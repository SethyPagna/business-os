// P10-21 + P10-22: GET /api/sales/customer-report ("customers purchases are
// doing default date start and date end, remove that to show all"; "the
// stats can be one row... then actually show rows of sales as well").
//
// 1. startDate/endDate are now OPTIONAL -- absent bounds must cover the
//    customer's COMPLETE history, not silently default to today. A bound
//    that IS supplied still 400s on a malformed date.
// 2. The handler now also returns a server-paged slice of the customer's
//    own sale rows (receipt/date/branch/status/total), independent totals
//    that do not shift as the page changes, same shape as
//    GET /suppliers/:id/purchases in routes/contacts.ts.
//
// This is a "pure" test in the same shape as
// test-batch-supplier-edit-cascade-pure.cjs: source-shape assertions against
// the route file, plus the exact SQL the route runs (whereActiveSales'
// all-time branch + the paged rows query) against a real migrated in-memory
// DB, so the reader logic is exercised directly rather than re-described.
//
// Run (from cloudflare/): node scripts/test-customer-purchases-rows-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')

// --- 1. The route no longer requires both bounds -----------------------
const salesRoute = src(path.join('routes', 'sales.ts'))
// Scope every assertion below to the customer-report handler ITSELF --
// the sibling delivery-contact-report handler right above it keeps the old
// both-bounds-required shape on purpose (X3 was not part of this fix), so a
// whole-file regex would false-positive against that unrelated handler.
const reportStart = salesRoute.indexOf("app.get('/customer-report'")
check('found the customer-report handler', reportStart > -1)
const reportEnd = salesRoute.indexOf("\napp.get(", reportStart + 1)
const reportHandler = salesRoute.slice(reportStart, reportEnd > -1 ? reportEnd : reportStart + 4000)

check('customer-report no longer 400s when startDate/endDate are both required',
  !/if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(startDate\) \|\| !\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(endDate\)\)/.test(reportHandler))
check('a supplied startDate is still validated as YYYY-MM-DD',
  /if \(rawStart && !dateFormat\.test\(rawStart\)\)/.test(reportHandler))
check('a supplied endDate is still validated as YYYY-MM-DD',
  /if \(rawEnd && !dateFormat\.test\(rawEnd\)\)/.test(reportHandler))
check('absent bounds are passed through as null (all-time), not empty strings',
  /const startDate = rawStart \|\| null/.test(reportHandler) && /const endDate = rawEnd \|\| null/.test(reportHandler))
check('the handler returns a paged "sales" array alongside totals',
  /sales: saleRows \|\| \[\]/.test(reportHandler) && /total_sales: totalRows/.test(reportHandler))
check('rows stay scoped to the same customer as the totals query',
  /const rowsWhere = `\$\{whereSql\} AND s\.customer_id = @customerId`/.test(reportHandler))
check('the gate stays getActionTier(..., \'contacts\', \'financial_history\') === \'full\'',
  /getActionTier\(c\.get\('user'\), 'contacts', 'financial_history'\) !== 'full'/.test(reportHandler))

// --- 2. The all-time + paging behaviour, on a real migrated database ---
const db = openDb(loadAll())
db.prepare(`INSERT INTO branches (id, name) VALUES (1, 'Main')`).run({})
db.prepare(`INSERT INTO customers (id, name) VALUES (9, 'Dara')`).run({})
db.prepare(`INSERT INTO customers (id, name) VALUES (10, 'Other')`).run({})

