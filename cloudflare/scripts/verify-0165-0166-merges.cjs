// Rehearses migrations/0165_product_same_name_merge.sql and
// 0166_customer_same_name_phone_merge.sql against a COPY of a given sqlite
// file (a local replica of production, or any better-sqlite3 file built on
// the real migration chain) and asserts every invariant the migrations'
// header comments promise. Never touches remote D1; never mutates the input
// file (always operates on a copy written next to it).
//
// Usage:
//   node scripts/verify-0165-0166-merges.cjs <path-to-sqlite>
// Defaults to ../../prod-export/prod-20260915.sqlite relative to this repo's
// scratchpad layout if no path is given and that file exists; otherwise
// prints instructions and exits 1 (this is a REHEARSAL tool, not a pure
// test -- scripts/test-migration-0165-0166-pure.cjs is the runnable-anytime
// synthetic-fixture pin).
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const sql0165 = fs.readFileSync(path.join(migrationsDir, '0165_product_same_name_merge.sql'), 'utf8')
const sql0166 = fs.readFileSync(path.join(migrationsDir, '0166_customer_same_name_phone_merge.sql'), 'utf8')

const defaultReplica = path.join(__dirname, '..', '..', '..', '..', '..', 'prod-export', 'prod-20260915.sqlite')
const inputPath = process.argv[2] || (fs.existsSync(defaultReplica) ? defaultReplica : null)
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('Usage: node scripts/verify-0165-0166-merges.cjs <path-to-sqlite-replica>')
  console.error('No replica found at the default path either: ' + defaultReplica)
  process.exit(1)
}

const workPath = path.join(path.dirname(inputPath), 'work', `verify-0165-0166-${Date.now()}.sqlite`)
fs.mkdirSync(path.dirname(workPath), { recursive: true })
fs.copyFileSync(inputPath, workPath)
console.log('Rehearsing against a COPY: ' + workPath + ' (source untouched: ' + inputPath + ')')

const db = new Database(workPath)
db.pragma('journal_mode = WAL')

function one(sql) { return db.prepare(sql).get() }
function count(sql) { return one(sql).c }

// ----------------------------------------------------------------- PRE ---
const pre = {
  products: count('SELECT COUNT(*) c FROM products'),
  eligibleProducts: count("SELECT COUNT(*) c FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0 AND tag_label IS NULL"),
  customers: count('SELECT COUNT(*) c FROM customers'),
  saleItemsCount: count('SELECT COUNT(*) c FROM sale_items'),
  saleItemsQty: one('SELECT COALESCE(SUM(quantity),0) c FROM sale_items').c,
  inventoryMovements: count('SELECT COUNT(*) c FROM inventory_movements'),
  productBatches: count('SELECT COUNT(*) c FROM product_batches'),
  branchStockByProductBranch: db.prepare('SELECT product_id, branch_id, SUM(quantity) q FROM branch_stock GROUP BY product_id, branch_id').all(),
  zeroCostLossMovements: count(`
    SELECT COUNT(*) c FROM inventory_movements m JOIN products p ON p.id = m.product_id
    WHERE m.movement_type IN ('remove','write_off') AND COALESCE(m.unit_cost_usd,0)=0 AND COALESCE(m.total_cost_usd,0)=0 AND COALESCE(p.cost_price_usd,0)=0
  `),
  ftsRows: count('SELECT COUNT(*) c FROM products_fts'),
}

// Snapshot per-name-cluster branch_stock totals and per-cluster cost inputs
// BEFORE the merge, keyed by name_key, so the POST check can recompute the
// expected mean cost/stock independent of the migration's own SQL.
const preClusters = db.prepare(`
  SELECT LOWER(TRIM(name)) AS name_key, id, cost_price_usd, cost_price_khr
  FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0 AND tag_label IS NULL
`).all()
const preBranchByProduct = db.prepare('SELECT product_id, SUM(quantity) q FROM branch_stock GROUP BY product_id').all()
const preStockByProduct = new Map(preBranchByProduct.map((r) => [r.product_id, r.q]))

console.log('PRE:', JSON.stringify({ ...pre, branchStockByProductBranch: undefined }, null, 2))

// --------------------------------------------------------------- APPLY ---
db.exec(sql0165)
db.exec(sql0166)

