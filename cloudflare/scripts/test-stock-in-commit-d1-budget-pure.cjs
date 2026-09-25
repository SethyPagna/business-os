// The fast stock-in commit must fit D1's per-invocation query ceiling on BOTH
// plans (lib/planTier.ts d1QueriesPerInvocation: Free 50, Paid 1000).
//
// POST /api/inventory/fast-stock-in/commit (routes/stockInCommit.ts) used to
// run every line of a session inside one invocation with no cap. Each line
// costs 16-24 D1 calls, so a Free deployment failed at about three lines and
// Paid at a few dozen -- and a line that ran out of queries half way could
// have written stock and still report an error, which a retry then applied
// twice. The route now attempts at most planTier's stockInLinesPerRequest
// lines and answers the rest { ok: false, code: 'deferred' } untouched.
//
// Unlike test-fast-stock-in-commit-pure.cjs (which stubs audit/cache and
// therefore under-counts), this file runs the REAL module graph behind the
// route -- real auth, audit, cache, quota guard, receipt guard, telegram
// settings read, catalog-cost recompute -- against every migration, and
// counts at the D1 BINDING, the level Cloudflare meters. Only the broadcast
// Durable Object and outbound fetch() are stubbed (neither is a D1 query).
// Both counts are kept: CALLS (a batch() is one) and STATEMENTS (a batch()
// is one per statement), because the cap must hold under either reading.
//
// Run (from cloudflare/): node scripts/test-stock-in-commit-d1-budget-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

// The per-line budget planTier.ts sizes the cap with. A kernel that grows past
// it turns this file red, which is the prompt to re-measure and re-size.
const LINE_BUDGET = 33

// ---------------------------------------------------------------------------
// A D1Database binding over node:sqlite that counts what it is asked to do.
// ---------------------------------------------------------------------------
const counts = { calls: 0, statements: 0 }
function resetCounts() { counts.calls = 0; counts.statements = 0 }
function snapshot() { return { calls: counts.calls, statements: counts.statements } }

