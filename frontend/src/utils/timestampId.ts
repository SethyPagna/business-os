// Identifier timestamps for client-minted receipt/return numbers:
// YYYYMMDD-HHMMSS in the business timezone (Asia/Phnom_Penh, 24-hour) --
// user, Aug 30 2026: receipt ids encode the sale's own date+time. This
// compact form is ONLY for identifiers; displayed dates stay mm/dd/yyyy
// 24-hour via utils/formatters.ts. Hand-synced server copy:
// cloudflare/src/lib/receiptNumber.ts (fixed UTC+7 arithmetic, same
// output); keep the two in step.

import { BUSINESS_TIME_ZONE } from '../constants.ts'

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
