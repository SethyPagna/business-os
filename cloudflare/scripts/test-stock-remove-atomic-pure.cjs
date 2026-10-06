// SCAN1 L2 (STK-C, STK-D, the /move-row variant of OV-3): every stock REMOVAL
// that spans the lot ledger and the aggregate is ONE D1 batch, strict, and
// guarded -- or it does not happen at all.
//
// What each group below pins, and the plausible wrong fix it kills:
//
//   STK-C  /adjust remove of stock that is partly or wholly UNLOTTED (legacy /
//          imported units that ride branch_stock alone). The remainder used to
//          go through an UPSERT whose VALUES row carried the negative delta;
//          SQLite checks CHECK(quantity >= 0) (migration 0058) on that
//          candidate row before ON CONFLICT, so every such remove failed -- and
//          a mixed lot + unlotted remove had ALREADY committed the lot drain in
//          its own batch, leaving lots drained with no movement row behind a
//          400. Wrong fix killed: clamping the branch decrement with MAX(0)
//          (the race check below ends with units removed that did not exist).
//   OV-6   the movement row rides the SAME batch: an injected movement failure
//          leaves both ledgers exactly where they were.
//   /move-row  captured allocations + strict decrement + destination receipt +
//          both movements in one batch. A stale read can no longer credit the
//          destination with units the source never gave up (phantom units),
//          and a mixed source no longer 500s after draining its lots.
//   STK-D  tagged Restore / Dispose: the held-lot decrement is guarded IN the
//          batch, so a concurrent consumer turns the request into a 409 with
//          nothing written instead of a 0-row UPDATE followed by a sellable
//          credit / a second write_off. A client_request_id makes a lost
//          response replay, and the guard abort RELEASES the claim (the write
//          mark rides the same batch), so the retry is not told "partially
//          applied" for a request that wrote nothing.
//
// Harness: the REAL route and kernels on the REAL migration chain, driven
// through app.request(), copied from scripts/test-stock-condition-tag-pure.cjs
// (whose before/after batch hooks simulate the concurrent writer).
//
// Run (from cloudflare/): node scripts/test-stock-remove-atomic-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
let afterDbBatchHook = null
let beforeDbBatchHook = null
// Flatten node:sqlite's run() result the same way lib/db.ts's real
// D1Compat.run() does -- productBatches.ts and inventory.ts rely on
// `result.lastInsertRowid`/`result.changes` at the top level.
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
    if (beforeDbBatchHook) await beforeDbBatchHook(items)
    // Exercise D1's actual atomic batch contract. A later assertion/trigger
    // failure must roll back every earlier statement in the same receipt.
    // Pass results through unmapped, like the real D1Compat.batch() (db.ts)
    // -- flattening to {changes,lastInsertRowid} dropped .meta and made a
    // batched insert's row id read back as 0. Found 2026-09-22.
    const results = await rawDb.batch(items)
    if (afterDbBatchHook) await afterDbBatchHook(items)
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
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } catch (error) {
    error.message = `${error.message} (while loading ${relPath})`
    throw error
  }
  Module._load = originalLoad
  return moduleObj.exports
}

