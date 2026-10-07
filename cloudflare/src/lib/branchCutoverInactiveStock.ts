import type { D1Compat } from './db'
import { productsShareExactIdentity } from './productIdentity'
import { barcodeIdentityMatches, normalizeProductFuzzyName } from './productDetailRule'
import { BranchCutoverCapabilityError } from './branchCutoverCapture'

/**
 * Owner rulings 7 Oct 2026 (rehearsal F3): there is no such thing as disabled stock, and an inactive product is never reactivated.
 * An inactive product that holds stock on any of the four ledgers (products.stock_quantity, branch_stock, branch_batch_stock via
 * product_batches.variant_product_id, damaged_stock_lots) is dealt with before the first capture page, so the capture, the manifest
 * baseline and the end state all describe the same stock:
 *   - real stock (a branch row, a lot or a held unit) and EXACTLY ONE active twin (same identity: normalized name and barcode,
 *     lib/productIdentity.ts productsShareExactIdentity): the product is folded into the twin with the one merge path
 *     (routes/products.ts foldDuplicateProductInto: lots, branch rows, cost, allocations, movements, audit and undo records);
 *   - real stock and no twin or several: admission refuses and lists the product for the owner;
 *   - only the cached products.stock_quantity is non-zero (cache drift, no unit anywhere): the cache is recomputed from the
 *     ledgers (0) with one audit row.
 */
export type InactiveStockRow = { id: number; name: string | null; barcode: string | null; image_path: string | null
  cache: number; branch: number; lots: number; damaged: number; is_group?: number }
/** An owner-approved fold (7 Oct 2026): a pair the exact-identity rule cannot match (7091 "Stix-Angel Vibes" -> 1529 "Stix Angel Vibes"). */
export type ApprovedFold = { dup: number; keeper: number }
export const APPROVED_FOLD_NOTE = 'owner-approved fold 7 Oct 2026'
export type InactiveStockPlan = {
  cacheOnly: InactiveStockRow[]
  fold: Array<{ dup: InactiveStockRow; keeper: { id: number; name: string | null; barcode: string | null }; approved?: true }>
  refuse: Array<{ id: number; name: string | null; reason: string }>
}
/** The operator's list, validated for shape only (at most 50 distinct dup ids, each pair two different positive integers). */
export function parseApprovedFolds(value: unknown): ApprovedFold[] {
  if (value === undefined || value === null) return []
  const bad = () => new BranchCutoverCapabilityError('approved_folds_invalid')
  if (!Array.isArray(value) || value.length > 50) throw bad()
  const seen = new Set<number>()
  return value.map(item => {
    const pair = item as { dup?: unknown; keeper?: unknown } | null
    if (!pair || typeof pair !== 'object' || !Number.isSafeInteger(pair.dup) || !Number.isSafeInteger(pair.keeper) || Number(pair.dup) < 1 || Number(pair.keeper) < 1
      || pair.dup === pair.keeper || seen.has(Number(pair.dup))) throw bad()
    seen.add(Number(pair.dup))
    return { dup: Number(pair.dup), keeper: Number(pair.keeper) }
  })
}
export const INACTIVE_STOCK_CENSUS_SQL = `SELECT p.id,p.name,p.barcode,p.image_path,COALESCE(p.is_group,0) AS is_group,COALESCE(p.stock_quantity,0) AS cache,
    COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=p.id),0) AS branch,
    COALESCE((SELECT SUM(s.quantity) FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id),0) AS lots,
    COALESCE((SELECT SUM(quantity_remaining) FROM damaged_stock_lots WHERE product_id=p.id),0) AS damaged
  FROM products p WHERE p.is_active IS NOT 1 AND (COALESCE(p.stock_quantity,0)<>0
    OR EXISTS(SELECT 1 FROM branch_stock s WHERE s.product_id=p.id AND s.quantity<>0)
    OR EXISTS(SELECT 1 FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id AND s.quantity<>0)
    OR EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.product_id=p.id AND d.quantity_remaining<>0))
  ORDER BY p.id LIMIT 500`
/** SQL twin of the census for the guards: no inactive product holds stock on any ledger (the cache included). */
export const INACTIVE_STOCKED_ANYWHERE_SQL = `EXISTS(SELECT 1 FROM products p WHERE p.is_active IS NOT 1 AND (COALESCE(p.stock_quantity,0)<>0
    OR EXISTS(SELECT 1 FROM branch_stock s WHERE s.product_id=p.id AND s.quantity<>0)
    OR EXISTS(SELECT 1 FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id AND s.quantity<>0)
    OR EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.product_id=p.id AND d.quantity_remaining<>0)))`
