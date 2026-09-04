// Identifier timestamps for client-minted receipt/return numbers:
// YYYYMMDD-HHMMSS in the business timezone (Asia/Phnom_Penh, 24-hour) --
// user, Aug 30 2026: receipt ids encode the sale's own date+time. This
// compact form is ONLY for identifiers; displayed dates stay mm/dd/yyyy
// 24-hour via utils/formatters.ts. Hand-synced server copy:
// cloudflare/src/lib/receiptNumber.ts (fixed UTC+7 arithmetic, same
// output); keep the two in step.

import { BUSINESS_TIME_ZONE } from '../constants.ts'
import { parseServerTimestampMs } from './formatters.ts'

export function businessDateTimeId(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23, not hour12:false -- some engines render midnight as "24" there,
    // same reason as formatters.ts's fmtDateTime24.
    hourCycle: 'h23',
    timeZone: BUSINESS_TIME_ZONE,
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`
}

/**
 * Display id for one stock-in session: `S-YYYYMMDD-HHMM`, 24-hour, stamped in
 * the business timezone (S4-14). The Sessions list used to print the raw
 * grouping key in this column -- "session:1757003912345", or the legacy form
 * "legacy:2026-09-03 08:12:44::1:7" -- which is a database join key, not
 * something a shop owner can read back over the phone.
 *
 * Derived from the session's OWN first-movement timestamp rather than minted
 * at render time, so the id is stable for the life of the row and identical on
 * every device. Server stamps are timezone-less UTC (SQLite's
 * CURRENT_TIMESTAMP), so they go through parseServerTimestampMs -- a bare
 * Date.parse would read them as local time and shift the id by 7 hours here.
 *
 * Minute resolution is what the board asked for, so two sessions opened in the
 * same minute do share an id; callers keep the opaque key on the row's `title`
 * so support can still tell them apart. Empty string for an unreadable stamp,
 * which callers render as their own placeholder.
 */
export function stockSessionId(rawCreatedAt: unknown): string {
  const ms = parseServerTimestampMs(rawCreatedAt as string)
  if (!Number.isFinite(ms)) return ''
  const [datePart, timePart] = businessDateTimeId(new Date(ms)).split('-')
  return `S-${datePart}-${timePart.slice(0, 4)}`
}

// Hand-synced mirror of cloudflare/src/lib/receiptNumber.ts's guard -- keep
// the two regexes identical. The client mints its own receipt id for an
// offline sale (api/saleWriteTransport.ts), so it also has to be able to tell
// a real business id from a foreign one: on 2026-09-02 a reconciliation pack
// wrote the old system's `NNNNNN@YYYY-MM-DD` invoice label onto 15,004 sales
// (repaired by migration 0107), and the queue must never replay that shape
// back to the server. The server normalises anyway; this stops the wrong
// number reaching the printed offline receipt in the first place.
export const BUSINESS_RECEIPT_NUMBER_RE = /^(?:RCP-|RET-|SRET-)?\d{8}-\d{6}(?:-[0-9A-Z]{1,4})?$/

export function isBusinessReceiptNumber(value: unknown): boolean {
  return typeof value === 'string' && BUSINESS_RECEIPT_NUMBER_RE.test(value.trim())
}