function makeD1(raw) {
  const statement = (sql) => {
    let values = []
    const exec = () => {
      const prepared = raw.prepare(sql)
      if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = prepared.all(...values)
        return { results: rows, success: true, meta: { changes: 0 } }
      }
      const info = prepared.run(...values)
      return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
    }
    const stmt = {
      bind(...bound) { values = bound; return stmt },
      async first() { counts.calls++; counts.statements++; return raw.prepare(sql).get(...values) ?? null },
      async all() { counts.calls++; counts.statements++; return { results: raw.prepare(sql).all(...values), success: true, meta: {} } },
      async run() { counts.calls++; counts.statements++; return exec() },
      _exec: exec,
    }
    return stmt
  }
  return {
    prepare: statement,
    async batch(list) {
      counts.calls++
      counts.statements += list.length
      raw.exec('BEGIN IMMEDIATE')
      try {
        const out = list.map((item) => item._exec())
        raw.exec('COMMIT')
        return out
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
    async exec(sql) { raw.exec(sql) },
  }
}

// ---------------------------------------------------------------------------
// Real module graph. Every relative import is loaded for real except these.
// ---------------------------------------------------------------------------
const overrides = {
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
}
globalThis.fetch = async () => new Response('{}', { status: 200 })

const moduleCache = new Map()
function load(file) {
  if (moduleCache.has(file)) return moduleCache.get(file)
  const mod = { exports: {} }
  moduleCache.set(file, mod.exports)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText
  const resolve = (request) => {
    if (Object.hasOwn(overrides, request)) return overrides[request]
    if (request.startsWith('.')) {
      const base = path.resolve(path.dirname(file), request)
      return load(fs.existsSync(base + '.ts') ? base + '.ts' : path.join(base, 'index.ts'))
    }
    return require(require.resolve(request, { paths: [cloudflareRoot] }))
  }
  new Function('require', 'module', 'exports', output)(resolve, mod, mod.exports)
  moduleCache.set(file, mod.exports)
  return mod.exports
}
const src = (rel) => path.join(cloudflareRoot, 'src', rel)
const stockInCommitApp = load(src('routes/stockInCommit.ts')).default
const { PLAN_LIMITS_BY_TIER, __resetPlanTierCacheForTests } = load(src('lib/planTier.ts'))
const { ensureCoreDataInvariants } = load(src('lib/coreDataInvariants.ts'))
const { getMaintenance } = load(src('lib/maintenance.ts'))
const { resetStockMutationReceiptSchemaProbe } = load(src('lib/stockMutationReceipt.ts'))

// ---------------------------------------------------------------------------
// Fixture: every migration, the core rows the Worker seeds itself, one admin
// session, and products 1001.. with branch stock.
// ---------------------------------------------------------------------------
const TOKEN = 'budget-test-session-token-0123456789'
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fixture(tier, productCount) {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) raw.exec(sql)
  const kv = new Map()
  const env = {
    DB: makeD1(raw),
    PLAN_TIER: tier,
    // A live KV version key per namespace, as production has.
    CACHE: {
      async get(key) { return kv.has(key) ? kv.get(key) : '1' },
      async put(key, value) { kv.set(key, value) },
      async delete(key) { kv.delete(key) },
    },
  }
  __resetPlanTierCacheForTests()
  resetStockMutationReceiptSchemaProbe()
  const core = await ensureCoreDataInvariants(env)
  const branchId = core.branchId
  for (let i = 1; i <= productCount; i += 1) {
    raw.exec(`INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(${1000 + i}, 'Budget P${i}', 'BUDGET-${i}', 1, 0, 0, 1)`)
    raw.exec(`INSERT OR IGNORE INTO branch_stock(product_id, branch_id, quantity) VALUES(${1000 + i}, ${branchId}, 0)`)
  }
  const tokenHash = await sha256Hex(TOKEN)
  raw.prepare(`INSERT INTO user_sessions(user_id, token_hash, created_at, expires_at) VALUES(?, ?, ?, ?)`)
    .run(core.adminUserId, tokenHash, new Date(Date.now() - 29 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString())
  // Worst case for the session: the touch AND the slide are both due, as they
  // are on the first request after a long idle.
  const armSession = () => raw.prepare(`UPDATE user_sessions SET last_seen_at = NULL, created_at = ?, expires_at = ? WHERE token_hash = ?`)
    .run(new Date(Date.now() - 29 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), tokenHash)
  return { raw, env, branchId, armSession }
}

async function commit(fx, lines) {
  fx.armSession()
  // Every request is measured as a cold isolate: the receipt-table probe runs
  // once per request that carries an identified line.
  resetStockMutationReceiptSchemaProbe()
  const pending = []
  const executionCtx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})) }, passThroughOnException() {} }
  resetCounts()
  const response = await stockInCommitApp.request('/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `bos_session=${TOKEN}` },
    body: JSON.stringify({ lines }),
  }, fx.env, executionCtx)
  const body = await response.json().catch(() => ({}))
  // waitUntil work runs inside the same invocation and spends the same budget.
  while (pending.length) await pending.shift()
  return { status: response.status, results: body.results || [], ...snapshot() }
}

// Line shapes exactly as FastStockInModal.buildLineRequest sends them.
const id = (n, tag) => `budget-${tag}-${String(n).padStart(4, '0')}`
const LINE_KINDS = {
  receive: (n, branchId) => ({ key: `r${n}`, wire: 'receive', body: {
    product_id: 1000 + n, branch_id: branchId, quantity: 2, unit_cost_usd: 1, supplier_name: 'Acme',
    payment_status: 'paid', client_request_id: id(n, 'receive'),
  } }),
  taggedAdd: (n, branchId) => ({ key: `t${n}`, wire: 'adjust', body: {
    productId: 1000 + n, type: 'add', quantity: 2, reason: 'stock in', branchId, conditionTag: 'damaged',
    supplierName: 'Acme', unitCostUsd: 1, paymentStatus: 'paid', client_request_id: id(n, 'tagged'),
  } }),
  setRaising: (n, branchId) => ({ key: `s${n}`, wire: 'adjust', body: {
    productId: 1000 + n, type: 'set', quantity: 5, reason: 'recount', branchId,
    supplierName: 'Acme', unitCostUsd: 1, paymentStatus: 'paid', client_request_id: id(n, 'set'),
  } }),
  taggedRemove: (n, branchId) => ({ key: `m${n}`, wire: 'adjust', body: {
    productId: 1000 + n, type: 'remove', quantity: 1, reason: 'broken', branchId, conditionTag: 'damaged',
    client_request_id: id(n, 'remove'),
  } }),
}
const worstLine = LINE_KINDS.taggedAdd

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// Measured, not assumed: the invocation's work OUTSIDE this route.
let outsideRoute = null
async function measureOutsideRoute() {
  if (outsideRoute) return outsideRoute
  const fx = await fixture('free', 0)
  resetCounts()
  await ensureCoreDataInvariants(fx.env) // index.ts: ensureCoreDataInvariantsOnce, fast path on a seeded DB
  await getMaintenance(fx.env) // index.ts: the write gate reads the maintenance flag
  outsideRoute = snapshot()
  return outsideRoute
}