const hasRealStock = (row: InactiveStockRow): boolean => Number(row.branch) !== 0 || Number(row.lots) !== 0 || Number(row.damaged) !== 0

/**
 * Why an approved pair is not acceptable, or null. The approval never loosens matching: it only names the pair, and the pair must still be the
 * same product by every rule that is safe to check -- the barcodes must not be two different real barcodes, and the fuzzy name key (case,
 * accents, punctuation, word order and duplicate words ignored) must be equal. The fuzzy key is never used to FIND a twin, only to confirm one.
 */
export function approvedFoldProblem(dup: { name: string | null; barcode: string | null },
  keeper: { id: number; name: string | null; barcode: string | null; is_active?: number; is_group?: number } | undefined): string | null {
  if (!keeper) return 'approved_keeper_missing'
  if (keeper.is_active !== 1) return 'approved_keeper_not_active'
  if (keeper.is_group) return 'approved_keeper_is_group'
  if (!barcodeIdentityMatches(dup.barcode, keeper.barcode)) return 'approved_barcode_differs'
  const dupKey = normalizeProductFuzzyName(dup.name)
  if (!dupKey || dupKey !== normalizeProductFuzzyName(keeper.name)) return 'approved_name_differs'
  return null
}

/**
 * An approved pair already done by THIS run: its run-keyed audit row exists (written before the fold, see applyInactiveStockPlan) and the dup
 * no longer holds stock. A crash between the fold's commit and the capture page's save re-plans on resume; without this the resume would
 * refuse a pair whose work is finished.
 */
