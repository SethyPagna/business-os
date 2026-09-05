// Regression lock: an Add Stock at a NEW COST must never fork a second
// product row carrying the SAME BARCODE.
//
// THE identity rule (lib/productDetailRule.ts) changed on Sep 4 2026: the
// barcode became the only DETAIL, and a differing cost merges instead of
// splitting a child row. Every consumer of productDetailSignature inherited
// that for free. routes/inventory.ts's resolveAddStockTarget did not -- it
// re-implemented the rule inline, kept comparing cost, and then asked
// findIdentityMatch (which excludes the source row, id != @id) to place the
// leftover. With one row on the barcode there was nothing to find, so the add
// fell through to the INSERT and forked a twin.
//
// The live consequence, production Sep 3 2026: "Olay Serum Body Lotion 547ml"
// barcode 075609215322, 28 units received at 17.50 against a row costed 17.00.
// The units and their lot landed on the forked row 47155; the POS resolves the
// barcode to row 4758 and showed Out of Stock over 31 zero lots. Freshly
// received stock became unsellable.
//
// So the assertions below cover BOTH layers, because fixing only the first
// would still leave the till showing zero:
//   * no second row is created, and the quantity lands on the source row;
//   * the BATCH ledger the POS reads agrees with branch_stock afterwards.
//
// Same approach as test-adjust-received-date-pure.cjs: transpile the REAL
// route and lib modules, run them against a real in-memory SQLite with the
// real migrations, and drive the actual Hono app. Notably lib/productIdentity
// is loaded REAL here rather than stubbed to an always-null findIdentityMatch,
// because the sibling-vs-source decision is exactly what is under test -- a
// stub would test the stub.
//
// Run (from cloudflare/): node scripts/test-add-stock-barcode-identity-pure.cjs

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
const productDetailRule = loadReal('lib/productDetailRule.ts')
// REAL, not stubbed -- see the header. This is the module that decides
// whether a barcode already belongs to another child row.
const productIdentity = loadReal('lib/productIdentity.ts', {
  './sqlBinding': sqlBinding,
  './productDetailRule': productDetailRule,
})
const productBatches = loadReal('lib/productBatches.ts', {
  './db': { getDb: () => db },
  './batchCode': batchCode,
  './sqlBinding': sqlBinding,
})
const permissions = loadReal('lib/permissions.ts')
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', {
  './db': { getDb: () => db },
  './businessDateWindow': businessDateWindow,
})

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true }) }

// Sep 6 2026: the owner's low-stock alert setting reaches this module through
// lib/lowStockSettings.ts. The SQL builder is the REAL one -- the clauses
// asserted below are the ones it composes -- while the settings READ answers
// the shipped default, there being no settings row in this harness. The rule
// itself is proven in scripts/test-low-stock-settings-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

const inventoryRoute = loadReal('routes/inventory.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/salesAnalytics': salesAnalytics,
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/sqlBinding': sqlBinding,
  '../lib/productIdentity': productIdentity,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/lowStockSettings': lowStockStub,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  // Both halves stubbed: the route calls formatStockChangeTelegramLines to
  // build the message before handing it to sendTelegramEvent, and a missing
  // formatter throws inside the waitUntil, which the route swallows and logs
  // -- harmless to the assertions, but it buries the PASS lines in noise.
  '../lib/telegram': { sendTelegramEvent: async () => false, formatStockChangeTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
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

// The real product row from the production incident, reduced to what the
// identity decision reads. name_key is written explicitly because
// findIdentityMatch keys on it.
const NAME = 'Olay Serum Body Lotion 547ml'
const BARCODE = '075609215322'
const nameKeyOf = (value) => String(value).trim().replace(/\s+/g, ' ').toLowerCase()

function seed() {
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements;')
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Shop', 1, 1)").run()
  rawDb.prepare('INSERT INTO products (id, name, name_key, barcode, is_active, is_group, stock_quantity, cost_price_usd, purchase_price_usd, selling_price_usd) VALUES (4758, @name, @nameKey, @barcode, 1, 0, 0, 17.0, 17.0, 22.0)')
    .run({ name: NAME, nameKey: nameKeyOf(NAME), barcode: BARCODE })
}

const productCount = () => rawDb.prepare('SELECT COUNT(*) AS n FROM products').get({}).n
const rowsOnBarcode = () => rawDb.prepare('SELECT id FROM products WHERE TRIM(barcode) = @b ORDER BY id').all({ b: BARCODE }) ?? []
const branchStockOf = (id) => rawDb.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM branch_stock WHERE product_id = @id').get({ id }).q
const batchStockOf = (id) => rawDb.prepare('SELECT COALESCE(SUM(bbs.quantity),0) AS q FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id WHERE pb.variant_product_id = @id').get({ id }).q

const addAtCost = (costUsd, barcode = BARCODE, quantity = 28) => req({
  productId: 4758,
  type: 'add',
  quantity,
  reason: 'Stock received',
  branchId: 2,
  unlockPricing: true,
  pricing: { cost_usd: costUsd, barcode, selling_price_usd: 22.0 },
})

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS ' + name)
    passed++
  } catch (e) {
    console.log('FAIL ' + name + ' - ' + e.message)
    process.exitCode = 1
  }
}

