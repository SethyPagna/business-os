// Family-aware stock stats -- companion to familyPagination.ts.
//
// Why this exists: paginateProductFamilies made every product LISTING treat
// a grouped product (parent_id family) as ONE item for paging purposes. But
// three separate stats surfaces -- Dashboard's summary tile (compat.ts
// dashboardSummary), Inventory's /bootstrap stats block, and Inventory's
// /stats endpoint -- all kept computing total_products/in_stock/low_stock/
// out_of_stock as a plain `COUNT(*) FROM products`, counting every variant
// row separately (and even counting group-header placeholder rows, which
// aren't sellable products at all -- the same exclusion the dead
// lib/businessMetrics.ts applied in its own sellableProductWhere, and never
// to these three live endpoints; that file is gone, this helper is the one
// place it lives now). Net effect: any catalog with grouped/variant
// products shows a bigger "total products" on Dashboard/Inventory stat
// cards than the pagination footer on the listing right below them, and
// stakeholders comparing the two pages get two different answers to
// "how many products do we have".
//
// This helper re-derives those same four counts (+ stock quantity/value)
// the same way paginateProductFamilies derives `total`: group rows into
// families by FAMILY_ROOT_KEY_SQL (name_key, see familyPagination.ts --
// NAME is the grouping axis, not parent_id), one row per family toward the
// count. Stock status is then rolled up per family using a documented
// "best status wins" rule -- a family counts as in_stock if ANY member has
// healthy stock, low_stock if none are healthy but at least one still has
// some (low) stock, and out_of_stock only if EVERY member is out. This
// mirrors the same "any variant in stock counts as in stock" logic POS's
// product-card badge already uses for grouped products, extended with the
// low tier for stats' finer-grained buckets. Group-header placeholder rows
// (is_group=1 AND parent_id=0) are excluded from the stock classification
// itself (they typically hold no real stock and would otherwise drag a
// healthy family down to "out of stock"), with a fallback to including them
// if a family somehow has no other members, so a family is never dropped
// from the count entirely.
import type { D1Compat } from './db'
import { FAMILY_ROOT_KEY_SQL } from './familyPagination'
import { lowStockThresholdSql, type LowStockConfig } from './lowStockSettings'

export interface FamilyStockStatsOptions {
  db: D1Compat
  // The owner's low-stock switch/amount/scope (lowStockSettings.ts), read
  // once per request by the route. REQUIRED rather than defaulted on purpose:
  // this one helper feeds the Dashboard tile, the Inventory stats block and
  // the Branches stats, and a default here is exactly how one of those three
  // would go on counting by the old hardcoded 10 while the list beside it
  // counted by the owner's number.
  lowStock: LowStockConfig
  // Extra JOINs beyond the family self-join this helper already adds
  // (e.g. a branch_stock join used by filters). Must only reference `p.`.
  joinSql: string
  // Full `WHERE ...` clause (including the `WHERE` keyword), referencing
  // only `p.` columns.
  whereSql: string
  // Named params for joinSql/whereSql (translated via `@name` -> D1 bind).
  params: Record<string, unknown>
  // SQL expression for a row's quantity, e.g. 'COALESCE(p.stock_quantity, 0)'
  // or a branch-scoped 'COALESCE(selected_bs.quantity, 0)'.
  qtyExpr: string
}

export interface FamilyStockStats {
  total_products: number
  in_stock: number
  healthy: number
  low_stock: number
  out_of_stock: number
  stock_quantity: number
  stock_value_usd: number
  stock_value_khr: number
}

export type FamilyStockAlertState = 'low' | 'out'

export interface FamilyStockAlertRow {
  id: number
  name: string | null
  category: string | null
  unit: string | null
  stock_quantity: number
  low_stock_threshold: number | null
  out_of_stock_threshold: number | null
  family_stock_quantity: number
  family_size: number
}

export interface FamilyStockAlertPage {
  items: FamilyStockAlertRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasMore: boolean
}

