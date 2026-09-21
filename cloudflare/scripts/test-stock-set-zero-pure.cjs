// N27 -- "set to 0" is a legal stock action.
//
// The fast flow's mode switch offers add / remove / set, and the whole point of
// a set is to make a branch total exactly the number the operator counted. Zero
// is a number they count: a line that is gone, a branch being emptied, a
// miscount corrected down to nothing. Both halves of the stack refused it.
//
// The Worker refused it FIRST -- `if (!(quantity > 0)) return 400` sits above
// the `type === 'set'` conversion, so a set-to-0 never reached the code that
// knows a set is a target and not a movement. That is the root cause: fixing
// only the client would have produced a request the server rejects. The
// frontend guard is pinned separately in frontend/tests/stockInModeSwitch.test.ts.
//
// Discriminating by construction. Every case below is a request whose CURRENT
// and PROPOSED behaviour differ, and the negative controls are the other half
// of the same rule:
//   (1) set 0 against a branch holding 5 -> 200 and the branch ends at 0
//       (before: 400 "Quantity must be a positive number", stock untouched).
//   (2) set 0 against a branch already at 0 -> 200 and NO movement is written
//       (before: 400). The no-op answer already existed for `diff === 0`; it
//       was simply unreachable at quantity 0.
//   (3) add 0 -> still 400, and (4) remove 0 -> still 400. A zero add or
//       remove is a no-op with a receipt attached; only a set has a meaning at
//       zero. A fix that just deleted the guard would pass (1) and (2) and
//       fail these.
//   (5) set -1 -> still 400. Non-negative, not "any number".
//
// Same harness as test-supplier-attribution-pure.cjs: transpile the REAL route
// and kernels, run them against the real migration chain in in-memory SQLite,
// call the actual Hono app.request(). Auth/audit/broadcast/cache/search are
// stubbed inert; the stock writes under test are real.
//
// Run (from cloudflare/): node scripts/test-stock-set-zero-pure.cjs

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
    return rawDb.batch(items)
  },
  async transaction(fn) { return fn(this) },
}
const fakeEnv = { DB: db }

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
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
const stockReceiptGate = loadReal('lib/stockReceiptGate.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', {
  './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision,
  './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision,
})
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': sqlBinding, './moneyPrecision': moneyPrecision })
const permissions = loadReal('lib/permissions.ts')
const acquisitionCostAccess = loadReal('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const branchRoles = loadReal('lib/branchRoles.ts')
const canonicalBranchIdentity = loadReal('lib/canonicalBranchIdentity.ts', {
  './db': loadReal('lib/db.ts', { './importMaintenanceFence': {} }),
  './branchRoles': branchRoles,
})
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': { getDb: () => db }, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const movementBranchNameKernel = loadReal('lib/movementBranchName.ts')
const movementActorNameKernel = loadReal('lib/movementActorName.ts')
const movementReferenceKernel = loadReal('lib/movementReference.ts')
const movementSearchKernel = loadReal('lib/movementSearch.ts', {
  './movementActorName': movementActorNameKernel,
  './movementBranchName': movementBranchNameKernel,
})
const productSalesLedger = loadReal('lib/productSalesLedger.ts', { './salesAnalytics': salesAnalytics })

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true }) }

