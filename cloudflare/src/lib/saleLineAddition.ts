// Adding a line to a sale that already exists (S4-24b).
//
// The Sales page could change a sale's status, its customer and its
// membership, but never its CONTENTS -- a customer who came back to the
// counter two minutes after paying and asked for one more item had to be
// rung up as a second, unrelated sale, so the receipt the shop keeps and
// the goods that actually left the shop disagreed.
//
// This module is the pure kernel for that write, deliberately separated
// from routes/sales.ts the same way lib/saleTransitions.ts and
// lib/saleTotals.ts were: the arithmetic that decides how many units leave
// the shelf is the part that must be directly testable, not reachable only
// through a live request. scripts/test-sale-add-items-pure.cjs drives every
// function here against a real in-memory schema with the same CHECK
// constraints production has.
//
// THE FIVE DECISIONS, stated once, here, because each one is a rule about
// money or stock and none of them should be inferred from the code:
//
// 1. WHICH STATUSES ACCEPT A NEW LINE -- see
//    SALE_STATUSES_ACCEPTING_NEW_LINES / guardSaleLineAddition below.
//
// 2. STOCK -- a line added to a status that holds stock deducted (since
//    S4-3 that is completed / awaiting_payment / awaiting_delivery, i.e.
//    STOCK_DEDUCTED_STATUSES) moves stock NOW; a line added to a sale that
//    holds nothing (cancelled is refused outright, and a stock_skipped sale
//    passes skipStock) moves none. The units moved are not a
//    second opinion: they are heldQuantity(status, quantity, 0) straight
//    out of lib/saleTransitions.ts, the same invariant PATCH /:id/status
//    moves stock by. The lots are picked by allocateAcrossLots over
//    readFifoLotAvailability(ForCart) -- the checkout's own FIFO rule,
//    called, not re-implemented -- and the decrements are the same strict
//    (unclamped) statements, so branch_stock/branch_batch_stock's
//    CHECK(quantity >= 0) stays the real race guard.
//
// 3. TOTALS -- see recomputeSaleMoneyAfterLineChange below.
//
// 4. UNDO -- planSaleLineRemoval below is the exact inverse, and it is what
//    the 'sale.add_items' undo applier replays. It returns stock to the SAME
//    lots the addition drew from, in reverse draw order, as new 'return'
//    movements (the standing rule: add stock back with a note, never edit
//    the original movements).
//
// 5. PERMISSION -- enforced in routes/sales.ts on the sales/add_items action
//    tier, and declared again by the undo applier, so a replay is gated as
//    tightly as the forward write.

import { RETURN_STATUSES, STOCK_DEDUCTED_STATUSES } from './salesStatus'
import { heldQuantity } from './saleTransitions'
import {
  allocateAcrossLots,
  decrementBatchStockStrictStatement,
  incrementBatchStockStatement,
  type FifoLotAvailability,
  type FifoLotTake,
} from './productBatches'
import { computeSaleTotals, round2, type SaleTotals } from './saleTotals'

export type StockStatement = { sql: string; params: Record<string, unknown> }

// ---------------------------------------------------------------------------
// DECISION 1: which sale statuses accept new lines.
//
//   completed          YES -- the everyday case ("one more of these please",
//                      seconds after the receipt printed). Stock is out for
//                      this sale, so the new line's stock goes out too.
//   awaiting_delivery  YES -- same reasoning: the goods are already
//                      committed and on their way, and an added line rides
//                      the same delivery.
//   awaiting_payment   YES -- and since S4-3 the added line's stock goes out
//                      too, exactly like `completed`. An unpaid order holds
//                      its units (they are promised to that buyer), so an
//                      added line takes its units off the shelf now rather
//                      than at some later completing transition.
//   cancelled          NO  -- a cancelled sale is a corrective record of a
//                      sale that did not happen. Adding goods to it would
//                      claim a sale nobody made, and un-cancelling would
//                      then deduct stock for a line no customer ever took.
//   partial_return     NO  -- these two belong to the returns flow, exactly
//   returned           as guardSaleStatusTransition says. Every return
//                      record was written against the line set that existed
//                      when it was recorded, and held() for the sale is
//                      computed from that pairing; adding a line underneath
//                      recorded returns silently changes what "already came
//                      back" means. The shop's answer for "they returned one
//                      thing and bought another" is a return plus a new
//                      sale, which is what the Returns page already does.
//
// A sale that has ANY recorded return is refused as well, whatever its
// status says -- the route passes hasRecordedReturns, so an imported or
// legacy row still labelled 'completed' underneath real return records
// cannot slip past the status check.
// ---------------------------------------------------------------------------
export const SALE_STATUSES_ACCEPTING_NEW_LINES: ReadonlySet<string> = new Set<string>([
  'completed',
  'awaiting_delivery',
  'awaiting_payment',
])