export async function getFamilyStockStats(opts: FamilyStockStatsOptions): Promise<FamilyStockStats> {
  const { db, joinSql, whereSql, params, qtyExpr, lowStock } = opts
  // Alerts off yields '-1' here, so `qty <= low_threshold` matches nothing and
  // `qty > low_threshold` matches everything: the low_stock bucket empties into
  // healthy without this query growing a branch, and out_of_stock is untouched.
  const lowThresholdSql = lowStockThresholdSql(lowStock, 'p.low_stock_threshold')
  const row = await db.prepare(`
    WITH matched AS (
      SELECT
        ${FAMILY_ROOT_KEY_SQL} AS family_root_id,
        COALESCE(p.is_group, 0) AS is_group,
        COALESCE(p.parent_id, 0) AS parent_id,
        ${qtyExpr} AS qty,
        COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
        ${lowThresholdSql} AS low_threshold,
        COALESCE(p.cost_price_usd, 0) AS unit_cost_usd,
        COALESCE(p.cost_price_khr, 0) AS unit_cost_khr
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${joinSql}
      ${whereSql}
    ),
    non_header_families AS (
      SELECT DISTINCT family_root_id FROM matched WHERE NOT (is_group = 1 AND parent_id = 0)
    ),
    members AS (
      SELECT m.* FROM matched m
      WHERE NOT (m.is_group = 1 AND m.parent_id = 0)
         OR m.family_root_id NOT IN (SELECT family_root_id FROM non_header_families)
    ),
    family_agg AS (
      SELECT
        family_root_id,
        MAX(CASE WHEN qty > out_threshold AND qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,
        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,
        SUM(qty) AS total_qty,
        SUM(MAX(qty, 0) * unit_cost_usd) AS value_usd,
        SUM(MAX(qty, 0) * unit_cost_khr) AS value_khr
      FROM members
      GROUP BY family_root_id
    )
    SELECT
      COUNT(*) AS total_products,
      -- 'in_stock' is "any positive stock" (healthy OR low) -- matches the
      -- row-level 'in_stock'/'positive' stock-state filter every other
      -- route already uses (appendInventoryProductFilters in this same
      -- file, routes/branches.ts's own stockState handling, POS/Products/
      -- Inventory's shared 'in_stock' filter option): qty above the
      -- out-of-stock threshold, full stop, no upper bound. Previously this
      -- column was 'has_healthy = 1' alone -- silently the *strict* subset
      -- (now split out as its own 'healthy' column below), which meant the
      -- in_stock number on every stat card that reads this (Dashboard,
      -- Inventory, Branches) undercounted relative to what clicking the
      -- "In Stock" filter pill actually returned directly below it.
      COALESCE(SUM(CASE WHEN has_healthy = 1 OR has_low = 1 THEN 1 ELSE 0 END), 0) AS in_stock,
      -- Strict subset of in_stock, above the low-stock threshold -- the
      -- distinct "Healthy" bucket the stats cards were missing (everything
      -- in_stock that ISN'T also counted in low_stock below).
      COALESCE(SUM(CASE WHEN has_healthy = 1 THEN 1 ELSE 0 END), 0) AS healthy,
      COALESCE(SUM(CASE WHEN has_healthy = 0 AND has_low = 1 THEN 1 ELSE 0 END), 0) AS low_stock,
      COALESCE(SUM(CASE WHEN has_healthy = 0 AND has_low = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
      COALESCE(SUM(total_qty), 0) AS stock_quantity,
      COALESCE(SUM(value_usd), 0) AS stock_value_usd,
      COALESCE(SUM(value_khr), 0) AS stock_value_khr
    FROM family_agg
  `).get<Record<string, number>>(params)

  return {
    total_products: Number(row?.total_products || 0),
    in_stock: Number(row?.in_stock || 0),
    healthy: Number(row?.healthy || 0),
    low_stock: Number(row?.low_stock || 0),
    out_of_stock: Number(row?.out_of_stock || 0),
    stock_quantity: Number(row?.stock_quantity || 0),
    stock_value_usd: Number(row?.stock_value_usd || 0),
    stock_value_khr: Number(row?.stock_value_khr || 0),
  }
}

/**
 * Pages one representative row per low/out family using the same
 * best-status-wins classification as getFamilyStockStats. Filtering raw
 * product rows first would incorrectly report a low variant from a family
 * that also has a healthy variant, so classification happens before paging.
 */
