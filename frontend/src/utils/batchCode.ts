// Hand-ported mirror of cloudflare/src/lib/batchCode.ts -- no shared
// package across the Worker/frontend boundary, kept in sync by hand (same
// pattern as lib/portalAi.ts's isDiscountActive). Used to show the
// operator what batch code a chosen received date will produce BEFORE
// they submit (ReceiveBatchModal, ManageBatchesModal) -- the backend
// always recomputes and stores the authoritative value itself rather than
// trusting this preview.

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

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

  // Trailing 24-hour time tolerated and ignored -- mirrors the cloudflare
  // copy (Part 388: mm/dd/yyyy datetimes appear in migration files too).
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

// MMDDYYYY -- e.g. "08222026" for 08/22/2026, "08022026" for 08/2/2026.
// Always read as mm/dd/yyyy; null if the input isn't a real date. Format
// history (mirrors cloudflare/src/lib/batchCode.ts): numeric ->
// month-abbreviation (Aug 24 direction) -> numeric again (Aug 28 Part 388
// direction, "translate mm/dd/yyyy into mmddyyyy").
export function dateToBatchCode(value: string | null | undefined): string | null {
  const iso = normalizeToIsoDate(value)
  if (!iso) return null
  const [yyyy, mm, dd] = iso.split('-')
  return `${mm}${dd}${yyyy}`
}