export type LineAdditionGuardResult = { ok: true } | { ok: false; error: string }

export function guardSaleLineAddition(status: string, hasRecordedReturns = false): LineAdditionGuardResult {
  const normalized = String(status || 'completed')
  if (normalized === 'cancelled') {
    return { ok: false, error: 'This sale was cancelled, so nothing can be added to it. Un-cancel it first, or record a new sale.' }
  }
  if (RETURN_STATUSES.has(normalized) || hasRecordedReturns) {
    return { ok: false, error: 'This sale has recorded returns, so its contents are managed by the Returns flow. Record a new sale for anything the customer is buying now.' }
  }
  if (!SALE_STATUSES_ACCEPTING_NEW_LINES.has(normalized)) {
    return { ok: false, error: `Items cannot be added to a sale in the "${normalized}" state.` }
  }
  return { ok: true }
}

/**
 * True when a sale in this status holds its stock deducted.
 *
 * STATUS ONLY. A sale carrying S4-2's sticky `stock_skipped` flag holds
 * nothing regardless of what its status says, and this function cannot see
 * that -- callers must combine it with saleAmendments.saleSkipsStock(sale),
 * which is what `skipStock` below exists to carry.
 */
export function saleStatusDeductsStock(status: string): boolean {
  return STOCK_DEDUCTED_STATUSES.has(String(status || 'completed'))
}

// ---------------------------------------------------------------------------
// The line as the caller asked for it, and the line once the FIFO allocation
// has decided which lots it draws from.
// ---------------------------------------------------------------------------

export type NewSaleLineInput = {
  productId: number
  productName: string
  quantity: number
  branchId: number | null
  unitPriceUsd: number
  costPriceUsd: number
  costPriceKhr: number
  /** An explicit lot pick, when the caller had a picker. Null = FIFO. */
  batchId?: number | null
  batchLabel?: string | null
  batchExpiryDate?: string | null
}

export type ExplicitBatchResolution =
  | { ok: true; lines: NewSaleLineInput[] }
  | { ok: false; error: string }

/**
 * Resolve every client-selected lot against the authoritative active stock
 * read for that product and branch. A missing entry deliberately covers all
 * unsafe identities (unknown, another product, inactive, or another branch):
 * none is a sellable lot for this line. Quantities are consumed in a private
 * availability copy so repeated lines cannot collectively overdraw one lot.
 * Client lot metadata is never retained.
 */
export function resolveExplicitSaleLineBatches(
  lines: NewSaleLineInput[],
  lotsByKey: Map<string, FifoLotAvailability[]>,
): ExplicitBatchResolution {
  const remaining = new Map<string, number>()
  const resolved: NewSaleLineInput[] = []

  for (const [index, line] of lines.entries()) {
    if (!line.batchId) {
      resolved.push(line)
      continue
    }
    if (!line.branchId) {
      return { ok: false, error: `Added item #${index + 1} cannot use a batch without a branch.` }
    }

    const key = `${line.productId}:${line.branchId}`
    const batchId = Number(line.batchId)
    const lot = (lotsByKey.get(key) || []).find((entry) => entry.batchId === batchId)
    if (!lot) {
      return { ok: false, error: `Batch #${batchId} is not an active, available lot for added item #${index + 1} at this branch.` }
    }

    const availabilityKey = `${key}:${batchId}`
    const available = remaining.has(availabilityKey) ? remaining.get(availabilityKey)! : lot.available
    const quantity = Math.max(0, Number(line.quantity) || 0)
    if (quantity > available) {
      return { ok: false, error: `Insufficient batch stock for added item #${index + 1}: requested ${quantity}, available ${available}.` }
    }
    remaining.set(availabilityKey, available - quantity)
    resolved.push({
      ...line,
      batchId,
      batchLabel: lot.lotCode ?? null,
      batchExpiryDate: lot.expiryDate ?? null,
    })
  }

  return { ok: true, lines: resolved }
}

