'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto')
const {execFileSync}=require('node:child_process')
const options=Object.fromEntries(process.argv.slice(2).map(value=>{const m=/^--([a-z-]+)=(.*)$/.exec(value);assert.ok(m,'Use --name=value');return[m[1],m[2]]}))
const root=path.resolve(options.root||path.join(__dirname,'..'))
// The old route is the one at the slice base: /stats reads the full snapshot through readSalesReportSnapshot.
const BASE='cbff55c8e4a9fffe722f2be30618f7dbe64ee623'
const candidate=path.resolve(options.candidate||path.join(root,'src/routes/sales.ts'))
const local=Module.createRequire(path.join(root,'package.json'))
const {seedStockFixture}=local('./scripts/harness/seed-stock-fixture.cjs')
const lf=text=>text.replace(/\r\n/g,'\n'),sha=text=>crypto.createHash('sha256').update(text).digest('hex')
const baseline=lf(execFileSync('git',['show',BASE+':cloudflare/src/routes/sales.ts'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}}))
assert.equal(sha(baseline),'d79a544a051cd70738a10a5b1bfdc3096ba50feb8db7aa99b7a3b680305c3ee3','Pinned full-reader route source')
const candidateSource=lf(fs.readFileSync(candidate,'utf8'))
if(options.candidate)assert.equal(sha(candidateSource),'d9dc349a67f241c807918abe6b5dd4ac28e2ef68022fb39bd76ab80f6dd977c8','Frozen private candidate overlay')
const once=(text,before,after)=>{assert.equal(text.split(before).length,2,'Unique existing fixture seam: '+before.slice(0,70));return text.replace(before,()=>after)}
const FIELDS=['total_count','revenue_count','revenue_usd','pending_revenue_usd','revenue_without_not_paid_usd','not_paid_owed_usd','truncated_in_list'].sort()
const ADMIN={id:71,username:'stats-admin',role_code:'admin',permissions:'{"all":true}'}
const VIEW={id:72,username:'stats-view',role_code:'employee',permissions:'{"sales":"view","sales:view_courier_cost":false}'}
const state=()=>({enabled:false,version:0,versionReads:0,reads:0,writes:0,values:new Map()})
let active=null
const previous=globalThis.__stats1022
globalThis.__stats1022={
  version(){if(!active)return '0';active.cache.versionReads++;return String(active.cache.version)},
  async cache(request,version,producer){
    if(!active)return producer()
    const c=active.cache,key=request.url+'|'+version;c.reads++
    if(c.enabled&&c.values.has(key))return c.values.get(key)
    const result=await producer()
    if(c.enabled){c.values.set(key,result);c.writes++}
    return result
  },
  semantic(kind,value,lib){
    if(!active)return
    if(kind==='snapshot'){active.semantic.fullReads++;active.semantic.counts={sale_count:value.sales.length,cancelled_count:value.voidSales.length,precision_mode:value.precision_mode,row_count:value.row_count}}
    else if(kind==='reduced'){active.semantic.totalsReads++;active.semantic.counts={sale_count:value.sale_count,cancelled_count:value.cancelled_count,precision_mode:value.precision_mode,row_count:value.row_count};active.semantic.diagnostic=lib.reportMoneyDiagnostic(value.totals)}
    else if(kind==='header'){active.semantic.totalsReads++;active.semantic.counts={sale_count:value.sale_count,cancelled_count:value.cancelled_count}}
    else active.semantic.diagnostic=lib.reportMoneyDiagnostic(value)
  },
}
function harness(routeSource){
  // J7 (6.0.1850): lib/receiptNumber.ts's uniqueBusinessDateTimeNumber now takes readTaken(candidates) -> the taken ones. The frozen full-reader
  // baseline (sha-pinned above, untouched) still passes its one-candidate probe, which would receive the candidate ARRAY and bind it as one SQL value.
  // Adapt only the baseline's two call sites, keeping its own semantics: probe in order, stop at the first free candidate. The candidate source
  // already passes the batched reader, so this is a no-op for it.
  routeSource=routeSource.replaceAll("uniqueBusinessDateTimeNumber('', receiptNumberTaken)","uniqueBusinessDateTimeNumber('', async (candidates) => { const held = []; for (const candidate of candidates) { if (!(await receiptNumberTaken(candidate))) break; held.push(candidate) } return held })")
  const file=path.join(root,'scripts/test-sale-create-atomic-pure.cjs'),text=fs.readFileSync(file,'utf8'),boundary=';(async () => {'
  assert.equal(text.split(boundary).length,2,'Existing full-migration Hono prefix')
  let prefix=text.slice(0,text.indexOf(boundary))
  prefix=once(prefix,'const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")
  prefix=once(prefix,'getVersionWithFallback: async () => 0,','getVersionWithFallback: async () => globalThis.__stats1022.version(),')
  prefix=once(prefix,'cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),','cachedJsonResponse: async (request, _context, version, _ttl, loader) => globalThis.__stats1022.cache(request,version,loader),')
  prefix=once(prefix,"requireAuth: async (c, next) => { c.set('user', currentUser); return next() }","requireAuth: async (c, next) => { if(!currentUser)return c.json({error:'Unauthenticated'},401);c.set('user',currentUser);return next() }")
  prefix=once(prefix,"const app = load('routes/sales.ts').default",`const analytics=load('lib/salesAnalytics.ts')
overrides['../lib/salesAnalytics']={...analytics,
 readSalesReportSnapshot:async(...args)=>{const value=await analytics.readSalesReportSnapshot(...args);globalThis.__stats1022.semantic('snapshot',value,analytics);return value},
 readSalesReportTotals:async(...args)=>{const value=await analytics.readSalesReportTotals(...args);globalThis.__stats1022.semantic('reduced',value,analytics);return value},
 readSalesHeaderTotals:async(...args)=>{const value=await analytics.readSalesHeaderTotals(...args);globalThis.__stats1022.semantic('header',value,analytics);return value},
 salesTotalsFromSnapshot:(...args)=>{const value=analytics.salesTotalsFromSnapshot(...args);globalThis.__stats1022.semantic('totals',value,analytics);return value}}
const app = load('routes/sales.ts').default`)
  const proxyFs={...fs,readFileSync(filename,encoding){
    const relative=path.relative(root,String(filename)).replaceAll('\\','/')
    if(relative==='src/routes/sales.ts')return encoding?routeSource:Buffer.from(routeSource)
    return fs.readFileSync(filename,encoding)
  }}
  const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file))
  const originalRequire=mod.require.bind(mod);mod.require=id=>id==='node:fs'?proxyFs:originalRequire(id)
  mod._compile(prefix+'\nmodule.exports={fixture,request,postSale,app,executionCtx,load,overrides,setUser(user){currentUser=user}};',file)
  const h=mod.exports,money=h.load('lib/reportMoneyPrecision.ts')
  h.app.onError((error,c)=>{if(error instanceof money.ReportMoneyPrecisionError){const mapped=money.reportMoneyHttpError(error);return c.json({success:false,error:mapped.message,code:error.code},mapped.status)}return c.json({success:false,error:String(error.message)},500)})
  Object.assign(h.overrides['../lib/telegram'],{sendReturnTelegramEvent:async()=>{},sendReturnStatusTelegramEvents:async()=>{}})
  h.overrides['../lib/cache'].bumpVersions=async()=>{}
  h.overrides['./cache']=h.overrides['../lib/cache'];h.overrides['./telegram']=h.overrides['../lib/telegram']
  return h
}
function kind(sql){
  if(/FROM sale_items si\b/.test(sql))return 'items'
  if(/FROM return_items ri\b/.test(sql))return 'returnItems'
  if(/FROM returns r\b/.test(sql))return 'returns'
  if(/FROM sales s WHERE/.test(sql))return /s\.subtotal_usd/.test(sql)?'sales':'voidSales'
  return 'other'
}
function fixtureParams(params={}){
  const value=item=>item instanceof ArrayBuffer?Buffer.from(item):ArrayBuffer.isView(item)?Buffer.from(item.buffer,item.byteOffset,item.byteLength):item
  return Array.isArray(params)?params.map(value):Object.fromEntries(Object.entries(params).map(([key,item])=>[key,value(item)]))
}
function meter(db,raw,config={}){
  const log={operations:0,statementAttempts:0,batchCalls:0,atomicBatches:0,prepares:0,resultUtf8Proxy:0,dataImage:null,groups:{sales:[],voidSales:[],items:[],returns:[],returnItems:[]}}
  function record(group,rows){
    const result=config.map?config.map(group,rows):rows
    log.resultUtf8Proxy+=Buffer.byteLength(JSON.stringify(result??null),'utf8')
    if(log.groups[group])log.groups[group].push(...result)
    return result
  }
  const read=async(sql,stmt,method,params)=>{
    log.operations++;log.statementAttempts++
    const result=await stmt[method](fixtureParams(params)),group=kind(sql),rows=method==='get'?(result?[result]:[]):result
    const actual=record(group,rows)
    config.after?.({sql,group,rows:actual})
    return method==='get'?actual[0]:actual
  }
  const api={
    prepare(sql){log.prepares++;const stmt=db.prepare(sql);return {all:params=>read(sql,stmt,'all',params),get:params=>read(sql,stmt,'get',params),run:()=>{throw Error('Stats read must not write')}}},
    async batch(statements){
      assert.ok(Array.isArray(statements)&&statements.length>0)
      log.operations++;log.batchCalls++;log.statementAttempts+=statements.length;log.prepares+=statements.length
      const main=statements.some(item=>item.sql.includes('report_restore_state_changed'))
      if(main)log.atomicBatches++
      config.beforeBatch?.({statements,main})
      const queryOnly=Number(raw.prepare('PRAGMA query_only').get().query_only)
      const results=[]
      raw.exec('BEGIN')
      try{
        raw.exec('PRAGMA query_only=ON')
        for(const item of statements){
          assert.match(item.sql,/^\s*(SELECT|WITH)\b/i,'Read batch requires SELECT statements')
          assert.ok(raw.prepare(item.sql).columns().length>0,'Read batch must return actual columns')
          results.push({success:true,results:await db.prepare(item.sql).all(fixtureParams(item.params)),meta:{changes:0}})
        }
        raw.exec('COMMIT')
      }catch(error){raw.exec('ROLLBACK');throw error}
      finally{raw.exec('PRAGMA query_only='+(queryOnly?1:0))}
      // A header-only plan has no items statement: name the groups from the statements that are there, not by fixed position.
      const names=['sales','voidSales','items','returns','returnItems','deliveryFees'].filter(name=>!(name==='items'&&!statements.slice(2).some(item=>/FROM sale_items si/.test(item.sql))))
      results.forEach((result,index)=>{const group=main&&index>=2?names[index-2]||'other':'other';result.results=record(group,result.results)})
      if(main)log.dataImage=Object.fromEntries(names.slice(0,results.length-2).map((name,index)=>[name,results[index+2].results]))
      config.afterBatch?.({statements,main,results})
      return results
    },
  }
  api.staging=api
  return {db:api,log}
}

