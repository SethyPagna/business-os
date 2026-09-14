// P3-L6: the three stock-side transitions on a TAGGED (held, non-sellable)
// stock row, as pure statement plans so scripts/test-stock-condition-tag-pure.cjs
// can drive them against the real migration chain -- the same zero-magic shape
// lib/stockRevert.ts uses.
//
// The transition table this file implements. S = sellable stock at the branch
// (branch_stock + products.stock_quantity + branch_batch_stock), D = held
// stock (SUM(damaged_stock_lots.quantity_remaining) for that product, branch
// and tag). Every delta is applied once per call; none of these calls is
// idempotent by itself, exactly like every other movement writer here, and a
// second call posts a second movement rather than silently re-applying.
//
//   HOLD      keep-as-tagged on a remove, or a tagged restock
//             S -= q, D += q     movement damage_out (cost filled) + lot row
//             NOT a loss: the goods are still owned, still countable, still
//             disposable or restorable. See stockCondition.ts.
//   DISPOSE   the tagged row's "Remove entirely"
//             S unchanged, D -= q    movement write_off (cost filled)
//             THIS is the loss, booked once, at cost. S is untouched because
//             the units already left sellable stock at HOLD time -- moving S
//             again here is the double-count this split exists to prevent.
//   RESTORE   the tagged row's "Restore to sellable"
//             S += q, D -= q     movement 'in' (cost filled)
//             The exact reversal of HOLD.
//
// A plain untagged removal (no HOLD at all) keeps its existing 'remove'
// movement and is the loss in its own right -- the owner's "if remove
// directly it also counts toward losses".
import type { D1Compat } from './db'
import { incrementBatchStockStatement, type StockWriteStatement } from './productBatches'
import { createDamagedLotStatement } from './returnsStock'
import { resolveMovementCostSnapshot, type MovementCostPair } from './movementCostSnapshot'
import {
  damagedLotReference,
  taggedReasonText,
  TAGGED_DISPOSAL_MOVEMENT_TYPE,
  TAGGED_HOLD_MOVEMENT_TYPE,
  TAGGED_RESTORE_MOVEMENT_TYPE,
  type StockConditionSource,
  type StockConditionTag,
} from './stockCondition'

export type TaggedLotActor = { userId: number | string | null; userName: string | null }

/** One open held lot, oldest first -- what allocateTaggedLots draws from. */
export type OpenTaggedLot = {
  id: number
  batch_id: number | null
  quantity_remaining: number
  unit_cost_usd: number | null
}

export type TaggedLotTake = { lotId: number; batchId: number | null; quantity: number; unitCostUsd: number | null }

/**
 * FIFO across a tag's open lots. Oldest lot first, because a held unit's cost
 * and its provenance belong to the lot it came from and the oldest held units
 * are the ones an operator means when they say "throw the broken ones out".
 * `uncovered` is what the lots could not supply; every caller refuses rather
 * than partially applying, so a stale client count can never dispose of more
 * than is held.
 */
export function allocateTaggedLots(lots: OpenTaggedLot[], quantity: number): { takes: TaggedLotTake[]; uncovered: number } {
  let remaining = Math.max(0, Number(quantity) || 0)
  const takes: TaggedLotTake[] = []
  for (const lot of lots) {
    if (remaining <= 0) break
    const available = Math.max(0, Number(lot.quantity_remaining) || 0)
    const take = Math.min(available, remaining)
    if (!(take > 0)) continue
    takes.push({
      lotId: Number(lot.id),
      batchId: lot.batch_id != null ? Number(lot.batch_id) : null,
      quantity: take,
      unitCostUsd: lot.unit_cost_usd ?? null,
    })
    remaining -= take
  }
  return { takes, uncovered: remaining }
}

const MOVEMENT_SQL = `
  INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
    unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
  VALUES (@productId, @productName, @branchId, @branchName, @movementType, @quantity,
    @unitCostUsd, @unitCostKhr, @totalCostUsd, @totalCostKhr,
    @reason, @referenceId, @userId, @userName, CURRENT_TIMESTAMP, @batchId)
`

function movementStatement(input: {
  productId: number
  productName: string | null
  branchId: number
  branchName: string | null
  movementType: string
  quantity: number
  cost: MovementCostPair
  reason: string
  referenceId: string | number | null
  batchId: number | null
  actor: TaggedLotActor
}): StockWriteStatement {
  return {
    sql: MOVEMENT_SQL,
    params: {
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      branchName: input.branchName,
      movementType: input.movementType,
      quantity: input.quantity,
      ...input.cost,
      reason: input.reason,
      referenceId: input.referenceId,
      userId: input.actor.userId ?? null,
      userName: input.actor.userName ?? null,
      batchId: input.batchId,
    },
  }
}

