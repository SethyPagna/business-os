// Real-SQLite test of the Part-77 CRITICAL (x3 audits) fix: inventory's
// POST /transfer used to move only the plain branch_stock total between
// branches, leaving every branch_batch_stock row at the source -- the exact
// per-branch lot drift migration 0081 had to repair. The route now
// auto-allocates the transferred quantity across the source branch's lots
// (same Z0 FIFO policy checkout uses for an unpicked line) and moves each
// take per-lot in the SAME atomic batch, with STRICT (unclamped) source
// decrements so a concurrent consumer aborts the whole batch instead of the
// clamp minting stock.
//
// Exercises the REAL transpiled lib/productBatches.ts helpers the route
// composes (readFifoLotAvailability, allocateAcrossLots,
// decrementBatchStockStrictStatement, incrementBatchStockStatement) against
// real better-sqlite3 with migration 0058's CHECK(quantity >= 0), plus
// source locks pinning the route wiring.
//
// Run: node scripts/test-inventory-transfer-lots-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

const batchCode = loadModule('lib/batchCode.ts', require)
const sqlBinding = loadModule('lib/sqlBinding.ts', require)
const productBatches = loadModule('lib/productBatches.ts', (id) => {
  if (id === './batchCode') return batchCode
  if (id === './sqlBinding') return sqlBinding
  return require(id)
})
const { readFifoLotAvailability, allocateAcrossLots, decrementBatchStockStrictStatement, incrementBatchStockStatement } = productBatches
const roles = loadModule('lib/branchRoles.ts', require)
const branchGuards = loadModule('lib/branchRoleGuards.ts', (id) => {
  if (id === './branchRoles') return roles
  throw new Error(`unexpected branch guard import ${id}`)
})
const canonicalIdentity = loadModule('lib/canonicalBranchIdentity.ts', (id) => {
  if (id === './db') return { toDbBool: (value, fallback = 0) => {
    if (value == null || value === '') return fallback
    if (typeof value === 'boolean') return value ? 1 : 0
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 1 : 0
  } }
  if (id === './branchRoles') return roles
  throw new Error(`unexpected canonical identity import ${id}`)
})

