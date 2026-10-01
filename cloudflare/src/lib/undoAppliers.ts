import { assertStockLifecycleMutable, stockLifecycleRefusal } from './stockLifecycle'
import type { Env } from '../index'
import type { SessionUser } from './auth'
// Type-only on purpose: dozens of test loaders stub this module's relative
// imports one by one, so a new runtime import would break them.
import type { ResolveChoiceValues } from './productResolveChoices'
import { getDb } from './db'
import { CATALOG_COST_DERIVE_SQL, catalogCostRecomputeIfChangedStatement } from './catalogCostRecompute'
import { audit } from './audit'
import { hasRecordedSaleMoneyPrecision } from './saleMoneyPrecision'
import { broadcast } from '../durable-objects/broadcastHub'
import {
  BRANCH_REPLAY_ROW_SQL,
  OTHER_CANONICAL_BRANCH_SQL,
  branchReplayDefaultStatements,
  branchReplayDropsDefault,
  branchReplayStateGuardStatement,
  branchUpdateStatements,
  completeBranchReplayFields,
  staleBranchReplayFields,
  type BranchReplayRow,
  type BranchWriteFields,
} from './branchWrites'
import { getActionTier, getPermissionTier, getMergedPermissions, isAdminControlUser, type PermissionTier } from './permissions'
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
import { SALE_SETTLEMENT_ACTION_KIND, replaySaleSettlementAction, saleMutationGuard, samePrecisionCompatibleState } from './saleSettlementAction'
import { STOCK_SESSION_KIND, replayStockSession } from './stockSession'
import { actorSnapshot } from './actorSnapshot'
import { CUSTOMER_GENDER_RESTORATION_KIND, replayCustomerGenderRestoration } from './customerGenderRestoration'
import {
  parseProductMergeClusterPlan,
  resolveProductMergeClusterPlanEconomics,
  type ProductMergeEconomics,
} from './productMerge'
import { PRODUCT_REMOVE_ACTION_KIND, parseProductRemoveSnapshot, productRemovePlanDigest, productRemoveReplayStatements,
  type ProductRemoveOperationRow } from './productDelete'

export const SALE_ADD_ITEMS_ACTION_KIND = 'sale.add_items'
import { resolveProductMergeLineage } from './productMergeLineage'
import { validateCapturedSaleBasket } from './saleItemPricing'

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

// A replay refused to protect newer data answers 409 with one of these stable
// machine codes, so the client can restate it in the operator's language
// (frontend/src/api/actionHistoryTransport.ts). The English message stays for
// action_history.last_error and API callers.
export const UNDO_RECORD_CHANGED_CODE = 'undo_record_changed'
export const UNDO_NO_DEFAULT_BRANCH_CODE = 'undo_no_default_branch'
// A merge closed this stock-in session's Undo for good (see
// closeStockSessionsStatements); the row reads "Undo closed: products were merged".
export const UNDO_CLOSED_BY_MERGE_CODE = 'undo_closed_products_merged'
export const UNDO_CLOSED_BY_MERGE_MESSAGE = 'Undo closed: products were merged.'
// A redo of a merge found stock had moved on a product while its write batch was
// being saved; nothing was written. Same code the merge routes answer with.
export const UNDO_MERGE_CONFLICT_RETRY_CODE = 'merge_conflict_retry'
// FX-exc1 item 1: the other refusals carry a code too.
// The history entry no longer matches the server (a stale generation, pointer
// or receipt): refresh history and try again.
export const UNDO_HISTORY_STALE_CODE = 'undo_history_stale'
// This direction was already replayed (by another tab or device).
export const UNDO_ALREADY_DONE_CODE = 'undo_already_done'
// The saved replay details are missing, invalid or cannot be checked, so the
// entry cannot be replayed safely. The code of any refusal that names none.
export const UNDO_HISTORY_UNUSABLE_CODE = 'undo_history_unusable'
// Answered by routes/actionHistory.ts itself: the row has no payload the Worker
// can replay, so only the tab that performed it can reverse it.
export const UNDO_NEEDS_ORIGINAL_TAB_CODE = 'undo_needs_original_tab'
// Any other 409 replay refusal that carries no stable code of its own (a
// grouped Return or bulk Sales replay's, say).
export const UNDO_REFUSED_CODE = 'undo_refused'

export class UndoConflictError extends Error {
  readonly statusCode = 409
  readonly code: string

  constructor(message: string, code: string = UNDO_HISTORY_UNUSABLE_CODE) {
    super(message)
    this.code = code
  }
}

// The code a 409 replay refusal answers with: the refusal's own stable machine
// code (an UndoConflictError's, or another lib's such as
// TransferConflictError's), else UNDO_REFUSED_CODE, so every refusal reaches
// the client with a code it can restate. Only for 409s: a failure that is not
// a refusal keeps its old uncoded shape.
export function replayRefusalCode(error: unknown): string {
  const own = (error as { code?: unknown } | null)?.code
  return typeof own === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(own) ? own : UNDO_REFUSED_CODE
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
  /** Present only when a Resolve barcode choice moved the keeper's own barcode onto this record; undo puts it back. */
  dupBarcodeBefore?: string | null
  /** Present only when a Resolve choice rewrote the keeper's name; undo restores both. */
  keeperNameBefore?: string | null
  keeperNameNormalizedBefore?: string | null
  /** The Resolve grid's keeper choice (N1/N4); a redo passes it back to the fold. */
  keeperChoice?: ProductMergeKeeperChoice
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
  /** New resolver snapshots include received date, supplier and cost metadata. */
  fullBatchMetadataFingerprint?: boolean
  fingerprintPending?: boolean
  operationId?: string
}

export const PRODUCT_MERGE_GROUP_ACTION_KIND = 'product.merge.group'
export const PRODUCT_MERGE_GROUP_CHILD_KIND = 'product.merge.group.child'
const PRODUCT_MERGE_APPLIER_KINDS = new Set(['product.merge', 'product.merge.bulk', PRODUCT_MERGE_GROUP_ACTION_KIND])

function mergeChoicePermissionError(reversal: MergeReversal, user: SessionUser | null | undefined): string | null {
  const choice = reversal.keeperChoice
  if (!choice) return null
  const needsProductEdit = choice.requiresProductEdit === true
    || (choice.requiresProductEdit !== false && !!choice.fields && Object.keys(choice.fields).length > 0)
  if (needsProductEdit && (!user || getActionTier(user, 'products', 'edit') !== 'full')) return 'product_edit_permission_required'
  if (choice.cost && (!user || (!isAdminControlUser(user) && getMergedPermissions(user).product_cost_edit !== true))) return 'cost_permission_required'
  return null
}

function assertMergeChoicePermissions(reversals: MergeReversal[], user: SessionUser | null | undefined): void {
  for (const reversal of reversals) {
    const code = mergeChoicePermissionError(reversal, user)
    if (code) throw Object.assign(new Error('Current permission is required to replay the saved Resolve choices.'), { code, status: 403 })
  }
}

export async function mergeReplayChoicePermissionError(env: Env, payload: Record<string, unknown>, user: SessionUser): Promise<string | null> {
  const kind = String(payload.applier || '')
  if (kind !== 'product.merge' && kind !== 'product.merge.bulk') return null
  const snapshotId = Number(payload.snapshot_id || 0)
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) return 'product_edit_permission_required'
  const snap = await getDb(env).prepare('SELECT payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
    .get<{ payload_json: string }>([snapshotId, kind])
  if (!snap) return 'product_edit_permission_required'
  try {
    const parsed = JSON.parse(snap.payload_json) as MergeReversal & { reversals?: MergeReversal[] }
    const reversals = kind === 'product.merge.bulk' ? parsed.reversals : [parsed]
    if (!Array.isArray(reversals) || !reversals.length) return 'product_edit_permission_required'
    for (const reversal of reversals) {
      const code = mergeChoicePermissionError(reversal, user)
      if (code) return code
    }
    return null
  } catch {
    return 'product_edit_permission_required'
  }
}

