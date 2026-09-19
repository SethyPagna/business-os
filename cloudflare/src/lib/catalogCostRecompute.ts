import type { D1Compat } from './db'
import type { MergedCostOutlier } from './productDetailRule'
import { meanMoney4 } from './moneyPrecision'

// Catalog receipts are observed purchase prices, not an identity-merge
// heuristic. Every distinct positive recorded price contributes equally,
// even when prices differ by more than twofold. Do not change merge policy.
function catalogCostMean(rows: Array<{ cost_price_usd: number | null }>): number | null {
  const values = [...new Set(rows.flatMap(row => {
    const value = row.cost_price_usd
    return value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? [Number(value)] : []
  }))]
  return values.length ? meanMoney4(values) : null
}

// Shared by catalogCostRecomputeStatement (SQL) and getCatalogCostBreakdown
// (JS, via a plain SELECT): "the latest manual cost entry for this product,
// if it carries a real (non-zero) cost_usd" -- ONE definition of "latest",
// reused everywhere the formula needs it so the SQL and JS selections cannot
// drift apart. See recordManualCostEntry below for the writer.
const LATEST_MANUAL_COST_ENTRY_ID_SQL = '(SELECT id FROM product_cost_entries WHERE product_id = @productId ORDER BY id DESC LIMIT 1)'

// Owner correction (2026-09-17, verbatim): "edit can override cost so before
// might be (n+n1+n2)/3, after override just becomes n. this means if future
// add stock have different price it will take from this n then add the new
// cost price / by that number of cost price". The latest manual entry's
// baseline_batch_id is the highest product_batches.id that already existed
// when it was recorded -- a lot only counts again once its id is HIGHER than
// that baseline. NULL when this product has no manual entry at all (formula
// falls back to every active lot, unchanged). Same fragment reused by
// catalogCostRecomputeStatement's SQL and mirrored by the plain SELECT
// recomputeCatalogCost/buildCatalogCostBreakdown run for the same row.
const LATEST_MANUAL_COST_ENTRY_BASELINE_SQL = '(SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = @productId ORDER BY id DESC LIMIT 1)'

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
 * catalogCostMean above for the catalog-only averaging
 * rule (owner ruling, 2026-09-04 and 2026-09-16: distinct non-zero
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

  // The latest manual cost-price entry (routes/products.ts PUT /:id, via
  // recordManualCostEntry below) is an OVERRIDE BASELINE, not one more
  // candidate cost: older manual entries for this product are history only
  // and never feed back into the formula, and neither do lots received
  // BEFORE it (see product_cost_entries's own migration doc, 0177, and
  // LATEST_MANUAL_COST_ENTRY_BASELINE_SQL above).
  const latestManualEntry = await db.prepare(
    'SELECT cost_usd, baseline_batch_id FROM product_cost_entries WHERE product_id = @id ORDER BY id DESC LIMIT 1',
  ).get<{ cost_usd: number | null; baseline_batch_id: number | null }>({ id: productId })
  const baseline = latestManualEntry ? Number(latestManualEntry.baseline_batch_id) || 0 : null

  const lots = await db.prepare(
    'SELECT unit_cost_usd FROM product_batches WHERE variant_product_id = @id AND is_active = 1 AND (@baseline IS NULL OR id > @baseline)',
  ).all<{ unit_cost_usd: number | null }>({ id: productId, baseline })

  const before = { usd: Number(product.cost_price_usd) || 0, khr: Number(product.cost_price_khr) || 0 }
  const candidates = lots.map((lot) => ({ cost_price_usd: lot.unit_cost_usd }))
  if (latestManualEntry) candidates.push({ cost_price_usd: latestManualEntry.cost_usd })
  const derivedUsd = catalogCostMean(candidates)
  const outliers: MergedCostOutlier[] = []

  // No positive recorded input: keep the existing figure rather than
  // treating an absent or free-goods cost as an override.
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
 * Same catalog-only averaging rule as catalogCostMean (distinct non-zero
 * `product_batches.unit_cost_usd` values for this product's active lots
 * received AFTER the latest manual entry's baseline (see
 * LATEST_MANUAL_COST_ENTRY_BASELINE_SQL -- a lot before that baseline no
 * longer counts, an OVERRIDE, not one more input to average in), UNIONed
 * with the latest `product_cost_entries` row for this product (a manual
 * cost-price edit, see recordManualCostEntry) if it carries a real cost --
 * older manual entries never rejoin the set, same JS/SQL selection as
 * recomputeCatalogCost above; mean rounded to 4 decimals), and the same "no real lot cost
 * yet" guard: if every active lot (and the latest manual entry) is 0/NULL,
 * the CASE falls through to the column's own current value, i.e. no
 * zeroing. Mirrors purchase_price_usd exactly like the JS twin.
 */
