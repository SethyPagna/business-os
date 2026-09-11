import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb } from './db'
import { audit } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { branchUpdateStatements } from './branchWrites'
import { getActionTier, getPermissionTier, type PermissionTier } from './permissions'
import {
  buildAllocationStatements,
  buildOperationAllocationStatements,
  planSaleLineAddition,
  planUnlottedSaleLineGuards,
  planSaleLineRemoval,
  plannedLineFromRecord,
  saleLineKhrSnapshotStatement,
  saleMoneyUpdateStatement,
  type SaleAddItemsReversal,
} from './saleLineAddition'
// S4-30: an undo/redo of an addition appends a compensating entry to the sale's
// amendment ledger, so there is ONE audit trail and the Undo button writes into
// it rather than around it. Never a rewrite -- migration 0115's triggers refuse
// that outright.
import { amendmentEntryStatement } from './saleAmendments'
import { replaySaleBulkStatus } from './saleBulkStatus'
import { BULK_CUSTOMER_UPDATE_KIND, BULK_UPDATE_KIND, MULTI_CUSTOMER_UPDATE_KIND, SINGLE_CUSTOMER_UPDATE_KIND, replaySaleBulkUpdate } from './saleBulkUpdate'
import { RETURN_BULK_ACTION_KIND, replayReturnBulkAction } from './returnBulkAction'
import { SALE_SETTLEMENT_ACTION_KIND, replaySaleSettlementAction, saleMutationGuard } from './saleSettlementAction'
import { STOCK_SESSION_KIND, replayStockSession } from './stockSession'
import { actorSnapshot } from './actorSnapshot'
import {
  parseProductMergeClusterPlan,
  resolveProductMergeClusterPlanEconomics,
  type ProductMergeEconomics,
} from './productMerge'
import { PRODUCT_REMOVE_ACTION_KIND, parseProductRemoveSnapshot, productRemovePlanDigest, productRemoveReplayStatements,
  type ProductRemoveOperationRow } from './productDelete'

export const SALE_ADD_ITEMS_ACTION_KIND = 'sale.add_items'

// Server-side undo/redo appliers (K1). The action_history store has always
// held an undo_payload / redo_payload per recorded action, but historically
// the CLIENT replayed them from a live in-memory closure -- so reversibility
// died on page reload (utils/actionHistory.ts's own comment explains why a
// generic closure cannot be serialized). This registry lets the WORKER replay
// a payload instead, whenever the payload names an applier registered here, so
// an admin/user can undo or redo an action that outlives their browser tab.
//
// The contract is intentionally additive: only a payload carrying a known
// `applier` string is executed server-side; anything else falls through to the
// pre-existing status-flip-and-return-payload behavior, so every action that
// does not opt in is untouched. Each applier replays a payload through the SAME
// write path the live route uses (see branchUpdateStatements) rather than a
// second copy of the SQL, and composes its own audit + broadcast -- an undo is
// an already-authorized direct action on an existing row, so it deliberately
// does not re-enter the review queue.
//
// Scope of this first slice: branch field edits (`branch.update`). Create/
// delete reversal (which has to reconcile a changing row id across the undo/
// redo cycle) and the other action_history scopes are the roadmap in
// progress.md's K1 -- each is added here as its consumer starts emitting a
// declarative payload.

export interface UndoApplierContext {
  env: Env
  user: SessionUser | null
  direction: 'undo' | 'redo'
  historyId?: number
  generation?: unknown
}

export interface UndoApplierOutcome {
  complete: boolean
  continuation_required: boolean
  processed_children: number
  pending_children: number
  generation: number
}

export type UndoApplier = (payload: Record<string, unknown>, ctx: UndoApplierContext) => Promise<void | UndoApplierOutcome>

export class UndoConflictError extends Error {
  readonly statusCode = 409
}

// Every applier declares the permission section its replay writes under, and
// optionally the granular ACTION within that section (merge_duplicates, say),
// so an applier is gated exactly as tightly as the live route it mirrors --
// never merely by the coarse section tier when the forward action itself is
// action-gated. This -- the server-side registry -- is the AUTHORITY the route
// checks at both record and operate time, never the row's client-supplied
// entity/scope (the Part-77 CRITICAL finding: an unrecognized entity derived an
// empty permission and gated nothing, so any account could store a payload
// naming 'branch.update' under scope 'global' and have the Worker write
// branches for it). A replay is a DIRECT write with no review queue, so the
// required tier is FULL: a review-tier user's forward edit is queued for
// approval, and their undo must not be the one path that writes the section
// directly.
type UndoApplierDef = { permission: string; action?: string; run: UndoApplier }

// The effective tier THIS user has over an applier's replay: the granular
// action tier when the applier declares one, else the coarse section tier.
// The single place the three gate sites (record, map, operate) agree on how
// an applier's permission is evaluated, so they can never drift.
export function applierPermissionTier(user: SessionUser, applier: { permission: string; action?: string }): PermissionTier {
  return applier.action
    ? getActionTier(user, applier.permission, applier.action)
    : getPermissionTier(user, applier.permission)
}

// ---------------------------------------------------------------------------
// product.merge -- reload-durable undo/redo for a duplicate-product merge.
//
// A merge (routes/products.ts foldDuplicateProductInto) folds a duplicate into
// a keeper: it sums branch stock, re-points/folds batches, carries images, and
// re-parents the dup's sale_items + inventory_movements, then soft-deletes the
// dup. Reversing that touches an unbounded number of rows, so the reversal
// snapshot lives in the undo_snapshots side table (0097), not the 20 KB
// action_history payload -- the action_history row carries only
// { applier: 'product.merge', snapshot_id }.
//
// UNDO restores both products to their exact pre-merge state from the captured
// snapshot. REDO re-runs the SAME production fold (no second copy of the merge
// SQL) -- deterministic because undo restored the exact pre-merge state -- and
// overwrites the snapshot with the fresh reversal it returns. The dup is only
// ever soft-deleted, so its id is stable across the whole undo/redo cycle.
// ---------------------------------------------------------------------------

export interface MergeReversal {
  keeperId: number
  keeperName: string | null
  dupId: number
  dupName: string | null
  mergeContext: string
  /** Immutable source economics/membership for a resumable bulk cluster. */
  bulkClusterPlan?: unknown
  keeperImagePathBefore: string | null
  /** Duplicate primary captured for image-effect permission checks on replay. */
  dupImagePathBefore?: string | null
  keeperBarcodeBefore?: string | null
  /** Optional exact keeper catalog before-image for reviewed v2 merges. */
  keeperCatalogBefore?: {
    category: string | null
    categories: string | null
    brand: string | null
    brands: string | null
    unit: string | null
    unit_normalized: string | null
    brand_compact: string | null
  }
  // Optional for backward compatibility with snapshots written before merge
  // cleanup began carrying the highest selling/wholesale prices to the keeper.
  keeperPricingBefore?: {
    selling_price_usd: number
    selling_price_khr: number
    // The discounted tier. Current snapshots carry wholesale_price_*; snapshots
    // written before S4-32 carry the same numbers under the retired
    // special_price_* spelling (migration 0111 moved the column, not the
    // meaning). BOTH are optional and neither may be defaulted to 0 -- see
    // wholesaleSet below for why a `|| 0` here would silently wipe a real
    // wholesale price off the keeper the moment an old merge is undone.
    wholesale_price_usd?: number
    wholesale_price_khr?: number
    /** @deprecated pre-S4-32 spelling of wholesale_price_usd; read-only fallback. */
    special_price_usd?: number
    /** @deprecated pre-S4-32 spelling of wholesale_price_khr; read-only fallback. */
    special_price_khr?: number
    // Optional again, one layer deeper: snapshots written before Sep 4 2026
    // predate cost being merged at all, so they carry no cost to restore and
    // must leave the keeper's cost alone rather than zero it.
    cost_price_usd?: number
    cost_price_khr?: number
  }
  keeperStockBefore: Array<{ branch_id: number; quantity: number }>
  dupStockBefore: Array<{ branch_id: number; quantity: number; rfid_confirmed_qty: number }>
  dupImagesBefore: Array<{ image_path: string; sort_order: number | null }>
  imagesMovedToKeeper: string[]
  repointedBatches: Array<{ id: number; batchNumber: number | null }>
  foldedBatches: Array<{
    dupBatchId: number
    keeperBatchId: number
    dupStockBefore: Array<{ branch_id: number; quantity: number }>
    keeperStockBefore: Array<{ branch_id: number; quantity: number }>
    saleAllocationIds?: number[]
    returnAllocationIds?: number[]
  }>
  reparentedSaleItemIds: number[]
  reparentedMovementIds: number[]
  adjustmentMovementIds: number[]
  // New atomic merge snapshots identify their own adjustment rows with a
  // cryptographically random marker because their integer ids do not exist
  // until the same D1 batch that stores this snapshot runs.
  adjustmentMovementMarker?: string
  // What the fold did with the discarded row's stock. Absent on snapshots
  // written before the choice existed -- those were all 'merge'.
  stockDisposition?: MergeStockDisposition
  // WRITE-OFF only: the discarded row's lots, deactivated in place with their
  // per-branch stock cleared. Undo reactivates each and re-inserts the stock.
  writtenOffBatches?: Array<{
    batchId: number
    stockBefore: Array<{ branch_id: number; quantity: number }>
  }>
  // Every OTHER foreign key the fold moved onto the keeper, table by table, so
  // undo can put each row back on the discarded id. sale_items and
  // inventory_movements keep their own dedicated fields above for
  // backward-compatibility with snapshots written before this existed.
  reparentedByTable?: Array<{ table: string; column: string; ids: number[] }>
  // promotion_rules.product_ids is a JSON id LIST in a TEXT column, so the walk
  // above (INTEGER FK columns) cannot reach it. The fold rewrites the discarded
  // id to the keeper inside the array; this is the array as it was, verbatim, so
  // undo restores the exact string rather than a re-serialized approximation of
  // it. Absent on snapshots written before this existed, and on any merge whose
  // discarded row was in no rule.
  promotionRulesBefore?: Array<{ id: number; product_ids: string }>
  // products.parent_id: the children the fold moved from the discarded row onto
  // the keeper (the keeper itself is never in this list -- a row cannot be its
  // own parent).
  reparentedChildProductIds?: number[]
  // Only present when the KEEPER was itself a child of the discarded row: the
  // fold cleared that parent link, and undo puts this value back.
  keeperParentIdBefore?: number | null
  mergedStateFingerprint?: string
  fingerprintPending?: boolean
  operationId?: string
}

export const PRODUCT_MERGE_GROUP_ACTION_KIND = 'product.merge.group'
export const PRODUCT_MERGE_GROUP_CHILD_KIND = 'product.merge.group.child'
const PRODUCT_MERGE_APPLIER_KINDS = new Set(['product.merge', 'product.merge.bulk', PRODUCT_MERGE_GROUP_ACTION_KIND])

function mergeReversalHasSavedImageEffect(reversal: MergeReversal): boolean {
  if ((reversal.dupImagesBefore || []).length || (reversal.imagesMovedToKeeper || []).length) return true
  if (Object.prototype.hasOwnProperty.call(reversal, 'dupImagePathBefore')) {
    return !String(reversal.keeperImagePathBefore || '').trim() && Boolean(String(reversal.dupImagePathBefore || '').trim())
  }
  return false
}