export async function getFamilyStockAlertPage(opts: {
  db: D1Compat
  lowStock: LowStockConfig
  state: FamilyStockAlertState
  page: number
  pageSize: number
}): Promise<FamilyStockAlertPage> {
  const { db, lowStock, state } = opts
  const page = Math.max(1, Math.trunc(opts.page) || 1)
  const pageSize = Math.max(1, Math.trunc(opts.pageSize) || 1)
  const offset = (page - 1) * pageSize
  const lowThresholdSql = lowStockThresholdSql(lowStock, 'p.low_stock_threshold')
  const eligibleSql = state === 'low'
    ? 'has_healthy = 0 AND has_low = 1'
    : 'has_healthy = 0 AND has_low = 0'
  const ctes = `
    WITH matched AS (
      SELECT
        ${FAMILY_ROOT_KEY_SQL} AS family_root_id,
        p.id, p.name, p.category, p.unit,
        COALESCE(p.stock_quantity, 0) AS qty,
        p.low_stock_threshold,
        p.out_of_stock_threshold,
        COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
        ${lowThresholdSql} AS low_threshold,
        COALESCE(p.is_group, 0) AS is_group,
        COALESCE(p.parent_id, 0) AS parent_id
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      WHERE p.is_active = 1
    ),
    non_header_families AS (
      SELECT DISTINCT family_root_id FROM matched WHERE NOT (is_group = 1 AND parent_id = 0)
    ),
    members AS (
      SELECT m.* FROM matched m
      WHERE NOT (m.is_group = 1 AND m.parent_id = 0)
         OR m.family_root_id NOT IN (SELECT family_root_id FROM non_header_families)
    ),
    family_agg AS (
      SELECT
        family_root_id,
        MIN(lower(trim(COALESCE(name, '')))) AS family_name,
        MIN(qty) AS minimum_qty,
        SUM(qty) AS total_qty,
        COUNT(*) AS family_size,
        MAX(CASE WHEN qty > out_threshold AND qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,
        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low
      FROM members
      GROUP BY family_root_id
    ),
    eligible AS (
      SELECT * FROM family_agg WHERE ${eligibleSql}
    )
  `
  const params = {
    __familyOffset: offset,
    __familyOffsetEnd: offset + pageSize,
    __alertState: state,
  }
  const totalRow = await db.prepare(`${ctes} SELECT COUNT(*) AS count FROM eligible`).get<{ count: number }>(params)
  const total = Number(totalRow?.count || 0)
  const items = await db.prepare(`
    ${ctes},
    ranked AS (
      SELECT family_root_id,
             ROW_NUMBER() OVER (ORDER BY minimum_qty ASC, family_name ASC, family_root_id ASC) AS family_rank
      FROM eligible
    ),
    representatives AS (
      SELECT m.*,
             ROW_NUMBER() OVER (
               PARTITION BY m.family_root_id
               ORDER BY
                 CASE
                   WHEN @__alertState = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0
                   WHEN @__alertState = 'out' AND m.qty <= m.out_threshold THEN 0
                   ELSE 1
                 END ASC,
                 m.qty ASC, lower(trim(COALESCE(m.name, ''))) ASC, m.id ASC
             ) AS representative_rank
      FROM members m
      JOIN eligible e ON e.family_root_id = m.family_root_id
    )
    SELECT
      r.id, r.name, r.category, r.unit,
      r.qty AS stock_quantity,
      r.low_stock_threshold,
      r.out_of_stock_threshold,
      e.total_qty AS family_stock_quantity,
      e.family_size
    FROM representatives r
    JOIN eligible e ON e.family_root_id = r.family_root_id
    JOIN ranked ON ranked.family_root_id = r.family_root_id
    WHERE r.representative_rank = 1
      AND ranked.family_rank > @__familyOffset
      AND ranked.family_rank <= @__familyOffsetEnd
    ORDER BY ranked.family_rank ASC
  `).all<FamilyStockAlertRow>(params)
  const normalizedItems = (Array.isArray(items) ? items : []).map((row) => ({
    ...row,
    stock_quantity: Number(row.stock_quantity || 0),
    family_stock_quantity: Number(row.family_stock_quantity || 0),
    family_size: Number(row.family_size || 1),
  }))
  return {
    items: normalizedItems,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasMore: offset + normalizedItems.length < total,
  }
}

