'use strict'

// Actual Sales route regression with a pinned pre-batch baseline.
// Native SQLite/Hono route regression; platform D1/CPU/peak evidence is separate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const {execFileSync}=require('node:child_process')
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const match=/^--([a-z-]+)=(.*)$/.exec(arg);assert.ok(match);return[match[1],match[2]]}))
const root=path.resolve(options.root||path.join(__dirname,'..'))
assert.ok(fs.existsSync(path.join(root,'src/routes/sales.ts')),'Run from cloudflare/scripts or supply --root=<cloudflare>')
const projectRequire=Module.createRequire(path.join(root,'package.json'))
const {seedStockFixture}=projectRequire('./scripts/harness/seed-stock-fixture.cjs')
const BASE='8a6e79307864f926d44bd8c510cc5a2b330b21be',shown=new Map()
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,'Unique fixture seam: '+from.slice(0,90));return text.replace(from,()=>to)}
function oldSource(relative){
  if(!shown.has(relative)){
    try{shown.set(relative,execFileSync('git',['show',BASE+':cloudflare/'+relative],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,
      env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['ignore','pipe','pipe']}))}
    catch{throw new Error('Pinned baseline unavailable locally: '+BASE+':cloudflare/'+relative+'; supply repository history, no baseline fallback')}
  }
  return shown.get(relative)
}
const cacheState=()=>({enabled:false,reads:0,versionReads:0,writes:0,values:new Map()})
let activeCache=cacheState()
globalThis.__salesPageCache={
  version(){activeCache.versionReads++;return 0},
  async read(request,version,producer){
    activeCache.reads++;const key=request.url+'|'+version
    if(activeCache.enabled&&activeCache.values.has(key))return activeCache.values.get(key)
    const value=await producer()
    if(activeCache.enabled){activeCache.values.set(key,value);activeCache.writes++}
    return value
  },
}
function harness(reference=false,cap=null){
  const file=path.join(root,'scripts/test-sale-create-atomic-pure.cjs'),source=fs.readFileSync(file,'utf8'),boundary=';(async () => {'
  assert.equal(source.split(boundary).length,2,'Existing full-migration fixture prefix')
  let prefix=source.slice(0,source.indexOf(boundary))
  prefix=once(prefix,'const overrides = {',"const overrides = { './db': { getDb: env => env.DB },")
  prefix=once(prefix,'getVersionWithFallback: async () => 0,','getVersionWithFallback: async () => globalThis.__salesPageCache.version(),')
  prefix=once(prefix,'cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),',
    'cachedJsonResponse: async (request, _context, key, _ttl, loader) => globalThis.__salesPageCache.read(request, key, loader),')
  prefix=once(prefix,"requireAuth: async (c, next) => { c.set('user', currentUser); return next() }",
    "requireAuth: async (c, next) => { if(!currentUser)return c.json({error:'Unauthenticated'},401); c.set('user', currentUser); return next() }")
  const proxyFs={...fs,readFileSync(filename,encoding){
    const relative=path.relative(root,String(filename)).replaceAll('\\','/')
    if(!relative.startsWith('src/')||!relative.endsWith('.ts'))return fs.readFileSync(filename,encoding)
    let text=reference?oldSource(relative):fs.readFileSync(filename,'utf8')
    if(cap!==null&&relative==='src/routes/sales.ts'){
      const start=text.indexOf("app.get('/', async (c) => {"),end=text.indexOf('/** Cache entries are actor-neutral.',start)
      assert.ok(start>0&&end>start);const block=text.slice(start,end)
      assert.equal(block.split('REPORT_MONEY_MAX_ROWS').length,3,'Two list-only cap references')
      text=text.slice(0,start)+block.replaceAll('REPORT_MONEY_MAX_ROWS',String(cap))+text.slice(end)
    }
    return encoding?text:Buffer.from(text)
  }}
  const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file))
  const requireOriginal=mod.require.bind(mod)
  mod.require=id=>id==='node:fs'?proxyFs:requireOriginal(id)
  mod._compile(prefix+'\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};',file)
  const h=mod.exports,money=h.load('lib/reportMoneyPrecision.ts')
  h.app.onError((error,c)=>{
    if(error instanceof money.ReportMoneyPrecisionError){const mapped=money.reportMoneyHttpError(error);return c.json({success:false,error:mapped.message,code:error.code},mapped.status)}
    return c.json({success:false,error:String(error.message)},500)
  })
  return h
}
const ADMIN={id:71,username:'fixture-admin',name:'Fixture Admin',role_code:'admin',organization_id:null,permissions:'{"all":true}'}
const STAFF={id:72,username:'fixture-viewer',name:'Fixture Viewer',role_code:'employee',permissions:'{"sales":"view","sales:view_courier_cost":false}'}
function kind(sql){
  if(/FROM sale_items si\b/.test(sql)&&/LEFT JOIN sales ss\b/.test(sql))return 'items'
  if(/SELECT id,sale_id,total_refund_usd,total_refund_khr,/.test(sql))return 'refunds'
  if(/SELECT s\.id AS sale_id,/.test(sql)&&/sale_amendments sa/.test(sql))return 'records'
  return null
}
function metered(db,config={}){
  const log={calls:0,statements:0,childCalls:0,childStatements:0,childBatches:0,events:[]}
  const begin=(sqls,batch)=>{
    log.calls++;log.statements+=sqls.length
    const kinds=sqls.map(kind);if(kinds.some(Boolean)){log.childCalls++;log.childStatements+=kinds.filter(Boolean).length;if(batch)log.childBatches++}
    log.events.push({batch,kinds,statements:sqls.length})
  }
  const malformed=(rows,sql)=>!config.badRefunds||kind(sql)!=='refunds'?rows:rows.map(row=>{
    if(Number(row.sale_id)===config.badRefunds.v0)return {...row,money_precision_version:0,total_refund_usd:'invalid-v0'}
    if(Number(row.sale_id)===config.badRefunds.v1)return {...row,money_precision_version:1,total_refund_usd:'invalid-v1'}
    return row
  })
  const api={prepare(sql){const stmt=db.prepare(sql);return{
    async all(params){begin([sql],false);return malformed(await stmt.all(params),sql)},
    async get(params){begin([sql],false);return stmt.get(params)},
    async run(){throw new Error('GET regression must not write through measured adapter')},
  }},async batch(plans){
    const children=plans.some(plan=>kind(plan.sql)==='items')&&plans.some(plan=>kind(plan.sql)==='refunds')&&plans.some(plan=>kind(plan.sql)==='records')
    if(children&&config.fault==='separate-calls')return Promise.all(plans.map(async plan=>({success:true,results:await api.prepare(plan.sql).all(plan.params),meta:{}})))
    begin(plans.map(plan=>plan.sql),true)
    const actualPlans=children&&config.fault==='missing-plan'?plans.slice(0,-1):plans
    let results=await db.batch(actualPlans)
    results=results.map((result,index)=>({...result,results:malformed(result.results??[],actualPlans[index].sql)}))
    if(!children)return results
    const slot=Math.min(1,results.length-1)
    if(config.fault==='short')return results.slice(0,-1)
    if(config.fault==='extra')return [...results,{success:true,results:[]}]
    if(config.fault==='hole'){delete results[slot];return results}
    if(config.fault==='null')results[slot]=null
    if(config.fault==='success-false')results[slot]={...results[slot],success:false}
    if(config.fault==='success-missing'){delete results[slot].success}
    if(config.fault==='results-missing'){delete results[slot].results}
    if(config.fault==='results-object')results[slot]={...results[slot],results:{}}
    return results
  }}
  api.staging=api
  return {db:api,log}
}
async function call(h,db,url,user=ADMIN,config={},cache=cacheState(),tier='free'){
  h.setUser(user);activeCache=cache
  const measured=metered(db,config)
  const response=await h.app.request(url,{method:'GET'},{DB:measured.db,PLAN_TIER:tier},h.executionCtx)
  return {status:response.status,body:await response.json(),log:measured.log,cache}
}
function assertMechanism(result){
  assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(Array.isArray(result.body),'Default remains array')
  assert.equal(result.log.childCalls,result.body.length?1:0,'Child data must use one adapter operation')
  assert.equal(result.log.childBatches,result.body.length?1:0,'Child data must use one true batch')
  assert.equal(result.log.childStatements,result.body.length?3*Math.ceil(result.body.length/100):0,'Original plan/chunk count')
}
async function main(){
  const before=harness(true),after=harness(false);before.setUser(ADMIN);after.setUser(ADMIN)
  const f=before.fixture()
  try{
    const create=async key=>{const result=await before.postSale(f.route,before.request(key));assert.equal(result.status,200,JSON.stringify(result.body));return result.body.id}
    const clean=await create('page-clean'),historical=await create('page-history')
    seedStockFixture(f.raw.db,()=>{
      f.raw.prepare("INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(20,'Fixture keeper','FIX-KEEPER',0,9.5,38000,4,16000,1)").run()
      f.raw.prepare('UPDATE sale_items SET product_id=20 WHERE sale_id=?').run([historical])
      f.raw.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(9,'Fixture driver','001234')").run()
      const sale=f.raw.prepare(`INSERT INTO sales(id,receipt_number,created_at,sale_status,branch_id,branch_name,cashier_name,customer_name,payment_method,
        subtotal_usd,total_usd,total_khr,discount_usd,membership_discount_usd,exchange_rate,amount_paid_usd,money_precision_version,
        is_delivery,delivery_contact_id,delivery_actual_cost_usd) VALUES(?,?,?,'completed',1,'Historical Shop','Fixture Cashier',?,'Cash',9.5,9.5,38000,0,0,4000,9.5,0,1,9,3)`)
      const item=f.raw.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr,returned_quantity)
        VALUES(?,?,10,?,1,1,9.5,38000,4,16000,0)`)
      for(let index=0;index<203;index++){
        const id=1000+index;sale.run([id,'List-'+String(index).padStart(4,'0'),'2026-10-27 01:00:00','Fixture Customer '+index])
        if(index<202)item.run([10000+index,id,'Fixture item '+index])
      }
      f.raw.prepare("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES('update','sale','1000','{}')").run()
      f.raw.prepare(`INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,total_refund_khr,money_precision_version)
        VALUES(900010,1000,'completed','customer',2.375,9500,0),
          (900011,1000,'cancelled','customer',2,8000,0),(900012,1000,'completed','supplier',3,12000,0)`).run()
      f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment',amount_paid_usd=0,amount_paid_khr=0 WHERE id=1001").run()
      f.raw.prepare(`INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,total_refund_khr,money_precision_version,refund_currency)
        VALUES(900020,1001,'completed','customer',1.25,5000,0,NULL)`).run()
      f.raw.prepare(`INSERT INTO return_items(return_id,sale_item_id,product_id,product_name,branch_id,quantity,cost_price_usd,total_usd,stock_action)
        VALUES(900010,10000,10,'Fixture item 0',1,0.25,4,2.375,'restock'),
          (900011,10000,10,'Fixture item 0',1,0.5,4,2,'restock'),
          (900012,10000,10,'Fixture item 0',1,0.75,4,3,'restock')`).run()
      f.raw.prepare('UPDATE sale_items SET returned_quantity=0.1 WHERE id=10000').run()
    })
    for(const h of [before,after]){
      const result=await call(h,f.route,'/?id=1000')
      assert.equal(result.status,200,JSON.stringify(result.body))
      const row=result.body[0]
      assert.equal(row.refund_usd,2.375);assert.equal(row.refund_khr,9500);assert.equal(row.return_count,1)
      assert.equal(row.return_owed_reduction_usd,0,'Completed legacy returns lower no debt')
      assert.equal(row.items[0].imported_returned_quantity,0.1)
      assert.equal(row.items[0].returned_quantity,0.35,'Only active customer lines add to imported returns')
      assert.equal(row.net_total_usd,7.125);assert.equal(row.net_total_khr,28500)
      const debt=await call(h,f.route,'/?id=1001')
      assert.equal(debt.status,200,JSON.stringify(debt.body))
      assert.equal(debt.body[0].refund_usd,1.25);assert.equal(debt.body[0].refund_khr,5000)
      assert.equal(debt.body[0].return_owed_reduction_usd,1.25,'An unpaid legacy return lowers its recorded debt')
    }
    const parity=[]
    for(const tier of ['free','paid'])for(const limit of [20,100,101,200])for(const page of [1,2]){
      const url=`/?limit=${limit}&page=${page}&sortBy=receipt&sortDir=asc`,old=await call(before,f.route,url,ADMIN,{},cacheState(),tier),current=await call(after,f.route,url,ADMIN,{},cacheState(),tier)
      assert.equal(old.status,200,JSON.stringify(old.body));assert.deepEqual(current.body,old.body,'Full array '+tier+' '+url)
      assertMechanism(current);assert.equal(old.log.childCalls,old.body.length?3*Math.ceil(old.body.length/100):0)
      parity.push({tier,limit,page,rows:current.body.length,old:old.log,current:current.log})
    }
    for(const url of [`/?id=${clean}`,`/?id=${historical}`,'/?id=99999999','/?id=1202','/?search=List-0003','/?search=not-present','/?limit=20&page=99999',
      '/?sortBy=total&sortDir=asc&limit=20','/?sortBy=customer&sortDir=desc&limit=20','/?sortBy=date&sortDir=desc&limit=20','/?withTotal=1&limit=20']){
      const old=await call(before,f.route,url),current=await call(after,f.route,url)
      assert.equal(current.status,old.status);assert.deepEqual(current.body,old.body,'Filter/default full-body '+url);assertMechanism(current)
      if(url===`/?id=${historical}`){assert.equal(current.body[0].identity_review_required,true);assert.equal(current.body[0].items[0].identity_review_required,true)}
      if(url===`/?id=${clean}`){assert.equal(current.body[0].identity_review_required,undefined);assert.ok(current.body[0].items[0].pricing_snapshot_json)}
    }
    for(const actor of [null,{...STAFF,permissions:'{"pos":true}'}])for(const h of [before,after]){
      const result=await call(h,f.route,'/?limit=20',actor);assert.ok([401,403].includes(result.status));assert.equal(result.log.calls,0);assert.equal(result.cache.reads+result.cache.versionReads,0)
    }
    for(const h of [before,after]){
      const denied=await call(h,f.route,'/?userId=71',STAFF);assert.equal(denied.status,403);assert.equal(denied.log.calls,0);assert.equal(denied.cache.reads+denied.cache.versionReads,0)
      const cache=cacheState();cache.enabled=true;const url=`/?id=${clean}&_case=cost`
      const admin=await call(h,f.route,url,ADMIN,{},cache),staff=await call(h,f.route,url,STAFF,{},cache)
      assert.equal(staff.status,200);assert.equal(staff.log.calls,0,'Cost projection after cached payload')
      assert.equal(Object.hasOwn(staff.body[0],'creation_snapshot_json'),false);assert.equal(Object.hasOwn(staff.body[0],'delivery_actual_cost_usd'),false)
      assert.equal(Object.hasOwn(staff.body[0].items[0],'cost_price_usd'),false)
      assert.deepEqual((await call(h,f.route,url,ADMIN,{},cache)).body,admin.body,'Shared cached payload must remain unmodified')
    }
    const good=await call(after,f.route,'/?limit=20&sortBy=receipt&sortDir=asc')
    const split=await call(after,f.route,'/?limit=20&sortBy=receipt&sortDir=asc',ADMIN,{fault:'separate-calls'})
    assert.deepEqual(split.body,good.body);assert.throws(()=>assertMechanism(split),/one adapter operation/)
    for(const fault of ['missing-plan','short','extra','hole','null','success-false','success-missing','results-missing','results-object']){
      const cache=cacheState();cache.enabled=true;const url='/?limit=20&_case='+fault
      const broken=await call(after,f.route,url,ADMIN,{fault},cache)
      assert.equal(broken.status,500,fault);assert.match(broken.body.error,/Incomplete sales page child batch/);assert.equal(cache.writes,0,'No partial payload cached')
      const recovered=await call(after,f.route,url,ADMIN,{},cache);assertMechanism(recovered);assert.equal(cache.writes,1)
    }
    const page=await call(before,f.route,'/?limit=200&sortBy=receipt&sortDir=asc');assert.equal(page.body.length,200)
    const ids={v0:page.body[0].id,v1:page.body[100].id}
    seedStockFixture(f.raw.db,()=>{
      const refund=f.raw.prepare("INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,total_refund_khr,money_precision_version) VALUES(?,?,'completed','customer',1,4000,0)")
      refund.run([900002,ids.v0]);refund.run([900001,ids.v1])
    })
    for(const h of [before,after]){
      const result=await call(h,f.route,'/?limit=200&sortBy=receipt&sortDir=asc',ADMIN,{badRefunds:ids})
      assert.equal(result.status,422);assert.equal(result.body.code,'invalid_recorded_decimal','Old first chunk V0 must precede lower-id second-chunk V1')
    }
    const cappedBefore=harness(true,3),cappedAfter=harness(false,3)
    seedStockFixture(f.raw.db,()=>{for(let id=901000;id<901004;id++)f.raw.prepare("INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,total_refund_khr,money_precision_version) VALUES(?,1000,'completed','customer',1,4000,0)").run([id])})
    for(const h of [cappedBefore,cappedAfter]){
      const result=await call(h,f.route,'/?id=1000',ADMIN,{badRefunds:{v0:1000,v1:-1}})
      assert.equal(result.status,413);assert.equal(result.body.code,'too_many_rows','Bounded cap3 seam must refuse before malformed money')
    }
    const columns=f.raw.db.prepare('PRAGMA table_info(returns)').all().map(row=>String(row.name)).filter(name=>name!=='money_precision_version')
    for(const name of columns)assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/)
    f.raw.db.exec('ALTER TABLE returns RENAME TO __page_returns_with_precision')
    f.raw.db.exec('CREATE TABLE returns AS SELECT '+columns.map(name=>'"'+name+'"').join(',')+' FROM __page_returns_with_precision')
    assert.equal(f.raw.db.prepare('PRAGMA table_info(returns)').all().some(row=>row.name==='money_precision_version'),false)
    for(const h of [before,after])h.load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
    const legacyOld=await call(before,f.route,'/?limit=101&sortBy=receipt&sortDir=asc')
    const legacyCurrent=await call(after,f.route,'/?limit=101&sortBy=receipt&sortDir=asc')
    assert.equal(legacyOld.status,200,JSON.stringify(legacyOld.body))
    assert.deepEqual(legacyCurrent.body,legacyOld.body,'Physical legacy precision-column absence keeps the full array')
    assertMechanism(legacyCurrent)
    console.log(JSON.stringify({status:'PASS_ACTUAL_ROUTE_CHILD_BATCH',baseline:BASE,parity,
      scope:'Full-migration native SQLite/Hono with injected auth/cache/error capture. Tier values are fixture inputs, not enforced Worker plans. Counts are D1-compatible adapter operations, not platform D1 calls. Legacy control uses a physical read-only table copy. SQL probe owns real D1 rows/bytes/EQP. No production auth, CPU, peak, daily or whole-Free certificate.'}))
  }finally{f.raw.db.close();delete globalThis.__salesPageCache}
}
main().catch(error=>{console.error(error);process.exitCode=1})
