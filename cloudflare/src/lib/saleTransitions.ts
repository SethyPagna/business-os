// The sale lifecycle transition kernel (Part 383 R3) -- one place that
// decides, for ANY old->new sale_status pair, exactly how much stock moves
// and which transitions are even legal. routes/sales.ts's PATCH /:id/status
// consumes this; the pure test drives it against a real in-memory schema.
//
// The single invariant everything hangs off:
//
//   held(status) = how many units of a line are PHYSICALLY OUT of stock
//                  while the sale sits in that status
//     completed / awaiting_delivery / partial_return / returned:
//         quantity - alreadyReturned   (the returns flow restocks returned
//                                       units the moment each return is
//                                       recorded, whatever the label says)
//     awaiting_payment / cancelled:  0
//
// and every transition moves exactly held(new) - held(old), per line, on
// branch stock, the product total, AND the line's batch. That closes the
// holes the old boolean was/willBeDeducted logic had:
//   - partial_return -> cancelled restored NOTHING (the un-returned units
//     vanished from stock records silently);
//   - completed -> awaiting_payment restored the FULL quantity even when
//     part of it had already come back through a return (double-add);
//   - any transition that re-deducted (cancelled -> completed) skipped the
//     line's batch, leaving lot totals permanently high.
//
// Cancellation is a corrective ACTION, not just a label: stock comes back
// as new 'return' movements ("add stock back, not undo" -- the original
// sale's movements stay untouched), the reason is recorded, and a lost fee
// (e.g. a delivery fee the shop already paid and the buyer refused to
// cover) can be written to the fees ledger. Un-cancelling goes back ONLY
// to the status the sale was in when cancelled.

import { RETURN_STATUSES, STOCK_DEDUCTED_STATUSES } from './salesStatus'
import { decrementBatchStockStrictStatement, incrementBatchStockStatement } from './productBatches'

export const CANCEL_REASONS = ['mistake', 'buyer_refused', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export function normalizeCancelReason(value: unknown): CancelReason | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return (CANCEL_REASONS as readonly string[]).includes(normalized) ? (normalized as CancelReason) : null
}

export function cancelReasonLabel(reason: CancelReason): string {
  if (reason === 'mistake') return 'Mistake'
  if (reason === 'buyer_refused') return "Buyer didn't buy"
  return 'Other'
}

export function heldQuantity(status: string, quantity: number, returnedQuantity: number): number {
  const normalized = status || 'completed'
  if (normalized === 'cancelled' || normalized === 'awaiting_payment') return 0
  if (STOCK_DEDUCTED_STATUSES.has(normalized) || RETURN_STATUSES.has(normalized)) {
    return Math.max(0, (Number(quantity) || 0) - Math.max(0, Number(returnedQuantity) || 0))
  }
  return 0
}

// Z0: which lot(s) this line drew from, with per-unit release tracking
// (migration 0078). quantity = units attributed to the lot;
// released_quantity = how many of those are currently back in stock.
// Rows are fetched in draw order (id ASC); restores walk them in REVERSE
// (last-drawn units come back first), re-deducts walk them FORWARD.
export type SaleItemAllocation = {
  id: number
  batch_id: number
  quantity: number
  released_quantity: number
}

export type TransitionItem = {
  id: number
  product_id: number | null
  product_name: string | null
  quantity: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  branch_id: number | null
  batch_id: number | null
  // Absent/empty = fall back to the single-lot batch_id behavior (old
  // sales whose allocation insert failed, or callers that did not fetch).
  allocations?: SaleItemAllocation[]
}

