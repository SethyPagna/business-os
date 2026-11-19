#!/usr/bin/env node
// The read-budget shapes must measure the same world on any run date (18 Nov 2026 17:00 UTC: every gate went red on products-id-sales-detail because its
// param was `mode=month&period=<run month>`: the seed hangs off the run date, so a calendar month held more seeded days, and one more sale of product 1000,
// the day the month had run 18 days. A ceiling recorded on one day then meant something else on the next).
// Rule pinned here: every date a shape sends is the anchor date shifted by a fixed number of days (seedContext's today/week/month/year/productSalesDay or a
// shift of them); no shape sends a bare month or year, and no shape source holds a literal date. Pure: no Miniflare.
'use strict'
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { seedContext, seedSql, FIRST_SALE, S, P, PRODUCT_SALE_K, PRODUCT_SALE_PRODUCT } = require('./read-budget/seed.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { getHistoryShapes } = require('./read-budget/ic-history.cjs')

let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL ' + message) } }

// Run dates chosen to straddle month, year and leap-day ends; 2027-02-28 and 2027-03-01 are a month length apart.
const RUN_DATES = ['2026-11-01', '2026-11-18', '2026-11-19', '2026-11-30', '2026-12-01', '2027-01-01', '2027-02-28', '2027-03-15', '2028-02-29']
const DAY_MS = 86400e3
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

// The one bare month a shape may send: the month of the anchored sales-detail day (see the proof at the end of this file).
const ownMonth = (ctx) => `mode=month&period=${ctx.productSalesDay.slice(0, 7)}`
const SALES_DETAIL = '/api/products/1000/sales-detail?'
const withoutOwnMonth = (url, ctx) => (url.startsWith(SALES_DETAIL) && url.endsWith(ownMonth(ctx)) ? url.slice(0, -ownMonth(ctx).length) + 'mode=month&period=MONTH_OF_productSalesDay' : url)
// A shape url with every full date replaced by its offset in days from the anchor date: equal strings on every run date mean the window is anchor-relative.
function normalised(url, ctx) {
  const anchorDate = ctx.anchorDate
  return withoutOwnMonth(url, ctx).replace(DATE, (d) => `D(${Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(anchorDate + 'T00:00:00Z')) / DAY_MS)})`)
}
// What is left of a url once the full dates are out: a param whose whole value is a year or a month (period=2026-11, year=2026) is a period the runner would not move with the anchor.
const strayPeriod = (url, ctx) => withoutOwnMonth(url, ctx).replace(DATE, '').match(/[=](?:19|20)\d{2}(?:-\d{2})?(?=&|$)/g)

const sets = RUN_DATES.map((d) => {
  const ctx = seedContext(new Date(d + 'T05:00:00Z'))
  return { runDate: d, ctx, shapes: [...getShapes(ctx), ...getHistoryShapes()] }
})
const first = sets[0]
check(first.shapes.length > 250, `expected the full shape list, got ${first.shapes.length}`)

for (const s of first.shapes) {
  for (const other of sets) {
    const twin = other.shapes.find((x) => x.id === s.id)
    check(Boolean(twin), `${s.id}: missing on run date ${other.runDate}`)
    if (!twin) continue
    check(normalised(twin.url, other.ctx) === normalised(s.url, first.ctx),
      `${s.id}: the request is not anchor-relative: ${first.runDate} sends ${s.url.slice(0, 120)}, ${other.runDate} sends ${twin.url.slice(0, 120)}`)
    const stray = strayPeriod(twin.url, other.ctx)
    check(!stray, `${s.id}: sends a bare month or year (${stray && stray.join(', ')}) on ${other.runDate}; only full anchor-derived dates are allowed`)
  }
}

// The remaining way a date gets in: a literal written into a shape source. Comments are skipped.
for (const file of ['shapes.cjs', 'writes.cjs', 'ic-history.cjs']) {
  const code = fs.readFileSync(path.join(__dirname, 'read-budget', file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const literal = code.match(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g)
  check(!literal, `${file}: holds a literal date ${literal && literal.join(', ')}; derive it from seedContext() instead`)
}

// The sales-detail windows rest on the seed: run the seed's OWN statements for sales and their lines (read from seedSql(), not copied) on a minimal in-memory schema and read
// back where the sales of product 1000 sit. Then, on every run date: productSalesDay is the local day of the sale the seed constants name, that day holds exactly that sale,
// and the calendar month of that day holds exactly that sale too (the other sales of the product are months away), so the day and the month shape read the same one sale.
function productSales(now) {
  const statements = seedSql({ now })
  const sales = statements.find((q) => /^\s*WITH RECURSIVE n\(k\)/.test(q) && /INSERT INTO sales\(/.test(q))
  const lines = statements.find((q) => /^\s*WITH RECURSIVE l\(i\)/.test(q) && /INSERT INTO sale_items\(/.test(q))
  const columns = (q, table) => new RegExp('INSERT INTO ' + table + '\\(([^)]*)\\)').exec(q)[1]
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE sales(${columns(sales, 'sales')}); CREATE TABLE sale_items(${columns(lines, 'sale_items')});
    CREATE TABLE products(id INTEGER PRIMARY KEY, name, sku, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr, is_active);
    WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}) INSERT INTO products SELECT 1000+j,'p'||j,'s'||j,1,4000,1,4000,1 FROM n`)
  db.exec(sales)
  db.exec(lines)
  return db.prepare(`SELECT s.id AS id, s.sale_status AS status, date(s.created_at, '+7 hours') AS day FROM sales s WHERE s.id IN (SELECT sale_id FROM sale_items WHERE product_id = ?) ORDER BY s.id DESC`).all(PRODUCT_SALE_PRODUCT)
}
const wantedId = FIRST_SALE + S - 1 - PRODUCT_SALE_K
for (const { runDate, ctx } of sets) {
  const sales = productSales(new Date(runDate + 'T05:00:00Z'))
  const wanted = sales.find((x) => x.id === wantedId)
  check(Boolean(wanted) && wanted.status === 'completed', `${runDate}: sale ${wantedId} (PRODUCT_SALE_K ${PRODUCT_SALE_K}) is not a completed sale of product ${PRODUCT_SALE_PRODUCT} in the seed`)
  if (!wanted) continue
  check(ctx.productSalesDay === wanted.day, `${runDate}: productSalesDay ${ctx.productSalesDay} is not the local day the seed puts sale ${wantedId} on (${wanted.day})`)
  const sameDay = sales.filter((x) => x.day === ctx.productSalesDay)
  const sameMonth = sales.filter((x) => x.day.slice(0, 7) === ctx.productSalesDay.slice(0, 7))
  check(sameDay.length === 1 && sameDay[0].id === wantedId, `${runDate}: the day ${ctx.productSalesDay} holds sales ${sameDay.map((x) => x.id)} of product ${PRODUCT_SALE_PRODUCT}, not just ${wantedId}`)
  check(sameMonth.length === 1 && sameMonth[0].id === wantedId, `${runDate}: the month ${ctx.productSalesDay.slice(0, 7)} holds sales ${sameMonth.map((x) => x.id + '@' + x.day)} of product ${PRODUCT_SALE_PRODUCT}, not just ${wantedId}`)
}

if (failures) { console.error(`test-read-budget-date-anchor-pure: ${failures} failure(s)`); process.exitCode = 1 } else console.log(`test-read-budget-date-anchor-pure: ${first.shapes.length} shapes anchor-relative on ${RUN_DATES.length} run dates`)
