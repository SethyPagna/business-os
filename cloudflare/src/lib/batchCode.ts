// Turns a batch's received date into the batch's own operator-facing code
// -- "lot code can be removed... batch column is just a translated
// version of received date": 08/22/2026 or 8/22/2026 becomes 08222026.
// Always read as mm/dd/yyyy, this app's date convention throughout (see
// frontend/src/utils/batchLabel.ts's formatBatchReceivedDate), never
// dd/mm/yyyy. See dateToBatchCode below for the format history.
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

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Normalizes a date-ish string to plain YYYY-MM-DD (no time component),
// accepting either this app's own ISO shape (received_date/todayIso(),
// <input type=date>, or the date-prefix of a D1 'YYYY-MM-DD HH:MM:SS'
// timestamp) or an mm/dd/yyyy (or m/d/yyyy, 2-digit year) string a human
// typed into a CSV cell. Returns null for anything that isn't a real
// calendar date.
export function normalizeToIsoDate(value: string | null | undefined): string | null {
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
  // answers "which DATE") so mm/dd/yyyy-formatted datetime cells from the
  // migration files parse the same way the ISO branch above already
  // tolerates 'YYYY-MM-DD HH:MM:SS'. (Part 388: the whole app speaks
  // mm/dd/yyyy, files included.)
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (slash) {
    const month = Number(slash[1])
    const day = Number(slash[2])
    let year = Number(slash[3])
    if (year < 100) year += 2000
    if (!isValidCalendarDate(year, month, day)) return null
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

// MMDDYYYY -- e.g. "08282026" for 08/28/2026. Format history, kept honest:
// originally all-numeric MMDDYYYY; switched to month-abbreviation
// (AUG282026) per Aug 24 user direction; switched BACK to all-numeric
// MMDDYYYY per Aug 28 (Part 388) user direction -- "translate mm/dd/yyyy
// into mmddyyyy". Codes are derived (never parsed back), and production
// holds zero batches pre-deploy, so the change is data-safe.
export function dateToBatchCode(value: string | null | undefined): string | null {
  const iso = normalizeToIsoDate(value)
  if (!iso) return null
  const [yyyy, mm, dd] = iso.split('-')
  return `${mm}${dd}${yyyy}`
}
