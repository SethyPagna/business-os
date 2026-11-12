import { getDb } from './db'
import type { Env } from '../index'
import { isAdminControlUser, type PermissionUser } from './permissions'
import { audit } from './audit'
import { isValidDeviceId } from './deviceCookie'
import { broadcast } from '../durable-objects/broadcastHub'
import { getPlanLimits } from './planTier'

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
  cookie_bound_at?: string | null
  claimed_approval_ref?: number | null
}

export function requiresDeviceApproval(user: PermissionUser): boolean {
  return Boolean(user) && !isAdminControlUser(user)
}

// Each account may hold at most the plan value maxApprovedDevicesPerUser APPROVED devices at once (owner
// 12 Nov 2026: 5, raised from 3). Enforced at the admin approve endpoints,
// the ONLY paths a device takes to 'approved'; one more stays pending until
// an existing one is revoked or replaced. Admin-control accounts bypass the
// device gate entirely (see requiresDeviceApproval), so the cap governs
// employees. The API returns it as `limit`; the UI never hard-codes it.
export const maxApprovedDevicesPerUser = (env: Env): number => getPlanLimits(env).maxApprovedDevicesPerUser

export async function countApprovedDevices(env: Env, userId: number, excludeRowId?: number): Promise<number> {
  const db = getDb(env)
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM trusted_devices
    WHERE user_id = @user_id AND status = 'approved' AND id != @exclude_id
  `).get<{ n: number }>({ user_id: userId, exclude_id: excludeRowId ?? -1 })
  return row?.n || 0
}

export type DeviceTrustWaitUntil = (promise: Promise<unknown>) => void

// The admin bell's "a device is waiting" alert. A request hands in its waitUntil so the sign-in never waits on the broadcast;
// a caller with no request context (tests) awaits it.
async function notifyDevicePending(env: Env, waitUntil: DeviceTrustWaitUntil | undefined): Promise<void> {
  const sent = broadcast(env, 'notifications', { type: 'device_pending' })
  if (waitUntil) waitUntil(sent)
  else await sent
}

// Called after password (and OTP, if enabled) verify but before a session
// is issued. Returns `null` when the device is approved and login should
// proceed normally. Returns a status string otherwise, and the caller
// should refuse to issue a session.
export async function checkDeviceTrust(
  env: Env,
  userId: number,
  deviceId: string | null | undefined,
  meta: { deviceName?: string | null; userAgent?: string | null; ip?: string | null; country?: string | null; cookieVerified?: boolean },
  waitUntil?: DeviceTrustWaitUntil,
): Promise<{ status: 'approved'; shopDeviceId?: number } | { status: 'pending'; created: boolean; replacedDeviceId?: string; claimedRowId?: number; heldByOther?: boolean } | { status: 'rejected' | 'missing_device_id' }> {
  if (!isValidDeviceId(deviceId)) {
    // A client that doesn't send a usable device id (missing, over-long or
    // outside [A-Za-z0-9_-]; e.g. an old cached
    // frontend build, or a direct API call) can't be recognized or
    // remembered -- fail closed into `pending` rather than silently
    // skipping the check, which would make the feature bypassable just by
    // omitting the field.
    return { status: 'missing_device_id' }
  }

  const db = getDb(env)
  // One statement answers both questions: this account's own row for the
  // device, and whether an administrator has marked the device as a shop
  // device. The base row keeps the shop answer when the account has no row.
  // The marking is read whether or not the cookie verified, and only USED when it did:
  // a client-chosen body id can never claim a shop device, and the till's own id arriving
  // without its cookie must not create a pending row on it (review M-1).
  const found = await db.prepare(`
    SELECT td.*, s.id AS shop_device_row_id, s.marked_at AS shop_marked_at,
      s.label AS shop_label, s.last_seen_at AS shop_last_seen_at, s.last_ip AS shop_last_ip, s.last_country AS shop_last_country,
      (SELECT 1 FROM shop_devices r WHERE r.device_id = @device_id AND r.unmarked_at IS NOT NULL LIMIT 1) AS shop_retired,
      (SELECT 1 FROM trusted_devices o WHERE o.device_id = @device_id AND o.user_id != @user_id LIMIT 1) AS held_by_other,
      (SELECT 1 FROM trusted_devices o WHERE o.device_id = @device_id AND o.user_id != @user_id AND o.cookie_bound_at IS NOT NULL LIMIT 1) AS held_bound_by_other
    FROM (SELECT 1 AS one) base
    LEFT JOIN trusted_devices td ON td.user_id = @user_id AND td.device_id = @device_id
    LEFT JOIN shop_devices s ON s.device_id = @device_id AND s.unmarked_at IS NULL
  `).get<(Partial<TrustedDeviceRow> & { shop_device_row_id: number | null; shop_marked_at: string | null; shop_label: string | null; shop_last_seen_at: string | null; shop_last_ip: string | null; shop_last_country: string | null; shop_retired: number | null; held_by_other: number | null; held_bound_by_other: number | null }) | undefined>({ user_id: userId, device_id: deviceId })
  const existing = found && found.id != null ? (found as TrustedDeviceRow) : null
  const markedShopId = found?.shop_device_row_id ?? null
  const shopDeviceId = meta.cookieVerified ? markedShopId : null
  // A device cookie is only ever issued when the signing key exists, so only then is "has had a cookie" a fact about the row.
  const cookiesOn = Boolean(env.APP_ENCRYPTION_KEY)

  // Three cases where the presented id is no longer enough and the browser becomes a new one with a fresh pending id (the caller pins it):
  //  - this browser's cookie was issued for the approved row, but the id arrived without it (typed into a request body, or the cookie was cleared);
  //  - the id belonged to a shop device that an administrator has since unmarked. The id is retired: whoever still holds a copy of its cookie
  //    gets nothing from it, and the till itself continues under its new id, which the administrator marks from its pending request.
  //  - the id is the one of a marked till and arrived without its cookie: the till's own id is never given a pending row, so no stale request can be declined or approved on it.
  const retiredShopId = Boolean(found?.shop_retired) && !markedShopId
  const markedWithoutCookie = Boolean(markedShopId) && !meta.cookieVerified
  if (cookiesOn && (retiredShopId || markedWithoutCookie || (existing?.status === 'approved' && (existing.cookie_bound_at || found?.held_bound_by_other) && !meta.cookieVerified))) {
    // A claim is only a claim when the id came without its cookie: the genuine device, cookie in hand, on a retired id is not claiming anything (L-2).
    const claimed = existing?.status === 'approved' && !meta.cookieVerified ? existing : null
    const fresh = crypto.randomUUID()
    const made = await db.prepare(`
      INSERT INTO trusted_devices (user_id, device_id, device_name, user_agent, first_ip, last_ip, first_country, last_country, status, decided_at, cookie_bound_at, claimed_approval_ref)
      VALUES (@user_id, @device_id, @device_name, @user_agent, @ip, @ip, @country, @country, 'pending', NULL, CURRENT_TIMESTAMP, @claimed)
    `).run({ claimed: claimed ? claimed.id : null, user_id: userId, device_id: fresh, device_name: meta.deviceName || null, user_agent: meta.userAgent || null, ip: meta.ip || null, country: meta.country || null })
    if (Number(made?.changes || 0) > 0) await notifyDevicePending(env, waitUntil)
    return { status: 'pending', created: true, replacedDeviceId: fresh, ...(claimed ? { claimedRowId: claimed.id } : {}) }
  }

  // Only a refusal an administrator made after marking the device outranks the
  // shop marking. A decline from before the marking, or a row that a revoke or a
  // replace at the device cap turned into 'rejected' (revoked_at is set), is
  // history about a personal approval and never locks an employee out of the till.
  // An approved row of its own is a personal approval and is used as such.
  const refusedAfterMarking = existing?.status === 'rejected' && !existing.revoked_at
    && (!existing.decided_at || !found?.shop_marked_at || existing.decided_at >= found.shop_marked_at)
  if (shopDeviceId && !refusedAfterMarking && existing?.status !== 'approved') {
    await recordShopSignIn(env, userId, deviceId, shopDeviceId, found as NonNullable<typeof found>, meta)
    return { status: 'approved', shopDeviceId }
  }

  if (!existing) {
    // This function is only reached for non-admin accounts. Every new
    // device begins pending: possession of a password alone is not enough
    // to bypass an administrator's device-approval policy.
    const initialStatus = 'pending'
    // Bound only when a cookie really exists for this id: this response sets one (the cookie already verified, or no other account holds the id,
    // see the post-gate cookie helper in deviceCookie.ts), or another account's row on it is already bound. Otherwise the browser has no cookie to prove, and marking the row
    // bound would re-ask the whole shared browser after the approval (review N-1).
    const willBind = cookiesOn && (Boolean(meta.cookieVerified) || !found?.held_by_other || Boolean(found?.held_bound_by_other))

    // Two parallel first sign-ins race this insert; the unique index makes the
    // loser a no-op instead of a 500.
    const inserted = await db.prepare(`
      INSERT INTO trusted_devices (user_id, device_id, device_name, user_agent, first_ip, last_ip, first_country, last_country, status, decided_at, cookie_bound_at)
      VALUES (@user_id, @device_id, @device_name, @user_agent, @ip, @ip, @country, @country, @status, @decided_at, CASE WHEN @bind = 1 THEN CURRENT_TIMESTAMP END)
      ON CONFLICT(user_id, device_id) DO NOTHING
    `).run({
      user_id: userId,
      device_id: deviceId,
      device_name: meta.deviceName || null,
      user_agent: meta.userAgent || null,
      ip: meta.ip || null,
      country: meta.country || null,
      status: initialStatus,
      decided_at: null,
      bind: willBind ? 1 : 0,
    })
    // Only a row this call created raises the alert; a retry or a lost race does not.
    const created = Number(inserted?.changes || 0) > 0
    if (created) await notifyDevicePending(env, waitUntil)
    return { status: initialStatus, created, ...(found?.held_by_other ? { heldByOther: true } : {}) }
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
      UPDATE trusted_devices SET last_seen_at = CURRENT_TIMESTAMP, last_ip = @ip, last_country = @country,
        cookie_bound_at = COALESCE(cookie_bound_at, CASE WHEN @bind = 1 THEN CURRENT_TIMESTAMP END)
      WHERE id = @id
    `).run({ id: existing.id, ip: meta.ip || existing.last_ip, country: meta.country || existing.last_country, bind: cookiesOn ? 1 : 0 })
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
  return { status: 'pending', created: false }
}

