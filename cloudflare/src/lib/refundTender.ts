// How a customer refund left the shop (owner rulings 29 Sep 2026, migration
// 0234): the currency it was paid in, and the part that lowered a Not Paid
// sale's debt instead of leaving a drawer. Import-free so every report can use it.

export type RefundCurrency = 'USD' | 'KHR'
export const DEFAULT_REFUND_CURRENCY: RefundCurrency = 'USD'
const REFUND_CURRENCIES: readonly RefundCurrency[] = ['USD', 'KHR']

export function parseRefundCurrency(value: unknown): RefundCurrency {
  if (value == null || value === '') return DEFAULT_REFUND_CURRENCY
  // RET-A P3 (verifier N8): only a text code; ['khr'] or {} is not a currency.
  if (typeof value !== 'string') throw new Error('Refund currency must be USD or KHR')
  const currency = value.trim().toUpperCase()
  if (!(REFUND_CURRENCIES as readonly string[]).includes(currency)) throw new Error('Refund currency must be USD or KHR')
  return currency as RefundCurrency
}

/**
 * RET-A verify R2: the part of a return's refund that paid its replacement
 * sale instead of leaving the till (the replacement's creation snapshot
 * `paid_from_refund`, written only for a replacement that follows the sale's
 * debt). Counted only while that replacement stands. The drawer is unchanged
 * -- it already takes the refund's cash leg out and the replacement's tender
 * in -- these say how much of the cash leg never reached the customer.
 */
export function refundToReplacementSql(returnAlias: string, currency: 'usd' | 'khr'): string {
  return `COALESCE((SELECT CASE WHEN json_valid(rs.creation_snapshot_json)
      THEN json_extract(rs.creation_snapshot_json, '$.paid_from_refund.${currency}') END
    FROM sales rs WHERE rs.id = ${returnAlias}.replacement_sale_id AND rs.source_return_id = ${returnAlias}.id
      AND COALESCE(rs.sale_status, 'completed') <> 'cancelled'), 0)`
}

// The drawer SQL that reads these columns lives in shiftReconciliation.ts
// (REFUND_DRAWER_USD_SQL / REFUND_DRAWER_KHR_SQL); refundTender() below is its JS reading.

export type RefundTenderRow = {
  total_refund_usd?: unknown
  total_refund_khr?: unknown
  owed_reduction_usd?: unknown
  refund_currency?: unknown
}

/**
 * What one recorded customer refund did with the money: the debt it lowered,
 * the part that paid its replacement, and the cash that actually left the
 * till -- in dollars, and in riel for a riel refund (the riel cash leg less the
 * riel that paid the replacement: the drawer's own net). Shared by the
 * Telegram return lines; the frontend detail mirrors it (refundCurrency.ts).
 */
export function refundOutcome(row: RefundTenderRow & { to_replacement_usd?: unknown; to_replacement_khr?: unknown }): {
  currency: RefundCurrency | null; loweredUsd: number; toReplacementUsd: number; toReplacementKhr: number; payoutUsd: number; payoutKhr: number
} {
  const tender = refundTender(row)
  const toReplacementUsd = Math.min(tender.cashUsd, Math.max(0, finite(row.to_replacement_usd)))
  const toReplacementKhr = tender.currency === 'KHR' ? Math.min(tender.rielRefunded, Math.max(0, Math.round(finite(row.to_replacement_khr)))) : 0
  return {
    currency: tender.currency, loweredUsd: tender.owedReductionUsd, toReplacementUsd, toReplacementKhr,
    payoutUsd: Math.round((tender.cashUsd - toReplacementUsd) * 10_000) / 10_000,
    payoutKhr: tender.currency === 'KHR' ? tender.rielRefunded - toReplacementKhr : 0,
  }
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

/**
 * SQLite's ROUND(x) with no digits, as D1 evaluates it: |x| + 0.5 truncated
 * toward zero, sign restored (sqlite3 func.c roundFunc). Math.round differs
 * at a negative half and where the float addition carries
 * (0.49999999999999994 + 0.5 is 1 in doubles), so a JS twin of a SQL ROUND
 * uses this.
 */
export function sqliteRound0(value: number): number {
  if (!Number.isFinite(value)) return value
  const magnitude = Math.abs(value)
  if (!(magnitude < 9_223_372_036_854_775_806)) return value
  const rounded = Math.trunc(magnitude + 0.5)
  return value < 0 ? -rounded : rounded
}

/**
 * RET-A verify R3 (E1): the riel a riel refund's cash leg takes from the
 * drawer, as SQL. ONE expression for the shift drawer
 * (shiftReconciliation.ts REFUND_DRAWER_KHR_SQL, which restates it to keep its
 * module map and is held equal to this by test-return-replacement-tender-pure) and
 * the report kernel. Stored REAL columns, one float subtraction, one
 * multiplication, one division, SQLite's ROUND.
 */
export function refundDrawerKhrSql(alias: string): string {
  return `CASE WHEN ${alias}.refund_currency = 'KHR' AND COALESCE(${alias}.total_refund_usd, 0) > 0
    THEN ROUND(COALESCE(${alias}.total_refund_khr, 0) * (COALESCE(${alias}.total_refund_usd, 0) - COALESCE(${alias}.owed_reduction_usd, 0)) / ${alias}.total_refund_usd) ELSE 0 END`
}

/**
 * refundDrawerKhrSql evaluated in JS over the values the return row stores:
 * the same float operations in the same order and SQLite's rounding, so the
 * screen, the replacement's riel tender and the drawer agree to the riel.
 * (The retired reading rounded the dollar cash to 4 places first; a
 * $1.20 / 4,700-riel line with $0.99 lowered then read 823 against the
 * drawer's 822 -- verify R3 E1.) Currency is the caller's to check.
 */
export function refundDrawerKhr(row: { total_refund_usd?: unknown; total_refund_khr?: unknown; owed_reduction_usd?: unknown }): number {
  const totalUsd = finite(row.total_refund_usd)
  if (!(totalUsd > 0)) return 0
  return sqliteRound0(finite(row.total_refund_khr) * (totalUsd - finite(row.owed_reduction_usd)) / totalUsd)
}

/** The JS reading of shiftReconciliation's drawer SQL, for one return row. */
export function refundTender(row: RefundTenderRow): RefundTender {
  const totalUsd = finite(row.total_refund_usd)
  const owedReductionUsd = finite(row.owed_reduction_usd)
  const cashUsd = Math.round((totalUsd - owedReductionUsd) * 10_000) / 10_000
  const currency = row.refund_currency == null ? null : parseRefundCurrency(row.refund_currency)
  const rielRefunded = currency === 'KHR' ? refundDrawerKhr(row) : 0
  return { currency, owedReductionUsd, cashUsd, rielRefunded }
}

/**
 * The riel of a share of a riel refund: the refund's riel figure in
 * proportion to that share. Used for the PART of the cash leg that pays a
 * replacement; the whole cash leg is refundDrawerKhr (the drawer's own
 * figure), never this.
 */
export function refundCashKhr(refundKhr: number, cashUsd: number, refundUsd: number): number {
  if (!(refundUsd > 0) || !(cashUsd > 0)) return 0
  return Math.round(finite(refundKhr) * cashUsd / refundUsd)
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
