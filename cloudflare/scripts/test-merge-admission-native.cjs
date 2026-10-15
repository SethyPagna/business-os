'use strict'
const assert=require('node:assert/strict')
const {startWorker,recorder,budgetLine,historyStep,createSale,addSaleItems}=require('./harness/al_money_native.cjs')
const mode=process.argv.find(value=>value.startsWith('--mode='))?.slice(7)||'normal'
const patches=[]
if(['short','lost','group-short','group-lost'].includes(mode)) patches.push({name:`one committed merge ${mode} result`,file:'src/lib/stockTransaction.ts',from:'    results = await dispatch()',to:`    results = await dispatch()
    if(businessCount>20 && !(globalThis as any).__mergeDispatchFault){(globalThis as any).__mergeDispatchFault=true;${mode.endsWith('short')?'results=results.slice(0,-1)':'throw new Error("Synthetic lost acknowledgement after committed merge dispatch")'}}`})
if(mode==='rollback') patches.push({name:'middle physical merge failure',file:'src/routes/products.ts',from:'  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []',to:`  statements.push({sql:"SELECT json_extract('', '$')"})
  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []`})
if(mode==='malformed-lost') patches.push({name:'unrelated malformed snapshot after committed fold',file:'src/routes/products.ts',from:"    batchResults = await executeStockTransaction(db, statements, 'retry')",to:`    batchResults = await executeStockTransaction(db, statements, 'retry')
    if(!(globalThis as any).__malformedReceiptFault){(globalThis as any).__malformedReceiptFault=true;await db.prepare("INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id) VALUES('product.merge','applied','{',@actor)").run({actor:user?.id??null});throw new Error('Synthetic committed lost acknowledgement with unrelated malformed snapshot')}`})
if(mode==='identity-lost') patches.push({name:'lost identity fold acknowledgement',file:'src/routes/products.ts',from:"    batchResults = await executeStockTransaction(db, statements, 'retry')",to:`    batchResults = await executeStockTransaction(db, statements, 'retry')
    if(context==='edit identity fold') throw new Error('Synthetic identity fold committed acknowledgement loss')`})
