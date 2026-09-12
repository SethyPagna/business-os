// Native route regression for the bounded leading-zero duplicate manifest.
// It mounts the real products route and duplicate detector over the full D1
// migration chain. No production database or network is used.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

function permissive() {
  return new Proxy(function () {}, {
    get: (_target, prop) => prop === 'default' ? permissive() : permissive(),
    apply: () => undefined,
    construct: () => ({}),
  })
}

function loadTs(relPath, stubs = {}) {
  const abs = path.join(SRC, relPath)
  const output = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
  } finally { Module._load = original }
  return mod.exports
}

class CapturingHono {
  constructor() { this.routes = [] }
  add(method, routePath, handler) { this.routes.push({ method, path: routePath, handler }); return this }
  get(routePath, handler) { return this.add('GET', routePath, handler) }
  post(routePath, handler) { return this.add('POST', routePath, handler) }
  put(routePath, handler) { return this.add('PUT', routePath, handler) }
  patch(routePath, handler) { return this.add('PATCH', routePath, handler) }
  delete(routePath, handler) { return this.add('DELETE', routePath, handler) }
  use() { return this }
  on() { return this }
  all() { return this }
  route() { return this }
  onError() { return this }
  notFound() { return this }
}

function adapter(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: (params = {}) => statement.get(params),
        all: (params = {}) => statement.all(params),
        run: (params = {}) => {
          const result = statement.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
    async batch(statements) {
      return statements.map(({ sql, params }) => ({ success: true, results: d1.prepare(sql).all(params || {}) }))
    },
  }
}

function loadRoute(db) {
  const sqlBinding = loadTs(path.join('lib', 'sqlBinding.ts'))
  const detailRule = loadTs(path.join('lib', 'productDetailRule.ts'))
  const productMerge = loadTs(path.join('lib', 'productMerge.ts'))
  const productIdentity = loadTs(path.join('lib', 'productIdentity.ts'), {
    './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule,
  })
  const conflictBatch = loadTs(path.join('lib', 'productConflictMergeBatch.ts'))
  return loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: CapturingHono },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': { getActionTier: () => 'full', hasPermission: () => true, getPermissionTier: () => 'full' },
    '../lib/productIdentity': productIdentity,
    '../lib/productDetailRule': detailRule,
    '../lib/productMerge': productMerge,
    '../lib/productConflictMergeBatch': conflictBatch,
    '../lib/sqlBinding': sqlBinding,
    '../lib/undoAppliers': {
      registerMergeFold: () => {}, registerProductMergeGroupRedo: () => {}, MERGE_REPARENT_TABLES: [],
    },
  }).default
}

function seed() {
  const d1 = openDb(loadAll())
  const raw = d1.db
  raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
  const insert = raw.prepare(`INSERT INTO products(
    id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,
    wholesale_price_usd,wholesale_price_khr,stock_quantity,is_active,is_group
  ) VALUES(?,?,?,?,?,?,?,?,?,?,1,0)`)
  const add = (id, name, barcode, stock = 0, cost = 4) => insert.run(
    id, name, barcode, cost, cost * 4000, 10, 40000, 8, 32000, stock,
  )
  add(1, 'Clean Pair', '01234', 3, 4)
  add(2, 'Clean Pair', '1234', 2, 6)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(1, 1, 3)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(2, 1, 2)
  add(3, 'Exact Raw', '7777')
  add(4, 'Exact Raw', '7777')
  add(5, 'Mismatch Pair', '08888', 9)
  add(6, 'Mismatch Pair', '8888', 1)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(5, 1, 7)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(6, 1, 1)
  add(7, 'Collision Pair', '00999')
  add(8, 'Collision Pair', '0999')
  add(9, 'Other Name', '999')
  add(11, 'Aardvark Pair', '05555')
  add(12, 'Aardvark Pair', '5555')
  return { d1, raw }
}

function context({ scope, body } = {}) {
  return {
    get: (key) => key === 'user' ? { id: 1, username: 'admin' } : undefined,
    env: {},
    req: {
      query: (key) => key === 'scope' ? scope : undefined,
      json: async () => body || {},
    },
    executionCtx: { waitUntil: () => {} },
    json: (responseBody, status = 200) => ({ status, body: responseBody }),
  }
}

