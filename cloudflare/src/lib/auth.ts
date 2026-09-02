import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from './db'
import type { Env } from '../index'

const SESSION_COOKIE_NAME = 'bos_session'
// "Always stay signed in" -- the new default (see createSession below).
// Not literally infinite (nothing in this schema should store a row with
// no expiry at all), but 10 years is indistinguishable from "always" for a
// business app and gives a real upper bound.
const ALWAYS_SESSION_MS = 10 * 365 * 24 * 60 * 60 * 1000
// Fallback when no recognized sessionDuration is supplied at all (e.g. an
// older cached frontend build that predates the 'always' option). Used to
// be a hardcoded 1 day, which meant anyone who hadn't explicitly picked a
// duration got silently logged out every 24h -- now matches the new
// default so "haven't touched the setting" behaves the same as "picked
// Always stay signed in" instead of the shortest possible option.
const DEFAULT_SESSION_MS = ALWAYS_SESSION_MS
const SESSION_DURATIONS_MS: Record<string, number> = {
  always: ALWAYS_SESSION_MS,
  // Deliberately short -- "Until I close the browser" is the shared-device
  // security option, must stay the shortest choice, not get folded into
  // the new long default.
  session: 24 * 60 * 60 * 1000,
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
  // Joined from roles (see getSessionUser below) so permission checks can
  // merge role-level defaults with user-level overrides, matching backend/
  // src/middleware.ts's getMergedPermissions(). Previously this Worker only
  // ever checked user.permissions and silently ignored role.permissions
  // entirely -- a role like "manager" granting `sales: true` had no effect
  // unless that same key also happened to be copied onto the user row.
  role_code?: string | null
  role_permissions?: string | null
  // Human-readable role label for display surfaces (Sidebar, UserProfileModal,
  // etc.) -- distinct from role_code, which is the machine-readable key used
  // for permission checks (isAdminControlUser, etc.). Previously missing from
  // this query entirely, so every one of those display surfaces always fell
  // back to "No role" even for a user with a real role_id, since role_code
  // isn't what they read. routes/users.ts's admin list query already selects
  // `r.name AS role_name` correctly -- this just brings the session user's
  // own query in line with that.
  role_name?: string | null
}

type SessionLookupRow = SessionUser & {
  session_created_at: string | null
  session_expires_at: string | null
  session_last_seen_at: string | null
}

type SessionExpiryMetadata = {
  created_at: string | null
  expires_at: string | null
}

// Persisting last_seen_at on every authenticated request turns a read-heavy
// hot path into a D1 write hot path. Five minutes is fresh enough for the
// session/admin surfaces while bounding routine touch writes to 12/hour per
// actively used session. The UPDATE below repeats this cutoff so concurrent
// requests cannot all write after making the same stale-read decision.
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000

function asUtc(value: string): number {
  const text = String(value).trim()
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text)
    ? text.replace(' ', 'T')
    : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

function isSessionTouchDue(lastSeenAt: string | null, nowMs: number): boolean {
  if (!lastSeenAt) return true
  const lastSeenMs = asUtc(lastSeenAt)
  return !Number.isFinite(lastSeenMs) || lastSeenMs < nowMs - SESSION_TOUCH_INTERVAL_MS
}

