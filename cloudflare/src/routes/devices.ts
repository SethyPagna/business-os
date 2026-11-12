import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, revokeSessionsForDevice, revokeUserSessions, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { isAdminControlUser } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import { buildInClause, chunkForBinding } from '../lib/sqlBinding'
import type { Env } from '../index'
import { maxApprovedDevicesPerUser, countApprovedDevices, type TrustedDeviceRow } from '../lib/deviceTrust'

// Admin device-approval management -- mounted at /api/auth/devices.
// Everything here requires an authenticated admin-control session (see
// lib/permissions.ts's isAdminControlUser): only someone already signed
// in from an administrator account can approve or reject another device.
// Administrators themselves are exempt from the device gate so they can
// always reach this management page after clearing browser data or moving
// to a replacement device.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

app.use('*', requireAuth)
app.use('*', async (c, next) => {
  if (!isAdminControlUser(c.get('user'))) {
    return c.json({ error: 'Administrator access required.' }, 403)
  }
  return next()
})

// ---- Live-session management (J3) ----------------------------------------
// Sessions are the other half of "device/session management": a device row
// says whether a FUTURE login passes the trust gate; a session row is a
// login that already happened and is still valid. getSessionUser checks
// `revoked_at IS NULL AND expires_at > now` on every request, so a revoke
// here bites on the target's very next request, not at their next login.

type LiveSessionRow = {
  id: number
  user_id: number
  device_id: string | null
  device_name: string | null
  device_tz: string | null
  user_agent: string | null
  last_ip: string | null
  created_at: string
  last_seen_at: string | null
  expires_at: string
  username: string
  user_name: string
}

// Explicit column list on purpose: `token_hash` is the session credential
// and must never leave the database, so no `s.*` here -- pinned by
// test-admin-sessions-pure.cjs.
const LIVE_SESSION_SELECT = `
  SELECT s.id, s.user_id, s.device_id, s.device_name, s.device_tz, s.user_agent,
         s.last_ip, s.created_at, s.last_seen_at, s.expires_at,
         u.username, u.name AS user_name
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.revoked_at IS NULL AND s.expires_at > @now`

// GET /api/auth/devices/sessions -- live sessions across all accounts,
// optionally scoped to one user via ?userId=. Most recently active first.
app.get('/sessions', async (c) => {
  const userId = c.req.query('userId')
  const db = getDb(c.env)
  const now = new Date().toISOString()
  const rows = userId
    ? await db.prepare(`${LIVE_SESSION_SELECT} AND s.user_id = @user_id ORDER BY s.last_seen_at DESC LIMIT 200`)
        .all<LiveSessionRow>({ now, user_id: userId })
    : await db.prepare(`${LIVE_SESSION_SELECT} ORDER BY s.last_seen_at DESC LIMIT 200`)
        .all<LiveSessionRow>({ now })
  return c.json({ sessions: rows || [] })
})

// POST /api/auth/devices/sessions/:id/revoke -- end ONE live session.
// Revoking your own current session is allowed (it is an honest
// sign-me-out; the admin just logs in again). Deliberately NOT marked
// "current" in the list: that would need the caller's token hash exposed
// out of lib/auth, and the credential stays private to that module.
app.post('/sessions/:id/revoke', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const session = await db.prepare(`
    SELECT id, user_id, device_id, device_name, user_agent, last_ip
    FROM user_sessions WHERE id = @id AND revoked_at IS NULL LIMIT 1
  `).get<Pick<LiveSessionRow, 'id' | 'user_id' | 'device_id' | 'device_name' | 'user_agent' | 'last_ip'>>({ id })
  if (!session) return c.json({ error: 'Live session not found' }, 404)

  await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id })

  await audit(c.env, admin.id, admin.username, 'session_revoked', 'user', session.user_id, {
    sessionId: session.id, deviceId: session.device_id, deviceName: session.device_name,
    userAgent: session.user_agent, lastIp: session.last_ip,
  })
  return c.json({ success: true })
})

