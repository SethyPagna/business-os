import { cashTakenNow, hasCashAmount, type CashTenderRow } from '../../utils/cashShiftRule.ts'
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

/** Save waits while the cash check blocks it: the note beside the rows already says why and how to get through. */
export function cashShiftBlocksSave(gate: { kind: string }): boolean {
  return gate.kind === 'block'
}
