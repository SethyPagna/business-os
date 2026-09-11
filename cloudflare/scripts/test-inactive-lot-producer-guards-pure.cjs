const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const outputText = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(requireOverrides, request)) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

function setup() {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (params) => stmt.get(params),
        all: async (params) => stmt.all(params) ?? [],
        run: async (params) => {
          const result = stmt.run(params)
          return {
            changes: Number(result.meta?.changes ?? 0),
            lastInsertRowid: Number(result.meta?.last_row_id ?? 0),
          }
        },
      }
    },
    async batch(items) {
      const results = await rawDb.batch(items)
      return results.map((result) => ({
        changes: Number(result.meta?.changes ?? 0),
        lastInsertRowid: Number(result.meta?.last_row_id ?? 0),
      }))
    },
  }

  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1), (2, 'Warehouse', 1, 0)").run()
  rawDb.prepare("INSERT INTO products (id, name, barcode, is_active, stock_quantity) VALUES (1, 'Serum', 'SERUM-1', 1, 0)").run()
  return { rawDb, db }
}

function seedLot(fixture, { active = 1, quantity = 0 } = {}) {
  fixture.rawDb.prepare(`
    INSERT INTO product_batches (
      id, variant_product_id, batch_key, lot_code, received_at, is_active,
      batch_number, supplier_name, unit_cost_usd, received_quantity
    ) VALUES (100, 1, 'lot a', 'LOT A', '2026-09-01', @active, 1, 'Vendor', 2, 0)
  `).run({ active })
  fixture.rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (100, 1, @quantity)').run({ quantity })
  fixture.rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @quantity)').run({ quantity })
  fixture.rawDb.prepare('UPDATE products SET stock_quantity = @quantity WHERE id = 1').run({ quantity })
}

let routeFixture
const batchCode = loadReal('lib/batchCode.ts')
const conflictControl = loadReal('lib/conflictControl.ts')
const batchRoute = loadReal('routes/batches.ts', {
  '../lib/db': { getDb: () => routeFixture.db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 1, name: 'Tester' }); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': { hasPermission: () => true, getActionTier: () => 'full', isActionBlocked: () => false },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productBatches': { getTrackedProductIds: async () => [], listBatchesForProduct: async () => [], receiveBatchStock: async () => { throw new Error('not used') } },
  '../lib/returnsStock': { listOpenDamagedLots: async () => [] },
  '../lib/batchCode': batchCode,
  '../lib/conflictControl': conflictControl,
  '../lib/stockReceiptGate': { appendReceiptNotes: (value) => value, FREE_GOODS_REASON_NOTE: '', stockReceiptGateCode: () => null, stockReceiptGateMessage: () => '' },
  '../lib/actorSnapshot': { actorSnapshot: () => 'Tester' },
}).default

const fakeExecutionCtx = { waitUntil: (promise) => { promise?.catch?.(() => {}) } }
async function request(method, url, body) {
  const response = await batchRoute.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, {}, fakeExecutionCtx)
  return { status: response.status, json: await response.json().catch(() => null) }
}

const searchMatch = loadReal('lib/searchMatch.ts')
const stockReceiptGate = loadReal('lib/stockReceiptGate.ts')
const branchRoles = loadReal('lib/branchRoles.ts')
const branchRoleGuards = loadReal('lib/branchRoleGuards.ts', { './branchRoles': branchRoles })
const actorSnapshot = loadReal('lib/actorSnapshot.ts')
const saleCreationSnapshot = loadReal('lib/saleCreationSnapshot.ts', { './actorSnapshot': actorSnapshot })
const stockActionCommit = loadReal('lib/stockActionCommit.ts', {
  './db': {},
  './batchCode': batchCode,
  './searchMatch': searchMatch,
  './stockReceiptGate': stockReceiptGate,
  './branchRoleGuards': branchRoleGuards,
  './saleCreationSnapshot': saleCreationSnapshot,
})

