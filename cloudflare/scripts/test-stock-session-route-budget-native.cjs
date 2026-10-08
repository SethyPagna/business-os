const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, receiveRequest, seedDistinctProducts } = require('./test-stock-session-atomic.cjs')
const sourceRoot = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(relative) {
  if (modules.has(relative)) return modules.get(relative).exports
  const mod={exports:{}};modules.set(relative,mod)
  const file=path.join(sourceRoot,relative)
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText
  new Function('require','module','exports',code)(name=>{
    if(!name.startsWith('.')) { if(name==='cloudflare:workers') return {DurableObject:class{}};return require(name) }
    const target=path.relative(sourceRoot,path.resolve(path.dirname(file),name+'.ts')).replaceAll('\\','/')
    return load(target)
  },mod,mod.exports)
  return mod.exports
}
const metrics=load('lib/requestMetrics.ts'),core=load('lib/coreDataInvariants.ts'),maintenance=load('lib/maintenance.ts')
const inventory=load('routes/inventory.ts').default,history=load('routes/actionHistory.ts').default
async function world(options={}) {
  const f=fixture();f.env.PLAN_TIER=options.tier||'free';load('lib/planTier.ts').__resetPlanTierCacheForTests()
  await core.ensureCoreDataInvariants(f.env)
  f.sql.exec(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 7,'admin','Admin','fixture',id,'{"all":true}',1 FROM roles WHERE code='admin' LIMIT 1`)
  await core.ensureCoreDataInvariants(f.env)
  const token='route-budget-cookie', now=Date.now()
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(7,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),new Date(now-3600000).toISOString(),new Date(now+48*3600000).toISOString(),new Date(now).toISOString())
  f.env.BROADCAST_HUB={idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}
  f.env.CACHE={get:async()=>null,put:async()=>{if(options.cacheFailure)throw new Error('KV unavailable')},delete:async()=>{}}
  if(options.cacheFailure)f.sql.prepare('INSERT INTO quota_usage(resource,window_key,used,updated_at) VALUES(?,?,950,CURRENT_TIMESTAMP)').run('kv_write',new Date().toISOString().slice(0,10))
  let physical=0,batches=0,acc,extraReads=0
  const failures=new Set(), sqls=[]
  const raw=f.env.DB
  const maybeFail=sql=>{const kind=/SELECT namespace, version FROM cache_versions/.test(sql)?'version-read':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'version-write':null;if(options.tailRetries&&kind&&!failures.has(kind)){failures.add(kind);throw new Error('D1_ERROR: internal error') }}
  const statement=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...params)=>statement(t.bind(...params));if(['all','run','first'].includes(k))return(...params)=>{physical++;sqls.push(t.text);maybeFail(t.text);return t[k](...params)};return t[k]}})
  f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>statement(t.prepare(sql));if(k==='batch')return ss=>{assert.ok(ss.every(s=>s.params.length<=100),'packed statements remain below D1 bind limit');physical+=ss.length;batches++;sqls.push(...ss.map(s=>s.text));ss.forEach(s=>maybeFail(s.text));return t.batch(ss)};return t[k]}})
  const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
  const app=new Hono()
  app.use('/api/*',metrics.requestMetricsMiddleware)
  app.use('/api/*',async(c,next)=>{acc=c.get('requestMetrics');await core.ensureCoreDataInvariantsForBuild(c.env,{buildKey:'session-route-proof',reverifyAfterMs:3600000});assert.equal(await maintenance.getMaintenance(c.env),null);for(let i=0;i<extraReads;i++)await load('lib/db.ts').getDb(c.env).prepare('SELECT 1').get();await next()})
  app.route('/api/inventory',inventory);app.route('/api/action-history',history)
  const call=async(url,body,additionalReads=0)=>{
    extraReads=additionalReads
    physical=0;batches=0;sqls.length=0;failures.clear()
    const response=await app.request(url,{method:'POST',headers:{cookie:'bos_session='+token,'content-type':'application/json'},body:JSON.stringify(body)},f.env,ctx)
    await Promise.all(tasks.splice(0))
    assert.equal(acc.attemptedStatements+1,physical,'raw maintenance consumes one physical statement outside D1Compat metrics')
    return {status:response.status,json:await response.json(),physical,batches,sqls:[...sqls]}
  }
  return {...f,call}
}
;(async()=>{
  for(const options of [{},{cacheFailure:true,tailRetries:true}]){
    const f=await world(options)
    const request=receiveRequest('real-route-'+(options.cacheFailure?'failure':'normal'))
    const result=await f.call('/api/inventory/sessions',request)
    console.log(JSON.stringify({create:options,status:result.status,physical:result.physical,batches:result.batches}))
    assert.equal(result.status,200,'ordinary Free stock adjustment remains usable on actual cold route')
    assert.ok(result.physical<=50)
    assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5)
    const replay=await f.call('/api/inventory/sessions',request,45)
    assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(replay.batches,0);assert.equal(replay.physical,50,'saved receipt resolves before new budget admission at actual50 statements')
    const fresh=await f.call('/api/inventory/sessions',{...request,client_request_id:request.client_request_id+'-fresh'},45)
    assert.equal(fresh.status,409);assert.equal(fresh.json.code,'stock_session_query_budget_exceeded');assert.ok(fresh.physical<=50);assert.equal(fresh.batches,0)
    const refusedUndo=await f.call('/api/action-history/'+result.json.actionHistoryId+'/undo',{require_applied:true,expected_generation:0},20)
    assert.equal(refusedUndo.status,409);assert.equal(refusedUndo.json.code,'stock_session_query_budget_exceeded');assert.equal(refusedUndo.batches,0);assert.ok(refusedUndo.physical<=50)
    assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5);assert.equal(f.sql.prepare('SELECT generation n FROM stock_session_operations').get().n,0)
    const undo=await f.call('/api/action-history/'+result.json.actionHistoryId+'/undo',{require_applied:true,expected_generation:0})
    console.log(JSON.stringify({undo:options,status:undo.status,physical:undo.physical,batches:undo.batches}))
    assert.equal(undo.status,200);assert.ok(undo.physical<=50);assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,0)
    const repeat=await f.call('/api/action-history/'+result.json.actionHistoryId+'/undo',{require_applied:true,expected_generation:0})
    assert.equal(repeat.status,200);assert.ok(repeat.physical<=50)
    const refusedRedo=await f.call('/api/action-history/'+result.json.actionHistoryId+'/redo',{require_applied:true,expected_generation:1},20)
    assert.equal(refusedRedo.status,409);assert.equal(refusedRedo.json.code,'stock_session_query_budget_exceeded');assert.equal(refusedRedo.batches,0);assert.ok(refusedRedo.physical<=50)
    assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,0);assert.equal(f.sql.prepare('SELECT generation n FROM stock_session_operations').get().n,1)
    const redo=await f.call('/api/action-history/'+result.json.actionHistoryId+'/redo',{require_applied:true,expected_generation:1})
    assert.equal(redo.status,200);assert.ok(redo.physical<=50);assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5)
    f.sql.close()
  }
  const large=await world();seedDistinctProducts(large,2)
  const body=receiveRequest('real-route-too-large');body.items.push({...body.items[0],line_id:'second',product_id:2})
  const refused=await large.call('/api/inventory/sessions',body)
  assert.equal(refused.status,409);assert.equal(refused.json.code,'stock_session_query_budget_exceeded');assert.equal(refused.batches,0)
  assert.equal(large.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,0)
  large.sql.close()
  const paid=await world({tier:'paid'});seedDistinctProducts(paid,25)
  const paidBody=receiveRequest('paid-real-route-25');paidBody.items=Array.from({length:25},(_,i)=>({...paidBody.items[0],line_id:'paid-'+i,product_id:i+1,received_date:'2026-09-'+String(i+1).padStart(2,'0')}))
  const paidResult=await paid.call('/api/inventory/sessions',paidBody)
  assert.equal(paidResult.status,200);assert.ok(paidResult.physical<=1000);assert.equal(paidResult.batches,1)
  console.log(JSON.stringify({paid25Physical:paidResult.physical}))
  const existingLots={...paidBody,client_request_id:'paid-real-route-25-existing-lots',items:paidBody.items.map(item=>({...item,batch_id:paidResult.json.items.find(row=>row.lineId===item.line_id).batchId}))}
  const dated=await paid.call('/api/inventory/sessions',existingLots)
  assert.equal(dated.status,200);assert.equal(dated.batches,1);assert.ok(dated.physical<=1000)
  assert.equal(paid.sql.prepare('SELECT COUNT(*) n FROM product_batches').get().n,25,'explicit25existingdatedlots are retained')
  assert.equal(paid.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,250)
  console.log(JSON.stringify({paid25ExistingDatedLotsPhysical:dated.physical}))
  paid.env.PLAN_TIER='free';load('lib/planTier.ts').__resetPlanTierCacheForTests()
  const paidUndo=await paid.call('/api/action-history/'+paidResult.json.actionHistoryId+'/undo',{require_applied:true,expected_generation:0})
  assert.equal(paidUndo.status,409);assert.equal(paidUndo.json.code,'stock_session_query_budget_exceeded');assert.equal(paidUndo.batches,0);assert.equal(paid.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,250)
  assert.equal(paid.sql.prepare('SELECT generation n FROM stock_session_operations').get().n,0)
  paid.sql.close()
  console.log('PASS actual inventory/history routes + auth/core/maintenance/metrics/cache/quota physical budgets and saved replay')
})().catch(error=>{console.error(error);process.exitCode=1})
