// Applies a StockCountPlan (lib/datedStockCountImport.ts's pure
// computation) as real DB writes. Kept in its own file, separate from
// the plan computation, per that file's own stated boundary ("does no
// I/O ... those are the caller's job").
//
// Deliberately does NOT re-derive its own batch FIFO logic. For the
// batch-tracked portion of a group (only ever present when the plan
// decided this group qualifies -- see computeBatchPlanForGroup's own
// comment on why a rerun gets none), this replays each date's movement
// through the SAME real functions the interactive UI already uses and
// already trusts -- `receiveBatchStock` for an add (it does its own
// date-based match-or-create, so it naturally reproduces the plan's
// batchTopUps/batchCreates split) and `removeStockAcrossBatches` for a
// remove (fresh FIFO against live batches at write time, not the plan's
// earlier snapshot -- deliberately more correct than trusting the
// plan's own batchId assignments if anything else touched this
// product's batches between preview and apply). This avoids maintaining
// two independent FIFO implementations that could quietly drift apart
// (see this project's standing "no zombie/duplicate code" rule) --
// plan.batchTopUps/batchCreates/batchDrains/batchDeactivations exist
// for PREVIEW purposes (showing the user what will happen before they
// confirm), not as literal apply-time instructions.
//
// A group with no batch actions in the plan (a rerun, or a group with
// no existingBatches supplied) applies through the plain aggregate
// branch_stock/products.stock_quantity path instead, same fallback the
// interactive /adjust route already uses for a non-batch-tracked
// product.
import type { D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'
import type { StockCountPlan, StockCountPlanMovement } from './datedStockCountImport'
import { receiveBatchStock, removeStockAcrossBatches } from './productBatches'

function groupKey(productId: number, branchId: number): string {
  return `${productId}:${branchId}`
}

async function applyPlainStockDelta(db: D1Compat, productId: number, branchId: number, delta: number): Promise<void> {
  await db.batch([
    {
      // Two clamps, both against MAX(0, ...): the INSERT seed floors a
      // no-existing-row REMOVE (delta < 0) to 0 (nothing to remove), and the
      // conflict update floors an existing row that a remove would take
      // negative. The conflict update references the bound @delta directly,
      // NOT excluded.quantity -- excluded carries the already-floored INSERT
      // value (0 for any remove), so using it would drop every remove on an
      // existing row. Previously the raw INSERT seed could store a negative
      // row silently; migration 0058's CHECK(quantity >= 0) now rejects that,
      // which this floors to match.
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, MAX(0, @delta))
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = MAX(0, branch_stock.quantity + @delta)`,
      params: { productId, branchId, delta },
    },
    {
      sql: `UPDATE products SET stock_quantity = MAX(0, COALESCE(stock_quantity, 0) + @delta), updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
      params: { productId, delta },
    },
  ])
}