async function main() {
  const { d1, raw } = seed()
  const app = loadRoute(adapter(d1))
  const preview = app.routes.find((route) => route.method === 'GET' && route.path === '/merge-duplicates/preview').handler
  const apply = app.routes.find((route) => route.method === 'POST' && route.path === '/merge-duplicates').handler

  const unknownGet = await preview(context({ scope: 'anything_else' }))
  assert.equal(unknownGet.status, 400)
  const unknownPost = await apply(context({ body: { scope: 'anything_else' } }))
  assert.equal(unknownPost.status, 400)

  const defaultPreview = await preview(context())
  assert.equal(Object.prototype.hasOwnProperty.call(defaultPreview.body, 'scope'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(defaultPreview.body, 'applyManifest'), false)

  const result = await preview(context({ scope: 'leading_zero' }))
  assert.equal(result.status, 200)
  assert.equal(result.body.scope, 'leading_zero')
  assert.deepEqual(result.body.applyManifest.groups, [
    { keeper_id: 2, member_ids: [1, 2] },
    { keeper_id: 12, member_ids: [11, 12] },
  ], 'manifest order is canonical even when detector name order differs')
  assert.equal(result.body.applyManifest.scope, 'leading_zero')
  assert.equal(result.body.applyManifest.manifest_version, 1)
  assert.match(result.body.applyManifest.manifest_digest, /^sha256-[a-f0-9]{64}$/)
  assert.equal(result.body.groups.some((group) => group.canonicalName === 'Exact Raw'), false, 'same raw barcode is outside scope')
  assert.equal(result.body.groups.find((group) => group.canonicalName === 'Mismatch Pair').mergeBlockers[0].code, 'cached_stock_mismatch')
  assert.equal(result.body.groups.find((group) => group.canonicalName === 'Collision Pair').mergeBlockers[0].code, 'canonical_barcode_cross_name_collision')

  const malformed = await apply(context({ body: {
    scope: 'leading_zero', manifest_version: 1, manifest_digest: result.body.applyManifest.manifest_digest,
    groups: [{ keeper_id: 2, member_ids: [1, 2], outsider: 9 }],
  } }))
  assert.equal(malformed.status, 400)

  raw.prepare('UPDATE products SET stock_quantity=4 WHERE id=1').run()
  const stockChanged = await apply(context({ body: {
    scope: 'leading_zero', manifest_version: 1, manifest_digest: result.body.applyManifest.manifest_digest,
    groups: result.body.applyManifest.groups,
  } }))
  assert.equal(stockChanged.status, 409)
  assert.match(stockChanged.body.error, /stock/i)
  raw.prepare('UPDATE products SET stock_quantity=3 WHERE id=1').run()

  const collisionPreview = await preview(context({ scope: 'leading_zero' }))
  addOutsider(raw, 'Other Fresh Name', '00001234')
  const newCollision = await apply(context({ body: {
    ...collisionPreview.body.applyManifest,
  } }))
  assert.equal(newCollision.status, 409)
  assert.match(newCollision.body.error, /more than one exact product name/i)
  raw.prepare('DELETE FROM products WHERE id=10').run()

  const pricePreview = await preview(context({ scope: 'leading_zero' }))
  raw.prepare('UPDATE products SET selling_price_usd=11 WHERE id=1').run()
  const stale = await apply(context({ body: {
    ...pricePreview.body.applyManifest,
  } }))
  assert.equal(stale.status, 409)
  assert.match(stale.body.error, /preview is stale/i)
  assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=1').get().is_active, 1)
  assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 1)

  const refreshed = await preview(context({ scope: 'leading_zero' }))
  addOutsider(raw, 'Clean Pair', '001234')
  const changedGroup = await apply(context({ body: {
    scope: 'leading_zero', manifest_version: 1, manifest_digest: refreshed.body.applyManifest.manifest_digest,
    groups: refreshed.body.applyManifest.groups,
  } }))
  assert.equal(changedGroup.status, 409)
  assert.match(changedGroup.body.error, /group changed/i)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM products WHERE id IN (1,2,10) AND is_active=1').get().n, 3)

  console.log(JSON.stringify({ status: 'PASS', manifestGroups: result.body.applyManifest.groups.length, digest: result.body.applyManifest.manifest_digest }))
}

function addOutsider(raw, name, barcode) {
  raw.prepare(`INSERT INTO products(
    id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,
    wholesale_price_usd,wholesale_price_khr,stock_quantity,is_active,is_group
  ) VALUES(10,?,?,4,16000,10,40000,8,32000,0,1,0)`).run(name, barcode)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
