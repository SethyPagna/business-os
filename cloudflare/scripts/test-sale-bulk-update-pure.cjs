// Conditional bulk sale field updates through the real Hono routes and SQLite transactions.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
let user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set(['db','permissions','saleBulkStatus','saleBulkUpdate','saleTransitions','sqlBinding','productBatches','batchCode','salesStatus','undoAppliers','branchWrites','conflictControl','searchMatch'])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel,mod)
  const source = fs.readFileSync(path.join(root,'src',rel),'utf8')
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const req = name => {
    if (name==='hono') return require(name)
    if (name.endsWith('/auth')) return { requireAuth: async(c,next)=>{c.set('user',user);return next()} }
    if (name.endsWith('/cache')) return {bumpVersion:async()=>{},getVersionWithFallback:async()=>0}
    if (name.endsWith('/broadcastHub')) return {broadcast:async()=>{}}
    if (name.endsWith('/audit')) return {audit:async()=>{}}
    if (name.startsWith('.')) {
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(rel),name))+'.ts'
      if(actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require','module','exports',output)(req,mod,mod.exports)
  return mod.exports
}
const sales = load('routes/sales.ts').default
const history = load('routes/actionHistory.ts').default
function fixture() {
  const sql=new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for(const file of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'))
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO customers(id,name,phone,address) VALUES(1,'Old','011','Old road'),(2,'Other','022','Other road'),(3,'New','033','New road');
    INSERT INTO delivery_contacts(id,name,phone,area,address) VALUES(1,'Driver A','111','A area','A road'),(2,'Driver B','222','B area','B road');
    INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_name,customer_id,customer_name,customer_phone,customer_address,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,is_delivery,delivery_contact_id,delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_actual_cost_usd,updated_at)
    VALUES
      (1,'R1','completed',1,'Shop','Cashier',1,'Old','011','Old road','Cash + ABA','[{"method":"Cash","amount_usd":3,"amount_khr":0},{"method":"ABA","amount_usd":7,"amount_khr":0}]','USD',4100,10,0,1,0,1,1,'Driver A','111','A road',2,'same-second'),
      (2,'R2','completed',1,'Shop','Cashier',1,'Old','011','Old road','Cash','[{"method":"Cash","amount_usd":2.5,"amount_khr":0}]','USD',4200,2.5,0,0,0,1,1,'Driver A','111','A road',1,'same-second'),
      (3,'R3','completed',1,'Shop','Cashier',2,'Other','022','Other road','ABA','[{"method":"ABA","amount_usd":5,"amount_khr":0}]','USD',4100,5,0,0,0,0,1,'Driver A','111','A road',NULL,'same-second');
    INSERT INTO returns(id,return_number,sale_id,customer_id,customer_name,updated_at) VALUES(1,'RET1',1,1,'Old','return-time'),(2,'RET2',3,2,'Other','return-time');
  `)
  let beforeBatch=null
  const env={DB:{
    prepare(text){
      return {bind(...params){
        return {
          text,params,
          async first(){return sql.prepare(text).get(...params)||null},
          async all(){return {results:sql.prepare(text).all(...params)}},
          async run(){const r=sql.prepare(text).run(...params);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}},
        }
      }}
    },
    async batch(statements){if(beforeBatch){const fn=beforeBatch;beforeBatch=null;await fn()}return sql.transaction(()=>statements.map(s=>{const r=sql.prepare(s.text).run(...s.params);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}))()}
  }}
  const ctx={waitUntil(){},passThroughOnException(){}}
  const call=async(app,url,body,method='POST')=>{const response=await app.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},env,ctx);return {status:response.status,body:await response.json()}}
  return {sql,call,barrier(fn){beforeBatch=fn}}
}
function items(f, ids=[1,2,3]) {return ids.map(id=>({id,expected_updated_at:f.sql.prepare('SELECT updated_at FROM sales WHERE id=?').get(id).updated_at}))}
function request(f,action,key='field-request-0001',ids=[1,2,3]) {return {client_request_id:key,items:items(f,ids),action}}
function snapshot(f) {return JSON.stringify(['sales','returns','fees','inventory_movements','undo_snapshots','action_history','sale_bulk_operations','sale_bulk_members','sale_write_revisions','audit_logs'].map(t=>[t,f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))}
async function replay(f,id,direction='undo',generation=0){return f.call(history,`/${id}/${direction}`,{require_applied:true,expected_generation:generation})}

async function run(){
  let f=fixture()
  const payment=request(f,{kind:'payment_method',source:'Cash',target:'Card'},'payment-request-1')
  payment.items[2].expected_updated_at='stale-but-source-mismatch'
  const paid=await f.call(sales,'/bulk-update',payment)
  assert.equal(paid.status,200,JSON.stringify(paid))
  assert.deepEqual([paid.body.changedCount,paid.body.unchangedCount],[2,1])
  const first=f.sql.prepare('SELECT * FROM sales WHERE id=1').get()
  assert.equal(first.payment_method,'Card + ABA')
  assert.deepEqual(JSON.parse(first.payment_details),[{method:'Card',amount_usd:3,amount_khr:0},{method:'ABA',amount_usd:7,amount_khr:0}])
  assert.deepEqual([first.amount_paid_usd,first.amount_paid_khr,first.payment_currency,first.exchange_rate,first.change_usd,first.change_khr],[10,0,'USD',4100,1,0])
  const committed=snapshot(f)
  assert.deepEqual(await f.call(sales,'/bulk-update',payment),paid)
  assert.equal(snapshot(f),committed)
  assert.equal((await replay(f,paid.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT payment_method FROM sales WHERE id=1').get().payment_method,'Cash + ABA')
  assert.equal((await replay(f,paid.body.actionHistoryId,'redo',1)).status,200)
  console.log('PASS matching tender labels only, partial amounts/currency unchanged, stale mismatch skipped, idempotency and replay')

  f=fixture()
  const stale=request(f,{kind:'payment_method',source:'Cash',target:'Card'},'stale-request-1',[1,2])
  let afterConcurrent
  f.barrier(()=>{f.sql.prepare("UPDATE sales SET notes='concurrent' WHERE id=2").run();afterConcurrent=snapshot(f)})
  const rejected=await f.call(sales,'/bulk-update',stale)
  assert.equal(rejected.status,409,JSON.stringify(rejected))
  assert.equal(snapshot(f),afterConcurrent)
  assert.equal(f.sql.prepare('SELECT payment_method FROM sales WHERE id=1').get().payment_method,'Cash + ABA')
  console.log('PASS candidate revision conflict rejects the entire group')

  f=fixture()
  const targetRace=request(f,{kind:'customer',source_id:1,target_id:3},'target-race-1',[1,2])
  f.barrier(()=>f.sql.prepare("UPDATE customers SET phone='changed-at-commit' WHERE id=3").run())
  const targetRaceRejected=await f.call(sales,'/bulk-update',targetRace)
  assert.equal(targetRaceRejected.status,409,JSON.stringify(targetRaceRejected))
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sales WHERE customer_id=3').get().n,0)
  console.log('PASS source and target reference snapshots are guarded at commit')

  f=fixture()
  const customer=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:1,target_id:3},'customer-request-1'))
  assert.equal(customer.status,200,JSON.stringify(customer))
  assert.deepEqual([customer.body.changedCount,customer.body.unchangedCount],[2,1])
  assert.deepEqual(f.sql.prepare('SELECT customer_id,customer_name FROM returns WHERE id=1').get(),{customer_id:3,customer_name:'New'})
  f.sql.prepare("UPDATE customers SET name='Older' WHERE id=1").run()
  const editedSource=snapshot(f)
  assert.equal((await replay(f,customer.body.actionHistoryId)).status,409)
  assert.equal(snapshot(f),editedSource)
  f.sql.prepare("UPDATE customers SET name='Old' WHERE id=1").run()
  assert.equal((await replay(f,customer.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id,1)
  assert.deepEqual(f.sql.prepare('SELECT customer_id,customer_name FROM returns WHERE id=1').get(),{customer_id:1,customer_name:'Old'})
  f.sql.prepare("UPDATE customers SET name='Newer' WHERE id=3").run()
  assert.equal((await replay(f,customer.body.actionHistoryId,'redo',1)).status,409)
  f.sql.prepare("UPDATE customers SET name='New' WHERE id=3").run()
  assert.equal((await replay(f,customer.body.actionHistoryId,'redo',1)).status,200)
  f.sql.prepare("INSERT INTO returns(id,return_number,sale_id,customer_id,customer_name,updated_at) VALUES(9,'LATE',1,3,'New','late')").run()
  const lateReturn=snapshot(f)
  assert.equal((await replay(f,customer.body.actionHistoryId,'undo',2)).status,409)
  assert.equal(snapshot(f),lateReturn)
  console.log('PASS customer reassignment mirrors exact linked returns; destination reference edits and newly linked returns block replay')

  f=fixture()
  f.sql.prepare('UPDATE sales SET delivery_contact_phone=NULL WHERE id=1').run()
  const driver=await f.call(sales,'/bulk-update',request(f,{kind:'delivery_contact',source_id:1,target_id:2},'driver-request-1'))
  assert.equal(driver.status,200,JSON.stringify(driver))
  assert.deepEqual([driver.body.changedCount,driver.body.unchangedCount],[2,1])
  const driverSale=f.sql.prepare('SELECT delivery_contact_id,delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_actual_cost_usd FROM sales WHERE id=1').get()
  assert.deepEqual(driverSale,{delivery_contact_id:2,delivery_contact_name:'Driver B',delivery_contact_phone:'222',delivery_contact_address:'B road',delivery_actual_cost_usd:2})
  assert.equal((await replay(f,driver.body.actionHistoryId)).status,200)
  assert.deepEqual(f.sql.prepare('SELECT delivery_contact_id,delivery_contact_phone,delivery_actual_cost_usd FROM sales WHERE id=1').get(),{delivery_contact_id:1,delivery_contact_phone:null,delivery_actual_cost_usd:2})
  console.log('PASS delivery reassignment preserves historical sale snapshots and actual cost while replay guards canonical contacts')

  f=fixture()
  user={id:2,name:'Customer editor',role_code:'user',permissions:JSON.stringify({sales:true,'sales:status':false,'sales:customer':true})}
  const customerOnly=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:1,target_id:3},'customer-permission-1',[1]))
  assert.equal(customerOnly.status,200)
  assert.equal((await replay(f,customerOnly.body.actionHistoryId)).status,200)
  const paymentDenied=await f.call(sales,'/bulk-update',request(f,{kind:'payment_method',source:'Cash',target:'Card'},'payment-permission-1',[2]))
  assert.equal(paymentDenied.status,403)
  user={id:1,name:'Admin',username:'admin',role_code:'admin',permissions:{all:true}}
  console.log('PASS customer and status-field actions preserve their distinct granular permissions, including replay')
}
run().catch(error=>{console.error(error);process.exitCode=1})