export type HoldAsTaggedInput = {
  productId: number
  productName: string | null
  branchId: number
  branchName: string | null
  /** The lot the units were taken from, when one lot covered the whole move. */
  batchId: number | null
  quantity: number
  tag: StockConditionTag
  source: Extract<StockConditionSource, 'remove' | 'restock'>
  reason: string | null
  /** The cost the movement records. Held units are valued at this, and the
   *  same USD unit cost is stamped on the lot so a later disposal can book the
   *  loss at what the goods actually cost, not at today's catalog price. */
  cost: MovementCostPair
  /** Session grouping for the Stock Change ledger (fast stock-in lines). */
  referenceId: string | number | null
  actor: TaggedLotActor
}

/**
 * HOLD. The caller has ALREADY taken the units out of sellable stock (the
 * /adjust remove path, or the tagged-restock path that receives and then
 * holds) -- this plan only records where they went. Returned as statements so
 * the movement and the lot row land in one db.batch: a movement with no lot
 * row would be an outflow nobody can restore, and a lot row with no movement
 * would be stock that left sellable without a ledger line.
 */
export function planHoldAsTagged(input: HoldAsTaggedInput): StockWriteStatement[] {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Held quantity must be positive')
  return [
    createDamagedLotStatement({
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      batchId: input.batchId,
      returnIdSql: 'NULL',
      quantity,
      reason: input.reason,
      userId: input.actor.userId,
      userName: input.actor.userName,
      conditionTag: input.tag,
      source: input.source,
      unitCostUsd: input.cost.unitCostUsd,
    }),
    movementStatement({
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      branchName: input.branchName,
      // damage_out, never 'remove': the Stock Change ledger already counts it
      // as an outflow, and a loss report must NOT count it as one. The loss
      // happens at DISPOSE. See stockCondition.ts.
      movementType: TAGGED_HOLD_MOVEMENT_TYPE,
      quantity,
      cost: input.cost,
      reason: taggedReasonText(input.tag, input.reason),
      referenceId: input.referenceId,
      batchId: input.batchId,
      actor: input.actor,
    }),
  ]
}

function decrementLotStatement(lotId: number, quantity: number): StockWriteStatement {
  // Guarded on quantity_remaining so a concurrent POS damage sale (which draws
  // the same column down) can never drive it negative; the caller re-reads and
  // refuses when the allocation no longer covers the request.
  return {
    sql: `UPDATE damaged_stock_lots
      SET quantity_remaining = quantity_remaining - @quantity, updated_at = CURRENT_TIMESTAMP
      WHERE id = @lotId AND quantity_remaining >= @quantity`,
    params: { lotId, quantity },
  }
}

export type TaggedLotChangeInput = {
  productId: number
  productName: string | null
  branchId: number
  branchName: string | null
  tag: StockConditionTag
  takes: TaggedLotTake[]
  reason: string | null
  /** Catalog cost, read before the write, for a held lot with no stamped cost
   *  (a returns-flow lot, or anything written before migration 0162). */
  fallbackUnitCostUsd: number | null
  fallbackUnitCostKhr: number | null
  actor: TaggedLotActor
}

function takenQuantity(takes: TaggedLotTake[]): number {
  return takes.reduce((sum, take) => sum + Number(take.quantity || 0), 0)
}

function costForTakes(input: TaggedLotChangeInput): MovementCostPair {
  return resolveMovementCostSnapshot({
    quantity: takenQuantity(input.takes),
    components: input.takes.map((take) => ({ quantity: take.quantity, unitCostUsd: take.unitCostUsd })),
    fallbackUnitCostUsd: input.fallbackUnitCostUsd,
    fallbackUnitCostKhr: input.fallbackUnitCostKhr,
  })
}

/** The lot that owns the whole move, else null -- the same "one lot or
 *  nothing" rule 0084 set for a movement's batch stamp. */
function singleBatchId(takes: TaggedLotTake[]): number | null {
  const ids = [...new Set(takes.map((take) => take.batchId).filter((id): id is number => id != null))]
  return takes.every((take) => take.batchId != null) && ids.length === 1 ? ids[0] : null
}

/**
 * DISPOSE -- the tagged row's "Remove entirely". The units are destroyed: the
 * held lots shrink and a write_off movement books the loss at the cost the
 * units were carried at. Sellable stock is deliberately NOT touched; these
 * units left it when they were held.
 */
