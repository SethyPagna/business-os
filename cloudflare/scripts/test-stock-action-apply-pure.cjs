// End-to-end test for the unified stock-action APPLY engine wiring
// (importEngine.ts::applyStockActionsJob). The atomic writers and the
// resolver are already covered by their own pure suites; this proves the
// glue that sits between them -- classify -> group -> dispatch -> finalize --
// against a real in-memory SQLite database:
//
//   * an `add` row receives batch/branch stock + a movement, one job row,
//     job finishes 'completed'
//   * a `create` row inserts the product and seeds its initial stock
//   * a `sale` group writes ONE receipt, deducts FIFO, and is idempotent on
//     a whole-job retry (no double receipt / double deduction)
//   * an oversell sale fails ONLY its own group (completed_with_errors), the
//     other units still apply, and the failed group leaves NO partial rows
//   * a sale group with an unresolved sibling line fails wholesale -- never a
//     partial receipt
//
// Loads the REAL transpiled importEngine.ts and its stock-action
// dependencies, exactly like the other *-pure.cjs suites, so it exercises the
// shipping code and not a re-implementation.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const libDir = path.join(__dirname, '..', 'src', 'lib')
const migrationsDir = path.join(__dirname, '..', 'migrations')

// Modules loaded for real (basename, resolved from src/lib). Everything the
// apply path actually calls into -- the writers, resolver, catalog bridge,
// and their pure helpers -- plus the same real deps importEngine needs just
// to finish loading (mirrors test-import-engine-pure.cjs's real set).
const REAL = new Set([
  'batchCode', 'importNumbers', 'stockActionResolver', 'stockActionImport',
  'stockActionCatalog', 'stockActionCommit', 'sqlBinding', 'productDetailRule',
  // productIdentity holds identityBarcodeKeySql, the ONE SQL spelling of the
  // fold the bounded catalog query narrows with. Stubbed, this harness would
  // green over a query that never folds.
  'productIdentity',
  // N14-D's receipt gate is REAL here on purpose. Left to the inert `{}` stub
  // the resolver falls back to, every add row would call an undefined
  // stockReceiptGateCode and fail with a TypeError recorded as the row's
  // reason -- and a stub that returned '' instead would be worse: the suite
  // would green while proving nothing about the gate this wire now runs.
  'stockReceiptGate',
  'productDescriptionSections', 'productBatches', 'salesStatus', 'contactOptions',
  'importImageMatch', 'searchMatch',
])

// Functional stubs for the D1/Env/queue/cache/broadcast modules that can't
// run outside a Worker. The apply path only ever calls bumpVersion/broadcast
// (fire-and-forget), so those return resolved promises; the rest are inert.
const asyncNoop = async () => {}
const STUBS = {
  './cache': new Proxy({}, { get: () => asyncNoop }),
  '../durable-objects/broadcastHub': new Proxy({}, { get: () => asyncNoop }),
  './db': { getDb: (env) => env.DB },
  './importCsv': {},
  '../index': {},
  './stockActionSeal': new Proxy({}, { get: () => async () => 0 }),
}

const realCache = new Map()
function transpile(abs) {
  return ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: abs,
  }).outputText
}
function makeRequire(fromDir) {
  return function localRequire(request) {
    if (request.startsWith('.')) {
      const base = path.basename(request)
      if (REAL.has(base)) return loadReal(base)
      if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request]
      return {} // unrelated local import not on the apply path -- inert stub
    }
    return require(request) // real npm package (typescript, etc.)
  }
}
function loadReal(base) {
  if (realCache.has(base)) return realCache.get(base)
  const abs = path.join(libDir, base + '.ts')
  const mod = { exports: {} }
  realCache.set(base, mod.exports) // seed before eval so any cycle resolves
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(abs))(
    mod.exports, makeRequire(path.dirname(abs)), mod, abs, path.dirname(abs),
  )
  realCache.set(base, mod.exports)
  return mod.exports
}

// Load the real importEngine.ts under the same resolver.
const engineAbs = path.join(libDir, 'importEngine.ts')
const engineMod = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(engineAbs))(
  engineMod.exports, makeRequire(libDir), engineMod, engineAbs, libDir,
)
const { applyStockActionsJob, runImportApply, STOCK_ACTION_MAX_ROWS, STOCK_ACTION_MAX_UNITS } = engineMod.exports
assert.strictEqual(typeof applyStockActionsJob, 'function', 'applyStockActionsJob must be exported')
assert.strictEqual(typeof runImportApply, 'function', 'runImportApply must be exported')
// A4: the boundary fixtures below seed RELATIVE to the real caps so a
// deliberate future re-base re-sizes them instead of silently pinning a
// stale number.
assert.ok(Number.isInteger(STOCK_ACTION_MAX_ROWS) && STOCK_ACTION_MAX_ROWS > 0, 'STOCK_ACTION_MAX_ROWS export missing')
assert.ok(Number.isInteger(STOCK_ACTION_MAX_UNITS) && STOCK_ACTION_MAX_UNITS > 0, 'STOCK_ACTION_MAX_UNITS export missing')

