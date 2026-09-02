// D5a: supplier-on-batch through the MANUAL add/receive surfaces. Both
// receive wires (POST /inventory/adjust camelCase supplierId/supplierName,
// POST /api/batches snake_case supplier_id/supplier_name) must flow into
// lib/productBatches.ts's receiveBatchStock, whose first-attribution-sticks
// rule is the contract: a NEW lot records the choice, a top-up only FILLS
// a still-NULL supplier (COALESCE) and never rewrites one. Free text is a
// deliberate name-only attribution (supplier_id NULL) -- the same
// first-class state the import engine writes -- and nothing here may
// auto-create a suppliers row (the import engine's match-only rule).
//
// Same harness as test-adjust-received-date-pure.cjs: transpile the REAL
// route files + kernel, run against real migrations in in-memory SQLite,
// call the actual Hono app.request(). Auth/audit/broadcast/cache/search
// are stubbed inert; the attribution writes under test are real.
//
// Run (from cloudflare/): node scripts/test-supplier-attribution-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const results = []
    for (const item of items) {
      const stmt = rawDb.prepare(item.sql)
      const r = stmt.run(item.params || {})
      results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
    }
    return results
  },
  async transaction(fn) { return fn(this) },
}
const fakeEnv = { DB: db }

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  Module._load = originalLoad
  return moduleObj.exports
}

const batchCode = loadReal('lib/batchCode.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': sqlBinding })
const permissions = loadReal('lib/permissions.ts')
// routes/batches.ts imports the shared optimistic-locking helpers; without
// this override the transpiled module's './conflictControl' require resolves
// against scripts/ and the whole test file dies at load time.
const conflictControl = loadReal('lib/conflictControl.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true }) }

const inventoryRoute = loadReal('routes/inventory.ts', {
  '../lib/db': { getDb: () => db },
  // routes/inventory.ts buckets movement dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/sqlBinding': sqlBinding,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': { sendTelegramEvent: async () => false },
  '../lib/permissions': permissions,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productIdentity': { findIdentityMatch: async () => null },
  '../lib/barcodeAliases': { buildAliasExactClause: () => '' }, // route ORs alias barcodes into its search plan; not exercised here
  '../lib/searchMatch': {
    buildFtsMatchExpression: () => "''",
    buildHybridMatchClause: () => '1=1',
    buildIssueStateClauses: () => [],
    buildPartialWordMatchClause: () => '1=1',
    buildShortWordFallbackClause: () => '1=1',
    buildTrigramMatchExpression: () => "''",
    expandAliasCandidates: (value) => [value],
    normalizedHaystackSql: () => "''",
    PRODUCT_SEARCH_COLUMNS: 'id, name',
    PRODUCTS_FTS_BM25_SQL: '0',
    runFuzzyFallbackMatch: async () => [],
    tokenizeSearchTermGroups: () => [],
    tokenizeSearchWords: () => [],
  },
  '../lib/datedStockCountRoute': { parseDatedStockCountEntries: () => ({ error: 'stubbed' }), buildDatedStockCountPlan: () => ({}) },
  '../lib/datedStockCountApply': { applyDatedStockCountPlan: async () => ({}) },
  '../lib/datedStockCountResolve': { parseRawDatedCountRows: () => [], resolveDatedStockCountRows: async () => [] },
  '../lib/datedStockCountDecisions': { applyDatedStockCountDecisions: async () => ({}) },
  // Part 553 added the movement-revert path to inventory.ts; these tests do not
  // exercise revert, so an empty stub is honest (type import is compile-erased).
  '../lib/stockRevert': { applyMovementRevert: async () => ({}) },
})
const app = inventoryRoute.default

const batchesRoute = loadReal('routes/batches.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  // K2 Part 416: routes/batches.ts gained the damaged-lots POS lookup;
  // these tests exercise receive/adjust, so an empty stub is honest.
  '../lib/returnsStock': { listOpenDamagedLots: async () => [] },
  '../lib/conflictControl': conflictControl,
})
const batchesApp = batchesRoute.default

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function seed() {
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements; DELETE FROM suppliers;')
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDb.prepare("INSERT INTO products (id, name, barcode, is_active, stock_quantity) VALUES (1, 'Widget', 'B123', 1, 0)").run()
  rawDb.prepare("INSERT INTO suppliers (id, name) VALUES (7, 'Acme Beauty Co')").run()
}

