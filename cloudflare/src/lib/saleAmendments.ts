// Amending a sale that already exists, as an APPEND-ONLY LEDGER (S4-30).
//
// The shop owner's ask, in their own words: "sometimes we make a sale, but we
// input wrong delivery cost, or customers change their mind and want to add or
// replace products... we do an add on top, so we know we added -- so before
// $1.50 delivery, then we add another $0.50; in details it shows both, in the
// receipt it shows $2.00... if we remove it doesn't show on the receipt but it
// shows in details."
//
// That is two views of one sale, deliberately different:
//
//   SALE DETAIL (staff)   original value + every amendment on top of it, each
//                         with what changed, by how much, who, and when.
//   RECEIPT (customer)    the net result only, as one finalized sale. A
//                         removed line is simply absent.
//
// THE ARCHITECTURE, and why the receipt needed no change at all:
//
//   `sales` and `sale_items` keep holding the NET state; migration 0115's
//   `sale_amendments` records how they got there.
//
// This was verified, not assumed. routes/sales.ts's list query replaces the
// response's `items` with live `sale_items` rows (`items: itemsBySale.get(...)`)
// and the money comes off the `sales` row; Sales.tsx hands that same object
// straight to <Receipt sale={selectedSale}>. Nothing anywhere freezes a
// receipt snapshot -- `receiptContracts.ts` is the TEMPLATE contract (which
// fields to print, `show_cashier` and friends), not a copy of the sale. So
// once the canonical tables hold net state, the customer-facing view is
// already correct and only the staff-facing view needs the new read.
//
// THE SIX DECISIONS, stated once, here, because each is a rule about money or
// stock and none of them should have to be inferred from the code:
//
// 1. WHICH SALES MAY BE AMENDED, AND FOR HOW LONG -- guardSaleAmendment
//    below. The status set is S4-24b's, unchanged; the edit window is new and
//    configurable; recorded returns refuse EVERY kind, not just additions.
//
// 2. WHICH FIELDS ARE AMENDABLE -- AMENDMENT_KINDS below, with the declined
//    ones named and justified there rather than left silent.
//
// 3. STOCK -- saleAmendmentMovesStock() is the ONE place that decides, and it
//    gates both directions. It defers to heldQuantity()/STOCK_DEDUCTED_STATUSES
//    exactly as S4-24b does, and it additionally honours S4-2's sticky
//    `stock_skipped` flag: a sale the system never took units for must not have
//    units invented for it on the way back out either.
//
// 4. MONEY -- subtotal is re-summed from the sale's own lines and the totals
//    run through S4-24b's recomputeSaleMoneyAfterLineChange(), called, not
//    re-implemented. Both DISCOUNTS stay frozen: they are absolute amounts
//    with no stored rate, and a discount is a deliberate money decision rather
//    than an arithmetic consequence of the lines. TAX is recomputed from
//    `settings.tax_enabled` + `settings.tax_rate` -- the owner ruled on
//    2026-09-04 that tax is a settings switch -- but only when the sale was
//    demonstrably taxed at today's rate; see DECISION 4a above
//    resolveAmendedTaxUsd() for the four cases that keep the stored amount
//    instead, and why each is a refusal rather than a guess. The delivery fee
//    is the one non-line money field that is set outright, because it is the
//    field the owner named and it is per-trip rather than per-item, so it does
//    not scale with a line.
//
// 5. UNDO -- a compensating APPEND, never a rewrite. See the block above
//    planCompensatingEntry().
//
// 6. RECEIPT NUMBER -- an amended sale keeps its ORIGINAL receipt number. See
//    the block above amendedSaleKeepsReceiptNumber().
//
// scripts/test-sale-amendments-pure.cjs drives every function here against a
// real in-memory schema carrying migration 0115's real triggers and the same
// CHECK(quantity >= 0) constraints production has.

import { RETURN_STATUSES, STOCK_DEDUCTED_STATUSES } from './salesStatus'
import { heldQuantity } from './saleTransitions'
import {
  allocateAcrossLots,
  decrementBatchStockStrictStatement,
  incrementBatchStockStatement,
  type FifoLotAvailability,
  type FifoLotTake,
} from './productBatches'
import { round2 } from './saleTotals'
import { financialCalculationValue } from './financialPrecision'
import { recomputeSaleMoneyAfterLineChange, type SaleMoneyRow, type StockStatement } from './saleLineAddition'

function calculatedKhr(value: unknown, exchangeRate: number): number {
  return financialCalculationValue(financialCalculationValue(Number(value) || 0) * financialCalculationValue(exchangeRate))
}

export type { StockStatement }

// ---------------------------------------------------------------------------
// DECISION 2: which fields are amendable.
//
// The owner named five things: the delivery cost, adding a product, adding to
// an existing line, replacing a product, and removing a product. All five are
// covered, by these kinds:
//
//   line_added                subsumes S4-24b's POST /:id/items -- that route
//                             now writes one of THESE entries rather than
//                             having its own separate trail. One way to add a
//                             line, one audit record for it.
//   line_quantity_increased   "add to existing" -- 1 becomes 2.
//   line_quantity_decreased   the partial of a removal.
//   line_removed              the line goes, and the ledger becomes the only
//                             record that it was ever on the sale.
//   delivery_fee_changed      $1.50 -> $2.00.
//
// "Replace product X with Y" is NOT a sixth kind. It is stored as a
// `line_removed` plus a `line_added` sharing one `group_id`, because that is
// exactly what it does to stock -- two movements that already have correct,
// tested primitives -- and inventing a third stock path for the same physical
// act is how the two paths later disagree. The detail view reads the group and
// renders the pair as the single act the cashier performed.
//
// DECLINED, named rather than left silent:
//
//   tax                 Not amendable DIRECTLY -- there is no "set the tax to
//                       $X" amendment, because tax is not a number staff type.
//                       It FOLLOWS the lines: when the sale was taxed at the
//                       rate `settings.tax_rate` holds today, every amendment
//                       recomputes it on the new post-discount base, and the
//                       ledger records the change as part of the amendment that
//                       caused it. DECISION 4a is the whole rule.
//   discount /          Absolute amounts with no stored rate. Changing
//   membership discount one is a deliberate money decision about a specific
//                       sale, not a correction of a data-entry slip, and it
//                       belongs on its own surface with its own permission.
//   a line's unit price Declined for the owner, not for lack of a mechanism:
//                       changing what a customer was charged for goods they
//                       already took is indistinguishable from an after-the-
//                       fact discount, and it is the one amendment that would
//                       change revenue without changing anything physical.
//                       Flagged upward rather than guessed.
//   amount paid /       A payment is an event, not an amendment. Adding a line
//   tender              already surfaces correctly as "Outstanding (on
//                       credit)" because total rises while tender stays frozen.
//   customer / status   Already have their own routes and their own
//                       permissions; folding them in here would give one
//                       action two audit trails.
// ---------------------------------------------------------------------------
export const AMENDMENT_KINDS = [
  'line_added',
  'line_quantity_increased',
  'line_quantity_decreased',
  'line_removed',
  'delivery_fee_changed',
] as const
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number]