// POST /api/auth/devices/sessions/revoke-user -- sign one account out
// everywhere ({ userId } in the body). The device trust rows are untouched:
// the person logs back in from an approved device without re-approval.
app.post('/sessions/revoke-user', async (c) => {
  const admin = c.get('user')
  const body = await c.req.json<{ userId?: unknown }>().catch(() => ({} as Record<string, unknown>))
  const userId = Number(body.userId)
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json({ error: 'A valid userId is required' }, 400)
  }
  const db = getDb(c.env)
  const liveCount = await db.prepare(
    'SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = @user_id AND revoked_at IS NULL',
  ).get<{ count: number }>({ user_id: userId })
  // Revoke ALL, no keep: "sign out everywhere" includes this device when an
  // admin aims it at their own account -- that is what the button promises.
  await revokeUserSessions(c.env, userId)
  await audit(c.env, admin.id, admin.username, 'sessions_revoked_all', 'user', userId, {
    revokedSessions: Number(liveCount?.count || 0),
  })
  return c.json({ success: true, revoked: Number(liveCount?.count || 0) })
})

// The other accounts with a pending or approved row on the same device, as a sub-select of the statement that lists the rows (no extra D1 call).
const SHARED_WITH_SQL = `(SELECT json_group_array(json_object('user_id', o.user_id, 'name', COALESCE(NULLIF(ou.name, ''), ou.username), 'status', o.status))
         FROM trusted_devices o JOIN users ou ON ou.id = o.user_id
         WHERE o.device_id = td.device_id AND o.user_id != td.user_id AND o.status IN ('pending', 'approved'))`