export function catalogCostRecomputeStatement(productId: number): { sql: string; params: Record<string, unknown> } {
  const derive = `(SELECT CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4)
    END FROM (SELECT DISTINCT unit_cost_usd AS cost FROM product_batches
      WHERE variant_product_id = @productId AND is_active = 1
        AND unit_cost_usd IS NOT NULL AND unit_cost_usd > 0
        AND (id > ${LATEST_MANUAL_COST_ENTRY_BASELINE_SQL} OR ${LATEST_MANUAL_COST_ENTRY_BASELINE_SQL} IS NULL)
      UNION
      SELECT cost_usd AS cost FROM product_cost_entries
      WHERE id = ${LATEST_MANUAL_COST_ENTRY_ID_SQL}
        AND cost_usd IS NOT NULL AND cost_usd > 0))`
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

/** One manual cost-price edit (product_cost_entries row) -- see recordManualCostEntry. */
export type CostBreakdownManualInput = {
  id: number
  previous_cost_usd?: number | null
  cost_usd: number | null
  cost_khr: number | null
  user_name: string | null
  created_at: string | null
  /** The product_batches.id this entry overrode as of the edit -- see recordManualCostEntry/migration 0177. */
  baseline_batch_id: number | null
}

export type CostBreakdownInputRow = {
  source: 'lot' | 'manual' | 'catalog'
  previous_cost_usd?: number | null
  /** Kept for older clients: the existing "<batch> · <branch>" text (or "Manual · <user>" for a manual entry). */
  label: string
  lot_code: string | null
  batch_number: number | null
  received_at: string | null
  branch_name: string | null
  user_name: string | null
  recorded_at: string | null
  cost_usd: number | null
  cost_khr: number | null
  excluded: 'zero' | 'duplicate' | 'inactive' | 'superseded' | 'overridden' | null
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

/** The label a manual cost-price edit shows in the breakdown. */
function costBreakdownManualLabel(entry: CostBreakdownManualInput): string {
  return entry.user_name ? `Manual · ${entry.user_name}` : 'Manual'
}

/**
 * Pure assembler -- no D1 access, so it is unit-testable with fixture rows.
 * `product` carries the row's CURRENT stored cost_price_usd/khr, used only as
 * the fallback `result_usd` when no active lot/manual entry carries a real
 * cost (mirrors recomputeCatalogCost's own "no real lot cost yet" guard) and
 * as the (unformulaic) `result_khr` figure -- see the module doc on
 * catalogCostRecompute: product_batches carries no per-lot KHR column, so
 * KHR is never averaged here, only reported as the stored scalar.
 *
 * `manualEntries` is EVERY manual cost-price edit for the product (oldest
 * first), shown for the record -- but only the LATEST one participates in
 * the formula, same selection as recomputeCatalogCost/catalogCostRecomputeStatement,
 * and as an OVERRIDE BASELINE, not one more input: only active lots received
 * AFTER it (`id > latestManualEntry.baseline_batch_id`) join it in the mean.
 * Older manual entries are always reported `excluded: 'superseded'`; lots
 * from before the override are `excluded: 'overridden'`.
 */
export function buildCatalogCostBreakdown(
  productId: number,
  product: { cost_price_usd: number | null; cost_price_khr: number | null },
  lots: CostBreakdownLotInput[],
  manualEntries: CostBreakdownManualInput[] = [],
): CatalogCostBreakdown {
  const activeLots = lots.filter((lot) => !!lot.is_active)
  const latestManualEntry = manualEntries.length
    ? manualEntries.reduce((latest, entry) => (entry.id > latest.id ? entry : latest))
    : null
  const baseline = latestManualEntry ? Number(latestManualEntry.baseline_batch_id) || 0 : null
  const candidates = activeLots
    .filter((lot) => baseline === null || lot.id > baseline)
    .map((lot) => ({ cost_price_usd: lot.unit_cost_usd }))
  if (latestManualEntry) candidates.push({ cost_price_usd: latestManualEntry.cost_usd })
  const derivedUsd = catalogCostMean(candidates)

  // Lots and manual entries interleaved chronologically (manual entries,
  // newest last -- same as a lot list already ordered by received date).
  type Combined = { kind: 'lot'; lot: CostBreakdownLotInput } | { kind: 'manual'; entry: CostBreakdownManualInput }
  const dateOf = (row: Combined) => (row.kind === 'lot' ? row.lot.received_at : row.entry.created_at) || ''
  const combined: Combined[] = [
    ...lots.map((lot): Combined => ({ kind: 'lot', lot })),
    ...manualEntries.map((entry): Combined => ({ kind: 'manual', entry })),
  ].sort((a, b) => dateOf(a).localeCompare(dateOf(b)))

  const seenDistinct = new Set<number>()
  const inputs: CostBreakdownInputRow[] = combined.map((row) => {
    if (row.kind === 'lot') {
      const lot = row.lot
      const label = costBreakdownLotLabel(lot)
      const cost = lot.unit_cost_usd != null && Number.isFinite(Number(lot.unit_cost_usd)) ? Number(lot.unit_cost_usd) : null
      const base = {
        source: 'lot' as const, label, cost_usd: cost, cost_khr: null,
        lot_code: lot.lot_code ?? null, batch_number: lot.batch_number != null ? Number(lot.batch_number) || null : null,
        received_at: lot.received_at ?? null, branch_name: lot.branch_name ?? null,
        user_name: null, recorded_at: null,
      }
      if (!lot.is_active) return { ...base, excluded: 'inactive' }
      if (baseline !== null && lot.id <= baseline) return { ...base, excluded: 'overridden' }
      if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
      if (seenDistinct.has(cost)) return { ...base, excluded: 'duplicate' }
      seenDistinct.add(cost)
      return { ...base, excluded: null }
    }
    const entry = row.entry
    const label = costBreakdownManualLabel(entry)
    const cost = entry.cost_usd != null && Number.isFinite(Number(entry.cost_usd)) ? Number(entry.cost_usd) : null
    const base = {
      source: 'manual' as const, label, cost_usd: cost, cost_khr: entry.cost_khr ?? null,
      previous_cost_usd: entry.previous_cost_usd ?? null,
      lot_code: null, batch_number: null, received_at: null, branch_name: null,
      user_name: entry.user_name ?? null, recorded_at: entry.created_at ?? null,
    }
    if (!latestManualEntry || entry.id !== latestManualEntry.id) return { ...base, excluded: 'superseded' }
    if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
    if (seenDistinct.has(cost)) return { ...base, excluded: 'duplicate' }
    seenDistinct.add(cost)
    return { ...base, excluded: null }
  })

  const distinctUsd = [...seenDistinct].sort((a, b) => a - b)
  const meanUsd = distinctUsd.length ? meanMoney4(distinctUsd) : 0
  const outlierFired = false
  const resultUsd = derivedUsd != null ? derivedUsd : (Number(product.cost_price_usd) || 0)

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

/** DB-backed wrapper: fetches the product row, every lot (active and inactive, for transparency) and every manual cost-price entry, then assembles via {@link buildCatalogCostBreakdown}. */
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

  const manualEntries = await db.prepare(`
    SELECT id, cost_usd, cost_khr, previous_cost_usd, user_name, created_at, baseline_batch_id
    FROM product_cost_entries
    WHERE product_id = @id
    ORDER BY id ASC
  `).all<CostBreakdownManualInput>({ id: productId })

  return buildCatalogCostBreakdown(productId, product, lots || [], manualEntries || [])
}

/**
 * Records a manual cost-price edit (routes/products.ts PUT /:id -- the ONLY
 * writer, see product_cost_entries's own migration doc, 0177) whenever the
 * request body carries `cost_price_usd` and/or `cost_price_khr` AND the
 * resulting stored value actually differs from what was there before
 * (exact nullable values after productWrites applies its precision policy).
 * Never round the historical preimage or conflate NULL with zero here.
 * A same-value resave (the editor re-POSTs the whole
 * form on every save) must not create a fresh history row.
 *
 * `before`/`after` are the product's OWN before/after cost figures (the
 * caller reads `before` from the row prior to its own `updateRow`, and
 * passes the row's next values as `after` -- for the field(s) the body did
 * not carry, `after` is simply `before`, so an edit that only ever touched
 * cost_price_khr still records the unmoved cost_price_usd as `cost_usd`,
 * which is NOT NULL on this table).
 *
 * Owner correction (2026-09-17, verbatim): "edit can override cost so before
 * might be (n+n1+n2)/3, after override just becomes n. this means if future
 * add stock have different price it will take from this n then add the new
 * cost price / by that number of cost price". So this write also captures
 * `baseline_batch_id` -- the highest `product_batches.id` that already
 * exists for this product right now, i.e. the boundary below which every
 * existing lot is superseded by this override and above which a future
 * receipt joins this figure in the mean again (see
 * LATEST_MANUAL_COST_ENTRY_BASELINE_SQL above and the formula in
 * recomputeCatalogCost/catalogCostRecomputeStatement/buildCatalogCostBreakdown).
 * 0 when the product has no lots yet.
 *
 * Returns the inserted row's id, or null when nothing changed (no entry
 * written). Callers are expected to follow a successful insert with
 * {@link recomputeCatalogCost} so the new manual figure immediately joins
 * the formula, same as a fresh lot would.
 */
export function planManualCostEntry(
  productId: number,
  before: { cost_price_usd: number | null; cost_price_khr: number | null },
  body: Record<string, unknown>,
  actor: { id: number | null; name: string | null },
): { sql: string; params: Record<string, unknown> } | null {
  const hasUsd = Object.prototype.hasOwnProperty.call(body, 'cost_price_usd')
  const hasKhr = Object.prototype.hasOwnProperty.call(body, 'cost_price_khr')
  if (!hasUsd && !hasKhr) return null

  // The caller supplies the exact guarded preimage and already-normalized
  // values actually written to products (including preserved legacy precision).
  const canonicalCost = (value: unknown): number | null => {
    if (value == null) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Expected a canonical nullable cost')
    return value
  }
  const beforeUsd = canonicalCost(before.cost_price_usd)
  const beforeKhr = canonicalCost(before.cost_price_khr)
  const afterUsd = hasUsd ? canonicalCost(body.cost_price_usd) : beforeUsd
  const afterKhr = hasKhr ? canonicalCost(body.cost_price_khr) : beforeKhr
  const changed = (hasUsd && afterUsd !== beforeUsd) || (hasKhr && afterKhr !== beforeKhr)
  if (!changed) return null

  return { sql: `
    INSERT INTO product_cost_entries (product_id, cost_usd, cost_khr, previous_cost_usd, source, user_id, user_name, baseline_batch_id)
    VALUES (@productId, @costUsd, @costKhr, @previousCostUsd, 'manual', @userId, @userName,
      (SELECT COALESCE(MAX(id),0) FROM product_batches WHERE variant_product_id=@productId))
  `, params: { productId, costUsd: afterUsd ?? 0, costKhr: hasKhr ? afterKhr : null,
    previousCostUsd: before.cost_price_usd, userId: actor.id, userName: actor.name } }
}

export async function recordManualCostEntry(
  db: D1Compat,
  productId: number,
  before: { cost_price_usd: number | null; cost_price_khr: number | null },
  body: Record<string, unknown>,
  actor: { id: number | null; name: string | null },
): Promise<number | null> {
  const plan = planManualCostEntry(productId, before, body, actor)
  if (!plan) return null
  const result = await db.prepare(plan.sql).run(plan.params)

  const insertedId = Number(result?.lastInsertRowid ?? NaN)
  return Number.isFinite(insertedId) && insertedId > 0 ? insertedId : null
}