export function planDisposeTagged(input: TaggedLotChangeInput): StockWriteStatement[] {
  const quantity = takenQuantity(input.takes)
  if (!(quantity > 0)) throw new Error('Disposed quantity must be positive')
  return [
    ...input.takes.map((take) => decrementLotStatement(take.lotId, take.quantity)),
    movementStatement({
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      branchName: input.branchName,
      movementType: TAGGED_DISPOSAL_MOVEMENT_TYPE,
      quantity,
      cost: costForTakes(input),
      reason: taggedReasonText(input.tag, input.reason),
      referenceId: damagedLotReference(input.takes[0].lotId),
      batchId: singleBatchId(input.takes),
      actor: input.actor,
    }),
  ]
}

/**
 * RESTORE -- the tagged row's "Restore to sellable", the exact reversal of
 * HOLD. The held lots shrink and the units go back into sellable stock: into
 * the batch they came from when the held lot recorded one (reactivating it, so
 * migration 0154's "positive stock needs an active lot" invariant holds), plus
 * the branch/product aggregate either way.
 */
export function planRestoreTagged(input: TaggedLotChangeInput): StockWriteStatement[] {
  const quantity = takenQuantity(input.takes)
  if (!(quantity > 0)) throw new Error('Restored quantity must be positive')
  const statements: StockWriteStatement[] = input.takes.map((take) => decrementLotStatement(take.lotId, take.quantity))
  for (const take of input.takes) {
    if (take.batchId == null) continue
    statements.push({
      sql: `UPDATE product_batches SET is_active = 1, updated_at = datetime('now') WHERE id = @batchId AND is_active IS NOT 1`,
      params: { batchId: take.batchId },
    })
    statements.push(incrementBatchStockStatement(take.batchId, input.branchId, take.quantity))
  }
  statements.push(
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { productId: input.productId, branchId: input.branchId, quantity },
    },
    {
      sql: 'UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @productId',
      params: { productId: input.productId, quantity },
    },
    movementStatement({
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      branchName: input.branchName,
      movementType: TAGGED_RESTORE_MOVEMENT_TYPE,
      quantity,
      cost: costForTakes(input),
      reason: taggedReasonText(input.tag, input.reason),
      // 'in' IS on stockRevert's revertible allowlist, so this marker is what
      // stops the ledger from "reverting" a restore -- which would pull the
      // units back out of sellable stock without putting them back on the
      // held lot, losing them entirely. stockCondition.ts explains the rule.
      referenceId: damagedLotReference(input.takes[0].lotId),
      batchId: singleBatchId(input.takes),
      actor: input.actor,
    }),
  )
  return statements
}

export type TaggedLotGroup = {
  product_id: number
  product_name: string | null
  branch_id: number | null
  branch_name: string | null
  condition_tag: string
  quantity: number
  lot_count: number
}

/**
 * The Products page's tagged child rows: one row per (product, tag, branch)
 * with quantity = SUM(quantity_remaining). Only OPEN lots (> 0) -- a fully
 * disposed, restored or sold-through tag leaves no row behind.
 */
export async function readTaggedLotGroups(db: D1Compat, productIds: number[]): Promise<TaggedLotGroup[]> {
  const ids = [...new Set(productIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return await db.prepare(`
    SELECT d.product_id AS product_id,
           d.product_name AS product_name,
           d.branch_id AS branch_id,
           b.name AS branch_name,
           COALESCE(d.condition_tag, 'damaged') AS condition_tag,
           SUM(d.quantity_remaining) AS quantity,
           COUNT(*) AS lot_count
    FROM damaged_stock_lots d
    LEFT JOIN branches b ON b.id = d.branch_id
    WHERE d.product_id IN (${placeholders}) AND d.quantity_remaining > 0
    GROUP BY d.product_id, d.branch_id, COALESCE(d.condition_tag, 'damaged')
    ORDER BY d.product_id ASC, COALESCE(d.condition_tag, 'damaged') ASC, d.branch_id ASC
  `).all<TaggedLotGroup>(ids)
}

/** Open lots for ONE (product, branch, tag), oldest first -- the allocation
 *  source for DISPOSE and RESTORE. */
export async function readOpenTaggedLots(db: D1Compat, input: {
  productId: number
  branchId: number
  tag: StockConditionTag
}): Promise<OpenTaggedLot[]> {
  return await db.prepare(`
    SELECT id, batch_id, quantity_remaining, unit_cost_usd
    FROM damaged_stock_lots
    WHERE product_id = @productId AND branch_id = @branchId
      AND COALESCE(condition_tag, 'damaged') = @tag AND quantity_remaining > 0
    ORDER BY created_at ASC, id ASC
  `).all<OpenTaggedLot>({ productId: input.productId, branchId: input.branchId, tag: input.tag })
}