export type SharedWith = { user_id: number; name: string; status: 'pending' | 'approved' }
function parseSharedWith(json: string | null | undefined): SharedWith[] {
  if (!json) return []
  try { const parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

// GET /api/auth/devices/pending -- devices awaiting a decision, across all
// admin-control users (not just the caller's own account), so any admin
// can clear the queue. Small deployments realistically have very few admin
// accounts, so this doesn't need per-user scoping.
app.get('/pending', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare(`
    SELECT td.*, u.username, u.name AS user_name,
      (SELECT c.device_name FROM trusted_devices c WHERE c.id = td.claimed_approval_ref) AS claimed_device_name,
      ${SHARED_WITH_SQL} AS shared_with_json
    FROM trusted_devices td
    JOIN users u ON u.id = td.user_id
    WHERE td.status = 'pending'
    ORDER BY td.requested_at ASC
  `).all<TrustedDeviceRow & { username: string; user_name: string; claimed_device_name: string | null; shared_with_json?: string | null }>()
  // Other accounts that already have a row on the same device: the administrator sees them before approving (review P-1).
  const devices = (rows || []).map(({ shared_with_json, ...row }) => ({ ...row, shared_with: parseSharedWith(shared_with_json) }))
  return c.json({ devices, limit: maxApprovedDevicesPerUser(c.env) })
})

// GET /api/auth/devices -- full history (approved/rejected/pending),
// optionally filtered to one user via ?userId=.
app.get('/', async (c) => {
  const userId = c.req.query('userId')
  const db = getDb(c.env)
  const rows = userId
    ? await db.prepare(`
        SELECT td.*, u.username, u.name AS user_name, ${SHARED_WITH_SQL} AS shared_with_json
        FROM trusted_devices td
        JOIN users u ON u.id = td.user_id
        WHERE td.user_id = @user_id
        ORDER BY td.requested_at DESC
      `).all<TrustedDeviceRow & { username: string; user_name: string; shared_with_json?: string | null }>({ user_id: userId })
    : await db.prepare(`
        SELECT td.*, u.username, u.name AS user_name, ${SHARED_WITH_SQL} AS shared_with_json
        FROM trusted_devices td
        JOIN users u ON u.id = td.user_id
        ORDER BY td.requested_at DESC
        LIMIT 200
      `).all<TrustedDeviceRow & { username: string; user_name: string; shared_with_json?: string | null }>()
  const devices = (rows || []).map(({ shared_with_json, ...row }) => ({ ...row, shared_with: parseSharedWith(shared_with_json) }))
  return c.json({ devices, limit: maxApprovedDevicesPerUser(c.env) })
})

// A request on the id of a till that was marked and then unmarked is dead: the id is retired and the browser
// continues under a fresh one, so approving it would be an approval nobody can use (review M-1).
// The same read answers both questions an approval asks about the device: was it a shop device that is now retired, and does another account
// already have a pending or approved row on it (an approval then also proves possession of that device for the other account, review P-1).
async function deviceFacts(db: ReturnType<typeof getDb>, deviceId: string, userId: number): Promise<{ retired: boolean; others: number }> {
  const row = await db.prepare(`SELECT (SELECT 1 FROM shop_devices WHERE device_id = @device_id AND unmarked_at IS NOT NULL LIMIT 1) AS retired,
    (SELECT COUNT(DISTINCT o.user_id) FROM trusted_devices o WHERE o.device_id = @device_id AND o.user_id != @user_id AND o.status IN ('pending', 'approved')) AS others`)
    .get<{ retired: number | null; others: number | null }>({ device_id: deviceId, user_id: userId })
  return { retired: Boolean(row?.retired), others: Number(row?.others || 0) }
}

const SHARED_CONFIRM_ANSWER = { error: 'Another account already uses this device. Confirm to continue.', code: 'device_shared_confirm' } as const
const confirmedShared = (body: { confirmShared?: unknown } | null | undefined) => body?.confirmShared === true

const RETIRED_SHOP_ID_ANSWER = { error: 'This request is on a shop device that was unmarked, so an approval would not work. Ask the employee to sign in again.', code: 'shop_device_retired' } as const

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const device = await db.prepare('SELECT * FROM trusted_devices WHERE id = @id LIMIT 1').get<TrustedDeviceRow>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)

  // A rejection is deliberately terminal for this row. An administrator must
  // use the reset action, which removes this exact rejected request so the
  // next authenticated login creates a fresh pending request to review.
  if (device.status === 'rejected') {
    return c.json({
      error: 'This rejected device must be reset before it can request approval again.',
      code: 'device_reapproval_reset_required',
    }, 409)
  }

  // Repeating an approval after a successful decision is harmless and must
  // stay idempotent even if the account is now at the approved-device cap.
  if (device.status === 'approved') return c.json({ success: true, idempotent: true })

  const facts = await deviceFacts(db, device.device_id, device.user_id)
  if (facts.retired) return c.json(RETIRED_SHOP_ID_ANSWER, 409)
  if (facts.others > 0 && !confirmedShared(await c.req.json<{ confirmShared?: unknown }>().catch(() => null))) return c.json(SHARED_CONFIRM_ANSWER, 409)

  // At most maxApprovedDevicesPerUser(c.env) approved devices per account (owner
  // rule, 5 since 12 Nov 2026). Excluding this row keeps re-approving an already-approved
  // device idempotent instead of tripping its own limit.
  const approvedCount = await countApprovedDevices(c.env, device.user_id, device.id)
  if (approvedCount >= maxApprovedDevicesPerUser(c.env)) {
    return c.json({
      error: `This account already has ${approvedCount} approved devices (limit ${maxApprovedDevicesPerUser(c.env)}). Revoke one of its devices first, then approve this one.`,
      code: 'device_limit_reached',
      limit: maxApprovedDevicesPerUser(c.env),
    }, 409)
  }

  // The pre-read above improves the ordinary cap message, but it is not the
  // authority: this write repeats the count in its own WHERE predicate so two
  // stale approval requests cannot both consume the final device slot.
  const updated = await db.prepare(`
    UPDATE trusted_devices
    SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name, revoked_at = NULL
    WHERE id = @id AND user_id = @user_id AND status = 'pending'
      AND (SELECT COUNT(*) FROM trusted_devices
           WHERE user_id = @user_id AND status = 'approved' AND id != @id) < @approved_device_limit
  `).run({
    id,
    user_id: device.user_id,
    admin_id: admin.id,
    admin_name: admin.name,
    approved_device_limit: maxApprovedDevicesPerUser(c.env),
  })

  // A concurrent reject/reset must never be overwritten by this stale
  // approval read. The guarded update changed no row, so report the state
  // that now exists instead of writing an audit decision that did not happen.
  if (!updated?.changes) {
    const current = await db.prepare('SELECT status FROM trusted_devices WHERE id = @id LIMIT 1')
      .get<Pick<TrustedDeviceRow, 'status'>>({ id })
    if (current?.status === 'approved') return c.json({ success: true, idempotent: true })
    if (current?.status === 'rejected') {
      return c.json({
        error: 'This rejected device must be reset before it can request approval again.',
        code: 'device_reapproval_reset_required',
      }, 409)
    }
    if (current?.status === 'pending') {
      const currentApprovedCount = await countApprovedDevices(c.env, device.user_id, device.id)
      if (currentApprovedCount >= maxApprovedDevicesPerUser(c.env)) {
        return c.json({
          error: `This account already has ${currentApprovedCount} approved devices (limit ${maxApprovedDevicesPerUser(c.env)}). Revoke one of its devices first, then approve this one.`,
          code: 'device_limit_reached',
          limit: maxApprovedDevicesPerUser(c.env),
        }, 409)
      }
    }
    return c.json({ error: 'Device request is no longer available.' }, 409)
  }

  await audit(c.env, admin.id, admin.username, 'device_approved', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, userAgent: device.user_agent,
    firstIp: device.first_ip, lastIp: device.last_ip, firstCountry: device.first_country,
    lastCountry: device.last_country, targetTrustedDeviceRowId: device.id,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'notifications', { type: 'device_decision' }))

  return c.json({ success: true })
})

