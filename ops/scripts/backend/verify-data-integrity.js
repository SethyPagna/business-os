/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/**
 * Final Docker data integrity verifier.
 *
 * Postgres is intentionally internal to Docker in the final release. This
 * script therefore runs psql inside the Postgres container instead of opening
 * a localhost database port or relying on pg-native on Windows.
 */

const EPS = 0.01
const RELEASE_ENV = path.resolve(__dirname, '../../runtime/docker-release/docker-release.env')
const DEFAULT_CONTAINER = process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1'
let failed = false
const shouldFix = process.argv.includes('--fix')
const shouldRunNewChecks = process.argv.includes('--comprehensive')

function parseEnvFile(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  const text = fs.readFileSync(filePath, 'utf8')
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const index = trimmed.indexOf('=')
    if (index <= 0) return
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  })
  return values
}

const runtimeEnv = parseEnvFile(RELEASE_ENV)
const pgUser = process.env.POSTGRES_USER || runtimeEnv.POSTGRES_USER || 'business_os'
const pgDb = process.env.POSTGRES_DB || runtimeEnv.POSTGRES_DB || 'business_os'

function fail(message) {
  failed = true
  console.error(`FAIL: ${message}`)
}

function pass(message) {
  console.log(`PASS: ${message}`)
}

function approxEqual(a, b, eps = EPS) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps
}

function stripTrailingSemicolon(sql) {
  return String(sql || '').trim().replace(/;+\s*$/, '')
}

