// Every per-invocation D1 budget counts CALLS: a db.batch() is ONE query against the limit, however many statements it
// holds (developers.cloudflare.com/d1/platform/limits, updated 24 Oct 2026: "a db.batch() call counts as a single
// query ... a batch containing 2,000 statements executes in a single Worker invocation, while issuing 2,000
// individual queries in one invocation fails"). Free allows 50 queries per invocation, Paid 1000.
//
// One discriminating pair per guard, on the real modules: a 60-statement batch is ALLOWED on Free, and 51 single
// calls are REFUSED. A guard that still charged a batch's statements refuses the first, a guard that stopped
// counting singles allows the second. The request-metrics counter itself is pinned in
// test-request-metrics-pure.cjs; the contact merge budget in test-contact-merge-n-records-native.cjs.
//
// Run: node scripts/test-d1-call-budget-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
function makeLoader(overrides) {
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

const state = { db: null, transactions: [] }
const load = makeLoader({
  './db': { getDb: () => state.db },
  '../durable-objects/broadcastHub': {},
  './cache': {},
})
const planTier = load('lib/planTier.ts')
const FREE = planTier.PLAN_LIMITS_BY_TIER.free.d1QueriesPerInvocation
const freeEnv = { PLAN_TIER: 'free' }
const sixty = Array.from({ length: 60 }, (_, i) => ({ sql: 'S' + i }))

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.log('FAIL ' + name + '\n  ' + (error && error.stack || error)) }
}

function fakeDb() {
  const read = async () => []
  const db = {
    prepare: () => ({ get: async () => undefined, all: read, run: async () => ({}), getOnce: async () => undefined, allOnce: read }),
    batch: async (items) => items.map(() => ({ results: [], meta: {} })),
    batchOnce: async (items) => items.map(() => ({ results: [], meta: {} })),
  }
  db.staging = db
  return db
}

