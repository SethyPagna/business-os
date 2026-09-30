// Part 553: reverting a Stock Change ledger row. A revert is a COMPENSATING
// counter-movement -- it posts the opposite stock effect and records a new
// movement row (reason "Revert of #N", reference_id "revert:N"); nothing is
// ever deleted, so the ledger stays append-only and the revert itself shows
// up in the history. The stock aggregate (products.stock_quantity +
// branch_stock) and the batch ledger are both moved through the SAME proven
// primitives the /adjust route uses, so a revert can never drift the
// aggregate from the lots.
//
// Owner, 30 Sep 2026: a Revert moves STOCK only, dated now. It never changes a
// past record: a reverted receipt keeps its lot's received quantity, cost,
// date, supplier and payment state, so past purchase reports, supplier totals
// and credit stay exactly as recorded (test-stock-revert-past-reports.cjs).
//
// Split into a pure decision (planMovementRevert) and the db mutation
// (applyMovementRevert) so both can be driven directly by
// test-stock-revert-pure.cjs against the real migration chain -- the same
// zero-magic pattern as stockLedgerQuery.ts.
import type { D1Compat } from './db'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'
import { decrementBatchStockStrictStatement, planRemoveStockFromBatch, restoreBatchStockStatements, type StockWriteStatement } from './productBatches'
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

// Every refusal carries a stable code (and the numbers its text needs) so the
// app can show it in the operator's language (frontend stockRevertError.ts).
export type RevertRefusalCode =
  | 'already_reverted' | 'stock_changed' | 'revert_not_tied' | 'revert_tagged_row' | 'revert_use_history'
  | 'revert_stock_in_line_edited' | 'revert_nothing_to_revert' | 'revert_not_revertible' | 'revert_session_generation'
  | 'revert_lineage_unresolved' | 'revert_insufficient_branch_stock' | 'revert_insufficient_lot_stock'
  | 'revert_lot_moved' | 'revert_no_received_date'

export type RevertRefusalParams = Record<string, string | number>

export type RevertResult =
  | { ok: true; revertType: 'add' | 'remove'; quantity: number; usedBatchId: number | null; movementId: number }
  | { ok: false; status: 400 | 409; error: string; code: RevertRefusalCode; params?: RevertRefusalParams }

function refuse(status: 400 | 409, code: RevertRefusalCode, error: string, params?: RevertRefusalParams): RevertResult {
  return params ? { ok: false, status, code, error, params } : { ok: false, status, code, error }
}

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

// What this product holds at the branch under a received date. Whatever
// branch_stock holds beyond it is stock with no date at all.
const DATED_LOT_QTY_SQL = `SELECT COALESCE(SUM(bbs.quantity), 0) AS quantity FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  WHERE pb.variant_product_id = @productId AND bbs.branch_id = @branchId`

async function datedLotQty(db: D1Compat, productId: number, branchId: number): Promise<number> {
  const row = await db.prepare(DATED_LOT_QTY_SQL)
    .get<{ quantity: number }>({ productId, branchId })
  return Number(row?.quantity) || 0
}

// In-batch assertion (stock_session_guards' CHECK(guard_value = 1)) that taking
// undated units never leaves branch_stock below its dated lots: a sale that
// consumed the undated units after the read above aborts the whole revert
// instead of forking the two stock ledgers.
function undatedStockGuard(productId: number, branchId: number): StockWriteStatement {
  return {
    sql: `INSERT INTO stock_session_guards (guard_value)
      SELECT CASE WHEN COALESCE((SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = @branchId), 0)
        >= (SELECT quantity FROM (${DATED_LOT_QTY_SQL})) THEN 1 ELSE 0 END`,
    params: { productId, branchId },
  }
}

type LotShare = { batchId: number; quantity: number; productId: number | null }

// FX-stock4 N1. A count that no single lot covered carries no batch_id (0084)
// but records what it moved on each lot (dated_stock_count_batch_actions,
// 0035). Every Revert in its chain moves exactly those lot shares back or
// forth -- read from the ROOT row, since the counters record none of their
// own -- so the lots never drift from what the count did. Other batch-less
// rows (a manual multi-lot remove, an aggregate-only add) have no shares.
async function rootLotShares(db: D1Compat, rootId: number): Promise<LotShare[]> {
  const rows = await db.prepare(`
    SELECT a.batch_id AS batchId, ABS(a.quantity) AS quantity, pb.variant_product_id AS productId
    FROM dated_stock_count_batch_actions a
    LEFT JOIN product_batches pb ON pb.id = a.batch_id
    WHERE a.movement_id = @movementId AND a.quantity <> 0
    ORDER BY a.id
  `).all<LotShare>({ movementId: rootId })
  return rows.map((row) => ({ batchId: Number(row.batchId), quantity: Number(row.quantity), productId: row.productId == null ? null : Number(row.productId) }))
}

