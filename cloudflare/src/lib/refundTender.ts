// How a customer refund left the shop (owner rulings 29 Sep 2026, migration
// 0234): the currency it was paid in, and the part that lowered a Not Paid
// sale's debt instead of leaving a drawer. Import-free so every report can use it.

export type RefundCurrency = 'USD' | 'KHR'
export const DEFAULT_REFUND_CURRENCY: RefundCurrency = 'USD'
const REFUND_CURRENCIES: readonly RefundCurrency[] = ['USD', 'KHR']

export function parseRefundCurrency(value: unknown): RefundCurrency {
  if (value == null || value === '') return DEFAULT_REFUND_CURRENCY
  const currency = String(value).trim().toUpperCase()
  if (!(REFUND_CURRENCIES as readonly string[]).includes(currency)) throw new Error('Refund currency must be USD or KHR')
  return currency as RefundCurrency
}

// The drawer SQL that reads these columns lives in shiftReconciliation.ts
// (REFUND_DRAWER_USD_SQL / REFUND_DRAWER_KHR_SQL); refundTender() below is its JS reading.

export type RefundTenderRow = {
  total_refund_usd?: unknown
  total_refund_khr?: unknown
  owed_reduction_usd?: unknown
  refund_currency?: unknown
}

export type RefundTender = {
  /** Null for a return recorded before the currency was asked. */
  currency: RefundCurrency | null
  owedReductionUsd: number
  cashUsd: number
  /** Riel handed back; 0 for a dollar refund. */
  rielRefunded: number
}

const finite = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** The JS reading of shiftReconciliation's drawer SQL, for one return row. */
export function refundTender(row: RefundTenderRow): RefundTender {
  const totalUsd = finite(row.total_refund_usd)
  const owedReductionUsd = finite(row.owed_reduction_usd)
  const cashUsd = Math.round((totalUsd - owedReductionUsd) * 10_000) / 10_000
  const currency = row.refund_currency == null ? null : parseRefundCurrency(row.refund_currency)
  const rielRefunded = currency === 'KHR' && totalUsd > 0 ? Math.round(finite(row.total_refund_khr) * cashUsd / totalUsd) : 0
  return { currency, owedReductionUsd, cashUsd, rielRefunded }
}

/**
 * RET-A P2 (verifier N6/N7): the riel figure a refund is recorded with.
 * A riel refund whose lines carry no riel price (a legacy line, or a
 * product-matched line that posted 0) would otherwise record 0 riel and leave
 * BOTH drawers untouched; its riel is taken from the dollars at the return's
 * own rate (the sale's booked rate). Null when that is impossible (no
 * positive rate): the caller refuses with return_refund_khr_unavailable.
 * A dollar refund keeps its recorded riel twin unchanged.
 */
export function refundRielFigure(input: {
  currency: RefundCurrency; refundUsd: number; refundKhr: number; anyLineWithoutRiel: boolean; exchangeRate: unknown
}): number | null {
  if (input.currency !== 'KHR' || !(input.refundUsd > 0)) return input.refundKhr
  if (input.refundKhr > 0 && !input.anyLineWithoutRiel) return input.refundKhr
  const rate = Number(input.exchangeRate)
  if (!(Number.isFinite(rate) && rate > 0)) return null
  return Math.round(input.refundUsd * rate)
}
