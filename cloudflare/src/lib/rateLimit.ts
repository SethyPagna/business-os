import { getDb } from './db'
import type { Env } from '../index'

// Generic D1-backed rate limiter for public, unauthenticated endpoints.
// Ported concept (not code) of the Docker backend's `checkRateLimit`
// (backend/src/security.ts), which used an in-memory Map -- doesn't carry
// over to Workers since isolates don't share memory across edge locations.
// Same pattern already used in lib/verification.ts for password-reset
// rate limiting, generalized here so other public routes (portal
// membership lookup, portal submissions) don't need their own copy.
//
// Every call does one conditional INSERT against a small table, so this
// isn't free -- fine for endpoints gated at a few requests/minute, not
// meant for hot internal paths.

// Match SQLite's UTC text ordering without applying a function to indexed
// created_at columns. Keep milliseconds for short windows; legacy rows with
// CURRENT_TIMESTAMP (whole seconds) sort correctly against these cutoffs.
export function sqliteUtcTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
    throw new RangeError('Timestamp is outside the supported SQLite UTC range')
  }
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

export async function checkRateLimit(
  env: Env,
  bucket: string,
  clientKey: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number; slot?: string }> {
  if (!Number.isSafeInteger(max) || max <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new RangeError('Rate limit and windowMs must be positive safe integers')
  }
  const now = Date.now()
  const windowStart = sqliteUtcTimestamp(now - windowMs)
  const createdAt = sqliteUtcTimestamp(now)
  const db = getDb(env)

  // Counting and admission must share a SQLite write statement. Separate
  // COUNT/INSERT awaits let concurrent Workers all spend the same last slot.
  const result = await db.prepare(`
    INSERT INTO rate_limit_events (bucket, client_key, created_at)
    SELECT @bucket, @clientKey, @createdAt
    WHERE (SELECT COUNT(*) FROM (
      SELECT 1 FROM rate_limit_events
      WHERE bucket = @bucket AND client_key = @clientKey AND created_at > @since
      LIMIT @max
    )) < @max
  `).run({ bucket, clientKey, createdAt, since: windowStart, max })

  if (result.changes === 1) return { allowed: true, retryAfterSeconds: 0, slot: createdAt }
  return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) }
}

// Gives back one slot checkRateLimit admitted (its `slot`). For a ceiling
// that must admit atomically -- so a burst of parallel attempts cannot all
// pass before the first failure is written -- yet should end up counting only
// failures: reserve with checkRateLimit, release once the attempt succeeded.
// Two slots admitted in the same millisecond are interchangeable.
export async function releaseRateLimitSlot(env: Env, bucket: string, clientKey: string, slot: string | undefined): Promise<void> {
  if (!slot) return
  await getDb(env).prepare(`
    DELETE FROM rate_limit_events WHERE id = (
      SELECT id FROM rate_limit_events
      WHERE bucket = @bucket AND client_key = @clientKey AND created_at = @slot
      LIMIT 1
    )
  `).run({ bucket, clientKey, slot })
}

// Failure-only limiting. checkRateLimit spends a slot on every call, which
// is right for a request ceiling but wrong for "N wrong guesses per account":
// shared till logins sign in many times an hour, and every success would
// spend the same allowance as a guess. peekRateLimit only reads the window;
// recordRateLimitEvent spends a slot, called by the route on a failure.
// Peek + record is NOT atomic: parallel failures can all pass a peek before
// any is recorded. Its one caller is POST /login's per-account ceiling,
// where the escalating lockout (lib/loginLockout) is the backstop -- that
// lockout applies to sign-in ONLY. Anything else that needs a hard,
// failure-only ceiling reserves with checkRateLimit and gives the slot back
// on success with releaseRateLimitSlot (see lib/currentPasswordGuard.ts).
export async function peekRateLimit(
  env: Env,
  bucket: string,
  clientKey: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!Number.isSafeInteger(max) || max <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new RangeError('Rate limit and windowMs must be positive safe integers')
  }
  const row = await getDb(env).prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM rate_limit_events
      WHERE bucket = @bucket AND client_key = @clientKey AND created_at > @since
      LIMIT @max
    )
  `).get<{ n: number }>({ bucket, clientKey, since: sqliteUtcTimestamp(Date.now() - windowMs), max })
  const allowed = Number(row?.n || 0) < max
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil(windowMs / 1000) }
}

export async function recordRateLimitEvent(env: Env, bucket: string, clientKey: string): Promise<void> {
  await getDb(env).prepare(`
    INSERT INTO rate_limit_events (bucket, client_key, created_at) VALUES (@bucket, @clientKey, @createdAt)
  `).run({ bucket, clientKey, createdAt: sqliteUtcTimestamp(Date.now()) })
}

// CF-Connecting-IP only: Cloudflare's edge sets it on every request, and a
// client cannot. X-Forwarded-For is whatever the caller typed, so falling
// back to it let one script choose a fresh rate-limit key per request
// (G38 P0, WEB-threat P1-11). Without the edge header every caller shares
// 'unknown-ip', which fails toward MORE limiting, never less.
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown-ip'
}

// The key a public abuse limiter should count by. One IPv6 subscriber holds
// a whole /64 and can rotate through it freely, so a per-address IPv6 key is
// no limit at all; the /64 prefix is the "one network" unit. IPv4 (and an
// IPv4-mapped IPv6 address) stays the exact address.
export function clientNetworkKey(ip: string): string {
  const value = String(ip || '').trim().toLowerCase()
  if (!value.includes(':')) return value || 'unknown-ip'
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  if (mapped) return mapped[1]
  const hextets = expandIpv6(value.split('%')[0])
  if (!hextets) return value
  return `${hextets.slice(0, 4).map((part) => part.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

export function getClientNetworkKey(request: Request): string {
  return clientNetworkKey(getClientIp(request))
}

function expandIpv6(value: string): string[] | null {
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  return parts.every((part) => /^[0-9a-f]{1,4}$/.test(part)) ? parts : null
}
