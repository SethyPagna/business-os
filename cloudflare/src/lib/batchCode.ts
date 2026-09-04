// Turns a batch's received date into the batch's own operator-facing code
// -- "lot code can be removed... batch column is just a translated
// version of received date": 08/22/2026 or 8/22/2026 becomes 08222026.
// The ORDER a slash-separated cell is read in is decided by the CSV column
// header it came from, not by the app's current display convention -- see
// SlashDateOrder and BATCH_DATE_COLUMNS below. See dateToBatchCode for the
// stored code's format history.
//
// Replaces the old free-typed "Lot / batch code" field: lib/
// productBatches.ts's receiveBatchStock, routes/batches.ts's PATCH /:id,
// lib/importEngine.ts's product-import restock path, and
// lib/productWrites.ts's default "day added" batch all now derive
// lot_code/batch_key from whichever date the stock was actually received,
// instead of trusting an arbitrary string typed in at receive time. A
// receipt on the same calendar date as an existing batch naturally
// produces the same code, so "top up an existing lot" now falls straight
// out of matching by date rather than needing a person to retype the same
// label twice.

/**
 * Which way round a slash/dash-separated date cell is read.
 *
 * The app's DISPLAY convention went day-first on Sep 4 2026, but this is
 * deliberately NOT tied to it. A CSV cell reading "03/09/2026" was written by
 * whoever exported or hand-built that file, and re-reading a historical file
 * under a new order would silently swap day and month for every day <= 12 --
 * writing a wrong `received_date` and a wrong `lot_code` into real stock,
 * with nothing on screen to show it happened.
 *
 * So the ORDER comes from the column header, which names its own format:
 * `batch(mm/dd/yyyy)` is month-first forever, `batch(dd/mm/yyyy)` is
 * day-first. The bare fallback headers name no format, so they keep the only
 * meaning they have ever had -- month-first. ISO `yyyy-mm-dd` is accepted
 * under every header and is what the downloaded template now ships, because
 * it is the one form neither reading can get wrong.
 */
export type SlashDateOrder = 'month-first' | 'day-first'

export const BATCH_DATE_COLUMN_MONTH_FIRST = 'batch(mm/dd/yyyy)'
export const BATCH_DATE_COLUMN_DAY_FIRST = 'batch(dd/mm/yyyy)'

/**
 * Accepted received-date columns, in precedence order. The two
 * format-naming headers win over the bare fallbacks, which exist only so an
 * older hand-built CSV still loads.
 */
const BATCH_DATE_COLUMNS: ReadonlyArray<{ header: string; order: SlashDateOrder }> = [
  { header: BATCH_DATE_COLUMN_DAY_FIRST, order: 'day-first' },
  { header: BATCH_DATE_COLUMN_MONTH_FIRST, order: 'month-first' },
  { header: 'batch', order: 'month-first' },
  { header: 'date', order: 'month-first' },
  { header: 'received_date', order: 'month-first' },
]

/**
 * The received-date cell of one import row, together with the reading order
 * its own header dictates. Empty `raw` means "no date given" -- callers
 * default that to today, exactly as before.
 */
export function readBatchDateCell(row: Record<string, unknown>): { raw: string; order: SlashDateOrder } {
  for (const { header, order } of BATCH_DATE_COLUMNS) {
    const value = String(row?.[header] ?? '').trim()
    if (value) return { raw: value, order }
  }
  return { raw: '', order: 'month-first' }
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Normalizes a date-ish string to plain YYYY-MM-DD (no time component),
// accepting either this app's own ISO shape (received_date/todayIso(),
// <input type=date>, or the date-prefix of a D1 'YYYY-MM-DD HH:MM:SS'
// timestamp) or a slash/dash-separated string a human typed into a CSV cell.
// Returns null for anything that isn't a real calendar date.
//
// `order` defaults to 'month-first' so every pre-existing call site keeps
// the exact meaning it had before Sep 4 2026. Only a caller that KNOWS it is
// reading a day-first column passes the other value -- see readBatchDateCell.
export function normalizeToIsoDate(value: string | null | undefined, order: SlashDateOrder = 'month-first'): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    if (!isValidCalendarDate(year, month, day)) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // A trailing 24-hour time is tolerated (and ignored -- this function
  // answers "which DATE") so slash-formatted datetime cells from the
  // migration files parse the same way the ISO branch above already
  // tolerates 'YYYY-MM-DD HH:MM:SS'.
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (slash) {
    const [month, day] = order === 'day-first'
      ? [Number(slash[2]), Number(slash[1])]
      : [Number(slash[1]), Number(slash[2])]
    let year = Number(slash[3])
    if (year < 100) year += 2000
    if (!isValidCalendarDate(year, month, day)) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

// MMDDYYYY -- e.g. "08282026" for the 28th of August 2026. Format history,
// kept honest: originally all-numeric MMDDYYYY; switched to
// month-abbreviation (AUG282026) per Aug 24 user direction; switched BACK to
// all-numeric MMDDYYYY per Aug 28 (Part 388) user direction -- "translate
// mm/dd/yyyy into mmddyyyy".
//
// THIS OUTPUT STAYS MMDDYYYY. It is an IDENTIFIER, not a displayed date: it
// is stored as `lot_code`/`batch_key` and recomputed here to MATCH existing
// lots, so re-cutting it day-first would stop every code produced from today
// matching the identical date's code stored yesterday -- silently splitting
// every lot in production in two. The app went day-first on Sep 4 2026 and
// this deliberately did not move; frontend/src/utils/batchLabel.ts's
// lotCodeAsDate is what turns this code into a day-first date for reading.
export function dateToBatchCode(value: string | null | undefined): string | null {
  const iso = normalizeToIsoDate(value)
  if (!iso) return null
  const [yyyy, mm, dd] = iso.split('-')
  return `${mm}${dd}${yyyy}`
}
