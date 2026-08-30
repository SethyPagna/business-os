import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from './db'
import type { Env } from '../index'

// Customer (storefront) sessions. A deliberate, SEPARATE fork of lib/auth.ts's
// staff session model — different table (portal_sessions), different cookie
// name (bos_portal), no roles/permissions, no device linkage. It must never
// be interchangeable with the staff session: requireAuth reads only
// `bos_session` + user_sessions, requirePortalAccount reads only `bos_portal`
// + portal_sessions, so a token from one can never authenticate the other.
// Both cookies are host-only (no Domain=), so a cookie set on the public
// origin (leangbeauty.com) is never sent to admin.leangbeauty.com.

const PORTAL_COOKIE_NAME = 'bos_portal'
// Storefront accounts exist to REMEMBER a customer (their cart + wishlist),
// so the session is long-lived by design ("permanent memory"). 10 years is
// indistinguishable from "always"; the cookie itself is capped below.
const PORTAL_SESSION_MS = 10 * 365 * 24 * 60 * 60 * 1000
// RFC 6265bis cookie Expires ceiling (Hono throws past ~400 days) — same cap
// lib/auth.ts uses.
const MAX_COOKIE_AGE_MS = 399 * 24 * 60 * 60 * 1000
const SLIDE_AFTER_FRACTION = 0.5

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type PortalAccount = {
  id: number
  membership_id: string
  name: string
  phone: string
  email: string | null
  contact_id: number | null
}

export async function createPortalSession(
  env: Env,
  accountId: number,
  options: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_MS).toISOString()
  await getDb(env).prepare(`
    INSERT INTO portal_sessions (account_id, token_hash, user_agent, last_ip, expires_at)
    VALUES (@account_id, @token_hash, @user_agent, @ip, @expires_at)
  `).run({
    account_id: accountId,
    token_hash: tokenHash,
    user_agent: options.userAgent || null,
    ip: options.ip || null,
    expires_at: expiresAt,
  })
  return { token, expiresAt }
}

export function setPortalCookie<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>, token: string, expiresAt: string): void {
  const requested = new Date(expiresAt)
  const cookieExpires = requested.getTime() - Date.now() > MAX_COOKIE_AGE_MS
    ? new Date(Date.now() + MAX_COOKIE_AGE_MS)
    : requested
  setCookie(c, PORTAL_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: cookieExpires,
  })
}

export function clearPortalCookie<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): void {
  deleteCookie(c, PORTAL_COOKIE_NAME, { path: '/' })
}

export async function getPortalAccount<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<PortalAccount | null> {
  const token = getCookie(c, PORTAL_COOKIE_NAME)
  if (!token) return null
  const tokenHash = await hashToken(token)
  const nowIso = new Date().toISOString()
  const db = getDb(c.env)
  const row = await db.prepare(`
    SELECT a.id, a.membership_id, a.name, a.phone, a.email, a.contact_id
    FROM portal_sessions s
    JOIN portal_accounts a ON a.id = s.account_id
    WHERE s.token_hash = @token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > @now
    LIMIT 1
  `).get<PortalAccount>({ token_hash: tokenHash, now: nowIso })
  if (!row) return null

  c.executionCtx.waitUntil(
    db.prepare('UPDATE portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run([tokenHash]),
  )
  c.executionCtx.waitUntil(slidePortalSession(c, tokenHash))
  return row
}

// Same inactivity-sliding contract as lib/auth.ts::slideSessionExpiry — keeps
// an actively-used account signed in without ever shortening its window.
async function slidePortalSession<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>, tokenHash: string): Promise<void> {
  try {
    const db = getDb(c.env)
    const session = await db.prepare(
      'SELECT created_at, expires_at FROM portal_sessions WHERE token_hash = ? LIMIT 1',
    ).get<{ created_at: string; expires_at: string }>([tokenHash])
    if (!session?.created_at || !session?.expires_at) return
    const asUtc = (value: string): number => {
      const text = String(value).trim()
      const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`
      return Date.parse(normalized)
    }
    const createdAt = asUtc(session.created_at)
    const expiresAt = asUtc(session.expires_at)
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return
    const ttlMs = expiresAt - createdAt
    if (ttlMs <= 0) return
    const now = Date.now()
    if (expiresAt - now > ttlMs * (1 - SLIDE_AFTER_FRACTION)) return
    const nextExpiry = Math.min(now + ttlMs, now + MAX_COOKIE_AGE_MS)
    if (nextExpiry <= expiresAt) return
    const nextExpiryIso = new Date(nextExpiry).toISOString()
    await db.prepare(
      'UPDATE portal_sessions SET expires_at = @expires_at WHERE token_hash = @token_hash AND revoked_at IS NULL',
    ).run({ expires_at: nextExpiryIso, token_hash: tokenHash })
    const token = getCookie(c, PORTAL_COOKIE_NAME)
    if (token) setPortalCookie(c, token, nextExpiryIso)
  } catch (_) {
    // Best effort — a missed slide just leaves the current expiry in place.
  }
}

export async function revokePortalSession<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<void> {
  const token = getCookie(c, PORTAL_COOKIE_NAME)
  if (!token) return
  const tokenHash = await hashToken(token)
  await getDb(c.env).prepare('UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?').run([tokenHash])
}

// Kill every live session for an account — used after a password reset so a
// stolen/forgotten password can't keep a session alive elsewhere.
export async function revokePortalSessionsForAccount(env: Env, accountId: number): Promise<void> {
  await getDb(env).prepare(
    'UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = @account_id AND revoked_at IS NULL',
  ).run({ account_id: accountId })
}

// Hono middleware for the storefront's own account routes. Reads ONLY
// bos_portal; a staff bos_session cookie can never satisfy it.
export async function requirePortalAccount(
  c: Context<{ Bindings: Env; Variables: { portalAccount: PortalAccount } }>,
  next: () => Promise<void>,
) {
  const account = await getPortalAccount(c)
  if (!account) return c.json({ error: 'Not signed in', code: 'portal_unauthenticated' }, 401)
  c.set('portalAccount', account)
  await next()
}
