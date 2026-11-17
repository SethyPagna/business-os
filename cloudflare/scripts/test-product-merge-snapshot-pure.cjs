const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

// productMergeSnapshot matches lots by received date through productMergeLots (16 Nov 2026), which sits on two leaf libs.
function loadLib(name) {
  const abs = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: abs,
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => (id.startsWith('./') ? loadLib(id.slice(2)) : require(id)), mod)
  return mod.exports
}
function loadSnapshotModule() {
  return loadLib('productMergeSnapshot')
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
assert.throws(() => d1.db.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(), /stock_transaction_required/)
  seedStockFixture(d1.db, () => d1.db.exec(`
    INSERT INTO products(id,name,barcode,image_path,is_active,updated_at,cost_price_usd,selling_price_usd)
      VALUES(9001,'Tea','123456',NULL,1,'2026-09-07 10:00:00',4,5),
            (9002,'Tea','0123456','/uploads/tea.webp',1,'2026-09-07 10:00:00',6,7);
    INSERT INTO branches(id,name) VALUES(901,'Shop');
    INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty)
      VALUES(9001,901,2,1),(9002,901,3,2);
    INSERT INTO product_images(product_id,image_path,sort_order)
      VALUES(9001,'/uploads/keeper.webp',0),(9002,'/uploads/tea.webp',0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,received_at,is_active)
      VALUES(9101,9001,'same',1,'2026-11-03',1),(9102,9002,'same',1,'2026-11-03',1),(9103,9002,'move',2,'2026-11-05',1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      VALUES(9101,901,1),(9102,901,2),(9103,901,1);
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,quantity)
      VALUES(1,9102,1);
    INSERT INTO return_item_batch_allocations(return_item_id,batch_id,quantity)
      VALUES(1,9102,1);
    INSERT INTO sales(id,receipt_number) VALUES(9301,'S-9301');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(9401,9301,9002,'Tea',1,9102);
    INSERT INTO returns(id,return_number,sale_id) VALUES(9302,'R-9302',9301);
    INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(9402,9302,9002,'Tea',1,9102);
  `))
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
  assert.equal(batches[1].length, 3, 'the dependent reads are SET reads: one lot-stock read and the two allocation/line reads, whatever the lot count')
  assert.deepEqual(lots.get(9102).duplicateStockRows.map((row) => Number(row.quantity)), [2])
  assert.deepEqual(lots.get(9102).keeperStockBefore.map((row) => Number(row.quantity)), [1])
  assert.equal(lots.get(9102).saleAllocationIds.length, 1)
  assert.equal(lots.get(9102).returnAllocationIds.length, 1)
  // A single-lot line names the lot in its own batch_id (no allocation row); the same two reads carry it, so the read count is unchanged.
  assert.deepEqual(lots.get(9102).saleItemIds, [9401])
  assert.deepEqual(lots.get(9102).returnItemIds, [9402])
  assert.equal(lots.get(9102).saleAllocationIds.includes(9401), false, 'a line id is never mistaken for an allocation id')
  assert.equal(lots.has(9103), false, 'a directly repointed lot needs no dependent read')

  const repointOnly = { ...snapshot, duplicateBatchRows: snapshot.duplicateBatchRows.filter((row) => row.id === 9103) }
  const beforeNoop = batches.length
  assert.equal((await readProductMergeDependentLotSnapshots(adapter, repointOnly, 'merge')).size, 0)
  assert.equal(batches.length, beforeNoop, 'no collision means no empty second batch')
  // 16 Nov 2026: lots meet by RECEIVED DATE. The same batch_key on another day is not a collision, so it needs no dependent read.
  const otherDay = { ...snapshot, duplicateBatchRows: snapshot.duplicateBatchRows.map((row) => (row.id === 9102 ? { ...row, received_at: '2026-11-04' } : row)) }
  assert.equal((await readProductMergeDependentLotSnapshots(adapter, otherDay, 'merge')).size, 0, 'the same key on another day is not a match')
  assert.equal(batches.length, beforeNoop, 'and it issues no second batch')

  const writeOff = await readProductMergeDependentLotSnapshots(adapter, snapshot, 'write_off')
  assert.equal(batches.length, beforeNoop + 1, 'all write-off lot stock reads share one second-phase batch')
  assert.equal(batches.at(-1).length, 1, 'write-off needs only the one lot-stock read')
  assert.deepEqual([...writeOff.keys()], [9102, 9103])

  const collisionSnapshot = (count) => ({
    ...snapshot,
    canonicalBatchRows: Array.from({ length: count }, (_, index) => ({
      id: 20_000 + index,
      batch_key: `collision-${index}`,
      batch_number: index + 1,
      received_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    })),
    duplicateBatchRows: Array.from({ length: count }, (_, index) => ({
      id: 30_000 + index,
      batch_key: `collision-${index}`,
      batch_number: index + 1,
      received_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    })),
  })
  // B1 (16 Nov 2026): the reads were 4 per folded lot against a limit of 80, so a merge of more than 19 lots was refused. They are set reads now.
  for (const count of [1, 10, 20, 21, 77, 304]) {
    const before = batches.length
    await readProductMergeDependentLotSnapshots(adapter, collisionSnapshot(count), 'merge')
    assert.equal(batches.length, before + 1, `${count} colliding lots use one dependent D1 batch call`)
    assert.equal(batches.at(-1).length, 3, `${count} colliding lots cost three reads, the same as one`)
  }
  // The reads still bind ONE id list each, so the dependent read of 304 lots is not an oversized batch; the limit itself still guards.
  await assert.rejects(
    readProductMergeDependentLotSnapshots(adapter, collisionSnapshot(21), 'merge', 2),
    (error) => error?.code === 'merge_read_batch_statement_limit' && error.statementCount === 3 && error.maxStatements === 2,
  )
  // An already-inactive discarded lot is neither folded nor read: it is only re-pointed (lead ruling, B2).
  const withInactive = collisionSnapshot(2)
  withInactive.duplicateBatchRows.push({ id: 39_999, batch_key: 'archived', batch_number: 9, received_at: '2026-01-01', is_active: 0 })
  const inactiveLots = await readProductMergeDependentLotSnapshots(adapter, withInactive, 'merge')
  assert.deepEqual([...inactiveLots.keys()], [30_000, 30_001], 'the archived lot has no dependent snapshot')
  const inactiveWriteOff = await readProductMergeDependentLotSnapshots(adapter, withInactive, 'write_off')
  assert.deepEqual([...inactiveWriteOff.keys()], [30_000, 30_001], 'and a write-off leaves it where it is')

  for (const statementGroup of batches) {
    for (const sql of statementGroup) {
      const binds = (sql.match(/@\w+|\?/g) || []).length
      assert.ok(binds <= 80, `read statement exceeded 80 binds: ${binds}`)
    }
  }
  console.log('test-product-merge-snapshot-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
