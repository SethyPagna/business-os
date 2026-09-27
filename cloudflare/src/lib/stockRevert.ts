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
  planReceiveBatchStock, planRemoveStockFromBatch, listBatchesForProduct, allocateAcrossLots,
  decrementBatchStockStrictStatement, planUnreceiveBatchStock, restoreBatchStockStatements, type StockWriteStatement,
} from './productBatches'
import { multiplyMoney4 } from './moneyPrecision'
import { STOCK_RECEIPT_MOVEMENT_TYPES, isStockInEditReference, stockInEditRange } from './stockInSessionsQuery'
import { isDamagedLotReference } from './stockCondition'

const OUT_TYPES = new Set<string>(LEDGER_OUT_TYPES)
const RECEIPT_TYPES = new Set<string>(STOCK_RECEIPT_MOVEMENT_TYPES)

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
  | { ok: false; status: 400 | 409; error: string; code?: 'already_reverted' | 'stock_changed' }

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
// reverting it must move the lot's purchase figures (received quantity/cost;
// see planUnreceiveBatchStock) and not just its stock. Keyed off the movement
// TYPE through the SAME receipt allowlist the ledger, the stock-in sessions
// list and the frontend's stockMovementDetail.ts use: only a receipt is a
// purchase. A lot quantity correction ('set', routes/batches.ts), an
// 'adjustment', a plain removal or a legacy 'csv_import'/'in' row can point
// at a received lot without being a purchase, so reverting one moves stock
// only -- a correction never touched received_quantity and its revert must
// not either, and a whole-lot correction reverted must not wipe the
// supplier's credit.
export function isReceiptMovementType(movementType: string): boolean {
  return RECEIPT_TYPES.has(movementType)
}

