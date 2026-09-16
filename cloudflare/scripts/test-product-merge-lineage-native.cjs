const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const file=path.join(__dirname,'test-sale-create-atomic-pure.cjs'),source=fs.readFileSync(file,'utf8'),boundary=source.indexOf(';(async () => {')
const harness=new Module(file,module);harness.filename=file;harness.paths=module.paths
harness._compile(source.slice(0,boundary).replace('const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")+'\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};',file)
const h=harness.exports
;(async()=>{
 h.setUser({...h.USER,permissions:'{"all":true}'})
 const f=h.fixture(),pricing=h.load('lib/saleItemPricing.ts'),lineage=h.load('lib/productMergeLineage.ts')
 const mutationBatch=f.route.batch.bind(f.route)
 f.route.batch=async statements=>{
   if(!statements.every(statement=>/^\s*SELECT\b/i.test(statement.sql)))return mutationBatch(statements)
   f.raw.db.exec('BEGIN')
   try{const result=statements.map(statement=>({success:true,results:f.raw.prepare(statement.sql).all(statement.params||{})}));f.raw.db.exec('COMMIT');return result}
   catch(error){f.raw.db.exec('ROLLBACK');throw error}
 }
 const created=await h.postSale(f.route,{...h.request('lineage-create'),money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,
   client_line_key:'lineage-line',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}]})
 assert.equal(created.status,200,JSON.stringify(created.body))
 const saleId=created.body.id,read=()=>({sale:f.raw.prepare('SELECT * FROM sales WHERE id=?').get([saleId]),lines:f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all([saleId])})
 const original=read(),saved=original.lines[0].pricing_snapshot_json
 f.raw.prepare("INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(20,'Powder','POWDER',0,9.5,38000,4,16000,1)").run()
 f.raw.prepare("UPDATE products SET barcode='123456' WHERE id IN(10,20)").run()
 const products=h.load('routes/products.ts')
 await products.foldDuplicateProductInto({DB:f.route},f.route,{...h.USER,permissions:'{"all":true}'},{id:20,name:'Powder'},{id:10,name:'Powder'},new Map([[1,'Shop']]),'lineage-native','merge',undefined,{operationId:crypto.randomUUID()})
 const merged=read();assert.equal(merged.lines[0].product_id,20);assert.equal(merged.lines[0].pricing_snapshot_json,saved)
 assert.throws(()=>pricing.validateCapturedSaleBasket(merged.lines,merged.sale))
 const context=await lineage.resolveProductMergeLineage(f.route,saleId,merged.lines)
 assert.equal(context.bindings.length,1);pricing.validateCapturedSaleBasket(merged.lines,merged.sale,context.bindings)
 const amendment={kind:'line_quantity_increased',quantity:1,sale_item_id:merged.lines[0].id,money_precision_version:1,
   expected_exchange_rate:4000,client_request_id:'merged-quantity',pricing_quote:{gross_usd:19,product_discount_usd:0,manual_discount_usd:0,total_usd:19,total_khr:76000}}
 const post=async body=>{const response=await h.app.request(`/${saleId}/amendments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx);return {status:response.status,body:await response.json()}}
 const quote=await post(amendment);assert.equal(quote.status,409,JSON.stringify(quote));assert.equal(quote.body.code,'sale_header_quote_conflict')
 const amended=await post({...amendment,expected_header_quote:quote.body.header_quote});assert.equal(amended.status,200,JSON.stringify(amended))
 assert.deepEqual(amended.body.sale.pricing_identity_bindings,context.bindings,'committed response carries validated public identity context')
 const afterAmend=read();assert.equal(afterAmend.lines[0].product_id,20);assert.equal(afterAmend.lines[0].total_usd,19)
 assert.deepEqual(JSON.parse(afterAmend.lines[0].pricing_snapshot_json).pool,JSON.parse(saved).pool,'original capture/rules unchanged')
 const assertion=`SELECT CASE WHEN ${context.condition} THEN 1 ELSE json_extract('', '$') END`
 f.raw.prepare(assertion).get(context.params)
 const snapshot=f.raw.prepare("SELECT * FROM undo_snapshots WHERE kind='product.merge' AND status='applied' ORDER BY id DESC LIMIT 1").get()
 const next={...amendment,client_request_id:'lineage-race',pricing_quote:{gross_usd:28.5,product_discount_usd:0,manual_discount_usd:0,total_usd:28.5,total_khr:114000}}
 const nextQuote=await post(next);assert.equal(nextQuote.body.code,'sale_header_quote_conflict')
 const batch=f.route.batch.bind(f.route);let raced=false
 f.route.batch=async statements=>{
   if(!raced&&statements.some(statement=>/UPDATE sales SET/.test(statement.sql))){raced=true;f.raw.prepare("UPDATE undo_snapshots SET status='reversed' WHERE id=?").run([snapshot.id])}
   return batch(statements)
 }
 const financialBefore=JSON.stringify(read())
 const rejected=await post({...next,expected_header_quote:nextQuote.body.header_quote});assert.equal(rejected.status,409,JSON.stringify(rejected));assert.equal(raced,true)
 assert.equal(JSON.stringify(read()),financialBefore,'lineage race rolls back all financial writes')
 f.route.batch=batch;f.raw.prepare("UPDATE undo_snapshots SET status='applied' WHERE id=?").run([snapshot.id])
 f.raw.prepare("UPDATE undo_snapshots SET status='reversed' WHERE id=?").run([snapshot.id])
 assert.throws(()=>f.raw.prepare(assertion).get(context.params))
 await assert.rejects(()=>lineage.resolveProductMergeLineage(f.route,saleId,merged.lines))
 f.raw.prepare("UPDATE undo_snapshots SET status='applied' WHERE id=?").run([snapshot.id])
 f.raw.prepare("INSERT INTO undo_snapshots(kind,status,payload_json) VALUES('product.merge','applied',?)").run([snapshot.payload_json])
 const duplicateId=f.raw.prepare('SELECT MAX(id) AS id FROM undo_snapshots').get().id
 await assert.rejects(()=>lineage.resolveProductMergeLineage(f.route,saleId,merged.lines),'duplicate evidence is ambiguous')
 assert.throws(()=>f.raw.prepare(assertion).get(context.params),'new duplicate proof invalidates atomic evidence set')
 f.raw.prepare('DELETE FROM undo_snapshots WHERE id=?').run([duplicateId])
 await assert.rejects(()=>lineage.resolveProductMergeLineage(f.route,saleId,[{...merged.lines[0],id:999999}]),'product alias without exact row evidence refuses')
 f.raw.prepare("INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(30,'Powder','POWDER','123456',0,9.5,38000,4,16000,1)").run()
 await products.foldDuplicateProductInto({DB:f.route},f.route,{...h.USER,permissions:'{"all":true}'},{id:30,name:'Powder'},{id:20,name:'Powder'},new Map([[1,'Shop']]),'lineage-second','merge',undefined,{operationId:crypto.randomUUID()})
 const chained=read(),chain=await lineage.resolveProductMergeLineage(f.route,saleId,chained.lines)
 assert.equal(chain.bindings[0].captured_product_id,10);assert.equal(chain.bindings[0].current_product_id,30)
 pricing.validateCapturedSaleBasket(chained.lines,chained.sale,chain.bindings)
 f.raw.prepare("INSERT INTO undo_snapshots(kind,status,payload_json) VALUES('product.merge','applied',?)").run([JSON.stringify({dupId:30,keeperId:10,reparentedSaleItemIds:[chained.lines[0].id]})])
 const cycleId=f.raw.prepare('SELECT MAX(id) AS id FROM undo_snapshots').get().id
 await assert.rejects(()=>lineage.resolveProductMergeLineage(f.route,saleId,chained.lines),'cycle/outgoing endpoint evidence refuses')
 f.raw.prepare('UPDATE sales SET is_delivery=1 WHERE id=?').run([saleId])
 const cost=await post({kind:'delivery_actual_cost_changed',money_precision_version:1,expected_exchange_rate:4000,client_request_id:'invalid-lineage-cost',delivery_actual_cost_usd:2})
 assert.equal(cost.status,200,JSON.stringify(cost));assert.equal(cost.body.canonical_receipt_available,false)
 assert.equal(Object.hasOwn(cost.body,'sale'),false,'cost-only success must not mint unvalidated identity binding')
 f.raw.prepare('DELETE FROM undo_snapshots WHERE id=?').run([cycleId])
 const addBody={money_precision_version:1,client_request_id:'lineage-add',expected_exchange_rate:4000,items:[{product_id:30,quantity:1,branch_id:1,batch_id:500,
   client_line_key:'new-current-line',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}]}
 const add=async body=>{const response=await h.app.request(`/${saleId}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},h.executionCtx);return {status:response.status,body:await response.json()}}
 const addQuote=await add(addBody);assert.equal(addQuote.body.code,'sale_header_quote_conflict')
 const added=await add({...addBody,expected_header_quote:addQuote.body.header_quote});assert.equal(added.status,200,JSON.stringify(added))
 const replay=async direction=>{
   const history=f.raw.prepare('SELECT * FROM action_history WHERE id=?').get([added.body.actionHistoryId])
   const payload=JSON.parse(history[direction==='undo'?'undo_payload':'redo_payload'])
   return h.load('lib/undoAppliers.ts').resolveUndoApplier(payload).run(payload,{env:{DB:f.route},user:{...h.USER,permissions:'{"all":true}'},direction,historyId:history.id,generation:payload.generation})
 }
 const beforeUndo=JSON.stringify(read())
 f.raw.prepare("UPDATE undo_snapshots SET status='reversed' WHERE id=?").run([snapshot.id])
 await assert.rejects(()=>replay('undo'),/merge evidence/);assert.equal(JSON.stringify(read()),beforeUndo)
 f.raw.prepare("UPDATE undo_snapshots SET status='applied' WHERE id=?").run([snapshot.id])
 const replayBatch=f.route.batch.bind(f.route);let undoRaced=false
 f.route.batch=async statements=>{
   if(!undoRaced&&statements.some(statement=>/UPDATE action_history SET/.test(statement.sql))){undoRaced=true;f.raw.prepare("UPDATE undo_snapshots SET status='reversed' WHERE id=?").run([snapshot.id])}
   return replayBatch(statements)
 }
 await assert.rejects(()=>replay('undo'));assert.equal(undoRaced,true);assert.equal(JSON.stringify(read()),beforeUndo)
 f.route.batch=replayBatch;f.raw.prepare("UPDATE undo_snapshots SET status='applied' WHERE id=?").run([snapshot.id])
 await replay('undo')
 const beforeRedo=JSON.stringify(read())
 f.raw.prepare("UPDATE undo_snapshots SET status='reversed' WHERE id=?").run([snapshot.id])
 await assert.rejects(()=>replay('redo'),/merge evidence/);assert.equal(JSON.stringify(read()),beforeRedo)
 f.raw.prepare("UPDATE undo_snapshots SET status='applied' WHERE id=?").run([snapshot.id])
 await replay('redo')
 f.raw.db.close()
 console.log('PASS actual two folds, merged quantity amendment, unchanged capture, response binding, concurrent rollback and missing/duplicate/cyclic row-proof refusal')
})().catch(error=>{console.error(error);process.exitCode=1})
