// Conditional bulk sale field updates through the real Hono routes and SQLite transactions.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))
let user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set(['actorSnapshot','anonymousCustomer','movementBranchName','db','permissions','saleBulkStatus','saleBulkUpdate','saleRecordEvents','saleTransitions','sqlBinding','productBatches','batchCode','salesStatus','undoAppliers','branchWrites','conflictControl','searchMatch','paymentMethodRegistry','contactOptions'])
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
    if (rel.endsWith('saleRecordEvents.ts') && name === './saleRecords') return { SALE_RECORD_FIELDS: recordContract.fields, SALE_RECORD_KINDS: recordContract.kinds }
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
    INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA","Card"]','settings-v1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    -- N21: customer 3 carries the Contact Options JSON that customers.address
    -- actually stores, so the reassignment below is exercised on the real shape.
    INSERT INTO customers(id,name,phone,address,membership_number) VALUES
      (1,'Old','011','Old road','OLD-MEMBER'),
      (2,'Other','022','Other road',NULL),
      (3,'New','033','[{"label":"Default","name":null,"phone":null,"email":null,"address":"New road","area":null}]','NEW-MEMBER');
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
function snapshot(f) {return JSON.stringify(['sales','returns','fees','inventory_movements','undo_snapshots','action_history','sale_bulk_operations','sale_bulk_members','sale_record_events','sale_write_revisions','audit_logs'].map(t=>[t,f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))}
async function replay(f,id,direction='undo',generation=0){return f.call(history,`/${id}/${direction}`,{require_applied:true,expected_generation:generation})}

async function run(){
  let f=fixture()
  const payment=request(f,{kind:'payment_method',source:'Cash',target:'card'},'payment-request-1')
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
  assert.deepEqual(f.sql.prepare('SELECT generation,kind,via,COUNT(*) n FROM sale_record_events GROUP BY generation,kind,via ORDER BY generation').all(),[
    {generation:0,kind:'payment_changed',via:'apply',n:2},
    {generation:1,kind:'payment_changed',via:'undo',n:2},
    {generation:2,kind:'payment_changed',via:'redo',n:2},
  ])
  console.log('PASS matching tender labels only, partial amounts/currency unchanged, stale mismatch skipped, idempotency and replay')

  f=fixture()
  const beforeUnknown=snapshot(f)
  const unknown=await f.call(sales,'/bulk-update',request(f,{kind:'payment_method',source:'Cash',target:'Forged Pay'},'payment-unknown-1',[1]))
  assert.equal(unknown.status,400,JSON.stringify(unknown))
  assert.equal(snapshot(f),beforeUnknown)
  const configRace=request(f,{kind:'payment_method',source:'Cash',target:'Card'},'payment-config-race-1',[1])
  f.barrier(()=>f.sql.prepare("UPDATE settings SET value='[\"Cash\",\"ABA\"]',updated_at='settings-v2' WHERE key='pos_payment_methods'").run())
  const racedConfig=await f.call(sales,'/bulk-update',configRace)
  assert.equal(racedConfig.status,409,JSON.stringify(racedConfig))
  assert.equal(f.sql.prepare('SELECT payment_method FROM sales WHERE id=1').get().payment_method,'Cash + ABA')
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sale_bulk_operations').get().n,0)
  console.log('PASS target must be active/configured and its exact canonical setting is guarded at commit')

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
  assert.equal(f.sql.prepare('SELECT json_extract(undo_payload,\'$.applier\') applier FROM action_history WHERE id=?').get(customer.body.actionHistoryId).applier,'sale.customer.v2.bulk')
  assert.deepEqual(f.sql.prepare('SELECT customer_id,customer_name FROM returns WHERE id=1').get(),{customer_id:3,customer_name:'New'})
  // N21: the sale snapshot must be the DISPLAY address. Copying the column raw,
  // as this writer used to, stores the options JSON, and the sale detail, the
  // receipt and the CSV export then print it.
  assert.equal(f.sql.prepare('SELECT customer_address FROM sales WHERE id=1').get().customer_address,'New road')
  const customerReceipt=JSON.parse(f.sql.prepare('SELECT receipt_json FROM sale_bulk_operations WHERE id=?').get(customer.body.operationId).receipt_json)
  assert.equal(customerReceipt.items.find(item=>item.id===1).before.membership_number,'OLD-MEMBER')
  assert.equal(customerReceipt.items.find(item=>item.id===1).after.membership_number,'NEW-MEMBER')
  const customerEvent=JSON.parse(f.sql.prepare("SELECT changes_json FROM sale_record_events WHERE kind='customer_changed' ORDER BY sale_id LIMIT 1").get().changes_json)
  assert.deepEqual(customerEvent.map(change=>change.field),['customer','membership'])
  assert.deepEqual(customerEvent[0].before.value,{id:1,name:'Old'})
  assert.deepEqual(customerEvent[0].after.value,{id:3,name:'New'})
  assert.ok(!JSON.stringify(customerEvent).includes('011') && !JSON.stringify(customerEvent).includes('Old road'))
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
  f.sql.prepare("UPDATE sales SET customer_id=NULL,customer_name=NULL,customer_phone=NULL,customer_address=NULL,updated_at='general-time' WHERE id=3").run()
  const fromGeneral=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:null,target_id:3},'customer-general-1',[3]))
  assert.equal(fromGeneral.status,200,JSON.stringify(fromGeneral))
  const generalReceipt=JSON.parse(f.sql.prepare('SELECT receipt_json FROM sale_bulk_operations WHERE id=?').get(fromGeneral.body.operationId).receipt_json)
  assert.equal(generalReceipt.items[0].before.customer_id,null)
  assert.equal(generalReceipt.items[0].before.membership_number,null)
  assert.equal(generalReceipt.items[0].after.membership_number,'NEW-MEMBER')
  const generalEvent=JSON.parse(f.sql.prepare("SELECT changes_json FROM sale_record_events WHERE sale_id=3").get().changes_json)
  assert.deepEqual(generalEvent.find(change=>change.field==='customer').before,{state:'known_none'})
  console.log('PASS General is explicit null and customer membership is a write-time receipt snapshot')

  f=fixture()
  f.sql.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  const clearMarkedGeneral=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:null,target_id:null},'clear-marked-general-1',[1]))
  assert.equal(clearMarkedGeneral.status,200,JSON.stringify(clearMarkedGeneral))
  assert.deepEqual([clearMarkedGeneral.body.changedCount,clearMarkedGeneral.body.unchangedCount],[0,1])
  assert.equal(f.sql.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id,1,'General-to-General clear preserves the historical marked id')
  const fromMarkedGeneral=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:null,target_id:3},'customer-marked-general-1',[1,2]))
  assert.equal(fromMarkedGeneral.status,200,JSON.stringify(fromMarkedGeneral))
  assert.deepEqual([fromMarkedGeneral.body.changedCount,fromMarkedGeneral.body.unchangedCount],[2,0])
  const markedReceipt=JSON.parse(f.sql.prepare('SELECT receipt_json FROM sale_bulk_operations WHERE id=?').get(fromMarkedGeneral.body.operationId).receipt_json)
  assert.equal(markedReceipt.items[0].before.customer_id,1,'receipt must retain the exact historical persisted id for guarded replay')
  assert.equal(markedReceipt.items[0].before.is_anonymous,1)
  const markedEvent=JSON.parse(f.sql.prepare("SELECT changes_json FROM sale_record_events WHERE sale_id=1 AND generation=0").get().changes_json)
  assert.deepEqual(markedEvent.find(change=>change.field==='customer').before,{state:'known_none'})
  assert.deepEqual(markedEvent.find(change=>change.field==='membership').before,{state:'known_none'})
  f.sql.prepare('UPDATE customers SET is_anonymous=0 WHERE id=1').run()
  assert.equal((await replay(f,fromMarkedGeneral.body.actionHistoryId)).status,409,'undo must not restore a row whose anonymous marker changed')
  f.sql.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  assert.equal((await replay(f,fromMarkedGeneral.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id,1)
  const anonTarget=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:1,target_id:1},'customer-anon-target-1',[1]))
  assert.equal(anonTarget.status,400,JSON.stringify(anonTarget))
  assert.match(anonTarget.body.error,/anonymous checkout identity/i)
  console.log('PASS persisted anonymous sources behave as General, retain guarded replay identity, and cannot be targets')

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
  user={id:2,name:'Customer editor',role_code:'user',permissions:JSON.stringify({sales:true,'sales:status':true,'sales:customer':true,'sales:bulk':false})}
  const customerOnly=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:1,target_id:3},'customer-permission-1',[1]))
  assert.equal(customerOnly.status,200)
  assert.equal(f.sql.prepare('SELECT json_extract(undo_payload,\'$.applier\') applier FROM action_history WHERE id=?').get(customerOnly.body.actionHistoryId).applier,'sale.customer.single')
  // Pre-F75 one-sale customer assignments used the shared bulk applier name.
  // Preserve their historical individual customer authority and replayability.
  f.sql.prepare("UPDATE action_history SET undo_payload=json_set(undo_payload,'$.applier','sale.customer.bulk'),redo_payload=json_set(redo_payload,'$.applier','sale.customer.bulk') WHERE id=?").run(customerOnly.body.actionHistoryId)
  assert.equal((await replay(f,customerOnly.body.actionHistoryId)).status,200)
  const beforeBulkDenied=snapshot(f)
  const customerBulkDenied=await f.call(sales,'/bulk-update',request(f,{kind:'customer',source_id:1,target_id:3},'customer-bulk-denied-1',[1,2]))
  assert.equal(customerBulkDenied.status,403)
  assert.equal(snapshot(f),beforeBulkDenied)
  const paymentDenied=await f.call(sales,'/bulk-update',request(f,{kind:'payment_method',source:'Cash',target:'Card'},'payment-permission-1',[2]))
  assert.equal(paymentDenied.status,403)
  user={id:1,name:'Admin',username:'admin',role_code:'admin',permissions:{all:true}}
  console.log('PASS new and legacy one-customer replay use individual authority while every true bulk action is refused without sales.bulk')
}
run().catch(error=>{console.error(error);process.exitCode=1})