/** Whether this saved merge direction will change a cover or gallery. */
export async function mergeReplayChangesProductImages(
  env: Env,
  payload: Record<string, unknown>,
  direction: 'undo' | 'redo',
): Promise<boolean> {
  const kind = String(payload.applier || '')
  const snapshotId = Number(payload.snapshot_id || 0)
  if (!PRODUCT_MERGE_APPLIER_KINDS.has(kind) || !Number.isInteger(snapshotId) || snapshotId <= 0) return false
  const db = getDb(env)
  const snap = await db.prepare('SELECT payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
    .get<{ payload_json: string }>([snapshotId, kind])
  // A group pointer fans out to child snapshots. Missing or malformed group
  // state fails closed: the replay itself will reject it, and history must not
  // advertise the operation to an actor without image authority meanwhile.
  if (!snap) return kind === PRODUCT_MERGE_GROUP_ACTION_KIND
  let reversals: MergeReversal[] = []
  try {
    const parsed = JSON.parse(snap.payload_json) as MergeReversal | { reversals?: MergeReversal[]; child_snapshot_ids?: unknown[] }
    if (kind === PRODUCT_MERGE_GROUP_ACTION_KIND) {
      const rawChildIds = (parsed as { child_snapshot_ids?: unknown[] }).child_snapshot_ids
      const childIds = intIds(rawChildIds)
      if (!Array.isArray(rawChildIds) || !childIds.length || childIds.length !== rawChildIds.length || childIds.length !== new Set(childIds).size) return true
      // One aggregate lookup covers the entire ordered child set without
      // materializing thousands of reversal payloads or issuing one query per
      // 80 ids. New group-child snapshots always carry dupImagePathBefore, so
      // the legacy live-product fallback below is unnecessary for this kind.
      const effect = await db.prepare(`
        SELECT COUNT(j.value) AS referenced_count,COUNT(s.id) AS found_count,
          MAX(CASE WHEN
            json_array_length(json_extract(s.payload_json,'$.dupImagesBefore')) > 0
            OR json_array_length(json_extract(s.payload_json,'$.imagesMovedToKeeper')) > 0
            OR (json_type(s.payload_json,'$.dupImagePathBefore') IS NOT NULL
              AND trim(COALESCE(json_extract(s.payload_json,'$.keeperImagePathBefore'),''))=''
              AND trim(COALESCE(json_extract(s.payload_json,'$.dupImagePathBefore'),''))!='')
          THEN 1 ELSE 0 END) AS changes_images
        FROM json_each(?) j
        LEFT JOIN undo_snapshots s ON s.id=CAST(j.value AS INTEGER) AND s.kind=?
      `).get<{ referenced_count: number; found_count: number; changes_images: number | null }>([JSON.stringify(childIds), PRODUCT_MERGE_GROUP_CHILD_KIND])
      if (Number(effect?.referenced_count) !== childIds.length || Number(effect?.found_count) !== childIds.length) return true
      return Number(effect?.changes_images) === 1
    } else {
      reversals = kind === 'product.merge.bulk'
        ? (Array.isArray((parsed as { reversals?: MergeReversal[] }).reversals) ? (parsed as { reversals: MergeReversal[] }).reversals : [])
        : [parsed as MergeReversal]
    }
  } catch (_) {
    return kind === PRODUCT_MERGE_GROUP_ACTION_KIND
  }
  if (reversals.some(mergeReversalHasSavedImageEffect)) return true

  // Old snapshots predate dupImagePathBefore. Query their current cover state
  // to distinguish an image-free merge from primary-image adoption without
  // overblocking image-free undo/redo.
  const legacy = reversals.filter((reversal) => !Object.prototype.hasOwnProperty.call(reversal, 'dupImagePathBefore'))
  for (const reversal of legacy) {
    const [keeper, duplicate] = await Promise.all([
      db.prepare('SELECT image_path FROM products WHERE id = ?').get<{ image_path: string | null }>([Number(reversal.keeperId)]),
      db.prepare('SELECT image_path FROM products WHERE id = ?').get<{ image_path: string | null }>([Number(reversal.dupId)]),
    ])
    const keeperPath = String(keeper?.image_path || '').trim()
    const duplicatePath = String(duplicate?.image_path || '').trim()
    const keeperBefore = String(reversal.keeperImagePathBefore || '').trim()
    if (direction === 'undo' ? keeperPath !== keeperBefore : (!keeperPath && Boolean(duplicatePath))) return true
  }
  return false
}

// What a merge does with the stock still sitting on the row being discarded.
// 'merge'     -- every lot moves onto the keeper with its batch/branch identity.
// 'write_off' -- the lots are zeroed and a balancing ledger movement is written.
// There is deliberately no third, silent path: a caller that supplies neither
// for a stocked row is rejected (see routes/products.ts's merge endpoint).
export type MergeStockDisposition = 'merge' | 'write_off'

// The ONE list of foreign keys a product merge must move onto the survivor.
// Kept here (a lib) rather than in the route so the forward fold and the undo
// applier read the SAME list and can never drift -- and so undo can validate a
// snapshot's table/column names against it before they ever reach SQL.
//
// The list is COMPLETE against the schema, checked by sweeping every migration
// for a *product_id column (test-merge-duplicates-carries-all-pure.cjs runs the
// same sweep, so a new table with a product FK fails there rather than silently
// orphaning rows). Everything not on the list is excluded ON PURPOSE:
//
//   branch_stock, product_batches.variant_product_id, product_images -- moved by
//     the fold itself, per branch / per batch_key / de-duplicated by path,
//     which a blind UPDATE could not do.
//   promotion_rules.product_ids -- also moved by the fold itself, and it could
//     never be on this list: it is a JSON ARRAY of ids in a TEXT column, not an
//     INTEGER FK, so neither this walk nor the migration sweep that keeps the
//     walk honest can see it. It IS a live link (promotionRules.ts's
//     ruleAppliesToProduct does `rule.product_ids.includes(product.id)`), so a
//     rule scoped to the discarded row simply stopped applying to anything the
//     moment the merge deactivated that row -- a discount that left the
//     catalogue silently. The fold rewrites the id inside the array,
//     de-duplicating when the keeper was already scoped, and records the
//     previous array verbatim (promotionRulesBefore) so undo restores it exactly.
//   products.parent_id -- the same shape of miss for the opposite reason: it is
//     a product FK that is not named *product_id, on the products table itself.
//     A child variant pointing at the discarded row would be left rooted on a
//     deactivated parent (familyPagination.ts joins `parent.id = p.parent_id`),
//     so the fold moves the children onto the keeper and records their ids.
//   stock_row_moves, import_auto_merges, legacy_* -- these record what a PAST
//     operation did to a specific product id; repointing them would rewrite
//     provenance rather than move a live link.
//   sale_amendments.product_id -- a SNAPSHOT, not a link. 0115:73 says so in
//     the schema itself ("product_id/product_name are snapshotted here and not
//     looked up"), so the amendment must keep naming the row the amendment was
//     actually made against.
//   stock_session_members.product_id -- provenance AND the replay driver. It is
//     not merely a record of a past stock-in: lib/stockSession.ts builds the
//     whole undo/redo postimage from it (`WITH m AS (SELECT * FROM
//     stock_session_members WHERE operation_id=@id)`, then products/branch_stock
//     /movements are read through `IN (SELECT product_id FROM m)`) and asserts
//     the live state still equals that postimage before it will reverse
//     anything. Repointing m at the keeper would compare the KEEPER's rows
//     against a postimage recorded for the loser -- and `members` is itself
//     inside the postimage, so the UPDATE alone breaks the assertion. Moving
//     this row does not fix the orphan; it inverts it onto the survivor.
//     What DOES protect the session is the guard in routes/products.ts
//     (mergeBlockedByReversibleStockSession): a merge is REFUSED while either
//     row still belongs to a stock session that can be undone or redone, so no
//     merge can silently brick a replay. Once the session's history row is
//     gone the members row is pure history and stays where it happened.
//
//     OWNER DECISION, OPEN -- a recorded DEVIATION from the N15 ask ("the
//     merge moves EVERY linked record ... including stock_session_members"),
//     not an oversight. What it costs: nothing ever settles a stock session
//     (lib/stockSession.ts writes only 'undoable' and 'redoable'), so the block
//     on a touched product lifts only when the retention sweep deletes the
//     action_history row at ACTION_HISTORY_TTL_DAYS = 180. Three ways out, for
//     the owner to pick: (a) accept the guard as it stands; (b) add a way to
//     settle/retire a spent session so the block lifts in days rather than
//     months; (c) implement the compensating postimage rewrite so the member
//     row can be reparented with the replay following it. Both halves are
//     pinned in scripts/test-merge-identity-fk-pure.cjs section 5, so
//     whichever way it goes the test moves with it.
export const MERGE_REPARENT_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'sale_items', column: 'product_id' },
  { table: 'return_items', column: 'product_id' },
  { table: 'return_replacement_items', column: 'product_id' },
  { table: 'inventory_movements', column: 'product_id' },
  { table: 'damaged_stock_lots', column: 'product_id' },
  { table: 'stock_transfers', column: 'product_id' },
  { table: 'rfid_tags', column: 'product_id' },
  { table: 'rfid_events', column: 'product_id' },
  { table: 'rfid_session_items', column: 'product_id' },
  { table: 'promotions', column: 'link_product_id' },
]

const MERGE_REPARENT_ALLOWED = new Set(MERGE_REPARENT_TABLES.map((t) => `${t.table}.${t.column}`))

// The forward fold lives in routes/products.ts; rather than have this lib
// import a route module (a lib->route dependency, and a require cycle since the
// route imports MergeReversal from here), the route REGISTERS the fold at
// module load and the redo path calls it through this seam.
export type MergeFoldFn = (
  env: Env,
  db: ReturnType<typeof getDb>,
  user: SessionUser | null,
  canonical: { id: number; name: string | null },
  dup: { id: number; name: string | null; image_path?: string | null },
  branchNameById: Map<number, string>,
  mergeContext: string,
  stockDisposition?: MergeStockDisposition,
  economicsOverride?: ProductMergeEconomics,
) => Promise<{ reversal: MergeReversal }>

let mergeFoldFn: MergeFoldFn | null = null
export function registerMergeFold(fn: MergeFoldFn): void {
  mergeFoldFn = fn
}

function savedBulkClusterEconomics(reversal: MergeReversal): ProductMergeEconomics | undefined {
  if (!Object.prototype.hasOwnProperty.call(reversal, 'bulkClusterPlan')) return undefined
  const plan = parseProductMergeClusterPlan(reversal.bulkClusterPlan)
  if (!plan || plan.keeperId !== Number(reversal.keeperId) || !plan.memberIds.includes(Number(reversal.dupId))) {
    throw new UndoConflictError('This merge has an invalid saved cluster plan, so it cannot be redone safely.')
  }
  const economics = resolveProductMergeClusterPlanEconomics(plan)
  if (economics.issues.length) {
    throw new UndoConflictError('This merge has invalid saved cluster economics, so it cannot be redone safely.')
  }
  return economics
}

