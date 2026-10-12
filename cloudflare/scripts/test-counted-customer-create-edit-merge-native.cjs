// Customer return CREATE and EDIT after a product merge, through the real bundled Worker on
// ephemeral SQLite worlds, Free and Paid. Refund, currency and cost stay with the ORIGINAL
// sale item; new physical stock lands on the keeper the product-merge records prove; archived
// sale, return, allocation and movement rows are never rewritten.
// RED on bbd692ee: CREATE 409, ordinary reason-only EDIT 409, tagged reason-only EDIT 400.
const assert=require('node:assert/strict')
const {createHash}=require('node:crypto')
const h=require('./test-counted-quantity-exact-native.cjs')
const {merge}=require('./test-counted-customer-merge-bulk-native.cjs')
const {load}=require('./test-product-merge-origin-plan-native.cjs')
const {executeStockTransaction}=load('lib/stockTransaction.ts'),{getDb}=load('lib/db.ts')
const {productMergeProtocolSchemaSql}=load('lib/productMergeProtocol.ts')
const {returnMergePhysicalProofSchemaSql}=load('lib/returnBulkAction.ts')
const {readProductMergeCaseSnapshot}=load('lib/productMergeSnapshot.ts')
const {planProductMergeForwardStock}=load('lib/productMergeForwardStock.ts')
const {planProductMergeReplay}=load('lib/productMergeReplay.ts')
const {sqliteD1Call}=require('./harness/sqlite_d1_bindings.cjs')
const pricing=load('lib/saleItemPricing.ts')

const counts=[]
async function call(f,tier,label,url,body,method='POST'){
 const log=console.log;let line=null
 console.log=(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('{"tier"'))line=args[0];log(...args)}
 try{
  const result=await f.call(url,body,method)
  const queries=JSON.parse(line).queries
  counts.push({tier,label,status:result.status,queries})
  return {...result,queries}
 }finally{console.log=log}
}

// Product 1 "Serum" sold .3 on sale 50 from receipt 1; products 2 and 3 are later keepers, 4 is unrelated.
async function world(make,tier,{physical=.1,prior=null,taggedSale=false}={}){
 const f=await h.world(make,tier,'zero',sql=>{
  h.seed(physical,true)(sql)
  sql.exec(`INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd)VALUES(2,'Keeper',1,0,2),(3,'Later keeper',1,0,2),(4,'Unrelated',1,0,2);
   INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0),(3,1,0),(4,1,0);
   ${taggedSale?"INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(2,1,'Serum',1,1,.4,.1,'damaged','remove',2);":''}
   INSERT INTO sales(id,receipt_number,branch_id,branch_name,sale_status,exchange_rate,total_usd,total_khr,amount_paid_usd)
    VALUES(50,'MERGE-RETURN-SALE',1,'Shop','${prior?'partial_return':'completed'}',4000,3,12000,3);
   INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,batch_id,damaged_lot_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd)
    VALUES(50,50,1,'Serum',1,1,${taggedSale?2:'NULL'},.3,10,40000,3,12000,2);
   INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(50,1,1,.3,0);`)
  if(prior)sql.exec(`INSERT INTO returns(id,return_number,sale_id,return_scope,branch_id,branch_name,status,reason,return_type,total_refund_usd,total_refund_khr,exchange_rate,created_at,updated_at)
    VALUES(55,'MERGE-RETURN-55',50,'customer',1,'Shop','completed','Original return','Refund',1,4000,4000,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z');
   INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,cost_price_usd,return_to_stock,stock_action,branch_id,batch_id)
    VALUES(55,55,50,1,'Serum',.1,10,40000,1,4000,2,${prior==='tagged'?0:1},'${prior==='tagged'?'damaged':'restock'}',1,1);
   INSERT INTO return_item_batch_allocations(return_item_id,sale_item_id,batch_id,branch_id,quantity)VALUES(55,50,1,1,.1);
   INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,reason,reference_id,user_id,user_name,batch_id)
    VALUES(1,'Serum',1,'${prior==='tagged'?'damage_in':'return'}',.1,2,'Return: Original return',55,7,'Admin',1);
   ${prior==='tagged'?"INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,'Serum',1,1,55,.1,.1,'damaged','return',2);":''}`)
 })
 const db=getDb(f.env),setup=[]
 if(prior)setup.push({sql:'UPDATE return_items SET stock_condition=@condition WHERE id=55',params:{condition:prior==='tagged'?'damaged':'ordinary'}})
 if(prior==='tagged')setup.push({sql:'UPDATE damaged_stock_lots SET return_item_id=55 WHERE id=1'})
 // Pre-fence tags convert into physical stock; pin the intended counted totals (tags inside T, counted once).
 setup.push({sql:'UPDATE products SET stock_quantity=@q WHERE id=1',params:{q:physical}},{sql:'UPDATE branch_stock SET quantity=@q WHERE product_id=1 AND branch_id=1',params:{q:physical}},
  {sql:'UPDATE branch_batch_stock SET quantity=@q WHERE batch_id=1 AND branch_id=1',params:{q:physical}})
 await executeStockTransaction(db,setup,'once')
 f.sql.exec(productMergeProtocolSchemaSql());f.sql.exec(returnMergePhysicalProofSchemaSql())
 return f
}
async function replayMerge(f,keeper,loser,number,transitionId,direction){
 const history=f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(number),pointer=JSON.parse(history.undo_payload)
 const evidence={plan:{...f.sql.prepare('SELECT * FROM undo_snapshots WHERE id=?').get(number)},history:{...history},
  seal:{...f.sql.prepare('SELECT * FROM undo_snapshots WHERE id=?').get(pointer.seal_id)}}
 const current=await readProductMergeCaseSnapshot(getDb(f.env),keeper,loser,[])
 await executeStockTransaction(getDb(f.env),planProductMergeReplay(current,evidence,{transitionId,direction,actorId:7,actorName:'Operator',pointer}).statements,'once')
}
// A rival transaction from another request: raw SQLite with the per-request D1 meter suspended, so its statements
// are not charged to the request under test (in production a concurrent merge is its own request).
async function rival(f,statements){
 const prepare=(text,params=[])=>({text,params,bind:(...values)=>prepare(text,values),
  first:async()=>sqliteD1Call(f.sql.prepare(text),'get',params)??null,
  all:async()=>({results:sqliteD1Call(f.sql.prepare(text),'all',params)}),
  run:async()=>({meta:sqliteD1Call(f.sql.prepare(text),'run',params)})})
 const raw={prepare,batch:async rows=>f.sql.transaction(()=>rows.map(row=>{
  const prepared=f.sql.prepare(row.text),result=sqliteD1Call(prepared,prepared.reader?'all':'run',row.params)
  return prepared.reader?{results:result,meta:{changes:0}}:{meta:{changes:result.changes,last_row_id:Number(result.lastInsertRowid)}}
 }))()}
 const meter=Symbol.for('business-os.request-metrics.v1'),hook=globalThis[meter]
 globalThis[meter]=undefined
 try{await executeStockTransaction(getDb({DB:raw}),statements,'once')}finally{globalThis[meter]=hook}
}
async function mergeStatements(f,keeper,loser,number){
 const snapshot=await readProductMergeCaseSnapshot(getDb(f.env),keeper,loser,[])
 return planProductMergeForwardStock(snapshot,{planId:number,transitionId:number+1,historyId:number,actorId:7,actorName:'Operator',
  requestId:'rival-merge-'+number,requestDigest:'rival-merge-'+number,origins:{operationId:'rival-merge-'+number,
   receiptIds:snapshot.duplicateBatchRows.map((row,index)=>({sourceReceiptId:row.id,targetReceiptId:number+100+index})),
   tagIds:snapshot.damagedStockRows.filter(row=>row.product_id===loser).map((row,index)=>({sourceTagId:row.id,targetTagId:number+200+index}))}}).statements
}

