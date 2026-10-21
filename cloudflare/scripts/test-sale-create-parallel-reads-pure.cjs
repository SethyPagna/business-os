// POST /api/sales (create): the reads that depend only on the request body run together,
// not one after another (AUDIT-PERFORMANCE finding 4, lane 6.0.913).
//
// Drives the real route on the fully migrated schema through the atomic-create harness and
// wraps D1 so every call is traced with its dependency depth: a call starts at
// (deepest call finished so far) + 1, so a chain of awaits adds one per call and calls started
// together share a depth. The deepest call before the atomic write batch is the number of D1
// round trips the cashier waits on before the write.
//
//   BEFORE (base 18c5c5c45): 10 sequential reads before the batch for a 1-line sale with a customer.
//   AFTER: the reads share depth; the answer, the statements issued and the write batch are the same.
//
// The error precedence cases pin that a read started early never changes WHICH refusal a caller
// gets, and that a started read that fails after an early refusal is not an unhandled rejection.
//
// Run: node scripts/test-sale-create-parallel-reads-pure.cjs
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
harness._compile(harnessSource.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale,creationState};', harnessFile)
const h = harness.exports

// Tracing wrapper: every prepare().all/get/run and batch() is one D1 call.
function traced(route, options = {}) {
  const calls = []
  let finishedDepth = 0
  const record = async (kind, sql, params, run) => {
    if (/stock_transaction_permit/.test(sql)) return run() // the harness's own admission check, not the route
    const call = { kind, sql: String(sql).replace(/\s+/g, ' ').trim(), params: JSON.stringify(params ?? null), depth: finishedDepth + 1, batch: kind === 'batch' }
    calls.push(call)
    await new Promise((resolve) => setImmediate(resolve))
    if (options.failOn && options.failOn.test(call.sql)) { finishedDepth = Math.max(finishedDepth, call.depth); throw new Error('injected read failure') }
    const value = await run()
    finishedDepth = Math.max(finishedDepth, call.depth)
    return value
  }
  const api = {
    prepare(sql) {
      const statement = route.prepare(sql)
      return {
        all: (params) => record('all', sql, params, () => statement.all(params)),
        get: (params) => record('get', sql, params, () => statement.get(params)),
        run: (params) => record('run', sql, params, () => statement.run(params)),
      }
    },
    batch: (statements) => record('batch', `batch(${statements.length})`, null, () => route.batch(statements)),
    exec: (sql) => route.exec(sql),
  }
  api.staging = api
  return { api, calls }
}

