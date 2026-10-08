const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..')
function fixture(lots = 1) {
  const original = path.join(__dirname, 'test-stock-session-atomic.cjs')
  let source = fs.readFileSync(original, 'utf8').replaceAll('\r\n', '\n')
  source = source.replace("name.endsWith('.sql')).sort()", "name.endsWith('.sql') && Number(name.slice(0,4))<243).sort()")
  source = source.replace("VALUES(1, 'Serum', 'SER-1', 2, 0, 0, 1)", "VALUES(1, 'Serum', 'SER-1', 2, 0, 100, 1)").replace('VALUES(1, 1, 0)', 'VALUES(1, 1, 100)')
  source = source.replace('  let failAfterMetadata = false', `
    sql.exec("INSERT INTO branches(id,name,is_default,is_active)VALUES(2,'Warehouse',0,1)")
    for(let id=1;id<=${lots};id++) {
      sql.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_quantity,received_cost_usd)VALUES(?,1,?,100,200)').run(id,'20260905-'+id)
      sql.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(?,1,?)').run(id,${lots === 1 ? 100 : 1})
    }
    sql.exec(fs.readFileSync(path.join(root,'migrations','0243_stock_schema_epoch.sql'),'utf8'))
    let failAfterMetadata = false`)
  source = source.replace('    let result\n    try { result = sqliteD1Call', `    if(sql.prepare(statement.text).reader) return {results:sqliteD1Call(sql.prepare(statement.text),'all',statement.params),meta:{changes:0}}
    let result
    try { result = sqliteD1Call`)
  const m = new Module(original, module); m.filename = original; m.paths = module.paths; m._compile(source, original)
  return m.exports.fixture()
}
async function bundleWorker() {
  const result = await build({stdin:{resolveDir:root,loader:'ts',contents:`import worker from './src/index.ts';export { ensureCoreDataInvariants } from './src/lib/coreDataInvariants.ts';export default worker;`},bundle:true,write:false,format:'cjs',platform:'node',target:'es2022',packages:'external',define:{__WORKER_BUILD_REVISION__:JSON.stringify('branch-budget-proof'),__WORKER_BUILD_HASH__:JSON.stringify('full-0243'),__WORKER_BUILT_AT__:JSON.stringify('2026-10-09T00:00:00Z')},plugins:[{name:'isolated-runtime',setup(b){
    b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker-runtime',namespace:'transport'}))
    b.onLoad({filter:/.*/,namespace:'transport'},()=>({contents:'export class DurableObject {}',loader:'js'}))
  }}]})
  return () => { const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);return m.exports }
}
async function world(makeWorker, tier, options = {}) {
  const f=fixture(options.lots || 1), worker=makeWorker()
  f.env.PLAN_TIER=tier;f.env.BUSINESS_OS_ADMIN_PASSWORD='synthetic-admin-password';f.env.PASSWORD_PEPPER='synthetic-native-pepper-at-least-32-characters'
  await worker.ensureCoreDataInvariants(f.env)
  f.sql.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 7,'admin','Admin','synthetic',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1")
  await worker.ensureCoreDataInvariants(f.env)
  const token='branch-auth-cookie', now=Date.now()
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at)VALUES(7,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),new Date(now-(options.staleAuth?48:1)*3600000).toISOString(),new Date(now+(options.staleAuth?1:48)*3600000).toISOString(),options.staleAuth?null:new Date(now).toISOString())
  f.sql.exec("INSERT OR REPLACE INTO settings(key,value)VALUES('telegram_chat_id','1001')")
  f.env.TELEGRAM_BOT_TOKEN='synthetic-token'
  f.env.BROADCAST_HUB={idFromName:name=>name,get:()=>({fetch:async()=>new Response('{}')})}
  f.env.CACHE={get:async()=>null,put:async()=>{if(options.cacheFailure)throw Error('synthetic KV unavailable')},delete:async()=>{}}
  let physical=0,metered=0,batches=0,stockBatches=0,preflightFailure=false;const raw=f.env.DB,sqls=[],failures=new Set()
  const hookKey=Symbol.for('business-os.request-metrics.v1'),hook=globalThis[hookKey]
  globalThis[hookKey]={...hook,d1Start(n){metered+=n;hook.d1Start(n)},rawD1Start(n){metered+=n;hook.rawD1Start(n)}}
  const maybeFail=sql=>{
    const kind=/SELECT namespace, version FROM cache_versions/.test(sql)?'version-read':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'version-write':/SELECT key, value FROM settings WHERE key IN/.test(sql)?'telegram-config':null
    if(options.tailRetries&&kind&&!failures.has(kind)){failures.add(kind);throw Error('D1_ERROR: internal error')}
    if(preflightFailure&&/SELECT id, name, barcode/.test(sql)){preflightFailure=false;throw Error('D1_ERROR: internal error')}
  }
  const wrap=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...xs)=>wrap(t.bind(...xs));if(['all','run','first'].includes(k))return(...xs)=>{physical++;sqls.push(t.text);maybeFail(t.text);return t[k](...xs)};return t[k]}})
  f.env.DB=new Proxy(raw,{get(t,k){if(k==='prepare')return sql=>wrap(t.prepare(sql));if(k==='batch')return ss=>{physical+=ss.length;batches++;if(ss.some(s=>s.text.includes("VALUES ('stock_transaction_permit'")))stockBatches++;sqls.push(...ss.map(s=>s.text));ss.forEach(s=>maybeFail(s.text));return t.batch(ss)};return t[k]}})
  const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
  const call=async(id,body={},bulk=false)=>{
    physical=0;metered=0;batches=0;stockBatches=0;sqls.length=0;failures.clear()
    const input={productId:1,fromBranchId:1,toBranchId:2,quantity:1,reason:'native full request',transfer_provenance_version:1,client_request_id:'native-'+createHash('sha256').update(id).digest('hex').slice(0,24),...body}
    if(bulk)input.items=[{productId:1,quantity:input.quantity}]
    const response=await worker.default.fetch(new Request('https://admin.business.test/api/branches/'+(bulk?'transfer-bulk':'transfer'),{method:'POST',headers:{cookie:'bos_session='+token,'content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(input)}),f.env,ctx)
    while(tasks.length)await Promise.all(tasks.splice(0))
    assert.equal(metered,physical,'real invocation hook must include every physical attempt, including raw maintenance and background tails')
    const result={tier,options,id,status:response.status,json:await response.json(),physical,batches,stockBatches}
    console.log(JSON.stringify(result));return result
  }
  return {...f,call,failPreflight(){preflightFailure=true},snapshot(){return JSON.stringify({products:f.sql.prepare('SELECT * FROM products').all(),stock:f.sql.prepare('SELECT * FROM branch_stock').all(),lots:f.sql.prepare('SELECT * FROM branch_batch_stock').all(),receipts:f.sql.prepare('SELECT * FROM transfer_operation_receipts').all(),history:f.sql.prepare('SELECT * FROM action_history').all(),audit:f.sql.prepare('SELECT * FROM audit_logs').all()})}}
}
const zero=f=>assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
async function main(){
  const savedFetch=globalThis.fetch
  globalThis.fetch=async url=>{assert.match(String(url),/^https:\/\/api\.telegram\.org\//);return new Response('{"ok":true}')}
  try{
    // Before this change the same real pipeline measured cold51 and lostACK64.
    // The assertions below fail against that implementation without needing
    // an unmerged historical commit object in a fresh clone.
    const current=await bundleWorker()
    for(const tier of ['free','paid']) {
      const f=await world(current,tier),cap=tier==='free'?50:1000
      f.loseNextCommitAcknowledgement()
      const coldLost=await f.call('cold-lost-'+tier)
      assert.equal(coldLost.status,200);assert.equal(coldLost.json.replayed,true);assert.equal(coldLost.stockBatches,1);assert.ok(coldLost.physical<=cap);zero(f)
      const before=f.snapshot(),replay=await f.call('cold-lost-'+tier)
      assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(replay.stockBatches,0);assert.equal(f.snapshot(),before)
    }
    for(const tier of ['free','paid']) for(const options of [{},{cacheFailure:true,tailRetries:true},{staleAuth:true}]){
      const f=await world(current,tier,options),cap=tier==='free'?50:1000
      const coldBefore=f.snapshot(),cold=await f.call('cold-'+tier+'-'+JSON.stringify(options));assert.ok(cold.physical<=cap)
      if(cold.status===409){assert.equal(cold.json.code,'transfer_query_budget_exceeded');assert.equal(cold.batches,0);assert.equal(f.snapshot(),coldBefore)}else{assert.equal(cold.status,200);assert.equal(cold.json.replayed,false)}
      const warm=await f.call((cold.status===409?'cold-':'warm-')+tier+'-'+JSON.stringify(options));assert.equal(warm.status,200);assert.equal(warm.json.replayed,false);assert.ok(warm.physical<=cap);assert.equal(warm.stockBatches,1);zero(f)
      f.loseNextCommitAcknowledgement()
      const lost=await f.call('lost-'+tier+'-'+JSON.stringify(options));assert.equal(lost.status,200);assert.equal(lost.json.replayed,true);assert.equal(lost.stockBatches,1);assert.ok(lost.physical<=cap);zero(f)
      const before=f.snapshot(),replay=await f.call('lost-'+tier+'-'+JSON.stringify(options));assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(replay.batches,0);assert.equal(f.snapshot(),before);assert.ok(replay.physical<=cap)
      const bulk=await f.call('bulk-'+tier+'-'+JSON.stringify(options),{},true);assert.equal(bulk.status,200);assert.ok(bulk.physical<=cap);zero(f)
      f.failPreflight();const failedBefore=f.snapshot(),failed=await f.call('preflight-transient-'+tier);assert.equal(failed.status,500);assert.equal(failed.batches,0);assert.equal(f.snapshot(),failedBefore);assert.ok(failed.physical<=cap)
    }
    for(const tier of ['free','paid']){
      const f=await world(current,tier,{lots:60}),before=f.snapshot(),large=await f.call('large-'+tier,{quantity:60},true)
      if(tier==='free'){assert.equal(large.status,409);assert.equal(large.json.code,'transfer_query_budget_exceeded');assert.equal(large.batches,0);assert.equal(f.snapshot(),before);assert.ok(large.physical<=50)}
      else{assert.equal(large.status,200);assert.equal(large.stockBatches,1);assert.ok(large.physical<=1000)}
      zero(f)
    }
    console.log('branch transfer actual index/auth/core/maintenance request budget full0243 native: PASS')
  }finally{globalThis.fetch=savedFetch}
}
main().catch(error=>{console.error(error);process.exitCode=1})

