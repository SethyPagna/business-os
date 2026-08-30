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