// P3-L6: routes/inventory.ts imports the tagged-stock kernel, so this
// loader has to resolve it too (the paths under test never tag anything;
// they just have to import).
const stockCondition = loadReal('lib/stockCondition.ts')
const damagedLotActions = loadReal('lib/damagedLotActions.ts', {
  './productBatches': productBatches,
  './stockCondition': stockCondition,
  './movementCostSnapshot': loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision }),
  './returnsStock': loadReal('lib/returnsStock.ts', { './productBatches': productBatches, './stockCondition': stockCondition }),
  // readTaggedLotGroups now chunks its IN(...) list through this helper
  // (D1's 100-bound-parameter fix); without the override the transpiled
  // require resolves against scripts/ and the whole loader dies.
  './sqlBinding': sqlBinding,
})
const inventoryRoute = loadReal('routes/inventory.ts', {
  '../lib/stockCondition': stockCondition,
  '../lib/damagedLotActions': damagedLotActions,
  '../lib/moneyPrecision': moneyPrecision,
  '../lib/movementCostSnapshot': loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision }),
  // inventory.ts imports this TypeScript-only helper; load it through the
  // harness rather than asking Node to resolve a non-existent .js sibling.
  '../lib/transferOperationReceipt': loadReal('lib/transferOperationReceipt.ts'),
  // This contract exercises /adjust; fail loudly if it ever reaches transfer.
  '../lib/transferOperation': { planTransferOperation: async () => { throw new Error('unrelated transfer path invoked') } },
  '../lib/branchRoleGuards': loadReal('lib/branchRoleGuards.ts', { './branchRoles': loadReal('lib/branchRoles.ts') }),
  '../lib/canonicalBranchIdentity': canonicalBranchIdentity,
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/movementBranchName': movementBranchNameKernel,
  '../lib/movementActorName': movementActorNameKernel,
  '../lib/movementReference': movementReferenceKernel,
  '../lib/movementSearch': movementSearchKernel,
  '../lib/db': { getDb: () => db },
  '../lib/businessMaintenanceGuard': loadReal('lib/businessMaintenanceGuard.ts'),
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/salesAnalytics': salesAnalytics,
  '../lib/productSalesLedger': productSalesLedger,
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/stockReceiptGate': stockReceiptGate,
  // The one shared reason-length cap (lib/stockReason.ts). REAL, not a
  // stub: the point of the module is that every wire measures the same way.
  '../lib/stockReason': loadReal('lib/stockReason.ts'),
  '../lib/sqlBinding': sqlBinding,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/lowStockSettings': lowStockStub,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': { sendTelegramEvent: async () => false, formatStockChangeTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/acquisitionCostAccess': acquisitionCostAccess,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productIdentity': { findIdentityMatch: async () => null,
    identityBarcodeKey: loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision }).identityBarcodeKey },
  // P10-4: REAL, not stubbed -- see routes/inventory.ts's own comment above
  // recomputeCatalogCost's call site.
  '../lib/catalogCostRecompute': loadReal('lib/catalogCostRecompute.ts', {
    './db': { getDb: () => db },
    './moneyPrecision': moneyPrecision,
    './productDetailRule': loadReal('lib/productDetailRule.ts', { './moneyPrecision': loadReal('lib/moneyPrecision.ts') }),
  }),
  '../lib/productSearchQuery': {
    buildProductSearchQuery: () => ({ hasSearchTerm: false, titleOnly: false }),
    buildFamilyRelevanceOrderSql: (tail) => tail,
  },
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
  '../lib/stockRevert': { applyMovementRevert: async () => ({}) },
})
const app = inventoryRoute.default

