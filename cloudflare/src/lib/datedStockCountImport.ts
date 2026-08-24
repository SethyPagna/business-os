// Dated stock-count import -- Part 234/235's confirmed spec, built Part
// 239: a source file has one row per (date, product), with separate
// "shop" and "warehouse" quantity columns (both present, not
// one-or-the-other -- confirmed with the user in Part 234), representing
// a physical count taken on that date. Distinct from the existing
// inventory add/remove/set import: those apply as a single movement
// dated today; this applies a whole dated SERIES per product+branch,
// "both counts, earliest to latest" (Part 234's own words) -- i.e. each
// date in the series is its own real movement, not collapsed to
// latest-wins.
//
// This file is ONLY the plan-computation core: given the resolved,
// already-branch/product-mapped entries from a parsed CSV, the
// system's live branch_stock for the products/branches involved, and
// any PRIOR stock-count-import movements this file previously created
// for the same product+branch+date combinations, it returns exactly
// what should change -- which old movements to delete, which new ones
// to insert, and what branch_stock should end up at. It does no I/O and
// knows nothing about SQL, CSV columns, or branch-name resolution --
// those are the caller's job (routes/importJobs.ts or wherever this
// gets wired in), kept separate so this correctness-critical part can
// be tested in isolation the same way importEngine.ts's core is.

export interface DatedCountEntry {
  date: string // 'YYYY-MM-DD'
  productId: number
  productName: string
  branchId: number
  branchName: string
  count: number // the physical count as of `date` -- an ABSOLUTE
  // quantity, same convention as the existing "Set stock to X" UI field,
  // not a delta.
}

// A movement this SAME import mechanism created on a previous run,
// identified by (productId, branchId, date). `signedQuantity` is the
// delta that movement actually applied (positive for an 'add', negative
// for a 'remove') -- needed to reconstruct the pre-that-movement
// baseline on a rerun; see computeDatedStockCountPlan's baseline
// reconstruction below for why. `batchActions` is that same movement's
// own batch-level provenance (migration 0035, Part 286) -- which real
// product_batches row(s) it topped up/created/drained and by how much;
// undefined/empty for a movement that predates this tracking, or one that
// only ever touched the plain aggregate (never a tracked batch). Lets a
// rerun reverse only ITS OWN prior batch effects before recomputing,
// instead of being forced to skip batch actions on every rerun.
export interface ExistingCountMovement {
  id: number
  productId: number
  branchId: number
  date: string
  signedQuantity: number
  batchActions?: { batchId: number; quantity: number }[]
}

export interface CurrentStock {
  productId: number
  branchId: number
  quantity: number
}

export interface StockCountPlanMovement {
  productId: number
  productName: string
  branchId: number
  branchName: string
  date: string
  quantity: number // always positive -- the magnitude; movementType carries direction
  movementType: 'add' | 'remove'
  reason: string
}

// A batch that already exists (in `product_batches`/`branch_batch_stock`)
// for one product+branch, as of just before this plan runs. `date` is the
// batch's own received-date code (see batchCode.ts's dateToBatchCode) --
// the thing an "add" on that same date should top up, and what FIFO
// ordering (oldest date first) walks across for a "remove".
export interface ExistingBatchState {
  batchId: number
  productId: number
  branchId: number
  date: string // 'YYYY-MM-DD'
  quantity: number // currently available at this branch
}

export interface BatchTopUp {
  productId: number
  branchId: number
  batchId: number
  date: string
  quantity: number // amount added to this existing batch
}

export interface BatchCreate {
  productId: number
  branchId: number
  date: string
  quantity: number // amount the caller should create a brand-new batch for, dated to `date`
}

export interface BatchDrain {
  productId: number
  branchId: number
  batchId: number
  quantity: number // amount FIFO-removed from this existing batch
}

