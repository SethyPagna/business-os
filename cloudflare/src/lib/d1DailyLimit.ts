// D1's free-tier daily caps (Cloudflare D1 changelog, 1 Sep 2026). Once the account reaches 5M rows read or 100k rows
// written in a UTC day, every D1 call fails until 00:00 UTC with
//   "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow
//    (midnight UTC) to continue."   (or "... daily row write limit ...").
// index.ts app.onError turns that into one stable 503 the app can show a single banner for, and never echoes the raw
// message. lib/db.ts already refuses to retry it (D1_QUOTA_EXCEEDED_ERROR_PATTERN), so a request fails on its first call.

export type D1DailyLimit = 'read' | 'write'
export type D1DailyLimitBody = { success: false; code: 'd1_daily_limit'; limit: D1DailyLimit; resetsAt: string }

const DAILY_LIMIT_MESSAGE = /exceeded D1.s free tier daily row (read|write) limit/i

/** Which daily cap an error reports, looking through wrapped causes; null for any other error. */
export function d1DailyLimitOf(error: unknown): D1DailyLimit | null {
  for (let depth = 0, current: unknown = error; current != null && depth < 4; depth += 1) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : String((current as { message?: unknown })?.message ?? '')
    const match = DAILY_LIMIT_MESSAGE.exec(message)
    if (match) return match[1].toLowerCase() === 'write' ? 'write' : 'read'
    current = (current as { cause?: unknown } | null)?.cause
  }
  return null
}

/** The next 00:00 UTC after `now`, as an ISO string. */
export function nextUtcMidnight(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
}

export function d1DailyLimitBody(error: unknown, now: Date = new Date()): D1DailyLimitBody | null {
  const limit = d1DailyLimitOf(error)
  return limit ? { success: false, code: 'd1_daily_limit', limit, resetsAt: nextUtcMidnight(now) } : null
}
