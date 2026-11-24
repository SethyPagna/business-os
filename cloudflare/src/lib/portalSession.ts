import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from './db'
import { PORTAL_CONSENT_VERSION, portalConsentCurrent } from './portalAccounts'
import type { Env } from '../index'
import { customerIsProfileSql } from './anonymousCustomer'
import { getPlanLimits } from './planTier'
import { portalNowIso, secondsAgoModifier } from './portalTelegramToken'

// Customer (storefront) sessions. A deliberate, SEPARATE fork of lib/auth.ts's
// staff session model — different table (portal_sessions), different cookie
// name (bos_portal), no roles/permissions, no device linkage. It must never
// be interchangeable with the staff session: requireAuth reads only
// `bos_session` + user_sessions, requirePortalAccount reads only `bos_portal`
// + portal_sessions, so a token from one can never authenticate the other.
// Both cookies are host-only (no Domain=), so a cookie set on the public
// origin (leangbeauty.com) is never sent to admin.leangbeauty.com.

export const PORTAL_COOKIE_NAME = 'bos_portal'
// RFC 6265bis cookie Expires ceiling (Hono throws past ~400 days) — same cap
// lib/auth.ts uses.
const MAX_COOKIE_AGE_MS = 399 * 24 * 60 * 60 * 1000
// Storefront accounts remember a customer's saved list. Session rows contain
// only the account id and a one-way token hash; IP addresses and user-agent
// strings are not persisted in this long-lived table.
// the row expires exactly when the cookie the browser holds does, and every
// visit past the halfway mark pushes both out again.
//
// It used to be ten years, which broke this twice over (N45). The row sat in
// portal_sessions with the visitor's last_ip and user-agent for a decade,
// unreachable by the retention sweep, which deletes a row once its expires_at
// is in the past -- so "expired sessions are deleted automatically" in the
// privacy policy was not true of the ones that mattered. And because
// slidePortalSession() computes the next expiry as min(now + ttl, now +
// MAX_COOKIE_AGE_MS), a ten-year ttl made every candidate expiry EARLIER
// than the stored one, so the slide returned without doing anything and the
// cookie was never re-issued: a customer who visited daily was still signed
// out at 399 days. Matching the two ceilings fixes the retention hole and
// turns the sliding back on.
export const PORTAL_SESSION_MS = MAX_COOKIE_AGE_MS
const SLIDE_AFTER_FRACTION = 0.5

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export type PortalAccount = {
  id: number
  // The LC-##### an account from before members were separate was issued; NULL for every member created since.
  membership_id: string | null
  member_code: string | null
  name: string
  phone: string | null
  email: string | null
  contact_id: number | null
}

export type PortalAccountState =
  | { status: 'authenticated'; account: PortalAccount }
  // accountId lets the renew endpoint (and nothing else) act for the session.
  | { status: 'reconsent_required'; account: null; accountId: number; membershipId: string }
  | { status: 'unauthenticated'; account: null }

// The id staff and the audit log see for an account: its LC number if it has one, else its W- code, else the row id.
export function portalActorLabel(row: { id: number; membership_id?: string | null; member_code?: string | null }): string {
  return String(row.membership_id ?? '').trim() || String(row.member_code ?? '').trim() || `account-${row.id}`
}

export async function createPortalSession(
  env: Env,
  accountId: number,
): Promise<{ token: string; expiresAt: string }> {
  return insertPortalSession(env, accountId, null)
}

// presentedTokenHash: the session the browser presented, if any, revoked in the same batch as the new one (R2-2).
async function insertPortalSession(
  env: Env,
  accountId: number,
  presentedTokenHash: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const nowMs = Date.now()
  const nowIso = portalNowIso(nowMs)
  const expiresAt = portalNowIso(nowMs + PORTAL_SESSION_MS)
  // S-S6. Every time is written in the one ISO form (design 1.3), never the column default.
  const insert = {
    sql: `
    INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (@account_id, @token_hash, @expires_at, @now, @now)
  `,
    params: { account_id: accountId, token_hash: tokenHash, expires_at: expiresAt, now: nowIso },
  }
  if (presentedTokenHash && presentedTokenHash !== tokenHash) {
    // S-S4 for the presented session, atomic with the insert: a late response carrying the old cookie can never restore
    // an earlier shopper, because that session is no longer live.
    await getDb(env).batch([
      insert,
      {
        sql: `
    UPDATE portal_sessions SET revoked_at = @now
    WHERE token_hash = @presented_hash
      AND substr(token_hash, 1, 4) <> 'tg1:'
      AND revoked_at IS NULL
  `,
        params: { now: nowIso, presented_hash: presentedTokenHash },
      },
    ])
  } else {
    await getDb(env).prepare(insert.sql).run(insert.params)
  }
  return { token, expiresAt }
}

