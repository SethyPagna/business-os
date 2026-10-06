// A sale shows TWO separate facts, never one merged word (owner, 6 Oct 2026:
// "this sale would have a status of not paid or completed. and the tag.").
//
//   * the STATUS CHIP is the payment state: Completed or Not Paid (a delivery
//     still to drive out keeps its own chip, a cancelled sale stays Cancelled);
//   * the TAG is everything else that is true of the sale -- today only the
//     return state, later managed tags such as Awaiting Delivery. A tag is
//     drawn as a corner ribbon over the card (components/sales/SaleTagRibbon).
//
// DISPLAY ONLY. The stored `sale_status` still reads partial_return/returned
// and every server rule (stock, revenue, filters, the status workflow) is
// untouched. What was true BEFORE a return moved the sale is the server's own
// `status_before_return` (cloudflare returns.ts, migration 0125); the server's
// reports already read the pair the same way (salesAnalytics.ts
// reportingSaleStatusExpr: a returned sale that was Not Paid is still Not Paid).
//
// THE UNKNOWN CASE IS NOT "completed". A response that does not carry the
// column at all (a surface whose query predates it) must not be read as "was
// completed" -- that would print Completed on a debt. Only a PRESENT-but-empty
// column means completed, which is exactly the Worker's own
// COALESCE(status_before_return, 'completed'). When the column is absent the
// chip keeps the stored status, as it did before this model existed.
import { NOT_PAID_STATUS, PAID_SALE_STATUSES } from './saleStatusResolution.ts'

export type SaleTagSource = {
  sale_status?: unknown
  status?: unknown
  status_before_return?: unknown
}

/** The stored statuses a return moves a sale into. */
export const RETURN_STATUSES: readonly string[] = ['partial_return', 'returned']

export type SaleTagId = 'partial_return' | 'returned'

export type SaleTag = {
  id: SaleTagId
  /** The status key whose pack text names this tag (status_partial_return ...). */
  labelKey: string
  fallback: string
  /** The short ribbon wording key and its English fallback. */
  ribbonKey: string
  ribbonFallback: string
  /** Tailwind background for the ribbon band. */
  tone: string
}

const RETURN_TAGS: Record<SaleTagId, SaleTag> = {
  partial_return: {
    id: 'partial_return',
    labelKey: 'status_partial_return',
    fallback: 'Partial Return',
    ribbonKey: 'sale_tag_partial_return',
    ribbonFallback: 'Partial',
    tone: 'bg-orange-600',
  },
  returned: {
    id: 'returned',
    labelKey: 'status_returned',
    fallback: 'Returned',
    ribbonKey: 'sale_tag_returned',
    ribbonFallback: 'Returned',
    tone: 'bg-purple-600',
  },
}

/** Blank and NULL are completed, as everywhere else (statsFormulas saleStatus). */
function storedStatus(sale: SaleTagSource | null | undefined): string {
  const raw = sale?.sale_status ?? sale?.status
  return String(raw ?? '').trim().toLowerCase() || 'completed'
}

export function isReturnStatus(status: unknown): boolean {
  return RETURN_STATUSES.includes(String(status ?? '').trim().toLowerCase())
}

/**
 * The status the CHIP shows. Anything but a returned sale is its own status.
 * A returned sale shows the state it was in before the return: Not Paid stays
 * Not Paid, a paid delivery still waiting stays that, everything else reads
 * Completed.
 */
export function saleChipStatus(sale: SaleTagSource | null | undefined): string {
  const status = storedStatus(sale)
  if (!isReturnStatus(status)) return status
  if (!sale || !('status_before_return' in sale) || sale.status_before_return === undefined) return status
  const before = String(sale.status_before_return ?? '').trim().toLowerCase()
  return before === NOT_PAID_STATUS || PAID_SALE_STATUSES.includes(before) ? before : 'completed'
}

/** Every tag the sale carries, primary first. Return state is the only one so far. */
export function saleTags(sale: SaleTagSource | null | undefined): SaleTag[] {
  const status = storedStatus(sale)
  return status === 'partial_return' || status === 'returned' ? [RETURN_TAGS[status]] : []
}

/**
 * True when a return lowered what the customer still owed: the sale was Not
 * Paid before it was returned. Needs the column itself -- absent means unknown.
 */
export function saleReturnLoweredDebt(sale: SaleTagSource | null | undefined): boolean {
  if (!sale || !isReturnStatus(storedStatus(sale))) return false
  return String(sale.status_before_return ?? '').trim().toLowerCase() === NOT_PAID_STATUS
}
