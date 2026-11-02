// P1.1 call counting, unit level. The Free per-invocation D1 limit (50) counts CALLS: a db.batch() is ONE, however many
// statements it holds (developers.cloudflare.com/d1/platform/limits). The `call_counting` switch makes write-path admission
// charge a batch as one call; OFF keeps the statement count, and the Paid tier never consults the switch.
//
// One discriminating pair per admission site, on the REAL modules: with the switch ON a 60-statement batch is admitted on
// Free and a request one call past the limit is refused; with it OFF the same batch is refused. A guard that still charges
// statements fails the first half, a guard that stops counting fails the second. The real-Worker, 50-call-enforced shapes
// are in test-call-counting-free-native.cjs; the row-for-row parity with Paid in test-call-counting-parity-native.cjs.
//
// Run: node scripts/test-call-counting-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const SRC = path.join(__dirname, '..', 'src')
function makeLoader(overrides = {}) {
  const cache = new Map()
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports
    const out = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.hasOwn(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : resolved + '.ts')
    }
    new Function('require', 'module', 'exports', out)(localRequire, mod, mod.exports)
    return mod.exports
  }
  return load
}

const SWITCH_ROW = (value) => ({ value })
const sixty = Array.from({ length: 60 }, (_, i) => ({ sql: 'S' + i }))
const tests = []
const check = (name, fn) => tests.push({ name, fn })

// A binding whose system_flags read is scripted and counted.
function switchEnv(tier, row, options = {}) {
  const reads = { n: 0 }
  const DB = { marker: Math.random() }
  const db = {
    prepare: () => ({
      all: async () => { reads.n += 1; if (options.fail) throw new Error('D1_ERROR: network down'); return row === undefined ? [] : [SWITCH_ROW(row)] },
      get: async () => undefined, run: async () => ({}),
    }),
    batch: async () => [],
  }
  return { env: { PLAN_TIER: tier, DB, __db: db }, reads, db }
}
const rowWith = (value) => JSON.stringify({ epoch: 1, switches: { call_counting: value } })

function modules(db) {
  return makeLoader({ './db': { getDb: (env) => env.__db || db }, '../durable-objects/broadcastHub': {}, './cache': {} })
}

check('readSwitch: only the exact token "on" is ON; any other spelling, a missing row and a failed read are OFF', async () => {
  for (const [label, row, expected, fail] of [
    ['on', rowWith('on'), true], ['off', rowWith('off'), false], ['upper case', rowWith('ON'), false], ['padded', rowWith('on '), false],
    ['shadow', rowWith('shadow:0.05'), false], ['boolean true', rowWith(true), false], ['number 1', rowWith(1), false],
    ['another switch only', JSON.stringify({ switches: { probe: 'on' } }), false], ['no switches key', JSON.stringify({ epoch: 3 }), false],
    ['an array', JSON.stringify({ switches: ['call_counting'] }), false], ['malformed JSON', '{"switches":{"call_counting":"on"', false],
    ['not an object', '"on"', false], ['no row', undefined, false], ['read fails', rowWith('on'), false, true],
  ]) {
    const { env } = switchEnv('free', row, { fail })
    const { readSwitch } = modules()('lib/readSwitches.ts')
    assert.equal(await readSwitch(env, 'call_counting'), expected, label)
  }
})

check('readSwitch: one read per memo period per database binding; a second binding reads on its own', async () => {
  const { readSwitch } = modules()('lib/readSwitches.ts')
  const a = switchEnv('free', rowWith('on'))
  for (let i = 0; i < 5; i++) assert.equal(await readSwitch(a.env, 'call_counting'), true)
  assert.equal(a.reads.n, 1)
  const b = switchEnv('free', undefined)
  assert.equal(await readSwitch(b.env, 'call_counting'), false)
  assert.equal(b.reads.n, 1)
  assert.equal(await readSwitch(a.env, 'call_counting'), true, 'the first binding is unaffected by the second')
  assert.equal(a.reads.n, 1)
})

