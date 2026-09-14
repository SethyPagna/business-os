// Part 553: reverting a Stock Change ledger row. A revert is a COMPENSATING
// counter-movement -- it posts the opposite stock effect and records a new
// movement row (reason "Revert of #N", reference_id "revert:N"); nothing is
// ever deleted, so the ledger stays append-only and the revert itself shows
// up in the history. The stock aggregate (products.stock_quantity +
// branch_stock) and the batch ledger are both moved through the SAME proven
// primitives the /adjust route uses, so a revert can never drift the
// aggregate from the lots.
//
// Split into a pure decision (planMovementRevert) and the db mutation
// (applyMovementRevert) so both can be driven directly by
// test-stock-revert-pure.cjs against the real migration chain -- the same
// zero-magic pattern as stockLedgerQuery.ts.
import type { D1Compat } from './db'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'
import {
  receiveBatchStock, removeStockFromBatch, removeStockAcrossBatches, InsufficientBatchStockError,
  planUnreceiveBatchStock, restoreBatchStockStatements, type StockWriteStatement,
} from './productBatches'
import { multiplyMoney4 } from './moneyPrecision'

const OUT_TYPES = new Set<string>(LEDGER_OUT_TYPES)

// Only pure, standalone stock adjustments may be reverted from the ledger.
// Anything tied to another record -- a sale, a return, a branch transfer, a
// row move, a damaged/replacement line off a return -- must be reversed from
// THAT record, or the stock would desync from the sale/return/transfer it
// belongs to. An allowlist (not a blocklist) so an unknown/future type is
// non-revertible by default rather than silently mutating stock.
export const REVERTIBLE_MOVEMENT_TYPES = new Set<string>([
  'add', 'remove', 'set', 'adjustment', 'in', 'out', 'csv_import',
])

export type RevertMovementRow = {
  id: number
  product_id: number
  product_name: string | null
  branch_id: number | null
  branch_name: string | null
  movement_type: string
  quantity: number
  unit_cost_usd: number | null
  unit_cost_khr: number | null
  total_cost_usd: number | null
  total_cost_khr: number | null
  reason: string | null
  reference_id: string | null
  batch_id: number | null
}

export type RevertActor = { userId: number | string | null; userName: string | null }

export type RevertPlan =
  | { revertible: true; revertType: 'add' | 'remove'; magnitude: number }
  | { revertible: false; reason: 'no_stock' | 'not_revertible' }

export type RevertResult =
  | { ok: true; revertType: 'add' | 'remove'; quantity: number; usedBatchId: number | null; movementId: number }
  | { ok: false; status: 400 | 409; error: string }

// Pure: given a movement, decide whether and how it reverts. The revert
// direction is the OPPOSITE of the original's net effect -- an inflow is
// undone by removing, an outflow by adding -- keyed off movement_type via the
// SAME LEDGER_OUT_TYPES list the ledger buckets by, never the stored quantity
// sign (which some writers store as a magnitude, some signed).
export function planMovementRevert(m: Pick<RevertMovementRow, 'movement_type' | 'quantity'>): RevertPlan {
  const magnitude = Math.abs(Number(m.quantity) || 0)
  if (!(magnitude > 0)) return { revertible: false, reason: 'no_stock' }
  if (!REVERTIBLE_MOVEMENT_TYPES.has(m.movement_type)) return { revertible: false, reason: 'not_revertible' }
  const revertType: 'add' | 'remove' = OUT_TYPES.has(m.movement_type) ? 'add' : 'remove'
  return { revertible: true, revertType, magnitude }
}

async function branchQty(db: D1Compat, productId: number, branchId: number): Promise<number> {
  const row = await db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = @branchId')
    .get<{ quantity: number }>({ productId, branchId })
  return row ? Number(row.quantity) || 0 : 0
}

