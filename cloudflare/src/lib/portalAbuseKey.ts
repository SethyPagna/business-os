import type { Env } from '../index'

type PortalAbuseEnv = Env & { PORTAL_ABUSE_HMAC_SECRET?: string }

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Public portal abuse controls need stable keys, but raw phone numbers, IP
// addresses and user-agent strings do not belong in rate/lockout tables.
// A dedicated secret makes the stored value non-enumerable. Missing or weak
// configuration returns null so callers can fail the write closed.
export async function portalAbuseKey(env: Env, scope: string, value: unknown): Promise<string | null> {
  const secret = String((env as PortalAbuseEnv).PORTAL_ABUSE_HMAC_SECRET || '')
  if (secret.length < 32) return null
  const normalizedScope = String(scope || '').trim().slice(0, 80)
  const normalizedValue = String(value || '').trim()
  if (!normalizedScope || !normalizedValue) return null
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${normalizedScope}\u0000${normalizedValue}`),
  )
  return `hmac-v1:${bytesToHex(new Uint8Array(signature))}`
}
