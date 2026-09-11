const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cache = new Map()
function load(file) {
  const absolute = path.resolve(__dirname, '../src/lib', file)
  if (cache.has(absolute)) return cache.get(absolute).exports
  const mod = { exports: {} }
  cache.set(absolute, mod)
  const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', 'module', output)(mod.exports, (request) => request.startsWith('.')
    ? load(path.resolve(path.dirname(absolute), `${request}.ts`)) : require(request), mod)
  return mod.exports
}
const batches = load('productBatches.ts')
const additions = load('saleLineAddition.ts')
const db = openDb(loadAll())
db.exec("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1); INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',0),(2,'B',0)")
const receive = (branchId, quantity, receivedDate, extra = {}) => db.batch(batches.planReceiveBatchStock({ productId: 1, branchId, quantity, receivedDate, ...extra }).statements)
const snapshot = (branchId, quantity, receivedDate = '10/09/2026') => db.batch(batches.planReconcileBranchSnapshot({ productId: 1, branchId, quantity, receivedDate }))
const lots = (branchId) => db.prepare(`SELECT pb.id,pb.received_at,pb.batch_key,bbs.quantity FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id WHERE pb.variant_product_id=1 AND bbs.branch_id=? ORDER BY pb.id`).all([branchId])
function parity(branchId, expected) {
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=?').get([branchId]).quantity, expected)
  assert.equal(lots(branchId).reduce((n, lot) => n + lot.quantity, 0), expected)
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,
    db.prepare('SELECT SUM(quantity) n FROM branch_stock WHERE product_id=1').get().n)
}

