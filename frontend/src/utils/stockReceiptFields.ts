// Receipt facts for a stock-IN, shared by every adjust surface (S4-15/S4-16).
//
// The Sessions list has always had Supplier, Payment and Total cost columns,
// and POST /api/inventory/adjust has always accepted `unitCostUsd`,
// `paymentStatus`, `creditDueDate` and `sessionId` -- FastStockInModal sends
// all four. The Products-section adjust modal and the Stock-changes ledger
// (both of which open StockAdjustModal, which reuses InventoryStockModals'
// form) sent none of them, so a receipt entered from either surface landed in
// the Sessions list with an empty Payment and a "-" Total cost. Nothing was
// missing from the schema; the fields simply never left the browser.
//
// Deliberately pure and React-free so the rule has one implementation both
// surfaces share and can be unit-tested without a DOM. The two rules that
// live here rather than in either modal:
//
//   1. WHAT COUNTS AS A STOCK-IN. An explicit 'add' -- and a 'set' whose new
//      total is above what the branch holds now, because routes/inventory.ts
//      converts exactly that case into an 'add' before it writes. That is why
//      "Set quantity" rows showed no cost (S4-16): they are real receipts
//      server-side, but the form treated 'set' as neither add nor remove and
//      offered no receipt fields at all.
//   2. WHAT GOES ON THE WIRE. Only what the operator actually typed. A blank
//      cost stays blank -- the Sessions list already reports "N line(s) have
//      no receipt-level cost" honestly, which is better than inventing one
//      from the product's stored cost price.

export type StockReceiptDraft = {
  /** Per-unit cost for THIS receipt. '' when the operator left it blank. */
  unit_cost_usd: string | number
  /** The operator's explicit "these goods were free" declaration (N14-D). */
  free_goods?: boolean
  payment_status: string
  credit_due_date: string
}

export type StockReceiptWire = {
  unitCostUsd?: number
  paymentStatus?: 'paid' | 'credit'
  creditDueDate?: string
  sessionId?: number
  freeGoods?: true
}

/**
 * True when this submission puts stock in, so the receipt fields apply.
 * A 'set' is only a receipt when it raises the on-hand figure; a set that
 * lowers it becomes a 'remove' server-side and carries no supplier or cost.
 */
export function isStockInSubmission(type: string, quantity: unknown, currentQuantity: unknown): boolean {
  if (type === 'add') return true
  if (type !== 'set') return false
  const requested = Number(quantity)
  const current = Number(currentQuantity)
  return Number.isFinite(requested) && Number.isFinite(current) && requested > current
}

/**
 * The mirror image: a 'set' whose new total is BELOW what the branch holds.
 * routes/inventory.ts converts exactly that case into a `remove` of the
 * difference, so it takes stock out of real lots -- which is why the adjust
 * form offers the batch picker for it (N14-E) instead of letting the server
 * FIFO-drain whichever lots happen to be oldest.
 */
export function isSetDownSubmission(type: string, quantity: unknown, currentQuantity: unknown): boolean {
  if (type !== 'set') return false
  const requested = Number(quantity)
  const current = Number(currentQuantity)
  return Number.isFinite(requested) && Number.isFinite(current) && requested < current
}

export type StockAdjustBatchContext = {
  type: string
  quantity: unknown
  currentQuantity: unknown
  /** An unlocked add always creates a fresh lot server-side, so it has no picker. */
  unlockPricing: boolean
  branchId: unknown
  /** Whatever the form is holding: '' (nothing picked), 'new', or a lot id. */
  batchId: string | number
}

/**
 * Whether the adjust form's batch picker is ON SCREEN for this submission.
 *
 * One rule, three consumers: InventoryStockModals renders by it, and
 * Inventory.tsx and StockAdjustModal.tsx build their wire by it. They used to
 * derive it separately -- the modal from the live form, the two submitters
 * from `batch_id !== ''` alone -- so a lot id chosen while the picker was
 * showing rode along after the picker had gone: raise a set-DOWN into a
 * set-UP and the receipt silently topped up, and inherited the supplier of,
 * a lot the operator had picked to REMOVE from. A hidden picker chose nothing.
 */
export function isBatchPickerVisible(ctx: StockAdjustBatchContext): boolean {
  if (ctx.unlockPricing) return false
  if (!(Number(ctx.branchId) > 0)) return false
  if (ctx.type === 'add' || ctx.type === 'remove') return true
  return isSetDownSubmission(ctx.type, ctx.quantity, ctx.currentQuantity)
}