export async function createSession(
  env: Env,
  userId: number,
  // `deviceId` is the same client-persisted id the device-approval feature
  // uses (see lib/deviceTrust.ts). Threading it onto the session row is
  // what lets routes/devices.ts's revoke/reject actually kill a *live*
  // session for that device, not just block its *next* login -- see
  // revokeSessionsForDevice below and migrations/0006_session_device_link.sql.
  // Optional and best-effort: a caller that doesn't have a deviceId (e.g.
  // a very old cached frontend build) still gets a working session, just
  // one that a future device revoke can't immediately terminate.
  options: { sessionDuration?: string; deviceName?: string; deviceTz?: string; userAgent?: string; ip?: string; deviceId?: string | null } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const ttlMs = SESSION_DURATIONS_MS[options.sessionDuration || ''] || DEFAULT_SESSION_MS
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()

  const db = getDb(env)
  await db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, user_agent, last_ip, device_id, expires_at)
    VALUES (@user_id, @token_hash, @device_name, @device_tz, @user_agent, @ip, @device_id, @expires_at)
  `).run({
    user_id: userId,
    token_hash: tokenHash,
    device_name: options.deviceName || null,
    device_tz: options.deviceTz || null,
    user_agent: options.userAgent || null,
    ip: options.ip || null,
    device_id: options.deviceId || null,
    expires_at: expiresAt,
  })

  return { token, expiresAt }
}

// Called from routes/devices.ts when an admin rejects a pending device or
// revokes a previously-approved one. Previously trust decisions here only
// affected the device's *next* login attempt -- a session already issued
// from that device (e.g. before the admin noticed it was stolen/lost, or
// during the window before rejection) stayed valid until it expired on
// its own. This immediately invalidates every live session tied to that
// user+device pair, the same way a password reset invalidates every
// session for a user (see revokeUserSessions above), just scoped to one
// device instead of the whole account.
export async function revokeSessionsForDevice(env: Env, userId: number, deviceId: string | null | undefined): Promise<number> {
  if (!deviceId || !deviceId.trim()) return 0
  const db = getDb(env)
  const result = await db.prepare(
    'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = @user_id AND device_id = @device_id AND revoked_at IS NULL',
  ).run({ user_id: userId, device_id: deviceId })
  return result?.changes || 0
}

// Cookies MUST NOT have an Expires more than 400 days out (RFC 6265bis;
// Hono's setCookie() throws rather than silently truncating -- see
// node_modules/hono/dist/utils/cookie.js). Session rows themselves can
// legitimately live up to ALWAYS_SESSION_MS (10 years, see above) so
// "Always stay signed in" doesn't force a re-login every year -- but the
// *cookie* has to stay under the cap regardless of how long the
// server-side session is valid for. 399 days (not the full 400) leaves a
// day of margin against clock skew between this Worker and the browser.
const MAX_COOKIE_AGE_MS = 399 * 24 * 60 * 60 * 1000

export function setSessionCookie<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>, token: string, expiresAt: string): void {
  const requested = new Date(expiresAt)
  const cookieExpires = requested.getTime() - Date.now() > MAX_COOKIE_AGE_MS
    ? new Date(Date.now() + MAX_COOKIE_AGE_MS)
    : requested
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: cookieExpires,
  })
}

export function clearSessionCookie<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
}

export async function getSessionUser<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null
  const tokenHash = await hashToken(token)
  const nowIso = new Date().toISOString()

  const db = getDb(c.env)
  const row = await db.prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.role_id, u.permissions, u.is_active,
           r.code AS role_code, r.permissions AS role_permissions, r.name AS role_name,
           s.created_at AS session_created_at, s.expires_at AS session_expires_at,
           s.last_seen_at AS session_last_seen_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE s.token_hash = @token_hash
      AND (s.revoked_at IS NULL)
      AND s.expires_at > @now
      AND u.is_active = 1
      AND u.deleted_at IS NULL
    LIMIT 1
  `).get<SessionLookupRow>({ token_hash: tokenHash, now: nowIso })

  if (!row) return null

  const {
    session_created_at: createdAt,
    session_expires_at: expiresAt,
    session_last_seen_at: lastSeenAt,
    ...user
  } = row

  if (isSessionTouchDue(lastSeenAt, Date.parse(nowIso))) {
    c.executionCtx.waitUntil(
      db.prepare(`
        UPDATE user_sessions
        SET last_seen_at = CURRENT_TIMESTAMP
        WHERE token_hash = @token_hash
          AND revoked_at IS NULL
          AND expires_at > @observed_at
          AND (
            last_seen_at IS NULL
            OR datetime(last_seen_at) < datetime(@observed_at, '-5 minutes')
          )
      `).run({ token_hash: tokenHash, observed_at: nowIso }),
    )
  }

  c.executionCtx.waitUntil(slideSessionExpiry(c, tokenHash, {
    created_at: createdAt,
    expires_at: expiresAt,
  }))

  return user
}

// How much of a session's life has to be gone before it is renewed. Half is
// a deliberate middle: renewing on every request would mean an UPDATE plus a
// Set-Cookie on every single call, and renewing only near the very end
// leaves almost no margin for a client that is briefly offline.
const SESSION_SLIDE_AFTER_FRACTION = 0.5

/**
 * Extend a live session that is past halfway through its life.
 *
 * Sessions were issued with a FIXED expiry and never renewed, so a session
 * died at a wall-clock moment decided at login regardless of whether the
 * person was in the middle of using the app. That is the reported
 * "'Not authenticated' shows up randomly after leaving it idle, and
 * sometimes I have to log in again": nothing had gone wrong, the window had
 * simply ended.
 *
 * The chosen duration now means "stay signed in for N days OF INACTIVITY"
 * rather than "N days from login", which is what people already assume it
 * means and what the wording ("Keep me signed in for 30 days") implies.
 *
 * The original TTL is recovered from `expires_at - created_at` rather than
 * stored, so this needs no migration and no change to createSession.
 *
 * Runs inside waitUntil, so it never adds latency to the request that
 * triggered it, and failure is harmless -- the session simply keeps its
 * current expiry and gets another chance on the next request.
 */
