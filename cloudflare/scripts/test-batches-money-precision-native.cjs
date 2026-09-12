// Actual Hono batches route + SQLite PATCH writes. Receipt implementation is a
// tripwire: every refused POST must return before reaching stock mutation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const SQLite = require('better-sqlite3')
const raw = new SQLite(':memory:')
raw.exec('CREATE TABLE product_batches(id INTEGER PRIMARY KEY, updated_at TEXT, unit_cost_usd REAL); INSERT INTO product_batches VALUES(1,NULL,1.2345)')
const db = { prepare(sql) {
  const statement = raw.prepare(sql)
  const args = (p) => Array.isArray(p) ? p : p == null ? [] : [p]
  return { get: async p => statement.get(...args(p)), all: async p => statement.all(...args(p)), run: async p => statement.run(...args(p)) }
} }
let receives = 0, audits = 0
const overrides = {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 1, username: 'test', role: 'admin' }); await next() } },
  '../lib/permissions': { hasPermission: () => true, getActionTier: () => 'full', getPermissionTier: () => 'full', isActionBlocked: () => false },
  '../lib/audit': { audit: async () => { audits++ } },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productBatches': { receiveBatchStock: async () => { receives++; throw new Error('unexpected stock mutation') } },
  '../lib/returnsStock': { listOpenDamagedLots: async () => [] },
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }; cache.set(file, mod.exports)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const resolve = request => Object.hasOwn(overrides, request) ? overrides[request]
    : request.startsWith('.') ? load(path.resolve(path.dirname(file), request + '.ts')) : require(request)
  new Function('require', 'module', 'exports', output)(resolve, mod, mod.exports)
  cache.set(file, mod.exports); return mod.exports
}
const app = load(path.resolve(__dirname, '../src/routes/batches.ts')).default
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
async function request(method, cost, extra = {}) {
  const fields = method === 'POST' ? { product_id: 1, branch_id: 1, quantity: 1, supplier_name: 'Fixture' } : {}
  return app.request(method === 'POST' ? '/' : '/1', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, unit_cost_usd: cost, ...extra }) }, {}, context)
}
;(async () => {
  for (const method of ['POST', 'PATCH']) for (const cost of [-.00004, '-0.00004', -1, '-1']) {
    const before = raw.serialize()
    assert.equal((await request(method, cost, { free_goods: true })).status, 400, `${method} rejects raw negative ${cost} before rounding`)
    assert.deepEqual(raw.serialize(), before)
  }
  for (const cost of [null, .00004, '0.00004', 0]) {
    assert.equal((await request('POST', cost)).status, 400, 'missing or rounded-zero receipt requires appropriate explicit declaration')
  }
  assert.equal(receives, 0)
  assert.equal(audits, 0)
  for (const [cost, expected] of [[null, null], [0, 0], ['1.23455', 1.2346], [1.2345, 1.2345]]) {
    assert.equal((await request('PATCH', cost)).status, 200)
    assert.equal(raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=1').get().unit_cost_usd, expected)
  }
  console.log('PASS actual Hono batch POST/PATCH raw negative numeric/string refusal, prewrite invariance, rounded-zero gate and nullable four-decimal PATCH')
})().catch(error => { console.error(error); process.exitCode = 1 })