export interface FamilyStockOverview {
  stats: FamilyStockStats
  low: FamilyStockAlertPage
  out: FamilyStockAlertPage
}

/**
 * The Dashboard's whole stock block in ONE statement and ONE pass over the
 * active catalog (G39 efficiency item 1).
 *
 * Exactly equal to these three calls, which the Dashboard used to make:
 *   getFamilyStockStats({ lowStock, joinSql: '', whereSql: 'WHERE p.is_active = 1',
 *                         qtyExpr: 'COALESCE(p.stock_quantity, 0)', params })
 *   getFamilyStockAlertPage({ lowStock, state: 'low', page: 1, pageSize: previewSize })
 *   getFamilyStockAlertPage({ lowStock, state: 'out', page: 1, pageSize: previewSize })
 * Those ran the matched/members/family_agg CTE five times (stats once, each
 * alert page twice: COUNT + items), i.e. five full-catalog passes with a parent
 * probe per row. Here `matched` is referenced several times, so SQLite
 * materializes it once, and every number is derived from that one pass:
 *   - the stats row aggregates family_agg exactly as getFamilyStockStats does;
 *   - an alert page's total IS that row's low_stock / out_of_stock count (the
 *     eligibility predicates are the same two expressions), so no COUNT pass;
 *   - each alert family's representative row is ranked with the same ORDER BY
 *     as getFamilyStockAlertPage, per family, using the family's own state.
 * scripts/test-dashboard-stock-overview-pure.cjs pins the equality against
 * the three helpers on fixtures that exercise every rule above.
 */