export type PlannedSaleLine = NewSaleLineInput & {
  lineTotalUsd: number
  /** heldQuantity(status, quantity, 0): the units this line takes off the shelf now. */
  heldUnits: number
  /** Which lots it draws from, in draw order. Empty for untracked (legacy) stock. */
  takes: FifoLotTake[]
  /**
   * inventory_movements.batch_id is attributable only when ONE lot covered
   * the whole line -- identical rule to POST / and planSaleStockTransition
   * (migration 0084). The per-lot detail lives in
   * sale_item_batch_allocations.
   */
  movementBatchId: number | null
}

/**
 * Split each line across the product's FIFO lots at its branch, consuming
 * the shared availability map as it goes so two lines of the same product in
 * one request cannot double-take the same units -- the same in-place
 * mutation POST /'s auto-allocation pass does.
 *
 * An explicit batchId short-circuits the FIFO walk (the cashier picked the
 * lot); a line whose product has no lot ledger at all gets no takes and
 * simply rides branch_stock, exactly as an untracked checkout line does.
 *
 * `skipStock` is S4-2's sticky "this sale is outside the stock ledger" flag,
 * passed EXPLICITLY rather than smuggled in as a status the caller knows
 * holds nothing. Callers used to pass a literal 'awaiting_payment' for that,
 * which was correct only for as long as awaiting_payment happened to hold
 * nothing -- S4-3 made it hold, and that sentinel would have inverted into a
 * full deduction on exactly the sales that must never move stock. The plan
 * takes the fact it needs, not a status stand-in for it.
 */
export function allocateNewSaleLines(
  lines: NewSaleLineInput[],
  lotsByKey: Map<string, FifoLotAvailability[]>,
  saleStatus: string,
  skipStock = false,
): PlannedSaleLine[] {
  return lines.map((line) => {
    const quantity = Math.max(0, Number(line.quantity) || 0)
    const unitPriceUsd = Number(line.unitPriceUsd) || 0
    const heldUnits = skipStock ? 0 : heldQuantity(saleStatus, quantity, 0)
    let takes: FifoLotTake[] = []
    if (line.branchId && quantity > 0) {
      if (line.batchId) {
        takes = [{
          batchId: Number(line.batchId),
          lotCode: line.batchLabel ?? null,
          expiryDate: line.batchExpiryDate ?? null,
          quantity,
        }]
        // Keep the shared availability honest for a later line of the same
        // product, the same way the FIFO branch below does.
        const lot = (lotsByKey.get(`${line.productId}:${line.branchId}`) || [])
          .find((entry) => entry.batchId === Number(line.batchId))
        if (lot) lot.available -= quantity
      } else {
        const lots = lotsByKey.get(`${line.productId}:${line.branchId}`) || []
        const allocated = allocateAcrossLots(lots, quantity)
        takes = allocated.takes
        for (const take of takes) {
          const lot = lots.find((entry) => entry.batchId === take.batchId)
          if (lot) lot.available -= take.quantity
        }
      }
    }
    return {
      ...line,
      quantity,
      unitPriceUsd,
      lineTotalUsd: round2(unitPriceUsd * quantity),
      heldUnits,
      takes,
      movementBatchId: takes.length === 1 && takes[0].quantity === quantity ? takes[0].batchId : null,
    }
  })
}