// POST /api/auth/devices/:id/approve-replacing { revokeId } -- approve a
// pending device for an account that is at the cap by revoking one of that
// account's approved devices in the same step. One db.batch (one SQLite
// transaction): the guard throws, rolling everything back, unless both rows are
// still in the state this request read; the new row's UPDATE repeats the cap
// count after the revoke; and a closing guard throws if the approval did not
// land, so the cap can never be exceeded and a half-done swap cannot persist.
app.post('/:id/approve-replacing', async (c) => {
  const id = Number(c.req.param('id'))
  const admin = c.get('user')
  const body = await c.req.json<{ revokeId?: unknown; confirmShared?: unknown }>().catch(() => ({} as { revokeId?: unknown; confirmShared?: unknown }))
  const revokeId = Number(body.revokeId)
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(revokeId) || revokeId <= 0 || id === revokeId) {
    return c.json({ error: 'A pending device and a different approved device are required.', code: 'device_replace_invalid' }, 400)
  }
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT * FROM trusted_devices WHERE id IN (@id, @revoke_id)')
    .all<TrustedDeviceRow>({ id, revoke_id: revokeId })
  const device = (rows || []).find((row) => row.id === id)
  const old = (rows || []).find((row) => row.id === revokeId)
  if (!device) return c.json({ error: 'Device request not found' }, 404)
  if (device.status === 'rejected') {
    return c.json({
      error: 'This rejected device must be reset before it can request approval again.',
      code: 'device_reapproval_reset_required',
    }, 409)
  }
  if (device.status === 'approved') return c.json({ success: true, idempotent: true })
  if (!old || old.user_id !== device.user_id || old.status !== 'approved') {
    return c.json({ error: 'Choose an approved device of the same account to replace.', code: 'device_replace_invalid' }, 400)
  }
  const facts = await deviceFacts(db, device.device_id, device.user_id)
  if (facts.retired) return c.json(RETIRED_SHOP_ID_ANSWER, 409)
  if (facts.others > 0 && !confirmedShared(body)) return c.json(SHARED_CONFIRM_ANSWER, 409)

  const params = {
    id: device.id,
    revoke_id: old.id,
    user_id: device.user_id,
    old_device_id: old.device_id,
    admin_id: admin.id,
    admin_name: admin.name,
    approved_device_limit: maxApprovedDevicesPerUser(c.env),
    replace_guard_error: '{',
  }
  let results: Array<{ meta?: { changes?: number } }>
  try {
    results = await db.batch([
      {
        sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM trusted_devices WHERE id = @id AND user_id = @user_id AND status = 'pending')
          AND EXISTS (SELECT 1 FROM trusted_devices WHERE id = @revoke_id AND user_id = @user_id AND status = 'approved')
          THEN 1 ELSE json_extract(@replace_guard_error, '$') END AS device_replace_guard`,
        params,
      },
      {
        sql: `UPDATE trusted_devices
          SET status = 'rejected', revoked_at = CURRENT_TIMESTAMP, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name
          WHERE id = @revoke_id AND user_id = @user_id AND status = 'approved'`,
        params,
      },
      {
        sql: `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = @user_id AND revoked_at IS NULL
            AND (
              device_id = @old_device_id
              OR limit_family_id IN (SELECT id FROM user_sessions WHERE user_id = @user_id AND device_id = @old_device_id)
            )`,
        params,
      },
      {
        sql: `UPDATE trusted_devices
          SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name, revoked_at = NULL
          WHERE id = @id AND user_id = @user_id AND status = 'pending'
            AND (SELECT COUNT(*) FROM trusted_devices
                 WHERE user_id = @user_id AND status = 'approved' AND id != @id) < @approved_device_limit`,
        params,
      },
      {
        sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM trusted_devices WHERE id = @id AND user_id = @user_id AND status = 'approved')
          THEN 1 ELSE json_extract(@replace_guard_error, '$') END AS device_replace_landed`,
        params,
      },
    ])
  } catch (error) {
    if (error instanceof Error && error.message.includes('malformed JSON')) {
      return c.json({ error: 'The devices changed while you were deciding. Reload and try again.', code: 'device_replace_conflict' }, 409)
    }
    throw error
  }
  const revokedSessions = Number(results[2]?.meta?.changes || 0)

  await audit(c.env, admin.id, admin.username, 'device_revoked', 'user', old.user_id, {
    deviceId: old.device_id, deviceName: old.device_name, userAgent: old.user_agent,
    firstIp: old.first_ip, lastIp: old.last_ip, firstCountry: old.first_country,
    lastCountry: old.last_country, targetTrustedDeviceRowId: old.id, revokedSessions,
    replacedByTrustedDeviceRowId: device.id,
  })
  await audit(c.env, admin.id, admin.username, 'device_approved', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, userAgent: device.user_agent,
    firstIp: device.first_ip, lastIp: device.last_ip, firstCountry: device.first_country,
    lastCountry: device.last_country, targetTrustedDeviceRowId: device.id,
    replacedTrustedDeviceRowId: old.id,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'notifications', { type: 'device_decision' }))

  return c.json({ success: true, revokedSessions })
})

