import type { Env } from '../index'

// One-way keys for the storefront's abuse counters (N45).
//
// The counters that protect the public portal -- the sliding window in
// rate_limit_events and the flat lockout in portal_auth_lockouts -- work by
// counting rows that share a key. They only ever compare keys for equality;
// nothing reads a key back or displays it. But the keys themselves were the
// raw identifiers: a visitor's IP address, their IP+user-agent pair, and for
// sign-in lockouts the CANONICAL PHONE NUMBER of the account being attempted.
// That last one is the sharpest: a table of phone numbers that tried to sign
// in, sitting beside a failure count.
//
// A one-way key does the same counting job and keeps none of that. Same input
// gives the same key, so the limits behave identically; the stored value is a
// digest that cannot be read back into a phone number or an address.
//
// SALT. Without one, a digest of a phone number or an IPv4 address is not
// really anonymous -- both spaces are small enough to enumerate offline. The
// salt is taken from a secret the Worker already holds, and there is no
// fallback that pretends otherwise: if neither secret is bound, this returns
// an UNSALTED digest and the caller still gets working rate limiting, but the
// deployment should bind AUTH_SESSION_SECRET (see the lane report -- this is
// flagged for the owner, not something a migration can fix).
//
// SCOPE is mixed into the digest so the same phone number in the sign-in
// lockout and the same address in a rate-limit bucket do not produce the same
// key, and one table's contents cannot be used to probe another's.
//
// Rotating the salt (or binding one for the first time) resets the counters,
// because old rows no longer match. That is harmless and self-healing: both
// tables are swept daily, a sliding window is 15 minutes wide, and a lockout
// cooldown is 30 minutes.

const KEY_HEX_LENGTH = 32 // 128 bits of a SHA-256 digest -- collision-proof at this scale

function saltFor(env: Env): string {
  const candidate = (env as { AUTH_SESSION_SECRET?: string; APP_ENCRYPTION_KEY?: string })
  return String(candidate.AUTH_SESSION_SECRET || candidate.APP_ENCRYPTION_KEY || '')
}

/**
 * Turns an identifier (IP, IP+user-agent, canonical phone) into the opaque
 * key an abuse counter stores. Returns '' for an empty identifier so callers
 * can keep treating "no key" as "nothing to count".
 */
export async function portalAbuseKey(env: Env, scope: string, value: unknown): Promise<string> {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const material = `${saltFor(env)}|${String(scope || '')}|${raw}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, KEY_HEX_LENGTH)
}
