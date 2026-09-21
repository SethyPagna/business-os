// Regression test for P4-B (fast stock-in batched commit).
//
// FastStockInModal.tsx used to commit its pending lines one HTTP request at
// a time (N lines -> N sequential POST /api/inventory/adjust or POST
// /api/batches round trips). routes/stockInCommit.ts collapses that to ONE
// request by calling the exact same per-line kernels directly:
// routes/inventory.ts's runAdjustAction and routes/batches.ts's
// runReceiveBatchAction -- both pulled out from behind their own
// `app.post(...)` wrapper with their body unchanged (P4-B extraction), not
// re-implemented.
//
// Same approach as test-returns-batch-restock-pure.cjs: transpile the REAL
// route/lib files and run them against a real in-memory SQLite database with
// the real migrations applied, through the exact flat db.prepare().get()/
// .all()/.run() + db.batch() shape lib/db.ts's real D1Compat class produces
// (so routes/lib code sees the same interface it does in production).
// Modules with no bearing on this fix (cache/broadcast/telegram/transfer/
// dated-stock-count/canonical-branch/family-stats/etc.) are auto-stubbed to
// permissive no-ops; the stock-write kernels, permission checks, receipt
// gate, and money/identity helpers they call are real.
//
// Run (from cloudflare/): node scripts/test-fast-stock-in-commit-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

// A no-op stand-in for any relative import this test does not care about.
// Every property access returns a callable no-op (safe for both `fn(...)`
// and `new Cls(...)` usage); code paths this test never exercises (transfer,
// dated-stock-count, telegram, canonical-branch identity, family stats,
// damaged-lot tagging, movement-label SQL fragments used only by read
// endpoints) never touch these.
function autoStub() {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (typeof prop === 'symbol') return undefined
      return () => undefined
    },
  })
}

const moduleCache = new Map()
function loadReal(relPath, overrides = {}) {
  const cacheKey = relPath + '::' + Object.keys(overrides).sort().join(',')
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey)
  const sourcePath = path.join(root, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  const patchedLoad = function (request, parent, isMain) {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) return autoStub()
    // A real npm package (e.g. 'hono'): resolve it for real, and while doing
    // so, restore the ORIGINAL loader so that package's own internal
    // relative requires (hono's dist files require each other with './...')
    // are not swept up by the autoStub branch above too -- only THIS file's
    // own top-level relative imports should ever be stubbed.
    Module._load = originalLoad
    try {
      return originalLoad.call(this, request, parent, isMain)
    } finally {
      Module._load = patchedLoad
    }
  }
  Module._load = patchedLoad
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  moduleCache.set(cacheKey, moduleObj.exports)
  return moduleObj.exports
}

// ---------------------------------------------------------------------------
// A flat db.prepare().get()/.all()/.run() + db.batch() adapter, matching the
// interface lib/db.ts's real D1Compat class produces (.run() returns
// {changes, lastInsertRowid} at the top level, not nested under .meta;
// .batch() returns the raw D1Result[] verbatim -- callers read
// results[i].meta.last_row_id off it; .get() returns the row itself or
// undefined) -- built on top of the raw D1-shaped harness
// (scripts/harness/d1compat.cjs), which mimics Cloudflare's actual
// D1 binding (.prepare().bind().first()/.all()/.run()). '../lib/db' /
// './db' are overridden with `{ getDb: () => currentDb }` below instead of
// loading the real lib/db.ts module, so this test never needs the raw
// harness's Stmt class to also grow a `.first()` method just to satisfy
// lib/db.ts's own inner layer -- one adapter layer, not two stacked ones.
// ---------------------------------------------------------------------------
function wrapFlat(rawDb) {
  return {
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
    // Pass results through unmapped, like the real D1Compat.batch() --
    // flattening to {changes,lastInsertRowid} dropped .meta and made a
    // batched insert's row id read back as 0. Found 2026-09-22.
    async batch(items) {
      return rawDb.batch(items)
    },
    async transaction(fn) { return fn(this) },
  }
}

let currentDb = null
const dbOverride = { getDb: () => currentDb }

// ---------------------------------------------------------------------------
// Real, pure library modules (no local imports of their own, or only imports
// of other modules loaded the same way below).
// ---------------------------------------------------------------------------
const moneyMod = loadReal('lib/moneyPrecision.ts')
const batchCodeMod = loadReal('lib/batchCode.ts')
const sqlBindingMod = loadReal('lib/sqlBinding.ts')
const stockConditionMod = loadReal('lib/stockCondition.ts')
const stockReceiptGateMod = loadReal('lib/stockReceiptGate.ts')
const stockReasonMod = loadReal('lib/stockReason.ts')
const actorSnapshotMod = loadReal('lib/actorSnapshot.ts')
const permissionsMod = loadReal('lib/permissions.ts')
const productDetailRuleMod = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyMod })
const productIdentityMod = loadReal('lib/productIdentity.ts', {
  './db': dbOverride, './sqlBinding': sqlBindingMod, './productDetailRule': productDetailRuleMod,
})
const movementCostSnapshotMod = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyMod })
const productBatchesMod = loadReal('lib/productBatches.ts', {
  './db': dbOverride, './batchCode': batchCodeMod, './moneyPrecision': moneyMod, './sqlBinding': sqlBindingMod,
})

