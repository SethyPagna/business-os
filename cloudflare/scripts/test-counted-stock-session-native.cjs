const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')

async function exercise(w,tier,receipt,observe=false){
  const f=await h.world(w,tier,'zero',sql=>h.seed(.1,receipt)(sql))
  try{
    const request={client_request_id:'exact-session-'+(receipt?'receipt':'NULL'),mode:'stock_in',items:[{
      line_id:'line-1',kind:'receive',product_id:1,branch_id:1,quantity:.2,received_date:'2026-10-09',unit_cost_usd:2,
      ...(receipt?{batch_id:1}:{supplier_name:'Session supplier'})}]}
    const before=f.state(),received=await f.call('/inventory/sessions',request)
    const after=f.state(),details={tier,receipt,received,after}
    if(received.status===200){
      details.undo=await f.call('/action-history/'+received.json.actionHistoryId+'/undo',{expected_generation:0,require_applied:true})
      details.undone=f.state()
      details.redo=await f.call('/action-history/'+received.json.actionHistoryId+'/redo',{expected_generation:1,require_applied:true})
      details.redone=f.state()
    }
    console.log('SESSION '+JSON.stringify(details))
    if(observe)return details
    assert.equal(received.status,200,JSON.stringify(received))
    assert.equal(after.physical,.3,'existing0.1+receive0.2 must be exact')
    assert.equal(after.cache,.3)
    assert.equal(details.undo.status,200,JSON.stringify(details.undo));assert.equal(details.undone.physical,.1);assert.equal(details.undone.cache,.1)
    assert.equal(details.redo.status,200,JSON.stringify(details.redo));assert.equal(details.redone.physical,.3);assert.equal(details.redone.cache,.3)
    assert.deepEqual(after.movements.slice(0,before.movements.length),before.movements)
  }finally{f.sql.close()}
}
async function forward(w,tier,receipt,scenario='normal'){
  const f=await h.world(w,tier,'zero',sql=>{h.seed(.1,receipt)(sql);if(['owner','over'].includes(scenario))sql.exec("INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Other',0,1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,0)")})
  try{
    if(scenario==='tag')await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,1,NULL,.05,.05,'opened','adjust')",params:{}}],'once')
    const body={client_request_id:'session-forward-'+scenario,mode:'stock_in',items:[{line_id:'one',kind:'receive',product_id:1,branch_id:1,quantity:.2,received_date:'2026-10-09',unit_cost_usd:2,...(receipt?{batch_id:1}:{supplier_name:'Session supplier'})}]}
    if(scenario==='interDate'){delete body.items[0].batch_id;body.items[0].received_date='2026-09-01';body.items[0].supplier_name='Session supplier'}
    if(scenario==='over')body.items.push({...body.items[0],line_id:'two',product_id:2,batch_id:undefined,supplier_name:'Session supplier'})
    const before=f.state(),purchases=f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),raw=f.env.DB
    if(scenario==='interDate'){
      let raced=false
      const concurrent=h.loadStockSession('lib/db.ts').getDb({DB:raw})
      f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>{
        const wrap=s=>new Proxy(s,{get(p,key){if(key==='bind')return(...args)=>wrap(p.bind(...args));if(key==='all')return async(...args)=>{const result=await p.all(...args);if(!raced&&sql.includes("SELECT 'counted'")){raced=true;await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(concurrent,[{sql:"UPDATE product_batches SET received_at='2026-10-08' WHERE id=1",params:{}}],'once')}return result};return p[key]}})
        return wrap(t.prepare(sql))};return t[k]}})
    }
    const rivals={actor:'UPDATE users SET is_active=0 WHERE id=7',role:"UPDATE roles SET permissions='{}' WHERE code='admin'",stock:'UPDATE branch_stock SET quantity=.15 WHERE product_id=1 AND branch_id=1',owner:'UPDATE product_batches SET variant_product_id=2 WHERE id=1',date:"UPDATE product_batches SET received_at='2026-10-08' WHERE id=1",member:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(99,1,'zero-rival',1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(99,1,0)",tagMember:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(99,1,1,NULL,0,0,'opened','adjust')"}
    if(rivals[scenario])f.competeBeforeCommit(rivals[scenario].split(';').map(sql=>({sql})))
    if(scenario==='late')f.failWhenSqlMatches(/SET receipt_json=json_object/)
    if(scenario==='lookalike')f.sql.exec('CREATE TEMP TABLE session_unrelated(guard_value_unrelated INTEGER CHECK(guard_value_unrelated=1));CREATE TEMP TRIGGER session_late BEFORE UPDATE OF receipt_json ON stock_session_operations BEGIN INSERT INTO session_unrelated VALUES(0);END')
    if(['ack','unknown'].includes(scenario))f.loseNextCommitAcknowledgement()
    let attempted=0,denied=0;const failed=new Set()
    if(['tail','unknown'].includes(scenario)){
      const committed=()=>f.sql.prepare('SELECT count(*) n FROM stock_session_operations WHERE receipt_json IS NOT NULL').get().n>0
      const reject=sql=>{if(!committed())return false;if(scenario==='unknown'&&/SELECT request_json,receipt_json FROM stock_session_operations/.test(sql)){denied++;return true}if(scenario!=='tail')return false;const key=/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null;if(!key||failed.has(key))return false;failed.add(key);return true}
      const wrap=(s,sql)=>new Proxy(s,{get(t,k){if(k==='bind')return(...args)=>wrap(t.bind(...args),sql);if(['first','all','run'].includes(k))return(...args)=>{attempted++;if(reject(sql))return Promise.reject(Error('D1_ERROR: unknown native session network'));return t[k](...args)};return t[k]}})
      f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql),sql);if(k==='batch')return ss=>{attempted+=ss.length;if(ss.some(s=>reject(s.text)))return Promise.reject(Error('D1_ERROR: unknown native session batch network'));return t.batch(ss)};return t[k]}})
      f.env.CACHE={get:async()=>null,put:async()=>{throw Error('native session KV fail')},delete:async()=>{}}
      f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
    }
    const result=await f.call('/inventory/sessions',body)
    console.log('FORWARD '+JSON.stringify({tier,receipt,scenario,status:result.status,code:result.json.code,attempted,denied,failed:[...failed]}))
    if(scenario==='interDate'){assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'stale_state');assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);assert.equal(f.sql.prepare('SELECT received_at FROM product_batches WHERE id=1').get().received_at,'2026-10-08');return}
    if(scenario==='over'){assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.json.code,'stock_session_query_budget_exceeded');assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),purchases);return}
    if(rivals[scenario]){assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(f.state().movements,before.movements);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);return}
    if(['late','lookalike'].includes(scenario)){assert.equal(result.status,503,JSON.stringify(result));assert.equal(result.json.code,'unknown_outcome');assert.deepEqual(f.state(),before);assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),purchases);if(scenario==='lookalike')f.sql.exec('DROP TRIGGER session_late');assert.equal((await f.call('/inventory/sessions',body)).status,200)}
    else if(scenario==='unknown'){assert.equal(result.status,503,JSON.stringify(result));assert.equal(denied,1)}else assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(f.state().physical,.3);assert.equal(f.state().cache,.3)
    if(scenario==='tag')assert.deepEqual(f.state().tags,before.tags)
    const saved=f.state();f.env.DB=raw;assert.equal((await f.call('/inventory/sessions',body)).status,200);assert.deepEqual(f.state(),saved)
    assert.ok(attempted<=(tier==='free'?50:1000));console.log('PASS forward exact session '+scenario+' '+tier)
  }finally{f.sql.close()}
}
async function main(){const w=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid'])for(const receipt of [true,false])await exercise(w,tier,receipt);for(const tier of ['free','paid'])for(const scenario of ['actor','role','stock','owner','date','interDate','member','tagMember','late','lookalike','ack','unknown','tail','tag'])await forward(w,tier,!['tag'].includes(scenario),scenario);await forward(w,'free',true,'over')}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
module.exports={exercise,forward}