// Returns recorded against a sale reference either a specific sale_item
// (sale_item_id) or just the product (older/product-matched rows). The
// item-level ones map directly; the product-level remainder is allocated
// greedily across that product's lines, capped at each line's own
// quantity -- same two-branch shape assertReturnableItems in
// routes/returns.ts validates with, so the two can't disagree about how
// much of a sale "already came back".
export function allocateReturnedQuantities(
  items: TransitionItem[],
  itemLevelReturned: Map<number, number>,
  productLevelReturned: Map<number, number>,
): Map<number, number> {
  const result = new Map<number, number>()
  const productRemaining = new Map<number, number>()
  for (const [productId, quantity] of productLevelReturned) {
    productRemaining.set(productId, Math.max(0, Number(quantity) || 0))
  }
  for (const item of items) {
    const direct = Math.max(0, Number(itemLevelReturned.get(item.id)) || 0)
    let returned = Math.min(item.quantity, direct)
    const productId = Number(item.product_id) || 0
    if (productId && (productRemaining.get(productId) || 0) > 0) {
      const capacity = Math.max(0, item.quantity - returned)
      const take = Math.min(capacity, productRemaining.get(productId) || 0)
      returned += take
      productRemaining.set(productId, (productRemaining.get(productId) || 0) - take)
    }
    result.set(item.id, returned)
  }
  return result
}

export type TransitionGuardResult = { ok: true } | { ok: false; error: string }

// Which old->new pairs this route may perform at all. partial_return and
// returned belong to the returns flow (routes/returns.ts sets them from
// real return records); letting PATCH flip a sale into one of them
// manually would claim stock came back with no return record behind it.
// Out of 'cancelled' the only road is back to where the sale was when it
// was cancelled -- the stock math for any other target would be a guess.
export function guardSaleStatusTransition(
  oldStatus: string,
  newStatus: string,
  statusBeforeCancel: string | null,
): TransitionGuardResult {
  if (oldStatus === newStatus) return { ok: true }
  // Un-cancel first: its one allowed target may itself BE a return status
  // (a sale cancelled while partial_return goes back to partial_return --
  // its return records still exist and the held() math accounts for them),
  // so this must run before the manual-return-status block below.
  if (oldStatus === 'cancelled') {
    const allowed = statusBeforeCancel || 'completed'
    if (newStatus !== allowed) {
      return { ok: false, error: `A cancelled sale can only be un-cancelled back to its previous status (${allowed}).` }
    }
    return { ok: true }
  }
  if (RETURN_STATUSES.has(newStatus)) {
    return { ok: false, error: 'Return statuses are set by recording an actual return (Returns page), not by switching the status by hand.' }
  }
  if (RETURN_STATUSES.has(oldStatus) && newStatus !== 'cancelled') {
    return { ok: false, error: 'This sale has recorded returns -- its status is managed by the returns flow. Only cancellation is allowed from here.' }
  }
  return { ok: true }
}

export type StockStatement = { sql: string; params: Record<string, unknown> }

export type SaleStockTransitionPlan = {
  statements: StockStatement[]
  // Positive deltas (stock that must be TAKEN) aggregated per
  // product+branch, for the route's pre-flight availability read. The
  // CHECK(quantity >= 0) constraints remain the real race guard.
  deductions: Array<{ product_id: number; branch_id: number; quantity: number }>
  restoredUnits: number
  deductedUnits: number
  // S4-2: units this transition WOULD have moved but deliberately did not,
  // because the caller passed skipStock (admin-only "Don't touch stock").
  // Non-zero only in that mode; it is what the audit trail records so a
  // deliberately-skipped sale is never mistaken for a lost deduction.
  skippedUnits: number
}