// The REAL date module the route validates with and the kernel derives lot
// codes with; a stub would test the stub.
const batchCode = loadReal('lib/batchCode.ts')
// N14-D: routes/inventory.ts now enforces the shared receipt gate, so the
// real module has to be in the stub map like every other real dependency.
const stockReceiptGate = loadReal('lib/stockReceiptGate.ts')
const stockMutationReceipt = loadReal('lib/stockMutationReceipt.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const productBatches = loadReal('lib/productBatches.ts', { './receivingBranch': loadReal('lib/receivingBranch.ts'), './db': { getDb: () => db }, './batchCode': batchCode, './moneyPrecision': moneyPrecision, './sqlBinding': sqlBinding })
const productDetailRule = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
const permissions = loadReal('lib/permissions.ts')
const acquisitionCostAccess = loadReal('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const branchRoles = loadReal('lib/branchRoles.ts')
const canonicalBranchIdentity = loadReal('lib/canonicalBranchIdentity.ts', {
  './db': loadReal('lib/db.ts', { './importMaintenanceFence': {
    getImportFencedDb: async () => { throw new Error('getImportFencedDb should not be called by this pure test') },
    withImportMaintenanceWriteFence: async () => { throw new Error('withImportMaintenanceWriteFence should not be called by this pure test') },
    isImportMaintenanceFenceError: () => false,
    ImportMaintenanceFenceError: class ImportMaintenanceFenceError extends Error {},
  } }),
  './branchRoles': branchRoles,
})
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
// salesAnalytics reads a credit sale's balance due through the one owed helper.
const saleStatusResolutionForAnalytics = loadReal('lib/saleStatusResolution.ts', { './financialPrecision': loadReal('lib/financialPrecision.ts') })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', {
  './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision,
  './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision,
})
const removalLosses = loadReal('lib/removalLosses.ts')
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './saleStatusResolution': saleStatusResolutionForAnalytics, './schemaProbe': schemaProbeReal,
  './db': { getDb: () => db },
  './businessDateWindow': businessDateWindow,
  './reportMoneyPrecision': reportMoneyPrecision,
  './customerReturnEntitlement': customerReturnEntitlement,
  './refundMoneyPrecision': refundMoneyPrecision, './saleMoneyPrecision': saleMoneyPrecision,
  './removalLosses': removalLosses,
})
// routes/inventory.ts's per-product revenue/COGS SQL moved into this shared
// ledger (audit sibling:F14); the REAL module, so the route builds real SQL.
const productSalesLedger = loadReal('lib/productSalesLedger.ts', { './salesAnalytics': salesAnalytics })
const movementCostSnapshot = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision })

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true, product_cost_edit: true, product_cost_view: true }) }

// The list, search and dated-count endpoints' dependencies are stubbed inert:
// no check here calls them. With no settings row in this harness, the
// low-stock settings read answers the shipped default.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
// N13: the shared actor / branch kernels these routes now import.
const movementBranchNameKernel = loadReal('lib/movementBranchName.ts')
// N13: and the actor / receipt kernels the movement readers now import.
const movementActorNameKernel = loadReal('lib/movementActorName.ts')
const movementReferenceKernel = loadReal('lib/movementReference.ts')
const movementSearchKernel = loadReal('lib/movementSearch.ts', {
  './movementActorName': movementActorNameKernel,
  './movementBranchName': movementBranchNameKernel,
})
const stockCondition = loadReal('lib/stockCondition.ts')
const damagedLotActions = loadReal('lib/damagedLotActions.ts', {
  './productBatches': productBatches,
  './stockCondition': stockCondition,
  './movementCostSnapshot': loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision }),
  './returnsStock': loadReal('lib/returnsStock.ts', { './productBatches': productBatches, './stockCondition': stockCondition }),
  // readTaggedLotGroups chunks its IN(...) list through this helper (the
  // D1 bound-parameter fix); without the override the transpiled require
  // resolves against scripts/ and the whole harness dies at load time.
  './sqlBinding': sqlBinding,
})
const audits = []
const stockInSessionsQuery = loadReal('lib/stockInSessionsQuery.ts', {
  './movementActorName': movementActorNameKernel,
  './movementBranchName': movementBranchNameKernel,
  './movementReference': movementReferenceKernel,
  './businessDateWindow': businessDateWindow,
})
const stockLedgerQuery = loadReal('lib/stockLedgerQuery.ts', {
  './businessDateWindow': businessDateWindow,
  './movementBranchName': movementBranchNameKernel,
  './movementActorName': movementActorNameKernel,
  './movementReference': movementReferenceKernel,
  './stockInSessionsQuery': stockInSessionsQuery,
})
const stockRevert = loadReal('lib/stockRevert.ts', {
  // p3/supplier: the receipt allowlist the revert mirror keys off.
  './stockInSessionsQuery': stockInSessionsQuery,
  './stockLedgerQuery': stockLedgerQuery,
  './productBatches': productBatches,
  './moneyPrecision': moneyPrecision,
  './stockCondition': stockCondition,
  // Sale/return-made stock is named by its record (revert_from_sale / _from_return).
  './movementReference': movementReferenceKernel,
})

