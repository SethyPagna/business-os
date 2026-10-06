import { roundMoney2, roundMoney4, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { NOT_PAID_STATUS, recordedSaleOutstandingUsd, type RecordedSaleMoney } from './saleStatusResolution'
import { RETURN_STATUSES } from './salesStatus'
import { refundCashKhr, type RefundCurrency } from './refundTender'

export type ReturnRefundSplit = { owedReductionUsd: number; cashUsd: number }

/** The sale's active customer returns before the one being recorded. */
export type PriorReturnMoney = {
  refundUsd: number
  owedReductionUsd: number
  /** Any return on the sale, cancelled or not, ever lowered its debt. */
  loweredDebt: boolean
}

export type ReturnDebtSale = RecordedSaleMoney & { sale_status?: unknown; status_before_return?: unknown }

export class ReturnRefundSplitError extends Error {
  constructor(readonly code: 'customer_return_refund_exceeds_paid' | 'customer_return_owed_unreadable') {
    super(code)
  }
}

const statusWord = (value: unknown): string => String(value || 'completed').trim().toLowerCase()

/**
 * Whether the sale has a debt a return can lower. Only a sale that was sold
 * Not Paid has one: a Completed sale is paid whatever tender it recorded
 * (imported sales carry none), so its returns are always cash.
 */
export function saleCarriesDebt(sale: ReturnDebtSale, loweredDebt: boolean): boolean {
  const status = statusWord(sale.sale_status)
  if (status === NOT_PAID_STATUS) return true
  if (RETURN_STATUSES.has(status) && statusWord(sale.status_before_return) === NOT_PAID_STATUS) return true
  return loweredDebt
}

function owedUsd(sale: ReturnDebtSale, owedReductionUsd: number): number {
  try {
    return recordedSaleOutstandingUsd({ ...sale, return_owed_reduction_usd: owedReductionUsd })
  } catch {
    throw new ReturnRefundSplitError('customer_return_owed_unreadable')
  }
}

function paymentCovers(sale: ReturnDebtSale, cashUsd: number): boolean {
  try {
    return recordedSaleOutstandingUsd({ ...sale, total_usd: cashUsd, return_owed_reduction_usd: 0 }) === 0
  } catch {
    throw new ReturnRefundSplitError('customer_return_owed_unreadable')
  }
}

/**
 * Owner rule 29 Sep 2026: a return first lowers what the customer still owes;
 * only the rest is refunded in cash, and the cash refunded on a sale never
 * exceeds what the customer paid for it.
 */
export function splitReturnRefund(input: { sale: ReturnDebtSale; prior: PriorReturnMoney; refundUsd: number }): ReturnRefundSplit {
  const refundUsd = roundMoney4(input.refundUsd)
  if (!saleCarriesDebt(input.sale, input.prior.loweredDebt)) return { owedReductionUsd: 0, cashUsd: refundUsd }
  const owedBefore = roundMoney2(owedUsd(input.sale, input.prior.owedReductionUsd))
  const owedReductionUsd = Math.min(refundUsd, owedBefore)
  const cashUsd = subtractMoney4(refundUsd, owedReductionUsd)
  const priorCashUsd = subtractMoney4(input.prior.refundUsd, input.prior.owedReductionUsd)
  if (cashUsd > 0 && !paymentCovers(input.sale, sumMoney4([priorCashUsd, cashUsd]))) {
    throw new ReturnRefundSplitError('customer_return_refund_exceeds_paid')
  }
  return { owedReductionUsd, cashUsd }
}

/** What a stored sale row still owes (saleStatusResolution's reading), for callers that import only this module. */
export function saleRowOwedUsd(sale: RecordedSaleMoney): number {
  return recordedSaleOutstandingUsd(sale)
}

export type ReplacementPaymentSplit = {
  /** The original sale carries a debt, so the replacement follows its payment state. */
  followsDebt: boolean
  /** Part of the replacement paid with the cash the return would otherwise hand back. */
  paidFromRefundUsd: number
  /** Part of the replacement added to what the customer owes (a Not Paid replacement sale). */
  owedUsd: number
  /** Cash still handed back after the replacement is paid from the refund. */
  payoutUsd: number
}

/**
 * RET-A P1 (verifier, 6 Oct 2026): an exchange on a sale that carries a debt.
 * The return lowers the debt first (splitReturnRefund); the replacement then
 * follows the original sale's payment state: it is paid only from the cash
 * part of the refund, and the rest of its value is owed -- so the drawer
 * never expects money that did not arrive, and the customer owes exactly the
 * goods they hold less what they paid.
 *   Not Paid $10, $4 back, $4 out:   drawer 0, owes $6 + $4 = $10
 *   $10 with $7 paid, $4 back ($3 lowers the debt, $1 cash), $4 out:
 *                                     $1 pays the replacement, owes $3, drawer 0
 *   ... $0.50 out:                    $0.50 paid from the refund, $0.50 paid out
 * A sale with no debt keeps the counter rule: the refund is paid out in full
 * and the customer pays the replacement like any sale.
 */
export function splitReplacementPayment(input: { carriesDebt: boolean; cashUsd: number; replacementUsd: number }): ReplacementPaymentSplit {
  const cashUsd = roundMoney4(Math.max(0, input.cashUsd))
  const replacementUsd = roundMoney4(Math.max(0, input.replacementUsd))
  if (!input.carriesDebt) return { followsDebt: false, paidFromRefundUsd: 0, owedUsd: 0, payoutUsd: cashUsd }
  const paidFromRefundUsd = Math.min(cashUsd, replacementUsd)
  return {
    followsDebt: true,
    paidFromRefundUsd,
    owedUsd: subtractMoney4(replacementUsd, paidFromRefundUsd),
    payoutUsd: subtractMoney4(cashUsd, paidFromRefundUsd),
  }
}

export type ReplacementTender = ReplacementPaymentSplit & {
  /** Riel of the refund's cash part that pays the replacement (a riel refund that follows a debt); 0 otherwise. */
  paidFromRefundKhr: number
  /**
   * Riel the till hands back: the refund's riel cash leg less the riel that
   * paid the replacement. Exactly the drawer's net (REFUND_DRAWER_KHR_SQL out,
   * the replacement's riel tender in), so the screen and the drawer agree to
   * the riel. 0 for a dollar refund.
   */
  payoutKhr: number
  /**
   * The rate the replacement's tender is recorded at. A riel-funded
   * replacement is settled in the basis the riel was paid in -- the refund's
   * own riel per dollar (its lines' riel prices) -- so the riel that funded
   * paidFromRefundUsd covers exactly that many dollars and leaves no debt
   * below the rounding unit (verify R2 X6-X8: legacy/v0 riel prices are not
   * USD x the sale rate). Every other replacement keeps the sale's rate.
   */
  replacementRate: number
}

/**
 * RET-A verify R2 (X6-X8, riel drift): the ONE settlement of a replacement
 * from a refund, shared by the Return screen preview (POST
 * /api/returns/split-preview) and the recorded return (POST /api/returns), so
 * what the screen says is what is recorded and what the drawer pays out.
 */
export function settleReplacementTender(input: {
  carriesDebt: boolean; cashUsd: number; replacementUsd: number
  currency: RefundCurrency; refundUsd: number; refundKhr: number; saleRate: number
}): ReplacementTender {
  const split = splitReplacementPayment(input)
  if (input.currency !== 'KHR') return { ...split, paidFromRefundKhr: 0, payoutKhr: 0, replacementRate: input.saleRate }
  const cashKhr = refundCashKhr(input.refundKhr, roundMoney4(Math.max(0, input.cashUsd)), input.refundUsd)
  const paidFromRefundKhr = split.paidFromRefundUsd > 0 && !(split.payoutUsd > 0)
    ? cashKhr : refundCashKhr(input.refundKhr, split.paidFromRefundUsd, input.refundUsd)
  return {
    ...split, paidFromRefundKhr, payoutKhr: Math.max(0, cashKhr - paidFromRefundKhr),
    replacementRate: paidFromRefundKhr > 0 && split.paidFromRefundUsd > 0 ? paidFromRefundKhr / split.paidFromRefundUsd : input.saleRate,
  }
}

/**
 * The sale's status once its active returns are counted: Not Paid while the
 * customer still owes, otherwise what the returned quantities make it.
 */
export function saleStatusWithReturns(input: {
  sale: ReturnDebtSale
  activeOwedReductionUsd: number
  loweredDebt: boolean
  quantityStatus: string
}): string {
  if (!saleCarriesDebt(input.sale, input.loweredDebt)) return input.quantityStatus
  return owedUsd(input.sale, input.activeOwedReductionUsd) > 0 ? NOT_PAID_STATUS : input.quantityStatus
}

const ACTIVE_RETURN = "COALESCE(returns.status,'completed')<>'cancelled'"

/** The sale's customer returns as splitReturnRefund reads them; @excludeReturnId leaves out the return being edited. */
export const PRIOR_RETURN_MONEY_SQL = `SELECT
    COALESCE(SUM(CASE WHEN ${ACTIVE_RETURN} THEN total_refund_usd ELSE 0 END), 0) AS refund_usd,
    COALESCE(SUM(CASE WHEN ${ACTIVE_RETURN} THEN owed_reduction_usd ELSE 0 END), 0) AS owed_reduction_usd,
    COUNT(CASE WHEN ${ACTIVE_RETURN} THEN 1 END) AS active_count,
    COALESCE(MAX(CASE WHEN owed_reduction_usd > 0 THEN 1 ELSE 0 END), 0) AS lowered_debt
  FROM returns
  WHERE returns.sale_id=@saleId AND COALESCE(returns.return_scope,'customer')='customer'
    AND (@excludeReturnId IS NULL OR returns.id<>@excludeReturnId)`

export type PriorReturnMoneyRow = { refund_usd: unknown; owed_reduction_usd: unknown; active_count: unknown; lowered_debt: unknown }

export function priorReturnMoney(row: PriorReturnMoneyRow | null | undefined): PriorReturnMoney {
  return {
    refundUsd: roundMoney4(Number(row?.refund_usd) || 0),
    owedReductionUsd: roundMoney4(Number(row?.owed_reduction_usd) || 0),
    loweredDebt: Number(row?.lowered_debt) === 1,
  }
}

/** A sale row's `return_owed_reduction_usd`, the field both saleStatusResolution mirrors subtract from what it owes. */
export function returnOwedReductionSql(saleAlias: string): string {
  return `(SELECT COALESCE(SUM(owed_reduction_usd), 0) FROM returns
      WHERE returns.sale_id=${saleAlias}.id AND ${ACTIVE_RETURN} AND COALESCE(returns.return_scope,'customer')='customer') AS return_owed_reduction_usd`
}
