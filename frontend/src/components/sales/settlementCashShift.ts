import { cashTakenNow, hasCashAmount, type CashTenderRow } from '../../utils/cashShiftRule.ts'
import { roundMoney2, roundMoney4, subtractMoney4 } from '../../utils/moneyPrecision.ts'
import type { PaymentMethodKindMap } from '../../utils/paymentMethodKind.ts'
import type { SettlementRow } from './saleSettlement.ts'

/** The tender rows a form is adding now: rows the sale already recorded are cash that was taken earlier, not cash taken by this save. */
export function settlementCashRows(rows: readonly SettlementRow[]): Array<CashTenderRow & { amount_usd: number; amount_khr: number }> {
  return rows
    .filter((row) => !row.id.startsWith('recorded-') && row.refundCredit !== true)
    .map((row) => ({ method: row.method, amount_usd: parseFloat(row.usd) || 0, amount_khr: parseFloat(row.khr) || 0 }))
}

/** Does this save take cash into the drawer? A payment correction re-records a tender already taken, so it never does. */
export function settlementTakesCash(rows: readonly SettlementRow[], kinds: PaymentMethodKindMap, paymentCorrection: boolean): boolean {
  return !paymentCorrection && hasCashAmount(cashTakenNow([], settlementCashRows(rows), kinds))
}

/** An exchange hands cash change back whenever it overpays; the take-cash note already covers a form that also takes cash, so only a cash-free form needs the give-back note. */
export function exchangeGiveBackNeedsShift(overpaidUsd: number, rows: readonly SettlementRow[], kinds: PaymentMethodKindMap): boolean {
  return overpaidUsd > 0 && !settlementTakesCash(rows, kinds, false)
}

/**
 * The cash a return hands back: the refund minus the debt it lowers first (owner, 29 Sep 2026; the Worker's refundCashUsd). Only a sale that carries a debt (it
 * reads Not Paid, or an earlier return lowered one) has a debt part: a sale paid at the counter, or imported with no tender, hands all of it back. An
 * unreadable debt counts as none, so the form still shows the note the Worker may enforce.
 */
export function refundCashShareUsd(refundUsd: number, carriesDebt: boolean, owedUsd: number): number {
  const refund = Number.isFinite(refundUsd) && refundUsd > 0 ? roundMoney4(refundUsd) : 0
  if (!carriesDebt || !Number.isFinite(owedUsd) || owedUsd <= 0) return refund
  return subtractMoney4(refund, Math.min(refund, roundMoney2(owedUsd)))
}

/** Save waits while the cash check blocks it: the note beside the rows already says why and how to get through. */
export function cashShiftBlocksSave(gate: { kind: string }): boolean {
  return gate.kind === 'block'
}