// 25 sales for customer 9, spread across three different years, so an
// all-time query must NOT collapse to "today". One extra sale belongs to a
// different customer to prove the WHERE actually scopes.
const insertSale = db.prepare(`
  INSERT INTO sales (id, receipt_number, branch_name, customer_id, sale_status, total_usd, created_at)
  VALUES (@id, @receipt, 'Main', @customerId, 'completed', @total, @createdAt)
`)
for (let i = 1; i <= 25; i++) {
  const year = 2022 + (i % 4) // spans 2022..2025, nowhere near "today"
  insertSale.run({
    id: i,
    receipt: `R${String(i).padStart(4, '0')}`,
    customerId: 9,
    total: i,
    createdAt: `${year}-0${(i % 9) + 1}-15 10:00:00`,
  })
}
insertSale.run({ id: 100, receipt: 'RXXXX', customerId: 10, total: 1, createdAt: '2024-01-01 10:00:00' })

// The exact clause whereActiveSales() emits with NO startDate/endDate: no
// date clause at all, just the default hide-cancelled guard -- see
// salesAnalytics.ts's whereActiveSales (`if (f.startDate && f.endDate) ...
// else if (f.startDate) ... else if (f.endDate) ...`, all three skipped
// when both are absent).
const allTimeWhere = `COALESCE(s.sale_status, 'completed') <> 'cancelled' AND s.customer_id = @customerId`

const countRow = db.prepare(`SELECT COUNT(*) AS total FROM sales s WHERE ${allTimeWhere}`).get({ customerId: 9 })
check('with no bounds the row count covers the customer\'s COMPLETE history (25), not just today',
  Number(countRow.total) === 25)

const totalsRow = db.prepare(`
  SELECT COUNT(*) AS tx_count, COALESCE(SUM(total_usd), 0) AS collected_usd
  FROM sales s WHERE ${allTimeWhere}
`).get({ customerId: 9 })
check('the totals query with no bounds also covers all 25 sales',
  Number(totalsRow.tx_count) === 25 && Number(totalsRow.collected_usd) === 325) // 1+2+...+25

const otherCustomer = db.prepare(`SELECT COUNT(*) AS total FROM sales s WHERE ${allTimeWhere}`).get({ customerId: 10 })
check('a different customer is not swept in by the all-time scope', Number(otherCustomer.total) === 1)

// Paging: page 1 of 20 rows, ordered newest first (id DESC breaks ties on
// the same created_at day), matches the route's ORDER BY / LIMIT / OFFSET.
const page1 = db.prepare(`
  SELECT s.id, s.receipt_number, s.total_usd FROM sales s WHERE ${allTimeWhere}
  ORDER BY s.created_at DESC, s.id DESC LIMIT @limit OFFSET @offset
`).all({ customerId: 9, limit: 20, offset: 0 })
const page2 = db.prepare(`
  SELECT s.id, s.receipt_number, s.total_usd FROM sales s WHERE ${allTimeWhere}
  ORDER BY s.created_at DESC, s.id DESC LIMIT @limit OFFSET @offset
`).all({ customerId: 9, limit: 20, offset: 20 })

check('page 1 returns exactly page_size (20) rows', page1.length === 20)
check('page 2 returns the remaining rows (25 - 20 = 5)', page2.length === 5)
const allIds = new Set([...page1, ...page2].map((r) => r.id))
check('no row appears on both pages, and all 25 rows are covered across pages',
  allIds.size === 25)

// Totals stay independent of the visible page -- re-run with an offset that
// would only see page 2, totals must still report all 25.
const totalsWithPage2Cursor = db.prepare(`
  SELECT COUNT(*) AS tx_count FROM sales s WHERE ${allTimeWhere}
`).get({ customerId: 9 })
check('totals do not shift when only a later page is requested',
  Number(totalsWithPage2Cursor.tx_count) === 25)

// A cancelled sale must not count toward either totals or the paged rows --
// same default guard every other sales report applies.
db.prepare(`UPDATE sales SET sale_status = 'cancelled' WHERE id = 1`).run({})
const afterCancel = db.prepare(`SELECT COUNT(*) AS total FROM sales s WHERE ${allTimeWhere}`).get({ customerId: 9 })
check('a cancelled sale drops out of the all-time count (24 remain)', Number(afterCancel.total) === 24)

console.log(`\nAll ${checks} checks passed.`)
