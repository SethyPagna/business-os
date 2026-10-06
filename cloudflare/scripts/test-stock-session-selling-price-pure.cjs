// UI-STOCK 5.2 / 11.2: a stock receipt may carry the product's new selling price.
//
// Owner, 30 Sep 2026: "we add can be different selling price or cost price, of
// course we prefill the current one. they can edit. if selling price, take
// latest one/highest, latest priority" -- and no "Lock current pricing": the
// receipt stays on the same product row (only a different barcode makes a new
// row). Both receipt wires take the price (POST /api/inventory/adjust
// sellingPriceUsd/Khr, POST /api/batches selling_price_usd/khr): the latest
// entered wins even when lower (not the old MAX), rounded UP to the cent, in
// the same D1 batch as the receipt, audited like a product edit so it shows in
// the product's Records. A change needs the Products edit grant (403
// price_edit_required, nothing written); an unchanged prefill writes nothing.
//
// Run (from cloudflare/): node scripts/test-stock-session-selling-price-pure.cjs
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
  '../lib/branchRedirectWrite': require('./harness/branch_redirect_write.cjs'), // CUTOVER-LR
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

function freshDb(migrations = loadAll()) {
  schemaProbeMod.__resetSchemaProbeCacheForTests()
  const rawDb = openDb(migrations)
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

const callAs = async (fn, db, user, body) => { const res = await fn(ctx(db, user), body); return { status: res.status, json: await res.json() } }
// Can take stock in and enter costs, but has no Products edit grant.
const STOCK_CLERK = { id: 3, username: 'clerk', name: 'Clerk', permissions: JSON.stringify({ inventory: true, product_cost_edit: true }) }
const price = (db) => db.prepare('SELECT selling_price_usd, selling_price_khr FROM products WHERE id = 1').get()
const priceAudits = () => auditCalls.filter((args) => args[3] === 'update' && args[4] === 'product')

async function run() {
  // 1. A changed price lands on the same row, rounded up to the cent, in the receipt's own D1 batch.
  for (const [label, send] of [
    ['adjust', (db) => adjust(db, { quantity: 6, unitCostUsd: 3.5, sellingPriceUsd: 5.501 })],
    ['receive', (db) => receive(db, { quantity: 6, unit_cost_usd: 3.5, selling_price_usd: 5.501 })],
  ]) {
    const db = freshDb()
    auditCalls = []
    batchLog = []
    const { status, json } = await send(db)
    assert.equal(status, 200, `${label}: ${JSON.stringify(json)}`)
    assert.equal(json.sellingPriceUsd, 5.51, `${label}: the answer reports the new price`)
    assert.deepEqual(price(db), { selling_price_usd: 5.51, selling_price_khr: 0 }, `${label}: $5.501 is stored rounded UP to $5.51; KHR untouched when not sent`)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1, `${label}: no new row for a new price (child-row rule)`)
    const together = batchLog.find((sqls) => sqls.some((sql) => /UPDATE products SET selling_price_usd/.test(sql)))
    assert.ok(together && together.some((sql) => /INSERT INTO branch_batch_stock/.test(sql)), `${label}: the price is written in the same D1 batch as the receipt`)
    const [entry] = priceAudits()
    assert.ok(entry, `${label}: audited like a product edit`)
    assert.deepEqual(entry[7], { before: { selling_price_usd: 5 }, after: { selling_price_usd: 5.51 } }, `${label}: the product's Records get the before and after`)
    console.log(`PASS ${label}: a typed selling price updates the product in the receipt's batch and is audited`)
  }

  // 2. Latest entered wins, even when lower (owner Q3) -- not the old MAX rule.
  {
    const db = freshDb()
    assert.equal((await adjust(db, { quantity: 1, unitCostUsd: 3.5, sellingPriceUsd: 4.2 })).status, 200)
    assert.equal(price(db).selling_price_usd, 4.2, 'a lower price replaces $5.00; MAX would keep $5.00')
    assert.equal((await receive(db, { quantity: 1, unit_cost_usd: 3.5, selling_price_usd: 4.8, selling_price_khr: 19700 })).status, 200)
    assert.deepEqual(price(db), { selling_price_usd: 4.8, selling_price_khr: 19700 }, 'the next receipt wins again, KHR when sent')
    console.log('PASS the latest entered selling price wins, lower or higher')
  }

  // 3. An unchanged price writes nothing and needs no price permission.
  {
    const db = freshDb()
    auditCalls = []
    const { status, json } = await callAs(inventoryMod.runAdjustAction, db, STOCK_CLERK, { productId: 1, branchId: 1, type: 'add', reason: 'New arrival', supplierName: 'Bong Long', paymentStatus: 'paid', quantity: 2, unitCostUsd: 3.5, sellingPriceUsd: 5 })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.sellingPriceUsd, null)
    assert.equal(priceAudits().length, 0, 'no price audit for an unchanged price')
    console.log('PASS an unchanged prefilled price writes nothing and needs no Products edit grant')
  }

  // 4. A change without the Products edit grant is refused before anything moves.
  for (const [label, fn, body] of [
    ['adjust', inventoryMod.runAdjustAction, { productId: 1, branchId: 1, type: 'add', reason: 'New arrival', supplierName: 'Bong Long', paymentStatus: 'paid', quantity: 2, unitCostUsd: 3.5, sellingPriceUsd: 6 }],
    ['receive', batchesMod.runReceiveBatchAction, { product_id: 1, branch_id: 1, reason: 'New arrival', supplier_name: 'Bong Long', payment_status: 'paid', quantity: 2, unit_cost_usd: 3.5, selling_price_usd: 6 }],
  ]) {
    const db = freshDb()
    const { status, json } = await callAs(fn, db, STOCK_CLERK, body)
    assert.equal(status, 403, `${label}: ${JSON.stringify(json)}`)
    assert.equal(json.code, 'price_edit_required')
    assert.equal(stock(db), 0, `${label}: no stock moved`)
    assert.equal(price(db).selling_price_usd, 5, `${label}: the price is unchanged`)
    console.log(`PASS ${label}: a price change without the Products edit grant is refused with nothing written`)
  }

  // 5. Only a receipt carries a price.
  {
    const db = freshDb()
    assert.equal((await adjust(db, { quantity: 5, unitCostUsd: 3.5 })).status, 200)
    for (const [label, body, code] of [
      ['remove', { type: 'remove', quantity: 1, sellingPriceUsd: 6, supplierName: undefined, paymentStatus: undefined }, 'selling_price_not_receipt'],
      ['set', { type: 'set', quantity: 9, unitCostUsd: 3.5, sellingPriceUsd: 6 }, 'selling_price_not_receipt'],
      ['unlocked pricing too', { quantity: 1, unitCostUsd: 3.5, sellingPriceUsd: 6, unlockPricing: true, pricing: { selling_price_usd: 7 } }, 'selling_price_conflict'],
      ['not a number', { quantity: 1, unitCostUsd: 3.5, sellingPriceUsd: 'five' }, 'invalid_selling_price'],
    ]) {
      const { status, json } = await adjust(db, body)
      assert.equal(status, 400, `${label}: refused`)
      assert.equal(json.code, code, `${label}: ${JSON.stringify(json)}`)
    }
    assert.equal(price(db).selling_price_usd, 5)
    assert.equal(stock(db), 5)
    console.log('PASS a selling price rides only on a receipt, never on a remove, a set or beside unlocked pricing')
  }
}

run().catch((error) => { console.error(error); process.exit(1) })