export interface StockCountPlan {
  // Existing movement ids to delete first (superseded by this run's
  // fresh computation for the same product+branch+date).
  movementsToDelete: number[]
  // New movements to insert, in the order they should be applied
  // (earliest date first within each product+branch group).
  movementsToCreate: StockCountPlanMovement[]
  // What branch_stock.quantity should be set to for every product+branch
  // this import touched, once movementsToCreate have all been applied.
  finalBranchStock: CurrentStock[]
  // Batch-level FIFO allocation (item 3's spec: an add creates/tops up a
  // batch dated to that snapshot's date; a decrease drains the earliest
  // still-open batch first). Computed for every product+branch group,
  // first import or rerun alike -- a rerun's own prior batch actions
  // (migration 0035's provenance) are reversed from the group's batch
  // baseline before this is recomputed fresh, the same idea
  // movementsToDelete/baseline reconstruction above already uses for the
  // aggregate side. See computeDatedStockCountPlan's own
  // reconstructBatchBaseline step for exactly how.
  batchTopUps: BatchTopUp[]
  batchCreates: BatchCreate[]
  batchDrains: BatchDrain[]
  // Existing batches this run's drains left at exactly 0 -- caller should
  // mark these product_batches rows inactive (same as any other
  // FIFO-drain-to-empty, matching removeStockAcrossBatches's convention).
  batchDeactivations: { productId: number; branchId: number; batchId: number }[]
}

export const DATED_STOCK_COUNT_REASON = 'Dated stock count import'

function groupKey(productId: number, branchId: number): string {
  return `${productId}:${branchId}`
}

