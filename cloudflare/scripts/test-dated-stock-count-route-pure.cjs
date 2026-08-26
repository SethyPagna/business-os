// Regression test for lib/datedStockCountRoute.ts -- the request-parsing
// + DB-lookup layer routes/inventory.ts's new POST /dated-stock-count/
// preview and /apply endpoints are built on top of (Part 1's "route
// wiring" gap). Same approach test-dated-stock-count-apply-pure.cjs
// already uses: transpile the REAL lib files and run them against a real
// in-memory SQLite database with the real migrations applied, so this
// covers the actual SQL (IN-clause building, product/branch lookups,
// prior-movement/batch reconstruction) end to end, not a mocked stand-in
// for it.
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-route-pure.cjs

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

const cache = new Map()
function loadReal(relPath) {
  if (cache.has(relPath)) return cache.get(relPath)
  const { sourcePath, outputText } = transpile(relPath)
  const mod = new Module(sourcePath, module)
  mod.filename = sourcePath
  mod.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  cache.set(relPath, mod.exports)
  mod._compile(outputText, sourcePath)
  return mod.exports
}

// datedStockCountRoute.ts's only real (value, non-type-only) relative
// imports are ./batchCode and ./datedStockCountImport -- both self
// contained (no further relative imports of their own, confirmed by
// reading them), so no other stubs are needed here.
const relMap = {
  './sqlBinding': () => loadReal('lib/sqlBinding.ts'),
  './sqlBinding.ts': () => loadReal('lib/sqlBinding.ts'),
  './batchCode': () => loadReal('lib/batchCode.ts'),
  './batchCode.ts': () => loadReal('lib/batchCode.ts'),
  './datedStockCountImport': () => loadReal('lib/datedStockCountImport.ts'),
  './datedStockCountImport.ts': () => loadReal('lib/datedStockCountImport.ts'),
}
const originalCompile = Module.prototype._compile
Module.prototype._compile = function (content, filename) {
  if (filename.includes(`${path.sep}cloudflare${path.sep}src${path.sep}lib${path.sep}`)) {
    const originalRequire = this.require.bind(this)
    this.require = (id) => (relMap[id] ? relMap[id]() : originalRequire(id))
  }
  return originalCompile.call(this, content, filename)
}

const { parseDatedStockCountEntries, buildDatedStockCountPlan, MAX_DATED_STOCK_COUNT_ENTRIES } = loadReal('lib/datedStockCountRoute.ts')

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

function seed(rawDb) {
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Annex', 1, 0)").run()
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (1, 'Widget', 1, 0)").run()
  rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 0)').run()
}