export async function getFamilyStockOverview(opts: {
  db: D1Compat
  lowStock: LowStockConfig
  previewSize: number
}): Promise<FamilyStockOverview> {
  const { db, lowStock } = opts
  const pageSize = Math.max(1, Math.trunc(opts.previewSize) || 1)
  const lowThresholdSql = lowStockThresholdSql(lowStock, 'p.low_stock_threshold')
  const rows = await db.prepare(`
    WITH matched AS (
      SELECT
        ${FAMILY_ROOT_KEY_SQL} AS family_root_id,
        p.id, p.name, p.category, p.unit,
        COALESCE(p.stock_quantity, 0) AS qty,
        p.low_stock_threshold,
        p.out_of_stock_threshold,
        COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
        ${lowThresholdSql} AS low_threshold,
        COALESCE(p.is_group, 0) AS is_group,
        COALESCE(p.parent_id, 0) AS parent_id,
        COALESCE(p.cost_price_usd, 0) AS unit_cost_usd,
        COALESCE(p.cost_price_khr, 0) AS unit_cost_khr
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      WHERE p.is_active = 1
    ),
    non_header_families AS (
      SELECT DISTINCT family_root_id FROM matched WHERE NOT (is_group = 1 AND parent_id = 0)
    ),
    members AS (
      SELECT m.* FROM matched m
      WHERE NOT (m.is_group = 1 AND m.parent_id = 0)
         OR m.family_root_id NOT IN (SELECT family_root_id FROM non_header_families)
    ),
    family_agg AS (
      SELECT
        family_root_id,
        MIN(lower(trim(COALESCE(name, '')))) AS family_name,
        MIN(qty) AS minimum_qty,
        SUM(qty) AS total_qty,
        COUNT(*) AS family_size,
        MAX(CASE WHEN qty > out_threshold AND qty > low_threshold THEN 1 ELSE 0 END) AS has_healthy,
        MAX(CASE WHEN qty > out_threshold AND qty <= low_threshold THEN 1 ELSE 0 END) AS has_low,
        SUM(MAX(qty, 0) * unit_cost_usd) AS value_usd,
        SUM(MAX(qty, 0) * unit_cost_khr) AS value_khr
      FROM members
      GROUP BY family_root_id
    ),
    eligible AS (
      SELECT family_agg.*, CASE WHEN has_low = 1 THEN 'low' ELSE 'out' END AS alert_state
      FROM family_agg
      WHERE has_healthy = 0
    ),
    ranked AS (
      SELECT family_root_id, alert_state,
             ROW_NUMBER() OVER (PARTITION BY alert_state ORDER BY minimum_qty ASC, family_name ASC, family_root_id ASC) AS family_rank
      FROM eligible
    ),
    previewed AS (
      SELECT * FROM ranked WHERE family_rank <= @previewSize
    ),
    representatives AS (
      SELECT m.*, v.alert_state, v.family_rank,
             ROW_NUMBER() OVER (
               PARTITION BY m.family_root_id
               ORDER BY
                 CASE
                   WHEN v.alert_state = 'low' AND m.qty > m.out_threshold AND m.qty <= m.low_threshold THEN 0
                   WHEN v.alert_state = 'out' AND m.qty <= m.out_threshold THEN 0
                   ELSE 1
                 END ASC,
                 m.qty ASC, lower(trim(COALESCE(m.name, ''))) ASC, m.id ASC
             ) AS representative_rank
      FROM members m
      JOIN previewed v ON v.family_root_id = m.family_root_id
    )
    SELECT
      'stats' AS row_kind, NULL AS alert_state, NULL AS family_rank,
      NULL AS id, NULL AS name, NULL AS category, NULL AS unit,
      NULL AS stock_quantity, NULL AS low_stock_threshold, NULL AS out_of_stock_threshold,
      NULL AS family_stock_quantity, NULL AS family_size,
      COUNT(*) AS total_products,
      COALESCE(SUM(CASE WHEN has_healthy = 1 OR has_low = 1 THEN 1 ELSE 0 END), 0) AS in_stock,
      COALESCE(SUM(CASE WHEN has_healthy = 1 THEN 1 ELSE 0 END), 0) AS healthy,
      COALESCE(SUM(CASE WHEN has_healthy = 0 AND has_low = 1 THEN 1 ELSE 0 END), 0) AS low_stock,
      COALESCE(SUM(CASE WHEN has_healthy = 0 AND has_low = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
      COALESCE(SUM(total_qty), 0) AS total_stock_quantity,
      COALESCE(SUM(value_usd), 0) AS stock_value_usd,
      COALESCE(SUM(value_khr), 0) AS stock_value_khr
    FROM family_agg
    UNION ALL
    SELECT
      'alert', r.alert_state, r.family_rank,
      r.id, r.name, r.category, r.unit,
      r.qty, r.low_stock_threshold, r.out_of_stock_threshold,
      e.total_qty, e.family_size,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM representatives r
    JOIN eligible e ON e.family_root_id = r.family_root_id
    WHERE r.representative_rank = 1
  `).all<Record<string, unknown>>({ previewSize: pageSize })

  const list = Array.isArray(rows) ? rows : []
  const statsRow = list.find((row) => row.row_kind === 'stats') || {}
  const stats: FamilyStockStats = {
    total_products: Number(statsRow.total_products || 0),
    in_stock: Number(statsRow.in_stock || 0),
    healthy: Number(statsRow.healthy || 0),
    low_stock: Number(statsRow.low_stock || 0),
    out_of_stock: Number(statsRow.out_of_stock || 0),
    stock_quantity: Number(statsRow.total_stock_quantity || 0),
    stock_value_usd: Number(statsRow.stock_value_usd || 0),
    stock_value_khr: Number(statsRow.stock_value_khr || 0),
  }
  const page = (state: FamilyStockAlertState, total: number): FamilyStockAlertPage => {
    const items: FamilyStockAlertRow[] = list
      .filter((row) => row.row_kind === 'alert' && row.alert_state === state)
      .sort((a, b) => Number(a.family_rank) - Number(b.family_rank))
      .map((row) => ({
        id: row.id as number,
        name: row.name as string | null,
        category: row.category as string | null,
        unit: row.unit as string | null,
        stock_quantity: Number(row.stock_quantity || 0),
        low_stock_threshold: row.low_stock_threshold as number | null,
        out_of_stock_threshold: row.out_of_stock_threshold as number | null,
        family_stock_quantity: Number(row.family_stock_quantity || 0),
        family_size: Number(row.family_size || 1),
      }))
    return {
      items,
      total,
      page: 1,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: items.length < total,
    }
  }
  return { stats, low: page('low', stats.low_stock), out: page('out', stats.out_of_stock) }
}