// A revert counter-movement (reference_id 'revert:N') takes its purchase
// nature from the row it compensates, however deep the chain: receipt ->
// revert (a 'remove' that un-received) -> revert of that (an 'add' that
// re-received) -> ... Classifying a counter by its own type would call the
// level-3 'add' a fresh receipt, and the counter of a plain removal (also an
// 'add') a purchase. Walks to the root with one primary-key read per hop; a
// chain is as long as the operator's changes of mind (typically 0-2 hops).
// A broken chain (referenced row missing) resolves to null = stock only.
export async function revertRootMovement(
  db: D1Compat,
  m: Pick<RevertMovementRow, 'id' | 'movement_type' | 'reference_id'>,
): Promise<{ id: number; movement_type: string } | null> {
  let current = { id: Number(m.id), movement_type: m.movement_type, reference_id: m.reference_id as string | number | null }
  for (let hop = 0; hop < 32; hop += 1) {
    const ref = String(current.reference_id ?? '')
    if (!ref.startsWith('revert:')) return { id: current.id, movement_type: current.movement_type }
    const parentId = Number(ref.slice('revert:'.length))
    if (!Number.isSafeInteger(parentId) || parentId <= 0) return null
    const parent = await db.prepare('SELECT id, movement_type, reference_id FROM inventory_movements WHERE id = @id')
      .get<{ id: number; movement_type: string; reference_id: string | number | null }>({ id: parentId })
    if (!parent) return null
    current = { id: Number(parent.id), movement_type: parent.movement_type, reference_id: parent.reference_id }
  }
  return null
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
  // P3-L6. A movement that moved units into or out of a TAGGED held row is
  // half of a two-ledger transition (sellable stock AND
  // damaged_stock_lots.quantity_remaining). The allowlist above is keyed on
  // movement_type alone, and 'in' -- the type a restore-to-sellable writes --
  // is on it, so without this guard the ledger would happily "revert" a
  // restore: the units would come back OUT of sellable stock while the held
  // row stayed at the figure the restore left it, and they would exist in
  // neither place. The real reversal for these transitions is the tagged
  // row's own Restore / Remove entirely actions, which move both ledgers.
  if (isDamagedLotReference(m.reference_id)) {
    return {
      ok: false,
      status: 400,
      error: 'This movement belongs to a tagged (damaged, broken, expired ...) stock row. Reverse it from that row on the product instead, so the tagged quantity moves with the stock.',
    }
  }
  // A scoped Set (lib/stockLotAdjustment.ts) and the counter-movement of its
  // undo are replayed ONLY through its own history generation, which guards
  // the exact lot/branch preimage. A ledger revert here would move stock
  // outside that generation and leave its undo/redo reversing the wrong state.
  // Prefix literal kept in sync with STOCK_SET_REFERENCE_PREFIX.
  const setReference = String(m.reference_id ?? '')
  const setParent = setReference.startsWith('revert:')
    ? await db.prepare('SELECT reference_id FROM inventory_movements WHERE id = @id').get<{ reference_id: string | null }>({ id: Number(setReference.slice(7)) || 0 })
    : null
  if (setReference.startsWith('stock-set:') || String(setParent?.reference_id ?? '').startsWith('stock-set:')) {
    return { ok: false, status: 409, error: 'This stock correction has exact history. Use Undo/Redo in its history; it cannot be reverted from the stock ledger.' }
  }
  // N6: a stock-in line edit (lib/stockInLineEdit.ts) is replayed only through
  // its own history generation, and a line that was edited is no longer just
  // its root receipt row: reverting the root would take back the ORIGINAL
  // quantity from the ORIGINAL lot. Both are refused; the line is changed (or
  // set to 0) through its Edit, and an edit is reversed with Undo.
  if (isStockInEditReference(setReference) || isStockInEditReference(setParent?.reference_id)) {
    return { ok: false, status: 409, error: 'This row belongs to an edit of a stock-in line. Use Undo/Redo in its history, or edit the line again.' }
  }
  if (RECEIPT_TYPES.has(m.movement_type)) {
    const edited = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id >= @lo AND reference_id < @hi LIMIT 1')
      .get<{ id: number }>(stockInEditRange(Number(m.id)))
    if (edited) {
      return { ok: false, status: 409, error: 'This stock-in line was edited after it was saved. Edit it again (quantity 0 removes it) or undo the edit from its history.' }
    }
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
  // Double-revert guard. This read only gives the common case a clean
  // answer; it is NOT what makes a revert once-only. Two requests (double
  // tap, two tabs, a retried POST whose reply was lost) can both pass it. The
  // enforcement is ALREADY_REVERTED_GUARD, the first statement of the ONE
  // batch below that also moves the stock and writes the counter-movement:
  // D1 runs batches one at a time, so the second batch sees the first's
  // counter-movement and aborts whole (H-stock 2, 2026-09-27).
  const counterRef = `revert:${m.id}`
  if (await revertExists(db, counterRef)) return ALREADY_REVERTED
  // A stock-in session's undo/redo writes its own counter-movement
  // (lib/stockSession.ts: reference_id = the session operation's rowid, no
  // stock_session_members row) and moves the lot through the session's saved
  // pre/post images. Reverting THAT row from the ledger would move the stock
  // without the purchase and fight the session's generation guard; the
  // session's own redo/undo is the path. The session's original receipt rows
  // (the ones stock_session_members.movement_id points at) stay revertible.
  const sessionRowid = /^\d+$/.test(String(m.reference_id ?? '')) ? Number(m.reference_id) : null
  if (sessionRowid != null) {
    const generationOf = await db.prepare(`
      SELECT o.id FROM stock_session_operations o
      WHERE o.rowid = @rowid
        AND NOT EXISTS (SELECT 1 FROM stock_session_members sm WHERE sm.movement_id = @movementId)
    `).get<{ id: string }>({ rowid: sessionRowid, movementId: m.id })
    if (generationOf) {
      return {
        ok: false,
        status: 409,
        error: `This row was written by the undo/redo of stock-in session ${generationOf.id}. Redo or undo that session from Stock-in Sessions instead.`,
      }
    }
  }

  const { revertType, magnitude } = plan
  const batchId = m.batch_id != null ? Number(m.batch_id) : null
  const root = await revertRootMovement(db, m)
  const purchaseSide = root != null && isReceiptMovementType(root.movement_type)
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
      // Strict (unclamped) lot + branch decrement in the same batch as the
      // counter-movement: a sale that took the lot in between trips the
      // CHECK(quantity >= 0) and the whole revert rolls back.
      const lot = await db.prepare(`
        SELECT COALESCE(bbs.quantity, 0) AS available
        FROM product_batches pb
        LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
        WHERE pb.id = @batchId AND pb.variant_product_id = @productId
      `).get<{ available: number }>({ batchId, productId, branchId })
      if (!lot) return { ok: false, status: 400, error: 'Selected received date does not belong to this product' }
      const available = Number(lot.available) || 0
      if (magnitude > available) return { ok: false, status: 400, error: `Only ${available} available under this received date at this branch` }
      statements.push(...planRemoveStockFromBatch({ batchId, productId, branchId, quantity: magnitude }).statements)
      usedBatchId = batchId
      // Un-purchase: the lot loses this receipt's units and money; supplier
      // and payment state stay on the row (see planUnreceiveBatchStock).
      if (purchaseSide) statements.push(...planUnreceiveBatchStock({ batchId, quantity: magnitude, totalCostUsd: receiptCostUsd }))
    } else {
      // Same FIFO order removeStockAcrossBatches uses (listBatchesForProduct),
      // written as strict statements into the one batch; whatever the lots
      // cannot cover comes off the aggregate only.
      const lots = await listBatchesForProduct(db, productId, branchId, { onlyAvailable: true })
      const { takes, uncovered } = allocateAcrossLots(
        lots.map((lot) => ({ batchId: Number(lot.id), lotCode: lot.lot_code ?? null, expiryDate: lot.expiry_date ?? null, available: Number(lot.quantity) || 0 })),
        magnitude,
      )
      for (const take of takes) statements.push(decrementBatchStockStrictStatement(take.batchId, branchId, take.quantity))
      // magnitude <= branch quantity was checked above; the strict UPDATE
      // makes a concurrent sale fail the batch instead of flooring. The
      // product total is recomputed from its branches, as
      // planRemoveStockFromBatch does, never pushed below zero by drift.
      statements.push(
        {
          sql: 'UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = @productId AND branch_id = @branchId',
          params: { productId, branchId, quantity: magnitude },
        },
        {
          sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @productId),
                  updated_at = CURRENT_TIMESTAMP WHERE id = @productId`,
          params: { productId },
        },
      )
      usedBatchId = takes.length === 1 && uncovered === 0 ? takes[0].batchId : null
      // A receipt with no lot stamp (pre-0084) names no lot to mirror on. When
      // the FIFO drain resolved to exactly ONE lot that covered all of it,
      // that lot is the only candidate and is mirrored (the counter-movement
      // is stamped with it by the same rule). Spread across several lots
      // there is no honest target and only the stock moves -- blank, the rule
      // 0084 set for the stamp itself.
      if (purchaseSide && usedBatchId != null) statements.push(...planUnreceiveBatchStock({ batchId: usedBatchId, quantity: magnitude, totalCostUsd: receiptCostUsd }))
    }
  } else if (batchId != null && purchaseSide) {
    // Reverting the revert of a receipt puts the purchase back on the same
    // lot: units and money are received again under the supplier and payment
    // state the row kept through the revert (they are not on the movement).
    // Since productBatches.ts now makes a ZEROED lot take whatever attribution
    // this receipt carries -- including clearing it to NULL when none is
    // given, so an unrelated later receipt never inherits a stale supplier --
    // this call must explicitly re-supply the row's own attribution rather
    // than rely on an implicit "no info means leave it alone".
    const priorAttribution = await db.prepare(
      'SELECT supplier_id, supplier_name, payment_status, credit_due_date FROM product_batches WHERE id = @batchId',
    ).get<{ supplier_id: number | null; supplier_name: string | null; payment_status: string | null; credit_due_date: string | null }>({ batchId })
    // Same plan receiveBatchStock builds for a historical replay onto an
    // explicit lot (no lot-target resolution; cost preimage from the row),
    // placed in this revert's one batch instead of committing on its own.
    const before = await db.prepare(
      'SELECT id, received_cost_usd FROM product_batches WHERE id = @batchId AND variant_product_id = @productId',
    ).get<{ id: number; received_cost_usd: number | null }>({ batchId, productId })
    if (!before) return { ok: false, status: 400, error: 'Selected received date does not belong to this product' }
    const unitCostUsd = m.unit_cost_usd ?? null
    try {
      statements.push(...planReceiveBatchStock({
        productId, branchId, quantity: magnitude, batchId, unitCostUsd,
        preserveHistoricalUnitCost: true,
        supplierId: priorAttribution?.supplier_id ?? null,
        supplierName: priorAttribution?.supplier_name ?? null,
        paymentStatus: priorAttribution?.payment_status === 'paid' || priorAttribution?.payment_status === 'credit' ? priorAttribution.payment_status : null,
        creditDueDate: priorAttribution?.credit_due_date ?? null,
        receiptCostPreimage: unitCostUsd != null ? { batchExists: true, receivedCostUsd: before.received_cost_usd ?? null } : undefined,
      }).statements)
    } catch (err) {
      return { ok: false, status: 400, error: err instanceof Error ? err.message : 'Failed to revert stock' }
    }
    usedBatchId = batchId
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
    // FX-stock4 N1. A removal no single lot covered carries no batch_id
    // (0084), and this put its units back on branch_stock alone: receive 4
    // and 8, count to 0, revert -> branch 12, lots 0. A dated stock count
    // records what it took from each lot (0035), so each of those lots gets
    // exactly that back; only what no lot held stays branch-only, as the
    // removal left it. A lot a merge has left on another product is refused,
    // as the stamped case above is. Other batch-less removals (a manual
    // multi-lot remove, a revert's own FIFO drain) keep no per-lot record and
    // still move branch_stock only.
    const takes = await db.prepare(`
      SELECT a.batch_id AS batchId, -a.quantity AS quantity, pb.variant_product_id AS productId
      FROM dated_stock_count_batch_actions a
      LEFT JOIN product_batches pb ON pb.id = a.batch_id
      WHERE a.movement_id = @movementId AND a.quantity < 0
      ORDER BY a.id
    `).all<{ batchId: number; quantity: number; productId: number | null }>({ movementId: Number(m.id) })
    if (takes.some((take) => Number(take.productId) !== productId)) {
      return { ok: false, status: 400, error: 'This count took stock from a received date that now belongs to another product (the products were merged), so it cannot be reverted here. Nothing was changed; correct it with a new count instead.' }
    }
    for (const take of takes) statements.push(...restoreBatchStockStatements(Number(take.batchId), branchId, Number(take.quantity)))
    statements.push(...aggregateDeltaStatements(productId, branchId, magnitude))
    usedBatchId = takes.length === 1 && Number(takes[0].quantity) === magnitude ? Number(takes[0].batchId) : null
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
      referenceId: counterRef,
      userId: actor.userId ?? null,
      userName: actor.userName ?? null,
      batchId: usedBatchId,
    },
  })
  try {
    await db.batch([
      { sql: ALREADY_REVERTED_GUARD, params: { ref: counterRef, movementId: Number(m.id) } },
      ...statements,
      { sql: 'DELETE FROM stock_session_guards', params: {} },
    ])
  } catch (err) {
    // Nothing was written. Tell the loser of a race apart from a stock
    // change by reading what the winner committed.
    if (await revertExists(db, counterRef)) return ALREADY_REVERTED
    const message = err instanceof Error ? err.message : String(err)
    if (/CHECK constraint failed/i.test(message)) {
      return { ok: false, status: 409, code: 'stock_changed', error: 'The stock changed while this was being reverted. Nothing was changed; refresh and try again.' }
    }
    throw err
  }
  return { ok: true, revertType, quantity: magnitude, usedBatchId, movementId: m.id }
}

// In-batch assertion (stock_session_guards' CHECK(guard_value = 1), the
// repo's existing idiom): 0 when a counter-movement for this row already
// exists, or when the row itself is gone, which aborts the whole batch before
// any stock moves. The second half is FX-stock F3: a dated stock count
// re-apply reverses and DELETES its own superseded movement in one batch; a
// revert that read that row just before would otherwise compensate a
// movement that no longer exists (the stock moved twice, and a revert:<id>
// row points at nothing). The caller reports it as stock_changed.
const ALREADY_REVERTED_GUARD = `INSERT INTO stock_session_guards (guard_value)
  SELECT CASE WHEN EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id = @ref)
    OR NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id = @movementId) THEN 0 ELSE 1 END`

const ALREADY_REVERTED: RevertResult = { ok: false, status: 409, code: 'already_reverted', error: 'This movement has already been reverted.' }

async function revertExists(db: D1Compat, ref: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id = @ref LIMIT 1').get<{ id: number }>({ ref })
  return Boolean(row)
}