function preserveBulkClusterPlan(source: MergeReversal, fresh: MergeReversal): void {
  if (Object.prototype.hasOwnProperty.call(source, 'bulkClusterPlan')) {
    fresh.bulkClusterPlan = source.bulkClusterPlan
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const intIds = (arr: unknown): number[] =>
  (Array.isArray(arr) ? arr : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)

async function runMergeFingerprintReadBatch(
  db: ReturnType<typeof getDb>,
  reads: ReadonlyArray<{ key: string; sql: string; params?: unknown[] }>,
): Promise<Map<string, Array<Record<string, unknown>>>> {
  if (!reads.length) return new Map()
  const results = await db.batch(reads.map(({ sql, params }) => ({ sql, params })))
  if (results.length !== reads.length) throw new Error('Merge fingerprint read batch returned an incomplete result set.')
  return new Map(reads.map((read, index) => [
    read.key,
    Array.isArray(results[index]?.results) ? results[index].results as Array<Record<string, unknown>> : [],
  ]))
}

export async function mergeStateFingerprint(db: ReturnType<typeof getDb>, reversals: MergeReversal[]): Promise<string> {
  const productIds = [...new Set(reversals.flatMap((r) => [Number(r.keeperId), Number(r.dupId)]).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
  if (!productIds.length) return ''
  const products: Array<Record<string, unknown>> = []
  const branchStock: Array<Record<string, unknown>> = []
  const batches: Array<Record<string, unknown>> = []
  const movementHeads: Array<Record<string, unknown>> = []
  const productImages: Array<Record<string, unknown>> = []
  const stockSessions: Array<Record<string, unknown>> = []
  const adjustmentRows: Array<Record<string, unknown>> = []
  const linkedRows: Record<string, Array<Record<string, unknown>>> = {}
  const promotionRules: Array<Record<string, unknown>> = []
  const childProducts: Array<Record<string, unknown>> = []
  const saleAllocations: Array<Record<string, unknown>> = []
  const returnAllocations: Array<Record<string, unknown>> = []
  const reads: Array<{ key: string; sql: string; params?: unknown[] }> = []
  const productChunks = chunk(productIds, 80)
  for (const [index, ids] of productChunks.entries()) {
    const placeholders = ids.map(() => '?').join(',')
    reads.push(
      { key: `products:${index}`, sql: `SELECT * FROM products WHERE id IN (${placeholders})`, params: ids },
      { key: `branchStock:${index}`, sql: `SELECT product_id, branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id IN (${placeholders})`, params: ids },
      { key: `batches:${index}`, sql: `SELECT id, variant_product_id, batch_key, batch_number, is_active FROM product_batches WHERE variant_product_id IN (${placeholders})`, params: ids },
      { key: `movementHeads:${index}`, sql: `SELECT product_id, MAX(id) AS max_id, COUNT(*) AS row_count FROM inventory_movements WHERE product_id IN (${placeholders}) GROUP BY product_id`, params: ids },
      { key: `productImages:${index}`, sql: `SELECT * FROM product_images WHERE product_id IN (${placeholders})`, params: ids },
      { key: `stockSessions:${index}`, sql: `SELECT * FROM stock_session_members WHERE product_id IN (${placeholders})`, params: ids },
      {
        key: `batchStockByProduct:${index}`,
        sql: `SELECT bbs.batch_id, bbs.branch_id, bbs.quantity
              FROM branch_batch_stock bbs
              JOIN product_batches pb ON pb.id=bbs.batch_id
              WHERE pb.variant_product_id IN (${placeholders})`,
        params: ids,
      },
    )
  }
  const savedBatchIds = reversals.flatMap((r) => [
    ...(r.repointedBatches || []).map((b) => Number(b.id)),
    ...(r.foldedBatches || []).flatMap((b) => [Number(b.dupBatchId), Number(b.keeperBatchId)]),
    ...(r.writtenOffBatches || []).map((b) => Number(b.batchId)),
  ])
  const uniqueSavedBatchIds = [...new Set(savedBatchIds.filter((id) => Number.isInteger(id) && id > 0))]
  for (const [index, ids] of chunk(uniqueSavedBatchIds, 80).entries()) {
    reads.push({ key: `batchStockBySaved:${index}`, sql: `SELECT batch_id, branch_id, quantity FROM branch_batch_stock WHERE batch_id IN (${ids.map(() => '?').join(',')})`, params: ids })
  }
  for (const [reversalIndex, reversal] of reversals.entries()) {
    if (reversal.adjustmentMovementMarker) {
      reads.push({
        key: `adjustments:${reversalIndex}:marker`,
        sql: `SELECT * FROM inventory_movements
              WHERE product_id=? AND movement_type='adjustment'
                AND instr(COALESCE(reason, ''), ?) > 0`,
        // The merge marker is literal data. D1 rejects some long LIKE patterns,
        // while instr preserves the intended contains check without wildcard parsing.
        params: [reversal.keeperId, String(reversal.adjustmentMovementMarker)],
      })
    } else {
      for (const [index, ids] of chunk(intIds(reversal.adjustmentMovementIds), 80).entries()) {
        reads.push({ key: `adjustments:${reversalIndex}:${index}`, sql: `SELECT * FROM inventory_movements WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids })
      }
    }
  }
  for (const [tableIndex, entry] of MERGE_REPARENT_TABLES.entries()) {
    const ids = [...new Set(reversals.flatMap((r) => (r.reparentedByTable || [])
      .filter((saved) => saved.table === entry.table && saved.column === entry.column)
      .flatMap((saved) => intIds(saved.ids))))]
    if (!ids.length) continue
    linkedRows[`${entry.table}.${entry.column}`] = []
    for (const [index, group] of chunk(ids, 80).entries()) {
      reads.push({ key: `linked:${tableIndex}:${index}`, sql: `SELECT * FROM ${entry.table} WHERE id IN (${group.map(() => '?').join(',')})`, params: group })
    }
  }
  const promotionIds = [...new Set(reversals.flatMap((r) => (r.promotionRulesBefore || []).map((row) => Number(row.id))).filter((id) => Number.isInteger(id) && id > 0))]
  for (const [index, ids] of chunk(promotionIds, 80).entries()) reads.push({ key: `promotionRules:${index}`, sql: `SELECT * FROM promotion_rules WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids })
  const childIds = [...new Set(reversals.flatMap((r) => intIds(r.reparentedChildProductIds)))]
  for (const [index, ids] of chunk(childIds, 80).entries()) reads.push({ key: `childProducts:${index}`, sql: `SELECT id,parent_id,updated_at FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids })
  const allocationIds = {
    sale: [...new Set(reversals.flatMap((r) => (r.foldedBatches || []).flatMap((b) => intIds(b.saleAllocationIds))))],
    returns: [...new Set(reversals.flatMap((r) => (r.foldedBatches || []).flatMap((b) => intIds(b.returnAllocationIds))))],
  }
  for (const [index, ids] of chunk(allocationIds.sale, 80).entries()) reads.push({ key: `saleAllocations:${index}`, sql: `SELECT * FROM sale_item_batch_allocations WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids })
  for (const [index, ids] of chunk(allocationIds.returns, 80).entries()) reads.push({ key: `returnAllocations:${index}`, sql: `SELECT * FROM return_item_batch_allocations WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids })

  const resultSets = await runMergeFingerprintReadBatch(db, reads)
  for (const [key, rows] of resultSets) {
    if (key.startsWith('products:')) products.push(...rows)
    else if (key.startsWith('branchStock:')) branchStock.push(...rows)
    else if (key.startsWith('batches:')) batches.push(...rows)
    else if (key.startsWith('movementHeads:')) movementHeads.push(...rows)
    else if (key.startsWith('productImages:')) productImages.push(...rows)
    else if (key.startsWith('stockSessions:')) stockSessions.push(...rows)
    else if (key.startsWith('adjustments:')) adjustmentRows.push(...rows)
    else if (key.startsWith('promotionRules:')) promotionRules.push(...rows)
    else if (key.startsWith('childProducts:')) childProducts.push(...rows)
    else if (key.startsWith('saleAllocations:')) saleAllocations.push(...rows)
    else if (key.startsWith('returnAllocations:')) returnAllocations.push(...rows)
    else if (key.startsWith('linked:')) {
      const [, tableIndexText] = key.split(':')
      const entry = MERGE_REPARENT_TABLES[Number(tableIndexText)]
      if (entry) linkedRows[`${entry.table}.${entry.column}`]?.push(...rows)
    }
  }
  const batchStockByKey = new Map<string, Record<string, unknown>>()
  for (const [key, rows] of resultSets) {
    if (!key.startsWith('batchStockBy')) continue
    for (const row of rows) batchStockByKey.set(`${Number(row.batch_id)}:${Number(row.branch_id)}`, row)
  }
  const batchStock = [...batchStockByKey.values()]
  const byNumbers = (keys: string[]) => (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const key of keys) {
      const difference = Number(a[key]) - Number(b[key])
      if (difference) return difference
    }
    return 0
  }
  products.sort(byNumbers(['id']))
  branchStock.sort(byNumbers(['product_id', 'branch_id']))
  batches.sort(byNumbers(['id']))
  batchStock.sort(byNumbers(['batch_id', 'branch_id']))
  movementHeads.sort(byNumbers(['product_id']))
  adjustmentRows.sort(byNumbers(['id']))
  productImages.sort(byNumbers(['id']))
  stockSessions.sort((a, b) => String(a.operation_id).localeCompare(String(b.operation_id)) || Number(a.product_id) - Number(b.product_id))
  promotionRules.sort(byNumbers(['id']))
  childProducts.sort(byNumbers(['id']))
  saleAllocations.sort(byNumbers(['id']))
  returnAllocations.sort(byNumbers(['id']))
  for (const rows of Object.values(linkedRows)) rows.sort(byNumbers(['id']))
  return JSON.stringify({ products, branchStock, batches, batchStock, movementHeads, adjustmentRows, productImages, stockSessions, linkedRows, promotionRules, childProducts, saleAllocations, returnAllocations })
}

async function assertMergeStateUnchanged(db: ReturnType<typeof getDb>, reversals: MergeReversal[], expected?: string): Promise<void> {
  if (reversals.some((reversal) => reversal.fingerprintPending)) {
    throw new UndoConflictError('This merge is missing its completed safety fingerprint, so it cannot be replayed automatically.')
  }
  // Legacy snapshots predate fingerprints; keep them replayable under their
  // existing row-level guards. Every snapshot written by the atomic path has
  // fingerprintPending until a complete expected value is stored.
  if (expected && await mergeStateFingerprint(db, reversals) !== expected) {
    throw new UndoConflictError('This merge has later stock or batch activity, so it can no longer be undone safely.')
  }
}

async function saleStateFingerprint(db: ReturnType<typeof getDb>, saleId: number): Promise<string> {
  const sale = await db.prepare('SELECT * FROM sales WHERE id = ?').get<Record<string, unknown>>([saleId])
  const lines = await db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all<Record<string, unknown>>([saleId])
  const amendmentHead = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM sale_amendments WHERE sale_id = ?').get<{ id: number }>([saleId])
  return JSON.stringify({ sale, lines, amendmentHeadId: Number(amendmentHead?.id) || 0 })
}

type AtomicSaleAddItemsReversal = SaleAddItemsReversal & {
  operationId?: unknown
  saleStateRevision?: unknown
}

type ReplayStatement = { sql: string; params: Record<string, unknown> }

function saleAddItemsAuditStatement(
  user: SessionUser,
  saleId: number,
  direction: 'undo' | 'redo',
  operationId: string,
  lineCount: number,
): ReplayStatement {
  const details = JSON.stringify({ via: 'undo_applier', applier: SALE_ADD_ITEMS_ACTION_KIND, operation_id: operationId, lines: lineCount })
  return {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
          VALUES(@userId,@userName,@action,'sale',@saleId,@details,'sale',@saleId,@details)`,
    params: {
      userId: user.id,
      userName: actorSnapshot(user),
      action: direction === 'undo' ? 'action_undo' : 'action_redo',
      saleId,
      details,
    },
  }
}

async function replayAtomicSaleAddItems(
  db: ReturnType<typeof getDb>,
  reversal: AtomicSaleAddItemsReversal,
  snapshotId: number,
  snapshotStatus: string,
  payload: Record<string, unknown>,
  ctx: UndoApplierContext,
): Promise<void> {
  if (!ctx.user || !Number.isSafeInteger(ctx.historyId) || !Number.isSafeInteger(ctx.generation) || Number(ctx.generation) < 0) {
    throw new UndoConflictError('Refresh history before replaying these added items.')
  }
  const user = ctx.user
  if (typeof reversal.saleStateRevision !== 'number' || !Number.isSafeInteger(reversal.saleStateRevision) || reversal.saleStateRevision < 0) {
    throw new UndoConflictError('The saved sale revision is invalid.')
  }
  const historyId = Number(ctx.historyId)
  const generation = Number(ctx.generation)
  const operationId = String(payload.operation_id || '')
  if (!operationId || String(reversal.operationId || '') !== operationId || payload.generation !== generation) {
    throw new UndoConflictError('This added-items receipt does not match its history generation.')
  }
  const saleId = Number(reversal.saleId)
  const expectedRevision = reversal.saleStateRevision
  const operation = await db.prepare(`
    SELECT id,sale_id,history_id,generation,sale_revision FROM sale_mutation_receipts
    WHERE id=? AND mutation_kind='add_items'
  `).get<Record<string, unknown>>([operationId])
  if (!operation || Number(operation.sale_id) !== saleId || Number(operation.history_id) !== historyId
    || Number(operation.generation) !== generation || Number(operation.sale_revision) !== expectedRevision) {
    throw new UndoConflictError('This added-items receipt changed or no longer matches its history.')
  }
  const revision = await db.prepare('SELECT COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=?),0) AS revision')
    .get<{ revision: number }>([saleId])
  if (Number(revision?.revision) !== expectedRevision) {
    throw new UndoConflictError('This sale was edited after the items were added. Nothing was reversed.')
  }

  const lines = reversal.lines || []
  if (!lines.length || lines.length > 25) throw new UndoConflictError('The saved added-items line set is invalid.')
  const guardParams: Record<string, unknown> = {
    operation: operationId,
    history: historyId,
    generation,
    saleId,
    revision: expectedRevision,
    snapshot: snapshotId,
    snapshotStatus: ctx.direction === 'undo' ? 'applied' : 'reversed',
    historyStatus: ctx.direction === 'undo' ? 'undoable' : 'redoable',
    saleStatus: reversal.saleStatus,
  }
  const memberGuards: string[] = []
  const lineGuards: string[] = []
  for (const [ordinal, line] of lines.entries()) {
    const lineId = Number(line.saleItemId)
    if (!Number.isSafeInteger(lineId) || lineId <= 0) throw new UndoConflictError('A saved sale line identity is invalid.')
    const key = `line${ordinal}`
    guardParams[key] = lineId
    memberGuards.push(`EXISTS(SELECT 1 FROM sale_mutation_members WHERE operation_id=@operation AND entity_kind='sale_item' AND ordinal=${ordinal} AND entity_id=@${key})`)
    lineGuards.push(ctx.direction === 'undo'
      ? `EXISTS(SELECT 1 FROM sale_items WHERE id=@${key} AND sale_id=@saleId)`
      : `NOT EXISTS(SELECT 1 FROM sale_items WHERE id=@${key})`)
  }
  const expectedSnapshotStatus = ctx.direction === 'undo' ? 'applied' : 'reversed'
  if (snapshotStatus !== expectedSnapshotStatus) throw new UndoConflictError('These added items were already replayed.')
  const guard = saleMutationGuard(`
    NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
    AND EXISTS(
      SELECT 1 FROM sale_mutation_receipts r
      JOIN action_history h ON h.id=r.history_id
      JOIN undo_snapshots s ON s.id=@snapshot
      JOIN sales sale ON sale.id=r.sale_id
      WHERE r.id=@operation AND r.sale_id=@saleId AND r.history_id=@history
        AND r.mutation_kind='add_items' AND r.generation=@generation AND r.sale_revision=@revision
        AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=r.sale_id),0)=@revision
        AND h.status=@historyStatus AND s.kind='sale.add_items' AND s.status=@snapshotStatus
        AND sale.sale_status=@saleStatus
        AND json_extract(h.undo_payload,'$.operation_id')=@operation
        AND json_extract(h.redo_payload,'$.operation_id')=@operation
        AND json_extract(h.undo_payload,'$.snapshot_id')=@snapshot
        AND json_extract(h.redo_payload,'$.snapshot_id')=@snapshot
        AND json_extract(h.undo_payload,'$.generation')=@generation
        AND json_extract(h.redo_payload,'$.generation')=@generation
        AND EXISTS(SELECT 1 FROM sale_mutation_members WHERE operation_id=@operation AND entity_kind='undo_snapshot' AND entity_id=@snapshot AND ordinal=0)
    )
    ${[...memberGuards, ...lineGuards].map((predicate) => `AND ${predicate}`).join('\n')}
  `, guardParams)
  const stamp = new Date().toISOString()
  const statements: ReplayStatement[] = [
    { sql: 'DELETE FROM sale_mutation_guards', params: {} },
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    guard,
  ]

  if (ctx.direction === 'undo') {
    const removal = planSaleLineRemoval({
      saleId,
      lines,
      reason: `Undo: items added to sale ${reversal.receiptNumber || `#${saleId}`} removed`,
      userId: ctx.user.id,
      userName: actorSnapshot(ctx.user),
    })
    const undoGroupId = crypto.randomUUID()
    statements.push(
      ...removal.statements,
      saleMoneyUpdateStatement(saleId, reversal.moneyBefore),
      ...(reversal.lineMoneyBefore ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyBefore)] : []),
      ...lines.map((line) => amendmentEntryStatement({
        saleId, kind: 'line_removed', groupId: undoGroupId,
        saleItemId: line.saleItemId, productId: line.productId, productName: line.productName,
        quantityBefore: line.quantity, quantityAfter: 0,
        totalBeforeUsd: reversal.moneyAfter.total_usd, totalAfterUsd: reversal.moneyBefore.total_usd,
        unitsMoved: line.heldUnits, via: 'undo',
        note: `Undo: items added to sale ${reversal.receiptNumber || `#${saleId}`} removed`,
        userId: user.id, userName: actorSnapshot(user),
      })),
    )
  } else {
    const plannedLines = lines.map(plannedLineFromRecord)
    const plan = planSaleLineAddition({
      saleId,
      saleStatus: reversal.saleStatus,
      lines: plannedLines,
      exchangeRate: Number(reversal.moneyAfter.exchange_rate ?? reversal.exchangeRate) || 4100,
      userId: ctx.user.id,
      userName: actorSnapshot(ctx.user),
    })
    const redoGroupId = crypto.randomUUID()
    statements.push(...planUnlottedSaleLineGuards(plan.lines))
    const ordinalByStatement = new Map(plan.saleItemStatementIndexByLine.map((statementIndex, ordinal) => [statementIndex, ordinal]))
    for (const [statementIndex, statement] of plan.statements.entries()) {
      statements.push(statement)
      const ordinal = ordinalByStatement.get(statementIndex)
      if (ordinal !== undefined) statements.push({
        sql: `UPDATE sale_mutation_members SET entity_id=last_insert_rowid()
              WHERE operation_id=@operation AND entity_kind='sale_item' AND ordinal=@ordinal`,
        params: { operation: operationId, ordinal },
      })
    }
    statements.push(
      ...buildOperationAllocationStatements(plan.lines, operationId, stamp),
      saleMoneyUpdateStatement(saleId, reversal.moneyAfter),
      ...(reversal.lineMoneyAfter ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyAfter)] : []),
      ...plan.lines.map((line) => amendmentEntryStatement({
        saleId, kind: 'line_added', groupId: redoGroupId,
        productId: line.productId, productName: line.productName,
        quantityBefore: 0, quantityAfter: line.quantity,
        totalBeforeUsd: reversal.moneyBefore.total_usd, totalAfterUsd: reversal.moneyAfter.total_usd,
        unitsMoved: -line.heldUnits || 0, via: 'redo',
        note: `Redo: items re-added to sale ${reversal.receiptNumber || `#${saleId}`}`,
        userId: user.id, userName: actorSnapshot(user),
      })),
    )
  }

  let snapshotPayload = 'payload_json'
  if (ctx.direction === 'redo') {
    for (const ordinal of lines.keys()) {
      snapshotPayload = `json_set(${snapshotPayload},'$.lines[${ordinal}].saleItemId',(SELECT entity_id FROM sale_mutation_members WHERE operation_id=@operation AND entity_kind='sale_item' AND ordinal=${ordinal}))`
    }
  }
  snapshotPayload = `json_set(${snapshotPayload},'$.saleStateRevision',COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0))`
  const nextGeneration = generation + 1
  statements.push(
    {
      sql: `UPDATE undo_snapshots SET status=@status,payload_json=${snapshotPayload},updated_at=@stamp WHERE id=@snapshot`,
      params: { status: ctx.direction === 'undo' ? 'reversed' : 'applied', stamp, snapshot: snapshotId, operation: operationId, saleId },
    },
    {
      sql: `UPDATE sale_mutation_receipts SET generation=@nextGeneration,
            sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0),updated_at=@stamp
            WHERE id=@operation`,
      params: { nextGeneration, saleId, stamp, operation: operationId },
    },
    {
      sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,
            undo_payload=json_set(undo_payload,'$.generation',@nextGeneration),
            redo_payload=json_set(redo_payload,'$.generation',@nextGeneration)
            WHERE id=@history`,
      params: { status: ctx.direction === 'undo' ? 'redoable' : 'undoable', stamp, nextGeneration, history: historyId },
    },
    saleAddItemsAuditStatement(ctx.user, saleId, ctx.direction, operationId, lines.length),
    { sql: 'DELETE FROM sale_mutation_guards', params: {} },
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (/constraint|guard_value/i.test(String(error))) {
      throw new UndoConflictError('This sale or added-items receipt changed. Nothing was reversed.')
    }
    throw error
  }
}

export type AtomicMergeStatement = { sql: string; params?: Record<string, unknown> }
// The caller may carry these directly from the two INSERT results in its
// already-committed atomic batch. Older D1 adapters can omit that metadata;
// finalizeAtomicMergeHistory then retains its operation-id discovery path.
export type AtomicMergeKnownIds = Readonly<{ snapshotId: number; actionHistoryId: number }>

// These statements are appended to the SAME D1 batch as one forward fold.
// If any graph mutation, snapshot, history, or audit insert fails, D1 rolls
// back the whole case. last_insert_rowid() is read immediately after the
// snapshot insert, before another insert can replace it.
export function buildAtomicMergeHistoryStatements(
  user: SessionUser | null,
  reversal: MergeReversal,
  operationId: string,
  auditDetails: Record<string, unknown>,
): AtomicMergeStatement[] {
  if (!operationId) throw new Error('A merge operation id is required.')
  const stored = { ...reversal, operationId, fingerprintPending: true }
  const keeperName = reversal.keeperName || `#${reversal.keeperId}`
  const dupName = reversal.dupName || `#${reversal.dupId}`
  const actorId = user?.id ?? null
  const actorName = actorSnapshot(user)
  const details = JSON.stringify(auditDetails)
  return [
    {
      sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)
            VALUES('product.merge','applied',@payload,@byId,@byName)`,
      params: { payload: JSON.stringify(stored), byId: actorId, byName: actorName },
    },
    {
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,
              undo_payload,redo_payload,created_by_id,created_by_name)
            VALUES('products','product',@entityId,@label,@undoLabel,@redoLabel,0,'recorded',
              json_object('applier','product.merge','snapshot_id',last_insert_rowid(),'operation_id',@operationId),
              json_object('applier','product.merge','snapshot_id',last_insert_rowid(),'operation_id',@operationId),
              @byId,@byName)`,
      params: {
        entityId: String(reversal.dupId),
        label: `Merged "${dupName}" into "${keeperName}"`,
        undoLabel: `Undo merge of "${dupName}"`,
        redoLabel: `Redo merge of "${dupName}"`,
        operationId,
        byId: actorId,
        byName: actorName,
      },
    },
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
            VALUES(@byId,@byName,'merge_duplicate','product',@entityId,@details,'product',@entityId,@details)`,
      params: { byId: actorId, byName: actorName, entityId: String(reversal.dupId), details },
    },
  ]
}

export async function finalizeAtomicMergeHistory(
  env: Env,
  operationId: string,
  reversal: MergeReversal,
  dbOverride?: ReturnType<typeof getDb>,
  knownIds?: AtomicMergeKnownIds,
): Promise<{
  operationId: string
  committed: true
  snapshotId: number | null
  actionHistoryId: number | null
  historyResolved: boolean
  fingerprintReady: boolean
}> {
  let resolvedSnapshotId: number | null = null
  let resolvedActionHistoryId: number | null = null
  const pending = () => ({
    operationId,
    committed: true as const,
    snapshotId: resolvedSnapshotId,
    actionHistoryId: resolvedActionHistoryId,
    historyResolved: resolvedSnapshotId != null && resolvedActionHistoryId != null,
    fingerprintReady: false,
  })
  try {
    // The graph mutation, snapshot, history and audit were committed in the
    // caller's preceding atomic batch. Every operation below is reconciliation
    // of that durable fact and therefore must never turn a committed case into
    // a reported failure. Reuse the caller's counted adapter when supplied so
    // these reads and the final batch remain inside its request budget.
    const db = dbOverride ?? getDb(env)
    let snapshotId = Number(knownIds?.snapshotId)
    let actionHistoryId = Number(knownIds?.actionHistoryId)
    // A new fold knows both rows are pending because the INSERT statements are
    // fixed immediately above the audit insert. Missing metadata and explicit
    // reconciliation calls still discover and inspect the durable rows.
    if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0 || !Number.isSafeInteger(actionHistoryId) || actionHistoryId <= 0) {
      const history = await db.prepare(`
        SELECT id, reversible, status, CAST(json_extract(undo_payload,'$.snapshot_id') AS INTEGER) AS snapshot_id
        FROM action_history
        WHERE json_extract(undo_payload,'$.operation_id')=@operationId
          AND json_extract(undo_payload,'$.applier')='product.merge'
        ORDER BY id DESC LIMIT 1
      `).get<{ id: number; reversible: number; status: string; snapshot_id: number }>({ operationId })
      snapshotId = Number(history?.snapshot_id)
      actionHistoryId = Number(history?.id)
      if (!Number.isSafeInteger(snapshotId) || snapshotId <= 0 || !Number.isSafeInteger(actionHistoryId) || actionHistoryId <= 0) {
        return pending()
      }
      resolvedSnapshotId = snapshotId
      resolvedActionHistoryId = actionHistoryId
      const ready = await db.prepare(`
        SELECT CAST(json_extract(payload_json,'$.fingerprintPending') AS INTEGER) AS pending
        FROM undo_snapshots WHERE id=@snapshotId AND kind='product.merge' AND status='applied'
      `).get<{ pending: number | null }>({ snapshotId })
      if (Number(ready?.pending) === 0 && Number(history?.reversible) === 1 && history?.status === 'undoable') {
        return { operationId, committed: true, snapshotId, actionHistoryId, historyResolved: true, fingerprintReady: true }
      }
    }
    resolvedSnapshotId = snapshotId
    resolvedActionHistoryId = actionHistoryId
    const mergedStateFingerprint = await mergeStateFingerprint(db, [reversal])
    const stored = { ...reversal, operationId, fingerprintPending: false, mergedStateFingerprint }
    await db.batch([
      {
        sql: `UPDATE undo_snapshots SET payload_json=@payload,updated_at=CURRENT_TIMESTAMP
              WHERE id=@snapshotId AND kind='product.merge' AND status='applied'
                AND json_extract(payload_json,'$.operationId')=@operationId
                AND json_extract(payload_json,'$.fingerprintPending')=1`,
        params: { payload: JSON.stringify(stored), snapshotId, operationId },
      },
      {
        sql: `UPDATE action_history SET reversible=1,status='undoable',updated_at=CURRENT_TIMESTAMP
              WHERE id=@historyId AND reversible=0 AND status='recorded'
                AND json_extract(undo_payload,'$.operation_id')=@operationId`,
        params: { historyId: actionHistoryId, operationId },
      },
      {
        sql: `SELECT CASE WHEN
                EXISTS(SELECT 1 FROM undo_snapshots WHERE id=@snapshotId AND kind='product.merge' AND status='applied'
                  AND json_extract(payload_json,'$.operationId')=@operationId
                  AND json_extract(payload_json,'$.fingerprintPending')=0)
                AND EXISTS(SELECT 1 FROM action_history WHERE id=@historyId AND reversible=1 AND status='undoable'
                  AND json_extract(undo_payload,'$.operation_id')=@operationId
                  AND json_extract(undo_payload,'$.applier')='product.merge')
              THEN 1 ELSE json_extract('', '$') END AS merge_history_guard`,
        params: { snapshotId, historyId: actionHistoryId, operationId },
      },
    ])
    return { operationId, committed: true, snapshotId, actionHistoryId, historyResolved: true, fingerprintReady: true }
  } catch {
    // The merge and its audit are already durable. Keep the history visibly
    // non-reversible while the explicit pending flag makes undo fail closed;
    // never advertise an Undo control before its fingerprint is complete.
    return pending()
  }
}

// Record a completed merge as an undoable/redoable action: the large reversal
// goes to undo_snapshots, and a small action_history row points at it. Returns
// both ids so the merge endpoint can hand the action id back to the client.
export async function recordMergeUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: MergeReversal,
): Promise<{ snapshotId: number; actionHistoryId: number }> {
  const db = getDb(env)
  const stored = { ...reversal, mergedStateFingerprint: await mergeStateFingerprint(db, [reversal]) }
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('product.merge', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify(stored), byId: user?.id ?? null, byName: actorSnapshot(user) })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'product.merge', snapshot_id: snapshotId })
  const keeperName = reversal.keeperName || `#${reversal.keeperId}`
  const dupName = reversal.dupName || `#${reversal.dupId}`
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.dupId),
    label: `Merged "${dupName}" into "${keeperName}"`,
    undoLabel: `Undo merge of "${dupName}"`,
    redoLabel: `Redo merge of "${dupName}"`,
    payload,
    byId: user?.id ?? null,
    byName: actorSnapshot(user),
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// Bulk variant: the whole-catalog POST /merge-duplicates folds MANY duplicates
// (across many keepers) in one run, and the person expects to undo the whole
// cleanup with one click -- not hunt down N separate history rows, and not risk
// undoing them out of order (a later fold in a group folds into batches an
// earlier fold already moved onto the keeper, so the reversals are ORDER-
// DEPENDENT). So the run is recorded as ONE composite action: every per-fold
// reversal, in application order, in a single undo_snapshots row, behind one
// action_history row. Undo replays them in REVERSE; redo re-runs the folds
// FORWARD (see the 'product.merge.bulk' applier). Records nothing (returns
// null) when the run folded nothing, so an empty cleanup leaves no dead row.
export async function recordBulkMergeUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversals: MergeReversal[],
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  const list = Array.isArray(reversals) ? reversals.filter((r) => r && Number(r.dupId) > 0) : []
  if (!list.length) return null
  const db = getDb(env)
  const mergedStateFingerprint = await mergeStateFingerprint(db, list)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('product.merge.bulk', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify({ reversals: list, mergedStateFingerprint }), byId: user?.id ?? null, byName: actorSnapshot(user) })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'product.merge.bulk', snapshot_id: snapshotId })
  const n = list.length
  const noun = n === 1 ? 'duplicate product' : 'duplicate products'
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(list[0].keeperId),
    label: `Merged ${n} ${noun}`,
    undoLabel: `Undo merge of ${n} ${noun}`,
    redoLabel: `Redo merge of ${n} ${noun}`,
    payload,
    byId: user?.id ?? null,
    byName: actorSnapshot(user),
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// Restore both products to their exact pre-merge state from the snapshot.
export function mergeKeeperRestoreStatement(r: MergeReversal, canChangeProductImages: boolean) {
  const imageSet = canChangeProductImages ? 'image_path=@path,' : ''
  const catalog = r.keeperCatalogBefore
  const catalogSet = catalog
    ? `category=@category,categories=@categories,brand=@brand,brands=@brands,unit=@unit,unit_normalized=@unitNormalized,brand_compact=@brandCompact,`
    : ''
  return {
    sql: `UPDATE products SET ${imageSet}${r.keeperBarcodeBefore !== undefined ? 'barcode=@barcode,' : ''}${catalogSet}updated_at=CURRENT_TIMESTAMP WHERE id=@keeperId`,
    params: {
      keeperId: Number(r.keeperId),
      ...(canChangeProductImages ? { path: r.keeperImagePathBefore ?? null } : {}),
      ...(r.keeperBarcodeBefore !== undefined ? { barcode: r.keeperBarcodeBefore } : {}),
      ...(catalog ? {
        category: catalog.category ?? null,
        categories: catalog.categories ?? null,
        brand: catalog.brand ?? null,
        brands: catalog.brands ?? null,
        unit: catalog.unit ?? null,
        unitNormalized: catalog.unit_normalized ?? null,
        brandCompact: catalog.brand_compact ?? null,
      } : {}),
    },
  }
}

async function buildMergeReversalStatements(env: Env, r: MergeReversal, canChangeProductImages = true): Promise<AtomicMergeStatement[]> {
  const db = getDb(env)
  const keeperId = Number(r.keeperId)
  const dupId = Number(r.dupId)
  if (!Number.isInteger(keeperId) || keeperId <= 0 || !Number.isInteger(dupId) || dupId <= 0) {
    throw new Error('This merge cannot be undone: its saved details are missing a product id.')
  }
  const [keeper, dupRow] = await Promise.all([
    db.prepare('SELECT id FROM products WHERE id = ?').get<{ id: number }>([keeperId]),
    db.prepare('SELECT id FROM products WHERE id = ?').get<{ id: number }>([dupId]),
  ])
  if (!keeper) throw new Error('The product this merge kept no longer exists, so the merge cannot be undone.')
  if (!dupRow) throw new Error('The merged-away product record no longer exists, so the merge cannot be undone.')

  const stmts: Array<{ sql: string; params?: Record<string, unknown> }> = []

  // 1. Reactivate the merged-away product; restore keeper's image_path.
  stmts.push({ sql: 'UPDATE products SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @dupId', params: { dupId } })
  stmts.push(mergeKeeperRestoreStatement(r, canChangeProductImages))
  if (r.keeperPricingBefore) {
    // Cost is restored only when the snapshot recorded it. A pre-Sep-4-2026
    // snapshot has no cost_price_* in its payload, and writing `|| 0` for a
    // missing field would wipe a real cost off the keeper on undo -- so the
    // two columns join the SET list only when they are actually present.
    const hasCost = r.keeperPricingBefore.cost_price_usd !== undefined
      || r.keeperPricingBefore.cost_price_khr !== undefined
    const costSet = hasCost
      ? `,
                cost_price_usd = @costUsd,
                cost_price_khr = @costKhr`
      : ''
    const costParams = hasCost
      ? {
        costUsd: Number(r.keeperPricingBefore.cost_price_usd) || 0,
        costKhr: Number(r.keeperPricingBefore.cost_price_khr) || 0,
      }
      : {}
    // The wholesale tier, restored the same conditional way cost is, and for
    // the same reason. Three snapshot vintages reach this line:
    //   * current      -- wholesale_price_usd/khr, restored verbatim.
    //   * pre-S4-32    -- special_price_usd/khr holding the SAME numbers under
    //                     the name migration 0111 retired. Post-0111 those
    //                     values are the wholesale price, so they are read as
    //                     the fallback rather than written back to the dead
    //                     column (which no reader would ever look at again).
    //   * pre-merge-pricing -- neither key. Writing `|| 0` for a missing field
    //                     would wipe a real wholesale price off the keeper on
    //                     undo, which is the exact silent data loss S4-32
    //                     exists to close, so the columns stay out of the SET
    //                     list entirely.
    const wholesaleUsdBefore = r.keeperPricingBefore.wholesale_price_usd ?? r.keeperPricingBefore.special_price_usd
    const wholesaleKhrBefore = r.keeperPricingBefore.wholesale_price_khr ?? r.keeperPricingBefore.special_price_khr
    const hasWholesale = wholesaleUsdBefore !== undefined || wholesaleKhrBefore !== undefined
    const wholesaleSet = hasWholesale
      ? `,
                wholesale_price_usd = @wholesaleUsd,
                wholesale_price_khr = @wholesaleKhr`
      : ''
    const wholesaleParams = hasWholesale
      ? {
        wholesaleUsd: Number(wholesaleUsdBefore) || 0,
        wholesaleKhr: Number(wholesaleKhrBefore) || 0,
      }
      : {}
    stmts.push({
      sql: `UPDATE products
            SET selling_price_usd = @sellingUsd,
                selling_price_khr = @sellingKhr${wholesaleSet}${costSet},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @keeperId`,
      params: {
        keeperId,
        sellingUsd: Number(r.keeperPricingBefore.selling_price_usd) || 0,
        sellingKhr: Number(r.keeperPricingBefore.selling_price_khr) || 0,
        ...wholesaleParams,
        ...costParams,
      },
    })
  }

  // 2. branch_stock, for exactly the branches the fold touched (the dup's):
  //    the keeper keeps its row and we UPDATE only quantity back (preserving
  //    rfid_confirmed_qty, which delete+reinsert would wipe), or DELETE the row
  //    the fold created for a branch it had none in; the dup's deleted rows are
  //    re-inserted with their captured quantity AND rfid_confirmed_qty.
  const keeperQtyByBranch = new Map((r.keeperStockBefore || []).map((x) => [Number(x.branch_id), Number(x.quantity) || 0]))
  for (const d of (r.dupStockBefore || [])) {
    const b = Number(d.branch_id)
    if (keeperQtyByBranch.has(b)) {
      stmts.push({ sql: 'UPDATE branch_stock SET quantity = @q WHERE product_id = @keeperId AND branch_id = @b', params: { keeperId, b, q: keeperQtyByBranch.get(b) } })
    } else {
      stmts.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @keeperId AND branch_id = @b', params: { keeperId, b } })
    }
    stmts.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @dupId AND branch_id = @b', params: { dupId, b } })
    stmts.push({ sql: 'INSERT INTO branch_stock (product_id, branch_id, quantity, rfid_confirmed_qty) VALUES (@dupId, @b, @q, @rfid)', params: { dupId, b, q: Number(d.quantity) || 0, rfid: Number(d.rfid_confirmed_qty) || 0 } })
  }

  // 3. inventory_movements: delete the fold's adjustment rows (by captured id,
  //    or by the dup-specific reason fragment for a snapshot from before ids
  //    were captured); move the re-parented history back to the dup.
  const adjIds = intIds(r.adjustmentMovementIds)
  if (adjIds.length) {
    for (const grp of chunk(adjIds, 400)) stmts.push({ sql: `DELETE FROM inventory_movements WHERE id IN (${grp.join(',')})` })
  } else if (r.adjustmentMovementMarker) {
    stmts.push({
      sql: `DELETE FROM inventory_movements
            WHERE product_id=@keeperId AND movement_type='adjustment'
              AND instr(COALESCE(reason, ''), @marker) > 0`,
      params: { keeperId, marker: String(r.adjustmentMovementMarker) },
    })
  } else {
    stmts.push({ sql: `DELETE FROM inventory_movements WHERE product_id = @keeperId AND movement_type = 'adjustment' AND reason LIKE @frag`, params: { keeperId, frag: `%(#${dupId}) into this product%` } })
  }
  for (const grp of chunk(intIds(r.reparentedMovementIds), 400)) {
    stmts.push({ sql: `UPDATE inventory_movements SET product_id = @dupId WHERE id IN (${grp.join(',')})`, params: { dupId } })
  }

  // 4. sale_items back to the dup.
  for (const grp of chunk(intIds(r.reparentedSaleItemIds), 400)) {
    stmts.push({ sql: `UPDATE sale_items SET product_id = @dupId WHERE id IN (${grp.join(',')})`, params: { dupId } })
  }

  // 4b. Every OTHER foreign key the fold moved (return_items, damaged lots,
  //     RFID tags, promotions...). Re-applying a table already covered above is
  //     idempotent, so the two overlapping records cannot conflict. Table and
  //     column names come out of a stored snapshot, so they are checked against
  //     MERGE_REPARENT_TABLES before being interpolated -- never trusted.
  for (const entry of (r.reparentedByTable || [])) {
    const table = String(entry?.table || '')
    const column = String(entry?.column || '')
    if (!MERGE_REPARENT_ALLOWED.has(`${table}.${column}`)) continue
    for (const grp of chunk(intIds(entry?.ids), 400)) {
      stmts.push({ sql: `UPDATE ${table} SET ${column} = @dupId WHERE id IN (${grp.join(',')})`, params: { dupId } })
    }
  }

  // 4c. promotion_rules.product_ids: put back the exact array the fold rewrote.
  //     Restored as the captured STRING, so a rule whose list also carried ids
  //     the fold never touched comes back byte-for-byte rather than
  //     re-serialized.
  for (const rule of (r.promotionRulesBefore || [])) {
    const ruleId = Number(rule?.id)
    if (!Number.isInteger(ruleId) || ruleId <= 0) continue
    stmts.push({
      sql: 'UPDATE promotion_rules SET product_ids = @ids, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { ids: String(rule?.product_ids ?? '[]'), id: ruleId },
    })
  }

  // 4d. products.parent_id: the children the fold moved onto the keeper go back
  //     onto the discarded row, and a keeper that was itself a child of that row
  //     gets its cleared parent link back.
  for (const grp of chunk(intIds(r.reparentedChildProductIds), 400)) {
    stmts.push({ sql: `UPDATE products SET parent_id = @dupId, updated_at = CURRENT_TIMESTAMP WHERE id IN (${grp.join(',')})`, params: { dupId } })
  }
  if (r.keeperParentIdBefore != null) {
    stmts.push({
      sql: 'UPDATE products SET parent_id = @parentId, updated_at = CURRENT_TIMESTAMP WHERE id = @keeperId',
      params: { keeperId, parentId: Number(r.keeperParentIdBefore) },
    })
  }

  // 5. product_images: pull the moved paths off the keeper, restore the dup's
  //    gallery (the fold had deleted every dup image row).
  if (canChangeProductImages) {
    const movedPaths = (r.imagesMovedToKeeper || []).map(String).filter(Boolean)
    for (const grp of chunk(movedPaths, 50)) {
      if (!grp.length) continue
      // sql-bound-params: bounded by construction -- this loop caps each group
      // at 50 image paths, plus keeperId, safely below D1's 100-bind ceiling.
      const placeholders = grp.map((_, i) => `@p${i}`).join(',')
      const params: Record<string, unknown> = { keeperId }
      grp.forEach((p, i) => { params[`p${i}`] = p })
      stmts.push({ sql: `DELETE FROM product_images WHERE product_id = @keeperId AND image_path IN (${placeholders})`, params })
    }
    for (const img of (r.dupImagesBefore || [])) {
      stmts.push({ sql: 'INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@dupId, @path, @order)', params: { dupId, path: String(img.image_path), order: img.sort_order == null ? 0 : Number(img.sort_order) } })
    }
  }

  // 6. product_batches: point the re-pointed batches back at the dup with their
  //    original number; reactivate each folded batch, re-insert its per-branch
  //    stock, and restore the keeper batch's stock for the folded branches.
  for (const b of (r.repointedBatches || [])) {
    stmts.push({ sql: 'UPDATE product_batches SET variant_product_id = @dupId, batch_number = @num, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { dupId, num: b.batchNumber == null ? null : Number(b.batchNumber), id: Number(b.id) } })
  }
  for (const fb of (r.foldedBatches || [])) {
    const dupBatchId = Number(fb.dupBatchId)
    const keeperBatchId = Number(fb.keeperBatchId)
    stmts.push({ sql: 'UPDATE product_batches SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dupBatchId } })
    for (const grp of chunk(intIds(fb.saleAllocationIds), 400)) stmts.push({ sql: `UPDATE sale_item_batch_allocations SET batch_id = @dupBatchId WHERE id IN (${grp.join(',')})`, params: { dupBatchId } })
    for (const grp of chunk(intIds(fb.returnAllocationIds), 400)) stmts.push({ sql: `UPDATE return_item_batch_allocations SET batch_id = @dupBatchId WHERE id IN (${grp.join(',')})`, params: { dupBatchId } })
    const keeperBBefore = new Map((fb.keeperStockBefore || []).map((x) => [Number(x.branch_id), Number(x.quantity) || 0]))
    for (const d of (fb.dupStockBefore || [])) {
      const b = Number(d.branch_id)
      if (keeperBBefore.has(b)) {
        stmts.push({ sql: 'UPDATE branch_batch_stock SET quantity = @q, updated_at = CURRENT_TIMESTAMP WHERE batch_id = @kb AND branch_id = @b', params: { kb: keeperBatchId, b, q: keeperBBefore.get(b) } })
      } else {
        stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @kb AND branch_id = @b', params: { kb: keeperBatchId, b } })
      }
      stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @db AND branch_id = @b', params: { db: dupBatchId, b } })
      stmts.push({ sql: 'INSERT INTO branch_batch_stock (batch_id, branch_id, quantity, updated_at) VALUES (@db, @b, @q, CURRENT_TIMESTAMP)', params: { db: dupBatchId, b, q: Number(d.quantity) || 0 } })
    }
  }

  // 6b. WRITE-OFF undo: the discarded row's lots were deactivated in place and
  //     their per-branch stock cleared (nothing was moved onto the keeper), so
  //     reversing is exactly reactivate + re-insert the captured quantities.
  //     The balancing negative inventory_movements rows the write-off wrote are
  //     deleted by step 3 (they were captured into adjustmentMovementIds).
  for (const wb of (r.writtenOffBatches || [])) {
    const batchId = Number(wb?.batchId)
    if (!Number.isInteger(batchId) || batchId <= 0) continue
    stmts.push({ sql: 'UPDATE product_batches SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchId } })
    for (const s of (wb.stockBefore || [])) {
      stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @b AND branch_id = @br', params: { b: batchId, br: Number(s.branch_id) } })
      stmts.push({ sql: 'INSERT INTO branch_batch_stock (batch_id, branch_id, quantity, updated_at) VALUES (@b, @br, @q, CURRENT_TIMESTAMP)', params: { b: batchId, br: Number(s.branch_id), q: Number(s.quantity) || 0 } })
    }
  }

  // 7. Recompute both products' denormalized stock_quantity from the truth.
  stmts.push({ sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @keeperId), updated_at = CURRENT_TIMESTAMP WHERE id = @keeperId', params: { keeperId } })
  stmts.push({ sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @dupId), updated_at = CURRENT_TIMESTAMP WHERE id = @dupId', params: { dupId } })

  return stmts
}

async function applyMergeReversal(env: Env, r: MergeReversal, canChangeProductImages = true): Promise<void> {
  const db = getDb(env)
  await db.batch(await buildMergeReversalStatements(env, r, canChangeProductImages))
}

// Undo a whole bulk merge: replay each fold's reversal in REVERSE application
// order. Order matters -- a later fold in a group folded into batches an
// earlier fold had already moved onto the keeper, so peeling the newest fold
// first restores the keeper to the exact state the next-oldest reversal was
// captured against. Each reversal runs in its own batch (validating the two
// products still exist); a cleanup undo is a rare admin op, not a hot path.
async function applyBulkMergeReversal(env: Env, reversals: MergeReversal[], canChangeProductImages = true): Promise<void> {
  for (let i = reversals.length - 1; i >= 0; i--) {
    await applyMergeReversal(env, reversals[i], canChangeProductImages)
  }
}

// Redo a whole bulk merge: re-run the SAME production folds in FORWARD order
// (deterministic because undo restored the exact pre-bulk state), then recompute
// each distinct keeper's denormalized stock_quantity once. Returns the fresh
// reversals so the snapshot can be overwritten for a future undo. Mirrors the
// single 'product.merge' redo, extended across the run.
async function redoBulkMergeFolds(
  env: Env,
  user: SessionUser | null,
  reversals: MergeReversal[],
): Promise<MergeReversal[]> {
  if (!mergeFoldFn) throw new Error('This merge cannot be redone in the current server build.')
  const db = getDb(env)
  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))
  const fresh: MergeReversal[] = []
  const keeperIds = new Set<number>()
  for (const r of reversals) {
    const keeperId = Number(r.keeperId)
    const dupId = Number(r.dupId)
    const [keeper, dupRow] = await Promise.all([
      db.prepare('SELECT id, name, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; is_active: number }>([keeperId]),
      db.prepare('SELECT id, name, image_path, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; image_path: string | null; is_active: number }>([dupId]),
    ])
    if (!keeper || !dupRow) throw new Error('One of the merged products no longer exists, so this merge cannot be redone.')
    if (!keeper.is_active || !dupRow.is_active) throw new Error('One of the merged products is no longer active, so this merge cannot be redone.')
    const economicsOverride = savedBulkClusterEconomics(r)
    const { reversal: one } = await mergeFoldFn!(
      env, db, user,
      { id: keeperId, name: keeper.name },
      { id: dupId, name: dupRow.name, image_path: dupRow.image_path },
      branchNameById,
      r.mergeContext || 'redo merge',
      // A redo must repeat the operator's ORIGINAL stock decision, never
      // silently fall back to merging stock the reviewer chose to write off.
      r.stockDisposition === 'write_off' ? 'write_off' : 'merge',
      economicsOverride,
    )
    preserveBulkClusterPlan(r, one)
    fresh.push(one)
    keeperIds.add(keeperId)
  }
  for (const keeperId of keeperIds) {
    await db.prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: keeperId })
  }
  return fresh
}

// ---------------------------------------------------------------------------
// supplier.backfill -- reload-durable undo/redo for attributing a supplier to a
// product's blank/name-only lots after the fact.
//
// Supplier attribution lives on the LOT (product_batches.supplier_id/_name,
// migration 0062): matched by exact normalized name at receive time, so a name
// that had no suppliers-table match then keeps supplier_id NULL and "stays
// linkable later". This action does that later linking -- it sets supplier_id
// (+ the supplier's canonical name) on the chosen unattributed lots. UNDO
// restores each lot's exact prior (supplier_id, supplier_name); REDO re-applies
// the current canonical name for the supplier. The lot set is bounded per
// product but the reversal still lives in undo_snapshots (0097) for the same
// reason the merge does -- the action_history payload stays a tiny pointer.
// ---------------------------------------------------------------------------
export interface SupplierBackfillReversal {
  productId: number
  supplierId: number
  supplierName: string | null
  lots: Array<{ id: number; prevSupplierId: number | null; prevSupplierName: string | null }>
}

// Record a completed backfill as one undoable/redoable action.
export async function recordSupplierBackfillSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: SupplierBackfillReversal,
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  const lots = Array.isArray(reversal.lots) ? reversal.lots.filter((l) => Number(l.id) > 0) : []
  if (!lots.length) return null
  const db = getDb(env)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('supplier.backfill', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify({ ...reversal, lots }), byId: user?.id ?? null, byName: actorSnapshot(user) })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'supplier.backfill', snapshot_id: snapshotId })
  const supplierName = reversal.supplierName || `#${reversal.supplierId}`
  const n = lots.length
  const noun = n === 1 ? 'lot' : 'lots'
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.productId),
    label: `Attributed ${n} ${noun} to "${supplierName}"`,
    undoLabel: `Undo supplier attribution of ${n} ${noun}`,
    redoLabel: `Redo supplier attribution of ${n} ${noun}`,
    payload,
    byId: user?.id ?? null,
    byName: actorSnapshot(user),
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// UNDO: restore each lot's exact prior attribution.
async function applySupplierBackfillUndo(env: Env, r: SupplierBackfillReversal): Promise<void> {
  const db = getDb(env)
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: l.prevSupplierId == null ? null : Number(l.prevSupplierId), sname: l.prevSupplierName ?? null },
    }))
  if (stmts.length) await db.batch(stmts)
}

// REDO: re-apply the supplier to the same lots, using the supplier's CURRENT
// canonical name (mirrors the forward action, which stamps the name at write
// time). Refuses if the supplier no longer exists -- guessing a name is worse.
async function applySupplierBackfillRedo(env: Env, r: SupplierBackfillReversal): Promise<string | null> {
  const db = getDb(env)
  const supplierId = Number(r.supplierId)
  const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get<{ id: number; name: string }>([supplierId])
  if (!supplier) throw new Error('That supplier no longer exists, so this attribution cannot be redone.')
  const name = supplier.name
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: supplierId, sname: name },
    }))
  if (stmts.length) await db.batch(stmts)
  return name
}

