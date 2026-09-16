const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function loadSnapshotModule() {
  const abs = path.join(__dirname, '..', 'src', 'lib', 'productMergeSnapshot.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

function countedAdapter(d1) {
  const batches = []
  return {
    batches,
    adapter: {
      batch(statements) {
        batches.push(statements.map((statement) => statement.sql))
        return Promise.resolve(statements.map((statement) => ({
          success: true,
          results: d1.prepare(statement.sql).all(statement.params || {}),
        })))
      },
    },
  }
}

async function main() {
  const d1 = openDb(loadAll())
  d1.db.exec(`
    INSERT INTO products(id,name,barcode,image_path,is_active,updated_at,cost_price_usd,selling_price_usd)
      VALUES(9001,'Tea','123456',NULL,1,'2026-09-07 10:00:00',4,5),
            (9002,'Tea','0123456','/uploads/tea.webp',1,'2026-09-07 10:00:00',6,7);
    INSERT INTO branches(id,name) VALUES(901,'Shop');
    INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty)
      VALUES(9001,901,2,1),(9002,901,3,2);
    INSERT INTO product_images(product_id,image_path,sort_order)
      VALUES(9001,'/uploads/keeper.webp',0),(9002,'/uploads/tea.webp',0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active)
      VALUES(9101,9001,'same',1,1),(9102,9002,'same',1,1),(9103,9002,'move',2,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      VALUES(9101,901,1),(9102,901,2),(9103,901,1);
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,quantity)
      VALUES(1,9102,1);
    INSERT INTO return_item_batch_allocations(return_item_id,batch_id,quantity)
      VALUES(1,9102,1);
  `)
  const { readProductMergeCaseSnapshot, readProductMergeDependentLotSnapshots } = loadSnapshotModule()
  const { adapter, batches } = countedAdapter(d1)
  const reparent = [
    { table: 'sale_items', column: 'product_id' },
    { table: 'inventory_movements', column: 'product_id' },
  ]

  const snapshot = await readProductMergeCaseSnapshot(adapter, 9001, 9002, reparent)
  assert.equal(batches.length, 1, 'all independent case reads use one D1 batch call')
  assert.equal(batches[0].length, 13, 'nine core reads, two reparent reads, promotion rules and children')
  assert.equal(snapshot.canonicalProduct.id, 9001)
  assert.equal(snapshot.duplicateProduct.id, 9002)
  assert.deepEqual(snapshot.duplicateStockRows.map((row) => Number(row.quantity)), [3])
  assert.deepEqual(snapshot.duplicateBatchRows.map((row) => Number(row.id)), [9102, 9103])
  assert.deepEqual(snapshot.duplicateImageRows.map((row) => row.image_path), ['/uploads/tea.webp'])

  const lots = await readProductMergeDependentLotSnapshots(adapter, snapshot, 'merge')
  assert.equal(batches.length, 2, 'dependent collision reads use one second D1 batch call')
  assert.equal(batches[1].length, 4, 'one collision reads both stocks and both allocation tables')
  assert.deepEqual(lots.get(9102).duplicateStockRows.map((row) => Number(row.quantity)), [2])
  assert.deepEqual(lots.get(9102).keeperStockBefore.map((row) => Number(row.quantity)), [1])
  assert.equal(lots.get(9102).saleAllocationIds.length, 1)
  assert.equal(lots.get(9102).returnAllocationIds.length, 1)
  assert.equal(lots.has(9103), false, 'a directly repointed lot needs no dependent read')

  const repointOnly = { ...snapshot, duplicateBatchRows: snapshot.duplicateBatchRows.filter((row) => row.id === 9103) }
  const beforeNoop = batches.length
  assert.equal((await readProductMergeDependentLotSnapshots(adapter, repointOnly, 'merge')).size, 0)
  assert.equal(batches.length, beforeNoop, 'no collision means no empty second batch')

  const writeOff = await readProductMergeDependentLotSnapshots(adapter, snapshot, 'write_off')
  assert.equal(batches.length, beforeNoop + 1, 'all write-off lot stock reads share one second-phase batch')
  assert.equal(batches.at(-1).length, 2)
  assert.deepEqual([...writeOff.keys()], [9102, 9103])

  const collisionSnapshot = (count) => ({
    ...snapshot,
    canonicalBatchRows: Array.from({ length: count }, (_, index) => ({
      id: 20_000 + index,
      batch_key: `collision-${index}`,
      batch_number: index + 1,
    })),
    duplicateBatchRows: Array.from({ length: count }, (_, index) => ({
      id: 30_000 + index,
      batch_key: `collision-${index}`,
      batch_number: index + 1,
    })),
  })
  const beforeBoundedLots = batches.length
  await readProductMergeDependentLotSnapshots(adapter, collisionSnapshot(20), 'merge')
  assert.equal(batches.length, beforeBoundedLots + 1)
  assert.equal(batches.at(-1).length, 80, 'twenty colliding lots fit the bounded dependent read batch')

  const beforeOversizedLots = batches.length
  await assert.rejects(
    readProductMergeDependentLotSnapshots(adapter, collisionSnapshot(21), 'merge'),
    (error) => String(error).includes('merge_read_batch_statement_limit')
      && error?.code === 'merge_read_batch_statement_limit'
      && error.statementCount === 84
      && error.maxStatements === 80,
  )
  assert.equal(batches.length, beforeOversizedLots, 'oversized dependent reads fail before a D1 batch call')

  for (const statementGroup of batches) {
    for (const sql of statementGroup) {
      const binds = (sql.match(/@\w+|\?/g) || []).length
      assert.ok(binds <= 80, `read statement exceeded 80 binds: ${binds}`)
    }
  }
  console.log('test-product-merge-snapshot-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
