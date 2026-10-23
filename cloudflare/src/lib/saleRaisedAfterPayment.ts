// A paid sale whose total is raised after the customer paid (lane 6.0.967).
//
// THE RULE (owner, 23 Oct 2026, with the 21 Oct rulings "Not Paid = amount owed" and "a kept exchange replacement becomes
// Not Paid for the unpaid share"): raising a Completed sale's total above the money taken moves the sale to Not Paid. The money
// already taken stays on the sale as its deposit, so the sale owes exactly the difference; it appears in receivables, in the
// shift's Not Paid line and in the reports' owed figures, and the increase is never counted as cash. Before this rule the tender
// was frozen and the status stayed Completed ("DECISION 3" in saleLineAddition.ts), which left sales that read paid with a
// shortfall (the health check's completed_short).
//
// WHERE IT RUNS: every writer that can raise a sale total goes through ONE seam, the money snapshot the writer persists with
// saleMoneyUpdateStatement (lib/saleLineAddition.ts):
//   POST /api/sales/:id/items                      line_added        (routes/sales.ts)
//   POST /api/sales/:id/amendments                 line_updated / line_quantity_increased / line_replaced (a price or quantity
//                                                  edit), delivery_added, delivery_fee_changed (routes/sales.ts)
//   the 'sale.add_items' undo and redo             replay the snapshots below, so Undo restores the status the sale had and
//                                                  Redo moves it again (lib/undoAppliers.ts)
// Not writers of a total, by construction: the review queue (lib/reviewApply.ts has no sales action; sales:amend is Full only),
// the Sales import (lib/salesImportCommit.ts only INSERTs sales, born with their own tender and status) and the returns exchange
// (a replacement is a NEW sale, born Not Paid when unpaid). scripts/test-sale-raised-after-payment-native.cjs pins each of these.
//
// The status change is recorded IN the snapshots (sale_status, delivery_pending) rather than beside them, so the existing
// undo payloads carry the reversal: a snapshot that has no sale_status (every action recorded before this rule) restores the
// money columns only, exactly as it always did.
import {
  NOT_PAID_STATUS,
  recordedSaleOutstandingUsd,
  saleStoredState,
  type RecordedSaleMoney,
} from './saleStatusResolution'

type MoneyAfter = {
  total_usd?: unknown
  exchange_rate?: unknown
  money_precision_version?: unknown
  calculated_total_usd?: unknown
}

import type { SaleStatusSnapshotFields } from './saleLineAddition'
export type { SaleStatusSnapshotFields }

type SaleStatusRow = RecordedSaleMoney & { sale_status?: unknown; delivery_pending?: unknown; status_before_return?: unknown; return_state?: unknown }

/**
 * The status columns a sale takes when its total becomes `after.total_usd`, or null when nothing moves.
 *
 * It moves only a sale that reads PAID (Completed, with or without the delivery-pending tag, or the retired awaiting_delivery
 * word) whose recorded tender no longer covers the new total by the one coverage rule (recordedSaleOutstandingUsd: short by more
 * than half a cent). A sale that is already Not Paid, cancelled or carrying a return stays as it is, a lower or equal total
 * moves nothing, and money that cannot be read moves nothing (it is not evidence of a debt either).
 */
export function notPaidStatusAfterRaise(sale: SaleStatusRow, after: MoneyAfter): { before: Required<SaleStatusSnapshotFields>; after: Required<SaleStatusSnapshotFields> } | null {
  const state = saleStoredState(sale)
  if (state.saleStatus === NOT_PAID_STATUS || state.saleStatus === 'cancelled' || state.returnState !== null) return null
  let owed: number
  try {
    owed = recordedSaleOutstandingUsd({
      ...sale,
      total_usd: after.total_usd,
      exchange_rate: after.exchange_rate ?? sale.exchange_rate,
      money_precision_version: after.money_precision_version ?? sale.money_precision_version,
      calculated_total_usd: after.calculated_total_usd ?? sale.calculated_total_usd,
    })
  } catch {
    return null
  }
  if (!(owed > 0)) return null
  return {
    before: { sale_status: String(sale.sale_status || 'completed'), delivery_pending: Number(sale.delivery_pending) === 1 ? 1 : 0 },
    // The retired awaiting_delivery word IS the delivery tag, so it is kept as the tag when the payment word moves.
    after: { sale_status: NOT_PAID_STATUS, delivery_pending: state.deliveryPending ? 1 : 0 },
  }
}

/**
 * Stamps the status move into the two snapshots a writer persists (mutating them: they are fresh per-request objects).
 * Returns true when the sale moved to Not Paid.
 */
export function markSaleNotPaidAfterRaise(sale: SaleStatusRow, moneyBefore: object, moneyAfter: object): boolean {
  const move = notPaidStatusAfterRaise(sale, moneyAfter as MoneyAfter)
  if (!move) return false
  Object.assign(moneyBefore, move.before)
  Object.assign(moneyAfter, move.after)
  return true
}
