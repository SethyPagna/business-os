// D4 (11.28) regression test: manual historical batches through the ONE
// shared stock-add path. POST /inventory/adjust now accepts an optional
// `receivedDate`, and it must flow into lib/productBatches.ts's
// receiveBatchStock -- the same kernel (and the same date->code matching)
// the Receive Batch modal's own route already uses, so "same date = same
// lot" stays one rule across every entry point (Product edit's
// BranchStockAdjuster, Inventory's Adjust modal, ReceiveBatchModal).
//
// Same approach as test-returns-batch-restock-pure.cjs: transpile the REAL
// route file and lib/productBatches.ts, run them against a real in-memory
// SQLite database with the real migrations applied, and call the actual
// Hono app.request() the way the real Worker would. Everything with no
// bearing on this behavior (auth/audit/broadcast/cache/search/dated-count
// import) is stubbed to a permissive no-op; the date normalization, batch
// creation/matching and aggregate writes under test are real.
//
// Run (from cloudflare/): node scripts/test-adjust-received-date-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
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

// The REAL date->code module: the route's own validation (normalizeToIsoDate)
// and the assertions below (dateToBatchCode) must be the same code the
// kernel derives lot codes with -- a stub would test the stub.
const batchCode = loadReal('lib/batchCode.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': sqlBinding })
const permissions = loadReal('lib/permissions.ts')
// routes/batches.ts imports the shared optimistic-locking helpers; without
// this override the transpiled module's './conflictControl' require resolves
// against scripts/ and the whole test file dies at load time.
const conflictControl = loadReal('lib/conflictControl.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ inventory: true }) }

// Only the /adjust path is driven here -- the list/search/dated-count
// endpoints' dependencies are stubbed inert (never called by these checks).
const inventoryRoute = loadReal('routes/inventory.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  '../lib/sqlBinding': sqlBinding,
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/familyStockStats': { getFamilyStockStats: async () => ({}) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productIdentity': { findIdentityMatch: async () => null },
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
  '../lib/stockRevert': { applyMovementRevert: async () => ({}) },
})

const app = inventoryRoute.default

