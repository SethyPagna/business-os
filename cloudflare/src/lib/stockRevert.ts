// Part 553: reverting a Stock Change ledger row. A revert is a COMPENSATING
// counter-movement -- it posts the opposite stock effect and records a new
// movement row (reason "Revert of #N", reference_id "revert:N"); nothing is
// ever deleted, so the ledger stays append-only and the revert itself shows
// up in the history. The stock aggregate (products.stock_quantity +
// branch_stock) and the batch ledger are both moved through the SAME proven
// primitives the /adjust route uses, so a revert can never drift the
// aggregate from the lots.
//
// Owner, 1 Oct 2026: a Revert works like cancelling a sale -- everything
// returns with no loss and the reverted effect leaves the reports. Reverting
// a receipt un-receives it from its lot (invoice line, supplier total, credit
// and paid spend follow); reverting a removal takes its loss out of the
// original period (removalLosses.ts). The Revert row itself, dated now and
// linked by reference_id, keeps the history (test-stock-revert-past-reports.cjs).
//
// Split into a pure decision (planMovementRevert) and the db mutation
// (applyMovementRevert) so both can be driven directly by
// test-stock-revert-pure.cjs against the real migration chain -- the same
// zero-magic pattern as stockLedgerQuery.ts.
import type { D1Compat } from './db'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'
import {
  decrementBatchStockStrictStatement, planReceiveBatchStock, planRemoveStockFromBatch, planUnreceiveBatchStock,
  restoreBatchStockStatements, type StockWriteStatement,
} from './productBatches'
import { multiplyMoney4 } from './moneyPrecision'
import { MOVEMENT_RETURN_REFERENCE_TYPES, movementReferenceKindSql } from './movementReference'
import { STOCK_RECEIPT_MOVEMENT_TYPES, isStockInEditReference, stockInEditRange } from './stockInSessionsQuery'
import { STOCK_CONDITION_TAGS, isDamagedLotReference, taggedReasonText } from './stockCondition'
import { findConsumingBlocker, type StockRefusalDetails } from './stockRefusalBlocker'
import { addressedStatements, landingLotId, requestBranchEffect, type RedirectTarget } from './branchRedirectWrite'

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
  | 'revert_lot_moved' | 'revert_no_received_date' | 'revert_from_sale' | 'revert_from_return'
  | 'revert_session_undone' | 'revert_from_merge'

export type RevertRefusalParams = Record<string, string | number>

export type RevertResult =
  | { ok: true; revertType: 'add' | 'remove'; quantity: number; usedBatchId: number | null; movementId: number }
  | { ok: false; status: 400 | 409; error: string; code: RevertRefusalCode; params?: RevertRefusalParams; refusal?: StockRefusalDetails }

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

// Whether a movement changed what the SUPPLIER delivered -- i.e. whether
// reverting it must move the lot's purchase figures (received quantity/cost;
// see planUnreceiveBatchStock) and not just its stock. Keyed off the movement
// TYPE through the SAME receipt allowlist the ledger, the stock-in sessions
// list and the frontend's stockMovementDetail.ts use: only a receipt (or a
// dated count increase, which is recorded as one) is a purchase. A lot
// quantity correction ('set'), an 'adjustment', a plain removal or a legacy
// 'csv_import'/'in' row can point at a received lot without being a purchase,
// so reverting one moves stock only.
export function isReceiptMovementType(movementType: string): boolean {
  return RECEIPT_TYPES.has(movementType)
}

// Stock a sale or a return moved belongs to that record: the operator changes
// it there (cancel the sale, change its status, edit the return), never here.
const SALE_SOURCE_TYPES = new Set<string>(['sale', 'sale_from_damaged'])
const RETURN_SOURCE_TYPES = new Set<string>(MOVEMENT_RETURN_REFERENCE_TYPES)