// The aggregate-only move (branch_stock + products.stock_quantity) -- used for
// a batch-less movement and for any FIFO remainder the lots can't cover.
//
// branch_stock carries CHECK(quantity >= 0) since migration 0058, and SQLite's
// UPSERT does NOT let ON CONFLICT DO UPDATE bypass a CHECK failure on the
// would-be-INSERTed candidate row -- so an upsert whose VALUES() carry a
// NEGATIVE delta is rejected outright, even when the conflicting row exists and
// the post-update value would be non-negative. A positive delta upserts safely
// (creating the branch_stock row if absent); a negative delta targets a row
// that is guaranteed to exist -- the revert-remove path guards magnitude <= the
// current branch quantity first -- so a plain UPDATE evaluates the CHECK on the
// final (>= 0) value and never trips it.
function aggregateDeltaStatements(productId: number, branchId: number, delta: number): StockWriteStatement[] {
  const branchSql = delta >= 0
    ? `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @delta)
       ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`
    : `UPDATE branch_stock SET quantity = quantity + @delta WHERE product_id = @productId AND branch_id = @branchId`
  return [
    { sql: branchSql, params: { productId, branchId, delta } },
    {
      sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @delta, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId, delta },
    },
  ]
}

// Whether a movement changed what the SUPPLIER delivered -- i.e. whether
// reverting it must move the lot's purchase figures (received quantity/cost,
// payment state; see planUnreceiveBatchStock) and not just its stock. Two
// movements qualify: a genuine receipt (an inflow that is not itself a revert
// counter-movement), and the revert of one (an outflow counter-movement --
// reverting it puts the purchase back). The other two shapes are stock-only:
// a plain removal (consumption, loss, correction) does not shrink what was
// bought, and reverting it does not buy the units a second time. Keyed off
// reference_id's 'revert:' marker, the one thing that tells a counter-movement
// apart from an ordinary row of the same type.
export function movementIsPurchaseSide(m: Pick<RevertMovementRow, 'movement_type' | 'reference_id'>): boolean {
  const isRevertCounter = String(m.reference_id || '').startsWith('revert:')
  return OUT_TYPES.has(m.movement_type) === isRevertCounter
}

