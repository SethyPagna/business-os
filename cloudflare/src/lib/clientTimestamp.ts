// Bounded trust for a client-supplied sale timestamp (offline replays).
//
// Offline POS sales already mint their receipt id at QUEUE time from the
// device clock (the sale's own moment -- frontend/src/api/saleWriteTransport
// stamps payload.created_at the same way). Without this, the server wrote
// CURRENT_TIMESTAMP at SYNC time, so a sale made at 23:50 that synced at
// 00:10 landed on the wrong day in every date-ranged report (the Part-77
// "offline sale timestamps" finding). Online checkouts send no created_at
// and keep the server clock.
//
// Trust is bounded the same way client receipt numbers already are (an
// authenticated cashier's device): the value must parse, and may not be in
// the future beyond small device-clock skew -- anything else falls back to
// the server clock (return null), never an error. No lower bound: a device
// legitimately offline for days still owns its sale moment.
//
// The output is normalized to SQLite's CURRENT_TIMESTAMP shape
// ("YYYY-MM-DD HH:MM:SS", UTC) -- NOT ISO-with-T: sales queries ORDER BY
// created_at lexicographically, and at position 10 "T" sorts after " ", so
// a mixed format would pin every ISO row after all same-day rows.

export const CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export function sanitizeClientCreatedAt(raw: unknown, nowMs: number = Date.now()): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getTime() > nowMs + CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS) return null
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}
