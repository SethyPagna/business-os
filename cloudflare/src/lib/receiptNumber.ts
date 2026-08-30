// Receipt/return-number generation: PREFIX-YYYYMMDD-HHMMSS (user, Aug 30
// 2026: "each sales/receipt can do date and time for sales id and
// identification ... yyyymmdd + 24-hour time"). The compact date form is
// ONLY for these identifiers -- displayed dates stay mm/dd/yyyy 24-hour
// app-wide (frontend/src/utils/formatters.ts).
//
// The encoded wall clock is Asia/Phnom_Penh (UTC+07:00, no DST), the app's
// canonical business timezone -- the same fixed-offset convention as
// importEngine.ts's parseSalesImportDateTime -- so a receipt minted at
// 14:35 in the shop reads "-1435xx" regardless of where the Worker runs.
// Hand-synced client copy: frontend/src/utils/timestampId.ts (Intl-based,
// same output); keep the two in step.

const BUSINESS_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

export function businessDateTimeId(now: Date = new Date()): string {
  const local = new Date(now.getTime() + BUSINESS_UTC_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}`
    + `-${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}`
}

// Same-second writes are real on a busy POS: the first sale keeps the bare
// timestamp id, later ones probe and take -2, -3, ... The probe cap guards
// against a pathological burst; past it a short random suffix keeps the id
// unique rather than looping. Two concurrent Workers can still in
// principle race between probe and INSERT (receipt_number carries no
// UNIQUE constraint) -- accepted: client_request_id dedupe already guards
// the harmful double-insert case, this only disambiguates the label.
export async function uniqueBusinessDateTimeNumber(
  prefix: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = `${prefix}-${businessDateTimeId()}`
  let candidate = base
  for (let n = 2; await exists(candidate); n++) {
    if (n > 10) return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    candidate = `${base}-${n}`
  }
  return candidate
}
