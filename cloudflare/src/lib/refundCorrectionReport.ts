// The Reports "returns" block honouring return_refund_corrections (migration 0275), the same way the shift drawer does
// (lib/shiftReconciliation.ts refundCorrectionsSql).
//
// The block groups the return rows by the date the return was made, and those rows hold the CURRENT refund. A correction
// made later therefore needs two adjustments: take its difference back out of the period the return was made in, and put
// it into the period it counts in (counts_at). Both come from refundCorrectionsSql() as signed rows, so a report over any
// period and the shift drawers of that period agree, and summed over all periods the report equals the current rows.
// Every figure of the block moves the same way: the refund in each currency, the debt lowered, and the drawer cash.
// The number of returns never moves: a correction changes a return, it does not add one.
import { refundCorrectionsSql } from './shiftReconciliation'

export type ReturnReportMoney = {
  refund_usd: number; refund_khr: number; owed_reduction_usd: number; cash_refund_usd: number; cash_refund_khr: number
}
const adjustmentColumns = `COALESCE(SUM(x.refund_usd), 0) AS refund_usd, COALESCE(SUM(x.refund_khr), 0) AS refund_khr,
  COALESCE(SUM(x.owed_usd), 0) AS owed_reduction_usd, COALESCE(SUM(x.cash_usd), 0) AS cash_refund_usd, COALESCE(SUM(x.cash_khr), 0) AS cash_refund_khr`

/** One row of signed adjustments over `rangeSql` (a clause on alias `x`, from reportRecordRange('returns', 'x', filters)). */
export function refundCorrectionTotalsSql(rangeSql: string): string {
  return `SELECT ${adjustmentColumns} FROM ${refundCorrectionsSql()} x WHERE ${rangeSql}`
}

/** The same adjustments grouped by the return's reason, spelled the way the report spells it. */
export function refundCorrectionByReasonSql(rangeSql: string): string {
  return `SELECT COALESCE(NULLIF(TRIM(rr.reason), ''), '') AS reason, ${adjustmentColumns}
    FROM ${refundCorrectionsSql()} x JOIN returns rr ON rr.id = x.return_id WHERE ${rangeSql} GROUP BY 1`
}

const finite = (value: unknown): number => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0 }
const round2 = (value: number) => Math.round(value * 100) / 100

/** A report row plus its adjustments; money rounded the way the report rounds it (cents, whole riel). */
export function applyRefundCorrections<T extends Record<string, unknown>>(base: T | null | undefined, adjustment: Record<string, unknown> | null | undefined): T & ReturnReportMoney {
  const row = (base ?? {}) as Record<string, unknown>
  const add = (key: keyof ReturnReportMoney) => finite(row[key]) + finite(adjustment?.[key])
  return {
    ...row,
    refund_usd: round2(add('refund_usd')), refund_khr: Math.round(add('refund_khr')), owed_reduction_usd: round2(add('owed_reduction_usd')),
    cash_refund_usd: round2(add('cash_refund_usd')), cash_refund_khr: Math.round(add('cash_refund_khr')),
  } as T & ReturnReportMoney
}

/**
 * The by-reason rows with each reason's adjustments applied. A reason that only has adjustments in this period (its
 * returns were made in another one) gets a row with a count of 0, so the by-reason rows keep adding up to the totals.
 * Ordered and cut the way the report's own query is: refund descending, then riel, then count, at most `limit`.
 */
export function mergeReasonAdjustments(rows: Record<string, unknown>[], adjustments: Record<string, unknown>[], limit = 50): Record<string, unknown>[] {
  const byReason = new Map<string, Record<string, unknown>>()
  for (const row of rows) byReason.set(String(row.reason ?? ''), { ...row, reason: String(row.reason ?? '') })
  for (const adjustment of adjustments) {
    const reason = String(adjustment.reason ?? '')
    byReason.set(reason, applyRefundCorrections(byReason.get(reason) ?? { reason, count: 0 }, adjustment))
  }
  return [...byReason.values()]
    .map((row) => applyRefundCorrections(row, null))
    .sort((a, b) => b.refund_usd - a.refund_usd || b.refund_khr - a.refund_khr || finite(b.count) - finite(a.count))
    .slice(0, limit)
}
