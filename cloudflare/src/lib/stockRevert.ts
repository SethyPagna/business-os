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
import { receiveBatchStock, removeStockFromBatch, removeStockAcrossBatches, InsufficientBatchStockError } from './productBatches'

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
  reason: string | null
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
async function applyAggregateDelta(db: D1Compat, productId: number, branchId: number, delta: number): Promise<void> {
  const branchSql = delta >= 0
    ? `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @delta)
       ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`
    : `UPDATE branch_stock SET quantity = quantity + @delta WHERE product_id = @productId AND branch_id = @branchId`
  await db.batch([
    { sql: branchSql, params: { productId, branchId, delta } },
    {
      sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @delta, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId, delta },
    },
  ])
}

// Apply the revert: move the stock (aggregate + batch ledger) the opposite
// way and insert the counter-movement. Returns a discriminated result rather
// than throwing, so the route can map it straight to a status/JSON; the only
// exceptions it swallows are the batch helpers' own (insufficient batch
// stock), converted to a 400.
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
  let usedBatchId: number | null = null

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
    } else {
      const drained = await removeStockAcrossBatches(db, { productId, branchId, quantity: magnitude })
      usedBatchId = drained.batchIds.length === 1 && drained.remainder === 0 ? drained.batchIds[0] : null
      if (drained.remainder > 0) await applyAggregateDelta(db, productId, branchId, -drained.remainder)
    }
  } else {
    if (batchId != null) {
      try {
        const received = await receiveBatchStock(db, { productId, branchId, quantity: magnitude, batchId })
        usedBatchId = received.batchId
      } catch (err) {
        return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Failed to revert stock' }
      }
    } else {
      await applyAggregateDelta(db, productId, branchId, magnitude)
    }
  }

  const revertReason = `Revert of #${m.id}${m.reason ? `: ${m.reason}` : ` (${m.movement_type})`}`
  await db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, reference_id, user_id, user_name, created_at, batch_id)
    VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity, @reason, @referenceId, @userId, @userName, CURRENT_TIMESTAMP, @batchId)
  `).run({
    productId,
    productName: m.product_name,
    branchId,
    branchName: m.branch_name,
    movementType: revertType,
    quantity: magnitude,
    reason: revertReason,
    referenceId: `revert:${m.id}`,
    userId: actor.userId ?? null,
    userName: actor.userName ?? null,
    batchId: usedBatchId,
  })
  return { ok: true, revertType, quantity: magnitude, usedBatchId, movementId: m.id }
}
