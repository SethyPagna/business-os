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
  db.exec(`
    CREATE TABLE product_batches (
      id INTEGER PRIMARY KEY, variant_product_id INTEGER NOT NULL,
      lot_code TEXT, expiry_date TEXT, received_at TEXT, batch_number INTEGER,
      is_active INTEGER DEFAULT 1, notes TEXT
    );
    -- Mirrors migration 0058's CHECK -- the strict decrement relies on it.
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
  assert.ok(/allocateAcrossLots\(sourceLots, quantity\)/.test(body), 'must allocate FIFO across the source lots')
  assert.ok(/decrementBatchStockStrictStatement\(take\.batchId, fromBranchId, take\.quantity\)/.test(body), 'source lot decrements must be STRICT (unclamped)')
  assert.ok(/incrementBatchStockStatement\(take\.batchId, toBranchId, take\.quantity\)/.test(body), 'destination gains the SAME batch ids')
  assert.ok(/takes\.length === 1 && uncovered === 0 \? takes\[0\]\.batchId : null/.test(body), '0084 blank-honest movement stamping')
})

}

main().then(() => {
  console.log(`\n${passed} check(s) passed.`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