check('the invocation overhead stays below the conservative planTier.ts allowance', async () => {
  const overhead = await measureOutsideRoute()
  assert.equal(overhead.calls, 2, 'core-invariants projection 1 + maintenance flag 1')
  assert.equal(overhead.statements, 2, 'the invariant projection is one SQL statement')
  const fx = await fixture('free', 0)
  const empty = await commit(fx, [])
  assert.equal(empty.status, 400)
  // session read + touch + slide, all due on a long-idle session.
  assert.equal(empty.calls, 3, 'auth costs one read and, at worst, two session writes')
})

check('every line shape the modal sends stays inside the per-line budget planTier.ts uses', async () => {
  for (const [kind, build] of Object.entries(LINE_KINDS)) {
    const fx = await fixture('free', 1)
    if (kind === 'taggedRemove') {
      // Stock to remove first, through the same route.
      const primed = await commit(fx, [LINE_KINDS.receive(1, fx.branchId)])
      assert.equal(primed.results[0]?.ok, true, `prime receive: ${JSON.stringify(primed.results[0])}`)
    }
    const empty = await commit(await fixture('free', 0), [])
    const one = await commit(fx, [build(1, fx.branchId)])
    assert.equal(one.results[0]?.ok, true, `${kind} line must succeed: ${JSON.stringify(one.results[0])}`)
    // Minus the auth baseline and the one receipt-table probe (both counted
    // in the per-request overhead of 13, not per line).
    const perLine = { calls: one.calls - empty.calls - 1, statements: one.statements - empty.statements - 1 }
    assert.ok(perLine.statements <= LINE_BUDGET, `${kind}: ${perLine.statements} statements > ${LINE_BUDGET}`)
    assert.ok(perLine.calls * 1.25 <= LINE_BUDGET, `${kind}: ${perLine.calls} calls leaves under a 25% margin in ${LINE_BUDGET}`)
    console.log(`  measured ${kind}: ${perLine.calls} calls / ${perLine.statements} statements per line (Free, 0192, identified)`)
  }
})

