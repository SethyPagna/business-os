'use strict'
// P1.8b at the seed's full size: the real Worker under Miniflare (counting D1 proxy, production-sized seed from read-budget/seed.cjs) answering
// GET /api/dashboard with read switch `dash_overview_5m` OFF and ON, Free plan. The dashboard's stock overview is the heaviest block of that
// request (one pass over the catalogue plus two expiry statements); the switch lets a sale, a stock adjustment or a transfer leave it alone for
// up to 5 minutes instead of recomputing it for the next visitor.
//   - the answer is the same: the cold body of OFF and ON equal each other except for `stock_as_of` (which both carry);
//   - OFF recomputes after every sale (the base behaviour); ON does not, and says so by keeping the same `stock_as_of`;
//   - a stock adjustment (and stock-in, transfer, product edit: every route that bumps the 'products' version) ends the entry at once under ON too;
//   - nothing ON serves is more than 300 s old; a new isolate reads the shared cache under both;
//   - rows read and D1 calls are printed per step, with the overview's own share (the statements that only the overview runs) split out.
//
// Run (from cloudflare/): node scripts/test-dashboard-overview-5m-budget-native.cjs
//   The first run seeds the world (several minutes). READ_BUDGET_SEED_SCRIPT_FILE=<file> pins the seed bundle so a Worker edit does not re-seed,
//   RUNNER_TEMP=<dir> keeps the seed out of the system temp directory.
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { seedContext } = require('./read-budget/seed.cjs')
const { writeShapes } = require('./read-budget/writes.cjs')

const WINDOW_MS = 300 * 1000
const BUSINESS_OFFSET_MS = 7 * 3600 * 1000
const ctx = seedContext()
const URL = `/api/dashboard?startDate=${ctx.today}&endDate=${ctx.today}`
// the statements only the stock overview runs: the catalogue pass and the expiry list / count
const OVERVIEW = /family_agg AS|COALESCE\(expiry_alert_days, 30\)/
const shape = (id) => writeShapes().find((s) => s.id === id)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A real clock decides the five-minute bucket, so a run that straddles a boundary would see ON recompute for a good reason. Wait it out.
async function clearOfBoundary(seconds = 100) {
  const intoBucket = (Date.now() + BUSINESS_OFFSET_MS) % WINDOW_MS
  const left = WINDOW_MS - intoBucket
  if (left < seconds * 1000) { console.log(`  (waiting ${Math.ceil(left / 1000) + 1} s for the next 5-minute bucket)`); await sleep(left + 1000) }
}

async function dashboard(world, label, { miss = true } = {}) {
  const r = await world.send('GET', URL, undefined, { miss })
  assert.equal(r.status, 200, `${label}: ${r.text.slice(0, 300)}`)
  const stmts = ((await world.last()).stmts || [])
  const own = stmts.filter((s) => OVERVIEW.test(s.raw))
  assert.match(String(r.json.stock_as_of), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, `${label}: stock_as_of`)
  return { label, status: r.status, rr: r.rr, calls: r.calls, statements: r.statements, overviewStatements: own.length, overviewRows: own.reduce((n, s) => n + (s.rr || 0), 0),
    asOf: r.json.stock_as_of, ageMs: Date.now() - Date.parse(r.json.stock_as_of), body: r.json }
}

async function run(switches) {
  const world = await bootWorld({ tier: 'free', switches })
  const steps = {}
  try {
    await world.send('GET', '/api/auth/me', undefined, { miss: true }) // warm the session
    await world.restart()
    await clearOfBoundary()
    steps.cold = await dashboard(world, 'cold')
    steps.repeat = await dashboard(world, 'repeat')

    const sale = shape('w-sale-3-lines')
    const body = await sale.prepare(world)
    const sold = await sale.run(world, (m, u, b) => world.send(m, u, b), body)
    assert.ok(sold.status < 300, `sale answered ${sold.status} ${sold.text.slice(0, 200)}`)
    steps.afterSale = await dashboard(world, 'after a sale')

    const sale2 = shape('w-sale-1-lines')
    const sold2 = await sale2.run(world, (m, u, b) => world.send(m, u, b), await sale2.prepare(world))
    assert.ok(sold2.status < 300, `second sale answered ${sold2.status} ${sold2.text.slice(0, 200)}`)
    steps.afterSale2 = await dashboard(world, 'after a second sale')

    const adjust = shape('w-adjust')
    const adjustBody = await adjust.prepare(world)
    const adjusted = await adjust.run(world, (m, u, b) => world.send(m, u, b), adjustBody)
    assert.ok(adjusted.status < 300, `adjust answered ${adjusted.status} ${adjusted.text.slice(0, 200)}`)
    steps.afterAdjust = await dashboard(world, 'after a stock adjustment')

    // another isolate, the shared Workers cache allowed to answer
    await world.restart()
    steps.newIsolate = await dashboard(world, 'new isolate', { miss: false })
  } finally { await world.dispose() }
  return steps
}