const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(body) {
  const res = await app.request('/adjust', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  return { status: res.status, json: await res.json().catch(() => null) }
}

function seed(startingQuantity) {
  rawDb.exec("DELETE FROM damaged_stock_lots; DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements; DELETE FROM suppliers; DELETE FROM system_flags WHERE key='maintenance';")
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  rawDb.prepare('INSERT INTO products (id, name, barcode, is_active, stock_quantity) VALUES (1, @name, @barcode, 1, @qty)')
    .run({ name: 'Lip Oil A', barcode: 'B123', qty: startingQuantity })
  if (startingQuantity > 0) {
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @qty)').run({ qty: startingQuantity })
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, received_quantity, received_cost_usd)
                   VALUES (10, 1, '09052026', '09052026', '2026-09-05', 1, 2, @qty, @cost)`).run({ qty: startingQuantity, cost: startingQuantity * 2 })
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (10, 1, @qty)').run({ qty: startingQuantity })
  }
}

function branchQty() {
  const row = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get({})
  return row ? Number(row.quantity) : 0
}

function movements() {
  return rawDb.prepare('SELECT movement_type, quantity, reason FROM inventory_movements ORDER BY id').all({}) ?? []
}

function stockSnapshot() {
  const rows = (sql) => rawDb.prepare(sql).all({}) ?? []
  return {
    products: rows('SELECT id,name,barcode,stock_quantity,cost_price_usd,purchase_price_usd,client_request_id FROM products ORDER BY id'),
    branch: rows('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
    lots: rows('SELECT id,variant_product_id,batch_key,is_active,received_quantity,received_cost_usd,unit_cost_usd FROM product_batches ORDER BY id'),
    lotStock: rows('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id'),
    movement: rows('SELECT product_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,batch_id FROM inventory_movements ORDER BY id'),
    held: rows('SELECT product_id,batch_id,quantity,quantity_remaining,source,unit_cost_usd FROM damaged_stock_lots ORDER BY id'),
    guards: rows('SELECT guard_value FROM stock_session_guards ORDER BY rowid'),
    audit: rows('SELECT id,action,entity,entity_id FROM audit_logs ORDER BY id'),
    history: rows('SELECT id FROM action_history ORDER BY id'),
  }
}

async function refusedAtCommit(body, mode = 'reset') {
  const before = stockSnapshot()
  const originalBatch = db.batch
  let injected = false
  db.batch = async (items) => {
    if (!injected) {
      injected = true
      assert.match(String(items.at(-1)?.sql), /ordinary_business_maintenance_active/,
        'the first adjustment batch ends with the real maintenance assertion')
      rawDb.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run(['maintenance', JSON.stringify({ mode })])
    }
    return originalBatch.call(db, items)
  }
  try {
    const result = await req(body)
    assert.strictEqual(injected, true, 'the real route reached a D1 batch')
    assert.strictEqual(result.status, 503, `maintenance must give a retriable refusal: ${JSON.stringify(result)}`)
    assert.strictEqual(result.json?.code, 'maintenance_active')
    assert.deepStrictEqual(stockSnapshot(), before, 'all product, lot, movement and held-stock rows roll back')
  } finally {
    db.batch = originalBatch
    rawDb.prepare("DELETE FROM system_flags WHERE key='maintenance'").run({})
  }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('movement insert failure rolls back prior lot and aggregate writes for add and remove', async () => {
    for (const body of [
      { productId: 1, type: 'remove', quantity: 2, reason: 'Failed movement', branchId: 1 },
      { productId: 1, type: 'add', quantity: 2, reason: 'Failed receipt movement', branchId: 1,
        batchId: 'new', attribution: 'correction' },
    ]) {
      seed(5)
      const before = stockSnapshot()
      rawDb.exec("CREATE TEMP TRIGGER block_adjust_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'blocked movement'); END;")
      try {
        const result = await req(body)
        assert.notStrictEqual(result.status, 200, `movement failure must refuse: ${JSON.stringify(result)}`)
        assert.deepStrictEqual(stockSnapshot(), before, 'movement failure cannot leave a stock or lot change')
      } finally { rawDb.exec('DROP TRIGGER block_adjust_movement') }
    }
  })

  await check('unlocked same-row tagged receipt keeps price merge, held provenance and request reference', async () => {
    seed(5)
    FAKE_USER.permissions = JSON.stringify({ inventory: true, product_cost_edit: true })
    try {
      const result = await req({ productId: 1, type: 'add', quantity: 2, reason: 'Damaged arrival', branchId: 1,
        unlockPricing: true, pricing: { barcode: 'B123', cost_usd: 3.125 },
        supplierName: 'Acme', unitCostUsd: 3.125, conditionTag: 'damaged', sessionId: 77 })
      assert.strictEqual(result.status, 200, JSON.stringify(result))
      assert.strictEqual(result.json.createdSibling, false)
      const state = stockSnapshot()
      assert.strictEqual(state.products.length, 1)
      assert.strictEqual(Number(state.branch[0].quantity), 5)
      assert.strictEqual(state.held.length, 1)
      assert.strictEqual(Number(state.held[0].unit_cost_usd), 3.125)
      assert.deepStrictEqual(state.movement.map((row) => row.movement_type), ['add', 'damage_out'])
      assert.deepStrictEqual(state.movement.map((row) => Number(row.reference_id)), [77, 77])
    } finally { FAKE_USER.permissions = JSON.stringify({ inventory: true }) }
  })

  await check('normal selected and mixed FIFO/legacy removals keep exact stock and movement costs', async () => {
    seed(5)
    const selected = await req({ productId: 1, type: 'remove', quantity: 2, reason: 'Damaged', branchId: 1, batchId: 10 })
    assert.strictEqual(selected.status, 200, JSON.stringify(selected))
    assert.strictEqual(branchQty(), 3)
    assert.strictEqual(Number(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10').get({}).quantity), 3)
    assert.strictEqual(Number(stockSnapshot().movement[0].total_cost_usd), 4)
    seed(5)
    rawDb.prepare('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=10').run({})
    const mixed = await req({ productId: 1, type: 'remove', quantity: 5, reason: 'Count mismatch', branchId: 1 })
    assert.strictEqual(mixed.status, 200, JSON.stringify(mixed))
    assert.strictEqual(branchQty(), 0)
    assert.strictEqual(Number(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10').get({}).quantity), 0)
    assert.strictEqual(stockSnapshot().movement.length, 1)
    assert.strictEqual(stockSnapshot().movement[0].batch_id, null, 'legacy remainder must not claim one lot')
  })

  await check('selected-lot removal preserves the historical product-scalar decrement policy', async () => {
    seed(5)
    rawDb.prepare('UPDATE products SET stock_quantity=7 WHERE id=1').run({})
    const result = await req({ productId: 1, type: 'remove', quantity: 2, reason: 'Damaged', branchId: 1, batchId: 10 })
    assert.strictEqual(result.status, 200, JSON.stringify(result))
    assert.strictEqual(Number(rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get({}).stock_quantity), 5)
    assert.strictEqual(branchQty(), 3)
  })

  await check('normal tagged restock commits receipt, both movements, and held provenance together', async () => {
    seed(5)
    const result = await req({ productId: 1, type: 'add', quantity: 2, reason: 'Broken arrival',
      conditionTag: 'damaged', branchId: 1, batchId: 'new', attribution: 'correction' })
    assert.strictEqual(result.status, 200, JSON.stringify(result))
    const state = stockSnapshot()
    assert.strictEqual(Number(state.branch[0].quantity), 5, 'tagged units are held, not sellable')
    assert.strictEqual(state.held.length, 1)
    assert.strictEqual(Number(state.held[0].quantity_remaining), 2)
    assert.deepStrictEqual(state.movement.map((row) => row.movement_type), ['add', 'damage_out'])
  })

  await check('normal unlocked new sibling commits one product, lot, movement and cost to 4dp', async () => {
    seed(5)
    FAKE_USER.permissions = JSON.stringify({ inventory: true, product_cost_edit: true })
    try {
      const result = await req({ productId: 1, type: 'add', quantity: 2, reason: 'New barcode', branchId: 1,
        unlockPricing: true, pricing: { barcode: 'B124', cost_usd: 3.125 },
        supplierName: 'Acme', unitCostUsd: 3.125 })
      assert.strictEqual(result.status, 200, JSON.stringify(result))
      assert.strictEqual(result.json.createdSibling, true)
      const state = stockSnapshot()
      assert.strictEqual(state.products.length, 2)
      assert.strictEqual(state.products[1].barcode, 'B124')
      assert.strictEqual(Number(state.products[1].stock_quantity), 2)
      assert.strictEqual(Number(state.products[1].cost_price_usd), 3.125)
      assert.strictEqual(state.lots.length, 2)
      assert.strictEqual(state.movement.length, 1)
      assert.strictEqual(Number(state.movement[0].total_cost_usd), 6.25)
    } finally { FAKE_USER.permissions = JSON.stringify({ inventory: true }) }
  })

  await check('unlocked new sibling tagged restock holds the new lot without sellable stock', async () => {
    seed(5)
    FAKE_USER.permissions = JSON.stringify({ inventory: true, product_cost_edit: true })
    try {
      const result = await req({ productId: 1, type: 'add', quantity: 2, reason: 'Damaged new barcode', branchId: 1,
        unlockPricing: true, pricing: { barcode: 'B125', cost_usd: 3.125 },
        supplierName: 'Acme', unitCostUsd: 3.125, conditionTag: 'damaged' })
      assert.strictEqual(result.status, 200, JSON.stringify(result))
      const state = stockSnapshot()
      const siblingId = result.json.productId
      assert.strictEqual(state.products.length, 2)
      assert.strictEqual(Number(state.products[1].stock_quantity), 0)
      assert.strictEqual(state.held.length, 1)
      assert.strictEqual(Number(state.held[0].product_id), siblingId)
      assert.strictEqual(Number(state.held[0].batch_id), result.json.batchId)
      assert.deepStrictEqual(state.movement.map((row) => row.movement_type), ['add', 'damage_out'])
    } finally { FAKE_USER.permissions = JSON.stringify({ inventory: true }) }
  })

  await check('selected-lot remove and mixed FIFO/legacy remainder refuse atomically under reset', async () => {
    seed(5)
    await refusedAtCommit({ productId: 1, type: 'remove', quantity: 2, reason: 'Damaged', branchId: 1, batchId: 10 })
    seed(5)
    rawDb.prepare('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=10 AND branch_id=1').run({})
    await refusedAtCommit({ productId: 1, type: 'remove', quantity: 5, reason: 'Count mismatch', branchId: 1 })
  })

  await check('tagged remove, tagged restock, and selected-lot correction refuse without partial held stock', async () => {
    seed(5)
    await refusedAtCommit({ productId: 1, type: 'remove', quantity: 2, reason: 'Broken', conditionTag: 'damaged', branchId: 1 })
    seed(5)
    await refusedAtCommit({ productId: 1, type: 'add', quantity: 2, reason: 'Broken arrival', conditionTag: 'damaged',
      branchId: 1, batchId: 'new', attribution: 'correction' })
    seed(5)
    await refusedAtCommit({ productId: 1, type: 'add', quantity: 2, reason: 'Count correction',
      branchId: 1, batchId: 10, attribution: 'correction' }, 'corrupt')
  })

  await check('unlocked new-sibling receipt refuses atomically, including the sibling row itself', async () => {
    seed(5)
    FAKE_USER.permissions = JSON.stringify({ inventory: true, product_cost_edit: true })
    try {
      await refusedAtCommit({ productId: 1, type: 'add', quantity: 2, reason: 'New barcode', branchId: 1,
        unlockPricing: true, pricing: { barcode: 'B124', cost_usd: 3.125 },
        supplierName: 'Acme', unitCostUsd: 3.125 })
    } finally { FAKE_USER.permissions = JSON.stringify({ inventory: true }) }
  })

  await check('maintenance arriving before add receipt commit rolls back lot, aggregate, and movement', async () => {
    seed(5)
    const before = {
      product: rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get({}),
      branch: rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get({}),
      lots: rawDb.prepare('SELECT id,received_quantity,received_cost_usd FROM product_batches ORDER BY id').all({}),
      lotStock: rawDb.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all({}),
      movements: movements(),
    }
    const originalBatch = db.batch
    let injected = false
    db.batch = async (items) => {
      if (!injected) {
        injected = true
        rawDb.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run(['maintenance', '{"mode":"restore"}'])
      }
      return originalBatch.call(db, items)
    }
    try {
      const result = await req({ productId: 1, type: 'add', quantity: 2, reason: 'Count correction',
        branchId: 1, batchId: 'new', attribution: 'correction' })
      assert.notStrictEqual(result.status, 200, `maintenance must refuse receipt: ${JSON.stringify(result)}`)
      assert.strictEqual(injected, true)
      assert.deepStrictEqual(rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get({}), before.product)
      assert.deepStrictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get({}), before.branch)
      assert.deepStrictEqual(rawDb.prepare('SELECT id,received_quantity,received_cost_usd FROM product_batches ORDER BY id').all({}), before.lots)
      assert.deepStrictEqual(rawDb.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all({}), before.lotStock)
      assert.deepStrictEqual(movements(), before.movements)
    } finally {
      db.batch = originalBatch
      rawDb.prepare("DELETE FROM system_flags WHERE key='maintenance'").run({})
    }
  })

  await check('maintenance arriving before set-to-zero commit rolls back the entire adjustment', async () => {
    seed(5)
    const before = {
      product: rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get({}),
      branch: rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get({}),
      lot: rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1').get({}),
      movements: movements(),
    }
    const originalBatch = db.batch
    let injected = false
    db.batch = async (items) => {
      if (!injected) {
        injected = true
        rawDb.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run(['maintenance', '{"mode":"reset"}'])
      }
      return originalBatch.call(db, items)
    }
    try {
      const result = await req({ productId: 1, type: 'set', quantity: 0, reason: 'Counted none', branchId: 1 })
      assert.notStrictEqual(result.status, 200, `maintenance must refuse adjustment: ${JSON.stringify(result)}`)
      assert.strictEqual(injected, true, 'the marker was installed at the actual commit boundary')
      assert.deepStrictEqual(rawDb.prepare('SELECT stock_quantity FROM products WHERE id=1').get({}), before.product)
      assert.deepStrictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get({}), before.branch)
      assert.deepStrictEqual(rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10 AND branch_id=1').get({}), before.lot)
      assert.deepStrictEqual(movements(), before.movements)
    } finally {
      db.batch = originalBatch
      rawDb.prepare("DELETE FROM system_flags WHERE key='maintenance'").run({})
    }
  })

  await check('set 0 empties a branch that holds stock', async () => {
    seed(5)
    const { status, json } = await req({ productId: 1, type: 'set', quantity: 0, reason: 'Counted none', branchId: 1 })
    assert.strictEqual(status, 200, `set-to-zero must be accepted, got ${status} ${JSON.stringify(json)}`)
    assert.strictEqual(branchQty(), 0, 'the branch total is exactly the number the operator set')
    const rows = movements()
    assert.strictEqual(rows.length, 1, `the difference posts as one movement, got ${JSON.stringify(rows)}`)
    assert.strictEqual(rows[0].movement_type, 'remove', 'lowering a total to zero is a remove of the difference')
    assert.strictEqual(Math.abs(Number(rows[0].quantity)), 5, 'the movement carries the whole difference')
    assert.match(String(rows[0].reason), /Set to 0/, 'the ledger records the operator action, not just its conversion')
  })

  await check('set 0 on a branch already at 0 succeeds and writes nothing', async () => {
    seed(0)
    const { status, json } = await req({ productId: 1, type: 'set', quantity: 0, reason: 'Counted none', branchId: 1 })
    assert.strictEqual(status, 200, `an already-zero branch is not an error, got ${status} ${JSON.stringify(json)}`)
    assert.strictEqual(json.movementType, 'set', 'the no-op answer still names the operator action')
    assert.strictEqual(json.quantity, 0)
    assert.strictEqual(branchQty(), 0)
    assert.deepStrictEqual(movements(), [], 'a no-op set leaves the ledger alone')
  })

  await check('add 0 is still refused', async () => {
    seed(5)
    const permissionsBefore = FAKE_USER.permissions
    FAKE_USER.permissions = JSON.stringify({ inventory: true, product_cost_edit: true })
    try {
      const { status } = await req({ productId: 1, type: 'add', quantity: 0, reason: 'Receive', branchId: 1, batchId: 'new', unitCostUsd: 2, supplierName: 'Acme' })
      assert.strictEqual(status, 400, 'a zero add is a receipt of nothing even when the actor can enter its cost')
    } finally {
      FAKE_USER.permissions = permissionsBefore
    }
    assert.strictEqual(branchQty(), 5)
  })

  await check('remove 0 is still refused', async () => {
    seed(5)
    const { status } = await req({ productId: 1, type: 'remove', quantity: 0, reason: 'Write-off', branchId: 1 })
    assert.strictEqual(status, 400, 'a zero remove takes nothing out')
    assert.strictEqual(branchQty(), 5)
  })

  await check('a negative set is still refused', async () => {
    seed(5)
    const { status } = await req({ productId: 1, type: 'set', quantity: -1, reason: 'Counted none', branchId: 1 })
    assert.strictEqual(status, 400, 'a branch cannot hold less than nothing')
    assert.strictEqual(branchQty(), 5)
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