// D4b: the Receive Batch route grows the same explicit-lot pick every
// adjust surface has -- loaded with the same real kernel + real batchCode.
const batchesRoute = loadReal('routes/batches.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/permissions': permissions,
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/productBatches': productBatches,
  '../lib/batchCode': batchCode,
  // K2 Part 416: routes/batches.ts gained the damaged-lots POS lookup;
  // these tests exercise receive/adjust, so an empty stub is honest.
  '../lib/returnsStock': { listOpenDamagedLots: async () => [] },
  '../lib/conflictControl': conflictControl,
})
const batchesApp = batchesRoute.default

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function seed() {
  rawDb.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; DELETE FROM products; DELETE FROM branches; DELETE FROM inventory_movements;')
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDb.prepare("INSERT INTO products (id, name, barcode, is_active, stock_quantity) VALUES (1, 'Widget', 'B123', 1, 0)").run()
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

function batchRows() {
  return rawDb.prepare('SELECT id, batch_key, lot_code, received_at, received_quantity, received_branch_id FROM product_batches ORDER BY id').all() ?? []
}

async function main() {
  await check('add with a historical receivedDate stores the REAL date and derives the lot code from it', async () => {
    seed()
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 5, reason: 'Late stock-in', branchId: 1,
      batchId: 'new', receivedDate: '2025-03-15',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'exactly one lot created')
    assert.strictEqual(rows[0].received_at, '2025-03-15', 'the lot carries the real received date, not today')
    const expectedCode = batchCode.dateToBatchCode('2025-03-15')
    assert.strictEqual(rows[0].lot_code, expectedCode, 'lot code derived from the historical date')
    assert.match(String(expectedCode), /^\d{8}$/, 'batch codes stay numeric MMDDYYYY (Part 388 decision)')
    assert.strictEqual(rows[0].received_quantity, 5)
    assert.strictEqual(rows[0].received_branch_id, 1)
    const aggregate = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get()
    assert.strictEqual(aggregate.quantity, 5, 'aggregate branch_stock moved with the batch')
    const total = rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get()
    assert.strictEqual(total.stock_quantity, 5, 'denormalized product total moved too')
  })

  await check('a second add with the SAME date (mm/dd/yyyy form) tops up that lot instead of creating a twin', async () => {
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 3, reason: 'Late stock-in, same receipt', branchId: 1,
      batchId: 'new', receivedDate: '03/15/2025',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'same date = same lot, one row only (the Receive Batch modal rule)')
    assert.strictEqual(rows[0].received_quantity, 8, 'cumulative received total (0067) counts both receipts')
    const lotQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @id AND branch_id = 1').get({ id: rows[0].id })
    assert.strictEqual(lotQty.quantity, 8)
  })

  await check("an explicit-batch top-up with a DIFFERENT date never rewrites the lot's own received_at (first attribution sticks)", async () => {
    const before = batchRows()[0]
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 2, reason: 'Top-up', branchId: 1,
      batchId: before.id, receivedDate: '2024-01-01',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'still one lot -- the date must not have spawned a twin')
    assert.strictEqual(rows[0].received_at, '2025-03-15', 'received_at unchanged by the later top-up')
    assert.strictEqual(rows[0].received_quantity, 10)
  })

  await check('an unreadable receivedDate is refused (400) and writes NOTHING -- never silently today', async () => {
    const rowsBefore = batchRows()
    const aggBefore = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    const { status } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 4, reason: 'Bad date', branchId: 1,
      batchId: 'new', receivedDate: 'not-a-date',
    })
    assert.strictEqual(status, 400, 'refused, not defaulted')
    assert.deepStrictEqual(batchRows(), rowsBefore, 'no batch row appeared')
    const aggAfter = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity
    assert.strictEqual(aggAfter, aggBefore, 'no stock moved')
  })

  await check('an add with NO receivedDate keeps the existing default: today (UTC day), pinned', async () => {
    seed()
    const { status, json } = await req('POST', '/adjust', {
      productId: 1, type: 'add', quantity: 2, reason: 'Ordinary receipt', branchId: 1, batchId: 'new',
    })
    assert.strictEqual(status, 200, JSON.stringify(json))
    const todayIso = new Date().toISOString().slice(0, 10)
    const rows = batchRows()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].received_at, todayIso, 'absent date still means "received today", unchanged behavior')
    assert.strictEqual(rows[0].lot_code, batchCode.dateToBatchCode(todayIso))
  })

  await check('D4b: POST /api/batches with an explicit batch_id tops up that exact lot and keeps its received_at', async () => {
    seed()
    const first = await req('POST', '/', {
      product_id: 1, branch_id: 1, quantity: 6, received_date: '2025-02-10',
    }, batchesApp)
    assert.strictEqual(first.status, 200, JSON.stringify(first.json))
    const lot = batchRows()[0]
    assert.strictEqual(lot.received_at, '2025-02-10')
    const topUp = await req('POST', '/', {
      product_id: 1, branch_id: 1, quantity: 4, batch_id: lot.id, received_date: '2026-08-01',
    }, batchesApp)
    assert.strictEqual(topUp.status, 200, JSON.stringify(topUp.json))
    const rows = batchRows()
    assert.strictEqual(rows.length, 1, 'the explicit pick must not have spawned a twin from the different date')
    assert.strictEqual(rows[0].received_at, '2025-02-10', "the lot's own received date stays (first attribution sticks)")
    assert.strictEqual(rows[0].received_quantity, 10, 'cumulative received total counts both receipts')
    const lotQty = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @id AND branch_id = 1').get({ id: rows[0].id })
    assert.strictEqual(lotQty.quantity, 10)
  })

  await check("D4b: a batch_id belonging to a DIFFERENT product is refused (400), nothing written", async () => {
    rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (2, 'Other', 1, 0)").run()
    const foreign = batchRows()[0]
    const aggBefore = rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 2').get().stock_quantity
    const { status } = await req('POST', '/', {
      product_id: 2, branch_id: 1, quantity: 3, batch_id: foreign.id,
    }, batchesApp)
    assert.strictEqual(status, 400, 'a caller mistake answers 400, not an unhandled 500')
    const aggAfter = rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 2').get().stock_quantity
    assert.strictEqual(aggAfter, aggBefore, 'no stock moved onto the wrong product')
    assert.strictEqual(batchRows().length, 1, 'no batch row appeared')
  })

  await check("D4's transfer rule source pin: branch transfers never set/change a product barcode", async () => {
    const branchesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
    // The whole file must contain no UPDATE that assigns products.barcode --
    // transfers may SELECT barcode (identity matching reads it) but only
    // create/add/adjust flows are allowed to write one (11.28).
    assert.ok(!/UPDATE\s+products\s+SET[^;]*?\bbarcode\s*=/is.test(branchesSrc), 'no products UPDATE in branches.ts assigns barcode')
    const transferStart = branchesSrc.indexOf("app.post('/transfer'")
    assert.ok(transferStart > -1, 'transfer route present')
    const nextRoute = branchesSrc.indexOf('app.', transferStart + 1)
    const transferSrc = branchesSrc.slice(transferStart, nextRoute === -1 ? undefined : nextRoute)
    assert.ok(!/INSERT\s+INTO\s+products\b/i.test(transferSrc), 'a transfer never creates a product row (so it cannot mint a new barcode either)')
  })

  await check('move-row drains the source lots and receives a fresh lot on the destination (no ledger drift)', async () => {
    seed()
    rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (2, 'Destination', 1, 0)").run()
    const add = await req('POST', '/adjust', { productId: 1, type: 'add', quantity: 10, reason: 'stock in', branchId: 1, batchId: 'new' })
    assert.strictEqual(add.status, 200, JSON.stringify(add.json))
    const srcLot = batchRows()[0]
    const srcLotQty = () => rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @id AND branch_id = 1').get({ id: srcLot.id }).quantity
    assert.strictEqual(srcLotQty(), 10, 'sanity: source lot holds 10')

    const moved = await req('POST', '/move-row', { sourceProductId: 1, destinationProductId: 2, quantity: 4, branchId: 1, reason: 'relabel' })
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.json))

    // Source: aggregate AND its lot both drop to 6 -- in step, not stranded at 10.
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get().quantity, 6, 'source aggregate drops by 4')
    assert.strictEqual(srcLotQty(), 6, 'source lot drops in step -- the pre-fix drift left it at 10')

    // Destination: aggregate = 4 AND a fresh lot holds exactly the moved units.
    assert.strictEqual(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 2 AND branch_id = 1').get().quantity, 4, 'destination aggregate is the moved 4')
    const destLotTotal = (rawDb.prepare('SELECT COALESCE(SUM(bbs.quantity), 0) AS q FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id WHERE pb.variant_product_id = 2 AND bbs.branch_id = 1').get() || {}).q
    assert.strictEqual(Number(destLotTotal), 4, 'destination received a lot -- its ledger equals its aggregate (invariant held on both sides)')
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
