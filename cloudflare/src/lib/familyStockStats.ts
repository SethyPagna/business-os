// Family-aware stock stats -- companion to familyPagination.ts.
//
// Why this exists: paginateProductFamilies made every product LISTING treat
// a grouped product (parent_id family) as ONE item for paging purposes. But
// three separate stats surfaces -- Dashboard's summary tile (compat.ts
// dashboardSummary), Inventory's /bootstrap stats block, and Inventory's
// /stats endpoint -- all kept computing total_products/in_stock/low_stock/
// out_of_stock as a plain `COUNT(*) FROM products`, counting every variant
// row separately (and even counting group-header placeholder rows, which
// aren't sellable products at all -- see businessMetrics.ts's
// sellableProductWhere for the same exclusion, applied there but never to
// these three live endpoints). Net effect: any catalog with grouped/variant
// products shows a bigger "total products" on Dashboard/Inventory stat
// cards than the pagination footer on the listing right below them, and
// stakeholders comparing the two pages get two different answers to
// "how many products do we have".
//
// This helper re-derives those same four counts (+ stock quantity/value)
// the same way paginateProductFamilies derives `total`: group rows into
// families by COALESCE(parent.id, p.id), one row per family toward the
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

export interface FamilyStockStatsOptions {
  db: D1Compat
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

export async function getFamilyStockStats(opts: FamilyStockStatsOptions): Promise<FamilyStockStats> {
  const { db, joinSql, whereSql, params, qtyExpr } = opts
  const row = await db.prepare(`
    WITH matched AS (
      SELECT
        COALESCE(parent.id, p.id) AS family_root_id,
        COALESCE(p.is_group, 0) AS is_group,
        COALESCE(p.parent_id, 0) AS parent_id,
        ${qtyExpr} AS qty,
        COALESCE(p.out_of_stock_threshold, 0) AS out_threshold,
        COALESCE(p.low_stock_threshold, 10) AS low_threshold,
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
