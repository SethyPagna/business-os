import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from './db'
import { PORTAL_CONSENT_VERSION, portalConsentVersionAccepted } from './portalAccounts'
import type { Env } from '../index'
import { customerIsProfileSql } from './anonymousCustomer'

// Customer (storefront) sessions. A deliberate, SEPARATE fork of lib/auth.ts's
// staff session model — different table (portal_sessions), different cookie
// name (bos_portal), no roles/permissions, no device linkage. It must never
// be interchangeable with the staff session: requireAuth reads only
// `bos_session` + user_sessions, requirePortalAccount reads only `bos_portal`
// + portal_sessions, so a token from one can never authenticate the other.
// Both cookies are host-only (no Domain=), so a cookie set on the public
// origin (leangbeauty.com) is never sent to admin.leangbeauty.com.

const PORTAL_COOKIE_NAME = 'bos_portal'
// RFC 6265bis cookie Expires ceiling (Hono throws past ~400 days) — same cap
// lib/auth.ts uses.
const MAX_COOKIE_AGE_MS = 399 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
// Session rows contain only the account id and a one-way token hash; IP
// addresses and user-agent strings are not persisted.
//
// G38 Phase 1 (design S6): a storefront session lives at most 90 days from
// sign-in (absolute) and ends after 30 days without a visit (idle). It used to
// be 399 days, sliding, with no idle limit, so a phone left signed in on a
// shared or lost device stayed in the account for over a year.
//   - expires_at is the idle deadline: sign-in + 30 days, pushed out by a
//     visit once less than half of it is left, never past created_at + 90.
//   - The read also checks both limits directly (created_at and last_seen_at),
//     so a row written under the old 399-day rule stops working on the same
//     terms as a new one without any data migration.
//   - The cookie expires with the row, and the retention sweep deletes rows
//     past either limit, so no abandoned session row outlives its cookie.
export const PORTAL_SESSION_IDLE_DAYS = 30
export const PORTAL_SESSION_ABSOLUTE_DAYS = 90
export const PORTAL_SESSION_IDLE_MS = PORTAL_SESSION_IDLE_DAYS * DAY_MS
export const PORTAL_SESSION_ABSOLUTE_MS = PORTAL_SESSION_ABSOLUTE_DAYS * DAY_MS
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
  // The LC-##### an account from before G38 was issued (frozen); NULL for
  // every member created since.
  membership_id: string | null
  member_code: string | null
  name: string
  phone: string | null
  email: string | null
  contact_id: number | null
  link_version: number
  // The linked customer's store number (owner answer 4: a linked member sees it).
  customer_membership_number: string | null
}

export type PortalAccountState =
  | { status: 'authenticated'; account: PortalAccount }
  | { status: 'reconsent_required'; account: null }
  | { status: 'unauthenticated'; account: null }

