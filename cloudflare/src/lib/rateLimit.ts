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
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
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

  const allowed = result.changes === 1
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil(windowMs / 1000) }
}

// Best-effort IP extraction -- Cloudflare sets CF-Connecting-IP on every
// request at the edge, more reliable than X-Forwarded-For (which a client
// could try to spoof before CF overwrites it, but CF-Connecting-IP is the
// edge's own determination).
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown-ip'
}
