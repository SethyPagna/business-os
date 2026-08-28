import { getDb } from './db'
import type { Env } from '../index'
import { isAdminControlUser, type PermissionUser } from './permissions'
import { audit } from './audit'

// Device-approval gate. See migrations/0005_trusted_devices.sql for the
// schema. Non-administrator accounts are enrolled: a device stays trusted
// until an administrator revokes it. Administrator-control accounts are
// intentionally exempt, so the person who administers approvals cannot be
// locked out by clearing browser storage or changing devices.

export type TrustedDeviceRow = {
  id: number
  user_id: number
  device_id: string
  device_name: string | null
  user_agent: string | null
  first_ip: string | null
  last_ip: string | null
  first_country: string | null
  last_country: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  decided_at: string | null
  decided_by_user_id: number | null
  decided_by_name: string | null
  last_seen_at: string
  revoked_at: string | null
}

export function requiresDeviceApproval(user: PermissionUser): boolean {
  return Boolean(user) && !isAdminControlUser(user)
}

// Each account may hold at most this many APPROVED devices at once — the
// user's rule (Aug 28): an employee can be signed in on at most 3 devices
// at the same time. Enforced at the admin approve endpoint, which is the
// ONLY path a device takes to 'approved'; a 4th device stays pending until
// an existing one is revoked. Admin-control accounts bypass the device gate
// entirely (see requiresDeviceApproval), so the cap governs employees.
export const MAX_APPROVED_DEVICES_PER_USER = 3

export async function countApprovedDevices(env: Env, userId: number, excludeRowId?: number): Promise<number> {
  const db = getDb(env)
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM trusted_devices
    WHERE user_id = @user_id AND status = 'approved' AND id != @exclude_id
  `).get<{ n: number }>({ user_id: userId, exclude_id: excludeRowId ?? -1 })
  return row?.n || 0
}

// Called after password (and OTP, if enabled) verify but before a session
// is issued. Returns `null` when the device is approved and login should
// proceed normally. Returns a status string otherwise, and the caller
// should refuse to issue a session.
export async function checkDeviceTrust(
  env: Env,
  userId: number,
  deviceId: string | null | undefined,
  meta: { deviceName?: string | null; userAgent?: string | null; ip?: string | null; country?: string | null },
): Promise<{ status: 'approved' } | { status: 'pending' | 'rejected' | 'missing_device_id' }> {
  if (!deviceId || !deviceId.trim()) {
    // A client that doesn't send a device id at all (e.g. an old cached
    // frontend build, or a direct API call) can't be recognized or
    // remembered -- fail closed into `pending` rather than silently
    // skipping the check, which would make the feature bypassable just by
    // omitting the field.
    return { status: 'missing_device_id' }
  }

  const db = getDb(env)
  const existing = await db.prepare(`
    SELECT * FROM trusted_devices WHERE user_id = @user_id AND device_id = @device_id LIMIT 1
  `).get<TrustedDeviceRow>({ user_id: userId, device_id: deviceId })

  if (!existing) {
    // This function is only reached for non-admin accounts. Every new
    // device begins pending: possession of a password alone is not enough
    // to bypass an administrator's device-approval policy.
    const initialStatus = 'pending'

    await db.prepare(`
      INSERT INTO trusted_devices (user_id, device_id, device_name, user_agent, first_ip, last_ip, first_country, last_country, status, decided_at)
      VALUES (@user_id, @device_id, @device_name, @user_agent, @ip, @ip, @country, @country, @status, @decided_at)
    `).run({
      user_id: userId,
      device_id: deviceId,
      device_name: meta.deviceName || null,
      user_agent: meta.userAgent || null,
      ip: meta.ip || null,
      country: meta.country || null,
      status: initialStatus,
      decided_at: null,
    })
    return { status: initialStatus }
  }

  if (existing.status === 'approved') {
    const incomingCountry = meta.country || null
    const priorCountry = existing.last_country || null
    // Only flag when both sides are known and actually differ -- a null on
    // either side (dev/local requests, or Cloudflare not attaching
    // cf-ipcountry) would otherwise fire on every request and drown out
    // real signal.
    if (incomingCountry && priorCountry && incomingCountry !== priorCountry) {
      await audit(env, userId, null, 'device_login_new_country', 'user', userId, {
        deviceId,
        deviceName: existing.device_name,
        previousCountry: priorCountry,
        newCountry: incomingCountry,
        ip: meta.ip || null,
      })
    }
    await db.prepare(`
      UPDATE trusted_devices SET last_seen_at = CURRENT_TIMESTAMP, last_ip = @ip, last_country = @country WHERE id = @id
    `).run({ id: existing.id, ip: meta.ip || existing.last_ip, country: meta.country || existing.last_country })
    return { status: 'approved' }
  }

  if (existing.status === 'rejected') {
    return { status: 'rejected' }
  }

  // Still pending -- refresh last-seen so the approval screen shows a
  // recent timestamp for repeated login attempts from the same device.
  await db.prepare(`
    UPDATE trusted_devices SET last_seen_at = CURRENT_TIMESTAMP, last_ip = @ip, last_country = @country WHERE id = @id
  `).run({ id: existing.id, ip: meta.ip || existing.last_ip, country: meta.country || existing.last_country })
  return { status: 'pending' }
}

export async function countPendingDevices(env: Env): Promise<number> {
  const db = getDb(env)
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM trusted_devices WHERE status = 'pending'`).get<{ n: number }>()
  return row?.n || 0
}
