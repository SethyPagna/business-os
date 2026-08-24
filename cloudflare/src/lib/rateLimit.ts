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
// Every call does one INSERT + one COUNT against a small table, so this
// isn't free -- fine for endpoints gated at a few requests/minute, not
// meant for hot internal paths.

export async function checkRateLimit(
  env: Env,
  bucket: string,
  clientKey: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const db = getDb(env)
  const windowStart = new Date(Date.now() - windowMs).toISOString()

  const countRow = await db.prepare(`
    SELECT COUNT(*) AS n FROM rate_limit_events
    WHERE bucket = @bucket AND client_key = @clientKey AND created_at > @since
  `).get<{ n: number }>({ bucket, clientKey, since: windowStart })

  if ((countRow?.n || 0) >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) }
  }

  await db.prepare(`
    INSERT INTO rate_limit_events (bucket, client_key) VALUES (@bucket, @clientKey)
  `).run({ bucket, clientKey })

  return { allowed: true, retryAfterSeconds: 0 }
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
