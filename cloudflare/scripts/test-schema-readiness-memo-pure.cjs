// Schema-readiness probes run before hot writes and before the POS checkout
// capability check. Each one read sqlite_master on every request (PLAN-BACKEND
// W1 step 1). Releases only ever add the probed tables and triggers, so a
// present answer is cached for the isolate; an absent answer and a failed
// lookup are never cached, so a database migrated under a warm isolate is
// seen on the next request and a lookup failure still fails closed.
//
// Real: the four route modules and lib/importMaintenanceFence.ts, lib/db.ts
// (D1Compat) and node:sqlite answering every probe. Only authentication is
// replaced. Every statement other than a probe or a PRAGMA throws, so a route
// that got past its probe answers 500 without touching anything else.
//
// Red on the base (read-only `git show`, nothing checked out):
//   READINESS_BASELINE=bf2d8e001 node test-schema-readiness-memo-pure.cjs
// SOURCE_ROOT=<a copy of cloudflare/src> runs the same checks against a copy.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const cloudflare = path.join(__dirname, '..')
const SOURCE_ROOT = process.env.SOURCE_ROOT || path.join(cloudflare, 'src')
const BASELINE = process.env.READINESS_BASELINE || ''
assert.ok(!BASELINE || /^[0-9a-f]{7,40}$/i.test(BASELINE), 'READINESS_BASELINE must be a commit sha')

const USER = {
  id: 7,
  username: 'probe-cashier',
  name: 'Probe Cashier',
  permissions: JSON.stringify({ pos: true, sales: true, branches: true, inventory: true, fees: true }),
}

function source(rel) {
  if (BASELINE) {
    return execFileSync('git', ['show', `${BASELINE}:cloudflare/src/${rel}`], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  }
  return fs.readFileSync(path.join(SOURCE_ROOT, rel), 'utf8')
}

const moduleCache = new Map()
const overrides = {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
}
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const output = ts.transpileModule(source(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path.join(SOURCE_ROOT, rel),
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const PROBED_OBJECTS = [
  'CREATE TABLE sales(id INTEGER PRIMARY KEY, money_precision_version INTEGER, calculated_total_usd REAL, rounding_adjustment_usd REAL)',
  'CREATE TABLE returns(id INTEGER PRIMARY KEY, money_precision_version INTEGER, calculated_refund_usd REAL, rounding_adjustment_usd REAL)',
  'CREATE TABLE sale_items(id INTEGER PRIMARY KEY, pricing_snapshot_json TEXT)',
]
const RELEASE_OBJECTS = [
  'CREATE TABLE fee_operation_receipts(id TEXT PRIMARY KEY)',
  'CREATE TRIGGER transfer_receipts_require_provenance_insert BEFORE INSERT ON fee_operation_receipts BEGIN SELECT 1; END',
  'CREATE TRIGGER sales_money_precision_update_0161 BEFORE UPDATE ON sales BEGIN SELECT 1; END',
  'CREATE TABLE system_flags(key TEXT PRIMARY KEY, value TEXT)',
]

// A D1 binding over node:sqlite that counts sqlite_master reads.
function database({ released = true } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of PROBED_OBJECTS) sqlite.exec(sql)
  if (released) for (const sql of RELEASE_OBJECTS) sqlite.exec(sql)
  const state = { reads: 0, failing: false }
  const binding = {
    prepare(sql) {
      let values = []
      const execute = async () => {
        if (/sqlite_master/i.test(sql)) {
          state.reads += 1
          if (state.failing) throw new Error('schema lookup unavailable')
        } else if (!/^\s*PRAGMA\b/i.test(sql)) {
          throw new Error('outside the readiness probe')
        }
        return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }
      }
      const bound = { all: execute, run: execute, first: async () => (await execute()).results[0] ?? null }
      return { ...bound, bind: (...next) => { values = next; return bound } }
    },
    batch: async () => { throw new Error('outside the readiness probe') },
  }
  return { state, binding, release: () => { for (const sql of RELEASE_OBJECTS) sqlite.exec(sql) } }
}

const executionCtx = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}) }, passThroughOnException() {} }
const results = []
async function check(label, run) {
  try {
    await run()
    results.push(true)
    console.log(`PASS ${label}`)
  } catch (error) {
    results.push(false)
    console.log(`FAIL ${label}: ${String(error && error.message).split('\n').slice(0, 12).join('\n')}`)
  }
}

const quiet = new WeakSet()
async function send(app, route, env, body) {
  if (!quiet.has(app)) { app.onError((_error, c) => c.text('stopped after the probe', 500)); quiet.add(app) }
  const init = body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const response = await app.request(route, init, env, executionCtx)
  return { status: response.status, body: await response.text() }
}

const transfer = (key) => ({ transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'Restock', client_request_id: key, productId: 1, quantity: 1 })
const bulkTransfer = (key) => ({ transfer_provenance_version: 1, fromBranchId: 1, toBranchId: 2, reason: 'Restock', client_request_id: key, items: [{ productId: 1, quantity: 1 }] })
const fee = (key) => ({ client_request_id: key, fee_type: 'expense', label: 'Tape', amount_usd: 1, amount_khr: 0, fee_date: '2026-09-30', branch_id: 1 })