async function main() {
  await check('the Free limit these guards use is the D1 page figure', async () => {
    assert.equal(FREE, 50)
  })

  await check('stock session budget: a 60-statement commit is one call; the 51st single read is refused', async () => {
    planTier.__resetPlanTierCacheForTests()
    const { sessionBudgetDb } = makeLoader({
      './db': { getDb: () => fakeDb() },
      './stockTransaction': { executeStockTransaction: async (_db, statements) => { state.transactions.push(statements.length); return [] },
        stockTransactionStatementCount: (n) => n + 2, StockTransactionUnavailableError: class extends Error {}, StockTransactionOutcomeUnknownError: class extends Error {} },
      '../durable-objects/broadcastHub': {}, './cache': {},
    })('lib/stockSession.ts')
    const budget = { statementsUsed: () => 0, reserveStatements: 6 }
    const allowed = sessionBudgetDb(freeEnv, budget)
    allowed.begin()
    await allowed.commit(sixty)
    assert.deepEqual(state.transactions, [60], 'the 60-statement batch was committed on Free')
    const singles = sessionBudgetDb(freeEnv, { statementsUsed: () => 0, reserveStatements: 0 })
    singles.begin()
    let refusedAt = 0
    for (let call = 1; call <= 51 && !refusedAt; call++) {
      try { await singles.db.prepare('Q').all() } catch (error) { assert.equal(error.code, 'stock_session_query_budget_exceeded'); refusedAt = call }
    }
    assert.ok(refusedAt > 0 && refusedAt <= 51, 'single calls are refused by the 51st')
  })

  await check('import stock-action budget: a 60-statement batch is one call; the 51st single read is deferred', async () => {
    const { stockQueryBudgetDb } = makeLoader({ './db': { getDb: () => fakeDb() }, '../durable-objects/broadcastHub': {}, './cache': {} })('lib/importEngine.ts')
    const wrapped = stockQueryBudgetDb(fakeDb(), FREE)
    const budget = wrapped[Object.getOwnPropertySymbols(wrapped).find((symbol) => String(symbol).includes('stockQueryBudget'))]
    budget.enabled = true
    await wrapped.batch(sixty)
    await wrapped.batchOnce(sixty)
    assert.equal(budget.used, 2, 'two 60-statement batches are two calls')
    budget.used = 0
    let deferredAt = 0
    for (let call = 1; call <= 51 && !deferredAt; call++) {
      try { await wrapped.prepare('Q').all() } catch (error) { assert.equal(error.constructor.name, 'StockQueryBudgetDeferred'); deferredAt = call }
    }
    assert.equal(deferredAt, 51, 'exactly the 51st call is over the Free limit of 50')
  })

  await check('product merge counter: a 60-statement batch is one call, 51 singles are 51', async () => {
    const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
    const { createCountedProductMergeDb } = createProductsRouteHarness().load('routes/products.ts')
    const batch = createCountedProductMergeDb(fakeDb())
    await batch.db.batch(sixty)
    assert.equal(batch.callCount(), 1)
    assert.equal(batch.statementCount(), 60, 'the pacing estimate still sees the statements')
    const singles = createCountedProductMergeDb(fakeDb())
    for (let call = 0; call < 51; call++) await singles.db.prepare('Q').all()
    assert.equal(singles.callCount(), 51)
    // The route's own test: calls so far + the cost-review reads it still plans (8 per 80 members) against the limit.
    const refused = (counter) => counter.callCount() + Math.ceil(1 / 80) * 8 > FREE
    assert.equal(refused(batch), false, 'a 60-statement batch leaves room on Free')
    assert.equal(refused(singles), true, '51 single calls do not')
    const source = fs.readFileSync(path.join(SRC, 'routes/products.ts'), 'utf8')
    assert.ok(source.includes('counted.callCount() + Math.ceil(members.size/80)*8 + 1 >') && source.includes('countedDb.callCount()+Math.ceil(members.size/80)*8 >'),
      'both resolve_plan_budget guards compare calls')
  })

  await check('stock receipt admission: a 60-statement batch is admitted as one call', async () => {
    const seen = []
    const { executeStockMutationBatch } = makeLoader({
      './db': { getDb: () => fakeDb() },
      './stockTransaction': { executeStockTransaction: async () => [], stockTransactionStatementCount: (n) => n + 2,
        StockTransactionUnavailableError: class extends Error {}, stockTransactionRefusal: () => null },
      '../durable-objects/broadcastHub': {}, './cache': {},
    })('lib/stockMutationReceipt.ts')
    await executeStockMutationBatch(fakeDb(), sixty, { statement: () => null, committed() {}, admit: (calls) => seen.push(calls) })
    assert.deepEqual(seen, [1])
  })

  await check('bulk returns and return create: the batch is planned as one call', async () => {
    planTier.__resetPlanTierCacheForTests()
    const { assertReturnBulkBudget } = makeLoader({ './db': { getDb: () => fakeDb() }, '../durable-objects/broadcastHub': {}, './cache': {} })('lib/returnBulkAction.ts')
    assertReturnBulkBudget(freeEnv, 30, 1, 8)
    assert.throws(() => assertReturnBulkBudget(freeEnv, 30, 60, 8), /too large for the current plan/, 'the check itself still refuses an oversized plan')
    assert.throws(() => assertReturnBulkBudget(freeEnv, 42, 1, 8), /too large for the current plan/, 'and 42 single calls plus the batch and its reserve are over 50')
    const bulk = fs.readFileSync(path.join(SRC, 'lib/returnBulkAction.ts'), 'utf8')
    const calls = bulk.match(/assertReturnBulkBudget\(env, queryBudget\.statementsUsed\(\), [^\n]*\)/g) || []
    assert.equal(calls.length, 3)
    for (const call of calls) assert.match(call, /statementsUsed\(\), 1, queryBudget\.reserveStatements\)/, 'planned is 1 call: ' + call)
    for (const [file, text] of [['lib/returnExchangeCreate.ts', 'const transactionStatementCount = 1'], ['routes/returns.ts', 'const transactionStatementCount = 1']]) {
      assert.ok(fs.readFileSync(path.join(SRC, file), 'utf8').includes(text), file + ' plans its batch as one call')
    }
  })

  if (failed) process.exit(1)
  console.log('all checks passed')
}
main()