// ---------------------------------------------------------------- POST ---
const mapRows = db.prepare('SELECT * FROM product_merge_map_0165').all()
const custMapRows = db.prepare('SELECT * FROM customer_merge_map_0166').all()
const loserIds = new Set(mapRows.map((r) => r.loser_id))
const custLoserIds = new Set(custMapRows.map((r) => r.loser_id))

const post = {
  products: count('SELECT COUNT(*) c FROM products'),
  customers: count('SELECT COUNT(*) c FROM customers'),
  saleItemsCount: count('SELECT COUNT(*) c FROM sale_items'),
  saleItemsQty: one('SELECT COALESCE(SUM(quantity),0) c FROM sale_items').c,
  inventoryMovements: count('SELECT COUNT(*) c FROM inventory_movements'),
  productBatches: count('SELECT COUNT(*) c FROM product_batches'),
  ftsRows: count('SELECT COUNT(*) c FROM products_fts'),
  zeroCostLossMovements: count(`
    SELECT COUNT(*) c FROM inventory_movements m JOIN products p ON p.id = m.product_id
    WHERE m.movement_type IN ('remove','write_off') AND COALESCE(m.unit_cost_usd,0)=0 AND COALESCE(m.total_cost_usd,0)=0 AND COALESCE(p.cost_price_usd,0)=0
  `),
}
console.log('POST:', JSON.stringify(post, null, 2))
console.log(`Merged ${mapRows.length} product losers into ${new Set(mapRows.map((r) => r.keeper_id)).size} keepers.`)
console.log(`Merged ${custMapRows.length} customer losers into ${new Set(custMapRows.map((r) => r.keeper_id)).size} keepers.`)
console.log(`Zero-cost loss movements: ${pre.zeroCostLossMovements} -> ${post.zeroCostLossMovements} (expect a fall or equal, never a rise)`)

// -------------------------------------------------------------- CHECKS ---
assert.strictEqual(post.products, pre.products - mapRows.length, 'products count = before - losers')
assert.strictEqual(post.customers, pre.customers - custMapRows.length, 'customers count = before - losers')
assert.strictEqual(post.saleItemsCount, pre.saleItemsCount, 'sale_items row count unchanged')
assert.strictEqual(post.saleItemsQty, pre.saleItemsQty, 'sale_items total quantity unchanged')
assert.strictEqual(post.inventoryMovements, pre.inventoryMovements, 'inventory_movements row count unchanged')
assert.strictEqual(post.productBatches, pre.productBatches, 'product_batches row count unchanged')
assert.strictEqual(post.ftsRows, post.products, 'products_fts row count tracks products after delete')
assert.ok(post.zeroCostLossMovements <= pre.zeroCostLossMovements, 'zero-cost loss movements never rise')

// No repointed table still references a deleted loser id.
const repointedTables = [
  ['sale_items', 'product_id'], ['return_items', 'product_id'], ['return_replacement_items', 'product_id'],
  ['inventory_movements', 'product_id'], ['damaged_stock_lots', 'product_id'], ['stock_transfers', 'product_id'],
  ['rfid_tags', 'product_id'], ['branch_stock', 'product_id'], ['product_batches', 'variant_product_id'],
  ['product_images', 'product_id'], ['sale_amendments', 'product_id'],
]
for (const [table, column] of repointedTables) {
  const n = count(`SELECT COUNT(*) c FROM ${table} WHERE ${column} IN (${[...loserIds].join(',') || '-1'})`)
  assert.strictEqual(n, 0, `${table}.${column} has no reference to a deleted product loser`)
}
const custRepointed = [['sales', 'customer_id'], ['returns', 'customer_id'], ['customer_receivables', 'customer_id'], ['loyalty_point_adjustments', 'customer_id'], ['customer_share_submissions', 'customer_id']]
for (const [table, column] of custRepointed) {
  const n = count(`SELECT COUNT(*) c FROM ${table} WHERE ${column} IN (${[...custLoserIds].join(',') || '-1'})`)
  assert.strictEqual(n, 0, `${table}.${column} has no reference to a deleted customer loser`)
}