const MERGED_LOT_REFUSAL = 'This count moved stock on a received date that now belongs to another product (the products were merged), so it cannot be reverted here. Nothing was changed; correct it with a new count instead.'

// The aggregate-only move (branch_stock + products.stock_quantity) -- used for
// the units of a batch-less movement that no lot holds.
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

// A revert counter-movement (reference_id 'revert:N') compensates a row that
// must still exist, however deep the chain. One indexed statement follows
// appended counters to their root; strictly decreasing ids prevent cycles
// without truncating valid chains. A reversal whose original cannot be
// identified is refused.
export async function revertRootMovement(
  db: D1Compat,
  m: Pick<RevertMovementRow, 'id' | 'movement_type' | 'reference_id'>,
): Promise<{ id: number; movement_type: string } | null> {
  if (!String(m.reference_id ?? '').startsWith('revert:')) return { id: Number(m.id), movement_type: m.movement_type }
  return await db.prepare(`WITH RECURSIVE ancestry(id, movement_type, reference_id) AS (
    SELECT id, movement_type, reference_id FROM inventory_movements WHERE id=@id
    UNION ALL
    SELECT parent.id, parent.movement_type, parent.reference_id
    FROM inventory_movements parent JOIN ancestry child
      ON parent.id=CAST(SUBSTR(child.reference_id,8) AS INTEGER)
    WHERE child.reference_id='revert:' || CAST(parent.id AS TEXT) AND parent.id > 0 AND parent.id < child.id
  ) SELECT id, movement_type FROM ancestry
    WHERE COALESCE(SUBSTR(reference_id,1,7),'') != 'revert:' LIMIT 1`)
    .get<{ id: number; movement_type: string }>({ id: Number(m.id) }) || null
}