async function slideSessionExpiry<E extends { Bindings: Env } = { Bindings: Env }>(
  c: Context<E>,
  tokenHash: string,
  session: SessionExpiryMetadata,
): Promise<void> {
  try {
    const db = getDb(c.env)
    if (!session?.created_at || !session?.expires_at) return

    // SQLite's CURRENT_TIMESTAMP writes "YYYY-MM-DD HH:MM:SS" (UTC, no
    // zone marker). Date.parse treats that as LOCAL time in some runtimes,
    // which would skew every comparison here, so the marker is added when
    // it is missing rather than trusting the default parse.
    const createdAt = asUtc(session.created_at)
    const expiresAt = asUtc(session.expires_at)
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return

    const ttlMs = expiresAt - createdAt
    if (ttlMs <= 0) return

    const now = Date.now()
    const remaining = expiresAt - now
    if (remaining > ttlMs * (1 - SESSION_SLIDE_AFTER_FRACTION)) return

    // Never shorten, and never push past the cookie's own ceiling.
    const nextExpiry = Math.min(now + ttlMs, now + MAX_COOKIE_AGE_MS)
    if (nextExpiry <= expiresAt) return
    const nextExpiryIso = new Date(nextExpiry).toISOString()

    await db.prepare(
      'UPDATE user_sessions SET expires_at = @expires_at WHERE token_hash = @token_hash AND revoked_at IS NULL',
    ).run({ expires_at: nextExpiryIso, token_hash: tokenHash })

    // The cookie carries its own expiry, so it has to move too -- otherwise
    // the browser drops it while the server-side row is still valid.
    const token = getCookie(c, SESSION_COOKIE_NAME)
    if (token) setSessionCookie(c, token, nextExpiryIso)
  } catch (_) {
    // Best effort by design: see this function's own comment.
  }
}

export async function revokeSession<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return
  const tokenHash = await hashToken(token)
  const db = getDb(c.env)
  await db.prepare("UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?").run([tokenHash])
}

// Ported from backend/src/sessionAuth.ts's revokeUserSessions(). Called
// after a password change/reset so every *other* device signed in as this
// user is forced to log in again with the new password -- not just the
// device that made the change. Unlike revokeSession above (single current
// cookie), this revokes every live session row for the given user id.
export async function revokeUserSessions(env: Env, userId: number | string): Promise<void> {
  const db = getDb(env)
  await db.prepare(
    'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = @user_id AND revoked_at IS NULL',
  ).run({ user_id: userId })
}

// Hono middleware -- equivalent to the original's `authToken` Express
// middleware. Usage: app.use('/protected/*', requireAuth) or per-route:
// app.get('/x', requireAuth, handler). Stores the resolved user on
// c.set('user', ...) for handlers to read via c.get('user').
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, next: () => Promise<void>) {
  const user = await getSessionUser(c)
  // `code: 'invalid_session'` matters, not just the message text: the
  // frontend's isInvalidSessionError() (api/http.ts) checks this field
  // first, and only falls back to a regex match against `message` that
  // looks for the phrases "sign in again"/"invalid session"/"cloudflare
  // access" -- none of which appear in the plain "Not authenticated" text
  // this middleware used to send alone. Real, confirmed gap: routes/
  // auth.ts's own /bootstrap handler already sets this code on its 401,
  // but this shared middleware (gating the large majority of other
  // authenticated routes -- organizations, notifications, products,
  // inventory, import-jobs, etc, confirmed by grep across routes/*.ts)
  // did not, so a 401 from any of THOSE routes was invisible to
  // isInvalidSessionError() and anything downstream that relies on it
  // (e.g. isConnectivityError's early "this isn't a connectivity problem,
  // don't retry it like one" check) -- it fell through as an
  // unrecognized generic error instead of the recoverable "your session
  // needs to be re-established" case, which is consistent with the raw
  // "Not authenticated" text still surfacing on-screen even once the
  // shared auth-recovery flow (AppContext.tsx's authRecoveryRef check)
  // had already re-confirmed the session was fine.
  if (!user) return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
  c.set('user', user)
  await next()
}
