import { productStockGuardStatement } from './productStockGuard'
import { planCountedTaggedChange, tagCapacityGuard, planExactCountedTagCapacity, planExactCountedTaggedChange,
  subtractCountedQuantity, sumCountedQuantities, CountedStockConflictError, type CountedCreatedReceipt, type CountedStockPlan } from './countedDamagedStock'
import type { D1Compat } from './db'
import type { StockWriteStatement } from './productBatches'
import { createDamagedLotStatement } from './returnsStock'
import { resolveMovementCostSnapshot, type MovementCostPair } from './movementCostSnapshot'
import { buildInClause, selectInChunks } from './sqlBinding'
import {
  damagedLotReference,
  taggedReasonText,
  TAGGED_DISPOSAL_MOVEMENT_TYPE,
  type StockConditionSource,
  type StockConditionTag,
} from './stockCondition'

export type TaggedLotActor = { userId: number | string | null; userName: string | null }

/** One open tagged lot, oldest first -- what allocateTaggedLots draws from. */
export type OpenTaggedLot = {
  id: number
  batch_id: number | null
  quantity_remaining: number
  unit_cost_usd: number | null
}

export type TaggedLotTake = { lotId: number; batchId: number | null; quantity: number; unitCostUsd: number | null }

/**
 * FIFO across a tag's open lots. Oldest lot first, because a tagged unit's cost
 * and its provenance belong to the lot it came from and the oldest tagged units
 * are the ones an operator means when they say "throw the broken ones out".
 * `uncovered` is what the lots could not supply; every caller refuses rather
 * than partially applying, so a stale client count can never dispose of more
 * than is tagged.
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
    remaining = subtractCountedQuantity(remaining, [take])
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
  /** The cost the movement records. Tagged units are valued at this, and the
   *  same USD unit cost is stamped on the lot so a later disposal can book the
   *  loss at what the goods actually cost, not at today's catalog price. */
  cost: MovementCostPair
  /** Session grouping for the Stock Change ledger (fast stock-in lines). */
  referenceId: string | number | null
  actor: TaggedLotActor
}

/** Tag existing physical units without moving them. The caller commits receipt and tag together. */
function holdStatements(input: HoldAsTaggedInput, capacity: StockWriteStatement[]): StockWriteStatement[] {
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Held quantity must be positive')
  return [
    productStockGuardStatement([input.productId], 'active'),
    ...capacity,
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
      movementType: 'condition_tag',
      quantity: 0,
      cost: input.cost,
      reason: taggedReasonText(input.tag, input.reason),
      referenceId: input.referenceId,
      batchId: input.batchId,
      actor: input.actor,
    }),
  ]
}

export function planHoldAsTagged(input: HoldAsTaggedInput): StockWriteStatement[] {
  return holdStatements(input, tagCapacityGuard(input.productId, input.branchId, input.batchId, input.quantity))
}

export function planHoldAsTaggedExact(input: HoldAsTaggedInput, exact: CountedStockPlan): StockWriteStatement[] {
  return holdStatements(input, planExactCountedTagCapacity(exact, input.productId, input.branchId, input.batchId, input.quantity))
}

export function planHoldAsTaggedCreatedReceipt(input: Omit<HoldAsTaggedInput, 'batchId'>, exact: CountedStockPlan, receipt: CountedCreatedReceipt): StockWriteStatement[] {
  if (input.productId !== receipt.productId || input.branchId !== receipt.branchId) throw new CountedStockConflictError()
  return holdStatements({ ...input, batchId: receipt.batchId }, exact.holdCreatedReceipt(receipt, input.quantity))
}

/** The code the in-batch guard below aborts with; the route answers 409 with it. */
export const TAGGED_LOT_CONFLICT_CODE = 'tagged_lot_conflict'

/**
 * True when a DISPOSE / RESTORE batch was refused by takeLotStatements' guard
 * (json_extract on a non-JSON code raises "malformed JSON"). The whole batch
 * rolled back: nothing was written.
 */
export function isTaggedLotConflict(error: unknown): boolean {
  return /malformed JSON|tagged_lot_conflict/i.test(error instanceof Error ? error.message : String(error))
}