// POST /api/auth/devices/:id/reset -- remove one rejected trust row so the
// same persistent device id can create a new pending request at its next
// authenticated login. Reset does not approve the device and does not alter
// any earlier audit history.
app.post('/:id/reset', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const device = await db.prepare('SELECT * FROM trusted_devices WHERE id = @id LIMIT 1').get<TrustedDeviceRow>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)
  if (device.status !== 'rejected') return c.json({ error: 'Only rejected devices can be reset for re-approval.' }, 400)

  // D1 batch is one SQLite transaction. The guard throws when the row changed
  // after the pre-read, rolling back both the targeted session revoke and the
  // delete. The session update itself requires the exact rejected row to still
  // exist, so it can never revoke a later approval/reapproval session.
  const params = { id: device.id, user_id: device.user_id, device_id: device.device_id, reapproval_reset_guard_error: '{' }
  let resetResults: Array<{ meta?: { changes?: number } }>
  try {
    resetResults = await db.batch([
      {
        sql: `SELECT CASE WHEN EXISTS (
          SELECT 1 FROM trusted_devices
          WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected'
        ) THEN 1 ELSE json_extract(@reapproval_reset_guard_error, '$') END AS device_reapproval_reset_guard`,
        params,
      },
      {
        sql: `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = @user_id AND device_id = @device_id AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM trusted_devices WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected')`,
        params,
      },
      {
        sql: `DELETE FROM trusted_devices
          WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected'`,
        params,
      },
    ])
  } catch (error) {
    if (error instanceof Error && error.message.includes('malformed JSON')) {
      return c.json({ error: 'Device request is no longer rejected.' }, 409)
    }
    throw error
  }
  const revokedSessions = Number(resetResults[1]?.meta?.changes || 0)

  await audit(c.env, admin.id, admin.username, 'device_reapproval_reset', 'user', device.user_id, {
    targetTrustedDeviceRowId: device.id,
    deviceId: device.device_id,
    deviceName: device.device_name,
    previousState: 'rejected',
    priorDecision: {
      decidedAt: device.decided_at,
      decidedByUserId: device.decided_by_user_id,
      decidedByName: device.decided_by_name,
      revokedAt: device.revoked_at,
    },
    revokedSessions,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'notifications', { type: 'device_decision' }))

  return c.json({ success: true, revokedSessions, nextLoginDeviceStatus: 'pending' })
})

