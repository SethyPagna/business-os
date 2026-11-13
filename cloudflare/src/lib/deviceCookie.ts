import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { getDb } from './db'
import type { Env } from '../index'

// The device id's main home: a signed, HttpOnly cookie. The browser's own
// localStorage copy is still sent, but Safari clears script-written storage
// after 7 idle days and a full quota loses it; a server-set first-party cookie
// survives both. `__Host-` makes it host-only (never sent to the storefront
// host), Secure, Path=/. SameSite=Lax, not Strict: Google's redirect back to
// /oauth/callback is a cross-site top-level GET and Strict would drop it.
// Set only by the sign-in endpoints, never on ordinary responses, and left
// alone by logout: approval belongs to the browser, not to one login.
export const DEVICE_COOKIE_NAME = '__Host-bos_dev'
const DEVICE_COOKIE_MAX_AGE_SECONDS = 399 * 24 * 60 * 60
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/
const encoder = new TextEncoder()

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch (_) {
    return null
  }
}

const COOKIE_PURPOSE = 'bos-device-cookie-v1'
const TICKET_PURPOSE = 'bos-device-ticket-v1'

// Keyed from the existing APP_ENCRYPTION_KEY with a purpose prefix, so no new
// secret is needed and a cookie can never pass as a ticket. Without the key no
// cookie or ticket is issued or trusted and the body id alone decides, as before.
function signingKey(env: Env, purpose: string): Promise<CryptoKey> | null {
  const secret = env.APP_ENCRYPTION_KEY
  if (!secret) return null
  return crypto.subtle.importKey('raw', encoder.encode(`${purpose}:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signDeviceCookieValue(env: Env, deviceId: string): Promise<string | null> {
  const key = signingKey(env, COOKIE_PURPOSE)
  if (!key || !isValidDeviceId(deviceId)) return null
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, encoder.encode(deviceId)))
  return `${deviceId}.${toBase64Url(mac)}`
}

// The id inside a cookie value, only when its signature verifies.
export async function verifyDeviceCookieValue(env: Env, raw: string | null | undefined): Promise<string | null> {
  const key = signingKey(env, COOKIE_PURPOSE)
  if (!key || !raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 1) return null
  const deviceId = raw.slice(0, dot)
  const mac = fromBase64Url(raw.slice(dot + 1))
  if (!isValidDeviceId(deviceId) || !mac) return null
  const valid = await crypto.subtle.verify('HMAC', await key, mac, encoder.encode(deviceId))
  return valid ? deviceId : null
}

export async function pinDeviceCookie<E extends { Bindings: Env }>(c: Context<E>, deviceId: string): Promise<void> {
  const value = await signDeviceCookieValue(c.env, deviceId)
  if (!value) return
  setCookie(c, DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  })
}

// The id this sign-in is for: the verified cookie's id when there is one, else the
// body's (a browser that has no cookie yet). The cookie always wins: an id typed
// into a request body cannot displace it. Sets NO cookie: an id taken from a request
// body is client-chosen and may be one the gate is about to refuse, and a signed cookie
// for it would be the proof the gate asks for (review H1, 13 Nov 2026). The caller runs
// checkDeviceTrust on the returned id and then pinDeviceAfterGate on the answer.
export async function resolveDeviceId<E extends { Bindings: Env }>(c: Context<E>, _userId: number, bodyId: unknown): Promise<string | null> {
  const cookieId = await verifyDeviceCookieValue(c.env, getCookie(c, DEVICE_COOKIE_NAME))
  cookieVerifiedIds.delete(c)
  const body = isValidDeviceId(bodyId) ? bodyId : null
  const chosen = cookieId || body
  if (chosen && chosen === cookieId) cookieVerifiedIds.set(c, chosen)
  return chosen
}

// The only place a sign-in sets the device cookie, and only after the gate answered, so a
// refused id never gets one and a response carries at most one device cookie. Returns the id
// the session and the answer must use. The cookie goes to:
//  - the fresh id a pending answer issued (the browser adopts it);
//  - the accepted id of an approved sign-in (a rolling renewal; a pre-cookie row binds here);
//  - a pending id this very request created, or one whose cookie was already verified.
// Never to a rejected id, never to an id held by another account that arrived without its
// cookie, and never to an existing pending row sent only in a body.
export async function pinDeviceAfterGate<E extends { Bindings: Env }, T extends string | null | undefined>(
  c: Context<E>,
  deviceId: T,
  trust: { status: string; created?: boolean; replacedDeviceId?: string; heldByOther?: boolean },
): Promise<T | string> {
  if (trust.status === 'pending' && trust.replacedDeviceId) {
    await pinDeviceCookie(c, trust.replacedDeviceId)
    return trust.replacedDeviceId
  }
  const verified = isCookieVerifiedDevice(c, deviceId)
  const accept = trust.status === 'approved'
    || (trust.status === 'pending' && (verified || (Boolean(trust.created) && !trust.heldByOther)))
  if (accept && typeof deviceId === 'string') await pinDeviceCookie(c, deviceId)
  return deviceId
}

// A device approved before the cookie existed, signed in on a long session, never passes
// /login again, so its row would stay unbound and claimable by anyone who knows its id.
// On an authenticated request from a browser that has no valid device cookie, the row
// that session's device id names is bound once and the cookie is set. No D1 call when
// the cookie is already there (the ordinary request), one UPDATE when it is not, and
// nothing once the row is bound (the WHERE clause), so a lost cookie of a bound row
// is not re-issued from a session. An id another account has already bound is never
// adopted: a cookie proves the id, not the account, so it would sign in as that account.
const SESSION_COOKIE_NAME = 'bos_session' // lib/auth.ts SESSION_COOKIE_NAME; pinned by test-device-cookie-bound-pure
const SESSION_ADOPTABLE_CONTEXT_KEY = 'sessionDeviceAdoptable' // lib/auth.ts ADOPTABLE_CONTEXT_KEY; pinned by test-session-adoption-probe-pure (check f)

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function adoptSessionDeviceCookie<E extends { Bindings: Env }>(c: Context<E>, userId: number): Promise<void> {
  if (!c.env.APP_ENCRYPTION_KEY) return
  if (await verifyDeviceCookieValue(c.env, getCookie(c, DEVICE_COOKIE_NAME))) return
  // The session read already answered, in the same statement, whether any row could be adopted (lib/auth.ts wantsAdoptionProbe): when it says no,
  // the UPDATE below could only write 0 rows. Unanswered (any other caller, or a browser that sent a device cookie) means ask as before.
  if ((c as unknown as { get(key: string): unknown }).get(SESSION_ADOPTABLE_CONTEXT_KEY) === false) return
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return
  const bound = await getDb(c.env).prepare(`
    UPDATE trusted_devices SET cookie_bound_at = CURRENT_TIMESTAMP
    WHERE user_id = @user_id AND status = 'approved' AND cookie_bound_at IS NULL
      AND device_id = (SELECT device_id FROM user_sessions WHERE token_hash = @token_hash AND user_id = @user_id AND revoked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM trusted_devices o WHERE o.device_id = trusted_devices.device_id AND o.user_id <> trusted_devices.user_id AND o.cookie_bound_at IS NOT NULL)
    RETURNING device_id
  `).get<{ device_id: string }>({ user_id: userId, token_hash: await sha256Hex(token) })
  if (bound?.device_id && isValidDeviceId(bound.device_id)) await pinDeviceCookie(c, bound.device_id)
}

// The id resolveAndPinDevice chose for this request, remembered only when it
// came from a cookie whose signature verified. The shop-device path trusts
// nothing else: the body id is client-chosen.
const cookieVerifiedIds = new WeakMap<object, string>()

export function isCookieVerifiedDevice(c: object, deviceId: unknown): boolean {
  return typeof deviceId === 'string' && cookieVerifiedIds.get(c) === deviceId
}

// A short-lived proof that THIS browser just sent a correct password (or Google
// identity) from an unapproved device: the answer to a pending sign-in carries
// it, and POST /device-status accepts it to say whether the admin has decided
// yet, so the waiting screen can continue by itself. It names the account and
// device and nothing else; it opens no session and answers only a status.
export const DEVICE_TICKET_TTL_SECONDS = 10 * 60

export async function issueDeviceTicket(env: Env, userId: number, deviceId: string): Promise<string | null> {
  const key = signingKey(env, TICKET_PURPOSE)
  if (!key || !Number.isInteger(userId) || userId <= 0 || !isValidDeviceId(deviceId)) return null
  const message = `${userId}.${deviceId}.${Math.floor(Date.now() / 1000) + DEVICE_TICKET_TTL_SECONDS}`
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, encoder.encode(message)))
  return `${message}.${toBase64Url(mac)}`
}

export async function readDeviceTicket(env: Env, raw: unknown): Promise<{ userId: number; deviceId: string } | null> {
  const key = signingKey(env, TICKET_PURPOSE)
  if (!key || typeof raw !== 'string' || raw.length > 300) return null
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [userPart, deviceId, expiresPart, macPart] = parts
  const userId = Number(userPart)
  const expires = Number(expiresPart)
  const mac = fromBase64Url(macPart)
  if (!mac || !Number.isInteger(userId) || userId <= 0 || !Number.isInteger(expires) || !isValidDeviceId(deviceId)) return null
  const valid = await crypto.subtle.verify('HMAC', await key, mac, encoder.encode(`${userPart}.${deviceId}.${expiresPart}`))
  if (!valid || expires * 1000 <= Date.now()) return null
  return { userId, deviceId }
}