// A till rarely changes address or country, so a sign-in from a new country on a
// shop device is the signal that a copied cookie is in use elsewhere: raise the
// same alert a personal device raises. The last-seen write is skipped (no D1
// call) unless the address or country changed or the last write is old.
const SHOP_SEEN_WRITE_EVERY_MS = 5 * 60 * 1000

async function recordShopSignIn(
  env: Env,
  userId: number,
  deviceId: string,
  shopDeviceId: number,
  shop: { shop_label: string | null; shop_last_seen_at: string | null; shop_last_ip: string | null; shop_last_country: string | null },
  meta: { ip?: string | null; country?: string | null },
): Promise<void> {
  const country = meta.country || null
  const priorCountry = shop.shop_last_country || null
  if (country && priorCountry && country !== priorCountry) {
    await audit(env, userId, null, 'device_login_new_country', 'user', userId, {
      // deviceName is what the bell shows (routes/notifications.ts): the till's label, not 'Device for user #12'.
      deviceId, deviceName: shop.shop_label || null, shopDeviceId, shopDevice: true, previousCountry: priorCountry, newCountry: country, ip: meta.ip || null,
    })
  }
  const ip = meta.ip || shop.shop_last_ip || null
  const seenAt = shop.shop_last_seen_at ? Date.parse(`${shop.shop_last_seen_at.replace(' ', 'T')}Z`) : NaN
  const recent = Number.isFinite(seenAt) && Date.now() - seenAt < SHOP_SEEN_WRITE_EVERY_MS
  if (recent && ip === (shop.shop_last_ip || null) && (country || priorCountry) === priorCountry) return
  await getDb(env).prepare(`
    UPDATE shop_devices SET last_seen_at = CURRENT_TIMESTAMP, last_ip = @ip, last_country = @country WHERE id = @id
  `).run({ id: shopDeviceId, ip, country: country || priorCountry })
}

export async function countPendingDevices(env: Env): Promise<number> {
  const db = getDb(env)
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM trusted_devices WHERE status = 'pending'`).get<{ n: number }>()
  return row?.n || 0
}
