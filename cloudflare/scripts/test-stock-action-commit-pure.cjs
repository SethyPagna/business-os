const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const batchCode = compile('batchCode.ts')
const searchMatch = compile('searchMatch.ts')
// The REAL gate kernel, not a stub: the import writer must refuse exactly
// what routes/inventory.ts, routes/batches.ts and lib/stockSession.ts refuse.
const stockReceiptGate = compile('stockReceiptGate.ts')
const subject = compile('stockActionCommit.ts', { './db': {}, './batchCode': batchCode, './searchMatch': searchMatch, './stockReceiptGate': stockReceiptGate })

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, name_normalized TEXT, barcode TEXT, unit TEXT, stock_quantity REAL DEFAULT 0,
      selling_price_usd REAL DEFAULT 0, wholesale_price_usd REAL DEFAULT 0, cost_price_usd REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1, client_request_id TEXT UNIQUE, created_at TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      UNIQUE(product_id, branch_id));
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, received_at TEXT, is_active INTEGER, notes TEXT, batch_number INTEGER, supplier_id INTEGER, supplier_name TEXT, unit_cost_usd REAL, payment_status TEXT, credit_due_date TEXT, received_quantity REAL, received_branch_id INTEGER, received_cost_usd REAL,
      UNIQUE(variant_product_id, batch_key), UNIQUE(variant_product_id, batch_number));
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER,
      product_name TEXT, branch_id INTEGER, branch_name TEXT, movement_type TEXT, quantity REAL,
      unit_cost_usd REAL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
      reason TEXT, reference_id INTEGER, created_at TEXT, batch_id INTEGER);
  `)
  sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0056_import_stock_action_commits.sql'), 'utf8'))
  sqlite.prepare(`INSERT INTO products(id, name) VALUES (10, 'Serum')`).run()
  sqlite.prepare(`INSERT INTO branches(id, name) VALUES (1, 'Shop'), (2, 'Warehouse')`).run()

  const db = {
    prepare(sql) {
      return {
        get(params) { return Promise.resolve(sqlite.prepare(sql).get(params)) },
        run(params) { const info = sqlite.prepare(sql).run(params); return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params)))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

// A complete receipt: N14-D requires a stock-in to name its supplier AND its
// unit cost on EVERY wire, and the import is the fourth one.
const input = {
  jobId: 'job-1', rowNumber: 2, productId: 10, productName: 'Serum',
  branchId: 1, branchName: 'Shop', quantity: 2, date: '08/27/2026',
  batchLabel: 'LOT A', sellingPriceUsd: 12.345, wholesalePriceUsd: 10, costPriceUsd: 5,
  supplierName: 'Bong Long',
}

// The lot this input's date+label resolves to, for seeding an EXISTING lot.
const LOT_KEY = 'lot a'
function seedLot(sqlite, { supplierName = null, supplierId = null } = {}) {
  sqlite.prepare(`INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_id, supplier_name)
                  VALUES (10, @batchKey, 'LOT A', '2026-08-27', 1, 1, @supplierId, @supplierName)`)
    .run({ batchKey: LOT_KEY, supplierId, supplierName })
}

;(async () => {
  const { sqlite, db } = setup()
  const first = await subject.applyUnifiedStockAdd(db, input)
  const retry = await subject.applyUnifiedStockAdd(db, input)
  assert.strictEqual(first.alreadyApplied, false)
  assert.strictEqual(retry.alreadyApplied, true)
  assert.deepStrictEqual(sqlite.prepare(`SELECT stock_quantity, selling_price_usd, wholesale_price_usd, cost_price_usd FROM products WHERE id = 10`).get(), {
    stock_quantity: 2, selling_price_usd: 12.35, wholesale_price_usd: 10, cost_price_usd: 0,
  }, 'receipt cost is historical; it never overwrites the catalog cost')
  assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 2)
  assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_batch_stock`).get().quantity, 2)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 1)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements`).get().n, 1)
  assert.deepStrictEqual(sqlite.prepare(`SELECT unit_cost_usd, total_cost_usd FROM inventory_movements`).get(), {
    unit_cost_usd: 5, total_cost_usd: 10,
  }, 'movement retains this receipt\'s own cost')
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits WHERE status = 'applied'`).get().n, 1)

  await assert.rejects(() => subject.applyUnifiedStockAdd(db, { ...input, rowNumber: 3, quantity: -1 }), /greater than 0/)

  // Supplier lands on the BATCH (migration 0062): a supplied add attributes
  // the lot; a later add to the same lot with a DIFFERENT supplier never
  // overwrites the first attribution; a blank supplier changes nothing.
  const supplied = setup()
  await subject.applyUnifiedStockAdd(supplied.db, { ...input, supplierName: 'srey now', supplierId: 7 })
  assert.deepStrictEqual(
    supplied.sqlite.prepare(`SELECT supplier_name, supplier_id FROM product_batches`).get(),
    { supplier_name: 'srey now', supplier_id: 7 },
  )
  await subject.applyUnifiedStockAdd(supplied.db, { ...input, rowNumber: 4, supplierName: 'bong long', supplierId: 9 })
  assert.deepStrictEqual(
    supplied.sqlite.prepare(`SELECT supplier_name, supplier_id FROM product_batches`).get(),
    { supplier_name: 'srey now', supplier_id: 7 },
    'first supplier attribution sticks; a later add never rewrites the lot',
  )
  // received_quantity (0067) is CUMULATIVE, unlike the fill-if-NULL
  // attribution above: both adds into the same lot count toward what was
  // bought, and the earlier retry-idempotency case must not have
  // double-counted its own redelivery.
  assert.strictEqual(
    supplied.sqlite.prepare(`SELECT received_quantity FROM product_batches`).get().received_quantity,
    4,
    'two 2-unit adds into one lot record received_quantity = 4',
  )
  assert.strictEqual(
    supplied.sqlite.prepare(`SELECT received_cost_usd FROM product_batches`).get().received_cost_usd,
    20,
    'same batch accumulates per-receipt spend without changing product cost',
  )
  assert.strictEqual(
    sqlite.prepare(`SELECT received_quantity FROM product_batches`).get().received_quantity,
    2,
    'a redelivered (already-applied) add never double-counts received_quantity',
  )
  // A lot another wire (or the pre-gate migration) left unattributed is still
  // FILLED by the next import add that names a supplier -- fill-if-NULL is
  // unchanged; what changed is that this writer can no longer MINT such a lot.
  const unsupplied = setup()
  seedLot(unsupplied.sqlite, { supplierName: null, supplierId: null })
  await subject.applyUnifiedStockAdd(unsupplied.db, { ...input, rowNumber: 5, supplierName: 'Dane japan', supplierId: null })
  assert.deepStrictEqual(
    unsupplied.sqlite.prepare(`SELECT supplier_name, supplier_id FROM product_batches`).get(),
    { supplier_name: 'Dane japan', supplier_id: null },
    'a lot with no supplier yet adopts the first named one',
  )

  // ---- N14-D: the receipt gate on the FOURTH wire -------------------------
  // Before this, an import row with no supplier and no cost minted a lot with
  // both NULL -- the exact receipt POST /adjust, POST /api/batches and the
  // stock-in session all refuse. Each refusal must leave NOTHING behind: no
  // pending commit row, no lot, no movement, no stock.
  const wroteNothing = (db, why) => {
    assert.strictEqual(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 0, `${why}: no lot`)
    assert.strictEqual(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements`).get().n, 0, `${why}: no movement`)
    assert.strictEqual(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits`).get().n, 0, `${why}: no commit row`)
    assert.strictEqual(db.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 0, `${why}: no stock`)
  }

  const noSupplier = setup()
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(noSupplier.db, { ...input, supplierName: '' }),
    /must name the supplier/,
    'an import row with no supplier is refused with the words the interactive wires use',
  )
  wroteNothing(noSupplier, 'supplier refusal')

  const noCost = setup()
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(noCost.db, { ...input, costPriceUsd: null }),
    /must carry its unit cost/,
    'a blank cost is refused, never written as NULL and read later as free goods',
  )
  wroteNothing(noCost, 'cost refusal')

  const bothBlank = setup()
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(bothBlank.db, { ...input, supplierName: '', costPriceUsd: undefined }),
    /must name the supplier/,
    'the both-NULL receipt this gate exists to stop',
  )
  wroteNothing(bothBlank, 'both blank')

  const zeroCost = setup()
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(zeroCost.db, { ...input, costPriceUsd: 0 }),
    /Free goods/,
    'a $0.00 import receipt is not silently accepted as free goods',
  )
  wroteNothing(zeroCost, 'zero cost')

  // ...but the sheet's own free_goods column is exactly the declaration the
  // refusal above asks for -- ticked, a $0.00 receipt applies AND the ledger
  // keeps the words, not just the zero (appendReceiptNotes, mirroring
  // routes/batches.ts:218's interactive equivalent).
  const zeroCostDeclaredFree = setup()
  const freeResult = await subject.applyUnifiedStockAdd(zeroCostDeclaredFree.db, { ...input, costPriceUsd: 0, freeGoods: true })
  assert.strictEqual(freeResult.applied, true, 'a declared-free $0.00 receipt is accepted')
  assert.strictEqual(
    zeroCostDeclaredFree.sqlite.prepare(`SELECT unit_cost_usd FROM product_batches`).get().unit_cost_usd,
    0,
  )
  assert.match(
    zeroCostDeclaredFree.sqlite.prepare(`SELECT notes FROM product_batches`).get().notes,
    /Free goods \(no cost\)/,
    'the lot notes record the CLAIM, not merely the zero',
  )
  assert.match(
    zeroCostDeclaredFree.sqlite.prepare(`SELECT reason FROM inventory_movements`).get().reason,
    /Free goods \(no cost\)/,
    'the movement reason records the same declaration',
  )

  const negativeCost = setup()
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(negativeCost.db, { ...input, costPriceUsd: -2 }),
    /cannot be negative/,
    'a negative cost gets the gate sentence, not the generic money parser error',
  )
  wroteNothing(negativeCost, 'negative cost')

  // The one blank supplier that IS complete: topping up a lot that is already
  // attributed. First attribution sticks, so the sheet has nothing to say and
  // demanding it retype an unchangeable name would refuse a good receipt --
  // the same rule ReceiveBatchModal and the adjust form follow.
  const attributedLot = setup()
  seedLot(attributedLot.sqlite, { supplierName: 'Srey Now', supplierId: 7 })
  await subject.applyUnifiedStockAdd(attributedLot.db, { ...input, supplierName: '' })
  assert.deepStrictEqual(
    attributedLot.sqlite.prepare(`SELECT supplier_name, supplier_id FROM product_batches`).get(),
    { supplier_name: 'Srey Now', supplier_id: 7 },
    'the top-up inherits the lot supplier and never rewrites it',
  )
  assert.strictEqual(attributedLot.sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 2)
  // ...but an attributed lot excuses only the supplier half.
  await assert.rejects(
    () => subject.applyUnifiedStockAdd(attributedLot.db, { ...input, rowNumber: 9, supplierName: '', costPriceUsd: null }),
    /must carry its unit cost/,
    "the lot's supplier does not excuse this receipt's own cost",
  )

  // A redelivery of a row that already landed stays idempotent even if it
  // would now be refused: the gate guards writes, not history.
  const redelivered = setup()
  await subject.applyUnifiedStockAdd(redelivered.db, input)
  redelivered.sqlite.prepare(`UPDATE product_batches SET supplier_name = NULL, unit_cost_usd = NULL`).run()
  const replay = await subject.applyUnifiedStockAdd(redelivered.db, { ...input, supplierName: '', costPriceUsd: null })
  assert.strictEqual(replay.alreadyApplied, true, 'an applied row replays as already-applied instead of being refused')

  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER reject_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'forced movement failure'); END;`)
  await assert.rejects(() => subject.applyUnifiedStockAdd(failed.db, input), /forced movement failure/)
  assert.strictEqual(failed.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits`).get().n, 0)

  const createdDb = setup()
  const created = await subject.ensureUnifiedStockProduct(createdDb.db, {
    jobId: 'job-new', identityKey: 'new:new serum|NEW', productName: 'New Serum', barcode: 'NEW',
    sellingPriceUsd: 9.999, wholesalePriceUsd: 8, costPriceUsd: 4,
  })
  const createRetry = await subject.ensureUnifiedStockProduct(createdDb.db, {
    jobId: 'job-new', identityKey: 'new:new serum|NEW', productName: 'New Serum', barcode: 'NEW',
    sellingPriceUsd: 99, wholesalePriceUsd: 88, costPriceUsd: 44,
  })
  assert.strictEqual(created.created, true)
  assert.strictEqual(createRetry.created, false)
  assert.strictEqual(createRetry.productId, created.productId)
  assert.strictEqual(createdDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM products WHERE client_request_id LIKE 'stock-import:%'`).get().n, 1)
  assert.strictEqual(createdDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM branch_stock WHERE product_id = @id AND quantity = 0`).get({ id: created.productId }).n, 2)
  assert.deepStrictEqual(createdDb.sqlite.prepare(`SELECT selling_price_usd, wholesale_price_usd, cost_price_usd FROM products WHERE id = @id`).get({ id: created.productId }), {
    selling_price_usd: 10, wholesale_price_usd: 8, cost_price_usd: 4,
  }, 'a retry resolves the original product instead of overwriting it with retry payload prices')
  console.log('PASS unified stock add commits batch/branch/product/movement/ledger atomically and is retry-idempotent')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
