const assert=require('node:assert/strict')
const {startWorker,budgetLine}=require('./harness/al_money_native.cjs')

async function main(){
 const fault=process.argv.includes('--lost-ack-undo')?'undo':process.argv.includes('--lost-ack-redo')?'redo':process.argv.includes('--rollback')?'rollback':process.argv.includes('--finalize-once')?'finalize':process.argv.includes('--finalize-race')?'race':null
 const patches=fault?[{name:'actual D1 batch '+fault,file:'src/lib/db.ts',
  from:'return metered(() => this.d1.batch(prepared), metasOf, statements.length)',
  to:`const target=statements.some(s=>s.sql.includes('merge_cost_replay_guard') && (s.params as any)?.fromStatus==='${fault==='redo'?'redoable':'undoable'}');
    const finalizing=statements.some(s=>s.sql.includes('merge_cost_fingerprint_guard'));
    if(finalizing && '${fault}'==='finalize' && !(globalThis as any).__mergeFinalizeFault){(globalThis as any).__mergeFinalizeFault=true;throw new Error('fixture_finalize_unavailable')}
    if(finalizing && '${fault}'==='race' && !(globalThis as any).__mergeFinalizeFault){(globalThis as any).__mergeFinalizeFault=true;await this.d1.prepare("UPDATE products SET name='Concurrent edit' WHERE id=60000").run()}
    if(target && '${fault}'==='rollback') prepared.splice(4,0,this.d1.prepare("SELECT json_extract('', '$')"));
    const result=await metered(() => this.d1.batch(prepared), metasOf, statements.length);
    if(target && ['undo','redo'].includes('${fault}') && !(globalThis as any).__mergeAckLost){(globalThis as any).__mergeAckLost=true;throw new Error('fixture_merge_ack_lost_after_commit')}
    return result` }]:[]
 const h=await startWorker({patches})
 try{
  await h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,is_active) VALUES(60000,'Review replay','6000001',5,20500,1),(60001,'Review replay','6000002',7,28700,1)").run()
  const read=()=>h.one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=60000')
  const before=await read(),applied=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:60000,mergeId:60001,keep:true},'new v3 merge')
  assert.equal(applied.status,200,JSON.stringify(applied.body))
  const history=await h.one("SELECT * FROM action_history WHERE entity='product' AND entity_id='60001' ORDER BY id DESC LIMIT 1")
  assert.ok(history)
  const merged=await read(),payload=JSON.parse(history.undo_payload)
  const beforeEvents=await h.all('SELECT * FROM audit_logs ORDER BY id'),beforeSnapshot=await h.one('SELECT * FROM undo_snapshots WHERE id=?',payload.snapshot_id)
  const undone=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:payload.generation??0},'v3 history undo')
  if(fault==='rollback'){
   assert.equal(undone.status,409,JSON.stringify(undone.body));assert.deepEqual(await read(),merged)
   assert.deepEqual(await h.one('SELECT * FROM undo_snapshots WHERE id=?',payload.snapshot_id),beforeSnapshot)
   assert.deepEqual(await h.one('SELECT * FROM action_history WHERE id=?',history.id),history)
   assert.deepEqual(await h.all('SELECT * FROM audit_logs ORDER BY id'),beforeEvents)
   console.log('PASS actual middle D1 batch refusal rolls back graph, compensation event, snapshot and authoritative history together')
   return
  }
  assert.equal(undone.status,200,JSON.stringify(undone.body))
  const afterUndo=await read()
  console.log('V3_HTTP '+JSON.stringify({before,merged,afterUndo,historyStatus:(await h.one('SELECT status FROM action_history WHERE id=?',history.id)).status}))
  assert.deepEqual(afterUndo,before,'new v3 history undo must restore prior review identity')
  console.log('PASS authenticated current-v3 history undo restores original keeper currencies and review identity')
  const eventsBefore=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='60000' ORDER BY id")
  const repeat=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:0},'repeat committed undo')
  assert.equal(repeat.status,200,JSON.stringify(repeat.body));assert.deepEqual(await read(),before)
  assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='60000' ORDER BY id"),eventsBefore)
  const redo=await h.call('POST','/api/action-history/'+history.id+'/redo',{require_applied:true,expected_generation:1},'v3 history redo')
  assert.equal(redo.status,200,JSON.stringify(redo.body))
  const redone=await read()
  assert.equal(redone.cost_price_usd,5);assert.equal(redone.cost_price_khr,20500)
  assert.match(redone.cost_review_key,/^[a-f0-9]{32}$/);assert.notEqual(redone.cost_review_key,merged.cost_review_key)
  if(fault==='finalize'||fault==='race'){
   if(fault==='race')console.log('FINALIZE_RACE '+JSON.stringify({product:await h.one('SELECT name FROM products WHERE id=60000'),revision:await h.one("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='60000'"),state:JSON.parse((await h.one('SELECT payload_json FROM undo_snapshots WHERE id=?',payload.snapshot_id)).payload_json).costReviewState}))
   assert.equal((await h.one('SELECT status FROM action_history WHERE id=?',history.id)).status,'recorded')
   const beforeRetry=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='60000' ORDER BY id")
   const resumed=await h.call('POST','/api/action-history/'+history.id+'/redo',{require_applied:true,expected_generation:1},'reconcile committed redo')
   assert.equal(resumed.status,200,JSON.stringify(resumed.body));assert.deepEqual(await read(),redone)
   assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='60000' ORDER BY id"),beforeRetry)
   assert.equal((await h.one('SELECT status FROM action_history WHERE id=?',history.id)).status,fault==='race'?'recorded':'undoable')
   if(fault==='race')assert.equal((await h.one('SELECT name FROM products WHERE id=60000')).name,'Concurrent edit')
   console.log('PASS committed redo '+(fault==='race'?'preserves intervening product edit and remains safely recorded':'resumes failed fingerprint finalization without repeating graph or review event'))
   return
  }
  assert.equal((await h.one('SELECT status FROM action_history WHERE id=?',history.id)).status,'undoable')
  const stale=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:0},'stale undo after redo')
  assert.equal(stale.status,409,JSON.stringify(stale.body));assert.deepEqual(await read(),redone)
  console.log('PASS authenticated redo preserves original fallback with a fresh review identity; committed undo retries do not duplicate events and ABA generation refuses')
  await h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(60002,'Review replay','6000003',9,1)").run()
  const prior=await read(),next=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:60000,mergeId:60002,keep:true},'merge with prior review identity')
  assert.equal(next.status,200,JSON.stringify(next.body))
  const second=await h.one("SELECT * FROM action_history WHERE entity='product' AND entity_id='60002' ORDER BY id DESC LIMIT 1")
  const secondPayload=JSON.parse(second.undo_payload),secondSnapshot=await h.one('SELECT payload_json FROM undo_snapshots WHERE id=?',secondPayload.snapshot_id)
  assert.equal(JSON.parse(secondSnapshot.payload_json).costReviewOutcome.beforeKey,prior.cost_review_key)
  const priorUndo=await h.call('POST','/api/action-history/'+second.id+'/undo',{require_applied:true,expected_generation:0},'restore prior review identity')
  assert.equal(priorUndo.status,200,JSON.stringify(priorUndo.body));assert.deepEqual(await read(),prior)
  console.log('PASS actual second merge captures and restores a pre-existing review identity')
  const deniedCookie=await h.addEmployee(69002,'review_hidden',{products:true,inventory:true,product_cost_view:false,product_cost_edit:false})
  const hidden=await h.call('GET','/api/products?search=Review%20replay&limit=25',undefined,'cost-hidden product reader',{cookie:deniedCookie})
  assert.equal(hidden.status,200,JSON.stringify(hidden.body));assert.ok(JSON.stringify(hidden.body).includes('Review replay'));assert.equal(JSON.stringify(hidden.body).includes(prior.cost_review_key),false)
  const hiddenPreview=await h.call('GET','/api/products/possible-duplicates/merge-preview?keepId=60000&mergeId=60002&keep=1',undefined,'cost-hidden snapshot preview',{cookie:deniedCookie})
  assert.equal(hiddenPreview.status,200,JSON.stringify(hiddenPreview.body));assert.equal(JSON.stringify(hiddenPreview.body).includes(prior.cost_review_key),false)
  console.log('PASS authenticated cost-hidden product and merge-preview readers do not expose protected review identity')
 }finally{budgetLine(h.metrics);await h.mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
