const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const pair = require('./test-product-merge-pair-http-native.cjs')
const { load } = require('./test-product-merge-origin-plan-native.cjs')
const { getDb } = load('lib/db.ts')
const { executeStockTransaction } = load('lib/stockTransaction.ts')
const { planProductMergeForwardStock } = load('lib/productMergeForwardStock.ts')
const { readProductMergeCaseSnapshot } = load('lib/productMergeSnapshot.ts')
const { readProductMergeReservations } = load('lib/productMergeReservations.ts')
const { productMergeGalleryAdditions } = load('lib/productMergeForwardCatalog.ts')
const tables = ['products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','product_images','promotion_rules',
  'product_cost_entries','inventory_movements','action_history','undo_snapshots','audit_logs','system_flags','sqlite_sequence']
const state = f => Object.fromEntries(tables.map(table => [table,f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const grants = { products: true, 'products:merge_duplicates': true, 'products:image': true, 'products:edit': true, 'products:price': true, product_cost_view: true, product_cost_edit: true, audit_log: true }
async function setup(worker, tier, receipt = true, tagged = true, catalog = false, selected = false, zero = false) {
  const f = await pair.world(worker, tier, receipt, tagged)
  if (catalog) await executeStockTransaction(getDb(f.env), [
    { sql: "UPDATE products SET image_path='',parent_id=2 WHERE id=1" },
    { sql: "UPDATE products SET image_path='loser-primary' WHERE id=2" },
    { sql: "INSERT INTO products(id,name,is_active,parent_id)VALUES(3,'Child',1,2),(4,'Unrelated',1,NULL)" },
    { sql: "INSERT INTO product_images(id,product_id,image_path,sort_order,created_at)VALUES(11,1,'shared',0,'old-k'),(12,2,'new-image',0,'old-l'),(13,2,'shared',1,'old-s')" },
    { sql: "INSERT INTO promotion_rules(id,title,rule_type,percent_off,product_ids,updated_at)VALUES(1,'Affected','percent_off',10,'[2,1,3]','old-p'),(2,'Unrelated','percent_off',5,'[4]','old-u')" },
  ], 'once')
  if (zero) await executeStockTransaction(getDb(f.env), [
    { sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=2' },
    { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=2' },
    { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=2' },
    { sql: 'UPDATE products SET stock_quantity=0 WHERE id=2' },
  ], 'once')
  const before = state(f)
  let historyId
  if (selected) {
    const snapshot = await readProductMergeCaseSnapshot(getDb(f.env),1,2,[])
    const reservations = await readProductMergeReservations(getDb(f.env),snapshot,'selected-http-origin',productMergeGalleryAdditions(snapshot).length)
    const compiled = planProductMergeForwardStock(snapshot,{...reservations,actorId:7,actorName:'Admin',requestId:'selected-http-original',requestDigest:'selected-catalog-native'},
      {canChangeImages:true,imageIds:reservations.imageIds,updatedAt:'2026-10-12T06:00:00Z',keeperChoice:{requiresProductEdit:true,fields:{name:'Chosen keeper',selling_price_usd:9},cost:{cost_price_usd:3}}})
    await executeStockTransaction(getDb(f.env),compiled.statements,'once');historyId=reservations.historyId
  } else {
    if(catalog&&tier==='free')f.env.PLAN_TIER='paid'
    const merged = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', client_request_id: 'replay-http-original' })
    assert.equal(merged.status,200,JSON.stringify(merged.json));historyId=merged.json.actionHistoryId
    f.env.PLAN_TIER=tier
  }
  const originalPlan = f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge.plan.v2'").get().payload_json
  return {...f,historyId,before,originalPlan}
}
function intercept(f, callback) {
  const raw = f.env.DB;let dispatches=0
  f.env.DB=new Proxy(raw,{get(target,key){
    if(key==='batch')return async rows=>{
      const transition=rows.some(row=>/INSERT INTO undo_snapshots\(id,kind,status,payload_json/.test(row.text))
      if(transition){dispatches++;await callback?.(rows,'before')}
      const result=await target.batch(rows)
      if(transition)await callback?.(rows,'after')
      return result
    }
    return target[key]
  }})
  return ()=>dispatches
}
const call = (f,direction,generation) => f.call(`/action-history/${f.historyId}/${direction}`,{expected_generation:generation,require_applied:true})
function invariant(f, undo) {
  const current=state(f)
  for(const table of ['product_batches','inventory_movements','product_cost_entries'])for(const row of f.before[table])assert.deepEqual(current[table].find(value=>value.id===row.id),row,table)
  for(const row of f.before.damaged_stock_lots){const actual=current.damaged_stock_lots.find(value=>value.id===row.id);const{quantity_remaining:_old,...before}=row;const{quantity_remaining:_new,...after}=actual;assert.deepEqual(after,before)}
  assert.equal(f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge.plan.v2'").get().payload_json,f.originalPlan)
  const originalLoser=f.before.products.find(row=>row.id===2).stock_quantity
  assert.deepEqual(current.products.filter(row=>row.id<=2).map(row=>[row.id,row.stock_quantity,row.is_active]),[[1,undo?.1:originalLoser===0?.1:.3,1],[2,undo?originalLoser:0,undo?1:0]])
  for(const row of f.before.branch_batch_stock)assert.equal(current.branch_batch_stock.find(value=>value.id===row.id).quantity, row.batch_id===2&&!undo?0:row.quantity)
  if(f.before.products.some(row=>row.id===4))assert.deepEqual(current.products.find(row=>row.id===4),f.before.products.find(row=>row.id===4))
  if(undo&&f.before.product_images.length){assert.deepEqual(current.product_images,f.before.product_images);assert.deepEqual(current.promotion_rules,f.before.promotion_rules);assert.equal(current.products.find(row=>row.id===3).parent_id,2)}
  assert.equal(current.system_flags.some(row=>row.key==='stock_transaction_permit'),false)
}
async function positive(worker,tier,receipt,tagged,catalog,mode) {
  const f=await setup(worker,tier,receipt,tagged,catalog,false,mode==='zero')
  try {
    let lost=false
    const batches=intercept(f,(_rows,phase)=>{if(mode==='lost-ack'&&phase==='after'&&!lost){lost=true;throw Error('network acknowledgement lost')}})
    if(mode==='nonadmin'){
      f.sql.prepare("INSERT INTO users(id,username,name,password,permissions,is_active)VALUES(8,'replay-operator','Replay operator','synthetic',?,1)").run(JSON.stringify(grants))
      f.sql.exec('UPDATE user_sessions SET user_id=8')
    }
    if(mode==='cache-fault')f.env.CACHE={get:async()=>{throw Error('synthetic KV down')},put:async()=>{throw Error('synthetic KV down')},delete:async()=>{}}
    for(const[direction,generation]of[['undo',0],['redo',1],['undo',2]]){
      const result=await call(f,direction,generation)
      assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(result.json.applied,true);assert.equal(result.json.generation,generation+1)
      invariant(f,direction==='undo')
      const before=state(f),retry=await call(f,direction,generation)
      assert.equal(retry.status,200,JSON.stringify(retry.json));assert.equal(retry.json.replayed,true);assert.deepEqual(state(f),before)
      assert.equal(result.json.item.server_replayable,true)
      assert.equal(result.json.item.created_by_id,7)
      const seal=f.sql.prepare('SELECT created_by_id,status FROM undo_snapshots WHERE id=?').get(result.json.item.undo_payload.seal_id)
      assert.equal(seal.created_by_id,mode==='nonadmin'?8:7);assert.equal(seal.status,'sealed')
    }
    assert.equal(batches(),3,'one transaction per physical generation, zero on repeats')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN('action_undo','action_redo')").get().n,3)
    console.log(`PASS HTTP replay ${tier} receipt=${receipt} tagged=${tagged} catalog=${catalog} mode=${mode}`)
  }finally{f.sql.close()}
}
async function refusals(worker,tier) {
  for(const fault of ['session','expiry','actor','role','image','source','child','branch','late-audit','generation','missing-generation','unknown-before','unknown-recovery']){
    const f=await setup(worker,tier,true,true,true)
    try {
      let rival,failRead=false
      const batches=intercept(f,(_rows,phase)=>{
        if(phase!=='before')return
        if(fault==='session')f.sql.exec('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP')
        if(fault==='expiry')f.sql.exec("UPDATE user_sessions SET expires_at='2000-01-01T00:00:00Z'")
        if(fault==='actor')f.sql.exec("UPDATE users SET permissions='{}' WHERE id=7")
        if(fault==='role')f.sql.exec("UPDATE roles SET permissions='{}' WHERE code='admin'")
        if(fault==='image')f.sql.prepare('UPDATE users SET username=?,role_id=NULL,permissions=? WHERE id=7').run('ordinary',JSON.stringify({...grants,'products:image':false}))
        if(fault==='child')f.sql.exec("UPDATE products SET parent_id=4,updated_at='rival' WHERE id=3")
        if(fault==='branch')f.sql.exec('UPDATE branches SET is_active=0 WHERE id=1')
        if(fault==='source')f.competeBeforeCommit([{sql:"UPDATE products SET brand='Source rival' WHERE id=1"}])
        if(fault==='late-audit')f.sql.exec("CREATE TRIGGER fail_replay_audit BEFORE INSERT ON audit_logs WHEN NEW.action='action_undo' BEGIN SELECT RAISE(ABORT,'merge_replay_late_failure');END")
        rival=state(f)
        if(fault==='unknown-before')throw Error('network failed before commit')
        if(fault==='unknown-recovery'){failRead=true;throw Error('network failed before outcome confirmed')}
      })
      if(fault==='unknown-recovery'){
        const raw=f.env.DB
        f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return text=>{
          const statement=target.prepare(text)
          if(failRead&&text.includes(' authorized,'))return new Proxy(statement,{get(t,k){if(k==='bind')return(...args)=>{const bound=t.bind(...args);return new Proxy(bound,{get(b,m){if(m==='first')return()=>{throw Error('network recovery unavailable')};return b[m]}})};return t[k]}})
          return statement
        };return target[key]}})
      }
      const before=state(f)
      const result=await f.call(`/action-history/${f.historyId}/undo`,{...(fault==='missing-generation'?{}:{expected_generation:fault==='generation'?2:0}),require_applied:true})
      const expected=['session','expiry','actor','role','image'].includes(fault)?403: fault==='missing-generation'?400: fault.startsWith('unknown')?503:409
      assert.equal(result.status,expected,JSON.stringify(result.json))
      const expectedState=structuredClone(rival||before)
      if(fault==='source')expectedState.products.find(row=>row.id===1).brand='Source rival'
      assert.deepEqual(state(f),expectedState,'refusal keeps complete physical/history graph and prior rival')
      assert.ok(batches()<=1)
      if(fault.startsWith('unknown'))assert.equal(result.json.action,'retry_same_request')
      console.log('PASS HTTP atomic refusal '+tier+' '+fault)
    }finally{f.sql.close()}
  }
  for(const[permission,code]of[['products:merge_duplicates','merge_replay_permission'],['products:image','image_permission_required'],['products:edit','product_edit_permission_required'],['products:price','price_permission_required'],['product_cost_edit','cost_permission_required']]){
    const f=await setup(worker,tier,true,true,true,true)
    try{
      const permissions={...grants,[permission]:false}
      f.sql.prepare('UPDATE users SET username=?,role_id=NULL,permissions=? WHERE id=7').run('ordinary',JSON.stringify(permissions))
      const before=state(f),result=await call(f,'undo',0)
      assert.equal(result.status,403,JSON.stringify(result.json));assert.equal(result.json.code,code);assert.deepEqual(state(f),before)
      console.log('PASS saved catalog permission '+tier+' '+permission)
    }finally{f.sql.close()}
  }
}
async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  if(process.argv.includes('--smoke')){await positive(worker,'free',true,true,false,'normal');return}
  for(const tier of ['free','paid']){
    for(const receipt of[false,true])for(const tagged of[false,true])await positive(worker,tier,receipt,tagged,true,'normal')
    for(const mode of['lost-ack','nonadmin','cache-fault','zero'])await positive(worker,tier,true,true,true,mode)
    await refusals(worker,tier)
  }
  console.log('LOCAL ACTUAL HTTP REPLAY: original real-pair producer plus explicit selected-catalog compiler producer permission controls; full invocation tails counted, no deployment/device certificate')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { main }