/**
 * The batch half of an /api/inventory/adjust body: the lot id that may ride
 * the wire, and whether the SUPPLIER half of the receipt gate is deferred to
 * the server for it.
 *
 * `lotAttributionDeferred` is true only for an existing lot picked by a
 * VISIBLE picker: an attributed lot keeps its first supplier server-side, so
 * the picker blanks the supplier field and shows the locked name instead, and
 * routes/inventory.ts reads the lot's own attribution before deciding. It is
 * never true for a stale id, which would defer the supplier question to a lot
 * this submission never named.
 */
export function stockAdjustBatchWire(ctx: StockAdjustBatchContext): {
  batchId?: string | number
  lotAttributionDeferred: boolean
} {
  if (!isBatchPickerVisible(ctx)) return { lotAttributionDeferred: false }
  const chosen = String(ctx.batchId ?? '')
  if (chosen === '') return { lotAttributionDeferred: false }
  return { batchId: ctx.batchId, lotAttributionDeferred: chosen !== 'new' }
}

/**
 * N14-D on the BULK surface. BulkAddStockModal applies one action to many
 * products and can see none of their branch figures, so it cannot tell which
 * rows of a 'set' raise stock -- and a set that raises stock is a receipt the
 * Worker gates exactly like an add. Offering the receipt fields for 'add'
 * only left a bulk 'set' with no supplier and no cost to send, so every
 * raising row came back 400 with nothing on screen to fix.
 *
 * So 'add' and 'set' both state the receipt facts and 'remove' states none.
 * Over-stating on a set that turns out to lower every row costs nothing --
 * routes/inventory.ts ignores a receipt cost on the remove it becomes -- and
 * it is the only alternative to inventing the answer for the rows that rise.
 */
export function bulkActionCanReceive(action: string): boolean {
  return action === 'add' || action === 'set'
}

export type BulkStockReceiptDraft = {
  unitCost: string | number
  freeGoods: boolean
  supplierId: number | null
  supplierName: string
  receivedDate: string
}

export type BulkStockReceiptWire = {
  unitCostUsd?: number
  freeGoods?: true
  supplierId?: number
  supplierName?: string
  receivedDate?: string
}

/** The receipt half of one bulk row's payload; empty for an action that removes. */
export function bulkStockReceiptWire(action: string, draft: BulkStockReceiptDraft): BulkStockReceiptWire {
  if (!bulkActionCanReceive(action)) return {}
  const wire: BulkStockReceiptWire = {}
  const typedCost = String(draft.unitCost ?? '').trim()
  const cost = typedCost === '' ? Number.NaN : Number(typedCost)
  if (Number.isFinite(cost) && cost >= 0) wire.unitCostUsd = cost
  // Only ever sent as `true`: the flag is a claim the operator made, and an
  // explicit `false` would read as a claim they did not make.
  if (draft.freeGoods) wire.freeGoods = true
  if (draft.supplierId != null) wire.supplierId = draft.supplierId
  const supplierName = String(draft.supplierName || '').trim()
  if (supplierName) wire.supplierName = supplierName
  const receivedDate = String(draft.receivedDate || '').trim()
  if (receivedDate) wire.receivedDate = receivedDate
  return wire
}

/**
 * True when the operator chose "On credit" but left the due date empty.
 * routes/inventory.ts refuses that combination with a 400, so the surfaces
 * check it before submitting and say so in their own words.
 */
export function isStockReceiptCreditIncomplete(draft: StockReceiptDraft): boolean {
  return draft.payment_status === 'credit' && String(draft.credit_due_date || '').trim() === ''
}

/**
 * The receipt half of an /api/inventory/adjust body. Returns an empty object
 * for anything that is not a stock-in, so a caller can spread it
 * unconditionally and a remove never carries a lingering cost or due date.
 *
 * `sessionId` is what groups several lines typed in one sitting into ONE row
 * in the Sessions list: the route stores it as the movement's `reference_id`,
 * which is the grouping key stockInSessionsQuery.ts prefers. Without it those
 * movements fall back to the legacy key (created_at + user + branch +
 * supplier), which splits one receipt across seconds. Mint it once per modal
 * opening, exactly as FastStockInModal does.
 */
