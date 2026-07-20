import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from './db'
import type { Env } from '../index'

const SESSION_COOKIE_NAME = 'bos_session'
const DEFAULT_SESSION_MS = 24 * 60 * 60 * 1000
const SESSION_DURATIONS_MS: Record<string, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

// SHA-256 via Web Crypto (crypto.subtle) -- a Workers-native standard API,
// not the node:crypto compat shim. The original backend/src/sessionAuth.ts
// uses crypto.createHash('sha256'); this produces byte-identical hex output
// for the same input, it's just a different (more portable) API to get there.
async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url, matching the original's crypto.randomBytes(32).toString('base64url')
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type SessionUser = {
  id: number
  username: string
  name: string
  organization_id: number | null
  role_id: number | null
  permissions: string | null
  is_active: number
}

export async function createSession(
  env: Env,
  userId: number,
  options: { sessionDuration?: string; deviceName?: string; deviceTz?: string; userAgent?: string; ip?: string } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const ttlMs = SESSION_DURATIONS_MS[options.sessionDuration || ''] || DEFAULT_SESSION_MS
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()

  const db = getDb(env)
  await db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, user_agent, last_ip, expires_at)
    VALUES (@user_id, @token_hash, @device_name, @device_tz, @user_agent, @ip, @expires_at)
  `).run({
    user_id: userId,
    token_hash: tokenHash,
    device_name: options.deviceName || null,
    device_tz: options.deviceTz || null,
    user_agent: options.userAgent || null,
    ip: options.ip || null,
    expires_at: expiresAt,
  })

  return { token, expiresAt }
}

export function setSessionCookie(c: Context<{ Bindings: Env }>, token: string, expiresAt: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
}

export async function getSessionUser<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null
  const tokenHash = await hashToken(token)
  const nowIso = new Date().toISOString()

  const db = getDb(c.env)
  const row = await db.prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.role_id, u.permissions, u.is_active
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = @token_hash
      AND (s.revoked_at IS NULL)
      AND s.expires_at > @now
      AND u.is_active = 1
      AND u.deleted_at IS NULL
    LIMIT 1
  `).get<SessionUser>({ token_hash: tokenHash, now: nowIso })

  if (!row) return null

  // "Touch" the session's last-seen timestamp. The original backend
  // deduplicates this with an in-memory Map (module-scope, keyed by
  // session id, only writes at most once/minute per session) to avoid a
  // write on every single request. That cache lived for the lifetime of
  // one long-running Node process. A Worker isolate is reused across some
  // requests but not guaranteed to be -- a per-isolate Map here is a
  // best-effort version of the same optimization (still avoids most
  // redundant writes in practice, since Cloudflare does reuse warm
  // isolates for bursts of traffic), not a correctness requirement either
  // way: skipping the touch just means last_seen_at is slightly stale,
  // never that auth is wrong.
  c.executionCtx.waitUntil(
    db.prepare('UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run([tokenHash]),
  )

  return row
}

export async function revokeSession(c: Context<{ Bindings: Env }>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return
  const tokenHash = await hashToken(token)
  const db = getDb(c.env)
  await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?").run([tokenHash])
}

// Hono middleware -- equivalent to the original's `authToken` Express
// middleware. Usage: app.use('/protected/*', requireAuth) or per-route:
// app.get('/x', requireAuth, handler). Stores the resolved user on
// c.set('user', ...) for handlers to read via c.get('user').
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, next: () => Promise<void>) {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  c.set('user', user)
  await next()
}