/** The statuses an amendment may touch. Identical set to S4-24b's, by design. */
export const SALE_STATUSES_ACCEPTING_AMENDMENTS: ReadonlySet<string> = new Set<string>([
  'completed',
  'awaiting_delivery',
  'awaiting_payment',
])

// ---------------------------------------------------------------------------
// DECISION 1b: the edit window.
//
// The owner said "MAYBE a timer that gives it a window to edit" -- thinking
// aloud, not specifying. So it is built, but configurable rather than
// hard-coded, and an admin can always amend outside it.
//
// DEFAULT: 120 minutes, measured from the sale's OWN created_at.
//
// Why 120 and not 15 or 1440: the two scenarios the owner actually described
// are the customer who turns around at the counter and the delivery whose cost
// came back wrong -- the first is minutes, the second is the length of one
// delivery run. Two hours covers both comfortably while still meaning that by
// the time the shop cashes up, yesterday's sales are no longer editable by
// whoever happens to be on the till. A window measured from the sale rather
// than from the last amendment is deliberate: measuring from the last
// amendment would let a chain of small edits keep a sale open indefinitely,
// which is the same thing as having no window.
//
// An admin (isAdminControlUser, the existing gate -- no new role invented)
// amends outside the window, because the real correction that arrives late is
// exactly the one that needs a decision-maker rather than a timer.
// ---------------------------------------------------------------------------
export const DEFAULT_AMENDMENT_WINDOW_MINUTES = 120
export const AMENDMENT_WINDOW_SETTING_KEY = 'sale_amendment_window_minutes'

/**
 * Resolve the `sale_amendment_window_minutes` setting.
 *
 * Blank/absent/garbage -> the default. A value of 0 means "no window at all"
 * (every amendment needs an admin), which is a legitimate configuration for a
 * shop that wants every correction signed off, so 0 is honoured rather than
 * treated as unset. Negative values are garbage and fall back.
 */
