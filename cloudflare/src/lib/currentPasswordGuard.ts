import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { checkRateLimit, releaseRateLimitSlot } from './rateLimit'
import { currentSessionLimitFamily } from './auth'
import { verifyPassword } from './passwordHash'
import type { Env } from '../index'

// The ONE current-password re-check (U-profile3, 27 Sep 2026): change
// password, the profile save, and Google unlink all run through here.
//
// Atomic (refuter X3). The old version peeked at the counter, compared, then
// recorded a miss -- three separate awaits, so 40 parallel wrong guesses all
// passed a peek that still read 0. Now every attempt RESERVES a slot with
// checkRateLimit (one conditional INSERT, so a burst can never take more
// than the allowance) before the hash check runs, and a correct password gives its
// slot back with releaseRateLimitSlot. What stays counted is failures only,
// so someone who saves their profile often is never locked out.
//
// Keyed so nobody else can lock you out (refuter X5). The old key was the
// target account id, so an admin's wrong guesses on your profile, or anyone
// holding one of your sessions, filled YOUR allowance and your own password
// change answered 429. The key is now:
//   - acting on your own account: the SIGN-IN the session descends from
//     (lib/auth.ts currentSessionLimitFamily). A cookie alone was not
//     enough (S-auth4): POST /api/auth/session-duration mints a new
//     session from an existing one with no password and leaves the old
//     cookie valid, so a per-cookie key handed a stolen session 10 more
//     guesses per session it minted. Re-issued sessions now carry their
//     sign-in's id (user_sessions.limit_family_id, migration 0201), so a
//     stolen or unattended session and everything minted from it share ONE
//     allowance of 10 guesses per 15 minutes. A new family needs a real
//     sign-in -- the password, an OTP sign-in, or a linked Google account --
//     and every other sign-in of yours keeps its full allowance.
//   - acting on someone else (an admin on your profile): the actor + target
//     pair, so that admin exhausts only their own allowance against you.
// No account-wide ceiling on top: it would hand back exactly the lockout X5
// removes (a few sessions or admins filling the shared count), and each
// guesser above is already bounded. Sign-in has its own limits
// (routes/auth.ts: per-IP, per-account, lib/loginLockout).
export const CURRENT_PASSWORD_LIMIT_BUCKET = 'auth:current_password'
export const CURRENT_PASSWORD_LIMIT_MAX = 10
export const CURRENT_PASSWORD_LIMIT_WINDOW_MS = 15 * 60 * 1000

const SESSION_COOKIE_NAME = 'bos_session'

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function currentPasswordLimitKey(c: Context<any>, actorId: number | string, targetId: number | string): Promise<string> {
  const actor = Number(actorId || 0)
  const target = Number(targetId || 0)
  if (actor && actor !== target) return `actor:${actor}:target:${target}`
  let family: number | null = null
  try {
    family = await currentSessionLimitFamily(c)
  } catch (_) {
    // Only before migration 0201 is applied (no limit_family_id column):
    // fall back to the per-cookie key rather than fail every password check.
    // Deploy order is migration first, so this is a transition path only.
  }
  if (family) return `family:${family}`
  const token = getCookie(c, SESSION_COOKIE_NAME)
  // Distinct derivation from lib/auth.ts's token_hash, so a rate-limit row
  // can never be matched back to a session token.
  if (token) return `session:${(await sha256Hex(`current-password:${token}`)).slice(0, 40)}`
  return `uid:${target}`
}

export type CurrentPasswordVerdict =
  | { ok: true }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }
  | { ok: false; rateLimited: false }

export async function verifyCurrentPassword(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any>,
  who: { actorId: number | string; targetId: number | string },
  candidate: string,
  passwordHash: string,
): Promise<CurrentPasswordVerdict> {
  const env = c.env as Env
  const key = await currentPasswordLimitKey(c, who.actorId, who.targetId)
  const reservation = await checkRateLimit(env, CURRENT_PASSWORD_LIMIT_BUCKET, key, CURRENT_PASSWORD_LIMIT_MAX, CURRENT_PASSWORD_LIMIT_WINDOW_MS)
  if (!reservation.allowed) return { ok: false, rateLimited: true, retryAfterSeconds: reservation.retryAfterSeconds }
  if ((await verifyPassword(String(candidate || ''), String(passwordHash || ''))).ok) {
    await releaseRateLimitSlot(env, CURRENT_PASSWORD_LIMIT_BUCKET, key, reservation.slot)
    return { ok: true }
  }
  return { ok: false, rateLimited: false }
}

export const CURRENT_PASSWORD_RATE_LIMITED_ERROR = 'Too many wrong current-password attempts. Please try again later.'