app.post('/:id/reject', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const device = await db.prepare('SELECT * FROM trusted_devices WHERE id = @id LIMIT 1').get<TrustedDeviceRow>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)

  await db.prepare(`
    UPDATE trusted_devices
    SET status = 'rejected', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name
    WHERE id = @id
  `).run({ id, admin_id: admin.id, admin_name: admin.name })

  // Reject also revokes any live session for this device, so a decision is
  // effective immediately rather than only at the next login.
  const revokedSessions = await revokeSessionsForDevice(c.env, device.user_id, device.device_id)

  await audit(c.env, admin.id, admin.username, 'device_rejected', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, userAgent: device.user_agent,
    firstIp: device.first_ip, lastIp: device.last_ip, firstCountry: device.first_country,
    lastCountry: device.last_country, targetTrustedDeviceRowId: device.id, revokedSessions,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'notifications', { type: 'device_decision' }))

  return c.json({ success: true, revokedSessions })
})

// POST /api/auth/devices/:id/revoke -- pull trust from a *previously
// approved* device (e.g. a laptop that was sold/lost). Distinct from
// reject: reject answers a pending request, revoke undoes a past
// approval. Existing sessions created from that device stay valid until
// they naturally expire or are separately revoked via user_sessions --
// this only affects whether a *future* login from that device id passes
// the trust check again.
app.post('/:id/revoke', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const device = await db.prepare('SELECT * FROM trusted_devices WHERE id = @id LIMIT 1').get<TrustedDeviceRow>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)
  if (device.status !== 'approved') return c.json({ error: 'Only approved devices can be revoked.' }, 400)

  await db.prepare(`
    UPDATE trusted_devices
    SET status = 'rejected', revoked_at = CURRENT_TIMESTAMP, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name
    WHERE id = @id
  `).run({ id, admin_id: admin.id, admin_name: admin.name })

  // This is the actual point of "revoke a stolen/lost device": previously
  // this only stopped a *future* login from that device id -- a session
  // it already held (the whole reason you're revoking it) stayed valid
  // until it expired on its own, sometimes days later. Now the live
  // session dies in the same request as the revoke.
  const revokedSessions = await revokeSessionsForDevice(c.env, device.user_id, device.device_id)

  await audit(c.env, admin.id, admin.username, 'device_revoked', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, userAgent: device.user_agent,
    firstIp: device.first_ip, lastIp: device.last_ip, firstCountry: device.first_country,
    lastCountry: device.last_country, targetTrustedDeviceRowId: device.id, revokedSessions,
  })
  c.executionCtx.waitUntil(broadcast(c.env, 'notifications', { type: 'device_decision' }))

  return c.json({ success: true, revokedSessions })
})

// ---- Shop devices (owner 12 Nov 2026) --------------------------------------
// An administrator marks a till once; every active employee then signs in
// there without a separate approval and without using one of their own device
// slots (lib/deviceTrust.ts checkDeviceTrust). The shop path only ever matches
// an id that arrived in the verified device cookie. Unmarking revokes the
// sessions that came in through the shop path, never an administrator's own.
const SHOP_LABEL_MAX = 60

type ShopDeviceRow = {
  id: number
  device_id: string
  label: string
  marked_by_user_id: number | null
  marked_by_name: string | null
  marked_at: string
  last_seen_at: string | null
  last_ip: string | null
  last_country: string | null
  unmarked_at: string | null
  device_name: string | null
}

// GET /api/auth/devices/shop -- the devices currently marked as shop devices.
app.get('/shop', async (c) => {
  const rows = await getDb(c.env).prepare(`
    SELECT s.id, s.device_id, s.label, s.marked_by_user_id, s.marked_by_name, s.marked_at, s.last_seen_at, s.last_ip, s.last_country,
      (SELECT t.device_name FROM trusted_devices t WHERE t.device_id = s.device_id AND t.device_name IS NOT NULL LIMIT 1) AS device_name
    FROM shop_devices s
    WHERE s.unmarked_at IS NULL
    ORDER BY s.marked_at DESC
    LIMIT 100
  `).all<ShopDeviceRow>()
  return c.json({ shopDevices: rows || [] })
})

