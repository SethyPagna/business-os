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
const originalHistory=f=>({items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(),receipts:f.sql.prepare('SELECT * FROM return_create_receipts ORDER BY id').all(),
  batches:f.sql.prepare('SELECT * FROM product_batches WHERE id=1').all(),history:f.sql.prepare('SELECT * FROM action_history WHERE id=1000').all(),
  plans:f.sql.prepare("SELECT * FROM undo_snapshots WHERE kind LIKE 'product.merge.%' ORDER BY id").all()})
const fullState=f=>Object.fromEntries(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]))
async function changedTarget(make){
 for(const tier of ['free','paid'])for(const receipt of [false,true])for(const tagged of [false,true]){
  const {f,id}=await fixture(make,tier,receipt,tagged)
  try{
   const original=originalHistory(f),cancelled=await f.call('/returns/bulk',request(f,id,'first-landing-cancel'));assert.equal(cancelled.status,200)
   const db=getDb(f.env)
   await executeStockTransaction(db,[{sql:"INSERT INTO products(id,name,is_active,stock_quantity)VALUES(3,'Later keeper',1,0)"},{sql:'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(3,1,0)'}],'once')
   const snapshot=await readProductMergeCaseSnapshot(db,3,2,[])
   await executeStockTransaction(db,planProductMergeForwardStock(snapshot,{planId:2000,transitionId:2001,historyId:2000,actorId:7,actorName:'Operator',requestId:'later-landing',requestDigest:'later-landing-original-source',
    origins:{operationId:'later-landing',receiptIds:snapshot.duplicateBatchRows.map((row,index)=>({sourceReceiptId:row.id,targetReceiptId:300+index})),
     tagIds:snapshot.damagedStockRows.filter(row=>row.product_id===2).map((row,index)=>({sourceTagId:row.id,targetTagId:400+index}))}}).statements,'once')
   const undo=await f.call('/action-history/'+cancelled.json.actionHistoryId+'/undo',{expected_generation:0});assert.equal(undo.status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=3').get().stock_quantity,tagged?.5:.2)
   assert.equal((await f.call('/action-history/'+cancelled.json.actionHistoryId+'/redo',{expected_generation:1})).status,200)
   assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=3').get().stock_quantity,tagged?.6:.3)
   assert.equal(stock(f).every(row=>row.stock_quantity===0),true)
   const proofs=f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' ORDER BY id").all().map(row=>JSON.parse(row.payload_json))
   assert.deepEqual(proofs.map(proof=>[proof.generation,proof.sources[0].effect.productId]),[[0,2],[1,3],[2,3]])
   assert.deepEqual(originalHistory(f).items,original.items);assert.deepEqual(originalHistory(f).receipts,original.receipts);assert.deepEqual(originalHistory(f).batches,original.batches)
   assert.deepEqual(originalHistory(f).history,original.history)
  }finally{f.sql.close()}
 }
}
async function faults(make){
 for(const tier of ['free','paid'])for(const tagged of [false,true])for(const phase of ['apply','undo','redo'])for(const fault of ['ack','late','source','target','actor','generation']){
  if(phase==='apply' && fault==='generation')continue
  const {f,id}=await fixture(make,tier,true,tagged)
  try{
   let history
   if(phase!=='apply'){const r=await f.call('/returns/bulk',request(f,id,'fault-setup'));assert.equal(r.status,200);history=r.json.actionHistoryId}
   if(phase==='redo')assert.equal((await f.call('/action-history/'+history+'/undo',{expected_generation:0})).status,200)
   const body=request(f,id,'merge-fault-action'),invoke=()=>phase==='apply'?f.call('/returns/bulk',body):f.call('/action-history/'+history+'/'+phase,{expected_generation:phase==='undo'?0:1})
   const before=fullState(f);let rivalState
   if(fault==='ack')f.loseNextCommitAcknowledgement()
   else if(fault==='late')f.failWhenSqlMatches(/INSERT INTO audit_logs/)
   else f.beforeCommit(async()=>{
    const statement={source:"UPDATE product_batches SET supplier_name='Rival original finance' WHERE id=1",target:"UPDATE product_batches SET unit_cost_usd=9 WHERE id=100",actor:'UPDATE users SET is_active=0 WHERE id=7',generation:'UPDATE return_bulk_operations SET generation=99 WHERE history_id='+history}[fault]
    await executeStockTransaction(getDb(f.env),[{sql:statement}],'once');rivalState=fullState(f)
   })
   const result=await invoke()
   if(fault==='ack'){
    assert.equal(result.status,200,JSON.stringify({tier,tagged,phase,fault,result}));const committed=fullState(f)
    assert.equal((await invoke()).status,200)
    for(const table of ['inventory_movements','return_items','return_create_receipts','return_bulk_operations','undo_snapshots','action_history','audit_logs'])assert.deepEqual(fullState(f)[table],committed[table],table+' once business effects')
   }else if(fault==='late'){
    assert.equal(result.status,503,JSON.stringify({tier,tagged,phase,fault,result}));assert.deepEqual(fullState(f),before)
    assert.equal((await invoke()).status,200)
   }else{assert.equal(result.status,409,JSON.stringify({tier,tagged,phase,fault,result}));assert.deepEqual(fullState(f),rivalState,'complete postrival database unchanged')}
  }finally{f.sql.close()}
 }
}
async function main() {
  const make = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) for (const tagged of [false, true]) {
    const { f, id } = await fixture(make, tier, receipt, tagged)
    try {
      const original=originalHistory(f),before = stock(f), result = await f.call('/returns/bulk', request(f, id, 'merge-return-cancel'))
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
      assert.deepEqual(originalHistory(f),original,'original financial/source/history bytes remain untouched')
      const proofs=f.sql.prepare("SELECT * FROM undo_snapshots WHERE kind='return.fields.bulk.physical.v1' ORDER BY id").all()
      assert.equal(proofs.length,3)
      for(const proof of proofs)for(const sql of ['UPDATE undo_snapshots SET payload_json=\'{}\' WHERE id=@id','DELETE FROM undo_snapshots WHERE id=@id',
        "INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id)VALUES(@id,'unrelated','recorded','{}',7)"]){
       const current=fullState(f)
       await assert.rejects(executeStockTransaction(getDb(f.env),[{sql,params:{id:proof.id}}],'once'),/return_merge_physical_proof_/)
       assert.deepEqual(fullState(f),current)
      }
    } finally { f.sql.close() }
  }
  if(!process.argv.includes('--baseline')){await changedTarget(make);await faults(make)}
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { fixture, request, stock }