export function stockReceiptWire(
  draft: StockReceiptDraft,
  sessionId: number | null,
  isStockIn: boolean,
): StockReceiptWire {
  if (!isStockIn) return {}
  const wire: StockReceiptWire = {}
  const typedCost = String(draft.unit_cost_usd ?? '').trim()
  const cost = typedCost === '' ? Number.NaN : Number(typedCost)
  if (Number.isFinite(cost) && cost >= 0) wire.unitCostUsd = cost
  if (draft.payment_status === 'credit' || draft.payment_status === 'paid') {
    wire.paymentStatus = draft.payment_status
    if (draft.payment_status === 'credit') {
      const due = String(draft.credit_due_date || '').trim()
      if (due) wire.creditDueDate = due
    }
  }
  if (Number.isSafeInteger(Number(sessionId)) && Number(sessionId) > 0) wire.sessionId = Number(sessionId)
  // Only ever sent as `true`: the flag is a claim the operator made, and an
  // explicit `false` on the wire would read as a claim they did not make.
  if (draft.free_goods) wire.freeGoods = true
  return wire
}

// ---------------------------------------------------------------------------
// N14-D: what a stock-IN must say about itself before it may be submitted.
//
// The browser-side mirror of cloudflare/src/lib/stockReceiptGate.ts. The rule
// is enforced on the server -- this copy exists so the operator is told at the
// field rather than by a 400 after the round trip. The two implementations are
// held together by the shared case table in
// cloudflare/scripts/fixtures/stock-receipt-gate-cases.json: tests/
// stockReceiptFields.test.ts runs every case through this one and
// cloudflare/scripts/test-stock-receipt-gate-pure.cjs runs the same cases
// through the other, and both assert the same codes. Change one side alone and
// both suites go red.
//
// Codes, not sentences: the sentence differs per language here and is English
// on the server, but the verdict must not.
// ---------------------------------------------------------------------------

export type StockReceiptGateCode =
  | 'supplier_required'
  | 'cost_required'
  | 'cost_negative'
  | 'free_goods_required'

export const STOCK_RECEIPT_GATE_CODES: readonly StockReceiptGateCode[] = [
  'supplier_required',
  'cost_required',
  'cost_negative',
  'free_goods_required',
]

/** The pack key each refusal is shown with. Both packs carry all four. */
export const STOCK_RECEIPT_GATE_KEYS: Record<StockReceiptGateCode, string> = {
  supplier_required: 'stock_receipt_supplier_required',
  cost_required: 'stock_receipt_cost_required',
  cost_negative: 'stock_receipt_cost_negative',
  free_goods_required: 'stock_receipt_free_goods_required',
}

export type StockReceiptGateInput = {
  isStockIn: boolean
  supplierName?: string | null
  /** The supplier the target lot already carries (first attribution sticks). */
  lotSupplierName?: string | null
  /** "Not visible here -- let the server decide": defers only the supplier half. */
  lotAttributionDeferred?: boolean
  unitCostUsd?: number | string | null
  freeGoods?: boolean | null
  attribution?: string | null
}

/** '' when the receipt may be submitted, otherwise the reason it may not. */
export function stockReceiptGateCode(input: StockReceiptGateInput): '' | StockReceiptGateCode {
  if (!input.isStockIn) return ''
  if (input.attribution === 'correction') return ''
  if (!String(input.supplierName ?? '').trim() && !String(input.lotSupplierName ?? '').trim() && !input.lotAttributionDeferred) return 'supplier_required'
  const typed = typeof input.unitCostUsd === 'string' ? input.unitCostUsd.trim() : input.unitCostUsd
  if (typed === '' || typed == null) return 'cost_required'
  const cost = Number(typed)
  if (!Number.isFinite(cost)) return 'cost_required'
  if (cost < 0) return 'cost_negative'
  if (cost === 0 && !input.freeGoods) return 'free_goods_required'
  return ''
}

/** English fallbacks for tr(), so a missing pack entry still says something real. */
export const STOCK_RECEIPT_GATE_FALLBACKS: Record<StockReceiptGateCode, string> = {
  supplier_required: 'Choose the supplier these goods came from.',
  cost_required: 'Enter the unit cost you paid. A blank cost is not recorded as zero.',
  cost_negative: 'Unit cost cannot be negative.',
  free_goods_required: 'A $0.00 unit cost needs the Free goods box ticked.',
}
