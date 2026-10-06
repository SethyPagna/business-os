import type { D1Compat } from './db'
import type { MergedCostOutlier } from './productDetailRule'
import { weightedMeanMoney4 } from './moneyPrecision'

// Historical label (owner rule: old records are never relabelled): the row's own branch-name snapshot
// when it has a non-blank one, else the live directory name. The SAME expression as
// branchHistoryNameSql in lib/stockInSessionsQuery.ts; test-cutover-ld-historical-readers-native.cjs pins every copy.
const branchHistoryNameSql = (snapshot: string, fallback: string): string =>
  `CASE WHEN trim(COALESCE(${snapshot},''),char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))<>'' THEN ${snapshot} ELSE ${fallback} END`

// Catalog receipts are observed purchase prices, not an identity-merge
// heuristic. Owner ruling (2026-09-25, superseding the distinct-cost mean):
// the catalog cost is the QUANTITY-WEIGHTED mean of what is on the shelf,
// SUM(on-hand qty x unit cost) / SUM(on-hand qty), e.g. 2 left at 12.00 and 8
// left at 12.50 -> 12.40. Nearest 4dp, half away from zero (the existing cost
// rule; weightedMeanMoney4 rounds once, from the unrounded numerator).
function weightedCatalogCost(terms: Array<{ cost: number; quantity: number }>): number | null {
  const counted = terms.filter(term => term.quantity > 0 && term.cost > 0)
  if (!counted.length) return null
  const totalQuantity = counted.reduce((sum, term) => sum + term.quantity, 0)
  return weightedMeanMoney4(counted.map(term => ({ amount: term.cost, factor: term.quantity })), totalQuantity)
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
// The formula, in order (owner ruling 2026-09-25, quantity-weighted):
//   1. Terms = every lot of this row that is active, has a RECORDED unit cost
//      (> 0 -- a 0 means "not recorded" and is left out of BOTH numerator and
//      denominator), was received after the latest manual override's baseline,
//      and is ON HAND, weighted by its on-hand quantity summed over every
//      branch; plus the latest manual cost entry when positive, weighted by
//      the on-hand quantity of the lots it overrode (active lots at or below
//      its baseline -- the stock the owner re-priced; 2026-09-17 override
//      baseline). Result = SUM(qty x cost) / SUM(qty), nearest 4dp.
//   2. A lot whose remaining quantity is 0 no longer takes part (owner,
//      2026-09-25, KIKO 3D Lip Gloss 05). branch_batch_stock carries
//      CHECK(quantity >= 0) (0058), so the positive rows are the on-hand ones.
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
const LOT_ON_HAND_QTY_SQL = '(SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0)'
const OVERRIDDEN_ON_HAND_QTY_SQL = `(SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0)`
// Nearest 4dp, half away from zero -- weightedMeanMoney4, which rounds the
// exact decimal quotient. SQLite's ROUND() rounds the binary double, so an
// exact tie (1.0001 and 1.0002, one each: 1.00015) can land either side
// depending on the engine version. Every input here is positive, so this
// adds the half and truncates, with a 1e-8-unit nudge: with 4dp costs a
// non-tie quotient sits at least 1/(2 x total quantity) units from a tie,
// far above double error and far above the nudge.
const HALF_UP_4DP = (value: string) => `CAST(${value} * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0`

export const CATALOG_COST_DERIVE_SQL = `COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN ${HALF_UP_4DP('SUM(qty * cost) / SUM(qty)')} END
      FROM (SELECT pb.unit_cost_usd AS cost, ${LOT_ON_HAND_QTY_SQL} AS qty FROM product_batches pb
        WHERE ${ELIGIBLE_LOT_SQL}
        UNION ALL
        SELECT pce.cost_usd AS cost, ${OVERRIDDEN_ON_HAND_QTY_SQL} AS qty FROM product_cost_entries pce
        WHERE pce.id = ${LATEST_MANUAL_ENTRY_ID_SQL}
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE ${ELIGIBLE_LOT_SQL}
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1))`

const CATALOG_COST_SET_SQL = `cost_price_usd = COALESCE(${CATALOG_COST_DERIVE_SQL}, cost_price_usd),
        purchase_price_usd = COALESCE(${CATALOG_COST_DERIVE_SQL}, purchase_price_usd)`

/**
 * True only when the formula would move EITHER stored column; NULL keeps both.
 * purchase_price_usd mirrors cost_price_usd, and a path that restores only
 * cost_price_usd (merge undo's keeper restore) must not leave the mirror on a
 * figure a trigger wrote in between. The derivation is evaluated once.
 */
const CATALOG_COST_CHANGED_SQL = `EXISTS (SELECT 1 FROM (SELECT ${CATALOG_COST_DERIVE_SQL} AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived))`

/**
 * The write-only-when-it-moves recompute, with `products.id` constrained by
 * `idPredicateSql` (e.g. `id = @productId`). ONE text shared by the JS entry
 * point, the undo paths, the 0195 triggers and the 0195 one-time repair, so an
 * unchanged figure never bumps a product revision or updated_at on any path.
 *
 * `stampUpdatedAt: false` (the triggers and the repair) writes ONLY the two
 * cost columns (owner, 2026-09-25: the migration touches nothing else). Under
 * the weighted rule a partial sale of a mixed-cost product moves the figure,
 * so stamping updated_at there would turn every such sale into an optimistic-
 * concurrency conflict for an editor open on the product; the 0124 revision
 * trigger still fires on the UPDATE, so sessions and caches see the change.
 */
export function catalogCostRecomputeIfChangedSql(idPredicateSql: string, { stampUpdatedAt = true }: { stampUpdatedAt?: boolean } = {}): string {
  return `UPDATE products SET
        ${CATALOG_COST_SET_SQL}${stampUpdatedAt ? `,
        updated_at = CURRENT_TIMESTAMP` : ''}
      WHERE ${idPredicateSql} AND ${CATALOG_COST_CHANGED_SQL}`
}

/** Statement form of the guarded recompute, for a caller's atomic batch. */
export function catalogCostRecomputeIfChangedStatement(productId: number): { sql: string; params: Record<string, unknown> } {
  return { sql: catalogCostRecomputeIfChangedSql('id = @productId'), params: { productId } }
}

const RESTORE_MODE_OFF_SQL = "NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')"

/**
 * The 0195 triggers (U-cost, supervisor decision 2026-09-25): the stored figure
 * is weighted by the ON-HAND quantity of each lot, and ~40 statements across
 * sale, void, return, transfer, removal, damage, set and undo move it. The
 * database re-derives instead, firing ONLY when:
 *   - a branch_batch_stock row's quantity changes, it is inserted positive, is
 *     deleted while positive, or is re-pointed at another lot. The guarded
 *     UPDATE then writes only when the figure moves: a product whose on-hand
 *     lots all share one cost, or a completed transfer (each lot's total is
 *     unchanged), writes nothing.
 *   - a lot (product_batches row) is inserted or deleted -- the sold-out
 *     fallback reads the newest lot, and a delete must name the product
 *     through OLD because the row is already gone.
 * Only the two cost columns are written (no updated_at, see
 * catalogCostRecomputeIfChangedSql). Only ACTIVE product rows are re-derived: a removed or merged-away row is
 * frozen history whose undo receipts compare it column for column, and it is
 * never sold. Stands down in backup-restore mode, like the 0124 revision
 * triggers.
 * test-migration-0195-on-hand-cost-pure.cjs pins the migration text to this.
 */
export function catalogCostOnHandTriggerSql(): string {
  const lotProducts = (ids: string) => `is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (${ids}))`
  const trigger = (name: string, event: string, when: string, idPredicate: string) => `CREATE TRIGGER ${name}
${event}
WHEN ${when}
 AND ${RESTORE_MODE_OFF_SQL}
BEGIN
  ${catalogCostRecomputeIfChangedSql(idPredicate, { stampUpdatedAt: false })};
END;
`
  return [
    trigger('catalog_cost_on_hand_stock_insert_0195', 'AFTER INSERT ON branch_batch_stock',
      'COALESCE(NEW.quantity, 0) > 0', lotProducts('NEW.batch_id')),
    trigger('catalog_cost_on_hand_stock_update_0195', 'AFTER UPDATE OF quantity, batch_id ON branch_batch_stock',
      '(COALESCE(OLD.quantity, 0) <> COALESCE(NEW.quantity, 0) OR OLD.batch_id IS NOT NEW.batch_id)',
      lotProducts('OLD.batch_id, NEW.batch_id')),
    trigger('catalog_cost_on_hand_stock_delete_0195', 'AFTER DELETE ON branch_batch_stock',
      'COALESCE(OLD.quantity, 0) > 0', lotProducts('OLD.batch_id')),
    trigger('catalog_cost_on_hand_lot_insert_0195', 'AFTER INSERT ON product_batches',
      'NEW.variant_product_id IS NOT NULL', 'is_active = 1 AND id = NEW.variant_product_id'),
    trigger('catalog_cost_on_hand_lot_delete_0195', 'AFTER DELETE ON product_batches',
      'OLD.variant_product_id IS NOT NULL', 'is_active = 1 AND id = OLD.variant_product_id'),
  ].join('\n')
}

/** The 0195 one-time repair: every ACTIVE product whose stored figure the formula moves. */
export function catalogCostRepairAllSql(): string {
  return `${catalogCostRecomputeIfChangedSql('is_active = 1', { stampUpdatedAt: false })};\n`
}

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
 * catalogCostRecomputeStatement) after writing the lot/entry. Writers that only
 * move a lot's ON-HAND quantity across zero (sale, void, return restock,
 * remove, set, transfer, damage, undo) are covered by the 0195 triggers
 * (catalogCostOnHandTriggerSql below), and the undo paths that restore a
 * product snapshot re-derive afterwards so a stale cost never wins.
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
  await db.prepare(catalogCostRecomputeIfChangedSql('id = @productId')).run({ productId })
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
 * n_{i+k}) / i". Since 2026-09-25 the arithmetic is quantity-weighted
 * (q_1 x n_1 + ... + q_k x n_k) / (q_1 + ... + q_k), and each row carries its
 * weight and share. GET /api/products/:id/cost-breakdown (routes/productCost.ts)
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
   * The quantity this row weighs in the average: a counted lot's on-hand
   * quantity, or for the latest manual override the on-hand quantity of the
   * lots it re-priced. 0 on a row that does not count. (Owner, 2026-09-25.)
   */
  weight_quantity: number
  /** weight_quantity / the total weight, 0..1; null when the row does not weigh in. */
  share: number | null
  /** The sold-out fallback: nothing is on hand, so the newest received lot's cost stands in. */
  fallback: boolean
  /**
   * 'depleted': nothing left on hand, so the cost no longer describes the
   * shelf (owner, 2026-09-25). 'duplicate' is retained for older payloads
   * only -- under the weighted rule every on-hand lot counts.
   */
  excluded: 'zero' | 'duplicate' | 'inactive' | 'superseded' | 'overridden' | 'depleted' | null
}