// Apply the revert: move the stock (aggregate + batch ledger) the opposite
// way, mirror the lot's purchase figures when the movement was a receipt, and
// insert the counter-movement -- the mirror and the counter-movement land in
// ONE db.batch. Returns a discriminated result rather than throwing, so the
// route can map it straight to a status/JSON; the only exceptions it swallows
// are the batch helpers' own (insufficient batch stock), converted to a 400.
export async function applyMovementRevert(db: D1Compat, m: RevertMovementRow, actor: RevertActor): Promise<RevertResult> {
  const productId = Number(m.product_id) || 0
  const branchId = Number(m.branch_id) || 0
  if (!productId || !branchId) {
    return { ok: false, status: 400, error: 'This movement is not tied to a product and branch, so it cannot be reverted here.' }
  }
  const plan = planMovementRevert(m)
  if (!plan.revertible) {
    return {
      ok: false,
      status: 400,
      error: plan.reason === 'no_stock'
        ? 'This movement moved no stock, so there is nothing to revert.'
        : `A "${m.movement_type}" movement is part of a sale, return, transfer or move record and cannot be reverted from the stock ledger. Undo it from its own record instead.`,
    }
  }
  // Double-revert guard: if a counter-movement already references this row,
  // reverting again would compensate twice.
  const already = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id = @ref LIMIT 1')
    .get<{ id: number }>({ ref: `revert:${m.id}` })
  if (already) return { ok: false, status: 409, error: 'This movement has already been reverted.' }

  const { revertType, magnitude } = plan
  const batchId = m.batch_id != null ? Number(m.batch_id) : null
  const purchaseSide = movementIsPurchaseSide(m)
  // This receipt's own money for the lot's cumulative received cost (0080):
  // the movement's recorded total, else its unit cost times its units.
  const receiptCostUsd = m.total_cost_usd != null ? Number(m.total_cost_usd)
    : m.unit_cost_usd != null ? multiplyMoney4(Number(m.unit_cost_usd), magnitude) : null
  let usedBatchId: number | null = null
  const statements: StockWriteStatement[] = []

  if (revertType === 'remove') {
    const current = await branchQty(db, productId, branchId)
    if (magnitude > current) {
      return { ok: false, status: 400, error: `Cannot revert: only ${current} in stock at ${m.branch_name || 'this branch'}, ${magnitude} needed.` }
    }
    if (batchId != null) {
      try {
        await removeStockFromBatch(db, { batchId, productId, branchId, quantity: magnitude })
        usedBatchId = batchId
      } catch (err) {
        if (err instanceof InsufficientBatchStockError) return { ok: false, status: 400, error: err.message }
        return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Failed to revert stock' }
      }
      // Un-purchase: the lot loses this receipt's units and money, and its
      // payment/attribution once nothing of it is left. A receipt with no lot
      // stamp (pre-0084 rows, FIFO-drained below) names no lot to mirror on --
      // blank-honest, the same rule 0084 set for the stamp itself.
      if (purchaseSide) statements.push(...planUnreceiveBatchStock({ batchId, quantity: magnitude, totalCostUsd: receiptCostUsd }))
    } else {
      const drained = await removeStockAcrossBatches(db, { productId, branchId, quantity: magnitude })
      usedBatchId = drained.batchIds.length === 1 && drained.remainder === 0 ? drained.batchIds[0] : null
      if (drained.remainder > 0) statements.push(...aggregateDeltaStatements(productId, branchId, -drained.remainder))
    }
  } else if (batchId != null && purchaseSide) {
    // Reverting the revert of a receipt puts the purchase back on the same
    // lot: units and money are received again. The supplier/payment a full
    // revert cleared is not on the movement row and is re-entered on the lot.
    try {
      const received = await receiveBatchStock(db, { productId, branchId, quantity: magnitude, batchId, unitCostUsd: m.unit_cost_usd ?? null })
      usedBatchId = received.batchId
    } catch (err) {
      return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Failed to revert stock' }
    }
  } else if (batchId != null) {
    // Putting back units a plain removal took out is not a new delivery: the
    // lot regains its stock (and picker visibility), its received figures stay
    // put. receiveBatchStock would have counted the units as received again.
    const lot = await db.prepare('SELECT id FROM product_batches WHERE id = @batchId AND variant_product_id = @productId')
      .get<{ id: number }>({ batchId, productId })
    if (!lot) return { ok: false, status: 400, error: 'Selected received date does not belong to this product' }
    statements.push(...restoreBatchStockStatements(batchId, branchId, magnitude), ...aggregateDeltaStatements(productId, branchId, magnitude))
    usedBatchId = batchId
  } else {
    statements.push(...aggregateDeltaStatements(productId, branchId, magnitude))
  }

  const revertReason = `Revert of #${m.id}${m.reason ? `: ${m.reason}` : ` (${m.movement_type})`}`
  statements.push({
    sql: `
    INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
      unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
      reason, reference_id, user_id, user_name, created_at, batch_id)
    VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity,
      @unitCostUsd, @unitCostKhr, @totalCostUsd, @totalCostKhr,
      @reason, @referenceId, @userId, @userName, CURRENT_TIMESTAMP, @batchId)
  `,
    params: {
      productId,
      productName: m.product_name,
      branchId,
      branchName: m.branch_name,
      movementType: revertType,
      quantity: magnitude,
      // A revert is a compensating record for this exact historical movement.
      // Copy its immutable snapshot (including explicit zero or NULL); looking
      // up today's product/lot cost would rewrite history after a price change.
      unitCostUsd: m.unit_cost_usd ?? null,
      unitCostKhr: m.unit_cost_khr ?? null,
      totalCostUsd: m.total_cost_usd ?? null,
      totalCostKhr: m.total_cost_khr ?? null,
      reason: revertReason,
      referenceId: `revert:${m.id}`,
      userId: actor.userId ?? null,
      userName: actor.userName ?? null,
      batchId: usedBatchId,
    },
  })
  await db.batch(statements)
  return { ok: true, revertType, quantity: magnitude, usedBatchId, movementId: m.id }
}
