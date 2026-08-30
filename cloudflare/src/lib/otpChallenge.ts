import type { Env } from '../index'

// OTP login challenges (Part-77, auth audit). POST /auth/otp/verify used to
// be reachable with nothing but a guessable numeric userId + a 6-digit code
// -- it was never bound to the password (or Google identity) step that is
// supposed to precede it, so 2FA was attackable as a standalone 6-digit
// login. The first factor MINTS a short-lived challenge when it answers
// `otpRequired`, and /otp/verify refuses any request that doesn't present a
// live challenge for that exact user. Stored in KV with a TTL; consumed on
// successful verification only, so a mistyped code within the window
// doesn't force the whole login over.

export const OTP_CHALLENGE_TTL_SECONDS = 300

function otpChallengeKey(token: string): string {
  return `otp:challenge:${token}`
}

export async function issueOtpChallenge(env: Env, userId: number): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  await env.CACHE.put(otpChallengeKey(token), String(userId), { expirationTtl: OTP_CHALLENGE_TTL_SECONDS })
  return token
}

export async function isLiveOtpChallenge(env: Env, token: string | undefined, userId: number): Promise<boolean> {
  const raw = String(token || '').trim()
  if (!raw || raw.length > 200) return false
  const stored = await env.CACHE.get(otpChallengeKey(raw))
  return stored != null && stored === String(userId)
}

export async function consumeOtpChallenge(env: Env, token: string | undefined): Promise<void> {
  const raw = String(token || '').trim()
  if (raw) await env.CACHE.delete(otpChallengeKey(raw))
}
