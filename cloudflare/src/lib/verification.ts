import { getDb } from './db'
import { sqliteUtcTimestamp } from './rateLimit'
import type { Env } from '../index'

// Real password-reset send/verify -- auth priority item 1 from
// PORTING_STATUS.md. This matches the flow the frontend already has built
// (frontend/src/components/auth/Login.tsx + api/authTransport.ts): a
// Supabase-style magic-link recovery email, not a manually-typed code --
// the client parses `#access_token=...&type=recovery` off the URL the
// email link points to and POSTs that token + a new password to
// /password-reset/complete. (The frontend also has a *separate*
// `resetPasswordWithOtp` path for resetting via an authenticator-app TOTP
// code -- that one is NOT implemented here, since it needs real TOTP
// generation/verification against `users.otp_secret`, which is a distinct,
// larger piece of work than email recovery. Left for a follow-up session,
// noted in PORTING_STATUS.md.)
//
// This is a genuinely new implementation, not a port: the legacy backend
// used speakeasy TOTP + an in-process rate limiter (checkRateLimit /
// checkAbuseLock in security.ts) backed by an in-memory Map, which doesn't
// carry over to Workers (no long-lived process, no shared memory across
// isolates). Rate limiting here is D1-backed instead -- slightly more
// latency per request, but correct across isolates and edge locations,
// which an in-memory approach on Workers would not be.

const LINK_TTL_MS = 30 * 60 * 1000 // 30 minutes -- matches typical "reset link" expectations, longer than a typed code would warrant
const REQUEST_LIMIT_PER_USER = 3 // max links issued per user per window
const REQUEST_LIMIT_PER_IP = 8 // max links issued per IP per window (any user)
const REQUEST_WINDOW_MS = 15 * 60 * 1000
const PASSWORD_RESET_LINK_PURPOSE = 'password_reset_link'

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function generateLinkToken(): string {
  // 256 bits, base64url -- unguessable, and long enough that a global
  // (non-user-scoped) lookup by hash is safe from collision, which matters
  // here since /complete only receives the token, not an identifier.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function normalizeEmail(input: string | null | undefined): string {
  return String(input || '').trim().toLowerCase()
}

// SQLite timestamps without a zone are UTC, not the host's local timezone.
// Reject malformed dates (including JS-normalized dates such as February 30)
// rather than allowing NaN to bypass the expiry comparison.
function expiryMilliseconds(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(value)
  if (!match) return NaN
  const base = `${match[1]}T${match[2]}${match[3] || ''}`
  const utc = Date.parse(`${base}Z`)
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 19) !== base.slice(0, 19)) return NaN
  return Date.parse(`${base}${match[4] || 'Z'}`)
}

