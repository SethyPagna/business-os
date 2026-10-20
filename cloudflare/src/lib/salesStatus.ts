import type { SaleStoredState } from './saleStatusResolution'

// Single source of truth for sales.sale_status lifecycle values, and which
// of them hold stock deducted -- previously defined only in routes/sales.ts
// (POST / and PATCH /:id/status), duplicated here rather than left there so
// lib/importEngine.ts's sales import can validate against and reason about
// the exact same list without either copy drifting from the other.
export const VALID_SALE_STATUSES: string[] = ['completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled', 'partial_return', 'returned']

export type SaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery' | 'cancelled' | 'partial_return' | 'returned'

// The statuses a NEW sale may be born with through POST /sales (the POS and
// its offline replays). Cancelled and the two return statuses are what
// happens to a sale afterwards -- PATCH /:id/status records the cancel reason
// and releases the stock, routes/returns.ts writes the return rows -- so a
// sale created directly in one of them carries the status without the record
// behind it. Sales import validates against VALID_SALE_STATUSES instead: a
// historical row's status is the only signal it will ever get.
export const CREATABLE_SALE_STATUSES: readonly string[] = ['completed', 'awaiting_payment', 'awaiting_delivery']

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

// Owner, 20 Oct 2026: sale_status is the payment state only. These three are
// the only values a writer may store; partial_return, returned and
// awaiting_delivery are read (rows before the held normalization, imports,
// request vocabulary) and become the return_state / delivery_pending tags
// (migration 0263) on every write -- lib/saleStatusResolution.ts saleStoredState.
export const WRITTEN_SALE_STATUSES: ReadonlySet<string> = new Set<string>(['completed', 'awaiting_payment', 'cancelled'])

// SQL twin of lib/saleStatusResolution.ts saleReadsNotPaid for a sales row
// aliased `alias`. Two equality terms, so idx_sales_status_created_pg serves both.
export function notPaidSaleSql(alias: string): string {
  return `(${alias}.sale_status = 'awaiting_payment' OR (${alias}.sale_status IN ('partial_return', 'returned') AND ${alias}.status_before_return = 'awaiting_payment'))`
}

// SQL twin of saleStoredState(...).saleStatus === 'completed' (a NULL or empty status reads completed).
export function paidSaleSql(alias: string): string {
  return `(${alias}.sale_status IN ('completed', 'awaiting_delivery') OR ${alias}.sale_status IS NULL OR ${alias}.sale_status = ''
    OR (${alias}.sale_status IN ('partial_return', 'returned') AND COALESCE(${alias}.status_before_return, '') <> 'awaiting_payment'))`
}

// SQL twin of saleStoredState(...).returnState === state. The retired label outranks the column.
export function returnStateSaleSql(alias: string, state: 'partial' | 'full'): string {
  return `(${alias}.sale_status = '${state === 'full' ? 'returned' : 'partial_return'}'
    OR (${alias}.return_state = '${state}' AND COALESCE(${alias}.sale_status, '') NOT IN ('partial_return', 'returned')))`
}

// The delivery queue: saleStoredState(...).deliveryPending on a sale that is not cancelled.
export function deliveryPendingSaleSql(alias: string): string {
  return `((${alias}.delivery_pending = 1 AND COALESCE(${alias}.sale_status, '') <> 'cancelled') OR ${alias}.sale_status = 'awaiting_delivery'
    OR (${alias}.sale_status IN ('partial_return', 'returned') AND ${alias}.status_before_return = 'awaiting_delivery'))`
}

// A status filter value (request vocabulary, retired values included) as a
// clause on the two-status model. Unknown values match the raw column.
export function saleStatusFilterSql(alias: string, status: string, param: string): string {
  if (status === 'awaiting_payment') return notPaidSaleSql(alias)
  if (status === 'completed') return paidSaleSql(alias)
  if (status === 'awaiting_delivery') return deliveryPendingSaleSql(alias)
  if (status === 'partial_return') return returnStateSaleSql(alias, 'partial')
  if (status === 'returned') return returnStateSaleSql(alias, 'full')
  return `${alias}.sale_status = @${param}`
}

// Does sale @saleId carry a return, by evidence rather than its status word:
// a live return line, a unit an import recorded as returned, or a return tag
// (or retired return label). Imported returned sales have no returns rows, so
// once their label becomes a tag only this keeps them out of amendments.
export const SALE_RETURN_EVIDENCE_SQL = `SELECT 1 AS found WHERE EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE r.sale_id = @saleId AND COALESCE(r.status, 'completed') != 'cancelled')
  OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id = @saleId AND COALESCE(si.returned_quantity, 0) > 0)
  OR EXISTS(SELECT 1 FROM sales s WHERE s.id = @saleId AND (s.return_state IS NOT NULL OR s.sale_status IN ('partial_return', 'returned')))`

// The columns every status writer sets, from saleStoredState / requestedSaleState.
export const SALE_STATE_SET_SQL = 'sale_status = @sale_status, return_state = @return_state, delivery_pending = @delivery_pending'
export function saleStateParams(state: SaleStoredState): { sale_status: string; return_state: string | null; delivery_pending: 0 | 1 } {
  if (!WRITTEN_SALE_STATUSES.has(state.saleStatus)) throw new Error(`sale_status_retired:${state.saleStatus}`)
  return { sale_status: state.saleStatus, return_state: state.returnState, delivery_pending: state.deliveryPending ? 1 : 0 }
}

/**
 * What a requested status (request vocabulary) leaves on a sale now in
 * `current`. Payment moves never touch a tag. `awaiting_delivery` is a paid
 * sale with the delivery-pending tag; `completed` on a sale that is already
 * paid and pending delivery is the delivery itself. Return statuses are not
 * requestable (lib/saleTransitions.ts guardSaleStatusTransition).
 */
export function requestedSaleState(current: SaleStoredState, requested: string): SaleStoredState {
  if (requested === 'awaiting_delivery') return { ...current, saleStatus: 'completed', deliveryPending: true }
  if (requested === 'completed' && current.saleStatus === 'completed' && current.deliveryPending) return { ...current, deliveryPending: false }
  return { ...current, saleStatus: requested }
}

// The request-vocabulary word for a state's payment and delivery, for Records,
// audit details and messages that already label these words. The return tag is shown on its own.
export function saleStatusWord(state: SaleStoredState): string {
  return state.saleStatus === 'completed' && state.deliveryPending ? 'awaiting_delivery' : state.saleStatus
}

export function sameSaleState(a: SaleStoredState, b: SaleStoredState): boolean {
  return a.saleStatus === b.saleStatus && a.returnState === b.returnState && a.deliveryPending === b.deliveryPending
}

export function normalizeSaleStatus(value: unknown): SaleStatus | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return VALID_SALE_STATUSES.includes(normalized) ? (normalized as SaleStatus) : null
}