check('callCountingOn: Paid never reads the switch (0 reads), even when the row says on; Free reads it', async () => {
  const load = modules()
  const planTier = load('lib/planTier.ts')
  const { callCountingOn } = load('lib/callCounting.ts')
  const paid = switchEnv('paid', rowWith('on'))
  planTier.__resetPlanTierCacheForTests()
  assert.equal(await callCountingOn(paid.env), false)
  assert.equal(paid.reads.n, 0, 'the Paid path makes no switch read')
  const unset = switchEnv(undefined, rowWith('on'))
  planTier.__resetPlanTierCacheForTests()
  assert.equal(await callCountingOn(unset.env), false, 'an unset tier is Paid')
  assert.equal(unset.reads.n, 0)
  const free = switchEnv('free', rowWith('on'))
  planTier.__resetPlanTierCacheForTests()
  assert.equal(await callCountingOn(free.env), true)
  assert.equal(free.reads.n, 1)
  planTier.__resetPlanTierCacheForTests()
})

check('middleware: the Free request gets one lazy resolver (a single read for many awaits); Paid gets none; nothing is read unless asked', async () => {
  const load = modules()
  const planTier = load('lib/planTier.ts')
  const metrics = load('lib/requestMetrics.ts')
  const { callCountingMiddleware } = load('lib/callCounting.ts')
  const run = async (tier, row) => {
    const { env, reads } = switchEnv(tier, row)
    planTier.__resetPlanTierCacheForTests()
    const seen = {}
    const app = new Hono()
    app.use('/api/*', metrics.requestMetricsMiddleware)
    app.use('/api/*', callCountingMiddleware)
    app.get('/api/probe', async (c) => {
      const m = metrics.requestMetricsOf(c)
      seen.hasResolver = typeof m.callCounting === 'function'
      seen.readsBeforeAsk = reads.n
      if (seen.hasResolver) seen.answers = [await m.callCounting(), await m.callCounting(), await m.callCounting()]
      return c.json({})
    })
    const response = await app.request('/api/probe', {}, env, { waitUntil() {}, passThroughOnException() {} })
    assert.equal(response.status, 200)
    return { seen, reads: reads.n }
  }
  const free = await run('free', rowWith('on'))
  assert.equal(free.seen.hasResolver, true)
  assert.equal(free.seen.readsBeforeAsk, 0, 'registering the resolver reads nothing')
  assert.deepEqual(free.seen.answers, [true, true, true])
  assert.equal(free.reads, 1, 'three awaits, one read')
  const off = await run('free', rowWith('off'))
  assert.deepEqual(off.seen.answers, [false, false, false])
  const paid = await run('paid', rowWith('on'))
  assert.equal(paid.seen.hasResolver, false, 'Paid requests carry no resolver at all')
  assert.equal(paid.reads, 0)
  planTier.__resetPlanTierCacheForTests()
})

// ---- the invocation counters --------------------------------------------------------------------------------------
function scriptedD1(onCall) {
  let calls = 0
  const metaFor = (n) => Array.from({ length: n }, () => ({ rows_read: 1, rows_written: 0, duration: 0 }))
  const prepared = () => ({ bind() { return this }, async all() { calls += 1; onCall?.(calls); return { results: [], meta: metaFor(1)[0] } }, async first() { calls += 1; onCall?.(calls); return null },
    async run() { calls += 1; onCall?.(calls); return { results: [], meta: metaFor(1)[0] } } })
  return { prepare: prepared, async batch(items) { calls += 1; onCall?.(calls); return items.map(() => ({ results: [], meta: metaFor(1)[0] })) }, calls: () => calls }
}
async function inRequest(body) {
  const load = makeLoader({ './importMaintenanceFence': {} })
  const metrics = load('lib/requestMetrics.ts')
  const dbModule = load('lib/db.ts')
  const app = new Hono()
  let acc
  app.use('/api/*', metrics.requestMetricsMiddleware)
  app.get('/api/x', async (c) => { acc = metrics.requestMetricsOf(c); await body({ dbModule, metrics }); return c.json({}) })
  const pending = []
  const response = await app.request('/api/x', {}, {}, { waitUntil(p) { pending.push(p) }, passThroughOnException() {} })
  assert.equal(response.status, 200)
  await Promise.allSettled(pending)
  return acc
}

