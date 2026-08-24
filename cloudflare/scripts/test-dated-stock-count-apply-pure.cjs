// Regression test for the new I/O apply layer
// (lib/datedStockCountApply.ts) that turns a StockCountPlan (the pure
// computation in lib/datedStockCountImport.ts, already covered by
// test-dated-stock-count-plan-pure.cjs) into real DB writes. Same
// approach as test-returns-batch-restock-pure.cjs: transpile the REAL
// lib files and run them against a real in-memory SQLite database with
// the real migrations applied -- nothing here is mocked at the SQL
// level, only the plan objects are hand-built (that's the pure layer's
// own job, already tested elsewhere).
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-apply-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function freshDb() {
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
  return { rawDb, db }
}

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

// Minimal require-graph loader: only follows the relative imports that
// datedStockCountApply.ts actually needs (productBatches.ts and its own
// dependency batchCode.ts), so this stays a targeted unit test rather
// than pulling in the whole worker bundle.
const cache = new Map()
function loadReal(relPath) {
  if (cache.has(relPath)) return cache.get(relPath)
  const { sourcePath, outputText } = transpile(relPath)
  const mod = new Module(sourcePath, module)
  mod.filename = sourcePath
  mod.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  cache.set(relPath, mod.exports)
  const originalResolve = Module._resolveFilename
  mod._compile(outputText, sourcePath)
  return mod.exports
}

// Patch require inside transpiled lib files to resolve sibling
// relative imports (./productBatches, ./batchCode, ./db) back through
// loadReal / to no-op stand-ins, same trick load_import_engine.cjs
// uses elsewhere in this scripts dir.
const relMap = {
  './productBatches': () => loadReal('lib/productBatches.ts'),
  './productBatches.ts': () => loadReal('lib/productBatches.ts'),
  './batchCode': () => loadReal('lib/batchCode.ts'),
  './batchCode.ts': () => loadReal('lib/batchCode.ts'),
  './db': () => ({}),
  './db.ts': () => ({}),
  './datedStockCountImport': () => ({}),
  './datedStockCountImport.ts': () => ({}),
}
const originalCompile = Module.prototype._compile
Module.prototype._compile = function (content, filename) {
  if (filename.includes(`${path.sep}cloudflare${path.sep}src${path.sep}lib${path.sep}`)) {
    const originalRequire = this.require.bind(this)
    this.require = (id) => (relMap[id] ? relMap[id]() : originalRequire(id))
  }
  return originalCompile.call(this, content, filename)
}

const { applyDatedStockCountPlan } = loadReal('lib/datedStockCountApply.ts')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (err) {
    console.log(`FAIL ${name}`)
    console.log(err.stack || err)
    failed += 1
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (err) {
    console.log(`FAIL ${name}`)
    console.log(err.stack || err)
    failed += 1
  }
}

function seedProduct(rawDb, { id, name, stockQuantity }) {
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1) ON CONFLICT(id) DO NOTHING").run()
  rawDb.prepare('INSERT INTO products (id, name, is_active, stock_quantity) VALUES (@id, @name, 1, @stockQuantity)').run({ id, name, stockQuantity })
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, 1, @stockQuantity)').run({ id, stockQuantity })
}

