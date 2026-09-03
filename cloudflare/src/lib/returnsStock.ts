// K2 (Part 410, 11.12/11.13): the kernel for the NEW return stock semantics
// -- the three-way per-item chooser and Replace. The locked design notes
// this implements (progress.md "Returns/replacements" + "Damaged stock"):
//
//   - Returned stock is classified per item as no restock, restock as
//     sellable, or restock as DAMAGED.
//   - Damaged stock lives as traceable lots tied to the exact return,
//     branch and batch (damaged_stock_lots, migration 0074) -- never as a
//     duplicate "damaged" product row and never inside sellable
//     branch_stock. POS's damage option (11.9) draws quantity_remaining
//     down later; a lot that has been drawn from blocks un-doing the
//     return edit that created it.
//   - Replace may hand out any catalog product. routes/returns.ts records the
//     hand-out as a linked sale/receipt as well as this stock movement.
//   - A return is ONLY a return: the customer gets back exactly what the
//     original sale line charged. A replacement is ONLY a sale: priced,
//     tendered and recorded like any other. Neither nets against the other,
//     so there is no exchange arithmetic, no price-difference settlement
//     and no permission gate on a value gap. (Returns rows written before
//     this carry settlement_mode/settlement_diff_* from migration 0074;
//     those columns are read-only history now -- ReturnDetailModal still
//     renders them for old rows, nothing writes them again.)
//
// The pre-existing sellable-restock path (receiveBatchStock/plain bump)
// stays in routes/returns.ts unchanged; this file owns only what 0074
// added, so scripts/test-returns-replace-damaged-pure.cjs can drive the
// real logic against a real sqlite database.
import type { D1Compat } from './db'
import { removeStockFromBatch } from './productBatches'

export type ReturnStockAction = 'none' | 'restock' | 'damaged'

// Movement-ledger types for the product's information trail (11.13's "adds
// a damage entry in the product's information" is exactly these rows).
export const DAMAGE_IN_MOVEMENT = 'damage_in'
export const DAMAGE_REVERSAL_MOVEMENT = 'damage_reversal'
export const REPLACEMENT_OUT_MOVEMENT = 'replacement_out'

// The historical wire shape (return_to_stock boolean, default TRUE) keeps
// its exact meaning when stock_action is absent -- older clients mid-deploy
// and every existing test payload behave as before.
export function normalizeStockAction(input: { stock_action?: unknown; return_to_stock?: unknown }): ReturnStockAction {
  const explicit = String(input.stock_action ?? '').trim().toLowerCase()
  if (explicit === 'none' || explicit === 'restock' || explicit === 'damaged') return explicit
  return input.return_to_stock !== false ? 'restock' : 'none'
}

// What one returned line refunds. The ONLY authority is the price the
// ORIGINAL sale line charged -- not the product's current selling price, and
// not whatever the client posted. A manual return (no sale line on file) has
// no such authority and falls back to the posted price, which is the only
// number that exists for it.
export function resolveRefundUnitPrice(input: {
  saleLine?: { applied_price_usd?: number | null; applied_price_khr?: number | null } | null
  postedUsd: number
  postedKhr: number
}): { unitUsd: number; unitKhr: number; fromSaleLine: boolean } {
  const line = input.saleLine
  if (line && (line.applied_price_usd != null || line.applied_price_khr != null)) {
    return {
      unitUsd: Number(line.applied_price_usd) || 0,
      unitKhr: Number(line.applied_price_khr) || 0,
      fromSaleLine: true,
    }
  }
  return { unitUsd: Number(input.postedUsd) || 0, unitKhr: Number(input.postedKhr) || 0, fromSaleLine: false }
}

export type ReturnLotSplit = { batchId: number; quantity: number }

export class ReturnLotRequiredError extends Error {
  code = 'return_lot_required'
  constructor(productName: string, quantity: number) {
    super(`Pick the lot ${quantity} unit(s) of "${productName}" go back into. This product's stock is tracked by lot, and the original sale line does not say which one -- a return never lands on unspecified stock.`)
    this.name = 'ReturnLotRequiredError'
  }
}

