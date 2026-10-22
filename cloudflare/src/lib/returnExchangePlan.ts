import type { BranchEffect } from './branchEffect'
import { allocateAcrossLots, planReceiveBatchStock, type FifoLotAvailability } from './productBatches'
import { planReturnLot, ReturnLotRequiredError } from './returnsStock'
import type { ExchangeContext } from './returnExchangeContext'

// The stock side of a one-step exchange, decided in memory from the one context read, before any write: which lots the returned
// units go back into, which lots the replacement units leave, the branch and lot deltas the write applies, and the before/after
// figures the commit proves. Mirrors what createCustomerReturn does line by line for a v0 exchange, minus every query.

export type ExchangeStockAction = 'none' | 'restock' | 'damaged'

export type ExchangeReturnLine = {
  sale_item_id: number
  product_id: number | null
  product_name: string | null
  quantity: number
  /** The branch the units land on (after any retired-branch redirect). */
  branch_id: number | null
  /** The lot the operator picked, when the sale line cannot say. */
  batch_id: number | null
  stock_action: ExchangeStockAction
  cost_price_usd: number | null
  cost_price_khr: number | null
  /** The lot recorded on the sale line itself. */
  sold_batch_id: number | null
  effect: BranchEffect | null
}

export type ExchangeReplacementStockLine = {
  productId: number
  productName: string
  branchId: number
  /** An explicit pick; null = the oldest lots first. */
  batchId: number | null
  quantity: number
}

export type ExchangeLotTake = { batchId: number; lotCode: string | null; expiryDate: string | null; quantity: number }
export type ExchangeLotPlan = { splits: Array<{ batchId: number; quantity: number }>; plainQuantity: number }
export type ExchangeFallbackLot = {
  lineIndex: number; productId: number; branchId: number; quantity: number
  batchKey: string; lotCode: string; receivedAt: string; notes: string
}

export type ExchangeRefusal = { status: 400 | 409; body: Record<string, unknown> }

export type ExchangeStockPlan = {
  lotPlans: ExchangeLotPlan[]
  fallbackLots: ExchangeFallbackLot[]
  replacementTakes: ExchangeLotTake[][]
  branchSnapshots: Array<{ product_id: number; branch_id: number; delta: number; before: number; after: number }>
  batchSnapshots: Array<{
    batch_id: number; product_id: number; branch_id: number; delta: number; requires_active: number
    is_active: number; lot_code: string; expiry_date: string; before: number; after: number
  }>
  /** Units that go back into an existing lot, per lot (the lot's received quantity moves with them, as a receive does). */
  lotRestocks: Array<{ batch_id: number; quantity: number }>
  touchedProductIds: number[]
  returnAllocationCount: number
  saleAllocationCount: number
}

const pairKey = (productId: number, branchId: number) => `${productId}:${branchId}`