function mergeReversalHasSavedImageEffect(reversal: MergeReversal): boolean {
  if ((reversal.dupImagesBefore || []).length || (reversal.imagesMovedToKeeper || []).length) return true
  const fields = reversal.keeperChoice?.fields
  if (fields && Object.prototype.hasOwnProperty.call(fields, 'image_path')
    && String(fields.image_path || '').trim() !== String(reversal.keeperImagePathBefore || '').trim()) return true
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

// The Resolve grid's Keep merge (owner N1/N4, 23 Sep 2026): the kept product
// keeps its name and barcode, and a permitted reviewer's chosen cost replaces
// the averaged one. Carried in the reversal so a redo repeats it exactly.
export type ProductMergeKeeperChoice = {
  follows: true
  requiresProductEdit?: boolean
  cost?: { cost_price_usd: number; cost_price_khr?: number | null }
  /** Server-frozen group economics; carried through each pair's undo/redo. */
  economics?: ProductMergeEconomics
  /**
   * The grid's per-field Final values (lib/productResolveChoices.ts), resolved
   * from the frozen reviewed rows. Applied after the economics on every step,
   * so a later step's highest-price rule cannot overwrite a chosen price.
   */
  fields?: ResolveChoiceValues
}

// The history rows that carry a product's name as a snapshot (the rename and
// merge paths keep them in step with products.name). Undo of a merge whose
// choice renamed the survivor writes the old name back to the survivor's rows.
export const PRODUCT_NAME_SNAPSHOT_COLUMNS: ReadonlyArray<{ table: string; idColumn: string; nameColumn: string }> = [
  { table: 'sale_items', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'inventory_movements', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'return_items', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'stock_transfers', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'damaged_stock_lots', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'return_replacement_items', idColumn: 'product_id', nameColumn: 'product_name' },
  { table: 'stock_row_moves', idColumn: 'source_product_id', nameColumn: 'source_product_name' },
  { table: 'stock_row_moves', idColumn: 'destination_product_id', nameColumn: 'destination_product_name' },
]

export function productNameSnapshotStatements(productId: number, productName: string | null): AtomicMergeStatement[] {
  if (productName == null || !Number.isSafeInteger(productId) || productId <= 0) return []
  return PRODUCT_NAME_SNAPSHOT_COLUMNS.map(({ table, idColumn, nameColumn }) => ({
    sql: `UPDATE ${table} SET ${nameColumn} = @snapshotName WHERE ${idColumn} = @snapshotProductId`,
    params: { snapshotName: productName, snapshotProductId: productId },
  }))
}

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
//   sale_not_paid_repair_0173, catalog_cost_recompute_0175,
//   catalog_cost_repair_0195_backup, sale_cost_repair_0200 (held) -- repair receipts of
//     a data migration (before-values and applied flags per product id); the
//     same provenance rule as stock_row_moves: they say what was repaired, they
//     are not a live link.
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
//     So the members row stays where it happened, and the merge CLOSES the
//     session's Undo in its own D1 batch (closeStockSessionsStatements below):
//     history status 'recorded', reversible 0, the reason in last_error, one
//     audit row per session. Before 1 Oct 2026 the merge was REFUSED while a
//     session could be undone or redone, but nothing ever settles a session
//     (only the 180-day retention sweep), so recently received duplicates could
//     never be merged. Closed is permanent: undoing the merge does not reopen
//     the session. Both halves are pinned in
//     scripts/test-merge-identity-fk-pure.cjs section 5 and
//     scripts/test-merge-closes-stock-session-native.cjs.
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
  // P10-10: the manual cost-price entry ledger (migration 0177) -- a merge
  // must carry the discarded row's cost-edit history onto the survivor, the
  // same as every other per-product ledger above, so undo gives it back.
  { table: 'product_cost_entries', column: 'product_id' },
]

// The history row of a closed session: the existing 'recorded' status with
// reversible = 0 (what every recorded-only action already uses) and this marker
// in last_error, which History and the Stock Changes page read to say why.
export const STOCK_SESSION_UNDO_CLOSED_BY_MERGE = 'undo_closed:products_merged'
export const STOCK_SESSION_CLOSED_AUDIT_ACTION = 'stock_session_undo_closed'

export const isUndoClosedByMerge = (row: { reversible?: unknown; last_error?: unknown } | null | undefined): boolean =>
  Boolean(row) && !Number(row?.reversible || 0) && row?.last_error === STOCK_SESSION_UNDO_CLOSED_BY_MERGE

export type OpenStockSession = { operationId: string; historyId: number; status: string }

const OPEN_STOCK_SESSION_WHERE = `h.status IN ('undoable', 'redoable')
      AND EXISTS (SELECT 1 FROM stock_session_members m WHERE m.operation_id = o.id
        AND m.product_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@closeProductIds)))`

export async function readOpenStockSessions(
  db: ReturnType<typeof getDb>,
  productIds: number[],
): Promise<OpenStockSession[]> {
  const ids = productIds.filter((id) => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return []
  return db.prepare(`
    SELECT o.id AS operationId, h.id AS historyId, h.status AS status
    FROM stock_session_operations o
    JOIN action_history h ON h.id = o.history_id
    WHERE ${OPEN_STOCK_SESSION_WHERE}
    ORDER BY h.id
  `).all<OpenStockSession>({ closeProductIds: JSON.stringify(ids) })
}

// Two statements for a merge's own db.batch. Both pick the sessions by the same
// predicate at write time, so a session created after the merge was planned is
// closed too and none can be left undoable on a folded product. The audit
// insert comes first because it selects the sessions the update then closes.
export function closeStockSessionsStatements(
  productIds: number[],
  user: { id?: number | null; name?: string | null; username?: string | null } | null,
  mergeOperationId: string | null,
  mergedIntoProductId: number,
): AtomicMergeStatement[] {
  const closeProductIds = JSON.stringify(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))
  return [
    {
      sql: `INSERT INTO audit_logs(user_id, user_name, action, entity, entity_id, details, table_name, record_id)
        SELECT @closeActor, @closeName, @closeAction, 'stock_session', o.id,
          json_object('reason', 'products merged', 'operationId', o.id, 'actionHistoryId', h.id,
            'previousStatus', h.status, 'mergeOperationId', @closeMergeOperation, 'mergedIntoProductId', @closeKeeper),
          'stock_session_operations', o.id
        FROM stock_session_operations o JOIN action_history h ON h.id = o.history_id
        WHERE ${OPEN_STOCK_SESSION_WHERE}`,
      params: {
        closeProductIds,
        closeActor: user?.id ?? null,
        closeName: actorSnapshot(user),
        closeAction: STOCK_SESSION_CLOSED_AUDIT_ACTION,
        closeMergeOperation: mergeOperationId,
        closeKeeper: mergedIntoProductId,
      },
    },
    {
      sql: `UPDATE action_history SET status = 'recorded', reversible = 0, last_error = @closeMarker, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT h.id FROM stock_session_operations o JOIN action_history h ON h.id = o.history_id
          WHERE ${OPEN_STOCK_SESSION_WHERE})`,
      params: { closeProductIds, closeMarker: STOCK_SESSION_UNDO_CLOSED_BY_MERGE },
    },
  ]
}

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
  keeperChoice?: ProductMergeKeeperChoice,
) => Promise<{ reversal: MergeReversal }>

let mergeFoldFn: MergeFoldFn | null = null
export function registerMergeFold(fn: MergeFoldFn): void {
  mergeFoldFn = async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      // Stock moved under the redo's write batch: nothing was written, so this is a 409 to try again, not a fault.
      if (String(error).includes(UNDO_MERGE_CONFLICT_RETRY_CODE)) {
        throw new UndoConflictError('Stock changed while the merge was being redone. Redo was refused. Nothing was changed. Try again.', UNDO_MERGE_CONFLICT_RETRY_CODE)
      }
      throw error
    }
  }
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

