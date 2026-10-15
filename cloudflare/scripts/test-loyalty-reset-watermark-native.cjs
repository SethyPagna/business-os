const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto'), { build } = require('esbuild'), { Miniflare,Log,LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = process.env.LOYALTY_RESET_BASELINE || path.resolve(__dirname,'..')
const script = `
import worker from './src/index.ts';
import { getDb } from './src/lib/db.ts';
import { loyaltyAccrualSql } from './src/lib/loyaltyEligibility.ts';
import { readCustomerPointsRaw, prepareCustomerAssignments } from './src/lib/saleCustomerAssignmentGuard.ts';
let active=[],wrapped;
const note=(sql,r)=>active.push({sql,rows:r.results?.length||0,meta:r.meta});
function statement(sql,s){return {inner:s,sql,bind(...v){return statement(sql,s.bind(...v))},async all(){const r=await s.all();note(sql,r);return r},async run(){const r=await s.run();note(sql,r);return r},async first(c){const r=await this.all();return c?r.results[0]?.[c]??null:r.results[0]??null}}}
export default {async fetch(request,env,ctx){
const input=await request.json();
if(input.op==='seed'){for(const s of input.statements){try{await env.DB.prepare(s.sql).bind(...(s.params||[])).run()}catch(e){return Response.json({error:String(e),sql:s.sql})}}return Response.json({ok:true})}
if(input.op==='migrate'){await env.DB.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)').run();if(await env.DB.prepare('SELECT 1 FROM d1_migrations WHERE name=?').bind(input.name).first())return Response.json({ok:true,replayed:true});try{await env.DB.batch([...input.statements.map(sql=>env.DB.prepare(sql)),env.DB.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(input.name)]);return Response.json({ok:true})}catch(error){return Response.json({error:String(error)})}}
if(input.op==='pointsRaw')return Response.json(await readCustomerPointsRaw(getDb(env),input.customerId));
if(input.op==='assign'){try{const db=getDb(env),guard=await prepareCustomerAssignments(db,[input.move]);await db.batch([guard.pre,{sql:'UPDATE sales SET customer_id=@target WHERE id=@id',params:{target:input.move.targetId,id:input.move.id}},guard.post]);return Response.json({ok:true})}catch(error){return Response.json({ok:false,status:error.status,message:String(error)})}}
if(input.op==='read')return Response.json((await env.DB.prepare(input.sql).all()).results);
if(!wrapped)wrapped={prepare:sql=>statement(sql,env.DB.prepare(sql)),async batch(items){const r=await env.DB.batch(items.map(x=>x.inner));r.forEach((v,i)=>note(items[i].sql,v));return r}};
active=[];const pending=[],started=Date.now();const saved=globalThis.caches;globalThis.caches={default:{match:async()=>undefined,put:async()=>{},delete:async()=>false}};
const headers={cookie:'bos_session='+input.token,origin:'https://admin.scope.example','content-type':'application/json'};
const response=await worker.fetch(new Request('https://admin.scope.example'+input.path,{method:input.method||(input.body?'POST':'GET'),headers,...(input.body?{body:JSON.stringify(input.body)}:{})}),{...env,DB:wrapped,BROADCAST_HUB:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({recipients:0})})}},{waitUntil(p){pending.push(p)},passThroughOnException(){}});
await Promise.allSettled(pending);globalThis.caches=saved;return Response.json({status:response.status,body:await response.text().then(text=>{try{return JSON.parse(text)}catch{return text}}),log:active,wallMs:Date.now()-started});
}};`
async function main(){
const bundle=await build({stdin:{resolveDir:root,loader:'ts',contents:script},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:*','cloudflare:workers'],logLevel:'silent'})
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],port:0,d1Databases:['DB'],kvNamespaces:['CACHE'],bindings:{PLAN_TIER:process.env.LOYALTY_TEST_TIER||'free',BUSINESS_OS_ADMIN_URL:'https://admin.scope.example'},log:new Log(LogLevel.ERROR)})
const call=async input=>(await mf.dispatchFetch('http://local/',{method:'POST',body:JSON.stringify(input)})).json()
const seed=async statements=>{const r=await call({op:'seed',statements});assert.equal(r.ok,true,JSON.stringify(r))}
try{
const files=fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort()
const isReset=n=>/loyalty_points_watermark/.test(n)
const apply=async names=>{const list=[];for(const name of names)for(const sql of split(fs.readFileSync(path.join(root,'migrations',name),'utf8'))){if(name==='0098_user_aliases.sql'&&/^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim()))continue;list.push({sql})}for(let i=0;i<list.length;i+=50)await seed(list.slice(i,i+50))}
await apply(files.filter(n=>!isReset(n)))
const token='synthetic-reset-session',hash=createHash('sha256').update(token).digest('hex')
const old="datetime('now','-3 days')"
await seed([
{sql:"INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('admin','Administrator','{\"all\":true}')"},
{sql:"INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 71,'synthetic-reset','Reset admin','fixture',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1"},
{sql:'INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(71,?,?,?,?)',params:[hash,new Date(Date.now()-3600000).toISOString(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString()]},
...Object.entries({loyalty_points_enabled:'true',customer_portal_points_basis:'usd',customer_portal_points_per_usd:'1.5',notifications_loyalty_threshold:'1',customer_portal_redeem_points:'100',exchange_rate:'4000'}).map(([key,value])=>({sql:'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',params:[key,value]})),
{sql:"INSERT INTO customers(id,name,membership_number) VALUES(9901,'Synthetic reset witness','LC-9901')"},
{sql:"INSERT INTO sales(id,receipt_number,customer_id,total_usd,total_khr,sale_status,loyalty_accrual,created_at) VALUES(9001,'PRE-EARNED',9901,100,400000,'completed',1,"+old+"),(9002,'PRE-SPENT',9901,10,40000,'completed',1,"+old+")"},
{sql:"UPDATE sales SET membership_points_redeemed=5 WHERE id=9002"},
{sql:"INSERT INTO returns(return_number,customer_id,sale_id,return_scope,status,total_refund_usd,total_refund_khr,created_at) VALUES('PRE-RETURN',9901,9001,'customer','completed',60,240000,"+old+")"},
{sql:"INSERT INTO loyalty_point_adjustments(customer_id,points,created_at) VALUES(9901,1000,"+old+")"},
{sql:"INSERT INTO loyalty_point_adjustments(customer_id,points,created_at) VALUES(9901,7,datetime('now','+3 days'))"},
{sql:"INSERT INTO customer_share_submissions(customer_id,status,reward_points,reviewed_at,created_at) VALUES(9901,'approved',500,"+old+","+old+")"},
{sql:"INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Synthetic shop','shop',1,1)"},
{sql:"INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(10,'Powder','RESET-PRODUCT',10,9.5,38000,4,16000,1)"},
{sql:'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)'},
{sql:"INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number) VALUES(500,10,'reset-lot','RESET-LOT','2027-06-01','2026-09-01',1,1)"},
{sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)'}])
const request=async(p,body,method)=>call({path:p,token,body,method})
const readers=async()=>{
 const member=await request('/api/customers/membership/LC-9901');assert.equal(member.status,200,JSON.stringify(member.body))
 const list=await request('/api/customers?search=LC-9901');assert.equal(list.status,200,JSON.stringify(list.body))
 const rows=Array.isArray(list.body)?list.body:(list.body.items||list.body.rows||list.body.data||[]);const row=rows.find(x=>x.id===9901);assert.ok(row,'customer list row '+JSON.stringify(list.body).slice(0,300))
 const summary=await request('/api/customers/points-summary');assert.equal(summary.status,200,JSON.stringify(summary.body));const sumRows=Array.isArray(summary.body)?summary.body:(summary.body.items||summary.body.rows||[]);const sum=sumRows.find(x=>x.id===9901)
 const note=await request('/api/notifications/summary');assert.equal(note.status,200,JSON.stringify(note.body));const section=note.body.sections.find(x=>x.id==='loyalty');const item=section&&section.items.find(x=>x.id==='loyalty-9901')
 return {member:member.body.points.balance,list:Number(row.points_balance),summary:sum?Number(sum.points_balance):null,notification:item?Number(item.meta.split(' ')[0]):0}}
const parity=async(expected,label)=>{const r=await readers();for(const [name,value] of Object.entries(r))assert.equal(value,expected,label+': reader '+name+' = '+value+', expected '+expected)}

const checkSql=fs.readFileSync(path.join(__dirname,'..','..','ops','queries','loyalty-reset-check.sql'),'utf8').replace(/\r\n/g,'\n').split('\n').filter(l=>!l.startsWith('--')).join('\n').trim().replace(/;$/,'')
assert.ok(/^WITH\b/i.test(checkSql)&&!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH)\b/i.test(checkSql),'the ops check is SELECT-only')
const opsCheck=async()=>(await call({op:"read",sql:checkSql}))[0]
const resetStatements=split(fs.readFileSync(path.join(root,'migrations',files.find(isReset)),'utf8'))
const failedReset=await call({op:'migrate',name:files.find(isReset),statements:[...resetStatements, 'SELECT * FROM synthetic_missing_reset_table']});assert.ok(failedReset.error,'failure control must refuse the migration')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM system_flags WHERE key='loyalty_points_reset'"}))[0].n,0,'failed migration rolls back checkpoint')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM pragma_table_info('customer_share_submissions') WHERE name='loyalty_eligible'"}))[0].n,0,'failed migration rolls back ALTER and triggers')
assert.equal((await call({op:'migrate',name:files.find(isReset),statements:resetStatements})).ok,true)
const mark=(await call({op:'read',sql:"SELECT value FROM system_flags WHERE key='loyalty_points_reset'"}))[0]
assert.ok(mark && JSON.parse(mark.value).sales === 9002, 'reset captures immutable sales identity')
assert.equal((await call({op:'read',sql:"SELECT value FROM settings WHERE key='loyalty_points_enabled'"}))[0].value,'false','reset defaults loyalty off')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM sales WHERE id IN (9001,9002) AND created_at<datetime('now','-2 days')"}))[0].n,2,'history rows untouched')
await parity(0,'reset excludes every pre-existing row, including future business dates')
assert.equal(await call({op:'pointsRaw',customerId:9901}),0,'raw zero cannot be a clamped negative debt')
await seed([{sql:"UPDATE customer_share_submissions SET reviewed_at=datetime('now','+1 day') WHERE id=1"},{sql:"UPDATE loyalty_point_adjustments SET created_at=(SELECT json_extract(value,'$.reset_at') FROM system_flags WHERE key='loyalty_points_reset') WHERE id=1"}])
await parity(0,'old approvals and same-instant history cannot regain cleared points')
const afterMigration=await opsCheck();assert.deepEqual([afterMigration.customers_nonzero_all_history,afterMigration.customers_nonzero_after_reset,afterMigration.customers_cleared_by_reset,afterMigration.customers_total],[1,0,1,1],'ops check: '+JSON.stringify(afterMigration));assert.ok(/^\d{4}-/.test(afterMigration.reset_at))
const checkout=(points,id)=>({offline_owner:{version:1,actor_id:71,organization_id:null,authority:'https://admin.scope.example',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,applied_price_usd:9.5,client_line_key:'reset-line',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:Number((9.5-points/100).toFixed(2)),customer_id:9901,membership_points_redeemed:points,membership_discount_usd:Number((points/100).toFixed(2)),loyalty_accrual:false,client_request_id:id})
const offRedeem=await request('/api/sales',checkout(1,'reset-off-redeem'));assert.equal(offRedeem.status,400,'loyalty off refuses spending')
const enable=await request('/api/settings',{loyalty_points_enabled:'true'});assert.equal(enable.status,200,JSON.stringify(enable.body))
const preRedeem=await request('/api/sales',checkout(1,'reset-pre-redeem'));assert.equal(preRedeem.status,409,'redeeming a pre-reset point is refused: '+JSON.stringify(preRedeem.body))

await seed([{sql:"INSERT INTO sales(id,receipt_number,customer_id,total_usd,total_khr,sale_status,loyalty_accrual) VALUES(9003,'POST-EARNED',9901,10,40000,'completed',1)"}])
await parity(15,'a sale after the watermark accrues normally')
await seed([{sql:"INSERT INTO returns(return_number,customer_id,sale_id,return_scope,status,total_refund_usd,total_refund_khr,created_at) VALUES('POST-RETURN-OF-PRE',9901,9001,'customer','completed',60,240000,CURRENT_TIMESTAMP)"}])
await parity(15,'a return of a pre-watermark sale takes back nothing, so cleared points never push the balance down')
await seed([{sql:"INSERT INTO returns(return_number,customer_id,sale_id,return_scope,status,total_refund_usd,total_refund_khr,created_at) VALUES('POST-RETURN',9901,9003,'customer','completed',1,4000,CURRENT_TIMESTAMP)"}])
await parity(13.5,'a return of a post-watermark sale deducts')
const over=await request('/api/sales',checkout(14,'reset-over'));assert.equal(over.status,409,'redemption beyond the post-watermark balance is refused: '+JSON.stringify(over.body))
const ok=await request('/api/sales',checkout(12,'reset-ok'));assert.equal(ok.status,200,JSON.stringify(ok.body))
await parity(1.5,'after redeeming 12 of 13.5')
await seed([{sql:"INSERT INTO loyalty_point_adjustments(customer_id,points) VALUES(9901,2)"},{sql:"INSERT INTO customer_share_submissions(customer_id,status,reward_points,reviewed_at,loyalty_eligible) VALUES(9901,'approved',3,CURRENT_TIMESTAMP,1)"}])
await parity(6.5,'a manual award and an approved reward after the watermark count')
const afterEarning=await opsCheck();assert.deepEqual([afterEarning.customers_nonzero_all_history,afterEarning.customers_nonzero_after_reset,afterEarning.customers_cleared_by_reset],[1,1,0],'ops check after earning: '+JSON.stringify(afterEarning))

assert.equal((await call({op:'migrate',name:files.find(isReset),statements:resetStatements})).replayed,true,'real migration journal skips already-applied ALTER')
await seed(resetStatements.filter(sql=>/^INSERT/i.test(sql.trim())).map(sql=>({sql})))
assert.equal((await call({op:'read',sql:"SELECT value FROM system_flags WHERE key='loyalty_points_reset'"}))[0].value,mark.value,'migration retry preserves identity')
assert.equal((await call({op:'read',sql:"SELECT value FROM settings WHERE key='loyalty_points_enabled'"}))[0].value,'true','migration retry preserves later switch choice')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM audit_logs WHERE action='reset_data' AND json_extract(details,'$.section')='loyalty'"}))[0].n,1,'reset records one immutable audit event')
await parity(6.5,'migration retry cannot clear later earnings')
await seed([{sql:"INSERT INTO customers(id,name,membership_number) VALUES(9902,'Synthetic reassignment control','LC-9902')"}])
const oldMove=await call({op:'assign',move:{id:9002,sourceId:9901,targetId:9902}});assert.equal(oldMove.ok,true,'cleared old redemption must not block reassignment: '+JSON.stringify(oldMove))
assert.equal(await call({op:'pointsRaw',customerId:9902}),0,'old reassignment creates no debt')
const spentSale=(await call({op:'read',sql:"SELECT id FROM sales WHERE client_request_id='reset-ok'"}))[0].id
const newMove=await call({op:'assign',move:{id:spentSale,sourceId:9901,targetId:9902}});assert.equal(newMove.ok,false,'new redemption cannot move to a customer with no points')
assert.equal((await call({op:'read',sql:'SELECT customer_id FROM sales WHERE id='+spentSale}))[0].customer_id,9901,'refused reassignment changes no sale')

await seed([{sql:"INSERT INTO customers(id,name,membership_number) VALUES(9903,'Synthetic eligibility witness','LC-9903')"}])
const switchTo=async value=>seed(value===undefined?[{sql:"DELETE FROM settings WHERE key='loyalty_points_enabled'"}]:[{sql:"INSERT INTO settings(key,value) VALUES('loyalty_points_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[value]}])
const ownCheckout=(flag,key)=>({...checkout(0,key),customer_id:9903,loyalty_accrual:flag})
const born=[]
for(const [i,value] of [undefined,'garbage','false','true'].entries()){
 await switchTo(value)
 const key='birth-switch-'+i
 const result=await request('/api/sales',ownCheckout(true,key));assert.equal(result.status,200,JSON.stringify(result.body))
 const row=(await call({op:'read',sql:"SELECT id,loyalty_accrual FROM sales WHERE client_request_id='"+key+"'"}))[0]
 assert.equal(row.loyalty_accrual,value==='true'?1:0,'explicit true cannot bypass authoritative switch '+value);born.push(row)
}
const optOut=await request('/api/sales',ownCheckout(false,'birth-on-opt-out'));assert.equal(optOut.status,200,JSON.stringify(optOut.body))
assert.equal((await call({op:'read',sql:"SELECT loyalty_accrual FROM sales WHERE client_request_id='birth-on-opt-out'"}))[0].loyalty_accrual,0,'ON preserves explicit opt-out')
const enabledRaw=await call({op:'pointsRaw',customerId:9903});assert.equal(enabledRaw,14.25,'only one eligible ON-born sale earns')
await switchTo('false')
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw,'OFF preserves existing earned balance')
const freshOffAward=await request('/api/customers/9903/points',{points:4,client_request_id:'birth-off-award'});assert.equal(freshOffAward.status,400,JSON.stringify(freshOffAward.body));assert.equal(freshOffAward.body.code,'loyalty_points_disabled')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM audit_logs WHERE action='award_points' AND entity_id=9903"}))[0].n,0,'OFF refusal has no partial audit')
await seed([{sql:"INSERT INTO sales(receipt_number,customer_id,total_usd,sale_status) VALUES('OLD-WORKER-OFF',9903,80,'awaiting_payment')"},{sql:"INSERT INTO customer_share_submissions(customer_id,status) VALUES(9903,'pending')"}])
const offSubmission=(await call({op:'read',sql:'SELECT MAX(id) id FROM customer_share_submissions'}))[0].id
const offLegacy=(await call({op:'read',sql:"SELECT id,loyalty_accrual FROM sales WHERE receipt_number='OLD-WORKER-OFF'"}))[0];assert.equal(offLegacy.loyalty_accrual,0,'old Worker omitted flag backstop effective before publication')
await switchTo('true')
await seed([{sql:"UPDATE sales SET sale_status='completed' WHERE receipt_number='OLD-WORKER-OFF'"}])
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw,'enabling and paying OFF-born sale does not award history')
const promotion=await call({op:'seed',statements:[{sql:'UPDATE sales SET loyalty_accrual=1 WHERE id='+offLegacy.id}]});assert.match(promotion.error,/loyalty_creation_eligibility_immutable/)
const reward=async(id,points,status='approved')=>request('/api/portal/submissions/'+id+'/review',{status,reward_points:points},'PATCH')
const ineligible=await reward(offSubmission,9);assert.equal(ineligible.status,400,JSON.stringify(ineligible.body))
await seed([{sql:"INSERT INTO customer_share_submissions(customer_id,status,loyalty_eligible) VALUES(9903,'pending',1)"}])
const onSubmission=(await call({op:'read',sql:'SELECT MAX(id) id FROM customer_share_submissions'}))[0].id
assert.equal((await reward(onSubmission,3)).status,200,'eligible ON submission rewards')
assert.equal((await reward(onSubmission,3)).status,200,'same approval does not duplicate')
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw+3)
const award=await request('/api/customers/9903/points',{points:4,client_request_id:'birth-off-award'});assert.equal(award.status,201,JSON.stringify(award.body))
await switchTo('false')
const retry=await request('/api/customers/9903/points',{points:4,client_request_id:'birth-off-award'});assert.equal(retry.status,200);assert.equal(retry.body.replayed,true,'committed retry replays while OFF')
assert.equal((await reward(onSubmission,3)).status,200,'unchanged earned approval survives OFF')
assert.equal((await reward(onSubmission,4)).status,400,'OFF cannot increase reward')
await seed([{sql:"INSERT INTO customer_share_submissions(customer_id,status,loyalty_eligible) VALUES(9903,'pending',1)"}])
const forged=(await call({op:'read',sql:'SELECT loyalty_eligible FROM customer_share_submissions ORDER BY id DESC LIMIT 1'}))[0];assert.equal(forged.loyalty_eligible,0,'OFF submission backstop strips forged birth eligibility')
await seed([{sql:"INSERT INTO returns(return_number,customer_id,sale_id,status,total_refund_usd) VALUES('BIRTH-OFF-REVERSAL',9903,"+born[3].id+",'completed',1)"}])
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw+3+4-1.5,'OFF still reverses eligible earned sale')
await seed([{sql:"INSERT INTO returns(return_number,customer_id,sale_id,status,total_refund_usd) VALUES('BIRTH-OFF-NONE',9903,"+offLegacy.id+",'completed',80)"}])
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw+3+4-1.5,'OFF-born sale return cannot deduct new points')
const snapshot={}
for(const table of ['sales','customer_share_submissions','loyalty_point_adjustments'])snapshot[table]=await call({op:'read',sql:'SELECT * FROM '+table+' WHERE customer_id=9903'})
await seed([{sql:"INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')"}])
for(const [table,rows] of Object.entries(snapshot)){
 for(const row of rows){
  await seed([{sql:'DELETE FROM '+table+' WHERE id=?',params:[row.id]},{sql:'INSERT INTO '+table+' ('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',params:Object.values(row)}])
 }
}
await seed([{sql:"DELETE FROM system_flags WHERE key='maintenance'"}])
assert.equal(await call({op:'pointsRaw',customerId:9903}),enabledRaw+3+4-1.5,'dynamic restore preserves flags and identities while OFF')
const portal=await request('/api/portal/membership/LC-9903');assert.equal(portal.status,403,'public membership stays disabled')
console.log('PASS loyalty reset: immutable identity, future/same-second history, reward re-review, preserved returns/redemption, reader parity, default off and idempotent audited migration')
}finally{await mf.dispose()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