let routeDb = null
let routeUser = null
let routeAudits = []
let routeWaits = []
const noop = () => null
const asyncNoop = async () => null
const inventoryRoute = loadModule('routes/inventory.ts', (id) => {
  if (id === 'hono') return require('hono')
  if (id === '../lib/db') return { getDb: () => wrapDb(routeDb) }
  if (id === '../lib/auth') return {
    requireAuth: async (c, next) => {
      if (!routeUser) return c.json({ error: 'Unauthorized' }, 401)
      c.set('user', routeUser)
      return next()
    },
  }
  if (id === '../lib/permissions') return {
    getPermissionTier: (user) => user?.tier || 'none',
    getActionTier: (user) => user?.tier || 'none',
  }
  if (id === '../lib/audit') return { audit: async (...args) => { routeAudits.push(args) } }
  if (id === '../lib/reviewGate') return { maybeQueueForReview: asyncNoop }
  if (id === '../durable-objects/broadcastHub') return { broadcast: asyncNoop }
  if (id === '../lib/cache') return { bumpVersion: asyncNoop }
  if (id === '../lib/productBatches') return { ...productBatches, attachBatchCounts: asyncNoop, receiveBatchStock: asyncNoop, removeStockFromBatch: asyncNoop, removeStockAcrossBatches: asyncNoop, InsufficientBatchStockError: class extends Error {} }
  if (id === '../lib/branchRoleGuards') return branchGuards
  if (id === '../lib/canonicalBranchIdentity') return canonicalIdentity
  if (id === '../lib/actorSnapshot') return { actorSnapshot: (user) => user?.name || null }
  if (id === '../lib/operationWriteReadiness') return loadModule('lib/operationWriteReadiness.ts', require)
  if (id === '../lib/transferOperation') return loadModule('lib/transferOperation.ts', (dep) => {
    if (dep === './db') return { getDb: () => wrapDb(routeDb) }
    if (dep === './permissions') return { getActionTier: user => user?.tier || 'none' }
    if (dep === './actorSnapshot') return { actorSnapshot: user => user?.name || null }
    if (dep === './productBatches') return productBatches
    if (dep === './canonicalBranchIdentity') return canonicalIdentity
    if (dep === './transferOperationReceipt') return loadModule('lib/transferOperationReceipt.ts', require)
    if (dep === '../durable-objects/broadcastHub') return { broadcast: asyncNoop }
    if (dep === './cache') return { bumpVersion: asyncNoop }
    throw new Error('unexpected transfer dependency '+dep)
  })
  if (id === '../lib/transferOperationReceipt') return loadModule('lib/transferOperationReceipt.ts', require)
  if (id === '../lib/telegram') return { formatStockChangeTelegramLines: noop, formatTransferTelegramLines: noop, sendTelegramEvent: asyncNoop }
  if (id === '../lib/businessDateWindow') return { localDateAtOrAfter: noop, localDateAtOrBefore: noop }
  if (id === '../lib/familyPagination') return { paginateProductFamilies: asyncNoop }
  if (id === '../lib/productSalesLedger') return { buildProductSalesLedgerSql: noop }
  if (id === '../lib/familyStockStats') return { getFamilyStockStats: asyncNoop }
  if (id === '../lib/lowStockSettings') return { loadLowStockConfig: asyncNoop, lowStockThresholdSql: noop }
  if (id === '../lib/productIdentity') return { findIdentityMatch: asyncNoop, identityBarcodeKey: noop }
  if (id === '../lib/searchMatch') return { buildIssueStateClauses: noop, buildLikeAliasClause: noop, runFuzzyFallbackMatch: asyncNoop, tokenizeSearchTermGroups: noop, tokenizeSearchWords: noop }
  if (id === '../lib/productSearchQuery') return { buildFamilyRelevanceOrderSql: noop, buildProductSearchQuery: noop }
  if (id === '../lib/stockRevert') return { applyMovementRevert: asyncNoop }
  if (id === '../lib/batchCode') return { ...batchCode, normalizeTypedDate: noop }
  if (id === '../lib/stockReceiptGate') return { appendReceiptNotes: noop, FREE_GOODS_REASON_NOTE: '', stockReceiptGateCode: noop, stockReceiptGateMessage: noop }
  if (id === '../lib/datedStockCountRoute') return { parseDatedStockCountEntries: noop, buildDatedStockCountPlan: asyncNoop }
  if (id === '../lib/datedStockCountApply') return { applyDatedStockCountPlan: asyncNoop }
  if (id === '../lib/datedStockCountResolve') return { parseRawDatedCountRows: noop, resolveDatedStockCountRows: asyncNoop }
  if (id === '../lib/datedStockCountDecisions') return { applyDatedStockCountDecisions: asyncNoop }
  if (id === '../lib/movementBranchName') return { RESOLVED_BRANCH_NAME_COLUMN: '', movementBranchNameSql: noop, withResolvedBranchName: noop }
  if (id === '../lib/movementActorName') return { RESOLVED_ACTOR_NAME_COLUMN: '', movementActorNameSql: noop, withResolvedActorName: noop }
  if (id === '../lib/movementReference') return { movementReferenceSelectSql: noop }
  if (id === '../lib/movementSearch') return { movementSearchHaystackSql: noop }
  if (id === '../index') return {}
  throw new Error(`unexpected inventory route import ${id}`)
})
const inventoryApp = inventoryRoute.default
inventoryApp.onError((error) => new Response(JSON.stringify({ error: error.message }), {
  status: 500,
  headers: { 'Content-Type': 'application/json' },
}))

