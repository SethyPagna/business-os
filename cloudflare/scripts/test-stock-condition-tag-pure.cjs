// P3-L6 contract: TAGGED (held, non-sellable) stock -- the owner's "keep in
// group with tag or remove entirely" choice, "Restock with tag", and the two
// row actions that lead back out of the held state.
//
// The transition table this file pins. S = sellable (branch_stock +
// products.stock_quantity), H = held (damaged_stock_lots.quantity_remaining):
//
//   HOLD (remove, tagged)     S -q   H +q   movement damage_out   NOT a loss
//   REMOVE ENTIRELY (untagged) S -q   H  0   movement remove       loss, at cost
//   HOLD (add, tagged)        S  0   H +q   receipt add + damage_out
//   DISPOSE a held row        S  0   H -q   movement write_off    loss, at cost
//   RESTORE a held row        S +q   H -q   movement in
//
// The two things that would quietly cost money, and are therefore asserted
// rather than assumed:
//
//   * DOUBLE COUNTING. Holding is not a loss; the loss is booked once, at
//     disposal. If both damage_out and write_off were counted, a
//     keep-then-dispose of one unit would be charged to the business twice.
//   * DOUBLE APPLYING. Every held-row action is allocated against the lots
//     actually open at that moment, so a stale page (or a double-click) that
//     replays a dispose/restore is refused outright instead of over-drawing.
//
// Same harness as scripts/test-adjust-received-date-pure.cjs: the REAL route,
// the REAL kernels, the REAL migrations on an in-memory SQLite database, and
// the app driven through app.request() exactly as the Worker would. The
// supplier-visibility check reads through routes/contacts.ts's own purchase
// SQL, the same way scripts/test-supplier-mirror-writers-pure.cjs does, so
// "the supplier still sees the purchase" is proven against the shipped reader
// rather than a hand-written query that agrees with the writer.
//
// Run (from cloudflare/): node scripts/test-stock-condition-tag-pure.cjs

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
    const rawResults = await rawDb.batch(items)
    const results = rawResults.map((r) => ({
      changes: r.meta?.changes ?? 0,
      lastInsertRowid: Number(r.meta?.last_row_id ?? 0),
    }))
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

// The REAL date->code module: the route's own validation (normalizeToIsoDate)
// and the assertions below (dateToBatchCode) must be the same code the
// kernel derives lot codes with -- a stub would test the stub.
const batchCode = loadReal('lib/batchCode.ts')
// N14-D: routes/inventory.ts now enforces the shared receipt gate, so the
// real module has to be in the stub map like every other real dependency.
const stockReceiptGate = loadReal('lib/stockReceiptGate.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './moneyPrecision': moneyPrecision, './sqlBinding': sqlBinding })
const productDetailRule = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
const permissions = loadReal('lib/permissions.ts')
const acquisitionCostAccess = loadReal('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const branchRoles = loadReal('lib/branchRoles.ts')
const canonicalBranchIdentity = loadReal('lib/canonicalBranchIdentity.ts', {
  './db': loadReal('lib/db.ts'),
  './branchRoles': branchRoles,
})
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', {
  './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision,
  './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision,
})
// P3-losses-writeoff: salesAnalytics.ts pulls in removalLosses.ts (p3/losses)
// -- a merge-time wiring gap left this override out, which died at load time
// for EVERY check in this file, not just the ones this lane touches.
// removalLosses.ts is deliberately import-free (see its own header), so it
// loads with no overrides of its own.
const removalLosses = loadReal('lib/removalLosses.ts')
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal,
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
// routes/batches.ts imports the shared optimistic-locking helpers; without
// this override the transpiled module's './conflictControl' require resolves
// against scripts/ and the whole test file dies at load time.
const conflictControl = loadReal('lib/conflictControl.ts')
const movementCostSnapshot = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyPrecision })

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true, product_cost_edit: true, product_cost_view: true }) }

// Only the /adjust path is driven here -- the list/search/dated-count
// endpoints' dependencies are stubbed inert (never called by these checks).
// Sep 6 2026: the owner's low-stock alert setting reaches this module through
// lib/lowStockSettings.ts. The SQL builder is the REAL one -- the clauses
// asserted below are the ones it composes -- while the settings READ answers
// the shipped default, there being no settings row in this harness. The rule
// itself is proven in scripts/test-low-stock-settings-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

// N13: the shared actor / branch kernels these routes now import.
const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
// N13: the shared actor / branch kernels these routes now import.
const movementBranchNameKernel = loadReal('lib/movementBranchName.ts')
// N13: and the actor / receipt kernels the movement readers now import.
const movementActorNameKernel = loadReal('lib/movementActorName.ts')
const movementReferenceKernel = loadReal('lib/movementReference.ts')
// N13 (round 2): the /movements search haystack is built from those same two
// expressions, so the route imports the haystack kernel too.
// P3-L6: deleting a product has to take its HELD units with it and give them
// back on undo. productDelete.ts only builds statements, so it is driven here
// exactly as routes/products.ts and lib/undoAppliers.ts drive it.
const productDelete = loadReal('lib/productDelete.ts', { './actorSnapshot': actorSnapshotKernel })
const movementSearchKernel = loadReal('lib/movementSearch.ts', {
  './movementActorName': movementActorNameKernel,
  './movementBranchName': movementBranchNameKernel,
})
// P3-L6: routes/inventory.ts imports the tagged-stock kernel, so this
// loader has to resolve it too (the paths under test never tag anything;
// they just have to import).
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
// The REAL ledger revert. Its refusal of a damaged_lot: movement is one of
// the contracts under test, and a stub would agree with itself.
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
})