let passed = 0
async function check(name, run) {
  await run()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('PATCH and DELETE cannot deactivate a lot while any branch holds positive stock', async () => {
    routeFixture = setup()
    seedLot(routeFixture, { active: 1, quantity: 4 })

    const patched = await request('PATCH', '/100', { is_active: false, notes: 'must not land' })
    assert.strictEqual(patched.status, 400, JSON.stringify(patched.json))
    assert.match(patched.json.error, /4 unit\(s\)/)
    assert.deepStrictEqual(
      { ...routeFixture.rawDb.prepare('SELECT is_active, notes FROM product_batches WHERE id = 100').get() },
      { is_active: 1, notes: null },
      'the guarded PATCH applies none of its other edits when deactivation is refused',
    )

    const deleted = await request('DELETE', '/100')
    assert.strictEqual(deleted.status, 400, JSON.stringify(deleted.json))
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT is_active FROM product_batches WHERE id = 100').get().is_active, 1)
  })

  await check('zero-stock deactivation succeeds and a later positive branch correction atomically reactivates the lot', async () => {
    routeFixture = setup()
    seedLot(routeFixture, { active: 1, quantity: 4 })

    const zeroed = await request('PATCH', '/100/branches/1', { quantity: 0 })
    assert.strictEqual(zeroed.status, 200, JSON.stringify(zeroed.json))
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 0)
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity, 0)

    const deactivated = await request('DELETE', '/100')
    assert.strictEqual(deactivated.status, 200, JSON.stringify(deactivated.json))
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT is_active FROM product_batches WHERE id = 100').get().is_active, 0)

    const corrected = await request('PATCH', '/100/branches/1', { quantity: 3 })
    assert.strictEqual(corrected.status, 200, JSON.stringify(corrected.json))
    assert.deepStrictEqual(
      { ...routeFixture.rawDb.prepare('SELECT is_active FROM product_batches WHERE id = 100').get() },
      { is_active: 1 },
      'positive stock is never assigned to a hidden lot',
    )
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 100 AND branch_id = 1').get().quantity, 3)
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 3)
    assert.strictEqual(routeFixture.rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity, 3)
  })

  const importInput = {
    jobId: 'inactive-lot-job', rowNumber: 2, productId: 1, productName: 'Serum',
    branchId: 1, branchName: 'Shop', quantity: 2, date: '2026-09-01',
    batchLabel: 'LOT A', costPriceUsd: 2, supplierName: '',
  }

  await check('stock-action receive into a matching inactive lot reactivates it without creating a duplicate', async () => {
    const fixture = setup()
    seedLot(fixture, { active: 0, quantity: 0 })

    const applied = await stockActionCommit.applyUnifiedStockAdd(fixture.db, importInput)
    const replay = await stockActionCommit.applyUnifiedStockAdd(fixture.db, importInput)
    assert.strictEqual(applied.alreadyApplied, false)
    assert.strictEqual(replay.alreadyApplied, true)
    assert.deepStrictEqual(
      { ...fixture.rawDb.prepare('SELECT is_active, received_quantity FROM product_batches WHERE id = 100').get() },
      { is_active: 1, received_quantity: 2 },
    )
    assert.strictEqual(fixture.rawDb.prepare('SELECT COUNT(*) AS count FROM product_batches').get().count, 1)
    assert.strictEqual(fixture.rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 100 AND branch_id = 1').get().quantity, 2)
    assert.strictEqual(fixture.rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 2)
    assert.strictEqual(fixture.rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity, 2)
    assert.strictEqual(fixture.rawDb.prepare('SELECT batch_id FROM inventory_movements').get().batch_id, 100)
  })

  await check('failed stock-action receipt rolls reactivation back with every stock write', async () => {
    const fixture = setup()
    seedLot(fixture, { active: 0, quantity: 0 })
    fixture.rawDb.exec("CREATE TRIGGER reject_inactive_lot_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'forced movement failure'); END;")

    await assert.rejects(
      () => stockActionCommit.applyUnifiedStockAdd(fixture.db, importInput),
      /forced movement failure/,
    )
    assert.strictEqual(fixture.rawDb.prepare('SELECT is_active FROM product_batches WHERE id = 100').get().is_active, 0)
    assert.strictEqual(fixture.rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 100 AND branch_id = 1').get().quantity, 0)
    assert.strictEqual(fixture.rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 0)
    assert.strictEqual(fixture.rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity, 0)
    assert.strictEqual(fixture.rawDb.prepare('SELECT COUNT(*) AS count FROM import_stock_action_commits').get().count, 0)
  })

  console.log(`\n${passed} inactive-lot producer guard checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