const beforeBatch = (calls) => calls.slice(0, calls.findIndex((call) => call.batch))
const rounds = (list) => list.reduce((deepest, call) => Math.max(deepest, call.depth), 0)

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.stack}`) }
}

function withCustomer(f, body) {
  f.raw.prepare("INSERT INTO customers(id,name,membership_number,is_anonymous) VALUES(30,'Sok','M-30',0)").run()
  return { ...body, customer_id: 30 }
}

;(async () => {
  await check('a 1-line sale with a customer does its independent reads in few round trips and records the same sale', async () => {
    const f = h.fixture()
    const { api, calls } = traced(f.route)
    const created = await h.postSale(api, withCustomer(f, h.request('parallel-1')))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const reads = beforeBatch(calls)
    const statementsBefore = reads.length; if (process.env.TRACE) for (const call of reads) console.log(call.depth, call.sql.slice(0, 110))
    const roundTrips = rounds(reads)
    console.log(`  measured: ${statementsBefore} statements before the write batch in ${roundTrips} round trips (sequential would be ${statementsBefore})`)
    assert.ok(statementsBefore >= 8, `the route still issues its reads (${statementsBefore})`)
    if (!process.env.DIGEST) assert.ok(roundTrips <= 3, `independent reads share a round trip (${roundTrips} round trips for ${statementsBefore} statements)`)
    if (process.env.DIGEST) {
      const batchCall = calls.find((call) => call.batch)
      const volatile = /receipt_number = ?|sale_items|system_flags/
      console.log('DIGEST', JSON.stringify({ reads: reads.map((call) => call.sql + call.params).filter((text) => !volatile.test(text)).sort(), state: h.creationState(f.raw), status: created.status, total: created.body.totalUsd, batch: batchCall.sql }))
    }
    const state = h.creationState(f.raw)
    assert.deepEqual({ sales: state.sales, items: state.items, product: state.product, branch: state.branch, batch: state.batch }, { sales: 1, items: 1, product: 9, branch: 9, batch: 9 })
    const sqlHeads = reads.map((call) => call.sql.slice(0, 60)).sort()
    for (const needle of ['FROM branches WHERE id IN', 'SELECT * FROM products WHERE id IN', 'FROM branch_stock WHERE branch_id', "key IN ('exchange_rate','change_exchange_rate')", 'FROM customers WHERE id = ?', "key = 'loyalty_points_enabled'", 'FROM promotion_rules WHERE is_active=1', 'SELECT name FROM branches WHERE id = ?']) {
      assert.ok(reads.some((call) => call.sql.includes(needle)), `read still issued: ${needle}\n${sqlHeads.join('\n')}`)
    }
    assert.ok(reads.some((call) => /product_batches|branch_batch_stock/.test(call.sql)), 'the lot availability read is still issued')
  })

  await check('the answer is the same with and without tracing (the wrapper adds latency, not behaviour)', async () => {
    const plain = h.fixture()
    const withTrace = h.fixture()
    const a = await h.postSale(plain.route, h.request('same-answer'))
    const b = await h.postSale(traced(withTrace.route).api, h.request('same-answer'))
    assert.equal(a.status, 200)
    assert.equal(b.status, 200)
    const strip = ({ body }) => ({ itemCount: body.itemCount, totalUsd: body.totalUsd, totalKhr: body.totalKhr, changeUsd: body.changeUsd, saleStatus: body.saleStatus, lines: body.sale.items.map((item) => [item.product_id, item.quantity, item.batch_id]) })
    assert.deepEqual(strip(b), strip(a))
  })

  await check('precedence: an inactive branch is refused 400 before an unknown product or a stock shortage is looked at', async () => {
    const f = h.fixture()
    f.raw.prepare('UPDATE branches SET is_active = 0 WHERE id = 1').run()
    const body = h.request('prec-branch')
    body.items[0].quantity = 999
    const refused = await h.postSale(traced(f.route).api, body)
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(h.creationState(f.raw).sales, 0)
  })

  await check('precedence: a stock shortage is refused 409 even though a bad promotion read, customer and lots were started alongside it', async () => {
    const f = h.fixture()
    const body = withCustomer(f, h.request('prec-stock'))
    body.items[0].quantity = 999
    const refused = await h.postSale(traced(f.route).api, body)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.match(refused.body.error, /^Insufficient stock for Powder: requested 999, available 10$/)
    assert.equal(h.creationState(f.raw).sales, 0)
  })

  await check('an early refusal with a failing started read is that refusal, not a 500, and raises no unhandled rejection', async () => {
    const f = h.fixture()
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const body = h.request('prec-unhandled')
      body.items[0].quantity = 999
      const refused = await h.postSale(traced(f.route, { failOn: /FROM promotion_rules/ }).api, body)
      assert.equal(refused.status, 409, 'the stock shortage is reported even though the promotion read was going to fail')
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.deepEqual(unhandled, [])
    } finally { process.removeListener('unhandledRejection', onUnhandled) }
  })

  await check('control: the same failing read on a sale that reaches it fails the request and records nothing', async () => {
    const f = h.fixture()
    const { api } = traced(f.route, { failOn: /FROM promotion_rules/ })
    const outcome = await h.postSale(api, h.request('prec-failing')).then((response) => response.status, () => 'threw')
    assert.ok(outcome === 'threw' || outcome >= 500, `the failure surfaces (${outcome})`)
    assert.equal(h.creationState(f.raw).sales, 0)
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
})()
