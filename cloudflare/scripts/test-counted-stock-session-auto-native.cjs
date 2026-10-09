const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')

async function absent(w,tier,explicit,scenario='normal'){
  const f=await h.world(w,tier,'zero',sql=>{h.seed(.1,false)(sql);if(scenario==='owner')sql.exec("INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Other owner',0,1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0)")})
  try{
    const db=h.loadStockSession('lib/db.ts').getDb(f.env),stock=h.loadStockSession('lib/stockTransaction.ts')
    await stock.executeStockTransaction(db,[{sql:'DELETE FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1',params:{}}],'once')
    if(['inactive','null'].includes(scenario))await stock.executeStockTransaction(db,[{sql:'UPDATE product_batches SET is_active='+ (scenario==='null'?'NULL':'0')+' WHERE id=1',params:{}}],'once')
    const before=f.state(),batches=f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all()
    const body={client_request_id:'session-absent-'+scenario,mode:'stock_in',items:[{line_id:'one',kind:'receive',product_id:1,branch_id:1,quantity:.2,received_date:'2026-09-01',unit_cost_usd:2,...(explicit?{batch_id:1}:{supplier_name:'Receipt supplier'})}]}
    const rivals={owner:'UPDATE product_batches SET variant_product_id=2 WHERE id=1',date:"UPDATE product_batches SET received_at='2026-10-08' WHERE id=1",active:'UPDATE product_batches SET is_active=0 WHERE id=1',membership:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,1,0)',actor:'UPDATE users SET is_active=0 WHERE id=7'}
    if(rivals[scenario])f.competeBeforeCommit([{sql:rivals[scenario]}])
    if(scenario==='late')f.failWhenSqlMatches(/SET receipt_json=json_object/)
    if(['ack','unknown'].includes(scenario))f.loseNextCommitAcknowledgement()
    let attempted=0,denied=0;const raw=f.env.DB,failed=new Set()
    if(scenario==='interDate'){
      let raced=false;const concurrent=h.loadStockSession('lib/db.ts').getDb({DB:raw})
      const wrap=(s,sql)=>new Proxy(s,{get(t,k){if(k==='bind')return(...args)=>wrap(t.bind(...args),sql);if(k==='all')return async(...args)=>{const result=await t.all(...args);if(!raced&&sql.includes("SELECT 'counted'")){raced=true;await stock.executeStockTransaction(concurrent,[{sql:"UPDATE product_batches SET received_at='2026-10-08' WHERE id=1",params:{}}],'once')}return result};return t[k]}})
      f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql),sql);return t[k]}})
    }
    if(['tail','unknown'].includes(scenario)){
      const committed=()=>f.sql.prepare('SELECT count(*) n FROM stock_session_operations WHERE receipt_json IS NOT NULL').get().n>0
      const reject=sql=>{if(!committed())return false;if(scenario==='unknown'&&/SELECT request_json,receipt_json FROM stock_session_operations/.test(sql)){denied++;return true}if(scenario!=='tail')return false;const key=/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null;if(!key||failed.has(key))return false;failed.add(key);return true}
      const wrap=(s,sql)=>new Proxy(s,{get(t,k){if(k==='bind')return(...args)=>wrap(t.bind(...args),sql);if(['first','all','run'].includes(k))return(...args)=>{attempted++;if(reject(sql))return Promise.reject(Error('D1_ERROR: unknown native session network'));return t[k](...args)};return t[k]}})
      f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql),sql);if(k==='batch')return ss=>{attempted+=ss.length;if(ss.some(s=>reject(s.text)))return Promise.reject(Error('D1_ERROR: unknown native session batch network'));return t.batch(ss)};return t[k]}})
      f.env.CACHE={get:async()=>null,put:async()=>{throw Error('native session KV fail')},delete:async()=>{}}
      f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
    }
    const result=await f.call('/inventory/sessions',body)
    console.log('AUTO '+JSON.stringify({tier,explicit,scenario,result,attempted,denied,failed:[...failed]}))
    if(tier==='free'&&['inactive','null'].includes(scenario)){assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'stock_session_query_budget_exceeded');assert.deepEqual(f.state(),before);assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),batches);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);return}
    if(rivals[scenario]||scenario==='interDate'){assert.equal(result.status,409,JSON.stringify(result));assert.equal(f.state().movements.length,before.movements.length);assert.equal(f.state().physical,before.physical);assert.equal(f.state().cache,before.cache);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);if(scenario!=='membership')assert.deepEqual(f.state().lots,before.lots);if(['date','interDate'].includes(scenario))assert.equal(f.sql.prepare('SELECT received_at FROM product_batches WHERE id=1').get().received_at,'2026-10-08');if(scenario==='owner')assert.equal(f.sql.prepare('SELECT variant_product_id FROM product_batches WHERE id=1').get().variant_product_id,2);return}
    if(scenario==='late'){assert.equal(result.status,503,JSON.stringify(result));assert.deepEqual(f.state(),before);assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),batches);assert.equal((await f.call('/inventory/sessions',body)).status,200)}
    else if(scenario==='unknown'){assert.equal(result.status,503,JSON.stringify(result));assert.equal(result.json.code,'unknown_outcome');assert.equal(denied,1)}else assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(f.state().physical,.3);assert.equal(f.state().cache,.3)
    assert.deepEqual(f.state().lots,[{batch_id:1,quantity:.2}])
    assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,1)
    assert.equal(f.sql.prepare('SELECT count(*) n FROM product_batches').get().n,1)
    assert.deepEqual(f.state().movements.slice(0,before.movements.length),before.movements)
    const movement=f.state().movements.at(-1);assert.equal(movement.quantity,.2);assert.equal(movement.batch_id,1);assert.equal(movement.unit_cost_usd,2);assert.equal(movement.total_cost_usd,.4)
    const saved=f.state();f.env.DB=raw;assert.equal((await f.call('/inventory/sessions',body)).status,200);assert.deepEqual(f.state(),saved)
    assert.ok(attempted<=(tier==='free'?50:1000));if(scenario==='tail'){assert.deepEqual([...failed].sort(),tier==='free'?['handoff','quota','versions']:['handoff','versions']);assert.equal(attempted,tier==='free'?50:48)}
  }finally{f.sql.close()}
}
async function main(){const w=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid'])for(const explicit of [false,true])for(const scenario of ['normal','inactive','null'])await absent(w,tier,explicit,scenario);for(const tier of ['free','paid'])for(const scenario of ['owner','date','interDate','active','membership','actor','late','ack','unknown','tail'])await absent(w,tier,false,scenario)}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={absent}