// ---------------------------------------------------------------------------
// sale.add_items -- reload-durable undo/redo for "add products to an existing
// sale" (routes/sales.ts POST /:id/items, S4-24b).
//
// This is the applier the sale-STATUS action never got. Sales.tsx records a
// status change with `undo_payload: {}` (actionHistory.ts's default), and
// resolveUndoApplier({}) returns null, so that row's Undo transitions the
// history entry and moves nothing -- the button lies. An action that MOVED
// STOCK must not repeat that, so this one carries a real payload and a real
// applier, and the pure test proves the applier reverses both the line and
// its stock.
//
// Payload shape: { applier: 'sale.add_items', snapshot_id }. The reversal is
// unbounded in line count (up to 50 lines, each with its own lot takes) and
// action_history's payload is a 20 KB column, so it lives in undo_snapshots
// exactly like the merge appliers above.
//
// UNDO returns the units to the SAME lots the addition drew from, in reverse
// draw order, as new 'return' movements (never by editing the original
// movements), deletes the added sale_items and their allocation rows, and
// restores the sale's money columns from the snapshot's moneyBefore.
// REDO re-inserts the same lines through the SAME production planner
// (planSaleLineAddition -- no second copy of the deduction SQL), drawing the
// exact lots recorded rather than re-running FIFO, then restores moneyAfter.
// The new sale_item ids are written back into the snapshot so the next undo
// deletes the rows that actually exist.
// ---------------------------------------------------------------------------

