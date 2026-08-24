import { getDb } from './db'
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

// Callers should treat "rate limited" as "silently skip sending" rather
// than surfacing it distinctly -- the public response must stay identical
// to the "no such account" case to avoid enumeration.
async function isRateLimited(env: Env, userId: number, purpose: string, requesterIp: string | null): Promise<boolean> {
  const db = getDb(env)
  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()

  const userCount = await db.prepare(`
    SELECT COUNT(*) AS n FROM verification_codes
    WHERE user_id = @user_id AND purpose = @purpose AND created_at > @since
  `).get<{ n: number }>({ user_id: userId, purpose, since: windowStart })
  if ((userCount?.n || 0) >= REQUEST_LIMIT_PER_USER) return true

  if (requesterIp) {
    const ipCount = await db.prepare(`
      SELECT COUNT(*) AS n FROM verification_codes
      WHERE requester_ip = @ip AND created_at > @since
    `).get<{ n: number }>({ ip: requesterIp, since: windowStart })
    if ((ipCount?.n || 0) >= REQUEST_LIMIT_PER_IP) return true
  }

  return false
}

// Sends the recovery link by email via Resend (https://resend.com) -- a
// simple fetch-based HTTP API, a natural fit for Workers since it needs no
// SMTP/socket support. Requires `RESEND_API_KEY` (wrangler secret) and
// `RESEND_FROM_EMAIL` (wrangler var, must be a verified sender/domain on
// the Resend account) to actually send. Without them, this logs and
// returns `sent: false` -- callers must NOT let that change the response
// shown to the requester (see isRateLimited's comment on enumeration).
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
  if (await isRateLimited(env, userId, PASSWORD_RESET_LINK_PURPOSE, requesterIp)) {
    return { issued: false, sent: false }
  }

  const db = getDb(env)
  const token = generateLinkToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()

  await db.batch([
    {
      sql: `UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP
            WHERE user_id = @user_id AND purpose = @purpose AND consumed_at IS NULL`,
      params: { user_id: userId, purpose: PASSWORD_RESET_LINK_PURPOSE },
    },
    {
      sql: `INSERT INTO verification_codes (user_id, purpose, code_hash, target, max_attempts, expires_at, requester_ip)
            VALUES (@user_id, @purpose, @code_hash, @target, 1, @expires_at, @requester_ip)`,
      params: { user_id: userId, purpose: PASSWORD_RESET_LINK_PURPOSE, code_hash: tokenHash, target: email, expires_at: expiresAt, requester_ip: requesterIp },
    },
  ])

  // Matches the URL shape Login.tsx already parses: hash fragment
  // access_token + type=recovery, appended to the page the client sent as
  // redirectTo (its own current origin+pathname).
  const base = String(redirectTo || '').trim() || ''
  const separator = base.includes('#') ? '&' : '#'
  const link = `${base}${separator}access_token=${encodeURIComponent(token)}&type=recovery`

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
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare('UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run([row.id])
    return { ok: false, reason: 'expired' }
  }

  await db.prepare('UPDATE verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run([row.id])
  return { ok: true, userId: row.user_id }
}

export function isEmailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL)
}
