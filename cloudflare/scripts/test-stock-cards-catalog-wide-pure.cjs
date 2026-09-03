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
// dashboard: routes/compat.ts (dashboard summary), routes/branches.ts (the
// branch hub's stats and the per-branch stock summary) and
// routes/inventory.ts (/stats and /bootstrap). Their static call sites all
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
const branches = read('src', 'routes', 'branches.ts')
const inventory = read('src', 'routes', 'inventory.ts')

// Anything that would make a stock figure depend on WHEN a product sold.
const RANGE_SCOPE = /sale_items|localDateRangeClause|localTodayRangeClause|@startDate|@endDate|productInRangeClause/

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

check('every Worker family-stock-stats caller is covered here (compat 1, branches 2, inventory 2)',
  byFile['routes/compat.ts'].length === 1
  && byFile['routes/branches.ts'].length === 2
  && byFile['routes/inventory.ts'].length === 2)

for (const [file, calls] of Object.entries(byFile)) {
  calls.forEach((call, index) => {
    check(`${file} stock stats call #${index + 1} carries no date/sales range scope`, !RANGE_SCOPE.test(call))
  })
}

// ---- The static call sites keep the plain active-catalog shape ----
check('compat.ts dashboard stock stats are the plain active catalog',
  /whereSql: 'WHERE p\.is_active = 1',/.test(compat))
check('branches.ts hub stock stats are the plain active catalog',
  /whereSql: 'WHERE p\.is_active = 1',/.test(branches))
check('inventory.ts stock stats are the plain active catalog',
  /whereSql: 'WHERE p\.is_active = 1',/.test(inventory))

// ---- The two dynamically built WHEREs stay branch/search predicates ----
{
  const builder = branches.slice(branches.indexOf('function buildBranchStockWhere'))
  const body = builder.slice(0, builder.indexOf('\n}\n'))
  check('branches.ts buildBranchStockWhere never adds a sales-date predicate', !RANGE_SCOPE.test(body))
  check('branches.ts buildBranchStockWhere starts from the active catalog', /const where = \['p\.is_active = 1'\]/.test(body))
}

// ---- compat.ts: the alert lists and their counts ----
{
  const summary = compat.slice(compat.indexOf('async function dashboardSummary'), compat.indexOf('async function dashboardAnalytics'))
  check('compat.ts dashboardSummary was located', summary.length > 500)
  const alerts = summary.split('db.prepare(').filter((chunk) => /COALESCE\(stock_quantity, 0\) <=|COALESCE\(expiry_alert_days/.test(chunk))
  check('compat.ts still has all four inventory alert queries', alerts.length === 4)
  for (const chunk of alerts) {
    const sql = chunk.slice(0, chunk.indexOf('`).'))
    check(`compat.ts alert query is catalog-wide: ${sql.trim().split('\n').pop().trim().slice(0, 60)}...`,
      /p\.is_active = 1/.test(sql) && !RANGE_SCOPE.test(sql))
  }
  check('compat.ts keeps the range on the movement queries (sales, returns, recent sales)',
    (summary.match(/localDateRangeClause\('created_at'\)/g) || []).length >= 4)
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
  check('Dashboard.tsx defaults its range to today at both initialisation sites',
    !/offsetDate\(-6\)/.test(dashboard)
    && (dashboard.match(/customStart \? [a-zA-Z]+\.customStart : todayStr\(\)/g) || []).length === 2)
}

console.log(`\nALL ${passed} CHECKS PASSED`)