const inventoryRoute = loadReal('routes/inventory.ts', {
  '../lib/receivingBranch': loadReal('lib/receivingBranch.ts'),
  '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
  // p3/reasons: the one shared reason-length cap the route enforces.
  '../lib/stockReason': loadReal('lib/stockReason.ts'),
  '../lib/stockCondition': stockCondition,
  '../lib/damagedLotActions': damagedLotActions,
  // inventory.ts imports this TypeScript-only helper; load it through the
  // harness rather than asking Node to resolve a non-existent .js sibling.
  '../lib/transferOperationReceipt': loadReal('lib/transferOperationReceipt.ts'),
  // No check here transfers; fail loudly if one does.
  '../lib/transferOperation': { planTransferOperation: async () => { throw new Error('unrelated transfer path invoked') } },
  '../lib/branchRoleGuards': loadReal('lib/branchRoleGuards.ts', { './branchRoles': loadReal('lib/branchRoles.ts') }),
  '../lib/canonicalBranchIdentity': canonicalBranchIdentity,
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/movementBranchName': movementBranchNameKernel,
  '../lib/movementActorName': movementActorNameKernel,
  '../lib/movementReference': movementReferenceKernel,
  '../lib/movementSearch': movementSearchKernel,
  '../lib/db': { getDb: () => db },
  // The ordinary maintenance guard is REAL: its statement rides in the same
  // batch as the write and must be the actual SQL, not a stand-in.
  '../lib/businessMaintenanceGuard': loadReal('lib/businessMaintenanceGuard.ts'),
  // routes/inventory.ts buckets movement dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/salesAnalytics': salesAnalytics,
  '../lib/productSalesLedger': productSalesLedger,
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/stockReceiptGate': stockReceiptGate,
  '../lib/stockSessionMath': loadReal('lib/stockSessionMath.ts', { './moneyPrecision': moneyPrecision }),
  '../lib/schemaProbe': loadReal('lib/schemaProbe.ts'),
  // REAL, not a stub: the replay, conflict and release checks below run
  // through the per-line receipt guard.
  '../lib/stockMutationReceipt': stockMutationReceipt,
  '../lib/moneyPrecision': moneyPrecision,
  '../lib/sqlBinding': sqlBinding,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/lowStockSettings': lowStockStub,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async (_env, userId, userName, action, entity, entityId, details) => { audits.push({ userId, userName, action, entity, entityId, details }) } },
  '../lib/telegram': { sendTelegramEvent: async () => false, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/acquisitionCostAccess': acquisitionCostAccess,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productIdentity': {
    findIdentityMatch: async () => null,
    identityBarcodeKey: productDetailRule.identityBarcodeKey,
  },
  // P10-4: REAL, not stubbed -- see routes/inventory.ts's own comment above
  // recomputeCatalogCost's call site.
  '../lib/catalogCostRecompute': loadReal('lib/catalogCostRecompute.ts', {
    './db': { getDb: () => db },
    './moneyPrecision': moneyPrecision,
    './productDetailRule': productDetailRule,
  }),
  // Write-path tests: an inert search builder keeps the WHERE unfiltered.
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
  '../lib/stockRevert': stockRevert,
  '../lib/movementCostSnapshot': movementCostSnapshot,
  '../lib/moneyPrecision': moneyPrecision,
})

const app = inventoryRoute.default

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n     ${String(error && error.message || error).split('\n')[0]}`)
  } finally {
    beforeDbBatchHook = null
    afterDbBatchHook = null
    clearMovementFailure()
  }
}

const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function req(method, url, body) {
  const res = await app.request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

// ---- fixture ----------------------------------------------------------------
// Product 1 'Widget' at branch 1 'Main': `lot` units on ONE received-date lot
// (id 10, cost 2) plus `unlotted` units that ride branch_stock alone -- the
// legacy / imported shape a real shop still carries. Product 2 is the /move-row
// destination and starts empty.
const LOT_ID = 10
function seedStock({ lot = 0, unlotted = 0 } = {}) {
  rawDb.exec(`DELETE FROM damaged_stock_lots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
    DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements;
    DELETE FROM stock_mutation_receipts; DELETE FROM action_history;`)
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run({})
  rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr)
    VALUES (1, 'Widget', 'B123', 1, @total, 3, 12000)`).run({ total: lot + unlotted })
  rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr)
    VALUES (2, 'Widget relabelled', 'B124', 1, 0, 3, 12000)`).run({})
  if (lot + unlotted > 0) {
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, @q)').run({ q: lot + unlotted })
  }
  if (lot > 0) {
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, received_quantity)
      VALUES (@id, 1, '09052026', '09052026', '2026-09-05', 1, 2, @q)`).run({ id: LOT_ID, q: lot })
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@id, 1, @q)').run({ id: LOT_ID, q: lot })
    // The catalog-cost trigger (0195) may have re-derived the catalog cost
    // from the lot; the fixture wants the catalog cost it set.
    rawDb.prepare('UPDATE products SET cost_price_usd = 3 WHERE id = 1').run({})
  }
  audits.length = 0
}