async function main() {
  await testAsync('plain (non-batch-tracked) group: deletes superseded movements, applies new ones, updates branch_stock/products.stock_quantity', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 1, name: 'Widget', stockQuantity: 10 })
    const oldMovementId = rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (1, 'Widget', 1, 'Main', 'add', 5, 'Dated stock count import', '2026-08-16 00:00:00')`
    ).run().meta.last_row_id

    const plan = {
      movementsToDelete: [oldMovementId],
      movementsToCreate: [
        { productId: 1, productName: 'Widget', branchId: 1, branchName: 'Main', date: '2026-08-16', quantity: 3, movementType: 'add', reason: 'Dated stock count import' },
        { productId: 1, productName: 'Widget', branchId: 1, branchName: 'Main', date: '2026-08-18', quantity: 2, movementType: 'remove', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 1, branchId: 1, quantity: 11 }],
      batchTopUps: [], batchCreates: [], batchDrains: [], batchDeactivations: [],
    }

    const result = await applyDatedStockCountPlan(db, plan, { userId: 7, userName: 'Sok' })
    assert.strictEqual(result.movementsDeleted, 1)
    assert.strictEqual(result.movementsApplied, 2)
    assert.strictEqual(result.plainGroups, 1)
    assert.strictEqual(result.batchTrackedGroups, 0)

    const deleted = rawDb.prepare('SELECT id FROM inventory_movements WHERE id = @id').get({ id: oldMovementId })
    assert.strictEqual(deleted, undefined, 'superseded movement should be deleted')

    const remaining = rawDb.prepare('SELECT movement_type, quantity, created_at FROM inventory_movements WHERE product_id = 1 ORDER BY created_at').all()
    assert.strictEqual(remaining.length, 2)
    assert.strictEqual(remaining[0].movement_type, 'add')
    assert.strictEqual(remaining[0].created_at, '2026-08-16 00:00:00')
    assert.strictEqual(remaining[1].movement_type, 'remove')

    // 10 (start) + 3 - 2 = 11
    const stock = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 1 AND branch_id = 1').get()
    assert.strictEqual(stock.quantity, 11)
    const product = rawDb.prepare('SELECT stock_quantity FROM products WHERE id = 1').get()
    assert.strictEqual(product.stock_quantity, 11)
  })

  await testAsync('batch-tracked group (fresh import): add creates a real batch via receiveBatchStock, later remove FIFO-drains it via removeStockAcrossBatches', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 2, name: 'Gadget', stockQuantity: 0 })

    const plan = {
      movementsToDelete: [],
      movementsToCreate: [
        { productId: 2, productName: 'Gadget', branchId: 1, branchName: 'Main', date: '2026-08-10', quantity: 5, movementType: 'add', reason: 'Dated stock count import' },
        { productId: 2, productName: 'Gadget', branchId: 1, branchName: 'Main', date: '2026-08-12', quantity: 5, movementType: 'remove', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 2, branchId: 1, quantity: 0 }],
      // batchCreates present for this group -> marks it batch-tracked,
      // matching computeDatedStockCountPlan's own contract (the entry's
      // fields beyond productId/branchId aren't otherwise read by the
      // apply layer -- it re-derives batch actions via the real
      // receiveBatchStock/removeStockAcrossBatches functions instead of
      // trusting the plan's own batchId assignments; see the file's own
      // top-of-file comment for why).
      batchTopUps: [], batchCreates: [{ productId: 2, branchId: 1, date: '2026-08-10', quantity: 5 }], batchDrains: [], batchDeactivations: [],
    }

    const result = await applyDatedStockCountPlan(db, plan)
    assert.strictEqual(result.batchTrackedGroups, 1)
    assert.strictEqual(result.plainGroups, 0)

    const batches = rawDb.prepare('SELECT id, batch_number FROM product_batches WHERE variant_product_id = 2').all()
    assert.strictEqual(batches.length, 1, 'one real batch should have been created via receiveBatchStock')

    const batchStock = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @id AND branch_id = 1').get({ id: batches[0].id })
    assert.strictEqual(batchStock.quantity, 0, 'the batch should be fully drained by the later remove')

    const stock = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 2 AND branch_id = 1').get()
    assert.strictEqual(stock.quantity, 0)
  })

  await testAsync('batch-tracked group: a remove bigger than tracked batches can cover falls back to the plain aggregate for the shortfall', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 3, name: 'Thingamajig', stockQuantity: 2 })

    const plan = {
      movementsToDelete: [],
      movementsToCreate: [
        { productId: 3, productName: 'Thingamajig', branchId: 1, branchName: 'Main', date: '2026-08-10', quantity: 3, movementType: 'add', reason: 'Dated stock count import' },
        { productId: 3, productName: 'Thingamajig', branchId: 1, branchName: 'Main', date: '2026-08-12', quantity: 5, movementType: 'remove', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 3, branchId: 1, quantity: 0 }],
      batchTopUps: [], batchCreates: [{ productId: 3, branchId: 1, date: '2026-08-10', quantity: 3 }], batchDrains: [], batchDeactivations: [],
    }

    await applyDatedStockCountPlan(db, plan)

    const batches = rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 3').all()
    const batchStock = rawDb.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = @id AND branch_id = 1').get({ id: batches[0].id })
    assert.strictEqual(batchStock.quantity, 0, 'tracked batch drained to 0 (its 3 covered)')

    // Started at 2 (pre-existing) + 3 (batch add) - 5 (remove) = 0 total;
    // the batch ledger only covered 3 of the 5, so the remaining 2 must
    // have come off the plain aggregate as a shortfall.
    const stock = rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = 3 AND branch_id = 1').get()
    assert.strictEqual(stock.quantity, 0)
  })

  await testAsync('movements are dated to their own snapshot date, not import time', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 4, name: 'Doohickey', stockQuantity: 0 })
    const plan = {
      movementsToDelete: [],
      movementsToCreate: [
        { productId: 4, productName: 'Doohickey', branchId: 1, branchName: 'Main', date: '2026-01-05', quantity: 1, movementType: 'add', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 4, branchId: 1, quantity: 1 }],
      batchTopUps: [], batchCreates: [], batchDrains: [], batchDeactivations: [],
    }
    await applyDatedStockCountPlan(db, plan)
    const row = rawDb.prepare('SELECT created_at FROM inventory_movements WHERE product_id = 4').get()
    assert.strictEqual(row.created_at, '2026-01-05 00:00:00')
  })

  await testAsync('batch-tracked add: records batch-level provenance (migration 0035) against the new movement row', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 5, name: 'Gizmo', stockQuantity: 0 })

    const plan = {
      movementsToDelete: [],
      movementsToCreate: [
        { productId: 5, productName: 'Gizmo', branchId: 1, branchName: 'Main', date: '2026-08-10', quantity: 7, movementType: 'add', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 5, branchId: 1, quantity: 7 }],
      batchTopUps: [], batchCreates: [{ productId: 5, branchId: 1, date: '2026-08-10', quantity: 7 }], batchDrains: [], batchDeactivations: [],
    }
    await applyDatedStockCountPlan(db, plan)

    const movement = rawDb.prepare('SELECT id FROM inventory_movements WHERE product_id = 5').get()
    const batch = rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 5').get()
    const actions = rawDb.prepare('SELECT movement_id, batch_id, quantity FROM dated_stock_count_batch_actions WHERE movement_id = @id').all({ id: movement.id })
    assert.strictEqual(actions.length, 1)
    assert.strictEqual(actions[0].batch_id, batch.id)
    assert.strictEqual(actions[0].quantity, 7)
  })

  await testAsync('batch-tracked remove: records signed-negative provenance per drained batch, none for the plain-aggregate shortfall', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 6, name: 'Sprocket', stockQuantity: 2 })

    const plan = {
      movementsToDelete: [],
      movementsToCreate: [
        { productId: 6, productName: 'Sprocket', branchId: 1, branchName: 'Main', date: '2026-08-10', quantity: 3, movementType: 'add', reason: 'Dated stock count import' },
        { productId: 6, productName: 'Sprocket', branchId: 1, branchName: 'Main', date: '2026-08-12', quantity: 5, movementType: 'remove', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 6, branchId: 1, quantity: 0 }],
      batchTopUps: [], batchCreates: [{ productId: 6, branchId: 1, date: '2026-08-10', quantity: 3 }], batchDrains: [], batchDeactivations: [],
    }
    await applyDatedStockCountPlan(db, plan)

    const removeMovement = rawDb.prepare(`SELECT id FROM inventory_movements WHERE product_id = 6 AND movement_type = 'remove'`).get()
    const batch = rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = 6').get()
    const actions = rawDb.prepare('SELECT batch_id, quantity FROM dated_stock_count_batch_actions WHERE movement_id = @id').all({ id: removeMovement.id })
    // Only the tracked batch's own 3 is recorded (signed negative); the
    // remaining 2 fell through to the plain aggregate and has nothing
    // batch-specific to record.
    assert.strictEqual(actions.length, 1)
    assert.strictEqual(actions[0].batch_id, batch.id)
    assert.strictEqual(actions[0].quantity, -3)
  })

  await testAsync('a superseded movement\'s batch-action rows are deleted alongside it (no orphaned provenance after a rerun)', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 7, name: 'Widget Pro', stockQuantity: 0 })
    const oldMovementId = rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (7, 'Widget Pro', 1, 'Main', 'add', 10, 'Dated stock count import', '2026-08-01 00:00:00')`
    ).run().meta.last_row_id
    rawDb.prepare(
      `INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (@movementId, 999, 10)`,
    ).run({ movementId: oldMovementId })

    const plan = {
      movementsToDelete: [oldMovementId],
      movementsToCreate: [
        { productId: 7, productName: 'Widget Pro', branchId: 1, branchName: 'Main', date: '2026-08-01', quantity: 4, movementType: 'add', reason: 'Dated stock count import' },
      ],
      finalBranchStock: [{ productId: 7, branchId: 1, quantity: 4 }],
      batchTopUps: [], batchCreates: [], batchDrains: [], batchDeactivations: [],
    }
    await applyDatedStockCountPlan(db, plan)

    const orphaned = rawDb.prepare('SELECT id FROM dated_stock_count_batch_actions WHERE movement_id = @id').all({ id: oldMovementId })
    assert.strictEqual(orphaned.length, 0, 'provenance rows for a deleted movement should not survive it')
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
