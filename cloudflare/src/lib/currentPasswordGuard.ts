import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import bcrypt from 'bcryptjs'
import { checkRateLimit, releaseRateLimitSlot } from './rateLimit'
import type { Env } from '../index'

// The ONE current-password re-check (U-profile3, 27 Sep 2026): change
// password, the profile save, and Google unlink all run through here.
//
// Atomic (refuter X3). The old version peeked at the counter, compared, then
// recorded a miss -- three separate awaits, so 40 parallel wrong guesses all
// passed a peek that still read 0. Now every attempt RESERVES a slot with
// checkRateLimit (one conditional INSERT, so a burst can never take more
// than the allowance) before bcrypt runs, and a correct password gives its
// slot back with releaseRateLimitSlot. What stays counted is failures only,
// so someone who saves their profile often is never locked out.
//
// Keyed so nobody else can lock you out (refuter X5). The old key was the
// target account id, so an admin's wrong guesses on your profile, or anyone
// holding one of your sessions, filled YOUR allowance and your own password
// change answered 429. The key is now:
//   - acting on your own account: the SESSION doing it (a hash of its
//     cookie, never the token itself). A stolen or unattended session can
//     spend only its own 10 guesses per 15 minutes -- it cannot mint more
//     sessions without the password -- and every other session of yours,
//     including a fresh sign-in, keeps its full allowance.
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
  const token = getCookie(c, SESSION_COOKIE_NAME)
  // Distinct derivation from lib/auth.ts's token_hash, so a rate-limit row
  // can never be matched back to a session row.
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
  if (bcrypt.compareSync(String(candidate || ''), String(passwordHash || ''))) {
    await releaseRateLimitSlot(env, CURRENT_PASSWORD_LIMIT_BUCKET, key, reservation.slot)
    return { ok: true }
  }
  return { ok: false, rateLimited: false }
}

export const CURRENT_PASSWORD_RATE_LIMITED_ERROR = 'Too many wrong current-password attempts. Please try again later.'