// The old pair member runs with report_atomic OFF (the legacy reader), the new one with it ON.
async function call(h,f,url='/stats',user=ADMIN,config={},cache=state()){
  f.raw.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").run([JSON.stringify({epoch:1,switches:{report_atomic:h===after?'on':'off',report_atomic_long:h===after?'on':'off'}})])
  h.setUser(user);const measured=meter(f.route,f.raw.db,config)
  const semantic={fullReads:0,totalsReads:0,counts:null,diagnostic:null}
  active={cache,semantic}
  try{const response=await h.app.request(url,{method:'GET'},{DB:measured.db},h.executionCtx);return {status:response.status,body:await response.json(),semantic,log:measured.log,cache}}
  finally{active=null}
}
function same(a,b){
  assert.equal(b.status,a.status);assert.deepEqual(b.body,a.body)
  // The header reader reads no sale lines (H2 Cut B): the counts still agree; the cost diagnostic and the row total belong to the lines it no longer reads.
  if(a.status===200){const pick=r=>({sale_count:r.semantic.counts.sale_count,cancelled_count:r.semantic.counts.cancelled_count});assert.deepEqual(pick(b),pick(a))}
  else{for(const result of [a,b]){assert.equal(result.cache.writes,0);assert.equal(result.cache.values.size,0)}}
}
const before=harness(baseline),after=harness(candidateSource)
let passed=0
async function test(name,fn){
  try{await fn();passed++;console.log('PASS '+name)}
  catch(error){console.log(JSON.stringify({status:'FAIL',passed,failed:[name],error:String(error?.message||error)}));throw error}
}
async function main(){
  before.setUser(ADMIN);const f=before.fixture()
  const prepare=f.route.prepare.bind(f.route)
  f.route.prepare=sql=>{const stmt=prepare(sql);return {...stmt,getOnce:stmt.get,allOnce:stmt.all}}
  f.route.batchOnce=f.route.batch.bind(f.route)
  try{
    const paid=await before.postSale(f.route,before.request('stats-paid'))
    const unpaid=await before.postSale(f.route,{...before.request('stats-unpaid'),sale_status:'awaiting_payment',amount_paid_usd:0})
    assert.equal(paid.status,200,JSON.stringify(paid.body));assert.equal(unpaid.status,200,JSON.stringify(unpaid.body))
    const sale=paid.body.sale;assert.ok(sale?.items?.length,'Actual canonical sale response')
    f.raw.prepare("UPDATE sales SET created_at='2026-09-13 01:00:00' WHERE id IN (?,?)").run([paid.body.id,unpaid.body.id])
    const returns=before.load('routes/returns.ts').default
    const send=async(url,body)=>{const response=await returns.request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.route},before.executionCtx);const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value}
    const quote=await send('/quote',{sale_id:sale.id,items:[{sale_item_id:sale.items[0].id,quantity:.25}]})
    const {customer_return_create_version:_create,customer_return_edit_version:_edit,...expected_quote}=quote
    await send('/',{client_request_id:'stats-return',money_precision_version:1,sale_id:sale.id,reason:'Synthetic Stats proof',expected_quote,items:[{sale_item_id:sale.items[0].id,quantity:.25,stock_action:'restock',branch_id:1}]})
    seedStockFixture(f.raw.db,()=>{
      f.raw.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Other fixture',1,0)").run()
      const s=f.raw.prepare(`INSERT INTO sales(id,receipt_number,created_at,sale_status,branch_id,cashier_id,cashier_name,customer_name,subtotal_usd,total_usd,total_khr,amount_paid_usd,exchange_rate,money_precision_version)
        VALUES(?,?,?, ?,1,?,?,'Synthetic customer',10,10,40000,?,4000,0)`)
      const item=f.raw.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,quantity,total_usd,cost_price_usd) VALUES(?,?,10,?, ?,1,10,4)`)
      for(let i=0;i<101;i++){
        const id=1000+i,status=i%11===0?'cancelled':i%7===0?'awaiting_payment':'completed'
        s.run([id,'STATS-LEGACY-'+i,i===100?'2026-09-12 16:59:59':'2026-09-13 01:00:00',status,i%2?71:72,i%2?'Dara':'Sokha',status==='awaiting_payment'?0:10])
        item.run([10000+i,id,('ហាង🙂\\"').repeat(32)+' item '+i,i===1?2:1])
      }
      f.raw.prepare("UPDATE sales SET customer_name='COHORT-MOVE' WHERE id=1001").run()
      f.raw.prepare("INSERT INTO customers(id,name,membership_number,is_anonymous) VALUES(9000,'Synthetic live customer','COHORT-MEMBER',0)").run()
      f.raw.prepare('UPDATE sales SET customer_id=9000 WHERE id=1001').run()
    })
    await test('actual seven fields/counts/diagnostic and reduced native SELECT shape',async()=>{
      const a=await call(before,f),b=await call(after,f);same(a,b);assert.equal(a.status,200,JSON.stringify(a.body))
      assert.deepEqual(Object.keys(b.body).sort(),FIELDS);assert.equal(b.body.total_count,103);assert.equal(b.body.truncated_in_list,true)
      assert.equal(a.semantic.fullReads,1);assert.equal(b.semantic.totalsReads,1);assert.equal(b.semantic.fullReads,0)
      assert.equal(Object.keys(b.log.groups.sales[0]).length,20);assert.equal(b.log.groups.items.length,0,'The header reader reads no sale lines')
      assert.deepEqual(Object.keys(b.log.groups.voidSales[0]),['id'])
      assert.ok(b.log.groups.returnItems.some(row=>typeof row.refund_snapshot_json==='string'&&row.refund_snapshot_json.length>200),'Actual V1 proof is read')
      assert.ok(b.log.resultUtf8Proxy<a.log.resultUtf8Proxy,'Dropping display-only columns must reduce actual SQL-result serialization')
      assert.equal(b.log.atomicBatches,1);assert.equal(b.log.batchCalls,3)
      assert.ok(b.log.statementAttempts>b.log.operations,'Statements and physical adapter calls stay separate')
      const control=meter(f.route,f.raw.db)
      const rows=await control.db.batch([{sql:'SELECT CAST(@bytes AS BLOB) AS b',params:{bytes:new Uint8Array([0,255]).buffer}},{sql:'SELECT 2 AS n'}])
      assert.deepEqual(Array.from(rows[0].results[0].b),[0,255]);assert.equal(rows[1].results[0].n,2)
      assert.equal(control.log.operations,1);assert.equal(control.log.statementAttempts,2);assert.equal(control.log.groups.items.length,0)
      const count=f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n
      await assert.rejects(()=>control.db.batch([{sql:'WITH one AS (SELECT 1) DELETE FROM sale_items RETURNING id'}]),/readonly|read-only|read only/i)
      assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n,count,'Read batch rejected writes before mutation')

    })
    const urls=['/stats?limit=1','/stats?limit=20','/stats?limit=200','/stats?startDate=2026-09-13&endDate=2026-09-13',
      '/stats?startDate=2026-09-13&endDate=2026-09-13&startTime=06:00&endTime=18:00','/stats?branchId=2',
      '/stats?status=awaiting_payment','/stats?status=cancelled','/stats?cashier=Dara','/stats?userId=71',
      '/stats?userId=71,72','/stats?search=STATS-LEGACY-17','/stats?search=no-such-fixture','/stats?search=COHORT-MOVE']
    for(const url of urls)await test('paired actual route '+url,async()=>{const a=await call(before,f,url),b=await call(after,f,url);same(a,b);assert.equal(b.status,200,JSON.stringify(b.body));assert.deepEqual(Object.keys(b.body).sort(),FIELDS)})
    await test('positive branch/item-branch, search and Not Paid controls',async()=>{
      assert.equal((await call(after,f,'/stats?branchId=2')).body.total_count,1)
      assert.equal((await call(after,f,'/stats?search=STATS-LEGACY-17')).body.total_count,1)
      const n=(await call(after,f,'/stats?status=awaiting_payment')).body
      assert.ok(n.pending_revenue_usd>0&&n.not_paid_owed_usd>0);assert.equal(n.revenue_without_not_paid_usd,0)
    })
    for(const [user,url,status] of [[null,'/stats',401],[{...VIEW,permissions:'{}'},'/stats',403],[VIEW,'/stats?userId=71',403],[ADMIN,'/stats?startTime=25:00&endTime=26:00',400]])await test('denial before data/cache '+status+' '+url,async()=>{
      for(const h of [before,after]){const r=await call(h,f,url,user);assert.equal(r.status,status);assert.equal(r.log.prepares,0);assert.equal(r.cache.versionReads,0);assert.equal(r.cache.reads,0)}
    })
    await test('view-only/no-cost role retains same public seven-field result',async()=>{const a=await call(before,f,'/stats',VIEW),b=await call(after,f,'/stats',VIEW);same(a,b);assert.deepEqual(Object.keys(b.body).sort(),FIELDS)})
    await test('cache hit bypasses producer, version bump makes old answer unreachable, denial still precedes cache',async()=>{
      for(const h of [before,after]){
        const c=state();c.enabled=true
        const first=await call(h,f,'/stats',ADMIN,{},c),hit=await call(h,f,'/stats',VIEW,{},c)
        assert.deepEqual(hit.body,first.body);assert.equal(hit.log.operations,0);assert.equal(c.writes,1)
        const denied=await call(h,f,'/stats',{...VIEW,permissions:'{}'},{},c);assert.equal(denied.status,403);assert.equal(denied.log.prepares,0)
        c.version++;const fresh=await call(h,f,'/stats',ADMIN,{},c);assert.equal(fresh.status,200);assert.ok(fresh.log.operations>0);assert.equal(c.writes,2)
      }
    })
    for(const [label,map,code] of [
      ['missing V1 refund proof',(group,rows)=>group==='returnItems'?rows.map(row=>({...row,refund_snapshot_json:null})):rows,'unsupported_row'],
    ])await test('paired financial refusal '+label,async()=>{
      const caches=[state(),state()];caches.forEach(cache=>{cache.enabled=true})
      const a=await call(before,f,'/stats',VIEW,{map},caches[0]),b=await call(after,f,'/stats',VIEW,{map},caches[1])
      same(a,b);assert.equal(a.status,422);assert.equal(a.body.code,code)
    })
    await test('a malformed stored line cost no longer stops the header (H2 Cut B: the report still refuses it elsewhere)',async()=>{
      const map=(group,rows)=>group==='items'?rows.map(row=>row.id===sale.items[0].id?{...row,cost_price_usd:'bad-cost'}:row):rows
      const clean=await call(after,f,'/stats',VIEW),b=await call(after,f,'/stats',VIEW,{map})
      assert.equal(b.status,200);assert.deepEqual(b.body,clean.body);assert.equal(b.log.groups.items.length,0)
    })
    await test('unknown canonical cost leaves the header unchanged and exposes no fields',async()=>{
      const map=(group,rows)=>group==='items'?rows.map(row=>row.id===sale.items[0].id?{...row,cost_price_usd:null}:row):rows
      const a=await call(before,f,'/stats',VIEW,{map}),b=await call(after,f,'/stats',VIEW,{map});same(a,b)
      assert.equal(b.status,200);assert.deepEqual(Object.keys(b.body).sort(),FIELDS)
    })
    for(const [label,url,sql,included,excluded,restore] of [
      ['customer search','/stats?search=COHORT-MOVE','UPDATE sales SET customer_name=? WHERE id=1001','COHORT-MOVE','COHORT-GONE','COHORT-MOVE'],
      ['live customer membership','/stats?search=COHORT-MEMBER','UPDATE customers SET membership_number=? WHERE id=9000','COHORT-MEMBER','COHORT-OTHER','COHORT-MEMBER'],
      ['cashier','/stats?cashier=COHORT-CASHIER','UPDATE sales SET cashier_name=? WHERE id=1001','COHORT-CASHIER','COHORT-OTHER','Dara'],
      ['item branch','/stats?branchId=2','UPDATE sale_items SET branch_id=? WHERE id=10001',2,1,2],
    ])await test('actual '+label+' fallback refuses mixing and atomic batches return a coherent cohort',async()=>{
      const change=value=>seedStockFixture(f.raw.db,()=>f.raw.prepare(sql).run([value]))
      try{
        for(const [h,target]of [[before,url],[after,url+(url.includes('?')?'&':'?')+'startDate=2026-09-13&endDate=2026-09-13']]){
          change(included);let flips=0
          const afterRead=({group})=>{if(group==='sales'){flips++;change(flips%2?excluded:included)}}
          const r=await call(h,f,target,ADMIN,{after:afterRead})
          assert.equal(r.status,409,JSON.stringify(r.body));assert.equal(r.body.code,'snapshot_changed');assert.ok(flips>=4);assert.equal(r.cache.writes,0)
        }
        change(included);const a=await call(after,f,url);change(excluded);const b=await call(after,f,url)
        assert.equal(a.status,200);assert.equal(b.status,200);assert.notDeepEqual(a.body,b.body)
        change(included);let beforeWrites=0
        const newer=await call(after,f,url,ADMIN,{beforeBatch({main}){if(main){beforeWrites++;change(excluded)}}})
        assert.equal(beforeWrites,1);assert.deepEqual(newer.body,b.body);assert.deepEqual(newer.log.dataImage,b.log.dataImage)
        change(included);let afterWrites=0
        const older=await call(after,f,url,ADMIN,{afterBatch({main}){if(main){afterWrites++;change(excluded)}}})
        assert.equal(afterWrites,1);assert.deepEqual(older.body,a.body);assert.deepEqual(older.log.dataImage,a.log.dataImage)
      }finally{change(restore)}
    })
    await test('retained money swaps preserve fallback refusal and one complete atomic image',async()=>{
      const seed=()=>seedStockFixture(f.raw.db,()=>f.raw.exec('UPDATE sale_items SET cost_price_usd=CASE id WHEN 10001 THEN 1 ELSE 2 END WHERE id IN (10001,10002)'))
      const swap=()=>seedStockFixture(f.raw.db,()=>f.raw.exec('UPDATE sale_items SET cost_price_usd=CASE cost_price_usd WHEN 1 THEN 2 ELSE 1 END WHERE id IN (10001,10002)'))
      try{
        for(const [h,url]of [[before,'/stats'],[after,'/stats?startDate=2026-09-13&endDate=2026-09-13']]){
          seed();let swaps=0,bandReads=0
          const r=await call(h,f,url,ADMIN,{after({group,rows}){
            if(group!=='items')return
            if(rows.some(row=>Object.hasOwn(row,'cost_price_usd'))){swaps++;swap()}
            else if(rows.some(row=>Object.hasOwn(row,'lo')&&Object.hasOwn(row,'hi')))bandReads++
          }})
          if(h===after){
            // H2 Cut B: the header reader reads no sale lines, so a line-cost swap is invisible to it (it is exact without lines) and no band read happens.
            assert.equal(r.status,200,`dated-totals ${url}: ${JSON.stringify(r.body)}`);assert.equal(swaps,0,'The header reader must not read line costs');assert.equal(bandReads,0,'The header reader has no item band')
            continue
          }
          assert.equal(r.status,409,`old-full ${url}: ${JSON.stringify(r.body)}`);assert.equal(r.body.code,'snapshot_changed');assert.ok(swaps>=4)
          assert.equal(bandReads,0,'Unfiltered full reader has no date band')
        }
        seed();const a=await call(after,f);swap();const b=await call(after,f)
        assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body,b.body)
        seed();let writes=0
        const coherent=await call(after,f,'/stats',ADMIN,{afterBatch({main}){if(main){writes++;swap()}}})
        assert.equal(writes,1);assert.equal(coherent.status,200);assert.deepEqual(coherent.body,a.body);assert.deepEqual(coherent.log.dataImage,a.log.dataImage)
      }finally{seedStockFixture(f.raw.db,()=>f.raw.exec('UPDATE sale_items SET cost_price_usd=4 WHERE id IN (10001,10002)'))}
    })
    console.log(JSON.stringify({status:'PASS_PAIRED_HONO_STATS',passed,base:BASE,baselineLfSha256:sha(baseline),candidateLfSha256:sha(candidateSource),
      scope:'Actual Hono/full-migration SQLite with injected auth/cache/error bridge. Adapter operations/result UTF8 proxy are not native D1 rows_read/calls, production auth/cache, CPU, peak, daily or Free readiness. Native cost probe is separate.'}))
  }finally{f.raw.db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{if(previous===undefined)delete globalThis.__stats1022;else globalThis.__stats1022=previous})
