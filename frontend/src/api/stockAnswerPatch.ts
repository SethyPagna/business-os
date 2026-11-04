// A stock write's answer (or its refusal) already says what the figures are. A Products row is patched from it, so no page re-reads stock to find out
// (Inventory replan 2.7: "Inventory never re-reads or verifies stock; it reuses the Products data").
//
//   before / after   what POST /api/inventory/adjust {setScope} and PATCH /api/batches/:id/branches/:branchId answer (lib/stockLotAdjustment.ts Snapshot)
//   current          what the same writers add to a stale-quantity 409 stock_conflict (S2): the figures at the moment of the refusal
//
// The patch is on the row's own figures, not on a delta from the answer: the branch entry takes the new number and stock_quantity moves by exactly what that
// entry moved, so stock_quantity stays the sum of the branch entries even when the row on screen was already stale. Lots (the S3 `lots` token) are patched the
// same way. A row is returned unchanged (the same object) when nothing in it moves, so a store can skip the re-render.

type Id = number | string
type Quantity = number | string | null | undefined
type BranchEntry = { branch_id?: Id | null; quantity?: Quantity; [key: string]: unknown }
type LotEntry = { id?: Id | null; branches?: BranchEntry[]; [key: string]: unknown }
export type StockPatchable = { id?: Id | null; stock_quantity?: Quantity; branch_stock?: BranchEntry[]; lots?: LotEntry[]; [key: string]: unknown }

export type StockFigures = { lotQuantity: number; branchQuantity: number }
/** The body of a 200 from the lot Set writers. `before` and `after` carry more fields; only these are read. */
export type StockWriteAnswer = { productId: number; branchId: number; batchId: number; before?: StockFigures; after: StockFigures }
/** The body of a 409 stock_conflict from the same writers. */
export type StockConflictAnswer = { productId: number; branchId: number; batchId: number; current: StockFigures }

const num = (value: Quantity): number => { const n = Number(value); return Number.isFinite(n) ? n : 0 }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const same = (a: Id | null | undefined, b: Id): boolean => a != null && String(a) === String(b)

function applyFigures<T extends StockPatchable>(product: T, productId: number, branchId: number, batchId: number, figures: StockFigures): T {
  if (!product || !same(product.id, productId) || !finite(figures.branchQuantity) || !finite(figures.lotQuantity)) return product
  let next: StockPatchable = product
  const entries = Array.isArray(product.branch_stock) ? product.branch_stock : null
  const at = entries ? entries.findIndex((entry) => same(entry.branch_id, branchId)) : -1
  if (entries && at >= 0 && num(entries[at].quantity) !== figures.branchQuantity) {
    const moved = figures.branchQuantity - num(entries[at].quantity)
    next = { ...next, branch_stock: entries.map((entry, index) => (index === at ? { ...entry, quantity: figures.branchQuantity } : entry)),
      ...(product.stock_quantity === undefined || product.stock_quantity === null ? {} : { stock_quantity: num(product.stock_quantity) + moved }) }
  }
  const lots = Array.isArray(product.lots) ? product.lots : null
  const lotAt = lots ? lots.findIndex((lot) => same(lot.id, batchId)) : -1
  if (lots && lotAt >= 0) {
    const lot = lots[lotAt]
    const rows = Array.isArray(lot.branches) ? lot.branches : []
    const row = rows.findIndex((entry) => same(entry.branch_id, branchId))
    const patched = row >= 0
      ? (num(rows[row].quantity) === figures.lotQuantity ? rows : rows.map((entry, index) => (index === row ? { ...entry, quantity: figures.lotQuantity } : entry)))
      : (figures.lotQuantity > 0 ? [...rows, { branch_id: branchId, quantity: figures.lotQuantity }] : rows)
    if (patched !== rows) next = { ...next, lots: lots.map((entry, index) => (index === lotAt ? { ...entry, branches: patched } : entry)) }
  }
  return next as T
}

/** The row after a successful lot or branch Set: the branch entry, stock_quantity and the lot's branch quantity take the answer's `after`. */
export function patchProductFromStockAnswer<T extends StockPatchable>(product: T, answer: StockWriteAnswer): T {
  return applyFigures(product, answer.productId, answer.branchId, answer.batchId, answer.after)
}

/** The row after a refused stale Set: it shows the figures the writer found, so the person can confirm the Set or recount. */
export function patchProductFromStockConflict<T extends StockPatchable>(product: T, conflict: StockConflictAnswer): T {
  return applyFigures(product, conflict.productId, conflict.branchId, conflict.batchId, conflict.current)
}

/** Reads `current` out of an error the transport threw for a 409 stock_conflict (error.body or the error itself), or null when it carries none (an older server). */
export function stockConflictFigures(error: unknown): StockFigures | null {
  const candidates = [error, (error as { body?: unknown } | null)?.body, (error as { data?: unknown } | null)?.data]
  for (const candidate of candidates) {
    const current = (candidate as { current?: Partial<StockFigures> } | null)?.current
    if (current && finite(current.lotQuantity) && finite(current.branchQuantity)) return { lotQuantity: current.lotQuantity, branchQuantity: current.branchQuantity }
  }
  return null
}