async function sourceRecordKind(db: D1Compat, m: Pick<RevertMovementRow, 'id' | 'movement_type'>): Promise<'sale' | 'return' | null> {
  if (SALE_SOURCE_TYPES.has(m.movement_type)) return 'sale'
  if (RETURN_SOURCE_TYPES.has(m.movement_type)) return 'return'
  // 'return' / 'damage_in' / 'damage_out' are written by both families.
  const row = await db.prepare(`SELECT ${movementReferenceKindSql('m')} AS kind FROM inventory_movements m WHERE m.id = @id`)
    .get<{ kind: string | null }>({ id: Number(m.id) })
  return row?.kind === 'sale' || row?.kind === 'return' ? row.kind : null
}

// The Inventory import writes its stock-in as type 'in' (not 'add') yet puts
// it on a received lot through the receipt planner, so it is a purchase like
// every other receipt. An 'in' row with no lot, or on a lot with no received
// figures (a legacy row), changes stock only: un-receiving leaves NULL alone.
async function isLotStampedRow(db: D1Compat, id: number): Promise<boolean> {
  const row = await db.prepare('SELECT batch_id FROM inventory_movements WHERE id = @id').get<{ batch_id: number | null }>({ id })
  return row?.batch_id != null
}

// Duplicate-merge rows ('adjustment', written by routes/products.ts) are owned
// by the merge and reversed by its History Undo. The write-off is stored as a
// NEGATIVE adjustment, which no standalone stock change ever writes, so a
// Revert would move stock the wrong way; the carry-in is found by its text.
const MERGE_ROW_REASON = /\) removed -- stock written off|\) into this product --|\[merge:[^\]]+\]/

function isMergeOwnedRow(m: Pick<RevertMovementRow, 'movement_type' | 'quantity' | 'reason'>): boolean {
  if (m.movement_type !== 'adjustment') return false
  return Number(m.quantity) < 0 || MERGE_ROW_REASON.test(String(m.reason ?? ''))
}

// A receipt recorded with a condition tag is written as a normal 'add' and then
// immediately moved to the held row (routes/inventory.ts, planHoldAsTagged):
// the units are no longer sellable, so reverting the 'add' would take them out
// of sellable stock a second time. The held 'damage_out' row beside it shares
// product, branch, lot, units, reference and the tag-prefixed reason.
async function isHeldAsTaggedReceipt(db: D1Compat, m: Pick<RevertMovementRow, 'id' | 'product_id' | 'branch_id' | 'batch_id' | 'quantity' | 'reason' | 'reference_id'>): Promise<boolean> {
  const held = await db.prepare(`SELECT reason FROM inventory_movements
    WHERE id > @id AND movement_type = 'damage_out' AND product_id = @productId AND branch_id = @branchId
      AND COALESCE(batch_id, 0) = @batchId AND ABS(quantity) = @quantity AND CAST(COALESCE(reference_id, '') AS TEXT) = @reference`)
    .all<{ reason: string | null }>({
      id: Number(m.id), productId: Number(m.product_id), branchId: Number(m.branch_id), batchId: Number(m.batch_id) || 0,
      quantity: Math.abs(Number(m.quantity)), reference: String(m.reference_id ?? ''),
    })
  return held.some((row) => STOCK_CONDITION_TAGS.some((tag) => row.reason === taggedReasonText(tag, m.reason)))
}

// 0153 (and any repair like it) wrote an 'adjustment' that carries the SALE's id
// as its reference: the correction belongs to that sale. Membership, not mere
// existence, because a standalone lot correction carries a client session id
// that can equal some unrelated sale id.
async function isSaleLinkedAdjustment(db: D1Compat, m: Pick<RevertMovementRow, 'movement_type' | 'product_id' | 'reference_id'>): Promise<boolean> {
  if (m.movement_type !== 'adjustment' || !/^\d+$/.test(String(m.reference_id ?? ''))) return false
  const row = await db.prepare('SELECT 1 AS hit FROM sale_items WHERE sale_id = @saleId AND product_id = @productId LIMIT 1')
    .get<{ hit: number }>({ saleId: Number(m.reference_id), productId: Number(m.product_id) })
  return Boolean(row)
}

