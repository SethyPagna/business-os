// Receipt/return-number generation: YYYYMMDD-HHMMSS, optionally prefixed
// (user, Aug 30 2026: "each sales/receipt can do date and time for sales id
// and identification ... yyyymmdd + 24-hour time"; Aug 31: "Receipt no need
// RCP" -- sales receipts mint the BARE timestamp id, empty prefix). Returns
// keep RET-/SRET- so a return number stays distinguishable from the sale
// receipt it references. The compact date form is ONLY for these
// identifiers -- displayed dates stay mm/dd/yyyy 24-hour app-wide
// (frontend/src/utils/formatters.ts).
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
//
// `moment` defaults to now (a live checkout or return). A historical sales
// import passes the sale's OWN moment instead, so an imported receipt gets
// the id the POS would have minted the day it happened rather than the id of
// the day someone happened to run the import.
export async function uniqueBusinessDateTimeNumber(
  prefix: string,
  exists: (candidate: string) => Promise<boolean>,
  moment: Date = new Date(),
): Promise<string> {
  // Empty prefix = the bare timestamp id (sales receipts); no leading dash.
  const stamp = businessDateTimeId(moment)
  const base = prefix ? `${prefix}-${stamp}` : stamp
  let candidate = base
  for (let n = 2; await exists(candidate); n++) {
    if (n > 10) return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    candidate = `${base}-${n}`
  }
  return candidate
}

// ---------------------------------------------------------------------------
// Shape guard for a receipt number that arrives from OUTSIDE this generator.
//
// On 2026-09-02 an out-of-band reconciliation pack (the untracked
// tmp/latest-data-reconcile/zero-error-migration.sql in the main checkout)
// rewrote 15,004 of the 15,005 sales.receipt_number values to the OLD
// SYSTEM's `NNNNNN@YYYY-MM-DD` form -- taking 87 of that week's 88 POS
// receipts with it. The user's rule (Sep 2 2026): "receipt numbers must be
// changed according to our system format, not nnnnn@yyyymmdd; it must be
// yyyymmdd-24hour format". Migration 0107 repairs the stored rows;
// this predicate is the gate that stops the shape coming back through a
// live writer.
//
// Accepted, and ONLY these:
//   20260902-164228        bare sales receipt (the generator's normal output)
//   20260902-164228-2      same-second disambiguation, -2 .. -10
//   20260902-164228-A3F9   pathological-burst random suffix
//   RET-/SRET-/RCP- + any of the above (returns, and historical sales ids
//   minted before the Aug-31 "Receipt no need RCP" change)
//
// Rejected: anything with '@', anything without the date-time core -- an
// invoice counter, a UUID, free text.
export const BUSINESS_RECEIPT_NUMBER_RE = /^(?:RCP-|RET-|SRET-)?\d{8}-\d{6}(?:-[0-9A-Z]{1,4})?$/

export function isBusinessReceiptNumber(value: unknown): boolean {
  return typeof value === 'string' && BUSINESS_RECEIPT_NUMBER_RE.test(value.trim())
}

// What POST /api/sales does with a client-supplied receipt_number.
//
// NORMALISE, never 400. An offline POS sale mints its own receipt id at
// QUEUE time (frontend/src/api/saleWriteTransport.ts) and the customer may
// already hold that printed number, so the value is honored when it is a
// real business id. But a 400 on replay is unrecoverable: failQueuedSale
// only sets retry_at for a *retryable* error, so a non-retryable rejection
// parks the queued sale as `failed` with no retry -- a sale that really
// happened would never reach the server. Dropping a malformed label and
// minting a correct one server-side loses nothing; rejecting loses money.
export function normalizeClientReceiptNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value && isBusinessReceiptNumber(value) ? value : null
}