export async function recordSaleAddItemsUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: SaleAddItemsReversal,
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  if (!reversal || !(Number(reversal.saleId) > 0) || !Array.isArray(reversal.lines) || !reversal.lines.length) return null
  const db = getDb(env)
  const stored = { ...reversal, saleStateFingerprint: await saleStateFingerprint(db, reversal.saleId) }
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('sale.add_items', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify(stored), byId: user?.id ?? null, byName: actorSnapshot(user) })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'sale.add_items', snapshot_id: snapshotId })
  const saleLabel = reversal.receiptNumber || `#${reversal.saleId}`
  const lineCount = reversal.lines.length
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('sales', 'sale', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.saleId),
    label: `Added ${lineCount} item${lineCount === 1 ? '' : 's'} to sale ${saleLabel}`,
    undoLabel: `Undo items added to sale ${saleLabel}`,
    redoLabel: `Redo items added to sale ${saleLabel}`,
    payload,
    byId: user?.id ?? null,
    byName: actorSnapshot(user),
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

export interface ProductMergeGroupSnapshot {
  version: 1
  review_id: string
  group_key: string
  child_snapshot_ids: number[]
  prefix_fingerprint: string
  generation: number
}

export function productMergeGroupPrefixFingerprint(
  reviewId: string,
  groupKey: string,
  childSnapshotIds: number[],
  generation: number,
): Promise<string> {
  const canonicalize = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]))
      : value
  const preimage = JSON.stringify(canonicalize({
    version: 1,
    review_id: reviewId,
    group_key: groupKey,
    generation,
    child_snapshot_ids: childSnapshotIds,
  }))
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage)).then((hashed) =>
    `sha256-${[...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
}

type ProductMergeGroupAssociation = {
  review_id: string
  group_ordinal: number
  group_key: string
  group_status: string
  reversal_generation: number
  action_history_id: number
  actor_id: number
  history_actor_id: number | null
  snapshot_actor_id: number | null
}

type ProductMergeGroupChild = {
  id: number
  status: string
  payload_json: string
  created_by_id: number | null
  member_ordinal: number
  product_id: number
  role: string
  member_status: string
  reversal: MergeReversal
}

export interface ProductMergeGroupRedoContext {
  env: Env
  db: ReturnType<typeof getDb>
  user: SessionUser
  reversal: MergeReversal
  reviewId: string
  groupOrdinal: number
  groupKey: string
  childSnapshotId: number
  childOrdinal: number
  historyId: number
  generation: number
  operationId: string
  completionStatements: (freshReversal: MergeReversal) => AtomicMergeStatement[]
}

// The products route owns the forward fold. It registers this narrow group
// seam after module load so redo can reuse that production fold while placing
// the child snapshot/member/group/history CAS statements in the SAME batch.
// A callback that cannot include completionStatements in its graph batch must
// reject; the applier deliberately has no non-atomic fallback.
export type ProductMergeGroupRedoFn = (ctx: ProductMergeGroupRedoContext) => Promise<void>
let productMergeGroupRedoFn: ProductMergeGroupRedoFn | null = null
export function registerProductMergeGroupRedo(fn: ProductMergeGroupRedoFn): void {
  productMergeGroupRedoFn = fn
}

function strictProductMergeGroupSnapshot(value: unknown): ProductMergeGroupSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = ['child_snapshot_ids', 'generation', 'group_key', 'prefix_fingerprint', 'review_id', 'version']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  const ids = Array.isArray(record.child_snapshot_ids) ? record.child_snapshot_ids.map(Number) : []
  if (!ids.length || ids.length > 3999 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return null
  const generation = Number(record.generation)
  if (record.version !== 1 || !Number.isSafeInteger(generation) || generation < 0) return null
  const reviewId = String(record.review_id || '')
  const groupKey = String(record.group_key || '')
  const prefixFingerprint = String(record.prefix_fingerprint || '')
  if (!reviewId || !groupKey || !/^sha256-[0-9a-f]{64}$/.test(prefixFingerprint)) return null
  return { version: 1, review_id: reviewId, group_key: groupKey, child_snapshot_ids: ids, prefix_fingerprint: prefixFingerprint, generation }
}

function strictProductMergeGroupPointer(payload: Record<string, unknown>): {
  snapshotId: number
  reviewId: string
  groupKey: string
  generation: number
} | null {
  const keys = Object.keys(payload).sort()
  const expected = ['applier', 'generation', 'group_key', 'review_id', 'snapshot_id']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  const snapshotId = Number(payload.snapshot_id)
  const generation = Number(payload.generation)
  const reviewId = String(payload.review_id || '')
  const groupKey = String(payload.group_key || '')
  if (payload.applier !== PRODUCT_MERGE_GROUP_ACTION_KIND || !Number.isSafeInteger(snapshotId) || snapshotId <= 0
    || !Number.isSafeInteger(generation) || generation < 0 || !reviewId || !groupKey) return null
  return { snapshotId, reviewId, groupKey, generation }
}

async function loadProductMergeGroupReplay(
  env: Env,
  payload: Record<string, unknown>,
  historyId: number,
): Promise<{
  db: ReturnType<typeof getDb>
  pointer: NonNullable<ReturnType<typeof strictProductMergeGroupPointer>>
  groupSnapshot: ProductMergeGroupSnapshot
  association: ProductMergeGroupAssociation
  children: ProductMergeGroupChild[]
}> {
  const pointer = strictProductMergeGroupPointer(payload)
  if (!pointer) throw new UndoConflictError('This group merge has an invalid saved history pointer.')
  const db = getDb(env)
  const groupRow = await db.prepare(`
    SELECT payload_json,created_by_id FROM undo_snapshots WHERE id=? AND kind=?
  `).get<{ payload_json: string; created_by_id: number | null }>([pointer.snapshotId, PRODUCT_MERGE_GROUP_ACTION_KIND])
  if (!groupRow) throw new UndoConflictError('The saved group merge details are unavailable.')
  let groupSnapshot: ProductMergeGroupSnapshot | null = null
  try { groupSnapshot = strictProductMergeGroupSnapshot(JSON.parse(groupRow.payload_json)) } catch { groupSnapshot = null }
  if (!groupSnapshot || groupSnapshot.review_id !== pointer.reviewId || groupSnapshot.group_key !== pointer.groupKey) {
    throw new UndoConflictError('The saved group merge details are invalid.')
  }
  const expectedPrefixFingerprint = await productMergeGroupPrefixFingerprint(
    groupSnapshot.review_id,
    groupSnapshot.group_key,
    groupSnapshot.child_snapshot_ids,
    groupSnapshot.generation,
  )
  if (groupSnapshot.prefix_fingerprint !== expectedPrefixFingerprint) {
    throw new UndoConflictError('The saved group merge prefix fingerprint is invalid.')
  }
  const association = await db.prepare(`
    SELECT g.review_id,g.ordinal AS group_ordinal,g.group_key,g.status AS group_status,
           g.reversal_generation,g.action_history_id,r.actor_id,
           h.created_by_id AS history_actor_id,@snapshot_actor AS snapshot_actor_id
    FROM product_conflict_action_groups g
    JOIN product_conflict_action_reviews r ON r.id=g.review_id
    JOIN action_history h ON h.id=g.action_history_id
    WHERE g.review_id=@review AND g.group_key=@groupKey AND g.action_history_id=@history
  `).get<ProductMergeGroupAssociation>({
    review: pointer.reviewId,
    groupKey: pointer.groupKey,
    history: historyId,
    snapshot_actor: groupRow.created_by_id,
  })
  if (!association || Number(association.actor_id) <= 0
    || Number(association.history_actor_id) !== Number(association.actor_id)
    || Number(association.snapshot_actor_id) !== Number(association.actor_id)) {
    throw new UndoConflictError('This group merge is not associated with its authoritative actor and history row.')
  }
  const allMemberRows = await db.prepare(`
    SELECT member_ordinal,product_id,role,status AS member_status,undo_snapshot_id
    FROM product_conflict_action_group_members
    WHERE review_id=? AND group_ordinal=?
    ORDER BY member_ordinal
  `).all<{ member_ordinal: number; product_id: number; role: string; member_status: string; undo_snapshot_id: number | null }>([pointer.reviewId, Number(association.group_ordinal)])
  const keeperRows = allMemberRows.filter((row) => row.role === 'keeper')
  if (keeperRows.length !== 1 || keeperRows[0].undo_snapshot_id != null) {
    throw new UndoConflictError('This group merge has an invalid authoritative keeper member.')
  }
  const memberRows = allMemberRows.filter((row) => row.undo_snapshot_id != null) as Array<{
    member_ordinal: number; product_id: number; role: string; member_status: string; undo_snapshot_id: number
  }>
  const memberIds = memberRows.map((row) => Number(row.undo_snapshot_id))
  if (memberIds.length !== groupSnapshot.child_snapshot_ids.length
    || memberIds.some((id, index) => id !== groupSnapshot!.child_snapshot_ids[index])) {
    throw new UndoConflictError('This group merge has foreign, missing, duplicated, or reordered child snapshots.')
  }
  const snapshotRows: Array<{ id: number; status: string; payload_json: string; created_by_id: number | null }> = []
  for (const ids of chunk(groupSnapshot.child_snapshot_ids, 80)) {
    const placeholders = ids.map(() => '?').join(',')
    snapshotRows.push(...await db.prepare(`
      SELECT id,status,payload_json,created_by_id FROM undo_snapshots
      WHERE kind=? AND id IN (${placeholders})
    `).all<{ id: number; status: string; payload_json: string; created_by_id: number | null }>([PRODUCT_MERGE_GROUP_CHILD_KIND, ...ids]))
  }
  if (snapshotRows.length !== groupSnapshot.child_snapshot_ids.length) {
    throw new UndoConflictError('This group merge has missing child snapshots.')
  }
  const snapshotsById = new Map(snapshotRows.map((row) => [Number(row.id), row]))
  const membersById = new Map(memberRows.map((row) => [Number(row.undo_snapshot_id), row]))
  const children = groupSnapshot.child_snapshot_ids.map((id) => {
    const row = snapshotsById.get(id)
    const member = membersById.get(id)
    if (!row || !member || Number(row.created_by_id) !== Number(association.actor_id)) {
      throw new UndoConflictError('This group merge has a foreign child snapshot.')
    }
    let reversal: MergeReversal
    try { reversal = JSON.parse(row.payload_json) as MergeReversal } catch { throw new UndoConflictError('A group merge child snapshot is unreadable.') }
    if (!reversal || Number(reversal.dupId) !== Number(member.product_id)
      || Number(reversal.keeperId) !== Number(keeperRows[0].product_id)
      || member.role !== 'merged' || !String(reversal.operationId || '').trim()) {
      throw new UndoConflictError('A group merge child snapshot does not match its authoritative member.')
    }
    return { ...row, ...member, reversal }
  })
  const firstReversed = children.findIndex((child) => child.status === 'reversed')
  if (children.some((child, index) => !['applied', 'reversed'].includes(child.status)
    || (firstReversed >= 0 && index >= firstReversed && child.status !== 'reversed'))) {
    throw new UndoConflictError('This group merge has an invalid child replay sequence.')
  }
  return { db, pointer, groupSnapshot, association, children }
}

function productMergeGroupCompletionStatements(args: {
  direction: 'undo' | 'redo'
  user: SessionUser
  historyId: number
  groupSnapshotId: number
  groupSnapshot: ProductMergeGroupSnapshot
  association: ProductMergeGroupAssociation
  child: ProductMergeGroupChild
  generation: number
  final: boolean
  nextPrefixFingerprint: string
  freshReversal?: MergeReversal
}): AtomicMergeStatement[] {
  const { direction, user, historyId, groupSnapshotId, association, child, generation, final } = args
  const fromSnapshotStatus = direction === 'undo' ? 'applied' : 'reversed'
  const toSnapshotStatus = direction === 'undo' ? 'reversed' : 'applied'
  const fromMemberStatus = direction === 'undo' ? 'undo_ready' : 'reversed'
  const toMemberStatus = direction === 'undo' ? 'reversed' : 'undo_ready'
  const finalGroupStatus = direction === 'undo' ? 'reversed' : 'completed'
  const finalHistoryStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const nextGeneration = final ? generation + 1 : generation
  const payload = JSON.stringify(args.freshReversal || child.reversal)
  const stamp = new Date().toISOString()
  const guard = {
    sql: `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM product_conflict_action_groups
        WHERE review_id=@review AND ordinal=@groupOrdinal AND group_key=@groupKey
          AND action_history_id=@history AND reversal_generation=@generation)
      AND EXISTS(SELECT 1 FROM product_conflict_action_reviews WHERE id=@review AND actor_id=@actor)
      AND EXISTS(SELECT 1 FROM undo_snapshots
        WHERE id=@groupSnapshot AND kind=@groupKind AND status=@groupSnapshotStatus AND created_by_id=@actor
          AND CAST(json_extract(payload_json,'$.generation') AS INTEGER)=@generation
          AND json_extract(payload_json,'$.prefix_fingerprint')=@prefixFingerprint)
      AND EXISTS(SELECT 1 FROM undo_snapshots
        WHERE id=@child AND kind=@childKind AND status=@fromSnapshot AND created_by_id=@actor AND payload_json=@childPayload)
      AND EXISTS(SELECT 1 FROM product_conflict_action_group_members
        WHERE review_id=@review AND group_ordinal=@groupOrdinal AND member_ordinal=@memberOrdinal
          AND product_id=@product AND undo_snapshot_id=@child AND status=@fromMember)
      AND EXISTS(SELECT 1 FROM action_history WHERE id=@history AND created_by_id=@actor AND status=@historyStatus)
      THEN 1 ELSE json_extract('', '$') END AS product_merge_group_guard`,
    params: {
      review: association.review_id, groupOrdinal: Number(association.group_ordinal), groupKey: association.group_key,
      history: historyId, generation, groupSnapshot: groupSnapshotId, groupKind: PRODUCT_MERGE_GROUP_ACTION_KIND,
      groupSnapshotStatus: direction === 'undo' ? 'applied' : 'reversed', prefixFingerprint: args.groupSnapshot.prefix_fingerprint,
      child: child.id, childKind: PRODUCT_MERGE_GROUP_CHILD_KIND, childPayload: child.payload_json,
      fromSnapshot: fromSnapshotStatus, memberOrdinal: child.member_ordinal, product: child.product_id,
      fromMember: fromMemberStatus, actor: Number(association.actor_id),
      historyStatus: direction === 'undo' ? 'undoable' : 'redoable',
    },
  }
  return [
    guard,
    {
      sql: `UPDATE undo_snapshots SET status=@status,payload_json=@payload,updated_at=@stamp
            WHERE id=@id AND kind=@kind AND status=@fromStatus`,
      params: { status: toSnapshotStatus, payload, stamp, id: child.id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND, fromStatus: fromSnapshotStatus },
    },
    {
      sql: `UPDATE product_conflict_action_group_members SET status=@status,updated_at=@stamp
            WHERE review_id=@review AND group_ordinal=@groupOrdinal AND member_ordinal=@memberOrdinal
              AND undo_snapshot_id=@child AND status=@fromStatus`,
      params: { status: toMemberStatus, stamp, review: association.review_id, groupOrdinal: Number(association.group_ordinal), memberOrdinal: child.member_ordinal, child: child.id, fromStatus: fromMemberStatus },
    },
    {
      sql: `UPDATE product_conflict_action_groups SET status=CASE WHEN @redoFinal=1 AND EXISTS(
              SELECT 1 FROM product_conflict_action_group_members pending
              WHERE pending.review_id=product_conflict_action_groups.review_id
                AND pending.group_ordinal=product_conflict_action_groups.ordinal
                AND pending.role='merged' AND pending.status='planned')
              THEN 'partial' ELSE @status END,reversal_generation=@nextGeneration,updated_at=@stamp
            WHERE review_id=@review AND ordinal=@groupOrdinal AND reversal_generation=@generation`,
      params: { status: final ? finalGroupStatus : 'partial', redoFinal: direction === 'redo' && final ? 1 : 0,
        nextGeneration, stamp, review: association.review_id, groupOrdinal: Number(association.group_ordinal), generation },
    },
    ...(final ? [{
      sql: `UPDATE undo_snapshots SET status=@status,
            payload_json=json_set(payload_json,'$.generation',@nextGeneration,'$.prefix_fingerprint',@nextPrefixFingerprint),updated_at=@stamp
            WHERE id=@id AND kind=@kind AND CAST(json_extract(payload_json,'$.generation') AS INTEGER)=@generation`,
      params: { status: direction === 'undo' ? 'reversed' : 'applied', nextGeneration, nextPrefixFingerprint: args.nextPrefixFingerprint, stamp, id: groupSnapshotId, kind: PRODUCT_MERGE_GROUP_ACTION_KIND, generation },
    }, {
      sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,
            undo_payload=json_set(undo_payload,'$.generation',@nextGeneration),
            redo_payload=json_set(redo_payload,'$.generation',@nextGeneration)
            WHERE id=@history AND status=@fromStatus`,
      params: { status: finalHistoryStatus, stamp, nextGeneration, history: historyId, fromStatus: direction === 'undo' ? 'undoable' : 'redoable' },
    }] : []),
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
            VALUES(@actor,@actorName,@action,'product',@product,@details,'product',@product,@details)`,
      params: {
        actor: user.id,
        actorName: actorSnapshot(user),
        action: direction === 'undo' ? 'action_undo' : 'action_redo',
        product: String(child.product_id),
        details: JSON.stringify({ via: 'undo_applier', applier: PRODUCT_MERGE_GROUP_ACTION_KIND, review_id: association.review_id, group_key: association.group_key, child_snapshot_id: child.id, generation }),
      },
    },
  ]
}

/** Restore only replay-written timestamps needed by the next older child.
 * The fingerprints remain immutable and include updated_at. Exact current-row
 * guards reject races; exact predecessor non-time fields must match AFTER the
 * reversal, before any timestamp is restored. Never bless a new fingerprint.
 */
function productMergeGroupPredecessorTimestamps(child: ProductMergeGroupChild, predecessor?: ProductMergeGroupChild): {
  before: AtomicMergeStatement[]; after: AtomicMergeStatement[]
} {
  const before: AtomicMergeStatement[] = []
  const after: AtomicMergeStatement[] = []
  if (!predecessor) return { before, after }
  const parse = (value: string | undefined): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(value || '')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* Fail closed rather than weakening a missing fingerprint. */ }
    throw new UndoConflictError('A group merge predecessor fingerprint is unavailable.')
  }
  const current = parse(child.reversal.mergedStateFingerprint)
  const prior = parse(predecessor.reversal.mergedStateFingerprint)
  const readRows = (fingerprint: Record<string, unknown>, keys: string[]): Map<number, Record<string, unknown>> => {
    const rows = new Map<number, Record<string, unknown>>()
    for (const key of keys) {
      if (!Array.isArray(fingerprint[key])) throw new UndoConflictError('A group merge fingerprint has invalid rows.')
      for (const value of fingerprint[key]) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UndoConflictError('Invalid group merge fingerprint row.')
        const row = value as Record<string, unknown>
        if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || !Object.hasOwn(row, 'updated_at')
          || Object.keys(row).some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) {
          throw new UndoConflictError('Invalid group merge timestamp provenance.')
        }
        // Full product rows take precedence over the child-product projection.
        if (!rows.has(Number(row.id))) rows.set(Number(row.id), row)
      }
    }
    return rows
  }
  const rowGuards = (table: string, rows: Record<string, unknown>[], omitTimestamp: boolean): AtomicMergeStatement[] => {
    const shapes = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const key = JSON.stringify(Object.keys(row).filter((field) => !omitTimestamp || field !== 'updated_at').sort())
      const group = shapes.get(key) || []
      group.push(row)
      shapes.set(key, group)
    }
    return [...shapes].map(([shape, values]) => ({
      sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(@rows) saved WHERE NOT EXISTS(
        SELECT 1 FROM ${table} live WHERE ${(JSON.parse(shape) as string[])
          .map((field) => `live."${field}" IS json_extract(saved.value,'$.${field}')`).join(' AND ')}
      )) THEN 1 ELSE json_extract('', '$') END AS product_merge_group_timestamp_guard`,
      params: { rows: JSON.stringify(values) },
    }))
  }
  before.push({
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM undo_snapshots
      WHERE id=@id AND kind=@kind AND status='applied' AND payload_json=@payload)
      THEN 1 ELSE json_extract('', '$') END AS product_merge_group_predecessor_guard`,
    params: { id: predecessor.id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND, payload: predecessor.payload_json },
  })
  for (const [table, keys, affected] of [
    ['products', ['products', 'childProducts'], [child.reversal.keeperId, child.reversal.dupId, ...intIds(child.reversal.reparentedChildProductIds)]],
    ['promotion_rules', ['promotionRules'], (child.reversal.promotionRulesBefore || []).map((row) => row.id)],
  ] as const) {
    const currentRows = readRows(current, [...keys])
    const priorRows = readRows(prior, [...keys])
    const targetIds = [...new Set(affected.map(Number))].filter((id) => priorRows.has(id))
    if (!targetIds.length) continue
    if (targetIds.some((id) => !currentRows.has(id))) throw new UndoConflictError('Missing current group merge timestamp provenance.')
    before.push(...rowGuards(table, targetIds.map((id) => currentRows.get(id)!), false))
    const savedRows = targetIds.map((id) => priorRows.get(id)!)
    after.push(...rowGuards(table, savedRows, true), {
      sql: `UPDATE ${table} SET updated_at=(SELECT json_extract(value,'$.updated_at') FROM json_each(@rows)
        WHERE json_extract(value,'$.id')=${table}.id)
        WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(@rows))`,
      params: { rows: JSON.stringify(savedRows.map(({ id, updated_at }) => ({ id, updated_at }))) },
    })
  }
  return { before, after }
}

async function replayProductMergeGroup(payload: Record<string, unknown>, ctx: UndoApplierContext): Promise<UndoApplierOutcome> {
  if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative group history identity is required.')
  const expectedGeneration = Number(ctx.generation)
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
    throw new UndoConflictError('An exact group reversal generation is required.')
  }
  const loaded = await loadProductMergeGroupReplay(ctx.env, payload, Number(ctx.historyId))
  const { db, pointer, groupSnapshot, association, children } = loaded
  const generation = Number(association.reversal_generation)
  if (pointer.generation !== generation || groupSnapshot.generation !== generation) {
    throw new UndoConflictError('The saved group reversal generation is inconsistent.')
  }
  const appliedCount = children.filter((child) => child.status === 'applied').length
  const terminal = ctx.direction === 'undo' ? appliedCount === 0 : appliedCount === children.length
  if (generation === expectedGeneration + 1 && terminal) {
    return { complete: true, continuation_required: false, processed_children: 0, pending_children: 0, generation }
  }
  if (generation !== expectedGeneration) throw new UndoConflictError('This group reversal generation is stale.')
  const targetIndex = ctx.direction === 'undo' ? appliedCount - 1 : appliedCount
  if (targetIndex < 0 || targetIndex >= children.length) {
    throw new UndoConflictError(`This group merge is already ${ctx.direction === 'undo' ? 'reversed' : 'applied'}.`)
  }
  const child = children[targetIndex]
  const final = ctx.direction === 'undo' ? targetIndex === 0 : targetIndex === children.length - 1
  const nextPrefixFingerprint = final
    ? await productMergeGroupPrefixFingerprint(groupSnapshot.review_id, groupSnapshot.group_key, groupSnapshot.child_snapshot_ids, generation + 1)
    : groupSnapshot.prefix_fingerprint
  if (ctx.direction === 'undo') {
    await assertMergeStateUnchanged(db, [child.reversal], child.reversal.mergedStateFingerprint)
    const statements = await buildMergeReversalStatements(ctx.env, child.reversal, getActionTier(ctx.user, 'products', 'image') === 'full')
    const timestamps = productMergeGroupPredecessorTimestamps(child, children[targetIndex - 1])
    const completion = productMergeGroupCompletionStatements({
      direction: ctx.direction, user: ctx.user, historyId: Number(ctx.historyId), groupSnapshotId: pointer.snapshotId,
      groupSnapshot, association, child, generation, final, nextPrefixFingerprint,
    })
    statements.unshift(completion[0], ...timestamps.before)
    statements.push(...timestamps.after, ...completion.slice(1))
    try { await db.batch(statements) } catch (error) {
      if (/malformed JSON|product_merge_group_guard|constraint/i.test(String(error))) {
        throw new UndoConflictError('This group merge changed concurrently. Nothing was reversed.')
      }
      throw error
    }
  } else {
    if (!productMergeGroupRedoFn) throw new UndoConflictError('This group merge cannot be redone in the current server build.')
    await productMergeGroupRedoFn({
      env: ctx.env, db, user: ctx.user, reversal: child.reversal,
      reviewId: association.review_id, groupOrdinal: Number(association.group_ordinal), groupKey: association.group_key,
      childSnapshotId: child.id, childOrdinal: targetIndex, historyId: Number(ctx.historyId), generation,
      operationId: String(child.reversal.operationId || ''),
      completionStatements: (freshReversal) => productMergeGroupCompletionStatements({
        direction: ctx.direction, user: ctx.user!, historyId: Number(ctx.historyId), groupSnapshotId: pointer.snapshotId,
        groupSnapshot, association, child, generation, final, nextPrefixFingerprint, freshReversal,
      }),
    })
    const refreshed = await db.prepare(`SELECT payload_json FROM undo_snapshots
      WHERE id=@child AND kind=@kind AND status='applied'`).get<{ payload_json: string }>({ child: child.id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND })
    if (!refreshed?.payload_json) throw new UndoConflictError('The redone group child receipt is unavailable.')
    let refreshedReversal: MergeReversal
    try { refreshedReversal = JSON.parse(refreshed.payload_json) as MergeReversal }
    catch { throw new UndoConflictError('The redone group child receipt is invalid.') }
    const fingerprinted = JSON.stringify({ ...refreshedReversal, fingerprintPending: false,
      mergedStateFingerprint: await mergeStateFingerprint(db, [refreshedReversal]) })
    const updated = await db.prepare(`UPDATE undo_snapshots SET payload_json=@payload,updated_at=CURRENT_TIMESTAMP
      WHERE id=@child AND kind=@kind AND status='applied' AND payload_json=@before`)
      .run({ payload: fingerprinted, child: child.id, kind: PRODUCT_MERGE_GROUP_CHILD_KIND, before: refreshed.payload_json })
    if (!Number((updated as { changes?: number; meta?: { changes?: number } }).changes
      ?? (updated as { meta?: { changes?: number } }).meta?.changes)) {
      throw new UndoConflictError('The redone group child changed before its fingerprint was recorded.')
    }
  }
  const pending = ctx.direction === 'undo' ? targetIndex : children.length - targetIndex - 1
  await broadcast(ctx.env, 'products', { action: 'update' })
  await broadcast(ctx.env, 'inventory', { action: 'update' })
  return {
    complete: final,
    continuation_required: !final,
    processed_children: 1,
    pending_children: pending,
    generation: final ? generation + 1 : generation,
  }
}

async function replayProductRemove(payload: Record<string, unknown>, ctx: UndoApplierContext): Promise<UndoApplierOutcome> {
  if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative product removal history is required.')
  const operationId = typeof payload.operation_id === 'string' ? payload.operation_id : ''
  const pointerGeneration = Number(payload.generation)
  const expectedGeneration = Number(ctx.generation)
  if (!operationId || !Number.isSafeInteger(pointerGeneration) || pointerGeneration < 0
    || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || pointerGeneration !== expectedGeneration) {
    throw new UndoConflictError('An exact product removal generation is required.')
  }
  const db = getDb(ctx.env)
  const operation = await db.prepare(`SELECT * FROM product_remove_operations
    WHERE operation_id=@operation AND action_history_id=@history`).get<ProductRemoveOperationRow>({ operation: operationId, history: ctx.historyId })
  if (!operation?.undo_snapshot_id) throw new UndoConflictError('The saved product removal is unavailable.')
  const targetStatus = ctx.direction === 'undo' ? 'reversed' : 'undo_ready'
  if (Number(operation.generation) === expectedGeneration + 1 && operation.status === targetStatus) {
    return { complete: true, continuation_required: false, processed_children: 0, pending_children: 0, generation: Number(operation.generation) }
  }
  if (Number(operation.generation) !== expectedGeneration
    || operation.status !== (ctx.direction === 'undo' ? 'undo_ready' : 'reversed')) {
    throw new UndoConflictError('This product removal generation is stale.')
  }
  const snapshotRow = await db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=@snapshot AND kind=@kind')
    .get<{ payload_json: string }>({ snapshot: operation.undo_snapshot_id, kind: PRODUCT_REMOVE_ACTION_KIND })
  let snapshot
  try { snapshot = parseProductRemoveSnapshot(JSON.parse(snapshotRow?.payload_json || 'null')) }
  catch { throw new UndoConflictError('The saved product removal details are invalid.') }
  if (snapshot.operation_id !== operation.operation_id || snapshot.plan.product_id !== Number(operation.product_id)
    || await productRemovePlanDigest(snapshot.plan) !== operation.plan_digest) {
    throw new UndoConflictError('The saved product removal details do not match their receipt.')
  }
  const transitionStamp = new Date().toISOString()
  const transitionRequestId = `${ctx.historyId}:${ctx.direction}:${expectedGeneration}`
  try {
    await db.batch(productRemoveReplayStatements({ snapshot, operation, direction: ctx.direction,
      historyId: Number(ctx.historyId), expectedGeneration, user: ctx.user, transitionStamp, transitionRequestId }))
  } catch (error) {
    if (/malformed JSON|product_remove_.*guard|constraint/i.test(String(error))) {
      throw new UndoConflictError('This removed product changed concurrently. Nothing was replayed.')
    }
    throw error
  }
  await broadcast(ctx.env, 'products', { action: ctx.direction === 'undo' ? 'restore' : 'delete', id: snapshot.plan.product_id })
  await broadcast(ctx.env, 'inventory', { action: 'update' })
  return { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: expectedGeneration + 1 }
}

const APPLIERS: Record<string, UndoApplierDef> = {
  'stock.transfer': {
    permission: 'branches', action: 'transfer',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Transfer history context is required.')
      const { replayTransferOperation } = await import('./transferOperation')
      await replayTransferOperation(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [STOCK_SESSION_KIND]: {
    permission: 'inventory',
    action: 'adjust',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Stock session history context is required.')
      await replayStockSession(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  'sale.status.bulk': {
    permission: 'sales', action: 'bulk',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replaySaleBulkStatus(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [BULK_UPDATE_KIND]: {
    permission: 'sales', action: 'bulk',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replaySaleBulkUpdate(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [BULK_CUSTOMER_UPDATE_KIND]: {
    // Legacy rows used this applier for both one- and multi-sale customer
    // updates. Their historical outer gate was sales:customer; the replay
    // helper rechecks the live snapshot size and additionally requires
    // sales:bulk before any legacy multi-sale write.
    permission: 'sales', action: 'customer',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replaySaleBulkUpdate(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [MULTI_CUSTOMER_UPDATE_KIND]: {
    permission: 'sales', action: 'bulk',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replaySaleBulkUpdate(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [SINGLE_CUSTOMER_UPDATE_KIND]: {
    permission: 'sales', action: 'customer',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replaySaleBulkUpdate(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [RETURN_BULK_ACTION_KIND]: {
    permission: 'returns', action: 'bulk',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative history identity required.')
      await replayReturnBulkAction(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  [SALE_SETTLEMENT_ACTION_KIND]: {
    permission: 'sales', action: 'status',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Authoritative settlement history identity is required.')
      await replaySaleSettlementAction(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  // Payload shape: { applier: 'sale.add_items', snapshot_id }. Undo and redo
  // payloads are identical; the applier is direction-aware and the reversal
  // (the added lines, their exact lot takes, and both money snapshots) lives
  // in undo_snapshots[snapshot_id]. See recordSaleAddItemsUndoSnapshot above
  // for why this action needed a REAL payload instead of the `{}` the sale
  // status action records.
  //
  // Gated by the SAME granular action as the live route (sales ->
  // add_items), full tier, at record and operate time.
  'sale.add_items': {
    permission: 'sales',
    action: 'add_items',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('These added items cannot be replayed: their saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, SALE_ADD_ITEMS_ACTION_KIND])
      if (!snap) throw new Error('The saved details for these added items are no longer available, so they cannot be reversed.')
      let reversal: SaleAddItemsReversal
      try {
        reversal = JSON.parse(snap.payload_json) as SaleAddItemsReversal
      } catch (_) {
        throw new Error('The saved details for these added items are unreadable, so they cannot be reversed.')
      }
      const saleId = Number(reversal.saleId || 0)
      const sale = await db.prepare('SELECT id, sale_status FROM sales WHERE id = ?').get<{ id: number; sale_status: string | null }>([saleId])
      if (!sale) throw new Error('The sale these items were added to no longer exists, so this cannot be reversed.')
      // The stock arithmetic recorded in the snapshot is only true for the
      // status the sale was in when the line was added -- a sale that has
      // since been cancelled has already had these units restored by the
      // cancellation, and undoing here would add them a second time.
      if (String(sale.sale_status || 'completed') !== String(reversal.saleStatus)) {
        throw new Error("This sale's status changed after the items were added, so this can no longer be undone safely. Adjust the sale directly instead.")
      }

      const atomicReversal = reversal as AtomicSaleAddItemsReversal
      const atomicReplay = (typeof payload.operation_id === 'string' && payload.operation_id.length > 0)
        || atomicReversal.operationId !== undefined
        || atomicReversal.saleStateRevision !== undefined
      if (atomicReplay) {
        await replayAtomicSaleAddItems(db, atomicReversal, snapshotId, snap.status, payload, ctx)
      } else if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('These added items have already been removed.')
        const savedFingerprint = (reversal as SaleAddItemsReversal & { saleStateFingerprint?: string }).saleStateFingerprint
        if (savedFingerprint && await saleStateFingerprint(db, saleId) !== savedFingerprint) {
          throw new UndoConflictError('This sale was edited after the items were added, so this can no longer be undone safely.')
        }
        const removal = planSaleLineRemoval({
          saleId,
          lines: reversal.lines || [],
          reason: `Undo: items added to sale ${reversal.receiptNumber || `#${saleId}`} removed`,
          userId: ctx.user?.id ?? null,
          userName: actorSnapshot(ctx.user),
        })
        // S4-30: the Undo button writes INTO the amendment ledger rather than
        // around it. Without this, a sale's detail view would show "added 2 x
        // Serum" and then silently stop mentioning it once someone undid the
        // addition -- one audit trail with a hole in it, which is worse than
        // none. The original entry is NEVER rewritten (migration 0115's
        // triggers make that impossible); this is a compensating APPEND, and
        // "we added it, then we took it back off" is a true statement about
        // the afternoon.
        const undoGroupId = crypto.randomUUID()
        await db.batch([
          ...removal.statements,
          saleMoneyUpdateStatement(saleId, reversal.moneyBefore),
          ...(reversal.lineMoneyBefore
            ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyBefore)]
            : []),
          ...(reversal.lines || []).map((line) => amendmentEntryStatement({
            saleId,
            kind: 'line_removed',
            groupId: undoGroupId,
            saleItemId: line.saleItemId,
            productId: line.productId,
            productName: line.productName,
            quantityBefore: line.quantity,
            quantityAfter: 0,
            totalBeforeUsd: reversal.moneyAfter.total_usd,
            totalAfterUsd: reversal.moneyBefore.total_usd,
            unitsMoved: line.heldUnits,
            via: 'undo',
            note: `Undo: items added to sale ${reversal.receiptNumber || `#${saleId}`} removed`,
            userId: ctx.user?.id ?? null,
            userName: actorSnapshot(ctx.user),
          })),
        ])
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('These items are already on the sale; there is nothing to redo.')
        // Re-add through the SAME production planner, drawing the exact lots
        // the original addition drew from (plannedLineFromRecord) rather than
        // re-running FIFO -- undo put those units back into those lots, so
        // they are the right ones, and the strict decrement aborts the redo
        // if a concurrent sale has since taken them.
        const lines = (reversal.lines || []).map(plannedLineFromRecord)
        const plan = planSaleLineAddition({
          saleId,
          saleStatus: reversal.saleStatus,
          lines,
          exchangeRate: Number(reversal.moneyAfter.exchange_rate ?? reversal.exchangeRate) || 4100,
          userId: ctx.user?.id ?? null,
          userName: actorSnapshot(ctx.user),
        })
        // The mirror of the undo branch above: a redo appends its own
        // `line_added` entries marked via 'redo', so the trail reads "added,
        // removed, added back" rather than quietly returning to a state it
        // never explains.
        const redoGroupId = crypto.randomUUID()
        const residualGuards = planUnlottedSaleLineGuards(plan.lines)
        const results = await db.batch([
          { sql: 'DELETE FROM sale_bulk_guards', params: {} },
          ...residualGuards,
          ...plan.statements,
          saleMoneyUpdateStatement(saleId, reversal.moneyAfter),
          ...(reversal.lineMoneyAfter
            ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyAfter)]
            : []),
          ...plan.lines.map((line) => amendmentEntryStatement({
            saleId,
            kind: 'line_added',
            groupId: redoGroupId,
            productId: line.productId,
            productName: line.productName,
            quantityBefore: 0,
            quantityAfter: line.quantity,
            totalBeforeUsd: reversal.moneyBefore.total_usd,
            totalAfterUsd: reversal.moneyAfter.total_usd,
            unitsMoved: -line.heldUnits || 0,
            via: 'redo',
            note: `Redo: items re-added to sale ${reversal.receiptNumber || `#${saleId}`}`,
            userId: ctx.user?.id ?? null,
            userName: actorSnapshot(ctx.user),
          })),
          { sql: 'DELETE FROM sale_bulk_guards', params: {} },
        ]) as Array<{ meta?: { last_row_id?: number } }>
        const saleItemIdByLine = plan.lines.map((_line, lineIndex) => {
          const statementIndex = 1 + residualGuards.length + plan.saleItemStatementIndexByLine[lineIndex]
          return Number(results[statementIndex]?.meta?.last_row_id || 0) || null
        })
        const allocationStatements = buildAllocationStatements(plan.lines, saleItemIdByLine)
        if (allocationStatements.length) {
          try { await db.batch(allocationStatements) } catch (allocationError) {
            console.error('[undo] sale.add_items redo: allocation rows failed (stock already moved correctly)', allocationError)
          }
        }
        // The re-inserted rows have NEW ids -- persist them so a later undo
        // deletes the rows that actually exist, not the ones this redo
        // replaced.
        const nextReversal: SaleAddItemsReversal = {
          ...reversal,
          lines: (reversal.lines || []).map((line, lineIndex) => ({
            ...line,
            saleItemId: Number(saleItemIdByLine[lineIndex] || 0) || line.saleItemId,
          })),
        }
        await db.prepare("UPDATE undo_snapshots SET payload_json = @payload, status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = @id")
          .run({ payload: JSON.stringify(nextReversal), id: snapshotId })
      }

      if (!atomicReplay) {
        await audit(
          ctx.env, ctx.user?.id ?? null, actorSnapshot(ctx.user),
          ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
          'sale', saleId,
          { via: 'undo_applier', applier: SALE_ADD_ITEMS_ACTION_KIND, lines: (reversal.lines || []).length },
        )
      }
      await broadcast(ctx.env, 'sales', { action: 'update', id: saleId })
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  // Payload shape: { applier: 'branch.update', id, fields: { name, location,
  // phone, manager, notes, is_default, is_active } }. The undo_payload carries
  // the PRE-edit field values and the redo_payload the POST-edit values, so the
  // one applier serves both directions -- the direction only decides which
  // stored payload the route hands in.
  'branch.update': {
    // Same section the live PUT /branches/:id gates on (getPermissionTier
    // (user, 'branches') in routes/branches.ts).
    permission: 'branches',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const id = Number(payload.id || 0)
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('This action cannot be replayed: its saved details are missing a branch id.')
      }
      const existing = await db.prepare('SELECT id, name, is_active FROM branches WHERE id = ?')
        .get<{ id: number; name: string; is_active: number }>([id])
      if (!existing) {
        throw new Error('The branch this action changed no longer exists, so it cannot be reversed.')
      }
      const fields = payload.fields && typeof payload.fields === 'object'
        ? (payload.fields as Record<string, unknown>)
        : {}
      await db.batch(branchUpdateStatements(id, fields, existing))
      await audit(
        ctx.env,
        ctx.user?.id ?? null,
        actorSnapshot(ctx.user),
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'branch',
        id,
        { via: 'undo_applier', applier: 'branch.update' },
      )
      await broadcast(ctx.env, 'branches', { action: 'update', id })
    },
  },
  // Payload shape: { applier: 'product.merge', snapshot_id }. Both the undo_
  // and redo_payload are identical -- the applier is direction-aware and the
  // heavy reversal data lives in undo_snapshots[snapshot_id], not the payload.
  // Gated by the SAME granular action as the live merge (products ->
  // merge_duplicates), full tier, at record and operate time.
  'product.merge': {
    permission: 'products',
    action: 'merge_duplicates',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This merge cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'product.merge'])
      if (!snap) throw new Error('The saved details for this merge are no longer available, so it cannot be reversed.')
      let reversal: MergeReversal
      try {
        reversal = JSON.parse(snap.payload_json) as MergeReversal
      } catch (_) {
        throw new Error('The saved details for this merge are unreadable, so it cannot be reversed.')
      }

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This merge has already been undone.')
        await assertMergeStateUnchanged(db, [reversal], reversal.mergedStateFingerprint)
        await applyMergeReversal(ctx.env, reversal, !!ctx.user && getActionTier(ctx.user, 'products', 'image') === 'full')
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This merge is already in place; there is nothing to redo.')
        if (!mergeFoldFn) throw new Error('This merge cannot be redone in the current server build.')
        const keeperId = Number(reversal.keeperId)
        const dupId = Number(reversal.dupId)
        const [keeper, dupRow] = await Promise.all([
          db.prepare('SELECT id, name, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; is_active: number }>([keeperId]),
          db.prepare('SELECT id, name, image_path, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; image_path: string | null; is_active: number }>([dupId]),
        ])
        if (!keeper || !dupRow) throw new Error('One of the two products no longer exists, so the merge cannot be redone.')
        if (!keeper.is_active || !dupRow.is_active) throw new Error('One of the two products is no longer active, so the merge cannot be redone.')
        const economicsOverride = savedBulkClusterEconomics(reversal)
        const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
        const { reversal: fresh } = await mergeFoldFn(
          ctx.env, db, ctx.user,
          { id: keeperId, name: keeper.name },
          { id: dupId, name: dupRow.name, image_path: dupRow.image_path },
          new Map<number, string>(branchRows.map((b) => [b.id, b.name])),
          reversal.mergeContext || 'redo merge',
          // Repeat the operator's ORIGINAL stock decision on redo; a merge the
          // reviewer settled as a write-off must not come back as a stock fold.
          reversal.stockDisposition === 'write_off' ? 'write_off' : 'merge',
          economicsOverride,
        )
        preserveBulkClusterPlan(reversal, fresh)
        await db.prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: keeperId })
        fresh.mergedStateFingerprint = await mergeStateFingerprint(db, [fresh])
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ payload: JSON.stringify(fresh), id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, actorSnapshot(ctx.user),
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversal.dupId,
        { via: 'undo_applier', applier: 'product.merge', keeperId: reversal.keeperId },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  // Payload shape: { applier: 'product.merge.bulk', snapshot_id }. The snapshot
  // holds { reversals: MergeReversal[] } -- every fold from one whole-catalog
  // POST /merge-duplicates run, in application order. UNDO replays them in
  // reverse (applyBulkMergeReversal); REDO re-runs the folds forward
  // (redoBulkMergeFolds) and overwrites the snapshot with the fresh reversals.
  // Same granular gate as the single merge (products -> merge_duplicates, full).
  'product.merge.bulk': {
    permission: 'products',
    action: 'merge_duplicates',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This merge cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'product.merge.bulk'])
      if (!snap) throw new Error('The saved details for this merge are no longer available, so it cannot be reversed.')
      let reversals: MergeReversal[]
      let mergedStateFingerprint: string | undefined
      try {
        const parsed = JSON.parse(snap.payload_json) as { reversals?: MergeReversal[]; mergedStateFingerprint?: string }
        reversals = Array.isArray(parsed?.reversals) ? parsed.reversals : []
        mergedStateFingerprint = parsed.mergedStateFingerprint
      } catch (_) {
        throw new Error('The saved details for this merge are unreadable, so it cannot be reversed.')
      }
      if (!reversals.length) throw new Error('This merge has no saved folds to replay.')

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This merge has already been undone.')
        await assertMergeStateUnchanged(db, reversals, mergedStateFingerprint)
        await applyBulkMergeReversal(ctx.env, reversals, !!ctx.user && getActionTier(ctx.user, 'products', 'image') === 'full')
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This merge is already in place; there is nothing to redo.')
        const fresh = await redoBulkMergeFolds(ctx.env, ctx.user, reversals)
        const freshFingerprint = await mergeStateFingerprint(db, fresh)
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ payload: JSON.stringify({ reversals: fresh, mergedStateFingerprint: freshFingerprint }), id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, actorSnapshot(ctx.user),
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversals[0]?.keeperId ?? null,
        { via: 'undo_applier', applier: 'product.merge.bulk', count: reversals.length },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  [PRODUCT_MERGE_GROUP_ACTION_KIND]: {
    permission: 'products',
    action: 'merge_duplicates',
    run: replayProductMergeGroup,
  },
  [PRODUCT_REMOVE_ACTION_KIND]: {
    permission: 'products',
    action: 'delete',
    run: replayProductRemove,
  },
  // Payload shape: { applier: 'supplier.backfill', snapshot_id }. The snapshot
  // holds a SupplierBackfillReversal (the lots + each lot's prior attribution).
  // Gated by the products edit action (attributing a lot's supplier IS a product
  // edit), full tier, at record and operate time -- same authority model as the
  // merge appliers above.
  'supplier.backfill': {
    permission: 'products',
    action: 'edit',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This attribution cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'supplier.backfill'])
      if (!snap) throw new Error('The saved details for this attribution are no longer available, so it cannot be reversed.')
      let reversal: SupplierBackfillReversal
      try {
        reversal = JSON.parse(snap.payload_json) as SupplierBackfillReversal
      } catch (_) {
        throw new Error('The saved details for this attribution are unreadable, so it cannot be reversed.')
      }

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This attribution has already been undone.')
        await applySupplierBackfillUndo(ctx.env, reversal)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This attribution is already in place; there is nothing to redo.')
        const name = await applySupplierBackfillRedo(ctx.env, reversal)
        // Keep the snapshot's cached name current for a future undo's label.
        if (name != null && name !== reversal.supplierName) {
          await db.prepare("UPDATE undo_snapshots SET payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id")
            .run({ payload: JSON.stringify({ ...reversal, supplierName: name }), id: snapshotId })
        }
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, actorSnapshot(ctx.user),
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversal.productId ?? null,
        { via: 'undo_applier', applier: 'supplier.backfill', supplierId: reversal.supplierId, lots: (reversal.lots || []).length },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
}

// Returns the applier a payload opts into, or null when the payload names no
// registered applier (the fall-through-to-client-replay case).
export function resolveUndoApplier(payload: Record<string, unknown> | null | undefined): { name: string; permission: string; action?: string; run: UndoApplier } | null {
  if (!payload || typeof payload !== 'object') return null
  const name = typeof payload.applier === 'string' ? payload.applier : ''
  const def = name ? APPLIERS[name] : undefined
  return def ? { name, permission: def.permission, action: def.action, run: def.run } : null
}

// Whether a stored action_history row's NEXT transition can be replayed by the
// Worker itself: an 'undoable' row's next transition is an undo (replaying its
// undo_payload), a 'redoable' row's is a redo (redo_payload) -- any other
// status has no next transition. This is what lets a RELOADED page (no live
// closure) still offer a real Undo/Redo button for the row: actionability is a
// property of the stored payload, not of the tab that recorded it.
export function isServerReplayable(
  row: { reversible?: unknown; status?: unknown },
  undoPayload: Record<string, unknown> | null | undefined,
  redoPayload: Record<string, unknown> | null | undefined,
): boolean {
  if (!Number(row?.reversible || 0)) return false
  const status = String(row?.status || '').toLowerCase()
  if (status === 'undoable') return !!resolveUndoApplier(undoPayload)
  if (status === 'redoable') return !!resolveUndoApplier(redoPayload)
  return false
}

// Exposed for tests: the set of applier names the Worker can execute today.
export function registeredUndoAppliers(): string[] {
  return Object.keys(APPLIERS)
}
