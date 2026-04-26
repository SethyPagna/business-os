'use strict'
/**
 * helpers.js — Shared utility functions for route handlers.
 *
 * Keeping these here (rather than inlining in routes) means:
 *  - One audit() signature change propagates everywhere.
 *  - Route files stay focused on HTTP/business logic, not plumbing.
 *  - Unit-testing helpers is straightforward without spinning up Express.
 */

const { db } = require('./database')
const { getRequestMeta } = require('./requestContext')

// ── Server-side operation log ─────────────────────────────────────────────────
const serverLog = []
const MAX_LOG   = 500

/**
 * Record a timed server operation. Stored in a ring buffer for the /api/debug/log endpoint.
 */
function logOp(channel, ms, ok = true) {
  serverLog.unshift({ ts: new Date().toISOString(), channel, ms, ok })
  if (serverLog.length > MAX_LOG) serverLog.pop()
}

function getServerLog() { return serverLog }

// ── HTTP response helpers ─────────────────────────────────────────────────────
/** Send a successful JSON response, merging `data` into `{ success: true }`. */
function ok(res, data = {}) {
  return res.json({ success: true, ...data })
}

/** Send a JSON error response with an optional HTTP status code (default 400). */
function err(res, msg, status = 400) {
  return res.status(status).json({ success: false, error: msg })
}

// ── Audit log writer ──────────────────────────────────────────────────────────
/**
 * Write a row to audit_logs.
 * @param {number|null} userId
 * @param {string|null} userName
 * @param {string}      action     e.g. 'create', 'update', 'delete'
 * @param {string|null} entity     e.g. 'product', 'sale'
 * @param {number|null} entityId
 * @param {*}           details    Anything serialisable
 * @param {Object}      [opts]     Extra metadata: newValue, tableName, recordId, deviceName, deviceTz, clientTime
 */
function audit(userId, userName, action, entity, entityId, details, opts = {}) {
  try {
    const requestMeta = getRequestMeta()
    const detailsStr = details != null
      ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
      : null
    const newVal = opts.newValue != null
      ? (typeof opts.newValue === 'object' ? JSON.stringify(opts.newValue) : String(opts.newValue))
      : detailsStr
    const detailObj = (details && typeof details === 'object') ? details : {}
    const deviceName = opts.deviceName
      || detailObj.deviceName
      || detailObj.device_name
      || requestMeta.deviceName
      || null
    const deviceTz = opts.deviceTz
      || detailObj.deviceTz
      || detailObj.device_tz
      || requestMeta.deviceTz
      || null
    const clientTime = opts.clientTime
      || detailObj.clientTime
      || detailObj.client_time
      || requestMeta.clientTime
      || null
    db.prepare(`
      INSERT INTO audit_logs
        (user_id, user_name, action, entity, entity_id, details,
         table_name, record_id, new_value, device_name, device_tz, client_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId   || null,
      userName || null,
      action,
      entity   || null,
      entityId || null,
      detailsStr,
      opts.tableName  || entity  || null,
      opts.recordId   || entityId || null,
      newVal,
      deviceName,
      deviceTz,
      clientTime,
    )
  } catch (_) {
    // Audit failures must never crash the main request
  }
}

// ── WebSocket broadcast ───────────────────────────────────────────────────────
// wss_clients is shared across middleware and routes via this module.
const wss_clients = new Set()

/**
 * Broadcast a sync:update message to all connected WebSocket clients.
 * @param {string} channel  e.g. 'products', 'sales'
 * @param {Object} [data]   Additional payload fields
 */
function broadcast(channel, data = {}) {
  const msg = JSON.stringify({ type: 'sync:update', channel, ...data })
  for (const ws of wss_clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
  try {
    const { scheduleDriveSync } = require('./services/googleDriveSync')
    scheduleDriveSync(`broadcast:${channel}`, 4000)
  } catch (_) {}
}

// ── Data helpers ──────────────────────────────────────────────────────────────
/** Safely parse JSON; return `fallback` on any error. */
function tryParse(str, fallback) {
  try { return JSON.parse(str) } catch { return fallback }
}

/** Return today's date as YYYY-MM-DD in the server's local timezone. */
function today() {
  return new Date().toISOString().split('T')[0]
}

// ── CSV bulk import ───────────────────────────────────────────────────────────
/**
 * Generic CSV import runner.
 * @param {string}   csvText      Full CSV string (header row required)
 * @param {string[]} _expectedCols Reserved for documentation only — not used at runtime
 * @param {Function} insertFn     Called once per data row with a `{header: value}` object
 * @returns {{ imported: number, errors: string[] }}
 */
function bulkImportCSV(csvText, _expectedCols, insertFn) {
  if (!csvText) return { imported: 0, errors: ['No CSV data'] }
  const lines = csvText.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return { imported: 0, errors: ['CSV must have a header row and at least one data row'] }

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
  let imported = 0
  const errors = []

  const txFn = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i])
      const row  = {}
      headers.forEach((h, j) => { row[h] = vals[j]?.trim().replace(/^"|"$/g, '') || '' })
      if (!row.name) { errors.push(`Row ${i + 1}: name is required`); continue }
      try {
        const result = insertFn(row)
        if (result === false) continue
        if (typeof result?.changes === 'number' && result.changes === 0) continue
        imported++
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e.message}`)
      }
    }
  })
  txFn()
  return { imported, errors }
}

