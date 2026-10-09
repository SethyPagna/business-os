import { executeStockTransaction, StockTransactionUnavailableError, StockTransactionOutcomeUnknownError } from './stockTransaction'
import { productStockGuardStatement, productStockGuardError, ProductStockGuardError } from './productStockGuard'
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
  planReceiveBatchStock, planUnreceiveBatchStock, type StockWriteStatement,
} from './productBatches'
import { multiplyMoney4, MoneyPrecisionError } from './moneyPrecision'
import { CountedStockBatchPlan, countedStockFactsSql, isCountedStockConflict, subtractCountedQuantity, sumCountedQuantities } from './countedDamagedStock'
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

// Intake condition history owns its receipt. Current tags change no physical
// units; legacy tags recorded a damage_out. Both retain the receipt reference.
type TaggedReceiptIdentity = Pick<RevertMovementRow, 'id' | 'product_id' | 'branch_id' | 'batch_id' | 'quantity' | 'reason' | 'reference_id'>

const TAGGED_RECEIPT_OWNERSHIP_SQL = `SELECT reason FROM inventory_movements
    WHERE id > @taggedMovementId AND ((movement_type = 'damage_out' AND ABS(quantity) = @taggedQuantity)
        OR (movement_type = 'condition_tag' AND quantity = 0))
      AND product_id = @taggedProductId AND branch_id = @taggedBranchId
      AND COALESCE(batch_id, 0) = @taggedBatchId AND CAST(COALESCE(reference_id, '') AS TEXT) = @taggedReference
      AND reason IN (SELECT value FROM json_each(@taggedReasons))`

function taggedReceiptIdentityParams(m: TaggedReceiptIdentity) {
  return {
    taggedMovementId: Number(m.id), taggedProductId: Number(m.product_id), taggedBranchId: Number(m.branch_id),
    taggedBatchId: Number(m.batch_id) || 0, taggedQuantity: Math.abs(Number(m.quantity)),
    taggedReference: String(m.reference_id ?? ''), taggedReasons: JSON.stringify(STOCK_CONDITION_TAGS.map(tag => taggedReasonText(tag, m.reason))),
  }
}