async function main(){
 const h=await startWorker({patches}),proof=recorder(`merge admission ${mode}`)
 const permit=()=>h.one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")
 const seed=async(keep,dup,identity=false,{third,value=5,manual}={})=>{
  const rows=[{sql:"INSERT INTO system_flags(key,value,updated_at) VALUES('stock_transaction_permit','legacy-separate-pool-v1',CURRENT_TIMESTAMP)"}]
  for(const [id,cost,quantity] of [[keep,value,5],[dup,9,2],...(third?[[third,9,2]]:[])]){
   rows.push({sql:'INSERT INTO products(id,name,name_key,barcode,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr,selling_price_usd,stock_quantity,is_active) VALUES(?,?,?,?,?,?,?,?,10,?,1)',values:[id,identity&&id===dup?`Different ${id}`:`Admission ${keep}`,identity&&id===dup?`different ${id}`:`admission ${keep}`,identity&&id===dup?`865${dup}`:`865${keep}`,cost,cost===null?null:cost*4000,cost,cost===null?null:cost*4000,quantity]},
    {sql:'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)',values:[id,quantity]})
  }
  if(manual!==undefined)rows.push({sql:"INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(?,?,'manual',0)",values:[keep,manual]})
  rows.push({sql:"DELETE FROM system_flags WHERE key='stock_transaction_permit'"})
  await h.db.batch(rows.map(row=>h.db.prepare(row.sql).bind(...(row.values||[]))))
  assert.equal((await permit()).n,0)
 }
 const state=ids=>h.all(`SELECT id,name,barcode,cost_price_usd,cost_review_key,is_active,stock_quantity FROM products WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`,...ids)
 try{
  assert.equal((await h.one("SELECT value FROM system_flags WHERE key='stock_schema_epoch'")).value,'legacy-separate-pool-v1')
  assert.equal((await h.one("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE '%0258'")).n,5)
  if(mode.startsWith('group')) {
   for(const [index,value,manual,expected] of (mode==='group'?[[0,null,undefined,null],[1,0,undefined,0],[2,5,7.123456789012345,7.123456789012345]]:[[0,5,undefined,5]])) {
    const keep=820000+index*10,dup=keep+1,third=keep+2
    await seed(keep,dup,false,{third,value,manual})
    const preview=await h.call('POST','/api/products/possible-duplicates/merge-batch/preview',{manifest_version:1,resolution_version:2,client_request_id:`admission-group-${keep}`,merge_groups:[{group_key:`barcode:865${keep}`,member_ids:[keep,dup,third]}],remove_rows:[]},`admitted group preview ${keep}`)
    assert.equal(preview.status,200,JSON.stringify(preview.body));const group=preview.body.page.groups[0]
    const final=await h.call('POST',`/api/products/possible-duplicates/merge-batch/reviews/${preview.body.review_id}/finalize`,{manifest_version:1,resolution_version:2,review_id:preview.body.review_id,draft_digest:preview.body.draft_digest,resolutions:[{group_key:group.group_key,keeper_id:keep,barcode:{mode:'member',source_product_id:keep},category_source_id:keep,brand_source_id:keep,unit_source_id:keep}]},`admitted group finalize ${keep}`)
    assert.equal(final.status,200,JSON.stringify(final.body))
    const body={review_id:preview.body.review_id,manifest_digest:final.body.manifest_digest,client_request_id:preview.body.review_id}
    let apply=await h.call('POST','/api/products/possible-duplicates/merge-batch',body,`admitted group apply ${keep}`)
    console.log('GROUP_APPLY',JSON.stringify({mode,status:apply.status,body:apply.body}))
    proof.check(`group ${keep} committed dispatch resolves without duplicate fold`,()=>assert.equal(apply.status,200,JSON.stringify(apply.body)))
    for(let i=0;i<5&&(apply.status!==200||apply.body.continuation_required);i++)apply=await h.call('POST','/api/products/possible-duplicates/merge-batch',body,`admitted group continuation ${keep}/${i}`)
    assert.equal(apply.status,200,JSON.stringify(apply.body));assert.equal(apply.body.continuation_required,false)
    const history=await h.one('SELECT action_history_id FROM product_conflict_action_groups WHERE review_id=?',preview.body.review_id)
    const originals=await h.all("SELECT id,details FROM audit_logs WHERE action='merge_duplicate' AND entity_id IN (?,?) ORDER BY id",String(dup),String(third))
    proof.check(`group ${keep} exactly two immutable forward folds`,()=>assert.equal(originals.length,2))
    for(const [direction,generation,total] of [['undo',0,5],['redo',1,9],['undo',2,5]]) {
     let response
     for(let i=0;i<5;i++){response=await historyStep(h,history.action_history_id,direction,generation,`admitted group ${direction} ${generation}/${keep}/${i}`);if(response.status!==200||!response.body.continuation_required)break}
     proof.check(`group ${keep} actual ${direction} ${generation} admitted`,()=>assert.equal(response.status,200,JSON.stringify(response.body)))
     assert.equal((await h.one('SELECT stock_quantity FROM products WHERE id=?',keep)).stock_quantity,total)
     assert.equal((await permit()).n,0)
     if(direction==='redo')assert.equal((await h.one('SELECT cost_price_usd FROM products WHERE id=?',keep)).cost_price_usd,expected)
    }
    assert.deepEqual(await h.all('SELECT id,details FROM audit_logs WHERE id IN (?,?) ORDER BY id',...originals.map(r=>r.id)),originals)
   }
   budgetLine(h.metrics);console.log(JSON.stringify({results:proof.results}));if(proof.results.some(row=>!row.ok))process.exitCode=1;return
  }
  if(mode==='sale') {
   await seed(830001,830002)
   await h.db.batch([
    h.db.prepare("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')"),
    h.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,batch_number) VALUES(835001,830001,'admission-sale-lot','2026-09-01',1,1)"),
    h.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(835001,1,5)'),
    h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
   assert.equal((await permit()).n,0)
   const sale=await createSale(h,{key:'admission-sale',lines:[{productId:830001,quantity:1,quote:{gross_usd:10,product_discount_usd:0,manual_discount_usd:0,total_usd:10,total_khr:40000}}],paymentDetails:[{method:'Cash',amount_usd:10,amount_khr:0}]})
   assert.equal(sale.status,200,JSON.stringify(sale.body))
   const add=await addSaleItems(h,sale.body.id,'admission-sale-add',[{productId:830001,quantity:1}],'admitted actual sale add')
   assert.equal(add.status,200,JSON.stringify(add.body));const id=add.body.undoActionId||add.body.actionHistoryId;assert.ok(id)
   for(const [direction,generation,total] of [['undo',0,10],['redo',1,20],['undo',2,10]]){
    const response=await historyStep(h,id,direction,generation,`admitted sale ${direction}/${generation}`)
    const receipt=await h.one('SELECT reversible,status FROM action_history WHERE id=?',id)
    proof.check(`sale added items ${direction} ${generation} remains reversible`,()=>{assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(receipt.reversible,1);assert.equal((response.body.success),true)})
    assert.equal((await h.one('SELECT total_usd FROM sales WHERE id=?',sale.body.id)).total_usd,total);assert.equal((await permit()).n,0)
   }
   budgetLine(h.metrics);console.log(JSON.stringify({results:proof.results}));if(proof.results.some(row=>!row.ok))process.exitCode=1;return
  }
  await seed(810001,810002)
  const before=await state([810001,810002])
  const tables=['products','branch_stock','product_batches','branch_batch_stock','product_cost_entries','audit_logs','action_history','undo_snapshots','inventory_movements','stock_session_revisions']
  const businessState=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await h.all(`SELECT * FROM ${table} ORDER BY rowid`)])))
  const graphBefore=await businessState()
  if(mode==='maintenance')await h.db.batch([
   h.db.prepare("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')"),
   h.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify({mode:'restore',token:'synthetic-admission-holder',backupKey:'fixture-only',phase:'inserting',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),startedBy:'fixture'})),
   h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
  if(mode==='epoch')await h.db.prepare("UPDATE system_flags SET value='wrong-epoch' WHERE key='stock_schema_epoch'").run()
  const merged=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:810001,mergeId:810002,keep:true,stock:'merge'},'admitted direct merge')
  assert.equal((await permit()).n,0,'request leaves no stock permit')
  if(mode==='rollback'||mode==='epoch'||mode==='maintenance'){
   proof.check('refused dispatch preserves physical graph',()=>{assert.notEqual(merged.status,200,JSON.stringify(merged.body))})
   assert.deepEqual(await state([810001,810002]),before);assert.deepEqual(await businessState(),graphBefore)
   if(mode==='epoch')assert.equal(merged.body.code,'stock_schema_unavailable')
   if(mode==='maintenance')assert.equal(merged.status,503)
  }else{
   proof.check('current merge passes both active schema fences',()=>assert.equal(merged.status,200,JSON.stringify(merged.body)))
   if(merged.status!==200){budgetLine(h.metrics);process.exitCode=1;return}
   const after=await state([810001,810002])
   assert.equal(after[0].stock_quantity,7);assert.equal(after[0].cost_price_usd,5);assert.equal(after[1].is_active,0)
   const row=await h.one("SELECT h.id,h.undo_payload FROM action_history h JOIN undo_snapshots s ON s.id=CAST(json_extract(h.undo_payload,'$.snapshot_id') AS INTEGER) WHERE s.kind='product.merge' AND json_extract(s.payload_json,'$.dupId')=810002 ORDER BY h.id DESC LIMIT 1")
   assert.ok(row?.id,JSON.stringify(merged.body));assert.equal(merged.body.actionHistoryId||merged.body.undoActionId||row.id,row.id)
   const originalAudits=await h.one("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate' AND entity_id='810002'")
   proof.check('committed result recovery records exactly one fold',()=>assert.equal(originalAudits.n,1))
   for(const [direction,generation,total] of [['undo',0,5],['redo',1,7],['undo',2,5]]){
    const response=await historyStep(h,row.id,direction,generation,`admitted ${direction} ${generation}`)
    proof.check(`real history ${direction} ${generation} remains admitted`,()=>assert.equal(response.status,200,JSON.stringify(response.body)))
    assert.equal((await h.one('SELECT stock_quantity FROM products WHERE id=810001')).stock_quantity,total)
    assert.equal((await permit()).n,0)
   }
   if(mode==='normal'||mode==='identity-lost'){
    await seed(810003,810004,true)
    const current=await h.one('SELECT updated_at FROM products WHERE id=810004')
    const identity=await h.call('PUT','/api/products/810004',{name:'Admission 810003',barcode:'865810003',expected_updated_at:current.updated_at,selling_price_usd:15},'admitted identity fold')
    proof.check('identity fold and selling intent pass schema fences',()=>{assert.equal(identity.status,200,JSON.stringify(identity.body))})
    const kept=await h.one('SELECT stock_quantity,selling_price_usd FROM products WHERE id=810003');assert.equal(kept.stock_quantity,7);assert.equal(kept.selling_price_usd,15)
   }
  }
  budgetLine(h.metrics);console.log(JSON.stringify({results:proof.results}));if(proof.results.some(row=>!row.ok))process.exitCode=1
 }finally{await h.mf.dispose();console.log('DISPOSED merge admission Worker')}
}
main().catch(error=>{console.error(error);process.exitCode=1})
