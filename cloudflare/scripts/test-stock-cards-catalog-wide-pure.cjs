// Lock: STOCK figures are never scoped to a selected date range.
//
// User directive, 2026-09-03: "products, and stock value must show all ...
// same in branches." The product count, the in/low/out-of-stock counts, the
// stock quantity and the stock value, and the low-stock / out-of-stock /
// expiring alert lists and their counts are CURRENT STATE for the whole
// active catalog. A selected Start->End range governs the FLOW figures only
// (sales, returns, revenue, cost in/out, the charts, the recent-sales feed);
// a period number may appear inside a stock card as a secondary line, never
// as its face value. This is the deliberate exception to the project's
// otherwise standing "one range scopes the list AND the stats" convention.
//
// What broke and why this file exists: compat.ts's dashboardSummary grew a
// `productInRangeClause` (EXISTS a recognized sale for this product inside
// the range) and applied it to the family stock stats and to all four alert
// queries. A product that is out of stock CANNOT sell, so everything out of
// stock for the whole window silently dropped off the out-of-stock alert --
// the card was closest to empty exactly when it mattered most -- and
// slow-moving stock stopped raising low-stock and expiry warnings at all.
//
// Every getFamilyStockStats() caller in the Worker is checked, not just the
// dashboard: routes/branches.ts (the branch hub's stats and the per-branch
// stock summary) and routes/inventory.ts (/stats and /bootstrap). The
// dashboard no longer calls it: since G39 item 1 (b8ec738d8) compat.ts
// dashboardSummary takes its whole stock block from
// lib/dashboardStockOverview.ts (loadDashboardStockOverview ->
// getFamilyStockOverview, one statement, cached), which is pinned below on
// the same terms. The static getFamilyStockStats call sites all
// read `whereSql: 'WHERE p.is_active = 1'`, and the two that build a WHERE
// dynamically build it from branch/search predicates only. That shape is
// what this file pins, so the sibling audit is mechanical rather than done
// by eye.
//
// Run (from cloudflare/): node scripts/test-stock-cards-catalog-wide-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
const compat = read('src', 'routes', 'compat.ts')
const stockOverview = read('src', 'lib', 'dashboardStockOverview.ts')
const branches = read('src', 'routes', 'branches.ts')
const inventory = read('src', 'routes', 'inventory.ts')
const familyStockStats = read('src', 'lib', 'familyStockStats.ts')

// Anything that would make a stock figure depend on WHEN a product sold.
const RANGE_SCOPE = /sale_items|localDateRangeClause|dashboardRangeClause|shiftWindowWhere|localTodayRangeClause|@startDate|@endDate|@createdFrom|@createdTo|productInRangeClause/

