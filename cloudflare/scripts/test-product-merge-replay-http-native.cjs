const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
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
const measurements=[]
let richTraceSaved=false
function measure(f){
  let queries=0;const raw=f.env.DB,sqls=[]
  const wrap=(statement,text)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),text);if(['first','all','run'].includes(key))return(...args)=>{queries++;sqls.push(text);return target[key](...args)};return target[key]}})
  f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return text=>wrap(target.prepare(text),text);if(key==='batch')return rows=>{queries+=rows.length;sqls.push(...rows.map(row=>row.text));return target.batch(rows)};return target[key]}})
  let original=f.call
  f.replaceCaller=caller=>{original=caller}
  f.call=async(url,body,method)=>{
    queries=0;sqls.length=0;const result=await original(url,body,method);const tier=f.env.PLAN_TIER
    assert.ok(queries<=(tier==='free'?50:1000),'actual current invocation tier including all response/cache tails')
    measurements.push({tier,url,status:result.status,queries,code:result.json.code})
    console.log('MEASURE '+JSON.stringify(measurements.at(-1)))
    if(process.argv.includes('--save-trace')&&!richTraceSaved&&url==='/products/possible-duplicates/merge'&&queries>=45){
      richTraceSaved=true
      fs.writeFileSync(path.resolve(__dirname,'../../../..','Records/Lanes/2026-10-12/MERGE-REPLAY-RICH-FORWARD-TRACE.json'),JSON.stringify({tier,status:result.status,queries,images:{keeper:1,loser:2},children:2,promotions:2,sqls},null,2))
    }
    return {...result,queries}
  }
  return f
}
async function setup(worker, tier, receipt = true, tagged = true, catalog = false, selected = false, zero = false) {
  const f = measure(await pair.world(worker, catalog&&!process.argv.includes('--free-forward')?'paid':tier, receipt, tagged))
  if (catalog) await executeStockTransaction(getDb(f.env), [
    { sql: "UPDATE products SET image_path='',parent_id=2 WHERE id=1" },
    { sql: "UPDATE products SET image_path='loser-primary' WHERE id=2" },
    { sql: "INSERT INTO products(id,name,is_active,parent_id)VALUES(3,'Child',1,2),(4,'Unrelated',1,NULL)" },
    { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(3,1,0),(4,1,0)' },
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
    if(process.argv.includes('--free-forward'))f.env.PLAN_TIER=tier
    const merged = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', client_request_id: 'replay-http-original' })
    if(process.argv.includes('--free-forward')&&merged.status===409){
      assert.equal(merged.json.code,'merge_request_budget')
      const current=state(f),expected=structuredClone(before)
      const marker=current.system_flags.find(row=>row.key==='core_invariants_build')
      assert.equal(JSON.parse(marker.value).status,'verified')
      current.system_flags=current.system_flags.filter(row=>row.key!=='core_invariants_build')
      expected.system_flags=expected.system_flags.filter(row=>row.key!=='core_invariants_build')
      assert.deepEqual(current,expected)
      console.log('PASS genuine Free rich forward remains bounded write-free admission refusal; Paid-produced Free replay is separate')
      return {...f,historyId:null,before}
    }
    assert.equal(merged.status,200,JSON.stringify(merged.json));historyId=merged.json.actionHistoryId
    f.env.PLAN_TIER=tier
  }
  const originalPlan = f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='product.merge.plan.v2'").get().payload_json
  if(selected)assert.equal((await f.call(`/action-history/${historyId}/undo`,{expected_generation:-1})).status,400)
  f.env.PLAN_TIER=tier
  if(catalog&&tier==='free'){
    const replayWorker=worker()
    f.replaceCaller(async(url,body,method='POST')=>{
      const tasks=[]
      const response=await replayWorker.default.fetch(new Request('https://admin.business.test/api'+url,{method,
        headers:{cookie:'bos_session=counted-set-native','content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)}),f.env,
        {waitUntil:promise=>tasks.push(Promise.resolve(promise)),passThroughOnException(){}})
      while(tasks.length)await Promise.all(tasks.splice(0))
      return{status:response.status,json:await response.json()}
    })
    assert.equal((await f.call(`/action-history/${historyId}/undo`,{expected_generation:-1})).status,400)
  }
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
  if(f.historyId===null){f.sql.close();return}
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
      let rival,failRead=false,failedOnce=false
      const batches=intercept(f,(_rows,phase)=>{
        if(fault==='unknown-recovery'&&phase==='after'&&!failedOnce){failedOnce=true;failRead=true;throw Error('network acknowledgement lost after commit')}
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
        if(fault==='unknown-before'&&!failedOnce){failedOnce=true;throw Error('network failed before commit')}
      })
      if(fault==='unknown-recovery'){
        const raw=f.env.DB
        f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return text=>{
          const statement=target.prepare(text)
          if(failRead&&text.includes(' authorized,'))return new Proxy(statement,{get(t,k){if(k==='bind')return(...args)=>{const bound=t.bind(...args);return new Proxy(bound,{get(b,m){if(m==='all')return async(...values)=>{await b.all(...values);throw Error('network recovery unavailable')};return b[m]}})};return t[k]}})
          return statement
        };return target[key]}})
      }
      const before=state(f)
      const result=await f.call(`/action-history/${f.historyId}/undo`,{...(fault==='missing-generation'?{}:{expected_generation:fault==='generation'?2:0}),require_applied:true})
      const expected=['session','expiry','actor','role','image'].includes(fault)?403: fault==='missing-generation'?400: fault.startsWith('unknown')?503:409
      assert.equal(result.status,expected,JSON.stringify(result.json))
      const expectedState=structuredClone(rival||before)
      if(fault==='source')expectedState.products.find(row=>row.id===1).brand='Source rival'
      if(fault==='unknown-recovery')invariant(f,true)
      else assert.deepEqual(state(f),expectedState,'refusal keeps complete physical/history graph and prior rival')
      assert.ok(batches()<=1)
      if(fault.startsWith('unknown'))assert.equal(result.json.action,'retry_same_request')
      if(fault.startsWith('unknown')){
        failRead=false
        const committed=state(f),retry=await call(f,'undo',0)
        assert.equal(retry.status,200,JSON.stringify(retry.json));invariant(f,true)
        if(fault==='unknown-recovery'){assert.equal(retry.json.replayed,true);assert.deepEqual(state(f),committed);assert.equal(batches(),1)}
        else assert.equal(batches(),2)
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='action_undo'").get().n,1)
      }
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
async function budget(worker,tier){
  async function trial(extra){
    const f=await setup(worker,tier,true,true,false)
    try{
      const before=state(f),raw=f.env.DB;let injected=false
      const batches=intercept(f)
      const counted=f.env.DB
      f.env.DB=new Proxy(counted,{get(target,key){if(key==='batch')return async rows=>{
        if(!injected&&rows.some(row=>row.text.includes('canonicalBatches'))){
          injected=true
          const hook=globalThis[Symbol.for('business-os.request-metrics.v1')]
          for(let index=0;index<extra;index++){hook.rawD1Start(1);await raw.prepare('SELECT 1 AS bounded_upstream_read').first()}
        }
        return target.batch(rows)
      };return target[key]}})
      const result=await call(f,'undo',0)
      if(result.status===400){assert.equal(result.json.code,'merge_replay_over_plan_budget');assert.equal(result.json.outcome,'not_dispatched');assert.equal(batches(),0);assert.deepEqual(state(f),before)}
      else{assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(batches(),1);invariant(f,true)}
      return result.status===200
    }finally{f.sql.close()}
  }
  let accepted=0,refused=tier==='free'?30:990
  assert.equal(await trial(refused),false)
  while(refused-accepted>1){const middle=Math.floor((accepted+refused)/2);if(await trial(middle))accepted=middle;else refused=middle}
  assert.equal(await trial(accepted),true);assert.equal(await trial(refused),false)
  console.log(`PASS exact actual upstream-read admission boundary ${tier}: ${accepted} accepted, ${refused} refused before stock dispatch`)
}
async function edgeControls(worker,tier){
  for(const mode of['server-managed','stale-head','original-image','derived-image','response-fault','tail-retries']){
    const f=await setup(worker,tier,true,true,true)
    try{
      let once=false,responseFault=false,permissionReads=0
      const failures=new Set()
      const batches=intercept(f,(_rows,phase)=>{
        if(phase==='after'&&mode==='response-fault'&&!once){once=true;responseFault=true}
        if(phase==='after'&&mode==='tail-retries'&&!once){once=true;throw Error('network lost acknowledgement')}
      })
      if(mode==='server-managed'){
        const pointer=JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(f.historyId).undo_payload)
        const before=state(f)
        assert.equal((await f.call('/action-history',{scope:'products',entity:'product_merge',entity_id:pointer.operation_id,undo_payload:pointer,redo_payload:pointer})).status,403)
        assert.equal((await f.call(`/action-history/${f.historyId}`,{status:'redoable'},'PATCH')).status,403)
        assert.deepEqual(state(f),before);assert.equal(batches(),0)
      }else if(mode==='stale-head'){
        assert.equal((await call(f,'undo',0)).status,200);assert.equal((await call(f,'redo',1)).status,200)
        const before=state(f);const stale=await call(f,'undo',0)
        assert.equal(stale.status,409);assert.equal(stale.json.code,'undo_history_stale');assert.deepEqual(state(f),before);assert.equal(batches(),2)
      }else if(mode.endsWith('image')){
        if(mode==='derived-image')assert.equal((await call(f,'undo',0)).status,200)
        f.sql.prepare('INSERT INTO product_images(id,product_id,image_path)VALUES(?,4,?)').run(mode==='original-image'?12:14,'Later unrelated image')
        const before=state(f),result=await call(f,mode==='original-image'?'undo':'redo',mode==='original-image'?0:1)
        assert.equal(result.status,409,JSON.stringify(result.json));assert.deepEqual(state(f),before)
      }else{
        const raw=f.env.DB
        if(mode==='tail-retries'){
          f.sql.exec('DELETE FROM cache_versions')
          f.env.CACHE={get:async()=>{throw Error('synthetic KV unavailable')},put:async()=>{throw Error('synthetic KV unavailable')},delete:async()=>{}}
        }
        f.env.DB=new Proxy(raw,{get(target,key){
          if(key==='prepare')return text=>{
            const statement=target.prepare(text)
            return new Proxy(statement,{get(t,k){if(k==='bind')return(...args)=>{
              const bound=t.bind(...args)
              return new Proxy(bound,{get(b,m){if(m==='all')return async(...values)=>{
                const result=await b.all(...values)
                if(responseFault&&text.includes('SELECT * FROM action_history WHERE id=')){responseFault=false;throw Error('network response read lost')}
                if(mode==='tail-retries'){
                  const group=text.includes('SELECT namespace, version FROM cache_versions')?'cache-read':text.includes('INSERT INTO quota_usage')?'quota':null
                  if(group&&!failures.has(group)){failures.add(group);throw Error('D1_ERROR: internal error')}
                  if(text.includes('SELECT payload_json FROM undo_snapshots')){permissionReads++;if(permissionReads===1||permissionReads===3)throw Error('D1_ERROR: internal error')}
                }
                return result
              };return b[m]}})
            };return t[k]}})
          }
          if(key==='batch')return async rows=>{
            const result=await target.batch(rows)
            if(mode==='tail-retries'&&rows.some(row=>row.text.includes('INSERT INTO cache_versions'))&&!failures.has('cache-write')){failures.add('cache-write');throw Error('D1_ERROR: internal error')}
            return result
          }
          return target[key]
        }})
        const result=await call(f,'undo',0)
        assert.equal(result.status,mode==='response-fault'?503:200,JSON.stringify(result.json));invariant(f,true)
        if(mode==='response-fault'){assert.equal(result.json.code,'merge_replay_outcome_unknown');assert.equal(result.json.action,'retry_same_request')}
        else assert.deepEqual([...failures].sort(),tier==='free'?['cache-read','cache-write','quota']:['cache-read','cache-write'])
        const before=state(f),retry=await call(f,'undo',0)
        assert.equal(retry.status,200);assert.equal(retry.json.replayed,true);assert.deepEqual(state(f),before);assert.equal(batches(),1)
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='action_undo'").get().n,1)
      }
      console.log(`PASS actual HTTP edge control ${tier} ${mode}`)
    }finally{f.sql.close()}
  }
}
async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  if(process.argv.includes('--smoke')){await positive(worker,'free',true,true,false,'normal');return}
  if(process.argv.includes('--free-forward')){await positive(worker,'free',true,true,true,'normal');return}
  if(process.argv.includes('--edge-controls')){for(const tier of ['free','paid'])await edgeControls(worker,tier);return}
  for(const tier of ['free','paid']){
    for(const receipt of[false,true])for(const tagged of[false,true])await positive(worker,tier,receipt,tagged,false,'normal')
    for(const receipt of[false,true])for(const tagged of[false,true])await positive(worker,tier,receipt,tagged,true,'normal')
    for(const mode of['lost-ack','nonadmin','cache-fault','zero'])await positive(worker,tier,true,true,true,mode)
    await refusals(worker,tier)
    await budget(worker,tier)
    await edgeControls(worker,tier)
  }
  console.log('LOCAL ACTUAL HTTP REPLAY: original real-pair producer plus explicit selected-catalog compiler producer permission controls; full invocation tails counted, no deployment/device certificate')
  console.log('TOTALS '+JSON.stringify({requests:measurements.length,free:Math.max(...measurements.filter(row=>row.tier==='free').map(row=>row.queries)),paid:Math.max(...measurements.filter(row=>row.tier==='paid').map(row=>row.queries))}))
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { main }