export async function approvedFoldAlreadyDone(db: D1Compat, operationId: string, item: ApprovedFold): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS done FROM audit_logs WHERE action=@action AND entity='product' AND entity_id=@keeper
    AND json_extract(details,'$.operationId')=@operation AND json_extract(details,'$.dup')=@dup LIMIT 1`)
    .get<{ done: number }>({ action: BRANCH_CUTOVER_APPROVED_FOLD_ACTION, keeper: item.keeper, operation: operationId, dup: item.dup })
  return Boolean(row)
}

export async function readInactiveStockPlan(db: D1Compat, approved: ApprovedFold[] = [], operationId: string | null = null): Promise<InactiveStockPlan> {
  const rows = await db.prepare(INACTIVE_STOCK_CENSUS_SQL).all<InactiveStockRow>({})
  const plan: InactiveStockPlan = { cacheOnly: [], fold: [], refuse: [] }
  const approvalFor = new Map(approved.map(item => [item.dup, item.keeper]))
  const stocked = new Set(rows.filter(hasRealStock).map(row => Number(row.id)))
  for (const item of approved) {
    if (stocked.has(item.dup)) continue
    if (operationId && await approvedFoldAlreadyDone(db, operationId, item)) continue
    plan.refuse.push({ id: item.dup, name: null, reason: 'approved_dup_not_inactive_with_stock' })
  }
  if (!rows.length) return plan
  const active = await db.prepare('SELECT id,name,barcode,is_active,COALESCE(is_group,0) AS is_group FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0').all<{ id: number; name: string | null; barcode: string | null; is_active: number; is_group: number }>({})
  for (const row of rows) {
    // The guard (INACTIVE_STOCKED_ANYWHERE_SQL) counts an inactive group too, so the census must see it: a group is never folded or recomputed here.
    if (Number(row.is_group) === 1) { plan.refuse.push({ id: row.id, name: row.name, reason: 'inactive_group_product_holds_stock' }); continue }
    if (!hasRealStock(row)) { plan.cacheOnly.push(row); continue }
    const twins = active.filter(candidate => candidate.id !== row.id && productsShareExactIdentity(row, candidate))
    const approvedKeeperId = approvalFor.get(Number(row.id))
    if (twins.length === 1) {
      if (approvedKeeperId !== undefined && approvedKeeperId !== twins[0].id) plan.refuse.push({ id: row.id, name: row.name, reason: 'approved_keeper_conflicts_with_exact_twin' })
      else plan.fold.push({ dup: row, keeper: twins[0] })
    } else if (approvedKeeperId !== undefined) {
      const keeper = (await db.prepare('SELECT id,name,barcode,is_active,COALESCE(is_group,0) AS is_group FROM products WHERE id=@id').get<{ id: number; name: string | null; barcode: string | null; is_active: number; is_group: number }>({ id: approvedKeeperId })) ?? undefined
      const problem = twins.length > 1 ? 'several_active_twins' : approvedFoldProblem(row, keeper)
      if (problem) plan.refuse.push({ id: row.id, name: row.name, reason: problem })
      else plan.fold.push({ dup: row, keeper: keeper!, approved: true })
    } else plan.refuse.push({ id: row.id, name: row.name, reason: twins.length === 0 ? 'no_active_twin' : 'several_active_twins' })
  }
  return plan
}
export const inactiveStockPlanIsEmpty = (plan: InactiveStockPlan): boolean => !plan.cacheOnly.length && !plan.fold.length && !plan.refuse.length

export const BRANCH_CUTOVER_APPROVED_FOLD_ACTION = 'branch_cutover_approved_fold'
export const BRANCH_CUTOVER_INACTIVE_FOLD_ACTION = 'branch_cutover_inactive_fold'
export const BRANCH_CUTOVER_PREPARE_AUDIT_ACTION = 'branch_cutover_inactive_stock'
export const BRANCH_CUTOVER_CACHE_AUDIT_ACTION = 'recompute_stock_cache'
export type InactiveStockContext = { operationId: string; actorId: number; actorName: string | null }
/**
 * Runs the plan. `fold(dup, keeper)` is the product merge (injected: the Worker passes foldDuplicateProductInto; lib code never imports a
 * route). Idempotent by state: a crash after some folds re-reads the census and only does what is left. Every step writes an audit row
 * naming the run, so the step is journaled even though each fold is its own atomic batch with its own undo record.
 */
export async function applyInactiveStockPlan(db: D1Compat, plan: InactiveStockPlan, context: InactiveStockContext,
  fold: (dup: InactiveStockRow, keeper: { id: number; name: string | null }, approved: boolean) => Promise<void>): Promise<void> {
  for (const item of plan.fold) {
    // The run's record of this fold is written BEFORE the merge (idempotent per run + pair): a crash after the merge commits but before the
    // next save then resumes as "already done" (approvedFoldAlreadyDone), and the post-check excuses exactly the lots this record names.
    const lots = await db.prepare('SELECT id FROM product_batches WHERE variant_product_id=@dup ORDER BY id').all<{ id: number }>({ dup: item.dup.id })
    const action = item.approved ? BRANCH_CUTOVER_APPROVED_FOLD_ACTION : BRANCH_CUTOVER_INACTIVE_FOLD_ACTION
    await db.prepare(`INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
      SELECT @actor,@actorName,@action,'product',@keeper,@details,'products',@keeper
      WHERE NOT EXISTS(SELECT 1 FROM audit_logs WHERE action=@action AND entity='product' AND entity_id=@keeper
        AND json_extract(details,'$.operationId')=@operation AND json_extract(details,'$.dup')=@dup)`).run({ actor: context.actorId, actorName: context.actorName, action, keeper: item.keeper.id,
      operation: context.operationId, dup: item.dup.id,
      details: JSON.stringify({ operationId: context.operationId, ...(item.approved ? { note: APPROVED_FOLD_NOTE } : {}), dup: item.dup.id, dupName: item.dup.name, keeper: item.keeper.id,
        keeperName: item.keeper.name, batchIds: lots.map(lot => Number(lot.id)) }) })
    await fold(item.dup, item.keeper, item.approved === true)
  }
  for (const row of plan.cacheOnly) {
    const statements = [
      { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
        VALUES(@actor,@actorName,@action,'product',CAST(@id AS INTEGER),@details,'products',CAST(@id AS INTEGER))`,
      params: { actor: context.actorId, actorName: context.actorName, action: BRANCH_CUTOVER_CACHE_AUDIT_ACTION, id: row.id,
        details: JSON.stringify({ operationId: context.operationId, reason: 'branch cutover: cached stock of an inactive product with no stock on any ledger',
          before: { stock_quantity: row.cache }, after: { stock_quantity: 0 }, name: row.name }) } },
      { sql: `UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=@id),0),updated_at=CURRENT_TIMESTAMP
        WHERE id=@id AND is_active IS NOT 1`, params: { id: row.id } },
    ]
    await db.batch(statements)
  }
  if (!inactiveStockPlanIsEmpty(plan)) {
    await db.prepare(`INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id)
      VALUES(@actor,@actorName,@action,'branch_cutover',@operation,@details,'branch_cutovers',@operation)`).run({
      actor: context.actorId, actorName: context.actorName, action: BRANCH_CUTOVER_PREPARE_AUDIT_ACTION, operation: context.operationId,
      details: JSON.stringify({ operationId: context.operationId, folded: plan.fold.map(item => [item.dup.id, item.keeper.id, item.dup.branch, item.dup.lots, item.dup.damaged]),
        cacheRecomputed: plan.cacheOnly.map(row => [row.id, row.cache]) }) })
  }
}