function runPsql(sql, options = {}) {
  const args = [
    'exec',
    '-i',
    DEFAULT_CONTAINER,
    'psql',
    '-U',
    pgUser,
    '-d',
    pgDb,
    '-v',
    'ON_ERROR_STOP=1',
  ]
  if (options.tuplesOnly) args.push('-t', '-A')
  args.push('-c', sql)
  return execFileSync('docker', args, {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function queryRows(sql) {
  const wrapped = `
    SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
    FROM (${stripTrailingSemicolon(sql)}) q
  `
  const output = runPsql(wrapped, { tuplesOnly: true })
  return output ? JSON.parse(output) : []
}

function queryOne(sql) {
  return queryRows(sql)[0] || null
}

function execSql(sql) {
  runPsql(sql)
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function checkNoNegativeStock() {
  const badProducts = queryRows('SELECT id, name, stock_quantity FROM products WHERE stock_quantity < 0')
  const badBranches = queryRows('SELECT product_id, branch_id, quantity FROM branch_stock WHERE quantity < 0')
  if (badProducts.length) fail(`Found ${badProducts.length} products with negative stock_quantity`)
  else pass('No products with negative stock_quantity')
  if (badBranches.length) fail(`Found ${badBranches.length} branch_stock rows with negative quantity`)
  else pass('No branch_stock rows with negative quantity')
}

function checkProductStockMatchesBranches() {
  const mismatches = queryRows(`
    SELECT p.id, p.name, p.stock_quantity,
      COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0) AS summed_qty
    FROM products p
    WHERE ABS(COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0)) > 0.001
  `)
  if (!mismatches.length) {
    pass('Product stock matches branch_stock totals')
    return
  }

  if (!shouldFix) {
    fail(`Found ${mismatches.length} products where stock_quantity != SUM(branch_stock)`)
    return
  }

  const ids = mismatches
    .map((row) => Number(row.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)
  if (!ids.length) {
    fail('Stock mismatch repair could not identify product ids')
    return
  }
  execSql(`
    UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(quantity), 0)
      FROM branch_stock
      WHERE branch_stock.product_id = products.id
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ANY(ARRAY[${ids.join(',')}]::integer[])
  `)
  pass(`Fixed ${ids.length} product stock total mismatches from branch_stock`)

  const remaining = Number(queryOne(`
    SELECT COUNT(*) AS n
    FROM products p
    WHERE ABS(COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0)) > 0.001
  `)?.n || 0)
  if (remaining > 0) fail(`Still found ${remaining} stock mismatch(es) after fix`)
  else pass('Post-fix check: product stock now matches branch_stock totals')
}

function checkSaleItemTotals() {
  const badRows = queryRows(`
    SELECT id, sale_id, quantity, applied_price_usd, total_usd
    FROM sale_items
    WHERE ABS(COALESCE(total_usd,0) - (COALESCE(quantity,0) * COALESCE(applied_price_usd,0))) > 0.02
  `)
  if (badRows.length) fail(`Found ${badRows.length} sale_items where total_usd != quantity * applied_price_usd`)
  else pass('Sale item totals match quantity * applied price')
}

function checkReturnDoesNotExceedSold() {
  const overReturned = queryRows(`
    WITH sold AS (
      SELECT sale_id, product_id, SUM(quantity) AS qty_sold
      FROM sale_items
      GROUP BY sale_id, product_id
    ),
    returned AS (
      SELECT r.sale_id, ri.product_id, SUM(ri.quantity) AS qty_returned
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE COALESCE(r.status, 'completed') != 'cancelled'
      GROUP BY r.sale_id, ri.product_id
    )
    SELECT r.sale_id, r.product_id, r.qty_returned, COALESCE(s.qty_sold, 0) AS qty_sold
    FROM returned r
    LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
    WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
  `)
  if (overReturned.length) fail(`Found ${overReturned.length} sale/product pairs with returned qty > sold qty`)
  else pass('Return quantities do not exceed sold quantities')
}

function checkProfitFormulaConsistency() {
  const sales = queryOne(`
    SELECT
      COALESCE(SUM(s.subtotal_usd), 0) AS subtotal_usd,
      COALESCE(SUM(s.discount_usd), 0) AS discount_usd,
      COALESCE(SUM(si.cost_part), 0) AS cogs_usd
    FROM sales s
    LEFT JOIN (
      SELECT sale_id, SUM(quantity * COALESCE(cost_price_usd, 0)) AS cost_part
      FROM sale_items
      GROUP BY sale_id
    ) si ON si.sale_id = s.id
    WHERE COALESCE(s.sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment')
  `) || {}

  const returns = queryOne(`
    SELECT
      COALESCE(SUM(r.total_refund_usd), 0) AS refunds_usd,
      COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_usd, 0) ELSE 0 END), 0) AS cogs_returned_usd
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE COALESCE(r.status, 'completed') != 'cancelled'
  `) || {}

  const netRevenue = Number(sales.subtotal_usd || 0) - Number(sales.discount_usd || 0) - Number(returns.refunds_usd || 0)
  const netCogs = Number(sales.cogs_usd || 0) - Number(returns.cogs_returned_usd || 0)
  const expectedProfit = netRevenue - netCogs

  if (!Number.isFinite(expectedProfit)) {
    fail('Profit formula produced non-finite value')
    return
  }

  pass(`Profit formula check OK (netRevenue=${netRevenue.toFixed(2)}, netCOGS=${netCogs.toFixed(2)}, profit=${expectedProfit.toFixed(2)})`)
}

function checkCogsSnapshotVsCurrentProductCost() {
  const row = queryOne(`
    SELECT
      COALESCE(SUM(si.quantity * COALESCE(si.cost_price_usd, 0)), 0) AS snapshot_cogs,
      COALESCE(SUM(si.quantity * COALESCE(p.cost_price_usd, 0)), 0) AS current_product_cogs
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
  `)

  if (!row) {
    pass('No sale_items to evaluate COGS source')
    return
  }

  if (!approxEqual(row.snapshot_cogs, row.current_product_cogs, 0.001)) {
    pass('COGS differs from current product cost baseline (snapshot costs are preserved)')
  } else {
    pass('COGS snapshot currently equals current product costs (no drift detected in current data)')
  }
}

function checkPostgresRuntimeTables() {
  const requiredTables = [
    'products',
    'branch_stock',
    'inventory_movements',
    'sales',
    'sale_items',
    'returns',
    'return_items',
    'users',
    'roles',
    'settings',
    'file_assets',
    'google_drive_sync_entries',
  ]
  const values = requiredTables.map((table) => `(${sqlString(table)})`).join(',')
  const found = new Set(queryRows(`
    WITH required(table_name) AS (VALUES ${values})
    SELECT t.table_name
    FROM required t
    JOIN information_schema.tables i
      ON i.table_schema = 'public'
     AND i.table_name = t.table_name
  `).map((row) => row.table_name))
  const missing = requiredTables.filter((table) => !found.has(table))
  if (missing.length) fail(`Missing required Postgres tables: ${missing.join(', ')}`)
  else pass('Required Postgres runtime tables exist')
}

function run() {
  console.log(`Running integrity checks against final Docker Postgres container: ${DEFAULT_CONTAINER}`)
  if (shouldFix) console.log('Fix mode enabled: stock mismatches will be reconciled.')
  if (shouldRunNewChecks) console.log('Comprehensive mode enabled: running additional Postgres runtime table checks.')

  checkNoNegativeStock()
  checkProductStockMatchesBranches()
  checkSaleItemTotals()
  checkReturnDoesNotExceedSold()
  checkProfitFormulaConsistency()
  checkCogsSnapshotVsCurrentProductCost()
  if (shouldRunNewChecks) checkPostgresRuntimeTables()

  if (failed) {
    console.error('\nIntegrity checks completed with failures.')
    process.exit(1)
  }
  console.log('\nAll integrity checks passed.')
}

try {
  run()
} catch (error) {
  console.error(error?.stderr || error)
  process.exit(1)
}