export function returnReceivedDate(occurredAt: string): string {
  return new Date(Date.parse(occurredAt) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Which lots each returned line goes back into: the picked lot, else the lots the sale line drew from (newest first), else the line's own lot. */
export function planExchangeReturnLots(lines: readonly ExchangeReturnLine[], ctx: ExchangeContext, productNames: ReadonlyMap<number, string>, fallbackBranchId: number | null):
  { ok: true; lotPlans: ExchangeLotPlan[] } | { ok: false; refusal: ExchangeRefusal } {
  const lotPlans: ExchangeLotPlan[] = []
  for (const line of lines) {
    const productId = Number(line.product_id)
    const lineBranchId = Number(line.branch_id || fallbackBranchId)
    if (line.stock_action !== 'restock' || !productId || !lineBranchId) {
      lotPlans.push({ splits: [], plainQuantity: 0 })
      continue
    }
    const plan = planReturnLot({
      allocations: ctx.allocations.get(line.sale_item_id) || [],
      saleLineBatchId: line.sold_batch_id,
      operatorBatchId: Number(line.batch_id) > 0 ? Number(line.batch_id) : null,
      quantity: line.quantity, lotTracked: false,
    })
    if (plan.requiresLotPick) {
      const error = new ReturnLotRequiredError(line.product_name?.trim() || productNames.get(productId) || `product #${productId}`, line.quantity)
      return { ok: false, refusal: { status: 400, body: { error: error.message, code: error.code, product_id: productId } } }
    }
    lotPlans.push({ splits: plan.splits, plainQuantity: plan.plainQuantity })
  }
  return { ok: true, lotPlans }
}

function fifoLotsFor(ctx: ExchangeContext, productId: number, branchId: number): FifoLotAvailability[] {
  const lots: Array<FifoLotAvailability & { batchNumber: number }> = []
  for (const lot of ctx.lots.values()) {
    if (lot.product_id !== productId || Number(lot.is_active) !== 1) continue
    const available = ctx.lotStock.get(`${lot.id}:${branchId}`) ?? 0
    if (!(available > 0)) continue
    lots.push({ batchId: lot.id, lotCode: lot.lot_code, receivedAt: lot.received_at, expiryDate: lot.expiry_date, available, batchNumber: lot.batch_number ?? 0 })
  }
  // Oldest received first, undated last, then batch number and id: the order readFifoLotAvailabilityForCart reads.
  lots.sort((a, b) => Number(a.receivedAt == null) - Number(b.receivedAt == null)
    || (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') || a.batchNumber - b.batchNumber || a.batchId - b.batchId)
  return lots.map(({ batchNumber: _batchNumber, ...lot }) => lot)
}

export function planExchangeStock(input: {
  ctx: ExchangeContext
  returnLines: readonly ExchangeReturnLine[]
  replacementLines: readonly ExchangeReplacementStockLine[]
  lotPlans: readonly ExchangeLotPlan[]
  /** `${effect branch}:${folded lot}` -> the lot that survived the fold, for a redirected return. */
  lotSurvivors: ReadonlyMap<string, number>
  headerBranchId: number | null
  clientRequestId: string
  occurredAt: string
}): { ok: true; plan: ExchangeStockPlan } | { ok: false; refusal: ExchangeRefusal } {
  const { ctx } = input
  const refuse = (status: 400 | 409, body: Record<string, unknown>) => ({ ok: false as const, refusal: { status, body } })
  const effectiveBatchId = (index: number, batchId: number | null): number | null => {
    const effect = input.returnLines[index].effect
    return batchId != null && effect?.redirected ? input.lotSurvivors.get(`${effect.effectBranchId}:${batchId}`) ?? batchId : batchId
  }
  const lotPlans: ExchangeLotPlan[] = input.lotPlans.map((plan, index) => {
    if (!plan.splits.length) return plan
    const merged = new Map<number, number>()
    for (const split of plan.splits) {
      const batchId = effectiveBatchId(index, split.batchId)!
      merged.set(batchId, (merged.get(batchId) || 0) + split.quantity)
    }
    return { splits: [...merged].map(([batchId, quantity]) => ({ batchId, quantity })), plainQuantity: plan.plainQuantity }
  })

  // ---- the replacement units: explicit lots must belong to the product, the rest leave the oldest lots first ----------------
  const fifo = new Map<string, FifoLotAvailability[]>()
  const replacementTakes: ExchangeLotTake[][] = []
  for (const [index, line] of input.replacementLines.entries()) {
    if (line.batchId != null) {
      const lot = ctx.lots.get(line.batchId)
      if (!lot || Number(lot.is_active) !== 1 || lot.product_id !== line.productId) {
        return refuse(400, { error: 'Selected received date does not belong to this replacement product' })
      }
      replacementTakes[index] = [{ batchId: line.batchId, lotCode: lot.lot_code, expiryDate: lot.expiry_date, quantity: line.quantity }]
      continue
    }
    const key = pairKey(line.productId, line.branchId)
    if (!fifo.has(key)) fifo.set(key, fifoLotsFor(ctx, line.productId, line.branchId))
    const lots = fifo.get(key)!
    const { takes, uncovered } = allocateAcrossLots(lots, line.quantity)
    if (uncovered > 0 && takes.length > 0) {
      return refuse(409, {
        error: `Not enough lot stock to hand out ${line.quantity} of "${line.productName}": tracked lots cover only ${line.quantity - uncovered}.`,
        code: 'replacement_lot_shortfall',
      })
    }
    replacementTakes[index] = takes.map((take) => {
      const lot = lots.find((candidate) => candidate.batchId === take.batchId)
      return { batchId: take.batchId, lotCode: lot?.lotCode ?? null, expiryDate: lot?.expiryDate ?? null, quantity: take.quantity }
    })
    for (const take of takes) {
      const lot = lots.find((candidate) => candidate.batchId === take.batchId)
      if (lot) lot.available -= take.quantity
    }
  }

  // ---- deltas ------------------------------------------------------------------------------------------------------------
  const branchDeltas = new Map<string, { product_id: number; branch_id: number; delta: number }>()
  const batchDeltas = new Map<string, { batch_id: number; product_id: number; branch_id: number; delta: number; requires_active: number }>()
  const addBranch = (productId: number, branchId: number, delta: number) => {
    const key = pairKey(productId, branchId)
    const current = branchDeltas.get(key) || { product_id: productId, branch_id: branchId, delta: 0 }
    current.delta += delta
    branchDeltas.set(key, current)
  }
  const addBatch = (batchId: number, productId: number, branchId: number, delta: number, requiresActive: boolean) => {
    const key = `${batchId}:${branchId}`
    const current = batchDeltas.get(key) || { batch_id: batchId, product_id: productId, branch_id: branchId, delta: 0, requires_active: 0 }
    current.delta += delta
    if (requiresActive) current.requires_active = 1
    batchDeltas.set(key, current)
  }
  const restocks = new Map<number, number>()
  const fallbackLots: ExchangeFallbackLot[] = []
  let returnAllocationCount = 0
  const touched = new Set<number>()
  for (const [index, line] of input.returnLines.entries()) {
    if (line.stock_action !== 'restock' || !line.product_id || !(line.branch_id || input.headerBranchId)) continue
    const productId = Number(line.product_id)
    const branchId = Number(line.branch_id || input.headerBranchId)
    addBranch(productId, branchId, line.quantity)
    const plan = lotPlans[index]
    for (const split of plan.splits) {
      addBatch(split.batchId, productId, branchId, split.quantity, false)
      restocks.set(split.batchId, (restocks.get(split.batchId) || 0) + split.quantity)
      returnAllocationCount += 1
    }
    if (plan.plainQuantity > 0) {
      // Unattributed units receive their own dated return-event lot, keyed by this request and line.
      const receive = planReceiveBatchStock({
        productId, branchId, quantity: plan.plainQuantity, receivedDate: returnReceivedDate(input.occurredAt),
        provenanceKey: `return:${input.clientRequestId}:${index}`, notes: 'Received from customer return; original received date unavailable',
      })
      fallbackLots.push({ lineIndex: index, productId, branchId, quantity: plan.plainQuantity, batchKey: receive.batchKey, lotCode: receive.lotCode, receivedAt: receive.receivedAt, notes: 'Received from customer return; original received date unavailable' })
      returnAllocationCount += 1
    }
    touched.add(productId)
  }
  let saleAllocationCount = 0
  for (const [index, line] of input.replacementLines.entries()) {
    addBranch(line.productId, line.branchId, -line.quantity)
    for (const take of replacementTakes[index]) {
      addBatch(take.batchId, line.productId, line.branchId, -take.quantity, true)
      saleAllocationCount += 1
    }
    touched.add(line.productId)
  }

  // ---- what the commit proves: the figures as read, and as they must stand after ----------------------------------------------
  const branchSnapshots = [...branchDeltas.values()].map((entry) => {
    const before = ctx.branchStock.get(pairKey(entry.product_id, entry.branch_id)) ?? 0
    return { ...entry, before, after: before + entry.delta }
  })
  if (branchSnapshots.some((row) => row.after < 0)) return refuse(409, { error: 'Replacement stock changed. Reload and try again.', code: 'write_conflict' })
  const batchSnapshots: ExchangeStockPlan['batchSnapshots'] = []
  for (const entry of batchDeltas.values()) {
    const lot = ctx.lots.get(entry.batch_id)
    if (!lot || lot.product_id !== entry.product_id || (entry.requires_active === 1 && Number(lot.is_active) !== 1)) {
      return refuse(409, { error: 'A selected received date is no longer active for this product', code: 'write_conflict' })
    }
    const before = ctx.lotStock.get(`${entry.batch_id}:${entry.branch_id}`) ?? 0
    if (before + entry.delta < 0) return refuse(409, { error: 'Replacement stock changed. Reload and try again.', code: 'write_conflict' })
    batchSnapshots.push({
      ...entry, is_active: Number(lot.is_active), lot_code: lot.lot_code || '', expiry_date: lot.expiry_date || '',
      before, after: before + entry.delta,
    })
  }
  return {
    ok: true,
    plan: {
      lotPlans, fallbackLots, replacementTakes, branchSnapshots, batchSnapshots,
      lotRestocks: [...restocks].map(([batch_id, quantity]) => ({ batch_id, quantity })),
      touchedProductIds: [...touched], returnAllocationCount, saleAllocationCount,
    },
  }
}
