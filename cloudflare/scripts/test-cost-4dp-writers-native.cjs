'use strict'
// cost-4dp lane: every writer of a product cost stores it to 4 decimals, nearest, half away from zero (owner rule), and a legacy value over 4
// places is rounded when its product is saved. Real Hono routes, the pending queue and the review applier on the migrated SQLite schema (the
// money-write-policy harness, evaluated from its own file so the two cannot drift).
//
// Scenarios (each followed by the census predicate over products, lots and cost entries):
//   create        POST /          typed costs 4.166666666 / '1.00015' / KHR 4100.12345 and a lone purchase cost
//   edit          PUT /:id        a legacy 6-place cost re-saved (rounded, twin follows, NO manual cost entry), a typed tie, a KHR cost
//   queue update  a request queued before 13 Sep 2026 (no money plan) approved today: cost, KHR and purchase rounded, selling price untouched
//   queue create  the same for a plan-less create
//   plan insert   planInsertRow (stock-in session and review create) with a long cost
//   bulk adjust   POST /bulk-price-adjust on cost fields keeps 4 places (was 2) and ties go away from zero
//   ties          roundMoney4 / meanMoney4 / weightedMeanMoney4 and the SQL nudge agree on exact decimal ties
// Mutants: the same scenarios re-run in a child process with one writer's rounding removed from the source text read by the harness; each must go red.
//
// Run: node scripts/test-cost-4dp-writers-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const SRC = path.resolve(__dirname, '../src')
// name -> [{ file, from, to }]: removing every rounding of ONE writer.
const MUTANTS = {
  'productWrites: no rounding in the money plan (create and edit)': [
    { file: 'lib/productWrites.ts', from: ': roundMoney4(value as string | number)', to: ': Number(value)' },
    { file: 'lib/productWrites.ts', from: '    writable[field] = roundMoney4(value)', to: '    writable[field] = value' },
  ],
  'updateRow: a plan-less queued update is written as queued': [
    { file: 'lib/productWrites.ts', from: "  if (table === 'products') roundProductCostPayload(payload)\n", to: '' },
  ],
  'buildInsertPayload: a plan-less create / planInsertRow is written as given': [
    { file: 'lib/productWrites.ts', from: '  roundProductCostPayload(payload)\n  applySearchNormalizedColumns(payload, body, columns, true)', to: '  applySearchNormalizedColumns(payload, body, columns, true)' },
  ],
  'isCostRoundingOnly: re-saving a legacy long cost is counted as a typed cost': [
    { file: 'lib/catalogCostRecompute.ts', from: "  if ((after ?? null) === (before ?? null)) return true\n  if (after == null || before == null || !Number.isFinite(before)) return false\n  return roundMoney4(before) === after", to: '  return (after ?? null) === (before ?? null)' },
  ],
}
const MUTANT = process.env.COST4DP_MUTANT || ''

if (MUTANT) {
  const mutations = MUTANTS[MUTANT]
  assert.ok(mutations, `unknown mutant ${MUTANT}`)
  const realRead = fs.readFileSync
  fs.readFileSync = function patched(file, ...rest) {
    const text = realRead.call(fs, file, ...rest)
    if (typeof text !== 'string') return text
    const rel = path.relative(SRC, String(file)).split(path.sep).join('/')
    let out = text.replace(/\r\n/g, '\n')
    let touched = false
    for (const m of mutations) if (m.file === rel) { assert.ok(out.includes(m.from), `${MUTANT}: anchor missing in ${rel}`); out = out.split(m.from).join(m.to); touched = true }
    return touched ? out : text
  }
}

const harnessPath = path.join(__dirname, 'test-product-money-write-policy-native.cjs')
const harnessText = fs.readFileSync(harnessPath, 'utf8')
const harnessEnd = harnessText.indexOf(';(async () => {')
assert.ok(harnessEnd > 0, 'the money-write-policy harness moved')
const harnessModule = { exports: {} }
new Function('require', '__dirname', 'module', `${harnessText.slice(0, harnessEnd)}
module.exports = { products, reviews, writer, request, row, raw, admin, requester, seedFixture, load }`)(createRequire(harnessPath), __dirname, harnessModule)
const { products, reviews, writer, request, row, raw, seedFixture, load } = harnessModule.exports
const money = load('lib/moneyPrecision.ts')

