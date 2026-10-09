const assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process')
const fs=require('node:fs'),path=require('node:path')
const seedCases = [[2001,7,[]],[2002,7,[]],[2003,12,[[3001,4,'2026-09-01'],[3002,8,'2026-09-02']]],[2004,7,[[3003,7,'2026-09-01']]],[2005,7,[[4001,7,'2026-09-01']]],[2006,7,[]]]
const preseed = seedCases.flatMap(([id,stock,lots]) => [
  `INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd) VALUES(${id},'Count ${id}',1,${stock},2)`,
  `INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(${id},1,${stock})`,
  ...lots.flatMap(([lot,q,date]) => [
    `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,received_quantity,unit_cost_usd,received_cost_usd,is_active) VALUES(${lot},${id},'${id}-${lot}','${id}-${lot}','${date}',${q},2,${q*2},1)`,
    `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(${lot},1,${q})`,
  ]),
]).join(';') + ';'
const coreSource = fs.readFileSync(path.join(__dirname,'test-stock-bridge-core-native.cjs'),'utf8')
const marker = "sql.exec('BEGIN IMMEDIATE')"
assert.ok(coreSource.includes(marker))
const fixtureModule = { exports: {} }
const epochBlock = /sql\.exec\('BEGIN IMMEDIATE'\)[\s\S]*?sql\.limits\.exprDepth = 100/
assert.ok(epochBlock.test(coreSource))
const seededSource = coreSource.replace(epochBlock, `sql.exec(${JSON.stringify(preseed)}); require('./harness/d1compat.cjs').applyMigrations({db:sql},loadAll().slice(loadAll({through:242}).length)); sql.limits.exprDepth = 100`)
new Function('require','module','__dirname',seededSource)(require,fixtureModule,__dirname)
const f = fixtureModule.exports
const current=f.load('lib/datedStockCountApply.ts')
const old=f.load('lib/datedStockCountApply.ts',execFileSync('git',['show','f132ba1e75a21d41aeda85d7b60d16cffcee9a3f:cloudflare/src/lib/datedStockCountApply.ts'],{encoding:'utf8'}))
const {buildDatedStockCountPlan}=f.load('lib/datedStockCountRoute.ts')
const {applyMovementRevert}=f.load('lib/stockRevert.ts')
const {removalLossMovementWhere}=f.load('lib/removalLosses.ts')
const entry=(id,count)=>[{date:'2026-10-01',productId:id,branchId:1,count}]
async function plan(id,count){const built=await buildDatedStockCountPlan(f.db,entry(id,count));assert.ok(!built.error,built.error);return built.plan}
async function apply(id,count,impl=current){return impl.applyDatedStockCountPlan(f.db,await plan(id,count),{userId:7,userName:'admin'})}
async function seed(id,stock){ assert.equal(f.sql.prepare('SELECT stock_quantity q FROM products WHERE id=?').get(id).q,stock) }

