const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

function state(f) {
  return Object.fromEntries(['products','branch_stock','branch_batch_stock','damaged_stock_lots','inventory_movements','sale_items','sale_item_batch_allocations','sale_amendments','sale_mutation_receipts','sale_mutation_members','undo_snapshots','action_history']
    .map(table=>[table,f.sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]))
}

async function scenario(makeWorker, tier, shape, source, lines, fault='none', baseline=false) {
  let worker
  const received=source!=='unlotted'
  const f=await h.world(()=>worker=makeWorker(),tier,'zero',sql=>{
    h.seed(1,received)(sql)
    if(lines==='multiple')sql.exec(`INSERT INTO products(id,name,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,stock_quantity,is_active)
      SELECT 2,'Second product',selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,1,1 FROM products WHERE id=1;
      INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(2,1,1);
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(2,2,'second','2026-09-02',2,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(2,1,${received?1:0});`)
  })
  let queries=[]
  let injectTail=false
  const tailFailures=new Set(),tailAttempts=new Map()
  const tailClass=sql=>/SELECT response_json FROM sale_mutation_receipts WHERE id=/.test(sql)?'receipt':/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':fault.startsWith('tail_')&&/WITH addition_context/.test(sql)?'preflight_products':fault.startsWith('tail_')&&/SELECT \* FROM promotion_rules/.test(sql)?'preflight_pricing':fault.startsWith('tail_')&&/SELECT s\.\*,COALESCE/.test(sql)?'preflight_sale':fault==='tail_over'&&/SELECT request_digest,response_json/.test(sql)?'preflight_receipt':null
  const tailRetry=sql=>{
    const kind=injectTail&&tailClass(sql)
    if(!kind)return false
    tailAttempts.set(kind,(tailAttempts.get(kind)||0)+1)
    if(tailFailures.has(kind))return false
    tailFailures.add(kind);return true
  }
  const raw=f.env.DB
  const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){
    if(key==='bind')return (...args)=>wrap(target.bind(...args),sql)
    if(['all','first','run'].includes(key))return (...args)=>{queries.push(sql);if(tailRetry(sql))return Promise.reject(new Error('D1_ERROR: network reset before tail attempt'));return target[key](...args)}
    return target[key]
  }})
  f.env.DB=new Proxy(raw,{get(target,key){
    if(key==='prepare')return sql=>wrap(target.prepare(sql),sql)
    if(key==='batch')return statements=>{queries.push(...statements.map(statement=>statement.text));if(statements.some(statement=>tailRetry(statement.text)))return Promise.reject(new Error('D1_ERROR: network reset before tail attempt'));return target.batch(statements)}
    return target[key]
  }})
  const measured=[]
  async function call(url,body,stage) {
    queries=[]
    const tasks=[]
    const response=await worker.default.fetch(new Request('https://admin.business.test/api'+url,{method:'POST',headers:{cookie:'bos_session=counted-set-native','content-type':'application/json',origin:'https://admin.business.test'},body:JSON.stringify(body)}),f.env,{waitUntil:promise=>tasks.push(Promise.resolve(promise)),passThroughOnException(){}})
    while(tasks.length)await Promise.all(tasks.splice(0))
    const json=await response.json()
    const row={tier,shape,source,lines,fault,stage,status:response.status,queries:queries.length,code:json.code}
    measured.push(row)
    console.log(JSON.stringify(row))
    if(stage==='accepted'||stage==='refused')console.log('SQL_CLASSES '+JSON.stringify(queries.map(sql=>sql.trim().split(/\s+/).slice(0,12).join(' '))))
    if(!baseline)assert.ok(queries.length<=(tier==='free'?50:1000),'every full HTTP request including auth/bootstrap/awaited tails must fit')
    return {status:response.status,json,queries:queries.length}
  }
  try {
    const money=h.loadStockSession('lib/moneyPrecision.ts')
    const price=f.sql.prepare('SELECT selling_price_usd FROM products WHERE id=1').get().selling_price_usd
    const quote=q=>({gross_usd:money.multiplyMoney4(price,q),product_discount_usd:0,manual_discount_usd:0,total_usd:money.multiplyMoney4(price,q),total_khr:money.multiplyMoney4(money.multiplyMoney4(price,q),4000)})
    const ordinary=(productId,index,q)=>({product_id:productId,branch_id:1,quantity:q,...(source==='explicit'?{batch_id:productId}:source==='unlotted'?{unlotted_stock:true}:{}),client_line_key:'budget-line-'+index,pricing_source:'selling',pricing_quote:quote(q)})
    const tagged=(productId,index,q)=>({...ordinary(productId,index,q),batch_id:undefined,unlotted_stock:undefined,damaged_lot_id:productId})
    const base={offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items:[{...ordinary(1,'base',0.1),applied_price_usd:price}],exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:money.multiplyMoney4(price,0.1),client_request_id:'budget-base'}
    const created=await call('/sales',base,'base')
    assert.equal(created.status,200,JSON.stringify(created.json))
    if(shape!=='ordinary') {
      const taggedProducts=shape==='tagged'&&lines==='multiple'?[1,2]:[1]
      for(const productId of taggedProducts)assert.equal((await call('/inventory/adjust',{type:'remove',productId,branchId:1,...(received?{batchId:productId}:{}),quantity:0.3,conditionTag:'damaged',reason:'Budget grid tag',client_request_id:'budget-tag-'+productId},'tag')).status,200)
    }
    let items=shape==='tagged'?[tagged(1,0,0.1),tagged(1,1,0.2)]:shape==='mixed'?[tagged(1,0,0.1),ordinary(1,1,0.2)]:[ordinary(1,0,0.1),ordinary(1,1,0.2)]
    if(lines==='single')items=items.slice(0,1)
    if(lines==='multiple')items.push(shape==='tagged'?tagged(2,2,0.1):ordinary(2,2,0.1))
    const body={money_precision_version:1,client_request_id:'budget-add',expected_exchange_rate:4000,items}
    const url='/sales/'+created.json.id+'/items'
    const review=await call(url,body,'review')
    assert.equal(review.status,409,JSON.stringify(review.json));assert.ok(review.json.header_quote,JSON.stringify(review.json))
    body.expected_header_quote=review.json.header_quote
    if(fault.startsWith('tail')) {
      f.sql.exec("DELETE FROM cache_versions WHERE namespace IN ('stock','sales')")
      const cache=f.env.CACHE
      f.env.CACHE=new Proxy(cache,{get(target,key){if(key==='get')return async name=>name.startsWith('v2:')?null:target.get(name);if(key==='put')return async(name,...args)=>{if(name.startsWith('v2:'))throw new Error('injected KV write failure');return target.put(name,...args)};return target[key]}})
      injectTail=true
    }
    const before=state(f)
    if(fault==='condition')f.competeBeforeCommit([{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1"}])
    if(fault==='unknown')f.sql.exec("CREATE TEMP TRIGGER unrelated_add_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: unrelated_audit_constraint');END")
    if(fault==='late') {
      f.failWhenSqlMatches(/INSERT INTO audit_logs/)
      const refused=await call(url,body,'late')
      if(refused.json.code!=='sale_addition_over_plan_budget')assert.equal(refused.status,500,JSON.stringify(refused.json))
      assert.deepEqual(state(f),before)
      if(refused.json.code==='sale_addition_over_plan_budget'){assert.equal(refused.json.outcome,'not_dispatched');return measured}
    }
    if(fault==='ack')f.loseNextCommitAcknowledgement()
    const added=await call(url,body,'accepted')
    injectTail=false
    if(fault==='condition') {
      assert.equal(added.status,409);assert.ok(['counted_quantity_conflict','sale_line_preimage_conflict'].includes(added.json.code))
      const rival=state(f);rival.damaged_stock_lots[0].condition_tag=before.damaged_stock_lots[0].condition_tag;assert.deepEqual(rival,before)
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE request_id='budget-add'").get().n,0)
      assert.equal((await call(url,body,'edited_same_key')).status,200)
      return measured
    }
    if(fault==='unknown') {
      assert.equal(added.status,500,JSON.stringify(added.json));assert.equal(added.json.code,undefined);assert.deepEqual(state(f),before)
      f.sql.exec('DROP TRIGGER unrelated_add_failure');assert.equal((await call(url,body,'unknown_retry')).status,200);return measured
    }
    if(added.status!==200) {
      assert.equal(added.status,409,JSON.stringify(added.json));assert.equal(added.json.code,'sale_addition_over_plan_budget')
      assert.equal(added.json.outcome,'not_dispatched');assert.deepEqual(state(f),before)
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE request_id='budget-add'").get().n,0)
      console.log('PASS explicit non-dispatched budget refusal '+JSON.stringify({tier,shape,source,lines,fault}))
      return measured
    }
    const expected=items.map(item=>({quantity:-item.quantity,user_id:7,reference_id:created.json.id}))
    assert.deepEqual(f.sql.prepare('SELECT quantity,user_id,reference_id FROM inventory_movements WHERE reference_id=? AND reason=? ORDER BY id').all(created.json.id,'Item added to sale #'+created.json.id),expected)
    assert.deepEqual(f.sql.prepare("SELECT quantity_after,units_moved FROM sale_amendments WHERE sale_id=? AND kind='line_added' ORDER BY id").all(created.json.id),items.map(item=>({quantity_after:item.quantity,units_moved:-item.quantity})))
    const after=state(f)
    if(fault.startsWith('tail')) {
      const expected=tier==='free'?{receipt:2,versions:2,quota:2,handoff:2}:{receipt:2,versions:2,handoff:2}
      if(fault.startsWith('tail_'))Object.assign(expected,{preflight_products:2,preflight_pricing:2,preflight_sale:2})
      assert.deepEqual(Object.fromEntries(tailAttempts),expected,'actual bounded plan-specific tail and preceding read retries')
      if(fault==='tail_boundary')assert.equal(added.queries,50,'full successful request exactly at Free boundary including all awaited retries')
    }
    assert.equal((await call(url,body,'replay')).status,200);assert.deepEqual(state(f),after)
    if(!baseline) {
      if(fault==='undo_condition') {
        f.competeBeforeCommit([{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1"}])
        const refused=await call('/action-history/'+added.json.actionHistoryId+'/undo',{expected_generation:0},'undo_condition')
        assert.equal(refused.status,409,JSON.stringify(refused.json));assert.equal(refused.json.code,'undo_record_changed')
        const rival=state(f);rival.damaged_stock_lots[0].condition_tag=after.damaged_stock_lots[0].condition_tag;assert.deepEqual(rival,after)
        await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb({DB:raw}),[{sql:"UPDATE damaged_stock_lots SET condition_tag='damaged' WHERE id=1"}], 'once')
      }
      assert.equal((await call('/action-history/'+added.json.actionHistoryId+'/undo',{expected_generation:0},'undo')).status,200)
      for(const row of before.branch_stock)assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(row.product_id,row.branch_id).quantity,row.quantity)
      assert.equal((await call('/action-history/'+added.json.actionHistoryId+'/redo',{expected_generation:1},'redo')).status,200)
      for(const row of after.branch_stock)assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(row.product_id,row.branch_id).quantity,row.quantity)
    }
    console.log('PASS full measured sale-addition grid '+JSON.stringify({tier,shape,source,lines,fault}))
    return measured
  }finally{f.sql.close()}
}

async function grid(makeWorker,baseline=false,controls=false) {
  const measured=[]
  for(const tier of ['free','paid'])for(const shape of ['tagged','ordinary','mixed'])for(const source of ['explicit','fifo','unlotted'])for(const lines of controls?['single','repeated']:['single','repeated','multiple'])for(const fault of controls?['late','ack']:['none'])
    measured.push(...await scenario(makeWorker,tier,shape,source,lines,fault,baseline))
  if(baseline)assert.ok(measured.some(row=>row.tier==='free'&&row.status===200&&row.queries>50),'preserve actual overbudget committing base RED')
  console.log('GRID_SUMMARY '+JSON.stringify({baseline,controls,requests:measured.length,maxima:Object.fromEntries(['free','paid'].map(tier=>[tier,Math.max(...measured.filter(row=>row.tier===tier).map(row=>row.queries))]))}))
  return measured
}

async function discriminators(makeWorker) {
  for(const tier of ['free','paid'])for(const fault of ['condition','undo_condition','unknown','tail'])await scenario(makeWorker,tier,fault==='tail'?'ordinary':'tagged',fault==='tail'?'unlotted':'explicit',fault==='tail'?'repeated':'single',fault)
  for(const fault of ['tail_boundary','tail_over'])await scenario(makeWorker,'free','ordinary','unlotted','repeated',fault)
}
async function main(){const makeWorker=await h.bundle.exports.bundleWorker();await grid(makeWorker);await grid(makeWorker,false,true);await discriminators(makeWorker)}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1})
module.exports={scenario,grid,state,discriminators}