const branchQty = (productId) => Number((rawDb.prepare(
  'SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = 1',
).get({ productId }) || { quantity: 0 }).quantity)
const productQty = (productId) => Number(rawDb.prepare('SELECT stock_quantity FROM products WHERE id = @productId').get({ productId }).stock_quantity)
const lotQty = (productId) => Number(rawDb.prepare(
  `SELECT COALESCE(SUM(bbs.quantity), 0) AS q FROM branch_batch_stock bbs
     JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = @productId`,
).get({ productId }).q)
// Both ledgers at once: the aggregate (branch_stock + products.stock_quantity)
// and the lot ledger.
const stateOf = (productId) => ({ branch: branchQty(productId), product: productQty(productId), lots: lotQty(productId) })
const moves = (productId, type) => rawDb.prepare(
  `SELECT * FROM inventory_movements WHERE product_id = @productId ${type ? 'AND movement_type = @type' : ''} ORDER BY id`,
).all(type ? { productId, type } : { productId })
const heldLots = (tag) => rawDb.prepare(
  `SELECT * FROM damaged_stock_lots WHERE product_id = 1 ${tag ? 'AND condition_tag = @tag' : ''} ORDER BY id`,
).all(tag ? { tag } : {})
const heldRemaining = (tag) => heldLots(tag).reduce((sum, lot) => sum + Number(lot.quantity_remaining), 0)

// The concurrent writer: runs once, immediately before the route's next
// db.batch -- i.e. after every read the route made and before its write.
function onFirstBatch(fn) {
  beforeDbBatchHook = async (items) => {
    beforeDbBatchHook = null
    await fn(items)
  }
}
// A concurrent POS sale of `quantity` units that the lot ledger did not carry.
const concurrentUnlottedSale = (quantity) => () => {
  rawDb.prepare('UPDATE branch_stock SET quantity = quantity - @q WHERE product_id = 1 AND branch_id = 1').run({ q: quantity })
  rawDb.prepare('UPDATE products SET stock_quantity = stock_quantity - @q WHERE id = 1').run({ q: quantity })
}
// A concurrent POS sale of `quantity` units out of lot 10.
const concurrentLotSale = (quantity) => () => {
  rawDb.prepare('UPDATE branch_batch_stock SET quantity = quantity - @q WHERE batch_id = @id AND branch_id = 1').run({ q: quantity, id: LOT_ID })
  concurrentUnlottedSale(quantity)()
}

// OV-6: make the movement INSERT fail, inside whatever transaction it rides.
function withMovementFailure() {
  rawDb.exec(`CREATE TEMP TRIGGER inject_movement_failure BEFORE INSERT ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'injected movement failure'); END`)
}
function clearMovementFailure() {
  rawDb.exec('DROP TRIGGER IF EXISTS temp.inject_movement_failure')
}

const REMOVE = (extra) => ({ productId: 1, type: 'remove', quantity: 1, reason: 'count fix', branchId: 1, ...extra })
const MOVE = (extra) => ({ sourceProductId: 1, destinationProductId: 2, quantity: 1, branchId: 1, reason: 'relabel', ...extra })
const TAGGED = (extra) => ({ productId: 1, branchId: 1, conditionTag: 'opened', quantity: 5, reason: 'checked', ...extra })
const hold = async (tag, quantity) => {
  const res = await req('POST', '/adjust', REMOVE({ quantity, reason: 'shelf damage', conditionTag: tag }))
  assert.equal(res.status, 200, `hold ${quantity} as ${tag}: ${JSON.stringify(res.json)}`)
}