async function insertMovementRow(db: D1Compat, movement: StockCountPlanMovement, userId: number | null, userName: string | null): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
    VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity, @reason, @userId, @userName, @createdAt)
  `).run({
    productId: movement.productId,
    productName: movement.productName,
    branchId: movement.branchId,
    branchName: movement.branchName,
    movementType: movement.movementType,
    quantity: movement.quantity,
    reason: movement.reason,
    userId,
    userName,
    // Dated to the movement's own snapshot date, not import time -- this
    // is a RECONCILIATION import, the whole point is a historically
    // accurate movement log, not a pile of movements all timestamped to
    // whenever the file happened to get uploaded.
    createdAt: `${movement.date} 00:00:00`,
  })
  return Number(result.lastInsertRowid)
}

// Records this movement's own batch-level provenance (migration 0035),
// so a later rerun of this same importer can find and reverse only ITS
// OWN prior batch effects (datedStockCountImport.ts's
// reconstructBatchBaseline) instead of being unable to tell them apart
// from a real sale/adjustment that happened since. No-op for a movement
// that didn't touch any tracked batch (a plain group, or a batch-tracked
// group's shortfall remainder that fell through to the plain aggregate
// -- that portion has nothing batch-specific to record).
async function insertBatchActions(db: D1Compat, movementId: number, actions: { batchId: number; quantity: number }[]): Promise<void> {
  if (!actions.length) return
  await db.batch(actions.map((action) => ({
    sql: `INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (@movementId, @batchId, @quantity)`,
    params: { movementId, batchId: action.batchId, quantity: action.quantity },
  })))
}

export interface ApplyDatedStockCountPlanResult {
  movementsDeleted: number
  movementsApplied: number
  batchTrackedGroups: number
  plainGroups: number
}

export async function applyDatedStockCountPlan(
  db: D1Compat,
  plan: StockCountPlan,
  actor: { userId: number | null; userName: string | null } = { userId: null, userName: null },
): Promise<ApplyDatedStockCountPlanResult> {
  if (plan.movementsToDelete.length) {
    // D1/SQLite has no array bind -- build the IN(...) list as its own
    // positional-safe placeholders rather than a single array param, and
    // split it so no one statement exceeds D1's 100-parameter limit.
    for (const chunk of chunkForBinding(plan.movementsToDelete)) {
      const { sql, params } = buildInClause('id', chunk)
      await db.prepare(`DELETE FROM inventory_movements WHERE id IN (${sql})`).run(params)
      // No FK cascade (migration 0035's own comment) -- this importer owns
      // both tables, so it deletes a superseded movement's provenance rows
      // itself, same "delete what you own" step this DELETE already does
      // for the movement row.
      await db.prepare(`DELETE FROM dated_stock_count_batch_actions WHERE movement_id IN (${sql})`).run(params)
    }
  }

  const batchTrackedGroupKeys = new Set<string>()
  for (const entry of [...plan.batchTopUps, ...plan.batchCreates, ...plan.batchDrains]) {
    batchTrackedGroupKeys.add(groupKey(entry.productId, entry.branchId))
  }

  // Group movements by product+branch, preserving each group's own
  // earliest-to-latest order (already guaranteed by the plan).
  const movementsByGroup = new Map<string, StockCountPlanMovement[]>()
  for (const movement of plan.movementsToCreate) {
    const key = groupKey(movement.productId, movement.branchId)
    const bucket = movementsByGroup.get(key)
    if (bucket) bucket.push(movement)
    else movementsByGroup.set(key, [movement])
  }

  let movementsApplied = 0
  for (const [key, movements] of movementsByGroup) {
    const batchTracked = batchTrackedGroupKeys.has(key)
    for (const movement of movements) {
      // This movement's own batch-level provenance -- which real
      // product_batches row(s) it touched and by how much (signed).
      // Recorded alongside the movement row so a later rerun can
      // reverse exactly this, and nothing else (see
      // datedStockCountImport.ts's reconstructBatchBaseline).
      let batchActions: { batchId: number; quantity: number }[] = []
      if (batchTracked) {
        if (movement.movementType === 'add') {
          const received = await receiveBatchStock(db, {
            productId: movement.productId,
            branchId: movement.branchId,
            quantity: movement.quantity,
            receivedDate: movement.date,
          })
          batchActions = [{ batchId: received.batchId, quantity: movement.quantity }]
        } else {
          const drained = await removeStockAcrossBatches(db, {
            productId: movement.productId,
            branchId: movement.branchId,
            quantity: movement.quantity,
          })
          batchActions = drained.batchQuantities
          // Same shortfall handling as the interactive /adjust route:
          // whatever the tracked batches couldn't cover still needs to
          // come off the plain aggregate, or branch_stock ends up too
          // high relative to what the count actually said. Nothing
          // batch-specific to record for the shortfall portion -- it
          // never touched a batch row.
          if (drained.remainder > 0) {
            await applyPlainStockDelta(db, movement.productId, movement.branchId, -drained.remainder)
          }
        }
      } else {
        const delta = movement.movementType === 'add' ? movement.quantity : -movement.quantity
        await applyPlainStockDelta(db, movement.productId, movement.branchId, delta)
      }
      const movementId = await insertMovementRow(db, movement, actor.userId, actor.userName)
      await insertBatchActions(db, movementId, batchActions)
      movementsApplied += 1
    }
  }

  return {
    movementsDeleted: plan.movementsToDelete.length,
    movementsApplied,
    batchTrackedGroups: batchTrackedGroupKeys.size,
    plainGroups: movementsByGroup.size - batchTrackedGroupKeys.size,
  }
}