// Minimal async D1-compatible wrapper over better-sqlite3 (same shape the
// other *-pure tests use): @named params, and batch() as one transaction.
function wrapDb(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        get: async (params) => (Array.isArray(params) ? stmt.get(...params) : stmt.get(params || {})),
        all: async (params) => (Array.isArray(params) ? stmt.all(...params) : stmt.all(params || {})),
        run: async (params) => (Array.isArray(params) ? stmt.run(...params) : stmt.run(params || {})),
      }
    },
    batch(statements) {
      const tx = sqlite.transaction((stmts) => {
        for (const s of stmts) {
          const st = sqlite.prepare(s.sql)
          if (s.params == null) st.run()
          else st.run(s.params)
        }
      })
      // D1's batch() rejects asynchronously; better-sqlite3 throws in place.
      try {
        tx(statements)
        return Promise.resolve()
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
}

function freshDb() {
  const db = new Database(':memory:')
  for (const name of fs.readdirSync(path.join(__dirname,'../migrations')).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'))
  }
  db.prepare("INSERT INTO branches(id,name,is_active) VALUES (1,'Shop',1),(2,'Warehouse',1)").run()
  db.prepare("INSERT INTO products(id,name,stock_quantity) VALUES (1,'Transfer product',12)").run()
  // Product 1 at branch 1: lot A (older, 6 units), lot B (newer, 4 units),
  // branch_stock 12 -- 2 units of legacy stock the lot ledger never tracked.
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, batch_number) VALUES (101, 1, 'A', 'A', '2026-08-01', 1)`).run()
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, batch_number) VALUES (102, 1, 'B', 'B', '2026-08-20', 2)`).run()
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (101, 1, 6)`).run()
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (102, 1, 4)`).run()
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 12)`).run()
  return db
}

async function routeRequest(body) {
  const response = await inventoryApp.request('/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transfer_provenance_version: 1, ...body }),
  }, {}, {
    waitUntil: (promise) => { routeWaits.push(Promise.resolve(promise)) },
    passThroughOnException: () => {},
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}

function lotQty(db, batchId, branchId) {
  const row = db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?').get(batchId, branchId)
  return row ? Number(row.quantity) : 0
}
function stockQty(db, branchId) {
  const row = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = ?').get(branchId)
  return row ? Number(row.quantity) : 0
}

// The exact statement composition the route builds for a transfer of
// `quantity` from branch 1 to branch 2.
async function composeTransferStatements(db, quantity) {
  const lots = await readFifoLotAvailability(wrapDb(db), 1, 1)
  const { takes, uncovered } = allocateAcrossLots(lots, quantity)
  const statements = [
    { sql: 'UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = 1 AND branch_id = 1', params: { quantity } },
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 2, @quantity)
            ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
      params: { quantity },
    },
    ...takes.flatMap((take) => [
      decrementBatchStockStrictStatement(take.batchId, 1, take.quantity),
      incrementBatchStockStatement(take.batchId, 2, take.quantity),
    ]),
  ]
  return { statements, takes, uncovered }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {

await check('a transfer spanning two lots moves each lot FIFO, atomically, keeping lot identity', async () => {
  const db = freshDb()
  const { statements, takes, uncovered } = await composeTransferStatements(db, 8)
  assert.deepStrictEqual(takes.map((t) => [t.batchId, t.quantity]), [[101, 6], [102, 2]], 'oldest lot drains first')
  assert.strictEqual(uncovered, 0)
  await wrapDb(db).batch(statements)
  assert.strictEqual(lotQty(db, 101, 1), 0)
  assert.strictEqual(lotQty(db, 102, 1), 2)
  assert.strictEqual(lotQty(db, 101, 2), 6, 'the SAME batch row holds the moved units at the destination')
  assert.strictEqual(lotQty(db, 102, 2), 2)
  assert.strictEqual(stockQty(db, 1), 4)
  assert.strictEqual(stockQty(db, 2), 8)
})

await check('legacy stock the lot ledger never tracked moves on branch_stock alone -- drift is conserved, never created', async () => {
  const db = freshDb()
  const { statements, takes, uncovered } = await composeTransferStatements(db, 12)
  assert.strictEqual(takes.reduce((sum, t) => sum + t.quantity, 0), 10)
  assert.strictEqual(uncovered, 2)
  await wrapDb(db).batch(statements)
  // Source: 0 stock, 0 in lots. Destination: 12 stock, 10 in lots -- the
  // SAME 2-unit legacy gap that existed at the source, nothing new.
  assert.strictEqual(stockQty(db, 1), 0)
  assert.strictEqual(lotQty(db, 101, 1) + lotQty(db, 102, 1), 0)
  assert.strictEqual(stockQty(db, 2), 12)
  assert.strictEqual(lotQty(db, 101, 2) + lotQty(db, 102, 2), 10)
})

await check('a concurrent consumer aborts the WHOLE batch (strict decrement + CHECK) -- nothing moves, no stock is minted', async () => {
  const db = freshDb()
  const { statements } = await composeTransferStatements(db, 8)
  // Between the availability read and the batch, a sale drains lot A to 3.
  db.prepare('UPDATE branch_batch_stock SET quantity = 3 WHERE batch_id = 101 AND branch_id = 1').run()
  db.prepare('UPDATE branch_stock SET quantity = 9 WHERE product_id = 1 AND branch_id = 1').run()
  await assert.rejects(() => wrapDb(db).batch(statements), /CHECK|constraint/i)
  // Fully rolled back: source untouched, destination gained nothing.
  assert.strictEqual(lotQty(db, 101, 1), 3)
  assert.strictEqual(lotQty(db, 102, 1), 4)
  assert.strictEqual(stockQty(db, 1), 9)
  assert.strictEqual(stockQty(db, 2), 0)
  assert.strictEqual(lotQty(db, 101, 2) + lotQty(db, 102, 2), 0)
})

await check('source lock: the route allocates FIFO, decrements STRICT, and stamps blank-honest movement lots', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'inventory.ts'), 'utf8')
  const routeAt = src.indexOf("app.post('/transfer'")
  assert.ok(routeAt > -1)
  const body = src.slice(routeAt, src.indexOf("app.post('/", routeAt + 20) === -1 ? undefined : src.indexOf("app.post('/", routeAt + 20))
  assert.ok(/readFifoLotAvailability\(db, productId, fromBranchId\)/.test(body), 'must read source-lot availability')
  assert.match(body, /selectedLots = batchId === null \? sourceLots : sourceLots.filter\(lot => lot.batchId === batchId\)/, 'omitted selection retains every FIFO source lot; explicit selection is exact')
  assert.ok(/allocateAcrossLots\(selectedLots, quantity\)/.test(body), 'must allocate across the selected FIFO source lots')
  assert.match(body, /await planTransferOperation\(db,/, 'route uses exact provenance planner')
  assert.match(body, /destProductId: productId/, 'inventory transfer preserves product identity')
  assert.ok(/takes\.length === 1 && uncovered === 0 \? takes\[0\]\.batchId : null/.test(body), '0084 blank-honest movement stamping')
})

await check('the real Inventory transfer handler applies independent forward and opposite-direction transfers', async () => {
  routeDb = freshDb()
  routeUser = { id: 7, name: 'Stock manager', tier: 'full' }
  routeAudits = []
  routeWaits = []
  const state = () => ({
    shopStock: stockQty(routeDb, 1),
    warehouseStock: stockQty(routeDb, 2),
    shopLots: [lotQty(routeDb, 101, 1), lotQty(routeDb, 102, 1)],
    warehouseLots: [lotQty(routeDb, 101, 2), lotQty(routeDb, 102, 2)],
  })

  let result = await routeRequest({ productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 8, reason: 'return to warehouse', client_request_id: 'inventory-transfer-forward' })
  assert.strictEqual(result.status, 200, JSON.stringify(result.json))
  assert.strictEqual(result.json.success, true)
  const applied = state()
  assert.deepStrictEqual(applied, {
    shopStock: 4, warehouseStock: 8, shopLots: [0, 2], warehouseLots: [6, 2],
  })

  result = await routeRequest({ productId: 1, fromBranchId: 2, toBranchId: 1, quantity: 8, reason: 'Undo: return to warehouse', client_request_id: 'inventory-transfer-undo' })
  assert.strictEqual(result.status, 200, JSON.stringify(result.json))
  assert.deepStrictEqual(state(), {
    shopStock: 12, warehouseStock: 0, shopLots: [6, 4], warehouseLots: [0, 0],
  })

  result = await routeRequest({ productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 8, reason: 'Redo: return to warehouse', client_request_id: 'inventory-transfer-redo' })
  assert.strictEqual(result.status, 200, JSON.stringify(result.json))
  assert.deepStrictEqual(state(), applied)
  assert.strictEqual(routeDb.prepare('SELECT SUM(quantity) AS total FROM branch_stock WHERE product_id=1').get().total, 12)
  assert.strictEqual(routeDb.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 3)
  assert.deepStrictEqual(
    routeDb.prepare('SELECT movement_type,branch_id,SUM(quantity) AS quantity,NULL AS batch_id FROM inventory_movements GROUP BY ((id-1)/4),movement_type ORDER BY MIN(id)').all(),
    [
      { movement_type: 'transfer_out', branch_id: 1, quantity: 8, batch_id: null },
      { movement_type: 'transfer_in', branch_id: 2, quantity: 8, batch_id: null },
      { movement_type: 'transfer_out', branch_id: 2, quantity: 8, batch_id: null },
      { movement_type: 'transfer_in', branch_id: 1, quantity: 8, batch_id: null },
      { movement_type: 'transfer_out', branch_id: 1, quantity: 8, batch_id: null },
      { movement_type: 'transfer_in', branch_id: 2, quantity: 8, batch_id: null },
    ],
  )
  assert.strictEqual(routeDb.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 3)
  await Promise.all(routeWaits)
})

await check('Inventory transfer replay returns its receipt without moving stock twice', async () => {
  routeDb = freshDb()
  routeUser = { id: 7, name: 'Stock manager', tier: 'full' }
  routeAudits = []
  routeWaits = []
  const body = { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, reason: 'replay-safe inventory move', client_request_id: 'inventory-replay-1' }
  const first = await routeRequest(body)
  assert.strictEqual(first.status, 200, JSON.stringify(first.json))
  const replay = await routeRequest(body)
  assert.strictEqual(replay.status, 200, JSON.stringify(replay.json))
  assert.strictEqual(replay.json.replayed, true)
  assert.strictEqual(stockQty(routeDb, 1), 10)
  assert.strictEqual(stockQty(routeDb, 2), 2)
  assert.strictEqual(routeDb.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 1)
  assert.strictEqual(routeDb.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 2)
  assert.strictEqual(routeDb.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='transfer_intent'").get().total, 1)
  await Promise.all(routeWaits)
})

await check('Inventory rejects same, unknown, inactive, duplicate-role, reasonless, and non-Full transfers without effects', async () => {
  const assertNoEffects = (db) => {
    assert.strictEqual(stockQty(db, 1), 12)
    assert.strictEqual(stockQty(db, 2), 0)
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM stock_transfers').get().total, 0)
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS total FROM inventory_movements').get().total, 0)
  }

  const attempt = async ({ setup, user = { id: 7, name: 'Stock manager', tier: 'full' }, body, status }) => {
    routeDb = freshDb()
    routeUser = user
    routeAudits = []
    routeWaits = []
    if (setup) setup(routeDb)
    const result = await routeRequest(body)
    assert.strictEqual(result.status, status, JSON.stringify(result.json))
    assertNoEffects(routeDb)
    assert.strictEqual(routeAudits.length, 0)
  }

  await attempt({ body: { productId: 1, fromBranchId: 1, toBranchId: 1, quantity: 1, reason: 'same', client_request_id: 'invalid-same-inventory' }, status: 400 })
  await attempt({
    setup: (db) => db.prepare("INSERT INTO branches(id,name,is_active) VALUES (3,'Depot',1)").run(),
    body: { productId: 1, fromBranchId: 1, toBranchId: 3, quantity: 1, reason: 'other', client_request_id: 'invalid-other-inventory' },
    status: 400,
  })
  await attempt({
    setup: (db) => db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run(),
    body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 1, reason: 'inactive', client_request_id: 'invalid-inactive-inventory' },
    status: 409,
  })
  await attempt({
    setup: (db) => db.prepare("INSERT INTO branches(id,name,is_active) VALUES (4,' warehouse ',1)").run(),
    body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 1, reason: 'duplicate', client_request_id: 'invalid-duplicate-inventory' },
    status: 409,
  })
  await attempt({ body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 1 }, status: 400 })
  await attempt({
    user: { id: 8, name: 'Reviewer', tier: 'review' },
    body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 1, reason: 'review refused', client_request_id: 'invalid-review-inventory' },
    status: 403,
  })
})

await check('offline replay still dispatches Inventory transfer to the same guarded route and forwards its request id', () => {
  const sync = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sync.ts'), 'utf8')
  const transport = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'inventoryWriteTransport.ts'), 'utf8')
  assert.match(sync, /'inventory\.transfer': \{ method: 'POST', path: '\/api\/inventory\/transfer' \}/)
  assert.match(sync, /'x-client-request-id': operation\.client_request_id/)
  assert.match(sync, /client_request_id: operation\.client_request_id/)
  assert.match(transport, /'inventory:transfer'[\s\S]*'POST'[\s\S]*'\/api\/inventory\/transfer'/)
  assert.match(transport, /ensureClientRequestId\([\s\S]*'transfer'\)/)
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
