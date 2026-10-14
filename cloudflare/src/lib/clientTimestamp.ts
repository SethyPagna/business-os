// A client-supplied sale time is never stored.
//
// Offline selling was cancelled (26 Sep 2026) and no queued sale exists, so
// POST /api/sales has no legitimate source of a back- or forward-dated sale.
// Every sale is stamped with the server clock. The claim is still read so the
// route can tell a stale client and keep an audit trail:
//   - a claim older than SALE_CREATED_AT_MAX_PAST_MS is flagged tooOld and the
//     caller refuses the sale (409): the device keeps its copy and nothing is
//     booked into today's drawer;
//   - any other claim is flagged adjusted and recorded, with what was claimed,
//     on the creation audit row; the sale takes the server time. A claim that
//     does not parse is adjusted with nothing to echo.
//
// A claim without a zone ("2026-10-13 17:03:15") is read as UTC, the shape the
// server itself stores, so the result does not depend on the host's time zone.
// The claim is echoed in SQLite's CURRENT_TIMESTAMP shape ("YYYY-MM-DD HH:MM:SS",
// UTC).

// Shift close (routes/shifts.ts) clamps a slightly-ahead closed_at with this
// tolerance.
export const CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export const SALE_CREATED_AT_MAX_PAST_MS = 10 * 60 * 1000

export type ClientCreatedAtResolution = {
  adjusted: boolean
  claimed: string | null
  tooOld: boolean
}

type ResolveOptions = { nowMs?: number }

const ZONELESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

function parseClaimMs(text: string): number {
  return new Date(ZONELESS_DATE_TIME.test(text) ? `${text.replace(' ', 'T')}Z` : text).getTime()
}

function storedShape(ms: number): string | null {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  if (year < 1000 || year > 9999) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export function resolveClientCreatedAt(raw: unknown, options: ResolveOptions = {}): ClientCreatedAtResolution {
  const nowMs = options.nowMs ?? Date.now()
  const text = typeof raw === 'string' ? raw.trim() : raw
  if (text === undefined || text === null || text === '') return { adjusted: false, claimed: null, tooOld: false }
  const parsedMs = typeof text === 'string' ? parseClaimMs(text) : Number.NaN
  if (Number.isNaN(parsedMs)) return { adjusted: true, claimed: null, tooOld: false }
  return { adjusted: true, claimed: storedShape(parsedMs), tooOld: parsedMs < nowMs - SALE_CREATED_AT_MAX_PAST_MS }
}
