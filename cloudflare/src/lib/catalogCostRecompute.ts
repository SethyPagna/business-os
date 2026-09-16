import type { D1Compat } from './db'
import { resolveMergedCostDetail, type MergedCostOutlier } from './productDetailRule'

export type CatalogCostRecomputeResult = {
  productId: number
  before: { usd: number; khr: number }
  after: { usd: number; khr: number }
  changed: boolean
  outliers: MergedCostOutlier[]
}

/**
 * Recomputes `products.cost_price_usd` (and its mirrored `purchase_price_usd`
 * twin -- see mirrorCostFields in routes/inventory.ts) as the mean of the
 * DISTINCT non-zero costs across the product row's own ACTIVE lots
 * (`product_batches.is_active = 1`, `unit_cost_usd` column) -- see
 * resolveMergedCostDetail in productDetailRule.ts for the averaging/outlier
 * rule itself (owner ruling, 2026-09-04 and 2026-09-16: distinct non-zero
 * costs add together and divide by the count of DIFFERENT costs).
 *
 * KHR is never touched: product_batches carries unit_cost_usd only -- no lot
 * ever recorded a KHR unit cost (migration 0065 added the USD column;
 * nothing ever added a KHR twin, and routes/inventory.ts's own receipt wire
 * only ever asks for a USD unit cost, see explicitReceiptMoney4('Unit cost')
 * above its call site) -- so there is no per-lot KHR figure to average.
 * `cost_price_khr`/`purchase_price_khr` are left exactly as they were.
 *
 * PURELY lot-derived, deliberately NOT folding in the row's own currently
 * stored cost_price_usd as one more candidate to average:
 *   - Self-reference drift: once cost_price_usd is itself a derived mean,
 *     feeding it back into its own next average lets that mean count as a
 *     second "purchase" forever after, nudging every later recompute toward
 *     wherever it last landed instead of what the active lots actually cost.
 *   - "No real active-lot cost yet" (every active lot's unit_cost_usd is
 *     0/NULL -- e.g. this receipt was the row's first and was free goods)
 *     must not ZERO an existing manually-priced or previously-derived
 *     figure: resolveMergedCostDetail's own "0 is not recorded" rule already
 *     protects a MERGE's distinct-cost set from a stray 0, but it cannot
 *     protect a scalar it was never shown -- so this function checks for a
 *     real (nonzero) result itself before writing, and otherwise leaves
 *     cost_price_usd exactly as it was.
 *
 * Owner ruling (2026-09-16, verbatim): "check and make sure all the
 * actions add, edit, remove, set, etc... sessions, make sure if different
 * costs it adds and divide by number of different costs (excluding zero
 * and empty costs)". Every writer that records a NEW lot/batch cost
 * (inventory add-stock receipts -- routes/inventory.ts POST /adjust,
 * routes/batches.ts, and the unified stock-action commit in
 * stockActionCommit.ts) must call this afterwards so `products.cost_price_usd`
 * tracks what the shelf actually paid across every lot, not just whichever
 * receipt happened to write the scalar column last.
 *
 * Deliberately PRODUCT-ROW scoped, not name-group scoped: sibling child
 * rows (rows with a different REAL barcode) are different articles with
 * their own cost, and only a merge/fold (create/edit identity fold,
 * merge-duplicates) combines rows -- that is a separate writer with its
 * own resolveMergedCostDetail call over the rows being folded together.
 *
 * Also skipped by every caller for a receipt that just CREATED a brand-new
 * row: that row's INSERT already set its cost_price_usd from the operator's
 * own explicit entry (unlocked pricing.cost_usd, or the plain create form),
 * which is the catalog-cost decision for a row that never had one before.
 *
 * Remove/set/transfer/return never record a cost, so no writer calls this
 * for them -- and if a remove drains a product's last costed active lot,
 * the catalog cost is deliberately left as the last-known figure (what the
 * shelf paid historically), never reset to 0.
 */
export async function recomputeCatalogCost(db: D1Compat, productId: number): Promise<CatalogCostRecomputeResult | null> {
  const product = await db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id')
    .get<{ cost_price_usd: number | null; cost_price_khr: number | null }>({ id: productId })
  if (!product) return null

  const lots = await db.prepare(
    'SELECT unit_cost_usd FROM product_batches WHERE variant_product_id = @id AND is_active = 1',
  ).all<{ unit_cost_usd: number | null }>({ id: productId })

  const before = { usd: Number(product.cost_price_usd) || 0, khr: Number(product.cost_price_khr) || 0 }
  const { merged, outliers } = resolveMergedCostDetail(lots.map((lot) => ({ cost_price_usd: lot.unit_cost_usd })))

  // merged.cost_price_usd is 0 both when no lot carried a cost at all and
  // when every lot's cost was explicitly 0 (free goods) -- resolveMergedCostDetail
  // treats a 0 as "not recorded" either way. Either way, that is not real
  // data this function should act on: keep the existing figure.
  const derivedUsd = merged.cost_price_usd
  const after = { usd: derivedUsd && derivedUsd > 0 ? derivedUsd : before.usd, khr: before.khr }
  const changed = after.usd !== before.usd

  if (changed) {
    await db.prepare(`
      UPDATE products SET
        cost_price_usd = @usd, purchase_price_usd = @usd,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: productId, usd: after.usd })
  }

  return { productId, before, after, changed, outliers }
}

/**
 * SQL-statement twin of {@link recomputeCatalogCost}, for callers that must
 * keep the recompute INSIDE the same atomic `db.batch()` as the receipt it
 * follows, rather than as a separate write afterwards.
 *
 * stockSession.ts's commit captures a live "after"/"expected" postimage of
 * every touched product (see `captureReplayState` / `stockReplayStateSql`)
 * as the LAST statement of the same batch that writes the lots -- that
 * postimage is what undo/redo later re-reads the table against to detect a
 * concurrent change. A recompute that ran as a separate write AFTER that
 * batch committed would silently invalidate every later undo/redo of that
 * session (the live row would no longer match its own "expected" snapshot).
 * So for this one caller the recompute has to be a statement inside the
 * batch, ahead of the postimage capture, not a follow-up async call.
 *
 * Same averaging/outlier rule as resolveMergedCostDetail (distinct non-zero
 * `product_batches.unit_cost_usd` values for this product's active lots;
 * >COST_OUTLIER_RATIO apart keeps the dearest; otherwise the mean rounded to
 * 4 decimals), and the same "no real lot cost yet" guard: if every active
 * lot is 0/NULL, the CASE falls through to the column's own current value,
 * i.e. no zeroing. Mirrors purchase_price_usd exactly like the JS twin.
 */
export function catalogCostRecomputeStatement(productId: number): { sql: string; params: Record<string, unknown> } {
  const derive = `(SELECT CASE
      WHEN COUNT(*) = 0 THEN NULL
      WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost)
      ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4)
    END FROM (SELECT DISTINCT unit_cost_usd AS cost FROM product_batches
      WHERE variant_product_id = @productId AND is_active = 1
        AND unit_cost_usd IS NOT NULL AND unit_cost_usd <> 0))`
  return {
    sql: `UPDATE products SET
        cost_price_usd = COALESCE(${derive}, cost_price_usd),
        purchase_price_usd = COALESCE(${derive}, purchase_price_usd)
      WHERE id = @productId`,
    params: { productId },
  }
}