export async function createPortalSession(
  env: Env,
  accountId: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_IDLE_MS).toISOString()
  await getDb(env).prepare(`
    INSERT INTO portal_sessions (account_id, token_hash, expires_at)
    VALUES (@account_id, @token_hash, @expires_at)
  `).run({
    account_id: accountId,
    token_hash: tokenHash,
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

export async function getPortalAccountState<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<PortalAccountState> {
  const token = getCookie(c, PORTAL_COOKIE_NAME)
  if (!token) return { status: 'unauthenticated', account: null }
  const tokenHash = await hashToken(token)
  const nowIso = new Date().toISOString()
  const db = getDb(c.env)
  const row = await db.prepare(`
    SELECT a.id, a.membership_id, a.member_code, a.name, a.phone, a.email, a.contact_id,
           a.link_version, c.membership_number AS customer_membership_number,
           a.consent_version, a.consent_at
    FROM portal_sessions s
    JOIN portal_accounts a ON a.id = s.account_id
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE s.token_hash = @token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > @now
      AND julianday(s.created_at) > julianday(@now) - ${PORTAL_SESSION_ABSOLUTE_DAYS}
      AND julianday(COALESCE(s.last_seen_at, s.created_at)) > julianday(@now) - ${PORTAL_SESSION_IDLE_DAYS}
      AND a.status = 'active'
      AND (a.contact_id IS NULL OR (c.id IS NOT NULL AND ${customerIsProfileSql('c')}))
    LIMIT 1
  `).get<PortalAccount & { consent_version: string | null; consent_at: string | null }>({ token_hash: tokenHash, now: nowIso })
  if (!row) return { status: 'unauthenticated', account: null }
  if (!portalConsentVersionAccepted(row.consent_version) || !row.consent_at) {
    return { status: 'reconsent_required', account: null }
  }

  // One round trip: the session's idle clock, and the member's own last-seen
  // date (read by the 180-day retention rule) at most once a day.
  c.executionCtx.waitUntil(db.batch([
    { sql: 'UPDATE portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = @token_hash', params: { token_hash: tokenHash } },
    {
      sql: `UPDATE portal_accounts SET last_seen_at = CURRENT_TIMESTAMP
        WHERE id = @account_id AND (last_seen_at IS NULL OR julianday(last_seen_at) < julianday('now') - 1)`,
      params: { account_id: row.id },
    },
  ]))
  c.executionCtx.waitUntil(slidePortalSession(c, tokenHash))
  const { consent_version: _consentVersion, consent_at: _consentAt, ...account } = row
  return { status: 'authenticated', account }
}

export async function getPortalAccount<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<PortalAccount | null> {
  return (await getPortalAccountState(c)).account
}

// Keeps an actively-used account signed in up to the 90-day absolute limit:
// once less than half of the 30-day idle window is left, a visit moves the
// deadline to min(now + 30 days, created_at + 90 days) and re-issues the
// cookie. It never shortens the window.
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
    const now = Date.now()
    if (expiresAt - now > PORTAL_SESSION_IDLE_MS * (1 - SLIDE_AFTER_FRACTION)) return
    const nextExpiry = Math.min(now + PORTAL_SESSION_IDLE_MS, createdAt + PORTAL_SESSION_ABSOLUTE_MS)
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

// Kill every live session for an account — used after a password reset,
// a suspension and an unlink (design S6), so a stolen/forgotten password or a
// link staff just removed can't keep a session alive elsewhere.
export async function revokePortalSessionsForAccount(env: Env, accountId: number): Promise<void> {
  await getDb(env).prepare(
    'UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = @account_id AND revoked_at IS NULL',
  ).run({ account_id: accountId })
}

// The same revocation as one statement for a caller's own D1 batch, so it
// commits or rolls back with the change that caused it.
export function revokePortalSessionsStatement(accountIds: number[], prefix = 'rv'): { sql: string; params: Record<string, unknown> } | null {
  const ids = [...new Set(accountIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return null
  const params: Record<string, unknown> = {}
  const list = ids.map((id, index) => { params[`${prefix}${index}`] = id; return `@${prefix}${index}` }).join(', ')
  return {
    sql: `UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id IN (${list}) AND revoked_at IS NULL`,
    params,
  }
}

// Hono middleware for the storefront's own account routes. Reads ONLY
// bos_portal; a staff bos_session cookie can never satisfy it.
export async function requirePortalAccount(
  c: Context<{ Bindings: Env; Variables: { portalAccount: PortalAccount } }>,
  next: () => Promise<void>,
) {
  const state = await getPortalAccountState(c)
  if (state.status === 'reconsent_required') {
    return c.json({
      error: 'Please agree to the current Terms & Conditions and Privacy Policy to continue with your account.',
      code: 'portal_consent_required',
      consentVersion: PORTAL_CONSENT_VERSION,
    }, 428)
  }
  if (!state.account) return c.json({ error: 'Not signed in', code: 'portal_unauthenticated' }, 401)
  c.set('portalAccount', state.account)
  await next()
}
