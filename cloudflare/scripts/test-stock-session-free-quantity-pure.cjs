// UI-STOCK 5.3 / 11.1: free units ride with the paid quantity on a receipt.
//
// Owner, 30 Sep 2026: "make sure the free actually works" -- before this, Free
// was only a declaration that a $0.00 cost was intended, so "buy 10, get 2
// free" could not be entered, and free units entered as a separate $0 line
// never lowered the average (a 0 cost is "not recorded"). Now both receipt
// wires (POST /api/inventory/adjust type add, POST /api/batches) take a free
// quantity: stock in = paid + free, the lot and the movement carry the
// effective cost (10 x $3.50 over 12 units = $2.9167, owner Q2), the money
// recorded is what the supplier was paid ($35.00), and the movement keeps the
// free count. Free units are refused on a remove, a set and a correction; 0
// paid + n free is a fully free receipt that declares itself free.
//
// The real routes and libs run against a real in-memory SQLite database with
// every migration applied (the same approach as test-fast-stock-in-commit-pure.cjs).
//
// Run (from cloudflare/): node scripts/test-stock-session-free-quantity-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

function autoStub() {
  return new Proxy({}, { get(_target, prop) { if (prop === '__esModule') return true; if (typeof prop === 'symbol') return undefined; return () => undefined } })
}
function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  const patchedLoad = function (request, parent, isMain) {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) return autoStub()
    Module._load = originalLoad
    try { return originalLoad.call(this, request, parent, isMain) } finally { Module._load = patchedLoad }
  }
  Module._load = patchedLoad
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

let batchLog = []
function wrapFlat(rawDb) {
  return {
    raw: rawDb,
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    async batch(items) { batchLog.push(items.map((item) => item.sql)); return rawDb.batch(items) },
    async transaction(fn) { return fn(this) },
  }
}