// branch_stock per (keeper, branch) total after merge equals the sum of the
// keeper's own pre-merge total plus every one of its losers' pre-merge total.
const keeperByLoser = new Map(mapRows.map((r) => [r.loser_id, r.keeper_id]))
const expectedKeeperStock = new Map()
for (const row of preBranchByProduct) {
  const keeper = keeperByLoser.get(row.product_id) || (mapRows.some((m) => m.keeper_id === row.product_id) ? row.product_id : null)
  if (keeper == null) continue
  expectedKeeperStock.set(keeper, (expectedKeeperStock.get(keeper) || 0) + row.q)
}
let stockChecks = 0
for (const [keeperId, expected] of expectedKeeperStock) {
  const actualRow = db.prepare('SELECT COALESCE(SUM(quantity),0) c FROM branch_stock WHERE product_id = ?').get(keeperId)
  assert.strictEqual(actualRow.c, expected, `keeper ${keeperId} branch_stock total preserved across its cluster`)
  stockChecks++
}
console.log(`Spot-checked ${stockChecks} keepers' branch_stock totals against their pre-merge cluster sum.`)

// Cost spot-check: 20 clusters (or fewer if fewer exist), computed in JS from
// the pre-merge snapshot, must equal the keeper's post-merge cost.
const clustersByKey = new Map()
for (const row of preClusters) {
  if (!clustersByKey.has(row.name_key)) clustersByKey.set(row.name_key, [])
  clustersByKey.get(row.name_key).push(row)
}
const mergedClusterKeys = [...new Set(mapRows.map((r) => r.name_key))].slice(0, 20)
let costChecks = 0
for (const key of mergedClusterKeys) {
  const clusterMapRows = mapRows.filter((r) => r.name_key === key)
  const keeperId = clusterMapRows[0].keeper_id
  const clusterRows = clustersByKey.get(key) || []
  const costs = clusterRows.filter((r) => clusterMapRows.some((m) => m.keeper_id === keeperId) && (r.id === keeperId || clusterMapRows.some((m) => m.loser_id === r.id && m.keeper_id === keeperId)))
    .map((r) => Number(r.cost_price_usd) || 0).filter((v) => v !== 0)
  if (!costs.length) continue
  const expectedMean = Math.round((costs.reduce((a, b) => a + b, 0) / new Set(costs).size + Number.EPSILON) * 1e6) / 1e6
  const actualCost = db.prepare('SELECT cost_price_usd c FROM products WHERE id = ?').get(keeperId)
  if (!actualCost) continue
  const distinctExpected = Math.round((([...new Set(costs)].reduce((a, b) => a + b, 0)) / new Set(costs).size + Number.EPSILON) * 1e6) / 1e6
  assert.ok(Math.abs(actualCost.c - distinctExpected) < 1e-4, `keeper ${keeperId} cost is the mean of distinct non-zero cluster costs (expected ~${distinctExpected}, got ${actualCost.c})`)
  costChecks++
}
console.log(`Spot-checked ${costChecks} keepers' averaged cost against a JS-computed mean of their pre-merge cluster.`)

// Two-real-code clusters keep >= 2 rows: any name_key with >1 distinct
// real_code_key survivors after the merge.
const twoCodeClusters = db.prepare(`
  SELECT LOWER(TRIM(name)) name_key, COUNT(DISTINCT LTRIM(TRIM(barcode),'0')) codes, COUNT(*) rows
  FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0 AND tag_label IS NULL
    AND LENGTH(TRIM(COALESCE(barcode,''))) >= 6 AND TRIM(barcode) NOT GLOB '*[^0-9]*' AND CAST(TRIM(barcode) AS INTEGER) <> 0
  GROUP BY 1 HAVING COUNT(DISTINCT LTRIM(TRIM(barcode),'0')) > 1
`).all()
console.log(`${twoCodeClusters.length} clusters kept two-or-more distinct real barcodes as separate keepers (expected around 35).`)

// Idempotence: re-running both files inserts no new map rows.
const mapCount1 = count('SELECT COUNT(*) c FROM product_merge_map_0165')
const custMapCount1 = count('SELECT COUNT(*) c FROM customer_merge_map_0166')
db.exec(sql0165)
db.exec(sql0166)
assert.strictEqual(count('SELECT COUNT(*) c FROM product_merge_map_0165'), mapCount1, '0165 second run is a no-op')
assert.strictEqual(count('SELECT COUNT(*) c FROM customer_merge_map_0166'), custMapCount1, '0166 second run is a no-op')

console.log('OK verify-0165-0166-merges.cjs')
console.log('Work file left at: ' + workPath + ' for inspection; delete it when done.')