// Batch-level FIFO layer for ONE product+branch group's already-computed
// dated delta series. `deltas` is `[date, signedDelta]` pairs in the same
// earliest-to-latest order the caller already sorted (signedDelta > 0 is
// an add, < 0 is a remove, 0 is skipped by the caller before this is
// called). `existingBatches` is that group's batch baseline -- already
// reconstructed by the caller (reconstructBatchBaseline, below) to
// reflect what each batch held BEFORE this same importer's own prior
// runs for the dates being replaced, so a rerun's fresh replay starts
// from the right lot quantities instead of double-counting its own past
// batch actions. FIFO-ordered (oldest date first -- caller is
// responsible for that ordering, same contract listBatchesForProduct's
// callers already rely on).
//
// Simulates a single ordered "lot queue" -- the group's reconstructed
// existing batches plus any brand-new batch this same run creates along
// the way -- so that a later date's decrease can correctly FIFO-drain a
// batch this same run added earlier, not just batches that predate this
// import. A brand-new batch that gets fully drained again within this
// same run nets out to never being created at all (there's nothing to
// persist -- it never existed for any real duration from the caller's
// point of view).
function computeBatchPlanForGroup(
  productId: number,
  branchId: number,
  deltas: { date: string; delta: number }[],
  existingBatches: ExistingBatchState[],
): { topUps: BatchTopUp[]; creates: BatchCreate[]; drains: BatchDrain[]; deactivations: { productId: number; branchId: number; batchId: number }[] } {
  type Lot = { kind: 'existing'; batchId: number; date: string; remaining: number } | { kind: 'new'; date: string; remaining: number }

  const queue: Lot[] = existingBatches
    .map((batch): Lot => ({ kind: 'existing', batchId: batch.batchId, date: batch.date, remaining: batch.quantity }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const topUpTotals = new Map<number, number>() // batchId -> cumulative added this run
  const drainTotals = new Map<number, number>() // batchId -> cumulative removed this run

  function findOrCreateLotForDate(date: string): Lot {
    const existing = queue.find((lot) => lot.date === date)
    if (existing) return existing
    const created: Lot = { kind: 'new', date, remaining: 0 }
    queue.push(created)
    queue.sort((a, b) => a.date.localeCompare(b.date))
    return created
  }

  for (const { date, delta } of deltas) {
    if (delta > 0) {
      const lot = findOrCreateLotForDate(date)
      lot.remaining += delta
      if (lot.kind === 'existing') {
        topUpTotals.set(lot.batchId, (topUpTotals.get(lot.batchId) || 0) + delta)
      }
    } else if (delta < 0) {
      let remaining = -delta
      for (const lot of queue) {
        if (remaining <= 0) break
        if (lot.remaining <= 0) continue
        const take = Math.min(remaining, lot.remaining)
        lot.remaining -= take
        remaining -= take
        if (lot.kind === 'existing') {
          drainTotals.set(lot.batchId, (drainTotals.get(lot.batchId) || 0) + take)
        }
      }
      // Any shortfall (this group's tracked batches can't cover the full
      // decrease) is left untracked at the batch level, same as
      // removeStockAcrossBatches's own "remainder" convention -- the
      // aggregate movement above already accounts for the full amount
      // either way.
    }
  }

  const topUps: BatchTopUp[] = []
  for (const [batchId, quantity] of topUpTotals) {
    if (quantity > 0) topUps.push({ productId, branchId, batchId, date: existingBatches.find((b) => b.batchId === batchId)!.date, quantity })
  }

  const drains: BatchDrain[] = []
  const deactivations: { productId: number; branchId: number; batchId: number }[] = []
  for (const [batchId, quantity] of drainTotals) {
    if (quantity > 0) drains.push({ productId, branchId, batchId, quantity })
    const lot = queue.find((entry) => entry.kind === 'existing' && entry.batchId === batchId)
    if (lot && lot.remaining <= 0) deactivations.push({ productId, branchId, batchId })
  }

  const creates: BatchCreate[] = queue
    .filter((lot): lot is Lot & { kind: 'new' } => lot.kind === 'new' && lot.remaining > 0)
    .map((lot) => ({ productId, branchId, date: lot.date, quantity: lot.remaining }))

  return { topUps, creates, drains, deactivations }
}

// Un-does THIS group's own prior batch actions from its current batch
// quantities, for exactly the movements about to be deleted/replaced
// (`deletedMovements` -- already the same subset computeDatedStockCountPlan
// is about to push onto movementsToDelete for this group). Mirrors the
// aggregate baseline reconstruction above (`baseline -= existing.
// signedQuantity`) at the batch level: sums each batch's own past deltas
// from THESE movements' `batchActions` (migration 0035 provenance) and
// subtracts that sum from the batch's live quantity, so the fresh replay
// below starts from what each batch held before this importer's own past
// runs touched it -- not from today's live figure, which already
// reflects them on a rerun. Any OTHER change to a batch since (a real
// sale, a manual adjustment, an unrelated receive) is left alone, same
// "only reverse this importer's own past effect" scope the aggregate
// side already limits itself to. Floors at 0 defensively -- a correctly
// functioning rerun should never produce a negative reconstructed
// baseline, but this guards against silently going negative if it ever
// does (matches this codebase's standing MAX(0, ...) stock-floor
// convention elsewhere).
function reconstructBatchBaseline(
  groupBatches: ExistingBatchState[],
  deletedMovements: ExistingCountMovement[],
): ExistingBatchState[] {
  const priorDeltaByBatch = new Map<number, number>()
  for (const movement of deletedMovements) {
    for (const action of movement.batchActions || []) {
      priorDeltaByBatch.set(action.batchId, (priorDeltaByBatch.get(action.batchId) || 0) + action.quantity)
    }
  }
  if (priorDeltaByBatch.size === 0) return groupBatches
  return groupBatches.map((batch) => ({
    ...batch,
    quantity: Math.max(0, batch.quantity - (priorDeltaByBatch.get(batch.batchId) || 0)),
  }))
}

// Computes the plan. Pure function -- same inputs always produce the
// same outputs, so a rerun (same file, or a corrected version of it) is
// idempotent: the plan first "undoes" this import's own prior
// movements for the dates being replaced (from the running baseline,
// not from live stock -- see below), then recomputes the whole dated
// series fresh from that baseline.
export function computeDatedStockCountPlan(
  entries: DatedCountEntry[],
  existingCountMovements: ExistingCountMovement[],
  currentStock: CurrentStock[],
  existingBatches: ExistingBatchState[] = [],
): StockCountPlan {
  const groups = new Map<string, DatedCountEntry[]>()
  for (const entry of entries) {
    const key = groupKey(entry.productId, entry.branchId)
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }

  const stockByKey = new Map<string, number>()
  for (const stock of currentStock) stockByKey.set(groupKey(stock.productId, stock.branchId), stock.quantity)

  const existingByKey = new Map<string, ExistingCountMovement[]>()
  for (const movement of existingCountMovements) {
    const key = groupKey(movement.productId, movement.branchId)
    const bucket = existingByKey.get(key)
    if (bucket) bucket.push(movement)
    else existingByKey.set(key, [movement])
  }

  const batchesByKey = new Map<string, ExistingBatchState[]>()
  for (const batch of existingBatches) {
    const key = groupKey(batch.productId, batch.branchId)
    const bucket = batchesByKey.get(key)
    if (bucket) bucket.push(batch)
    else batchesByKey.set(key, [batch])
  }

  const movementsToDelete: number[] = []
  const movementsToCreate: StockCountPlanMovement[] = []
  const finalBranchStock: CurrentStock[] = []
  const batchTopUps: BatchTopUp[] = []
  const batchCreates: BatchCreate[] = []
  const batchDrains: BatchDrain[] = []
  const batchDeactivations: { productId: number; branchId: number; batchId: number }[] = []

  for (const [key, groupEntries] of groups) {
    const [productIdStr, branchIdStr] = key.split(':')
    const productId = Number(productIdStr)
    const branchId = Number(branchIdStr)

    // Earliest to latest -- Part 234's confirmed semantics for repeated
    // dated counts of the same product: apply as a sequential series,
    // not latest-wins.
    const sorted = [...groupEntries].sort((a, b) => a.date.localeCompare(b.date))
    const dateSet = new Set(sorted.map((entry) => entry.date))

    let baseline = stockByKey.get(key) ?? 0

    // Reconstruct the baseline stock had BEFORE this import's own prior
    // movements for these exact dates -- not today's live stock, which
    // already reflects them on a rerun. Only this import's own
    // previously-created movements are undone here; any unrelated
    // movement on this product/branch (a sale, a manual adjustment) that
    // happened since is assumed to still be correct and is left alone,
    // not replayed -- reconciling against those is a different, harder
    // problem (would need to know WHEN relative to the count series they
    // happened), out of scope for this pass.
    const deletedMovements: ExistingCountMovement[] = []
    for (const existing of existingByKey.get(key) || []) {
      if (dateSet.has(existing.date)) {
        movementsToDelete.push(existing.id)
        deletedMovements.push(existing)
        baseline -= existing.signedQuantity
      }
    }

    let running = baseline
    const deltas: { date: string; delta: number }[] = []
    for (const entry of sorted) {
      const delta = entry.count - running
      if (delta !== 0) {
        movementsToCreate.push({
          productId,
          productName: entry.productName,
          branchId,
          branchName: entry.branchName,
          date: entry.date,
          quantity: Math.abs(delta),
          movementType: delta > 0 ? 'add' : 'remove',
          reason: DATED_STOCK_COUNT_REASON,
        })
      }
      deltas.push({ date: entry.date, delta })
      running = entry.count
    }

    finalBranchStock.push({ productId, branchId, quantity: running })

    // Batch actions for every group, first import or rerun alike --
    // reconstructBatchBaseline undoes this group's own prior batch
    // provenance (from the movements just deleted above) so the fresh
    // replay below starts from the right lot quantities instead of
    // double-counting a previous run's own batch effects.
    const groupBatches = batchesByKey.get(key) || []
    const reconstructed = reconstructBatchBaseline(groupBatches, deletedMovements)
    const batchPlan = computeBatchPlanForGroup(productId, branchId, deltas, reconstructed)
    batchTopUps.push(...batchPlan.topUps)
    batchCreates.push(...batchPlan.creates)
    batchDrains.push(...batchPlan.drains)
    batchDeactivations.push(...batchPlan.deactivations)
  }

  return { movementsToDelete, movementsToCreate, finalBranchStock, batchTopUps, batchCreates, batchDrains, batchDeactivations }
}