check('counters: a db.batch() is ONE call and N statements; the legacy statement counters are unchanged', async () => {
  const acc = await inRequest(async ({ dbModule }) => {
    const db = new dbModule.D1Compat(scriptedD1())
    await db.batch(sixty)
    await db.batchOnce(sixty)
  })
  assert.equal(acc.invocation.attemptedCalls, 2, 'two 60-statement batches are two calls')
  assert.equal(acc.invocation.attemptedStatements, 120, 'OFF reads this field: still the statement count')
  assert.equal(acc.attemptedStatements, 120)
})

check('counters: 51 single calls are 51 calls (the Free limit is crossed by the 51st)', async () => {
  const acc = await inRequest(async ({ dbModule }) => {
    const db = new dbModule.D1Compat(scriptedD1())
    for (let i = 0; i < 51; i++) await db.prepare('Q' + i).getOnce()
  })
  assert.equal(acc.invocation.attemptedCalls, 51)
})

check('counters: a retried call is two calls', async () => {
  const acc = await inRequest(async ({ dbModule }) => {
    let failed = false
    const native = scriptedD1((n) => { if (n === 1 && !failed) { failed = true; throw new Error('D1_ERROR: network connection lost') } })
    const db = new dbModule.D1Compat(native)
    await db.prepare('Q').all()
    assert.equal(native.calls(), 2, 'the transient error was retried')
  })
  assert.equal(acc.invocation.attemptedCalls, 2)
})

check('counters: the raw dispatch counts the calls it is told (one), whatever its statement count; omitted means one', async () => {
  const acc = await inRequest(async ({ metrics }) => {
    const hook = globalThis[Symbol.for(metrics.REQUEST_METRICS_HOOK_KEY)]
    hook.rawD1Start(62, 1)
    hook.rawD1Start(1)
  })
  assert.equal(acc.invocation.attemptedCalls, 2)
  assert.equal(acc.invocation.attemptedStatements, 63)
})

check('counters: background work attached to the request shares the invocation; runBackground children too', async () => {
  const acc = await inRequest(async ({ dbModule, metrics }) => {
    const db = new dbModule.D1Compat(scriptedD1())
    await db.prepare('route').getOnce()
    await metrics.runBackground({}, 'child', async () => { await db.prepare('child 1').getOnce(); await db.batch(sixty) })
  })
  assert.equal(acc.invocation.attemptedCalls, 3, 'the route call, the child read and the child batch share one invocation')
  assert.equal(acc.attemptedCalls ?? 0, 0, 'the route accumulator itself has no call counter: the invocation owns it')
})

// ---- admission sites ----------------------------------------------------------------------------------------------
const ENV_FREE = { PLAN_TIER: 'free' }

// A fixture that counts the way Cloudflare does: every prepared read/write is a call, a db.batch() is ONE call.
function callFixture(lines) {
  const { fixture, seedDistinctProducts } = require('./test-stock-session-atomic.cjs')
  const f = fixture(), raw = f.env.DB
  f.env.PLAN_TIER = 'free'
  if (lines > 1) seedDistinctProducts(f, lines)
  let calls = 0, batches = 0, statements = 0
  const statement = (p) => new Proxy(p, { get(t, k) {
    if (k === 'bind') return (...params) => statement(t.bind(...params))
    if (['first', 'all', 'run'].includes(k)) return (...params) => { calls += 1; statements += 1; return t[k](...params) }
    return t[k]
  } })
  f.env.DB = new Proxy(raw, { get(t, k) {
    if (k === 'prepare') return (sql) => statement(t.prepare(sql))
    if (k === 'batch') return (items) => { calls += 1; batches += 1; statements += items.length; return t.batch(items) }
    return t[k]
  } })
  return Object.assign(f, { calls: () => calls, batches: () => batches, statements: () => statements, reset() { calls = 0; batches = 0; statements = 0 } })
}
function sessionOf(lines, id) {
  const { receiveRequest } = require('./test-stock-session-atomic.cjs')
  const body = receiveRequest(id)
  body.items = Array.from({ length: lines }, (_, i) => ({ ...body.items[0], line_id: 'cc-' + i, product_id: i + 1 }))
  return body
}