export type SaleLineAdditionPlan = {
  lines: PlannedSaleLine[]
  /** sale_items INSERTs interleaved with their stock moves, in batch order. */
  statements: StockStatement[]
  /** Index into `statements` of each line's own sale_items INSERT, by line index. */
  saleItemStatementIndexByLine: number[]
  /** Per product+branch units that must be TAKEN, for the route's pre-flight read. */
  deductions: Array<{ product_id: number; branch_id: number; quantity: number }>
  deductedUnits: number
  addedSubtotalUsd: number
}

/**
 * DECISION 2. The whole write for a set of added lines: one sale_items row
 * each, plus -- only when the sale's status holds stock deducted -- the same
 * four stock statements a checkout line emits (strict batch decrement, plain
 * branch_stock subtraction, products.stock_quantity rollup, and the 'sale'
 * movement). Nothing here is clamped: an oversell has to abort the batch
 * through the CHECK constraint rather than silently swallow units.
 */
export function planSaleLineAddition(input: {
  saleId: number | string
  saleStatus: string
  lines: PlannedSaleLine[]
  exchangeRate: number
  userId: number | string | null
  userName: string | null
}): SaleLineAdditionPlan {
  const exchangeRate = Number(input.exchangeRate) || 4100
  const statements: StockStatement[] = []
  const saleItemStatementIndexByLine: number[] = []
  const deductionMap = new Map<string, { product_id: number; branch_id: number; quantity: number }>()
  let deductedUnits = 0
  let addedSubtotalUsd = 0

  for (const [lineIndex, line] of input.lines.entries()) {
    addedSubtotalUsd += line.lineTotalUsd
    saleItemStatementIndexByLine[lineIndex] = statements.length
    statements.push({
      sql: `INSERT INTO sale_items (
              sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr,
              cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id,
              price_mode, base_price_usd, base_price_khr, batch_id, batch_label, batch_expiry_date
            ) VALUES (
              @sale_id, @product_id, @product_name, @quantity, @applied_price_usd, @applied_price_khr,
              @cost_price_usd, @cost_price_khr, @total_usd, @total_khr, @branch_id,
              @price_mode, @base_price_usd, @base_price_khr, @batch_id, @batch_label, @batch_expiry_date
            )`,
      params: {
        sale_id: input.saleId,
        product_id: line.productId,
        product_name: line.productName,
        quantity: line.quantity,
        applied_price_usd: line.unitPriceUsd,
        applied_price_khr: Math.round(line.unitPriceUsd * exchangeRate),
        cost_price_usd: line.costPriceUsd,
        cost_price_khr: line.costPriceKhr,
        total_usd: line.lineTotalUsd,
        total_khr: Math.round(line.lineTotalUsd * exchangeRate),
        branch_id: line.branchId,
        price_mode: 'selling',
        // Same "no manual discount" default POST / uses: base = applied.
        base_price_usd: line.unitPriceUsd,
        base_price_khr: Math.round(line.unitPriceUsd * exchangeRate),
        // A single-lot line stamps its lot on the row, identical to an
        // explicit pick at checkout; a multi-lot split keeps NULL and the
        // detail lives in sale_item_batch_allocations.
        batch_id: line.takes.length === 1 && line.takes[0].quantity === line.quantity ? line.takes[0].batchId : null,
        batch_label: line.takes.length === 1 && line.takes[0].quantity === line.quantity ? (line.takes[0].lotCode ?? null) : null,
        batch_expiry_date: line.takes.length === 1 && line.takes[0].quantity === line.quantity ? (line.takes[0].expiryDate ?? null) : null,
      },
    })

    // heldUnits is 0 only when the sale holds nothing (a stock_skipped
    // sale): the line is recorded and no stock moves. This is the ONE place
    // that decides, and it defers to heldQuantity() rather than re-deriving
    // "does this status deduct".
    if (!line.branchId || line.heldUnits <= 0) continue

    deductedUnits += line.heldUnits
    const key = `${line.productId}:${line.branchId}`
    const existing = deductionMap.get(key)
    if (existing) existing.quantity += line.heldUnits
    else deductionMap.set(key, { product_id: line.productId, branch_id: line.branchId, quantity: line.heldUnits })

    for (const take of line.takes) {
      statements.push(decrementBatchStockStrictStatement(take.batchId, line.branchId, take.quantity))
    }
    statements.push({
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
      params: { product_id: line.productId, branch_id: line.branchId, quantity: line.heldUnits },
    })
    statements.push({
      sql: `UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
      params: { product_id: line.productId, quantity: line.heldUnits },
    })
    statements.push({
      sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
            VALUES (@product_id, @product_name, @branch_id, 'sale', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
      params: {
        product_id: line.productId,
        product_name: line.productName,
        branch_id: line.branchId,
        quantity: -line.heldUnits,
        unit_cost_usd: line.costPriceUsd,
        unit_cost_khr: line.costPriceKhr,
        reason: `Item added to sale #${input.saleId}`,
        reference_id: input.saleId,
        user_id: input.userId,
        user_name: input.userName,
        batch_id: line.movementBatchId,
      },
    })
  }

  return {
    lines: input.lines,
    statements,
    saleItemStatementIndexByLine,
    deductions: [...deductionMap.values()],
    deductedUnits,
    addedSubtotalUsd: round2(addedSubtotalUsd),
  }
}

