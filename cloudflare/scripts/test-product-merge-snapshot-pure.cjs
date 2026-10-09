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
  const d1 = openDb(loadAll({ through: 242 }))
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
    UPDATE product_batches SET lot_code='អត្ថបទ',expiry_date='2027-08-01',received_at='2026-10-09',
      notes='quoted "receipt"',synthetic=1,supplier_id=17,supplier_name='Supplier',payment_status='credit',
      credit_due_date='2026-12-01',unit_cost_usd=1.25,received_quantity=4.5,received_branch_id=901,
      received_cost_usd=1.2,received_branch_name='Shop at receipt' WHERE id=9101;
    INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason)
      VALUES(9002,901,'in',3,'Original intake'),(9001,901,'in',2,'Keeper intake');
  `)
  for (const file of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(file => file.endsWith('.sql') && Number(file.slice(0, 4)) > 242).sort()) {
    if (file.startsWith('0246_')) d1.db.exec(`BEGIN;
      INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1');
      INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"counted_conversion","token":"snapshot-fixture"}');
      DELETE FROM system_flags WHERE key='stock_transaction_permit';`)
    d1.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'))
    if (file.startsWith('0246_')) d1.db.exec("DELETE FROM system_flags WHERE key='maintenance'; COMMIT;")
  }
  assert.equal(d1.db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value, 'counted-tagged-subset-v1')
  const { planProductMergeCaseSnapshot, readProductMergeCaseSnapshot, readProductMergeDependentLotSnapshots, runProductMergeReadBatch } = loadSnapshotModule()
  const { adapter, batches } = countedAdapter(d1)
  const reparent = [
    { table: 'sale_items', column: 'product_id' },
    { table: 'inventory_movements', column: 'product_id' },
  ]

  const snapshot = await readProductMergeCaseSnapshot(adapter, 9001, 9002, reparent)
  assert.equal(batches.length, 1, 'all independent case reads use one D1 batch call')
  assert.equal(batches[0].length, 1, 'all logical case rowsets consume one actual SQL statement')
  assert.equal(snapshot.canonicalProduct.id, 9001)
  assert.equal(snapshot.duplicateProduct.id, 9002)
  assert.deepEqual(snapshot.duplicateStockRows.map((row) => Number(row.quantity)), [3])
  assert.deepEqual(snapshot.duplicateBatchRows.map((row) => Number(row.id)), [9102, 9103])
  assert.deepEqual(snapshot.duplicateImageRows.map((row) => row.image_path), ['/uploads/tea.webp'])
  assert.deepEqual(snapshot.canonicalBatchRows, d1.prepare('SELECT * FROM product_batches WHERE variant_product_id=9001 ORDER BY id').all().map(row => ({ ...row })))
  assert.deepEqual(Object.keys(snapshot.canonicalBatchRows[0]), d1.prepare('PRAGMA table_info(product_batches)').all().map(row => row.name), 'complete current metadata and schema order retained')
  assert.deepEqual(snapshot.canonicalBatchStockRows, d1.prepare('SELECT * FROM branch_batch_stock WHERE batch_id=9101 ORDER BY id').all().map(row => ({ ...row })))
  assert.deepEqual(snapshot.reparentedByTable, [{ table: 'inventory_movements', column: 'product_id', ids: [1] }])
  const empty = await readProductMergeCaseSnapshot(adapter, 9001, 9999, reparent)
  assert.equal(empty.duplicateProduct, undefined)
  assert.deepEqual(empty.duplicateStockRows, [])
  assert.deepEqual(empty.reparentedByTable, [])
  const plan = planProductMergeCaseSnapshot(9001, 9002, reparent)
  const envelope = d1.prepare(plan.reads[0].sql).all(plan.reads[0].params)
  const decode = value => plan.decode(new Map([['capture', value]]))
  const changeCapture = mutate => {
    const data = JSON.parse(envelope[0].data)
    mutate(data)
    return [{ ...envelope[0], data: JSON.stringify(data) }]
  }
  for (const bad of [[], [...envelope, ...envelope], [{ data: null }], [{ data: '{' }],
    changeCapture(data => { delete data.duplicateStock }),
    changeCapture(data => { data.unknown = [] }),
    changeCapture(data => { data.duplicateStock = null }),
    changeCapture(data => { data.duplicateStock[0].pop() }),
    changeCapture(data => { data.duplicateStock[0][1] = { quantity: 3 } }),
  ]) assert.throws(() => decode(bad), /merge_snapshot_incomplete/)
  assert.throws(() => decode([{ data: null, oversized: 1 }]), /merge_case_snapshot_limit/)
  assert.throws(() => decode(changeCapture(data => { data.childProducts = Array.from({ length: 10001 }, (_, id) => [id]) })), /merge_case_snapshot_limit/)
  assert.throws(() => decode(changeCapture(data => { data.duplicateImages = [['x'.repeat(512 * 1024), 0]] })), /merge_case_snapshot_limit/)
  assert.throws(() => planProductMergeCaseSnapshot(9001, 9002, [{ table: 'products; DROP TABLE products', column: 'id' }]), /merge_snapshot_invalid_table/)
  const pooledPlans = [plan, planProductMergeCaseSnapshot(9002, 9001, reparent)]
  const pooledRows = await runProductMergeReadBatch(adapter, pooledPlans.flatMap((item, index) => item.reads.map(read => ({ ...read, key: `${index}:${read.key}` }))))
  const pooled = pooledPlans.map((item, index) => item.decode(new Map(item.reads.map(read => [read.key, pooledRows.get(`${index}:${read.key}`)]))))
  assert.deepEqual(pooled.map(item => [item.canonicalProduct.id, item.duplicateProduct.id]), [[9001, 9002], [9002, 9001]], 'pooled cases keep independent parameter and result scopes')
  assert.deepEqual(pooled[0], snapshot)

  const lots = await readProductMergeDependentLotSnapshots(adapter, snapshot, 'merge')
  assert.equal(batches.length, 4, 'dependent collision reads use a separate D1 batch call')
  assert.equal(batches.at(-1).length, 4, 'one collision reads both stocks and both allocation tables')
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
  d1.db.exec("UPDATE product_images SET image_path=printf('%.*c',524288,'x') WHERE product_id=9002")
  const oversized = d1.prepare(plan.reads[0].sql).all(plan.reads[0].params)
  assert.equal(oversized[0].oversized, 1)
  assert.equal(oversized[0].data, null, 'oversized SQL capture does not send the payload to the Worker')
  await assert.rejects(readProductMergeCaseSnapshot(adapter, 9001, 9002, reparent), /merge_case_snapshot_limit/)
  d1.db.prepare('UPDATE product_images SET image_path=? WHERE product_id=9002').run('ក'.repeat(180000))
  assert.equal(d1.prepare(plan.reads[0].sql).all(plan.reads[0].params)[0].oversized, 1, 'bound is UTF-8 bytes, not character count')
  d1.db.exec("DELETE FROM product_images WHERE product_id=9002; WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10000) INSERT INTO product_images(product_id,image_path) SELECT 9002,'image-'||n FROM ids")
  assert.equal((await readProductMergeCaseSnapshot(adapter, 9001, 9002, reparent)).duplicateImageRows.length, 10000, 'last admitted member retained')
  d1.db.exec("INSERT INTO product_images(product_id,image_path) VALUES(9002,'image-over-limit')")
  await assert.rejects(readProductMergeCaseSnapshot(adapter, 9001, 9002, reparent), /merge_case_snapshot_limit/, 'sentinel prevents silent row truncation')
  console.log('test-product-merge-snapshot-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
