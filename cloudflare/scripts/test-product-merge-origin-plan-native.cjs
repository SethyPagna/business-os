const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const {openDb}=require('./harness/d1compat.cjs'),{loadAll}=require('./harness/load_migrations.cjs')
const cache=new Map(),src=path.resolve(__dirname,'../src')
function load(file){if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);const code=ts.transpileModule(fs.readFileSync(path.join(src,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('.')?load(path.posix.join(path.posix.dirname(file),name+'.ts')):require(name),mod,mod.exports);return mod.exports}
const snapshotModule=load('lib/productMergeSnapshot.ts'),origins=load('lib/productMergeOriginPlan.ts'),kernel=load('lib/countedDamagedStock.ts'),stock=load('lib/stockTransaction.ts'),costs=load('lib/catalogCostRecompute.ts')
function world(){return openDb(loadAll(),{seedBeforeFence(d1){d1.db.exec(`
 INSERT INTO branches(id,name,is_active)VALUES(1,'Shop',1);
 INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,cost_price_khr)VALUES(1,'Keeper',1,1,6,12000),(2,'Original',1,1.4,4,8000);
 INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,1,1),(2,1,1.4);
 INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,is_active,unit_cost_usd,received_at,supplier_id,supplier_name,received_quantity,received_cost_usd,received_branch_id,received_branch_name,payment_status,credit_due_date,lot_code,notes)
 VALUES(1,1,'original-keeper',4,1,6,'2026-09-01',17,'Supplier',1,6,1,'Original Shop','credit','2026-12-01','K','keeper'),
 (10,2,'original-receipt',1,1,2,'2026-09-01',17,'Supplier',3,6,1,'Original Shop','credit','2026-12-01','L','មាន'),
 (11,2,'exhausted',2,1,9,'2026-09-02',17,'Supplier',0,0,1,'Original Shop','paid',NULL,'E','empty'),
 (12,2,'inactive',3,0,3,'2026-09-03',17,'Supplier',0,0,1,'Original Shop','paid',NULL,'I','inactive'),
 (13,2,'zero-cost',4,1,0,'2026-09-04',17,'Supplier',0,0,1,'Original Shop','paid',NULL,'Z','unknown cost');
 INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,1,1),(10,1,.6),(11,1,0);
 INSERT INTO product_cost_entries(id,product_id,cost_usd,cost_khr,source,user_name,baseline_batch_id,previous_cost_usd)VALUES(28,1,6,12000,'manual','keeper',1,6),(29,2,0,8000,'manual','older',13,2),(30,2,4,8000,'manual','source',10,2);
 INSERT INTO damaged_stock_lots(id,product_id,product_name,branch_id,batch_id,return_id,quantity,quantity_remaining,reason,condition_tag,source,unit_cost_usd,created_by_user_id,created_by_user_name)
 VALUES(20,2,'Original',1,10,700,3,.4,'Original return','damaged','return',2,7,'Original actor'),
 (21,2,'Original',1,10,700,2,0,'Consumed return','expired','return',2,7,'Original actor'),
 (22,2,'Original',1,NULL,NULL,1,.2,'Unlotted tag','damaged','adjustment',1.0000000000000002,7,'Original actor');
 `)}})}
function adapter(d1){return {batch:rows=>d1.batch(rows),batchOnce:rows=>d1.batch(rows)}}
function insert(table,metadata){const keys=Object.keys(metadata);return {sql:`INSERT INTO ${table}(${keys.join(',')})VALUES(${keys.map(key=>'@'+key).join(',')})`,params:metadata}}
const reserve={operationId:'origin-proof',receiptIds:[10,11,12,13].map((sourceReceiptId,index)=>({sourceReceiptId,targetReceiptId:100+index})),tagIds:[20,21,22].map((sourceTagId,index)=>({sourceTagId,targetTagId:200+index}))}
async function capture(d1){return snapshotModule.readProductMergeCaseSnapshot(adapter(d1),1,2,[])}
const rows=(d1,table)=>d1.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
async function main(){
 const metrics=[]
 for(const relocate of [false,true]){
  const d1=world()
  await stock.executeStockTransaction(adapter(d1),[{sql:"INSERT INTO returns(id,return_number,branch_id,return_type)VALUES(700,'R700',1,'refund')"},{sql:"INSERT INTO return_items(id,return_id,product_id,quantity,branch_id,stock_action,stock_condition)VALUES(701,700,2,3,1,'damaged','damaged'),(702,700,2,2,1,'damaged','expired')"}],'once')
  const snapshot=await capture(d1),before=JSON.stringify(snapshot),plan=origins.planProductMergeOrigins(snapshot,reserve)
  assert.equal(JSON.stringify(snapshot),before)
  assert.deepEqual(plan.receiptOrigins.map(row=>[row.original.id,row.batchNumber,row.valuation.effectiveUnitCostUsd,row.valuation.source]),[[10,5,4,'manual'],[11,6,9,'receipt'],[12,7,null,'excluded'],[13,8,null,'excluded']])
  assert.equal(plan.receiptOrigins[0].valuation.manualEntry.id,30)
  assert.equal(snapshot.productCostRows[plan.receiptOrigins[0].valuation.manualEntry.index].id,30)
  assert.equal(plan.receiptClones[2].metadata.is_active,0)
  assert.equal(plan.tagClones[0].metadata.quantity,3);assert.equal(plan.tagClones[1].metadata.quantity_remaining,0)
  assert.equal(plan.tagClones[2].metadata.batch_id,null)
  assert.equal(kernel.sumCountedQuantities(plan.physicalEdges.map(row=>row.quantity)),2)
  const originals={receipts:rows(d1,'product_batches'),tags:rows(d1,'damaged_stock_lots'),costs:rows(d1,'product_cost_entries')}
  const purchases=()=>d1.db.prepare('SELECT SUM(received_quantity) quantity,SUM(received_cost_usd) cost FROM product_batches WHERE received_quantity IS NULL OR received_quantity>0 OR COALESCE(received_cost_usd,0)<>0').get()
  const invoiceBefore=purchases()
  const writes=[snapshotModule.productMergeCaptureGuard(snapshot)]
  for(const clone of plan.receiptClones)writes.push(insert('product_batches',clone.metadata))
  const incoming=new Map()
  for(const edge of plan.physicalEdges)if(edge.effect.batchId!==null){const values=incoming.get(edge.effect.batchId)||[];values.push(edge.quantity);incoming.set(edge.effect.batchId,values)}
  for(const [batchId,values]of incoming)writes.push({sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(@batchId,1,@quantity)',params:{batchId,quantity:kernel.sumCountedQuantities(values)}})
  for(const clone of plan.tagClones)writes.push(insert('damaged_stock_lots',clone.metadata))
  writes.push({sql:'UPDATE branch_stock SET quantity=3 WHERE product_id=1 AND branch_id=1'},{sql:'UPDATE products SET stock_quantity=3 WHERE id=1'})
  if(relocate)writes.push({sql:'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN(10,11,12,13)'},{sql:'UPDATE branch_stock SET quantity=0 WHERE product_id=2'},{sql:'UPDATE products SET stock_quantity=0 WHERE id=2'},{sql:'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2'})
  writes.push(costs.catalogCostRecomputeStatement(1))
  metrics.push({world:relocate?'stock-conserving':'metadata-only',captureStatements:1,businessStatements:writes.length,stockDispatchStatements:writes.length+2,planBytes:Buffer.byteLength(JSON.stringify(plan),'utf8')})
  await stock.executeStockTransaction(adapter(d1),writes,'once')
  assert.deepEqual(rows(d1,'product_batches').filter(row=>row.id<100),originals.receipts)
  const tagMetadata=row=>{const result={...row};if(relocate)delete result.quantity_remaining;return result}
  assert.deepEqual(rows(d1,'damaged_stock_lots').filter(row=>row.id<200).map(tagMetadata),originals.tags.map(tagMetadata))
  assert.deepEqual(rows(d1,'product_cost_entries'),originals.costs);assert.deepEqual(purchases(),invoiceBefore)
  for(const [table,clones]of [['product_batches',plan.receiptClones],['damaged_stock_lots',plan.tagClones]])for(const clone of clones){const stored=d1.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(clone.id);assert.deepEqual(Object.keys(clone.metadata).sort(),d1.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name).sort());for(const [field,value]of Object.entries(clone.metadata))assert.equal(stored[field],value,table+' '+field)}
  assert.equal(plan.tagClones[2].metadata.unit_cost_usd,1.0000000000000002)
  assert.equal(d1.db.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd,5)
  assert.equal(d1.db.prepare('SELECT cost_price_khr FROM products WHERE id=1').get().cost_price_khr,12000)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM damaged_stock_lots WHERE return_id=700').get().n,2)
  const facts=()=>d1.db.prepare('SELECT '+kernel.countedStockFactsSql('1','1')+' facts').get().facts
  const exact=new kernel.CountedStockPlan(facts(),1)
  const identity={productId:1,branchId:1,batchId:100,lotId:200}
  assert.doesNotThrow(()=>exact.change(identity,1,'restore'))
  const lowCap=JSON.parse(facts());lowCap.tags.find(row=>row[0]===200)[2]=.4
  assert.throws(()=>new kernel.CountedStockPlan(JSON.stringify(lowCap),1).change(identity,1,'restore'),kernel.CountedStockConflictError)
  assert.doesNotThrow(()=>new kernel.CountedStockPlan(facts(),1).change({productId:1,branchId:1,batchId:100,lotId:201},1,'restore'))
  if(relocate){assert.equal(d1.db.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,3);assert.equal(d1.db.prepare('SELECT SUM(quantity_remaining) n FROM damaged_stock_lots WHERE product_id=2').get().n,0);assert.equal(kernel.sumCountedQuantities(rows(d1,'damaged_stock_lots').filter(row=>row.product_id===1).map(row=>row.quantity_remaining)),.6)}
  if(relocate){const restore=new kernel.CountedStockPlan(facts(),1);await stock.executeStockTransaction(adapter(d1),[...restore.change(identity,1,'restore'),...restore.change({productId:1,branchId:1,batchId:100,lotId:201},1,'restore')],'once');assert.equal(d1.db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,5);assert.equal(d1.db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=200').get().quantity_remaining,1.4);assert.equal(d1.db.prepare('SELECT quantity_remaining FROM damaged_stock_lots WHERE id=201').get().quantity_remaining,1);assert.deepEqual(purchases(),invoiceBefore)}
  for(const bad of [{...reserve,receiptIds:reserve.receiptIds.slice(1)},{...reserve,receiptIds:reserve.receiptIds.map(row=>({...row,targetReceiptId:1}))},{...reserve,tagIds:reserve.tagIds.map(row=>({...row,targetTagId:20}))},{...reserve,operationId:'../wrong'}])assert.throws(()=>origins.planProductMergeOrigins(snapshot,bad),origins.ProductMergeOriginPlanError)
  snapshot.duplicateBatchRows[0].unit_cost_usd=7
  assert.throws(()=>origins.planProductMergeOrigins(snapshot,reserve),origins.ProductMergeOriginPlanError)
  d1.db.close()
 }
 for(const number of [null,0,1.5,Number.MAX_SAFE_INTEGER]){const d1=world();await stock.executeStockTransaction(adapter(d1),[{sql:'UPDATE product_batches SET batch_number=@number WHERE id=1',params:{number}}],'once');const snapshot=await capture(d1);if(number===null)assert.equal(origins.planProductMergeOrigins(snapshot,reserve).receiptOrigins[0].batchNumber,1);else assert.throws(()=>origins.planProductMergeOrigins(snapshot,reserve),origins.ProductMergeOriginPlanError);d1.db.close()}
 console.log(JSON.stringify(metrics))
 console.log('PASS two full-schema worlds: metadata-only and stock-conserving relocation; all receipts/tags/zero/NULL origins, original immutable rows, purchase0/0, manual6+4=5, cap/exhausted restore, reservation/source controls; four actual captured sequence controls')
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={world,adapter,reserve,capture,rows,load,main}