/**
 * The sale_item_batch_allocations rows for the added lines, written once the
 * atomic batch above has told us each new sale_item's real id. Same
 * released_quantity convention as POST /: 0 when the units are physically
 * out with the sale, the full take when they are not (a stock_skipped sale),
 * so a later transition that does move stock consumes them back down.
 */
export function buildAllocationStatements(
  lines: PlannedSaleLine[],
  saleItemIdByLine: Array<number | null>,
): StockStatement[] {
  const statements: StockStatement[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const saleItemId = Number(saleItemIdByLine[lineIndex] || 0)
    if (!(saleItemId > 0) || !line.branchId || !line.takes.length) continue
    const deducted = line.heldUnits > 0
    for (const take of line.takes) {
      statements.push({
        sql: `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity, released_at)
              VALUES (@sale_item_id, @batch_id, @branch_id, @quantity, @lot_code, @expiry_date, @released_quantity, @released_at)`,
        params: {
          sale_item_id: saleItemId,
          batch_id: take.batchId,
          branch_id: line.branchId,
          quantity: take.quantity,
          lot_code: take.lotCode ?? null,
          expiry_date: take.expiryDate ?? null,
          released_quantity: deducted ? 0 : take.quantity,
          released_at: deducted ? null : new Date().toISOString(),
        },
      })
    }
  }
  return statements
}

// ---------------------------------------------------------------------------
// DECISION 4: the exact inverse, replayed by the 'sale.add_items' undo
// applier. This is the shape the undo_snapshots row stores.
// ---------------------------------------------------------------------------

export type AddedSaleLineRecord = {
  saleItemId: number
  productId: number
  productName: string | null
  quantity: number
  branchId: number | null
  /** Units this line actually took off the shelf (0 on a stock_skipped sale). */
  heldUnits: number
  unitPriceUsd: number
  lineTotalUsd: number
  costPriceUsd: number
  costPriceKhr: number
  takes: FifoLotTake[]
}

/**
 * Rebuild the forward plan's line shape from a stored reversal record, so a
 * REDO re-inserts the line drawing from the EXACT lots the original addition
 * drew from rather than re-running FIFO against whatever the shelf looks
 * like now. (Undo restored those units to those lots, so they are the right
 * ones; if a concurrent sale has since taken them, the strict decrement
 * aborts the redo, which is the correct answer rather than quietly moving
 * the sale onto a different lot.)
 */
export function plannedLineFromRecord(record: AddedSaleLineRecord): PlannedSaleLine {
  return {
    productId: record.productId,
    productName: record.productName || `product #${record.productId}`,
    quantity: record.quantity,
    branchId: record.branchId,
    unitPriceUsd: record.unitPriceUsd,
    costPriceUsd: record.costPriceUsd,
    costPriceKhr: record.costPriceKhr,
    batchId: null,
    batchLabel: null,
    batchExpiryDate: null,
    lineTotalUsd: record.lineTotalUsd,
    heldUnits: record.heldUnits,
    takes: record.takes || [],
    movementBatchId: (record.takes || []).length === 1 && record.takes[0].quantity === record.quantity
      ? record.takes[0].batchId
      : null,
  }
}

