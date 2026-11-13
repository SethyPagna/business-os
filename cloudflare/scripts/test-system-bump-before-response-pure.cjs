'use strict'
// W3 Slice A round 2, routes/system.ts (review F2 and F5). The real router runs with stubbed collaborators, a SLOW fake cache and a broadcast recorder.
//   F2  POST /api/system/sale-not-paid-stock-recovery-20260909/apply: the bump (stock included, the correction moves stock) finishes BEFORE the
//       response and before any broadcast; cache_invalidated is read from the version tokens, so a bump that did nothing is reported as such.
//   F5  POST /api/system/repair-integrity: the stock repair commits in its own step. When a later step throws, the route still advances
//       products, stock and sales before it answers 500 -- and a clean check (nothing repaired) bumps nothing.
// Run (from cloudflare/): node scripts/test-system-bump-before-response-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const SRC = path.join(__dirname, '../src')
const BUMP_MS = 80
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function inert() { return new Proxy(function () {}, { get: () => inert(), apply: () => undefined }) }
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (request) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : require(request)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(req, mod, mod.exports, full, path.dirname(full))
  return mod.exports
}
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

const events = []
const bumps = []
const versions = {}
let bumpDoesNothing = false
let integrity = async () => ({ errors: [], repairs: 0, summary: '' })
const cache = {
  bumpVersion: async (_env, namespace) => cache.bumpVersions(_env, [namespace]),
  bumpVersions: async (_env, list) => {
    events.push(`bump-start:${list.join('+')}`); bumps.push([...list])
    await sleep(BUMP_MS)
    if (!bumpDoesNothing) for (const namespace of list) versions[namespace] = (versions[namespace] || 0) + 1
    events.push(`bump-done:${list.join('+')}`)
  },
  getVersionsWithFallback: async (_env, list) => list.map((namespace) => String(versions[namespace] || 0)),
  getVersionWithFallback: async (_env, namespace) => String(versions[namespace] || 0),
}
const hub = { broadcast: async (_env, channel) => { events.push(`broadcast:${channel}`) } }
const recovery = {
  SALE_NOT_PAID_STOCK_RECOVERY_TARGET: 'sale-not-paid-stock-recovery-test',
  SALE_NOT_PAID_STOCK_RECOVERY_BACKUP_TABLES: ['sales'],
  SaleNotPaidStockRecoveryValidationError: class extends Error {}, SaleNotPaidStockRecoveryConflictError: class extends Error {}, SaleNotPaidStockRecoveryUncertainError: class extends Error {},
  prepareSaleNotPaidStockRecovery: async () => ({ outcome: 'apply' }),
  applySaleNotPaidStockRecovery: async () => ({ success: true, outcome: 'applied', verification_pending: false }),
}
const kv = new Map()
const env = { CACHE: { get: async (key) => kv.get(key) ?? null, put: async (key, value) => { kv.set(key, String(value)) } } }
const systemRoute = load('routes/system.ts', {
  hono: require('hono'),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', ADMIN); return next() } },
  '../lib/permissions': load('lib/permissions.ts'),
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
  '../lib/db': { getDb: () => ({}) },
  '../lib/cache': cache,
  '../durable-objects/broadcastHub': hub,
  '../lib/backup': { createSectionBackup: async () => ({ name: 'backup' }) },
  '../lib/dataIntegrity': { runDataIntegrityCheck: (...args) => integrity(...args) },
  '../lib/destructiveStepUp': { denyUnlessCurrentPassword: async () => null, denyUnlessRepairPermission: async () => null, denyUnlessDefaultAdmin: async () => null },
  '../lib/audit': { audit: async () => {} },
  '../lib/saleNotPaidStockRecovery': recovery,
  '../lib/productStockGuard': load('lib/productStockGuard.ts'),
  '../lib/stockTransaction': {},
}).default
const app = new Hono()
app.route('/api/system', systemRoute)
const pending = []
const executionCtx = { waitUntil: (p) => { pending.push(p); p?.catch?.(() => {}) }, passThroughOnException() {} }
const post = async (url, body) => {
  events.length = 0; bumps.length = 0; kv.clear()
  const res = await app.request(`https://admin.test${url}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://admin.test', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body) }, env, executionCtx)
  events.push('response')
  const json = await res.json().catch(() => null)
  const trace = events.join(' > ')
  await Promise.allSettled(pending.splice(0))
  return { status: res.status, json, trace, all: events.join(' > ') }
}

;(async () => {
  let failed = 0
  const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.stack || error.message) } }
  const recoveryUrl = '/api/system/sale-not-paid-stock-recovery-20260909/apply'

  await check('F2: the recovery bump (with stock) finishes before the response and before every broadcast', async () => {
    const got = await post(recoveryUrl, { step: 'apply' })
    assert.equal(got.status, 200, JSON.stringify(got.json))
    const order = got.all.split(' > ')
    const done = order.findIndex((event) => event.startsWith('bump-done:'))
    const response = order.indexOf('response')
    const firstBroadcast = order.findIndex((event) => event.startsWith('broadcast:'))
    assert.ok(done >= 0 && done < response, `bump finished before the response (${got.all})`)
    assert.ok(firstBroadcast > done, `no broadcast before the bump finished (${got.all})`)
    assert.equal(bumps.length, 1, 'one bump call')
    assert.ok(bumps[0].includes('stock') && bumps[0].includes('sales') && bumps[0].includes('products'), `sales, products and stock move together (${bumps[0]})`)
    assert.equal(got.json.cache_invalidated, true)
    assert.equal(got.json.refresh_pending, false)
  })

  await check('F2: a bump that moved nothing is reported as not invalidated, not as success', async () => {
    bumpDoesNothing = true
    try {
      const got = await post(recoveryUrl, { step: 'apply' })
      assert.equal(got.status, 200, JSON.stringify(got.json))
      assert.equal(got.json.cache_invalidated, false)
      assert.equal(got.json.refresh_pending, true)
    } finally { bumpDoesNothing = false }
  })

  await check('F5: a repair whose later step throws still bumps products, stock and sales before the 500', async () => {
    integrity = async () => { throw new Error('status check failed after the stock repair committed') }
    const got = await post('/api/system/repair-integrity', {})
    assert.equal(got.status, 500, JSON.stringify(got.json))
    const order = got.all.split(' > ')
    const done = order.findIndex((event) => event.startsWith('bump-done:'))
    assert.ok(done >= 0 && done < order.indexOf('response'), `bumped before the answer (${got.all})`)
    assert.deepEqual([...bumps[0]].sort(), ['products', 'sales', 'stock'])
    assert.equal(bumps.length, 1)
  })

  await check('F5: a repair that repaired something bumps once; a clean check bumps nothing', async () => {
    integrity = async () => ({ errors: [], repairs: 2, summary: 'fixed' })
    const repaired = await post('/api/system/repair-integrity', {})
    assert.equal(repaired.status, 200, JSON.stringify(repaired.json))
    assert.equal(bumps.length, 1, `one bump (${repaired.all})`)
    integrity = async () => ({ errors: [], repairs: 0, summary: 'clean' })
    const clean = await post('/api/system/repair-integrity', {})
    assert.equal(clean.status, 200)
    assert.equal(bumps.length, 0, 'a clean check changed nothing')
  })

  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
  console.log('PASS test-system-bump-before-response-pure')
})().catch((error) => { console.error(error); process.exit(1) })
