// Native route regression for Task C part 2: a live merge must keep the
// denormalized product_name snapshot columns (sale_items, inventory_movements,
// return_items, stock_transfers, damaged_stock_lots, return_replacement_items,
// stock_row_moves.source_/destination_product_name) in sync with the keeper's
// CURRENT name, in the SAME atomic batch as the reparent -- the same job
// syncLinkedProductNameSnapshots (routes/products.ts:98-129) already does for
// the rename path. Before this fix, a merged loser's OLD name silently
// survived on every history row forever (this is exactly what migration 0169
// had to backfill for 0165/0168 -- a one-time repair this route fix makes
// unnecessary for every future merge). sale_amendments is deliberately never
// touched (append-only snapshot trigger).
// No production database or network is used.

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
    if (request === './moneyPrecision' || request === '../lib/moneyPrecision') return original.call(Module, path.join(SRC, 'lib/moneyPrecision.ts'), parent, isMain)
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
      return d1.batch(statements)
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
  const productMergeSnapshot = loadTs(path.join('lib', 'productMergeSnapshot.ts'), { './db': {} })
  const conflictBatch = loadTs(path.join('lib', 'productConflictMergeBatch.ts'))
  const undoAppliers = loadTs(path.join('lib', 'undoAppliers.ts'), {
    '../index': {}, './auth': {}, './db': { getDb: () => db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  })
  return loadTs(path.join('routes', 'products.ts'), {
    hono: { Hono: CapturingHono },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': { getActionTier: () => 'full', hasPermission: () => true, getPermissionTier: () => 'full' },
    '../lib/productIdentity': productIdentity,
    '../lib/productDetailRule': detailRule,
    '../lib/productMerge': productMerge,
    '../lib/productMergeSnapshot': productMergeSnapshot,
    '../lib/productConflictMergeBatch': conflictBatch,
    '../lib/sqlBinding': sqlBinding,
    '../lib/audit': { audit: async () => {} },
    '../lib/undoAppliers': undoAppliers,
  }).default
}

function addProduct(raw, id, name, barcode, stock = 0, cost = 4) {
  raw.prepare(`INSERT INTO products(
    id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,
    wholesale_price_usd,wholesale_price_khr,stock_quantity,is_active,is_group
  ) VALUES(?,?,?,?,?,?,?,?,?,?,1,0)`).run(id, name, barcode, cost, cost * 4000, 10, 40000, 8, 32000, stock)
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
  const d1 = openDb(loadAll())
  const raw = d1.db
  raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Second',0,1)")
  // A leading-zero pair -- both rows already share the CURRENT catalogue
  // name (a rename happened on both sides at some point before now, same as
  // production); the merge must be identity-eligible on today's name.
  addProduct(raw, 301, 'Serum Clean Spelling', '00812345', 0, 5)
  addProduct(raw, 302, 'Serum Clean Spelling', '812345', 1, 5)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(301, 1, 0)
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').run(302, 2, 1)

  // Seed history rows carrying the DUP's product_id but a name captured
  // BEFORE the earlier rename to the current spelling was ever synced onto
  // these history rows -- reproducing the exact stale-snapshot scenario 0169
  // had to backfill after 0165/0168.
  raw.prepare("INSERT INTO sales(id, receipt_number) VALUES (900, 'R-sync')").run()
  raw.prepare(`INSERT INTO sale_items(id, sale_id, product_id, product_name, quantity)
    VALUES (1, 900, 301, 'Serum Old Spelling', 1)`).run()
  raw.prepare(`INSERT INTO inventory_movements(id, product_id, product_name, branch_id, branch_name, movement_type, quantity)
    VALUES (1, 301, 'Serum Old Spelling', 1, 'Shop', 'add', 2)`).run()
  // stock_row_moves.source_/destination_product_id are NOT in
  // MERGE_REPARENT_TABLES (the live route never reparents this table's
  // product ids -- only migrations 0165/0168 do); this row is already tied
  // to the KEEPER id directly (destination_product_id=302), the one shape
  // the live route's name sync CAN reach today.
  raw.prepare(`INSERT INTO stock_row_moves(id, source_product_id, source_product_name, destination_product_id, destination_product_name, quantity)
    VALUES (1, 999, 'Some Other Product', 302, 'Serum Old Spelling', 1)`).run()

  const app = loadRoute(adapter(d1))
  const preview = app.routes.find((route) => route.method === 'GET' && route.path === '/merge-duplicates/preview').handler
  const apply = app.routes.find((route) => route.method === 'POST' && route.path === '/merge-duplicates').handler

  const previewed = await preview(context({ scope: 'leading_zero' }))
  assert.equal(previewed.status, 200)
  assert.deepEqual(previewed.body.applyManifest.groups, [{ keeper_id: 302, member_ids: [301, 302] }])

  const result = await apply(context({ body: { ...previewed.body.applyManifest, client_request_id: 'name-sync-test' } }))
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.mergedProducts, 1)

  assert.equal(raw.prepare('SELECT product_name FROM sale_items WHERE id=1').get().product_name, 'Serum Clean Spelling',
    'sale_items.product_name is synced to the keeper current name in the same merge batch')
  assert.equal(raw.prepare('SELECT product_name FROM inventory_movements WHERE id=1').get().product_name, 'Serum Clean Spelling',
    'inventory_movements.product_name is synced')
  const move = raw.prepare('SELECT source_product_name, destination_product_name FROM stock_row_moves WHERE id=1').get()
  assert.equal(move.destination_product_name, 'Serum Clean Spelling', 'stock_row_moves.destination_product_name is synced for a row already tied to the keeper id')
  assert.equal(move.source_product_name, 'Some Other Product', 'an unrelated source_product_id is left untouched')

  raw.close()
  console.log('OK test-merge-name-snapshot-sync-native.cjs')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
