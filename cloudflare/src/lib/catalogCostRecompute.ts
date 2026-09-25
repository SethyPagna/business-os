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

// ---------------------------------------------------------------------------
// THE catalog-cost formula, as ONE SQL scalar expression. Every writer
// evaluates this exact text inside `UPDATE products ...` (via
// catalogCostRecomputeStatement / recomputeCatalogCost), so `products.id`
// below is the row being updated (a correlated reference). The pure breakdown
// (buildCatalogCostBreakdown) restates it in JS so each row can say why it
// counted; test-catalog-cost-on-hand-pure.cjs proves the two agree on a real
// migrated SQLite.
//
// The formula, in order:
//   1. Candidate set = the DISTINCT positive unit costs of this row's lots that
//      are active, received after the latest manual override's baseline, and
//      still ON HAND (some branch_batch_stock row with quantity > 0), UNIONed
//      with the latest manual cost entry when it is positive. Mean of that set
//      (owner rulings 2026-09-04 / 2026-09-16: "add and divide by number of
//      different costs"; 2026-09-17 override baseline).
//   2. Owner ruling (2026-09-25, KIKO 3D Lip Gloss 05): a lot whose remaining
//      quantity is 0 no longer takes part -- its cost described stock that is
//      gone. branch_batch_stock carries CHECK(quantity >= 0) (0058), so
//      "remaining > 0" is exactly "some branch row is positive", which the
//      partial index idx_branch_batch_stock_positive_batch_0155 serves.
//   3. Nothing on hand (sold out): the most recently RECEIVED such lot's cost
//      (received_at, then id -- the last row of the breakdown list). This is
//      the figure the formula held just before the last lot ran out under
//      FIFO, and unlike "whatever was stored last" it is a pure function of
//      the lots, so JS, SQL and a replayed undo can never disagree.
//   4. Still nothing: NULL -- callers COALESCE to the stored column, so a
//      free-goods or cost-less history never zeroes an existing figure.
// ---------------------------------------------------------------------------
const LATEST_MANUAL_ENTRY_ID_SQL = '(SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)'
// Owner correction (2026-09-17, verbatim): "edit can override cost so before
// might be (n+n1+n2)/3, after override just becomes n. this means if future
// add stock have different price it will take from this n then add the new
// cost price / by that number of cost price". baseline_batch_id is the highest
// product_batches.id that existed when the override was recorded; only lots
// ABOVE it count again. NULL (no manual entry) means every lot is eligible.
const LATEST_MANUAL_BASELINE_SQL = '(SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)'
const ELIGIBLE_LOT_SQL = `pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > ${LATEST_MANUAL_BASELINE_SQL} OR ${LATEST_MANUAL_BASELINE_SQL} IS NULL)`
const LOT_ON_HAND_SQL = 'EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0)'

export const CATALOG_COST_DERIVE_SQL = `COALESCE(
    (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4) END
      FROM (SELECT DISTINCT pb.unit_cost_usd AS cost FROM product_batches pb
        WHERE ${ELIGIBLE_LOT_SQL}
          AND ${LOT_ON_HAND_SQL}
        UNION
        SELECT pce.cost_usd AS cost FROM product_cost_entries pce
        WHERE pce.id = ${LATEST_MANUAL_ENTRY_ID_SQL}
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE ${ELIGIBLE_LOT_SQL}
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1))`

const CATALOG_COST_SET_SQL = `cost_price_usd = COALESCE(${CATALOG_COST_DERIVE_SQL}, cost_price_usd),
        purchase_price_usd = COALESCE(${CATALOG_COST_DERIVE_SQL}, purchase_price_usd)`

export type CatalogCostRecomputeResult = {
  productId: number
  before: { usd: number; khr: number }
  after: { usd: number; khr: number }
  changed: boolean
  outliers: MergedCostOutlier[]
}

/**
 * Re-derives `products.cost_price_usd` (and its mirrored `purchase_price_usd`
 * twin -- see mirrorCostFields in routes/inventory.ts) from the formula in
 * CATALOG_COST_DERIVE_SQL above, via the very same statement the batched
 * writers use, then reports before/after. No second JS formula to drift.
 *
 * KHR is never touched: product_batches carries unit_cost_usd only, so there
 * is no per-lot KHR figure to average.
 *
 * PURELY lot-derived (plus the latest manual override), deliberately NOT
 * folding in the row's own stored cost_price_usd as a candidate: once it is
 * itself a derived mean, feeding it back would let it count as a second
 * "purchase" forever after. When the formula has no positive input at all it
 * returns NULL and the stored figure is kept, never zeroed.
 *
 * Who keeps the stored figure current: receipts, lot cost edits, manual cost
 * edits, stock-session and import receipts call this (or
 * catalogCostRecomputeStatement) after writing the lot/entry. KNOWN GAP (U-cost,
 * 2026-09-25, owner decision pending): writers that only move a lot's ON-HAND
 * quantity across zero (sale, void, return restock, remove, set, transfer,
 * damage, undo) do not call it yet, so a lot that sells out keeps counting in
 * the STORED figure until that product's next receipt or cost edit.
 * Historical sale/return cost snapshots (sale_items.cost_price_usd) are copied
 * at sale time and are never rewritten by any of this.
 *
 * Deliberately PRODUCT-ROW scoped, not name-group scoped: sibling child rows
 * (a different REAL barcode) are different articles with their own cost.
 */