const roots=id=>f.sql.prepare("SELECT * FROM inventory_movements WHERE product_id=? AND reason='Dated stock count import' ORDER BY id").all(id)
const originalBytes=id=>JSON.stringify({row:f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id),actions:f.sql.prepare('SELECT * FROM dated_stock_count_batch_actions WHERE movement_id=? ORDER BY id').all(id)})
const stock=id=>f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1').get(id).quantity
const state=()=>JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','inventory_movements','dated_stock_count_batch_actions'].map(t=>f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))
async function main(){
 await seed(2001,7);await apply(2001,10,old);const lost=roots(2001)[0].id;await apply(2001,10,old);assert.equal(f.sql.prepare('SELECT id FROM inventory_movements WHERE id=?').get(lost),undefined);console.log('PASS frozen f132 reapply deletes original history under actual0243/0244')
 for(const [id,start,count,lots] of [[2002,7,10,[]],[2003,12,2,[[3001,4,'2026-09-01'],[3002,8,'2026-09-02']]],[2004,7,10,[[3003,7,'2026-09-01']]]]){
  await seed(id,start,lots);await apply(id,count);const root=roots(id)[0];
  f.sql.prepare('UPDATE inventory_movements SET unit_cost_usd=CASE WHEN product_id=2002 THEN 0 WHEN product_id=2004 THEN NULL ELSE 2 END,unit_cost_khr=CASE WHEN product_id=2002 THEN 0 WHEN product_id=2004 THEN NULL ELSE 8000 END,total_cost_usd=CASE WHEN product_id=2002 THEN 0 WHEN product_id=2004 THEN NULL ELSE quantity*2 END,total_cost_khr=CASE WHEN product_id=2002 THEN 0 WHEN product_id=2004 THEN NULL ELSE quantity*8000 END WHERE id=?').run(root.id)
  const before=originalBytes(root.id);const result=await apply(id,count);assert.equal(result.movementsDeleted,0);assert.equal(result.movementsCompensated,1);assert.equal(stock(id),count);assert.equal(originalBytes(root.id),before)
  const counter=f.sql.prepare('SELECT * FROM inventory_movements WHERE reference_id=?').get(`revert:${root.id}`);assert.ok(counter);for(const key of ['unit_cost_usd','unit_cost_khr','total_cost_usd','total_cost_khr','batch_id','branch_name','addressed_branch_name'])assert.equal(counter[key],f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(root.id)[key])
  const repeat=await applyMovementRevert(f.db,f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(root.id),{userId:7,userName:'admin'});assert.equal(repeat.ok,false);assert.equal(stock(id),count)
  let back=await applyMovementRevert(f.db,counter,{userId:7,userName:'admin'});if(!back.ok){assert.match(back.code,/insufficient/);for(const share of f.sql.prepare('SELECT batch_id,ABS(quantity) q FROM dated_stock_count_batch_actions WHERE movement_id=?').all(root.id)){const available=f.sql.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=? AND branch_id=1').get(share.batch_id)?.q||0;if(available<share.q)await f.load('lib/productBatches.ts').receiveBatchStock(f.db,{productId:id,branchId:1,batchId:share.batch_id,quantity:share.q-available,historicalReceiptReplay:true})}back=await applyMovementRevert(f.db,counter,{userId:7,userName:'admin'})}assert.equal(back.ok,true);await apply(id,count);assert.equal(stock(id),count);assert.equal(originalBytes(root.id),before);assert.equal(f.permits(),0)
  console.log(`PASS ${id} positive/negative/plain/multi-lot reapply retains immutable root/provenance/cost; counter revert then recount`)
 }
 await seed(2005,7,[[4001,7,'2026-09-01']]);await apply(2005,10);const prior=roots(2005)[0],bytes=originalBytes(prior.id);const batches=f.load('lib/productBatches.ts');await batches.removeStockFromBatch(f.db,{productId:2005,branchId:1,batchId:4001,quantity:2});await apply(2005,10);assert.equal(stock(2005),10);assert.equal(originalBytes(prior.id),bytes);console.log('PASS intervening sale/removal keeps lot and aggregate count arithmetic, provenance unchanged')
 const stale=await plan(2005,12);await apply(2005,11);const before=state();await assert.rejects(current.applyDatedStockCountPlan(f.db,stale),e=>e instanceof current.DatedStockCountConflictError);assert.equal(state(),before)
 const late=await plan(2005,12);f.failSql(/INSERT INTO dated_stock_count_batch_actions/);await assert.rejects(current.applyDatedStockCountPlan(f.db,late),/fixture transaction failure/);assert.equal(state(),before);console.log('PASS concurrent rerun and late rollback retain all physical history/provenance')
 assert.equal(f.sql.prepare(`SELECT COUNT(*) n FROM inventory_movements m WHERE m.product_id BETWEEN 2001 AND 2005 AND ${removalLossMovementWhere('m')}`).get().n,0);console.log('PASS dated original and numeric counters do not double-count removal losses')
 await seed(2006,7);await apply(2006,10);const pending=await plan(2006,12);const original=roots(2006)[0];const reverted=await applyMovementRevert(f.db,original,{userId:7,userName:'admin'});assert.equal(reverted.ok,true);const afterRevert=state();await assert.rejects(current.applyDatedStockCountPlan(f.db,pending),e=>e instanceof current.DatedStockCountConflictError);assert.equal(state(),afterRevert);console.log('PASS ledger revert after preview refuses stale recount without duplicate compensation')
 f.sql.exec("UPDATE branches SET is_active=0 WHERE id=1");const inactive=await buildDatedStockCountPlan(f.db,entry(2006,10));assert.equal(inactive.code,'branch_retired_no_successor');assert.equal(state(),afterRevert);f.sql.exec("UPDATE branches SET is_active=1 WHERE id=1");console.log('PASS inactive branch requires explicit redirect without stock/history changes')
 console.log('PASS actual0243/0244 append-only native compensation controls')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>f.sql.close())