// Which lot(s) a returned line restocks into, decided BEFORE any write.
//
// An explicit operator pick is authoritative for the WHOLE line -- the person
// looked at the shelf and said "these units belong in that lot", and letting
// it merge with a derived split would put units somewhere nobody chose. With
// no pick, the sale itself answers: the lots the line actually drew from
// (last drawn first, mirroring the cancel path), or the single lot recorded
// on the line.
//
// A lot-tracked product with neither a pick nor a sale-side answer is
// REFUSED, never silently bumped onto the unspecified branch_stock
// aggregate. A product that has never used lot tracking (`lotTracked` false)
// keeps the plain aggregate bump, which for it is the only truthful
// destination.
export function planReturnLot(input: {
  allocations: Array<{ batch_id: number; outstanding: number }>
  saleLineBatchId: number | null
  operatorBatchId: number | null
  quantity: number
  lotTracked: boolean
}): { splits: ReturnLotSplit[]; plainQuantity: number; requiresLotPick: boolean } {
  const quantity = Math.max(0, Number(input.quantity) || 0)
  if (input.operatorBatchId != null) {
    return { splits: [{ batchId: Number(input.operatorBatchId), quantity }], plainQuantity: 0, requiresLotPick: false }
  }
  const splits: ReturnLotSplit[] = []
  let remaining = quantity
  for (let index = input.allocations.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const alloc = input.allocations[index]
    const give = Math.min(Math.max(0, Number(alloc.outstanding) || 0), remaining)
    if (give <= 0) continue
    splits.push({ batchId: Number(alloc.batch_id), quantity: give })
    remaining -= give
  }
  if (remaining > 0 && input.saleLineBatchId != null) {
    splits.push({ batchId: Number(input.saleLineBatchId), quantity: remaining })
    remaining = 0
  }
  return {
    splits,
    plainQuantity: input.lotTracked ? 0 : remaining,
    requiresLotPick: remaining > 0 && input.lotTracked,
  }
}

export async function createDamagedLot(db: D1Compat, input: {
  productId: number
  productName: string | null
  branchId: number | null
  batchId: number | null
  returnId: number | string
  quantity: number
  reason: string | null
  userId: number | string | null
  userName: string | null
}): Promise<void> {
  await db.prepare(`
    INSERT INTO damaged_stock_lots (product_id, product_name, branch_id, batch_id, return_id, quantity, quantity_remaining, reason, created_by_user_id, created_by_user_name)
    VALUES (@product_id, @product_name, @branch_id, @batch_id, @return_id, @quantity, @quantity, @reason, @user_id, @user_name)
  `).run({
    product_id: input.productId,
    product_name: input.productName,
    branch_id: input.branchId,
    batch_id: input.batchId,
    return_id: input.returnId,
    quantity: input.quantity,
    reason: input.reason,
    user_id: input.userId,
    user_name: input.userName,
  })
}

export class ConsumedDamagedStockError extends Error {
  constructor(productName: string, consumed: number) {
    super(`${consumed} unit(s) of "${productName}" from this return's damaged stock ${consumed === 1 ? 'has' : 'have'} already been drawn (sold or written off) -- the return can no longer be edited. Record a separate adjustment instead.`)
    this.name = 'ConsumedDamagedStockError'
  }
}