// --- In-memory D1 adapter ---------------------------------------------------
function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, name_normalized TEXT, barcode TEXT, unit TEXT, category TEXT, brand TEXT,
      selling_price_usd REAL DEFAULT 0, wholesale_price_usd REAL DEFAULT 0, cost_price_usd REAL DEFAULT 0,
      stock_quantity REAL DEFAULT 0, is_active INTEGER DEFAULT 1, client_request_id TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE UNIQUE INDEX ux_products_crid ON products(client_request_id) WHERE client_request_id IS NOT NULL;
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    -- The supplier column on an add row is match-only (migration 0062): the
    -- engine looks the as-entered name up here and keeps the text with a NULL
    -- id when it matches nothing. Every add row carries a supplier now that the
    -- receipt gate requires one, so this lookup is on the hot path.
    CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0, UNIQUE(product_id, branch_id));
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, expiry_date TEXT, received_at TEXT, is_active INTEGER DEFAULT 1,
      notes TEXT, batch_number INTEGER, supplier_id INTEGER, supplier_name TEXT, unit_cost_usd REAL, payment_status TEXT, credit_due_date TEXT, received_quantity REAL, received_branch_id INTEGER, received_cost_usd REAL, created_at TEXT, updated_at TEXT);
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, client_request_id TEXT UNIQUE,
      cashier_name TEXT, branch_id INTEGER, branch_name TEXT, payment_method TEXT, payment_currency TEXT,
      subtotal_usd REAL, total_usd REAL, amount_paid_usd REAL, sale_status TEXT, notes TEXT, items TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER,
      product_name TEXT, quantity REAL, unit TEXT, applied_price_usd REAL, cost_price_usd REAL, total_usd REAL,
      branch_id INTEGER, price_mode TEXT, base_price_usd REAL, batch_id INTEGER, batch_label TEXT, batch_expiry_date TEXT);
    CREATE TABLE sale_item_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_item_id INTEGER,
      batch_id INTEGER, branch_id INTEGER, quantity REAL, lot_code TEXT, expiry_date TEXT);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT,
      branch_id INTEGER, branch_name TEXT, movement_type TEXT, quantity REAL, unit_cost_usd REAL, total_cost_usd REAL,
      reason TEXT, reference_id INTEGER, created_at TEXT, batch_id INTEGER);
    CREATE TABLE import_jobs (id TEXT PRIMARY KEY, type TEXT, policy_json TEXT, status TEXT, phase TEXT,
      started_at TEXT, materialize_state_json TEXT, materialize_done INTEGER DEFAULT 0,
      processed_rows INTEGER DEFAULT 0, failed_rows INTEGER DEFAULT 0, warning_count INTEGER DEFAULT 0,
      summary_json TEXT, finished_at TEXT, cancel_requested INTEGER DEFAULT 0, updated_at TEXT,
      lease_token TEXT, lease_expires_at TEXT, chunk_cursor INTEGER DEFAULT 0, chunk_state_json TEXT);
    CREATE TABLE import_job_source_rows (job_id TEXT, sequence INTEGER, row_number INTEGER, data_json TEXT);
    CREATE TABLE import_job_rows (job_id TEXT, phase TEXT, row_number INTEGER, group_index INTEGER,
      action TEXT, identifier TEXT, result_json TEXT, PRIMARY KEY(job_id, phase, row_number));
  `)
  sqlite.exec(fs.readFileSync(path.join(migrationsDir, '0056_import_stock_action_commits.sql'), 'utf8'))
  sqlite.exec(fs.readFileSync(path.join(migrationsDir, '0057_import_stock_action_guards.sql'), 'utf8'))
  sqlite.exec(fs.readFileSync(path.join(migrationsDir, '0063_import_stock_action_groups.sql'), 'utf8'))
  sqlite.exec(`
    INSERT INTO branches(id, name, is_active) VALUES (1, 'Shop', 1), (2, 'Warehouse', 1);
  `)
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        get: (p) => Promise.resolve(stmt.get(p || {})),
        all: (p) => Promise.resolve(stmt.all(p || {})),
        run: (p) => { const i = stmt.run(p || {}); return Promise.resolve({ changes: i.changes, lastInsertRowid: Number(i.lastInsertRowid) }) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))
      return Promise.resolve(run())
    },
  }
  // import staging tables route through D1Compat.staging; single-DB mock -> self.
  db.staging = db
  return { sqlite, db }
}

function seedProduct(sqlite, { id, name, barcode, cost = 0, sell = 0, shop = 0, warehouse = 0 }) {
  sqlite.prepare(`INSERT INTO products(id, name, name_normalized, barcode, unit, selling_price_usd, cost_price_usd, stock_quantity, is_active)
    VALUES (?, ?, ?, ?, 'pcs', ?, ?, ?, 1)`).run(id, name, String(name).trim().toLowerCase().replace(/\s+/g, ' '), barcode || null, sell, cost, shop + warehouse)
  sqlite.prepare(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (?, 1, ?)`).run(id, shop)
  sqlite.prepare(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (?, 2, ?)`).run(id, warehouse)
}
function seedBatch(sqlite, { id, productId, key, lot, expiry, received, branch = 1, qty }) {
  sqlite.prepare(`INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, batch_number)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`).run(id, productId, key, lot, expiry || null, received, id)
  sqlite.prepare(`INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)`).run(id, branch, qty)
}

function seedJob(sqlite, jobId, rows, policy) {
  sqlite.prepare(`INSERT INTO import_jobs(id, type, policy_json, status, phase, started_at, materialize_done)
    VALUES (?, 'stock_actions', ?, 'applying', 'applying', datetime('now'), 1)`).run(jobId, JSON.stringify(policy || {}))
  rows.forEach((row, index) => {
    sqlite.prepare(`INSERT INTO import_job_source_rows(job_id, sequence, row_number, data_json) VALUES (?, ?, ?, ?)`)
      .run(jobId, index, row._rowNumber ?? index + 2, JSON.stringify(row))
  })
}

const env = { IMPORT_QUEUE: { send: async () => {} } }
const sw = { lap() {}, marks: {} }

// DIRECT mode is a continuation engine (M4): each invocation does one window
// of classify or dispatch and self-enqueues the next. This pump simulates
// Cloudflare Queues delivering those continuation messages until the job
// stops asking for more; the LAST invocation reports the real totals.
async function runJobToCompletion(db, jobId, policy, { maxInvocations = 1000 } = {}) {
  const queue = []
  const pumpEnv = { IMPORT_QUEUE: { send: async (message) => { queue.push(message) } } }
  let invocations = 1
  let out = await applyStockActionsJob(pumpEnv, db, jobId, policy, sw, undefined)
  while (queue.length) {
    if (++invocations > maxInvocations) throw new Error('continuation did not terminate')
    queue.shift()
    out = await applyStockActionsJob(pumpEnv, db, jobId, policy, sw, undefined)
  }
  return { out, invocations }
}

let failures = 0
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failures += 1; console.error(`FAIL ${name}`); console.error(error) }
}

;(async () => {
  // 1) A plain add row -----------------------------------------------------
  await test('an add row receives batch + branch stock and finishes completed', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 10, name: 'Serum', barcode: 'S10', cost: 4, sell: 12 })
    seedJob(sqlite, 'job-add', [
      { _rowNumber: 2, name: 'Serum', barcode: 'S10', shop: '5', warehouse: '', date: '08/27/2026', action: 'add', selling_price: '', vip_price: '', cost_price: '4', supplier: 'Bong Long', batch: 'AUG' },
    ], { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-add', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: 1, failed: 0 })
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1`).get().quantity, 5)
    assert.strictEqual(sqlite.prepare(`SELECT stock_quantity FROM products WHERE id=10`).get().stock_quantity, 5)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='add'`).get().n, 1)
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-add'`).get().status, 'completed')
  })

  // 2) A create row --------------------------------------------------------
  await test('a create row inserts the product and seeds its initial stock', async () => {
    const { sqlite, db } = makeDb()
    seedJob(sqlite, 'job-new', [
      { _rowNumber: 2, name: 'Brand New Balm', barcode: 'BNB1', shop: '7', warehouse: '', date: '2026-08-27', action: 'create', selling_price: '9', vip_price: '', cost_price: '3', supplier: 'Bong Long', batch: '' },
    ], { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-new', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: 1, failed: 0 })
    const product = sqlite.prepare(`SELECT id, stock_quantity, selling_price_usd, cost_price_usd FROM products WHERE name='Brand New Balm'`).get()
    assert.ok(product && product.id > 0, 'product created')
    assert.strictEqual(product.stock_quantity, 7)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1`).get(product.id).quantity, 7)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=?`).get(product.id).n, 1)
  })

  // 3) A sale group: one receipt, FIFO, idempotent on retry ----------------
  await test('a sale group writes one FIFO receipt and is idempotent on whole-job retry', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 20, name: 'Cream', barcode: 'C20', cost: 5, sell: 15, shop: 8 })
    seedBatch(sqlite, { id: 201, productId: 20, key: 'early', lot: 'EARLY', expiry: '2026-12-31', received: '2026-01-01', branch: 1, qty: 3 })
    seedBatch(sqlite, { id: 202, productId: 20, key: 'late', lot: 'LATE', expiry: '2027-12-31', received: '2026-02-01', branch: 1, qty: 5 })
    const rows = [
      { _rowNumber: 2, name: 'Cream', barcode: 'C20', shop: '2', warehouse: '', date: '08/27/2026', action: 'sale2', selling_price: '15', vip_price: '', cost_price: '', batch: '' },
      { _rowNumber: 3, name: 'Cream', barcode: 'C20', shop: '3', warehouse: '', date: '08/27/2026', action: 'sale2', selling_price: '15', vip_price: '', cost_price: '', batch: '' },
    ]
    seedJob(sqlite, 'job-sale', rows, { stock_action_mode: 'direct' })
    const policy = JSON.stringify({ stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-sale', policy)
    assert.deepStrictEqual(out, { applied: 2, failed: 0 })
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sales`).get().n, 1, 'one receipt for the group')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 2)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=20 AND branch_id=1`).get().quantity, 3)
    // FIFO by expiry: the 3-unit EARLY lot empties first, then 2 of the 5
    // units come from LATE -> EARLY 0, LATE 3. Total sold across the group = 5.
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id=201`).get().quantity, 0)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id=202`).get().quantity, 3)

    // Whole-job retry (a redelivery / crash-resume) must not double anything.
    const { out: retry } = await runJobToCompletion(db, 'job-sale', policy)
    assert.deepStrictEqual(retry, { applied: 2, failed: 0 })
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sales`).get().n, 1, 'retry does not add a second receipt')
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=20 AND branch_id=1`).get().quantity, 3)
  })

  // 4) Oversell isolates to its own group ----------------------------------
  await test('an oversell sale fails only its group; other units still apply; no partial rows', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 30, name: 'Toner', barcode: 'T30', cost: 2, sell: 8, shop: 1 }) // only 1 in stock
    seedProduct(sqlite, { id: 31, name: 'Mist', barcode: 'M31', cost: 3, sell: 9, shop: 0 })
    const rows = [
      // sale1: oversell (wants 5, only 1) -> whole group fails
      { _rowNumber: 2, name: 'Toner', barcode: 'T30', shop: '5', warehouse: '', date: '08/27/2026', action: 'sale1', selling_price: '8', vip_price: '', cost_price: '', batch: '' },
      // an independent add of a different product -> must still apply
      { _rowNumber: 3, name: 'Mist', barcode: 'M31', shop: '4', warehouse: '', date: '08/27/2026', action: 'add', selling_price: '', vip_price: '', cost_price: '4', supplier: 'Bong Long', batch: '' },
    ]
    seedJob(sqlite, 'job-mix', rows, { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-mix', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.strictEqual(out.failed, 1, 'the oversell group is one failed row')
    assert.strictEqual(out.applied, 1, 'the independent add still applied')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sales`).get().n, 0, 'no partial receipt from the failed group')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=30 AND branch_id=1`).get().quantity, 1, 'oversold product untouched')
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=31 AND branch_id=1`).get().quantity, 4, 'the add landed')
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-mix'`).get().status, 'completed_with_errors')
  })

  // 5) A poisoned sale group (unresolved sibling) fails wholesale ----------
  await test('a sale group with an unresolved sibling line fails wholesale -- never partial', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 40, name: 'Wax', barcode: 'W40', cost: 2, sell: 10, shop: 20 })
    const rows = [
      // good line of the receipt
      { _rowNumber: 2, name: 'Wax', barcode: 'W40', shop: '2', warehouse: '', date: '08/27/2026', action: 'sale3', selling_price: '10', vip_price: '', cost_price: '', batch: '' },
      // sibling line of the SAME receipt but unresolved (no product matches) -> blocks
      { _rowNumber: 3, name: 'Ghost Product That Does Not Exist', barcode: 'ZZZ', shop: '1', warehouse: '', date: '08/27/2026', action: 'sale3', selling_price: '10', vip_price: '', cost_price: '', batch: '' },
    ]
    seedJob(sqlite, 'job-poison', rows, { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-poison', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM sales`).get().n, 0, 'no receipt at all -- the good line is not committed alone')
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=40 AND branch_id=1`).get().quantity, 20, 'stock untouched')
    assert.ok(out.failed >= 1, 'the group is reported as failed')
  })

  // 6) DIRECT continuation (M4): more than one unit-cap's worth of units
  // loads across invocations
  await test('a direct sheet beyond the unit cap applies fully across continuation invocations', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 50, name: 'Bounded', barcode: 'B50' })
    // Two full dispatch windows + 10: one-or-two classify windows, then
    // three dispatch windows (cap + cap + 10) -- the unit cap is also the
    // per-invocation dispatch window (see the engine's own comment).
    // Distinct batch labels so each row makes its own lot.
    const CONTINUE_UNITS = STOCK_ACTION_MAX_UNITS * 2 + 10
    const rows = Array.from({ length: CONTINUE_UNITS }, (_, index) => ({
      _rowNumber: index + 2, name: 'Bounded', barcode: 'B50', shop: '1', warehouse: '',
      date: `2026-0${1 + (index % 6)}-${String(1 + (index % 27)).padStart(2, '0')}`,
      action: 'add', selling_price: '', vip_price: '', cost_price: '4', supplier: 'Bong Long', batch: `L${index}`,
    }))
    seedJob(sqlite, 'job-continue', rows, { stock_action_mode: 'direct' })
    const { out, invocations } = await runJobToCompletion(db, 'job-continue', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: CONTINUE_UNITS, failed: 0 })
    assert.ok(invocations >= 4, `expected multiple continuation invocations, got ${invocations}`)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=50 AND branch_id=1`).get().quantity, CONTINUE_UNITS)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=50`).get().n, CONTINUE_UNITS)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='add'`).get().n, CONTINUE_UNITS)
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-continue'`).get().status, 'completed')
  })

  // 6b) Crash/redelivery mid-dispatch resumes without doubling stock -------
  await test('a redelivered continuation resumes exactly; no double-adds', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 51, name: 'Resumed', barcode: 'R51' })
    const rows = Array.from({ length: 75 }, (_, index) => ({
      _rowNumber: index + 2, name: 'Resumed', barcode: 'R51', shop: '1', warehouse: '',
      date: '2026-03-05', action: 'add', selling_price: '', vip_price: '', cost_price: '4', supplier: 'Bong Long', batch: `R${index}`,
    }))
    seedJob(sqlite, 'job-resume', rows, { stock_action_mode: 'direct' })
    const policy = JSON.stringify({ stock_action_mode: 'direct' })
    // classify invocation + FIRST dispatch window only (which may already
    // cover every unit when the sheet fits inside one window -- the
    // redelivery claims below hold either way)...
    await applyStockActionsJob(env, db, 'job-resume', policy, sw, undefined)
    await applyStockActionsJob(env, db, 'job-resume', policy, sw, undefined)
    // ...then simulate the crashed window's message being REDELIVERED twice
    // before the run continues to completion.
    const { out } = await runJobToCompletion(db, 'job-resume', policy)
    await applyStockActionsJob(env, db, 'job-resume', policy, sw, undefined)
    assert.deepStrictEqual(out, { applied: 75, failed: 0 })
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=51 AND branch_id=1`).get().quantity, 75, 'resume + redelivery never double-add')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements`).get().n, 75)
  })

  // 7) RECONCILE keeps the single-pass caps (one live-stock snapshot) ------
  await test('reconcile mode: more raw rows than the single-pass cap fail before classification', async () => {
    const { sqlite, db } = makeDb()
    const overRows = STOCK_ACTION_MAX_ROWS + 1
    const rows = Array.from({ length: overRows }, (_, index) => ({ _rowNumber: index + 2, name: `Raw ${index}` }))
    seedJob(sqlite, 'job-rows-bound', rows, { stock_action_mode: 'reconcile' })
    await assert.rejects(
      () => applyStockActionsJob(env, db, 'job-rows-bound', JSON.stringify({ stock_action_mode: 'reconcile' }), sw, undefined),
      new RegExp(`${overRows} rows[\\s\\S]*at most ${STOCK_ACTION_MAX_ROWS} rows`),
    )
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM import_job_rows`).get().n, 0)
  })

  // 7b) Reconcile unit ceiling still guards before any stock write ---------
  await test('reconcile mode: more business actions than the unit cap fail before any stock write', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 52, name: 'Bounded', barcode: 'B52' })
    const rows = Array.from({ length: STOCK_ACTION_MAX_UNITS + 1 }, (_, index) => ({
      _rowNumber: index + 2, name: 'Bounded', barcode: 'B52', shop: String(index + 1), warehouse: '',
      date: '08/27/2026', action: 'add', selling_price: '', vip_price: '', cost_price: '4', supplier: 'Bong Long', batch: '',
    }))
    seedJob(sqlite, 'job-units-bound', rows, { stock_action_mode: 'reconcile' })
    await assert.rejects(
      () => applyStockActionsJob(env, db, 'job-units-bound', JSON.stringify({ stock_action_mode: 'reconcile' }), sw, undefined),
      new RegExp(`actions[\\s\\S]*at most ${STOCK_ACTION_MAX_UNITS} actions`),
    )
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=52 AND branch_id=1`).get().quantity, 0)
  })

  // 7c) The direct-mode ceiling exists too, far higher ---------------------
  await test('direct mode: more than 25,000 raw rows fail with the split instruction', async () => {
    const { sqlite, db } = makeDb()
    sqlite.prepare(`INSERT INTO import_jobs(id, type, policy_json, status, phase, started_at, materialize_done)
      VALUES ('job-direct-bound', 'stock_actions', '{"stock_action_mode":"direct"}', 'applying', 'applying', datetime('now'), 1)`).run()
    const insert = sqlite.prepare(`INSERT INTO import_job_source_rows(job_id, sequence, row_number, data_json) VALUES ('job-direct-bound', ?, ?, '{}')`)
    const bulk = sqlite.transaction(() => { for (let i = 0; i < 25001; i++) insert.run(i, i + 2) })
    bulk()
    await assert.rejects(
      () => applyStockActionsJob(env, db, 'job-direct-bound', JSON.stringify({ stock_action_mode: 'direct' }), sw, undefined),
      /25001 rows.*25000 rows/,
    )
  })

  // 8) Queue-entry cancellation happens before materialization/classify/write
  await test('runImportApply honors cancellation before any stock action', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 60, name: 'Cancelled', barcode: 'C60' })
    seedJob(sqlite, 'job-cancel', [
      { _rowNumber: 2, name: 'Cancelled', barcode: 'C60', shop: '5', warehouse: '', date: '08/27/2026', action: 'add', cost_price: '4', supplier: 'Bong Long' },
    ], { stock_action_mode: 'direct' })
    sqlite.prepare(`UPDATE import_jobs SET cancel_requested=1, status='applying', phase='applying' WHERE id='job-cancel'`).run()
    const out = await runImportApply({ ...env, DB: db }, 'job-cancel')
    assert.deepStrictEqual(out, { applied: 0, failed: 0 })
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-cancel'`).get().status, 'cancelled')
    assert.strictEqual(sqlite.prepare(`SELECT lease_token FROM import_jobs WHERE id='job-cancel'`).get().lease_token, null)
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=60 AND branch_id=1`).get().quantity, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements`).get().n, 0)
  })

  // 9) N14-D on the FOURTH wire, end to end --------------------------------
  // The three interactive wires refuse a stock-in that names no supplier and
  // carries no cost. This one did not, and it is the only wire that can write
  // 20,000 such receipts unattended. The refusal must reach the row's own
  // reason (failed-action-keeps-the-form: the operator reads it in the
  // finished report and re-uploads the fixed sheet), the job must finish
  // instead of aborting, and the refused row must leave the ledger untouched.
  await test('an import add with no supplier and no cost is refused, and the sheet keeps going', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 70, name: 'Ungated', barcode: 'U70' })
    seedProduct(sqlite, { id: 71, name: 'Complete', barcode: 'C71' })
    seedJob(sqlite, 'job-gate', [
      // no supplier column, no cost column -- the receipt every other wire refuses
      { _rowNumber: 2, name: 'Ungated', barcode: 'U70', shop: '5', warehouse: '', date: '08/27/2026', action: 'add' },
      // a complete receipt on the same sheet still lands: one bad row is one bad row
      { _rowNumber: 3, name: 'Complete', barcode: 'C71', shop: '4', warehouse: '', date: '08/27/2026', action: 'add', cost_price: '6', supplier: 'Bong Long' },
    ], { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-gate', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: 1, failed: 1 })
    const refused = JSON.parse(sqlite.prepare(`SELECT result_json FROM import_job_rows WHERE job_id='job-gate' AND row_number=2`).get().result_json)
    assert.strictEqual(refused.action, 'error')
    // The SAME sentence POST /adjust, POST /api/batches and the stock-in
    // session return -- not an import-only paraphrase.
    assert.match(refused.message, /A stock-in must name the supplier the goods came from/)
    // Nothing of the refused receipt reached the ledger.
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=70 AND branch_id=1`).get().quantity, 0)
    assert.strictEqual(sqlite.prepare(`SELECT stock_quantity FROM products WHERE id=70`).get().stock_quantity, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=70`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE product_id=70`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM import_stock_action_commits WHERE row_number=2`).get().n, 0)
    // ...and the complete row on the same sheet is untouched by its neighbour.
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=71 AND branch_id=1`).get().quantity, 4)
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-gate'`).get().status, 'completed_with_errors')
  })

  // 10) ...and the gate stops at the receipts. A create row whose branch
  // columns are an explicit 0 registers a product and writes NO stock: there
  // is no receipt, so there is nothing for a supplier or a cost to describe.
  // Refusing it would make the gate reject rows that put nothing in.
  await test('a create row with zero stock is not a receipt, so the gate lets it through', async () => {
    const { sqlite, db } = makeDb()
    seedJob(sqlite, 'job-zero', [
      { _rowNumber: 2, name: 'Catalog Only', barcode: 'CO72', shop: '0', warehouse: '0', date: '2026-08-27', action: 'create', selling_price: '9' },
    ], { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-zero', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: 1, failed: 0 })
    const created = sqlite.prepare(`SELECT id, stock_quantity FROM products WHERE barcode='CO72'`).get()
    assert.ok(created && created.id > 0, 'the product is registered')
    assert.strictEqual(created.stock_quantity, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches`).get().n, 0, 'no lot, because no receipt')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements`).get().n, 0)
  })

  // 11) RECONCILE mode's upward delta is an ADD, and the gate runs on it too.
  // Before this test, no case anywhere applied a reconcile-mode increase --
  // stockActionResolver.ts turns a counted rise into an 'add' plan, which
  // dispatchStockActionSingle routes through the exact same applyUnifiedStockAdd
  // writer a direct-mode add uses. Proved here rather than inferred: a stock-
  // take sheet with no supplier/cost columns must refuse the raised rows and
  // leave the ledger at its PRE-import count, not silently apply an
  // unattributed receipt.
  await test('reconcile mode: a counted increase is an add, and the receipt gate refuses it', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 80, name: 'Counted', barcode: 'CT80', shop: 3 })
    seedJob(sqlite, 'job-reconcile-gate', [
      // Counted total 10 against 3 on hand -- a +7 add, no supplier, no cost.
      { _rowNumber: 2, name: 'Counted', barcode: 'CT80', shop: '10', warehouse: '', date: '08/27/2026', action: '' },
    ], { stock_action_mode: 'reconcile' })
    const { out } = await runJobToCompletion(db, 'job-reconcile-gate', JSON.stringify({ stock_action_mode: 'reconcile' }))
    assert.deepStrictEqual(out, { applied: 0, failed: 1 })
    const refused = JSON.parse(sqlite.prepare(`SELECT result_json FROM import_job_rows WHERE job_id='job-reconcile-gate' AND row_number=2`).get().result_json)
    assert.strictEqual(refused.action, 'error')
    assert.match(refused.message, /A stock-in must name the supplier the goods came from/)
    // The ledger stays at the PRE-import count -- refused, not partially applied.
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=80 AND branch_id=1`).get().quantity, 3)
    assert.strictEqual(sqlite.prepare(`SELECT stock_quantity FROM products WHERE id=80`).get().stock_quantity, 3)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=80`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE product_id=80`).get().n, 0)
    assert.strictEqual(sqlite.prepare(`SELECT status FROM import_jobs WHERE id='job-reconcile-gate'`).get().status, 'completed_with_errors')
  })

  // 12) Two add rows sharing one lot (same product + batchIdentity's
  // date/label key): a blank-supplier row must inherit the lot's first
  // attribution rather than being refused. Before the fix at commit
  // 2d27a570 -- which introduced applyUnifiedStockAdd's lot_supplier_name
  // read without yet serializing same-lot dispatch -- this file's job-race
  // case failed with { applied: 1, failed: 1 }: the second row's read of
  // the lot could land in either order relative to the first row's INSERT,
  // and one of those two orders refuses it. Correction to an earlier draft
  // of this comment: base 6e3abfea passes this exact case trivially, not
  // because it handles the race correctly, but because stockActionCommit.ts
  // had no receipt gate at all yet (sibling:F13's whole point) -- nothing
  // there could refuse either row regardless of read order. And because
  // this harness's D1 stub is synchronous better-sqlite3, applyUnifiedStockAdd's
  // read and write can never actually interleave here regardless of dispatch
  // order, so no scheduling-dependence is observable in THIS harness at
  // all. What this case actually pins is the narrower, harness-provable
  // half of the fix: pendingLotKeys makes a second same-lot row wait for
  // the first, so it inherits the first row's supplier instead of being
  // refused by it.
  await test('a second blank-supplier row of the same lot inherits the first row\'s supplier instead of being refused', async () => {
    const buildRows = () => [
      // Row 2 supplies the lot; row 3 (same product+date+batch => same lot)
      // does not. Sequentially this always tops up an already-attributed lot
      // (deferred, so it is complete); concurrently the blank row can read the
      // lot BEFORE row 2's INSERT commits and get refused instead.
      { _rowNumber: 2, name: 'Raced', barcode: 'RC90', shop: '2', warehouse: '', date: '08/27/2026', action: 'add', cost_price: '4', supplier: 'Bong Long', batch: 'RACE-LOT' },
      { _rowNumber: 3, name: 'Raced', barcode: 'RC90', shop: '0', warehouse: '3', date: '08/27/2026', action: 'add', cost_price: '4', batch: 'RACE-LOT' },
    ]
    const runOnce = async () => {
      const { sqlite, db } = makeDb()
      seedProduct(sqlite, { id: 90, name: 'Raced', barcode: 'RC90' })
      seedJob(sqlite, 'job-race', buildRows(), { stock_action_mode: 'direct' })
      const { out } = await runJobToCompletion(db, 'job-race', JSON.stringify({ stock_action_mode: 'direct' }))
      return out
    }
    const first = await runOnce()
    const second = await runOnce()
    assert.deepStrictEqual(first, second, 'the same file must not import differently run to run')
    assert.deepStrictEqual(first, { applied: 2, failed: 0 }, 'both rows of one lot land: the blank row inherits the lot supplier, never a race')
  })

  // 13) An existing product's catalog cost must never fill a blank cost_price
  // cell for the RECEIPT GATE. stockActionImport.ts's costPriceUsd inherits
  // matched.product.cost_price_usd so the product-price columns stay filled
  // on a bare add, but before sheetCostPriceUsd existed that same inherited
  // value fed the gate too -- so a sheet with a supplier column and NO
  // cost_price column at all resolved a $5 catalog cost into an ACCEPTED
  // receipt cost the operator never typed. Discriminating: this case passes
  // wrongly (applied:1) against the pre-fix code, because cost.value ??
  // matched.product?.cost_price_usd ?? null hands the gate the catalog's 5.
  await test('an existing product\'s catalog cost never fills a blank cost_price cell for the receipt gate', async () => {
    const { sqlite, db } = makeDb()
    seedProduct(sqlite, { id: 95, name: 'Catalog Serum', barcode: 'CS95', cost: 5 })
    seedJob(sqlite, 'job-catalog-cost', [
      // No cost_price key at all: the sheet states a supplier but never
      // types a cost for this row.
      { _rowNumber: 2, name: 'Catalog Serum', barcode: 'CS95', shop: '4', warehouse: '', date: '08/27/2026', action: 'add', supplier: 'Bong Long', batch: 'CATALOG-LOT' },
    ], { stock_action_mode: 'direct' })
    const { out } = await runJobToCompletion(db, 'job-catalog-cost', JSON.stringify({ stock_action_mode: 'direct' }))
    assert.deepStrictEqual(out, { applied: 0, failed: 1 })
    const refused = JSON.parse(sqlite.prepare(`SELECT result_json FROM import_job_rows WHERE job_id='job-catalog-cost' AND row_number=2`).get().result_json)
    assert.match(refused.message, /must carry its unit cost/, 'refused for cost, not supplier -- the supplier column IS filled')
    assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id=95 AND branch_id=1`).get().quantity, 0, 'branch_stock unchanged')
    assert.strictEqual(sqlite.prepare(`SELECT stock_quantity FROM products WHERE id=95`).get().stock_quantity, 0, 'products.stock_quantity unchanged')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=95`).get().n, 0, 'no lot minted from the catalog cost')
    assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) n FROM inventory_movements WHERE product_id=95`).get().n, 0)
  })

  if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1) }
  console.log('\nAll stock-action apply-engine tests passed')
})().catch((error) => { console.error(error); process.exit(1) })