// D1 parses with a maximum expression depth of 100 and a left-leaning chain of
// conjuncts costs about three levels per term, so a wide row's equality guard
// must be a balanced tree: depth grows with log(terms), not terms.
export function joinBalanced(terms: readonly string[], operator: 'AND' | 'OR'): string {
  if (terms.length === 0) throw new Error('joinBalanced needs at least one term')
  if (terms.length === 1) return terms[0]
  const middle = Math.ceil(terms.length / 2)
  return `(${joinBalanced(terms.slice(0, middle), operator)} ${operator} ${joinBalanced(terms.slice(middle), operator)})`
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

export async function mergeStateFingerprint(
  db: ReturnType<typeof getDb>, reversals: MergeReversal[], transactionGuards?: AtomicMergeStatement[],
): Promise<string> {
  const productIds = [...new Set(reversals.flatMap((r) => [Number(r.keeperId), Number(r.dupId)]).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
  if (!productIds.length) return ''
  const fullBatchMetadata = reversals.some((reversal) => reversal.fullBatchMetadataFingerprint)
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
      { key: `batches:${index}`, sql: `SELECT ${fullBatchMetadata ? '*' : 'id, variant_product_id, batch_key, batch_number, is_active'} FROM product_batches WHERE variant_product_id IN (${placeholders})`, params: ids },
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
    // Old fingerprints intentionally project only lot identity/activation.
    // Preserve that serialized contract, but lock the entire current lot row
    // (received date, cost, supplier, etc.) against races during group undo.
    if (transactionGuards && !fullBatchMetadata) reads.push({
      key: `casBatchMetadata:${index}`,
      sql: `SELECT * FROM product_batches WHERE variant_product_id IN (${placeholders})`, params: ids,
    })
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
  if (transactionGuards) {
    // Re-run the exact fingerprint projections inside the write transaction.
    // Count + exact row equality protects additions/removals as well as edits,
    // including empty scopes. Reuse these reads so CAS cannot drift from the
    // saved fingerprint's products, lots, links, allocations or promotions.
    for (const read of reads) {
      const rows = resultSets.get(read.key)!
      const columns = Object.keys(rows[0] || {})
      if (columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
        throw new UndoConflictError('Invalid merge fingerprint column.')
      }
      let index = 0
      const query = read.sql.replace(/\?/g, () => `@fingerprintValue${index++}`)
      if (index !== (read.params || []).length) throw new UndoConflictError('Invalid merge fingerprint bindings.')
      const equality = !columns.length ? '' : joinBalanced(columns.map((column) => `live."${column}" IS json_extract(saved.value,'$.${column}')`), 'AND')
      transactionGuards.push({
        sql: `WITH live AS MATERIALIZED (${query})
          SELECT CASE WHEN (SELECT COUNT(*) FROM live)=json_array_length(@fingerprintRows)
            ${columns.length ? `AND NOT EXISTS(SELECT 1 FROM json_each(@fingerprintRows) saved
              WHERE NOT EXISTS(SELECT 1 FROM live WHERE ${equality}))` : ''}
            THEN 1 ELSE json_extract('', '$') END AS product_merge_group_graph_guard`,
        params: { fingerprintRows: JSON.stringify(rows),
          ...Object.fromEntries((read.params || []).map((value, i) => [`fingerprintValue${i}`, value])) },
      })
    }
  }
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

async function assertMergeStateUnchanged(
  db: ReturnType<typeof getDb>, reversals: MergeReversal[], expected?: string, transactionGuards?: AtomicMergeStatement[],
): Promise<void> {
  if (reversals.some((reversal) => reversal.fingerprintPending)) {
    throw new UndoConflictError('This merge is missing its completed safety fingerprint, so it cannot be replayed automatically.')
  }
  // Legacy snapshots predate fingerprints; keep them replayable under their
  // existing row-level guards. Every snapshot written by the atomic path has
  // fingerprintPending until a complete expected value is stored.
  if (transactionGuards && !expected) throw new UndoConflictError('This group merge is missing its safety fingerprint.')
  if (expected && await mergeStateFingerprint(db, reversals, transactionGuards) !== expected) {
    throw new UndoConflictError('This merge has later stock or batch activity, so it can no longer be undone safely.', UNDO_RECORD_CHANGED_CODE)
  }
}

// FX-undo2 (R-undo C11): the LEGACY product.merge / product.merge.bulk undo,
// for snapshots recorded before 357bc6de7 (2026-09-05) and so carrying no
// mergedStateFingerprint (every later recorder stores one, or
// fingerprintPending until it has one, and a redo always does). That undo
// writes ABSOLUTE values -- the keeper's branch stock and folded-into lots from
// their before-images, its prices and its cover -- so it first derives from the
// snapshot what the fold (routes/products.ts foldDuplicateProductInto as it
// stood then) left behind, and proves both products still hold exactly that:
//   * their activity: the discarded row inactive, the keeper active;
//   * every branch_stock row of both: the keeper's before-image plus the
//     discarded row's stock (unless it was written off), none on the other;
//   * every lot the fold touched: its product, its activity where the fold set
//     it, and the per-branch stock of each lot whose stock the snapshot holds;
//   * the keeper's selling and wholesale prices: the higher of the saved
//     before-price and the discarded row's own (resolveMergedPricing);
//   * the keeper's cover, when this actor's undo would restore it.
// A whole-catalog run is undone newest fold first, so each fold's in-batch
// check is derived from the state the folds after it restore. Cost is not
// compared: 0175/0195 re-derive it from lots, as step 8 of the undo does. A
// snapshot that cannot be read this way, or whose undo would also write what
// this derivation does not cover (catalog, barcode, parent links, promotion
// lists, lot allocations -- written only by fingerprinted recorders), is
// refused, never guessed.
type LegacyMergeStock = Map<number, number>

interface LegacyMergeFold {
  keeperId: number
  dupId: number
  moveStock: boolean
  keeperStock: LegacyMergeStock
  dupStock: LegacyMergeStock
  repointed: number[]
  folded: Array<{ dupLot: number; keeperLot: number; dupStock: LegacyMergeStock; keeperStock: LegacyMergeStock }>
  writtenOff: Array<{ lot: number; stock: LegacyMergeStock }>
  // Exactly what the undo writes back (buildMergeReversalStatements step 1).
  prices: { su: number; sk: number; wu?: number; wk?: number } | null
  cover: string | null
}

interface LegacyMergeModel {
  active: Map<number, number>
  stock: Map<number, LegacyMergeStock>
  lots: Map<number, { product: number; active: number | null }>
  lotStock: Map<number, LegacyMergeStock>
  // dupId: the discarded row whose price or cover the fold may have adopted;
  // null once an undo has written the saved value back.
  prices: Map<number, { dupId: number | null; su: number; sk: number; wu?: number; wk?: number }>
  covers: Map<number, { dupId: number | null; before: string | null }>
}

const LEGACY_MERGE_EPSILON = 0.00005

const positiveId = (value: unknown): number | null => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function legacyMergeStock(rows: unknown): LegacyMergeStock | null {
  if (!Array.isArray(rows)) return null
  const stock: LegacyMergeStock = new Map()
  for (const row of rows) {
    const branchId = positiveId((row as { branch_id?: unknown } | null)?.branch_id)
    const quantity = legacyFiniteNumber((row as { quantity?: unknown } | null)?.quantity)
    if (branchId === null || quantity === null || stock.has(branchId)) return null
    stock.set(branchId, quantity)
  }
  return stock
}

function legacyMergeFold(r: MergeReversal): LegacyMergeFold | null {
  if (!r || typeof r !== 'object') return null
  const keeperId = positiveId(r.keeperId)
  const dupId = positiveId(r.dupId)
  if (keeperId === null || dupId === null || keeperId === dupId) return null
  // Present (or non-empty) only on fingerprinted snapshots; the undo would
  // write them, and nothing below derives what they must match.
  const listed = (value: unknown) => value != null && (!Array.isArray(value) || value.length > 0)
  if (r.keeperCatalogBefore || r.keeperBarcodeBefore !== undefined || r.keeperParentIdBefore != null
    || listed(r.promotionRulesBefore) || listed(r.reparentedChildProductIds)) return null
  const keeperStock = legacyMergeStock(r.keeperStockBefore)
  const dupStock = legacyMergeStock(r.dupStockBefore)
  if (!keeperStock || !dupStock || !Array.isArray(r.repointedBatches) || !Array.isArray(r.foldedBatches)) return null
  const repointed: number[] = []
  for (const batch of r.repointedBatches) {
    const id = positiveId(batch?.id)
    if (id === null) return null
    repointed.push(id)
  }
  const folded: LegacyMergeFold['folded'] = []
  for (const batch of r.foldedBatches) {
    const dupLot = positiveId(batch?.dupBatchId)
    const keeperLot = positiveId(batch?.keeperBatchId)
    const lotDupStock = legacyMergeStock(batch?.dupStockBefore)
    const lotKeeperStock = legacyMergeStock(batch?.keeperStockBefore)
    if (dupLot === null || keeperLot === null || dupLot === keeperLot || !lotDupStock || !lotKeeperStock
      || listed(batch?.saleAllocationIds) || listed(batch?.returnAllocationIds)) return null
    folded.push({ dupLot, keeperLot, dupStock: lotDupStock, keeperStock: lotKeeperStock })
  }
  const writtenOff: LegacyMergeFold['writtenOff'] = []
  if (r.writtenOffBatches != null) {
    if (!Array.isArray(r.writtenOffBatches)) return null
    for (const batch of r.writtenOffBatches) {
      const lot = positiveId(batch?.batchId)
      const stock = legacyMergeStock(batch?.stockBefore)
      if (lot === null || !stock) return null
      writtenOff.push({ lot, stock })
    }
  }
  let prices: LegacyMergeFold['prices'] = null
  const pricing = r.keeperPricingBefore
  if (pricing) {
    if (typeof pricing !== 'object' || Array.isArray(pricing)) return null
    const wholesaleUsd = pricing.wholesale_price_usd ?? pricing.special_price_usd
    const wholesaleKhr = pricing.wholesale_price_khr ?? pricing.special_price_khr
    prices = {
      su: Number(pricing.selling_price_usd) || 0,
      sk: Number(pricing.selling_price_khr) || 0,
      ...(wholesaleUsd !== undefined || wholesaleKhr !== undefined
        ? { wu: Number(wholesaleUsd) || 0, wk: Number(wholesaleKhr) || 0 }
        : {}),
    }
  }
  const cover = r.keeperImagePathBefore ?? null
  if (cover !== null && typeof cover !== 'string') return null
  return {
    keeperId, dupId, moveStock: r.stockDisposition !== 'write_off', keeperStock, dupStock,
    repointed, folded, writtenOff, prices, cover,
  }
}

function legacyMergeFoldLots(fold: LegacyMergeFold): number[] {
  return [...new Set([
    ...fold.repointed,
    ...fold.folded.flatMap((batch) => [batch.dupLot, batch.keeperLot]),
    ...fold.writtenOff.map((batch) => batch.lot),
  ])]
}

const addLegacyMergeStock = (base: LegacyMergeStock, added: LegacyMergeStock): LegacyMergeStock => {
  const sum = new Map(base)
  for (const [branchId, quantity] of added) sum.set(branchId, (sum.get(branchId) ?? 0) + quantity)
  return sum
}

// What the folds left behind, applied in their recorded order (a later fold
// of the same keeper recorded the earlier one's result as its before-image).
function legacyMergeApplied(folds: LegacyMergeFold[]): LegacyMergeModel {
  const model: LegacyMergeModel = {
    active: new Map(), stock: new Map(), lots: new Map(), lotStock: new Map(), prices: new Map(), covers: new Map(),
  }
  for (const fold of folds) {
    model.active.set(fold.dupId, 0)
    model.active.set(fold.keeperId, 1)
    model.stock.set(fold.keeperId, fold.moveStock ? addLegacyMergeStock(fold.keeperStock, fold.dupStock) : new Map(fold.keeperStock))
    model.stock.set(fold.dupId, new Map())
    for (const lot of fold.repointed) model.lots.set(lot, { product: fold.keeperId, active: null })
    for (const batch of fold.folded) {
      model.lots.set(batch.dupLot, { product: fold.dupId, active: 0 })
      model.lotStock.set(batch.dupLot, new Map())
      model.lots.set(batch.keeperLot, { product: fold.keeperId, active: null })
      model.lotStock.set(batch.keeperLot, addLegacyMergeStock(batch.keeperStock, batch.dupStock))
    }
    for (const batch of fold.writtenOff) {
      model.lots.set(batch.lot, { product: fold.dupId, active: 0 })
      model.lotStock.set(batch.lot, new Map())
    }
    if (fold.prices) model.prices.set(fold.keeperId, { dupId: fold.dupId, ...fold.prices })
    model.covers.set(fold.keeperId, { dupId: fold.dupId, before: fold.cover })
  }
  return model
}

// The same writes buildMergeReversalStatements makes for one fold.
function legacyMergeUndone(model: LegacyMergeModel, fold: LegacyMergeFold, canChangeProductImages: boolean): void {
  model.active.set(fold.dupId, 1)
  if (fold.prices) model.prices.set(fold.keeperId, { dupId: null, ...fold.prices })
  if (canChangeProductImages) model.covers.set(fold.keeperId, { dupId: null, before: fold.cover })
  const restore = (current: LegacyMergeStock | undefined, dupBefore: LegacyMergeStock, keeperBefore: LegacyMergeStock) => {
    const keeper = new Map(current ?? [])
    for (const branchId of dupBefore.keys()) {
      if (keeperBefore.has(branchId)) keeper.set(branchId, keeperBefore.get(branchId)!)
      else keeper.delete(branchId)
    }
    return keeper
  }
  const putBack = (current: LegacyMergeStock | undefined, before: LegacyMergeStock) => {
    const stock = new Map(current ?? [])
    for (const [branchId, quantity] of before) stock.set(branchId, quantity)
    return stock
  }
  model.stock.set(fold.keeperId, restore(model.stock.get(fold.keeperId), fold.dupStock, fold.keeperStock))
  model.stock.set(fold.dupId, putBack(model.stock.get(fold.dupId), fold.dupStock))
  for (const lot of fold.repointed) model.lots.set(lot, { product: fold.dupId, active: model.lots.get(lot)?.active ?? null })
  for (const batch of fold.folded) {
    model.lots.set(batch.dupLot, { product: fold.dupId, active: 1 })
    model.lotStock.set(batch.keeperLot, restore(model.lotStock.get(batch.keeperLot), batch.dupStock, batch.keeperStock))
    model.lotStock.set(batch.dupLot, putBack(model.lotStock.get(batch.dupLot), batch.dupStock))
  }
  for (const batch of fold.writtenOff) {
    model.lots.set(batch.lot, { product: fold.dupId, active: 1 })
    model.lotStock.set(batch.lot, putBack(model.lotStock.get(batch.lot), batch.stock))
  }
}

// The model, for these products and lots, as one boolean SQL expression over
// JSON lists (a fixed number of bound values, whatever the size of the run).
// Stock is compared as non-zero quantities, so a zero row and no row agree.
function legacyMergeExpectation(
  model: LegacyMergeModel, productIds: number[], lotIds: number[], canChangeProductImages: boolean,
): { sql: string; params: Record<string, unknown> } {
  const nonZero = (quantity: number) => Math.abs(quantity) >= LEGACY_MERGE_EPSILON
  const products = productIds.filter((id) => model.active.has(id)).map((id) => ({ id, a: model.active.get(id) }))
  const stock = products.flatMap(({ id }) => [...(model.stock.get(id) ?? [])]
    .filter(([, quantity]) => nonZero(quantity)).map(([branchId, quantity]) => ({ p: id, b: branchId, q: quantity })))
  const lots = lotIds.filter((id) => model.lots.has(id))
    .map((id) => ({ id, p: model.lots.get(id)!.product, a: model.lots.get(id)!.active }))
  const stockLots = lotIds.filter((id) => model.lotStock.has(id))
  const lotStock = stockLots.flatMap((id) => [...model.lotStock.get(id)!]
    .filter(([, quantity]) => nonZero(quantity)).map(([branchId, quantity]) => ({ l: id, b: branchId, q: quantity })))
  const prices = productIds.filter((id) => model.prices.has(id)).map((id) => {
    const { dupId, ...values } = model.prices.get(id)!
    return { k: id, d: dupId, ...values }
  })
  const covers = canChangeProductImages
    ? productIds.filter((id) => model.covers.has(id)).map((id) => ({ k: id, d: model.covers.get(id)!.dupId, before: model.covers.get(id)!.before }))
    : []
  // resolveMergedPricing: the higher of the two rows, a blank row skipped.
  const merged = (column: string, key: string) => `(CASE WHEN d.id IS NULL OR d.${column} IS NULL OR d.${column} = ''
      THEN json_extract(e.value, '$.${key}') ELSE MAX(json_extract(e.value, '$.${key}'), CAST(d.${column} AS REAL)) END)`
  const priceDiffers = (column: string, key: string) => `ABS(COALESCE(k.${column}, 0) - ${merged(column, key)}) >= @epsilon`
  return {
    sql: `(NOT EXISTS (SELECT 1 FROM json_each(@products) e LEFT JOIN products p ON p.id = json_extract(e.value, '$.id')
        WHERE p.id IS NULL OR COALESCE(p.is_active, 0) <> json_extract(e.value, '$.a'))
      AND NOT EXISTS (SELECT 1 FROM json_each(@stock) e
        WHERE ABS(COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = json_extract(e.value, '$.p')
          AND bs.branch_id = json_extract(e.value, '$.b')), 0) - json_extract(e.value, '$.q')) >= @epsilon)
      AND NOT EXISTS (SELECT 1 FROM branch_stock bs
        WHERE bs.product_id IN (SELECT json_extract(value, '$.id') FROM json_each(@products))
          AND ABS(COALESCE(bs.quantity, 0)) >= @epsilon
          AND NOT EXISTS (SELECT 1 FROM json_each(@stock) e
            WHERE json_extract(e.value, '$.p') = bs.product_id AND json_extract(e.value, '$.b') = bs.branch_id))
      AND NOT EXISTS (SELECT 1 FROM json_each(@lots) e LEFT JOIN product_batches pb ON pb.id = json_extract(e.value, '$.id')
        WHERE pb.id IS NULL OR pb.variant_product_id IS NOT json_extract(e.value, '$.p')
          OR (json_extract(e.value, '$.a') IS NOT NULL AND COALESCE(pb.is_active, 0) <> json_extract(e.value, '$.a')))
      AND NOT EXISTS (SELECT 1 FROM json_each(@lotStock) e
        WHERE ABS(COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = json_extract(e.value, '$.l')
          AND bbs.branch_id = json_extract(e.value, '$.b')), 0) - json_extract(e.value, '$.q')) >= @epsilon)
      AND NOT EXISTS (SELECT 1 FROM branch_batch_stock bbs
        WHERE bbs.batch_id IN (SELECT value FROM json_each(@stockLots))
          AND ABS(COALESCE(bbs.quantity, 0)) >= @epsilon
          AND NOT EXISTS (SELECT 1 FROM json_each(@lotStock) e
            WHERE json_extract(e.value, '$.l') = bbs.batch_id AND json_extract(e.value, '$.b') = bbs.branch_id))
      AND NOT EXISTS (SELECT 1 FROM json_each(@prices) e JOIN products k ON k.id = json_extract(e.value, '$.k')
        LEFT JOIN products d ON d.id = json_extract(e.value, '$.d')
        WHERE ${priceDiffers('selling_price_usd', 'su')} OR ${priceDiffers('selling_price_khr', 'sk')}
          OR (json_extract(e.value, '$.wu') IS NOT NULL AND ${priceDiffers('wholesale_price_usd', 'wu')})
          OR (json_extract(e.value, '$.wk') IS NOT NULL AND ${priceDiffers('wholesale_price_khr', 'wk')}))
      AND NOT EXISTS (SELECT 1 FROM json_each(@covers) e JOIN products k ON k.id = json_extract(e.value, '$.k')
        LEFT JOIN products d ON d.id = json_extract(e.value, '$.d')
        WHERE COALESCE(k.image_path, '') IS NOT COALESCE(CASE
            WHEN COALESCE(json_extract(e.value, '$.before'), '') <> '' THEN json_extract(e.value, '$.before')
            WHEN COALESCE(d.image_path, '') <> '' THEN d.image_path
            ELSE json_extract(e.value, '$.before') END, '')))`,
    params: {
      products: JSON.stringify(products),
      stock: JSON.stringify(stock),
      lots: JSON.stringify(lots),
      lotStock: JSON.stringify(lotStock),
      stockLots: JSON.stringify(stockLots),
      prices: JSON.stringify(prices),
      covers: JSON.stringify(covers),
      epsilon: LEGACY_MERGE_EPSILON,
    },
  }
}

// Checks the derived state of the whole run now, and returns one in-batch
// twin per fold (index = the fold's position) that aborts that fold's undo
// batch through a malformed JSON path if its products change in between. Null
// for a fingerprinted snapshot, which assertMergeStateUnchanged has checked.
async function assertLegacyMergeUnchanged(
  db: ReturnType<typeof getDb>, reversals: MergeReversal[], expected: string | undefined, canChangeProductImages: boolean,
): Promise<AtomicMergeStatement[] | null> {
  if (expected) return null
  const folds: LegacyMergeFold[] = []
  for (const reversal of reversals) {
    const fold = legacyMergeFold(reversal)
    if (!fold) {
      throw new UndoConflictError('This merge was saved without the details needed to check the two products are unchanged, so it cannot be undone safely. Nothing was changed.', UNDO_RECORD_CHANGED_CODE)
    }
    folds.push(fold)
  }
  const model = legacyMergeApplied(folds)
  const whole = legacyMergeExpectation(
    model,
    [...new Set(folds.flatMap((fold) => [fold.keeperId, fold.dupId]))],
    [...new Set(folds.flatMap(legacyMergeFoldLots))],
    canChangeProductImages,
  )
  const row = await db.prepare(`SELECT CASE WHEN ${whole.sql} THEN 1 ELSE 0 END AS ok`).get<{ ok: number }>(whole.params)
  if (Number(row?.ok) !== 1) {
    throw new UndoConflictError('These products changed after the merge (stock, lots, prices or cover image), so it can no longer be undone safely. Nothing was changed.', UNDO_RECORD_CHANGED_CODE)
  }
  const guards: AtomicMergeStatement[] = new Array(folds.length)
  for (let i = folds.length - 1; i >= 0; i--) {
    const fold = folds[i]
    const scoped = legacyMergeExpectation(model, [fold.keeperId, fold.dupId], legacyMergeFoldLots(fold), canChangeProductImages)
    guards[i] = {
      sql: `SELECT CASE WHEN ${scoped.sql} THEN 1 ELSE json_extract('[1]', '$[product_merge_changed]') END AS product_merge_guard`,
      params: scoped.params,
    }
    legacyMergeUndone(model, fold, canChangeProductImages)
  }
  return guards
}

async function saleStateFingerprint(db: ReturnType<typeof getDb>, saleId: number): Promise<string> {
  const sale = await db.prepare('SELECT * FROM sales WHERE id = ?').get<Record<string, unknown>>([saleId])
  const lines = await db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all<Record<string, unknown>>([saleId])
  const amendmentHead = await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM sale_amendments WHERE sale_id = ?').get<{ id: number }>([saleId])
  return JSON.stringify({ sale, lines, amendmentHeadId: Number(amendmentHead?.id) || 0 })
}

export function sameSaleStateFingerprint(currentJson: string, expectedJson: string): boolean {
  if (currentJson === expectedJson) return true
  try {
    const current = JSON.parse(currentJson), expected = JSON.parse(expectedJson)
    if (!current?.sale || !expected?.sale || !samePrecisionCompatibleState(current.sale,expected.sale)) return false
    // Only absent legacy pricing provenance may project a newly added NULL.
    // Non-NULL provenance and all other line fields remain exact conflicts.
    if (!Array.isArray(current.lines) || !Array.isArray(expected.lines) || current.lines.length!==expected.lines.length) return false
    const lines=current.lines.map((row:Record<string,unknown>,index:number)=>{
      if (Object.prototype.hasOwnProperty.call(expected.lines[index],'pricing_snapshot_json')) return row
      if (row.pricing_snapshot_json!==null) return row
      const legacy={...row}; delete legacy.pricing_snapshot_json; return legacy
    })
    return JSON.stringify({ ...current, sale: expected.sale, lines }) === expectedJson
  } catch { return false }
}

// FX-undo2 (R-undo C10): the LEGACY sale.add_items replay, for snapshots the
// old POST /sales/:id/items recorded on 2026-09-04..05 before the atomic path
// (no operation id, no sale revision; the oldest without saleStateFingerprint
// either). Both directions write ABSOLUTE values -- an undo restores
// moneyBefore, a redo restores moneyAfter -- so each first proves the sale is
// still exactly as the other direction left it, derived from the snapshot:
//   undo: the money columns equal moneyAfter, every recorded line is still on
//         the sale as recorded, and the lines sum to moneyAfter's subtotal
//         (that route summed the subtotal from the sale's own lines);
//   redo: the money columns equal moneyBefore, no recorded line is on the
//         sale, and its lines sum to moneyAfter's subtotal less the recorded
//         lines this redo adds back.
// A snapshot too incomplete to derive that from is refused, never guessed.
const LEGACY_ADD_ITEMS_REQUIRED_MONEY = ['subtotal_usd', 'subtotal_khr', 'total_usd', 'total_khr', 'change_usd', 'change_khr']
// Optional keys saleMoneyUpdateStatement also writes when a snapshot has them.
const LEGACY_ADD_ITEMS_OPTIONAL_MONEY = ['exchange_rate', 'money_precision_version', 'calculated_total_usd', 'rounding_adjustment_usd',
  'change_is_actual', 'change_exchange_rate', 'discount_khr', 'tax_khr', 'delivery_fee_khr', 'membership_discount_khr']
const LEGACY_ADD_ITEMS_EPSILON = 0.00005
// The legacy subtotal was round2(existing lines + round2(added lines)).
const LEGACY_ADD_ITEMS_SUM_TOLERANCE = 0.0101

function legacyFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function legacySaleAddItemsExpectation(
  reversal: SaleAddItemsReversal, direction: 'undo' | 'redo',
): { sql: string; params: Record<string, unknown> } | null {
  const saleId = Number(reversal?.saleId)
  const money = (direction === 'undo' ? reversal?.moneyAfter : reversal?.moneyBefore) as unknown as Record<string, unknown> | undefined
  const subtotalAfter = legacyFiniteNumber(reversal?.moneyAfter?.subtotal_usd)
  const lines = Array.isArray(reversal?.lines) ? reversal.lines : []
  if (!Number.isInteger(saleId) || saleId <= 0 || !money || typeof money !== 'object' || subtotalAfter === null || !lines.length) return null
  const params: Record<string, unknown> = { saleId, epsilon: LEGACY_ADD_ITEMS_EPSILON, sumTolerance: LEGACY_ADD_ITEMS_SUM_TOLERANCE }
  const moneyTerms: string[] = []
  for (const column of [...LEGACY_ADD_ITEMS_REQUIRED_MONEY, ...LEGACY_ADD_ITEMS_OPTIONAL_MONEY]) {
    const present = Object.prototype.hasOwnProperty.call(money, column)
    const value = present ? legacyFiniteNumber(money[column]) : null
    if (LEGACY_ADD_ITEMS_REQUIRED_MONEY.includes(column) ? value === null : present && value === null && money[column] !== null) return null
    if (!present) continue
    params[`m_${column}`] = value
    moneyTerms.push(`ABS(COALESCE(s.${column}, 0) - COALESCE(@m_${column}, 0)) < @epsilon`)
  }
  const recorded: Array<{ id: number; productId: number; quantity: number; total: number }> = []
  let recordedTotal = 0
  for (const line of lines) {
    const id = Number(line?.saleItemId)
    const productId = Number(line?.productId)
    const quantity = legacyFiniteNumber(line?.quantity)
    const total = legacyFiniteNumber(line?.lineTotalUsd)
    if (!Number.isInteger(id) || id <= 0 || recorded.some((r) => r.id === id)
      || !Number.isInteger(productId) || productId <= 0 || quantity === null || total === null) return null
    recorded.push({ id, productId, quantity, total })
    recordedTotal += total
  }
  params.lines = JSON.stringify(recorded)
  params.lineSum = direction === 'undo' ? subtotalAfter : subtotalAfter - recordedTotal
  let lineTerm: string
  if (direction === 'undo') {
    params.lineCount = recorded.length
    lineTerm = `(SELECT COUNT(*) FROM json_each(@lines) j JOIN sale_items si ON si.id = json_extract(j.value, '$.id')
        WHERE si.sale_id = @saleId AND si.product_id = json_extract(j.value, '$.productId')
          AND ABS(COALESCE(si.quantity, 0) - json_extract(j.value, '$.quantity')) < @epsilon
          AND ABS(COALESCE(si.total_usd, 0) - json_extract(j.value, '$.total')) < @epsilon) = @lineCount`
  } else {
    lineTerm = `NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = @saleId
        AND si.id IN (SELECT json_extract(value, '$.id') FROM json_each(@lines)))`
  }
  return {
    sql: `(EXISTS (SELECT 1 FROM sales s WHERE s.id = @saleId AND ${moneyTerms.join(' AND ')})
      AND ${lineTerm}
      AND ABS((SELECT COALESCE(SUM(total_usd), 0) FROM sale_items WHERE sale_id = @saleId) - @lineSum) <= @sumTolerance)`,
    params,
  }
}

// Checks the derived state now and returns its in-batch twin, which aborts the
// replay's whole batch through a malformed JSON path (the supplier.backfill
// guard mechanism) if the sale changes between this check and the write.
async function assertLegacySaleAddItemsUnchanged(
  db: ReturnType<typeof getDb>, reversal: SaleAddItemsReversal, direction: 'undo' | 'redo',
): Promise<{ sql: string; params: Record<string, unknown> }> {
  const verb = direction === 'undo' ? 'undone' : 'redone'
  const expectation = legacySaleAddItemsExpectation(reversal, direction)
  if (!expectation) {
    throw new UndoConflictError(`These added items were saved without the totals needed to check the sale is unchanged, so they cannot be ${verb} safely. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
  }
  const row = await db.prepare(`SELECT CASE WHEN ${expectation.sql} THEN 1 ELSE 0 END AS ok`).get<{ ok: number }>(expectation.params)
  if (Number(row?.ok) !== 1) {
    throw new UndoConflictError(direction === 'undo'
      ? 'This sale was edited after the items were added, so this can no longer be undone safely.'
      : 'This sale was edited after these items were removed, so they can no longer be added back safely. Nothing was changed.', UNDO_RECORD_CHANGED_CODE)
  }
  return {
    sql: `SELECT CASE WHEN ${expectation.sql} THEN 1 ELSE json_extract('[1]', '$[sale_add_items_changed]') END AS sale_add_items_guard`,
    params: expectation.params,
  }
}

function legacySaleAddItemsRaceError(error: unknown, direction: 'undo' | 'redo'): unknown {
  return /JSON path error|sale_add_items_changed/i.test(String((error as Error)?.message ?? error))
    ? new UndoConflictError(`This sale changed while the added items were being ${direction === 'undo' ? 'removed' : 'added back'}. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
    : error
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

function salePrecisionLedgerFields(value: Record<string,unknown>): Record<string,unknown> {
  return Object.fromEntries(['money_precision_version','calculated_total_usd','rounding_adjustment_usd']
    .filter(key => Object.prototype.hasOwnProperty.call(value,key)).map(key => [key,value[key]]))
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
    throw new UndoConflictError('Refresh history before replaying these added items.', UNDO_HISTORY_STALE_CODE)
  }
  const user = ctx.user
  if (typeof reversal.saleStateRevision !== 'number' || !Number.isSafeInteger(reversal.saleStateRevision) || reversal.saleStateRevision < 0) {
    throw new UndoConflictError('The saved sale revision is invalid.')
  }
  const historyId = Number(ctx.historyId)
  const generation = Number(ctx.generation)
  const operationId = String(payload.operation_id || '')
  if (!operationId || String(reversal.operationId || '') !== operationId || payload.generation !== generation) {
    throw new UndoConflictError('This added-items receipt does not match its history generation.', UNDO_HISTORY_STALE_CODE)
  }
  const saleId = Number(reversal.saleId)
  const expectedRevision = reversal.saleStateRevision
  const operation = await db.prepare(`
    SELECT id,sale_id,history_id,generation,sale_revision FROM sale_mutation_receipts
    WHERE id=? AND mutation_kind='add_items'
  `).get<Record<string, unknown>>([operationId])
  if (!operation || Number(operation.sale_id) !== saleId || Number(operation.history_id) !== historyId
    || Number(operation.generation) !== generation || Number(operation.sale_revision) !== expectedRevision) {
    throw new UndoConflictError('This added-items receipt changed or no longer matches its history.', UNDO_HISTORY_STALE_CODE)
  }
  const revision = await db.prepare('SELECT COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=?),0) AS revision')
    .get<{ revision: number }>([saleId])
  if (Number(revision?.revision) !== expectedRevision) {
    throw new UndoConflictError('This sale was edited after the items were added. Nothing was reversed.', UNDO_RECORD_CHANGED_CODE)
  }

  const currentSale=await db.prepare('SELECT * FROM sales WHERE id=?').get<Record<string,unknown>>([saleId])
  const currentLines=await db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all<Record<string,unknown>>([saleId])
  if(!currentSale||!currentLines.length)throw new UndoConflictError('The recorded sale basket is unavailable.')
  let lineage:{condition:string;params:Record<string,unknown>}={condition:'1=1',params:{}}
  if(Number(currentSale.money_precision_version)===1||currentLines.every(line=>line.pricing_snapshot_json!=null)){
    try{
      const resolved=await resolveProductMergeLineage(db,saleId,currentLines)
      if(Number(currentSale.money_precision_version)===1)validateCapturedSaleBasket(currentLines,currentSale,resolved.bindings)
      lineage=resolved
    }catch{throw new UndoConflictError('Recorded product merge evidence changed. Nothing was reversed.', UNDO_RECORD_CHANGED_CODE)}
  }
  const currentHeaderJson=JSON.stringify(currentSale),currentLinesJson=JSON.stringify(currentLines)
  if(new TextEncoder().encode(currentHeaderJson+currentLinesJson).byteLength>500_000)throw new UndoConflictError('The recorded sale basket is too large to replay safely.')
  const stateKeys=(row:Record<string,unknown>)=>Object.keys(row).map(key=>{
    if(!/^[a-z][a-z0-9_]*$/.test(key))throw new UndoConflictError('The recorded sale basket shape is invalid.')
    return key
  })
  const all=(terms:readonly string[]):string=>{
    if(!terms.length)return '1=1'
    if(terms.length===1)return terms[0]
    const middle=Math.floor(terms.length/2)
    return `(${all(terms.slice(0,middle))} AND ${all(terms.slice(middle))})`
  }
  const basketCondition=`EXISTS(SELECT 1 FROM sales current WHERE current.id=@saleId AND ${all(stateKeys(currentSale).map(key=>`current.${key} IS json_extract(@replaySale,'$.${key}')`))})
    AND (SELECT COUNT(*) FROM sale_items WHERE sale_id=@saleId)=json_array_length(@replayLines)
    AND NOT EXISTS(SELECT 1 FROM json_each(@replayLines) expected WHERE NOT EXISTS(SELECT 1 FROM sale_items current WHERE current.sale_id=@saleId
      AND ${all(stateKeys(currentLines[0]).map(key=>`current.${key} IS json_extract(expected.value,'$.${key}')`))}))`

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
    replaySale:currentHeaderJson,replayLines:currentLinesJson,...lineage.params,
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
  if (snapshotStatus !== expectedSnapshotStatus) throw new UndoConflictError('These added items were already replayed.', UNDO_ALREADY_DONE_CODE)
  const guard = saleMutationGuard(`
    NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
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
    AND (${basketCondition}) AND (${lineage.condition})
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
        ...(hasRecordedSaleMoneyPrecision(reversal.moneyAfter) ? {moneyPrecisionVersion:1 as const,
          before:salePrecisionLedgerFields(reversal.moneyAfter),after:salePrecisionLedgerFields(reversal.moneyBefore)} : {}),
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
        ...(hasRecordedSaleMoneyPrecision(reversal.moneyAfter) ? {moneyPrecisionVersion:1 as const,
          before:salePrecisionLedgerFields(reversal.moneyBefore),after:salePrecisionLedgerFields(reversal.moneyAfter)} : {}),
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
      throw new UndoConflictError('This sale or added-items receipt changed. Nothing was reversed.', UNDO_RECORD_CHANGED_CODE)
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
  // products.name is NOT NULL: a snapshot without a usable name leaves it alone.
  const restoresName = typeof r.keeperNameBefore === 'string'
  const nameSet = restoresName ? 'name=@name,name_normalized=@nameNormalized,' : ''
  return {
    sql: `UPDATE products SET ${imageSet}${r.keeperBarcodeBefore !== undefined ? 'barcode=@barcode,' : ''}${nameSet}${catalogSet}updated_at=CURRENT_TIMESTAMP WHERE id=@keeperId`,
    params: {
      keeperId: Number(r.keeperId),
      ...(canChangeProductImages ? { path: r.keeperImagePathBefore ?? null } : {}),
      ...(r.keeperBarcodeBefore !== undefined ? { barcode: r.keeperBarcodeBefore } : {}),
      ...(restoresName ? { name: r.keeperNameBefore, nameNormalized: r.keeperNameNormalizedBefore ?? null } : {}),
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
  await assertStockLifecycleMutable(getDb(env), { productId: r.keeperId })
  await assertStockLifecycleMutable(getDb(env), { productId: r.dupId })
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
  // A snapshot without dupBarcodeBefore (every merge but a Resolve barcode swap) leaves the barcode alone.
  const restoresDupBarcode = r.dupBarcodeBefore !== undefined
  stmts.push({
    sql: `UPDATE products SET is_active = 1, ${restoresDupBarcode ? 'barcode = @dupBarcode, ' : ''}updated_at = CURRENT_TIMESTAMP WHERE id = @dupId`,
    params: { dupId, ...(restoresDupBarcode ? { dupBarcode: r.dupBarcodeBefore } : {}) },
  })
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

  // 4e. A chosen name was synced onto the survivor's history rows; the rows
  //     reparented above are back on the discarded id, so this touches only
  //     the survivor's own.
  const chosenName = r.keeperChoice?.fields?.name
  if (typeof r.keeperNameBefore === 'string' && typeof chosenName === 'string' && chosenName !== r.keeperNameBefore) {
    stmts.push(...productNameSnapshotStatements(keeperId, r.keeperNameBefore))
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

  // 8. U-cost (supervisor decision, 2026-09-25): the keeper's cost restored in
  //    step 1 is a snapshot, and re-pointing lots (step 6) fires no 0195
  //    trigger. Re-derive both rows from the lots they now hold, so a lot that
  //    sold out since the merge never counts again. No-op when already right.
  //    A group undo's intermediate step lands on its predecessor's post-merge
  //    row; productMergeGroupPredecessorTimestamps accepts the derived figure
  //    for the two cost columns (the lot restores above fire the triggers anyway).
  stmts.push(catalogCostRecomputeIfChangedStatement(keeperId))
  stmts.push(catalogCostRecomputeIfChangedStatement(dupId))

  return stmts
}

async function applyMergeReversal(
  env: Env, r: MergeReversal, canChangeProductImages = true, legacyGuard?: AtomicMergeStatement,
): Promise<void> {
  const db = getDb(env)
  const statements = await buildMergeReversalStatements(env, r, canChangeProductImages)
  if (!legacyGuard) {
    await db.batch(statements)
    return
  }
  // assertLegacyMergeUnchanged's in-batch twin runs first, inside the batch.
  try {
    await db.batch([legacyGuard, ...statements])
  } catch (error) {
    if (/JSON path error|product_merge_changed/i.test(String((error as Error)?.message ?? error))) {
      throw new UndoConflictError('These products changed while the merge was being undone, so the undo stopped before overwriting that change.', UNDO_RECORD_CHANGED_CODE)
    }
    throw error
  }
}

// Undo a whole bulk merge: replay each fold's reversal in REVERSE application
// order. Order matters -- a later fold in a group folded into batches an
// earlier fold had already moved onto the keeper, so peeling the newest fold
// first restores the keeper to the exact state the next-oldest reversal was
// captured against. Each reversal runs in its own batch (validating the two
// products still exist); a cleanup undo is a rare admin op, not a hot path.
async function applyBulkMergeReversal(
  env: Env, reversals: MergeReversal[], canChangeProductImages = true, legacyGuards?: AtomicMergeStatement[] | null,
): Promise<void> {
  for (let i = reversals.length - 1; i >= 0; i--) {
    await applyMergeReversal(env, reversals[i], canChangeProductImages, legacyGuards?.[i])
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
      r.keeperChoice,
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

// Staleness (FX-undo): a replay may only rewrite a lot that still carries the
// attribution the recorded action left on it. An undo expects every lot to
// still be attributed to the backfilled supplier under the name the action
// stamped (the snapshot's supplierName, which a redo keeps current) or the
// supplier's current name (a rename that carried to its lots re-stamps them --
// that is the same attribution); a redo expects every lot to still hold the
// prior attribution the undo restored. Anything else is a later edit (a batch
// edit, including one that changed only the lot's supplier name -- FX-undo2,
// R-undo C8 -- a supplier merge, another backfill) that the replay must refuse
// rather than overwrite. A lot that no longer exists counts as changed.
function supplierBackfillLotsJson(r: SupplierBackfillReversal): string {
  return JSON.stringify((r.lots || []).filter((l) => Number(l.id) > 0).map((l) => ({
    id: Number(l.id),
    prevSupplierId: l.prevSupplierId == null ? null : Number(l.prevSupplierId),
    prevSupplierName: l.prevSupplierName ?? null,
  })))
}

function supplierBackfillLotMatchesSql(direction: 'undo' | 'redo'): string {
  return direction === 'undo'
    ? `b.supplier_id IS @supplierId
       AND lower(trim(COALESCE(b.supplier_name, ''))) IN (lower(trim(COALESCE(@supplierName, ''))),
         (SELECT lower(trim(COALESCE(s.name, ''))) FROM suppliers s WHERE s.id = @supplierId))`
    : `b.supplier_id IS json_extract(l.value, '$.prevSupplierId')
       AND lower(trim(COALESCE(b.supplier_name, ''))) = lower(trim(COALESCE(json_extract(l.value, '$.prevSupplierName'), '')))`
}

function supplierBackfillStaleLotsParams(r: SupplierBackfillReversal): Record<string, unknown> {
  return { lots: supplierBackfillLotsJson(r), supplierId: Number(r.supplierId), supplierName: r.supplierName ?? null }
}

function supplierBackfillStaleLotsSql(direction: 'undo' | 'redo'): string {
  return `SELECT json_extract(l.value, '$.id') AS id FROM json_each(@lots) l
    WHERE NOT EXISTS (SELECT 1 FROM product_batches b
      WHERE b.id = json_extract(l.value, '$.id') AND ${supplierBackfillLotMatchesSql(direction)})`
}

async function assertSupplierBackfillLotsUnchanged(
  db: ReturnType<typeof getDb>, r: SupplierBackfillReversal, direction: 'undo' | 'redo',
): Promise<void> {
  const stale = await db.prepare(supplierBackfillStaleLotsSql(direction))
    .all<{ id: number }>(supplierBackfillStaleLotsParams(r))
  if (stale.length) {
    const noun = stale.length === 1 ? 'lot was' : 'lots were'
    throw new UndoConflictError(`${stale.length} ${noun} re-attributed after this change, so it can no longer be ${direction === 'undo' ? 'undone' : 'redone'} without overwriting that edit. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
  }
}

// In-batch twin of the check above: aborts the whole batch through a malformed
// JSON path (the ordinaryBusinessMaintenanceGuard mechanism) when any lot
// changed between the check and the write.
function supplierBackfillGuardStatement(r: SupplierBackfillReversal, direction: 'undo' | 'redo') {
  return {
    sql: `SELECT CASE WHEN NOT EXISTS (${supplierBackfillStaleLotsSql(direction)})
      THEN 1 ELSE json_extract('[1]', '$[supplier_backfill_lot_changed]') END AS supplier_backfill_guard`,
    params: supplierBackfillStaleLotsParams(r),
  }
}

async function runSupplierBackfillBatch(
  db: ReturnType<typeof getDb>, r: SupplierBackfillReversal, direction: 'undo' | 'redo',
  stmts: Array<{ sql: string; params: Record<string, unknown> }>,
): Promise<void> {
  if (!stmts.length) return
  try {
    await db.batch([supplierBackfillGuardStatement(r, direction), ...stmts])
  } catch (error) {
    if (/JSON path error|supplier_backfill_lot_changed/i.test(String((error as Error)?.message ?? error))) {
      throw new UndoConflictError(`A lot was re-attributed while this change was being ${direction === 'undo' ? 'undone' : 'redone'}. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
    }
    throw error
  }
}

// UNDO: restore each lot's exact prior attribution.
async function applySupplierBackfillUndo(env: Env, r: SupplierBackfillReversal): Promise<void> {
  const db = getDb(env)
  await assertSupplierBackfillLotsUnchanged(db, r, 'undo')
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: l.prevSupplierId == null ? null : Number(l.prevSupplierId), sname: l.prevSupplierName ?? null },
    }))
  await runSupplierBackfillBatch(db, r, 'undo', stmts)
}

// REDO: re-apply the supplier to the same lots, using the supplier's CURRENT
// canonical name (mirrors the forward action, which stamps the name at write
// time). Refuses if the supplier no longer exists -- guessing a name is worse.
async function applySupplierBackfillRedo(env: Env, r: SupplierBackfillReversal): Promise<string | null> {
  const db = getDb(env)
  const supplierId = Number(r.supplierId)
  const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get<{ id: number; name: string }>([supplierId])
  if (!supplier) throw new Error('That supplier no longer exists, so this attribution cannot be redone.')
  await assertSupplierBackfillLotsUnchanged(db, r, 'redo')
  const name = supplier.name
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: supplierId, sname: name },
    }))
  await runSupplierBackfillBatch(db, r, 'redo', stmts)
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
  // U-cost (0195): the on-hand triggers own a product's two USD cost columns.
  // Restoring a fold's lots re-derives them, so the post-undo check accepts
  // either the saved figure or the one derived from the lots now held (a
  // legacy after-image recorded the plan's merged cost, not the derivation).
  const derivedCostColumns = new Set(['cost_price_usd', 'purchase_price_usd'])
  const fieldGuard = (table: string, field: string, derivedCost: boolean) => {
    const saved = `json_extract(saved.value,'$.${field}')`
    return derivedCost && table === 'products' && derivedCostColumns.has(field)
      ? `(live."${field}" IS ${saved} OR live."${field}" IS (SELECT ${CATALOG_COST_DERIVE_SQL} FROM products WHERE products.id = live.id))`
      : `live."${field}" IS ${saved}`
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
        SELECT 1 FROM ${table} live WHERE ${joinBalanced((JSON.parse(shape) as string[])
          .map((field) => fieldGuard(table, field, omitTimestamp)), 'AND')}
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
    if (targetIds.some((id) => !currentRows.has(id))) throw new UndoConflictError('Missing current group merge timestamp provenance.', UNDO_RECORD_CHANGED_CODE)
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
    throw new UndoConflictError('An exact group reversal generation is required.', UNDO_HISTORY_STALE_CODE)
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
  if (generation !== expectedGeneration) throw new UndoConflictError('This group reversal generation is stale.', UNDO_HISTORY_STALE_CODE)
  const targetIndex = ctx.direction === 'undo' ? appliedCount - 1 : appliedCount
  if (targetIndex < 0 || targetIndex >= children.length) {
    throw new UndoConflictError(`This group merge is already ${ctx.direction === 'undo' ? 'reversed' : 'applied'}.`, UNDO_ALREADY_DONE_CODE)
  }
  const child = children[targetIndex]
  const final = ctx.direction === 'undo' ? targetIndex === 0 : targetIndex === children.length - 1
  const nextPrefixFingerprint = final
    ? await productMergeGroupPrefixFingerprint(groupSnapshot.review_id, groupSnapshot.group_key, groupSnapshot.child_snapshot_ids, generation + 1)
    : groupSnapshot.prefix_fingerprint
  if (ctx.direction === 'undo') {
    const currentGraphGuards: AtomicMergeStatement[] = []
    await assertMergeStateUnchanged(db, [child.reversal], child.reversal.mergedStateFingerprint, currentGraphGuards)
    const statements = await buildMergeReversalStatements(ctx.env, child.reversal, getActionTier(ctx.user, 'products', 'image') === 'full')
    const timestamps = productMergeGroupPredecessorTimestamps(child, children[targetIndex - 1])
    const completion = productMergeGroupCompletionStatements({
      direction: ctx.direction, user: ctx.user, historyId: Number(ctx.historyId), groupSnapshotId: pointer.snapshotId,
      groupSnapshot, association, child, generation, final, nextPrefixFingerprint,
    })
    statements.unshift(completion[0], ...currentGraphGuards, ...timestamps.before)
    statements.push(...timestamps.after, ...completion.slice(1))
    try { await db.batch(statements) } catch (error) {
      if (/malformed JSON|product_merge_group_guard|constraint/i.test(String(error))) {
        throw new UndoConflictError('This group merge changed concurrently. Nothing was reversed.', UNDO_RECORD_CHANGED_CODE)
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
      throw new UndoConflictError('The redone group child changed before its fingerprint was recorded.', UNDO_RECORD_CHANGED_CODE)
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
    throw new UndoConflictError('An exact product removal generation is required.', UNDO_HISTORY_STALE_CODE)
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
    throw new UndoConflictError('This product removal generation is stale.', UNDO_HISTORY_STALE_CODE)
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
  await assertStockLifecycleMutable(db, { productId: snapshot.plan.product_id })
  const transitionStamp = new Date().toISOString()
  const transitionRequestId = `${ctx.historyId}:${ctx.direction}:${expectedGeneration}`
  try {
    await db.batch(productRemoveReplayStatements({ snapshot, operation, direction: ctx.direction,
      historyId: Number(ctx.historyId), expectedGeneration, user: ctx.user, transitionStamp, transitionRequestId }))
  } catch (error) {
    if (stockLifecycleRefusal(error)) throw error
    if (/malformed JSON|product_remove_.*guard|constraint/i.test(String(error))) {
      throw new UndoConflictError('This removed product changed concurrently. Nothing was replayed.', UNDO_RECORD_CHANGED_CODE)
    }
    throw error
  }
  await broadcast(ctx.env, 'products', { action: ctx.direction === 'undo' ? 'restore' : 'delete', id: snapshot.plan.product_id })
  await broadcast(ctx.env, 'inventory', { action: 'update' })
  return { complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: expectedGeneration + 1 }
}

// branch.update records the PRE-edit fields as its undo payload and the
// POST-edit fields as its redo payload. The payload a replay is NOT running is
// therefore the state the row must still be in: an undo expects the redo
// payload's fields, a redo the undo payload's. Read from the history row
// itself, never from the request, and refused when it is missing.
async function branchReplayExpectedFields(
  db: ReturnType<typeof getDb>, id: number, ctx: UndoApplierContext,
): Promise<BranchWriteFields> {
  const refuse = () => new UndoConflictError('This branch edit has no recorded result to check against, so it cannot be replayed safely. Edit the branch directly instead.', UNDO_RECORD_CHANGED_CODE)
  if (!ctx.historyId) throw refuse()
  const row = await db.prepare('SELECT undo_payload, redo_payload FROM action_history WHERE id = ?')
    .get<{ undo_payload: string | null; redo_payload: string | null }>([ctx.historyId])
  const raw = row ? (ctx.direction === 'undo' ? row.redo_payload : row.undo_payload) : null
  let other: Record<string, unknown> | null = null
  try { other = raw ? JSON.parse(raw) as Record<string, unknown> : null } catch (_) { other = null }
  if (!other || other.applier !== 'branch.update' || Number(other.id) !== id
    || !other.fields || typeof other.fields !== 'object' || Array.isArray(other.fields)) {
    throw refuse()
  }
  return other.fields as BranchWriteFields
}

const APPLIERS: Record<string, UndoApplierDef> = {
  [CUSTOMER_GENDER_RESTORATION_KIND]: { permission: 'contacts', action: 'edit', run: replayCustomerGenderRestoration },
  // Scoped Set (lib/stockLotAdjustment.ts): the server replays the exact lot
  // and branch snapshots of one generation and refuses 409 when current stock
  // no longer equals the snapshot it would reverse from.
  'stock.quantity_set': {
    permission: 'inventory', action: 'adjust',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Stock correction history context is required.')
      const { replayStockLotSet } = await import('./stockLotAdjustment')
      await replayStockLotSet(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
  // N6 stock-in line edit (lib/stockInLineEdit.ts): same exact-snapshot
  // replay contract as the scoped Set above; a cost edit also needs the
  // cost-entry permission, checked inside the replay.
  'stock.session_line_edit': {
    permission: 'inventory', action: 'adjust',
    run: async (payload, ctx) => {
      if (!ctx.user || !ctx.historyId) throw new UndoConflictError('Stock-in line edit history context is required.')
      const { replayStockInLineEdit } = await import('./stockInLineEdit')
      await replayStockInLineEdit(ctx.env, ctx.user, ctx.direction, ctx.historyId, ctx.generation, payload)
    },
  },
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
        throw new UndoConflictError("This sale's status changed after the items were added, so this can no longer be undone safely. Adjust the sale directly instead.", UNDO_RECORD_CHANGED_CODE)
      }

      const atomicReversal = reversal as AtomicSaleAddItemsReversal
      const atomicReplay = (typeof payload.operation_id === 'string' && payload.operation_id.length > 0)
        || atomicReversal.operationId !== undefined
        || atomicReversal.saleStateRevision !== undefined
      if (atomicReplay) {
        await replayAtomicSaleAddItems(db, atomicReversal, snapshotId, snap.status, payload, ctx)
      } else if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new UndoConflictError('These added items have already been removed.', UNDO_ALREADY_DONE_CODE)
        const savedFingerprint = (reversal as SaleAddItemsReversal & { saleStateFingerprint?: string }).saleStateFingerprint
        if (savedFingerprint && !sameSaleStateFingerprint(await saleStateFingerprint(db, saleId),savedFingerprint)) {
          throw new UndoConflictError('This sale was edited after the items were added, so this can no longer be undone safely.', UNDO_RECORD_CHANGED_CODE)
        }
        // With or without a fingerprint, the state the undo overwrites is
        // derived from the snapshot and re-checked inside the batch.
        const saleGuard = await assertLegacySaleAddItemsUnchanged(db, reversal, 'undo')
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
          saleGuard,
          ...removal.statements,
          saleMoneyUpdateStatement(saleId, reversal.moneyBefore),
          ...(reversal.lineMoneyBefore
            ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyBefore)]
            : []),
          ...(reversal.lines || []).map((line) => amendmentEntryStatement({
            ...(hasRecordedSaleMoneyPrecision(reversal.moneyAfter) ? {moneyPrecisionVersion:1 as const,
              before:salePrecisionLedgerFields(reversal.moneyAfter),after:salePrecisionLedgerFields(reversal.moneyBefore)} : {}),
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
        ]).catch((error: unknown) => { throw legacySaleAddItemsRaceError(error, 'undo') })
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new UndoConflictError('These items are already on the sale; there is nothing to redo.', UNDO_ALREADY_DONE_CODE)
        // A redo writes moneyAfter over the sale, so it too must find the sale
        // exactly as the undo left it (R-undo C10: it was never checked).
        const saleGuard = await assertLegacySaleAddItemsUnchanged(db, reversal, 'redo')
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
        const leading = [
          saleGuard,
          { sql: 'DELETE FROM sale_bulk_guards', params: {} },
          ...residualGuards,
        ]
        const results = await db.batch([
          ...leading,
          ...plan.statements,
          saleMoneyUpdateStatement(saleId, reversal.moneyAfter),
          ...(reversal.lineMoneyAfter
            ? [saleLineKhrSnapshotStatement(saleId, reversal.lineMoneyAfter)]
            : []),
          ...plan.lines.map((line) => amendmentEntryStatement({
            ...(hasRecordedSaleMoneyPrecision(reversal.moneyAfter) ? {moneyPrecisionVersion:1 as const,
              before:salePrecisionLedgerFields(reversal.moneyBefore),after:salePrecisionLedgerFields(reversal.moneyAfter)} : {}),
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
        ]).catch((error: unknown) => { throw legacySaleAddItemsRaceError(error, 'redo') }) as Array<{ meta?: { last_row_id?: number } }>
        const saleItemIdByLine = plan.lines.map((_line, lineIndex) => {
          const statementIndex = leading.length + plan.saleItemStatementIndexByLine[lineIndex]
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
        // replaced. A saved fingerprint names those ids and the amendment
        // head, which this redo just moved, so it is re-taken too; kept as it
        // was, it could never match again and the next undo would be refused.
        const savedFingerprint = (reversal as SaleAddItemsReversal & { saleStateFingerprint?: string }).saleStateFingerprint
        const nextReversal: SaleAddItemsReversal & { saleStateFingerprint?: string } = {
          ...reversal,
          lines: (reversal.lines || []).map((line, lineIndex) => ({
            ...line,
            saleItemId: Number(saleItemIdByLine[lineIndex] || 0) || line.saleItemId,
          })),
          ...(savedFingerprint ? { saleStateFingerprint: await saleStateFingerprint(db, saleId) } : {}),
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
      const existing = await db.prepare(BRANCH_REPLAY_ROW_SQL).get<BranchReplayRow>([id])
      if (!existing) {
        throw new Error('The branch this action changed no longer exists, so it cannot be reversed.')
      }
      const fields = payload.fields && typeof payload.fields === 'object'
        ? (payload.fields as Record<string, unknown>)
        : {}
      // Staleness: the row must still hold what the recorded action left
      // behind -- the OTHER payload of this history row -- for every field
      // this replay restores, or a later edit would be silently overwritten.
      const expected = await branchReplayExpectedFields(db, id, ctx)
      const verb = ctx.direction === 'undo' ? 'undone' : 'redone'
      const stale = staleBranchReplayFields(existing, expected)
      if (stale.length) {
        throw new UndoConflictError(`This branch was edited after this change (${stale.join(', ')}), so it can no longer be ${verb} without overwriting that edit. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
      }
      const replayFields = completeBranchReplayFields(fields, existing)
      if (branchReplayDropsDefault(replayFields, existing)
        && !(await db.prepare(OTHER_CANONICAL_BRANCH_SQL).get<{ id: number }>([id]))) {
        throw new UndoConflictError(`This change cannot be ${verb}: it would leave no default branch. Nothing was changed.`, UNDO_NO_DEFAULT_BRANCH_CODE)
      }
      try {
        await db.batch([
          branchReplayStateGuardStatement(id, expected),
          ...branchUpdateStatements(id, replayFields, existing),
          ...branchReplayDefaultStatements(id, replayFields, existing),
        ])
      } catch (error) {
        // Every guard in this batch (identity, staleness, one default) aborts
        // through the same NOT NULL on branches.name.
        if (/NOT NULL constraint failed: branches\.name/i.test(String((error as Error)?.message ?? error))) {
          throw new UndoConflictError(`This branch changed while the change was being ${verb}. Nothing was changed.`, UNDO_RECORD_CHANGED_CODE)
        }
        throw error
      }
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

      assertMergeChoicePermissions([reversal], ctx.user)

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new UndoConflictError('This merge has already been undone.', UNDO_ALREADY_DONE_CODE)
        await assertMergeStateUnchanged(db, [reversal], reversal.mergedStateFingerprint)
        const canChangeImages = !!ctx.user && getActionTier(ctx.user, 'products', 'image') === 'full'
        const legacyGuards = await assertLegacyMergeUnchanged(db, [reversal], reversal.mergedStateFingerprint, canChangeImages)
        await applyMergeReversal(ctx.env, reversal, canChangeImages, legacyGuards?.[0])
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new UndoConflictError('This merge is already in place; there is nothing to redo.', UNDO_ALREADY_DONE_CODE)
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
          reversal.keeperChoice,
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
      assertMergeChoicePermissions(reversals, ctx.user)

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new UndoConflictError('This merge has already been undone.', UNDO_ALREADY_DONE_CODE)
        await assertMergeStateUnchanged(db, reversals, mergedStateFingerprint)
        const canChangeImages = !!ctx.user && getActionTier(ctx.user, 'products', 'image') === 'full'
        const legacyGuards = await assertLegacyMergeUnchanged(db, reversals, mergedStateFingerprint, canChangeImages)
        await applyBulkMergeReversal(ctx.env, reversals, canChangeImages, legacyGuards)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new UndoConflictError('This merge is already in place; there is nothing to redo.', UNDO_ALREADY_DONE_CODE)
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
        if (String(snap.status) !== 'applied') throw new UndoConflictError('This attribution has already been undone.', UNDO_ALREADY_DONE_CODE)
        await applySupplierBackfillUndo(ctx.env, reversal)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new UndoConflictError('This attribution is already in place; there is nothing to redo.', UNDO_ALREADY_DONE_CODE)
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
