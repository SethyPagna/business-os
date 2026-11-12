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

// Keyed from the existing APP_ENCRYPTION_KEY with a purpose prefix, so no new
// secret is needed. Without the key no cookie is issued or trusted and the
// body id alone decides, as before.
function signingKey(env: Env): Promise<CryptoKey> | null {
  const secret = env.APP_ENCRYPTION_KEY
  if (!secret) return null
  return crypto.subtle.importKey('raw', encoder.encode(`bos-device-cookie-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signDeviceCookieValue(env: Env, deviceId: string): Promise<string | null> {
  const key = signingKey(env)
  if (!key || !isValidDeviceId(deviceId)) return null
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, encoder.encode(deviceId)))
  return `${deviceId}.${toBase64Url(mac)}`
}

// The id inside a cookie value, only when its signature verifies.
export async function verifyDeviceCookieValue(env: Env, raw: string | null | undefined): Promise<string | null> {
  const key = signingKey(env)
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

// The id this sign-in is for: the verified cookie's id, else the body's. When
// both exist and differ, one read adopts the id this account has already
// approved, then a row that already exists (so a retry never adds another
// pending row), then the cookie. Pins the cookie to the result on every call
// (a rolling renewal; no D1 call), so a browser that only had the localStorage
// id gets the cookie at its first sign-in. Never answers 'approved' by itself: the caller still runs
// checkDeviceTrust on the returned id.
export async function resolveAndPinDevice<E extends { Bindings: Env }>(c: Context<E>, userId: number, bodyId: unknown): Promise<string | null> {
  const cookieId = await verifyDeviceCookieValue(c.env, getCookie(c, DEVICE_COOKIE_NAME))
  const body = isValidDeviceId(bodyId) ? bodyId : null
  let chosen = cookieId || body
  if (cookieId && body && cookieId !== body) {
    const rows = await getDb(c.env).prepare(
      'SELECT device_id, status FROM trusted_devices WHERE user_id = @user_id AND device_id IN (@cookie_id, @body_id)',
    ).all<{ device_id: string; status: string }>({ user_id: userId, cookie_id: cookieId, body_id: body })
    const known = rows || []
    chosen = known.find((row) => row.status === 'approved')?.device_id
      || known.find((row) => row.device_id === cookieId)?.device_id
      || known.find((row) => row.device_id === body)?.device_id
      || cookieId
  }
  if (chosen) await pinDeviceCookie(c, chosen)
  return chosen
}
