import type { D1Compat } from './db'
import { productsShareExactIdentity } from './productIdentity'

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
  cache: number; branch: number; lots: number; damaged: number }
export type InactiveStockPlan = {
  cacheOnly: InactiveStockRow[]
  fold: Array<{ dup: InactiveStockRow; keeper: { id: number; name: string | null; barcode: string | null } }>
  refuse: Array<{ id: number; name: string | null; reason: 'no_active_twin' | 'several_active_twins' }>
}
export const INACTIVE_STOCK_CENSUS_SQL = `SELECT p.id,p.name,p.barcode,p.image_path,COALESCE(p.stock_quantity,0) AS cache,
    COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=p.id),0) AS branch,
    COALESCE((SELECT SUM(s.quantity) FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id),0) AS lots,
    COALESCE((SELECT SUM(quantity_remaining) FROM damaged_stock_lots WHERE product_id=p.id),0) AS damaged
  FROM products p WHERE p.is_active IS NOT 1 AND COALESCE(p.is_group,0)=0 AND (COALESCE(p.stock_quantity,0)<>0
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

export async function readInactiveStockPlan(db: D1Compat): Promise<InactiveStockPlan> {
  const rows = await db.prepare(INACTIVE_STOCK_CENSUS_SQL).all<InactiveStockRow>({})
  const plan: InactiveStockPlan = { cacheOnly: [], fold: [], refuse: [] }
  if (!rows.length) return plan
  const active = await db.prepare('SELECT id,name,barcode FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0').all<{ id: number; name: string | null; barcode: string | null }>({})
  for (const row of rows) {
    if (!hasRealStock(row)) { plan.cacheOnly.push(row); continue }
    const twins = active.filter(candidate => candidate.id !== row.id && productsShareExactIdentity(row, candidate))
    if (twins.length === 1) plan.fold.push({ dup: row, keeper: twins[0] })
    else plan.refuse.push({ id: row.id, name: row.name, reason: twins.length === 0 ? 'no_active_twin' : 'several_active_twins' })
  }
  return plan
}
export const inactiveStockPlanIsEmpty = (plan: InactiveStockPlan): boolean => !plan.cacheOnly.length && !plan.fold.length && !plan.refuse.length

export const BRANCH_CUTOVER_PREPARE_AUDIT_ACTION = 'branch_cutover_inactive_stock'
export const BRANCH_CUTOVER_CACHE_AUDIT_ACTION = 'recompute_stock_cache'
export type InactiveStockContext = { operationId: string; actorId: number; actorName: string | null }
/**
 * Runs the plan. `fold(dup, keeper)` is the product merge (injected: the Worker passes foldDuplicateProductInto; lib code never imports a
 * route). Idempotent by state: a crash after some folds re-reads the census and only does what is left. Every step writes an audit row
 * naming the run, so the step is journaled even though each fold is its own atomic batch with its own undo record.
 */
export async function applyInactiveStockPlan(db: D1Compat, plan: InactiveStockPlan, context: InactiveStockContext,
  fold: (dup: InactiveStockRow, keeper: { id: number; name: string | null }) => Promise<void>): Promise<void> {
  for (const item of plan.fold) await fold(item.dup, item.keeper)
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
