// Resource-pressure fixtures exercise native admission and abort ordering, not financial history.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {createHash}=require('node:crypto'),{createRequire}=require('node:module')
assert.equal(process.argv.length,2,'This regression loads the current checkout; no arguments are supported')
const root=path.resolve(__dirname,'../..'),cf=path.join(root,'cloudflare')
const workerFile=path.join(__dirname,'harness/report-bounded-batch-worker.ts')
const sha=value=>createHash('sha256').update(value).digest('hex')
const worker=fs.readFileSync(workerFile,'utf8').replace(/\r\n/g,'\n')
assert.equal(sha(worker),'df7817be3ec3012764ccc87ba6bbbdd777cec59e6017b145e97ea0af502cd35d','Update the reviewed worker binding when changing its instrumentation')
const testExports='\nexport {buildSalesReportReadPlan as __guardPlan,reportTotalsBatchStatements as __guardBatch,readBoundedReportRestoreState as __guardState,reportRestoreStatements as __guardFlags,REPORT_TOTALS_POLICY as __guardPolicy};\n'
const sources=new Map(),sourceHashes={},testSourceHashes={}
let lastStage={stage:'start'}
function readSource(relative){
 if(sources.has(relative))return sources.get(relative)
 const file=path.join(root,relative)
 if(!fs.existsSync(file))return null
 const text=fs.readFileSync(file,'utf8');sources.set(relative,text);sourceHashes[relative]=sha(text);return text
}
const analytics=readSource('cloudflare/src/lib/salesAnalytics.ts')
assert.notEqual(analytics,null,'Current salesAnalytics source is required')
const local=createRequire(path.join(cf,'package.json')),{build}=local('esbuild'),{Miniflare,Log,LogLevel}=local('miniflare'),{unstable_splitSqlQuery:splitSql}=local('wrangler')
const plugin={name:'current-checkout-guard-builders',setup(build){
 build.onResolve({filter:/^guard:(analytics|db|money)$/},args=>({path:args.path==='guard:analytics'?'src/lib/salesAnalytics':args.path==='guard:db'?'src/lib/db':'src/lib/reportMoneyPrecision',namespace:'checkout'}))
 build.onResolve({filter:/^\.\.?\//,namespace:'checkout'},args=>({path:path.posix.normalize(path.posix.join(path.posix.dirname(args.importer),args.path)),namespace:'checkout'}))
 build.onLoad({filter:/.*/,namespace:'checkout'},args=>{for(const suffix of ['.ts','/index.ts','']){const relative='cloudflare/'+args.path+suffix,original=readSource(relative);if(original===null)continue;const contents=relative==='cloudflare/src/lib/salesAnalytics.ts'?original+testExports:original;testSourceHashes[relative]=sha(contents);return {contents,loader:relative.endsWith('.json')?'json':'ts',resolveDir:cf}}throw new Error('Missing current source '+args.path)})
}}
async function main(){
 const hashes={},checks=[];let sequence=0,summary
 const recordHash=(name,value)=>{const data=typeof value==='string'?Buffer.from(value):Buffer.from(JSON.stringify(value,null,2));hashes[name]=sha(data)}
 const life=(stage,detail={})=>{lastStage={stage,...detail}}
 recordHash('runner-source.cjs',fs.readFileSync(__filename,'utf8'));recordHash('worker-source.ts',worker);recordHash('analytics-original.ts',analytics);recordHash('analytics-with-test-exports.ts',analytics+testExports)
 life('bundle-before');const bundle=(await build({stdin:{contents:worker,resolveDir:cf,loader:'ts',sourcefile:'report-bounded-batch-worker.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],logLevel:'error',plugins:[plugin]})).outputFiles[0].text;recordHash('worker.mjs',bundle);life('bundle-after')
 const migrations=fs.readdirSync(path.join(cf,'migrations')).filter(name=>name.endsWith('.sql')).sort(),statements=[]
 for(const name of migrations)for(const sql of splitSql(readSource('cloudflare/migrations/'+name)).filter(sql=>sql.trim())){
  // Keep the fresh-database alias-seed exception used by the native migration fixtures.
  if(name==='0098_user_aliases.sql'&&/^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim()))continue
  statements.push(sql)
 }
 for(const [name,text]of sources)recordHash('loaded-source/'+name,text)
 recordHash('test-source-patch.json',{kind:'exports-only',append:testExports,original_sha256:sha(analytics),instrumented_sha256:sha(analytics+testExports)})
 const mf=new Miniflare({modules:true,script:bundle,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,d1Databases:['DB','FLAGS'],d1Persist:false,cachePersist:false,outboundService:{network:{allow:[],deny:['0.0.0.0/0','::/0']}},log:new Log(LogLevel.ERROR)})
 try{
  const raw=await mf.getD1Database('DB'),flags=await mf.getD1Database('FLAGS'),setup=[]
  const recordSetup=(kind,result)=>setup.push({kind,results:(Array.isArray(result)?result:[result]).map(row=>({success:row.success,rows_read:row.meta?.rows_read??null,rows_written:row.meta?.rows_written??null}))})
  const exec=async(sql,values=[],db=raw)=>{life('setup-before',{sql_sha256:sha(sql),bind_count:values.length});const result=await db.prepare(sql).bind(...values).run();recordSetup('fixture',result);recordHash('setup.json',setup);life('setup-after');return result}
  for(let offset=0;offset<statements.length;offset+=100){life('migration-before',{offset});recordSetup('migration',await raw.batch(statements.slice(offset,offset+100).map(sql=>raw.prepare(sql))));recordHash('setup.json',setup)}
  for(const table of ['sales','sale_items','returns','return_items']){const found=await raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger'AND tbl_name=?").bind(table).all();recordHash('dropped-trigger-inventory-'+table+'.json',found.results);for(const row of found.results){assert.match(row.name,/^[A-Za-z0-9_]+$/);await exec('DROP TRIGGER "'+row.name+'"')}}
  await raw.batch([raw.prepare("INSERT INTO system_flags(key,value)SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),raw.prepare("INSERT INTO branches(id,name,is_default,is_active)VALUES(1,'Guard fixture',1,1)"),raw.prepare("INSERT INTO products(id,name,stock_quantity,is_active)VALUES(10,'Guard fixture',0,1)"),raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
  await exec('CREATE TABLE system_flags(key TEXT,value)',[],flags)
  const invoke=async(input,label)=>{life('request-before',{label,input:{...input,policy:input.policy}});const response=await mf.dispatchFetch('http://fixture.test/run',{method:'POST',body:JSON.stringify(input)}),value=await response.json();recordHash('calls/'+String(++sequence).padStart(3,'0')+'-'+label+'.json',value);life('request-after',{label,status:response.status,kind:value.kind,marker:value.error?.marker});assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.ok,true,JSON.stringify(value));return value}
  const test=async(name,run)=>{await run();checks.push({name,passed:true});recordHash('checks.json',checks);console.log('PASS '+name)}
  async function seed({headers=1,items=1,returns=0,returnItems=0,cost=null}={}){
   for(const table of ['return_items','returns','sale_items','sales'])await exec('DELETE FROM '+table)
   if(headers)await exec("WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?1)INSERT INTO sales(id,created_at,sale_status,branch_id,subtotal_usd,total_usd,money_precision_version)SELECT x,'2026-09-13 01:00:00','completed',1,1,1,0 FROM n",[headers])
   if(items)await exec('WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?1)INSERT INTO sale_items(id,sale_id,product_id,quantity,total_usd,cost_price_usd,product_discount_usd,manual_discount_usd)SELECT x,1,10,1,NULL,?2,NULL,NULL FROM n',[items,cost])
   if(returns)await exec("INSERT INTO returns(id,sale_id,status,return_scope,total_refund_usd,money_precision_version)VALUES(1,1,'completed','customer',0,0)")
   if(returnItems)await exec('WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?1)INSERT INTO return_items(id,return_id,product_id,quantity,total_usd,cost_price_usd,return_to_stock,stock_action,sale_item_id,refund_snapshot_json)SELECT x,1,10,1,NULL,NULL,NULL,NULL,NULL,NULL FROM n',[returnItems])
   const counts={};for(const table of ['sales','sale_items','returns','return_items'])counts[table]=(await raw.prepare('SELECT COUNT(*)AS n FROM '+table).all()).results[0].n
   recordHash('fixture-counts.json',counts);return counts
  }
  function nativeFailure(value,marker,{mapped=null}={}){
   assert.equal(value.kind,'error',JSON.stringify(value));assert.equal(value.error.marker,marker,JSON.stringify(value.error))
   const guards=value.calls.filter(call=>call.phase==='guard');assert.equal(guards.length,1,'Exactly one deterministic native guard attempt');assert.equal(guards[0].operation,'batch');assert.ok(guards[0].error.includes(marker),'Expected marker must come from the actual native batch error');assert.equal(guards[0].unknown_metadata,guards[0].arity,'Failed native batch metadata stays unknown');assert.equal(guards[0].results,undefined)
   if(mapped!==null){assert.equal(value.error.mapped_status,mapped);assert.equal(value.error.code,'too_many_rows')}
  }
  async function rejectWithPoison(label,input,marker,mapped){
   const failed=await invoke({...input,poison:'after'},label+'-guard');nativeFailure(failed,marker,{mapped})
   const bypass=await invoke({...input,poison:'after',bypass:true},label+'-wrong-no-throw-guard');nativeFailure(bypass,'__report_guard_detail_poison');assert.ok(bypass.calls.find(call=>call.phase==='guard').instrumentation?.count>=2,'Wrong guard must be an actual named SQL error-operand mutation')
   return failed
  }
  await test('small admitted native detail arrays respect actual builder bounds',async()=>{await seed({cost:2});const value=await invoke({mode:'direct'},'small-admitted');assert.equal(value.kind,'direct-success');assert.ok(value.actual_detail_arrays_utf8<=value.admission.detail_upper);assert.equal(value.admission.data_rows,2);const app=await invoke({mode:'execute'},'small-real-helper');assert.equal(app.kind,'application-success');assert.equal(app.value.row_count,2)})
  await test('native poison calibration distinguishes ordering and genuine admission',async()=>{const after=await invoke({mode:'execute',poison:'after'},'allowed-reaches-poison');nativeFailure(after,'__report_guard_detail_poison');const before=await invoke({mode:'execute',poison:'before'},'poison-before-fence');nativeFailure(before,'__report_guard_detail_poison')})
  await test('receipt ceiling aborts actual native batch before follower',async()=>{await seed({headers:1,items:1});nativeFailure(await invoke({mode:'execute',options:{maxReceipts:1},poison:'after'},'receipt-exact-admitted'),'__report_guard_detail_poison');await seed({headers:2,items:2});const result=await rejectWithPoison('receipt-over',{mode:'execute',options:{maxReceipts:1}},'report_totals_receipts');assert.equal(result.error.name,'SalesReportExportTooLargeError')})
  await test('shared100000 across sets admits;100001 refuses before detail materialization',async()=>{const counts=await seed({headers:1,items:50000,returns:1,returnItems:49998});assert.equal(Object.values(counts).reduce((sum,n)=>sum+n,0),100000);nativeFailure(await invoke({mode:'execute',poison:'after'},'shared100000-admitted'),'__report_guard_detail_poison');await exec('INSERT INTO return_items(id,return_id,product_id,quantity,total_usd,cost_price_usd,return_to_stock,stock_action,sale_item_id,refund_snapshot_json)VALUES(49999,1,10,1,NULL,NULL,NULL,NULL,NULL,NULL)');await rejectWithPoison('shared100001',{mode:'execute'},'report_totals_rows',413)})
  await test('production1.8MB fallback-text row bound admits below and refuses above',async()=>{await seed({cost:'\u0001'.repeat(299000)});const below=await invoke({mode:'diagnose'},'row-below-native-upper');assert.equal(below.kind,'diagnostic');assert.ok(below.admission.probe_largest<=1800000);nativeFailure(await invoke({mode:'execute',poison:'after'},'row-below-admitted'),'__report_guard_detail_poison');await seed({cost:'\u0001'.repeat(300100)});const above=await invoke({mode:'diagnose'},'row-over-native-upper');assert.ok(above.admission.probe_largest>1800000);assert.ok(above.admission.detail_upper<32*1024*1024);await rejectWithPoison('row-over',{mode:'execute'},'report_totals_bytes',413)})
  await test('production32MiB fallback-text shared upper bound includes native data rather than only per-row cap',async()=>{await seed({items:10000,cost:'\u0001'.repeat(500)});const below=await invoke({mode:'diagnose'},'global-below-native-upper');assert.ok(below.admission.probe_largest<1800000);assert.ok(below.admission.detail_upper+below.control+below.state.postUpper+below.state.postRequestUpper<32*1024*1024);nativeFailure(await invoke({mode:'execute',poison:'after'},'global-below-admitted'),'__report_guard_detail_poison');await seed({items:10000,cost:'\u0001'.repeat(600)});const above=await invoke({mode:'diagnose'},'global-over-native-upper');assert.ok(above.admission.probe_largest<1800000);assert.ok(above.admission.detail_upper>32*1024*1024);await rejectWithPoison('global-over',{mode:'execute'},'report_totals_bytes',413)})
  await test('data-mode escaped ASCII row bound admits useful text and refuses overflow',async()=>{await seed({cost:'"'.repeat(899000)});const below=await invoke({mode:'diagnose'},'ascii-row-below-native-upper');assert.equal(below.kind,'diagnostic');assert.ok(below.admission.probe_largest<=1800000);nativeFailure(await invoke({mode:'execute',poison:'after'},'ascii-row-below-admitted'),'__report_guard_detail_poison');await seed({cost:'"'.repeat(900100)});const above=await invoke({mode:'diagnose'},'ascii-row-over-native-upper');assert.ok(above.admission.probe_largest>1800000);assert.ok(above.admission.detail_upper<32*1024*1024);await rejectWithPoison('ascii-row-over',{mode:'execute'},'report_totals_bytes',413)})
  await test('data-mode escaped ASCII shared bound admits useful text and refuses overflow',async()=>{await seed({items:10000,cost:'\\'.repeat(1300)});const below=await invoke({mode:'diagnose'},'ascii-global-below-native-upper');assert.ok(below.admission.probe_largest<1800000);assert.ok(below.admission.detail_upper+below.control+below.state.postUpper+below.state.postRequestUpper<32*1024*1024);nativeFailure(await invoke({mode:'execute',poison:'after'},'ascii-global-below-admitted'),'__report_guard_detail_poison');await seed({items:10000,cost:'\\'.repeat(1700)});const above=await invoke({mode:'diagnose'},'ascii-global-over-native-upper');assert.ok(above.admission.probe_largest<1800000);assert.ok(above.admission.detail_upper>32*1024*1024);await rejectWithPoison('ascii-global-over',{mode:'execute'},'report_totals_bytes',413)})
  await test('ordinary printable ASCII exact width avoids a worst2x false refusal',async()=>{await seed({items:10000,cost:'x'.repeat(3000)});const value=await invoke({mode:'diagnose'},'ordinary-ascii-exact-width');assert.equal(value.kind,'diagnostic');assert.ok(value.admission.probe_largest<1800000);assert.ok(value.admission.detail_upper+value.control+value.state.postUpper+value.state.postRequestUpper<32*1024*1024);nativeFailure(await invoke({mode:'execute',poison:'after'},'ordinary-ascii-exact-width-admitted'),'__report_guard_detail_poison')})
  await test('empty arrays exact framing plus model byte cap and cap-minus-one include control/request',async()=>{await seed({headers:0,items:0});const empty=await invoke({mode:'direct'},'empty-native-arrays');assert.equal(empty.kind,'direct-success');assert.equal(empty.actual_detail_arrays_utf8,16);assert.equal(empty.admission.detail_upper,16);let cap=32*1024*1024,last=null,converged=false;for(let index=0;index<8;index++){const diagnostic=await invoke({mode:'diagnose',policy:{maxBytes:cap}},'empty-cap-fixed-point-'+index);assert.equal(diagnostic.kind,'diagnostic');const next=diagnostic.control+diagnostic.admission.detail_upper+diagnostic.state.postUpper+diagnostic.state.postRequestUpper;last=diagnostic;if(next===cap){converged=true;break}cap=next}assert.equal(converged,true,'Empty model byte boundary must converge');assert.equal(cap,last.control+last.admission.detail_upper+last.state.postUpper+last.state.postRequestUpper);nativeFailure(await invoke({mode:'direct',policy:{maxBytes:cap},poison:'after'},'empty-exact-cap'),'__report_guard_detail_poison');await rejectWithPoison('empty-cap-minus-one',{mode:'direct',policy:{maxBytes:cap-1}},'report_totals_bytes')})
  await test('control flag payload/bind/request model participates in main cap',async()=>{await exec("INSERT INTO system_flags(key,value)VALUES('maintenance_mode',?)",['n'.repeat(1000)]);const populated=await invoke({mode:'diagnose'},'flag-control-accounted');assert.equal(populated.state.atomicSupported,true);assert.equal(populated.state.firstRestoreChecked,true);assert.ok(populated.state.payloadUpper>1000&&populated.state.bindUpper>1000&&populated.state.requestUpper>0&&populated.state.postRequestUpper>0);let cap=populated.control+populated.admission.detail_upper+populated.state.postUpper+populated.state.postRequestUpper,converged=false;for(let index=0;index<8;index++){const value=await invoke({mode:'diagnose',policy:{maxBytes:cap}},'flag-cap-fixed-point-'+index);const next=value.control+value.admission.detail_upper+value.state.postUpper+value.state.postRequestUpper;if(next===cap){converged=true;break}cap=next}assert.equal(converged,true,'Flag model byte boundary must converge');nativeFailure(await invoke({mode:'direct',policy:{maxBytes:cap},poison:'after'},'flag-exact-main-cap'),'__report_guard_detail_poison');await rejectWithPoison('flag-main-cap-minus-one',{mode:'direct',policy:{maxBytes:cap-1}},'report_totals_bytes');await exec("DELETE FROM system_flags WHERE key='maintenance_mode'")})
  await test('flag32MiB prefix refuses before any value/raw-token payload follower',async()=>{await (async()=>{
   const before=await raw.prepare("SELECT COUNT(*)AS n FROM system_flags WHERE key='stock_transaction_permit'").all();assert.equal(before.results[0].n,0)
   life('selected-maintenance-fixture-permit-before')
   const seeded=await raw.batch([
    raw.prepare("INSERT INTO system_flags(key,value)SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
    raw.prepare("INSERT INTO system_flags(key,value)VALUES('maintenance',?),('maintenance_mode',?)").bind('x'.repeat(1800000),'y'.repeat(1800000)),
    raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
   ])
   recordSetup('selected-maintenance-fixture-stock-permit',seeded)
   const after=await raw.prepare("SELECT COUNT(*)AS n FROM system_flags WHERE key='stock_transaction_permit'").all();assert.equal(after.results[0].n,0)
   recordHash('selected-maintenance-fixture-permit.json',{before,seeded,after});recordHash('setup.json',setup);life('selected-maintenance-fixture-permit-after')
  })();await rejectWithPoison('flag-global-over',{mode:'execute',stage:'flags'},'report_flags_bytes',413);await exec("DELETE FROM system_flags WHERE key IN('maintenance','maintenance_mode')")})
  await test('flag100000-row prefix cap is native and before payload even in unsupported legacy shape',async()=>{await exec("WITH RECURSIVE n(x)AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000)INSERT INTO system_flags(key,value)SELECT 'maintenance',NULL FROM n",[],flags);nativeFailure(await invoke({mode:'execute',flagsDb:true,stage:'flags',poison:'after'},'flag100000-admitted'),'__report_guard_detail_poison');await exec("INSERT INTO system_flags(key,value)VALUES('maintenance',NULL)",[],flags);await rejectWithPoison('flag100001',{mode:'execute',flagsDb:true,stage:'flags'},'report_flags_rows',413)})
  await test('bounded control-row branch uses actual flag builder under a lowered private cap',async()=>{await exec("INSERT INTO system_flags(key,value)VALUES('maintenance_mode',?)",['x'.repeat(1000)]);await rejectWithPoison('flag-control-row-over',{mode:'prefetch',stage:'flags',policy:{maxControlRowBytes:100}},'report_flags_bytes',413);await exec("DELETE FROM system_flags WHERE key='maintenance_mode'")})
  await test('six groups include a nonzero delivery fee in the same native admission',async()=>{
   await seed({cost:2})
   const idRows=await raw.batch([raw.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM delivery_contacts'),raw.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM fees')])
   const contactId=idRows[0].results[0].id,feeId=idRows[1].results[0].id
   assert.ok(Number.isSafeInteger(contactId)&&contactId>0&&Number.isSafeInteger(feeId)&&feeId>0,'Isolated fixture IDs must be safe positive integers')
   recordSetup('six-group-fixture-id-allocation',idRows);recordHash('six-group-fixture-id-allocation.json',{idRows,contactId,feeId})
   await exec("INSERT INTO delivery_contacts(id,name)VALUES(?,'Guard courier')",[contactId])
   await exec("INSERT INTO fees(id,fee_type,fee_date,sale_id,branch_id,delivery_contact_id,amount_usd,amount_khr,created_at)VALUES(?,'delivery','2026-09-13',NULL,1,?,2.5,1000,'2026-09-13 01:00:00')",[feeId,contactId])
   const helper=await invoke({mode:'execute',fees:true},'six-group-fee-helper'),oracle=await invoke({mode:'full-oracle',fees:true},'six-group-fee-full-oracle')
   assert.equal(helper.kind,'application-success');assert.equal(oracle.kind,'full-oracle-success');assert.deepEqual(helper.value,oracle.value,'Complete helper result/diagnostic must match actual full-reader reducer')
   assert.equal(helper.value.row_count,3);assert.equal(oracle.snapshot.sales.length,1);assert.equal(oracle.snapshot.items.length,1);assert.equal(oracle.snapshot.deliveryFees.length,1)
   assert.equal(oracle.snapshot.deliveryFees[0].amount_usd,2.5);assert.equal(oracle.snapshot.deliveryFees[0].amount_khr,1000)
   const direct=await invoke({mode:'direct',fees:true},'six-group-fee-admitted')
   assert.equal(direct.kind,'direct-success');assert.equal(direct.admission.data_rows,3);assert.equal(direct.admission.rows_deliveryFees,1);assert.equal(direct.admission.rows_sales,1);assert.equal(direct.admission.rows_items,1)
   assert.equal(direct.calls.find(call=>call.phase==='guard').arity,8,'One fence + one shared admission + six detail groups')
   nativeFailure(await invoke({mode:'direct',fees:true,policy:{maxRows:3},poison:'after'},'six-group-fee-exact-row-cap'),'__report_guard_detail_poison')
   nativeFailure(await invoke({mode:'direct',fees:false,policy:{maxRows:2},poison:'after'},'five-group-without-fee-exact-row-cap'),'__report_guard_detail_poison')
   await rejectWithPoison('six-group-fee-shared-row-over',{mode:'direct',fees:true,policy:{maxRows:2}},'report_totals_rows')
   await exec('DELETE FROM fees WHERE id=?',[feeId]);await exec('DELETE FROM delivery_contacts WHERE id=?',[contactId])
  })
  await seed({cost:2});const restored=await invoke({mode:'execute'},'restored-positive-helper');assert.equal(restored.kind,'application-success')
  assert.equal(checks.length,15,'All bounded-batch resource groups must complete')
  for(const [name,text]of sources)assert.equal(sha(fs.readFileSync(path.join(root,name),'utf8')),sha(text),'Loaded source changed during the regression: '+name)
  const bindingDigest=value=>sha(JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
  summary={status:'PASS',checks:checks.length,requests:sequence,migrations:migrations.length,source_files:sources.size,analytics_sha256:sha(analytics),worker_sha256:sha(worker),worker_hash_basis:'CRLF normalized to LF',bundle_sha256:sha(bundle),loaded_source_bindings_sha256:bindingDigest(sourceHashes),test_source_bindings_sha256:bindingDigest(testSourceHashes),observation_bindings_sha256:bindingDigest(hashes),scope:'Current public totals helper and generated native guards; shared production caps, native poison ordering, named no-throw guard mutants, and lowered model boundaries. Data-write triggers are removed only from four pressure-fixture tables; system_flags guards and permit-balanced maintenance setup remain. This fixture is not financial history. No CPU, peak-memory, provider-wire, auth, call-quota, Free-plan or deployment certification.'}
 }finally{await mf.dispose()}
 life('complete',{checks:checks.length});console.log(JSON.stringify({...summary,disposed:true}))
}
main().catch(error=>{console.error('Bounded-batch regression failed at',JSON.stringify(lastStage));console.error(error);process.exitCode=1})