// Every portal sign-in path (password sign-in, sign-up and the Telegram claim) mints its session here: the session the
// browser presented, if any, is revoked in the same batch (R2-2).
export async function createPortalSessionReplacingPresented<E extends { Bindings: Env } = { Bindings: Env }>(
  c: Context<E>,
  accountId: number,
): Promise<{ token: string; expiresAt: string }> {
  const presented = getCookie(c, PORTAL_COOKIE_NAME)
  return insertPortalSession(c.env, accountId, presented ? await hashToken(presented) : null)
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

// Today's time parser: a stored time is either the column default (`YYYY-MM-DD HH:MM:SS`, UTC) or ISO.
function asUtc(value: string): number {
  const text = String(value).trim()
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

export async function getPortalAccountState<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<PortalAccountState> {
  const token = getCookie(c, PORTAL_COOKIE_NAME)
  if (!token) return { status: 'unauthenticated', account: null }
  const tokenHash = await hashToken(token)
  const nowMs = Date.now()
  const nowIso = portalNowIso(nowMs)
  const db = getDb(c.env)
  // S-S1: the one statement of an authenticated request. It refuses a Telegram ticket (the `tg1:` prefix) on its
  // own, a second refusal beside the structural one (a ticket is never the hash of any cookie). It also returns the
  // session's own times, so the stamp and the slide below need no read of their own.
  const row = await db.prepare(`
    SELECT a.id, a.membership_id, a.member_code, a.name, a.phone, a.email, a.contact_id,
           a.consent_version, a.consent_at, a.age_confirmed_at,
           s.created_at AS session_created_at, s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at
    FROM portal_sessions s
    JOIN portal_accounts a ON a.id = s.account_id
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE s.token_hash = @token_hash
      AND substr(s.token_hash, 1, 4) <> 'tg1:'
      AND s.revoked_at IS NULL
      AND datetime(s.expires_at) > datetime(@now)
      AND a.status = 'active'
      AND (a.contact_id IS NULL OR (c.id IS NOT NULL AND ${customerIsProfileSql('c')}))
    LIMIT 1
  `).get<PortalAccount & {
    consent_version: string | null; consent_at: string | null; age_confirmed_at: string | null
    session_created_at: string | null; session_expires_at: string | null; session_last_seen_at: string | null
  }>({ token_hash: tokenHash, now: nowIso })
  if (!row) return { status: 'unauthenticated', account: null }
  if (!portalConsentCurrent(row)) {
    return { status: 'reconsent_required', account: null, accountId: row.id, membershipId: portalActorLabel(row) }
  }
  const { session_created_at: _created, session_expires_at: sessionExpiresAt, session_last_seen_at: sessionLastSeenAt, ...account } = row
  void _created

  // The hourly stamp (S-S2). Due when the session was never stamped or the stamp is at least one interval old; a
  // malformed stored time is never due. The statement repeats the interval in datetime() form, so two concurrent
  // requests write at most once.
  const touchSeconds = getPlanLimits(c.env).portalSessionTouchIntervalSeconds
  const stampDue = sessionLastSeenAt == null || asUtc(sessionLastSeenAt) <= nowMs - touchSeconds * 1000
  if (stampDue) {
    c.executionCtx.waitUntil(
      db.prepare(`
        UPDATE portal_sessions SET last_seen_at = @now
        WHERE token_hash = @token_hash
          AND substr(token_hash, 1, 4) <> 'tg1:'
          AND revoked_at IS NULL
          AND datetime(expires_at) > datetime(@now)
          AND (last_seen_at IS NULL OR datetime(last_seen_at) < datetime(@now, @touch_window))
      `).run({ token_hash: tokenHash, now: nowIso, touch_window: secondsAgoModifier(touchSeconds) }),
    )
  }
  const expiresAt = sessionExpiresAt == null ? NaN : asUtc(sessionExpiresAt)
  if (Number.isFinite(expiresAt)) {
    // The lifetime is the constant, never expires_at - created_at (that grows with every slide, review 6).
    const ttlMs = PORTAL_SESSION_MS
    if (expiresAt - nowMs <= ttlMs * (1 - SLIDE_AFTER_FRACTION)) {
      // never past the cookie ceiling, whatever the lifetime constant is
      const nextExpiryIso = portalNowIso(nowMs + Math.min(ttlMs, MAX_COOKIE_AGE_MS))
      // The cookie is set here, before the response is returned: a header set after the response is finalized lands on
      // a Response nobody returns (a daily shopper would be signed out at the first cookie expiry). Only the D1 write
      // stays in waitUntil.
      setPortalCookie(c, token, nextExpiryIso)
      c.executionCtx.waitUntil(slidePortalSession(c, tokenHash, nextExpiryIso))
    }
  }
  return { status: 'authenticated', account }
}

export async function getPortalAccount<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<PortalAccount | null> {
  return (await getPortalAccountState(c)).account
}

// Same inactivity-sliding contract as lib/auth.ts::slideSessionExpiry -- keeps an actively-used account signed in
// without ever shortening its window. Only called when the slide is due (S-S1 returned the times); S-S3 writes only a
// later expiry, so concurrent requests write once.
async function slidePortalSession<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>, tokenHash: string, nextExpiryIso: string): Promise<void> {
  try {
    await getDb(c.env).prepare(`
      UPDATE portal_sessions SET expires_at = @next_expires_at
      WHERE token_hash = @token_hash
        AND substr(token_hash, 1, 4) <> 'tg1:'
        AND revoked_at IS NULL
        AND datetime(expires_at) < datetime(@next_expires_at)
    `).run({ next_expires_at: nextExpiryIso, token_hash: tokenHash })
  } catch (_) {
    // Best effort -- a missed slide just leaves the current expiry in place.
  }
}

export async function revokePortalSession<E extends { Bindings: Env } = { Bindings: Env }>(c: Context<E>): Promise<void> {
  const token = getCookie(c, PORTAL_COOKIE_NAME)
  if (!token) return
  const tokenHash = await hashToken(token)
  // S-S4
  await getDb(c.env).prepare(`
    UPDATE portal_sessions SET revoked_at = @now
    WHERE token_hash = @token_hash
      AND substr(token_hash, 1, 4) <> 'tg1:'
      AND revoked_at IS NULL
  `).run({ now: portalNowIso(), token_hash: tokenHash })
}

// Kill every live session for an account -- used after a password reset so a stolen/forgotten password can't keep a
// session alive elsewhere. By account, so it revokes an unclaimed Telegram ticket too, which is wanted (S-S5).
export async function revokePortalSessionsForAccount(env: Env, accountId: number): Promise<void> {
  await getDb(env).prepare(
    'UPDATE portal_sessions SET revoked_at = @now WHERE account_id = @account_id AND revoked_at IS NULL',
  ).run({ now: portalNowIso(), account_id: accountId })
}

// S-D1: the devices a member is signed in on. Live, not revoked, not a ticket, and either touched more than 60 s
// after creation or created within the last day (so an orphan from a lost claim response stops counting after a day).
// One call, no write.
export async function countPortalDevices(env: Env, accountId: number, nowIso: string): Promise<number> {
  const row = await getDb(env).prepare(`
    SELECT COUNT(*) AS n FROM portal_sessions
    WHERE account_id = @account_id
      AND revoked_at IS NULL
      AND substr(token_hash, 1, 4) <> 'tg1:'
      AND datetime(expires_at) > datetime(@now)
      AND (datetime(last_seen_at) > datetime(created_at, '+60 seconds')
           OR datetime(created_at) > datetime(@now, @device_window))
  `).get<{ n: number }>({
    account_id: accountId,
    now: nowIso,
    // A fixed day: a display rule, not a plan budget, so it is not a limit field (design 7, S-D1).
    device_window: secondsAgoModifier(86_400),
  })
  return Number(row?.n ?? 0)
}

// S-D2: sign out other devices. Every other session of the member and every unclaimed ticket is revoked (the ticket
// has no cookie, so it is matched by "not the current hash"). Exported by name: it is one of the statements allowed to
// name token_hash without the ticket predicate (design 6.1, test T-F2). Returns the rows revoked.
export const S_D2 = `
  UPDATE portal_sessions SET revoked_at = @now
  WHERE account_id = @account_id AND revoked_at IS NULL AND token_hash <> @token_hash
`
export async function revokeOtherPortalSessions(env: Env, accountId: number, currentTokenHash: string, nowIso: string): Promise<number> {
  const result = await getDb(env).prepare(S_D2).run({ now: nowIso, account_id: accountId, token_hash: currentTokenHash })
  return result.changes || 0
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
