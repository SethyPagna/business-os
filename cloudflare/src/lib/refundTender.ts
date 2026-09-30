// How a customer refund left the shop (owner rulings 29 Sep 2026, migration
// 0204): the currency it was paid in, and the part that lowered a Not Paid
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

const REFUND_CASH_USD = '(COALESCE(returns.total_refund_usd, 0) - COALESCE(returns.owed_reduction_usd, 0))'

/** Dollars a refund took from the dollar drawer (alias `returns`). */
export const REFUND_DRAWER_USD_SQL = `CASE WHEN returns.refund_currency = 'KHR' THEN 0 ELSE ${REFUND_CASH_USD} END`

/**
 * Riel a refund took from the riel drawer (alias `returns`): its cash share of
 * the return's own riel figure, which is the refund at the sale's booked rate.
 */
export const REFUND_DRAWER_KHR_SQL = `CASE WHEN returns.refund_currency = 'KHR' AND COALESCE(returns.total_refund_usd, 0) > 0
    THEN ROUND(COALESCE(returns.total_refund_khr, 0) * ${REFUND_CASH_USD} / returns.total_refund_usd) ELSE 0 END`

/** A return recorded before 0204 has no currency; its riel figure is only the refund's riel equivalent. */
export const REFUND_BEFORE_CURRENCY_KHR_SQL = 'CASE WHEN returns.refund_currency IS NULL THEN COALESCE(returns.total_refund_khr, 0) ELSE 0 END'

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

/** The JS reading of the SQL above, for one return row. */
export function refundTender(row: RefundTenderRow): RefundTender {
  const totalUsd = finite(row.total_refund_usd)
  const owedReductionUsd = finite(row.owed_reduction_usd)
  const cashUsd = Math.round((totalUsd - owedReductionUsd) * 10_000) / 10_000
  const currency = row.refund_currency == null ? null : parseRefundCurrency(row.refund_currency)
  const rielRefunded = currency === 'KHR' && totalUsd > 0 ? Math.round(finite(row.total_refund_khr) * cashUsd / totalUsd) : 0
  return { currency, owedReductionUsd, cashUsd, rielRefunded }
}