check('stock session: a 20-line session is admitted on calls ON and refused before any write OFF; the limit is exact in calls', async () => {
  const { loadStockSession, user } = require('./test-stock-session-atomic.cjs')
  const planTier = loadStockSession('lib/planTier.ts')
  planTier.__resetPlanTierCacheForTests()
  const kernel = loadStockSession()
  // OFF: the old statement count refuses it (the failure that motivated the slice).
  const off = callFixture(20)
  await assert.rejects(() => kernel.commitStockSession(off.env, user, sessionOf(20, 'cc-off-20'), null, { statementsUsed: () => 0, reserveStatements: 4 }), (e) => e.code === 'stock_session_query_budget_exceeded')
  assert.equal(off.batches(), 0)
  assert.equal(off.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n, 0)
  assert.equal(off.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n, 0)
  // ON: the same session is admitted; its real call count is far below the limit.
  const on = callFixture(20)
  const receipt = await kernel.commitStockSession(on.env, user, sessionOf(20, 'cc-on-20'), null, { statementsUsed: () => 0, reserveStatements: 4, callCounting: true })
  assert.ok(receipt.operationId)
  assert.equal(on.batches(), 1)
  assert.ok(on.statements() > 50, 'the work is more than 50 statements ' + on.statements() + ' (so OFF refusing it is the statement count)')
  assert.ok(on.calls() < 50, 'and fewer than 50 calls: ' + on.calls())
  assert.equal(on.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n, 100)
  // Exactness: with the invocation already carrying (limit - cold) calls the same session still fits, one more refuses before any write.
  const cold = on.calls()
  for (const extra of [0, 1]) {
    const bound = callFixture(20)
    const perform = () => kernel.commitStockSession(bound.env, user, sessionOf(20, 'cc-bound-' + extra), null, { statementsUsed: () => 50 - cold + extra, reserveStatements: 0, callCounting: true })
    if (extra) {
      await assert.rejects(perform, (e) => e.code === 'stock_session_query_budget_exceeded')
      assert.equal(bound.batches(), 0, 'refused before the batch')
      assert.equal(bound.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n, 0)
      assert.equal(bound.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n, 0)
    } else {
      await perform()
      assert.equal(bound.calls(), cold, 'the run is deterministic: the same call count')
      assert.equal(bound.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n, 100)
    }
  }
  planTier.__resetPlanTierCacheForTests()
})

check('stock receipts: the batch about to be sent is admitted as one call ON and as its statement count OFF; exact at the limit', async () => {
  const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
  const receipts = loadStockSession('lib/stockMutationReceipt.ts')
  const dbModule = loadStockSession('lib/db.ts')
  let serial = 0
  const attempt = async (budget, statements = 62) => {
    const f = fixture()
    const response = await receipts.withStockMutationReceipt(() => dbModule.getDb(f.env), user.id, 'adjust', { client_request_id: `cc-admit-${++serial}-0000`, productId: 1 },
      (value, status) => Response.json(value, { status: status ?? 200 }),
      async (_markWritten, mark) => { mark.admit(statements); return Response.json({ ok: true }) },
      { requireReceipt: true, budget })
    f.sql.close()
    return { status: response.status, code: (await response.json()).code }
  }
  assert.equal((await attempt({ used: () => 0, limit: 50, reserve: 16, callCounting: true })).status, 200)
  const off = await attempt({ used: () => 0, limit: 50, reserve: 16 })
  assert.deepEqual(off, { status: 503, code: 'stock_request_query_budget_exceeded' }, 'OFF: 0 + 62 + 16 is over 50')
  assert.equal((await attempt({ used: () => 33, limit: 50, reserve: 16, callCounting: true })).status, 200, '33 + 1 + 16 = 50 is inside')
  assert.equal((await attempt({ used: () => 34, limit: 50, reserve: 16, callCounting: true })).code, 'stock_request_query_budget_exceeded', '34 + 1 + 16 = 51 is one over')
})

