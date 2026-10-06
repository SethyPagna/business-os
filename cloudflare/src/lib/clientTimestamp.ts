// Bounded trust for a client-supplied sale timestamp.
//
// Offline POS sales used to mint their receipt id and created_at at QUEUE time
// from the device clock, so a sale made at 23:50 that synced at 00:10 still
// landed on the day it happened (the Part-77 "offline sale timestamps"
// finding). Online checkouts send no created_at and keep the server clock.
//
// N3 (loophole review 2026-10-06): offline selling was retired on 26 Sep 2026,
// which removed the only legitimate reason to accept an OLD sale moment -- and
// with no lower bound any authenticated caller could backdate a sale into an
// earlier, already-closed shift and day, changing that day's report and
// taking the cash out of today's drawer. The value is now honoured only
// within small device-clock skew of the server's own clock, in either
// direction; anything else falls back to the server clock (return null),
// never an error, so a till is never stranded. The one-time manual recovery
// of a sale queued before the retirement still records -- at the server's
// time, inside the recovering cashier's open shift (lib/saleShiftRequirement).
// There is no backdating feature: imports carry historical dates through
// their own permission-gated path, not this one.
//
// The output is normalized to SQLite's CURRENT_TIMESTAMP shape
// ("YYYY-MM-DD HH:MM:SS", UTC) -- NOT ISO-with-T: sales queries ORDER BY
// created_at lexicographically, and at position 10 "T" sorts after " ", so
// a mixed format would pin every ISO row after all same-day rows.

export const CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
export const CLIENT_TIMESTAMP_MAX_PAST_SKEW_MS = 5 * 60 * 1000

export function sanitizeClientCreatedAt(raw: unknown, nowMs: number = Date.now()): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getTime() > nowMs + CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS) return null
  if (parsed.getTime() < nowMs - CLIENT_TIMESTAMP_MAX_PAST_SKEW_MS) return null
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}
