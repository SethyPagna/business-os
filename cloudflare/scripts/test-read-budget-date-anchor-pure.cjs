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
const { seedContext, seedSql, FIRST_SALE, S, P, PRODUCT_SALE_K, PRODUCT_SALE_MONTH_K, PRODUCT_SALE_PRODUCT } = require('./read-budget/seed.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { getHistoryShapes } = require('./read-budget/ic-history.cjs')

let failures = 0
const check = (ok, message) => { if (!ok) { failures += 1; console.error('FAIL ' + message) } }

// Run dates chosen to straddle month, year and leap-day ends; 2027-02-28 and 2027-03-01 are a month length apart.
const RUN_DATES = ['2026-11-01', '2026-11-18', '2026-11-19', '2026-11-30', '2026-12-01', '2027-01-01', '2027-02-28', '2027-03-15', '2028-02-29']
const DAY_MS = 86400e3
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

// The one bare month a shape may send: the month of the product's other completed sale (see the proof below).
const ownMonth = (ctx) => `mode=month&period=${ctx.productSalesMonth}`
const SALES_DETAIL = `/api/products/${PRODUCT_SALE_PRODUCT}/sales-detail?`
const withoutOwnMonth = (url, ctx) => (url.startsWith(SALES_DETAIL) && url.endsWith(ownMonth(ctx)) ? url.slice(0, -ownMonth(ctx).length) + 'mode=month&period=MONTH_OF_productSalesMonth' : url)
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

// The sales-detail windows rest on the seed: run the seed's OWN statements for sales, their lines and returns (read from seedSql(), not copied) on a minimal in-memory schema.
// Then, on every run date: productSalesDay is the local day of the sale the seed constants name and productSalesMonth is the month of the product's other completed sale; each window
// holds exactly that one sale of the product, and no sale the seed returns lies in either window, so the ledger half of the route reads the same rows on every run date.
function seeded(now) {
  const statements = seedSql({ now })
  const sales = statements.find((q) => /^\s*WITH RECURSIVE n\(k\)/.test(q) && /INSERT INTO sales\(/.test(q))
  const lines = statements.find((q) => /^\s*WITH RECURSIVE l\(i\)/.test(q) && /INSERT INTO sale_items\(/.test(q))
  const returns = statements.filter((q) => /^\s*INSERT INTO returns\(/.test(q))
  const columns = (q, table) => new RegExp('INSERT INTO ' + table + '\\(([^)]*)\\)').exec(q)[1]
  check(returns.length === 2, 'the seed is expected to hold two INSERT INTO returns statements, found ' + returns.length)
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE sales(${columns(sales, 'sales')}); CREATE TABLE sale_items(${columns(lines, 'sale_items')}); CREATE TABLE returns(${columns(returns[0], 'returns')});
    CREATE TABLE products(id INTEGER PRIMARY KEY, name, sku, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr, is_active);
    WITH RECURSIVE n(j) AS (SELECT 0 UNION ALL SELECT j+1 FROM n WHERE j<${P - 1}) INSERT INTO products SELECT 1000+j,'p'||j,'s'||j,1,4000,1,4000,1 FROM n`)
  db.exec(sales)
  db.exec(lines)
  for (const q of returns) db.exec(q)
  const day = "date(s.created_at, '+7 hours')"
  return {
    product: db.prepare(`SELECT s.id AS id, s.sale_status AS status, ${day} AS day FROM sales s WHERE s.id IN (SELECT sale_id FROM sale_items WHERE product_id = ?) ORDER BY s.id DESC`).all(PRODUCT_SALE_PRODUCT),
    returned: db.prepare(`SELECT s.id AS id, ${day} AS day FROM sales s WHERE s.id IN (SELECT sale_id FROM returns)`).all(),
  }
}
const saleIdOf = (k) => FIRST_SALE + S - 1 - k
for (const { runDate, ctx } of sets) {
  const { product, returned } = seeded(new Date(runDate + 'T05:00:00Z'))
  check(returned.length === 9, `${runDate}: expected nine returned sales in the seed, found ${returned.length}`)
  const windows = [
    { name: 'day', inside: (d) => d === ctx.productSalesDay, id: saleIdOf(PRODUCT_SALE_K), label: ctx.productSalesDay },
    { name: 'month', inside: (d) => d.slice(0, 7) === ctx.productSalesMonth, id: saleIdOf(PRODUCT_SALE_MONTH_K), label: ctx.productSalesMonth },
  ]
  for (const w of windows) {
    const wanted = product.find((x) => x.id === w.id)
    check(Boolean(wanted) && wanted.status === 'completed', `${runDate}: sale ${w.id} is not a completed sale of product ${PRODUCT_SALE_PRODUCT} in the seed (${w.name} window)`)
    if (!wanted) continue
    if (w.name === 'day') check(ctx.productSalesDay === wanted.day, `${runDate}: productSalesDay ${ctx.productSalesDay} is not the local day the seed puts sale ${w.id} on (${wanted.day})`)
    else check(ctx.productSalesMonth === wanted.day.slice(0, 7), `${runDate}: productSalesMonth ${ctx.productSalesMonth} is not the month the seed puts sale ${w.id} in (${wanted.day})`)
    const held = product.filter((x) => w.inside(x.day))
    check(held.length === 1 && held[0].id === w.id, `${runDate}: the ${w.name} ${w.label} holds sales ${held.map((x) => x.id + '@' + x.day)} of product ${PRODUCT_SALE_PRODUCT}, not just ${w.id}`)
    const hit = returned.filter((x) => w.inside(x.day))
    check(hit.length === 0, `${runDate}: the ${w.name} ${w.label} holds returned sales ${hit.map((x) => x.id + '@' + x.day)}; its ledger half would read their rows`)
  }
}

// One run date per run. The clock is read ONCE (seed.cjs readClock, at load); the seed stores the anchor date it used (org.json) and world.ctx and every native are built from the
// stored date. Before this, the seed key, the seed data, world.ctx and three natives each read the clock: a run that crossed 17:00Z (Cambodia midnight) asked for the day after its data.
const source = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
const count = (text, re) => (text.match(re) || []).length
const seedText = source('read-budget', 'seed.cjs')
check(count(seedText, /\breadClock\(\)/g) === 2 && /RUN_NOW = readClock\(\)/.test(seedText), 'seed.cjs: the clock must be read once, by `const RUN_NOW = readClock()` at load')
check(count(seedText, /new Date\(\)/g) === 1 && count(seedText, /Date\.now\(/g) === 0, 'seed.cjs: no clock read outside readClock')
check(/function seedContext\(now = RUN_NOW\)/.test(seedText), 'seed.cjs: seedContext must default to the one run instant')
const worldText = source('read-budget', 'world.cjs')
check(/ctx: contextOn\(anchorDate\)/.test(worldText) && /orgId: org\.id, anchorDate: /.test(worldText), 'world.cjs: world.ctx must be built from the anchor date the seed stored in org.json')
check(count(worldText, /\bseedContext\(/g) === 2, `world.cjs: seedContext() may be read only for the seed key and the stored anchor, found ${count(worldText, /\bseedContext\(/g)}`)

const CLOCK_FREE = ['shapes.cjs', 'ic-history.cjs', 'history-pass.cjs', 'runner.cjs', 'routes.cjs', 'switches.cjs', 'writes.cjs'].map((f) => ['read-budget', f])
const natives = fs.readdirSync(__dirname).filter((f) => /^test-.*-(native|http)\.cjs$/.test(f)).map((f) => [f])
for (const parts of [...CLOCK_FREE, ...natives]) {
  const text = source(...parts)
  const name = parts.join('/')
  check(!/\b(seedContext|contextOn)\(|\bRUN_NOW\b|READ_BUDGET_NOW|READ_BUDGET_CLOCK_DRIFT/.test(text), `${name}: builds a date from the clock or a seed context at load; use world.ctx of the booted world`)
}
for (const parts of CLOCK_FREE) {
  const text = source(...parts).replace(/world\.clockMs = shiftCloseInstant\(world\.ctx\.anchorDate, Date\.now\(\)\)/, '')
  check(!/new Date\(\)|Date\.now\(\)/.test(text), `${parts.join('/')}: reads the clock; a shape's dates come from ctx`)
}

// A native that boots the world must not build a calendar date from the real clock: its dates come from world.ctx. A date from `new Date()` or `Date.now()` cut to a day or a month moves at
// 17:00Z and with the run date, away from the seed.
const CLOCK_DATE_ALLOWED = { 'test-sales-stats-header-lines-native.cjs': 'a real-clock window around sales the test creates itself, not the seeded world' }
const SLICE = String.raw`\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*(?:7|10)\s*\)`
const CLOCK = String.raw`(?:new Date\(\s*\)|Date\.now\(\))`
function clockDate(text) {
  if (new RegExp(CLOCK + String.raw`[^;\n]*` + SLICE).test(text)) return true
  const held = [...text.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*` + CLOCK, 'g'))].map((m) => m[1])
  return held.some((v) => new RegExp(String.raw`\b${v}` + SLICE).test(text) || new RegExp(String.raw`new Date\(\s*${v}\b[^;\n]*` + SLICE).test(text))
}
for (const f of fs.readdirSync(__dirname).filter((n) => /^test-.*\.cjs$/.test(n))) {
  const text = source(f)
  if (!/\bworld\.cjs/.test(text) || !/read-budget/.test(text)) continue
  if (CLOCK_DATE_ALLOWED[f]) { check(clockDate(text), `${f}: is allowed a clock date (${CLOCK_DATE_ALLOWED[f]}) but builds none; remove it from CLOCK_DATE_ALLOWED`); continue }
  check(!clockDate(text), `${f}: builds a calendar date from the real clock (new Date() or Date.now() cut with toISOString().slice(0, 7 or 10)); take it from world.ctx of the booted world`)
}

// The seam: a clock that moves on by a day after the first read must not move anything built from the seed context.
const probe = "const s = require('./read-budget/seed.cjs'); const a = s.seedContext().anchorDate; const b = s.seedContext().anchorDate; const c = s.contextOn(a).anchorDate; "
  + "const sql = s.seedSql().join('\\n'); console.log(JSON.stringify({ a, b, c, later: s.readClock().toISOString().slice(0, 10), sql: [sql.includes('2026-11-18 05:00:00'), sql.includes('2026-11-19')] }))"
let seen = null
try {
  seen = JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', probe], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, READ_BUDGET_NOW: '2026-11-18T10:00:00Z', READ_BUDGET_CLOCK_DRIFT_DAYS: '1' } }))
} catch (e) { check(false, 'the clock-drift probe did not run: ' + String(e.message).split('\n')[0]) }
if (seen) {
  check(seen.later === '2026-11-19', `the drift seam is not live (a second clock read gave ${seen.later}), so this probe proves nothing`)
  check(seen.a === '2026-11-18' && seen.b === seen.a && seen.c === seen.a, `with the clock moving on a day, seedContext() answered ${seen.a}, ${seen.b}, contextOn ${seen.c}; they must all be 2026-11-18`)
  check(seen.sql[0] === true && seen.sql[1] === false, 'with the clock moving on a day, the seed statements are not all on the first date')
}

if (failures) { console.error(`test-read-budget-date-anchor-pure: ${failures} failure(s)`); process.exitCode = 1 } else console.log(`test-read-budget-date-anchor-pure: ${first.shapes.length} shapes anchor-relative on ${RUN_DATES.length} run dates`)