async function main() {
  await check('an add at a DIFFERENT cost on the SAME barcode does not fork a second row', async () => {
    seed()
    const before = productCount()
    const { status, json } = await addAtCost(17.5)
    assert.equal(status, 200, 'adjust should succeed')
    assert.equal(productCount(), before, 'no new product row may be created for a cost difference')
    assert.equal(json.createdSibling, false, 'createdSibling must be false -- the barcode did not change')
    assert.equal(json.productId, 4758, 'the stock must land on the row the request named')
    assert.equal(rowsOnBarcode().length, 1, 'exactly one row may ever hold this barcode')
  })

  await check('the 28 units land on the source row, where the POS looks for them', async () => {
    assert.equal(branchStockOf(4758), 28, 'branch_stock must carry the received quantity')
  })

  await check('the BATCH ledger agrees with branch_stock -- the half the till reads', async () => {
    // This is the assertion that encodes the reported symptom. Before the fix
    // the units existed in branch_stock on one row and in the batch ledger on
    // another, so the product sheet said 28 and the POS said 0.
    assert.equal(batchStockOf(4758), 28, 'the lot ledger must hold the same 28 units')
    assert.equal(batchStockOf(4758), branchStockOf(4758), 'batch ledger and branch_stock must never disagree')
  })

  await check('repeated adds at further new costs still never fork a row', async () => {
    seed()
    await addAtCost(17.5)
    await addAtCost(19.25)
    await addAtCost(12.0)
    assert.equal(rowsOnBarcode().length, 1, 'three different costs must still be one row')
    assert.equal(branchStockOf(4758), 84, 'every unit must be on the one row')
    assert.equal(batchStockOf(4758), 84, 'and visible to the POS through the lot ledger')
  })

  await check('a genuinely DIFFERENT barcode still forks a child row -- the rule is not disabled', async () => {
    seed()
    const before = productCount()
    const { status, json } = await addAtCost(17.0, '999888777666')
    assert.equal(status, 200)
    assert.equal(productCount(), before + 1, 'a new barcode is a new article and must get its own row')
    assert.equal(json.createdSibling, true, 'createdSibling must be true for a real barcode change')
    assert.notEqual(json.productId, 4758, 'the stock belongs on the new row')
  })

  await check('a different barcode ALREADY held by a sibling routes there instead of making a third row', async () => {
    seed()
    rawDb.prepare("INSERT INTO products (id, name, name_key, barcode, is_active, is_group, stock_quantity, cost_price_usd, purchase_price_usd, selling_price_usd) VALUES (47155, @name, @nameKey, '999888777666', 1, 0, 0, 30.0, 30.0, 22.0)")
      .run({ name: NAME, nameKey: nameKeyOf(NAME) })
    const before = productCount()
    const { json } = await addAtCost(17.0, '999888777666')
    assert.equal(productCount(), before, 'the sibling already exists -- no third row')
    assert.equal(json.productId, 47155, 'the stock must go to the row that owns that barcode')
    assert.equal(json.createdSibling, false)
  })

  console.log('\n' + passed + ' passed')
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