for (const tier of ['free', 'paid']) {
  check(`${tier}: the cap is the budget arithmetic, and a full request of worst lines fits the ceiling`, async () => {
    const limits = PLAN_LIMITS_BY_TIER[tier]
    const cap = limits.stockInLinesPerRequest
    assert.ok(Number.isInteger(cap) && cap >= 1, `stockInLinesPerRequest must be a positive integer on ${tier}, got ${cap}`)
    const overhead = await measureOutsideRoute()
    // Retain the original conservative 13-call allowance and existing caps:
    // outside-route work fell from 9 to 2; auth 3 + receipt-table probe 1
    // now make 6 actual overhead calls. The saved 7 remain safety headroom.
    assert.ok(overhead.calls + 3 + 1 <= 13)
    assert.equal(cap, Math.floor((limits.d1QueriesPerInvocation - 13) / LINE_BUDGET))
    const fx = await fixture(tier, cap + 3)
    const lines = Array.from({ length: cap + 3 }, (_, i) => worstLine(i + 1, fx.branchId))
    const res = await commit(fx, lines)
    assert.equal(res.status, 200)
    assert.equal(res.results.length, lines.length, 'one result per line, deferred ones included')
    res.results.slice(0, cap).forEach((r, i) => assert.equal(r.ok, true, `line ${i + 1} is attempted and succeeds: ${JSON.stringify(r)}`))
    res.results.slice(cap).forEach((r, i) => {
      assert.equal(r.ok, false)
      assert.equal(r.code, 'deferred', `line ${cap + i + 1} is deferred`)
      assert.equal(r.key, lines[cap + i].key, 'a deferred answer keeps its line key')
      assert.match(String(r.error), /Complete again/, 'a client that predates the code still shows an actionable sentence')
    })
    const total = { calls: res.calls + overhead.calls, statements: res.statements + overhead.statements }
    assert.ok(total.calls <= limits.d1QueriesPerInvocation, `${tier}: ${total.calls} D1 calls > ${limits.d1QueriesPerInvocation}`)
    assert.ok(total.statements <= limits.d1QueriesPerInvocation, `${tier}: ${total.statements} D1 statements > ${limits.d1QueriesPerInvocation}`)
    console.log(`  ${tier}: cap ${cap}, invocation total ${total.calls} calls / ${total.statements} statements of ${limits.d1QueriesPerInvocation}`)
  })

  check(`${tier}: deferred lines cost zero D1 queries and move no stock`, async () => {
    const cap = PLAN_LIMITS_BY_TIER[tier].stockInLinesPerRequest
    assert.ok(Number.isInteger(cap) && cap >= 1)
    const exact = await fixture(tier, cap)
    const atCap = await commit(exact, Array.from({ length: cap }, (_, i) => worstLine(i + 1, exact.branchId)))
    const over = await fixture(tier, cap + 5)
    const overCap = await commit(over, Array.from({ length: cap + 5 }, (_, i) => worstLine(i + 1, over.branchId)))
    assert.deepEqual({ calls: overCap.calls, statements: overCap.statements }, { calls: atCap.calls, statements: atCap.statements },
      'five extra lines past the cap must add nothing to the invocation')
    for (let n = cap + 1; n <= cap + 5; n += 1) {
      const moved = over.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = ?').get(1000 + n).n
      const stock = over.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(1000 + n, over.branchId).quantity
      assert.equal(moved, 0, `deferred product ${1000 + n} has no movement`)
      assert.equal(stock, 0, `deferred product ${1000 + n} kept its stock`)
    }
  })
}

check('an old client that simply re-sends its failed lines applies every line exactly once', async () => {
  const tier = 'free'
  const cap = PLAN_LIMITS_BY_TIER[tier].stockInLinesPerRequest
  assert.ok(Number.isInteger(cap) && cap >= 1)
  const total = cap * 2 + 1
  const fx = await fixture(tier, total)
  let pending = Array.from({ length: total }, (_, i) => LINE_KINDS.receive(i + 1, fx.branchId))
  const sentKeys = []
  let rounds = 0
  // The pre-deferral modal: one request with every non-saved line, then the
  // operator presses Complete again for whatever came back not ok.
  while (pending.length && rounds < total + 1) {
    rounds += 1
    sentKeys.push(...pending.map((line) => line.key))
    const res = await commit(fx, pending)
    pending = pending.filter((_, i) => !res.results[i]?.ok)
  }
  assert.equal(pending.length, 0, 'every line eventually saved')
  assert.equal(rounds, Math.ceil(total / cap))
  for (let n = 1; n <= total; n += 1) {
    const stock = fx.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?').get(1000 + n, fx.branchId).quantity
    assert.equal(stock, 2, `product ${1000 + n} received once, not ${stock / 2} times`)
  }
  // Each line is sent until the round that saves it and never after: with the
  // prefix rule, line n is saved in round ceil(n / cap), so it is sent
  // exactly that many times.
  for (let n = 1; n <= total; n += 1) {
    assert.equal(sentKeys.filter((key) => key === `r${n}`).length, Math.ceil(n / cap), `line r${n} send count`)
  }
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (error) {
      console.log('FAIL', name, '-', error && error.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed}/${tests.length} check(s) passed.`)
}

void main()
