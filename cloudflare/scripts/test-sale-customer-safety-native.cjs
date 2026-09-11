// Actual mounted sales/history routes, production permission/assignment logic,
// and native D1 transactions. Reuse the existing complete schema fixture only.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { Miniflare } = require('miniflare')

async function main() {
  let source = fs.readFileSync(path.join(__dirname, 'test-sale-bulk-update-pure.cjs'), 'utf8')
    .replace("const actual = new Set([", "const actual = new Set(['saleCustomerAssignmentGuard',")
    .replace(/run\(\)\.catch[\s\S]*$/, '')
  const { sales, history, fixture, setUser, load } = new Function('require', '__dirname', source + '\nreturn {sales,history,fixture,load,setUser:value=>{user=value}};')(require, __dirname)
  const contacts = load('routes/contacts.ts').default
  const f = fixture()
  f.sql.exec("INSERT INTO users(id,username,name,password) VALUES(1,'employee','Employee','test')")
  const required = new Set(['sales','returns','sale_items','return_items','customers','users','roles','branches','settings','inventory_movements','sale_write_revisions','sale_bulk_guards','sale_bulk_operations','sale_bulk_members','sale_record_events','undo_snapshots','action_history','audit_logs','system_flags','customer_receivables','loyalty_point_adjustments','customer_share_submissions'])
  required.add('return_write_revisions')
  for (const name of required) for (const fk of f.sql.prepare(`PRAGMA foreign_key_list(${name})`).all()) required.add(fk.table)
  const objects = f.sql.prepare('SELECT name,tbl_name,type,sql FROM sqlite_master WHERE sql IS NOT NULL').all().filter(o => required.has(o.tbl_name) && o.name !== 'sqlite_sequence')
  const mf = new Miniflare({ modules:true, script:'', d1Databases:['DB'] })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch(objects.filter(o=>o.type==='table').map(o=>db.prepare(o.sql)))
    const inserts=[]
    for(const name of required) for(const row of f.sql.prepare(`SELECT * FROM ${name}`).all()) {
      const cols=Object.keys(row)
      inserts.push(db.prepare(`INSERT INTO ${name}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).bind(...Object.values(row)))
    }
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'),...inserts])
    await db.batch(objects.filter(o=>o.type==='index'||(o.type==='trigger'&&['sales','returns','sale_items','return_items','sale_record_events','undo_snapshots','sale_bulk_operations','sale_bulk_members'].includes(o.tbl_name))).map(o=>db.prepare(o.sql)))
    let barrier=null
    const env={DB:{prepare:sql=>db.prepare(sql),batch:async statements=>{if(barrier){const run=barrier;barrier=null;await run()}return db.batch(statements)}}}
    const context={waitUntil(){},passThroughOnException(){}}
    const call=async(route,url,body,method='POST')=>{const r=await route.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},env,context);const text=await r.text();let result;try{result=JSON.parse(text)}catch{result={error:text}}return {status:r.status,body:result}}
    const row=()=>db.prepare('SELECT * FROM sales WHERE id=1').first()
    const request=async(action,key)=>({client_request_id:key,items:[{id:1,expected_updated_at:(await row()).updated_at}],action})
    const readAll=async()=>JSON.stringify(await Promise.all(['sales','returns','customers','loyalty_point_adjustments','customer_share_submissions','customer_receivables','sale_record_events','sale_bulk_operations','action_history','undo_snapshots','inventory_movements'].map(async table=>[table,(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])))
    const employee={id:1,username:'employee',role_code:'employee',permissions:JSON.stringify({sales:true,contacts:false})}
    setUser({...employee,permissions:JSON.stringify({sales:true,contacts:false,'sales:customer_reassign':false})})
    let before=await readAll()
    let r=await call(sales,'/bulk-update',await request({kind:'customer',source_id:1,target_id:3},'denied-assignment'))
    assert.equal(r.status,403,JSON.stringify(r));assert.equal(await readAll(),before)
    r=await call(sales,'/1/customer',{client_request_id:'denied-legacy',expected_updated_at:(await row()).updated_at,customerId:3},'PATCH')
    assert.equal(r.status,403,JSON.stringify(r))
    const nameRequest=await request({kind:'customer_name',name:'Receipt corrected'},'name-only-request')
    const name=await call(sales,'/bulk-update',nameRequest)
    assert.equal(name.status,200,JSON.stringify(name));assert.equal((await row()).customer_name,'Receipt corrected')
    assert.deepEqual([(await row()).customer_id,(await row()).customer_phone],[1,'011'])
    assert.equal((await db.prepare('SELECT name FROM customers WHERE id=1').first()).name,'Old')
    assert.equal((await db.prepare('SELECT customer_name FROM returns WHERE id=1').first()).customer_name,'Old')
    const committed=await readAll();assert.deepEqual(await call(sales,'/bulk-update',nameRequest),name);assert.equal(await readAll(),committed)
    assert.equal((await call(history,`/${name.body.actionHistoryId}/undo`,{require_applied:true,expected_generation:0})).status,200)
    assert.equal((await row()).customer_name,'Old')
    for(const extra of [{customer_id:3},{phone:'forged'},{membership_number:'fake'}]) {
      r=await call(sales,'/bulk-update',await request({kind:'customer_name',name:'Bad',...extra},'name-forged-'+Object.keys(extra)[0]));assert.equal(r.status,400,JSON.stringify(r))
    }
    console.log('PASS employee Sales Full / Contacts None name-only exact retry and undo; reassignment and field injection denied')
    setUser(employee)
    for(const [label,setup,clear] of [
      ['redeemed50',"UPDATE sales SET loyalty_accrual=0,membership_points_redeemed=50 WHERE id=1","UPDATE sales SET membership_points_redeemed=0 WHERE id=1"],
      ['redeemed100',"UPDATE sales SET membership_points_redeemed=100 WHERE id=1","UPDATE sales SET membership_points_redeemed=0 WHERE id=1"],
      ['earned50',"UPDATE sales SET loyalty_accrual=1,total_usd=50 WHERE id=1","UPDATE sales SET loyalty_accrual=0,total_usd=0 WHERE id=1"],
      ['earned100',"UPDATE sales SET loyalty_accrual=1,total_usd=100 WHERE id=1","UPDATE sales SET loyalty_accrual=0,total_usd=0 WHERE id=1"],
      ['return50',"UPDATE returns SET total_refund_usd=50 WHERE id=1","UPDATE returns SET total_refund_usd=0 WHERE id=1"],
    ]) {
      await db.prepare(setup).run();before=await readAll()
      r=await call(sales,'/bulk-update',await request({kind:'customer',source_id:1,target_id:3},'blocked-'+label))
      assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'loyalty_reassignment_requires_reconciliation');assert.equal(await readAll(),before)
      r=await call(sales,'/1/customer',{client_request_id:'legacy-'+label,expected_updated_at:(await row()).updated_at,customerId:3},'PATCH')
      assert.equal(r.status,409,JSON.stringify(r));assert.equal(await readAll(),before);await db.prepare(clear).run()
    }
    // A separate committed return lands after preflight; the batch must roll
    // back. Independently exercise the loyalty assertion without a revision
    // guard to prove containment is not merely the existing revision trigger.
    const race=await request({kind:'customer',source_id:1,target_id:3},'return-race-request')
    barrier=async()=>db.prepare('UPDATE returns SET total_refund_usd=100 WHERE id=1').run()
    r=await call(sales,'/bulk-update',race);assert.equal(r.status,409,JSON.stringify(r));assert.equal((await row()).customer_id,1)
    const compat=load('lib/db.ts').getDb({DB:db})
    const guard=load('lib/saleCustomerAssignmentGuard.ts').customerAssignmentGuard(1,3)
    before=await readAll()
    await assert.rejects(()=>compat.batch([{sql:"UPDATE sales SET customer_name='must roll back' WHERE id=1",params:{}},guard]))
    assert.equal(await readAll(),before)
    await db.prepare('UPDATE returns SET total_refund_usd=0 WHERE id=1').run()
    console.log('PASS 50/100 earned/redeemed/refund blocks preserve every financial ledger; native preflight-to-commit return race rolls back')
    setUser({...employee,permissions:JSON.stringify({sales:true,contacts:true,'sales:customer_reassign':false})})
    r=await call(contacts,'/customers/link-conflicts/relink',{customer_id:1,target_customer_id:3,phone_key:'11'})
    assert.equal(r.status,403,JSON.stringify(r))
    setUser({...employee,permissions:JSON.stringify({sales:true,contacts:true})})
    await db.prepare('UPDATE sales SET membership_points_redeemed=100 WHERE id=1').run()
    before=await readAll()
    r=await call(contacts,'/customers/link-conflicts/relink',{customer_id:1,target_customer_id:3,phone_key:'11'})
    assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.body.code,'loyalty_reassignment_requires_reconciliation');assert.equal(await readAll(),before)
    await db.prepare('UPDATE sales SET customer_id=NULL WHERE id=1').run()
    before=await readAll()
    r=await call(contacts,'/customers/link-conflicts/resolve-missing',{name:'Old',phone:'011',phone_key:'11',target_customer_id:3})
    assert.equal(r.status,409,JSON.stringify(r));assert.equal(await readAll(),before)
    await db.prepare('UPDATE sales SET customer_id=1,membership_points_redeemed=0 WHERE id=1').run()
    setUser(employee)
    console.log('PASS actual Contacts relink/resolve-missing cannot bypass restricted assignment or loyalty containment')
    await db.prepare("INSERT INTO customer_receivables(legacy_id,customer_id,customer_name,invoice_no,invoice_date,status,source_file,source_row,outstanding_balance_usd) VALUES(900,1,'Old','R1','2026-09-12','credit','fixture',1,-25)").run()
    const credit=(await db.prepare('SELECT * FROM customer_receivables').all()).results
    const transfer=await call(sales,'/bulk-update',await request({kind:'customer',source_id:1,target_id:3},'safe-transfer-request'))
    assert.equal(transfer.status,200,JSON.stringify(transfer));assert.equal((await row()).customer_id,3);assert.equal((await row()).customer_phone,'033')
    assert.equal((await db.prepare('SELECT customer_id FROM returns WHERE id=1').first()).customer_id,3)
    assert.deepEqual((await db.prepare('SELECT * FROM customer_receivables').all()).results,credit)
    r=await call(history,`/${transfer.body.actionHistoryId}/undo`,{require_applied:true,expected_generation:0});assert.equal(r.status,200,JSON.stringify(r))
    assert.deepEqual([(await row()).customer_id,(await row()).customer_name,(await row()).customer_phone],[1,'Old','011'])
    assert.equal((await db.prepare('SELECT customer_id FROM returns WHERE id=1').first()).customer_id,1)
    r=await call(history,`/${transfer.body.actionHistoryId}/redo`,{require_applied:true,expected_generation:1});assert.equal(r.status,200,JSON.stringify(r))
    setUser({...employee,permissions:JSON.stringify({sales:true,'sales:customer_reassign':false})})
    r=await call(history,`/${transfer.body.actionHistoryId}/undo`,{require_applied:true,expected_generation:2});assert.equal(r.status,403,JSON.stringify(r));assert.equal((await row()).customer_id,3)
    setUser(employee)
    await db.prepare('UPDATE sales SET membership_points_redeemed=100 WHERE id=1').run()
    r=await call(history,`/${transfer.body.actionHistoryId}/undo`,{require_applied:true,expected_generation:2});assert.equal(r.status,409,JSON.stringify(r));assert.equal((await row()).customer_id,3)
    console.log('PASS zero-loyalty transfer moves exact sale/return snapshots, leaves unrelated legacy credit, and cannot undo after permission revocation or loyalty activity')
  } finally { f.sql.close();await mf.dispose() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
