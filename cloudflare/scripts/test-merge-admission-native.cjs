'use strict'
const assert=require('node:assert/strict')
const {startWorker,recorder,budgetLine,historyStep}=require('./harness/al_money_native.cjs')
const mode=process.argv.find(value=>value.startsWith('--mode='))?.slice(7)||'normal'
const patches=[]
if(['short','lost'].includes(mode)) patches.push({name:`one committed merge ${mode} result`,file:'src/lib/stockTransaction.ts',from:'    results = await dispatch()',to:`    results = await dispatch()
    if(businessCount>20 && !(globalThis as any).__mergeDispatchFault){(globalThis as any).__mergeDispatchFault=true;${mode==='short'?'results=results.slice(0,-1)':'throw new Error("Synthetic lost acknowledgement after committed merge dispatch")'}}`})
if(mode==='rollback') patches.push({name:'middle physical merge failure',file:'src/routes/products.ts',from:'  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []',to:`  statements.push({sql:"SELECT json_extract('', '$')"})
  let batchResults: Array<{ meta?: { last_row_id?: number } }> = []`})
async function main(){
 const h=await startWorker({patches}),proof=recorder(`merge admission ${mode}`)
 const permit=()=>h.one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")
 const seed=async(keep,dup,identity=false)=>{
  const rows=[{sql:"INSERT INTO system_flags(key,value,updated_at) VALUES('stock_transaction_permit','legacy-separate-pool-v1',CURRENT_TIMESTAMP)"}]
  for(const [id,cost,quantity] of [[keep,5,5],[dup,9,2]]){
   rows.push({sql:'INSERT INTO products(id,name,name_key,barcode,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr,selling_price_usd,stock_quantity,is_active) VALUES(?,?,?,?,?,?,?,?,10,?,1)',values:[id,identity&&id===dup?`Different ${id}`:`Admission ${keep}`,identity&&id===dup?`different ${id}`:`admission ${keep}`,identity&&id===dup?`865${dup}`:`865${keep}`,cost,cost*4000,cost,cost*4000,quantity]},
    {sql:'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)',values:[id,quantity]})
  }
  rows.push({sql:"DELETE FROM system_flags WHERE key='stock_transaction_permit'"})
  await h.db.batch(rows.map(row=>h.db.prepare(row.sql).bind(...(row.values||[]))))
  assert.equal((await permit()).n,0)
 }
 const state=ids=>h.all(`SELECT id,name,barcode,cost_price_usd,cost_review_key,is_active,stock_quantity FROM products WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`,...ids)
 try{
  assert.equal((await h.one("SELECT value FROM system_flags WHERE key='stock_schema_epoch'")).value,'legacy-separate-pool-v1')
  assert.equal((await h.one("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE '%0258'")).n,5)
  await seed(810001,810002)
  const before=await state([810001,810002])
  if(mode==='epoch')await h.db.prepare("UPDATE system_flags SET value='wrong-epoch' WHERE key='stock_schema_epoch'").run()
  const merged=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:810001,mergeId:810002,keep:true,stock:'merge'},'admitted direct merge')
  assert.equal((await permit()).n,0,'request leaves no stock permit')
  if(mode==='rollback'||mode==='epoch'){
   proof.check('refused dispatch preserves physical graph',()=>{assert.notEqual(merged.status,200,JSON.stringify(merged.body))})
   assert.deepEqual(await state([810001,810002]),before)
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
   if(mode==='normal'){
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
