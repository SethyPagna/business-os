// Turns a batch's received date into the batch's own operator-facing code
// -- "lot code can be removed... batch column is just a translated
// version of received date": 22/08/2026 or 22/8/2026 (day first) becomes 08222026.
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
 * ONE RULE (owner, Oct 6 2026): every import reads a slash date DAY-FIRST,
 * dd/mm/yyyy, like the rest of the app -- "we can't have different logics in
 * the system". The single exception is a column whose header NAMES the other
 * order: `batch(mm/dd/yyyy)` is month-first, so a sheet the shop already
 * exported under that header still reads exactly as it was written.
 * `batch(dd/mm/yyyy)` and every bare header (`batch`, `date`,
 * `received_date`) are day-first. ISO `yyyy-mm-dd` is accepted under every
 * header and is what the downloaded template ships, because it is the one
 * form neither reading can get wrong.
 *
 * Before Oct 6 the bare headers were month-first "because they have always
 * been". That left two readings of one string in one system; the history is in
 * git, the rule is this paragraph.
 */
export type SlashDateOrder = 'month-first' | 'day-first'

export const BATCH_DATE_COLUMN_MONTH_FIRST = 'batch(mm/dd/yyyy)'
export const BATCH_DATE_COLUMN_DAY_FIRST = 'batch(dd/mm/yyyy)'

/**
 * Accepted received-date columns, in precedence order. The two
 * format-naming headers win over the bare fallbacks, which exist only so an
 * older hand-built CSV still loads. Only the header that SAYS mm/dd/yyyy is
 * month-first.
 */
const BATCH_DATE_COLUMNS: ReadonlyArray<{ header: string; order: SlashDateOrder }> = [
  { header: BATCH_DATE_COLUMN_DAY_FIRST, order: 'day-first' },
  { header: BATCH_DATE_COLUMN_MONTH_FIRST, order: 'month-first' },
  { header: 'batch', order: 'day-first' },
  { header: 'date', order: 'day-first' },
  { header: 'received_date', order: 'day-first' },
]

/**
 * The received-date cell of one import row, together with the reading order
 * its own header dictates and the NAME of the header it came from. Empty
 * `raw` means "no date given" -- callers default that to today, exactly as
 * before, and get an empty `header` with it.
 *
 * The header name is returned, not just the order, because the messages this
 * feeds are read by someone looking at their own spreadsheet: "not a readable
 * date" leaves them guessing which of their columns was read and which way
 * round. See importEngine.ts's unreadable_batch_date warning.
 */
export function readBatchDateCell(row: Record<string, unknown>): { raw: string; order: SlashDateOrder; header: string } {
  for (const { header, order } of BATCH_DATE_COLUMNS) {
    const value = String(row?.[header] ?? '').trim()
    if (value) return { raw: value, order, header }
  }
  return { raw: '', order: 'day-first', header: '' }
}

// The same window DateEntryInput's parser (frontend/src/utils/dateEntry.ts
// MIN_YEAR/MAX_YEAR) accepts. A date the field refuses must not be storable by
// a route that re-reads the same text: '0099-01-01' and '9999-12-31' are typos,
// not received dates.
const MIN_DATE_YEAR = 1970
const MAX_DATE_YEAR = 2999

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) return false
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
// `order` defaults to 'day-first', the one reading the whole app shares. A
// caller whose source names the other order says so: readBatchDateCell does for
// a `batch(mm/dd/yyyy)` column header, and nothing else should.
export function normalizeToIsoDate(value: string | null | undefined, order: SlashDateOrder = 'day-first'): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  // End-anchored: a date followed by anything but a time-of-day ('2026-09-03garbage',
  // '2026-09-031') is not a date. The tolerated tail is exactly what D1 and
  // JSON.stringify(Date) emit: ' HH:MM[:SS[.fff]]' or 'THH:MM[:SS[.fff]]' with an
  // optional Z / +07:00 / +0700 zone.
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/)
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
  // The year is 2 or 4 digits, never 3 ('9/3/026' is a typo; the day-first
  // field refuses it too).
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/)
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

/**
 * The order a PERSON typed it in, inside this app's own UI: DAY-FIRST.
 *
 * Owner, Sep 6 2026: "i asked to change already dd/mm/yyyy. this is the rule
 * moving forward." Every field staff type a date into renders DateEntryInput,
 * whose mask and parser are day-first (frontend/src/utils/dateEntry.ts), and
 * every date the app prints back is day-first too. A Worker route that re-read
 * that same slash string month-first would store what the screen called
 * 3 September (03/09/2026) as 9 March -- wrong by months, with nothing on
 * screen to show it, for every day <= 12.
 *
 * So the two readings carry two NAMES instead of one silent default:
 *   normalizeTypedDate(v)        -- a value a person typed into the UI.
 *   normalizeToIsoDate(v, order) -- a CSV cell, whose order its own column
 *                                   header decides (readBatchDateCell).
 * A route must not reach for the bare default: that default belongs to
 * spreadsheet columns that name no format and must keep the only meaning they
 * have ever had.
 */
export function normalizeTypedDate(value: string | null | undefined): string | null {
  return normalizeToIsoDate(value, 'day-first')
}

/**
 * A typed date FIELD read at an API boundary (a lot's expiry or credit due
 * date, a discount window, a stock-in line): blank -> { value: null }, a
 * readable date (day-first, like the field that typed it) -> its ISO form,
 * anything else -> { invalid: true }. The caller answers 400 on `invalid`; it
 * must never store the raw text and never fall back to "today" -- both of which
 * the routes used to do, which is how a month-first slash string reached
 * `received_at` and a year-only text reached `expiry_date`.
 */
export function readTypedDateField(value: unknown, options?: { keepTime?: boolean }): { value: string | null; invalid: boolean } {
  if (value == null) return { value: null, invalid: false }
  if (typeof value !== 'string' && typeof value !== 'number') return { value: null, invalid: true }
  const text = String(value).trim()
  if (!text) return { value: null, invalid: false }
  const iso = normalizeTypedDate(text)
  if (!iso) return { value: null, invalid: true }
  // keepTime: a readable value that carries a time of day (an older writer's instant) keeps
  // it verbatim -- the window columns are compared as instants, and cutting the value to its
  // date would move the window's edge.
  return { value: options?.keepTime && /[ T]\d{1,2}:\d{2}/.test(text) ? text : iso, invalid: false }
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