// Editing a return re-applies its stock from scratch (see PATCH /:id in
// routes/returns.ts), so its damaged lots must come back out first. A lot
// that POS already drew from cannot be silently un-damaged -- that stock
// left the building -- so consumption blocks the edit outright.
export async function reverseDamagedLots(
  db: D1Compat,
  returnId: number | string,
): Promise<Array<{ product_id: number; product_name: string | null; branch_id: number | null; batch_id: number | null; quantity: number; reason: string | null; created_by_user_id: number | string | null; created_by_user_name: string | null }>> {
  const lots = await db.prepare(`
    SELECT id, product_id, product_name, branch_id, batch_id, quantity, quantity_remaining, reason, created_by_user_id, created_by_user_name
    FROM damaged_stock_lots WHERE return_id = @return_id
  `).all<{ id: number; product_id: number; product_name: string | null; branch_id: number | null; batch_id: number | null; quantity: number; quantity_remaining: number; reason: string | null; created_by_user_id: number | string | null; created_by_user_name: string | null }>({ return_id: returnId })
  if (!lots.length) return []
  for (const lot of lots) {
    if (Number(lot.quantity_remaining) < Number(lot.quantity)) {
      throw new ConsumedDamagedStockError(String(lot.product_name || `product #${lot.product_id}`), Number(lot.quantity) - Number(lot.quantity_remaining))
    }
  }
  await db.prepare('DELETE FROM damaged_stock_lots WHERE return_id = @return_id').run({ return_id: returnId })
  // batch_id = the original sale lot the damaged units belonged to (0084
  // reads it for the reversal movement's attribution). reason/created_by
  // ride along so a failed EDIT can re-create these rows faithfully -- the
  // validation above guarantees quantity_remaining === quantity, so a
  // re-creation via createDamagedLot loses nothing.
  return lots.map((lot) => ({ product_id: lot.product_id, product_name: lot.product_name, branch_id: lot.branch_id, batch_id: lot.batch_id ?? null, quantity: Number(lot.quantity), reason: lot.reason ?? null, created_by_user_id: lot.created_by_user_id ?? null, created_by_user_name: lot.created_by_user_name ?? null }))
}

export class InsufficientReplacementStockError extends Error {
  constructor(productName: string, requested: number, available: number) {
    super(`Insufficient stock to hand out ${requested} of ${productName} as a replacement: ${available} available in the selected branch`)
    this.name = 'InsufficientReplacementStockError'
  }
}

// Drain the stock a replacement line hands to the customer -- the POS way:
// an explicit batch drains that exact lot (validated by
// removeStockFromBatch, which also keeps branch_stock/stock_quantity in
// step); no batch means a validated plain branch_stock decrement. Writes
// its own movement row; the caller re-derives products.stock_quantity for
// the plain path (same division of labor as the existing restock path).
export async function applyReplacementStock(db: D1Compat, input: {
  productId: number
  productName: string
  branchId: number
  batchId: number | null
  quantity: number
  unitCostUsd: number
  unitCostKhr: number
  returnId: number | string
  returnNumber: string | null
  userId: number | string | null
  userName: string | null
}): Promise<{ usedBatch: boolean }> {
  let usedBatch = false
  if (input.batchId != null) {
    // Throws InsufficientBatchStockError/Error before writing anything if
    // the lot can't cover it -- deliberately NOT caught here: the person
    // picked this exact lot, so a shortfall is an answer, not a fallback.
    await removeStockFromBatch(db, {
      batchId: input.batchId,
      productId: input.productId,
      branchId: input.branchId,
      quantity: input.quantity,
    })
    usedBatch = true
  } else {
    const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @product_id AND branch_id = @branch_id')
      .get<{ quantity: number }>({ product_id: input.productId, branch_id: input.branchId })
    const available = Number(stockRow?.quantity) || 0
    if (input.quantity > available) {
      throw new InsufficientReplacementStockError(input.productName, input.quantity, available)
    }
    // Strict (unclamped) subtraction (Part-77, oversell-clamp audit): the
    // check above already validated availability, so the only way this goes
    // negative is a concurrent consumer winning the read-write race -- then
    // 0058's CHECK(quantity >= 0) rejects the write (the movement below
    // never runs) instead of the old MAX(0, ...) clamp handing the customer
    // units the branch no longer had.
    await db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity
    `).run({ product_id: input.productId, branch_id: input.branchId, quantity: input.quantity })
  }
  await db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
    VALUES (@product_id, @product_name, @branch_id, '${REPLACEMENT_OUT_MOVEMENT}', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)
  `).run({
    product_id: input.productId,
    product_name: input.productName,
    branch_id: input.branchId,
    quantity: -input.quantity,
    unit_cost_usd: input.unitCostUsd,
    unit_cost_khr: input.unitCostKhr,
    reason: `Replacement for return ${input.returnNumber ? `#${input.returnNumber}` : `id ${input.returnId}`}`,
    reference_id: input.returnId,
    user_id: input.userId,
    user_name: input.userName,
    // 0084: an explicit lot pick drained exactly that lot. The plain path is
    // reached only by a product that has never used lot tracking (the modal
    // requires a lot wherever lots exist), so a NULL here means "this
    // product has no lots", never "we did not bother to look".
    batch_id: input.batchId ?? null,
  })
  return { usedBatch }
}

