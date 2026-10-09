const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto'), { build } = require('esbuild'), { Miniflare,Log,LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = process.env.LOYALTY_SCOPE_BASELINE || path.resolve(__dirname,'..')
const script = `
import worker from './src/index.ts';
let active=[],wrapped;
const note=(sql,r)=>active.push({sql,rows:r.results?.length||0,meta:r.meta});
function statement(sql,s){return {inner:s,sql,bind(...v){return statement(sql,s.bind(...v))},async all(){const r=await s.all();note(sql,r);return r},async run(){const r=await s.run();note(sql,r);return r},async first(c){const r=await this.all();return c?r.results[0]?.[c]??null:r.results[0]??null}}}
export default {async fetch(request,env,ctx){
const input=await request.json();
if(input.op==='seed'){for(const s of input.statements){try{await env.DB.prepare(s.sql).bind(...(s.params||[])).run()}catch(e){return Response.json({error:String(e),sql:s.sql})}}return Response.json({ok:true})}
if(input.op==='read')return Response.json((await env.DB.prepare(input.sql).all()).results);
if(!wrapped)wrapped={prepare:sql=>statement(sql,env.DB.prepare(sql)),async batch(items){const r=await env.DB.batch(items.map(x=>x.inner));r.forEach((v,i)=>note(items[i].sql,v));return r}};
active=[];const pending=[],started=Date.now();const saved=globalThis.caches;globalThis.caches=undefined;
const headers={cookie:'bos_session='+input.token,origin:'https://admin.scope.example','content-type':'application/json'};
const response=await worker.fetch(new Request('https://admin.scope.example'+input.path,{method:input.body?'POST':'GET',headers,...(input.body?{body:JSON.stringify(input.body)}:{})}),{...env,DB:wrapped},{waitUntil(p){pending.push(p)},passThroughOnException(){}});
await Promise.allSettled(pending);globalThis.caches=saved;return Response.json({status:response.status,body:await response.text().then(text=>{try{return JSON.parse(text)}catch{return text}}),log:active,wallMs:Date.now()-started});
}};`
async function main(){
const bundle=await build({stdin:{resolveDir:root,loader:'ts',contents:script},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:*','cloudflare:workers'],logLevel:'silent'})
for(const tier of ['free','paid']){
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',compatibilityFlags:['nodejs_compat'],port:0,d1Databases:['DB'],kvNamespaces:['CACHE'],bindings:{PLAN_TIER:tier,BUSINESS_OS_ADMIN_URL:'https://admin.scope.example'},log:new Log(LogLevel.ERROR)})
const call=async input=>(await mf.dispatchFetch('http://local/',{method:'POST',body:JSON.stringify(input)})).json()
const seed=async statements=>{const r=await call({op:'seed',statements});assert.equal(r.ok,true,JSON.stringify(r))}
try{
const migrations=[];for(const name of fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())for(const sql of split(fs.readFileSync(path.join(root,'migrations',name),'utf8'))){if(name==='0098_user_aliases.sql'&&/^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim()))continue;migrations.push({sql})}
for(let i=0;i<migrations.length;i+=50)await seed(migrations.slice(i,i+50))
const token='synthetic-scope-session',hash=createHash('sha256').update(token).digest('hex')
await seed([
{sql:"INSERT OR IGNORE INTO roles(code,name,permissions) VALUES('admin','Administrator','{\"all\":true}')"},
{sql:"INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 71,'synthetic-scope','Scope admin','fixture',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1"},
{sql:'INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(71,?,?,?,?)',params:[hash,new Date(Date.now()-3600000).toISOString(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString()]},
...Object.entries({loyalty_points_enabled:'true',customer_portal_points_basis:'usd',customer_portal_points_per_usd:'1.5',notifications_loyalty_threshold:'14',customer_portal_redeem_points:'100',exchange_rate:'4000'}).map(([key,value])=>({sql:'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',params:[key,value]})),
{sql:"INSERT INTO customers(id,name,membership_number) VALUES(9901,'Synthetic scope witness','LC-9901')"},
{sql:"INSERT INTO sales(receipt_number,customer_id,total_usd,total_khr,sale_status,loyalty_accrual) VALUES('SCOPE-EARNED',9901,10,40000,'completed',1)"},
{sql:"INSERT INTO returns(return_number,customer_id,return_scope,status,total_refund_usd,total_refund_khr) VALUES('SCOPE-SUPPLIER',9901,'supplier','completed',1,4000),('SCOPE-CANCELLED',9901,'customer','cancelled',1000,4000000)"},
{sql:"INSERT INTO loyalty_point_adjustments(customer_id,points,voided_at) VALUES(9901,1000,CURRENT_TIMESTAMP)"},
{sql:"INSERT INTO customer_share_submissions(customer_id,status,reward_points,reward_points_voided_at) VALUES(9901,'approved',1000,CURRENT_TIMESTAMP)"},
{sql:"INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Synthetic shop','shop',1,1)"},
{sql:"INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(10,'Powder','SCOPE-PRODUCT',10,9.5,38000,4,16000,1)"},
{sql:'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)'},
{sql:"INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number) VALUES(500,10,'scope-lot','SCOPE-LOT','2027-06-01','2026-09-01',1,1)"},
{sql:'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,10)'}])
const request=async(path,body)=>{const r=await call({path,token,body});assert.ok(r.log.length<=(tier==='free'?50:1000),JSON.stringify({tier,path,queries:r.log.length,status:r.status,body:r.body}));console.log(JSON.stringify({tier,path,status:r.status,queries:r.log.length,rowsRead:r.log.reduce((n,x)=>n+(x.meta?.rows_read||0),0),rowsWritten:r.log.reduce((n,x)=>n+(x.meta?.rows_written||0),0),wallMs:r.wallMs}));return r}
const membership=async expected=>{const r=await request('/api/customers/membership/LC-9901');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.points.balance,expected)}
const notification=async expected=>{const r=await request('/api/notifications/summary');assert.equal(r.status,200,JSON.stringify(r.body));const section=r.body.sections.find(x=>x.id==='loyalty');if(expected===null)assert.ok(!section);else assert.equal(section.items.find(x=>x.id==='loyalty-9901').meta,expected+' points')}
await notification(15);if(process.argv[2]!=='checkout')await membership(15)
await seed([{sql:"INSERT INTO returns(return_number,customer_id,return_scope,status,total_refund_usd,total_refund_khr) VALUES('SCOPE-CUSTOMER',9901,'customer','completed',1,4000)"}])
if(process.argv[2]!=='checkout')await membership(13.5);await notification(null)
await seed([{sql:"INSERT INTO returns(return_number,customer_id,return_scope,status,total_refund_usd,total_refund_khr) VALUES('SCOPE-LEGACY',9901,NULL,'completed',1,4000)"}]);if(process.argv[2]!=='checkout')await membership(12);await notification(null)
const checkout={offline_owner:{version:1,actor_id:71,organization_id:null,authority:'https://admin.scope.example',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{product_id:10,quantity:1,branch_id:1,batch_id:500,applied_price_usd:9.5,client_line_key:'scope-line',pricing_source:'selling',pricing_quote:{gross_usd:9.5,product_discount_usd:0,manual_discount_usd:0,total_usd:9.5,total_khr:38000}}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:9.38,customer_id:9901,membership_points_redeemed:12,membership_discount_usd:0.12,loyalty_accrual:false,client_request_id:'scope-redeem'}
const invalid=await request('/api/sales',{...checkout,membership_points_redeemed:13,client_request_id:'scope-excess'});assert.equal(invalid.status,409,JSON.stringify(invalid.body));assert.equal(invalid.body.code,'loyalty_redemption_conflict')
assert.equal((await call({op:'read',sql:"SELECT COUNT(*) n FROM sales WHERE client_request_id='scope-excess'"}))[0].n,0)
const redeemed=await request('/api/sales',checkout);assert.equal(redeemed.status,200,JSON.stringify(redeemed.body));await membership(0);await notification(null)
const stock=await call({op:'read',sql:'SELECT quantity FROM branch_batch_stock WHERE batch_id=500'});assert.equal(stock[0].quantity,9)
const replay=await request('/api/sales',checkout);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal((await call({op:'read',sql:'SELECT quantity FROM branch_batch_stock WHERE batch_id=500'}))[0].quantity,9)
console.log('PASS '+tier+' actual full Worker/auth/native D1 supplier exclusion, customer/NULL refunds, cancelled/void exclusion, excess refusal, exact checkout and replay')
}finally{await mf.dispose()}
}}
main().catch(e=>{console.error(e);process.exitCode=1})
