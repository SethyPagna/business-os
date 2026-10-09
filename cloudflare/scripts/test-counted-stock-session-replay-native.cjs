const assert=require('node:assert/strict')
const h=require('./test-counted-quantity-exact-native.cjs')

async function exercise(w,tier,receipt,quantity=.2,scenario='normal'){
  const f=await h.world(w,tier,'zero',sql=>{h.seed(.1,receipt)(sql);if(scenario==='otherBranch')sql.exec("INSERT INTO branches(id,name,is_active)VALUES(2,'Other branch',1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,.2);UPDATE products SET stock_quantity=.3 WHERE id=1")})
  try{
    const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
    if(scenario==='tag')await stock.executeStockTransaction(db,[{sql:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,1,"+(receipt?'1':'NULL')+",.05,.05,'opened','adjust')",params:{}}],'once')
    const body={client_request_id:'session-replay-'+scenario,mode:'stock_in',items:[{line_id:'one',kind:'receive',product_id:1,branch_id:1,quantity,received_date:'2026-10-09',unit_cost_usd:2,...(receipt?{batch_id:1}:{supplier_name:'Session supplier'})}]}
    const initial=f.state(),received=await f.call('/inventory/sessions',body)
    assert.equal(received.status,200,JSON.stringify(received))
    if(scenario==='later'){const later=await f.call('/inventory/sessions',{...body,client_request_id:'session-later-delivery',items:[{...body.items[0],quantity:.1}]});assert.equal(later.status,200,JSON.stringify(later));assert.equal(f.state().physical,.4)}
    const original=f.state(),snapshot=f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations)').get().payload_json
    const rivals={actor:'UPDATE users SET is_active=0 WHERE id=7',role:"UPDATE roles SET permissions='{}' WHERE code='admin'",product:'UPDATE products SET is_active=0 WHERE id=1',stock:'UPDATE branch_stock SET quantity=.15 WHERE product_id=1 AND branch_id=1',member:"INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(99,1,'replay-zero',1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(99,1,0)",tagMember:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(99,1,1,NULL,0,0,'opened','adjust')",identity:"UPDATE inventory_movements SET reason='Rival source edit' WHERE id=(SELECT movement_id FROM stock_session_members LIMIT 1)"}
    if(rivals[scenario])f.competeBeforeCommit(rivals[scenario].split(';').map(sql=>({sql})))
    if(scenario==='late')f.failWhenSqlMatches(/UPDATE stock_session_operations SET generation=/)
    if(scenario==='lookalike')f.sql.exec('CREATE TEMP TABLE replay_unrelated(guard_value_unrelated INTEGER CHECK(guard_value_unrelated=1));CREATE TEMP TRIGGER replay_late BEFORE UPDATE OF generation ON stock_session_operations BEGIN INSERT INTO replay_unrelated VALUES(0);END')
    if(['ack','unknown'].includes(scenario))f.loseNextCommitAcknowledgement()
    if(scenario==='tagBlocked')await stock.executeStockTransaction(db,[{sql:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,1,1,.2,.2,'opened','adjust')",params:{}}],'once')
    let attempted=0,denied=0;const raw=f.env.DB,failed=new Set()
    if(['tail','unknown'].includes(scenario)){
      const committed=()=>f.sql.prepare('SELECT generation FROM stock_session_operations').get().generation===1
      const reject=sql=>{if(!committed())return false;if(scenario==='unknown'&&/SELECT o.generation,h.status FROM stock_session_operations/.test(sql)){denied++;return true}if(scenario!=='tail')return false;const key=/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null;if(!key||failed.has(key))return false;failed.add(key);return true}
      const wrap=(s,sql)=>new Proxy(s,{get(t,k){if(k==='bind')return(...args)=>wrap(t.bind(...args),sql);if(['first','all','run'].includes(k))return(...args)=>{attempted++;if(reject(sql))return Promise.reject(Error('D1_ERROR: unknown native replay network'));return t[k](...args)};return t[k]}})
      f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql),sql);if(k==='batch')return ss=>{attempted+=ss.length;if(ss.some(s=>reject(s.text)))return Promise.reject(Error('D1_ERROR: unknown native replay batch network'));return t.batch(ss)};return t[k]}})
      f.env.CACHE={get:async()=>null,put:async()=>{throw Error('native replay KV fail')},delete:async()=>{}}
      f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
    }
    const undoBody={expected_generation:0,require_applied:true},url='/action-history/'+received.json.actionHistoryId
    const undo=await f.call(url+'/undo',undoBody)
    console.log('REPLAY '+JSON.stringify({tier,receipt,quantity,scenario,status:undo.status,code:undo.json.code,attempted,denied,failed:[...failed]}))
    if(rivals[scenario]||scenario==='tagBlocked'){assert.equal(undo.status,409,JSON.stringify(undo));assert.equal(f.sql.prepare('SELECT generation FROM stock_session_operations').get().generation,0);assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations)').get().payload_json,snapshot);assert.equal(f.state().movements.length,original.movements.length);return}
    if(['late','lookalike'].includes(scenario)){assert.equal(undo.status,503,JSON.stringify(undo));assert.equal(undo.json.success,false);assert.match(undo.json.error,/could not be confirmed/);assert.deepEqual(f.state(),original);if(scenario==='lookalike')f.sql.exec('DROP TRIGGER replay_late');assert.equal((await f.call(url+'/undo',undoBody)).status,200)}else if(scenario==='unknown'){assert.equal(undo.status,503,JSON.stringify(undo));assert.equal(denied,1)}else assert.equal(undo.status,200,JSON.stringify(undo))
    f.env.DB=raw
    assert.equal(f.state().physical,scenario==='later'?.2:.1,'exact recorded delta must not discard tiny quantities');assert.equal(f.state().cache,scenario==='later'?.2:initial.cache)
    const undone=f.state();assert.equal((await f.call(url+'/undo',undoBody)).status,200);assert.deepEqual(f.state(),undone)
    const redo=await f.call(url+'/redo',{expected_generation:1,require_applied:true});assert.equal(redo.status,200,JSON.stringify(redo));assert.equal(f.state().physical,original.physical);assert.equal(f.state().cache,original.cache)
    assert.deepEqual(f.state().movements.slice(0,original.movements.length),original.movements)
    const compensation=f.state().movements.slice(original.movements.length)
    assert.equal(compensation.length,2);assert.equal(compensation[0].quantity,-quantity);assert.equal(compensation[1].quantity,quantity)
    const source=original.movements.find(row=>row.id===received.json.items[0].movementId)
    for(const row of compensation){assert.equal(row.unit_cost_usd,source.unit_cost_usd);assert.equal(row.unit_cost_khr,source.unit_cost_khr);assert.equal(row.batch_id,source.batch_id);assert.equal(row.user_id,7);assert.equal(row.total_cost_usd,source.total_cost_usd===null?null:source.total_cost_usd===0?0:source.total_cost_usd*(row.quantity<0?-1:1))}
    assert.deepEqual(initial.tags,f.state().tags)
    const replayed=JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations ORDER BY rowid LIMIT 1)').get().payload_json),saved=JSON.parse(snapshot)
    for(const key of ['request','before','after'])assert.deepEqual(replayed[key],saved[key])
    if(scenario==='otherBranch')assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity,.2)
    assert.ok(attempted<=(tier==='free'?50:1000));if(scenario==='tail')assert.deepEqual([...failed].sort(),tier==='free'?['handoff','quota','versions']:['handoff','versions'])
  }finally{f.sql.close()}
}
async function multiple(w,tier){
  const f=await h.world(w,tier,'zero',sql=>{h.seed(.1,true)(sql);sql.exec("INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Other product',.2,1);INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,.2);INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(2,2,'other-receipt','2026-09-01',2,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,1,.2)")})
  try{
    const body={client_request_id:'session-replay-multiple',mode:'stock_in',items:[{line_id:'one',kind:'receive',product_id:1,branch_id:1,batch_id:1,quantity:.2,received_date:'2026-10-09',unit_cost_usd:2},{line_id:'two',kind:'receive',product_id:2,branch_id:1,batch_id:2,quantity:.1,received_date:'2026-10-09',unit_cost_usd:2}]}
    const before=f.state(),result=await f.call('/inventory/sessions',body)
    if(tier==='free'){assert.equal(result.status,409);assert.equal(result.json.code,'stock_session_query_budget_exceeded');assert.deepEqual(f.state(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_session_operations').get().n,0);return}
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.totalQuantity,.3)
    const balances=()=>f.sql.prepare('SELECT product_id,quantity FROM branch_stock ORDER BY product_id').all()
    assert.deepEqual(balances(),[{product_id:1,quantity:.3},{product_id:2,quantity:.3}])
    const url='/action-history/'+result.json.actionHistoryId
    assert.equal((await f.call(url+'/undo',{expected_generation:0,require_applied:true})).status,200);assert.deepEqual(balances(),[{product_id:1,quantity:.1},{product_id:2,quantity:.2}])
    assert.equal((await f.call(url+'/redo',{expected_generation:1,require_applied:true})).status,200);assert.deepEqual(balances(),[{product_id:1,quantity:.3},{product_id:2,quantity:.3}])
    assert.deepEqual(f.sql.prepare('SELECT id,stock_quantity FROM products ORDER BY id').all(),[{id:1,stock_quantity:.3},{id:2,stock_quantity:.3}]);assert.equal(f.state().movements.length,6)
  }finally{f.sql.close()}
}
async function main(){const w=await h.bundle.exports.bundleWorker();for(const tier of ['free','paid'])for(const receipt of [true,false])for(const quantity of [.2,1e-10])await exercise(w,tier,receipt,quantity);for(const tier of ['free','paid'])for(const scenario of ['actor','role','product','stock','member','tagMember','identity','late','lookalike','ack','unknown','tail','tag','tagBlocked','otherBranch','later'])await exercise(w,tier,true,.2,scenario);for(const tier of ['free','paid']){await exercise(w,tier,false,.2,'tag');await multiple(w,tier)}}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={exercise,multiple}