export async function recomputeCatalogCost(db: D1Compat, productId: number): Promise<CatalogCostRecomputeResult | null> {
  const readCost = () => db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id')
    .get<{ cost_price_usd: number | null; cost_price_khr: number | null }>({ id: productId })
  const product = await readCost()
  if (!product) return null
  const before = { usd: Number(product.cost_price_usd) || 0, khr: Number(product.cost_price_khr) || 0 }

  // Same formula as catalogCostRecomputeStatement, but writes (and stamps
  // updated_at) only when the figure actually moves, so an unchanged
  // recompute bumps no product revision -- the behaviour this entry point
  // always had.
  await db.prepare(`UPDATE products SET
        ${CATALOG_COST_SET_SQL},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @productId AND cost_price_usd IS NOT COALESCE(${CATALOG_COST_DERIVE_SQL}, cost_price_usd)`).run({ productId })
  const updated = await readCost()
  const after = { usd: Number(updated?.cost_price_usd) || 0, khr: before.khr }
  const changed = after.usd !== before.usd

  return { productId, before, after, changed, outliers: [] }
}

/**
 * SQL-statement form of {@link recomputeCatalogCost}, for callers that must
 * keep the recompute INSIDE the same atomic `db.batch()` as the receipt it
 * follows (stockSession.ts captures its undo postimage as the batch's last
 * statement, so a follow-up write would invalidate every later undo/redo).
 * The statement ends in a plain WHERE so callers may append `AND <guard>`.
 */
export function catalogCostRecomputeStatement(productId: number): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `UPDATE products SET
        ${CATALOG_COST_SET_SQL}
      WHERE id = @productId`,
    params: { productId },
  }
}

/**
 * P10-6 (owner ruling, 2026-09-16, verbatim): "when clicked on cost price it
 * opens a page that tells us the calculated cost price (n_i + n_{i+1} + ... +
 * n_{i+k}) / i". GET /api/products/:id/cost-breakdown (routes/productCost.ts)
 * shows exactly that arithmetic -- the SAME selection as
 * CATALOG_COST_DERIVE_SQL, restated in JS so each row can say why it did or
 * did not count. Parity is pinned by test-catalog-cost-on-hand-pure.cjs.
 */