const inventoryRoute = loadReal('routes/inventory.ts', {
  // p3/reasons: the one shared reason-length cap the route enforces.
  '../lib/stockReason': loadReal('lib/stockReason.ts'),
  '../lib/stockCondition': stockCondition,
  '../lib/damagedLotActions': damagedLotActions,
  // inventory.ts imports this TypeScript-only helper; load it through the
  // harness rather than asking Node to resolve a non-existent .js sibling.
  '../lib/transferOperationReceipt': loadReal('lib/transferOperationReceipt.ts'),
  // This contract exercises receive/adjust; fail loudly on accidental transfer.
  '../lib/transferOperation': { planTransferOperation: async () => { throw new Error('unrelated transfer path invoked') } },
  // REAL, not stubbed: POST /inventory/transfer now refuses a shop -> warehouse
  // move through this guard, so the fixtures here run through the rejection
  // instead of opting out of it.
  '../lib/branchRoleGuards': loadReal('lib/branchRoleGuards.ts', { './branchRoles': loadReal('lib/branchRoles.ts') }),
  '../lib/canonicalBranchIdentity': canonicalBranchIdentity,
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/movementBranchName': movementBranchNameKernel,
  '../lib/movementActorName': movementActorNameKernel,
  '../lib/movementReference': movementReferenceKernel,
  '../lib/movementSearch': movementSearchKernel,
  '../lib/db': { getDb: () => db },
  // routes/inventory.ts buckets movement dates in UTC+7 through the pure
  // businessDateWindow helpers; provide the real module so its date SQL resolves.
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/salesAnalytics': salesAnalytics,
  '../lib/productSalesLedger': productSalesLedger,
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/stockReceiptGate': stockReceiptGate,
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
  // identityBarcodeKey is the REAL fold, not a stub: the add-stock 'same
  // barcode means the SOURCE row' rule is exactly what this file exercises,
  // and stubbing the comparison would make the test agree with itself.
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
  // routes/products.ts + inventory.ts now build their search tail from the
  // one shared implementation (lib/productSearchQuery.ts). These tests
  // exercise write paths, not search, so an inert builder keeps the WHERE
  // unfiltered exactly as the searchMatch stubs above already did.
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
  // Part 553 added the movement-revert path to inventory.ts; these tests
  // exercise receive/adjust, not revert, so an empty stub is honest (the type
  // import is compile-erased, only applyMovementRevert needs a runtime stub).
  '../lib/stockRevert': stockRevert,
  '../lib/movementCostSnapshot': movementCostSnapshot,
  '../lib/moneyPrecision': moneyPrecision,
})

const app = inventoryRoute.default

// ---- the shipped supplier readers, not a hand-written copy ----------------
// Same extraction scripts/test-supplier-mirror-writers-pure.cjs uses: if
// contacts.ts stops shaping its purchase query this way the extraction fails
// loudly rather than silently proving nothing.
const contactsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8').replace(/\r\n/g, '\n')
const supplierWhereMatch = contactsSource.match(/const supplierWhere = `(\([\s\S]*?\))`/)
const totalsMatch = contactsSource.match(/const totalsRow = await db\.prepare\(`([\s\S]*?)`\)\.get/)
assert.ok(supplierWhereMatch && totalsMatch, 'contacts.ts still defines supplierWhere and the purchase totals query')
const PURCHASE_TOTALS_SQL = totalsMatch[1]
  // P3-10 (contacts lane) filters the totals by the Start->End range; with no
  // range set purchasesWhere IS supplierWhere, so both spellings resolve to it.
  .replace('${purchasesWhere}', supplierWhereMatch[1]).replace('${supplierWhere}', supplierWhereMatch[1])
assert.ok(!PURCHASE_TOTALS_SQL.includes('${'), 'the purchase totals query was extracted whole -- no template placeholder survived')
const SUPPLIER = { id: 41, name: 'Acme Supply' }

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
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

function seed() {
  rawDb.exec(`DELETE FROM damaged_stock_lots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
    DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements;
    DELETE FROM suppliers; DELETE FROM action_history;`)
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDb.prepare("INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr) VALUES (1, 'Widget', 'B123', 1, 0, 3, 12000)").run()
  rawDb.prepare('INSERT INTO suppliers (id, name) VALUES (@id, @name)').run({ id: SUPPLIER.id, name: SUPPLIER.name })
  audits.length = 0
}

