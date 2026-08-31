// Real-SQLite test of the C1 fix (Aug-31 reconcile audit): routes/branches.ts
// POST /transfer and POST /transfer-bulk used to move only the plain
// branch_stock total for an item with NO picked lot, leaving every
// branch_batch_stock row at the source and creating none at the destination
// -- so a batch-tracked product moved through the branch TransferModal's
// multi-select flow (which never picks a lot) drifted its per-lot ledger from
// the branch total and lost lot identity at the destination. This is the same
// class of per-branch lot drift migration 0081 had to repair for the inventory
// route; branches.ts had never grown the equivalent FIFO fallback.
//
// The routes now auto-allocate the no-batchId quantity across the source
// branch's active lots FIFO (the same Z0 policy checkout / inventory.ts use)
// and move each take per-lot in the SAME atomic batch, materializing the
// matching lot at the destination. The FIFO leg uses the STRICT source
// decrement, matching inventory.ts's /transfer: the availability read runs
// OUTSIDE the atomic batch, so a concurrent drain between read and write must
// abort-and-retry (CHECK(quantity >= 0) violation) rather than let a clamped
// floor mint per-lot drift at the destination. Each route's explicit-batch
// leg (a user-picked lot) stays CLAMPED, unchanged.
//
// Exercises the REAL transpiled lib/productBatches.ts helpers the routes
// compose (readFifoLotAvailability, allocateAcrossLots,
// decrementBatchStockStrictStatement, incrementBatchStockStatement) against
// real better-sqlite3, plus source locks pinning both routes' wiring.
//
// Run: node scripts/test-branch-transfer-lots-pure.cjs

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
  db.exec(`
    CREATE TABLE product_batches (
      id INTEGER PRIMARY KEY, variant_product_id INTEGER NOT NULL,
      lot_code TEXT, expiry_date TEXT, received_at TEXT, batch_number INTEGER,
      is_active INTEGER DEFAULT 1, notes TEXT
    );
    CREATE TABLE branch_batch_stock (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
      quantity REAL DEFAULT 0 CHECK (quantity >= 0), updated_at TEXT,
      UNIQUE (batch_id, branch_id)
    );
    CREATE TABLE branch_stock (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
      quantity REAL DEFAULT 0 CHECK (quantity >= 0),
      UNIQUE (product_id, branch_id)
    );
  `)
  // Product 1 at branch 1: lot A (older, 6 units), lot B (newer, 4 units),
  // branch_stock 12 -- 2 units of legacy stock the lot ledger never tracked.
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, lot_code, received_at, batch_number) VALUES (101, 1, 'A', '2026-08-01', 1)`).run()
  db.prepare(`INSERT INTO product_batches (id, variant_product_id, lot_code, received_at, batch_number) VALUES (102, 1, 'B', '2026-08-20', 2)`).run()
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (101, 1, 6)`).run()
  db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (102, 1, 4)`).run()
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 12)`).run()
  return db
}

function lotQty(db, batchId, branchId) {
  const row = db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?').get(batchId, branchId)
  return row ? Number(row.quantity) : 0
}
function stockQty(db, branchId) {
  const row = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = ?').get(branchId)
  return row ? Number(row.quantity) : 0
}