export type SaleMoneySnapshot = {
  subtotal_usd: number
  subtotal_khr: number
  total_usd: number
  total_khr: number
  change_usd: number
  change_khr: number
}

export type SaleAddItemsReversal = {
  saleId: number
  receiptNumber: string | null
  saleStatus: string
  exchangeRate: number
  /**
   * The sale's money columns exactly as they were BEFORE and AFTER the
   * addition. Both are stored so neither direction has to RE-derive them at
   * replay time: an undo restores `moneyBefore`, a redo restores
   * `moneyAfter`. Re-running the arithmetic during a replay would read
   * whatever the sale's discount/tender columns say at that later moment,
   * which is not what this action changed.
   */
  moneyBefore: SaleMoneySnapshot
  moneyAfter: SaleMoneySnapshot
  lines: AddedSaleLineRecord[]
}

/** The one UPDATE that writes a money snapshot back onto the sale row. */
export function saleMoneyUpdateStatement(saleId: number | string, money: SaleMoneySnapshot): StockStatement {
  return {
    sql: `UPDATE sales SET subtotal_usd = @subtotal_usd, subtotal_khr = @subtotal_khr,
            total_usd = @total_usd, total_khr = @total_khr,
            change_usd = @change_usd, change_khr = @change_khr,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = @sale_id`,
    params: {
      sale_id: saleId,
      subtotal_usd: round2(Number(money.subtotal_usd) || 0),
      subtotal_khr: Math.round(Number(money.subtotal_khr) || 0),
      total_usd: round2(Number(money.total_usd) || 0),
      total_khr: Math.round(Number(money.total_khr) || 0),
      change_usd: round2(Number(money.change_usd) || 0),
      change_khr: Math.round(Number(money.change_khr) || 0),
    },
  }
}

/**
 * Undo: hand the units back to the SAME lots, in REVERSE draw order (the
 * last-drawn units come back first -- the identical walk
 * planSaleStockTransition's restore branch does), add them back to branch
 * stock and the product rollup as new 'return' movements, then drop the
 * allocation rows and the sale_items rows themselves.
 *
 * A line whose heldUnits is 0 (added to a stock_skipped sale) moves no
 * stock on the way out either -- it only loses its rows. Symmetry with the
 * forward plan is the whole point: whatever heldQuantity said on the way in
 * is what comes back on the way out.
 */
export function planSaleLineRemoval(input: {
  saleId: number | string
  lines: AddedSaleLineRecord[]
  reason: string
  userId: number | string | null
  userName: string | null
}): { statements: StockStatement[]; restoredUnits: number } {
  const statements: StockStatement[] = []
  let restoredUnits = 0

  for (const line of input.lines) {
    if (line.branchId && line.heldUnits > 0) {
      restoredUnits += line.heldUnits
      const restoredLots: Array<{ batchId: number; quantity: number }> = []
      for (let index = line.takes.length - 1; index >= 0; index -= 1) {
        const take = line.takes[index]
        if (take.quantity <= 0) continue
        statements.push(incrementBatchStockStatement(take.batchId, line.branchId, take.quantity))
        restoredLots.push({ batchId: take.batchId, quantity: take.quantity })
      }
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
        params: { product_id: line.productId, branch_id: line.branchId, quantity: line.heldUnits },
      })
      statements.push({
        sql: `UPDATE products SET stock_quantity = stock_quantity + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @product_id`,
        params: { product_id: line.productId, quantity: line.heldUnits },
      })
      statements.push({
        sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
              VALUES (@product_id, @product_name, @branch_id, 'return', @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
        params: {
          product_id: line.productId,
          product_name: line.productName,
          branch_id: line.branchId,
          quantity: line.heldUnits,
          unit_cost_usd: line.costPriceUsd,
          unit_cost_khr: line.costPriceKhr,
          reason: input.reason,
          reference_id: input.saleId,
          user_id: input.userId,
          user_name: input.userName,
          // Same single-lot attribution rule as everywhere else (0084).
          batch_id: restoredLots.length === 1 && restoredLots[0].quantity === line.heldUnits ? restoredLots[0].batchId : null,
        },
      })
    }
    statements.push({
      sql: 'DELETE FROM sale_item_batch_allocations WHERE sale_item_id = @sale_item_id',
      params: { sale_item_id: line.saleItemId },
    })
    statements.push({
      sql: 'DELETE FROM sale_items WHERE id = @sale_item_id AND sale_id = @sale_id',
      params: { sale_item_id: line.saleItemId, sale_id: input.saleId },
    })
  }

  return { statements, restoredUnits }
}