/** Split a single CSV line, respecting quoted fields. */
function parseCSVLine(line) {
  const result = []
  let current  = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"')                { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current); current = '' }
    else                           { current += ch }
  }
  result.push(current)
  return result
}

/**
 * INSERT OR IGNORE rows from a backup array into a named table.
 * @param {string}   table  Target table name
 * @param {Object[]} rows   Array of row objects
 * @param {string[]} cols   Columns to insert (in order)
 */
function importRows(table, rows = [], cols) {
  if (!rows.length) return
  const placeholders = cols.map(() => '?').join(',')
  const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`)
  rows.forEach(row => {
    try { stmt.run(cols.map(c => row[c] ?? null)) } catch (_) {}
  })
}

// ── Data Integrity & Validation ──────────────────────────────────────────────
/**
 * Verify and repair stock quantities based on inventory movements.
 * Rebuilds product.stock_quantity and branch_stock from movement history.
 * @returns {Object} { errors: string[], repairs: number, summary: string }
 */
function verifyAndRepairStockQuantities() {
  const errors = []
  let repairs = 0

  try {
    db.transaction(() => {
      // Get all products and recalculate their stock based on movements
      const products = db.prepare('SELECT id FROM products').all()

      for (const prod of products) {
        const movementsSql = `
          SELECT COALESCE(SUM(CASE WHEN movement_type IN ('return', 'stock_adjustment', 'opening')
                                   THEN quantity
                                   ELSE -quantity END), 0) AS calculated_stock
          FROM inventory_movements
          WHERE product_id = ?
        `
        const calculated = db.prepare(movementsSql).get(prod.id)?.calculated_stock || 0
        const actual = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prod.id)?.stock_quantity || 0

        if (Math.abs(actual - calculated) > 0.01) {
          db.prepare('UPDATE products SET stock_quantity = ?, updated_at = datetime("now") WHERE id = ?')
            .run(Math.max(0, calculated), prod.id)
          repairs++
          errors.push(`Product ${prod.id}: stock corrected from ${actual} to ${calculated}`)
        }
      }

      // Verify branch_stock quantities
      const branches = db.prepare(`
        SELECT DISTINCT product_id, branch_id FROM branch_stock
      `).all()

      for (const {product_id, branch_id} of branches) {
        const movementsSql = `
          SELECT COALESCE(SUM(CASE WHEN movement_type IN ('return', 'stock_adjustment')
                                   THEN quantity
                                   ELSE -quantity END), 0) AS calculated_stock
          FROM inventory_movements
          WHERE product_id = ? AND branch_id = ?
        `
        const calculated = db.prepare(movementsSql).get(product_id, branch_id)?.calculated_stock || 0
        const actual = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?')
          .get(product_id, branch_id)?.quantity || 0

        if (Math.abs(actual - calculated) > 0.01) {
          db.prepare('UPDATE branch_stock SET quantity = ? WHERE product_id = ? AND branch_id = ?')
            .run(Math.max(0, calculated), product_id, branch_id)
          repairs++
          errors.push(`Branch ${branch_id}, Product ${product_id}: branch_stock corrected from ${actual} to ${calculated}`)
        }
      }
    })()
  } catch (e) {
    errors.push(`Stock verification error: ${e.message}`)
  }

  return {
    errors,
    repairs,
    summary: `Verified stock quantities: ${repairs} repairs made`
  }
}

/**
 * Verify sale status consistency with associated returns.
 * Fixes sales that should be partial_return/returned based on return records.
 * @returns {Object} { errors: string[], repairs: number }
 */
function verifyAndRepairSaleStatuses() {
  const errors = []
  let repairs = 0

  try {
    db.transaction(() => {
      const sales = db.prepare('SELECT id, sale_status FROM sales WHERE sale_status NOT IN ("cancelled")')
        .all()

      for (const sale of sales) {
        // Get all items from this sale
        const saleItems = db.prepare(`
          SELECT product_id, SUM(quantity) as total_qty
          FROM sale_items WHERE sale_id = ?
          GROUP BY product_id
        `).all(sale.id)

        if (saleItems.length === 0) continue

        // Get all non-cancelled returns for this sale
        const returnedItems = db.prepare(`
          SELECT ri.product_id, SUM(ri.quantity) as total_qty
          FROM return_items ri
          JOIN returns r ON r.id = ri.return_id
          WHERE r.sale_id = ? AND COALESCE(r.status, 'completed') != 'cancelled'
          GROUP BY ri.product_id
        `).all(sale.id)

        const returnedMap = {}
        returnedItems.forEach(r => { returnedMap[r.product_id] = r.total_qty })

        // Determine correct status
        const fullyReturned = saleItems.every(si => returnedMap[si.product_id] >= si.total_qty)
        const hasPartialReturn = returnedItems.length > 0 && !fullyReturned
        const correctStatus = fullyReturned ? 'returned' : hasPartialReturn ? 'partial_return' : sale.sale_status

        if (correctStatus !== sale.sale_status) {
          db.prepare('UPDATE sales SET sale_status = ? WHERE id = ?')
            .run(correctStatus, sale.id)
          repairs++
          errors.push(`Sale ${sale.id}: status corrected from ${sale.sale_status} to ${correctStatus}`)
        }
      }
    })()
  } catch (e) {
    errors.push(`Sale status verification error: ${e.message}`)
  }

  return {
    errors,
    repairs,
    summary: `Verified sale statuses: ${repairs} repairs made`
  }
}

/**
 * Ensure cost prices are properly filled in for profit calculations.
 * Falls back to purchase_price if cost_price is missing in sale_items.
 * @returns {Object} { errors: string[], repairs: number }
 */
function verifyAndRepairCostPrices() {
  const errors = []
  let repairs = 0

  try {
    db.transaction(() => {
      // Find sale_items with null cost prices
      const nullCostItems = db.prepare(`
        SELECT si.id, si.product_id, p.cost_price_usd, p.cost_price_khr, p.purchase_price_usd, p.purchase_price_khr
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        WHERE (si.cost_price_usd IS NULL OR si.cost_price_usd = 0)
          OR (si.cost_price_khr IS NULL OR si.cost_price_khr = 0)
      `).all()

      for (const item of nullCostItems) {
        const costUsd = item.cost_price_usd || item.purchase_price_usd || 0
        const costKhr = item.cost_price_khr || item.purchase_price_khr || 0

        if (costUsd > 0 || costKhr > 0) {
          db.prepare(`
            UPDATE sale_items
            SET cost_price_usd = COALESCE(cost_price_usd, ?),
                cost_price_khr = COALESCE(cost_price_khr, ?)
            WHERE id = ?
          `).run(costUsd, costKhr, item.id)
          repairs++
          errors.push(`Sale item ${item.id}: cost prices filled from product data`)
        }
      }

      // Also check inventory_movements
      const nullMovements = db.prepare(`
        SELECT im.id, im.product_id, p.cost_price_usd, p.cost_price_khr
        FROM inventory_movements im
        LEFT JOIN products p ON p.id = im.product_id
        WHERE (im.unit_cost_usd IS NULL OR im.unit_cost_usd = 0)
          AND im.movement_type IN ('sale', 'return')
      `).all()

      for (const mov of nullMovements) {
        const costUsd = mov.cost_price_usd || 0
        const costKhr = mov.cost_price_khr || 0

        if (costUsd > 0 || costKhr > 0) {
          db.prepare(`
            UPDATE inventory_movements
            SET unit_cost_usd = COALESCE(unit_cost_usd, ?),
                unit_cost_khr = COALESCE(unit_cost_khr, ?)
            WHERE id = ?
          `).run(costUsd, costKhr, mov.id)
          repairs++
        }
      }
    })()
  } catch (e) {
    errors.push(`Cost price verification error: ${e.message}`)
  }

  return {
    errors,
    repairs,
    summary: `Verified cost prices: ${repairs} items filled`
  }
}

/**
 * Complete data integrity check covering stock, sales status, costs, and orphaned records.
 * @returns {Object} Combined results from all verification functions
 */
function runDataIntegrityCheck() {
  const allErrors = []
  let totalRepairs = 0

  const stockCheck = verifyAndRepairStockQuantities()
  const statusCheck = verifyAndRepairSaleStatuses()
  const costCheck = verifyAndRepairCostPrices()

  allErrors.push(...stockCheck.errors, ...statusCheck.errors, ...costCheck.errors)
  totalRepairs = stockCheck.repairs + statusCheck.repairs + costCheck.repairs

  return {
    success: allErrors.length === 0 || allErrors.some(e => !e.includes('error')),
    errors: allErrors,
    repairs: totalRepairs,
    details: {
      stock: stockCheck,
      saleStatus: statusCheck,
      costPrices: costCheck
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * Get safe cost price for a product, with fallbacks.
 */
function getSafeCostPrice(product = {}) {
  return {
    usd: product.cost_price_usd || product.purchase_price_usd || 0,
    khr: product.cost_price_khr || product.purchase_price_khr || 0
  }
}

/**
 * Safely calculate profit/COGS for a sale.
 * Returns {revenue, cogs, profit} in both currencies.
 */
function calculateSaleProfit(sale, items = []) {
  let revenueUsd = sale.total_usd || 0
  let revenueKhr = sale.total_khr || 0
  let cogsUsd = 0
  let cogsKhr = 0

  if (Array.isArray(items)) {
    items.forEach(item => {
      cogsUsd += (item.cost_price_usd || 0) * (item.quantity || 0)
      cogsKhr += (item.cost_price_khr || 0) * (item.quantity || 0)
    })
  }

  return {
    revenue_usd: revenueUsd,
    revenue_khr: revenueKhr,
    cogs_usd: cogsUsd,
    cogs_khr: cogsKhr,
    profit_usd: revenueUsd - cogsUsd,
    profit_khr: revenueKhr - cogsKhr,
    margin_pct: revenueUsd > 0 ? ((revenueUsd - cogsUsd) / revenueUsd * 100).toFixed(2) : 0
  }
}

module.exports = {
  logOp, getServerLog,
  ok, err,
  audit, broadcast, wss_clients,
  tryParse, today,
  bulkImportCSV, parseCSVLine, importRows,
  verifyAndRepairStockQuantities,
  verifyAndRepairSaleStatuses,
  verifyAndRepairCostPrices,
  runDataIntegrityCheck,
  getSafeCostPrice,
  calculateSaleProfit,
}