async function main() {
  // ---- parseDatedStockCountEntries: pure validation, no DB ----
  test('parseDatedStockCountEntries rejects a missing/empty entries array', () => {
    assert.ok('error' in parseDatedStockCountEntries({}))
    assert.ok('error' in parseDatedStockCountEntries({ entries: [] }))
  })
  test('parseDatedStockCountEntries rejects more than MAX_DATED_STOCK_COUNT_ENTRIES rows', () => {
    const entries = Array.from({ length: MAX_DATED_STOCK_COUNT_ENTRIES + 1 }, () => ({ date: '2026-08-01', productId: 1, branchId: 1, count: 1 }))
    const result = parseDatedStockCountEntries({ entries })
    assert.ok('error' in result)
    assert.ok(/Too many entries/.test(result.error))
  })
  test('parseDatedStockCountEntries accepts an mm/dd/yyyy date via normalizeToIsoDate and rewrites it to ISO', () => {
    const result = parseDatedStockCountEntries({ entries: [{ date: '08/16/2026', productId: 1, branchId: 1, count: 5 }] })
    assert.ok('entries' in result, JSON.stringify(result))
    assert.strictEqual(result.entries[0].date, '2026-08-16')
  })
  test('parseDatedStockCountEntries rejects a row with a non-positive productId', () => {
    const result = parseDatedStockCountEntries({ entries: [{ date: '2026-08-16', productId: 0, branchId: 1, count: 5 }] })
    assert.ok('error' in result)
    assert.ok(/productId/.test(result.error))
  })
  test('parseDatedStockCountEntries rejects a negative count', () => {
    const result = parseDatedStockCountEntries({ entries: [{ date: '2026-08-16', productId: 1, branchId: 1, count: -1 }] })
    assert.ok('error' in result)
    assert.ok(/count/.test(result.error))
  })

  // ---- buildDatedStockCountPlan: real DB lookups + real plan ----
  await testAsync('buildDatedStockCountPlan resolves canonical product/branch names from the DB, not the request', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-16', productId: 1, branchId: 1, count: 5 }])
    assert.ok('plan' in built, JSON.stringify(built))
    assert.strictEqual(built.plan.movementsToCreate.length, 1)
    assert.strictEqual(built.plan.movementsToCreate[0].productName, 'Widget')
    assert.strictEqual(built.plan.movementsToCreate[0].branchName, 'Main')
  })

  await testAsync('buildDatedStockCountPlan 404s on an unknown productId, without touching branch lookups', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-16', productId: 999, branchId: 1, count: 5 }])
    assert.ok('error' in built)
    assert.strictEqual(built.status, 404)
    assert.ok(/Product 999/.test(built.error))
  })

  await testAsync('buildDatedStockCountPlan 404s on an unknown branchId', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-16', productId: 1, branchId: 999, count: 5 }])
    assert.ok('error' in built)
    assert.strictEqual(built.status, 404)
    assert.ok(/Branch 999/.test(built.error))
  })

  await testAsync('buildDatedStockCountPlan finds and reconstructs baseline from a PRIOR run\'s own movement (rerun idempotency), ignoring an unrelated movement on the same row', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    // A prior run of this same importer already created this movement.
    const priorId = rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (1, 'Widget', 1, 'Main', 'add', 5, 'Dated stock count import', '2026-08-16 00:00:00')`
    ).run().meta.last_row_id
    // An unrelated manual adjustment on the same product/branch/day, a
    // different reason -- must NOT be picked up as this importer's own
    // prior movement, and must not be deleted by a rerun.
    const unrelatedId = rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (1, 'Widget', 1, 'Main', 'add', 2, 'Manual count', '2026-08-16 00:00:00')`
    ).run().meta.last_row_id
    rawDb.prepare('UPDATE branch_stock SET quantity = 7 WHERE product_id = 1 AND branch_id = 1').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 7 WHERE id = 1').run()

    // Rerun with a corrected count for the same date (was 5, now 8).
    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-16', productId: 1, branchId: 1, count: 8 }])
    assert.ok('plan' in built, JSON.stringify(built))
    assert.deepStrictEqual(built.plan.movementsToDelete, [priorId], 'only this importer\'s own prior movement should be queued for deletion, not the unrelated one')
    assert.strictEqual(built.plan.movementsToCreate.length, 1)
    // Baseline reconstruction: live stock 7, minus the prior run's own +5
    // = true baseline 2; new count 8 - 2 = a +6 add.
    assert.strictEqual(built.plan.movementsToCreate[0].movementType, 'add')
    assert.strictEqual(built.plan.movementsToCreate[0].quantity, 6)
    assert.ok(!built.plan.movementsToDelete.includes(unrelatedId))
  })

  await testAsync('buildDatedStockCountPlan only pulls existing batches whose (productId, branchId) pair is actually in this request -- a batch at a different branch does not leak into another branch\'s group', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    const batchId = rawDb.prepare(
      `INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number)
       VALUES (1, '08102026', '08102026', '2026-08-10', 1, 1)`
    ).run().meta.last_row_id
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, 2, 4)').run({ batchId })
    // This request only imports branch 1 -- the branch-2 batch stock
    // above must not surface as an existingBatches entry for branch 1.
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 2, 4)').run()

    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-20', productId: 1, branchId: 1, count: 3 }])
    assert.ok('plan' in built, JSON.stringify(built))
    // Group (product 1, branch 1) has zero existing branch-1 batches, so
    // this is treated as a fresh batch-tracked import for that branch --
    // it should create a NEW batch dated 2026-08-20, not top up the
    // branch-2 batch.
    assert.strictEqual(built.plan.batchCreates.length, 1)
    assert.strictEqual(built.plan.batchCreates[0].date, '2026-08-20')
    assert.strictEqual(built.plan.batchTopUps.length, 0)
  })

  await testAsync('buildDatedStockCountPlan loads this importer\'s own recorded batch-action provenance (migration 0035) onto the matching prior movement, and feeds it through to a real rerun top-up', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    const batchId = rawDb.prepare(
      `INSERT INTO product_batches (variant_product_id, batch_key, lot_code, received_at, is_active, batch_number)
       VALUES (1, '08102026', '08102026', '2026-08-10', 1, 1)`
    ).run().meta.last_row_id
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, 1, 5)').run({ batchId })
    rawDb.prepare('UPDATE branch_stock SET quantity = 5 WHERE product_id = 1 AND branch_id = 1').run()
    rawDb.prepare('UPDATE products SET stock_quantity = 5 WHERE id = 1').run()

    const priorId = rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (1, 'Widget', 1, 'Main', 'add', 5, 'Dated stock count import', '2026-08-10 00:00:00')`
    ).run().meta.last_row_id
    rawDb.prepare(
      `INSERT INTO dated_stock_count_batch_actions (movement_id, batch_id, quantity) VALUES (@movementId, @batchId, 5)`,
    ).run({ movementId: priorId, batchId })

    // Rerun with the same count -- should recompute the same +5 top-up
    // on the SAME real batch, not double it, thanks to the loaded
    // provenance undoing the prior run's own +5 before replay.
    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-10', productId: 1, branchId: 1, count: 5 }])
    assert.ok('plan' in built, JSON.stringify(built))
    assert.deepStrictEqual(built.plan.movementsToDelete, [priorId])
    assert.deepStrictEqual(built.plan.batchTopUps, [{ productId: 1, branchId: 1, batchId, date: '2026-08-10', quantity: 5 }])
    assert.strictEqual(built.plan.batchCreates.length, 0)
  })

  await testAsync('buildDatedStockCountPlan tolerates a prior movement with no recorded batch actions (predates migration 0035) -- no crash, just nothing to reconstruct', async () => {
    const { rawDb, db } = freshDb()
    seed(rawDb)
    rawDb.prepare(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
       VALUES (1, 'Widget', 1, 'Main', 'add', 5, 'Dated stock count import', '2026-08-10 00:00:00')`
    ).run()
    rawDb.prepare('UPDATE branch_stock SET quantity = 5 WHERE product_id = 1 AND branch_id = 1').run()

    const built = await buildDatedStockCountPlan(db, [{ date: '2026-08-10', productId: 1, branchId: 1, count: 5 }])
    assert.ok('plan' in built, JSON.stringify(built))
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