const over4 = (c) => `(typeof(${c}) IN ('integer','real') AND ABS(${c} * 10000 - ROUND(${c} * 10000)) > 0.000001)`
// The census predicate (cost_usd_over_4dp), over every column a writer in this file can reach.
function census() {
  const n = (table, cols, where = '1') => raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where} AND (${cols.map(over4).join(' OR ')})`).get().n
  return {
    products: n('products', ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr'], 'id NOT IN (SELECT id FROM _legacy_long)'),
    lots: n('product_batches', ['unit_cost_usd', 'received_cost_usd']),
    entries: n('product_cost_entries', ['cost_usd', 'cost_khr', 'previous_cost_usd']),
  }
}
raw.exec('CREATE TEMP TABLE _legacy_long (id INTEGER PRIMARY KEY)')
const seedLegacy = (name, usd, khr = null) => {
  const id = Number(seedFixture(raw, () => raw.prepare('INSERT INTO products(name,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr,is_active) VALUES(?,?,?,?,?,1)')
    .run(name, usd, usd ?? 0, khr, khr ?? 0)).lastInsertRowid)
  raw.prepare('INSERT INTO _legacy_long(id) VALUES(?)').run(id)
  return id
}
const entries = (id) => raw.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=?').get(id).n
const pair = (id) => { const r = row(id); return [r.cost_price_usd, r.purchase_price_usd, r.cost_price_khr, r.purchase_price_khr] }
const queuePlanless = (actionType, productId, payload) => Number(raw.prepare(
  "INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,status,requested_by,requested_by_name) VALUES('products',?,'product',?,?,'open',2,'Requester')")
  .run(actionType, productId, JSON.stringify(payload)).lastInsertRowid)
const approve = (pendingId) => request(reviews, 'POST', `/${pendingId}/approve`, {})
const finish = (id) => raw.prepare('INSERT OR IGNORE INTO _legacy_long(id) SELECT ?').run(id)

async function scenarios() {
  // ---- create ------------------------------------------------------------------------------------------------------------------------------
  const created = await request(products, 'POST', '/', { name: 'W create', cost_price_usd: 4.166666666, cost_price_khr: '4100.12345' })
  assert.equal(created.status, 200, JSON.stringify(created))
  assert.deepEqual(pair(created.body.id), [4.1667, 4.1667, 4100.1235, 4100.1235], 'create: typed costs stored at 4 places, twin and KHR included (4100.12345 is a tie, goes up)')
  const tie = await request(products, 'POST', '/', { name: 'W create tie', cost_price_usd: '1.00105' })
  assert.deepEqual(pair(tie.body.id).slice(0, 2), [1.0011, 1.0011], 'create: the decimal tie 1.00105 goes up (the double 1.00105 times 10000 is 10010.499999999998)')
  const lone = await request(products, 'POST', '/', { name: 'W create purchase', purchase_price_usd: '2.00005', purchase_price_khr: 9000.12345 })
  assert.deepEqual(pair(lone.body.id), [null, 2.0001, null, 9000.1235], 'create: a lone purchase cost is rounded too')
  assert.deepEqual(census(), { products: 0, lots: 0, entries: 0 }, 'census after create')

  // ---- edit --------------------------------------------------------------------------------------------------------------------------------
  const legacy = seedLegacy('W legacy', 4.166667, 4100.12345)
  const before = entries(legacy)
  assert.equal((await request(products, 'PUT', `/${legacy}`, { cost_price_usd: 4.166667, cost_price_khr: 4100.12345 })).status, 200)
  assert.deepEqual(pair(legacy), [4.1667, 4.1667, 4100.1235, 4100.1235], 'edit: re-saving the stored legacy value rounds it (the preserve-legacy rule is gone), twin follows')
  assert.equal(entries(legacy), before, 'edit: rounding a legacy cost is not a typed cost, so no manual cost entry (it would freeze the catalog formula)')
  finish(legacy)
  const typed = seedLegacy('W typed', 3, null)
  assert.equal((await request(products, 'PUT', `/${typed}`, { cost_price_usd: '1.00015' })).status, 200)
  assert.deepEqual(pair(typed).slice(0, 2), [1.0002, 1.0002], 'edit: a typed tie 1.00015 goes up')
  assert.equal(raw.prepare('SELECT cost_usd c FROM product_cost_entries WHERE product_id=? ORDER BY id DESC LIMIT 1').get(typed).c, 1.0002, 'edit: the manual cost entry holds the stored 4-place figure')
  finish(typed)
  assert.deepEqual(census(), { products: 0, lots: 0, entries: 0 }, 'census after edit')

  // ---- a request queued before 13 Sep 2026 (no money plan), approved today -------------------------------------------------------------------
  const queued = seedLegacy('W queued', 3, 4000)
  const pending = queuePlanless('update', queued, { cost_price_usd: 4.16666666, cost_price_khr: '4100.12345', purchase_price_usd: 2.00005, selling_price_usd: 1.23004 })
  assert.equal((await approve(pending)).status, 200)
  const q = row(queued)
  assert.deepEqual([q.cost_price_usd, q.cost_price_khr], [4.1667, 4100.1235], 'queue update: cost and KHR rounded at apply')
  assert.equal(q.purchase_price_usd, 4.1667, 'queue update: the twin is the stored cost')
  assert.equal(q.selling_price_usd, 1.23004, 'queue update: a selling price keeps the legacy reading (only costs are in this rule)')
  finish(queued)
  const queuedTwin = seedLegacy('W queued twin', 3, null)
  assert.equal((await approve(queuePlanless('update', queuedTwin, { purchase_price_usd: '3.45675' }))).status, 200)
  assert.equal(row(queuedTwin).purchase_price_usd, 3.4568, 'queue update: a lone purchase cost is rounded (tie goes up)')
  finish(queuedTwin)
  const createPending = queuePlanless('create', null, { name: 'W queued create', cost_price_usd: '4.16666666', cost_price_khr: 4100.12345, purchase_price_usd: 99 })
  assert.equal((await approve(createPending)).status, 200)
  const made = raw.prepare("SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd FROM products WHERE name='W queued create'").get()
  assert.deepEqual({ ...made, id: 0 }, { id: 0, cost_price_usd: 4.1667, cost_price_khr: 4100.1235, purchase_price_usd: 4.1667 }, 'queue create: rounded at apply')
  assert.deepEqual(census(), { products: 0, lots: 0, entries: 0 }, 'census after the queue')

  // ---- planInsertRow (stock-in session, review create) ---------------------------------------------------------------------------------------
  const columns = new Set(['name', 'cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr', 'is_active', 'created_at', 'updated_at'])
  const plan = writer.planInsertRow('products', { name: 'W planned', cost_price_usd: 4.16666666, cost_price_khr: 4100.12345 }, columns, { is_active: 1 })
  const names = /INSERT INTO "products" \((.*?)\) VALUES/.exec(plan.sql)[1].split(', ').map((c) => c.replace(/"/g, ''))
  const named = Object.fromEntries(names.map((c, i) => [c, plan.params[`value${i}`]]))
  assert.deepEqual([named.cost_price_usd, named.purchase_price_usd, named.cost_price_khr, named.purchase_price_khr], [4.1667, 4.1667, 4100.1235, 4100.1235], 'planInsertRow: rounded in the INSERT')

  // ---- exact ties ---------------------------------------------------------------------------------------------------------------------------
  for (const [input, want] of [['1.00015', 1.0002], ['1.00105', 1.0011], ['2.00005', 2.0001], ['0.00005', 0.0001], ['0.00015', 0.0002], ['3.12345', 3.1235], ['1.00014', 1.0001], ['4.1666666666', 4.1667], ['1.2333333333333334', 1.2333], ['149.573577', 149.5736]]) {
    assert.equal(money.roundMoney4(input), want, `roundMoney4(${input})`)
    assert.equal(money.roundMoney4(Number(input)), want, `roundMoney4(Number(${input}))`)
  }
  assert.equal(money.meanMoney4([1.0001, 1.0002]), 1.0002, 'mean of 1.0001 and 1.0002 is the tie 1.00015: away from zero')
  assert.equal(money.meanMoney4([1.1, 1.2, 1.4]), 1.2333)
  assert.equal(money.weightedMeanMoney4([{ amount: 1.0001, factor: 1 }, { amount: 1.0002, factor: 1 }], 2), 1.0002, 'weighted tie')
  // The SQL nudge the catalog formula, the merge authority and the repair use equals the exact decimal on 40,000 decimal ties; ROUND(x, 4) does not.
  const nudge = raw.prepare('SELECT ROUND(?, 4) r, CAST(? * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 n')
  let sqliteRoundWrong = 0
  for (let k = 10000; k < 50000; k++) {
    const text = `${Math.floor(k / 10000)}.${String(k % 10000).padStart(4, '0')}5`
    const want = money.roundMoney4(text)
    const got = nudge.get(Number(text), Number(text))
    assert.equal(got.n, want, `nudge(${text})`)
    if (got.r !== want) sqliteRoundWrong++
  }
  assert.ok(sqliteRoundWrong > 10000, `SQLite ROUND(x, 4) rounds the binary double and lands ${sqliteRoundWrong} of 40000 decimal ties on the wrong side: the reason no cost path uses it`)
  assert.deepEqual(census(), { products: 0, lots: 0, entries: 0 }, 'census at the end')
}

async function main() {
  await scenarios()
  console.log('test-cost-4dp-writers-native: scenarios ok')
}

if (MUTANT) {
  main().then(() => { console.log(`SURVIVED ${MUTANT}`); process.exitCode = 0 }).catch((e) => { console.log(`KILLED ${MUTANT}: ${String(e.message).split('\n')[0].slice(0, 160)}`); process.exitCode = 1 })
} else {
  main().then(() => {
    // Mutants: one child process each, the same scenarios with that writer's rounding removed from the source text; all must go red.
    for (const name of Object.keys(MUTANTS)) {
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, COST4DP_MUTANT: name }, encoding: 'utf8' })
      const line = String(r.stdout).split('\n').find((l) => /^(KILLED|SURVIVED)/.test(l)) || String(r.stderr).split('\n')[0]
      assert.notEqual(r.status, 0, `mutant survived: ${name}`)
      assert.ok(/^KILLED/.test(line), `mutant did not run its scenarios: ${name}: ${line}`)
      console.log(`PASS mutant killed: ${name}`)
    }
    console.log(`test-cost-4dp-writers-native: ${Object.keys(MUTANTS).length} mutants killed`)
  }).catch((e) => { console.error(e); process.exitCode = 1 })
}
