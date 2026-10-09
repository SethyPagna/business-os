const assert = require('node:assert/strict')
const { ready, options, state } = require('./test-product-merge-forward-catalog-native.cjs')
const { world, adapter, capture, load } = require('./test-product-merge-origin-plan-native.cjs')
const reservations = load('lib/productMergeReservations.ts')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { planProductMergeForwardCatalog } = load('lib/productMergeForwardCatalog.ts')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { readProductMergeCaseSnapshot } = load('lib/productMergeSnapshot.ts')
const tables = ['undo_snapshots','action_history','product_batches','damaged_stock_lots','product_images']
const burned = [10001,20001,30001,40001,50001]
const write = (sql,params) => ({sql,params})
function occupy(table,id) {
  const sql = { undo_snapshots: "INSERT INTO undo_snapshots(id,kind,status,payload_json) VALUES(@id,'reservation.fixture','recorded','{}')",
    action_history: "INSERT INTO action_history(id,label,entity) VALUES(@id,'Unrelated reservation fixture','unrelated')",
    product_batches: "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_quantity,received_cost_usd) VALUES(@id,4,'occupied:'||@id,1,0,0)",
    damaged_stock_lots: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,quantity,quantity_remaining,condition_tag) VALUES(@id,4,1,0,0,'damaged')",
    product_images: "INSERT INTO product_images(id,product_id,image_path) VALUES(@id,4,'occupied:'||@id)" }[table]
  return write(sql,{id})
}
async function burn(d1) {
  await executeStockTransaction(adapter(d1),tables.flatMap((table,index)=>[occupy(table,burned[index]),write(`DELETE FROM ${table} WHERE id=@id`,{id:burned[index]})]),'once')
}
async function propose(d1,snapshot,operation='reservation-proof',images=2) {
  let reads=0
  const db={batch:rows=>{reads+=rows.length;return d1.batch(rows)}}
  const before=state(d1)
  const ids=await reservations.readProductMergeReservations(db,snapshot,operation,images)
  assert.equal(reads,1,'one coherent native read')
  assert.deepEqual(state(d1),before,'ID proposal changes no table, sequence, permit or history')
  return ids
}
function compile(snapshot,ids) {
  const catalog=planProductMergeForwardCatalog(snapshot,{...options,imageIds:ids.imageIds})
  const stock=planProductMergeForwardStock(snapshot,{...ids,actorId:7,actorName:'Operator',requestId:'reserved-merge',requestDigest:'original-request'})
  const statements=[...stock.statements]
  const derive=statements.findIndex(row=>row.sql.includes('cost_price_usd =')&&row.sql.includes('UPDATE products'))
  assert.ok(derive>0)
  statements.splice(derive,0,...catalog.statements)
  statements.splice(1,0,...catalog.admissionGuards.slice(1))
  return {statements,catalog,stock}
}
async function burnedPositive() {
  const d1=await ready()
  try {
    d1.db.exec(productMergeProtocolSchemaSql())
    await burn(d1)
    const snapshot=await capture(d1),ids=await propose(d1,snapshot)
    assert.deepEqual([ids.planId,ids.transitionId,ids.historyId],[10002,10003,20002])
    assert.deepEqual(ids.origins.receiptIds.map(row=>row.targetReceiptId),[30002,30003,30004,30005])
    assert.deepEqual(ids.origins.tagIds.map(row=>row.targetTagId),[40002,40003,40004])
    assert.deepEqual(ids.imageIds,[50002,50003])
    assert.deepEqual(ids.origins.receiptIds.map(row=>row.sourceReceiptId),[10,11,12,13])
    assert.deepEqual(ids.origins.tagIds.map(row=>row.sourceTagId),[20,21,22])
    for(let index=0;index<tables.length;index++)assert.ok(d1.db.prepare(`SELECT COALESCE(MAX(id),0)+1 next FROM ${tables[index]}`).get().next<=burned[index],'max(id)+1 wrongly reuses burned identity')
    const compiled=compile(snapshot,ids)
    await executeStockTransaction(adapter(d1),compiled.statements,'once')
    assert.equal(d1.db.prepare('SELECT status FROM undo_snapshots WHERE id=?').get(ids.transitionId).status,'sealed')
    assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd,5)
    assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_batches WHERE id>=30002').get().n,4)
    assert.deepEqual(d1.db.prepare('SELECT id FROM product_images WHERE id>=50002 ORDER BY id').all().map(row=>row.id),ids.imageIds)
    console.log('PASS burned high sequences: one read/no mutation, exact source mappings and real compiler+catalog seal')
  } finally {d1.db.close()}
}
async function races() {
  for(const kind of ['plan','transition','history','receipt','tag','image']) {
    const d1=await ready()
    try {
      d1.db.exec(productMergeProtocolSchemaSql())
      const snapshot=await capture(d1),ids=await propose(d1,snapshot),compiled=compile(snapshot,ids)
      const [table,id]={plan:['undo_snapshots',ids.planId],transition:['undo_snapshots',ids.transitionId],history:['action_history',ids.historyId],receipt:['product_batches',ids.origins.receiptIds[0].targetReceiptId],tag:['damaged_stock_lots',ids.origins.tagIds[0].targetTagId],image:['product_images',ids.imageIds[0]]}[kind]
      await executeStockTransaction(adapter(d1),[occupy(table,id)],'once')
      const before=state(d1)
      await assert.rejects(executeStockTransaction(adapter(d1),compiled.statements,'once'))
      assert.deepEqual(state(d1),before,'rival '+kind+' remains, complete attempted merge rolls back')
      console.log('PASS occupied '+kind+' ID predispatch race wholeDB rollback')
    } finally {d1.db.close()}
  }
}
async function controls() {
  const d1=await ready()
  try {
    const snapshot=await capture(d1),before=state(d1)
    for(const [op,count]of [['',2],['../bad',2],['x'.repeat(81),2],['ok',-1],['ok',1.5],['ok','2'],['ok',10001]])assert.throws(()=>reservations.planProductMergeReservations(snapshot,op,count),/merge_state_conflict/)
    assert.deepEqual(state(d1),before,'rejected no-call plans have no side effects')
    const plan=reservations.planProductMergeReservations(snapshot,'pure-controls',2)
    assert.equal(plan.reads.length,1)
    const good=Object.fromEntries(tables.flatMap(table=>[[table+'_id',0],[table+'_seq',null],[table+'_sequences',0]]))
    const decode=row=>plan.decode(new Map([['reservations',[row]]]))
    assert.throws(()=>plan.decode(new Map()),/merge_reservation_incomplete/)
    assert.throws(()=>plan.decode(new Map([['reservations',[good,good]]])),/merge_reservation_incomplete/)
    for(const [key,value]of [['undo_snapshots_id',Number.MAX_SAFE_INTEGER],['undo_snapshots_id',-1],['undo_snapshots_id','1'],['product_batches_id',1.5],['product_images_seq','1'],['product_images_sequences',2]])assert.throws(()=>decode({...good,[key]:value}),/merge_reservation_invalid|merge_reservation_overflow/)
    const maximum=reservations.planProductMergeReservations(snapshot,'max-gallery',10000).decode(new Map([['reservations',[good]]]));assert.equal(maximum.imageIds.length,10000);assert.equal(maximum.imageIds[9999],10000)
    const saved=snapshot.duplicateProduct;snapshot.duplicateProduct=undefined;assert.throws(()=>reservations.planProductMergeReservations(snapshot,'missing-source',2),/merge_state_conflict/);snapshot.duplicateProduct=saved
    const seq={...good,undo_snapshots_id:100,undo_snapshots_seq:50,undo_snapshots_sequences:1}
    assert.equal(decode(seq).planId,101,'existing row maximum wins over lower sequence')
    snapshot.duplicateBatchRows[0].id=999
    assert.throws(()=>reservations.planProductMergeReservations(snapshot,'mutated',2),/merge_snapshot_incomplete/)
    console.log('PASS safe count/operation/row/type/sequence/overflow and in-memory source controls')
  } finally {d1.db.close()}
  const zero=world()
  try {
    await executeStockTransaction(adapter(zero),[{sql:'INSERT INTO products(id,name,is_active,stock_quantity) VALUES(4,\'Zero source\',1,0)'},{sql:'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(4,1,0)'}],'once')
    const snapshot=await readProductMergeCaseSnapshot(adapter(zero),1,4,[])
    const ids=await propose(zero,snapshot,'zero-source',0)
    assert.deepEqual(ids.origins.receiptIds,[]);assert.deepEqual(ids.origins.tagIds,[]);assert.deepEqual(ids.imageIds,[])
    assert.ok(ids.planId>0&&ids.transitionId===ids.planId+1&&ids.historyId>0)
    console.log('PASS zero-source maps empty derivatives while proposing fresh plan/head identities')
  } finally {zero.db.close()}
}
async function main(){await burnedPositive();await races();await controls()}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={propose,compile,burn,main}