// The exact statement composition branches.ts builds for a no-batchId transfer
// (single or one bulk item) of `quantity` from branch 1 to branch 2: no merge,
// so the destination keeps the SAME batch ids, and the source decrement is
// STRICT (matching inventory.ts's FIFO leg, so a concurrent drain aborts).
async function composeBranchTransferStatements(db, quantity) {
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

// ---- source-lock helper: the body of one route handler ----
function routeBody(src, marker) {
  const start = src.indexOf(marker)
  assert.ok(start > -1, `route not found: ${marker}`)
  // End at the next route declaration after this one.
  const next = src.slice(start + marker.length).search(/app\.(get|post|put|delete|patch)\('\//)
  return next === -1 ? src.slice(start) : src.slice(start, start + marker.length + next)
}

async function main() {

await check('no-batchId branch transfer spanning two lots moves each lot FIFO and materializes the SAME lots at the destination', async () => {
  const db = freshDb()
  const { statements, takes, uncovered } = await composeBranchTransferStatements(db, 8)
  assert.deepStrictEqual(takes.map((t) => [t.batchId, t.quantity]), [[101, 6], [102, 2]], 'oldest lot drains first (FIFO)')
  assert.strictEqual(uncovered, 0)
  await wrapDb(db).batch(statements)
  // Source lots drained FIFO...
  assert.strictEqual(lotQty(db, 101, 1), 0)
  assert.strictEqual(lotQty(db, 102, 1), 2)
  // ...and the destination now HAS the matching lot rows (the bug: it had none).
  assert.strictEqual(lotQty(db, 101, 2), 6, 'destination materializes the SAME batch row for the moved units')
  assert.strictEqual(lotQty(db, 102, 2), 2)
  assert.strictEqual(stockQty(db, 1), 4)
  assert.strictEqual(stockQty(db, 2), 8)
  // The 8 moved units were fully lot-covered, so the destination reconciles
  // exactly -- before the fix its per-lot sum was 0 while its branch total was 8.
  assert.strictEqual(lotQty(db, 101, 2) + lotQty(db, 102, 2), stockQty(db, 2), 'destination per-lot sum == destination branch total')
  // The source keeps its 2 pre-existing units of untracked legacy stock on
  // branch_stock (4) beyond the 2 still in lot B -- that residual gap existed
  // before the transfer and is conserved, not created by the move.
  assert.strictEqual(stockQty(db, 1) - (lotQty(db, 101, 1) + lotQty(db, 102, 1)), 2, 'only the pre-existing 2-unit untracked residual stays unattributed at source')
})

await check('legacy stock the lot ledger never tracked moves on branch_stock alone -- drift is conserved, never created', async () => {
  const db = freshDb()
  const { statements, takes, uncovered } = await composeBranchTransferStatements(db, 12)
  assert.strictEqual(takes.reduce((sum, t) => sum + t.quantity, 0), 10)
  assert.strictEqual(uncovered, 2, 'the 2 untracked units are not attributable to a lot')
  await wrapDb(db).batch(statements)
  assert.strictEqual(stockQty(db, 1), 0)
  assert.strictEqual(lotQty(db, 101, 1) + lotQty(db, 102, 1), 0)
  assert.strictEqual(stockQty(db, 2), 12)
  assert.strictEqual(lotQty(db, 101, 2) + lotQty(db, 102, 2), 10, 'same 2-unit legacy gap as the source, nothing new minted')
})

await check('strict decrement makes a concurrent lot drain abort-and-rollback, never minting destination drift', async () => {
  const db = freshDb()
  // Availability is read (lot A = 6) and the take built for a transfer of 8...
  const { statements, takes } = await composeBranchTransferStatements(db, 8)
  assert.deepStrictEqual(takes.map((t) => [t.batchId, t.quantity]), [[101, 6], [102, 2]])
  // ...then a concurrent sale drains lot A to 3 before this batch applies. The
  // take still says "decrement A by 6": strict subtraction underflows past the
  // CHECK(quantity >= 0) and must abort the WHOLE batch. A clamped decrement
  // would instead floor A at 0 while the destination still gained 6 -- +3
  // phantom units, the exact per-lot drift this fix exists to prevent.
  db.prepare('UPDATE branch_batch_stock SET quantity = 3 WHERE batch_id = 101 AND branch_id = 1').run()
  await assert.rejects(wrapDb(db).batch(statements), 'strict oversell must reject, not clamp')
  // Fully rolled back: nothing moved at either branch, destination never minted.
  assert.strictEqual(lotQty(db, 101, 1), 3, 'source lot A holds the concurrently-drained value')
  assert.strictEqual(lotQty(db, 102, 1), 4)
  assert.strictEqual(stockQty(db, 1), 12, 'source branch total unchanged (batch rolled back)')
  assert.strictEqual(stockQty(db, 2), 0, 'destination branch total unchanged')
  assert.strictEqual(lotQty(db, 101, 2) + lotQty(db, 102, 2), 0, 'no phantom destination lot minted')
})

await check('source lock: BOTH /transfer and /transfer-bulk auto-allocate FIFO for the no-batchId path (strict decrement, materializing the destination lot)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')

  const single = routeBody(src, "app.post('/transfer',")
  assert.ok(/readFifoLotAvailability\(db, productId, fromBranchId\)/.test(single), '/transfer must read source-lot availability for the no-batch path')
  assert.ok(/allocateAcrossLots\(sourceLots, quantity\)/.test(single), '/transfer must allocate FIFO across the source lots')
  assert.ok(/incrementBatchStockStatement\(destLotId, toBranchId, take\.quantity\)/.test(single), '/transfer must materialize the destination lot per take')

  const bulk = routeBody(src, "app.post('/transfer-bulk',")
  assert.ok(/readFifoLotAvailability\(db, item\.productId, fromBranchId\)/.test(bulk), '/transfer-bulk must read source-lot availability per no-batch item')
  assert.ok(/allocateAcrossLots\(sourceLots, item\.quantity\)/.test(bulk), '/transfer-bulk must allocate FIFO across the source lots')
  assert.ok(/incrementBatchStockStatement\(destLotId, toBranchId, take\.quantity\)/.test(bulk), '/transfer-bulk must materialize the destination lot per take')

  // The FIFO legs use the STRICT decrement (their availability read is outside
  // the atomic batch, so a concurrent drain must abort-and-retry, not clamp
  // into per-lot drift). Guards against a future edit swapping the clamped form
  // back in and silently re-opening the race.
  assert.ok(/decrementBatchStockStrictStatement\(take\.batchId, fromBranchId, take\.quantity\)/.test(single), '/transfer no-batch decrement must be the STRICT statement')
  assert.ok(/decrementBatchStockStrictStatement\(take\.batchId, fromBranchId, take\.quantity\)/.test(bulk), '/transfer-bulk no-batch decrement must be the STRICT statement')
  // ...while each route's EXPLICIT-batch leg (a user-picked lot whose quantity
  // may legitimately trail the branch total) stays CLAMPED.
  assert.ok(/decrementBatchStockStatement\(sourceBatch\.id, fromBranchId, quantity\)/.test(single), '/transfer explicit-batch leg stays clamped')
  assert.ok(/decrementBatchStockStatement\(sourceBatchForItem\.id, fromBranchId, item\.quantity\)/.test(bulk), '/transfer-bulk explicit-batch leg stays clamped')
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