// Sends the recovery link by email via Resend (https://resend.com) -- a
// simple fetch-based HTTP API, a natural fit for Workers since it needs no
// SMTP/socket support. Requires `RESEND_API_KEY` (wrangler secret) and
// `RESEND_FROM_EMAIL` (wrangler var, must be a verified sender/domain on
// the Resend account) to actually send. Without them, this logs and
// returns `sent: false` -- callers must NOT let that change the response
// shown to the requester, to avoid account enumeration.
async function sendRecoveryEmail(env: Env, toEmail: string, link: string): Promise<{ sent: boolean }> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn('[verification] RESEND_API_KEY/RESEND_FROM_EMAIL not configured -- recovery link not emailed. Set both with `wrangler secret put RESEND_API_KEY` and a RESEND_FROM_EMAIL var before relying on this in production.')
    return { sent: false }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [toEmail],
        subject: 'Reset your password',
        text: `Click the link below to set a new password. It expires in 30 minutes and can only be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
      }),
    })
    if (!response.ok) {
      console.error('[verification] Resend API error', response.status, await response.text().catch(() => ''))
      return { sent: false }
    }
    return { sent: true }
  } catch (error) {
    console.error('[verification] Resend fetch failed', error)
    return { sent: false }
  }
}

// The emailed recovery link must land on THIS app, never on a caller-chosen
// host. `redirectTo` arrives from the UNAUTHENTICATED /password-reset/email
// endpoint, so before this check anyone who knew a username could have a
// legit-looking recovery email delivered whose link carried the single-use
// token to an attacker page in its hash fragment (open redirect -> token
// theft -> account takeover; Part-77 HIGH, auth audit). A redirectTo on one
// of the app's own configured origins keeps its origin + pathname (the page
// the client was on -- query and hash are dropped so nothing else rides
// into the emailed link); anything else falls back to the admin URL.
export function resolvePasswordResetBase(env: Env, redirectTo: string): string {
  const fallback = String(env.BUSINESS_OS_ADMIN_URL || '').replace(/\/$/, '')
  try {
    const requested = new URL(String(redirectTo || '').trim())
    const allowedOrigins = [env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL]
      .map((value) => {
        try { return new URL(String(value || '')).origin } catch { return '' }
      })
      .filter(Boolean)
    if (allowedOrigins.includes(requested.origin)) {
      return `${requested.origin}${requested.pathname}`
    }
  } catch {
    // Not a parseable absolute URL (relative, garbage, empty) -- fall back.
  }
  return fallback
}

// Issues a new recovery link for a user, invalidating any still-live links
// for the same purpose first (so only the most recently requested link is
// ever valid).
export async function issuePasswordResetLink(
  env: Env,
  userId: number,
  email: string,
  redirectTo: string,
  requesterIp: string | null,
): Promise<{ issued: boolean; sent: boolean }> {
  const db = getDb(env)
  const token = generateLinkToken()
  const tokenHash = await hashToken(token)
  const now = Date.now()
  const createdAt = sqliteUtcTimestamp(now)
  const expiresAt = sqliteUtcTimestamp(now + LINK_TTL_MS)
  const params = {
    user_id: userId, purpose: PASSWORD_RESET_LINK_PURPOSE, code_hash: tokenHash,
    target: email, expires_at: expiresAt, requester_ip: requesterIp,
    created_at: createdAt, since: sqliteUtcTimestamp(now - REQUEST_WINDOW_MS),
    user_max: REQUEST_LIMIT_PER_USER, ip_max: REQUEST_LIMIT_PER_IP,
  }

  // Both quotas and admission are one conditional write. Invalidate older
  // links only if this batch admitted a replacement; a denied request must
  // neither send mail nor revoke the user's still-valid link. The id bound
  // prevents an adapter retry from invalidating a newer admitted request.
  const results = await db.batch([
    {
      sql: `INSERT INTO verification_codes (user_id, purpose, code_hash, target, max_attempts, expires_at, requester_ip, created_at)
            SELECT @user_id, @purpose, @code_hash, @target, 1, @expires_at, @requester_ip, @created_at
            WHERE (SELECT COUNT(*) FROM (
              SELECT 1 FROM verification_codes
              WHERE user_id = @user_id AND purpose = @purpose AND created_at > @since
              LIMIT @user_max
            )) < @user_max
            AND (@requester_ip IS NULL OR @requester_ip = '' OR (SELECT COUNT(*) FROM (
              SELECT 1 FROM verification_codes
              WHERE requester_ip = @requester_ip AND created_at > @since
              LIMIT @ip_max
            )) < @ip_max)
            AND NOT EXISTS (SELECT 1 FROM verification_codes
                            WHERE user_id = @user_id AND purpose = @purpose AND code_hash = @code_hash)`,
      params,
    },
    {
      sql: `UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP
            WHERE user_id = @user_id AND purpose = @purpose AND consumed_at IS NULL
              AND id < (SELECT id FROM verification_codes
                        WHERE user_id = @user_id AND purpose = @purpose AND code_hash = @code_hash)`,
      params,
    },
  ])
  if (results[0]?.meta?.changes !== 1) return { issued: false, sent: false }

  // Matches the URL shape Login.tsx already parses: hash fragment
  // access_token + type=recovery, appended to the page the client sent as
  // redirectTo (its own current origin+pathname) -- AFTER the origin
  // allowlist above; an off-app redirectTo becomes the admin URL.
  const base = resolvePasswordResetBase(env, redirectTo)
  const link = `${base}#access_token=${encodeURIComponent(token)}&type=recovery`

  const { sent } = await sendRecoveryEmail(env, email, link)
  return { issued: true, sent }
}

export type ConsumeLinkResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'invalid' | 'expired' }

// Single-use: looked up directly by token hash (the client only has the
// token, no identifier) and consumed immediately on success so the same
// link can't be replayed.
export async function consumePasswordResetLink(env: Env, token: string): Promise<ConsumeLinkResult> {
  const db = getDb(env)
  const tokenHash = await hashToken(String(token || '').trim())

  const row = await db.prepare(`
    SELECT id, user_id, expires_at FROM verification_codes
    WHERE code_hash = @code_hash AND purpose = @purpose AND consumed_at IS NULL
    LIMIT 1
  `).get<{ id: number; user_id: number; expires_at: string }>({ code_hash: tokenHash, purpose: PASSWORD_RESET_LINK_PURPOSE })

  if (!row) return { ok: false, reason: 'invalid' }
  const expiresAt = expiryMilliseconds(row.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await db.prepare('UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run([row.id])
    return { ok: false, reason: 'expired' }
  }

  const consumed = await db.prepare(`
    UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP
    WHERE id = @id AND consumed_at IS NULL AND expires_at = @expires_at
      AND julianday(expires_at) > julianday(@now)
  `).run({ id: row.id, expires_at: row.expires_at, now: sqliteUtcTimestamp(Date.now()) })
  return consumed.changes === 1 ? { ok: true, userId: row.user_id } : { ok: false, reason: 'invalid' }
}

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL)
}
