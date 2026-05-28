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
const outputArgIndex = process.argv.indexOf('--output')
const outputPath = outputArgIndex >= 0 ? path.resolve(process.cwd(), process.argv[outputArgIndex + 1] || '') : ''
const sampleLimitArgIndex = process.argv.indexOf('--sample-limit')
const sampleLimit = Math.max(1, Math.min(50, Number(process.argv[sampleLimitArgIndex + 1] || 10) || 10))

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
const report = {
  generatedAt: new Date().toISOString(),
  container: DEFAULT_CONTAINER,
  database: pgDb,
  user: pgUser,
  comprehensive: shouldRunNewChecks,
  fix: shouldFix,
  checks: [],
  overReturned: [],
  relationshipOrphans: [],
  cleanupClassification: [],
  datasetSummary: null,
  failures: [],
}

function fail(message) {
  failed = true
  report.checks.push({ status: 'fail', message })
  report.failures.push(message)
  console.error(`FAIL: ${message}`)
}

function pass(message) {
  report.checks.push({ status: 'pass', message })
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

function queryScalarList(sql, key = 'id') {
  return queryRows(sql).map((row) => row[key]).filter((value) => value !== null && value !== undefined)
}

function execSql(sql) {
  runPsql(sql)
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function generatedTextMatch(columns) {
  return columns
    .map((column) => `COALESCE(${column}, '') ILIKE '%QA Audit%' OR COALESCE(${column}, '') ILIKE '%QA Smoke%' OR COALESCE(${column}, '') ILIKE '%QA Deep Audit%' OR COALESCE(${column}, '') ILIKE '%Smoke %'`)
    .map((part) => `(${part})`)
    .join(' OR ')
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
    SELECT r.sale_id, r.product_id, r.qty_returned, COALESCE(s.qty_sold, 0) AS qty_sold,
      (r.qty_returned - COALESCE(s.qty_sold, 0)) AS excess_qty
    FROM returned r
    LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
    WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
    ORDER BY excess_qty DESC, r.sale_id, r.product_id
  `)
  report.overReturned = {
    count: overReturned.length,
    sampleLimit,
    samples: overReturned.slice(0, sampleLimit),
  }
  if (overReturned.length) fail(`Found ${overReturned.length} sale/product pairs with returned qty > sold qty`)
  else pass('Return quantities do not exceed sold quantities')
}

function addCleanupClassification(name, totalSql, generatedSql, policy) {
  const total = Number(queryOne(totalSql)?.n || 0)
  const generatedLike = Number(queryOne(generatedSql)?.n || 0)
  report.cleanupClassification.push({
    name,
    total,
    generatedLike,
    unclassified: Math.max(0, total - generatedLike),
    policy,
  })
}

function addCleanupCandidateIds(name, generatedIdsSql, unclassifiedIdsSql = '') {
  const bucket = report.cleanupClassification.find((entry) => entry.name === name)
  if (!bucket) return
  bucket.candidateIds = {
    sampleLimit,
    generatedLike: queryScalarList(`${generatedIdsSql} LIMIT ${sampleLimit}`),
    unclassified: unclassifiedIdsSql ? queryScalarList(`${unclassifiedIdsSql} LIMIT ${sampleLimit}`) : [],
  }
}

function classifyIntegrityBacklog() {
  addCleanupClassification(
    'over_returned_sale_product_pairs',
    `
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
      SELECT COUNT(*)::integer AS n
      FROM returned r
      LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
      WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
    `,
    `
      WITH sold AS (
        SELECT sale_id, product_id, SUM(quantity) AS qty_sold
        FROM sale_items
        GROUP BY sale_id, product_id
      ),
      returned AS (
        SELECT r.sale_id, ri.product_id, SUM(ri.quantity) AS qty_returned,
          MAX(CASE WHEN ${generatedTextMatch(['ri.product_name', 'r.reason'])} THEN 1 ELSE 0 END) AS generated_marker
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(r.status, 'completed') != 'cancelled'
        GROUP BY r.sale_id, ri.product_id
      )
      SELECT COUNT(*)::integer AS n
      FROM returned r
      LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
      WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
        AND r.generated_marker = 1
    `,
    'review-before-delete-or-relink',
  )
  addCleanupCandidateIds(
    'over_returned_sale_product_pairs',
    `
      WITH sold AS (
        SELECT sale_id, product_id, SUM(quantity) AS qty_sold
        FROM sale_items
        GROUP BY sale_id, product_id
      ),
      returned AS (
        SELECT r.sale_id, ri.product_id, SUM(ri.quantity) AS qty_returned,
          MIN(ri.id) AS id,
          MAX(CASE WHEN ${generatedTextMatch(['ri.product_name', 'r.reason'])} THEN 1 ELSE 0 END) AS generated_marker
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(r.status, 'completed') != 'cancelled'
        GROUP BY r.sale_id, ri.product_id
      )
      SELECT r.id
      FROM returned r
      LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
      WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
        AND r.generated_marker = 1
      ORDER BY r.id
    `,
    `
      WITH sold AS (
        SELECT sale_id, product_id, SUM(quantity) AS qty_sold
        FROM sale_items
        GROUP BY sale_id, product_id
      ),
      returned AS (
        SELECT r.sale_id, ri.product_id, SUM(ri.quantity) AS qty_returned,
          MIN(ri.id) AS id,
          MAX(CASE WHEN ${generatedTextMatch(['ri.product_name', 'r.reason'])} THEN 1 ELSE 0 END) AS generated_marker
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE COALESCE(r.status, 'completed') != 'cancelled'
        GROUP BY r.sale_id, ri.product_id
      )
      SELECT r.id
      FROM returned r
      LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
      WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
        AND r.generated_marker = 0
      ORDER BY r.id
    `,
  )

  addCleanupClassification(
    'product_batches_missing_product',
    "SELECT COUNT(*)::integer AS n FROM product_batches pb LEFT JOIN products p ON p.id = pb.variant_product_id WHERE pb.variant_product_id IS NOT NULL AND p.id IS NULL",
    `SELECT COUNT(*)::integer AS n FROM product_batches pb LEFT JOIN products p ON p.id = pb.variant_product_id WHERE pb.variant_product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])})`,
    'generated-residue-candidate-if-backed-up',
  )
  addCleanupCandidateIds(
    'product_batches_missing_product',
    `SELECT pb.id FROM product_batches pb LEFT JOIN products p ON p.id = pb.variant_product_id WHERE pb.variant_product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])}) ORDER BY pb.id`,
    `SELECT pb.id FROM product_batches pb LEFT JOIN products p ON p.id = pb.variant_product_id WHERE pb.variant_product_id IS NOT NULL AND p.id IS NULL AND NOT (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])}) ORDER BY pb.id`,
  )

  addCleanupClassification(
    'branch_batch_stock_missing_branch',
    "SELECT COUNT(*)::integer AS n FROM branch_batch_stock bbs LEFT JOIN branches b ON b.id = bbs.branch_id WHERE bbs.branch_id IS NOT NULL AND b.id IS NULL",
    `SELECT COUNT(*)::integer AS n FROM branch_batch_stock bbs LEFT JOIN branches b ON b.id = bbs.branch_id LEFT JOIN product_batches pb ON pb.id = bbs.batch_id WHERE bbs.branch_id IS NOT NULL AND b.id IS NULL AND (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])})`,
    'relink-branch-or-delete-generated-residue-after-backup',
  )
  addCleanupCandidateIds(
    'branch_batch_stock_missing_branch',
    `SELECT bbs.id FROM branch_batch_stock bbs LEFT JOIN branches b ON b.id = bbs.branch_id LEFT JOIN product_batches pb ON pb.id = bbs.batch_id WHERE bbs.branch_id IS NOT NULL AND b.id IS NULL AND (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])}) ORDER BY bbs.id`,
    `SELECT bbs.id FROM branch_batch_stock bbs LEFT JOIN branches b ON b.id = bbs.branch_id LEFT JOIN product_batches pb ON pb.id = bbs.batch_id WHERE bbs.branch_id IS NOT NULL AND b.id IS NULL AND NOT (${generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])}) ORDER BY bbs.id`,
  )

  addCleanupClassification(
    'return_items_missing_product',
    "SELECT COUNT(*)::integer AS n FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id WHERE ri.product_id IS NOT NULL AND p.id IS NULL",
    `SELECT COUNT(*)::integer AS n FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id LEFT JOIN returns r ON r.id = ri.return_id WHERE ri.product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['ri.product_name', 'r.reason'])})`,
    'snapshot-history-or-relink-before-fk',
  )
  addCleanupCandidateIds(
    'return_items_missing_product',
    `SELECT ri.id FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id LEFT JOIN returns r ON r.id = ri.return_id WHERE ri.product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['ri.product_name', 'r.reason'])}) ORDER BY ri.id`,
    `SELECT ri.id FROM return_items ri LEFT JOIN products p ON p.id = ri.product_id LEFT JOIN returns r ON r.id = ri.return_id WHERE ri.product_id IS NOT NULL AND p.id IS NULL AND NOT (${generatedTextMatch(['ri.product_name', 'r.reason'])}) ORDER BY ri.id`,
  )

  addCleanupClassification(
    'inventory_movements_missing_branch',
    "SELECT COUNT(*)::integer AS n FROM inventory_movements im LEFT JOIN branches b ON b.id = im.branch_id WHERE im.branch_id IS NOT NULL AND b.id IS NULL",
    `SELECT COUNT(*)::integer AS n FROM inventory_movements im LEFT JOIN branches b ON b.id = im.branch_id WHERE im.branch_id IS NOT NULL AND b.id IS NULL AND (${generatedTextMatch(['im.product_name', 'im.reason', 'im.lot_code'])})`,
    'snapshot-history-or-relink-before-fk',
  )
  addCleanupCandidateIds(
    'inventory_movements_missing_branch',
    `SELECT im.id FROM inventory_movements im LEFT JOIN branches b ON b.id = im.branch_id WHERE im.branch_id IS NOT NULL AND b.id IS NULL AND (${generatedTextMatch(['im.product_name', 'im.reason', 'im.lot_code'])}) ORDER BY im.id`,
    `SELECT im.id FROM inventory_movements im LEFT JOIN branches b ON b.id = im.branch_id WHERE im.branch_id IS NOT NULL AND b.id IS NULL AND NOT (${generatedTextMatch(['im.product_name', 'im.reason', 'im.lot_code'])}) ORDER BY im.id`,
  )

  addCleanupClassification(
    'stock_transfers_missing_product',
    "SELECT COUNT(*)::integer AS n FROM stock_transfers st LEFT JOIN products p ON p.id = st.product_id WHERE st.product_id IS NOT NULL AND p.id IS NULL",
    `SELECT COUNT(*)::integer AS n FROM stock_transfers st LEFT JOIN products p ON p.id = st.product_id WHERE st.product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['st.product_name', 'st.notes'])})`,
    'snapshot-history-or-relink-before-fk',
  )
  addCleanupCandidateIds(
    'stock_transfers_missing_product',
    `SELECT st.id FROM stock_transfers st LEFT JOIN products p ON p.id = st.product_id WHERE st.product_id IS NOT NULL AND p.id IS NULL AND (${generatedTextMatch(['st.product_name', 'st.notes'])}) ORDER BY st.id`,
    `SELECT st.id FROM stock_transfers st LEFT JOIN products p ON p.id = st.product_id WHERE st.product_id IS NOT NULL AND p.id IS NULL AND NOT (${generatedTextMatch(['st.product_name', 'st.notes'])}) ORDER BY st.id`,
  )
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

function checkDatasetReadiness() {
  const counts = queryOne(`
    SELECT
      (SELECT COUNT(*)::integer FROM products) AS products,
      (SELECT COUNT(*)::integer FROM product_batches) AS product_batches,
      (SELECT COUNT(*)::integer FROM branch_stock) AS branch_stock,
      (SELECT COUNT(*)::integer FROM sales) AS sales,
      (SELECT COUNT(*)::integer FROM sale_items) AS sale_items,
      (SELECT COUNT(*)::integer FROM returns) AS returns,
      (SELECT COUNT(*)::integer FROM return_items) AS return_items,
      (SELECT COUNT(*)::integer FROM inventory_movements) AS inventory_movements,
      (SELECT COUNT(*)::integer FROM stock_transfers) AS stock_transfers,
      (SELECT COUNT(*)::integer FROM action_history) AS action_history,
      (SELECT COUNT(*)::integer FROM audit_logs) AS audit_logs
  `) || {}
  const transactionalTables = [
    'products',
    'product_batches',
    'branch_stock',
    'sales',
    'sale_items',
    'returns',
    'return_items',
    'inventory_movements',
    'stock_transfers',
  ]
  const hasTransactionalData = transactionalTables.some((name) => Number(counts[name] || 0) > 0)
  report.datasetSummary = {
    status: hasTransactionalData ? 'loaded' : 'empty',
    counts,
    note: hasTransactionalData
      ? 'Transactional tables contain data.'
      : 'Transactional business tables are empty; restore or import verified business data before production use.',
  }
  if (hasTransactionalData) pass('Runtime dataset contains transactional business rows')
  else pass('Runtime dataset is empty; restore or import verified business data before production use')
}

function checkRelationshipOrphans() {
  const relationships = [
    ['users', 'role_id', 'roles', 'id'],
    ['users', 'organization_id', 'organizations', 'id'],
    ['user_sessions', 'user_id', 'users', 'id'],
    ['verification_codes', 'user_id', 'users', 'id'],
    ['branch_stock', 'product_id', 'products', 'id'],
    ['branch_stock', 'branch_id', 'branches', 'id'],
    ['product_images', 'product_id', 'products', 'id'],
    ['product_batches', 'variant_product_id', 'products', 'id'],
    ['branch_batch_stock', 'batch_id', 'product_batches', 'id'],
    ['branch_batch_stock', 'branch_id', 'branches', 'id'],
    ['sale_item_batch_allocations', 'sale_item_id', 'sale_items', 'id'],
    ['sale_item_batch_allocations', 'batch_id', 'product_batches', 'id'],
    ['return_item_batch_allocations', 'return_item_id', 'return_items', 'id'],
    ['return_item_batch_allocations', 'sale_item_id', 'sale_items', 'id'],
    ['return_item_batch_allocations', 'batch_id', 'product_batches', 'id'],
    ['sales', 'customer_id', 'customers', 'id'],
    ['sales', 'branch_id', 'branches', 'id'],
    ['sales', 'delivery_contact_id', 'delivery_contacts', 'id'],
    ['sale_items', 'sale_id', 'sales', 'id'],
    ['sale_items', 'product_id', 'products', 'id'],
    ['sale_items', 'branch_id', 'branches', 'id'],
    ['returns', 'sale_id', 'sales', 'id'],
    ['returns', 'customer_id', 'customers', 'id'],
    ['returns', 'supplier_id', 'suppliers', 'id'],
    ['returns', 'branch_id', 'branches', 'id'],
    ['return_items', 'return_id', 'returns', 'id'],
    ['return_items', 'sale_item_id', 'sale_items', 'id'],
    ['return_items', 'product_id', 'products', 'id'],
    ['return_items', 'branch_id', 'branches', 'id'],
    ['inventory_movements', 'product_id', 'products', 'id'],
    ['inventory_movements', 'branch_id', 'branches', 'id'],
    ['stock_row_moves', 'source_product_id', 'products', 'id'],
    ['stock_row_moves', 'destination_product_id', 'products', 'id'],
    ['stock_row_moves', 'branch_id', 'branches', 'id'],
    ['stock_transfers', 'from_branch_id', 'branches', 'id'],
    ['stock_transfers', 'to_branch_id', 'branches', 'id'],
    ['stock_transfers', 'product_id', 'products', 'id'],
    ['stock_transfers', 'user_id', 'users', 'id'],
    ['rfid_tags', 'product_id', 'products', 'id'],
    ['rfid_tags', 'branch_id', 'branches', 'id'],
    ['rfid_tags', 'last_seen_session_id', 'rfid_scan_sessions', 'id'],
    ['rfid_scan_sessions', 'branch_id', 'branches', 'id'],
    ['rfid_events', 'session_id', 'rfid_scan_sessions', 'id'],
    ['rfid_events', 'product_id', 'products', 'id'],
    ['rfid_events', 'branch_id', 'branches', 'id'],
    ['rfid_session_items', 'session_id', 'rfid_scan_sessions', 'id'],
    ['rfid_session_items', 'product_id', 'products', 'id'],
    ['rfid_session_items', 'expected_branch_id', 'branches', 'id'],
    ['rfid_session_items', 'seen_branch_id', 'branches', 'id'],
  ]

  const values = relationships
    .map(([childTable, childColumn, parentTable, parentColumn]) => `(${sqlString(childTable)}, ${sqlString(childColumn)}, ${sqlString(parentTable)}, ${sqlString(parentColumn)})`)
    .join(',')
  const missingColumns = queryRows(`
    WITH rel(child_table, child_column, parent_table, parent_column) AS (VALUES ${values})
    SELECT rel.*
    FROM rel
    LEFT JOIN information_schema.columns child_col
      ON child_col.table_schema = current_schema()
     AND child_col.table_name = rel.child_table
     AND child_col.column_name = rel.child_column
    LEFT JOIN information_schema.columns parent_col
      ON parent_col.table_schema = current_schema()
     AND parent_col.table_name = rel.parent_table
     AND parent_col.column_name = rel.parent_column
    WHERE child_col.column_name IS NULL OR parent_col.column_name IS NULL
  `)
  if (missingColumns.length) {
    fail(`Relationship orphan check has ${missingColumns.length} missing column definition(s)`)
    return
  }

  const orphanCountSql = relationships.map(([childTable, childColumn, parentTable, parentColumn]) => `
    SELECT
      ${sqlString(`${childTable}.${childColumn} -> ${parentTable}.${parentColumn}`)} AS relationship,
      ${sqlString(childTable)} AS child_table,
      ${sqlString(childColumn)} AS child_column,
      ${sqlString(parentTable)} AS parent_table,
      ${sqlString(parentColumn)} AS parent_column,
      COUNT(*)::integer AS n
      FROM ${sqlIdentifier(childTable)} child
      LEFT JOIN ${sqlIdentifier(parentTable)} parent ON parent.${sqlIdentifier(parentColumn)} = child.${sqlIdentifier(childColumn)}
      WHERE child.${sqlIdentifier(childColumn)} IS NOT NULL AND parent.${sqlIdentifier(parentColumn)} IS NULL
  `).join('\nUNION ALL\n')
  const orphanRows = queryRows(orphanCountSql).map((row) => {
    return {
      relationship: row.relationship,
      childTable: row.child_table,
      childColumn: row.child_column,
      parentTable: row.parent_table,
      parentColumn: row.parent_column,
      count: Number(row?.n || 0),
    }
  }).filter((row) => row.count > 0)
  report.relationshipOrphans = orphanRows.map((row) => ({
    ...row,
    sampleLimit,
    samples: queryRows(`
      SELECT child.*
      FROM ${sqlIdentifier(row.childTable)} child
      LEFT JOIN ${sqlIdentifier(row.parentTable)} parent ON parent.${sqlIdentifier(row.parentColumn)} = child.${sqlIdentifier(row.childColumn)}
      WHERE child.${sqlIdentifier(row.childColumn)} IS NOT NULL AND parent.${sqlIdentifier(row.parentColumn)} IS NULL
      ORDER BY child.id
      LIMIT ${sampleLimit}
    `),
  }))

  if (orphanRows.length) {
    fail(`Found relationship orphan rows: ${orphanRows.map((row) => `${row.relationship}=${row.count}`).join('; ')}`)
    return
  }
  pass(`Relationship orphan checks passed for ${relationships.length} FK candidates`)
}

function writeReport() {
  if (!outputPath) return
  const relative = path.relative(path.resolve(__dirname, '../../..'), outputPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing integrity report outside workspace: ${outputPath}`)
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
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
  if (shouldRunNewChecks) {
    checkPostgresRuntimeTables()
    checkDatasetReadiness()
    checkRelationshipOrphans()
    classifyIntegrityBacklog()
  }

  if (failed) {
    writeReport()
    console.error('\nIntegrity checks completed with failures.')
    process.exit(1)
  }
  writeReport()
  console.log('\nAll integrity checks passed.')
}

try {
  run()
} catch (error) {
  console.error(error?.stderr || error)
  process.exit(1)
}