const rows=(f,sql,...params)=>f.sql.prepare(sql).all(...params)
const one=(f,sql,...params)=>f.sql.prepare(sql).get(...params)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Every business table; the first request's core-invariant build marker is housekeeping, not a business write.
const everything=f=>Object.fromEntries(rows(f,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
 .map(({name})=>[name,rows(f,'SELECT * FROM "'+name+'"'+(name==='system_flags'?" WHERE key<>'core_invariants_build'":''))]))
// Original (archived) records: the sale and its lines/allocations/conditions, every pre-existing return row except an
// edited one's own lines, every movement already written, and the merged-away product's receipts and tags.
function archive(f,editedReturn=null){
 const movementCeiling=one(f,'SELECT COALESCE(MAX(id),0) n FROM inventory_movements').n
 const kept=JSON.stringify(rows(f,'SELECT id FROM returns WHERE id IS NOT ? ORDER BY id',editedReturn).map(row=>row.id))
 return ()=>({
  sales:hash(rows(f,'SELECT * FROM sales WHERE id=50').map(({sale_status,status_before_return,updated_at,...money})=>money)),
  sale_items:hash(rows(f,'SELECT * FROM sale_items WHERE sale_id=50 ORDER BY id')),
  sale_allocations:hash(rows(f,'SELECT * FROM sale_item_batch_allocations ORDER BY id')),
  conditions:hash(rows(f,'SELECT * FROM counted_sale_item_conditions ORDER BY sale_item_id')),
  returns:hash(rows(f,'SELECT * FROM returns WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',kept)),
  return_items:hash(rows(f,'SELECT * FROM return_items WHERE return_id IN (SELECT value FROM json_each(?)) ORDER BY id',kept)),
  return_allocations:hash(rows(f,'SELECT a.* FROM return_item_batch_allocations a JOIN return_items i ON i.id=a.return_item_id WHERE i.return_id IN (SELECT value FROM json_each(?)) ORDER BY a.id',kept)),
  movements:hash(rows(f,'SELECT * FROM inventory_movements WHERE id<=? ORDER BY id',movementCeiling)),
  loser_receipts:hash(rows(f,'SELECT * FROM product_batches WHERE variant_product_id=1 ORDER BY id')),
  loser_tags:hash(rows(f,'SELECT * FROM damaged_stock_lots WHERE product_id=1 ORDER BY id')),
 })
}
const assertArchived=(now,saved)=>{for(const key of Object.keys(saved))assert.equal(now[key],saved[key],'archived '+key+' unchanged')}
const stockOf=(f,product)=>({total:one(f,'SELECT stock_quantity q FROM products WHERE id=?',product).q,
 branch:one(f,'SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=1',product)?.q??0,
 receipts:Number(one(f,'SELECT COALESCE(SUM(s.quantity),0) q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=?',product).q.toFixed(9)),
 tagged:Number(one(f,'SELECT COALESCE(SUM(quantity_remaining),0) q FROM damaged_stock_lots WHERE product_id=?',product).q.toFixed(9))})
const createBody=(key,extra={},item={})=>({sale_id:50,branch_id:1,reason:'Merged product return',client_request_id:key,...extra,
 items:[{sale_item_id:50,product_id:1,quantity:.2,stock_condition:'ordinary',applied_price_usd:10,applied_price_khr:40000,...item}]})
const editBody=(f,key,line={},extra={},returnId=55)=>{
 const current=one(f,'SELECT updated_at FROM returns WHERE id=?',returnId).updated_at
 const saved=one(f,'SELECT * FROM return_items WHERE return_id=? ORDER BY id LIMIT 1',returnId)
 const tagged=saved.stock_action==='damaged'
 // Exactly what EditReturnModal posts: the saved line's own product, no receipt, condition only when tagged.
 return {client_request_id:key,expected_updated_at:current,reason:'Changed reason',return_type:'Refund',notes:null,...extra,
  items:[{sale_item_id:50,product_id:saved.product_id,product_name:saved.product_name,quantity:saved.quantity,applied_price_usd:10,applied_price_khr:40000,
   return_to_stock:!tagged,stock_action:tagged?'damaged':'restock',branch_id:1,...(tagged?{condition_tag:'damaged',damaged_disposition:'keep'}:{}),...line}]}
}
function assertNewLine(f,returnId,{product,batch,quantity=.2,action='restock',condition='ordinary'}){
 const line=one(f,'SELECT * FROM return_items WHERE return_id=?',returnId)
 assert.deepEqual({sale_item_id:line.sale_item_id,product_id:line.product_id,batch_id:line.batch_id,quantity:line.quantity,stock_action:line.stock_action,stock_condition:line.stock_condition,
  applied_price_usd:line.applied_price_usd,applied_price_khr:line.applied_price_khr,cost_price_usd:line.cost_price_usd},
  {sale_item_id:50,product_id:product,batch_id:batch,quantity,stock_action:action,stock_condition:condition,applied_price_usd:10,applied_price_khr:40000,cost_price_usd:2},
  'refund and cost stay with the original sale item; only the physical tuple names the proven keeper')
 return line
}

const cases={
 async createControl(make,tier){
  const f=await world(make,tier)
  try{
   const r=await call(f,tier,'create no merge','/returns',createBody('create-control'))
   assert.equal(r.status,200,JSON.stringify(r.json))
   assertNewLine(f,r.json.id,{product:1,batch:1})
   assert.deepEqual(stockOf(f,1),{total:.3,branch:.3,receipts:.3,tagged:0})
  }finally{f.sql.close()}
 },
 async createAfterMerge(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const before=archive(f),archived=before()
   const r=await call(f,tier,'create after merge','/returns',createBody('create-merged'))
   assert.equal(r.status,200,'valid new return after merge: '+JSON.stringify(r.json))
   const line=assertNewLine(f,r.json.id,{product:2,batch:1100})
   assert.deepEqual(rows(f,'SELECT batch_id,branch_id,quantity,sale_item_id FROM return_item_batch_allocations WHERE return_item_id=?',line.id),[{batch_id:1100,branch_id:1,quantity:.2,sale_item_id:50}])
   assert.deepEqual(rows(f,"SELECT product_id,batch_id,quantity FROM inventory_movements WHERE reference_id=? AND movement_type='return'",r.json.id),[{product_id:2,batch_id:1100,quantity:.2}])
   assert.equal(one(f,'SELECT total_refund_usd t FROM returns WHERE id=?',r.json.id).t,2)
   assert.deepEqual(stockOf(f,2),{total:.3,branch:.3,receipts:.3,tagged:0});assert.deepEqual(stockOf(f,1),{total:0,branch:0,receipts:0,tagged:0})
   assertArchived(before(),archived)
   const committed=everything(f),again=await call(f,tier,'create replay','/returns',createBody('create-merged'))
   assert.equal(again.status,200);assert.deepEqual(again.json,r.json);assert.deepEqual(everything(f),committed,'replay gives exactly one effect')
   // The client may name the proven keeper; the server re-derives the same physical effect and refund.
   const named=await call(f,tier,'create naming keeper','/returns',createBody('create-named-keeper',{},{product_id:2,quantity:.05}))
   assert.equal(named.status,200,JSON.stringify(named.json));assertNewLine(f,named.json.id,{product:2,batch:1100,quantity:.05})
   assert.equal(stockOf(f,2).total,.35)
   // The digest does not depend on where the keeper chain points now: after B merges into C the same body replays.
   await merge(f,3,2,2000)
   const afterChain=everything(f),replayed=await call(f,tier,'create replay after keeper moved on','/returns',createBody('create-merged'))
   assert.equal(replayed.status,200,JSON.stringify(replayed.json));assert.deepEqual(replayed.json,r.json);assert.deepEqual(everything(f),afterChain)
  }finally{f.sql.close()}
 },
 async createMixedFractional(make,tier){
  const mixed=key=>{const body=createBody(key);body.items.push({...body.items[0],quantity:.1,stock_condition:'damaged',damaged_disposition:'keep'});body.items[0].quantity=.1;return body}
  if(tier==='free')for(const merged of [false,true]){
   const f=await world(make,tier);if(merged)await merge(f,2,1,1000)
   try{
    const before=everything(f),r=await call(f,tier,'create mixed Free plan limit'+(merged?' merged':''),'/returns',mixed('create-mixed-free'))
    assert.equal(r.status,400,JSON.stringify(r.json));assert.equal(r.json.code,'customer_return_over_plan_budget');assert.deepEqual(everything(f),before)
   }finally{f.sql.close()}
  }
  if(tier==='free')return
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const r=await call(f,tier,'create mixed after merge','/returns',mixed('create-mixed'))
   assert.equal(r.status,200,JSON.stringify(r.json))
   const lines=rows(f,'SELECT id,product_id,batch_id,stock_action,stock_condition,quantity,sale_item_id FROM return_items WHERE return_id=? ORDER BY id',r.json.id)
   assert.deepEqual(lines.map(({id,...line})=>line),[{product_id:2,batch_id:1100,stock_action:'restock',stock_condition:'ordinary',quantity:.1,sale_item_id:50},
    {product_id:2,batch_id:1100,stock_action:'damaged',stock_condition:'damaged',quantity:.1,sale_item_id:50}])
   assert.deepEqual(rows(f,'SELECT product_id,batch_id,quantity,quantity_remaining,condition_tag FROM damaged_stock_lots WHERE return_item_id=?',lines[1].id),
    [{product_id:2,batch_id:1100,quantity:.1,quantity_remaining:.1,condition_tag:'damaged'}])
   // Damaged is a sellable tag inside total stock, counted once: T=.3, D=.1, ordinary=.2.
   assert.deepEqual(stockOf(f,2),{total:.3,branch:.3,receipts:.3,tagged:.1})
  }finally{f.sql.close()}
 },
 async createKeeperChain(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000);await merge(f,3,2,2000)
  try{
   const archived=archive(f),saved=archived()
   const r=await call(f,tier,'create after A->B->C','/returns',createBody('create-chain'))
   assert.equal(r.status,200,JSON.stringify(r.json))
   const derived=one(f,"SELECT id FROM product_batches WHERE variant_product_id=3 AND batch_key LIKE 'merge:%:1100'").id
   assertNewLine(f,r.json.id,{product:3,batch:derived})
   assert.deepEqual(stockOf(f,3),{total:.3,branch:.3,receipts:.3,tagged:0});assert.equal(stockOf(f,2).total,0)
   assertArchived(archived(),saved)
  }finally{f.sql.close()}
 },
 async createLostAcknowledgement(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   f.loseNextCommitAcknowledgement()
   const r=await call(f,tier,'create lost ack','/returns',createBody('create-ack'))
   assert.equal(r.status,200,JSON.stringify(r.json))
   const committed=everything(f),retry=await call(f,tier,'create retry after lost ack','/returns',createBody('create-ack'))
   assert.equal(retry.status,200);assert.deepEqual(retry.json,r.json);assert.deepEqual(everything(f),committed)
   assert.equal(one(f,'SELECT COUNT(*) n FROM returns').n,1);assert.equal(stockOf(f,2).total,.3)
  }finally{f.sql.close()}
 },
 async createLateFailure(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const before=everything(f);f.failWhenSqlMatches(/INSERT INTO return_create_receipts/)
   const r=await call(f,tier,'create late failure','/returns',createBody('create-late'))
   assert.equal(r.status,503,JSON.stringify(r.json));assert.equal(r.json.code,'unknown_outcome');assert.deepEqual(everything(f),before)
   const retry=await call(f,tier,'create retry after late failure','/returns',createBody('create-late'))
   assert.equal(retry.status,200,JSON.stringify(retry.json));assert.equal(stockOf(f,2).total,.3)
  }finally{f.sql.close()}
 },
 async createStaleKeeperRace(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const statements=await mergeStatements(f,3,2,2000);let rivalState
   f.beforeCommit(async()=>{await rival(f,statements);rivalState=everything(f)})
   const r=await call(f,tier,'create keeper changed before commit','/returns',createBody('create-race'))
   assert.equal(r.status,409,JSON.stringify(r.json));assert.equal(r.json.code,'write_conflict')
   assert.equal(one(f,'SELECT is_active a FROM products WHERE id=2').a,0);assert.deepEqual(everything(f),rivalState,'refused write left only the rival merge')
   const retry=await call(f,tier,'create retry on new keeper','/returns',createBody('create-race'))
   assert.equal(retry.status,200,JSON.stringify(retry.json));assert.equal(one(f,'SELECT product_id p FROM return_items').p,3)
   assert.equal(stockOf(f,3).total,.3)
  }finally{f.sql.close()}
 },
 async mergeGuardInTransaction(make,tier){
  // A rival touching only the merged-away product's original receipt (no stock fact, sale or return row moves): only
  // the merge guard inside the write batch sees it.
  for(const kind of ['create','edit']){
   const f=await world(make,tier,kind==='edit'?{physical:.2,prior:'ordinary'}:{});await merge(f,2,1,1000)
   try{
    const send=()=>kind==='create'?call(f,tier,'create merge-record rival','/returns',createBody('guard-create'))
     :call(f,tier,'edit merge-record rival','/returns/55',editBody(f,'guard-edit'),'PATCH')
    let rivalState
    f.beforeCommit(async()=>{await rival(f,[{sql:"UPDATE product_batches SET notes='rival receipt note' WHERE id=1"}]);rivalState=everything(f)})
    const r=await send()
    assert.equal(r.status,409,kind+' '+JSON.stringify(r.json));assert.equal(r.json.code,'write_conflict');assert.deepEqual(everything(f),rivalState)
    await rival(f,[{sql:'UPDATE product_batches SET notes=NULL WHERE id=1'}])
    const retry=await send()
    assert.equal(retry.status,200,kind+' '+JSON.stringify(retry.json));assert.equal(stockOf(f,2).total,kind==='create'?.3:.2)
   }finally{f.sql.close()}
  }
 },
 async createExactMoneyAfterMerge(make,tier){
  // A v1 (exact net-entitlement) sale of .3 at 10: the quote, refund snapshot and currency stay with sale item 60.
  const key='merge-v1-line',pool={version:1,pool_key:'merge-v1-pool',evaluation_time:'2026-10-01T00:00:00.000Z',exchange_rate:4000,rules:[],
   lines:[{line_key:key,source:'selling',product:{id:1,selling_price_usd:10,selling_price_khr:40000,wholesale_price_usd:null,discount_enabled:false,
    discount_amount_usd:0,discount_amount_khr:0,discount_percent:0},selling_price_input_usd:null,manual:{type:'none',value:0}}]}
  const line=pricing.materializeCapturedPricingRow({id:60,product_id:1},pool,{[key]:.3},key,{version:1,lines:[{line_key:key,amount:3}],discount_usd:0,membership_discount_usd:0,tax_usd:0})
  const entitlement=pricing.parseSaleItemPricing(line.pricing_snapshot_json).receipt_allocation.net_entitlement_usd,total=Math.round(entitlement*100)/100
  const f=await world(make,tier)
  f.sql.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,discount_usd,membership_discount_usd,tax_usd,
   calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status)VALUES(60,'MERGE-V1-SALE',1,'Shop',4000,3,0,0,0,?,?,?,1,'completed')`)
   .run(entitlement,Number((total-entitlement).toFixed(4)),total)
  f.sql.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,total_usd,total_khr,base_price_usd,base_price_khr,
   applied_price_usd,applied_price_khr,product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,manual_discount_usd,manual_discount_khr,
   manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)VALUES(60,60,1,'Serum',.3,1,1,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .run(...['total_usd','total_khr','base_price_usd','base_price_khr','applied_price_usd','applied_price_khr','product_discount_usd','product_discount_khr',
    'product_discount_type','product_discount_label','manual_discount_usd','manual_discount_khr','manual_discount_type','manual_discount_value','price_mode','pricing_snapshot_json'].map(column=>line[column]))
  f.sql.exec('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)VALUES(60,1,1,.3,0)')
  await merge(f,2,1,1000)
  try{
   const quoted=await call(f,tier,'v1 quote after merge','/returns/quote',{sale_id:60,items:[{sale_item_id:60,quantity:.2}]})
   assert.equal(quoted.status,200,JSON.stringify(quoted.json))
   const {customer_return_create_version:_create,customer_return_edit_version:_edit,...expected}=quoted.json
   const body={client_request_id:'merge-v1',money_precision_version:1,sale_id:60,reason:'Exact refund after merge',expected_quote:expected,
    items:[{sale_item_id:60,product_id:1,quantity:.2,stock_condition:'ordinary',branch_id:1}]}
   const r=await call(f,tier,'v1 create after merge','/returns',body)
   assert.equal(r.status,200,JSON.stringify(r.json))
   const saved=one(f,'SELECT sale_item_id,product_id,batch_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,refund_snapshot_json FROM return_items WHERE return_id=?',r.json.id)
   assert.deepEqual({...saved,refund_snapshot_json:undefined},{sale_item_id:60,product_id:2,batch_id:1100,quantity:.2,applied_price_usd:10,applied_price_khr:40000,
    total_usd:expected.items[0].total_usd,total_khr:expected.items[0].total_khr,refund_snapshot_json:undefined})
   assert.ok(saved.refund_snapshot_json,'exact refund snapshot recorded from the original sale item')
   assert.deepEqual(one(f,'SELECT money_precision_version m,calculated_refund_usd c,total_refund_usd t,total_refund_khr k FROM returns WHERE id=?',r.json.id),
    {m:1,c:expected.calculated_refund_usd,t:expected.total_refund_usd,k:expected.total_refund_khr})
   assert.deepEqual(stockOf(f,2),{total:.3,branch:.3,receipts:.3,tagged:0})
   const committed=everything(f),again=await call(f,tier,'v1 create replay','/returns',body)
   assert.equal(again.status,200);assert.deepEqual(again.json,r.json);assert.deepEqual(everything(f),committed)
  }finally{f.sql.close()}
 },
 async createAfterMergeUndoRedo(make,tier){
  for(const redo of [false,true]){
   const f=await world(make,tier);await merge(f,2,1,1000);await replayMerge(f,2,1,1000,1002,'undo')
   if(redo)await replayMerge(f,2,1,1000,1003,'redo')
   try{
    // A keeper whose merge was undone is no longer a keeper; a redone merge proves it again.
    assert.equal(one(f,'SELECT is_active a FROM products WHERE id=1').a,redo?0:1)
    const r=await call(f,tier,'create after merge '+(redo?'redo':'undo'),'/returns',createBody('create-replayed'))
    assert.equal(r.status,200,JSON.stringify(r.json));assertNewLine(f,r.json.id,redo?{product:2,batch:1100}:{product:1,batch:1})
    assert.equal(stockOf(f,redo?2:1).total,.3);assert.equal(stockOf(f,redo?1:2).total,0)
    if(!redo){
     const before=everything(f),stale=await call(f,tier,'create naming undone keeper','/returns',createBody('create-stale-keeper',{},{product_id:2,quantity:.05}))
     assert.equal(stale.status,400,JSON.stringify(stale.json));assert.equal(stale.json.error,'return_condition_sale_identity_conflict');assert.deepEqual(everything(f),before)
    }
   }finally{f.sql.close()}
  }
 },
 async createRefusals(make,tier){
  for(const merged of [false,true]){
   const f=await world(make,tier);if(merged)await merge(f,2,1,1000)
   try{
    const before=everything(f)
    for(const [label,body,status,code] of [
     ['unrelated product',createBody('refuse-unrelated',{},{product_id:4}),400,'return_condition_sale_identity_conflict'],
     ['not the keeper',createBody('refuse-not-keeper',{},{product_id:3}),400,'return_condition_sale_identity_conflict'],
     ['above entitlement',createBody('refuse-over',{},{quantity:.4}),400,null],
     ['another organisation product id',createBody('refuse-foreign',{},{product_id:987654}),400,'return_condition_sale_identity_conflict'],
    ]){
     const r=await call(f,tier,'create refusal '+label+(merged?' merged':''),'/returns',body)
     assert.equal(r.status,status,label+' '+JSON.stringify(r.json))
     if(code)assert.equal(r.json.code??r.json.error,code,label)
     assert.deepEqual(everything(f),before,label+' wrote nothing')
    }
   }finally{f.sql.close()}
  }
 },
 async createZeroStockMerge(make,tier){
  const f=await world(make,tier,{physical:0});await merge(f,2,1,1000)
  try{
   const r=await call(f,tier,'create after zero-stock merge','/returns',createBody('create-zero'))
   assert.equal(r.status,200,JSON.stringify(r.json));assertNewLine(f,r.json.id,{product:2,batch:1100})
   assert.deepEqual(stockOf(f,2),{total:.2,branch:.2,receipts:.2,tagged:0})
  }finally{f.sql.close()}
 },
 async createTaggedOrigin(make,tier){
  for(const choice of [null,'ordinary']){
   const f=await world(make,tier,{taggedSale:true});await merge(f,2,1,1000)
   try{
    const derivative=one(f,"SELECT id FROM damaged_stock_lots WHERE product_id=2").id
    const item=choice?{quantity:.2,stock_condition:choice}:{quantity:.2}
    const body=createBody('create-tagged-'+choice,{},item);if(!choice)delete body.items[0].stock_condition
    const r=await call(f,tier,'create tagged-origin '+(choice||'default')+' after merge','/returns',body)
    assert.equal(r.status,200,JSON.stringify(r.json))
    // Defaults to the sold condition; an explicit permitted change to ordinary is honoured.
    const line=assertNewLine(f,r.json.id,{product:2,batch:1100,action:choice?'restock':'damaged',condition:choice||'damaged'})
    assert.equal(one(f,'SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=?',derivative).q,.1,'the sold derivative tag is not touched')
    assert.deepEqual(stockOf(f,2),{total:.3,branch:.3,receipts:.3,tagged:choice?.1:.3})
    if(!choice)assert.deepEqual(rows(f,'SELECT product_id,batch_id,quantity_remaining FROM damaged_stock_lots WHERE return_item_id=?',line.id),[{product_id:2,batch_id:1100,quantity_remaining:.2}])
   }finally{f.sql.close()}
  }
 },
 async editControl(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'ordinary'})
  try{
   const r=await call(f,tier,'edit no merge','/returns/55',editBody(f,'edit-control'),'PATCH')
   assert.equal(r.status,200,JSON.stringify(r.json));assertNewLine(f,55,{product:1,batch:1,quantity:.1})
   assert.equal(stockOf(f,1).total,.2)
  }finally{f.sql.close()}
 },
 async editOrdinaryReasonOnly(make,tier){
  for(const shape of ['modal','header']){
   const f=await world(make,tier,{physical:.2,prior:'ordinary'});await merge(f,2,1,1000)
   try{
    const archived=archive(f,55),saved=archived(),body=editBody(f,'edit-ordinary-'+shape)
    if(shape==='header')delete body.items
    const r=await call(f,tier,'edit ordinary reason-only '+shape+' after merge','/returns/55',body,'PATCH')
    assert.equal(r.status,200,'reason-only edit after merge: '+JSON.stringify(r.json))
    assert.equal(one(f,'SELECT reason FROM returns WHERE id=55').reason,'Changed reason')
    assertNewLine(f,55,{product:2,batch:1100,quantity:.1})
    assert.deepEqual(stockOf(f,2),{total:.2,branch:.2,receipts:.2,tagged:0});assert.equal(stockOf(f,1).total,0)
    assert.equal(one(f,'SELECT total_refund_usd t FROM returns WHERE id=55').t,1)
    assertArchived(archived(),saved)
    const committed=everything(f),again=await call(f,tier,'edit replay '+shape,'/returns/55',body,'PATCH')
    assert.equal(again.status,200);assert.deepEqual(again.json,r.json);assert.deepEqual(everything(f),committed)
   }finally{f.sql.close()}
  }
 },
 async editTaggedReasonOnly(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'tagged'});await merge(f,2,1,1000)
  try{
   const archived=archive(f,55),saved=archived(),derivative=one(f,'SELECT id FROM damaged_stock_lots WHERE product_id=2').id
   assert.equal(one(f,'SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=?',derivative).q,.1)
   const r=await call(f,tier,'edit tagged reason-only after merge','/returns/55',editBody(f,'edit-tagged'),'PATCH')
   assert.equal(r.status,200,'merge zero on the original tag is not consumption: '+JSON.stringify(r.json))
   const line=assertNewLine(f,55,{product:2,batch:null,quantity:.1,action:'damaged',condition:'damaged'})
   assert.deepEqual(rows(f,'SELECT product_id,batch_id,quantity_remaining,condition_tag FROM damaged_stock_lots WHERE return_item_id=?',line.id),[{product_id:2,batch_id:1100,quantity_remaining:.1,condition_tag:'damaged'}])
   assert.equal(one(f,'SELECT quantity_remaining q FROM damaged_stock_lots WHERE id=?',derivative).q,0)
   assert.deepEqual(stockOf(f,2),{total:.2,branch:.2,receipts:.2,tagged:.1})
   assertArchived(archived(),saved)
  }finally{f.sql.close()}
 },
 async editTaggedConsumed(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'tagged'});await merge(f,2,1,1000)
  try{
   const derivative=one(f,'SELECT id FROM damaged_stock_lots WHERE product_id=2').id
   await executeStockTransaction(getDb(f.env),[{sql:'UPDATE damaged_stock_lots SET quantity_remaining=.05 WHERE id=@id',params:{id:derivative}},
    {sql:'UPDATE branch_batch_stock SET quantity=.15 WHERE batch_id=1100'},{sql:'UPDATE branch_stock SET quantity=.15 WHERE product_id=2'},{sql:'UPDATE products SET stock_quantity=.15 WHERE id=2'}],'once')
   const before=everything(f),r=await call(f,tier,'edit tagged after derivative sold','/returns/55',editBody(f,'edit-consumed'),'PATCH')
   // Only the .05 really drawn from the keeper's derivative is consumed; the merge's zero on the original tag is not.
   assert.equal(r.status,400,JSON.stringify(r.json));assert.match(r.json.error,/^0\.05 unit\(s\) of "Serum".*already been drawn/)
   assert.deepEqual(everything(f),before)
  }finally{f.sql.close()}
 },
 async editQuantityAndEntitlement(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'ordinary'});await merge(f,2,1,1000)
  try{
   const before=everything(f)
   const over=await call(f,tier,'edit above entitlement after merge','/returns/55',editBody(f,'edit-over',{quantity:.4}),'PATCH')
   assert.equal(over.status,400,JSON.stringify(over.json));assert.deepEqual(everything(f),before)
   const r=await call(f,tier,'edit quantity after merge','/returns/55',editBody(f,'edit-quantity',{quantity:.2}),'PATCH')
   assert.equal(r.status,200,JSON.stringify(r.json));assertNewLine(f,55,{product:2,batch:1100,quantity:.2})
   assert.deepEqual(stockOf(f,2),{total:.3,branch:.3,receipts:.3,tagged:0});assert.equal(one(f,'SELECT total_refund_usd t FROM returns WHERE id=55').t,2)
  }finally{f.sql.close()}
 },
 async editNewReturnAfterChain(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const created=await call(f,tier,'create before second merge','/returns',createBody('chain-create'))
   assert.equal(created.status,200,JSON.stringify(created.json))
   const id=created.json.id,url='/returns/'+id
   // The modal names the saved line's product: the proven keeper.
   const firstEdit=editBody(f,'chain-edit-1',{},{},id),same=await call(f,tier,'edit post-merge return naming keeper',url,firstEdit,'PATCH')
   assert.equal(same.status,200,JSON.stringify(same.json));assertNewLine(f,id,{product:2,batch:1100})
   await merge(f,3,2,2000)
   const afterChain=everything(f),replayed=await call(f,tier,'edit replay after keeper moved on',url,firstEdit,'PATCH')
   assert.equal(replayed.status,200,JSON.stringify(replayed.json));assert.deepEqual(replayed.json,same.json);assert.deepEqual(everything(f),afterChain)
   const archived=archive(f,id),saved=archived()
   const r=await call(f,tier,'edit naming intermediate keeper after A->B->C',url,editBody(f,'chain-edit-2',{},{},id),'PATCH')
   assert.equal(r.status,200,JSON.stringify(r.json))
   const derived=one(f,"SELECT id FROM product_batches WHERE variant_product_id=3 AND batch_key LIKE 'merge:%:1100'").id
   assertNewLine(f,id,{product:3,batch:derived});assert.deepEqual(stockOf(f,3),{total:.3,branch:.3,receipts:.3,tagged:0})
   assertArchived(archived(),saved)
   const before=everything(f)
   const wrong=await call(f,tier,'edit naming unrelated product',url,editBody(f,'chain-edit-wrong',{product_id:4},{},id),'PATCH')
   assert.equal(wrong.status,400,JSON.stringify(wrong.json));assert.equal(wrong.json.error,'return_condition_sale_identity_conflict');assert.deepEqual(everything(f),before)
  }finally{f.sql.close()}
 },
 async editLostAcknowledgement(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'tagged'});await merge(f,2,1,1000)
  try{
   const body=editBody(f,'edit-ack');f.loseNextCommitAcknowledgement()
   const r=await call(f,tier,'edit lost ack','/returns/55',body,'PATCH')
   assert.equal(r.status,200,JSON.stringify(r.json))
   const committed=everything(f),retry=await call(f,tier,'edit retry after lost ack','/returns/55',body,'PATCH')
   assert.equal(retry.status,200);assert.deepEqual(retry.json,r.json);assert.deepEqual(everything(f),committed)
   assert.deepEqual(stockOf(f,2),{total:.2,branch:.2,receipts:.2,tagged:.1})
  }finally{f.sql.close()}
 },
 async editV1Refused(make,tier){
  const f=await world(make,tier,{physical:.2,prior:'ordinary'});await merge(f,2,1,1000)
  try{
   f.sql.exec('UPDATE returns SET money_precision_version=1,calculated_refund_usd=1,rounding_adjustment_usd=0 WHERE id=55')
   const before=everything(f),r=await call(f,tier,'v1 edit refused','/returns/55',editBody(f,'edit-v1'),'PATCH')
   assert.equal(r.status,409);assert.equal(r.json.code,'customer_return_edit_v1_not_supported');assert.deepEqual(everything(f),before)
  }finally{f.sql.close()}
 },
 async createThenBulkCancelUndoRedo(make,tier){
  const f=await world(make,tier);await merge(f,2,1,1000)
  try{
   const created=await call(f,tier,'create for bulk','/returns',createBody('bulk-create'))
   assert.equal(created.status,200,JSON.stringify(created.json))
   const item=one(f,'SELECT id,status expected_status,return_type expected_method,updated_at expected_updated_at FROM returns WHERE id=?',created.json.id)
   const archived=archive(f,created.json.id),saved=archived(),lines=()=>[rows(f,'SELECT * FROM return_items WHERE return_id=?',created.json.id),
    rows(f,'SELECT a.* FROM return_item_batch_allocations a JOIN return_items i ON i.id=a.return_item_id WHERE i.return_id=?',created.json.id)],savedLines=lines()
   const cancel=await call(f,tier,'bulk cancel merged create','/returns/bulk',{client_request_id:'bulk-cancel',field:'status',source:'completed',target:'cancelled',items:[item]})
   assert.equal(cancel.status,200,JSON.stringify(cancel.json));assert.equal(stockOf(f,2).total,.1)
   assert.equal((await call(f,tier,'bulk undo','/action-history/'+cancel.json.actionHistoryId+'/undo',{expected_generation:0})).status,200);assert.equal(stockOf(f,2).total,.3)
   assert.equal((await call(f,tier,'bulk redo','/action-history/'+cancel.json.actionHistoryId+'/redo',{expected_generation:1})).status,200);assert.equal(stockOf(f,2).total,.1)
   assertArchived(archived(),saved);assert.deepEqual(lines(),savedLines,'bulk cancel/undo/redo never rewrites the new return lines')
  }finally{f.sql.close()}
 },
}

async function main(){
 const make=await h.bundle.exports.bundleWorker(),only=process.env.CASES?new Set(process.env.CASES.split(',')):null,failures=[]
 for(const [name,run] of Object.entries(cases)){
  if(only && !only.has(name))continue
  for(const tier of ['free','paid']){
   try{await run(make,tier);console.log('PASS '+name+' '+tier)}
   catch(error){failures.push(name+' '+tier);console.log('RED '+name+' '+tier+': '+String(error&&error.message||error).split('\n').slice(0,6).join(' | '))}
  }
 }
 const max=tier=>Math.max(0,...counts.filter(row=>row.tier===tier).map(row=>row.queries))
 console.log('QUERIES '+JSON.stringify({free:max('free'),paid:max('paid')}))
 for(const row of counts)console.log('COUNT '+JSON.stringify(row))
 console.log(failures.length?'RED '+failures.length+': '+failures.join(', '):'ALL PASS')
 if(failures.length)process.exitCode=1
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={cases,world,main}