// ---- readers over the two ledgers this feature moves ----------------------
const sellable = () => ({
  product: Number(rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get({}).stock_quantity),
  branch: Number((rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get({}) || { quantity: 0 }).quantity),
})
const heldLots = (tag) => rawDb.prepare(
  `SELECT * FROM damaged_stock_lots WHERE product_id = 1 ${tag ? 'AND condition_tag = @tag' : ''} ORDER BY id`,
).all(tag ? { tag } : {})
const movements = (type) => rawDb.prepare(
  `SELECT * FROM inventory_movements WHERE product_id = 1 ${type ? 'AND movement_type = @type' : ''} ORDER BY id`,
).all(type ? { type } : {})
// Stock lives in TWO ledgers here: the aggregate (branch_stock +
// products.stock_quantity) and the lot ledger (branch_batch_stock). A
// transition that moves one and not the other shows up later as "7 here, 0
// there", so the reversal is checked against both.
const lotLedger = () => Number(rawDb.prepare(
  'SELECT COALESCE(SUM(bbs.quantity), 0) AS q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = 1',
).get({}).q)

const purchaseTotals = () => {
  const row = rawDb.prepare(PURCHASE_TOTALS_SQL).get({ id: SUPPLIER.id, name: SUPPLIER.name.toLowerCase() })
  return {
    batches: Number(row.batches) || 0,
    units: Number(row.units_received) || 0,
    cost: Math.round((Number(row.cost_usd) || 0) * 100) / 100,
  }
}

// Every stock-in goes through the shared receipt gate, which requires the
// supplier the goods came from -- tagged or not.
const ADD = (extra) => ({
  productId: 1, type: 'add', quantity: 10, reason: 'opening', branchId: 1, unitCostUsd: 2,
  supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, paymentStatus: 'paid', ...extra,
})