// audit() calls are recorded, not written to a real audit_logs row -- same
// pattern as test-returns-batch-restock-pure.cjs, since what this test needs
// to prove is "one audit call per line", not the audit table's own schema.
let auditCalls = []
const auditStub = { audit: async (...args) => { auditCalls.push(args) } }
const cacheStub = { bumpVersion: async () => {} }
const broadcastStub = { broadcast: async () => {} }
// requireAuth is never actually invoked -- this test calls runAdjustAction /
// runReceiveBatchAction / runStockInCommit directly, bypassing the Hono
// app.use() chain entirely -- but inventory.ts/batches.ts/stockInCommit.ts
// each call `app.use('*', requireAuth)` at module-eval time, so the export
// must exist and be callable.
const authStub = { requireAuth: async (c, next) => { await next() } }

const inventoryMod = loadReal('routes/inventory.ts', {
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/cache': cacheStub,
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/productIdentity': productIdentityMod,
  '../lib/movementCostSnapshot': movementCostSnapshotMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/moneyPrecision': moneyMod,
  '../lib/stockCondition': stockConditionMod,
})

const batchesMod = loadReal('routes/batches.ts', {
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/cache': cacheStub,
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/moneyPrecision': moneyMod,
})

const stockInCommitMod = loadReal('routes/stockInCommit.ts', {
  '../lib/auth': authStub,
  '../lib/permissions': permissionsMod,
  './inventory': inventoryMod,
  './batches': batchesMod,
})
const { runStockInCommit } = stockInCommitMod
const { runAdjustAction } = inventoryMod
assert.equal(typeof runStockInCommit, 'function', 'routes/stockInCommit.ts exports runStockInCommit')
assert.equal(typeof runAdjustAction, 'function', 'routes/inventory.ts exports runAdjustAction (P4-B extraction)')
assert.equal(typeof batchesMod.runReceiveBatchAction, 'function', 'routes/batches.ts exports runReceiveBatchAction (P4-B extraction)')

