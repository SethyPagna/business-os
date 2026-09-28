// P5 (SCAN1, 2026-09-28): no statement in the POS sale-create write batch may
// scan a whole table.
//
// canonicalSaleChildrenGuard looked the new sale up with
// `client_request_id=@canonicalSale` alone. The only index on that column is
// the partial idx_sales_client_request_unique_pg (`... <> ''`), and `x = ?`
// does not imply `x <> ''`, so SQLite scanned every sale twice inside every
// checkout's atomic batch (and again on each receipt-race retry).
//
// Drives the real POST /api/sales on the fully migrated schema, captures the
// exact batch the route hands D1, rewrites @name to ? the way lib/db.ts
// translate() does, and EXPLAINs every statement. A SCAN of a CTE, a
// json_each virtual table or a constant row is fine; a SCAN of a real table is
// not. The guard must also still find THIS sale by its write key: an index-
// friendly rewrite that looks at some other sale (or at none) is refused.
//
// Run: node scripts/test-sale-create-write-batch-no-scan-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const harnessFile = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const harnessSource = fs.readFileSync(harnessFile, 'utf8')
const boundary = harnessSource.indexOf(';(async () => {')
assert.ok(boundary > 0, 'test-sale-create-atomic-pure.cjs changed shape; update this harness import')
const harness = new Module(harnessFile, module)
harness.filename = harnessFile
harness.paths = module.paths
harness._compile(harnessSource.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale};', harnessFile)
const h = harness.exports

const translate = (sql) => sql.replace(/@(\w+)/g, '?')

function realTables(raw) {
  return new Set(raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
}

function scannedTables(raw, sql, tables) {
  const plan = raw.prepare('EXPLAIN QUERY PLAN ' + translate(sql)).all().map((row) => row.detail)
  const scanned = []
  for (const detail of plan) {
    const match = /^SCAN (\w+)/.exec(detail)
    if (!match || match[1] === 'CONSTANT' || /VIRTUAL TABLE/.test(detail)) continue
    const alias = new RegExp(`\\b(?:FROM|JOIN)\\s+(\\w+)\\s+(?:AS\\s+)?${match[1]}\\b`, 'i').exec(sql)
    const table = alias ? alias[1] : match[1]
    if (tables.has(table)) scanned.push(`${table} (${detail})`)
  }
  return scanned
}

async function createCapturing(f, key) {
  let captured = null
  f.hooks.beforeBatch = async (_db, statements) => {
    if (!captured) captured = statements.map((statement) => ({ sql: statement.sql, params: statement.params }))
  }
  const created = await h.postSale(f.route, h.request(key))
  f.hooks.beforeBatch = null
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.ok(captured && captured.length > 5, 'the create batch was not captured')
  return captured
}

function childrenGuard(statements) {
  const guards = statements.filter((statement) => /^INSERT INTO sale_mutation_guards\(id,guard_value\) SELECT 3,/.test(statement.sql.trim())
    && /FROM sale_items/.test(statement.sql))
  assert.equal(guards.length, 1, 'expected exactly one canonical-children guard in the create batch')
  return guards[0]
}

// The guard's own verdict (1 = pass) for a write key, read without writing.
function guardVerdict(raw, guard, key) {
  const select = guard.sql.trim().replace(/^INSERT INTO sale_mutation_guards\(id,guard_value\) SELECT 3,/, 'SELECT ')
  const names = [...guard.sql.matchAll(/@(\w+)/g)].map((m) => m[1])
  const values = names.map((name) => (name === 'canonicalSale' ? key : guard.params[name] ?? null))
  const row = raw.prepare(translate(select) + ' AS verdict').get(...values)
  return Number(row.verdict)
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

;(async () => {
  const hooks = {}
  const f = h.fixture({ beforeBatch: (...args) => (hooks.beforeBatch ? hooks.beforeBatch(...args) : undefined) })
  f.hooks = hooks
  const raw = f.raw.db
  const tables = realTables(raw)
  const firstBatch = await createCapturing(f, 'p5-first-sale')
  const secondBatch = await createCapturing(f, 'p5-second-sale')

  await check('no statement in the sale-create write batch scans a real table', () => {
    const offenders = []
    for (const [index, statement] of firstBatch.entries()) {
      for (const scan of scannedTables(raw, statement.sql, tables)) offenders.push(`#${index}: ${scan}\n        ${statement.sql.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
    assert.deepEqual(offenders, [], `full-table scans inside the atomic create batch:\n      ${offenders.join('\n      ')}`)
  })

  await check('the canonical-children guard reaches the new sale through the partial request-id index', () => {
    const guard = childrenGuard(firstBatch)
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + translate(guard.sql)).all().map((row) => row.detail)
    assert.ok(plan.some((detail) => /SEARCH sales USING COVERING INDEX idx_sales_client_request_unique_pg/.test(detail)),
      `expected an index SEARCH of sales, got:\n      ${plan.join('\n      ')}`)
    assert.ok(!plan.some((detail) => /^SCAN sales\b/.test(detail)), plan.join(' | '))
  })

  await check('the guard still judges THIS sale by its write key (not another sale, not none)', () => {
    const guard = childrenGuard(secondBatch)
    assert.equal(guardVerdict(raw, guard, 'p5-first-sale'), 1, 'a committed, valid sale must pass its guard')
    assert.equal(guardVerdict(raw, guard, 'p5-second-sale'), 1)
    const firstSaleId = raw.prepare("SELECT id FROM sales WHERE client_request_id='p5-first-sale'").get().id
    raw.prepare('UPDATE sale_items SET quantity=0 WHERE sale_id=?').run(firstSaleId)
    assert.equal(guardVerdict(raw, guard, 'p5-first-sale'), 0, 'a zero-quantity line on the keyed sale must fail its guard')
    assert.equal(guardVerdict(raw, guard, 'p5-second-sale'), 1, 'the other sale is untouched and still passes')
    assert.equal(guardVerdict(raw, guard, 'p5-no-such-sale'), 0, 'an unknown key has no lines and must fail closed')
    assert.equal(guardVerdict(raw, guard, ''), 0, 'the empty key never names a sale')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
