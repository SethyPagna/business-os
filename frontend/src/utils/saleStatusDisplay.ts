// How a sale's status is SHOWN and changed by hand, in the two-status model
// (owner, 20 Oct 2026): sale_status is the payment state only (Completed, Not
// Paid; Cancelled kept) and returns and delivery are TAGS beside it
// (return_state, delivery_pending; migration 0263). Every badge, status label,
// status group and status picker reads a sale through here, never the raw
// column: the Worker stores a POS delivery order as `completed` plus
// delivery_pending 1, and it must read Awaiting Delivery until it is delivered.
//
// The status word is the Worker's saleStatusWord (cloudflare/src/lib/
// salesStatus.ts): the payment state, read as `awaiting_delivery` for a paid
// order not yet delivered. It is request vocabulary too: requesting
// `completed` on an awaiting_delivery sale is the delivery itself
// (requestedSaleState), single and grouped.

import { NOT_PAID_STATUS, saleStoredState } from './saleStatusResolution.ts'

type SaleStatusRow = Parameters<typeof saleStoredState>[0]

/** A return tag, named by its existing status label (status_partial_return / status_returned). */
export type SaleReturnTag = 'partial_return' | 'returned'

export type SaleStatusDisplay = {
  /** completed | awaiting_payment | awaiting_delivery | cancelled. */
  status: string
  returnTag: SaleReturnTag | null
  /** A Not Paid order still waiting for its delivery: the delivery shows beside Not Paid. */
  deliveryTag: boolean
}

export function saleStatusDisplay(sale: SaleStatusRow): SaleStatusDisplay {
  const state = saleStoredState(sale)
  // The delivery queue leaves cancelled sales out (deliveryPendingSaleSql).
  const pending = state.deliveryPending && state.saleStatus !== 'cancelled'
  const status = pending && state.saleStatus === 'completed' ? 'awaiting_delivery' : state.saleStatus
  return {
    status,
    returnTag: state.returnState === 'full' ? 'returned' : state.returnState === 'partial' ? 'partial_return' : null,
    deliveryTag: pending && status === NOT_PAID_STATUS,
  }
}

/** What a badge shows, in order: the status word, then the delivery and return tags beside it. */
export function saleStatusChipWords(sale: SaleStatusRow): string[] {
  const view = saleStatusDisplay(sale)
  return [view.status, ...(view.deliveryTag ? ['awaiting_delivery'] : []), ...(view.returnTag ? [view.returnTag] : [])]
}

/**
 * The status words a group action's From matches for this sale, exactly as the
 * Worker matches its source (lib/saleBulkStatus.ts sourceMatches): the shown
 * word and the payment state under it, so Completed also takes in a paid
 * order awaiting delivery.
 */
export function saleStatusWords(sale: SaleStatusRow): string[] {
  return [...new Set([saleStatusDisplay(sale).status, saleStoredState(sale).saleStatus])]
}

const STATUS_WORDS = ['completed', NOT_PAID_STATUS, 'awaiting_delivery', 'cancelled']

/**
 * The statuses a sale may be given by hand, as the Worker's
 * guardSaleStatusTransition accepts them (lib/saleTransitions.ts). Return
 * words are tags, never destinations. A returned sale that is not Not Paid
 * belongs to the returns flow: only a partial return may still be cancelled,
 * and while its delivery is pending it may still be delivered (Completed). A
 * cancelled sale has its own Un-cancel action.
 */
export function saleStatusDestinations(view: Pick<SaleStatusDisplay, 'status' | 'returnTag'>): string[] {
  if (view.status === 'cancelled') return []
  return STATUS_WORDS.filter((status) => {
    if (status === view.status) return false
    if (!view.returnTag || view.status === NOT_PAID_STATUS) return true
    if (status === 'completed') return view.status === 'awaiting_delivery'
    return status === 'cancelled' && view.returnTag === 'partial_return'
  })
}