// One held-lot take, GUARDED IN THE BATCH (SCAN1 STK-D). The route reads the
// open lots and allocates before it writes; a concurrent POS damage sale (or a
// second Restore / Dispose) can draw the same quantity_remaining down in
// between. The decrement's own WHERE only stops the column going negative --
// on its own it turns into a silent 0-row UPDATE while the rest of the batch
// still credits sellable stock (Restore) or books a second loss (Dispose). So
// the guard aborts the whole batch first, and the route answers 409
// tagged_lot_conflict with nothing written.
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
  return sumCountedQuantities(takes.map(take => Number(take.quantity || 0)))
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
 * units were carried at. Physical stock and its tagged subset are reduced together.
 */
function disposeStatements(input: TaggedLotChangeInput, changes: StockWriteStatement[]): StockWriteStatement[] {
  const quantity = takenQuantity(input.takes)
  if (!(quantity > 0)) throw new Error('Disposed quantity must be positive')
  return [
    ...changes,
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

export function planDisposeTagged(input: TaggedLotChangeInput): StockWriteStatement[] {
  return disposeStatements(input, input.takes.flatMap(take => planCountedTaggedChange({ lotId: take.lotId, productId: input.productId, branchId: input.branchId, batchId: take.batchId }, take.quantity, 'consume')))
}

export function planDisposeTaggedExact(input: TaggedLotChangeInput, exact: CountedStockPlan): StockWriteStatement[] {
  return disposeStatements(input, input.takes.flatMap(take => planExactCountedTaggedChange(exact, { lotId: take.lotId, productId: input.productId, branchId: input.branchId, batchId: take.batchId }, take.quantity, 'consume')))
}

/** Clear a condition tag without changing physical stock. */
function restoreStatements(input: TaggedLotChangeInput, changes: StockWriteStatement[]): StockWriteStatement[] {
  const quantity = takenQuantity(input.takes)
  if (!(quantity > 0)) throw new Error('Restored quantity must be positive')
  const statements: StockWriteStatement[] = [
    ...changes,
    movementStatement({
      productId: input.productId,
      productName: input.productName,
      branchId: input.branchId,
      branchName: input.branchName,
      movementType: 'condition_clear',
      quantity: 0,
      cost: costForTakes(input),
      reason: taggedReasonText(input.tag, input.reason),
      referenceId: damagedLotReference(input.takes[0].lotId),
      batchId: singleBatchId(input.takes),
      actor: input.actor,
    }),
  ]
  return statements
}

export function planRestoreTagged(input: TaggedLotChangeInput): StockWriteStatement[] {
  return restoreStatements(input, input.takes.flatMap(take => planCountedTaggedChange({ lotId: take.lotId, productId: input.productId, branchId: input.branchId, batchId: take.batchId }, take.quantity, 'clear')))
}

export function planRestoreTaggedExact(input: TaggedLotChangeInput, exact: CountedStockPlan): StockWriteStatement[] {
  return restoreStatements(input, input.takes.flatMap(take => planExactCountedTaggedChange(exact, { lotId: take.lotId, productId: input.productId, branchId: input.branchId, batchId: take.batchId }, take.quantity, 'clear')))
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
  // D1 caps bound parameters at 100 (lib/sqlBinding.ts) -- a page of
  // products plus pinned recently-edited ones can exceed that, so this
  // chunks the IN(...) list the same way datedStockCountApply.ts does
  // rather than binding the whole id array in one statement. Each id
  // lands in exactly one chunk, so the per-chunk GROUP BY never needs to
  // be merged across chunks -- concatenating the chunk results is enough.
  return await selectInChunks(ids, 0, async (chunk) => {
    const { sql, params } = buildInClause('productId', chunk)
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
      WHERE d.product_id IN (${sql}) AND d.quantity_remaining > 0
      GROUP BY d.product_id, d.branch_id, COALESCE(d.condition_tag, 'damaged')
      ORDER BY d.product_id ASC, COALESCE(d.condition_tag, 'damaged') ASC, d.branch_id ASC
    `).all<TaggedLotGroup>(params)
  })
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
