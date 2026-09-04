// Single source of truth for sales.sale_status lifecycle values, and which
// of them hold stock deducted -- previously defined only in routes/sales.ts
// (POST / and PATCH /:id/status), duplicated here rather than left there so
// lib/importEngine.ts's sales import can validate against and reason about
// the exact same list without either copy drifting from the other.
export const VALID_SALE_STATUSES: string[] = ['completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled', 'partial_return', 'returned']

export type SaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery' | 'cancelled' | 'partial_return' | 'returned'

// S4-3/S4-4: `awaiting_payment` HOLDS stock. The goods are promised to a
// named buyer the moment the order is taken, so they are not available to
// sell to anyone else -- which is what the POS has told the cashier all
// along ("Order placed, payment pending -- stock held", both lang packs).
// Before this, the label said held and the ledger deducted nothing, so the
// same unit could be sold twice.
//
// This set and lib/saleTransitions.ts's heldQuantity() are ONE rule with two
// gates: heldQuantity early-returns for the statuses that hold nothing and
// consults this set for the rest. scripts/test-sale-stock-holding-parity-pure.cjs
// drives every status through both and fails if they ever disagree, so the
// half-applied fix this pairing invites cannot silently reopen.
//
// `cancelled` is the only live status that holds nothing: the sale is off,
// the units are back on the shelf.
export const STOCK_DEDUCTED_STATUSES: ReadonlySet<string> = new Set<string>(['completed', 'awaiting_payment', 'awaiting_delivery'])

// A status that itself represents stock coming back (a return recorded
// directly in this state, as opposed to a live sale later transitioning
// into one via PATCH /:id/status -- see that route's own comment on why
// the transition path skips restoring for these two: a real customer
// return there is handled by routes/returns.ts's own restock, not by the
// status flip itself). Sales import has no such separate "create the
// return" step -- a historical row imported already in one of these
// statuses is the only signal it will ever get, so it restocks directly.
export const RETURN_STATUSES: ReadonlySet<string> = new Set<string>(['returned', 'partial_return'])

export function normalizeSaleStatus(value: unknown): SaleStatus | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return VALID_SALE_STATUSES.includes(normalized) ? (normalized as SaleStatus) : null
}