export function resolveAmendmentWindowMinutes(rawSetting: unknown): number {
  const parsed = parseFloat(String(rawSetting ?? '').trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_AMENDMENT_WINDOW_MINUTES
}

/**
 * Parse a SQLite timestamp as UTC.
 *
 * `CURRENT_TIMESTAMP` stores 'YYYY-MM-DD HH:MM:SS' with no zone, and V8's
 * Date.parse reads that shape as LOCAL time -- which on a Worker is UTC but on
 * a developer's machine is not, so a window check written the obvious way
 * passes in production and fails (or silently widens) in a test. Same
 * normalization lib/auth.ts, lib/portalSession.ts and lib/telegram.ts each
 * already do inline; see the note in the lane report about the three existing
 * copies, which belong to other files and were not refactored from here.
 */
export function parseSqliteTimestampMs(raw: unknown): number {
  const text = String(raw ?? '').trim()
  if (!text) return Number.NaN
  const normalized = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

export type AmendmentGuardInput = {
  saleStatus: string
  /** Proved with a real return_items JOIN returns read, never the status label. */
  hasRecordedReturns: boolean
  /** sales.created_at. */
  saleCreatedAt: unknown
  /** Resolved from the setting. */
  windowMinutes: number
  /** isAdminControlUser(user) -- the EXISTING admin gate, not a new role. */
  isAdmin: boolean
  /** Defaults to now. Injectable so the window is testable. */
  nowMs?: number
}

export type AmendmentGuardResult =
  | { ok: true; outsideWindow: boolean }
  | { ok: false; error: string; code: 'status' | 'returns' | 'window' }

/**
 * DECISION 1. Whether this sale may be amended at all, right now, by this user.
 *
 * Order matters: status and returns are permanent properties of the sale and
 * are checked first, so a sale that can never be amended says so rather than
 * telling a cashier "the window closed" and sending them to find an admin who
 * would also be refused.
 */
export function guardSaleAmendment(input: AmendmentGuardInput): AmendmentGuardResult {
  const status = String(input.saleStatus || 'completed')

  if (status === 'cancelled') {
    return { ok: false, code: 'status', error: 'This sale was cancelled, so it cannot be amended. Un-cancel it first, or record a new sale.' }
  }
  // Every return was recorded against the line set that existed at that
  // moment, and held() for the sale is computed from that pairing -- so
  // amending the lines underneath recorded returns silently changes what
  // "already came back" means. Identical refusal to S4-24b's, applied to
  // EVERY kind rather than only to additions.
  if (RETURN_STATUSES.has(status) || input.hasRecordedReturns) {
    return { ok: false, code: 'returns', error: 'This sale has recorded returns, so its contents are managed by the Returns flow. Record a new sale, or a return, for what is changing now.' }
  }
  if (!SALE_STATUSES_ACCEPTING_AMENDMENTS.has(status)) {
    return { ok: false, code: 'status', error: `A sale in the "${status}" state cannot be amended.` }
  }

  const createdMs = parseSqliteTimestampMs(input.saleCreatedAt)
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
  const windowMinutes = Math.max(0, Number(input.windowMinutes) || 0)
  // An unparseable created_at must not silently grant an unlimited window.
  // Treated as outside the window, so an admin can still fix the sale and a
  // cashier is told plainly why they cannot.
  const outsideWindow = !Number.isFinite(createdMs) || (nowMs - createdMs) > windowMinutes * 60_000

  if (outsideWindow && !input.isAdmin) {
    return {
      ok: false,
      code: 'window',
      error: windowMinutes > 0
        ? `The ${formatWindow(windowMinutes)} window for editing this sale has closed. An admin can still amend it.`
        : 'Sales can only be amended by an admin at this shop.',
    }
  }
  return { ok: true, outsideWindow }
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}-minute`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}-hour`
}

// ---------------------------------------------------------------------------
// DECISION 3: stock. ONE check, both directions.
//
// Two independent reasons an amendment moves no stock, and they must be asked
// in one place so a future kind cannot honour one and forget the other:
//
//   * the sale's status does not hold stock deducted: the units never left
//     the shelf, so there is nothing to take back and adding a line takes
//     nothing now. This is heldQuantity()'s invariant, deferred to rather
//     than re-derived. Since S4-3 the only such status is `cancelled`
//     (awaiting_payment now holds), and an amendment to a cancelled sale is
//     already refused upstream -- so in practice the flag below is what
//     makes this branch fire.
//
//   * the sale carries S4-2's sticky `stock_skipped` flag: an admin completed
//     it WITHOUT moving stock. held() would say the units are out, so a naive
//     restore on a decrease would INVENT stock that never left. The flag is
//     sticky precisely so every later transition keeps skipping, and an
//     amendment is a later transition.
//
// The flag is read tolerantly on purpose. S4-2's column (migration 0114) is
// not in this lane's base; until it merges, `SELECT *` simply does not return
// the field, `Number(undefined) || 0` is 0, and stock moves exactly as it does
// today. The moment the column lands, the flag is honoured with no further
// change here -- and the pure test pins that by driving both shapes.
// ---------------------------------------------------------------------------
export type AmendableSaleRow = SaleMoneyRow & {
  sale_status?: unknown
  stock_skipped?: unknown
  created_at?: unknown
  branch_id?: unknown
  receipt_number?: unknown
}

/** True when the sale carries S4-2's sticky "completed without moving stock" flag. */
export function saleSkipsStock(sale: AmendableSaleRow | null | undefined): boolean {
  return !!(Number(sale?.stock_skipped) || 0)
}

/**
 * The ONE decision: does an amendment to this sale move stock?
 *
 * Every plan* function below takes the boolean this returns; none of them asks
 * the question a second time.
 */
export function saleAmendmentMovesStock(sale: AmendableSaleRow | null | undefined): boolean {
  if (saleSkipsStock(sale)) return false
  return STOCK_DEDUCTED_STATUSES.has(String(sale?.sale_status || 'completed'))
}

/**
 * Units this amendment physically moves for a line, given the sale's status.
 * Defers to heldQuantity() so an amendment can never disagree with what
 * PATCH /:id/status would have moved for the same units.
 */
export function amendmentHeldUnits(sale: AmendableSaleRow, quantity: number): number {
  if (saleSkipsStock(sale)) return 0
  return heldQuantity(String(sale.sale_status || 'completed'), quantity, 0)
}

// ---------------------------------------------------------------------------
// The line as it exists now, and its lot attribution.
// ---------------------------------------------------------------------------
export type ExistingSaleLine = {
  id: number
  product_id: number | null
  product_name: string | null
  quantity: number
  applied_price_usd: number
  cost_price_usd: number
  cost_price_khr: number
  branch_id: number | null
}

/** One `sale_item_batch_allocations` row, in draw order (id ASC). */
export type LineAllocation = {
  id: number
  batch_id: number
  branch_id: number | null
  quantity: number
  released_quantity: number
}

export type AmendmentPlan = {
  statements: StockStatement[]
  /** Units that left the shelf (negative) or returned to it (positive). */
  unitsMoved: number
  /** The line's quantity either side of this plan. */
  quantityBefore: number
  quantityAfter: number
  /** SUM delta this plan applies to the sale's subtotal. */
  subtotalDeltaUsd: number
  /** Which lots the units came from / went back to, in the order they moved. */
  takes: FifoLotTake[]
}

// ---------------------------------------------------------------------------
// INCREASE: "1 and now 2".
//
// Physically identical to adding a line, so it draws its units the same way
// S4-24b's addition does -- allocateAcrossLots over the FIFO availability the
// checkout itself uses, never a second opinion -- and emits the same four
// unclamped statements, so branch_stock/branch_batch_stock's
// CHECK(quantity >= 0) stays the real race guard rather than something this
// module clamps away.
//
// The difference from an addition is only in the row it lands on: the existing
// sale_items row's quantity and totals are raised, and NEW allocation rows are
// appended for the new units, rather than a fresh line being inserted.
// ---------------------------------------------------------------------------
export function planLineQuantityIncrease(input: {
  saleId: number | string
  sale: AmendableSaleRow
  line: ExistingSaleLine
  addedQuantity: number
  lots: FifoLotAvailability[]
  exchangeRate: number
  userId: number | string | null
  userName: string | null
}): AmendmentPlan {
  const added = Math.max(0, Number(input.addedQuantity) || 0)
  const line = input.line
  const quantityBefore = Number(line.quantity) || 0
  const quantityAfter = round2(quantityBefore + added)
  const unitPrice = Number(line.applied_price_usd) || 0
  const exchangeRate = Number(input.exchangeRate) || 4100
  const movesStock = saleAmendmentMovesStock(input.sale)
  const heldUnits = movesStock ? amendmentHeldUnits(input.sale, added) : 0

  const statements: StockStatement[] = []
  let takes: FifoLotTake[] = []

  if (line.branch_id && added > 0) {
    const allocated = allocateAcrossLots(input.lots, added)
    takes = allocated.takes
  }

  // The line row first, so a reader of `statements` sees the sale change and
  // then the shelf change, in that order, exactly as the addition path does.
  statements.push(lineQuantityUpdateStatement(line, quantityAfter, unitPrice, exchangeRate))

  if (line.branch_id && heldUnits > 0) {
    for (const take of takes) {
      statements.push(decrementBatchStockStrictStatement(take.batchId, line.branch_id, take.quantity))
    }
    statements.push({
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, 0)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - @quantity`,
      params: { product_id: line.product_id, branch_id: line.branch_id, quantity: heldUnits },
    })
    statements.push({
      sql: 'UPDATE products SET stock_quantity = MAX(0, stock_quantity - @quantity), updated_at = CURRENT_TIMESTAMP WHERE id = @product_id',
      params: { product_id: line.product_id, quantity: heldUnits },
    })
    statements.push(saleMovementStatement({
      line,
      movementType: 'sale',
      quantity: -heldUnits,
      reason: `Quantity increased on sale #${input.saleId}`,
      saleId: input.saleId,
      userId: input.userId,
      userName: input.userName,
      // Same single-lot attribution rule as everywhere else (migration 0084):
      // a split line is not attributable and keeps NULL.
      batchId: takes.length === 1 && takes[0].quantity === added ? takes[0].batchId : null,
    }))
  }

  // The lot attribution is recorded whether or not the units physically moved,
  // matching POST /'s convention: released_quantity is 0 when the units are
  // out with the sale, and the full take when they are not, so the later
  // completing transition consumes them back down.
  for (const take of takes) {
    statements.push({
      sql: `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity, released_at)
            VALUES (@sale_item_id, @batch_id, @branch_id, @quantity, @lot_code, @expiry_date, @released_quantity, @released_at)`,
      params: {
        sale_item_id: line.id,
        batch_id: take.batchId,
        branch_id: line.branch_id,
        quantity: take.quantity,
        lot_code: take.lotCode ?? null,
        expiry_date: take.expiryDate ?? null,
        released_quantity: heldUnits > 0 ? 0 : take.quantity,
        released_at: heldUnits > 0 ? null : new Date().toISOString(),
      },
    })
  }

  return {
    statements,
    // `|| 0` is not redundant: negating a zero yields -0, which survives into
    // the ledger column and compares unequal to 0 under Object.is.
    unitsMoved: -heldUnits || 0,
    quantityBefore,
    quantityAfter,
    subtotalDeltaUsd: round2(unitPrice * added),
    takes,
  }
}

