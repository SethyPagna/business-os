const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function receiptReturn(makeWorker, tier, condition = 'ordinary') {
  const f = await h.world(makeWorker, tier, 'zero', sql => {
    h.seed(0.1, true)(sql)
    sql.exec(`INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)
      VALUES(50,'RETURN-EXACT-ORIGINAL',1,'completed',4000,2,2);
      INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,batch_id,quantity,applied_price_usd,total_usd,cost_price_usd)
      VALUES(50,50,1,'Serum',1,1,0.2,10,2,2);
      INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)
      VALUES(50,1,1,0.2,0);`)
  })
  try {
    const before = f.sql.prepare('SELECT received_quantity,received_cost_usd,received_at,supplier_id,payment_status FROM product_batches WHERE id=1').get()
    const body = { sale_id: 50, branch_id: 1, reason: 'Fractional original receipt return',
      client_request_id: 'return-exact-' + condition, items: [{ sale_item_id: 50, product_id: 1,
        quantity: 0.2, stock_condition: condition, applied_price_usd: 10, applied_price_khr: 40000 }] }
    const response = await f.call('/returns', body)
    assert.equal(response.status, 200, JSON.stringify(response.json))
    assert.equal(f.state().physical, 0.3, 'return .2 to original .1 must produce exactly .3')
    assert.equal(f.state().cache, 0.3, 'cache must equal exact physical stock')
    assert.equal(f.state().lots[0].quantity, 0.3, 'original receipt must receive exact quantity')
    assert.deepEqual(f.sql.prepare('SELECT received_quantity,received_cost_usd,received_at,supplier_id,payment_status FROM product_batches WHERE id=1').get(), before, 'customer return must not change purchase attribution')
    if (condition !== 'ordinary') {
      const item = f.sql.prepare('SELECT id,stock_condition FROM return_items WHERE return_id=?').get(response.json.id)
      const tag = f.sql.prepare('SELECT batch_id,quantity_remaining,condition_tag FROM damaged_stock_lots WHERE return_item_id=?').get(item.id)
      assert.deepEqual(tag, { batch_id: 1, quantity_remaining: 0.2, condition_tag: condition })
    }
    const saved = f.state()
    assert.equal((await f.call('/returns', body)).status, 200)
    assert.deepEqual(f.state(), saved, 'same request must not repeat physical stock, tag or history')
    console.log('PASS exact original receipt return ' + tier + ' ' + condition)
  } finally { f.sql.close() }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const condition of ['ordinary', 'opened']) {
    await receiptReturn(makeWorker, tier, condition)
  }
  for (const tier of ['free', 'paid']) for (const kind of ['dated', 'NULL', 'none', 'dispose', 'race', 'late', 'ack', 'replacement']) {
    await finitePost(makeWorker,tier,kind)
  }
}

async function finitePost(makeWorker,tier,kind) {
  const originalNull = kind === 'NULL'
  const f = await h.world(makeWorker,tier,'zero',sql => {
    h.seed(.1,!originalNull)(sql)
    sql.exec(`INSERT INTO sales(id,receipt_number,branch_id,sale_status,exchange_rate,total_usd,amount_paid_usd)
      VALUES(50,'RETURN-EXACT-FINITE',1,'completed',4000,2,2);
      ${originalNull ? "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,NULL,0.2,0,'opened','remove',2);" : ''}
      INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,batch_id,damaged_lot_id,quantity,applied_price_usd,total_usd,cost_price_usd)
      VALUES(50,50,1,'Serum',1,${kind==='dated'||originalNull?'NULL':1},${originalNull?1:'NULL'},0.2,10,2,2);
      ${kind==='dated'||originalNull?'':"INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(50,1,1,0.2,0);"}`)
  })
  try {
    const purchases=f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all()
    const body={sale_id:50,branch_id:1,reason:'Finite exact return',client_request_id:'finite-'+kind,
      ...(kind==='replacement'?{replacement_items:[{product_id:1,branch_id:1,batch_id:1,quantity:.2,applied_price_usd:10}]}:{}),
      items:[{sale_item_id:50,product_id:1,quantity:.2,stock_condition:kind==='dispose'?'opened':'ordinary',
        ...(kind==='none'?{stock_action:'none'}:{}),...(kind==='dispose'?{damaged_disposition:'remove'}:{}),applied_price_usd:10}]}
    if(kind==='race') f.competeBeforeCommit([{sql:'UPDATE branch_stock SET quantity=0.15 WHERE product_id=1 AND branch_id=1'},
      {sql:'UPDATE branch_batch_stock SET quantity=0.15 WHERE batch_id=1 AND branch_id=1'},{sql:'UPDATE products SET stock_quantity=0.15 WHERE id=1'}])
    if(kind==='late')f.failWhenSqlMatches(/INSERT INTO return_create_receipts/)
    if(kind==='ack')f.loseNextCommitAcknowledgement()
    const before=f.state(),result=await f.call('/returns',body)
    if(kind==='replacement'&&result.status===400) {
      assert.equal(tier,'free');assert.equal(result.json.code,'customer_return_over_plan_budget');assert.deepEqual(f.state(),before)
      assert.equal(f.sql.prepare('SELECT count(*) n FROM returns').get().n,0)
    } else if(kind==='race') {
      assert.equal(result.status,409);assert.equal(result.json.code,'write_conflict')
      assert.equal(f.state().physical,.15);assert.deepEqual(f.state().movements,before.movements)
      assert.equal(f.sql.prepare('SELECT count(*) n FROM returns').get().n,0)
    } else if(kind==='late') {
      assert.equal(result.status,503);assert.equal(result.json.code,'unknown_outcome');assert.deepEqual(f.state(),before)
      assert.equal(f.sql.prepare('SELECT count(*) n FROM returns').get().n,0)
      assert.equal((await f.call('/returns',body)).status,200)
      assert.equal(f.state().physical,.3)
    } else {
      assert.equal(result.status,200,JSON.stringify(result.json))
      assert.equal(f.state().physical,kind==='none'||kind==='dispose'||kind==='replacement'?.1:.3)
      assert.equal(f.state().cache,f.state().physical)
      if(kind==='dated') {
        const lot=f.sql.prepare("SELECT * FROM product_batches WHERE batch_key LIKE ' event:return:%'").get()
        assert.ok(lot);assert.equal(lot.received_quantity,.2);assert.equal(lot.supplier_id,null);assert.equal(lot.received_cost_usd,null)
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=?').get(lot.id).quantity,.2)
      }
      if(originalNull) {
        assert.equal(f.state().lots[0].quantity,0)
        assert.equal(f.sql.prepare('SELECT batch_id FROM return_items').get().batch_id,null)
        assert.equal(f.sql.prepare('SELECT count(*) n FROM product_batches').get().n,1)
      }
      if(kind==='dispose') {
        assert.equal(f.sql.prepare('SELECT quantity_remaining FROM damaged_stock_lots').get().quantity_remaining,0)
        assert.equal(f.sql.prepare("SELECT count(*) n FROM inventory_movements WHERE movement_type='write_off'").get().n,1)
      }
      const saved=f.state();assert.equal((await f.call('/returns',body)).status,200);assert.deepEqual(f.state(),saved)
    }
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches WHERE id=1').get(),purchases[0],'original purchase receipt remains immutable')
    console.log('PASS finite POST '+tier+' '+kind)
  }finally{f.sql.close()}
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { receiptReturn }