// ---------------------------------------------------------------------------
// DECISION 3: totals.
//
// Subtotal is RECOMPUTED, because subtotal is by definition the sum of the
// sale's lines and that has to be true again after the insert. (It is read
// back as SUM(sale_items.total_usd), not as stored_subtotal + added, so a
// row whose stored subtotal had already drifted is corrected rather than
// having the drift carried forward.)
//
// Discounts, the membership discount, tax and the delivery fee are FROZEN.
// Not a convenience: none of them is stored as a RATE anywhere in this
// schema -- `sales.discount_usd`, `membership_discount_usd`, `tax_usd` and
// `delivery_fee_usd` are all absolute amounts the cashier or the POS
// computed at checkout, and there is no percentage on the row to re-apply.
// "Recomputing" one would mean inferring a rate from the old subtotal and
// then giving the customer a bigger discount (or charging more tax) than
// anyone agreed to. A delivery fee is per-trip, not per-item, so it does
// not scale with a line either. A shop that wants the added line discounted
// edits the discount deliberately, as its own act.
//
// Amount paid is FROZEN too -- adding a line does not make the customer hand
// over more money. The consequence is the correct one and it is already
// rendered: total rises, so `outstanding = total - paid` becomes positive
// and SaleDetailModal shows the "Outstanding (on credit)" row. Change is
// re-derived by computeSaleTotals from the same (frozen) tender, which is
// the same function POST / uses -- one definition of the money math, so an
// added line can never round differently from a checkout.
// ---------------------------------------------------------------------------

export type SaleMoneyRow = {
  discount_usd?: unknown
  membership_discount_usd?: unknown
  tax_usd?: unknown
  is_delivery?: unknown
  delivery_fee_usd?: unknown
  delivery_fee_paid_by?: unknown
  exchange_rate?: unknown
  amount_paid_usd?: unknown
  amount_paid_khr?: unknown
}

export function recomputeSaleMoneyAfterLineChange(input: {
  sale: SaleMoneyRow
  /** SUM(sale_items.total_usd) for the sale AFTER the write. */
  subtotalUsd: number
  /** The raw `change_exchange_rate` setting (Part 534). */
  changeExchangeRate?: unknown
}): SaleTotals & { subtotalUsd: number; subtotalKhr: number } {
  const sale = input.sale
  const exchangeRate = Number(sale.exchange_rate) || 4100
  const subtotalUsd = round2(Number(input.subtotalUsd) || 0)
  const totals = computeSaleTotals({
    subtotalUsd,
    discountUsd: round2(Number(sale.discount_usd) || 0),
    membershipDiscountUsd: round2(Number(sale.membership_discount_usd) || 0),
    taxUsd: round2(Number(sale.tax_usd) || 0),
    isDelivery: Boolean(Number(sale.is_delivery) || 0),
    deliveryFeeUsd: round2(Number(sale.delivery_fee_usd) || 0),
    deliveryFeePaidBy: String(sale.delivery_fee_paid_by || 'customer'),
    exchangeRate,
    changeExchangeRate: input.changeExchangeRate,
    // Frozen tender: pass the STORED values through as "supplied", so a
    // legitimately-zero paid amount stays zero instead of falling back to
    // the new total (the exact bug lib/saleTotals.ts documents).
    rawAmountPaidUsd: Number(sale.amount_paid_usd) || 0,
    rawAmountPaidKhr: Number(sale.amount_paid_khr) || 0,
  })
  return { ...totals, subtotalUsd, subtotalKhr: Math.round(subtotalUsd * exchangeRate) }
}
