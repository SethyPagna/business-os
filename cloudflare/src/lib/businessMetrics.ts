// Ported from backend/src/businessMetrics.ts. Only getStockMetrics is
// included (what routes/products.ts's /stats endpoint needs) -- the file
// also has getLowStockProducts/getOutOfStockProducts/getExpiringProducts,
// not needed by this section, left for whichever future section needs a
// dashboard/reporting endpoint that calls them.

import type { D1Compat } from './db'

export type StockMetrics = {
  total_products: number
  in_stock: number
  low_stock: number
  out_of_stock: number
  stock_quantity: number
  stock_value_usd: number
  stock_value_khr: number
}

function sellableProductWhere(alias = 'p'): string {
  return `${alias}.is_active = 1 AND NOT (COALESCE(${alias}.is_group, 0) = 1 AND COALESCE(${alias}.parent_id, 0) = 0)`
}

function effectiveCostExpr(alias = 'p', currency: 'usd' | 'khr' = 'usd'): string {
  const cost = currency === 'khr' ? 'cost_price_khr' : 'cost_price_usd'
  return `COALESCE(${alias}.${cost}, 0)`
}

function normalizeMetricRow(row: Record<string, unknown> = {}): StockMetrics {
  return {
    total_products: Number(row.total_products || 0),
    in_stock: Number(row.in_stock || 0),
    low_stock: Number(row.low_stock || 0),
    out_of_stock: Number(row.out_of_stock || 0),
    stock_quantity: Number(row.stock_quantity || 0),
    stock_value_usd: Number(row.stock_value_usd || 0),
    stock_value_khr: Number(row.stock_value_khr || 0),
  }
}

export async function getStockMetrics(db: D1Compat, options: { branchId?: number | string | null } = {}): Promise<StockMetrics> {
  const numericBranchId = Number.parseInt(String(options.branchId ?? ''), 10)
  const hasBranch = Number.isFinite(numericBranchId) && numericBranchId > 0
  const qty = hasBranch ? 'COALESCE(batch_totals.branch_quantity, 0)' : 'COALESCE(batch_totals.total_quantity, 0)'
  const branchQuantitySql = hasBranch
    ? 'COALESCE(SUM(CASE WHEN bbs.branch_id = @branchId THEN bbs.quantity ELSE 0 END), 0) AS branch_quantity'
    : '0 AS branch_quantity'
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total_products,
      SUM(CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS in_stock,
      SUM(CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} <= COALESCE(p.low_stock_threshold, 10) THEN 1 ELSE 0 END) AS low_stock,
      SUM(CASE WHEN ${qty} <= COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS out_of_stock,
      COALESCE(SUM(${qty}), 0) AS stock_quantity,
      COALESCE(SUM(MAX(0, ${qty}) * ${effectiveCostExpr('p', 'usd')}), 0) AS stock_value_usd,
      COALESCE(SUM(MAX(0, ${qty}) * ${effectiveCostExpr('p', 'khr')}), 0) AS stock_value_khr
    FROM products p
    LEFT JOIN (
      SELECT
        pb.variant_product_id AS product_id,
        COALESCE(SUM(bbs.quantity), 0) AS total_quantity,
        ${branchQuantitySql}
      FROM product_batches pb
      LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
      GROUP BY pb.variant_product_id
    ) batch_totals ON batch_totals.product_id = p.id
    WHERE ${sellableProductWhere('p')}
  `).get<Record<string, unknown>>(hasBranch ? { branchId: numericBranchId } : {})
  return normalizeMetricRow(row || {})
}
