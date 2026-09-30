import { roundMoney2, roundMoney4, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { NOT_PAID_STATUS, recordedSaleOutstandingUsd, type RecordedSaleMoney } from './saleStatusResolution'
import { RETURN_STATUSES } from './salesStatus'

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
