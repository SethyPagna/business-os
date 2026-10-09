const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
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
  new Function('exports', 'require', 'module', output)(mod.exports, withProductStockGuard((request) => request === 'cloudflare:workers' ? { DurableObject: class {} } : request.startsWith('.')
    ? load(path.resolve(path.dirname(absolute), `${request}.ts`)) : require(request)), mod)
  return mod.exports
}
const batches = load('productBatches.ts')
const additions = load('saleLineAddition.ts')
const db = openDb(loadAll(), { seedBeforeFence(db) { db.exec("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1); INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',0),(2,'B',0)") } })
assert.throws(() => db.exec('UPDATE products SET stock_quantity=stock_quantity'), /stock_transaction_required/)
const transaction = load('stockTransaction.ts')
const stockWrite = async statements => {
  try { return await transaction.executeStockTransaction(db, statements, 'retry') }
  finally { assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0, 'success and rollback release the actual permit') }
}

const receive = (branchId, quantity, receivedDate, extra = {}) => stockWrite(batches.planReceiveBatchStock({ productId: 1, branchId, quantity, receivedDate, ...extra }).statements)
const snapshot = (branchId, quantity, receivedDate = '10/09/2026') => stockWrite(batches.planReconcileBranchSnapshot({ productId: 1, branchId, quantity, receivedDate }))
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
  await assert.rejects(stockWrite([...batches.planReconcileBranchSnapshot({ productId: 1, branchId: 1, quantity: 20, receivedDate: '11/09/2026' }),
    { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)', params: {} }]), /constraint/i)
  assert.deepEqual(lots(1), beforeFailure); parity(1, 5)
  assert.throws(() => batches.planReconcileBranchSnapshot({ productId: 1, branchId: 1, quantity: 2, receivedDate: '30/02/2026' }), /valid received date/)
  console.log('PASS snapshot grow, repeat, shrink, zero, regrow, two branches, invalid date and atomic rollback')

  const engine = load('importEngine.ts'), metrics = load('requestMetrics.ts')
  let physical = 0
  const bindingStatement = (text, params = []) => ({ text, params,
    bind(...values) { return bindingStatement(text, values) },
    async all() { physical++; return { results: db.prepare(text).all(params) } },
    async first() { physical++; return db.prepare(text).get(params) },
    async run() { physical++; return db.prepare(text).run(params) },
  })
  const binding = { prepare: bindingStatement, async batch(statements) {
    physical += statements.length
    return db.batch(statements.map(statement => ({ sql: statement.text, params: statement.params })))
  } }
  const finalDb = new (load('db.ts').D1Compat)(binding)
  const state = { startedAtMs: Date.now(), genericApply: { window: 1, finalize:
    { phase: 'reconcile', product: 0, branch: 0, deactivated: 0, reconciled: 0, unified: 0 } } }
  const context = { jobId: 'snapshot-test', leaseToken: 'snapshot-holder', state, queued: true }
  db.prepare(`INSERT INTO import_jobs(id,type,status,lease_token,lease_expires_at,chunk_state_json)
    VALUES('snapshot-test','products','applying',@lease,@expiry,@state)`).run({ lease: context.leaseToken,
      expiry: new Date(Date.now()+3600000).toISOString(), state: JSON.stringify(state) })
  for (const [row, quantity] of [[1, 4], [2, 5]]) db.prepare(`INSERT INTO import_job_rows(job_id,phase,row_number,action,result_json) VALUES('snapshot-test','apply',@row,'update',@json)`)
    .run({ row, json: JSON.stringify({ existingId: 1, data: { branch_id: 1, stock_quantity: quantity, received_date: '2026-09-10' } }) })
  const invoke = work => metrics.runBackground(undefined, 'date-finalizer-fixture', async () => {
    const before = physical
    try { return await work() }
    finally {
      const attempts = physical-before
      assert.equal(metrics.currentRequestMetrics().invocation.attemptedStatements, attempts)
      assert.ok(attempts <= 1000, 'actual native dispatch including failed batches fits Paid invocation cap')
      assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      console.log('MEASURED date finalizer '+attempts)
    }
  })
  assert.equal(await invoke(() => engine.reconcileDuplicateProductSnapshotRows(finalDb, context.jobId, context)), 0)
  assert.match(state.genericApply.finalize.pendingHash, /^[a-f0-9]{64}$/)
  parity(1,5); parity(2,8)
  const plannedLots = lots(1)
  await assert.rejects(invoke(() => engine.reconcileDuplicateProductSnapshotRows(finalDb, context.jobId,
    { ...context, leaseToken: 'foreign-holder' })), /import_lease_changed/)
  assert.deepEqual(lots(1),plannedLots); parity(1,5)
  assert.equal(await invoke(() => engine.reconcileDuplicateProductSnapshotRows(finalDb, context.jobId, context)), 1)
  parity(1, 9); parity(2, 8)
  const finalizedLots = lots(1)
  assert.equal(await invoke(() => engine.reconcileDuplicateProductSnapshotRows(finalDb, context.jobId, context)), 0)
  assert.equal(state.genericApply.finalize.phase,'unify')
  assert.deepEqual(lots(1),finalizedLots); parity(1,9)
  await snapshot(1, 5)
  console.log('PASS real leased/digested duplicate finalizer uses grouped idempotent reconciliation and refuses a foreign holder')

  const original = lots(2)[0]
  await receive(2, 1, '11/09/2026', { batchId: original.id })
  assert.equal(lots(2)[0].received_at, '2026-03-04', 'exact-lot top-up retains first date')
  const plannedReturn = batches.planReceiveBatchStock({ productId: 1, branchId: 1, quantity: 2, receivedDate: '11/09/2026', provenanceKey: 'return:one:0', notes: 'Return receipt' })
  await stockWrite(plannedReturn.statements)
  const returnLot = lots(1).find((lot) => lot.batch_key === plannedReturn.batchKey)
  assert.equal(returnLot.received_at, '2026-09-11')
  assert.equal(returnLot.quantity, 2)
  assert.ok(returnLot.batch_key.startsWith(' event:return:'), 'return receipt is distinct from procurement on the same day')
  parity(1, 7)
  console.log('PASS first receipt date and event provenance remain distinct')

  await stockWrite([{ sql: 'UPDATE branch_stock SET quantity=quantity+3 WHERE product_id=1 AND branch_id=1' }])
  const input = { productId: 1, productName: 'A', branchId: 1, quantity: 2, unitPriceUsd: 10, costPriceUsd: 3, costPriceKhr: 12000, unlottedStock: true }
  const availableLots = new Map([['1:1', [{ batchId: returnLot.id, available: 2, receivedAt: '2026-09-11', lotCode: '110926', expiryDate: null }]]])
  const planned = additions.allocateNewSaleLines([input], availableLots, 'completed')
  assert.deepEqual(planned[0].takes, [], 'explicit unlotted source never FIFO allocates')
  assert.equal(availableLots.get('1:1')[0].available, 2)
  assert.equal(additions.resolveExplicitSaleLineBatches([{ ...input, batchId: returnLot.id }], availableLots).ok, false)
  await stockWrite(additions.planUnlottedSaleLineGuards(planned))
  const duplicate = additions.allocateNewSaleLines([input, input], availableLots, 'completed')
  await assert.rejects(stockWrite(additions.planUnlottedSaleLineGuards(duplicate)), /constraint/i, 'duplicate lines share one residual capacity')
  await assert.rejects(stockWrite([{ sql: 'UPDATE product_batches SET is_active=0 WHERE id=@id', params: { id: returnLot.id } }]), /Cannot deactivate a received lot/, '0154 rejects new inactive positive stock')
  // Historical corruption belongs to a genuinely pre-0154 physical schema. No current trigger is removed.
  const historical = openDb(loadAll({ through: 153 }))
  historical.exec(`INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1);
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',5);
    INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at) VALUES(1,1,'historical',0,'2026-09-11');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,2);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,5);`)
  await assert.rejects(historical.batch(additions.planUnlottedSaleLineGuards(duplicate)), /constraint/i, 'historical inactive lot stock remains attributed')
  await stockWrite([{ sql: 'UPDATE branch_stock SET quantity=quantity-2 WHERE product_id=1 AND branch_id=1' }])
  await assert.rejects(stockWrite(additions.planUnlottedSaleLineGuards(planned)), /constraint/i, 'racing residual change fails closed')
  assert.equal(additions.planUnlottedSaleLineGuards(additions.allocateNewSaleLines([input], availableLots, 'completed', true)).length, 0)
  console.log('PASS explicit unlotted choice, mixed provenance, duplicate capacity, inactive lots, stale residual and stock-skipped parity')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