check('bulk returns: planned is one call, the check itself still refuses an oversized plan', async () => {
  const planTier = makeLoader()('lib/planTier.ts')
  planTier.__resetPlanTierCacheForTests()
  const { assertReturnBulkBudget } = makeLoader({ './db': { getDb: () => ({}) }, '../durable-objects/broadcastHub': {}, './cache': {} })('lib/returnBulkAction.ts')
  assertReturnBulkBudget(ENV_FREE, 41, 1, 8)
  assert.throws(() => assertReturnBulkBudget(ENV_FREE, 42, 1, 8), /too large for the current plan/, '42 spent + the batch + 8 reserve is 51')
  assert.throws(() => assertReturnBulkBudget(ENV_FREE, 0, 62, 8), /too large for the current plan/, 'a plan charged as 62 statements is over')
  planTier.__resetPlanTierCacheForTests()
})

check('import stock-action budget: ON a 60-statement batch is one call and the 51st single read is deferred; OFF the batch is deferred', async () => {
  const fake = () => {
    const read = async () => []
    const db = { prepare: () => ({ get: async () => undefined, all: read, run: async () => ({}), getOnce: async () => undefined, allOnce: read }),
      batch: async (items) => items.map(() => ({ results: [], meta: {} })), batchOnce: async (items) => items.map(() => ({ results: [], meta: {} })) }
    db.staging = db
    return db
  }
  const { stockQueryBudgetDb } = makeLoader({ './db': { getDb: () => fake() }, '../durable-objects/broadcastHub': {}, './cache': {} })('lib/importEngine.ts')
  const budgetOf = (wrapped) => wrapped[Object.getOwnPropertySymbols(wrapped).find((symbol) => String(symbol).includes('stockQueryBudget'))]
  const on = stockQueryBudgetDb(fake(), 50, 0, true)
  budgetOf(on).enabled = true
  await on.batch(sixty); await on.batchOnce(sixty)
  assert.equal(budgetOf(on).used, 2, 'two 60-statement batches are two calls')
  budgetOf(on).used = 0
  let deferredAt = 0
  for (let call = 1; call <= 51 && !deferredAt; call++) {
    try { await on.prepare('Q').all() } catch (error) { assert.equal(error.constructor.name, 'StockQueryBudgetDeferred'); deferredAt = call }
  }
  assert.equal(deferredAt, 51, 'exactly the 51st call is over 50')
  const off = stockQueryBudgetDb(fake(), 50)
  budgetOf(off).enabled = true
  await assert.rejects(async () => off.batch(sixty), (error) => error.constructor.name === 'StockQueryBudgetDeferred', 'OFF charges the 60 statements')
  assert.equal(budgetOf(off).unit, 'statement')
  assert.equal(budgetOf(on).unit, 'call')
  assert.equal(budgetOf(on).baseUnit, 'call', 'the historical-sales loop restores to the base unit, not to statements')
})

check('contact merge: ON a six-record batch holds the full cap in one request; OFF it is split by the statement budget', async () => {
  const { contactMergeStatementBudget, CONTACT_MERGE_MAX_STATEMENTS, CONTACT_MERGE_ROUTE_OVERHEAD_QUERIES } = makeLoader()('lib/contactMerge.ts')
  assert.equal(contactMergeStatementBudget(50), 50 - CONTACT_MERGE_ROUTE_OVERHEAD_QUERIES, 'OFF is the old statement budget (27)')
  assert.equal(contactMergeStatementBudget(50, true), CONTACT_MERGE_MAX_STATEMENTS)
  assert.equal(contactMergeStatementBudget(1000), CONTACT_MERGE_MAX_STATEMENTS, 'Paid is unchanged')
  assert.equal(contactMergeStatementBudget(23, true), 1, 'a limit with no room for the batch itself still steps one statement')
})

check('product merge counter: callCount is a call count, statementCount the pacing estimate', async () => {
  const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
  const { createCountedProductMergeDb } = createProductsRouteHarness().load('routes/products.ts')
  const fake = { prepare: () => ({ get: async () => undefined, all: async () => [], run: async () => ({}) }), batch: async (items) => items.map(() => ({})) }
  const counted = createCountedProductMergeDb(fake)
  await counted.db.batch(sixty)
  assert.equal(counted.callCount(), 1)
  assert.equal(counted.statementCount(), 60)
  const singles = createCountedProductMergeDb(fake)
  for (let i = 0; i < 51; i++) await singles.db.prepare('Q').all()
  assert.equal(singles.callCount(), 51)
})