let currentDb = null
const dbOverride = { getDb: () => currentDb }
const moneyMod = loadReal('lib/moneyPrecision.ts')
const batchCodeMod = loadReal('lib/batchCode.ts')
const sqlBindingMod = loadReal('lib/sqlBinding.ts')
const stockConditionMod = loadReal('lib/stockCondition.ts')
const gateMod = loadReal('lib/stockReceiptGate.ts')
const stockReasonMod = loadReal('lib/stockReason.ts')
const actorSnapshotMod = loadReal('lib/actorSnapshot.ts')
const permissionsMod = loadReal('lib/permissions.ts')
const productDetailRuleMod = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyMod })
const productIdentityMod = loadReal('lib/productIdentity.ts', { './db': dbOverride, './sqlBinding': sqlBindingMod, './productDetailRule': productDetailRuleMod })
const movementCostSnapshotMod = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyMod })
const productBatchesMod = loadReal('lib/productBatches.ts', { './receivingBranch': loadReal('lib/receivingBranch.ts'), './db': dbOverride, './batchCode': batchCodeMod, './moneyPrecision': moneyMod, './sqlBinding': sqlBindingMod })
const stockMutationReceiptMod = loadReal('lib/stockMutationReceipt.ts')
const stockSessionMathMod = loadReal('lib/stockSessionMath.ts', { './moneyPrecision': moneyMod })
const schemaProbeMod = loadReal('lib/schemaProbe.ts')
const catalogCostMod = loadReal('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyMod })
const realAudit = loadReal('lib/audit.ts')
let auditCalls = []
const auditStub = { audit: async (...args) => { auditCalls.push(args) }, changedFields: realAudit.changedFields }
const shared = {
  '../lib/receivingBranch': loadReal('lib/receivingBranch.ts'),
  '../lib/db': dbOverride,
  '../lib/auth': { requireAuth: async (_c, next) => { await next() } },
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../lib/cache': { bumpVersion: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': gateMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/stockMutationReceipt': stockMutationReceiptMod,
  '../lib/moneyPrecision': moneyMod,
  '../lib/stockSessionMath': stockSessionMathMod,
  '../lib/schemaProbe': schemaProbeMod,
  '../lib/catalogCostRecompute': catalogCostMod,
}
const inventoryMod = loadReal('routes/inventory.ts', {
  '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
  ...shared,
  '../lib/productIdentity': productIdentityMod,
  '../lib/movementCostSnapshot': movementCostSnapshotMod,
  '../lib/stockCondition': stockConditionMod,
})
const batchesMod = loadReal('routes/batches.ts', shared)

function freshDb(migrations = loadAll(), extraSql = '') {
  schemaProbeMod.__resetSchemaProbeCacheForTests()
  const rawDb = openDb(migrations)
  if (extraSql) rawDb.exec(extraSql)
  rawDb.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, selling_price_usd, stock_quantity, is_active)
      VALUES(1, 'SK-II Gentle Cleanser 20g', 'SK-1', 3.5, 0, 5, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
  `)
  return wrapFlat(rawDb)
}
const ADMIN = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}' }
function ctx(db, user = ADMIN) {
  currentDb = db
  return {
    env: { DB: {} },
    executionCtx: { waitUntil: (p) => { Promise.resolve(p).catch(() => {}) } },
    get: (key) => (key === 'user' ? user : undefined),
    set: () => {},
    json: (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } }),
  }
}
const call = async (fn, db, body) => { const res = await fn(ctx(db), body); return { status: res.status, json: await res.json() } }
const adjust = (db, body) => call(inventoryMod.runAdjustAction, db, { productId: 1, branchId: 1, type: 'add', reason: 'New arrival', supplierName: 'Bong Long', paymentStatus: 'paid', ...body })
const receive = (db, body) => call(batchesMod.runReceiveBatchAction, db, { product_id: 1, branch_id: 1, reason: 'New arrival', supplier_name: 'Bong Long', payment_status: 'paid', ...body })
const stock = (db) => db.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
const lots = (db) => db.prepare('SELECT unit_cost_usd, received_quantity, received_cost_usd FROM product_batches WHERE variant_product_id = 1 ORDER BY id').all()
const movements = (db) => db.prepare("SELECT quantity, unit_cost_usd, total_cost_usd, free_quantity, reason FROM inventory_movements WHERE product_id = 1 ORDER BY id").all()
const catalogCost = (db) => db.prepare('SELECT cost_price_usd FROM products WHERE id = 1').get().cost_price_usd

async function run() {
  // 0. The gate: a fully free receipt declares itself free; the supplier is still required.
  {
    const gate = gateMod.stockReceiptGateCode
    assert.equal(gate({ isStockIn: true, supplierName: 'Bong Long', quantity: 0, freeQuantity: 3 }), '', 'nothing paid + free units: no cost needed')
    assert.equal(gate({ isStockIn: true, supplierName: 'Bong Long', quantity: 0, freeQuantity: 0, unitCostUsd: null }), 'cost_required', 'zero free units is not a free receipt')
    assert.equal(gate({ isStockIn: true, supplierName: '', quantity: 0, freeQuantity: 3 }), 'supplier_required', 'free goods still came from a supplier')
    assert.equal(gate({ isStockIn: true, supplierName: 'Bong Long', quantity: 10, freeQuantity: 2, unitCostUsd: 0 }), 'free_goods_required', 'a $0 cost on paid units still needs the declaration')
    assert.equal(gateMod.parseFreeQuantity(undefined), 0)
    assert.equal(gateMod.parseFreeQuantity('2'), 2)
    assert.equal(gateMod.parseFreeQuantity(1.5), null, 'free units are whole units')
    assert.equal(gateMod.parseFreeQuantity(-1), null)
    console.log('PASS the receipt gate treats 0 paid + free units as declared free goods')
  }

  // 1. Both wires: 10 paid at $3.50 + 2 free = 12 in at $2.9167, $35.00 owed.
  for (const [label, send] of [
    ['adjust', (db) => adjust(db, { quantity: 10, unitCostUsd: 3.5, freeQuantity: 2 })],
    ['receive', (db) => receive(db, { quantity: 10, unit_cost_usd: 3.5, free_quantity: 2 })],
  ]) {
    const db = freshDb()
    const { status, json } = await send(db)
    assert.equal(status, 200, `${label}: ${JSON.stringify(json)}`)
    assert.equal(json.freeQuantity, 2, `${label}: the answer reports the free units`)
    assert.equal(stock(db), 12, `${label}: stock in = paid + free`)
    assert.deepEqual(lots(db), [{ unit_cost_usd: 2.9167, received_quantity: 12, received_cost_usd: 35 }], `${label}: the lot carries the effective cost and the money actually owed`)
    const [movement] = movements(db)
    assert.deepEqual([movement.quantity, movement.unit_cost_usd, movement.total_cost_usd, movement.free_quantity], [12, 2.9167, 35, 2], `${label}: the movement keeps 12 (2 free) and the paid money`)
    assert.equal(catalogCost(db), 2.9167, `${label}: the catalog cost follows the on-hand lot`)
    console.log(`PASS ${label}: 10 paid + 2 free lands 12 units at the effective cost with $35.00 owed`)
  }

  // 2. Free units lower the average (owner "cost price add and divide").
  {
    const db = freshDb()
    assert.equal((await adjust(db, { quantity: 10, unitCostUsd: 3.5 })).status, 200)
    assert.equal(catalogCost(db), 3.5)
    assert.equal((await adjust(db, { quantity: 10, unitCostUsd: 3.5, freeQuantity: 2 })).status, 200)
    assert.equal(stock(db), 22)
    assert.equal(catalogCost(db), 3.1818, '(10 x 3.50 + 12 x 2.9167) / 22 -- ignoring the free units would keep $3.50')
    console.log('PASS free units lower the quantity-weighted catalog cost')
  }

  // 3. 0 paid + n free: a fully free receipt, declared in the ledger.
  for (const [label, send] of [
    ['adjust', (db) => adjust(db, { quantity: 0, freeQuantity: 5 })],
    ['receive', (db) => receive(db, { quantity: 0, free_quantity: 5 })],
  ]) {
    const db = freshDb()
    const { status, json } = await send(db)
    assert.equal(status, 200, `${label}: ${JSON.stringify(json)}`)
    assert.equal(stock(db), 5)
    assert.deepEqual(lots(db), [{ unit_cost_usd: 0, received_quantity: 5, received_cost_usd: 0 }], `${label}: free goods cost nothing`)
    const [movement] = movements(db)
    assert.equal(movement.free_quantity, 5)
    assert.equal(movement.total_cost_usd, 0)
    assert.match(movement.reason, /Free goods \(no cost\)/, `${label}: the ledger keeps the free-goods claim in words`)
    assert.equal(catalogCost(db), 3.5, `${label}: a $0 lot is "not recorded" and leaves the catalog cost alone`)
    console.log(`PASS ${label}: 0 paid + 5 free is a declared free receipt`)
  }

  // 4. Refusals: nothing moves.
  {
    const db = freshDb()
    assert.equal((await adjust(db, { quantity: 10, unitCostUsd: 3.5 })).status, 200)
    const cases = [
      ['remove', { type: 'remove', quantity: 2, freeQuantity: 1, supplierName: undefined, paymentStatus: undefined }, 'free_quantity_not_receipt'],
      ['set', { type: 'set', quantity: 20, freeQuantity: 1, unitCostUsd: 3.5 }, 'free_quantity_not_receipt'],
      ['scoped set', { type: 'set', setScope: 'lot', batchId: 1, quantity: 20, freeQuantity: 1, supplierName: undefined, paymentStatus: undefined }, 'free_quantity_not_receipt'],
      ['correction', { quantity: 2, freeQuantity: 1, attribution: 'correction', supplierName: undefined, paymentStatus: undefined }, 'free_quantity_not_receipt'],
      ['half a unit', { quantity: 2, unitCostUsd: 3.5, freeQuantity: 0.5 }, 'invalid_free_quantity'],
    ]
    for (const [label, body, code] of cases) {
      const { status, json } = await adjust(db, body)
      assert.equal(status, 400, `${label}: refused`)
      assert.equal(json.code, code, `${label}: ${JSON.stringify(json)}`)
    }
    assert.equal((await adjust(db, { quantity: 0, freeQuantity: 0, unitCostUsd: 3.5 })).status, 400, '0 paid and 0 free is not a receipt')
    assert.equal((await receive(db, { quantity: 0, free_quantity: 0, unit_cost_usd: 3.5 })).status, 400)
    assert.equal((await receive(db, { quantity: 2, unit_cost_usd: 3.5, free_quantity: -2 })).json.code, 'invalid_free_quantity')
    assert.equal(stock(db), 10, 'no refused request moved stock')
    assert.equal(movements(db).length, 1)
    console.log('PASS free units are refused on a remove, a set, a correction and a malformed count')
  }

  // 5. Before the migration is applied remotely, a free receipt still lands; only the column waits.
  {
    const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
    const freeMigration = files.find((f) => /_inventory_movements_free_quantity\.sql$/.test(f))
    assert.ok(freeMigration, 'the append-only migration exists')
    const before = Number(freeMigration.slice(0, 4)) - 1
    // The receive planner stamps the lot's branch label (0236, a later migration than the one this test withholds).
    const db = freshDb(loadAll({ through: before }), 'ALTER TABLE product_batches ADD COLUMN received_branch_name TEXT')
    const { status, json } = await adjust(db, { quantity: 10, unitCostUsd: 3.5, freeQuantity: 2 })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(stock(db), 12)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(\'inventory_movements\') WHERE name = \'free_quantity\'').get().n, 0)
    assert.equal(db.prepare('SELECT total_cost_usd FROM inventory_movements').get().total_cost_usd, 35)
    console.log('PASS a schema without free_quantity still records the receipt (the column is written only when it exists)')
  }
}

run().catch((error) => { console.error(error); process.exit(1) })