// ---- Every getFamilyStockStats() call carries no range scope ----
//
// The call bodies are matched by their literal shape (the helper is always
// called with an object literal), then read whole -- so a range clause
// inlined into whereSql, joinSql or qtyExpr would be caught wherever it sat.
function familyStatsCalls(source) {
  const calls = []
  const marker = 'getFamilyStockStats({'
  let from = 0
  for (;;) {
    const start = source.indexOf(marker, from)
    if (start < 0) break
    let depth = 0
    let end = start + marker.length - 1
    for (let i = start + marker.length - 1; i < source.length; i++) {
      const char = source[i]
      if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    calls.push(source.slice(start, end + 1))
    from = end + 1
  }
  return calls
}

const byFile = {
  'routes/compat.ts': familyStatsCalls(compat),
  'routes/branches.ts': familyStatsCalls(branches),
  'routes/inventory.ts': familyStatsCalls(inventory),
}

check('every Worker family-stock-stats caller is covered here (compat 0 -- it uses the overview --, branches 2, inventory 2)',
  byFile['routes/compat.ts'].length === 0
  && byFile['routes/branches.ts'].length === 2
  && byFile['routes/inventory.ts'].length === 2)

for (const [file, calls] of Object.entries(byFile)) {
  calls.forEach((call, index) => {
    check(`${file} stock stats call #${index + 1} carries no date/sales range scope`, !RANGE_SCOPE.test(call))
  })
}

// ---- The static call sites keep the plain active-catalog shape ----
// The dashboard's stock block: compat.ts hands the overview NOTHING but the
// env and a cache context (no range, no branch, no params), and the overview
// itself is the plain active catalog. A range argument added to the call, or
// a range clause added inside the one-pass helper, would fail here.
{
  const overviewCalls = compat.match(/loadDashboardStockOverview\([^)]*\)/g) || []
  check('compat.ts dashboardSummary loads the shared stock overview exactly once',
    overviewCalls.length === 1)
  check('compat.ts passes the overview no date range, branch or query params',
    overviewCalls[0] === 'loadDashboardStockOverview(env, overviewCtx)')
  check('compat.ts no longer builds the dashboard stock block from range-bearing params',
    !/getFamilyStockStats\(/.test(compat) && !/getFamilyStockAlertPage\(\{[^}]*(params|range|startDate|endDate)/.test(compat))

  const compute = stockOverview.slice(stockOverview.indexOf('export async function computeDashboardStockOverview'), stockOverview.indexOf('// Bump when the cached shape changes'))
  check('the overview compute function was located', compute.length > 300)
  check('the overview computes the family block through the one-pass helper with no where/join/range input',
    /getFamilyStockOverview\(\{ db, lowStock, previewSize: DASHBOARD_STOCK_PREVIEW_SIZE \}\)/.test(compute)
    && !RANGE_SCOPE.test(compute))
  check('the overview expiry list and count both use the one active-catalog predicate',
    (stockOverview.match(/WHERE \$\{DASHBOARD_EXPIRY_WHERE_SQL\}/g) || []).length === 2 && stockOverview.includes('INACTIVE_EXPIRY_WHERE_SQL'))
  const expiryWhere = (stockOverview.match(/export const DASHBOARD_EXPIRY_WHERE_SQL = `([^`]*)`/) || [])[1] || ''
  check('the overview expiry predicate starts from the active catalog and carries no date/sales range scope',
    /^p\.is_active = 1 AND /.test(expiryWhere) && !RANGE_SCOPE.test(expiryWhere))

  const overviewFn = familyStockStats.slice(familyStockStats.indexOf('export async function getFamilyStockOverview'))
  const overviewSql = overviewFn.slice(0, overviewFn.indexOf('.all<'))
  check('getFamilyStockOverview starts from the plain active catalog',
    /FROM products p\s+LEFT JOIN products parent ON parent\.id = p\.parent_id\s+WHERE \$\{stockVisibleProductSql\(\)\}\s+\)/.test(overviewSql))
  check('getFamilyStockOverview carries no date/sales range scope and takes no where/join/params from its caller',
    !RANGE_SCOPE.test(overviewSql)
    && /opts: \{\s*db: D1Compat\s*lowStock: LowStockConfig\s*previewSize: number\s*\}/.test(overviewFn))
  check('getFamilyStockOverview shares the configured low-stock threshold expression',
    /lowStockThresholdSql\(lowStock, 'p\.low_stock_threshold'\)/.test(overviewSql))
}
check('branches.ts hub stock stats are the plain active catalog',
  /whereSql: `WHERE \$\{stockVisibleProductSql\(\)\}`,/.test(branches))
check('inventory.ts stock stats are the plain active catalog',
  /whereSql: `WHERE \(p\.is_active = 1 OR \$\{productHasStockSql\('p'\)\}\)`,/.test(inventory))

// ---- The two dynamically built WHEREs stay branch/search predicates ----
{
  const builder = branches.slice(branches.indexOf('function buildBranchStockWhere'))
  const body = builder.slice(0, builder.indexOf('\n}\n'))
  check('branches.ts buildBranchStockWhere never adds a sales-date predicate', !RANGE_SCOPE.test(body))
  check('branches.ts buildBranchStockWhere starts from the active catalog', /const where = \[stockVisibleProductSql\(\)\]/.test(body))
}

// ---- compat.ts: the alert lists and their counts ----
{
  const summary = compat.slice(compat.indexOf('async function dashboardSummary'), compat.indexOf('async function dashboardAnalytics'))
  check('compat.ts dashboardSummary was located', summary.length > 500)
  check('compat.ts dashboardSummary no longer runs its own expiry or low/out alert queries (they are catalog-wide in the overview, pinned above)',
    !/COALESCE\(expiry_alert_days/.test(summary) && !/getFamilyStockAlertPage\(/.test(summary))
  // The drill-down route still pages one state at a time through the same
  // family-aware helper, with only state/page/pageSize.
  const drill = compat.slice(compat.indexOf("app.get('/dashboard/stock-alerts'"), compat.indexOf("app.get('/analytics'"))
  const drillCalls = drill.match(/getFamilyStockAlertPage\(\{[^}]*\}\)/g) || []
  check('compat.ts stock-alerts drill-down pages through the family-aware helper', drillCalls.length === 1)
  check('compat.ts stock-alerts drill-down carries no date/sales range scope', drillCalls.every((call) => !RANGE_SCOPE.test(call)) && !RANGE_SCOPE.test(drill))
  check('the family alert helper itself starts from the active catalog and shares the configured low-stock threshold',
    /export async function getFamilyStockAlertPage/.test(familyStockStats)
    && /WHERE \$\{stockVisibleProductSql\(\)\}/.test(familyStockStats)
    && /lowStockThresholdSql\(lowStock, 'p\.low_stock_threshold'\)/.test(familyStockStats))
  // p6/efficiency-3 (3c6a4c1e): dashboardSummary used to run two identical
  // WHERE/params queries (today_count/today_total and all_total -- same
  // window, historical naming from when they scoped two different ones) as
  // separate db.prepare() calls, each with its own localDateRangeClause
  // occurrence. One query with a COUNT now backs both fields, so the
  // literal-occurrence count dropped from 4 to 3 -- the three remaining
  // matches (sales totals, returns, recent sales) are the same three
  // range-scoped queries this check has always protected; none lost its
  // scope. See test-compat-dashboard-daterange-pure.cjs's sibling 4->3
  // locator-count update in the same commit.
  check('compat.ts keeps the range on the movement queries (sales, returns, recent sales)',
    (summary.match(/dashboardRangeClause\('(sales|returns)', range\)/g) || []).length >= 3)
  check('compat.ts records the stock/alert exception in the code itself',
    /deliberate exception to the\s*\n?\s*\/\/ one-range-scopes-list-and-stats convention \(user, 2026-09-03\)/.test(summary)
    || /one-range-scopes-list-and-stats convention \(user, 2026-09-03\)/.test(summary))
}

// ---- The default dashboard window is TODAY ----
{
  check('compat.ts defaults the dashboard range to the business day, not a rolling window',
    /startDate: String\(query\.startDate \|\| today\)/.test(compat)
    && /endDate: String\(query\.endDate \|\| today\)/.test(compat)
    && !/defaultStart/.test(compat))
  const dashboard = read('..', 'frontend', 'src', 'components', 'dashboard', 'Dashboard.tsx')
  check('Dashboard.tsx defaults persisted and missing range state to the Today preset',
    !/offsetDate\(-6\)/.test(dashboard)
    && /return \{ version: 2, rangeId: 'today', customStart: '', customEnd: '' \}/.test(dashboard)
    && /if \(!prefs\) \{\s*const today = todayStr\(\)\s*return \{ startDate: today, endDate: today, startTime: '', endTime: '' \}/.test(dashboard)
    && /readDashboardFilterPrefs\(dashboardFilterStorageKey\)/.test(dashboard)
    && /resolveDashboardFilterRange\(filterPrefs\)/.test(dashboard))
}

console.log(`\nALL ${passed} CHECKS PASSED`)

{
 const Database = require('better-sqlite3'); const db = new Database(':memory:')
 db.exec('CREATE TABLE products(id INTEGER,is_active INTEGER,stock_quantity REAL); CREATE TABLE branch_stock(product_id INTEGER,quantity REAL); CREATE TABLE product_batches(id INTEGER,variant_product_id INTEGER); CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL); CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL); INSERT INTO products VALUES(1,1,0),(2,0,0),(3,0,2),(4,0,0),(5,0,0),(6,0,0); INSERT INTO branch_stock VALUES(4,3); INSERT INTO product_batches VALUES(55,5); INSERT INTO branch_batch_stock VALUES(55,4); INSERT INTO damaged_stock_lots VALUES(6,5);')
 const guard = require('./harness/product_stock_guard.cjs')
 assert.deepEqual(db.prepare('SELECT id FROM products p WHERE '+guard.stockVisibleProductSql()).all().map(r=>r.id), [1,3,4,5,6], 'stock readers expose each legacy stocked ledger, exclude removed empty rows')
 assert.deepEqual(db.prepare('SELECT id FROM products p WHERE '+guard.catalogProductSql()).all().map(r=>r.id), [1], 'ordinary catalog keeps removed identities unavailable, including legacy stock rows')
 db.close()
}