// S4-2 "Don't touch stock" (admin only, lock-gated in the UI, enforced
// server-side in routes/sales.ts).
//
// WHY IT EXISTS. The Sep-2 2026 reconciliation rewrote every product's
// quantity to the physically-counted truth, and that count ALREADY assumes
// the migrated old-system sales are completed. Flipping such a sale
// awaiting_payment -> completed therefore deducts units a second time --
// on Sep 3 a bulk flip of 7 migrated sales took 9 units that were already
// accounted for. For those sales the correct stock delta is zero, and no
// amount of held() arithmetic can know that: it is a fact about where the
// data came from, not about the lifecycle.
//
// WHAT skipStock DOES. The transition still happens in every other respect
// (status, payment fields, cancellation record, audit, notifications); the
// stock ledger is simply not touched -- no branch_stock, no
// products.stock_quantity, no branch_batch_stock, no allocation release,
// and above all NO inventory_movements row. Zero statements, not
// compensating ones: an inventory_movements row asserts that units
// physically moved, and none did.
//
// WHY IT MUST BE STICKY (routes/sales.ts persists sales.stock_skipped=1 and
// re-applies it to every later transition of that sale). held() is a state
// machine over the sale's status, and it assumes the system itself put the
// units out. Once a sale reaches `completed` without the system deducting
// anything, held(completed) is a lie for that sale: a later cancel would
// compute delta = 0 - qty and ADD units that were never taken -- inventing
// stock, the exact failure this feature exists to stop. So a stock-skipped
// sale is permanently outside the stock ledger and every subsequent
// transition of it moves zero. Real returns against it still restock
// normally: routes/returns.ts works from the return record (goods actually
// came back over the counter), not from held().
export function planSaleStockTransition(input: {
  saleId: number | string
  oldStatus: string
  newStatus: string
  items: TransitionItem[]
  returnedByItem: Map<number, number>
  reason: string
  userId: number | string | null
  userName: string | null
  // Admin-only, verified by the route BEFORE this is set (see
  // isAdminControlUser there) -- the kernel never decides permission.
  skipStock?: boolean
}): SaleStockTransitionPlan {
  const statements: StockStatement[] = []
  const deductionMap = new Map<string, { product_id: number; branch_id: number; quantity: number }>()
  let restoredUnits = 0
  let deductedUnits = 0
  let skippedUnits = 0
  const skipStock = input.skipStock === true

  for (const item of input.items) {
    if (!item.product_id || !item.branch_id) continue
    const returned = Math.max(0, Number(input.returnedByItem.get(item.id)) || 0)
    const before = heldQuantity(input.oldStatus, item.quantity, returned)
    const after = heldQuantity(input.newStatus, item.quantity, returned)
    const delta = after - before
    if (delta === 0) continue

    if (skipStock) {
      // Count what was NOT moved, emit nothing at all, and leave
      // restoredUnits/deductedUnits at zero so the audit trail cannot
      // read as if stock had moved.
      skippedUnits += Math.abs(delta)
      continue
    }

    if (delta > 0) {
      // Taking stock (e.g. un-cancel, or awaiting_payment -> completed).
      deductedUnits += delta
      const key = `${item.product_id}:${item.branch_id}`
      const existing = deductionMap.get(key)
      if (existing) existing.quantity += delta
      else deductionMap.set(key, { product_id: item.product_id, branch_id: item.branch_id, quantity: delta })
      // Plain subtraction on purpose: branch_stock's CHECK(quantity >= 0)
      // (migration 0058) turns a concurrent shortage into an atomic abort
      // instead of a silent clamp -- same strictness as POST / checkout.
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
        params: { product_id: item.product_id, branch_id: item.branch_id, quantity: delta },
      })
      statements.push({
        sql: `UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
        params: { product_id: item.product_id, quantity: delta },
      })
      // 0084: which lots this item's movement row actually touched -- the
      // row stamps a batch_id only when ONE lot covered the whole delta.
      const touchedLots: Array<{ batchId: number; quantity: number }> = []
      const deductAllocations = item.allocations || []
      if (deductAllocations.length) {
        // Z0: re-take the units from the SAME lots the sale drew from,
        // forward (FIFO) order, each capped at what that lot has released.
        // Strict decrements, like a sale: a lot that cannot cover its share
        // aborts the whole transition (batch CHECK, migration 0058).
        let remaining = delta
        for (const alloc of deductAllocations) {
          if (remaining <= 0) break
          const take = Math.min(Math.max(0, Number(alloc.released_quantity) || 0), remaining)
          if (take <= 0) continue
          statements.push(decrementBatchStockStrictStatement(alloc.batch_id, item.branch_id, take))
          touchedLots.push({ batchId: alloc.batch_id, quantity: take })
          statements.push({
            sql: `UPDATE sale_item_batch_allocations
                  SET released_quantity = released_quantity - @take,
                      released_at = CASE WHEN released_quantity - @take <= 0 THEN NULL ELSE released_at END
                  WHERE id = @id`,
            params: { take, id: alloc.id },
          })
          remaining -= take
        }
      } else if (item.batch_id) {
        // Strict, like a sale: a lot that cannot cover the re-deduct
        // aborts the whole transition (batch CHECK, migration 0058).
        statements.push(decrementBatchStockStrictStatement(item.batch_id, item.branch_id, delta))
        touchedLots.push({ batchId: item.batch_id, quantity: delta })
        statements.push({
          sql: `UPDATE sale_item_batch_allocations SET released_at = NULL, released_quantity = 0
                WHERE sale_item_id = @sale_item_id AND batch_id = @batch_id`,
          params: { sale_item_id: item.id, batch_id: item.batch_id },
        })
      }
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name,
          branch_id: item.branch_id,
          quantity: -delta,
          // 0084: attributable only when one lot covered the whole delta.
          batch_id: touchedLots.length === 1 && touchedLots[0].quantity === delta ? touchedLots[0].batchId : null,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason: input.reason,
          reference_id: input.saleId,
          user_id: input.userId,
          user_name: input.userName,
        },
      })
    } else {
      // Giving stock back (cancellation, or completed -> awaiting_payment).
      const restore = -delta
      restoredUnits += restore
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
        params: { product_id: item.product_id, branch_id: item.branch_id, quantity: restore },
      })
      statements.push({
        sql: `UPDATE products SET stock_quantity = stock_quantity + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
        params: { product_id: item.product_id, quantity: restore },
      })
      // 0084: same single-lot attribution rule as the deduct branch above.
      const restoredLots: Array<{ batchId: number; quantity: number }> = []
      const restoreAllocations = item.allocations || []
      if (restoreAllocations.length) {
        // Z0: put the units back into the SAME lots the sale drew from --
        // reverse order (last-drawn units return first), each capped at the
        // allocation's outstanding (quantity - released_quantity), so units
        // a recorded return already restocked are never re-added.
        let remaining = restore
        for (let index = restoreAllocations.length - 1; index >= 0 && remaining > 0; index -= 1) {
          const alloc = restoreAllocations[index]
          const outstanding = Math.max(0, (Number(alloc.quantity) || 0) - (Number(alloc.released_quantity) || 0))
          const give = Math.min(outstanding, remaining)
          if (give <= 0) continue
          statements.push(incrementBatchStockStatement(alloc.batch_id, item.branch_id, give))
          restoredLots.push({ batchId: alloc.batch_id, quantity: give })
          statements.push({
            sql: `UPDATE sale_item_batch_allocations
                  SET released_quantity = released_quantity + @give,
                      released_at = CASE WHEN released_quantity + @give >= quantity THEN datetime('now') ELSE released_at END
                  WHERE id = @id`,
            params: { give, id: alloc.id },
          })
          remaining -= give
        }
      } else if (item.batch_id) {
        statements.push(incrementBatchStockStatement(item.batch_id, item.branch_id, restore))
        restoredLots.push({ batchId: item.batch_id, quantity: restore })
        statements.push({
          sql: `UPDATE sale_item_batch_allocations SET released_at = datetime('now'), released_quantity = quantity
                WHERE sale_item_id = @sale_item_id AND batch_id = @batch_id AND released_at IS NULL`,
          params: { sale_item_id: item.id, batch_id: item.batch_id },
        })
      }
      // ADDED-BACK stock, visibly: a new 'return' movement whose reason
      // carries the cancellation ("add stock back with a note, never undo
      // the original movements").
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: item.product_id,
          product_name: item.product_name,
          branch_id: item.branch_id,
          quantity: restore,
          // 0084: attributable only when one lot received the whole restore.
          batch_id: restoredLots.length === 1 && restoredLots[0].quantity === restore ? restoredLots[0].batchId : null,
          unit_cost_usd: item.cost_price_usd || 0,
          unit_cost_khr: item.cost_price_khr || 0,
          reason: input.reason,
          reference_id: input.saleId,
          user_id: input.userId,
          user_name: input.userName,
        },
      })
    }
  }

  return { statements, deductions: [...deductionMap.values()], restoredUnits, deductedUnits, skippedUnits }
}
