const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const { load } = require('./test-product-merge-origin-plan-native.cjs')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { getDb } = load('lib/db.ts')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const { readProductMergeCaseSnapshot } = load('lib/productMergeSnapshot.ts')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { returnMergePhysicalProofSchemaSql } = load('lib/returnBulkAction.ts')
async function fixture(make, tier, receipt, tagged) {
  const f = await h.world(make, tier, 'zero', sql => {
    h.seed(.3, receipt)(sql)
    sql.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(2,'Physical keeper',1,0); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0)")
    if (tagged) sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd) VALUES(1,1,1,${receipt ? 1 : 'NULL'},.3,.3,'damaged','remove',2)`)
  })
  f.sql.exec(productMergeProtocolSchemaSql())
  if(returnMergePhysicalProofSchemaSql)f.sql.exec(returnMergePhysicalProofSchemaSql())
  const created = await f.call('/returns/supplier', { branch_id: 1, reason: 'Original supplier source', settlement: 'refund',
    supplier_name: 'Original supplier', exchange_rate: 4000, client_request_id: 'merge-return-create',
    items: [{ product_id: 1, branch_id: 1, quantity: .1, cost_price_usd: 2, stock_condition: tagged ? 'damaged' : 'ordinary',
      ...(tagged ? { damaged_lot_id: 1 } : {}) }] })
  assert.equal(created.status, 200, JSON.stringify(created))
  const id = created.json.id, db = getDb(f.env)
  const snapshot = await readProductMergeCaseSnapshot(db, 2, 1, [])
  const compiled = planProductMergeForwardStock(snapshot, { planId: 1000, transitionId: 1001, historyId: 1000,
    actorId: 7, actorName: 'Operator', requestId: 'merge-before-return-cancel', requestDigest: 'fixture-original-source',
    origins: { operationId: 'merge-before-return-cancel',
      receiptIds: snapshot.duplicateBatchRows.map((row, index) => ({ sourceReceiptId: row.id, targetReceiptId: 100 + index })),
      tagIds: snapshot.damagedStockRows.filter(row => row.product_id === 1).map((row, index) => ({ sourceTagId: row.id, targetTagId: 200 + index })),
    } })
  await executeStockTransaction(db, compiled.statements, 'once')
  return { f, id }
}
const stock = f => f.sql.prepare('SELECT id,stock_quantity,is_active FROM products WHERE id IN(1,2) ORDER BY id').all()
const request = (f, id, key) => ({ client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
  items: f.sql.prepare('SELECT id,status expected_status,supplier_settlement expected_method,updated_at expected_updated_at FROM returns WHERE id=?').all(id) })
async function main() {
  const make = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) for (const tagged of [false, true]) {
    const { f, id } = await fixture(make, tier, receipt, tagged)
    try {
      const before = stock(f), result = await f.call('/returns/bulk', request(f, id, 'merge-return-cancel'))
      console.log(JSON.stringify({ tier, receipt, tagged, before, result }))
      if (process.argv.includes('--baseline')) {
        assert.equal(result.status, 409)
        assert.deepEqual(stock(f), before)
        continue
      }
      assert.equal(result.status, 200, 'validated original supplier history must restore at proven physical keeper')
      assert.equal(stock(f)[0].stock_quantity, 0)
      assert.equal(stock(f)[1].stock_quantity, tagged?.6:.3)
      const history=result.json.actionHistoryId
      assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
      assert.deepEqual(stock(f),before)
      assert.equal((await f.call('/action-history/'+history+'/redo',{expected_generation:1})).status,200)
      assert.equal(stock(f)[1].stock_quantity,tagged?.6:.3)
    } finally { f.sql.close() }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { fixture, request, stock }
