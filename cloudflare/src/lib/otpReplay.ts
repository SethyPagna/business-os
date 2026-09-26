import type { Env } from '../index'

// TOTP replay guard. A six-digit code stays valid for the whole +/-2 step
// verification window (~150s), so without this a code seen once -- shoulder
// surfing, a phished page, a proxy log -- can be submitted again. Records the
// highest step each user has spent and refuses any step at or below it.
//
// KV (the CACHE binding already used by lib/otpChallenge.ts), not D1: the
// record only needs to outlive the verification window, and a TTL keeps it
// self-cleaning without a migration. KV is eventually consistent, so two
// requests racing inside the same second can both pass; the per-user rate
// limit and lockout that run in front of this bound that to a handful.
const OTP_REPLAY_TTL_SECONDS = 10 * 60

function otpReplayKey(userId: number | string): string {
  return `otp-used-step:${Number(userId)}`
}

export async function isOtpStepReplayed(env: Env, userId: number | string, step: number): Promise<boolean> {
  const raw = await env.CACHE.get(otpReplayKey(userId))
  if (raw === null || raw === undefined) return false
  const lastStep = Number(raw)
  return Number.isFinite(lastStep) && step <= lastStep
}

export async function markOtpStepUsed(env: Env, userId: number | string, step: number): Promise<void> {
  await env.CACHE.put(otpReplayKey(userId), String(step), { expirationTtl: OTP_REPLAY_TTL_SECONDS })
}