;(async () => {
  // ------------------------------------------------------------------ HOLD
  await check('keep-in-group: units leave sellable, land on a tagged lot, and the movement is damage_out with cost', async () => {
    seed()
    assert.equal((await req('POST', '/adjust', ADD())).status, 200)
    assert.deepEqual(sellable(), { product: 10, branch: 10 })

    const res = await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 3, reason: 'dropped in transit', branchId: 1, conditionTag: 'broken' })
    assert.equal(res.status, 200)

    // S -3
    assert.deepEqual(sellable(), { product: 7, branch: 7 })

    // H +3, carrying the cost the units were valued at.
    const lots = heldLots('broken')
    assert.equal(lots.length, 1)
    assert.equal(Number(lots[0].quantity), 3)
    assert.equal(Number(lots[0].quantity_remaining), 3)
    assert.equal(lots[0].source, 'remove')
    assert.equal(lots[0].reason, 'dropped in transit')
    assert.ok(Number(lots[0].unit_cost_usd) > 0, 'held lot carries the unit cost it was valued at')
    assert.equal(Number(lots[0].created_by_user_id), 1)

    // ONE damage_out movement, with both cost columns filled.
    const held = movements('damage_out')
    assert.equal(held.length, 1, 'exactly one hold movement per call -- the transition is applied once')
    assert.equal(Number(held[0].quantity), 3)
    assert.ok(Number(held[0].unit_cost_usd) > 0)
    assert.ok(Number(held[0].total_cost_usd) > 0)
    assert.equal(Math.round(Number(held[0].total_cost_usd) * 100) / 100, Math.round(Number(held[0].unit_cost_usd) * 3 * 100) / 100)
    // The tag is in the reason text, in English, for the ledger surfaces.
    assert.equal(held[0].reason, 'broken: dropped in transit')
    assert.equal(held[0].branch_name, 'Main')
    assert.equal(held[0].user_name, 'tester')

    // And NOT a loss: no destruction movement was written alongside it.
    assert.equal(movements('remove').length, 0)
    assert.equal(movements('write_off').length, 0)
  })

  await check('a tagged removal writes no action_history, so no undo can claim to reverse it', async () => {
    // POST /adjust records no action_history at all. That is the honest state
    // for this transition: the reversal is the held row's own Restore, which
    // moves BOTH ledgers. An undo_payload that only re-added sellable stock
    // would leave the held row standing and duplicate the units.
    assert.equal(Number(rawDb.prepare('SELECT COUNT(*) AS n FROM action_history').get({}).n), 0)
  })

  // -------------------------------------------------------- remove entirely
  await check('remove entirely: the movement carries cost, so it can be counted as a loss', async () => {
    const before = sellable()
    const res = await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 2, reason: 'thrown away', branchId: 1 })
    assert.equal(res.status, 200)
    assert.deepEqual(sellable(), { product: before.product - 2, branch: before.branch - 2 })

    const removals = movements('remove')
    assert.equal(removals.length, 1)
    assert.ok(Number(removals[0].unit_cost_usd) > 0, 'a direct removal is valued at cost -- it is a loss')
    assert.ok(Number(removals[0].total_cost_usd) > 0)
    // Nothing was kept: no new held row.
    assert.equal(heldLots().length, 1)
  })

  await check('an unknown tag is refused, and nothing moves', async () => {
    const before = sellable()
    const lotsBefore = heldLots().length
    const movesBefore = movements().length
    for (const tag of ['smashed', 'lost', 'broken-ish', 'ខូច', 123]) {
      const res = await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 1, reason: 'x', branchId: 1, conditionTag: tag })
      assert.equal(res.status, 400, `tag ${JSON.stringify(tag)} must be refused`)
      assert.ok(String(res.json?.error || '').length > 0)
    }
    assert.deepEqual(sellable(), before)
    assert.equal(heldLots().length, lotsBefore)
    assert.equal(movements().length, movesBefore, 'a refused tag writes no ledger line')
  })

  await check('a tag is normalised, not guessed at: case and padding only', async () => {
    // The wire value is normalised so a hand-rolled API call is not refused
    // over whitespace, but nothing is FUZZY-matched -- a near-miss stays a
    // 400 above rather than being filed under the wrong tag.
    const res = await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 1, reason: 'case test', branchId: 1, conditionTag: ' BROKEN ' })
    assert.equal(res.status, 200)
    const lots = heldLots('broken')
    assert.equal(lots.length, 2)
    assert.equal(lots[1].condition_tag, 'broken')
    assert.equal(movements('damage_out').slice(-1)[0].reason, 'broken: case test')
  })
  await check('a set cannot be tagged: it has no quantity of its own to hold', async () => {
    const before = sellable()
    const res = await req('POST', '/adjust', { productId: 1, type: 'set', quantity: 20, reason: 'count', branchId: 1, conditionTag: 'damaged' })
    assert.equal(res.status, 400)
    assert.deepEqual(sellable(), before)
  })

  // --------------------------------------------------------------- RESTOCK
  await check('restock with a tag: held, not sellable -- and the supplier still sees the purchase', async () => {
    seed()
    assert.deepEqual(purchaseTotals(), { batches: 0, units: 0, cost: 0 })

    const res = await req('POST', '/adjust', ADD({
      quantity: 5,
      unitCostUsd: 4,
      conditionTag: 'damaged',
      reason: 'arrived crushed',
      supplierId: SUPPLIER.id,
      supplierName: SUPPLIER.name,
      paymentStatus: 'credit',
      creditDueDate: '2026-12-31',
    }))
    assert.equal(res.status, 200)

    // S unchanged: received and immediately held, never sellable.
    assert.deepEqual(sellable(), { product: 0, branch: 0 })

    // H +5 at the receipt cost.
    const lots = heldLots('damaged')
    assert.equal(lots.length, 1)
    assert.equal(Number(lots[0].quantity_remaining), 5)
    assert.equal(lots[0].source, 'restock')
    assert.equal(Number(lots[0].unit_cost_usd), 4)

    // The purchase reached the supplier ledger through the UNCHANGED receipt
    // writer (the mirror's W3), read here through contacts.ts's own SQL.
    assert.deepEqual(purchaseTotals(), { batches: 1, units: 5, cost: 20 })
    const lot = rawDb.prepare('SELECT * FROM product_batches WHERE variant_product_id = 1 ORDER BY id DESC').get({})
    assert.equal(Number(lot.supplier_id), SUPPLIER.id)
    assert.equal(lot.payment_status, 'credit')
    assert.equal(Number(lot.received_quantity), 5)

    // The ledger tells the honest story: goods arrived, then were held.
    assert.equal(movements('add').length, 1)
    const heldMoves = movements('damage_out')
    assert.equal(heldMoves.length, 1)
    assert.equal(Number(heldMoves[0].quantity), 5)
    assert.equal(heldMoves[0].reason, 'damaged: arrived crushed')
    assert.ok(Number(heldMoves[0].total_cost_usd) > 0)
    // Still not a loss at this point.
    assert.equal(movements('write_off').length, 0)
  })

  // --------------------------------------------------------------- DISPOSE
  await check('dispose a held row: the loss is booked once, at cost, and sellable stock does not move again', async () => {
    const before = sellable()
    const lotId = Number(heldLots('damaged')[0].id)
    const res = await req('POST', '/tagged-lots/dispose', { productId: 1, branchId: 1, conditionTag: 'damaged', quantity: 5, reason: 'binned' })
    assert.equal(res.status, 200)

    // H -5 ...
    assert.equal(Number(heldLots('damaged')[0].quantity_remaining), 0)
    // ... and S UNTOUCHED: the units left sellable when they were held. This
    // is the double-count guard -- deducting again here would charge the
    // business twice for one unit.
    assert.deepEqual(sellable(), before)

    const writeOffs = movements('write_off')
    assert.equal(writeOffs.length, 1)
    assert.equal(Number(writeOffs[0].quantity), 5)
    assert.equal(Number(writeOffs[0].unit_cost_usd), 4, 'the loss is booked at what the goods cost, not at the catalog price')
    assert.equal(Number(writeOffs[0].total_cost_usd), 20)
    assert.equal(writeOffs[0].reason, 'damaged: binned')
    assert.equal(writeOffs[0].reference_id, `damaged_lot:${lotId}`)
    assert.equal(writeOffs[0].branch_name, 'Main')
    assert.equal(writeOffs[0].user_name, 'tester')
    assert.ok(audits.some((entry) => entry.action === 'stock_tagged_dispose'))
  })

  await check('disposing the same held row twice is refused outright, not partially applied', async () => {
    const beforeMoves = movements().length
    const res = await req('POST', '/tagged-lots/dispose', { productId: 1, branchId: 1, conditionTag: 'damaged', quantity: 5, reason: 'binned again' })
    assert.equal(res.status, 400)
    assert.match(String(res.json?.error || ''), /held/i)
    assert.equal(movements().length, beforeMoves, 'a refused replay writes nothing')
    assert.equal(Number(heldLots('damaged')[0].quantity_remaining), 0)
  })

  await check('a dispose larger than what is held is refused whole, never partially', async () => {
    seed()
    assert.equal((await req('POST', '/adjust', ADD())).status, 200)
    assert.equal((await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 4, reason: 'cracked', branchId: 1, conditionTag: 'expired' })).status, 200)
    const res = await req('POST', '/tagged-lots/dispose', { productId: 1, branchId: 1, conditionTag: 'expired', quantity: 5, reason: 'clear out' })
    assert.equal(res.status, 400)
    assert.equal(Number(heldLots('expired')[0].quantity_remaining), 4, 'the held row is untouched by a refused request')
    assert.equal(movements('write_off').length, 0)
  })

  // --------------------------------------------------------------- RESTORE
  await check('restore to sellable is the exact reversal of having kept the units', async () => {
    // Baseline BEFORE the hold, so the reversal can be checked against it.
    seed()
    assert.equal((await req('POST', '/adjust', ADD())).status, 200)
    const baseline = sellable()
    const baselineLots = lotLedger()

    assert.equal((await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 4, reason: 'shelf damage', branchId: 1, conditionTag: 'opened' })).status, 200)
    assert.deepEqual(sellable(), { product: baseline.product - 4, branch: baseline.branch - 4 })
    const lotId = Number(heldLots('opened')[0].id)

    const res = await req('POST', '/tagged-lots/restore', { productId: 1, branchId: 1, conditionTag: 'opened', quantity: 4, reason: 'cleaned up, fine to sell' })
    assert.equal(res.status, 200)

    // Both ledgers back exactly where they started -- the aggregate AND the
    // lot ledger, so the two cannot silently fork.
    assert.deepEqual(sellable(), baseline)
    assert.equal(lotLedger(), baselineLots)
    assert.equal(Number(heldLots('opened')[0].quantity_remaining), 0)

    const restores = movements('in')
    assert.equal(restores.length, 1)
    assert.equal(Number(restores[0].quantity), 4)
    assert.equal(restores[0].reason, 'opened: cleaned up, fine to sell')
    assert.equal(restores[0].reference_id, `damaged_lot:${lotId}`)
    assert.ok(audits.some((entry) => entry.action === 'stock_tagged_restore'))
    // A restore is not a loss.
    assert.equal(movements('write_off').length, 0)
  })

  await check('restoring the same held row twice is refused, so sellable stock cannot be inflated', async () => {
    const before = sellable()
    const res = await req('POST', '/tagged-lots/restore', { productId: 1, branchId: 1, conditionTag: 'opened', quantity: 4, reason: 'again' })
    assert.equal(res.status, 400)
    assert.deepEqual(sellable(), before, 'a replayed restore adds nothing')
    assert.equal(movements('in').length, 1)
  })

  // ------------------------------------------------- the ledger revert gate
  await check('the ledger revert refuses a movement that belongs to a held row', async () => {
    // 'in' IS on stockRevert's allowlist. Without the damaged_lot: marker a
    // restore could be reverted from the Stock Change ledger, taking the
    // units back out of sellable stock while quantity_remaining stayed at 0 --
    // the units would exist in neither ledger.
    const restore = movements('in')[0]
    const outcome = await stockRevert.applyMovementRevert(db, restore)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.status, 400)
    assert.match(String(outcome.error || ''), /tagged/i)
    // And the hold itself is not revertible either (damage_out is not on the
    // allowlist), so neither half of the transition can be undone by the
    // ledger's generic revert.
    const hold = movements('damage_out')[0]
    const holdOutcome = await stockRevert.applyMovementRevert(db, hold)
    assert.equal(holdOutcome.ok, false)
  })

  // ------------------------------------------------------------ the reader
  await check('the tagged-lots read groups by product, tag and branch, and drops exhausted rows', async () => {
    seed()
    assert.equal((await req('POST', '/adjust', ADD({ quantity: 12 }))).status, 200)
    for (const [tag, quantity] of [['broken', 2], ['broken', 3], ['expired', 1]]) {
      assert.equal((await req('POST', '/adjust', { productId: 1, type: 'remove', quantity, reason: `${tag} batch`, branchId: 1, conditionTag: tag })).status, 200)
    }
    const res = await req('GET', '/tagged-lots?productIds=1')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.items.map((item) => [item.condition_tag, item.quantity, item.lot_count, item.branch_name]), [
      ['broken', 5, 2, 'Main'],
      ['expired', 1, 1, 'Main'],
    ])

    // Once a tag's held quantity reaches zero the row disappears from the
    // product group rather than lingering as a "0 broken" line.
    assert.equal((await req('POST', '/tagged-lots/dispose', { productId: 1, branchId: 1, conditionTag: 'broken', quantity: 5, reason: 'binned' })).status, 200)
    const after = await req('GET', '/tagged-lots?productIds=1')
    assert.deepEqual(after.json.items.map((item) => item.condition_tag), ['expired'])

    // And the held units were never part of sellable stock: 12 in, 6 held out.
    assert.deepEqual(sellable(), { product: 6, branch: 6 })
  })

  // P3-L6 (bound-parameter fix): D1 refuses any statement bound with more
  // than 100 parameters (lib/sqlBinding.ts). A server page of products (up
  // to 100) plus pinned recently-edited rows routinely asks GET
  // /tagged-lots for just over 100 ids, so readTaggedLotGroups has to chunk
  // its `product_id IN (...)` itself rather than binding the whole id list
  // in one statement. Driven directly (not through the route, which merely
  // caps the id count) with an instrumented db that counts bound
  // parameters per statement -- the same class of check
  // test-d1-bound-params-repro.cjs runs, but against this reader's own SQL.
  await check('readTaggedLotGroups chunks a 151-id read and never binds more than 100 parameters per statement', async () => {
    seed()
    const returnsStockForCheck = loadReal('lib/returnsStock.ts', { './productBatches': productBatches, './stockCondition': stockCondition })
    // seed() already inserted product id 1; add 150 more (2..151) so the
    // read has to cover 151 ids total -- one more than one unchunked
    // IN(...) can bind.
    const ids = [1]
    const lotStatements = [returnsStockForCheck.createDamagedLotStatement({
      productId: 1, productName: 'Widget', branchId: 1, batchId: null, returnIdSql: 'NULL',
      quantity: 1, reason: 'seed', userId: 1, userName: 'tester', conditionTag: 'broken', source: 'remove', unitCostUsd: 1,
    })]
    for (let i = 2; i <= 151; i++) {
      rawDb.prepare(`INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr)
        VALUES (@id, @name, @barcode, 1, 0, 3, 12000)`).run({ id: i, name: `Widget ${i}`, barcode: `TAG${i}` })
      lotStatements.push(returnsStockForCheck.createDamagedLotStatement({
        productId: i, productName: `Widget ${i}`, branchId: 1, batchId: null, returnIdSql: 'NULL',
        quantity: 1, reason: 'seed', userId: 1, userName: 'tester', conditionTag: 'broken', source: 'remove', unitCostUsd: 1,
      }))
      ids.push(i)
    }
    await db.batch(lotStatements)

    const boundCounts = []
    const countingDb = {
      prepare(sql) {
        const bound = (sql.match(/@\w+/g) || []).length
        const real = db.prepare(sql)
        return {
          get: (params) => real.get(params),
          all: (params) => { boundCounts.push(bound); return real.all(params) },
          run: (params) => real.run(params),
        }
      },
    }
    const groups = await damagedLotActions.readTaggedLotGroups(countingDb, ids)

    assert.ok(boundCounts.length >= 2, 'a 151-id read must run more than one chunked statement, not one unchunked IN(...)')
    for (const bound of boundCounts) {
      assert.ok(bound <= 100, `a single statement bound ${bound} parameters -- past D1's 100-bound-parameter limit`)
    }
    assert.equal(new Set(groups.map((g) => g.product_id)).size, 151, 'every one of the 151 products must come back, not just the first chunk')
    assert.equal(groups.reduce((sum, g) => sum + Number(g.quantity), 0), 151, 'no lot silently dropped by the chunking')
  })

  // Owner report (phone, admin session, Sep 16 2026): "Failed to load
  // tagged stock" (stock_tagged_load_failed) with an empty
  // damaged_stock_lots table and migrations already at 0169 -- so neither
  // the historical missing-column cause (0162, see
  // test-tagged-stock-migration-columns-pure.cjs) nor a 403 (admin) apply.
  // This drives the ROUTE (not just readTaggedLotGroups directly, unlike
  // the 151-id check above) through app.request() with the id list encoded
  // EXACTLY the way frontend/src/api/damagedLotsTransport.ts's
  // getTaggedLots actually sends it -- `new URLSearchParams({ productIds:
  // ids.join(',') })`, which percent-encodes the commas as %2C -- across
  // the shapes the owner's report named: 0 ids, 1 id, and 150 ids (Products
  // pages a server page of up to 100 plus pinned recently-edited rows).
  await check('GET /tagged-lots survives the exact frontend request shape against an empty table (0/1/150 ids)', async () => {
    rawDb.exec('DELETE FROM damaged_stock_lots')
    const encodedQuery = (ids) => new URLSearchParams({ productIds: ids.join(',') }).toString()
    const zero = await req('GET', `/tagged-lots?${encodedQuery([])}`)
    assert.equal(zero.status, 200, JSON.stringify(zero))
    assert.deepEqual(zero.json.items, [])

    const one = await req('GET', `/tagged-lots?${encodedQuery([1])}`)
    assert.equal(one.status, 200, JSON.stringify(one))
    assert.deepEqual(one.json.items, [])

    const manyIds = Array.from({ length: 150 }, (_, i) => i + 1)
    const many = await req('GET', `/tagged-lots?${encodedQuery(manyIds)}`)
    assert.equal(many.status, 200, JSON.stringify(many))
    assert.deepEqual(many.json.items, [])
  })

  await check('a held-row action still demands a reason, like every other stock change', async () => {
    for (const url of ['/tagged-lots/dispose', '/tagged-lots/restore']) {
      const res = await req('POST', url, { productId: 1, branchId: 1, conditionTag: 'expired', quantity: 1 })
      assert.equal(res.status, 400)
      assert.match(String(res.json?.error || ''), /reason/i)
    }
  })

  // --------------------------------------------------- delete and undo
  // A product delete is a reversible removal: it snapshots the whole stock
  // graph, zeroes it, and restores it from that snapshot on undo. Held units
  // are stock -- they simply live in a different table -- so a delete that
  // ignores them leaves an OPEN held lot pointing at a deleted product: units
  // nobody can see, sell, dispose of or restore, and that undo cannot bring
  // back either.
  await check('deleting a product takes its held lot with it, and undo gives it back whole', async () => {
    seed()
    rawDb.exec('DELETE FROM undo_snapshots; DELETE FROM product_remove_operations; DELETE FROM pending_actions; DELETE FROM audit_logs;')
    assert.equal((await req('POST', '/adjust', ADD())).status, 200)
    assert.equal((await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 4, reason: 'dropped', branchId: 1, conditionTag: 'broken' })).status, 200)
    assert.deepEqual(sellable(), { product: 6, branch: 6 })
    const before = heldLots()
    assert.equal(before.length, 1)
    assert.equal(Number(before[0].quantity_remaining), 4)
    assert.equal(before[0].condition_tag, 'broken')
    const writeOffsBefore = movements('write_off').length

    // --- the plan carries the held lot -------------------------------------
    const plan = await productDelete.prepareProductRemovePlan(db, 1, 'discontinued')
    assert.equal(plan.damaged_lots.length, 1)
    assert.equal(Number(plan.damaged_lots[0].quantity_remaining), 4)
    assert.equal(plan.damaged_lots[0].condition_tag, 'broken')
    const planDigest = await productDelete.productRemovePlanDigest(plan)

    // --- apply --------------------------------------------------------------
    await db.batch(productDelete.productRemoveApplyStatements({
      plan, operationId: 'op-tagged-1', source: 'direct', requestId: 'req-tagged-1',
      user: FAKE_USER, transitionStamp: '2026-09-14T10:00:00.000Z', planDigest,
    }))
    assert.equal(Number(rawDb.prepare('SELECT is_active FROM products WHERE id = 1').get({}).is_active), 0)
    assert.deepEqual(sellable(), { product: 0, branch: 0 })
    // The held row is kept at zero, exactly as branch_stock and
    // branch_batch_stock are -- that is what makes the undo an exact restore.
    const during = heldLots()
    assert.equal(during.length, 1)
    assert.equal(Number(during[0].quantity_remaining), 0)
    assert.equal(during[0].condition_tag, 'broken')
    // Nothing is left open against a product that no longer exists.
    assert.equal(Number(rawDb.prepare(`SELECT COUNT(*) AS c FROM damaged_stock_lots d
      JOIN products p ON p.id = d.product_id WHERE d.quantity_remaining > 0 AND p.is_active = 0`).get({}).c), 0)
    // P3-losses-writeoff (Sep 15 2026), owner ruling: "if remove directly it
    // also counts toward losses. as cost price no selling price means loss."
    // Deleting the product destroys the held units exactly as finally as
    // disposing the tagged row would, so it books TWO write-offs now: the 6
    // sellable units (unchanged) AND the 4 held units, at the lot's own
    // stamped cost -- this used to book only the first, silently destroying
    // the held units' value with no loss ever recorded for them.
    const writeOffs = movements('write_off').slice(writeOffsBefore)
    assert.equal(writeOffs.length, 2)
    assert.deepEqual(writeOffs.map((row) => Number(row.quantity)).sort((a, b) => a - b), [4, 6])
    const heldWriteOff = writeOffs.find((row) => Number(row.quantity) === 4)
    assert.equal(Number(heldWriteOff.unit_cost_usd), 2, 'valued at the lot cost stamped when it was held, not a guess')
    assert.equal(Number(heldWriteOff.total_cost_usd), 8)
    // Both rows share ONE reference marker for this apply -- so a single undo
    // counter excludes both from removalLosses.ts together (see
    // productRemoveWriteOffReferenceId in lib/productDelete.ts).
    const sellableWriteOff = writeOffs.find((row) => Number(row.quantity) === 6)
    assert.equal(sellableWriteOff.reference_id, heldWriteOff.reference_id)
    assert.equal(sellableWriteOff.reference_id, 'product_remove:op-tagged-1:0')

    // --- undo, replayed server-side from the snapshot alone -----------------
    const operation = rawDb.prepare("SELECT * FROM product_remove_operations WHERE operation_id = 'op-tagged-1'").get({})
    assert.equal(operation.status, 'undo_ready')
    const snapshot = productDelete.parseProductRemoveSnapshot(
      JSON.parse(rawDb.prepare('SELECT payload_json FROM undo_snapshots WHERE id = @id').get({ id: operation.undo_snapshot_id }).payload_json),
    )
    // lib/undoAppliers.ts re-derives this digest before it replays anything.
    // Carrying a new field in the plan must not desync it.
    assert.equal(await productDelete.productRemovePlanDigest(snapshot.plan), operation.plan_digest)
    await db.batch(productDelete.productRemoveReplayStatements({
      snapshot, operation, direction: 'undo', historyId: Number(operation.action_history_id), expectedGeneration: 0,
      user: FAKE_USER, transitionStamp: '2026-09-14T11:00:00.000Z', transitionRequestId: 'undo-1',
    }))
    const after = heldLots()
    assert.equal(after.length, 1)
    assert.equal(Number(after[0].quantity_remaining), 4)
    assert.equal(after[0].condition_tag, 'broken')
    assert.equal(after[0].id, before[0].id)
    assert.deepEqual(sellable(), { product: 6, branch: 6 })
    // Restored all the way to the surface the owner sees.
    const listed = await req('GET', '/tagged-lots?productIds=1')
    assert.deepEqual(listed.json.items.map((item) => [item.condition_tag, item.quantity]), [['broken', 4]])

    // The undo wrote ONE 'add' counter for the held units too (mirroring the
    // one it already wrote for sellable), both stamped 'revert:' + the shared
    // marker -- proof removalLosses.ts's exclusion (reference_id-keyed, since
    // this operation writes more than one row per generation) actually
    // matches, not just that the number "looks right".
    const undoCounters = movements('add').filter((row) => row.reference_id === 'revert:product_remove:op-tagged-1:0')
    assert.deepEqual(undoCounters.map((row) => Number(row.quantity)).sort((a, b) => a - b), [4, 6])

    // --- redo: re-drains with FRESH rows, a new generation, a new marker ----
    await db.batch(productDelete.productRemoveReplayStatements({
      snapshot, operation: { ...operation, status: 'reversed', generation: 1 }, direction: 'redo',
      historyId: Number(operation.action_history_id), expectedGeneration: 1,
      user: FAKE_USER, transitionStamp: '2026-09-14T12:00:00.000Z', transitionRequestId: 'redo-1',
    }))
    const redoWriteOffs = movements('write_off').slice(writeOffsBefore + 2)
    assert.equal(redoWriteOffs.length, 2, 'redo books a fresh write_off pair, not a reuse of the undone ones')
    assert.deepEqual(redoWriteOffs.map((row) => Number(row.quantity)).sort((a, b) => a - b), [4, 6])
    assert.equal(redoWriteOffs[0].reference_id, 'product_remove:op-tagged-1:2', 'tagged at the NEW generation, not the original')
    assert.deepEqual(sellable(), { product: 0, branch: 0 })
    assert.equal(Number(heldLots()[0].quantity_remaining), 0)
  })

  await check('a removal plan written before held lots existed still applies, and still leaves them alone', async () => {
    seed()
    rawDb.exec('DELETE FROM undo_snapshots; DELETE FROM product_remove_operations; DELETE FROM pending_actions; DELETE FROM audit_logs;')
    assert.equal((await req('POST', '/adjust', ADD())).status, 200)
    assert.equal((await req('POST', '/adjust', { productId: 1, type: 'remove', quantity: 4, reason: 'dropped', branchId: 1, conditionTag: 'broken' })).status, 200)

    // A plan saved before P3-L6 has no damaged_lots key at all. Reading that
    // as "absent" rather than "empty" is the whole point: an empty set would
    // make the exact-set guard demand this product have NO held lots, and the
    // apply would zero rows the snapshot cannot restore.
    const fresh = await productDelete.prepareProductRemovePlan(db, 1, 'discontinued')
    const legacy = { ...fresh }
    delete legacy.damaged_lots
    assert.deepEqual(productDelete.parseProductRemovePlan(legacy), legacy)
    const guards = productDelete.productRemoveGraphGuards(legacy, 'source')
    assert.equal(guards.filter((statement) => /damaged_stock_lots/.test(statement.sql)).length, 0)

    await db.batch(productDelete.productRemoveApplyStatements({
      plan: legacy, operationId: 'op-legacy-1', source: 'direct', requestId: 'req-legacy-1',
      user: FAKE_USER, transitionStamp: '2026-09-14T12:00:00.000Z',
      planDigest: await productDelete.productRemovePlanDigest(legacy),
    }))
    // It behaves exactly as it did before this change: sellable stock gone,
    // the held lot untouched (orphaned, as it always was). Silently draining
    // it would be worse -- undo could never put it back.
    assert.deepEqual(sellable(), { product: 0, branch: 0 })
    assert.equal(Number(heldLots()[0].quantity_remaining), 4)
  })

  console.log(`\n${passed} checks passed`)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