async function isHeldAsTaggedReceipt(db: D1Compat, m: TaggedReceiptIdentity): Promise<boolean> {
  const held = await db.prepare(TAGGED_RECEIPT_OWNERSHIP_SQL).all<{ reason: string | null }>(taggedReceiptIdentityParams(m))
  return held.length > 0
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

function receiptRowGuard(m: RevertMovementRow): StockWriteStatement {
  const { lo, hi } = stockInEditRange(Number(m.id))
  const checkEdits = RECEIPT_TYPES.has(m.movement_type)
  const sessionRowid = /^\d+$/.test(String(m.reference_id ?? '')) ? Number(m.reference_id) : null
  return {
    sql: `INSERT INTO stock_session_guards (guard_value)
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM inventory_movements WHERE id=@movementId
          AND product_id IS @sourceProductId AND branch_id IS @sourceBranchId AND batch_id IS @sourceBatchId
          AND movement_type IS @sourceType AND quantity IS @sourceQuantity
          AND reason IS @sourceReason AND reference_id IS @sourceReference
          AND product_name IS @sourceProductName AND branch_name IS @sourceBranchName
          AND unit_cost_usd IS @sourceUnitCostUsd AND unit_cost_khr IS @sourceUnitCostKhr
          AND total_cost_usd IS @sourceTotalCostUsd AND total_cost_khr IS @sourceTotalCostKhr) THEN 0
        WHEN @checkTaggedReceipt = 1 AND EXISTS (${TAGGED_RECEIPT_OWNERSHIP_SQL})
          THEN json_extract('[1]','$[revert_tagged_receipt_conflict]')
        WHEN @checkEdits = 1 AND EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id >= @lo AND reference_id < @hi) THEN 0
        WHEN @rowid IS NOT NULL AND EXISTS (${SESSION_UNDONE_SQL}) THEN 0
        ELSE 1 END`,
    params: { checkEdits: checkEdits ? 1 : 0, lo, hi, rowid: sessionRowid, movementId: Number(m.id),
      checkTaggedReceipt: checkEdits && !String(m.reference_id ?? '').startsWith('revert:') ? 1 : 0,
      sourceProductId: m.product_id, sourceBranchId: m.branch_id, sourceBatchId: m.batch_id ?? null,
      sourceType: m.movement_type, sourceQuantity: m.quantity, sourceReason: m.reason ?? null, sourceReference: m.reference_id ?? null,
      sourceProductName: m.product_name ?? null, sourceBranchName: m.branch_name ?? null,
      sourceUnitCostUsd: m.unit_cost_usd ?? null, sourceUnitCostKhr: m.unit_cost_khr ?? null,
      sourceTotalCostUsd: m.total_cost_usd ?? null, sourceTotalCostKhr: m.total_cost_khr ?? null,
      ...taggedReceiptIdentityParams(m) },
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
    ORDER BY a.id LIMIT 10001
  `).all<LotShare>({ movementId: rootId })
  return rows.map((row) => ({ batchId: Number(row.batchId), quantity: Number(row.quantity), productId: row.productId == null ? null : Number(row.productId) }))
}

const MERGED_LOT_REFUSAL = 'This count moved stock on a received date that now belongs to another product (the products were merged), so it cannot be reverted here. Nothing was changed; correct it with a new count instead.'

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
  // Condition history owns both the physical stock and its damaged subset.
  // Replaying only its movement would leave the condition history inconsistent.
  if (/^(?:revert:)*condition_history:/.test(String(m.reference_id||''))) {
    return refuse(409, 'revert_use_history', 'This condition compensation has exact lot history. Use its History Undo/Redo so physical stock and tags remain together.')
  }
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
  try {
    const originalShares = batchId === null ? await rootLotShares(db, root.id) : []
    if (originalShares.length > 10000) throw new MoneyPrecisionError('too_many_terms')
    const shares = await landingShares(originalShares)
    if (shares.some(share => share.productId !== productId)) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
    const receiptIds = [...new Set([...(batchId === null ? [] : [batchId]), ...shares.map(share => share.batchId)])]
    const observed = await db.prepare(`SELECT p.is_active, ${countedStockFactsSql('@productId', '@branchId', '@receiptIds')} AS facts
      FROM products p WHERE p.id=@productId`).get<{ is_active: number; facts: string }>({ productId, branchId, receiptIds: JSON.stringify(receiptIds) })
    if (revertType === 'add' && observed?.is_active !== 1) throw new ProductStockGuardError([productId])
    const exact = new CountedStockBatchPlan([{ facts: observed?.facts ?? 'null', branchId }], { deferPhysicalWrites: true })
    const stock = exact.get(productId, branchId)
    const guards = exact.takePreimageGuards()
    const stockStatements: StockWriteStatement[] = []
    const metadata: StockWriteStatement[] = []
    type Receipt = { id: number; received_quantity: number | null; received_cost_usd: number | null;
      supplier_id: number | null; supplier_name: string | null; payment_status: string | null; credit_due_date: string | null;
      is_active: number; unit_cost_usd: number | null; received_branch_id: number | null; received_branch_name: string | null }
    let sourceReceiptId = m.batch_id == null ? null : Number(m.batch_id)
    if (purchaseSide && sourceReceiptId !== null && root.id !== Number(m.id)) {
      const original = await db.prepare('SELECT batch_id FROM inventory_movements WHERE id=@id')
        .get<{ batch_id: number | null }>({ id: root.id })
      sourceReceiptId = original?.batch_id ?? null
      if (sourceReceiptId === null) {
        const originalShares = await rootLotShares(db, root.id)
        if (originalShares.length !== 1 || originalShares[0].quantity !== magnitude) return refuse(409, 'stock_changed', 'The original receipt source cannot be identified. Nothing was changed.')
        sourceReceiptId = originalShares[0].batchId
      }
    }
    const purchaseIds = purchaseSide ? [...new Set(sourceReceiptId === null ? shares.map(share => share.receivedBatchId) : [sourceReceiptId])] : []
    const receipts = purchaseIds.length ? await db.prepare(`SELECT id,received_quantity,received_cost_usd,supplier_id,supplier_name,payment_status,credit_due_date,
      is_active,unit_cost_usd,received_branch_id,received_branch_name
      FROM product_batches WHERE variant_product_id=@productId AND id IN (SELECT value FROM json_each(@ids)) LIMIT 10001`)
      .all<Receipt>({ productId, ids: JSON.stringify(purchaseIds) }) : []
    if (receipts.length !== purchaseIds.length) return refuse(400, 'revert_lot_moved', MERGED_LOT_REFUSAL)
    if (receipts.length) guards.push({
      sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(@receipts) saved
        LEFT JOIN product_batches pb ON pb.id=json_extract(saved.value,'$.id') AND pb.variant_product_id=@productId
        WHERE pb.id IS NULL OR pb.received_quantity IS NOT json_extract(saved.value,'$.received_quantity')
          OR pb.received_cost_usd IS NOT json_extract(saved.value,'$.received_cost_usd')
          OR pb.supplier_id IS NOT json_extract(saved.value,'$.supplier_id') OR pb.supplier_name IS NOT json_extract(saved.value,'$.supplier_name')
          OR pb.payment_status IS NOT json_extract(saved.value,'$.payment_status') OR pb.credit_due_date IS NOT json_extract(saved.value,'$.credit_due_date')
          OR pb.is_active IS NOT json_extract(saved.value,'$.is_active') OR pb.unit_cost_usd IS NOT json_extract(saved.value,'$.unit_cost_usd')
          OR pb.received_branch_id IS NOT json_extract(saved.value,'$.received_branch_id') OR pb.received_branch_name IS NOT json_extract(saved.value,'$.received_branch_name'))
        THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`, params: { productId, receipts: JSON.stringify(receipts) },
    })
    const purchaseChange = (receiptId: number, quantity: number, dated: boolean) => {
      const prior = receipts.find(receipt => receipt.id === receiptId)!
      const before = prior.received_quantity
      if (revertType === 'remove') {
        metadata.push(...planUnreceiveBatchStock({ batchId: receiptId, quantity,
          totalCostUsd: dated ? receiptCostUsd : null, receivedQuantityPreimage: { quantity: before } }))
        prior.received_quantity = before === null ? null : Math.max(0, subtractCountedQuantity(before, [quantity]))
      } else if (dated) {
        const unitCostUsd = !Number(m.unit_cost_usd) && !Number(m.total_cost_usd) ? null : m.unit_cost_usd ?? null
        const receive = planReceiveBatchStock({ productId, branchId, batchId: receiptId, quantity, unitCostUsd,
          receiptTotalUsd: m.total_cost_usd != null ? Number(m.total_cost_usd) : null,
          preserveHistoricalUnitCost: true, preserveHistoricalAttribution: true,
          receiptCostPreimage: unitCostUsd != null ? { batchExists: true, receivedCostUsd: prior.received_cost_usd } : undefined,
          receivedQuantityPreimage: { quantity: before },
        })
        metadata.push(...receive.metadataStatements)
        prior.received_quantity = subtractCountedQuantity(before ?? 0, [-quantity])
      } else {
        const next = before === null ? null : subtractCountedQuantity(before, [-quantity])
        const params = { batchId: receiptId, productId, before, next }
        metadata.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_batches WHERE id=@batchId
          AND variant_product_id=@productId AND received_quantity IS @before)
          THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`, params },
          { sql: 'UPDATE product_batches SET received_quantity=@next,updated_at=CURRENT_TIMESTAMP WHERE id=@batchId', params })
        prior.received_quantity = next
      }
    }
    const move = (source: number | null, quantity: number) => {
      if (quantity <= 0) return
      const action = revertType === 'remove' ? 'consume'
        : source !== null && stock.requiresReceiptActivation(source) ? 'activateAndReceive' : 'receive'
      stockStatements.push(...stock.changeOrdinary(source, quantity, action))
    }
    if (revertType === 'remove' && magnitude > stock.branchQuantity) {
      const current = stock.branchQuantity
      return withBlocker(db, refuse(400, 'revert_insufficient_branch_stock', `Cannot revert: only ${current} in stock at ${branchLabel || 'this branch'}, ${magnitude} needed.`,
        { available: current, needed: magnitude, branch: branchLabel || '' }), { productId, branchId, batchId: null, afterMovementId: Number(m.id) })
    }
    if (batchId !== null) {
      if (revertType === 'remove') {
        const available = stock.ordinaryQuantity(batchId)
        if (magnitude > available) return withBlocker(db, lotShortRefusal(available, magnitude), { productId, branchId, batchId, afterMovementId: Number(m.id) })
      }
      move(batchId, magnitude)
      if (purchaseSide) purchaseChange(sourceReceiptId!, magnitude, true)
      usedBatchId = batchId
    } else {
      const undatedQuantity = subtractCountedQuantity(magnitude, [sumCountedQuantities(shares.map(share => share.quantity))])
      if (undatedQuantity < 0) return refuse(409, 'stock_changed', 'The recorded lot shares exceed this movement. Nothing was changed.')
      for (const share of shares) {
        if (revertType === 'remove') {
          const available = stock.ordinaryQuantity(share.batchId)
          if (share.quantity > available) return withBlocker(db, lotShortRefusal(available, share.quantity), { productId, branchId, batchId: share.batchId, afterMovementId: Number(m.id) })
        }
        move(share.batchId, share.quantity)
        if (purchaseSide) purchaseChange(share.receivedBatchId, share.quantity, false)
      }
      if (revertType === 'remove' && undatedQuantity > 0) {
        const available = stock.ordinaryQuantity(null)
        if (undatedQuantity > available) return refuse(400, 'revert_no_received_date',
          `Cannot revert: this change was saved without a received date and only ${available} of the ${undatedQuantity} units at ${branchLabel || 'this branch'} are held without one. Nothing was changed. Use Remove stock and choose the received date instead.`,
          { available, needed: undatedQuantity, branch: branchLabel || '' })
      }
      move(null, undatedQuantity)
      usedBatchId = shares.length === 1 && shares[0].quantity === magnitude ? shares[0].batchId : null
    }
    const statements = [...guards, ...stockStatements, ...exact.takeFinalPhysicalWrites(), ...metadata]

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
    await executeStockTransaction(db, addressedStatements(landing, [
      ...(revertType === 'add' ? [productStockGuardStatement([productId], 'active')] : []),
      { sql: ALREADY_REVERTED_GUARD, params: { ref: counterRef, movementId: Number(m.id) } },
      receiptRowGuard(m),
      ...statements,
      { sql: 'DELETE FROM stock_session_guards', params: {} },
    ]), 'once')
  } catch (err) {
    // A lost acknowledgement may have committed. Reconcile the original counter before classifying the refusal.
    if (await revertExists(db, counterRef)) return ALREADY_REVERTED
    if (err instanceof StockTransactionUnavailableError || err instanceof StockTransactionOutcomeUnknownError) throw err
    const message = err instanceof Error ? err.message : String(err)
    const activeGuard = productStockGuardError(err)

    if (activeGuard) throw activeGuard

    if (message.includes('$[revert_tagged_receipt_conflict]')) {
      return refuse(409, 'revert_tagged_row', 'This receipt was held as a tagged (damaged, broken, expired ...) stock row. Reverse it from that row on the product instead, so the tagged quantity moves with the stock.')
    }

    if (isCountedStockConflict(err) || err instanceof MoneyPrecisionError || /CHECK constraint failed/i.test(message)) {
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
// re-apply reverses its own superseded movement with an appended counter; a
// revert that read that row just before would otherwise compensate a
// movement already compensated (or historically deleted), moving stock twice. The caller reports it as stock_changed.
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