;(async () => {
  if (!BASELINE) {
    await check('schemaObjectsPresent: one read until present, absent and failed lookups are re-read', async () => {
      const probe = load('lib/schemaProbe.ts')
      probe.__resetSchemaProbeCacheForTests()
      const { D1Compat } = load('lib/db.ts')
      const legacy = database({ released: false })
      const db = new D1Compat(legacy.binding)
      const trigger = [{ type: 'trigger', name: 'sales_money_precision_update_0161' }]
      const pair = [{ type: 'table', name: 'fee_operation_receipts' }, { type: 'trigger', name: 'transfer_receipts_require_provenance_insert' }]
      assert.equal(await probe.schemaObjectsPresent(db, trigger), false)
      assert.equal(await probe.schemaObjectsPresent(db, trigger), false)
      assert.equal(legacy.state.reads, 2, 'an absent object is looked up again')
      legacy.release()
      legacy.state.failing = true
      await assert.rejects(probe.schemaObjectsPresent(db, trigger), /schema lookup unavailable/)
      legacy.state.failing = false
      assert.equal(await probe.schemaObjectsPresent(db, trigger), true)
      assert.equal(await probe.schemaObjectsPresent(db, trigger), true)
      assert.equal(legacy.state.reads, 4, 'a failed lookup is not cached; a present answer is')
      assert.equal(await probe.schemaObjectsPresent(db, pair), true)
      assert.equal(await probe.schemaObjectsPresent(db, pair), true)
      assert.equal(legacy.state.reads, 5, 'each object set is cached under its own key')
      probe.__resetSchemaProbeCacheForTests()
      const halfReleased = new DatabaseSync(':memory:')
      halfReleased.exec(RELEASE_OBJECTS[0])
      const halfDb = new D1Compat({ prepare: (sql) => ({ bind: (...values) => ({ all: async () => ({ results: halfReleased.prepare(sql).all(...values), meta: {} }) }) }) })
      assert.equal(await probe.schemaObjectsPresent(halfDb, pair), false, 'every object of the set must be present')
    })
  }

  const sales = load('routes/sales.ts').default
  await check('GET /api/sales/money-precision-capability reads sqlite_master once, then serves the cached readiness', async () => {
    load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
    const legacy = database({ released: false })
    for (let call = 0; call < 2; call += 1) {
      const answer = await send(sales, '/money-precision-capability', { DB: legacy.binding })
      assert.equal(answer.status, 200, answer.body)
      assert.equal(JSON.parse(answer.body).historical_edit_ready, false)
    }
    assert.equal(legacy.state.reads, 2, 'a database without the 0161 trigger is asked again on every call')
    legacy.release()
    for (let call = 0; call < 3; call += 1) {
      const answer = await send(sales, '/money-precision-capability', { DB: legacy.binding })
      assert.equal(answer.status, 200, answer.body)
      assert.equal(JSON.parse(answer.body).historical_edit_ready, true)
    }
    assert.equal(legacy.state.reads, 3, `after the first ready answer no call reads sqlite_master (${legacy.state.reads - 2} reads for 3 ready calls)`)
  })

  const releaseProbeRoutes = [
    ['routes/branches.ts', [['/transfer', transfer], ['/transfer-bulk', bulkTransfer]]],
    ['routes/inventory.ts', [['/transfer', transfer]]],
    ['routes/fees.ts', [['/', fee]]],
  ]
  for (const [rel, endpoints] of releaseProbeRoutes) {
    await check(`${rel}: the release-schema probe fails closed until ready, then is read once`, async () => {
      const app = load(rel).default
      const legacy = database({ released: false })
      const env = { DB: legacy.binding }
      for (const [route, body] of endpoints) {
        const answer = await send(app, route, env, body(`probe-legacy-${route.length}`))
        assert.equal(answer.status, 503, `${route}: ${answer.body}`)
        assert.match(answer.body, /release_upgrade_in_progress/)
      }
      assert.equal(legacy.state.reads, endpoints.length, 'a database without the release objects is asked again')
      legacy.release()
      legacy.state.failing = true
      const [firstRoute, firstBody] = endpoints[0]
      const failed = await send(app, firstRoute, env, firstBody('probe-failure-0001'))
      assert.equal(failed.status, 503, `a failed lookup fails closed: ${failed.body}`)
      legacy.state.failing = false
      const readsBeforeReady = legacy.state.reads
      for (let round = 0; round < 2; round += 1) {
        for (const [route, body] of endpoints) {
          const answer = await send(app, route, env, body(`probe-ready-${round}-${route.length}`))
          assert.notEqual(answer.status, 503, `${route}: a released schema passes the probe: ${answer.body}`)
        }
      }
      assert.equal(legacy.state.reads - readsBeforeReady, 1,
        `${endpoints.length * 2} ready requests read sqlite_master ${legacy.state.reads - readsBeforeReady} time(s)`)
    })
  }

  await check('getImportFencedDb reads sqlite_master until system_flags is seen, then never again', async () => {
    const fence = load('lib/importMaintenanceFence.ts')
    const legacy = database({ released: false })
    const env = { DB: legacy.binding }
    const unfenced = await fence.getImportFencedDb(env)
    await fence.getImportFencedDb(env)
    assert.equal(legacy.state.reads, 2, 'a legacy database without system_flags is asked again')
    assert.equal(Object.getPrototypeOf(unfenced).constructor.name, 'D1Compat', 'no flag table: the plain adapter')
    legacy.release()
    legacy.state.failing = true
    await assert.rejects(fence.getImportFencedDb(env), /schema lookup unavailable/, 'a failed lookup fails closed')
    legacy.state.failing = false
    const fenced = await fence.getImportFencedDb(env)
    assert.ok(Object.getPrototypeOf(fenced) instanceof load('lib/db.ts').D1Compat, 'the fence wraps the adapter')
    await fence.getImportFencedDb(env)
    await fence.getImportFencedDb(env)
    assert.equal(legacy.state.reads, 4, `once present, later fences read nothing (${legacy.state.reads} reads)`)
  })

  const passed = results.filter(Boolean).length
  console.log(`${passed}/${results.length} schema-readiness memo checks passed${BASELINE ? ` (sources from ${BASELINE})` : ''}`)
  if (passed !== results.length || !results.length) process.exitCode = 1
})()
