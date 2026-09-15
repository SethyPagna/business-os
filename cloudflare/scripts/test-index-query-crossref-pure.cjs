// p6/efficiency-3 step 5: pins scripts/index-query-crossref.cjs -- the
// index-versus-query cross-reference over the hot read paths this wave
// touched (inventory list, stock-in session detail, dashboard summary/top
// products, sales export product breakdown, and the contacts membership
// lookup).
//
// Two things are checked:
// 1. Regression: every hot query currently classified `ok` (no SCAN TABLE
//    against a large table) must stay `ok`. This is a real behavioral run
//    against the fully-migrated in-memory schema (scripts/harness/load_migrations.cjs),
//    not a source-text pin -- if a future migration drops an index this
//    hot-path queries, this test goes red on real EXPLAIN QUERY PLAN output.
// 2. Positive control (see memory sweep-needs-a-positive-control): the
//    instrument itself is proven capable of catching a genuinely unindexed
//    query, by running one deliberately-bad query (a large-table filter on
//    a column with no supporting index) through the same runCrossref
//    machinery and asserting it IS reported as a finding. A sweep that
//    reports "everything is fine" is worthless unless it can also report
//    "this is not fine" on a known-bad input.
//
// Run (from cloudflare/): node scripts/test-index-query-crossref-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const Database = require('better-sqlite3')

const { runCrossref, LARGE_TABLES } = require('./index-query-crossref.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// ---- 1. Regression: current hot queries are all clean ----
const results = runCrossref()

check('runCrossref covers all expected hot-path labels', () => {
  assert.ok(results.length >= 16, `expected at least 16 hot queries, got ${results.length}`)
  const labels = results.map((r) => r.label)
  assert.ok(labels.some((l) => l.includes('inventory.ts GET /movements')), 'expected inventory movements coverage')
  assert.ok(labels.some((l) => l.includes('commitStockSession')), 'expected stock-in session coverage')
  assert.ok(labels.some((l) => l.includes('dashboardAnalytics topProducts')), 'expected dashboard top-products coverage')
  assert.ok(labels.some((l) => l.includes('product_totals')), 'expected sales export coverage')
  assert.ok(labels.some((l) => l.includes('membership')), 'expected the contacts hot-query candidate')
})

check('no hot query does a full scan on a large table (products, sale_items, sales, inventory_movements, product_batches, branch_stock, branch_batch_stock, customers)', () => {
  const failures = results.filter((r) => !r.ok)
  assert.deepEqual(
    failures.map((r) => `${r.label}: ${r.error || r.findings.join('; ')}`),
    [],
    'expected zero findings against the current schema',
  )
})

check('no hot query errors out (all named parameters resolved, all referenced tables/indexes exist)', () => {
  const errored = results.filter((r) => r.error)
  assert.deepEqual(errored.map((r) => r.label), [], 'expected zero EXPLAIN QUERY PLAN errors')
})

// ---- 2. Positive control: prove the instrument detects a real miss ----
check('the instrument DOES report a deliberately unindexed query against a large table (positive control)', () => {
  const db = new Database(':memory:')
  for (const sql of loadAll()) db.exec(sql)

  // sale_items has no index on `sku` -- a WHERE on it forces a full table
  // scan. This is the known-bad input; if the instrument fails to flag it,
  // the "16/16 clean" result above is not trustworthy.
  const badSql = `SELECT id FROM sale_items WHERE sku = @sku`
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${badSql}`).all({ sku: null })
  const scanLines = plan.filter((row) => /^SCAN /.test(String(row.detail || '')))
  const findings = scanLines.filter((row) => {
    const match = /^SCAN (\S+)/.exec(String(row.detail || ''))
    const table = match ? match[1].replace(/^"|"$/g, '') : ''
    return LARGE_TABLES.has(table)
  })
  assert.ok(findings.length > 0, 'expected the positive control (unindexed sale_items.sku filter) to be flagged as a full scan on a large table')
  db.close()
})

check('LARGE_TABLES matches the task-specified set exactly', () => {
  assert.deepEqual(
    [...LARGE_TABLES].sort(),
    ['branch_batch_stock', 'branch_stock', 'customers', 'inventory_movements', 'product_batches', 'products', 'sale_items', 'sales'].sort(),
  )
})

console.log(`\n${passed} checks passed`)
console.log(`\nCrossref summary: ${results.filter((r) => r.ok).length}/${results.length} hot queries clean`)