export type CostBreakdownLotInput = {
  id: number
  batch_number: number | string | null
  lot_code: string | null
  received_at: string | null
  branch_name: string | null
  unit_cost_usd: number | null
  is_active: number | boolean | null
  /** SUM(branch_batch_stock.quantity) for this lot; null = no stock rows = nothing on hand. */
  remaining_quantity: number | null
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
  /** A lot's remaining on-hand quantity across branches; null on a manual row. */
  remaining_quantity: number | null
  /**
   * 'depleted': the lot has nothing left on hand, so its cost no longer
   * describes the shelf (owner, 2026-09-25). A depleted lot that is the
   * sold-out FALLBACK (nothing on hand at all) is reported as counted (null).
   */
  excluded: 'zero' | 'duplicate' | 'inactive' | 'superseded' | 'overridden' | 'depleted' | null
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

function positiveCost(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
}

/** Same order as CATALOG_COST_DERIVE_SQL's fallback: received_at, then id. */
function compareLotsByReceipt(a: CostBreakdownLotInput, b: CostBreakdownLotInput): number {
  // Binary string order, as SQLite compares TEXT -- not localeCompare.
  const left = String(a.received_at || ''), right = String(b.received_at || '')
  return left < right ? -1 : left > right ? 1 : a.id - b.id
}

/**
 * Pure assembler -- no D1 access, so it is unit-testable with fixture rows.
 * `product` carries the row's CURRENT stored cost_price_usd/khr, used only as
 * the last-resort `result_usd` when the formula has no positive input (the
 * same COALESCE the SQL writers apply) and as the (unformulaic) `result_khr`.
 *
 * `manualEntries` is EVERY manual cost-price edit for the product, shown for
 * the record -- only the LATEST participates, as an OVERRIDE BASELINE: only
 * lots received AFTER it (`id > baseline_batch_id`) join it in the mean.
 *
 * Row order: everything that describes stock on hand (lots with remaining > 0
 * and the manual entries) first, chronologically; depleted lots after them,
 * also chronologically -- the owner reads the list top-down as "what the
 * shelf holds", and sold-out history stays viewable underneath.
 */
export function buildCatalogCostBreakdown(
  productId: number,
  product: { cost_price_usd: number | null; cost_price_khr: number | null },
  lots: CostBreakdownLotInput[],
  manualEntries: CostBreakdownManualInput[] = [],
): CatalogCostBreakdown {
  const latestManualEntry = manualEntries.length
    ? manualEntries.reduce((latest, entry) => (entry.id > latest.id ? entry : latest))
    : null
  const baseline = latestManualEntry ? Number(latestManualEntry.baseline_batch_id) || 0 : null
  const isOnHand = (lot: CostBreakdownLotInput) => Number(lot.remaining_quantity) > 0
  const eligibleLots = lots.filter((lot) => !!lot.is_active
    && (baseline === null || lot.id > baseline)
    && positiveCost(lot.unit_cost_usd) !== null)

  const candidates = eligibleLots.filter(isOnHand).map((lot) => ({ cost_price_usd: lot.unit_cost_usd }))
  if (latestManualEntry) candidates.push({ cost_price_usd: latestManualEntry.cost_usd })
  const onHandMean = catalogCostMean(candidates)
  // Sold out: the most recently received eligible lot stands in (see step 3
  // of CATALOG_COST_DERIVE_SQL).
  const fallbackLot = onHandMean == null && eligibleLots.length
    ? [...eligibleLots].sort(compareLotsByReceipt)[eligibleLots.length - 1]
    : null

  type Combined = { kind: 'lot'; lot: CostBreakdownLotInput } | { kind: 'manual'; entry: CostBreakdownManualInput }
  const dateOf = (row: Combined) => (row.kind === 'lot' ? row.lot.received_at : row.entry.created_at) || ''
  const describesShelf = (row: Combined) => row.kind === 'manual' || isOnHand(row.lot)
  const chronological: Combined[] = [
    ...lots.map((lot): Combined => ({ kind: 'lot', lot })),
    ...manualEntries.map((entry): Combined => ({ kind: 'manual', entry })),
  ].sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
  const combined = [...chronological.filter(describesShelf), ...chronological.filter((row) => !describesShelf(row))]

  const seenDistinct = new Set<number>()
  const countOnce = (cost: number): 'duplicate' | null => {
    if (seenDistinct.has(cost)) return 'duplicate'
    seenDistinct.add(cost)
    return null
  }
  const inputs: CostBreakdownInputRow[] = combined.map((row) => {
    if (row.kind === 'lot') {
      const lot = row.lot
      const cost = lot.unit_cost_usd != null && Number.isFinite(Number(lot.unit_cost_usd)) ? Number(lot.unit_cost_usd) : null
      const base = {
        source: 'lot' as const, label: costBreakdownLotLabel(lot), cost_usd: cost, cost_khr: null,
        lot_code: lot.lot_code ?? null, batch_number: lot.batch_number != null ? Number(lot.batch_number) || null : null,
        received_at: lot.received_at ?? null, branch_name: lot.branch_name ?? null,
        user_name: null, recorded_at: null, remaining_quantity: Number(lot.remaining_quantity) || 0,
      }
      if (!lot.is_active) return { ...base, excluded: 'inactive' }
      if (baseline !== null && lot.id <= baseline) return { ...base, excluded: 'overridden' }
      if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
      if (!isOnHand(lot) && lot !== fallbackLot) return { ...base, excluded: 'depleted' }
      return { ...base, excluded: countOnce(cost) }
    }
    const entry = row.entry
    const cost = entry.cost_usd != null && Number.isFinite(Number(entry.cost_usd)) ? Number(entry.cost_usd) : null
    const base = {
      source: 'manual' as const, label: costBreakdownManualLabel(entry), cost_usd: cost, cost_khr: entry.cost_khr ?? null,
      previous_cost_usd: entry.previous_cost_usd ?? null,
      lot_code: null, batch_number: null, received_at: null, branch_name: null,
      user_name: entry.user_name ?? null, recorded_at: entry.created_at ?? null, remaining_quantity: null,
    }
    if (!latestManualEntry || entry.id !== latestManualEntry.id) return { ...base, excluded: 'superseded' }
    if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
    return { ...base, excluded: countOnce(cost) }
  })

  const distinctUsd = [...seenDistinct].sort((a, b) => a - b)
  const meanUsd = distinctUsd.length ? meanMoney4(distinctUsd) : 0
  const derivedUsd = onHandMean ?? positiveCost(fallbackLot?.unit_cost_usd)
  const resultUsd = derivedUsd != null ? derivedUsd : (Number(product.cost_price_usd) || 0)

  return {
    product_id: productId,
    inputs,
    distinct_usd: distinctUsd,
    distinct_khr: [],
    mean_usd: meanUsd,
    mean_khr: 0,
    outlier_guard: { fired: false, kept: null },
    result_usd: resultUsd,
    result_khr: Number(product.cost_price_khr) || 0,
  }
}

/** DB-backed wrapper: fetches the product row, every lot (active and inactive, for transparency) with its remaining on-hand quantity, and every manual cost-price entry, then assembles via {@link buildCatalogCostBreakdown}. */
export async function getCatalogCostBreakdown(db: D1Compat, productId: number): Promise<CatalogCostBreakdown | null> {
  const product = await db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id')
    .get<{ cost_price_usd: number | null; cost_price_khr: number | null }>({ id: productId })
  if (!product) return null

  const lots = await db.prepare(`
    SELECT pb.id, pb.batch_number, pb.lot_code, pb.received_at, pb.unit_cost_usd, pb.is_active, b.name AS branch_name,
      (SELECT COALESCE(SUM(bbs.quantity), 0) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id) AS remaining_quantity
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
