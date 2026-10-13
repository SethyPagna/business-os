// Bounded trust for a client-supplied sale timestamp.
//
// Offline selling was cancelled (26 Sep 2026), so POST /api/sales has no
// legitimate source of a past-dated sale. A claimed created_at is honored only
// inside a short window around the server clock (device-clock skew, a slow
// request). A wider window lets any POS user record today's cash on a closed
// business day, which hides it from today's shift.
//
// A claim earlier than the window is flagged tooOld and the caller refuses the
// sale: moving it to the server clock would book a genuine retained sale into
// today's drawer and the device deletes its copy on success. A claim in the
// future or one that does not parse falls back to the server clock (value
// null) and is reported as adjusted.
//
// A caller that must keep an older client time (a one-off drain of sales
// queued before the cancellation) passes maxPastMs explicitly; the default
// never widens.
//
// The output is normalized to SQLite's CURRENT_TIMESTAMP shape
// ("YYYY-MM-DD HH:MM:SS", UTC) -- NOT ISO-with-T: sales queries ORDER BY
// created_at lexicographically, and at position 10 "T" sorts after " ", so
// a mixed format would pin every ISO row after all same-day rows.

// Shift close (routes/shifts.ts) clamps a slightly-ahead closed_at with this
// tolerance; it is deliberately wider than the sale window below.
export const CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export const SALE_CREATED_AT_MAX_PAST_MS = 10 * 60 * 1000
export const SALE_CREATED_AT_MAX_FUTURE_MS = 2 * 60 * 1000

export type ClientCreatedAtResolution = {
  value: string | null
  adjusted: boolean
  claimed: string | null
  tooOld: boolean
}

type ResolveOptions = { nowMs?: number; maxPastMs?: number }

function storedShape(ms: number): string | null {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  if (year < 1000 || year > 9999) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function resolveClientCreatedAt(raw: unknown, options: ResolveOptions = {}): ClientCreatedAtResolution {
  const nowMs = options.nowMs ?? Date.now()
  const maxPastMs = options.maxPastMs ?? SALE_CREATED_AT_MAX_PAST_MS
  const text = typeof raw === 'string' ? raw.trim() : raw
  if (text === undefined || text === null || text === '') return { value: null, adjusted: false, claimed: null, tooOld: false }
  const parsedMs = typeof text === 'string' ? new Date(text).getTime() : Number.NaN
  if (Number.isNaN(parsedMs)) return { value: null, adjusted: true, claimed: null, tooOld: false }
  const claimed = storedShape(parsedMs)
  const tooOld = parsedMs < nowMs - maxPastMs
  const inWindow = !tooOld && parsedMs <= nowMs + SALE_CREATED_AT_MAX_FUTURE_MS
  if (!inWindow || !claimed) return { value: null, adjusted: true, claimed, tooOld }
  return { value: claimed, adjusted: false, claimed, tooOld: false }
}

export function sanitizeClientCreatedAt(raw: unknown, nowMs: number = Date.now()): string | null {
  return resolveClientCreatedAt(raw, { nowMs }).value
}
