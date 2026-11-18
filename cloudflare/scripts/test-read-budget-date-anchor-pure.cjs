#!/usr/bin/env node
// The read-budget shapes must measure the same world on any run date (18 Nov 2026 17:00 UTC: every gate went red on products-id-sales-detail because its
// param was `mode=month&period=<run month>`: the seed hangs off the run date, so a calendar month held more seeded days, and one more sale of product 1000,
// the day the month had run 18 days. A ceiling recorded on one day then meant something else on the next).
// Rule pinned here: every date a shape sends is the anchor date shifted by a fixed number of days (seedContext's today/week/month/year/productSalesDay or a
// shift of them); no shape sends a bare month or year, and no shape source holds a literal date. Pure: no Miniflare.
'use strict'
const fs = require('fs')
const path = require('path')
const { seedContext } = require('./read-budget/seed.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { getHistoryShapes } = require('./read-budget/ic-history.cjs')

let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL ' + message) } }

// Run dates chosen to straddle month, year and leap-day ends; 2027-02-28 and 2027-03-01 are a month length apart.
const RUN_DATES = ['2026-11-01', '2026-11-18', '2026-11-19', '2026-11-30', '2026-12-01', '2027-01-01', '2027-02-28', '2027-03-15', '2028-02-29']
const DAY_MS = 86400e3
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

// A shape url with every full date replaced by its offset in days from the anchor date: equal strings on every run date mean the window is anchor-relative.
function normalised(url, anchorDate) {
  return url.replace(DATE, (d) => `D(${Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(anchorDate + 'T00:00:00Z')) / DAY_MS)})`)
}
// What is left of a url once the full dates are out: a param whose whole value is a year or a month (period=2026-11, year=2026) is a period the runner would not move with the anchor.
const strayPeriod = (url) => url.replace(DATE, '').match(/[=](?:19|20)\d{2}(?:-\d{2})?(?=&|$)/g)

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
    check(normalised(twin.url, other.ctx.anchorDate) === normalised(s.url, first.ctx.anchorDate),
      `${s.id}: the request is not anchor-relative: ${first.runDate} sends ${s.url.slice(0, 120)}, ${other.runDate} sends ${twin.url.slice(0, 120)}`)
    const stray = strayPeriod(twin.url)
    check(!stray, `${s.id}: sends a bare month or year (${stray && stray.join(', ')}) on ${other.runDate}; only full anchor-derived dates are allowed`)
  }
}

// The remaining way a date gets in: a literal written into a shape source. Comments are skipped.
for (const file of ['shapes.cjs', 'writes.cjs', 'ic-history.cjs']) {
  const code = fs.readFileSync(path.join(__dirname, 'read-budget', file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const literal = code.match(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g)
  check(!literal, `${file}: holds a literal date ${literal && literal.join(', ')}; derive it from seedContext() instead`)
}

// productSalesDay must keep landing on the one sale of product 1000 it exists for (sale k=784: 25,715 minutes before the anchor, local 15:25, 18 days back).
for (const { runDate, ctx } of sets) {
  const local = new Date(Date.parse(ctx.anchorDate + 'T12:00:00Z') - 25715 * 60e3).toISOString().slice(0, 10)
  check(ctx.productSalesDay === local, `${runDate}: productSalesDay ${ctx.productSalesDay} is not the local day of sale k=784 (${local})`)
}

if (failures) { console.error(`test-read-budget-date-anchor-pure: ${failures} failure(s)`); process.exitCode = 1 } else console.log(`test-read-budget-date-anchor-pure: ${first.shapes.length} shapes anchor-relative on ${RUN_DATES.length} run dates`)