// Apply the revert: move the stock (aggregate + batch ledger) the opposite
// way and insert the counter-movement, in ONE db.batch. Returns a
// discriminated result rather than throwing, so the route can map it straight
// to a status/JSON; a CHECK failure inside the batch becomes stock_changed.
export async function applyMovementRevert(db: D1Compat, m: RevertMovementRow, actor: RevertActor): Promise<RevertResult> {
  const productId = Number(m.product_id) || 0
  const branchId = Number(m.branch_id) || 0
  if (!productId || !branchId) {
    return refuse(400, 'revert_not_tied', 'This movement is not tied to a product and branch, so it cannot be reverted here.')
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
    return refuse(400, 'revert_tagged_row', 'This movement belongs to a tagged (damaged, broken, expired ...) stock row. Reverse it from that row on the product instead, so the tagged quantity moves with the stock.')
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
    return refuse(409, 'revert_use_history', 'This stock correction has exact history. Use Undo/Redo in its history; it cannot be reverted from the stock ledger.')
  }
  // N6: a stock-in line edit (lib/stockInLineEdit.ts) is replayed only through
  // its own history generation, and a line that was edited is no longer just
  // its root receipt row: reverting the root would take back the ORIGINAL
  // quantity from the ORIGINAL lot. Both are refused; the line is changed (or
  // set to 0) through its Edit, and an edit is reversed with Undo.
  if (isStockInEditReference(setReference) || isStockInEditReference(setParent?.reference_id)) {
    return refuse(409, 'revert_use_history', 'This row belongs to an edit of a stock-in line. Use Undo/Redo in its history, or edit the line again.')
  }
  if (RECEIPT_TYPES.has(m.movement_type)) {
    const edited = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id >= @lo AND reference_id < @hi LIMIT 1')
      .get<{ id: number }>(stockInEditRange(Number(m.id)))
    if (edited) {
      return refuse(409, 'revert_stock_in_line_edited', 'This stock-in line was edited after it was saved. Edit it again (quantity 0 removes it) or undo the edit from its history.')
    }
  }
  const plan = planMovementRevert(m)
  if (!plan.revertible) {
    return plan.reason === 'no_stock'
      ? refuse(400, 'revert_nothing_to_revert', 'This movement moved no stock, so there is nothing to revert.')
      : refuse(400, 'revert_not_revertible', `A "${m.movement_type}" movement is part of a sale, return, transfer or move record and cannot be reverted from the stock ledger. Undo it from its own record instead.`, { type: m.movement_type })
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
      return refuse(409, 'revert_session_generation', `This row was written by the undo/redo of stock-in session ${generationOf.id}. Redo or undo that session from Stock-in Sessions instead.`, { session: generationOf.id })
    }
  }

  const { revertType, magnitude } = plan
  const batchId = m.batch_id != null ? Number(m.batch_id) : null
  const root = await revertRootMovement(db, m)
  if (!root) return refuse(409, 'revert_lineage_unresolved', 'Cannot revert: the original stock action cannot be identified safely. Nothing was changed.')
  let usedBatchId: number | null = null
  const statements: StockWriteStatement[] = []

  if (revertType === 'remove') {
    const current = await branchQty(db, productId, branchId)
    if (magnitude > current) {
      return refuse(400, 'revert_insufficient_branch_stock', `Cannot revert: only ${current} in stock at ${m.branch_name || 'this branch'}, ${magnitude} needed.`, { available: current, needed: magnitude, branch: m.branch_name || '' })
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
      if (!lot) return refuse(400, 'revert_lot_moved', 'Selected received date does not belong to this product')
      const available = Number(lot.available) || 0
      if (magnitude > available) return lotShortRefusal(available, magnitude)
      statements.push(...planRemoveStockFromBatch({ batchId, productId, branchId, quantity: magnitude }).statements)
      usedBatchId = batchId
    } else {
      // No lot stamp: the count's own lot shares come back off those lots;
      // every other unit (a pre-0084 receipt, an aggregate-only add) was
      // never put on a received date, so it comes off the stock held under
      // none. Taking it from a dated lot would guess, and could drain another
      // supplier's delivery; when the undated stock is short the revert is
      // refused whole.
      const shares = await rootLotShares(db, root.id)
      if (shares.some((share) => share.productId !== productId)) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
      for (const share of shares) {
        const lot = await db.prepare('SELECT COALESCE(quantity, 0) AS available FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = @branchId')
          .get<{ available: number }>({ batchId: share.batchId, branchId })
        const available = Number(lot?.available) || 0
        if (share.quantity > available) return lotShortRefusal(available, share.quantity)
        statements.push(decrementBatchStockStrictStatement(share.batchId, branchId, share.quantity))
      }
      const fromLots = shares.reduce((sum, share) => sum + share.quantity, 0)
      const undated = current - await datedLotQty(db, productId, branchId)
      if (magnitude - fromLots > undated) {
        const available = Math.max(0, undated)
        const needed = magnitude - fromLots
        return refuse(400, 'revert_no_received_date', `Cannot revert: this change was saved without a received date and only ${available} of the ${needed} units at ${m.branch_name || 'this branch'} are held without one. Nothing was changed. Use Remove stock and choose the received date instead.`, { available, needed, branch: m.branch_name || '' })
      }
      statements.push(...aggregateDeltaStatements(productId, branchId, -magnitude), undatedStockGuard(productId, branchId))
      usedBatchId = shares.length === 1 && shares[0].quantity === magnitude ? shares[0].batchId : null
    }
  } else if (batchId != null) {
    // Putting units back is not a new delivery, whether the original was a
    // removal or the Revert of a receipt: the lot regains its stock (and
    // picker visibility), its received figures stay as recorded.
    const lot = await db.prepare('SELECT id FROM product_batches WHERE id = @batchId AND variant_product_id = @productId')
      .get<{ id: number }>({ batchId, productId })
    if (!lot) return refuse(400, 'revert_lot_moved', 'Selected received date does not belong to this product')
    statements.push(...restoreBatchStockStatements(batchId, branchId, magnitude), ...aggregateDeltaStatements(productId, branchId, magnitude))
    usedBatchId = batchId
  } else {
    // No lot stamp: a count's lot shares go back on those lots (receive 4
    // and 8, count to 0, revert -> lots 4 / 8, not branch 12 / lots 0); what
    // no lot held stays branch-only, as the original left it.
    const shares = await rootLotShares(db, root.id)
    if (shares.some((share) => share.productId !== productId)) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
    for (const share of shares) statements.push(...restoreBatchStockStatements(share.batchId, branchId, share.quantity))
    statements.push(...aggregateDeltaStatements(productId, branchId, magnitude))
    usedBatchId = shares.length === 1 && shares[0].quantity === magnitude ? shares[0].batchId : null
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
      return refuse(409, 'stock_changed', 'The stock changed while this was being reverted. Nothing was changed; refresh and try again.')
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

const ALREADY_REVERTED: RevertResult = refuse(409, 'already_reverted', 'This movement has already been reverted.')

function lotShortRefusal(available: number, needed: number): RevertResult {
  return refuse(400, 'revert_insufficient_lot_stock', `Cannot revert: only ${available} available under this received date at this branch, ${needed} needed.`, { available, needed })
}

async function revertExists(db: D1Compat, ref: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id = @ref LIMIT 1').get<{ id: number }>({ ref })
  return Boolean(row)
}
