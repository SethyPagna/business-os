import type { D1Compat } from './db'
import { resolveMergedCostDetail, type MergedCostOutlier } from './productDetailRule'
import { meanMoney4 } from './moneyPrecision'

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

/**
 * P10-6 (owner ruling, 2026-09-16, verbatim): "when clicked on cost price it
 * opens a page that tells us the calculated cost price (n_i + n_{i+1} + ... +
 * n_{i+k}) / i". GET /api/products/:id/cost-breakdown (routes/productCost.ts)
 * shows exactly that arithmetic -- so this is the SAME selection
 * recomputeCatalogCost uses (every one of the product row's own lots,
 * `product_batches.variant_product_id = id`, not name-group scoped) fed
 * through the SAME resolveMergedCostDetail, never a second formula.
 */
export type CostBreakdownLotInput = {
  id: number
  batch_number: number | string | null
  lot_code: string | null
  received_at: string | null
  branch_name: string | null
  unit_cost_usd: number | null
  is_active: number | boolean | null
}

export type CostBreakdownInputRow = {
  source: 'lot' | 'catalog'
  label: string
  cost_usd: number | null
  cost_khr: number | null
  excluded: 'zero' | 'duplicate' | 'inactive' | null
}

export type CatalogCostBreakdown = {
  product_id: number
  inputs: CostBreakdownInputRow[]
  distinct_usd: number[]
  distinct_khr: number[]
  mean_usd: number
  mean_khr: number
  outlier_guard: { fired: boolean; kept: number | null }
  result_usd: number
  result_khr: number
}

/** The label a lot shows in the breakdown: batch code, else received date, else lot code -- with its branch appended when known. */
function costBreakdownLotLabel(lot: CostBreakdownLotInput): string {
  const core = lot.batch_number != null && lot.batch_number !== ''
    ? String(lot.batch_number)
    : (lot.received_at ? String(lot.received_at).slice(0, 10) : (lot.lot_code || `#${lot.id}`))
  return lot.branch_name ? `${core} · ${lot.branch_name}` : core
}

/**
 * Pure assembler -- no D1 access, so it is unit-testable with fixture rows.
 * `product` carries the row's CURRENT stored cost_price_usd/khr, used only as
 * the fallback `result_usd` when no active lot carries a real cost (mirrors
 * recomputeCatalogCost's own "no real lot cost yet" guard) and as the
 * (unformulaic) `result_khr` figure -- see the module doc on catalogCostRecompute:
 * product_batches carries no per-lot KHR column, so KHR is never averaged
 * here, only reported as the stored scalar.
 */
export function buildCatalogCostBreakdown(
  productId: number,
  product: { cost_price_usd: number | null; cost_price_khr: number | null },
  lots: CostBreakdownLotInput[],
): CatalogCostBreakdown {
  const activeLots = lots.filter((lot) => !!lot.is_active)
  const { merged, outliers } = resolveMergedCostDetail(activeLots.map((lot) => ({ cost_price_usd: lot.unit_cost_usd })))

  const seenDistinct = new Set<number>()
  const inputs: CostBreakdownInputRow[] = lots.map((lot) => {
    const label = costBreakdownLotLabel(lot)
    const cost = lot.unit_cost_usd != null && Number.isFinite(Number(lot.unit_cost_usd)) ? Number(lot.unit_cost_usd) : null
    if (!lot.is_active) return { source: 'lot', label, cost_usd: cost, cost_khr: null, excluded: 'inactive' }
    if (cost === null || cost <= 0) return { source: 'lot', label, cost_usd: cost, cost_khr: null, excluded: 'zero' }
    if (seenDistinct.has(cost)) return { source: 'lot', label, cost_usd: cost, cost_khr: null, excluded: 'duplicate' }
    seenDistinct.add(cost)
    return { source: 'lot', label, cost_usd: cost, cost_khr: null, excluded: null }
  })

  const distinctUsd = [...seenDistinct].sort((a, b) => a - b)
  const meanUsd = distinctUsd.length ? meanMoney4(distinctUsd) : 0
  const outlierFired = outliers.some((outlier) => outlier.field === 'cost_price_usd')
  const resultUsd = merged.cost_price_usd && merged.cost_price_usd > 0 ? merged.cost_price_usd : (Number(product.cost_price_usd) || 0)

  return {
    product_id: productId,
    inputs,
    distinct_usd: distinctUsd,
    distinct_khr: [],
    mean_usd: meanUsd,
    mean_khr: 0,
    outlier_guard: { fired: outlierFired, kept: outlierFired ? resultUsd : null },
    result_usd: resultUsd,
    result_khr: Number(product.cost_price_khr) || 0,
  }
}

/** DB-backed wrapper: fetches the product row and every lot (active and inactive, for transparency), then assembles via {@link buildCatalogCostBreakdown}. */
export async function getCatalogCostBreakdown(db: D1Compat, productId: number): Promise<CatalogCostBreakdown | null> {
  const product = await db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id')
    .get<{ cost_price_usd: number | null; cost_price_khr: number | null }>({ id: productId })
  if (!product) return null

  const lots = await db.prepare(`
    SELECT pb.id, pb.batch_number, pb.lot_code, pb.received_at, pb.unit_cost_usd, pb.is_active, b.name AS branch_name
    FROM product_batches pb
    LEFT JOIN branches b ON b.id = pb.received_branch_id
    WHERE pb.variant_product_id = @id
    ORDER BY pb.received_at ASC, pb.id ASC
  `).all<CostBreakdownLotInput>({ id: productId })

  return buildCatalogCostBreakdown(productId, product, lots || [])
}
