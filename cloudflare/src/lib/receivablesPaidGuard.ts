// P11-12 (Sep 18 2026): the legacy account-receivable report the old system
// exports lists one row per INVOICE LINE, not one row per invoice -- the
// "Taxable Amount"/"VAT Amount" columns are correctly split per line, but the
// "Amount Paid" column repeats the FULL invoice-level payment on every one of
// that invoice's lines. The importer that turns each report row into its own
// customer_receivables row (import-aug31-legacy-reports.mjs,
// import-sep02-legacy-reports.mjs -- one row per report row, never grouped)
// took that "Amount Paid" figure at face value, so a multi-line invoice's
// paid amount landed multiplied by its own line count: 367 imported rows
// across 243 customers ended up with amount_paid_usd an exact integer
// multiple of total_amount_usd (5370 paid as 10740, 780 paid as 4680 = 6x,
// 624 paid as 3744 = 6x) and a NEGATIVE outstanding_balance_usd, even though
// every one of them already carries status='Paid' -- i.e. genuinely settled.
// Production measured -$98,742.52 across those 367 rows (Sep 18 2026).
//
// This guard is the fix for a RE-IMPORT: a row whose own reported "paid" is a
// clean integer multiple (>=2x, penny tolerance) of its own "total" AND whose
// status already says settled is the exact shape of the report's per-line
// repeat-the-invoice-total defect, so paid is clamped back down to total
// (outstanding 0) instead of being trusted. A genuine partial balance
// (paid < total) or an exact single-line match (paid === total) is untouched.
// The already-imported 367 rows are repaired separately by migration 0181,
// which uses the same multiple-of-total detection so both paths agree.

export type ReceivableRawAmounts = {
  totalUsd: number
  paidUsd: number
  status?: string | null
}

export type NormalizedReceivableAmounts = {
  totalUsd: number
  paidUsd: number
  outstandingUsd: number
  /** True when the per-line "Amount Paid" multiplication was detected and clamped. */
  corrected: boolean
}

const round2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100

/** A status string that means "the old system considers this invoice settled". */
export function isSettledReceivableStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === 'paid' || normalized === 'settled' || normalized === 'fully paid'
}

/**
 * Detects the exact-multiple-of-total shape ("Amount Paid" repeating the
 * whole invoice on every one of its N lines) and clamps it. Returns the
 * amounts a customer_receivables row should be written with.
 */
export function normalizeReceivablePaidAmount(row: ReceivableRawAmounts): NormalizedReceivableAmounts {
  const total = round2(row.totalUsd)
  const paid = round2(row.paidUsd)
  if (isSettledReceivableStatus(row.status) && total > 0 && paid > total) {
    const multiple = Math.round(paid / total)
    if (multiple >= 2 && Math.abs(paid - multiple * total) < 0.01) {
      return { totalUsd: total, paidUsd: total, outstandingUsd: 0, corrected: true }
    }
  }
  return { totalUsd: total, paidUsd: paid, outstandingUsd: round2(total - paid), corrected: false }
}
