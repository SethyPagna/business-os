// UI-STOCK 5.4 / 11.3: what the supplier was paid must match the session.
//
// Owner, 30 Sep 2026: "we can also do the payment amount... to compare session
// of add/create with paid to supplier. as we don't want the cost price which
// is what we paid to the actual paid to be inconsistent". The stock session's
// Payment step sends { supplierTotalUsd, paymentStatus, creditDueDate? } with
// POST /api/inventory/fast-stock-in/commit. Before any line runs, the receipt
// lines' paid money (quantity x unit cost, free units excluded) must match it
// within half a cent and every receipt line must carry the session's payment
// status; otherwise the request is refused and nothing is written. Without the
// block the route behaves exactly as before (older clients).
//
// Run (from cloudflare/): node scripts/test-stock-in-commit-supplier-total-pure.cjs
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
const productBatchesMod = loadReal('lib/productBatches.ts', { './db': dbOverride, './batchCode': batchCodeMod, './moneyPrecision': moneyMod, './sqlBinding': sqlBindingMod })
const stockMutationReceiptMod = loadReal('lib/stockMutationReceipt.ts')
const stockSessionMathMod = loadReal('lib/stockSessionMath.ts', { './moneyPrecision': moneyMod })
const schemaProbeMod = loadReal('lib/schemaProbe.ts')
const catalogCostMod = loadReal('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyMod })
const realAudit = loadReal('lib/audit.ts')
let auditCalls = []
const auditStub = { audit: async (...args) => { auditCalls.push(args) }, changedFields: realAudit.changedFields }
const shared = {
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

const planTierMod = loadReal('lib/planTier.ts')
const commitMod = loadReal('routes/stockInCommit.ts', {
  '../lib/auth': shared['../lib/auth'],
  '../lib/permissions': permissionsMod,
  '../lib/planTier': planTierMod,
  '../lib/stockSessionMath': stockSessionMathMod,
  './inventory': inventoryMod,
  './batches': batchesMod,
})
// The free plan answers one line per request and defers the rest untouched,
// so these runs also show the first request checks the WHOLE session.
const commit = async (db, body) => {
  currentDb = db
  const c = { ...ctx(db), env: { DB: {}, PLAN_TIER: 'free' } }
  const res = await commitMod.commitStockIn(c, body)
  return { status: res.status, json: await res.json() }
}
const nothingWritten = (db, label) => {
  assert.equal(stock(db), 0, `${label}: no stock moved`)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0, `${label}: no movement written`)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_batches').get().n, 0, `${label}: no lot written`)
}
// 10 at $3.50 + 2 free and 6 at $12.09 (paid, free units excluded) = $107.54.
const sessionLines = (paymentStatus = 'paid') => [
  { key: 'a', wire: 'receive', body: { product_id: 1, branch_id: 1, quantity: 10, free_quantity: 2, unit_cost_usd: 3.5, supplier_name: 'Bong Long', payment_status: paymentStatus, credit_due_date: '2026-10-15', reason: 'New arrival' } },
  { key: 'b', wire: 'adjust', body: { productId: 1, branchId: 1, type: 'add', quantity: 6, unitCostUsd: 12.09, supplierName: 'Bong Long', paymentStatus: 'paid', reason: 'New arrival' } },
  { key: 'c', wire: 'adjust', body: { productId: 1, branchId: 1, type: 'remove', quantity: 1, reason: 'Damaged' } },
]

async function run() {
  // 1. The pure rule.
  {
    const refuse = commitMod.stockInCommitSessionRefusal
    const lines = sessionLines()
    assert.equal(refuse(lines, undefined), null, 'no block: the old contract')
    assert.equal(refuse(lines, { supplierTotalUsd: 107.54, paymentStatus: 'paid' }), null)
    assert.equal(refuse(lines, { supplierTotalUsd: 107.545, paymentStatus: 'paid' }), null, 'half a cent over still matches')
    assert.deepEqual(refuse(lines, { supplierTotalUsd: 107.546, paymentStatus: 'paid' }), { error: 'Paid to supplier does not match the items total', code: 'supplier_total_mismatch', itemsTotalUsd: 107.54, supplierTotalUsd: 107.546 })
    assert.equal(refuse(lines, { supplierTotalUsd: 114.54, paymentStatus: 'paid' }).code, 'supplier_total_mismatch', 'the free units are not paid for: counting them is a mismatch')
    assert.equal(refuse(lines, { supplierTotalUsd: 107.54, paymentStatus: 'credit', creditDueDate: '2026-10-15' }).code, 'payment_status_mismatch')
    assert.equal(refuse(lines, { supplierTotalUsd: 107.54, paymentStatus: 'credit' }).code, 'invalid_session', 'Not Yet Paid needs its due date')
    assert.equal(refuse(lines, { supplierTotalUsd: 'lots', paymentStatus: 'paid' }).code, 'invalid_session')
    assert.equal(refuse(lines, { supplierTotalUsd: 107.54, paymentStatus: 'later' }).code, 'invalid_session')
    assert.equal(refuse([sessionLines()[2]], { supplierTotalUsd: 0, paymentStatus: 'paid' }), null, 'a remove-only session owes nothing')
    console.log('PASS the session block matches paid lines within half a cent, free units excluded, one payment status')
  }

  // 2. A match runs the lines; the first request checks every line, deferred tail included.
  {
    const db = freshDb()
    const { status, json } = await commit(db, { lines: sessionLines(), session: { supplierTotalUsd: 107.545, paymentStatus: 'paid' } })
    assert.equal(status, 200, JSON.stringify(json))
    assert.deepEqual(json.results.map((result) => [result.key, result.ok, result.code ?? null]), [['a', true, null], ['b', false, 'deferred'], ['c', false, 'deferred']], 'the free plan ran one line and deferred the rest')
    assert.equal(stock(db), 12)
    // The client re-sends the deferred tail without the block (the whole session was checked above).
    const tail = await commit(db, { lines: sessionLines().slice(1) })
    assert.equal(tail.status, 200)
    const last = await commit(db, { lines: sessionLines().slice(2) })
    assert.equal(last.status, 200)
    assert.equal(stock(db), 17, '12 + 6 - 1')
    console.log('PASS a matching session runs, and its deferred tail completes without the block')
  }

  // 3. A mismatch refuses BEFORE any line runs.
  for (const [label, session, code] of [
    ['0.006 off', { supplierTotalUsd: 107.546, paymentStatus: 'paid' }, 'supplier_total_mismatch'],
    ['free units counted as paid', { supplierTotalUsd: 114.54, paymentStatus: 'paid' }, 'supplier_total_mismatch'],
    ['another payment status', { supplierTotalUsd: 107.54, paymentStatus: 'credit', creditDueDate: '2026-10-15' }, 'payment_status_mismatch'],
  ]) {
    const db = freshDb()
    const { status, json } = await commit(db, { lines: sessionLines(), session })
    assert.equal(status, 400, `${label}: ${JSON.stringify(json)}`)
    assert.equal(json.code, code)
    nothingWritten(db, label)
    console.log(`PASS ${label}: refused before any line, nothing written`)
  }

  // 4. No block: today's behaviour, whatever the totals.
  {
    const db = freshDb()
    const { status, json } = await commit(db, { lines: sessionLines() })
    assert.equal(status, 200)
    assert.equal(json.results[0].ok, true)
    console.log('PASS without a session block the route behaves as before')
  }
}

run().catch((error) => { console.error(error); process.exit(1) })
