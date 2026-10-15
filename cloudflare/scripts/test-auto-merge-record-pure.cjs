// K5 / 9.2 (Part 421): in-file import auto-merges become visible --
// products.auto_merged_count + the import_auto_merges record (migration
// 0076), written at apply time where the in-batch dedupe folds a later
// row into an earlier row's product.
//
// runImportApply has no fake-D1 harness by long-standing policy (see
// test-import-engine-pure.cjs's header), so this follows the same house
// style: source pins on the engine's recording path, plus REAL-sqlite
// checks that the exact SQL shapes the engine emits are valid against the
// real migrated schema and mean what they claim.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function assertGuardedAutoMergeGroup(source) {
  const finishGroupIndex=source.indexOf('const finishProductRowWriteGroup = () => {')
  const recordsIndex=source.indexOf('const mergeRecords = autoMergeRecords.filter(',finishGroupIndex)
  const counterIndex=source.indexOf("sql: 'UPDATE products SET auto_merged_count",recordsIndex)
  const queueGroupIndex=source.indexOf('productStatementGroups.push(rowWriteGroup)',counterIndex)
  const calls=[...source.matchAll(/runD1BatchGroupsInChunks\(\s*importWriteDb,\s*productStatementGroups,\s*D1_IMPORT_BATCH_CHUNK_SIZE,\s*true\s*\)/g)]
  assert.ok(finishGroupIndex!==-1 && recordsIndex!==-1 && counterIndex!==-1 && queueGroupIndex!==-1
    && calls.some(call=>call.index>queueGroupIndex),
    'auto-merge record + counter must join the product row group before its guarded group-atomic flush')
}

async function run() {
  const db = openDb(MIGRATION_SQLS)
  assert.throws(()=>db.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(),/stock_transaction_required/)
  const engineSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
  const routeSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const portalSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'portal.ts'), 'utf8')
  const migration = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0076_product_auto_merges.sql'), 'utf8')

  await check('migration 0076: the flag column and the append-only record table exist', async () => {
    assert.match(migration, /ALTER TABLE products ADD COLUMN auto_merged_count INTEGER DEFAULT 0/)
    assert.match(migration, /CREATE TABLE IF NOT EXISTS import_auto_merges/)
    const columns = (await db.prepare('PRAGMA table_info(products)').all()).map((c) => c.name)
    assert.ok(columns.includes('auto_merged_count'))
    const mergeColumns = (await db.prepare('PRAGMA table_info(import_auto_merges)').all()).map((c) => c.name)
    for (const column of ['product_id', 'import_job_id', 'row_number', 'losing_json', 'created_at']) {
      assert.ok(mergeColumns.includes(column), `import_auto_merges.${column}`)
    }
  })

  await check('the engine records the fold BEFORE pricing mutates the losing row, and writes ride the same batch', async () => {
    // the snapshot happens inside the dedupe branch, before resolveMergedPricing.
    // Matched on the call, not on the whole assignment: the assignment gained a
    // second spread (resolveMergedCost) on Sep 4 2026 and the ordering this
    // guards did not change.
    const foldIndex = engineSource.indexOf('autoMergeRecords.push({ productId: earlier.id')
    const pricingIndex = engineSource.indexOf('...resolveMergedPricing([earlier.data, d]),')
    assert.ok(foldIndex !== -1 && pricingIndex !== -1 && foldIndex < pricingIndex,
      'the losing-row snapshot must be taken before resolveMergedPricing mutates it')
    // internal keys never pollute the record
    assert.match(engineSource, /key\.startsWith\('__'\) \|\| key === 'name_normalized'/)
    // The product writer now keeps every imported product row in its own
    // statement group. The merge record and counter must be appended to that
    // SAME group before it is queued, and those groups must use the group-
    // atomic runner. A global statements flush would allow the product write
    // and its merge history to split across D1 batches.
    assertGuardedAutoMergeGroup(engineSource)
    const guardedCall='runD1BatchGroupsInChunks(importWriteDb, productStatementGroups, D1_IMPORT_BATCH_CHUNK_SIZE, true)'
    assert.ok(engineSource.includes(guardedCall))
    assert.throws(()=>assertGuardedAutoMergeGroup(engineSource.replace(guardedCall,guardedCall.replace('true','false'))))
    assert.throws(()=>assertGuardedAutoMergeGroup(engineSource.replace(guardedCall,guardedCall.replace('productStatementGroups','productStatementGroups.flat()'))))
    const reordered=engineSource.replace('if (rowWriteGroup.length) productStatementGroups.push(rowWriteGroup)','')
      .replace('const mergeRecords = autoMergeRecords.filter(', 'if (rowWriteGroup.length) productStatementGroups.push(rowWriteGroup); const mergeRecords = autoMergeRecords.filter(')
    assert.throws(()=>assertGuardedAutoMergeGroup(reordered))
    assert.match(engineSource, /UPDATE products SET auto_merged_count = COALESCE\(auto_merged_count, 0\) \+ @count WHERE id = @id/)
  })

  await check('the exact SQL shapes the engine emits are valid against the real schema', async () => {
    await seedStockFixture(db,()=>db.prepare(`INSERT INTO products (id, name, is_active, stock_quantity) VALUES (77, 'Merged Winner', 1, 0)`).run({}))
    await seedStockFixture(db,()=>db.prepare(`INSERT INTO import_auto_merges (product_id, import_job_id, row_number, losing_json, created_at)
                      VALUES (@product_id, @import_job_id, @row_number, @losing_json, @created_at)`)
      .run({ product_id: 77, import_job_id: 5, row_number: 12, losing_json: JSON.stringify({ name: 'Merged Winner', barcode: 'b1', selling_price_usd: 9 }), created_at: '2026-08-28T00:00:00.000Z' }))
    await seedStockFixture(db,()=>db.prepare('UPDATE products SET auto_merged_count = COALESCE(auto_merged_count, 0) + @count WHERE id = @id').run({ count: 2, id: 77 }))
    assert.equal((await db.prepare('SELECT auto_merged_count FROM products WHERE id = 77').get()).auto_merged_count, 2)
    const record = await db.prepare('SELECT * FROM import_auto_merges WHERE product_id = 77').get()
    assert.equal(record.row_number, 12)
    assert.equal(JSON.parse(record.losing_json).barcode, 'b1')
    // the facet's WHERE clause finds exactly the flagged rows
    const rows = await db.prepare('SELECT id FROM products WHERE COALESCE(auto_merged_count, 0) > 0').all()
    assert.deepEqual(rows.map((r) => r.id), [77])
  })

  await check('routes: the merged=auto facet, the flag on the list payload, and the merge-log read', async () => {
    assert.match(routeSource, /const mergedFilter = String\(query\.merged \|\| ''\)\.trim\(\)\.toLowerCase\(\)/)
    assert.match(routeSource, /COALESCE\(p\.auto_merged_count, 0\) > 0/)
    assert.match(routeSource, /COALESCE\(p\.auto_merged_count, 0\) AS auto_merged_count/)
    assert.match(routeSource, /app\.get\('\/auto-merges\/:productId'/)
    // losing_json can carry supplier/cost values -- the log stays behind
    // the products gate and NEVER reaches the public portal
    assert.doesNotMatch(portalSource, /auto_merged|import_auto_merges/)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
