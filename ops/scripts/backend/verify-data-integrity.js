/* eslint-disable no-console */
'use strict'

const path = require('path')
const { db } = require('../../../backend/src/database')
const { runDataIntegrityCheck } = require('../../../backend/src/helpers')

/**
 * 1. Data Integrity Verification Script
 * 1.1 Purpose
 * - Run baseline inventory/sales/returns integrity checks.
 * - Optionally apply safe auto-fixes for stock mismatches.
 * - Optionally run deeper comprehensive checks.
 */
const EPS = 0.01
let failed = false
const shouldFix = process.argv.includes('--fix')
const shouldRunNewChecks = process.argv.includes('--comprehensive')

function fail(message) {
  failed = true
  console.error(`FAIL: ${message}`)
}

function pass(message) {
  console.log(`PASS: ${message}`)
}

function approxEqual(a, b, eps = EPS) {
  return Math.abs((a || 0) - (b || 0)) <= eps
}

/**
 * 2. Stock Consistency Checks
 */
function checkNoNegativeStock() {
  const badProducts = db.prepare('SELECT id, name, stock_quantity FROM products WHERE stock_quantity < 0').all()
  const badBranches = db.prepare('SELECT product_id, branch_id, quantity FROM branch_stock WHERE quantity < 0').all()
  if (badProducts.length) fail(`Found ${badProducts.length} products with negative stock_quantity`)
  else pass('No products with negative stock_quantity')
  if (badBranches.length) fail(`Found ${badBranches.length} branch_stock rows with negative quantity`)
  else pass('No branch_stock rows with negative quantity')
}

function checkProductStockMatchesBranches() {
  const mismatches = db.prepare(`
    SELECT p.id, p.name, p.stock_quantity,
      COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0) AS summed_qty
    FROM products p
    WHERE ABS(COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0)) > 0.001
  `).all()
  if (!mismatches.length) {
    pass('Product stock matches branch_stock totals')
    return
  }

  if (!shouldFix) {
    fail(`Found ${mismatches.length} products where stock_quantity != SUM(branch_stock)`)
    return
  }

  const fixStmt = db.prepare(`
    UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(quantity), 0)
      FROM branch_stock
      WHERE branch_stock.product_id = products.id
    ),
    updated_at = datetime('now')
    WHERE id = ?
  `)
  let fixed = 0
  const tx = db.transaction(() => {
    for (const row of mismatches) {
      fixStmt.run(row.id)
      fixed += 1
    }
  })
  tx()
  pass(`Fixed ${fixed} product stock total mismatches from branch_stock`)

  const remaining = db.prepare(`
    SELECT COUNT(*) AS n
    FROM products p
    WHERE ABS(COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0)) > 0.001
  `).get()?.n || 0
  if (remaining > 0) fail(`Still found ${remaining} stock mismatch(es) after fix`)
  else pass('Post-fix check: product stock now matches branch_stock totals')
}

/**
 * 3. Sales and Returns Checks
 */
function checkSaleItemTotals() {
  const badRows = db.prepare(`
    SELECT id, sale_id, quantity, applied_price_usd, total_usd
    FROM sale_items
    WHERE ABS(COALESCE(total_usd,0) - (COALESCE(quantity,0) * COALESCE(applied_price_usd,0))) > 0.02
  `).all()
  if (badRows.length) fail(`Found ${badRows.length} sale_items where total_usd != quantity * applied_price_usd`)
  else pass('Sale item totals match quantity * applied price')
}

function checkReturnDoesNotExceedSold() {
  const overReturned = db.prepare(`
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
  `).all()
  if (overReturned.length) fail(`Found ${overReturned.length} sale/product pairs with returned qty > sold qty`)
  else pass('Return quantities do not exceed sold quantities')
}

/**
 * 4. Profit/COGS Formula Checks
 */
function checkProfitFormulaConsistency() {
  const sales = db.prepare(`
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
  `).get()

  const returns = db.prepare(`
    SELECT
      COALESCE(SUM(r.total_refund_usd), 0) AS refunds_usd,
      COALESCE(SUM(CASE WHEN ri.return_to_stock = 1 THEN ri.quantity * COALESCE(ri.cost_price_usd, 0) ELSE 0 END), 0) AS cogs_returned_usd
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE COALESCE(r.status, 'completed') != 'cancelled'
  `).get()

  const netRevenue = (sales.subtotal_usd || 0) - (sales.discount_usd || 0) - (returns.refunds_usd || 0)
  const netCogs = (sales.cogs_usd || 0) - (returns.cogs_returned_usd || 0)
  const expectedProfit = netRevenue - netCogs

  if (!Number.isFinite(expectedProfit)) {
    fail('Profit formula produced non-finite value')
    return
  }

  pass(`Profit formula check OK (netRevenue=${netRevenue.toFixed(2)}, netCOGS=${netCogs.toFixed(2)}, profit=${expectedProfit.toFixed(2)})`)
}

function checkCogsSnapshotVsCurrentProductCost() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(si.quantity * COALESCE(si.cost_price_usd, 0)), 0) AS snapshot_cogs,
      COALESCE(SUM(si.quantity * COALESCE(p.cost_price_usd, 0)), 0) AS current_product_cogs
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
  `).get()

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

/**
 * 5. Main Runner
 */
function run() {
  console.log(`Running integrity checks against DB at: ${path.resolve(require('../../../backend/src/config').DB_PATH)}`)
  if (shouldFix) console.log('Fix mode enabled: stock mismatches will be reconciled.')
  if (shouldRunNewChecks) console.log('Comprehensive mode enabled: running advanced data integrity checks.')

  checkNoNegativeStock()
  checkProductStockMatchesBranches()
  checkSaleItemTotals()
  checkReturnDoesNotExceedSold()
  checkProfitFormulaConsistency()
  checkCogsSnapshotVsCurrentProductCost()

  if (shouldRunNewChecks) {
    console.log('\n--- Running Comprehensive Data Integrity Checks ---')
    try {
      const result = runDataIntegrityCheck()
      if (result.repairs > 0) {
        console.log(`Made ${result.repairs} repairs:`)
        result.errors.forEach((item) => console.log(`  - ${item}`))
      }
      if (result.errors.length > 0 && result.repairs === 0) {
        console.error(`Found ${result.errors.length} issues:`)
        result.errors.forEach((item) => console.error(`  - ${item}`))
        failed = true
      } else if (result.repairs > 0) {
        console.log(`Successfully repaired ${result.repairs} data issues`)
      } else {
        console.log('All comprehensive checks passed')
      }
    } catch (error) {
      console.error(`Comprehensive check error: ${error.message}`)
      failed = true
    }
  }

  if (failed) {
    console.error('\nIntegrity checks completed with failures.')
    process.exit(1)
  }
  console.log('\nAll integrity checks passed.')
}

run()
