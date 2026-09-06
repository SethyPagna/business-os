// Actual Hono routes + actual D1 adapter + real SQLite transactions. No SQL mocks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
let user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set(['actorSnapshot','movementBranchName','db','permissions','saleBulkStatus','saleBulkUpdate','saleTransitions','saleTotals','sqlBinding','productBatches','batchCode','salesStatus','undoAppliers','branchWrites','conflictControl','searchMatch'])
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
    if (name.endsWith('/telegram')) return {formatSaleTelegramLines:()=>[],sendTelegramEvent:async()=>{},telegramMoney:()=>''}
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
const helper = load('lib/saleBulkStatus.ts')
function fixture(migrate = true) {
  const sql=new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for(const file of fs.readdirSync(path.join(root,'migrations')).filter(f=>f.endsWith('.sql') && (migrate || !f.startsWith('0120_'))).sort()) sql.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'))
  sql.exec("INSERT INTO branches(id,name) VALUES(1,'Shop'),(2,'Warehouse'); INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',100),(2,'B',100); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,50),(1,2,50),(2,1,100)")
  let failAt=null, beforeBatch=null, batches=0, reads=0
  const readRows=[]
  const env={DB:{
    prepare(text) {
      return {bind(...params) {
        if(params.length>100) throw Error('too many SQL variables')
        return {text,params, async first(){reads++;return sql.prepare(text).get(...params)||null}, async all(){reads++;const results=sql.prepare(text).all(...params);readRows.push({text,bindings:params.length,rows:results.length});return {results}},async run(){const r=sql.prepare(text).run(...params);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}}
      }}
    },
    async batch(statements) {
      batches++
      if(beforeBatch) {const fn=beforeBatch;beforeBatch=null;await fn()}
      return sql.transaction(()=>statements.map((s,i)=>{if(failAt!==null&&(i===failAt||s.text.includes(failAt)))throw Error('injected failure');const r=sql.prepare(s.text).run(...s.params);return {meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}))()
    }
  }}
  const ctx={waitUntil(){},passThroughOnException(){}}
  const call=async(app,url,body,method='POST')=>{const response=await app.request(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},env,ctx);const text=await response.text();let parsed;try{parsed=JSON.parse(text)}catch{parsed={error:text}}return {status:response.status,body:parsed}}
  return {sql,env,call,fail(value){failAt=value},barrier(fn){beforeBatch=fn},metrics:()=>({batches,reads,readRows})}
}
function seed(f,count=9) {
  for(let id=1;id<=count;id++) {
    f.sql.prepare("INSERT INTO sales(id,receipt_number,sale_status,branch_id,updated_at) VALUES(?,?,?,1,'same-second')").run(id,`R${id}`,id<=7?'awaiting_payment':'completed')
    f.sql.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(?,?,1,\'A\',2,1)').run(id,id)
  }
}
function request(f,target='completed',key='request-0001') {
  return {client_request_id:key,target_status:target,items:f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales ORDER BY id').all(),...(target==='cancelled'?{cancel_reason:'mistake'}:{})}
}
function snapshot(f) {
  return JSON.stringify(['sales','sale_items','products','branch_stock','branch_batch_stock','sale_item_batch_allocations','damaged_stock_lots','fees','inventory_movements','undo_snapshots','action_history','sale_bulk_operations','sale_bulk_members','sale_write_revisions','audit_logs'].map(t=>[t,f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))
}
async function replay(f,id,direction='undo',generation=0) {return f.call(history,`/${id}/${direction}`,{require_applied:true,expected_generation:generation})}
async function run() {
  // Append 0120 to a populated pre-0120 fixture as well as the full fresh chain.
  let legacy=fixture(false);seed(legacy)
  const domain=legacy.sql.prepare('SELECT * FROM sales ORDER BY id').all()
  legacy.sql.exec(fs.readFileSync(path.join(root,'migrations/0120_sale_bulk_status_actions.sql'),'utf8'))
  assert.deepEqual(legacy.sql.prepare('SELECT * FROM sales ORDER BY id').all(),domain)
  assert.equal(legacy.sql.prepare('SELECT COUNT(*) n FROM sale_write_revisions').get().n,0)
  assert.equal((await legacy.call(sales,'/bulk-status',request(legacy))).status,200)
  const savedRevisions=legacy.sql.prepare('SELECT * FROM sale_write_revisions ORDER BY sale_id').all()
  legacy.sql.exec(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}'); DELETE FROM sale_write_revisions; DELETE FROM sale_items; DELETE FROM sales;`)
  for(const row of domain) {const keys=Object.keys(row);legacy.sql.prepare(`INSERT INTO sales(${keys}) VALUES(${keys.map(()=>'?')})`).run(...keys.map(k=>row[k]))}
  assert.equal(legacy.sql.prepare('SELECT COUNT(*) n FROM sale_write_revisions').get().n,0)
  for(const row of savedRevisions) legacy.sql.prepare('INSERT INTO sale_write_revisions(sale_id,revision) VALUES(?,?)').run(row.sale_id,row.revision)
  assert.deepEqual(legacy.sql.prepare('SELECT * FROM sale_write_revisions ORDER BY sale_id').all(),savedRevisions)
  legacy.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
  const revision=legacy.sql.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=1').get().revision
  legacy.sql.exec("UPDATE sales SET notes='normal write' WHERE id=1")
  assert.equal(legacy.sql.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=1').get().revision,revision+1)
  console.log('PASS fresh chain/populated migration, restore revision preservation, one increment per same-sale UPDATE')
  let f=fixture();seed(f)
  const result=await f.call(sales,'/bulk-status',request(f))
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.changedCount,7);assert.equal(result.body.unchangedCount,2)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM action_history').get().n,1)
  assert.equal(f.metrics().batches,1)
  let h=result.body.actionHistoryId
  // No browser closure or retained request state: the actual history route
  // loads the operation and snapshot from SQLite on every replay.
  assert.equal((await replay(f,h)).status,200)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sales WHERE sale_status='awaiting_payment'").get().n,7)
  assert.equal((await replay(f,h,'redo',1)).status,200)
  console.log('PASS one request, seven changes/two noops, one group, reload undo/redo')
  f=fixture();seed(f)
  const req=request(f,'cancelled'),first=await f.call(sales,'/bulk-status',req)
  assert.equal(first.status,200,JSON.stringify(first))
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,68)
  const committed=snapshot(f)
  assert.deepEqual(await f.call(sales,'/bulk-status',req),first);assert.equal(snapshot(f),committed)
  assert.equal((await f.call(sales,'/bulk-status',{...req,notes:'different'})).status,409)
  assert.equal((await replay(f,first.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,50)
  console.log('PASS exact stock inverse and request idempotency')

  f=fixture();seed(f)
  const conditional=request(f,'cancelled','request-source-filter')
  conditional.source_status='completed'
  conditional.items=conditional.items.map(item=>item.id<=7?{...item,expected_status:'completed',expected_updated_at:'stale'}:item)
  const conditionalResult=await f.call(sales,'/bulk-status',conditional)
  assert.equal(conditionalResult.status,200,JSON.stringify(conditionalResult))
  assert.deepEqual([conditionalResult.body.changedCount,conditionalResult.body.unchangedCount],[2,7])
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sales WHERE id<=7 AND sale_status='awaiting_payment'").get().n,7)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sales WHERE id>7 AND sale_status='cancelled'").get().n,2)
  assert.equal(conditionalResult.body.items.filter(item=>item.reason==='source_mismatch').length,7)
  assert.equal((await replay(f,conditionalResult.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sales WHERE sale_status='completed'").get().n,2)
  console.log('PASS conditional source status skips mismatches, including stale mismatches, and replays only changed members')

  f=fixture();seed(f,2)
  const perSale=request(f,'cancelled','request-per-sale-fees')
  delete perSale.cancel_reason
  perSale.items=perSale.items.map((item,index)=>({...item,cancel:{reason:index?'other':'buyer_refused',...(index?{note:'address wrong'}:{}),fee_usd:index?2.5:1,fee_khr:index?0:4000,fee_note:`fee ${index+1}`}}))
  const baselineFeeCount=f.sql.prepare('SELECT COUNT(*) n FROM fees').get().n
  const withFees=await f.call(sales,'/bulk-status',perSale)
  assert.equal(withFees.status,200,JSON.stringify(withFees))
  const feeRows=f.sql.prepare('SELECT f.* FROM fees f JOIN sales s ON s.cancel_fee_id=f.id WHERE s.id IN (1,2) ORDER BY f.sale_id').all()
  assert.equal(feeRows.length,2)
  assert.ok(feeRows.every(row=>row.id<0))
  assert.deepEqual(f.sql.prepare('SELECT cancel_fee_id FROM sales ORDER BY id').all().map(row=>row.cancel_fee_id),feeRows.map(row=>row.id))
  assert.equal((await replay(f,withFees.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM fees').get().n,baselineFeeCount)
  assert.equal((await replay(f,withFees.body.actionHistoryId,'redo',1)).status,200)
  assert.deepEqual(f.sql.prepare('SELECT f.* FROM fees f JOIN sales s ON s.cancel_fee_id=f.id WHERE s.id IN (1,2) ORDER BY f.sale_id').all(),feeRows)
  f.sql.prepare("UPDATE fees SET notes='edited later' WHERE id=?").run(feeRows[0].id)
  const editedFeeState=snapshot(f)
  assert.equal((await replay(f,withFees.body.actionHistoryId,'undo',2)).status,409)
  assert.equal(snapshot(f),editedFeeState)
  console.log('PASS per-sale cancellation answers and fees are atomic, exactly replayable, and guarded against later fee edits')

  f=fixture();seed(f,1)
  const beforeSingleFee=snapshot(f)
  f.fail('INSERT INTO fees')
  const failedSingleFee=await f.call(sales,'/1/status',{sale_status:'cancelled',expected_updated_at:'same-second',cancel_reason:'mistake',cancel_fee_usd:3},'PATCH')
  assert.equal(failedSingleFee.status,500)
  assert.equal(snapshot(f),beforeSingleFee)
  f=fixture();seed(f,1)
  const singleFee=await f.call(sales,'/1/status',{sale_status:'cancelled',expected_updated_at:'same-second',cancel_reason:'mistake',cancel_fee_usd:3},'PATCH')
  assert.equal(singleFee.status,200,JSON.stringify(singleFee))
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM fees WHERE sale_id=1').get().n,1)
  assert.equal(f.sql.prepare('SELECT cancel_fee_id FROM sales WHERE id=1').get().cancel_fee_id,f.sql.prepare('SELECT id FROM fees WHERE sale_id=1').get().id)
  console.log('PASS single cancellation fee and status/stock commit atomically')

  for(const marker of ['UPDATE sales','INSERT INTO undo_snapshots','INSERT INTO action_history','INSERT INTO audit_logs']) {
    f=fixture();seed(f);const before=snapshot(f);f.fail(marker)
    assert.equal((await f.call(sales,'/bulk-status',request(f,'cancelled'))).status,500)
    assert.equal(snapshot(f),before,marker)
  }
  console.log('PASS failure injection rolls back every table including history/snapshot/audit')
  f=fixture();seed(f);const applied=await f.call(sales,'/bulk-status',request(f,'cancelled'));h=applied.body.actionHistoryId
  f.sql.exec("UPDATE sale_items SET quantity=3 WHERE id=9")
  const stale=snapshot(f)
  assert.equal((await replay(f,h)).status,409);assert.equal(snapshot(f),stale)
  console.log('PASS stale member rejects complete replay without history mutation')
  f=fixture();seed(f);h=(await f.call(sales,'/bulk-status',request(f,'cancelled'))).body.actionHistoryId
  let release;const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r)
  f.barrier(async()=>{entered();await gate})
  const a=replay(f,h);await ready;const b=await replay(f,h);release();const ar=await a
  assert.deepEqual([ar.status,b.status].sort(),[200,409])
  assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,50)
  console.log('PASS concurrent same-generation replay applies once')
  f=fixture();seed(f);const before=snapshot(f)
  user={id:2,name:'View',role_code:'user',permissions:{sales:'view'}}
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,403);assert.equal(snapshot(f),before)
  user={id:1,name:'Admin',username:'admin',role_code:'admin',permissions:{all:true}}
  const skipped=await f.call(sales,'/bulk-status',{...request(f,'cancelled'),skip_stock:true});assert.equal(skipped.status,200)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0)
  assert.equal((await replay(f,skipped.body.actionHistoryId)).status,200)
  assert.equal(f.sql.prepare('SELECT SUM(stock_skipped) n FROM sales').get().n,9)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0)
  console.log('PASS permission refusal and sticky skip in both directions')

  f=fixture();seed(f,4)
  f.sql.exec(`
    UPDATE sale_items SET quantity=5 WHERE id=1;
    UPDATE sales SET sale_status='partial_return' WHERE id=1;
    UPDATE sale_items SET branch_id=2,batch_id=3 WHERE id=2;
    INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,1,'a'),(2,1,'b'),(3,1,'c');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,20),(2,1,30),(3,2,50);
    INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity,released_at) VALUES(1,1,1,1,3,0,NULL),(2,1,2,1,2,1,'original');
    INSERT INTO returns(id,sale_id) VALUES(1,1);
    INSERT INTO return_items(id,return_id,sale_item_id,product_id,quantity) VALUES(1,1,1,1,1);
    INSERT INTO damaged_stock_lots(id,product_id,branch_id,quantity,quantity_remaining) VALUES(1,1,1,5,3);
    UPDATE sale_items SET damaged_lot_id=1 WHERE id=3;
    UPDATE sales SET stock_skipped=1 WHERE id=4;
  `)
  const allocBefore=f.sql.prepare('SELECT * FROM sale_item_batch_allocations ORDER BY id').all()
  const mixed=await f.call(sales,'/bulk-status',request(f,'cancelled'))
  assert.equal(mixed.status,200,JSON.stringify(mixed))
  assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_batch_stock ORDER BY batch_id').all().map(r=>r.quantity),[23,31,52])
  assert.equal(f.sql.prepare('SELECT quantity_remaining q FROM damaged_stock_lots').get().q,5)
  assert.equal((await replay(f,mixed.body.actionHistoryId)).status,200)
  assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_batch_stock ORDER BY batch_id').all().map(r=>r.quantity),[20,30,50])
  assert.deepEqual(f.sql.prepare('SELECT * FROM sale_item_batch_allocations ORDER BY id').all(),allocBefore)
  assert.equal(f.sql.prepare('SELECT quantity_remaining q FROM damaged_stock_lots').get().q,3)
  assert.equal((await replay(f,mixed.body.actionHistoryId,'redo',1)).status,200)
  console.log('PASS mixed branches, exact multiple allocations, legacy lot, partial return, damaged and sticky skip')

  f=fixture();seed(f,1)
  f.sql.exec("UPDATE sales SET sale_status='cancelled',status_before_cancel='completed',cancel_fee_id=999999,cancel_reason='mistake' WHERE id=1; INSERT INTO fees(id,fee_type,label,amount_usd,sale_id,fee_date) VALUES(999999,'expense','Lost fee',5,1,'2026-09-05')")
  const fee=f.sql.prepare('SELECT * FROM fees WHERE id=999999').get()
  h=(await f.call(sales,'/bulk-status',request(f))).body.actionHistoryId
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM fees WHERE id=999999').get().n,0)
  assert.equal((await replay(f,h)).status,200)
  assert.deepEqual(f.sql.prepare('SELECT * FROM fees WHERE id=999999').get(),fee)
  console.log('PASS cancellation fee deletion and exact durable restoration')

  for(const mutation of ["UPDATE sales SET notes='concurrent' WHERE id=1",'UPDATE sale_items SET quantity=3 WHERE id=1',"INSERT INTO returns(sale_id) VALUES(1)","INSERT INTO sale_amendments(sale_id,kind) VALUES(1,'delivery_fee_changed')"]) {
    f=fixture();seed(f);const req=request(f,'cancelled')
    let afterOther
    f.barrier(()=>{f.sql.exec(mutation);afterOther=snapshot(f)})
    assert.equal((await f.call(sales,'/bulk-status',req)).status,409,mutation)
    assert.equal(snapshot(f),afterOther,mutation)
  }
  f=fixture();seed(f,2);h=(await f.call(sales,'/bulk-status',request(f,'cancelled'))).body.actionHistoryId
  // A consumer takes the shared last units after replay planning. Final
  // member must fail and roll back the first member's deduction as well.
  let afterConsumer
  f.barrier(()=>{f.sql.exec('UPDATE branch_stock SET quantity=3 WHERE product_id=1 AND branch_id=1');afterConsumer=snapshot(f)})
  assert.equal((await replay(f,h)).status,409);assert.equal(snapshot(f),afterConsumer)
  console.log('PASS commit-time status/line/return/amendment interleavings and shared-stock atomic shortage')

  f=fixture();seed(f,1);f.sql.exec("UPDATE sales SET sale_status='completed' WHERE id=1")
  const noop=await f.call(sales,'/bulk-status',request(f));assert.equal(noop.body.changedCount,0)
  assert.equal(f.sql.prepare('SELECT reversible FROM action_history').get().reversible,0)
  assert.equal((await replay(f,noop.body.actionHistoryId)).status,400)
  assert.equal((await f.call(history,'/',{label:'forged',undo_payload:{applier:'sale.status.bulk',snapshot_id:1}})).status,403)
  assert.equal((await f.call(history,`/${noop.body.actionHistoryId}`,{status:'redoable'},'PATCH')).status,403)
  console.log('PASS all-noop recorded only; generic history cannot forge or flip grouped actions')

  f=fixture();seed(f,1)
  let wake;const held=new Promise(r=>wake=r);let started;const paused=new Promise(r=>started=r)
  f.barrier(async()=>{started();await held})
  const single=f.call(sales,'/1/status',{sale_status:'awaiting_delivery',expected_updated_at:'same-second'},'PATCH')
  await paused
  const grouped=await f.call(sales,'/bulk-status',request(f,'cancelled'))
  assert.equal(grouped.status,200)
  const afterBulk=snapshot(f);wake()
  assert.equal((await single).status,409)
  assert.equal(snapshot(f),afterBulk)
  console.log('PASS actual single-status route cannot overwrite a concurrent bulk commit')

  f=fixture();seed(f,1)
  const valid=request(f)
  for(const invalid of [null,[],{...valid,items:[]},{...valid,items:[...valid.items,...valid.items]},{...valid,payment_method:'Cash'},{...valid,cancel_fee_usd:1},{...valid,skip_stock:'true'},{...valid,items:Array.from({length:26},(_,i)=>({...valid.items[0],id:i+1}))}]) {
    const before=snapshot(f);assert.equal((await f.call(sales,'/bulk-status',invalid)).status,400);assert.equal(snapshot(f),before)
  }
  for(const permissions of [{pos:true},{sales:'view'},{sales:'review'},{sales:true,'sales:status':false}]) {
    user={id:2,name:'Limited',role_code:'user',permissions:JSON.stringify(permissions)}
    assert.equal((await f.call(sales,'/bulk-status',valid)).status,403)
  }
  user={id:2,name:'Sales',role_code:'user',permissions:JSON.stringify({sales:true})}
  assert.equal((await f.call(sales,'/bulk-status',{...valid,skip_stock:true})).status,403)
  const owned=await f.call(sales,'/bulk-status',valid);assert.equal(owned.status,200)
  h=owned.body.actionHistoryId
  user={id:3,name:'Foreign',role_code:'user',permissions:JSON.stringify({sales:true})}
  assert.equal((await replay(f,h)).status,404)
  user={id:2,name:'Demoted',role_code:'user',permissions:JSON.stringify({sales:'view'})}
  assert.equal((await replay(f,h)).status,404)
  user={id:1,name:'Admin',username:'admin',role_code:'admin',permissions:JSON.stringify({all:true})}
  assert.equal((await f.call(history,`/${h}/undo`,{require_applied:true})).status,409)
  f.sql.prepare("UPDATE action_history SET undo_payload=json_set(undo_payload,'$.snapshot_id',999999) WHERE id=?").run(h)
  const forged=snapshot(f);assert.equal((await replay(f,h)).status,409);assert.equal(snapshot(f),forged)
  console.log('PASS bounded input, POS/review/view/action/skip/foreign/demoted permissions, generation and forged snapshot guards')

  {
  f=fixture();seed(f,25)
  f.sql.exec(`WITH RECURSIVE n(i) AS (VALUES(26) UNION ALL SELECT i+1 FROM n WHERE i<2000)
    INSERT INTO sale_items(id,sale_id,product_id,quantity,branch_id) SELECT i,1,1,1,1 FROM n`)
  let before=snapshot(f)
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,400)
  assert.equal(snapshot(f),before);assert.equal(f.metrics().batches,0)
  let limited=f.metrics().readRows.filter(r=>r.text.includes('FROM sale_items WHERE'))
  assert.equal(limited.length,1);assert.equal(limited[0].rows,151);assert.equal(limited[0].bindings,25)

  f=fixture();seed(f,25)
  f.sql.exec(`WITH RECURSIVE n(i) AS (VALUES(26) UNION ALL SELECT i+1 FROM n WHERE i<150)
    INSERT INTO sale_items(id,sale_id,product_id,quantity,branch_id) SELECT i,1,1,1,1 FROM n;
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<2000)
    INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity) SELECT (i%150)+1,1,1,1 FROM n`)
  before=snapshot(f)
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,400)
  assert.equal(snapshot(f),before);assert.equal(f.metrics().batches,0)
  limited=f.metrics().readRows.filter(r=>r.text.includes('FROM sale_item_batch_allocations a'))
  assert.equal(limited.length,1);assert.equal(limited[0].rows,301);assert.equal(limited[0].bindings,25)

  f=fixture();seed(f,1)
  f.sql.exec(`INSERT INTO returns(id,sale_id) VALUES(1,1);
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<2000)
    INSERT INTO return_items(return_id,sale_item_id,product_id,quantity) SELECT 1,1,1,0 FROM n`)
  before=snapshot(f)
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,400)
  assert.equal(snapshot(f),before);assert.equal(f.metrics().batches,0)
  limited=f.metrics().readRows.filter(r=>r.text.includes('FROM returns r JOIN return_items'))
  assert.equal(limited.length,1);assert.equal(limited[0].rows,301)
  assert.doesNotMatch(limited[0].text,/GROUP BY|SUM\(/)
  console.log('PASS SQL sentinel caps return only 151 lines/301 allocations/301 raw returns; 25 ids use one query')

  const addMovements=(f,count)=>f.sql.exec(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${count})
    INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reference_id) SELECT 1,1,'sale',0,1 FROM n`)
  f=fixture();seed(f,1);addMovements(f,2000);before=snapshot(f)
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,400)
  assert.equal(snapshot(f),before);assert.equal(f.metrics().batches,0)
  const fingerprintRead=f.metrics().readRows.find(r=>r.text.includes('AS movement_fingerprint'))
  assert.match(fingerprintRead.text,/LIMIT 257/)
  assert.equal(f.sql.prepare(fingerprintRead.text).get(1).movement_fingerprint,null)

  // Exactly at the cap may change status without stock. New movement rows
  // overflowing the cap must roll back, never save a truncated precondition.
  f=fixture();seed(f,1);addMovements(f,256)
  assert.equal((await f.call(sales,'/bulk-status',request(f))).status,200)
  f=fixture();seed(f,1);addMovements(f,256);before=snapshot(f)
  assert.equal((await f.call(sales,'/bulk-status',request(f,'cancelled'))).status,400)
  assert.equal(snapshot(f),before);assert.equal(f.metrics().batches,0)
  f=fixture();seed(f,1);addMovements(f,254)
  h=(await f.call(sales,'/bulk-status',request(f,'cancelled'))).body.actionHistoryId
  assert.equal((await replay(f,h)).status,200)
  before=snapshot(f)
  assert.equal((await replay(f,h,'redo',1)).status,409);assert.equal(snapshot(f),before)
  // A concurrent edit to the last selected member's history must also be
  // detected even when its first 256 rows still match the saved fingerprint.
  f=fixture();seed(f,1)
  h=(await f.call(sales,'/bulk-status',request(f,'cancelled'))).body.actionHistoryId
  addMovements(f,2000);before=snapshot(f)
  assert.equal((await replay(f,h)).status,409);assert.equal(snapshot(f),before)
  // A concurrent append beyond the cap also invalidates a prepared plan.
  f=fixture();seed(f,1);f.barrier(()=>{addMovements(f,2000);before=snapshot(f)})
  assert.equal((await f.call(sales,'/bulk-status',request(f,'cancelled'))).status,409)
  assert.equal(snapshot(f),before)
  console.log('PASS movement fingerprint overflow rejects reads, final writes, replay and concurrent append atomically')
  }
}
run().catch(error=>{console.error(error);process.exitCode=1})