const SESSION_UNDONE_TEXT = 'This row belongs to a stock-in session that was undone, so its stock is already taken back. Redo the session from Stock-in Sessions first. Nothing was changed.'
const LINE_EDITED_TEXT = 'This stock-in line was edited after it was saved. Edit it again (quantity 0 removes it) or undo the edit from its history.'

// Whether the session that wrote this row is currently undone (odd generation:
// every undo adds one, every redo another).
const SESSION_UNDONE_SQL = `SELECT 1 FROM stock_session_operations o
  WHERE o.rowid = @rowid AND o.generation % 2 = 1
    AND EXISTS (SELECT 1 FROM stock_session_members sm WHERE sm.movement_id = @movementId)`

// The two states that make a receipt row no longer the thing it was when it
// was saved: a later Edit of the line (stock-in-edit:<id> rows) and an Undo of
// its session. Read once before planning, and asserted again INSIDE the batch
// below, so a change that commits in between aborts the Revert instead of
// being reversed twice.
async function receiptRowRefusal(db: D1Compat, m: Pick<RevertMovementRow, 'id' | 'movement_type' | 'reference_id'>): Promise<RevertResult | null> {
  if (RECEIPT_TYPES.has(m.movement_type)) {
    const edited = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id >= @lo AND reference_id < @hi LIMIT 1')
      .get<{ id: number }>(stockInEditRange(Number(m.id)))
    if (edited) return refuse(409, 'revert_stock_in_line_edited', LINE_EDITED_TEXT)
  }
  if (/^\d+$/.test(String(m.reference_id ?? ''))) {
    const undone = await db.prepare(SESSION_UNDONE_SQL).get<{ 1: number }>({ rowid: Number(m.reference_id), movementId: Number(m.id) })
    if (undone) return refuse(409, 'revert_session_undone', SESSION_UNDONE_TEXT)
  }
  return null
}

