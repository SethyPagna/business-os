const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const req=createRequire(root+'/cloudflare/package.json'),ts=req('typescript');
const {openDb}=req('./scripts/harness/d1compat.cjs'),{loadAll}=req('./scripts/harness/load_migrations.cjs'),{sqliteD1Call}=req('./scripts/harness/sqlite_d1_bindings.cjs');
function modules(baseline=false){
 const cache=new Map(); function load(rel){if(cache.has(rel))return cache.get(rel).exports;
 const file=root+'/cloudflare/src/'+rel;
 const src=baseline&&rel==='routes/inventory.ts'?execFileSync('git',['show','e42815342b5910e1be87760e70900758d819fccd:cloudflare/src/routes/inventory.ts'],{cwd:root,encoding:'utf8'}):fs.readFileSync(file,'utf8');
 const mod={exports:{}};cache.set(rel,mod);
 const local=name=>{if(name==='./cache'||name==='../lib/cache')return {bumpVersion:async()=>{},getVersion:async()=>0,cacheKey:(...x)=>x.join(':'),cachedJson:async(c,k,t,fn)=>c.json(await fn())};if(name==='../durable-objects/broadcastHub')return {broadcast:async()=>{}};if(name==='../lib/auth')return {requireAuth:async(c,next)=>{c.set('user',{id:101,permissions:'{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"sales":true,"products":true,"branches":true}'});return next()}};
 if(name==='../lib/telegram')return {sendTelegramEvent:async()=>{},formatStockChangeTelegramLines:()=>[],formatTransferTelegramLines:()=>[],formatSaleTelegramLines:()=>[]};
 if(!name.startsWith('.'))return req(name);const next=path.posix.normalize(path.posix.join(path.posix.dirname(rel),name));return load(next.endsWith('.ts')?next:next+'.ts')};
 new Function('require','module','exports',ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText)(local,mod,mod.exports);return mod.exports;
 }return {app:load('routes/inventory.ts').default,kernel:load('lib/stockDisposition.ts'),getDb:load('lib/db.ts').getDb,load};
}
const current=modules();
function fixture(admitted=true){const db=openDb(loadAll()).db;db.limits.variableNumber=100;assert.equal(db.limits.exprDepth,100);
 const seed=`INSERT INTO branches(id,name,is_active,is_default) VALUES(9,'Shop',1,1);
 INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(101,'refuter','Refuter','admin123','{"inventory":true,"product_cost_edit":true,"product_cost_view":true,"fees":true,"sales":true,"products":true,"branches":true}',1);
 INSERT INTO suppliers(id,name) VALUES(31,'Guard supplier');
 INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(91,'Independent lot','R91',3,1);
 INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,payment_status,received_quantity,received_cost_usd,received_branch_id,unit_cost_usd) VALUES(951,91,'R951','R951','2026-10-01',1,1,31,'credit',3,7.0001,9,2.3334);
 INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(951,9,3);
 INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(91,9,3);
 INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,reference_id,user_id) VALUES(991,91,9,951,'add',3,0.5,7.0001,'independent-source',101);
 INSERT INTO stock_disposition_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,funding_state) VALUES('src-independent',991,951,91,9,31,'3','0.5',70001,0,70001,'reconciled_unpaid');
 PRAGMA foreign_keys=ON;`;db.exec(admitted?seed:seed.replace(/ INSERT INTO stock_disposition_sources[^;]+;/,''));
 const f={db,maxBindings:0,initialFees:Number(db.prepare("SELECT COUNT(*) n FROM fees").get().n)};function prep(sql,values=[]){f.maxBindings=Math.max(f.maxBindings,values.length);const run=()=>{const actualSql=f.transform?f.transform(sql):sql;const s=db.prepare(actualSql);if(/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql))return {success:true,results:sqliteD1Call(s,'all',values),meta:{changes:0}};const r=sqliteD1Call(s,'run',values);return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}};return {sql,values,execute:run,bind:(...v)=>prep(sql,v),all:async()=>run(),run:async()=>run(),first:async()=>run().results[0]??null}}
 f.d1={prepare:prep,batch:async ss=>{f.batchCount=ss.length;if(f.before){const fn=f.before;delete f.before;await fn(db,ss)}db.exec('BEGIN IMMEDIATE');try{const result=ss.map((s,i)=>{if(i===f.fail)throw Error('independent failure');return s.execute()});db.exec('COMMIT');if(f.after){const fn=f.after;delete f.after;fn(db)}if(f.lost){delete f.lost;throw Error('independent lost response')}return result}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e}}};return f;
}
const hold=(extra={})=>({kind:'hold',source_id:'src-independent',batch_id:951,product_id:91,branch_id:9,supplier_id:31,quantity:1,coverage_usd:1.2,coverage_state:'accepted_credit',condition_tag:'expired',reason:'Independent hold',extra_fee_usd:0.4,expected_generation:0,client_request_id:'independent-hold-001',...extra});
async function post(f,body,mod=current,enabled=true){const r=await mod.app.request('/disposition-experiment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{DB:f.d1,...(enabled?{STOCK_DISPOSITION_EXPERIMENT:'local-fixture-only'}:{})},{waitUntil(){},passThroughOnException(){}});return {status:r.status,data:await r.json().catch(()=>null)}}
const count=(f,t)=>Number(f.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
const snapshot=f=>JSON.stringify(['branch_stock','branch_batch_stock','products','stock_disposition_allocations','stock_disposition_events','stock_disposition_receipts','stock_disposition_fees','fees','fee_operation_receipts','audit_logs'].map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()));
let failed=0,passed=0;
async function call(f,url,body,app=current.app,method='POST'){const r=await app.request(url,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.d1},{waitUntil(p){Promise.resolve(p).catch(()=>{})},passThroughOnException(){}});return {status:r.status,data:await r.json().catch(()=>null)}}
const editBody=f=>({quantity:4,unit_cost_usd:2.3334,expected_batch_revision:f.db.prepare("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key='951'),0) n").get().n,client_request_id:'guard-pencil-001'});
const transferBody={transfer_provenance_version:1,productId:91,fromBranchId:9,toBranchId:8,batchId:951,quantity:1,reason:'Guard transfer',client_request_id:'guard-transfer-001'};
const saleBody={money_precision_version:1,offline_owner:{version:1,actor_id:101,organization_id:null,authority:'http://localhost',runtime:'cloudflare-workers'},branch_id:9,sale_status:'completed',client_request_id:'guard-sale-001',exchange_rate:4000,items:[{product_id:91,quantity:1,branch_id:9,batch_id:951,price_usd:5,price_khr:20000,client_line_key:'guard-sale-line',pricing_source:'selling',display_price_mode:'selling',pricing_quote:{gross_usd:5,product_discount_usd:0,manual_discount_usd:0,total_usd:5,total_khr:20000}}],payment_method:'Cash',amount_paid_usd:5,amount_paid_khr:0};
async function check(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+' '+e.message)}}
async function refused(name,fn){await check(name,async()=>{const f=fixture();try{f.db.exec("INSERT INTO branches(id,name,is_active) VALUES(8,'Warehouse',1);UPDATE products SET selling_price_usd=5 WHERE id=91;INSERT INTO products(id,name,sku,stock_quantity,is_active) VALUES(92,'Independent lot','R92',0,1)");const h=await post(f,hold());assert.equal(h.status,200,JSON.stringify(h));const before=snapshot(f),r=await fn(f);assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.data.code,'stock_lifecycle_dependency',JSON.stringify(r));assert.equal(snapshot(f),before)}finally{f.db.close()}})}
(async()=>{
await refused('pencil dependency',f=>call(f,'/stock-in-lines/991/edit',editBody(f)));
await refused('official Revert dependency',f=>call(f,'/movements/991/revert',{}));
await refused('selected lot transfer dependency',f=>call(f,'/transfer',transferBody));
await refused('POS source consumption dependency',f=>call(f,'/',saleBody,current.load('routes/sales.ts').default));
await refused('Product Remove dependency',f=>call(f,'/91',{reason:'Guard remove',client_request_id:'guard-remove-001'},current.load('routes/products.ts').default,'DELETE'));
await refused('Resolve merge lineage dependency',async f=>{return call(f,'/possible-duplicates/merge',{keepId:92,mergeId:91,stock:'merge'},current.load('routes/products.ts').default)});
await refused('linked fee edit dependency',f=>call(f,'/'+f.db.prepare('SELECT fee_id FROM stock_disposition_fees LIMIT 1').get().fee_id,{fee_money_version:1,amount_usd:0.5},current.load('routes/fees.ts').default,'PUT'));
await refused('linked fee delete dependency',f=>call(f,'/'+f.db.prepare('SELECT fee_id FROM stock_disposition_fees LIMIT 1').get().fee_id,undefined,current.load('routes/fees.ts').default,'DELETE'));
console.log(JSON.stringify({passed,failed}));if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