check('fast stock-in cap: Free counts calls to a measured N; Paid is unchanged; OFF keeps the one-line cap', async () => {
  const { PLAN_LIMITS_BY_TIER } = makeLoader()('lib/planTier.ts')
  assert.equal(PLAN_LIMITS_BY_TIER.free.stockInLinesPerRequest, 1, 'OFF is the old Free cap')
  assert.ok(PLAN_LIMITS_BY_TIER.free.stockInLinesPerRequestByCalls > 1, 'ON raises it')
  assert.equal(PLAN_LIMITS_BY_TIER.paid.stockInLinesPerRequestByCalls, PLAN_LIMITS_BY_TIER.paid.stockInLinesPerRequest, 'Paid never counts calls')
})

check('every admission site takes its unit from the same resolver (a source census, so a new site cannot be forgotten)', async () => {
  const text = (file) => fs.readFileSync(path.join(SRC, file), 'utf8')
  const expectations = {
    'routes/inventory.ts': [/const callCounting = \(await metrics\?\.callCounting\?\.\(\)\) === true/g, 2],
    'routes/batches.ts': [/const callCounting = \(await metrics\?\.callCounting\?\.\(\)\) === true/g, 1],
    'routes/returns.ts': [/\(await (?:bulkMetrics|requestMetrics)\?\.callCounting\?\.\(\)\) === true/g, 2],
    'routes/actionHistory.ts': [/\(await metrics\.callCounting\?\.\(\)\) === true/g, 1],
    'routes/products.ts': [/\(await (?:metrics|mergeMetrics)\?\.callCounting\?\.\(\)\) === true/g, 2],
    'routes/contacts.ts': [/\?\.callCounting\?\.\(\)\) === true/g, 1],
    'routes/stockInCommit.ts': [/\(await metrics\?\.callCounting\?\.\(\)\) === true/g, 1],
  }
  for (const [file, [pattern, count]] of Object.entries(expectations)) {
    assert.equal((text(file).match(pattern) || []).length, count, `${file} resolves call_counting ${count} time(s)`)
  }
  // No budget closure may read the legacy statement counter without choosing the unit first.
  for (const file of ['routes/inventory.ts', 'routes/batches.ts', 'routes/actionHistory.ts', 'routes/returns.ts', 'routes/products.ts']) {
    for (const line of text(file).split('\n')) {
      if (/statementsUsed: \(\) =>|used: \(\) =>/.test(line) && /attemptedStatements/.test(line)) assert.match(line, /attemptedCalls/, `${file}: ${line.trim().slice(0, 120)}`)
    }
  }
  // The raw stock transaction and the maintenance dispatch report one call.
  assert.match(text('lib/stockTransaction.ts'), /rawD1Start\?\.\(stockTransactionStatementCount\(statements\.length\), 1\)/)
  // The Worker registers the middleware behind the metrics wrapper, and the queue hook exists for imports.
  assert.match(text('index.ts'), /app\.use\('\/api\/\*', callCountingMiddleware\)/)
  assert.match(text('lib/callCounting.ts'), /Symbol\.for\(CALL_COUNTING_HOOK_KEY\)/)
  assert.match(text('lib/importEngine.ts'), /Symbol\.for\('business-os\.call-counting\.v1'\)/)
  // Reading the switch is itself a D1 call: both import budgets start one higher when ON, so the 51st real call is never hidden.
  const imports = text('lib/importEngine.ts')
  assert.match(imports, /stockQueryBudgetDb\(db, getPlanLimits\(env\)\.d1QueriesPerInvocation, callCounting \? 1 : 0, callCounting\)/)
  assert.match(imports, /stockQueryBudgetDb\(fencedDb, getPlanLimits\(env\)\.d1QueriesPerInvocation, callCounting \? 2 : 1, callCounting\)/)
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.log('FAIL ' + name + '\n  ' + (error && error.stack || error)) }
  }
  if (failed) { console.log(`${failed} of ${tests.length} checks failed`); process.exit(1) }
  console.log(`all ${tests.length} checks passed`)
})()