// ---------------------------------------------------------------------------
// DECREASE and REMOVE: "2 back to 1", and "take it off entirely".
//
// One function, because a removal is a decrease that happens to take the whole
// line -- writing them separately is how the two later disagree about whether
// the allocation rows were cleaned up.
//
// Units go back to the SAME lots they were drawn from, in REVERSE draw order
// (last drawn comes back first) -- the identical walk
// planSaleStockTransition's restore branch and S4-24b's planSaleLineRemoval
// both do -- as new 'return' movements. The standing rule: add stock back with
// a note; never edit the original movements.
//
// The units actually returned to the shelf are the ones the allocation row
// says are NOT already released. That single subtraction is what makes this
// correct for all three cases at once: a completed line (released 0 -> the
// whole take comes back), an awaiting_payment line (released == quantity ->
// nothing comes back, because nothing ever left), and a stock-skipped sale
// (movesStock false -> nothing comes back, because the system never took the
// units and returning them would INVENT stock).
//
// A line that predates lot tracking has no allocation rows at all and simply
// rides branch_stock, exactly as it does everywhere else.
// ---------------------------------------------------------------------------
export function planLineQuantityDecrease(input: {
  saleId: number | string
  sale: AmendableSaleRow
  line: ExistingSaleLine
  /** Units to take off the line. Equal to line.quantity for a full removal. */
  removedQuantity: number
  /** The line's allocation rows in draw order (id ASC). */
  allocations: LineAllocation[]
  exchangeRate: number
  reason: string
  userId: number | string | null
  userName: string | null
}): AmendmentPlan {
  const line = input.line
  const quantityBefore = Number(line.quantity) || 0
  const removed = Math.min(quantityBefore, Math.max(0, Number(input.removedQuantity) || 0))
  const quantityAfter = round2(quantityBefore - removed)
  const isFullRemoval = quantityAfter <= 0
  const unitPrice = Number(line.applied_price_usd) || 0
  const exchangeRate = Number(input.exchangeRate) || 4100
  const movesStock = saleAmendmentMovesStock(input.sale)

  const statements: StockStatement[] = []
  const takes: FifoLotTake[] = []
  let unitsReturnedToShelf = 0

  // Walk the allocations in REVERSE draw order, taking `removed` units back.
  let remaining = removed
  for (let index = input.allocations.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const allocation = input.allocations[index]
    const attributed = Math.max(0, Number(allocation.quantity) || 0)
    if (attributed <= 0) continue
    const taken = Math.min(attributed, remaining)
    remaining -= taken

    // Of the units coming off this allocation, the ones already sitting on the
    // shelf (released) do not come back again; only the still-held ones do.
    const alreadyReleased = Math.max(0, Number(allocation.released_quantity) || 0)
    const stillHeld = Math.max(0, attributed - alreadyReleased)
    const returnsToShelf = movesStock ? Math.min(taken, stillHeld) : 0
    const releasedGivenUp = Math.max(0, taken - Math.min(taken, stillHeld))

    if (returnsToShelf > 0 && allocation.branch_id) {
      statements.push(incrementBatchStockStatement(allocation.batch_id, allocation.branch_id, returnsToShelf))
      unitsReturnedToShelf += returnsToShelf
      takes.push({ batchId: allocation.batch_id, lotCode: null, expiryDate: null, quantity: returnsToShelf })
    }

    // The allocation row shrinks by the units the sale no longer claims. A row
    // emptied entirely is deleted -- a zero-quantity attribution row is not a
    // record of anything, and the ledger is where the history lives now.
    if (taken >= attributed) {
      statements.push({
        sql: 'DELETE FROM sale_item_batch_allocations WHERE id = @id',
        params: { id: allocation.id },
      })
    } else {
      statements.push({
        sql: `UPDATE sale_item_batch_allocations
              SET quantity = quantity - @taken, released_quantity = MAX(0, released_quantity - @released)
              WHERE id = @id`,
        params: { id: allocation.id, taken, released: releasedGivenUp },
      })
    }
  }

  // Units the allocation walk could not attribute to any lot -- a line that
  // predates lot tracking has no allocation rows at all, so `remaining` is the
  // whole removal. Those units ride branch_stock only, exactly as they did on
  // the way out. `movesStock` gates them for the same two reasons it gates the
  // attributed ones.
  const totalReturned = unitsReturnedToShelf + (movesStock ? remaining : 0)

  if (line.branch_id && totalReturned > 0) {
    statements.push({
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@product_id, @branch_id, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + @quantity`,
      params: { product_id: line.product_id, branch_id: line.branch_id, quantity: totalReturned },
    })
    statements.push({
      sql: 'UPDATE products SET stock_quantity = stock_quantity + @quantity, updated_at = CURRENT_TIMESTAMP WHERE id = @product_id',
      params: { product_id: line.product_id, quantity: totalReturned },
    })
    statements.push(saleMovementStatement({
      line,
      movementType: 'return',
      quantity: totalReturned,
      reason: input.reason,
      saleId: input.saleId,
      userId: input.userId,
      userName: input.userName,
      batchId: takes.length === 1 && takes[0].quantity === totalReturned ? takes[0].batchId : null,
    }))
  }

  // The line itself. A full removal DELETES the row -- not "set quantity to
  // 0" -- because the receipt must not show the line at all ("if we remove it
  // doesn't show on receipt but it shows on details"), and a 0-quantity row
  // would print as "0 x Serum". The ledger entry is what keeps the record.
  if (isFullRemoval) {
    statements.push({
      sql: 'DELETE FROM sale_items WHERE id = @id AND sale_id = @sale_id',
      params: { id: line.id, sale_id: input.saleId },
    })
  } else {
    statements.push(lineQuantityUpdateStatement(line, quantityAfter, unitPrice, exchangeRate))
  }

  return {
    statements,
    unitsMoved: totalReturned,
    quantityBefore,
    quantityAfter,
    subtotalDeltaUsd: round2(-unitPrice * removed),
    takes,
  }
}

function lineQuantityUpdateStatement(
  line: ExistingSaleLine,
  quantity: number,
  unitPriceUsd: number,
  exchangeRate: number,
): StockStatement {
  const totalUsd = round2(unitPriceUsd * quantity)
  return {
    sql: `UPDATE sale_items SET quantity = @quantity, total_usd = @total_usd, total_khr = @total_khr WHERE id = @id`,
    params: {
      id: line.id,
      quantity,
      total_usd: totalUsd,
      total_khr: calculatedKhr(totalUsd, exchangeRate),
    },
  }
}

function saleMovementStatement(input: {
  line: ExistingSaleLine
  movementType: 'sale' | 'return'
  quantity: number
  reason: string
  saleId: number | string
  userId: number | string | null
  userName: string | null
  batchId: number | null
}): StockStatement {
  return {
    sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id)
          VALUES (@product_id, @product_name, @branch_id, @movement_type, @quantity, @unit_cost_usd, @unit_cost_khr, @reason, @reference_id, @user_id, @user_name, @batch_id)`,
    params: {
      product_id: input.line.product_id,
      product_name: input.line.product_name,
      branch_id: input.line.branch_id,
      movement_type: input.movementType,
      quantity: input.quantity,
      unit_cost_usd: Number(input.line.cost_price_usd) || 0,
      unit_cost_khr: Number(input.line.cost_price_khr) || 0,
      reason: input.reason,
      reference_id: input.saleId,
      user_id: input.userId,
      user_name: input.userName,
      batch_id: input.batchId,
    },
  }
}

// ---------------------------------------------------------------------------
// DELIVERY FEE: "$1.50, then we add another $0.50; the receipt shows $2.00".
//
// The API takes the CORRECTED VALUE, not the delta, and derives the delta for
// the ledger. Two reasons: a cashier reading "$1.50" on screen and typing what
// it should be cannot get the arithmetic wrong, and two concurrent corrections
// cannot both apply their delta to produce a number nobody chose (the route's
// existing assertUpdatedAtMatch already rejects the second one, and an
// absolute value makes the retry obvious rather than compounding).
//
// Refused on a sale that is not a delivery: computeSaleTotals only bills a
// customer-paid fee when `is_delivery` is set, so writing a fee onto a
// non-delivery sale would store a number the total silently ignores. Turning a
// counter sale into a delivery is a different act -- it needs a contact and an
// address -- and it is flagged upward rather than guessed at here.
// ---------------------------------------------------------------------------
export type DeliveryFeeGuardResult = { ok: true } | { ok: false; error: string }

export function guardDeliveryFeeAmendment(sale: AmendableSaleRow): DeliveryFeeGuardResult {
  if (!Number(sale.is_delivery)) {
    return { ok: false, error: 'This sale is not a delivery, so it has no delivery fee to correct. Record the delivery on the sale first.' }
  }
  return { ok: true }
}

export function planDeliveryFeeChange(input: {
  saleId: number | string
  sale: AmendableSaleRow
  newFeeUsd: number
  exchangeRate: number
}): { statements: StockStatement[]; feeBeforeUsd: number; feeAfterUsd: number; feeDeltaUsd: number } {
  const exchangeRate = Number(input.exchangeRate) || 4100
  const feeBeforeUsd = round2(Number(input.sale.delivery_fee_usd) || 0)
  const feeAfterUsd = round2(Math.max(0, Number(input.newFeeUsd) || 0))
  return {
    statements: [{
      sql: `UPDATE sales SET delivery_fee_usd = @fee_usd, delivery_fee_khr = @fee_khr, updated_at = CURRENT_TIMESTAMP WHERE id = @sale_id`,
      params: {
        sale_id: input.saleId,
        fee_usd: feeAfterUsd,
        fee_khr: calculatedKhr(feeAfterUsd, exchangeRate),
      },
    }],
    feeBeforeUsd,
    feeAfterUsd,
    feeDeltaUsd: round2(feeAfterUsd - feeBeforeUsd),
  }
}

// ---------------------------------------------------------------------------
// DECISION 4a: TAX on an amended sale.
//
// The owner ruled (2026-09-04): "tax can turn on off in settings which will
// show based on that, if off, doesn't show." So tax is a SETTING, not a value
// frozen at sale time -- which overturns this lane's original inherited answer
// (S4-24b froze `sales.tax_usd` because no rate was stored anywhere).
//
// A rate WAS already stored: `settings.tax_rate`, a percentage that
// POS.tsx:1043 reads as `parseFloat(settings.tax_rate)/100` and applies to the
// post-discount subtotal. This module reads the same two keys and applies the
// same base, so an amended sale is taxed exactly as the till would have taxed
// it. `settings.tax_enabled` is the owner's on/off; when the key is ABSENT it
// falls back to "on iff the rate is positive", which is precisely today's
// behaviour, so no existing install changes until the owner touches the switch.
//
// The four cases that do NOT recompute, and why each one is a refusal rather
// than a guess:
//
//   storedTax <= 0    The sale was rung up without tax. Turning the setting on
//                     later must not retroactively add tax to a receipt the
//                     customer already holds. Nothing was charged; nothing is
//                     charged; the row stays absent, which is the owner's
//                     "if off, doesn't show".
//   !enabled          Off means "stop charging it", NOT "erase what was
//                     charged". Zeroing a historical tax amount would make that
//                     receipt's own arithmetic wrong (subtotal + delivery would
//                     no longer reach the recorded total) and would quietly
//                     restate collected tax in every report. Kept, and reported
//                     as not recomputed.
//   rate <= 0         Same shape: no usable rate, so there is nothing to
//                     recompute WITH.
//   rate mismatch     The stored amount is not what today's rate would have
//                     produced on the pre-amendment base -- a migrated sale, or
//                     the rate changed since. Solving for the sale's own rate
//                     is exactly the "retro-derive a rate" that was ruled out,
//                     so the amount is kept verbatim and the caller is told.
//
// Every non-recomputing case returns `recomputed: false` with a machine-
// readable reason, so the route can surface "tax was not recalculated" on the
// screen instead of leaving staff to notice a stale line themselves.
// ---------------------------------------------------------------------------
export const TAX_ENABLED_SETTING_KEY = 'tax_enabled'
export const TAX_RATE_SETTING_KEY = 'tax_rate'

export type TaxSettings = { enabled: boolean; rate: number }

/**
 * `rawEnabled` and `rawRate` are the raw `settings.value` strings (or
 * undefined when the row does not exist).
 *
 * The rate is a PERCENT in storage ("10" means 10%), matching what the
 * Settings screen collects and what POS divides by 100.
 */
export function resolveTaxSettings(rawEnabled: unknown, rawRate: unknown): TaxSettings {
  const percent = Number(String(rawRate ?? '').trim())
  const rate = Number.isFinite(percent) && percent > 0 ? percent / 100 : 0
  const enabledText = String(rawEnabled ?? '').trim().toLowerCase()
  // Absent key => infer from the rate, so nothing changes for an install that
  // has never seen this switch. Present key => the owner's explicit answer.
  const enabled = enabledText === ''
    ? rate > 0
    : !(enabledText === '0' || enabledText === 'false' || enabledText === 'off' || enabledText === 'no')
  return { enabled, rate }
}

/** The base tax is charged on: subtotal less both discounts, floored at 0. */
export function taxableBaseUsd(sale: AmendableSaleRow, subtotalUsd: number): number {
  const base = (Number(subtotalUsd) || 0)
    - (Number(sale.discount_usd) || 0)
    - (Number(sale.membership_discount_usd) || 0)
  return round2(Math.max(0, base))
}

export type AmendedTaxResult = {
  taxUsd: number
  recomputed: boolean
  reason: 'recomputed' | 'no_tax_on_sale' | 'tax_disabled' | 'no_rate' | 'rate_mismatch'
}

export function resolveAmendedTaxUsd(input: {
  sale: AmendableSaleRow
  /** The taxable base BEFORE the amendment (from the sale's stored subtotal). */
  taxableBaseBeforeUsd: number
  /** The taxable base AFTER it (from the re-summed sale_items). */
  taxableBaseAfterUsd: number
  settings: TaxSettings
}): AmendedTaxResult {
  const storedTax = round2(Number(input.sale.tax_usd) || 0)
  if (storedTax <= 0) return { taxUsd: 0, recomputed: false, reason: 'no_tax_on_sale' }
  if (!input.settings.enabled) return { taxUsd: storedTax, recomputed: false, reason: 'tax_disabled' }
  const rate = Number(input.settings.rate) || 0
  if (rate <= 0) return { taxUsd: storedTax, recomputed: false, reason: 'no_rate' }
  const expected = round2((Number(input.taxableBaseBeforeUsd) || 0) * rate)
  // One cent of tolerance: the stored amount went through the same round2 the
  // till used, so anything further out is a different rate, not float drift.
  //
  // The DIFFERENCE is rounded before it is compared. Both operands are already
  // 2-decimal money, but their subtraction is not: |1.00 - 1.01| evaluates to
  // 0.010000000000000009 in binary floating point, which is greater than 0.01,
  // and a one-cent gap would have been rejected as a different rate.
  if (round2(Math.abs(expected - storedTax)) > 0.01) {
    return { taxUsd: storedTax, recomputed: false, reason: 'rate_mismatch' }
  }
  return { taxUsd: round2((Number(input.taxableBaseAfterUsd) || 0) * rate), recomputed: true, reason: 'recomputed' }
}

/**
 * The ONE statement that writes a recomputed tax back. Deliberately separate
 * from S4-24b's saleMoneyUpdateStatement, which does not touch tax_usd: that
 * function is shared with paths that must keep freezing it, and widening it
 * would change their behaviour silently. The caller appends this only when
 * resolveAmendedTaxUsd said `recomputed`.
 */
export function saleTaxUpdateStatement(saleId: number | string, taxUsd: number, exchangeRate: number): StockStatement {
  const usd = round2(Math.max(0, Number(taxUsd) || 0))
  return {
    sql: `UPDATE sales SET tax_usd = @tax_usd, tax_khr = @tax_khr, updated_at = CURRENT_TIMESTAMP WHERE id = @sale_id`,
    params: {
      sale_id: saleId,
      tax_usd: usd,
      tax_khr: calculatedKhr(usd, Number(exchangeRate) || 4100),
    },
  }
}

// ---------------------------------------------------------------------------
// DECISION 4: totals after any amendment.
//
// Subtotal is RE-SUMMED from the sale's own lines (the caller passes
// SUM(sale_items.total_usd) read back AFTER the write), never added onto the
// stored column -- so a row whose stored subtotal had drifted is corrected
// rather than carrying the drift forward. Everything else runs through
// S4-24b's recomputeSaleMoneyAfterLineChange: CALLED, not re-implemented, so
// an amendment can never round differently from an addition or a checkout.
//
// The delivery-fee and tax overrides are passed as a shallow copy rather than
// by mutating the sale row, so nothing downstream sees a half-updated object.
// ---------------------------------------------------------------------------
export function recomputeSaleMoneyAfterAmendment(input: {
  sale: AmendableSaleRow
  subtotalUsd: number
  /** Set only by a delivery_fee_changed amendment; otherwise the stored fee. */
  deliveryFeeUsdOverride?: number | null
  /** Set when resolveAmendedTaxUsd recomputed; otherwise the stored amount. */
  taxUsdOverride?: number | null
  changeExchangeRate?: unknown
  exchangeRateOverride?: unknown
}) {
  const overrides: Partial<AmendableSaleRow> = {}
  if (input.deliveryFeeUsdOverride !== null && input.deliveryFeeUsdOverride !== undefined) {
    overrides.delivery_fee_usd = input.deliveryFeeUsdOverride
  }
  if (input.taxUsdOverride !== null && input.taxUsdOverride !== undefined) {
    overrides.tax_usd = input.taxUsdOverride
  }
  const sale = Object.keys(overrides).length === 0 ? input.sale : { ...input.sale, ...overrides }
  return recomputeSaleMoneyAfterLineChange({
    sale,
    subtotalUsd: input.subtotalUsd,
    changeExchangeRate: input.changeExchangeRate,
    exchangeRateOverride: input.exchangeRateOverride,
  })
}

// ---------------------------------------------------------------------------
// DECISION 6: the receipt number of an amended sale.
//
// It KEEPS its original number, and a reprint is a reprint. SETTLED by the
// owner on 2026-09-04: the same number is reprinted showing the new totals.
//
// The original wording was ambiguous -- "receipt treats as one receipt
// finalized total without customer realize it is changed... but new receipt" --
// so it was put back to the owner, who chose one sale, one number. The reasons
// it was also the safer default:
//
//   * receipt numbers carry a business format from migration 0107 and are the
//     shop's own external reference; a second number for one sale means two
//     pieces of paper that both look like sales.
//   * every revenue read in this codebase counts `sales` rows, so a second
//     number would either need a second row (double-counted revenue) or would
//     be a number with no row behind it.
//
// This is now a fixed rule, not a default awaiting confirmation. Nothing in
// this module or the routes it serves writes `receipt_number`.
// ---------------------------------------------------------------------------
export function amendedSaleKeepsReceiptNumber(): true {
  return true
}

// ---------------------------------------------------------------------------
// DECISION 5: undo, as a compensating APPEND.
//
// An amendment is reversed by appending the opposite entry, never by rewriting
// or deleting the original one. Three reasons, and the third is the decisive
// one:
//
//   1. It is what the ledger IS. Migration 0115's triggers make a rewrite
//      impossible at the database, so "undo by rewriting" is not an option
//      that exists.
//   2. It is how the shop already thinks: "we removed one, then put it back"
//      is a true statement about the afternoon, and a detail view that shows
//      both is more useful than one that shows neither.
//   3. It keeps ONE model. S4-24b's `sale.add_items` undo applier already
//      exists and reverses an addition through the undo-snapshot machinery.
//      Rather than having two audit trails -- one that shows the addition and
//      one that quietly makes it disappear -- that applier now APPENDS a
//      compensating `line_removed` entry marked `via: 'undo'` (and a
//      `line_added` marked `via: 'redo'` on the way back). The Undo button
//      writes INTO the ledger rather than around it.
//
// So: the undo-snapshot machinery still drives the REPLAY (it knows the exact
// lots, and it is reload-durable); the ledger records that the replay
// happened. One trail, one story, no silent gaps.
// ---------------------------------------------------------------------------
export type AmendmentEntry = {
  saleId: number | string
  kind: AmendmentKind
  groupId?: string | null
  saleItemId?: number | null
  productId?: number | null
  productName?: string | null
  quantityBefore?: number | null
  quantityAfter?: number | null
  amountBeforeUsd?: number | null
  amountAfterUsd?: number | null
  totalBeforeUsd: number
  totalAfterUsd: number
  unitsMoved?: number
  stockSkipped?: boolean
  via?: 'amend' | 'undo' | 'redo'
  reversesAmendmentId?: number | null
  undoActionId?: number | null
  note?: string | null
  userId?: number | string | null
  userName?: string | null
}

/**
 * The one INSERT that writes a ledger entry. Deltas are derived here rather
 * than taken from the caller, so a caller cannot record "1 -> 2, delta -5".
 */
export function amendmentEntryStatement(entry: AmendmentEntry): StockStatement {
  const quantityBefore = numberOrNull(entry.quantityBefore)
  const quantityAfter = numberOrNull(entry.quantityAfter)
  const amountBefore = numberOrNull(entry.amountBeforeUsd)
  const amountAfter = numberOrNull(entry.amountAfterUsd)
  return {
    sql: `INSERT INTO sale_amendments (
            sale_id, group_id, kind, sale_item_id, product_id, product_name,
            quantity_before, quantity_after, quantity_delta,
            amount_before_usd, amount_after_usd, amount_delta_usd,
            total_before_usd, total_after_usd,
            units_moved, stock_skipped, via, reverses_amendment_id, undo_action_id,
            note, user_id, user_name
          ) VALUES (
            @sale_id, @group_id, @kind, @sale_item_id, @product_id, @product_name,
            @quantity_before, @quantity_after, @quantity_delta,
            @amount_before_usd, @amount_after_usd, @amount_delta_usd,
            @total_before_usd, @total_after_usd,
            @units_moved, @stock_skipped, @via, @reverses_amendment_id, @undo_action_id,
            @note, @user_id, @user_name
          )`,
    params: {
      sale_id: entry.saleId,
      group_id: entry.groupId ?? null,
      kind: entry.kind,
      sale_item_id: entry.saleItemId ?? null,
      product_id: entry.productId ?? null,
      product_name: entry.productName ?? null,
      quantity_before: quantityBefore,
      quantity_after: quantityAfter,
      quantity_delta: quantityBefore === null || quantityAfter === null ? null : round2(quantityAfter - quantityBefore),
      amount_before_usd: amountBefore,
      amount_after_usd: amountAfter,
      amount_delta_usd: amountBefore === null || amountAfter === null ? null : round2(amountAfter - amountBefore),
      total_before_usd: round2(Number(entry.totalBeforeUsd) || 0),
      total_after_usd: round2(Number(entry.totalAfterUsd) || 0),
      units_moved: round2(Number(entry.unitsMoved) || 0) || 0,
      stock_skipped: entry.stockSkipped ? 1 : 0,
      via: entry.via || 'amend',
      reverses_amendment_id: entry.reversesAmendmentId ?? null,
      undo_action_id: entry.undoActionId ?? null,
      note: entry.note ? String(entry.note).slice(0, 500) : null,
      user_id: entry.userId ?? null,
      user_name: entry.userName ?? null,
    },
  }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? round2(parsed) : null
}

/** The kind that reverses a kind, for a compensating entry. */
export function reversingKind(kind: AmendmentKind): AmendmentKind {
  if (kind === 'line_added') return 'line_removed'
  if (kind === 'line_removed') return 'line_added'
  if (kind === 'line_quantity_increased') return 'line_quantity_decreased'
  if (kind === 'line_quantity_decreased') return 'line_quantity_increased'
  return 'delivery_fee_changed'
}

// ---------------------------------------------------------------------------
// The read side: what the SALE DETAIL shows and what the RECEIPT shows, and
// the fact that they are supposed to disagree.
//
// This function exists so the disagreement is a stated, tested property rather
// than an emergent one. Given the net line set (what the receipt prints) and
// the ledger (what the detail shows), it reports the sale's amendment summary:
// how many entries, whether any line was removed entirely, and the running
// original-versus-current figures the detail header needs.
// ---------------------------------------------------------------------------
export type LedgerRow = {
  id: number
  kind: string
  group_id: string | null
  sale_item_id: number | null
  product_id: number | null
  product_name: string | null
  quantity_before: number | null
  quantity_after: number | null
  quantity_delta: number | null
  amount_before_usd: number | null
  amount_after_usd: number | null
  amount_delta_usd: number | null
  total_before_usd: number | null
  total_after_usd: number | null
  units_moved: number | null
  stock_skipped: number | null
  via: string | null
  note: string | null
  user_id: number | null
  user_name: string | null
  created_at: string | null
}

export type AmendmentSummary = {
  amended: boolean
  entryCount: number
  /** Lines the ledger remembers that the receipt no longer prints. */
  removedLines: Array<{ productId: number | null; productName: string | null; quantity: number }>
  /** The sale's total before the FIRST amendment -- what the first receipt said. */
  originalTotalUsd: number | null
  /** The sale's total after the LAST amendment -- what a reprint says now. */
  currentTotalUsd: number | null
  /** The delivery fee's first-known and latest values, when it was amended. */
  deliveryFeeBeforeUsd: number | null
  deliveryFeeAfterUsd: number | null
}

/**
 * Summarize a sale's ledger for the detail header.
 *
 * Entries arrive oldest-first (the index is (sale_id, id)). A `line_removed`
 * whose product later reappears through a compensating `line_added` in the
 * same group is NOT reported as removed -- the customer's goods came back, and
 * a detail header that still said "1 line removed" would be describing a
 * moment rather than the sale.
 */
export function summarizeAmendments(rows: LedgerRow[]): AmendmentSummary {
  const entries = Array.isArray(rows) ? rows : []
  if (!entries.length) {
    return {
      amended: false,
      entryCount: 0,
      removedLines: [],
      originalTotalUsd: null,
      currentTotalUsd: null,
      deliveryFeeBeforeUsd: null,
      deliveryFeeAfterUsd: null,
    }
  }

  // Net removals per product: a removal subtracts, a re-addition adds back.
  const removedByProduct = new Map<number | null, { productId: number | null; productName: string | null; quantity: number }>()
  let deliveryFeeBeforeUsd: number | null = null
  let deliveryFeeAfterUsd: number | null = null

  for (const row of entries) {
    if (row.kind === 'delivery_fee_changed') {
      if (deliveryFeeBeforeUsd === null) deliveryFeeBeforeUsd = numberOrNull(row.amount_before_usd)
      deliveryFeeAfterUsd = numberOrNull(row.amount_after_usd)
      continue
    }
    if (row.kind !== 'line_removed' && row.kind !== 'line_added') continue
    const key = row.product_id ?? null
    const existing = removedByProduct.get(key) || { productId: key, productName: row.product_name, quantity: 0 }
    // A removal took `quantity_before` units off; an addition put
    // `quantity_after` back on.
    existing.quantity += row.kind === 'line_removed'
      ? Math.max(0, Number(row.quantity_before) || 0)
      : -Math.max(0, Number(row.quantity_after) || 0)
    existing.productName = existing.productName || row.product_name
    removedByProduct.set(key, existing)
  }

  return {
    amended: true,
    entryCount: entries.length,
    removedLines: [...removedByProduct.values()].filter((entry) => entry.quantity > 0),
    originalTotalUsd: numberOrNull(entries[0].total_before_usd),
    currentTotalUsd: numberOrNull(entries[entries.length - 1].total_after_usd),
    deliveryFeeBeforeUsd,
    deliveryFeeAfterUsd,
  }
}