;(async () => {
  // ====================================================================== STK-C
  await check('STK-C: removing wholly UNLOTTED stock succeeds and moves both figures once', async () => {
    seedStock({ unlotted: 5 })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 2 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 0 })
    const removed = moves(1, 'remove')
    assert.equal(removed.length, 1)
    assert.equal(Number(removed[0].quantity), 2)
    assert.equal(removed[0].batch_id, null)
  })

  await check('STK-C: "Set stock to 3" on unlotted 5 posts one remove of 2', async () => {
    seedStock({ unlotted: 5 })
    const res = await req('POST', '/adjust', { productId: 1, type: 'set', quantity: 3, reason: 'count', branchId: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 0 })
    const removed = moves(1, 'remove')
    assert.equal(removed.length, 1)
    assert.equal(Number(removed[0].quantity), 2)
    assert.match(String(removed[0].reason), /Set to 3/)
  })

  await check('STK-C: a MIXED remove (lot 3 + unlotted 2, remove 4) drains the lot, takes 1 unlotted, one movement', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 4 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 1, product: 1, lots: 0 })
    const removed = moves(1, 'remove')
    assert.equal(removed.length, 1, 'exactly one movement for one request')
    assert.equal(Number(removed[0].quantity), 4)
    assert.equal(removed[0].batch_id, null, 'no single lot owns a movement that also took unlotted units')
    assert.ok(Number(removed[0].total_cost_usd) > 0, 'the removal is valued at cost')
  })

  await check('STK-C: clearing mixed stock to zero (remove 5 of lot 3 + unlotted 2)', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 5 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 0, product: 0, lots: 0 })
    assert.equal(moves(1, 'remove').length, 1)
  })

  await check('STK-C: a TAGGED remove of mixed stock holds the units (damage_out + held lot), no remove movement', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 4, conditionTag: 'broken' }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 1, product: 1, lots: 0 })
    assert.equal(heldRemaining('broken'), 4)
    const heldMoves = moves(1, 'damage_out')
    assert.equal(heldMoves.length, 1)
    assert.equal(Number(heldMoves[0].quantity), 4)
    assert.equal(moves(1, 'remove').length, 0, 'held, not destroyed')
  })

  await check('control: a fully-lotted remove still stamps the one lot that covered it', async () => {
    seedStock({ lot: 5 })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 2 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 3 })
    const removed = moves(1, 'remove')
    assert.equal(removed.length, 1)
    assert.equal(Number(removed[0].batch_id), LOT_ID)
  })

  // ======================================================================= OV-6
  await check('OV-6: a failing movement INSERT leaves a fully-lotted remove unapplied (both ledgers)', async () => {
    seedStock({ lot: 5 })
    withMovementFailure()
    const res = await req('POST', '/adjust', REMOVE({ quantity: 2 }))
    clearMovementFailure()
    assert.ok(res.status >= 400, `refused, got ${res.status}`)
    assert.deepEqual(stateOf(1), { branch: 5, product: 5, lots: 5 }, 'no stock left without its movement')
    assert.equal(moves(1).length, 0)
  })

  await check('OV-6: a failing movement INSERT leaves a MIXED remove unapplied (no lot drained behind an error)', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    withMovementFailure()
    const res = await req('POST', '/adjust', REMOVE({ quantity: 4 }))
    clearMovementFailure()
    assert.ok(res.status >= 400, `refused, got ${res.status}`)
    assert.deepEqual(stateOf(1), { branch: 5, product: 5, lots: 3 })
    assert.equal(moves(1).length, 0)
  })

  await check('OV-6: a failing hold movement leaves a TAGGED mixed remove unapplied (no held lot, no drain)', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    withMovementFailure()
    const res = await req('POST', '/adjust', REMOVE({ quantity: 4, conditionTag: 'broken' }))
    clearMovementFailure()
    assert.ok(res.status >= 400, `refused, got ${res.status}`)
    assert.deepEqual(stateOf(1), { branch: 5, product: 5, lots: 3 })
    assert.equal(heldLots().length, 0)
  })

  // ================================================================= the races
  await check('race: 2 unlotted units sold after the read -> 409, nothing removed (kills the MAX(0) clamp fix)', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    onFirstBatch(concurrentUnlottedSale(2))
    const res = await req('POST', '/adjust', REMOVE({ quantity: 4 }))
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json?.code, 'stock_removal_conflict')
    // Only the concurrent sale's effect: 3 left, all of it the lot.
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 3 })
    assert.equal(moves(1).length, 0)
  })

  await check('race: the branch_stock row vanished after the read -> 409, the lot is untouched', async () => {
    seedStock({ lot: 5 })
    onFirstBatch(() => { rawDb.prepare('DELETE FROM branch_stock WHERE product_id = 1').run({}) })
    const res = await req('POST', '/adjust', REMOVE({ quantity: 2 }))
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json?.code, 'stock_removal_conflict')
    assert.equal(lotQty(1), 5)
    assert.equal(moves(1).length, 0)
  })

  await check('receipt: a conflicted remove RELEASES its claim -- the same id retries, never "partially applied"', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    onFirstBatch(concurrentUnlottedSale(2))
    const first = await req('POST', '/adjust', REMOVE({ quantity: 4, client_request_id: 'stkc-release-0001' }))
    assert.equal(first.status, 409, JSON.stringify(first.json))
    assert.equal(first.json?.code, 'stock_removal_conflict')
    const retry = await req('POST', '/adjust', REMOVE({ quantity: 4, client_request_id: 'stkc-release-0001' }))
    assert.notEqual(retry.json?.code, 'stock_request_partially_applied', 'nothing was written, so nothing is partial')
    assert.equal(retry.status, 400, JSON.stringify(retry.json))
    assert.match(String(retry.json?.error || ''), /only 3 available/)
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 3 })
  })

  await check('receipt: a mixed remove with a client_request_id replays instead of removing twice', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    const first = await req('POST', '/adjust', REMOVE({ quantity: 4, client_request_id: 'stkc-replay-0001' }))
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const again = await req('POST', '/adjust', REMOVE({ quantity: 4, client_request_id: 'stkc-replay-0001' }))
    assert.equal(again.status, 200, JSON.stringify(again.json))
    assert.equal(again.json?.replayed, true)
    assert.deepEqual(stateOf(1), { branch: 1, product: 1, lots: 0 })
    assert.equal(moves(1, 'remove').length, 1)
  })

  // ================================================================= /move-row
  await check('/move-row: a mixed source (lot 3 + unlotted 2) moves 4 -- both products, both ledgers, both movements', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    const res = await req('POST', '/move-row', MOVE({ quantity: 4 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 1, product: 1, lots: 0 })
    assert.deepEqual(stateOf(2), { branch: 4, product: 4, lots: 4 })
    const out = moves(1, 'move_out')
    const into = moves(2, 'move_in')
    assert.equal(out.length, 1)
    assert.equal(into.length, 1)
    assert.equal(Number(out[0].quantity), 4)
    assert.equal(Number(into[0].quantity), 4)
    assert.equal(out[0].batch_id, null)
    const destLot = rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 2').get({})
    assert.equal(Number(into[0].batch_id), Number(destLot.id), 'move_in is stamped with the lot it landed on')
  })

  await check('/move-row: a wholly unlotted source moves 2', async () => {
    seedStock({ unlotted: 5 })
    const res = await req('POST', '/move-row', MOVE({ quantity: 2 }))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(stateOf(1), { branch: 3, product: 3, lots: 0 })
    assert.deepEqual(stateOf(2), { branch: 2, product: 2, lots: 2 })
  })

  await check('/move-row: units sold from the source lot after the read -> 409, the destination is NOT credited (phantom units)', async () => {
    seedStock({ lot: 3 })
    onFirstBatch(concurrentLotSale(2))
    const res = await req('POST', '/move-row', MOVE({ quantity: 3 }))
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json?.code, 'stock_removal_conflict')
    assert.deepEqual(stateOf(1), { branch: 1, product: 1, lots: 1 })
    assert.deepEqual(stateOf(2), { branch: 0, product: 0, lots: 0 }, 'no units created from nothing')
    assert.equal(moves(1).length + moves(2).length, 0)
  })

  await check('/move-row: a failing movement INSERT moves nothing', async () => {
    seedStock({ lot: 3, unlotted: 2 })
    withMovementFailure()
    const res = await req('POST', '/move-row', MOVE({ quantity: 4 }))
    clearMovementFailure()
    assert.ok(res.status >= 400, `refused, got ${res.status}`)
    assert.deepEqual(stateOf(1), { branch: 5, product: 5, lots: 3 })
    assert.deepEqual(stateOf(2), { branch: 0, product: 0, lots: 0 })
  })

  // ====================================================================== STK-D
  await check('STK-D: held units consumed after the read -> Restore is 409 and credits nothing', async () => {
    seedStock({ lot: 5 })
    await hold('opened', 5)
    assert.deepEqual(stateOf(1), { branch: 0, product: 0, lots: 0 })
    onFirstBatch(() => { rawDb.prepare('UPDATE damaged_stock_lots SET quantity_remaining = 0').run({}) })
    const res = await req('POST', '/tagged-lots/restore', TAGGED())
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json?.code, 'tagged_lot_conflict')
    assert.deepEqual(stateOf(1), { branch: 0, product: 0, lots: 0 }, 'no sellable units restored from an empty held lot')
    assert.equal(moves(1, 'in').length, 0)
  })

  await check('STK-D: held units consumed after the read -> Dispose is 409 and books no loss', async () => {
    seedStock({ lot: 5 })
    await hold('broken', 5)
    onFirstBatch(() => { rawDb.prepare('UPDATE damaged_stock_lots SET quantity_remaining = 0').run({}) })
    const res = await req('POST', '/tagged-lots/dispose', TAGGED({ conditionTag: 'broken' }))
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json?.code, 'tagged_lot_conflict')
    assert.equal(moves(1, 'write_off').length, 0)
  })

  await check('STK-D: a Restore with a client_request_id replays instead of restoring twice', async () => {
    seedStock({ lot: 5 })
    await hold('opened', 5)
    const first = await req('POST', '/tagged-lots/restore', TAGGED({ client_request_id: 'stkd-restore-0001' }))
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const again = await req('POST', '/tagged-lots/restore', TAGGED({ client_request_id: 'stkd-restore-0001' }))
    assert.equal(again.status, 200, JSON.stringify(again.json))
    assert.equal(again.json?.replayed, true)
    assert.deepEqual(stateOf(1), { branch: 5, product: 5, lots: 5 })
    assert.equal(moves(1, 'in').length, 1)
  })

  await check('STK-D: the same id with a different quantity is refused (409 idempotency_conflict)', async () => {
    seedStock({ lot: 5 })
    await hold('opened', 5)
    const first = await req('POST', '/tagged-lots/restore', TAGGED({ quantity: 2, client_request_id: 'stkd-diff-0001' }))
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const other = await req('POST', '/tagged-lots/restore', TAGGED({ quantity: 3, client_request_id: 'stkd-diff-0001' }))
    assert.equal(other.status, 409, JSON.stringify(other.json))
    assert.equal(other.json?.code, 'idempotency_conflict')
    assert.equal(branchQty(1), 2)
  })

  await check('STK-D: a conflicted Restore RELEASES its claim (the write mark rides the aborted batch)', async () => {
    seedStock({ lot: 5 })
    await hold('expired', 5)
    onFirstBatch(() => { rawDb.prepare('UPDATE damaged_stock_lots SET quantity_remaining = 0').run({}) })
    const first = await req('POST', '/tagged-lots/restore', TAGGED({ conditionTag: 'expired', client_request_id: 'stkd-release-0001' }))
    assert.equal(first.status, 409, JSON.stringify(first.json))
    assert.equal(first.json?.code, 'tagged_lot_conflict')
    const retry = await req('POST', '/tagged-lots/restore', TAGGED({ conditionTag: 'expired', client_request_id: 'stkd-release-0001' }))
    assert.notEqual(retry.json?.code, 'stock_request_partially_applied', 'nothing was written, so nothing is partial')
    assert.equal(retry.status, 400, JSON.stringify(retry.json))
    assert.match(String(retry.json?.error || ''), /held/)
    assert.deepEqual(stateOf(1), { branch: 0, product: 0, lots: 0 })
  })

  await check('STK-D: Dispose with a client_request_id books the loss once across a retry', async () => {
    seedStock({ lot: 5 })
    await hold('broken', 5)
    const first = await req('POST', '/tagged-lots/dispose', TAGGED({ conditionTag: 'broken', client_request_id: 'stkd-dispose-0001' }))
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const again = await req('POST', '/tagged-lots/dispose', TAGGED({ conditionTag: 'broken', client_request_id: 'stkd-dispose-0001' }))
    assert.equal(again.status, 200, JSON.stringify(again.json))
    assert.equal(again.json?.replayed, true)
    assert.equal(moves(1, 'write_off').length, 1)
    assert.equal(heldRemaining('broken'), 0)
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    for (const name of failures) console.log(`  RED: ${name}`)
    process.exit(1)
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
