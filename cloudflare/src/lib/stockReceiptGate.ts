// What a stock-IN must say about itself before the ledger will accept it.
//
// N14-D, owner ruling: supplier name AND unit cost are REQUIRED on every
// stock-in -- an 'add', and a 'set' that raises the on-hand figure, because
// routes/inventory.ts converts exactly that case into an 'add' before it
// writes. They are NOT required on a remove (a set that lowers stock included:
// that becomes a remove, and a removal has no supplier to name).
//
// The point is not validation for its own sake. Before this gate, three
// different call sites answered "cost?" with a number the operator never
// typed:
//
//   BulkAddStockModal.tsx     unitCostUsd: product.purchase_price_usd || 0
//   productWriteHelpers.ts    unitCostUsd: options.unitCostUsd ?? (…|| 0)
//   lib/stockSession.ts       expanded('unit_cost_usd') ?? product?.cost_price_usd
//
// Each of those writes a receipt cost that looks entered and is invented, and
// the `|| 0` pair silently records "these goods were free" -- the one claim
// that must never be made by default. So a blank cost is REFUSED here, and
// $0.00 is accepted only when the operator explicitly declares free goods.
// That declaration is stamped into the movement reason by the callers, so the
// ledger keeps the words rather than just a zero.
//
// Deliberately dependency-free: routes/inventory.ts and lib/stockSession.ts
// share this one implementation, and frontend/src/utils/stockReceiptFields.ts
// mirrors it for the pre-submit check. The two sides are held together by the
// shared case table in scripts/fixtures/stock-receipt-gate-cases.json, which
// both test suites run.

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

/**
 * `correction` is the ONLY exemption, and it is explicit on the wire.
 *
 * Undo, redo-of-an-undo and snapshot restores put stock back to a figure the
 * ledger already held; they are not new receipts and have no supplier to name.
 * Anything that is not the literal string 'correction' -- absent, empty, a
 * typo, a hand-written request trying its luck -- is a receipt and is gated.
 */
export type StockReceiptAttribution = 'receipt' | 'correction'

export type StockReceiptGateInput = {
  isStockIn: boolean
  supplierName?: string | null
  /**
   * The supplier the TARGET lot already carries, when this receipt tops up an
   * existing lot rather than creating one. First attribution sticks (the
   * writers only ever COALESCE-fill a blank), so the pickers deliberately send
   * NO supplier for an already-attributed lot -- ReceiveBatchModal and the
   * adjust form both clear the field and show the locked name instead. That
   * receipt is attributed; demanding the operator retype what cannot be
   * changed would refuse a perfectly complete stock-in.
   */
  lotSupplierName?: string | null
  /**
   * "The target lot's attribution is not visible here -- let the server decide."
   * Some surfaces (a per-row lot picker) know a row tops up an EXISTING lot
   * but not whether that lot is already attributed. Guessing
   * either way is wrong: refuse and a complete receipt is blocked in the
   * browser; assume attributed and the surface is laxer than the wire. This
   * defers only the supplier half; the cost is still this receipt's own and is
   * still required.
   */
  lotAttributionDeferred?: boolean
  unitCostUsd?: number | string | null
  freeGoods?: boolean | null
  attribution?: string | null
}

/**
 * True when this movement puts stock in, so the receipt facts apply.
 * `currentQuantity` is the branch's live on-hand figure; a 'set' is only a
 * receipt when the requested total is above it.
 */
export function isStockReceiptType(type: string, quantity: unknown, currentQuantity: unknown): boolean {
  if (type === 'add') return true
  if (type !== 'set') return false
  const requested = Number(quantity)
  const current = Number(currentQuantity)
  return Number.isFinite(requested) && Number.isFinite(current) && requested > current
}

/** '' when the receipt may proceed, otherwise the reason it may not. */
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

const MESSAGES: Record<StockReceiptGateCode, string> = {
  supplier_required: 'A stock-in must name the supplier the goods came from',
  cost_required: 'A stock-in must carry its unit cost -- enter the cost you paid, or mark the goods as free',
  cost_negative: 'Unit cost cannot be negative',
  free_goods_required: 'A $0.00 unit cost is only accepted for goods received free -- tick "Free goods" to record that',
}

/** The English sentence for a refusal; null for a pass. */
export function stockReceiptGateMessage(code: '' | StockReceiptGateCode): string | null {
  return code ? MESSAGES[code] : null
}

/**
 * The words that go into the movement reason when a $0.00 receipt is accepted,
 * so the ledger records the CLAIM and not merely the number. Appended by the
 * writers next to their own reason text.
 */
export const FREE_GOODS_REASON_NOTE = 'Free goods (no cost)'

/**
 * Fold the receipt's declarations into the movement reason so the ledger keeps
 * the words. Used for the free-goods declaration: a bare 0 in unit_cost_usd is
 * indistinguishable from the invented zeros this gate exists to stop, so the
 * accepted $0.00 receipt says so in the reason column too.
 */
export function appendReceiptNotes(reason: string | null, notes: readonly string[]): string | null {
  if (!notes.length) return reason
  const base = String(reason || '').trim()
  return base ? `${base} (${notes.join('; ')})` : notes.join('; ')
}