function receiptRowGuard(m: Pick<RevertMovementRow, 'id' | 'movement_type' | 'reference_id'>): StockWriteStatement {
  const { lo, hi } = stockInEditRange(Number(m.id))
  const checkEdits = RECEIPT_TYPES.has(m.movement_type)
  const sessionRowid = /^\d+$/.test(String(m.reference_id ?? '')) ? Number(m.reference_id) : null
  return {
    sql: `INSERT INTO stock_session_guards (guard_value)
      SELECT CASE
        WHEN @checkEdits = 1 AND EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id >= @lo AND reference_id < @hi) THEN 0
        WHEN @rowid IS NOT NULL AND EXISTS (${SESSION_UNDONE_SQL}) THEN 0
        ELSE 1 END`,
    params: { checkEdits: checkEdits ? 1 : 0, lo, hi, rowid: sessionRowid, movementId: Number(m.id) },
  }
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
// way, mirror the lot's purchase figures when the chain's root is a receipt,
// and insert the counter-movement, in ONE db.batch. Returns a
// discriminated result rather than throwing, so the route can map it straight
// to a status/JSON; a CHECK failure inside the batch becomes stock_changed.
// `redirectTarget` (X-Branch-Redirect): a row recorded at a branch that has since been disabled is reverted at
// the active branch the operator confirmed, and the counter-movement keeps the disabled branch as its addressed
// label. Without it such a revert throws the branch_redirect_required refusal (lib/branchEffect.ts).
export async function applyMovementRevert(db: D1Compat, m: RevertMovementRow, actor: RevertActor, redirectTarget: RedirectTarget = null): Promise<RevertResult> {
  const productId = Number(m.product_id) || 0
  const recordedBranchId = Number(m.branch_id) || 0
  if (!productId || !recordedBranchId) {
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
  const rowRefusal = await receiptRowRefusal(db, m)
  if (rowRefusal) return rowRefusal
  // Rows another record owns: the record's own undo reverses them with its
  // other effects, and a Revert here would move stock the wrong way or twice.
  // A Revert counter is exempt, so a wrong-direction Revert made before this
  // rule can still be reverted back.
  if (!String(m.reference_id ?? '').startsWith('revert:')) {
    if (isMergeOwnedRow(m)) {
      return refuse(400, 'revert_from_merge', 'This change came from merging duplicate products. Undo the merge from History instead. Nothing was changed.')
    }
    if (await isSaleLinkedAdjustment(db, m)) {
      return refuse(400, 'revert_from_sale', 'This change came from a sale. Change it from the sale: cancel it or change its status.')
    }
    if (RECEIPT_TYPES.has(m.movement_type) && await isHeldAsTaggedReceipt(db, m)) {
      return refuse(400, 'revert_tagged_row', 'This receipt was held as a tagged (damaged, broken, expired ...) stock row. Reverse it from that row on the product instead, so the tagged quantity moves with the stock.')
    }
  }
  const plan = planMovementRevert(m)
  if (!plan.revertible) {
    if (plan.reason === 'no_stock') return refuse(400, 'revert_nothing_to_revert', 'This movement moved no stock, so there is nothing to revert.')
    const source = await sourceRecordKind(db, m)
    if (source === 'sale') return refuse(400, 'revert_from_sale', 'This change came from a sale. Change it from the sale: cancel it or change its status.')
    if (source === 'return') return refuse(400, 'revert_from_return', 'This change came from a return. Change it from the return instead.')
    return refuse(400, 'revert_not_revertible', `A "${m.movement_type}" movement is part of a sale, return, transfer or move record and cannot be reverted from the stock ledger. Undo it from its own record instead.`, { type: m.movement_type })
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

  const landing = await requestBranchEffect(db, recordedBranchId, redirectTarget)
  const branchId = landing.effectBranchId
  const branchLabel = landing.redirected ? landing.effectName : m.branch_name
  const lotAt = async (id: number): Promise<number> => Number(await landingLotId(db, landing, id))
  // Stock moves on the lot as it exists at the landing branch; the purchase figures stay on the lot that was received.
  const landingShares = async (shares: LotShare[]): Promise<Array<LotShare & { receivedBatchId: number }>> =>
    Promise.all(shares.map(async (share) => ({ ...share, batchId: await lotAt(share.batchId), receivedBatchId: share.batchId })))
  const { revertType, magnitude } = plan
  const batchId = m.batch_id != null ? await lotAt(Number(m.batch_id)) : null
  const root = await revertRootMovement(db, m)
  if (!root) return refuse(409, 'revert_lineage_unresolved', 'Cannot revert: the original stock action cannot be identified safely. Nothing was changed.')
  // A chain takes its purchase nature from its root: receipt -> un-receive ->
  // re-receive -> ..., while the chain of a removal only moves stock.
  const purchaseSide = isReceiptMovementType(root.movement_type) || (root.movement_type === 'in' && await isLotStampedRow(db, root.id))
  // This receipt's own money for the lot's cumulative received cost (0080):
  // the movement's recorded total, else its unit cost times its units.
  const receiptCostUsd = m.total_cost_usd != null ? Number(m.total_cost_usd)
    : m.unit_cost_usd != null ? multiplyMoney4(Number(m.unit_cost_usd), magnitude) : null
  let usedBatchId: number | null = null
  const statements: StockWriteStatement[] = []

  if (revertType === 'remove') {
    const current = await branchQty(db, productId, branchId)
    if (magnitude > current) {
      return withBlocker(db, refuse(400, 'revert_insufficient_branch_stock', `Cannot revert: only ${current} in stock at ${branchLabel || 'this branch'}, ${magnitude} needed.`, { available: current, needed: magnitude, branch: branchLabel || '' }), { productId, branchId, batchId: null, afterMovementId: Number(m.id) })
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
      if (magnitude > available) return withBlocker(db, lotShortRefusal(available, magnitude), { productId, branchId, batchId, afterMovementId: Number(m.id) })
      statements.push(...planRemoveStockFromBatch({ batchId, productId, branchId, quantity: magnitude }).statements)
      usedBatchId = batchId
      // Un-purchase: the lot loses this receipt's units and money; supplier
      // and payment state stay on the row for the Revert of this Revert.
      if (purchaseSide) statements.push(...planUnreceiveBatchStock({ batchId: Number(m.batch_id), quantity: magnitude, totalCostUsd: receiptCostUsd }))
    } else {
      // No lot stamp: the count's own lot shares come back off those lots;
      // every other unit (a pre-0084 receipt, an aggregate-only add) was
      // never put on a received date, so it comes off the stock held under
      // none. Taking it from a dated lot would guess, and could drain another
      // supplier's delivery; when the undated stock is short the revert is
      // refused whole.
      const shares = await landingShares(await rootLotShares(db, root.id))
      if (shares.some((share) => share.productId !== productId)) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
      for (const share of shares) {
        const lot = await db.prepare('SELECT COALESCE(quantity, 0) AS available FROM branch_batch_stock WHERE batch_id = @batchId AND branch_id = @branchId')
          .get<{ available: number }>({ batchId: share.batchId, branchId })
        const available = Number(lot?.available) || 0
        if (share.quantity > available) return withBlocker(db, lotShortRefusal(available, share.quantity), { productId, branchId, batchId: share.batchId, afterMovementId: Number(m.id) })
        statements.push(decrementBatchStockStrictStatement(share.batchId, branchId, share.quantity))
      }
      const fromLots = shares.reduce((sum, share) => sum + share.quantity, 0)
      const undated = current - await datedLotQty(db, productId, branchId)
      if (magnitude - fromLots > undated) {
        const available = Math.max(0, undated)
        const needed = magnitude - fromLots
        return refuse(400, 'revert_no_received_date', `Cannot revert: this change was saved without a received date and only ${available} of the ${needed} units at ${branchLabel || 'this branch'} are held without one. Nothing was changed. Use Remove stock and choose the received date instead.`, { available, needed, branch: branchLabel || '' })
      }
      statements.push(...aggregateDeltaStatements(productId, branchId, -magnitude), undatedStockGuard(productId, branchId))
      // A count increase was received onto its lots: un-receive each share
      // (after the stock writes, so an emptied lot is seen as empty).
      if (purchaseSide) for (const share of shares) statements.push(...planUnreceiveBatchStock({ batchId: share.receivedBatchId, quantity: share.quantity, totalCostUsd: null }))
      usedBatchId = shares.length === 1 && shares[0].quantity === magnitude ? shares[0].batchId : null
    }
  } else if (batchId != null && purchaseSide) {
    // Reverting the revert of a receipt puts the purchase back on the same
    // lot: units and money are received again under the supplier and payment
    // state the row kept through the revert (they are not on the movement).
    // A ZEROED lot takes whatever attribution a receipt carries (clearing it
    // to NULL when none is given), so this call re-supplies the row's own.
    const priorAttribution = await db.prepare(
      'SELECT supplier_id, supplier_name, payment_status, credit_due_date FROM product_batches WHERE id = @batchId',
    ).get<{ supplier_id: number | null; supplier_name: string | null; payment_status: string | null; credit_due_date: string | null }>({ batchId })
    const before = await db.prepare(
      'SELECT id, received_cost_usd FROM product_batches WHERE id = @batchId AND variant_product_id = @productId',
    ).get<{ id: number; received_cost_usd: number | null }>({ batchId, productId })
    if (!before) return refuse(400, 'revert_lot_moved', 'Selected received date does not belong to this product')
    // Both cost columns default to 0 (0001), so a row with neither priced (a
    // dated count) carries no cost and must not turn the lot's NULL into $0.
    const unitCostUsd = !Number(m.unit_cost_usd) && !Number(m.total_cost_usd) ? null : m.unit_cost_usd ?? null
    try {
      statements.push(...planReceiveBatchStock({
        productId, branchId, quantity: magnitude, batchId, unitCostUsd,
        // Free units ride at the effective unit cost, so unit x quantity drifts off what the supplier was paid.
        receiptTotalUsd: m.total_cost_usd != null ? Number(m.total_cost_usd) : null,
        preserveHistoricalUnitCost: true,
        supplierId: priorAttribution?.supplier_id ?? null,
        supplierName: priorAttribution?.supplier_name ?? null,
        paymentStatus: priorAttribution?.payment_status === 'paid' || priorAttribution?.payment_status === 'credit' ? priorAttribution.payment_status : null,
        creditDueDate: priorAttribution?.credit_due_date ?? null,
        receiptCostPreimage: unitCostUsd != null ? { batchExists: true, receivedCostUsd: before.received_cost_usd ?? null } : undefined,
      }).statements)
    } catch (err) {
      return refuse(400, 'revert_lot_moved', err instanceof Error ? err.message : 'Failed to revert stock')
    }
    usedBatchId = batchId
  } else if (batchId != null) {
    // Putting back units a plain removal took out is not a new delivery: the
    // lot regains its stock (and picker visibility), its received figures stay.
    const lot = await db.prepare('SELECT id FROM product_batches WHERE id = @batchId AND variant_product_id = @productId')
      .get<{ id: number }>({ batchId, productId })
    if (!lot) return refuse(400, 'revert_lot_moved', 'Selected received date does not belong to this product')
    statements.push(...restoreBatchStockStatements(batchId, branchId, magnitude), ...aggregateDeltaStatements(productId, branchId, magnitude))
    usedBatchId = batchId
  } else {
    // No lot stamp: a count's lot shares go back on those lots (receive 4
    // and 8, count to 0, revert -> lots 4 / 8, not branch 12 / lots 0), and a
    // count increase is received on them again; what no lot held stays
    // branch-only, as the original left it.
    const shares = await landingShares(await rootLotShares(db, root.id))
    if (shares.some((share) => share.productId !== productId)) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
    for (const share of shares) {
      statements.push(...restoreBatchStockStatements(share.batchId, branchId, share.quantity))
      if (purchaseSide) {
        statements.push({
          sql: `UPDATE product_batches SET received_quantity = CASE WHEN received_quantity IS NULL THEN NULL ELSE received_quantity + @quantity END,
                  updated_at = CURRENT_TIMESTAMP WHERE id = @batchId`,
          params: { batchId: share.receivedBatchId, quantity: share.quantity },
        })
      }
    }
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
      branchName: branchLabel,
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
    await db.batch(addressedStatements(landing, [
      { sql: ALREADY_REVERTED_GUARD, params: { ref: counterRef, movementId: Number(m.id) } },
      receiptRowGuard(m),
      ...statements,
      { sql: 'DELETE FROM stock_session_guards', params: {} },
    ]))
  } catch (err) {
    // Nothing was written. Tell the loser of a race apart from a stock
    // change by reading what the winner committed.
    if (await revertExists(db, counterRef)) return ALREADY_REVERTED
    const message = err instanceof Error ? err.message : String(err)
    if (/CHECK constraint failed/i.test(message)) {
      // The in-batch receipt guard: an Edit or a session Undo landed after the
      // reads above. Say which, instead of a generic "stock changed".
      const changed = await receiptRowRefusal(db, m)
      if (changed) return changed
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

// RET-D (owner, 5 Oct 2026): a short-stock refusal names the movement that
// took the units since this one -- WHY and WHERE (lib/stockRefusalBlocker.ts).
// Read only after the refusal is decided, never on the success path.
async function withBlocker(db: D1Compat, result: RevertResult, input: Parameters<typeof findConsumingBlocker>[1]): Promise<RevertResult> {
  if (result.ok) return result
  const refusal = await findConsumingBlocker(db, input)
  return refusal ? { ...result, refusal } : result
}

function lotShortRefusal(available: number, needed: number): RevertResult {
  return refuse(400, 'revert_insufficient_lot_stock', `Cannot revert: only ${available} available under this received date at this branch, ${needed} needed.`, { available, needed })
}

async function revertExists(db: D1Compat, ref: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM inventory_movements WHERE reference_id = @ref LIMIT 1').get<{ id: number }>({ ref })
  return Boolean(row)
}