async function main() {
  await receive(1, 4, '02/01/2026')
  await receive(1, 6, '04/03/2026')
  await receive(2, 8, '04/03/2026')
  await snapshot(1, 15)
  parity(1, 15); parity(2, 8)
  assert.deepEqual(lots(1).map((lot) => [lot.received_at, lot.quantity]), [['2026-01-02', 4], ['2026-03-04', 6], ['2026-09-10', 5]])
  const first = lots(1)
  await snapshot(1, 15)
  assert.deepEqual(lots(1), first, 'snapshot redelivery must not add units or lots')
  await snapshot(1, 7)
  parity(1, 7); parity(2, 8)
  assert.deepEqual(lots(1).map((lot) => lot.quantity), [4, 3, 0], 'shrink retains oldest receipt provenance')
  await snapshot(1, 0)
  parity(1, 0); parity(2, 8)
  assert.ok(lots(1).every((lot) => lot.quantity === 0))
  await snapshot(1, 5)
  parity(1, 5)
  assert.equal(lots(1).find((lot) => lot.batch_key.startsWith(' snapshot:')).quantity, 5)
  const beforeFailure = lots(1)
  await assert.rejects(db.batch([...batches.planReconcileBranchSnapshot({ productId: 1, branchId: 1, quantity: 20, receivedDate: '11/09/2026' }),
    { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)', params: {} }]), /constraint/i)
  assert.deepEqual(lots(1), beforeFailure); parity(1, 5)
  assert.throws(() => batches.planReconcileBranchSnapshot({ productId: 1, branchId: 1, quantity: 2, receivedDate: '30/02/2026' }), /valid received date/)
  console.log('PASS snapshot grow, repeat, shrink, zero, regrow, two branches, invalid date and atomic rollback')

  // Execute the real duplicate-row finalizer, including its staging query,
  // against the same migrated DB. Only the unrelated chunk scheduler is
  // reduced to sequential atomic groups (covered by its dedicated suite).
  const engineSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/importEngine.ts'), 'utf8')
  const engineAst = ts.createSourceFile('importEngine.ts', engineSource, ts.ScriptTarget.Latest, true)
  const declaration = engineAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'reconcileDuplicateProductSnapshotRows')
  const compiled = ts.transpileModule(declaration.getText(engineAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const authority = load('importBranchAuthority.ts')
  new Function('exports', 'planReconcileBranchSnapshot', 'validateCanonicalImportBranchIds', 'withCanonicalImportBranchWriteGuard', 'runD1BatchGroupsInChunks', compiled)(
    exports, batches.planReconcileBranchSnapshot, authority.validateCanonicalImportBranchIds, authority.withCanonicalImportBranchWriteGuard,
    async (database, groups) => { for (const group of groups) await database.batch(group) })
  for (const [row, quantity] of [[1, 4], [2, 5]]) db.prepare(`INSERT INTO import_job_rows(job_id,phase,row_number,action,result_json) VALUES('snapshot-test','apply',@row,'update',@json)`)
    .run({ row, json: JSON.stringify({ existingId: 1, data: { branch_id: 1, stock_quantity: quantity, received_date: '2026-09-10' } }) })
  assert.equal(await exports.reconcileDuplicateProductSnapshotRows(db, 'snapshot-test'), 1)
  parity(1, 9); parity(2, 8)
  await exports.reconcileDuplicateProductSnapshotRows(db, 'snapshot-test')
  parity(1, 9)
  await snapshot(1, 5)
  console.log('PASS real duplicate import finalizer uses grouped, idempotent lot/branch reconciliation')

  const original = lots(2)[0]
  await receive(2, 1, '11/09/2026', { batchId: original.id })
  assert.equal(lots(2)[0].received_at, '2026-03-04', 'exact-lot top-up retains first date')
  const plannedReturn = batches.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, receivedDate: '11/09/2026', provenanceKey: 'return:one:0', notes: 'Return receipt' })
  await db.batch(plannedReturn.statements)
  const returnLot = lots(1).find((lot) => lot.batch_key === plannedReturn.batchKey)
  assert.equal(returnLot.received_at, '2026-09-11')
  assert.equal(returnLot.quantity, 2)
  assert.ok(returnLot.batch_key.startsWith(' event:return:'), 'return receipt is distinct from procurement on the same day')
  parity(1, 7)
  console.log('PASS first receipt date and event provenance remain distinct')

  db.prepare('UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=1 AND branch_id=1').run()
  const input = { productId: 1, productName: 'A', branchId: 1, quantity: 2, unitPriceUsd: 10, costPriceUsd: 3, costPriceKhr: 12000, unlottedStock: true }
  const availableLots = new Map([['1:1', [{ batchId: returnLot.id, available: 2, receivedAt: '2026-09-11', lotCode: '110926', expiryDate: null }]]])
  const planned = additions.allocateNewSaleLines([input], availableLots, 'completed')
  assert.deepEqual(planned[0].takes, [], 'explicit unlotted source never FIFO allocates')
  assert.equal(availableLots.get('1:1')[0].available, 2)
  assert.equal(additions.resolveExplicitSaleLineBatches([{ ...input, batchId: returnLot.id }], availableLots).ok, false)
  await db.batch(additions.planUnlottedSaleLineGuards(planned))
  const duplicate = additions.allocateNewSaleLines([input, input], availableLots, 'completed')
  await assert.rejects(db.batch(additions.planUnlottedSaleLineGuards(duplicate)), /constraint/i, 'duplicate lines share one residual capacity')
  db.prepare('UPDATE product_batches SET is_active=0 WHERE id=?').run([returnLot.id])
  await assert.rejects(db.batch(additions.planUnlottedSaleLineGuards(duplicate)), /constraint/i, 'inactive lot stock remains attributed')
  db.prepare('UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=1 AND branch_id=1').run()
  await assert.rejects(db.batch(additions.planUnlottedSaleLineGuards(planned)), /constraint/i, 'racing residual change fails closed')
  assert.equal(additions.planUnlottedSaleLineGuards(additions.allocateNewSaleLines([input], availableLots, 'completed', true)).length, 0)
  console.log('PASS explicit unlotted choice, mixed provenance, duplicate capacity, inactive lots, stale residual and stock-skipped parity')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