;(async () => {
  const off = await run(undefined)
  const on = await run({ dash_overview_5m: 'on' })
  const names = ['cold', 'repeat', 'afterSale', 'afterSale2', 'afterAdjust', 'newIsolate']
  const nice = { cold: 'cold isolate', repeat: 'same isolate, again', afterSale: 'after a sale', afterSale2: 'after a second sale', afterAdjust: 'after a stock adjustment', newIsolate: 'new isolate (shared cache)' }

  // 1. the same answer
  const strip = (b) => { const { stock_as_of, ...rest } = b; return JSON.stringify(rest) }
  assert.equal(strip(on.cold.body), strip(off.cold.body), 'the cold dashboard body differs between OFF and ON')
  assert.equal(strip(on.repeat.body), strip(off.repeat.body))
  console.log('PASS the dashboard body is the same with the switch OFF and ON (stock_as_of aside), cold and repeated')

  // 2. OFF is the base: every write moves the overview
  assert.ok(off.cold.overviewStatements >= 3, `OFF computes on a cold isolate (${off.cold.overviewStatements} overview statements)`)
  assert.equal(off.repeat.overviewStatements, 0, 'OFF: same isolate, same versions: memo')
  assert.ok(off.afterSale.overviewStatements >= 3, 'OFF recomputes after a sale')
  assert.notEqual(off.afterSale.asOf, off.repeat.asOf)
  assert.ok(off.afterSale2.overviewStatements >= 3, 'OFF recomputes after a second sale')
  assert.ok(off.afterAdjust.overviewStatements >= 3, 'OFF recomputes after a stock adjustment')
  console.log('PASS OFF recomputes the overview after every sale and after a stock adjustment (the base behaviour)')

  // 3. ON keeps it for the window, and a product edit ends it
  assert.ok(on.cold.overviewStatements >= 3, 'ON computes on a cold isolate')
  assert.equal(on.repeat.overviewStatements, 0)
  assert.equal(on.afterSale.overviewStatements, 0, 'ON: a sale does not recompute the overview')
  assert.equal(on.afterSale.asOf, on.cold.asOf, 'ON: the cached overview keeps its original stock_as_of')
  assert.equal(on.afterSale2.overviewStatements, 0, 'ON: a second sale does not recompute it either')
  assert.equal(on.afterSale2.asOf, on.cold.asOf)
  // routes/inventory.ts bumps 'products' (not 'stock') after an adjustment, and 'products' stays in the ON key
  assert.ok(on.afterAdjust.overviewStatements >= 3, "ON: a stock adjustment bumps 'products' and ends the entry at once")
  assert.notEqual(on.afterAdjust.asOf, on.cold.asOf)
  console.log('PASS ON keeps the overview through two sales (same stock_as_of) and recomputes after a stock adjustment (products version)')

  // 4. the age bound and the shared cache
  for (const name of names) assert.ok(on[name].ageMs >= 0 && on[name].ageMs <= WINDOW_MS, `ON ${name}: the served overview is ${on[name].ageMs} ms old`)
  assert.equal(off.newIsolate.overviewStatements, 0, 'OFF: a new isolate reads the shared cache')
  assert.equal(on.newIsolate.overviewStatements, 0, 'ON: a new isolate reads the shared cache')
  assert.equal(on.newIsolate.asOf, on.afterAdjust.asOf, 'ON: and gets the stored stock_as_of, not a new one')
  console.log('PASS ON never served an overview more than 300 s old; a new isolate reads the shared cache under both')

  // 5. the saving
  const sum = (run, key) => names.reduce((n, name) => n + run[name][key], 0)
  console.log('\nrows read / D1 calls per GET /api/dashboard (Free, seed full size); overview share in brackets')
  console.log(`  ${''.padEnd(30)} ${'OFF rows'.padStart(9)} ${'ON rows'.padStart(9)}   ${'OFF calls'.padStart(9)} ${'ON calls'.padStart(9)}   ${'OFF overview rows'.padStart(18)} ${'ON overview rows'.padStart(17)}`)
  for (const name of names) {
    console.log(`  ${nice[name].padEnd(30)} ${String(off[name].rr).padStart(9)} ${String(on[name].rr).padStart(9)}   ${String(off[name].calls).padStart(9)} ${String(on[name].calls).padStart(9)}   ${String(off[name].overviewRows).padStart(18)} ${String(on[name].overviewRows).padStart(17)}`)
  }
  console.log(`  ${'six requests, total'.padEnd(30)} ${String(sum(off, 'rr')).padStart(9)} ${String(sum(on, 'rr')).padStart(9)}   ${String(sum(off, 'calls')).padStart(9)} ${String(sum(on, 'calls')).padStart(9)}   ${String(sum(off, 'overviewRows')).padStart(18)} ${String(sum(on, 'overviewRows')).padStart(17)}`)
  assert.ok(sum(on, 'rr') < sum(off, 'rr'), 'ON reads fewer rows over the sequence')
  assert.ok(on.afterSale.rr < off.afterSale.rr && on.afterSale2.rr < off.afterSale2.rr, 'and each sale-then-visit reads fewer rows')
  assert.ok(on.afterSale.calls <= off.afterSale.calls && on.afterSale2.calls <= off.afterSale2.calls, 'and no more calls')
  assert.ok(on.cold.calls <= off.cold.calls + 1, 'the cold visit costs at most the switch row more')
  console.log(`\nPASS ${sum(off, 'rr') - sum(on, 'rr')} fewer rows read across the sequence (${Math.round((1 - sum(on, 'rr') / sum(off, 'rr')) * 100)}%); no extra calls after a sale`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