// ---------------------------------------------------------------------------
// Fixture DB + fake Hono Context. No real Hono app.request() round trip --
// the kernels are called directly, exactly as stockInCommit.ts's own POST
// /commit handler calls them.
// ---------------------------------------------------------------------------
function freshDb() {
  const rawDb = openDb(loadAll())
  rawDb.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(1, 'Serum', 'SER-1', 2, 0, 0, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(2, 'Toner', 'TON-1', 3, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(2, 1, 0);
  `)
  return wrapFlat(rawDb)
}

const ADMIN_USER = { id: 1, username: 'admin', name: 'Admin', permissions: '{}' }
// inventory: false blocks BOTH wires identically -- runAdjustAction's own
// `getActionTier(user, 'inventory', 'adjust') !== 'full'` check and this
// route's own canReceiveBatchStock() (hasPermission('inventory')) both read
// the same underlying 'inventory' permission key.
const NO_PERM_USER = { id: 2, username: 'cashier', name: 'Cashier', permissions: JSON.stringify({ inventory: false }) }

function makeContext(db, user) {
  let currentUser = user
  currentDb = db
  return {
    env: { DB: {} },
    executionCtx: { waitUntil: (p) => { Promise.resolve(p).catch(() => {}) } },
    get(key) { return key === 'user' ? currentUser : undefined },
    set(key, value) { if (key === 'user') currentUser = value },
    json(obj, status = 200) {
      return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
    },
  }
}

function branchStock(db, productId) {
  const row = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = 1').get({ productId })
  return row ? row.quantity : 0
}

async function run() {
  // 1) Mixed add/set/receive lines, in order, all succeed and apply exactly
  //    once each -- the ordinary fast stock-in session shape.
  {
    const db = freshDb()
    const c = makeContext(db, ADMIN_USER)
    const lines = [
      { key: 'a', wire: 'receive', body: {
        product_id: 1, branch_id: 1, quantity: 5, unit_cost_usd: 2, supplier_name: 'Acme', payment_status: 'paid',
      } },
      { key: 'b', wire: 'adjust', body: {
        productId: 2, type: 'add', quantity: 4, branchId: 1, reason: 'stock in',
        supplierName: 'Acme', unitCostUsd: 3, paymentStatus: 'paid',
      } },
      { key: 'c', wire: 'adjust', body: {
        productId: 1, type: 'remove', quantity: 2, branchId: 1, reason: 'damaged',
      } },
      { key: 'd', wire: 'adjust', body: {
        productId: 2, type: 'set', quantity: 10, branchId: 1, reason: 'recount',
        supplierName: 'Acme', unitCostUsd: 3, paymentStatus: 'paid',
      } },
    ]
    auditCalls = []
    const results = await runStockInCommit(c, lines)
    assert.equal(results.length, lines.length, 'one result per input line')
    assert.deepEqual(results.map((r) => r.key), ['a', 'b', 'c', 'd'], 'results preserve input order')
    for (const r of results) assert.equal(r.ok, true, `line ${r.key} should succeed: ${r.error || ''}`)
    // product 1: +5 receive, -2 remove = 3
    assert.equal(branchStock(db, 1), 3, 'receive then remove nets to 3')
    // product 2: +4 add, then set to 10 (raises by 6, itself an add) = 10
    assert.equal(branchStock(db, 2), 10, 'add then set-to-total lands on the requested total')
    assert.equal(auditCalls.length, 4, 'one audit call per line, matching the old per-line loop')
    console.log('PASS mixed add/set/receive lines apply once each, in order')
  }

  // 2) Permission refusal on one wire does not silently drop the other
  //    line's result -- every line still gets an entry, the loop keeps
  //    going, exactly like the old frontend for-loop's try/catch-per-line
  //    never breaking out early.
  {
    const db = freshDb()
    const c = makeContext(db, NO_PERM_USER)
    const lines = [
      { key: 'a', wire: 'receive', body: { product_id: 1, branch_id: 1, quantity: 5, unit_cost_usd: 2, supplier_name: 'Acme', payment_status: 'paid' } },
      { key: 'b', wire: 'adjust', body: { productId: 2, type: 'remove', quantity: 1, branchId: 1, reason: 'x' } },
    ]
    const results = await runStockInCommit(c, lines)
    assert.equal(results.length, 2, 'a forbidden line is still reported, not dropped')
    assert.equal(results[0].ok, false, 'the receive-wire line is refused')
    assert.equal(results[1].ok, false, 'the adjust-wire line is refused')
    assert.match(results[0].error, /permission/i)
    assert.match(results[1].error, /Full Access/i)
    assert.equal(branchStock(db, 1), 0, 'no stock moved for the refused receive line')
    assert.equal(branchStock(db, 2), 0, 'no stock moved for the refused adjust line')
    console.log("PASS permission refusal on one wire does not drop the other line's result")
  }

  // 3) Kernel parity: the same 'remove' line run through the single-line
  //    endpoint's own kernel (runAdjustAction, called the way POST /adjust
  //    calls it) and through the batched commit route must leave identical
  //    branch_stock and inventory_movements rows behind.
  {
    const dbSingle = freshDb()
    const dbBatched = freshDb()
    const body = { productId: 1, type: 'remove', quantity: 1, branchId: 1, reason: 'parity check' }
    await runAdjustAction(makeContext(dbSingle, ADMIN_USER), body)
    await runStockInCommit(makeContext(dbBatched, ADMIN_USER), [{ key: 'x', wire: 'adjust', body }])
    assert.equal(branchStock(dbSingle, 1), branchStock(dbBatched, 1), 'branch_stock matches between the two call paths')
    const rowSql = 'SELECT movement_type, quantity, reason FROM inventory_movements WHERE product_id = 1 ORDER BY id'
    assert.deepEqual(dbBatched.prepare(rowSql).all(), dbSingle.prepare(rowSql).all(), 'inventory_movements rows match between the two call paths')
    console.log('PASS batched route reuses the exact single-line kernel (no behavioural drift)')
  }

  // 4) A session larger than D1's 100-bound-parameter cap does not fail --
  //    each line still runs through the kernels' own existing chunking
  //    (lib/sqlBinding.ts), called sequentially, not folded into one
  //    oversized statement by this route.
  {
    const rawDb = openDb(loadAll())
    rawDb.exec("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);")
    const lines = []
    for (let i = 1; i <= 30; i += 1) {
      rawDb.exec(`INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active) VALUES(${i}, 'P${i}', 'B${i}', 1, 0, 0, 1);`)
      rawDb.exec(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(${i}, 1, 0);`)
      lines.push({ key: `p${i}`, wire: 'receive', body: { product_id: i, branch_id: 1, quantity: 1, unit_cost_usd: 1, supplier_name: 'Acme', payment_status: 'paid' } })
    }
    const db = wrapFlat(rawDb)
    const results = await runStockInCommit(makeContext(db, ADMIN_USER), lines)
    assert.equal(results.length, 30)
    assert.ok(results.every((r) => r.ok), `all 30 lines across a >100-param session succeed: ${JSON.stringify(results.filter((r) => !r.ok))}`)
    console.log('PASS a 30-line session (well past the 100-bound-parameter cap for one statement) commits every line')
  }
}

run().then(() => console.log('PASS fast-stock-in batched commit')).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