export const DAMAGE_OUT_MOVEMENT = 'damage_out'

export class DamagedLotShortfallError extends Error {
  available: number
  constructor(productName: string, requested: number, available: number) {
    super(`Only ${available} left in the damaged lot for ${productName} (requested ${requested})`)
    this.name = 'DamagedLotShortfallError'
    this.available = available
  }
}

// d1compat's run() reports changes as {changes} (typed) or {meta:{changes}}
// (what D1 actually returns) -- read both, same lesson renameCascade.ts
// already encodes.
function changesOf(result: unknown): number {
  const record = result as { changes?: number; meta?: { changes?: number } } | null
  return Number(record?.changes ?? record?.meta?.changes ?? 0)
}

// 11.9: POS's damage source -- draw units out of ONE damaged lot. The
// UPDATE's own WHERE clause is the race guard (damaged_stock_lots has no
// CHECK constraint): a concurrent draw that empties the lot makes this
// statement match zero rows, and the zero-changes read throws WITHOUT
// having written anything. quantity_remaining only ever shrinks here.
export async function consumeDamagedLot(db: D1Compat, input: {
  lotId: number
  productId: number
  quantity: number
}): Promise<{ productName: string | null; branchId: number | null; returnId: number | null }> {
  const lot = await db.prepare(`
    SELECT id, product_id, product_name, branch_id, return_id, quantity_remaining
    FROM damaged_stock_lots WHERE id = @id
  `).get<{ id: number; product_id: number; product_name: string | null; branch_id: number | null; return_id: number | null; quantity_remaining: number }>({ id: input.lotId })
  if (!lot || Number(lot.product_id) !== Number(input.productId)) {
    throw new Error('Selected damaged lot does not belong to this product')
  }
  const result = await db.prepare(`
    UPDATE damaged_stock_lots
    SET quantity_remaining = quantity_remaining - @quantity, updated_at = datetime('now')
    WHERE id = @id AND quantity_remaining >= @quantity
  `).run({ id: input.lotId, quantity: input.quantity })
  if (!changesOf(result)) {
    throw new DamagedLotShortfallError(String(lot.product_name || `product #${input.productId}`), input.quantity, Number(lot.quantity_remaining) || 0)
  }
  return { productName: lot.product_name, branchId: lot.branch_id, returnId: lot.return_id }
}

// The reverse (a cancelled sale hands its units back to the lot; also the
// compensation path when a checkout fails after its draw). Clamped to the
// lot's original quantity -- restoring can never mint damaged stock.
export async function restoreDamagedLot(db: D1Compat, input: {
  lotId: number
  quantity: number
}): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE damaged_stock_lots
    SET quantity_remaining = MIN(quantity, quantity_remaining + @quantity), updated_at = datetime('now')
    WHERE id = @id
  `).run({ id: input.lotId, quantity: input.quantity })
  return changesOf(result) > 0
}

// Open damaged lots for one product (optionally one branch) -- the product
// detail's damage entries (D3) and, next part, POS's damage source option.
// Never exposes cost; damaged lots carry none by design.
export async function listOpenDamagedLots(db: D1Compat, input: {
  productId: number
  branchId?: number | null
}): Promise<Array<{ id: number; branch_id: number | null; batch_id: number | null; return_id: number | null; quantity_remaining: number; reason: string | null; created_at: string | null }>> {
  const branchClause = input.branchId != null ? 'AND branch_id = @branch_id' : ''
  return await db.prepare(`
    SELECT id, branch_id, batch_id, return_id, quantity_remaining, reason, created_at
    FROM damaged_stock_lots
    WHERE product_id = @product_id AND quantity_remaining > 0 ${branchClause}
    ORDER BY created_at ASC, id ASC
  `).all({ product_id: input.productId, branch_id: input.branchId ?? null })
}
