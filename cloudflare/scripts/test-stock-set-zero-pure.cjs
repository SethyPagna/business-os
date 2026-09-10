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
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': sqlBinding })
const permissions = loadReal('lib/permissions.ts')
const branchRoles = loadReal('lib/branchRoles.ts')
const canonicalBranchIdentity = loadReal('lib/canonicalBranchIdentity.ts', {
  './db': loadReal('lib/db.ts'),
  './branchRoles': branchRoles,
})
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './businessDateWindow': businessDateWindow })
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

const inventoryRoute = loadReal('routes/inventory.ts', {
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
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/salesAnalytics': salesAnalytics,
  '../lib/productSalesLedger': productSalesLedger,
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/stockReceiptGate': stockReceiptGate,
  '../lib/sqlBinding': sqlBinding,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/lowStockSettings': lowStockStub,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': { sendTelegramEvent: async () => false, formatStockChangeTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productIdentity': { findIdentityMatch: async () => null },
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
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements; DELETE FROM suppliers;')
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

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
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
    const { status } = await req({ productId: 1, type: 'add', quantity: 0, reason: 'Receive', branchId: 1, batchId: 'new', unitCostUsd: 2, supplierName: 'Acme' })
    assert.strictEqual(status, 400, 'a zero add is a receipt of nothing')
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
