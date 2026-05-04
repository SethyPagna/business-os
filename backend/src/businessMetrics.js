'use strict'

const { db } = require('./database')

function sellableProductWhere(alias = 'p') {
  return [
    `${alias}.is_active = 1`,
    `NOT (COALESCE(${alias}.is_group, 0) = 1 AND COALESCE(${alias}.parent_id, 0) = 0)`,
  ]
}

function effectiveCostExpr(alias = 'p', currency = 'usd') {
  const purchase = currency === 'khr' ? 'purchase_price_khr' : 'purchase_price_usd'
  const cost = currency === 'khr' ? 'cost_price_khr' : 'cost_price_usd'
  return `COALESCE(NULLIF(${alias}.${purchase}, 0), ${alias}.${cost}, 0)`
}

function stockQuantityExpr({ branchId = null, productAlias = 'p', stockAlias = 'bs' } = {}) {
  return branchId ? `COALESCE(${stockAlias}.quantity, 0)` : `COALESCE(${productAlias}.stock_quantity, 0)`
}

function normalizeMetricRow(row = {}) {
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

function getStockMetrics({ branchId = null } = {}) {
  const numericBranchId = Number.parseInt(branchId, 10)
  const hasBranch = Number.isFinite(numericBranchId) && numericBranchId > 0
  const qty = stockQuantityExpr({ branchId: hasBranch ? numericBranchId : null })
  const joinSql = hasBranch
    ? 'LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId'
    : ''
  const params = hasBranch ? { branchId: numericBranchId } : {}
  const whereSql = sellableProductWhere('p').join(' AND ')
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_products,
      SUM(CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS in_stock,
      SUM(CASE WHEN ${qty} > COALESCE(p.out_of_stock_threshold, 0) AND ${qty} <= COALESCE(p.low_stock_threshold, 10) THEN 1 ELSE 0 END) AS low_stock,
      SUM(CASE WHEN ${qty} <= COALESCE(p.out_of_stock_threshold, 0) THEN 1 ELSE 0 END) AS out_of_stock,
      COALESCE(SUM(${qty}), 0) AS stock_quantity,
      COALESCE(SUM(MAX(0, ${qty}) * ${effectiveCostExpr('p', 'usd')}), 0) AS stock_value_usd,
      COALESCE(SUM(MAX(0, ${qty}) * ${effectiveCostExpr('p', 'khr')}), 0) AS stock_value_khr
    FROM products p
    ${joinSql}
    WHERE ${whereSql}
  `).get(params) || {}
  return normalizeMetricRow(row)
}

function getLowStockProducts({ limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(5000, Number.parseInt(limit, 10) || 20))
  const whereSql = sellableProductWhere('p').join(' AND ')
  return db.prepare(`
    SELECT p.id, p.name, p.category, p.unit, p.stock_quantity, p.low_stock_threshold, p.out_of_stock_threshold
    FROM products p
    WHERE ${whereSql}
      AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
      AND COALESCE(p.stock_quantity, 0) <= COALESCE(p.low_stock_threshold, 10)
    ORDER BY p.stock_quantity ASC, p.name ASC
    LIMIT ?
  `).all(safeLimit)
}

function getOutOfStockProducts({ limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(5000, Number.parseInt(limit, 10) || 20))
  const whereSql = sellableProductWhere('p').join(' AND ')
  return db.prepare(`
    SELECT p.id, p.name, p.category, p.unit, p.stock_quantity, p.low_stock_threshold, p.out_of_stock_threshold
    FROM products p
    WHERE ${whereSql}
      AND COALESCE(p.stock_quantity, 0) <= COALESCE(p.out_of_stock_threshold, 0)
    ORDER BY p.stock_quantity ASC, p.name ASC
    LIMIT ?
  `).all(safeLimit)
}

function getStockAlertProducts({ limit = 5000 } = {}) {
  const safeLimit = Math.max(1, Math.min(5000, Number.parseInt(limit, 10) || 5000))
  const whereSql = sellableProductWhere('p').join(' AND ')
  const outOfStock = getOutOfStockProducts({ limit: safeLimit })
  const lowStock = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit, p.stock_quantity, p.low_stock_threshold, p.out_of_stock_threshold
    FROM products p
    WHERE ${whereSql}
      AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
      AND COALESCE(p.stock_quantity, 0) <= COALESCE(p.low_stock_threshold, 10)
    ORDER BY p.stock_quantity ASC, p.name ASC
    LIMIT ?
  `).all(safeLimit)
  const counts = getStockMetrics()
  return {
    outOfStock,
    lowStock,
    countOut: counts.out_of_stock,
    countLow: counts.low_stock,
  }
}

function getExpiringProducts({ limit = 20, days = 30 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 20))
  const safeDays = Math.max(0, Math.min(3650, Number.parseInt(days, 10) || 30))
  const whereSql = sellableProductWhere('p').join(' AND ')
  return db.prepare(`
    SELECT
      p.id,
      p.name,
      p.category,
      p.unit,
      p.stock_quantity,
      p.expiry_date,
      COALESCE(p.expiry_alert_days, ?) AS expiry_alert_days,
      (NULLIF(p.expiry_date, '')::date - CURRENT_DATE) AS days_until_expiry
    FROM products p
    WHERE ${whereSql}
      AND NULLIF(p.expiry_date, '') IS NOT NULL
      AND NULLIF(p.expiry_date, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
      AND NULLIF(p.expiry_date, '')::date <= CURRENT_DATE + CAST(? AS integer)
    ORDER BY NULLIF(p.expiry_date, '')::date ASC, p.name ASC
    LIMIT ?
  `).all(safeDays, safeDays, safeLimit)
}

module.exports = {
  effectiveCostExpr,
  getExpiringProducts,
  getLowStockProducts,
  getOutOfStockProducts,
  getStockAlertProducts,
  getStockMetrics,
  sellableProductWhere,
  stockQuantityExpr,
}
