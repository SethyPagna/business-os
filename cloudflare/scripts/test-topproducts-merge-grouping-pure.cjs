// p6/efficiency-3 step 3 (coordinator-added linkage sweep finding):
// routes/compat.ts's dashboard "top products" (topProducts/topProductsQty)
// and routes/sales.ts's export product breakdown used to GROUP BY
// (si.product_id, si.product_name). After a product merge (migration
// 0165+) the keeper id's sale_items rows carry SEVERAL different pre-merge
// product_name snapshots across different sales, so that pair-grouping
// split one merged product's history back into N rows -- one per historical
// name -- instead of one row under the product's current name.
//
// Two checks:
// 1. Source lock: the actual queries in both files group by product_id
//    only (COALESCE(...,0) with a name-fallback branch for NULL-id lines)
//    and read the display name live from `products`, not from the raw
//    per-line snapshot.
// 2. Behavioral: the corrected GROUP BY shape, run against a real
//    better-sqlite3 fixture with one keeper id under two legacy names,
//    produces exactly ONE row with qty/revenue summed across both names and
//    the CURRENT product name -- and the OLD (product_id, product_name)
//    shape, run against the identical fixture, is proven to still split
//    into two rows (the regression this locks against).
//
// Run (from cloudflare/): node scripts/test-topproducts-merge-grouping-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
const compatSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'compat.ts'), 'utf8')
const salesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label}: start marker not found`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label}: end marker not found after start`)
  return source.slice(start, end)
}

// ---- 1. Source lock ----------------------------------------------------
check('compat.ts topProducts/topProductsQty group by product_id only, name from live products', () => {
  // End the slice at the next top-level declaration, not at the first
  // app.get('/dashboard' -- P11-16 (4cde5947) inserted dashboardInsightList
  // between the two, and that function legitimately reuses the SAME id-only
  // GROUP BY (its whole point is to serve the untruncated form of these very
  // lists), so the old window swallowed a third correct occurrence and read
  // it as a drift. This asserts the shape of dashboardAnalytics alone.
  const block = sliceBetween(compatSource, 'async function dashboardAnalytics', 'async function dashboardInsightList', 'compat.ts dashboardAnalytics fan-out')
  const groupByMatches = block.match(/GROUP BY COALESCE\(si\.product_id, 0\), CASE WHEN si\.product_id IS NULL THEN lower\(trim\(COALESCE\(si\.product_name, ''\)\)\) ELSE '' END/g) || []
  assert.equal(groupByMatches.length, 2, 'expected the id-only GROUP BY shape on both topProducts and topProductsQty')
  const nameExprMatches = block.match(/COALESCE\(MAX\(p\.name\), MAX\(si\.product_name\)\) AS product_name/g) || []
  assert.equal(nameExprMatches.length, 2, 'expected the live-name expression on both topProducts and topProductsQty')
  assert.match(block, /LEFT JOIN products p ON p\.id = si\.product_id/, 'expected a LEFT JOIN to products for the live name')
})

// P11-16 (4cde5947) gave the dashboard's four truncated insight lists an
// untruncated backing endpoint. dashboardInsightList's top_products query is
// the SAME list as dashboardAnalytics' topProducts, just uncapped, so it must
// merge identically -- a sibling surface that grouped by (id, name) would show
// one renamed product as two rows the moment the customer clicked View more.
check('compat.ts dashboardInsightList reuses the id-only GROUP BY and the live-name expression', () => {
  const block = sliceBetween(compatSource, 'async function dashboardInsightList', "app.get('", 'compat.ts dashboardInsightList')
  assert.match(
    block,
    /GROUP BY COALESCE\(si\.product_id, 0\), CASE WHEN si\.product_id IS NULL THEN lower\(trim\(COALESCE\(si\.product_name, ''\)\)\) ELSE '' END/,
    'the untruncated product list must group by product_id only, exactly like the preview it replaces',
  )
  assert.match(block, /COALESCE\(MAX\(p\.name\), MAX\(si\.product_name\)\) AS product_name/, 'and take the live name the same way')
  assert.match(block, /LEFT JOIN products p ON p\.id = si\.product_id/, 'and LEFT JOIN products for it')
})

check('sales.ts export product_totals groups by product_id only, name from live products', () => {
  const block = sliceBetween(salesSource, 'const productRows = await db.prepare', ').all<ProductBreakdownRow>(snapshotParams)', 'sales.ts export product breakdown')
  assert.match(
    block,
    /GROUP BY COALESCE\(pl\.product_id, 0\), CASE WHEN pl\.product_id IS NULL THEN lower\(trim\(COALESCE\(pl\.product_name, ''\)\)\) ELSE '' END/,
    'expected the id-only GROUP BY shape on product_totals',
  )
  assert.match(block, /COALESCE\(MAX\(p\.name\), MAX\(pl\.product_name\)\) AS product_name/, 'expected the live-name expression on product_totals')
  assert.match(block, /LEFT JOIN products p ON p\.id = pl\.product_id/, 'expected a LEFT JOIN to products for the live name')
})

// ---- 2. Behavioral: real SQLite, one keeper id under two legacy names ---
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, product_name TEXT, quantity REAL, total_usd REAL);
`)
// Product 1 is the merge keeper, renamed to its current name after absorbing
// a duplicate that used to be sold under "Old Name B".
db.exec(`INSERT INTO products (id, name) VALUES (1, 'Current Canonical Name')`)
db.exec(`
  INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, total_usd) VALUES
    (1, 100, 1, 'Old Name A', 3, 30),
    (2, 101, 1, 'Old Name B', 5, 50),
    (3, 102, 1, 'Old Name A', 2, 20)
`)

const FIXED_GROUP_BY = `
  SELECT si.product_id, COALESCE(MAX(p.name), MAX(si.product_name)) AS product_name,
         SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS revenue_usd
  FROM sale_items si
  LEFT JOIN products p ON p.id = si.product_id
  GROUP BY COALESCE(si.product_id, 0), CASE WHEN si.product_id IS NULL THEN lower(trim(COALESCE(si.product_name, ''))) ELSE '' END
`
const OLD_BROKEN_GROUP_BY = `
  SELECT si.product_id, si.product_name, SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS revenue_usd
  FROM sale_items si
  GROUP BY si.product_id, si.product_name
`

check('fixed GROUP BY shape merges one keeper id under two legacy names into one row', () => {
  const rows = db.prepare(FIXED_GROUP_BY).all()
  assert.equal(rows.length, 1, `expected exactly one row, got ${rows.length}`)
  assert.equal(rows[0].product_id, 1)
  assert.equal(rows[0].product_name, 'Current Canonical Name')
  assert.equal(rows[0].qty_sold, 10)
  assert.equal(rows[0].revenue_usd, 100)
})

check('the OLD (product_id, product_name) shape is proven to still split the same fixture (regression this locks against)', () => {
  const rows = db.prepare(OLD_BROKEN_GROUP_BY).all()
  assert.equal(rows.length, 2, `expected the old shape to split into 2 rows (one per legacy name), got ${rows.length}`)
})

check('a deleted product_id (no products row) still falls back to its own snapshot name, not merged with unrelated NULL rows', () => {
  db.exec(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, total_usd) VALUES
    (10, 200, NULL, 'Legacy Import Row', 1, 9),
    (11, 201, NULL, 'Another Legacy Row', 2, 18)`)
  const rows = db.prepare(FIXED_GROUP_BY).all().filter((r) => r.product_id == null)
  assert.equal(rows.length, 2, 'two distinct NULL-id names must stay two separate rows, not merged into one NULL bucket')
})

console.log(`\n${passed} checks passed`)