export type CatalogCostBreakdown = {
  product_id: number
  inputs: CostBreakdownInputRow[]
  /** The weighted terms, in row order: SUM(quantity x cost_usd) / SUM(quantity). */
  weighted_terms: Array<{ cost_usd: number; quantity: number }>
  /** SUM of weighted_terms' quantity; 0 when nothing is on hand. */
  weighted_quantity: number
  /** Legacy readers: the distinct counted costs. Not the calculation. */
  distinct_usd: number[]
  distinct_khr: number[]
  /** The weighted mean (or the fallback lot's cost), 0 when there is neither. */
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
 * the record -- only the LATEST participates, as an OVERRIDE BASELINE: lots at
 * or below its baseline stop counting at their own cost and their on-hand
 * quantity is counted at the override's cost instead; lots received after it
 * count at their own cost. Same selection as CATALOG_COST_DERIVE_SQL.
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
  const onHandOf = (lot: CostBreakdownLotInput) => Math.max(0, Number(lot.remaining_quantity) || 0)
  const isOnHand = (lot: CostBreakdownLotInput) => onHandOf(lot) > 0
  const eligibleLots = lots.filter((lot) => !!lot.is_active
    && (baseline === null || lot.id > baseline)
    && positiveCost(lot.unit_cost_usd) !== null)
  const manualCost = latestManualEntry ? positiveCost(latestManualEntry.cost_usd) : null
  // The stock the latest override re-priced: active lots at or below its baseline.
  const overriddenOnHand = latestManualEntry && manualCost !== null
    ? lots.filter((lot) => !!lot.is_active && lot.id <= (baseline ?? 0)).reduce((sum, lot) => sum + onHandOf(lot), 0)
    : 0

  const lotWeight = new Map<CostBreakdownLotInput, number>(eligibleLots.filter(isOnHand).map((lot) => [lot, onHandOf(lot)]))
  const terms: Array<{ cost: number; quantity: number }> = [...lotWeight].map(([lot, quantity]) => ({ cost: Number(lot.unit_cost_usd), quantity }))
  if (manualCost !== null && overriddenOnHand > 0) terms.push({ cost: manualCost, quantity: overriddenOnHand })
  const weightedMean = weightedCatalogCost(terms)
  const totalWeight = weightedMean === null ? 0 : terms.reduce((sum, term) => sum + term.quantity, 0)
  // Sold out: the most recently received eligible lot stands in (see step 3
  // of CATALOG_COST_DERIVE_SQL).
  const fallbackLot = weightedMean === null && eligibleLots.length
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

  const shareOf = (quantity: number) => (totalWeight > 0 ? quantity / totalWeight : null)
  const weightedTerms: Array<{ cost_usd: number; quantity: number }> = []
  const inputs: CostBreakdownInputRow[] = combined.map((row) => {
    if (row.kind === 'lot') {
      const lot = row.lot
      const cost = lot.unit_cost_usd != null && Number.isFinite(Number(lot.unit_cost_usd)) ? Number(lot.unit_cost_usd) : null
      const base = {
        source: 'lot' as const, label: costBreakdownLotLabel(lot), cost_usd: cost, cost_khr: null,
        lot_code: lot.lot_code ?? null, batch_number: lot.batch_number != null ? Number(lot.batch_number) || null : null,
        received_at: lot.received_at ?? null, branch_name: lot.branch_name ?? null,
        user_name: null, recorded_at: null, remaining_quantity: Number(lot.remaining_quantity) || 0,
        weight_quantity: 0, share: null, fallback: false,
      }
      if (!lot.is_active) return { ...base, excluded: 'inactive' }
      if (baseline !== null && lot.id <= baseline) return { ...base, excluded: 'overridden' }
      if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
      if (lot === fallbackLot) return { ...base, fallback: true, excluded: null }
      const quantity = lotWeight.get(lot)
      if (quantity === undefined) return { ...base, excluded: 'depleted' }
      weightedTerms.push({ cost_usd: cost, quantity })
      return { ...base, weight_quantity: quantity, share: shareOf(quantity), excluded: null }
    }
    const entry = row.entry
    const cost = entry.cost_usd != null && Number.isFinite(Number(entry.cost_usd)) ? Number(entry.cost_usd) : null
    const base = {
      source: 'manual' as const, label: costBreakdownManualLabel(entry), cost_usd: cost, cost_khr: entry.cost_khr ?? null,
      previous_cost_usd: entry.previous_cost_usd ?? null,
      lot_code: null, batch_number: null, received_at: null, branch_name: null,
      user_name: entry.user_name ?? null, recorded_at: entry.created_at ?? null, remaining_quantity: null,
      weight_quantity: 0, share: null, fallback: false,
    }
    if (!latestManualEntry || entry.id !== latestManualEntry.id) return { ...base, excluded: 'superseded' }
    if (cost === null || cost <= 0) return { ...base, excluded: 'zero' }
    // Every unit the override re-priced has been sold: it prices nothing now.
    if (overriddenOnHand <= 0) return { ...base, excluded: 'depleted' }
    weightedTerms.push({ cost_usd: cost, quantity: overriddenOnHand })
    return { ...base, weight_quantity: overriddenOnHand, share: shareOf(overriddenOnHand), excluded: null }
  })

  const fallbackCost = positiveCost(fallbackLot?.unit_cost_usd)
  const derivedUsd = weightedMean ?? fallbackCost
  const resultUsd = derivedUsd != null ? derivedUsd : (Number(product.cost_price_usd) || 0)
  const distinctUsd = [...new Set(weightedTerms.map((term) => term.cost_usd).concat(fallbackCost !== null ? [fallbackCost] : []))].sort((a, b) => a - b)

  return {
    product_id: productId,
    inputs,
    weighted_terms: weightedTerms,
    weighted_quantity: totalWeight,
    distinct_usd: distinctUsd,
    distinct_khr: [],
    mean_usd: derivedUsd ?? 0,
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
    SELECT pb.id, pb.batch_number, pb.lot_code, pb.received_at, pb.unit_cost_usd, pb.is_active, ${branchHistoryNameSql('pb.received_branch_name', 'b.name')} AS branch_name,
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

/**
 * A cost typed or imported through a path OTHER than the product form (the
 * catalog-wide bulk price adjust, a product/inventory import, an approved
 * review-queue edit). The 0195 triggers re-derive products.cost_price_usd at
 * every stock movement, and the derivation only honours a cost that has a
 * product_cost_entries row -- so a bare `UPDATE products SET cost_price_usd`
 * holds only until the next sale. This records the SAME row the form's
 * planManualCostEntry records (source 'manual', the actor, the baseline =
 * the product's highest lot id right now, previous_cost_usd, cost_khr only
 * when the write carries KHR, cost_usd NULL -> 0), and only when the write
 * actually moves a cost column, so a same-value re-import writes nothing.
 *
 * Set-based and evaluated against the PREIMAGE: run it in the same atomic
 * batch IMMEDIATELY BEFORE the UPDATE, with `nextUsdSql`/`nextKhrSql` the
 * exact expressions (or bound params) that UPDATE writes, or null for a
 * column it leaves alone. Unqualified columns in them resolve to `products`.
 * Binds @costEntryUserId / @costEntryUserName (costEntryActorParams).
 */
export function typedCostEntriesBeforeWriteSql(input: { nextUsdSql: string | null; nextKhrSql: string | null; whereSql: string }): string {
  const { nextUsdSql, nextKhrSql, whereSql } = input
  const moved = [
    nextUsdSql && `(${nextUsdSql}) IS NOT products.cost_price_usd`,
    nextKhrSql && `(${nextKhrSql}) IS NOT products.cost_price_khr`,
  ].filter(Boolean)
  if (!moved.length) throw new Error('typedCostEntriesBeforeWriteSql needs at least one cost column')
  return `INSERT INTO product_cost_entries (product_id, cost_usd, cost_khr, previous_cost_usd, source, user_id, user_name, baseline_batch_id)
    SELECT products.id, COALESCE(${nextUsdSql ?? 'products.cost_price_usd'}, 0), ${nextKhrSql ?? 'NULL'}, products.cost_price_usd,
      'manual', @costEntryUserId, @costEntryUserName,
      (SELECT COALESCE(MAX(pb.id), 0) FROM product_batches pb WHERE pb.variant_product_id = products.id)
    FROM products
    WHERE (${whereSql}) AND (${moved.join(' OR ')})`
}

export function costEntryActorParams(actor: { id: number | null; name: string | null }): Record<string, unknown> {
  return { costEntryUserId: actor.id ?? null, costEntryUserName: actor.name ?? null }
}

/**
 * One product row's form of typedCostEntriesBeforeWriteSql: `usd`/`khr` are
 * the values the following UPDATE binds (undefined = that UPDATE does not
 * write the column). Null when neither column is written.
 */
export function typedCostEntryBeforeWriteStatement(
  productId: number,
  next: { usd?: number | null; khr?: number | null },
  actor: { id: number | null; name: string | null },
): { sql: string; params: Record<string, unknown> } | null {
  const hasUsd = next.usd !== undefined
  const hasKhr = next.khr !== undefined
  if (!hasUsd && !hasKhr) return null
  return {
    sql: typedCostEntriesBeforeWriteSql({
      nextUsdSql: hasUsd ? '@costEntryUsd' : null,
      nextKhrSql: hasKhr ? '@costEntryKhr' : null,
      whereSql: 'products.id = @costEntryProductId',
    }),
    params: {
      costEntryProductId: productId,
      ...(hasUsd ? { costEntryUsd: next.usd } : {}),
      ...(hasKhr ? { costEntryKhr: next.khr } : {}),
      ...costEntryActorParams(actor),
    },
  }
}

/**
 * The after-write form, for a writer that cannot place a statement before its
 * own UPDATE (updateRow on a plan-less historical review-queue row): compares
 * the row NOW against the preimage the caller read before writing.
 */
export function typedCostEntryAfterWriteStatement(
  productId: number,
  before: { cost_price_usd: number | null; cost_price_khr: number | null },
  written: { usd: boolean; khr: boolean },
  actor: { id: number | null; name: string | null },
): { sql: string; params: Record<string, unknown> } | null {
  if (!written.usd && !written.khr) return null
  const moved = [
    written.usd && 'products.cost_price_usd IS NOT @costEntryBeforeUsd',
    written.khr && 'products.cost_price_khr IS NOT @costEntryBeforeKhr',
  ].filter(Boolean)
  return {
    sql: `INSERT INTO product_cost_entries (product_id, cost_usd, cost_khr, previous_cost_usd, source, user_id, user_name, baseline_batch_id)
    SELECT products.id, COALESCE(products.cost_price_usd, 0), ${written.khr ? 'products.cost_price_khr' : 'NULL'}, @costEntryBeforeUsd,
      'manual', @costEntryUserId, @costEntryUserName,
      (SELECT COALESCE(MAX(pb.id), 0) FROM product_batches pb WHERE pb.variant_product_id = products.id)
    FROM products
    WHERE products.id = @costEntryProductId AND (${moved.join(' OR ')})`,
    params: {
      costEntryProductId: productId,
      costEntryBeforeUsd: before.cost_price_usd ?? null,
      costEntryBeforeKhr: before.cost_price_khr ?? null,
      ...costEntryActorParams(actor),
    },
  }
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
