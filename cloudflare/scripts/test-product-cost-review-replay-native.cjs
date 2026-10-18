const assert=require('node:assert/strict')
const {startWorker,budgetLine}=require('./harness/al_money_native.cjs')

async function arrangeStock(h, statement) {
 const permitCount=async()=>(await h.db.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").first()).n
 assert.equal(await permitCount(),0)
 try {
  const results=await h.db.batch([
   h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
   statement,
   h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
  ])
  return results[1]
 } finally {assert.equal(await permitCount(),0)}
}

async function main(){
 const fault=process.argv.includes('--lost-ack-undo')?'undo':process.argv.includes('--lost-ack-redo')?'redo':process.argv.includes('--rollback')?'rollback':process.argv.includes('--finalize-once')?'finalize':process.argv.includes('--finalize-race')?'race':(process.argv.includes('--gallery-before-read')||process.argv.includes('--gallery-aba'))?'gallery':process.argv.includes('--stock-before-read')?'stock':process.argv.includes('--entry-before-read')?'entry':process.argv.includes('--entry-after-finalize')?'lateEntry':process.argv.includes('--receipt-real-before-read')?'real':process.argv.includes('--initial-stock-before-read')?'initial':null
 const patches=fault?[{name:'actual D1 batch '+fault,file:'src/lib/db.ts',
  from:'return metered(() => this.d1.batch(prepared), metasOf, statements.length)',
  to:`const compete=async(sql:string)=>{
      const permitCount=async()=>Number((await this.d1.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").first<{n:number}>())?.n);
      if(await permitCount()!==0)throw new Error('fixture_competitor_existing_permit');
      const {executeRawStockTransaction}=await import('./stockTransaction');
      const changed=await executeRawStockTransaction(this.d1,[this.d1.prepare(sql)]);
      if(changed.length!==1||Number(changed[0].meta?.changes)!==1)throw new Error('fixture_competitor_missing_effect');
      if(await permitCount()!==0)throw new Error('fixture_competitor_leaked_permit');
    };
    const target=statements.some(s=>s.sql.includes('merge_cost_replay_guard') && (s.params as any)?.fromStatus==='${['redo','gallery','stock','entry','real'].includes(fault)?'redoable':'undoable'}');
    const initial=statements.some(s=>s.sql.includes("INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)"));
    const finalizing=statements.some(s=>s.sql.includes('merge_cost_fingerprint_guard'));
    if(finalizing && '${fault}'==='finalize' && !(globalThis as any).__mergeFinalizeFault){(globalThis as any).__mergeFinalizeFault=true;throw new Error('fixture_finalize_unavailable')}
    if(finalizing && '${fault}'==='race' && !(globalThis as any).__mergeFinalizeFault){const changed=await this.d1.prepare("UPDATE products SET name='Concurrent edit' WHERE id=60000").run();if(Number(changed.meta?.changes)!==1)throw new Error('fixture_competitor_missing_effect');(globalThis as any).__mergeFinalizeFault=true}
    if(target && '${fault}'==='rollback') prepared.splice(4,0,this.d1.prepare("SELECT json_extract('', '$')"));
    const result=await metered(() => this.d1.batch(prepared), metasOf, statements.length);
    if(target && '${fault}'==='gallery' && !(globalThis as any).__mergeGalleryFault){(globalThis as any).__mergeGalleryFault=true;await this.d1.prepare("UPDATE product_images SET sort_order=77 WHERE product_id=60000 AND image_path='fixture-moved-gallery'").run();${process.argv.includes('--gallery-aba')?`await this.d1.prepare("UPDATE product_images SET sort_order=2 WHERE product_id=60000 AND image_path='fixture-moved-gallery'").run();`:''}}
    if(target && '${fault}'==='stock' && !(globalThis as any).__mergeStockFault){await compete("UPDATE branch_stock SET quantity=quantity+1,rfid_confirmed_qty=rfid_confirmed_qty+1 WHERE product_id=60000");(globalThis as any).__mergeStockFault=true}
    if(target && '${fault}'==='entry' && !(globalThis as any).__mergeEntryFault){await compete("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(60000,42,'manual',0)");(globalThis as any).__mergeEntryFault=true}
    if(target && '${fault}'==='real' && !(globalThis as any).__mergeRealFault){await compete("UPDATE branch_stock SET quantity=7.000000000000002 WHERE product_id=60000");(globalThis as any).__mergeRealFault=true}
    if(initial && '${fault}'==='initial' && !(globalThis as any).__mergeInitialFault){await compete("UPDATE branch_stock SET quantity=quantity+1,rfid_confirmed_qty=rfid_confirmed_qty+1 WHERE product_id=60000");(globalThis as any).__mergeInitialFault=true}
    if(target && ['undo','redo'].includes('${fault}') && !(globalThis as any).__mergeAckLost){(globalThis as any).__mergeAckLost=true;throw new Error('fixture_merge_ack_lost_after_commit')}
    return result` }]:[]
 const h=await startWorker({patches})
 try{
  await arrangeStock(h,h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,is_active) VALUES(60000,'Review replay','6000001',5,20500,1),(60001,'Review replay','6000002',7,28700,1)"))
  if(process.argv.includes('--precision'))await arrangeStock(h,h.db.prepare('UPDATE products SET cost_price_usd=?,cost_price_khr=? WHERE id=60000').bind(5.123456789012345,20500.12345678901))
  if(process.argv.includes('--null'))await arrangeStock(h,h.db.prepare('UPDATE products SET cost_price_usd=NULL,cost_price_khr=NULL WHERE id=60000'))
  if(process.argv.includes('--zero'))await arrangeStock(h,h.db.prepare('UPDATE products SET cost_price_usd=0,cost_price_khr=0 WHERE id=60000'))
  if(fault==='gallery'||process.argv.includes('--gallery-control')||process.argv.includes('--gallery-fraction'))await h.db.prepare("INSERT INTO product_images(product_id,image_path,sort_order) VALUES(60001,'fixture-moved-gallery',2)").run()
  if(process.argv.includes('--gallery-fraction'))await h.db.prepare("UPDATE product_images SET sort_order=7.000000000000002 WHERE image_path='fixture-moved-gallery'").run()
  if(fault==='stock'||fault==='real'||fault==='initial'||process.argv.includes('--initial-stock-control'))await arrangeStock(h,h.db.prepare("INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(60000,1,5,0),(60001,1,2,0)"))
  const read=()=>h.one('SELECT cost_price_usd,cost_price_khr,cost_review_key FROM products WHERE id=60000')
  if(process.argv.includes('--receipt-byte-overflow')){
   const multibyte='ក'.repeat(44000)
   assert.ok(multibyte.length<131072);assert.ok(Buffer.byteLength(multibyte)>131072)
   await h.db.prepare('UPDATE products SET description=? WHERE id=60000').bind(multibyte).run()
   const tables=['products','branch_stock','branch_batch_stock','inventory_movements','product_cost_entries','audit_logs','undo_snapshots','action_history']
   const snapshot=async()=>Promise.all(tables.map(table=>h.all('SELECT * FROM '+table+' ORDER BY rowid')))
   const before=await snapshot()
   const refused=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:60000,mergeId:60001,keep:true,stock:'merge'},'refuse multibyte committed receipt overflow')
   assert.equal(refused.status,409,JSON.stringify(refused.body));assert.deepEqual(await snapshot(),before)
   console.log('PASS actual multibyte receipt overflow rolls back products, stock, ledger, review event, snapshot and history together; data chars='+multibyte.length+' UTF8bytes='+Buffer.byteLength(multibyte))
   return
  }
  const before=await read(),applied=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:60000,mergeId:60001,keep:true,stock:'merge'},'new v3 merge')
  assert.equal(applied.status,200,JSON.stringify(applied.body))
  const history=await h.one("SELECT * FROM action_history WHERE entity='product' AND entity_id='60001' ORDER BY id DESC LIMIT 1")
  assert.ok(history)
  const merged=await read(),payload=JSON.parse(history.undo_payload)
  if(process.argv.includes('--precision')){
   assert.equal(before.cost_price_usd,5.123456789012345);assert.equal(before.cost_price_khr,20500.12345678901)
   const costEvent=JSON.parse((await h.one("SELECT details FROM audit_logs WHERE action='cost_override' AND entity_id='60000' ORDER BY id DESC LIMIT 1")).details).cost_review
   assert.equal(costEvent.fallback_usd,before.cost_price_usd);assert.equal(costEvent.fallback_khr,before.cost_price_khr)
   assert.equal(costEvent.after_usd,merged.cost_price_usd);assert.equal(costEvent.after_khr,merged.cost_price_khr)
  }
  const beforeEvents=await h.all('SELECT * FROM audit_logs ORDER BY id'),beforeSnapshot=await h.one('SELECT * FROM undo_snapshots WHERE id=?',payload.snapshot_id)
  if(fault==='initial'){
   const stock=await h.all('SELECT * FROM branch_stock WHERE product_id IN (60000,60001) ORDER BY product_id,branch_id')
   const events=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
   assert.equal(stock.length,1);assert.equal(stock[0].quantity,8);assert.equal(stock[0].rfid_confirmed_qty,1)
   assert.equal(history.status,'recorded');assert.equal(history.reversible,0)
   const refused=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:0},'refuse initial merge undo after concurrent stock edit')
   assert.equal(refused.status,409,JSON.stringify(refused.body))
   assert.deepEqual(await h.all('SELECT * FROM branch_stock WHERE product_id IN (60000,60001) ORDER BY product_id,branch_id'),stock)
   assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),events)
   assert.equal((await h.one('SELECT payload_json FROM undo_snapshots WHERE id=?',payload.snapshot_id)).payload_json,beforeSnapshot.payload_json)
   console.log('PASS actual initial committed merge remains truthful and non-reversible when first-read stock state differs; quantity8/RFID1 preserved')
   return
  }
  const rollbackTables=['products','branch_stock','product_batches','branch_batch_stock','product_images','inventory_movements','product_cost_entries','audit_logs','undo_snapshots','action_history']
  const rollbackBefore=fault==='rollback'?await Promise.all(rollbackTables.map(table=>h.all('SELECT * FROM '+table+' ORDER BY rowid'))):null
  const undone=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:payload.generation??0},'v3 history undo')
  if(fault==='rollback'){
   assert.deepEqual(await Promise.all(rollbackTables.map(table=>h.all('SELECT * FROM '+table+' ORDER BY rowid'))),rollbackBefore)
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
  assert.equal(redone.cost_price_usd,before.cost_price_usd);assert.equal(redone.cost_price_khr,before.cost_price_khr)
  assert.match(redone.cost_review_key,/^[a-f0-9]{32}$/);assert.notEqual(redone.cost_review_key,merged.cost_review_key)
  const replayState=JSON.parse((await h.one('SELECT payload_json FROM undo_snapshots WHERE id=?',payload.snapshot_id)).payload_json).costReviewState
  assert.equal(replayState.graph_version,2);assert.equal(typeof replayState.graph_state,'string')
  const receiptRows=JSON.parse(replayState.graph_state)
  console.log('GRAPH_RECEIPT '+JSON.stringify({bytes:Buffer.byteLength(replayState.graph_state),scopes:Object.fromEntries(Object.entries(receiptRows).map(([key,value])=>[key,value[1].length]))}))
  if(fault==='entry'||fault==='lateEntry'){
   if(fault==='lateEntry')await arrangeStock(h,h.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,source,baseline_batch_id) VALUES(60000,42,'manual',0)"))
   const entries=await h.all('SELECT * FROM product_cost_entries ORDER BY id'),events=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
   assert.equal(entries.filter(row=>row.product_id===60000&&row.cost_usd===42&&row.source==='manual').length,1)
   assert.equal((await h.one("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'")).n,0)
   const laterUndo=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:2},fault==='lateEntry'?'undo after new manual entry after finalized redo':'undo after new manual entry before first fingerprint read')
   assert.equal(laterUndo.status,409,JSON.stringify(laterUndo.body));assert.deepEqual(await h.all('SELECT * FROM product_cost_entries ORDER BY id'),entries)
   assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),events)
   if(fault==='lateEntry'){
    const repeatRedo=await h.call('POST','/api/action-history/'+history.id+'/redo',{require_applied:true,expected_generation:1},'committed redo retry after later manual entry')
    assert.equal(repeatRedo.status,200,JSON.stringify(repeatRedo.body));assert.deepEqual(await h.all('SELECT * FROM product_cost_entries ORDER BY id'),entries)
    assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),events)
   }
   console.log('PASS new current-keeper manual entry '+(fault==='lateEntry'?'after finalized redo':'before first fingerprint read')+' is protected beyond saved FK row IDs; exact committed retry does not replay')
   return
  }
  if(fault==='stock'||fault==='real'){
   const graphBefore=await h.all('SELECT * FROM branch_stock WHERE product_id IN (60000,60001) ORDER BY product_id,branch_id'),eventsBefore=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
   assert.equal(graphBefore.find(row=>row.product_id===60000).quantity,fault==='real'?7.000000000000002:8)
   assert.equal((await h.one("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'")).n,0)
   const laterUndo=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:2},'undo after unchanged-cost stock edit before first fingerprint read')
   console.log('STOCK_BEFORE_READ '+JSON.stringify({before:graphBefore,after:await h.all('SELECT * FROM branch_stock WHERE product_id IN (60000,60001) ORDER BY product_id,branch_id'),status:laterUndo.status}))
   assert.equal(laterUndo.status,409,JSON.stringify(laterUndo.body));assert.deepEqual(await h.all('SELECT * FROM branch_stock WHERE product_id IN (60000,60001) ORDER BY product_id,branch_id'),graphBefore)
   assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),eventsBefore)
   console.log('PASS non-product stock quantity/RFID edit between redo commit and first fingerprint read is preserved')
   return
  }
  if(process.argv.includes('--gallery-control')||process.argv.includes('--gallery-fraction')){
   const latestUndo=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:2},'no-edit gallery undo after finalized redo')
   assert.equal(latestUndo.status,200,JSON.stringify(latestUndo.body))
   const restored=await h.one("SELECT product_id,sort_order FROM product_images WHERE image_path='fixture-moved-gallery'")
   assert.equal(restored.product_id,60001);assert.equal(restored.sort_order,process.argv.includes('--gallery-fraction')?7.000000000000002:2)
   console.log('PASS actual no-edit gallery redo and next undo restore the original image identity and order')
   return
  }
  if(fault==='gallery'){
   const graphBefore=await h.all('SELECT * FROM product_images ORDER BY id'),eventsBefore=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id")
   const laterUndo=await h.call('POST','/api/action-history/'+history.id+'/undo',{require_applied:true,expected_generation:2},'undo after gallery edit before fingerprint read')
   console.log('GALLERY_BEFORE_READ '+JSON.stringify({before:graphBefore,after:await h.all('SELECT * FROM product_images ORDER BY id'),status:laterUndo.status}))
   assert.equal(laterUndo.status,409,JSON.stringify(laterUndo.body));assert.deepEqual(await h.all('SELECT * FROM product_images ORDER BY id'),graphBefore)
   assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' ORDER BY id"),eventsBefore)
   console.log('PASS gallery-only edit after redo commit before first fingerprint read cannot be adopted and undone')
   return
  }
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
  await arrangeStock(h,h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(60002,'Review replay','6000003',9,1)"))
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
  if(process.argv.includes('--actor')){
   await arrangeStock(h,h.db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,is_active) VALUES(61000,'Hidden actor merge','6100001',5,1),(61001,'Hidden actor merge','6100002',7,1)"))
   const own=await h.call('POST','/api/products/possible-duplicates/merge',{keepId:61000,mergeId:61001,keep:true},'cost-hidden actor merge',{cookie:deniedCookie})
   assert.equal(own.status,200,JSON.stringify(own.body))
   const ownHistory=await h.one("SELECT id FROM action_history WHERE entity_id='61001' ORDER BY id DESC LIMIT 1")
   const visible=await h.call('GET','/api/action-history?scope=products&limit=100',undefined,'cost-hidden creator history',{cookie:deniedCookie})
   assert.equal(visible.status,200,JSON.stringify(visible.body))
   const item=visible.body.items.find(row=>row.id===ownHistory.id);assert.ok(item)
   const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),source=fs.readFileSync(path.join(__dirname,'../../frontend/src/utils/actionHistory.ts'),'utf8')
   const code=source.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0];assert.ok(code)
   const mod={exports:{}};new Function('exports','module',ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports,mod)
   const wire=mod.exports.buildServerReplayRequest(item.undo_payload)
   const ownUndo=await h.call('POST','/api/action-history/'+ownHistory.id+'/undo',wire,'cost-hidden frontend wire undo',{cookie:deniedCookie})
   console.log('HIDDEN_HISTORY '+JSON.stringify({payload:item.undo_payload,wire,status:ownUndo.status,body:ownUndo.body}))
   assert.equal(ownUndo.status,200,JSON.stringify(ownUndo.body));assert.equal(wire.expected_generation,0)
   assert.equal((await h.one('SELECT cost_review_key FROM products WHERE id=61000')).cost_review_key,null)
   const refreshed=await h.call('GET','/api/action-history?scope=products&limit=100',undefined,'cost-hidden redo history',{cookie:deniedCookie})
   const redoItem=refreshed.body.items.find(row=>row.id===ownHistory.id)
   const redoWire=mod.exports.buildServerReplayRequest(redoItem.redo_payload)
   const ownRedo=await h.call('POST','/api/action-history/'+ownHistory.id+'/redo',redoWire,'cost-hidden frontend wire redo',{cookie:deniedCookie})
   assert.equal(ownRedo.status,200,JSON.stringify(ownRedo.body));assert.equal(redoWire.expected_generation,1)
   const role=await h.one('SELECT name,updated_at FROM roles WHERE id=69002')
   const revoked=await h.call('PUT','/api/roles/69002',{name:role.name,expected_updated_at:role.updated_at,permissions:{products:false,inventory:true,product_cost_view:false,product_cost_edit:false}},'revoke creator merge authority')
   assert.equal(revoked.status,200,JSON.stringify(revoked.body))
   const eventsBeforeRevoked=await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='61000' ORDER BY id")
   const refused=await h.call('POST','/api/action-history/'+ownHistory.id+'/undo',{require_applied:true,expected_generation:2},'revoked creator undo',{cookie:deniedCookie})
   assert.equal(refused.status,404,JSON.stringify(refused.body));assert.deepEqual(await h.all("SELECT * FROM audit_logs WHERE action='cost_override' AND entity_id='61000' ORDER BY id"),eventsBeforeRevoked)
   console.log('PASS actual cost-hidden creator history through real frontend request builder undo/redo needs no cost grants; actual role revocation refuses replay without compensation')
  }
 }finally{budgetLine(h.metrics);await h.mf.dispose()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