// POST /api/auth/devices/:id/mark-shop { label } -- :id is a PENDING or
// APPROVED trusted_devices row; its device id becomes a shop device. Marking
// costs no slot: the batch removes every pending or approved row for that
// browser (any employee's), because the marking replaces them. Unmarking then
// really does mean "each employee needs an approval again".
app.post('/:id/mark-shop', async (c) => {
  const id = Number(c.req.param('id'))
  const admin = c.get('user')
  const body = await c.req.json<{ label?: unknown; confirmShared?: unknown }>().catch(() => ({} as { label?: unknown; confirmShared?: unknown }))
  const label = typeof body.label === 'string' ? body.label.trim().replace(/\s+/g, ' ') : ''
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Device request not found' }, 404)
  if (!label || label.length > SHOP_LABEL_MAX) {
    return c.json({ error: `Give the shop device a name of 1 to ${SHOP_LABEL_MAX} characters.`, code: 'shop_label_invalid' }, 400)
  }
  const db = getDb(c.env)
  const device = await db.prepare(`SELECT t.*, (SELECT 1 FROM shop_devices s WHERE s.device_id = t.device_id AND s.unmarked_at IS NOT NULL LIMIT 1) AS shop_retired
    FROM trusted_devices t WHERE t.id = @id LIMIT 1`).get<TrustedDeviceRow & { shop_retired: number | null }>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)
  if (device.shop_retired) {
    return c.json({ error: 'This device was a shop device before and is given a new identity when it signs in again. Decide on its new request instead.', code: 'shop_device_retired' }, 409)
  }
  if (device.status !== 'approved' && device.status !== 'pending') return c.json({ error: 'Only a pending or approved device can be marked as a shop device.', code: 'shop_device_not_approved' }, 409)
  // A request that says it comes from an approved device but could not prove it is a browser that learned that id: the panel hides the button, and the server refuses too (review N-3).
  if (device.status === 'pending' && device.claimed_approval_ref) {
    return c.json({ error: 'This request says it comes from an approved device but could not show it. Decline it, or mark the approved device instead.', code: 'shop_device_claimed' }, 409)
  }
  // Rows for this browser no longer matter once it is a shop device (every
  // employee passes there): waiting requests would stay in the queue and bell,
  // and approved rows would hold a slot for nothing. The same batch removes them.
  const waiting = await db.prepare(`SELECT id, user_id, status, cookie_bound_at IS NOT NULL AS bound FROM trusted_devices WHERE device_id = @device_id AND status IN ('pending', 'approved') LIMIT 200`)
    .all<{ id: number; user_id: number; status: string; bound: number }>({ device_id: device.device_id })
  // A marking only works for a browser that holds the device cookie (the marked id is used only with a verified cookie), and the marking removes the rows
  // through which that cookie would otherwise be issued. So the device must have had its cookie issued first: some row on it is bound (review M-A).
  if (!(waiting || []).some((row) => row.bound)) {
    return c.json({ error: 'Sign in on this device once, then mark it as a shop device.', code: 'shop_device_unbound' }, 409)
  }
  // The approved rows the marking deletes were the only thing those employees' live sessions on this browser stood on. Tag the sessions with the
  // new marking in the same batch, so unmarking revokes them like any other shop sign-in (otherwise they outlive the unmark with no approval behind
  // them and no device row an administrator could revoke). Only the accounts whose approved row is deleted: an administrator's session is never touched.
  const approvedUserIds = [...new Set((waiting || []).filter((row) => row.status === 'approved').map((row) => row.user_id))]
  // One UPDATE per chunk of accounts: D1 refuses more than 100 bound parameters and @device_id is bound three times in each statement.
  const tagStatements = chunkForBinding(approvedUserIds, 3).map((chunk) => {
    const list = buildInClause('u', chunk)
    return {
      sql: `UPDATE user_sessions SET shop_device_id = (SELECT id FROM shop_devices WHERE device_id = @device_id AND unmarked_at IS NULL)
        WHERE device_id = @device_id AND revoked_at IS NULL AND shop_device_id IS NULL
          AND user_id IN (${list.sql})
          AND EXISTS (SELECT 1 FROM shop_devices WHERE device_id = @device_id AND unmarked_at IS NULL)`,
      params: { device_id: device.device_id, ...list.params } as Record<string, string | number>,
    }
  })
  // A pending request whose id another account already holds an approved device for is a browser that learned that id (it is not secret): marking it
  // would delete the other account's approval and open that device to every employee. Refuse; the administrator declines it, or marks the approved device.
  if (device.status === 'pending' && (waiting || []).some((row) => row.status === 'approved' && row.user_id !== device.user_id)) {
    return c.json({ error: 'Another account already has an approved device with this id, so this request may be a copy of it. Decline the request, or mark the approved device instead.', code: 'shop_device_held' }, 409)
  }
  // More than one account on this device: marking it opens it to every employee and removes all of those accounts' rows, so the administrator confirms it (review P-1 HC).
  if (new Set((waiting || []).map((row) => row.user_id)).size > 1 && !confirmedShared(body)) return c.json(SHARED_CONFIRM_ANSWER, 409)
  let inserted: { changes?: number } | undefined
  let closed = 0
  let tagged = 0
  try {
    const results = await db.batch([
      {
        sql: `INSERT INTO shop_devices (device_id, label, marked_by_user_id, marked_by_name)
          SELECT @device_id, @label, @admin_id, @admin_name
          WHERE EXISTS (SELECT 1 FROM trusted_devices WHERE id = @id AND status IN ('pending', 'approved'))`,
        params: { id, device_id: device.device_id, label, admin_id: admin.id, admin_name: admin.name },
      },
      {
        sql: `DELETE FROM trusted_devices WHERE device_id = @device_id AND status IN ('pending', 'approved') AND changes() = 1`,
        params: { device_id: device.device_id },
      },
      ...tagStatements,
    ])
    inserted = { changes: Number(results[0]?.meta?.changes || 0) }
    closed = Number(results[1]?.meta?.changes || 0)
    tagged = results.slice(2).reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0)
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return c.json({ error: 'This device is already marked as a shop device.', code: 'shop_device_exists' }, 409)
    }
    throw error
  }
  if (!inserted?.changes) return c.json({ error: 'The device changed while you were deciding. Reload and try again.', code: 'shop_device_conflict' }, 409)
  await audit(c.env, admin.id, admin.username, 'shop_device_marked', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, label, targetTrustedDeviceRowId: device.id,
  })
  if (closed > 0) {
    await audit(c.env, admin.id, admin.username, 'shop_device_rows_removed', 'user', admin.id, {
      deviceId: device.device_id, label, closedRows: (waiting || []).map((row) => ({ rowId: row.id, userId: row.user_id, status: row.status })), closedCount: closed, taggedSessions: tagged,
    })
  }
  return c.json({ success: true, removedRows: closed })
})