const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body, targetApp = app) {
  const res = await targetApp.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function batchRows() {
  return rawDb.prepare('SELECT id, supplier_id, supplier_name, received_quantity FROM product_batches ORDER BY id').all() ?? []
}

function supplierCount() {
  return rawDb.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n
}

async function main() {
  await check('adjust add (picked contact): the new lot records supplier_id AND supplier_name', async () => {
    seed()
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 5, reason: 'Receive', branchId: 1,
      batchId: 'new', supplierId: 7, supplierName: 'Acme Beauty Co',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].supplier_id, 7, 'contact link stored')
    assert.strictEqual(rows[0].supplier_name, 'Acme Beauty Co', 'display name stored beside the id')
  })

  await check('adjust add (free text): name-only attribution -- supplier_id stays NULL, NO suppliers row auto-created', async () => {
    seed()
    const before = supplierCount()
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 3, reason: 'Receive', branchId: 1,
      batchId: 'new', supplierName: 'Handwritten Vendor',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows[0].supplier_id, null, 'free text never invents a contact link')
    assert.strictEqual(rows[0].supplier_name, 'Handwritten Vendor')
    assert.strictEqual(supplierCount(), before, 'match-only rule: manual receive never auto-creates a supplier')
  })

  await check("top-up of an ATTRIBUTED lot with a different supplier changes NOTHING but quantity (first attribution sticks)", async () => {
    seed()
    await req('POST', '/adjust', { productId: 1, type: 'add', quantity: 5, reason: 'r', branchId: 1, batchId: 'new', supplierId: 7, supplierName: 'Acme Beauty Co' })
    const lotId = batchRows()[0].id
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 2, reason: 'top-up', branchId: 1,
      batchId: lotId, supplierName: 'Somebody Else',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'no twin lot')
    assert.strictEqual(rows[0].supplier_id, 7, 'original contact link intact')
    assert.strictEqual(rows[0].supplier_name, 'Acme Beauty Co', 'original name intact -- never rewritten')
    assert.strictEqual(rows[0].received_quantity, 7, 'quantity still accumulated')
  })

  await check('top-up of an UNATTRIBUTED lot FILLS the blank (COALESCE honors the choice the picker offered)', async () => {
    seed()
    await req('POST', '/adjust', { productId: 1, type: 'add', quantity: 4, reason: 'r', branchId: 1, batchId: 'new' })
    const lotId = batchRows()[0].id
    assert.strictEqual(batchRows()[0].supplier_name, null, 'precondition: lot starts unattributed')
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 2, reason: 'top-up', branchId: 1,
      batchId: lotId, supplierId: 7, supplierName: 'Acme Beauty Co',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows[0].supplier_id, 7, 'id filled where still NULL')
    assert.strictEqual(rows[0].supplier_name, 'Acme Beauty Co', 'name filled where still NULL')
  })

  await check('auto-routed add (no batchId -- the BulkAddStockModal wire) attributes the lot it creates', async () => {
    seed()
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 6, reason: 'bulk', branchId: 1,
      receivedDate: '2025-04-01', supplierId: 7, supplierName: 'Acme Beauty Co',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'auto-routing created the lot')
    assert.strictEqual(rows[0].supplier_id, 7)
    assert.strictEqual(rows[0].supplier_name, 'Acme Beauty Co')
  })

  await check("remove ignores supplier fields entirely -- a removal has no supplier semantics", async () => {
    seed()
    await req('POST', '/adjust', { productId: 1, type: 'add', quantity: 5, reason: 'r', branchId: 1, batchId: 'new' })
    const lotId = batchRows()[0].id
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'remove', quantity: 2, reason: 'damage', branchId: 1,
      batchId: lotId, supplierId: 7, supplierName: 'Acme Beauty Co',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.strictEqual(batchRows()[0].supplier_name, null, 'the removal did not attribute the lot')
  })

  await check('POST /api/batches (snake_case wire) still records supplier_id + supplier_name on create -- two wires, one rule', async () => {
    seed()
    const { status, json } = await req('POST', '/', {
      product_id: 1, branch_id: 1, quantity: 6, received_date: '2025-02-10',
      supplier_id: 7, supplier_name: 'Acme Beauty Co',
    }, batchesApp)
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows[0].supplier_id, 7)
    assert.strictEqual(rows[0].supplier_name, 'Acme Beauty Co')
  })

  await check('GET /api/batches now carries each lot\'s supplier attribution (the pickers\' locked/fill rule reads it)', async () => {
    const { status, json } = await req('GET', '/?productId=1&branchId=1', null, batchesApp)
    assert.strictEqual(status, 200, JSON.stringify(json))
    const lots = json?.batches || []
    assert.strictEqual(lots.length, 1)
    assert.strictEqual(lots[0].supplier_id, 7, 'supplier_id in the list payload')
    assert.strictEqual(lots[0].supplier_name, 'Acme Beauty Co', 'supplier_name in the list payload (name-only rule: visible to lot viewers)')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
