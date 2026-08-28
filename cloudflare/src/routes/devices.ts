import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, revokeSessionsForDevice, revokeUserSessions, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { isAdminControlUser } from '../lib/permissions'
import { broadcast } from '../durable-objects/broadcastHub'
import type { Env } from '../index'
import { MAX_APPROVED_DEVICES_PER_USER, countApprovedDevices, type TrustedDeviceRow } from '../lib/deviceTrust'

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
  await revokeUserSessions(c.env, userId)
  await audit(c.env, admin.id, admin.username, 'sessions_revoked_all', 'user', userId, {
    revokedSessions: Number(liveCount?.count || 0),
  })
  return c.json({ success: true, revoked: Number(liveCount?.count || 0) })
})

// GET /api/auth/devices/pending -- devices awaiting a decision, across all
// admin-control users (not just the caller's own account), so any admin
// can clear the queue. Small deployments realistically have very few admin
// accounts, so this doesn't need per-user scoping.
app.get('/pending', async (c) => {
  const db = getDb(c.env)
  const rows = await db.prepare(`
    SELECT td.*, u.username, u.name AS user_name
    FROM trusted_devices td
    JOIN users u ON u.id = td.user_id
    WHERE td.status = 'pending'
    ORDER BY td.requested_at ASC
  `).all<TrustedDeviceRow & { username: string; user_name: string }>()
  return c.json({ devices: rows || [] })
})

// GET /api/auth/devices -- full history (approved/rejected/pending),
// optionally filtered to one user via ?userId=.
app.get('/', async (c) => {
  const userId = c.req.query('userId')
  const db = getDb(c.env)
  const rows = userId
    ? await db.prepare(`
        SELECT td.*, u.username, u.name AS user_name
        FROM trusted_devices td
        JOIN users u ON u.id = td.user_id
        WHERE td.user_id = @user_id
        ORDER BY td.requested_at DESC
      `).all<TrustedDeviceRow & { username: string; user_name: string }>({ user_id: userId })
    : await db.prepare(`
        SELECT td.*, u.username, u.name AS user_name
        FROM trusted_devices td
        JOIN users u ON u.id = td.user_id
        ORDER BY td.requested_at DESC
        LIMIT 200
      `).all<TrustedDeviceRow & { username: string; user_name: string }>()
  return c.json({ devices: rows || [] })
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const admin = c.get('user')
  const db = getDb(c.env)
  const device = await db.prepare('SELECT * FROM trusted_devices WHERE id = @id LIMIT 1').get<TrustedDeviceRow>({ id })
  if (!device) return c.json({ error: 'Device request not found' }, 404)

  // At most MAX_APPROVED_DEVICES_PER_USER approved devices per account (the
  // Aug-28 rule). Excluding this row keeps re-approving an already-approved
  // device idempotent instead of tripping its own limit.
  const approvedCount = await countApprovedDevices(c.env, device.user_id, device.id)
  if (approvedCount >= MAX_APPROVED_DEVICES_PER_USER) {
    return c.json({
      error: `This account already has ${approvedCount} approved devices (limit ${MAX_APPROVED_DEVICES_PER_USER}). Revoke one of its devices first, then approve this one.`,
      code: 'device_limit_reached',
      limit: MAX_APPROVED_DEVICES_PER_USER,
    }, 409)
  }

  await db.prepare(`
    UPDATE trusted_devices
    SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = @admin_id, decided_by_name = @admin_name, revoked_at = NULL
    WHERE id = @id
  `).run({ id, admin_id: admin.id, admin_name: admin.name })

  await audit(c.env, admin.id, admin.username, 'device_approved', 'user', device.user_id, {
    deviceId: device.device_id, deviceName: device.device_name, userAgent: device.user_agent,
    firstIp: device.first_ip, lastIp: device.last_ip, firstCountry: device.first_country,
    lastCountry: device.last_country, targetTrustedDeviceRowId: device.id,
  })
  await broadcast(c.env, 'notifications', { type: 'device_decision' })

  return c.json({ success: true })
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
  await broadcast(c.env, 'notifications', { type: 'device_decision' })

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
  await broadcast(c.env, 'notifications', { type: 'device_decision' })

  return c.json({ success: true, revokedSessions })
})

export default app