// POST /api/auth/devices/shop/:shopId/unmark -- one batch (one transaction)
// ends the marking and revokes the sessions the shop path issued (and the
// sessions re-issued from them), so the next sign-in there needs an approval.
// The device id is retired for good: its next sign-in is given a fresh id (see
// checkDeviceTrust), so a copy of its cookie stops working, and the same id can
// never be marked again.
app.post('/shop/:shopId/unmark', async (c) => {
  const shopId = Number(c.req.param('shopId'))
  const admin = c.get('user')
  if (!Number.isInteger(shopId) || shopId <= 0) return c.json({ error: 'Shop device not found' }, 404)
  const db = getDb(c.env)
  const shop = await db.prepare('SELECT id, device_id, label, unmarked_at FROM shop_devices WHERE id = @id LIMIT 1')
    .get<{ id: number; device_id: string; label: string; unmarked_at: string | null }>({ id: shopId })
  if (!shop) return c.json({ error: 'Shop device not found' }, 404)
  if (shop.unmarked_at) return c.json({ success: true, idempotent: true, revokedSessions: 0 })
  const params = { id: shopId, admin_id: admin.id, admin_name: admin.name }
  const results = await db.batch([
    {
      sql: `UPDATE shop_devices SET unmarked_at = CURRENT_TIMESTAMP, unmarked_by_user_id = @admin_id, unmarked_by_name = @admin_name
        WHERE id = @id AND unmarked_at IS NULL`,
      params,
    },
    {
      sql: `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
        WHERE revoked_at IS NULL
          AND (shop_device_id = @id OR limit_family_id IN (SELECT id FROM user_sessions WHERE shop_device_id = @id))`,
      params: { id: shopId },
    },
  ])
  const revokedSessions = Number(results[1]?.meta?.changes || 0)
  await audit(c.env, admin.id, admin.username, 'shop_device_unmarked', 'user', admin.id, {
    deviceId: shop.device_id, label: shop.label, shopDeviceRowId: shop.id, revokedSessions,
  })
  return c.json({ success: true, revokedSessions })
})

export default app
