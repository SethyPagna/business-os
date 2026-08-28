import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, revokeSessionsForDevice, type SessionUser } from '../lib/auth'
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
