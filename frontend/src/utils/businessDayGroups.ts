import { fmtDate } from './formatters.ts'
import type { TimestampInput } from './formatters.ts'

/**
 * Split an already-ordered list of records into consecutive BUSINESS-DAY
 * groups, so a list can print the date once on a divider row and leave each
 * record showing only its time (fmtClock24).
 *
 * The business day is Asia/Phnom_Penh (constants.ts BUSINESS_TIME_ZONE), and
 * fmtDate() is the helper that already renders one business day as exactly one
 * string -- so grouping by that string IS a business-day grouping. This is the
 * mechanism the Stock Changes ledger has shipped inline since Aug 30 2026
 * (components/products/StockChangeSection.tsx's `dayGroups`); it lives here so
 * the Stock-in Sessions list uses the same one rather than a second copy.
 *
 * Deliberately NOT recordFilters.ts's buildTimeActionSections(): that one
 * derives its day key from the DEVICE's calendar (getFullYear/getMonth/
 * getDate), so a 22:00 Phnom Penh receipt lands on the previous or next day
 * for anyone whose device is in another zone. Stock receipts are business
 * facts, not device facts.
 *
 * Nothing here sorts or compares the rendered text -- rows arrive already
 * ordered (created_at DESC from the server) and iteration preserves both the
 * day order and the within-day order. A day may straddle a page edge; the
 * header simply reappears on the next page, as on every other server-paged
 * day-grouped list in this app.
 */
export function groupByBusinessDay<T>(
  rows: readonly T[],
  timestampOf: (row: T) => TimestampInput,
): Array<{ key: string; rows: T[] }> {
  const groups: Array<{ key: string; rows: T[] }> = []
  const index = new Map<string, number>()
  for (const row of rows) {
    const key = fmtDate(timestampOf(row))
    let at = index.get(key)
    if (at === undefined) {
      at = groups.length
      index.set(key, at)
      groups.push({ key, rows: [] })
    }
    groups[at].rows.push(row)
  }
  return groups
}
