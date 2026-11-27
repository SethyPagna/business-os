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
