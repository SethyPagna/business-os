const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const {state:baseState} = require('./test-counted-add-budget-native.cjs')
const state=f=>({...baseState(f),counted_sale_item_conditions:f.sql.prepare('SELECT * FROM counted_sale_item_conditions ORDER BY sale_item_id').all()})

async function amendmentWorld(makeWorker,tier,source='ordinary') {
  const f=await h.world(makeWorker,tier,'zero',sql=>{h.seed(1,true)(sql);sql.exec('UPDATE products SET selling_price_usd=2,selling_price_khr=8000 WHERE id=1')})
  const money=h.loadStockSession('lib/moneyPrecision.ts')
  const price=f.sql.prepare('SELECT selling_price_usd FROM products WHERE id=1').get().selling_price_usd
  const quote=q=>({gross_usd:money.multiplyMoney4(price,q),product_discount_usd:0,manual_discount_usd:0,total_usd:money.multiplyMoney4(price,q),total_khr:money.multiplyMoney4(money.multiplyMoney4(price,q),4000)})
  if(source==='tagged')assert.equal((await h.tag(f,0.6,true,'amendment-tag')).status,200)
  const items=[0.3,0.1].map((quantity,index)=>({product_id:1,branch_id:1,quantity,client_line_key:'amendment-line-'+index,pricing_source:'selling',pricing_quote:quote(quantity),...(source==='tagged'?{damaged_lot_id:1}:{batch_id:1})}))
  const created=await f.call('/sales',{offline_owner:{version:1,actor_id:7,organization_id:null,authority:'https://admin.business.test',runtime:'cloudflare-workers'},branch_id:1,money_precision_version:1,items,exchange_rate:4000,payment_method:'Cash',payment_currency:'USD',amount_paid_usd:money.multiplyMoney4(price,0.4),client_request_id:'amendment-base'})
  assert.equal(created.status,200,JSON.stringify(created.json))
  const line=f.sql.prepare('SELECT id FROM sale_items WHERE sale_id=? ORDER BY id').get(created.json.id)
  async function amend(kind,quantity,key,fault,extra={}) {
    const body={kind,sale_item_id:line.id,quantity,money_precision_version:1,expected_exchange_rate:4000,client_request_id:key,...extra}
    for(let attempt=0;attempt<4;attempt++) {
      if(fault&&body.expected_header_quote) {await fault();fault=null}
      const result=await f.call('/sales/'+created.json.id+'/amendments',body)
      console.log('AMENDMENT_RESPONSE '+JSON.stringify({status:result.status,code:result.json.code,pricing_quotes:result.json.pricing_quotes,header_quote:result.json.header_quote}))
      if(result.json.code==='sale_pricing_quote_conflict')body.pricing_quote=result.json.pricing_quotes[0]
      else if(result.json.code==='sale_header_quote_conflict')body.expected_header_quote=result.json.header_quote
      else return {...result,body}
    }
    throw new Error('Review did not converge')
  }
  return {f,amend,quote,saleId:created.json.id,lineId:line.id}
}
async function main() {
  const makeWorker=await h.bundle.exports.bundleWorker()
  for(const tier of ['free','paid'])for(const source of ['ordinary','tagged']) {
    const {f,amend}=await amendmentWorld(makeWorker,tier,source)
    try {
      assert.equal((await amend('line_quantity_decreased',0.1,'amendment-decrease')).status,200)
      const quantities=f.state()
      console.log('AMENDMENT_END '+JSON.stringify({tier,source,physical:quantities.physical,cache:quantities.cache,receipt:quantities.lots[0].quantity,tags:quantities.tags}))
      assert.equal(quantities.physical,0.7,'exact physical after .6 plus .1')
      assert.equal(quantities.cache,0.7,'exact product cache')
      assert.equal(quantities.lots[0].quantity,0.7,'exact original receipt quantity')
      if(source==='tagged')assert.equal(quantities.tags[0].quantity_remaining,0.3,'exact restored tag quantity')
      else assert.equal(f.sql.prepare('SELECT quantity FROM sale_item_batch_allocations ORDER BY id').get().quantity,0.2,'exact remaining original allocation')
    }finally{f.sql.close()}
  }
}
async function proveWriters(makeWorker) {
  for(const tier of ['free','paid'])for(const source of ['ordinary','tagged'])for(const operation of ['increase','remove','replace']) {
    const {f,amend,quote,saleId}=await amendmentWorld(makeWorker,tier,source)
    try {
      const replacement={product_id:1,branch_id:1,quantity:source==='tagged'?0.5:0.8,client_line_key:'replacement',pricing_source:'selling',pricing_quote:quote(source==='tagged'?0.5:0.8),...(source==='tagged'?{damaged_lot_id:1}:{batch_id:1})}
      const result=await amend(operation==='increase'?'line_quantity_increased':operation==='remove'?'line_removed':'line_replaced',operation==='increase'?0.1:undefined,'amendment-'+operation,null,operation==='replace'?{replacement}:{})
      assert.equal(result.status,200,JSON.stringify(result.json))
      const after=state(f)
      assert.equal((await f.call('/sales/'+saleId+'/amendments',result.body)).status,200)
      assert.deepEqual(state(f),after,'receipt replay must not repeat stock/allocation/audit')
      const expected=operation==='increase'?0.5:operation==='remove'?0.9:source==='tagged'?0.4:0.1
      assert.equal(f.state().physical,expected)
      assert.equal(f.state().cache,expected)
      assert.equal(f.state().lots[0].quantity,expected)
      const live=f.sql.prepare('SELECT id,quantity FROM sale_items WHERE sale_id=? ORDER BY id').all(saleId)
      for(const item of live)if(source==='ordinary')assert.equal(f.sql.prepare('SELECT quantity FROM sale_item_batch_allocations WHERE sale_item_id=?').get(item.id).quantity,item.quantity)
      console.log('PASS exact amendment writer '+JSON.stringify({tier,source,operation,expected}))
    }finally{f.sql.close()}
  }
}
async function proveRaces(makeWorker) {
  for(const tier of ['free','paid'])for(const source of ['ordinary','tagged'])for(const operation of ['increase','decrease','remove','replace'])for(const fault of ['identity','membership','allocation','late','ack']) {
    if(source==='tagged'&&fault==='allocation')continue
    const {f,amend,quote,saleId}=await amendmentWorld(makeWorker,tier,source)
    try {
      const before=state(f)
      const rivalSql=fault==='identity'?(source==='tagged'?"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1":"UPDATE product_batches SET received_at='2026-09-09' WHERE id=1")
        :fault==='membership'?"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,1,0.05,0,'opened','remove')"
        :'UPDATE sale_item_batch_allocations SET released_quantity=0.1 WHERE id=1'
      const hook=()=>{
        if(fault==='late')f.failWhenSqlMatches(/INSERT INTO audit_logs/)
        else if(fault==='ack')f.loseNextCommitAcknowledgement()
        else f.competeBeforeCommit([{sql:rivalSql}])
      }
      const replacement={product_id:1,branch_id:1,quantity:0.2,client_line_key:'replacement',pricing_source:'selling',pricing_quote:quote(0.2),...(source==='tagged'?{damaged_lot_id:1}:{batch_id:1})}
      const kind={increase:'line_quantity_increased',decrease:'line_quantity_decreased',remove:'line_removed',replace:'line_replaced'}[operation]
      const result=await amend(kind,operation==='increase'||operation==='decrease'?0.1:undefined,'amendment-race',hook,operation==='replace'?{replacement}:{})
      if(fault==='ack') {
        assert.equal(result.status,200,JSON.stringify(result.json))
        const after=state(f);assert.equal((await f.call('/sales/'+saleId+'/amendments',result.body)).status,200);assert.deepEqual(state(f),after)
      }else if(fault==='late') {
        assert.equal(result.status,500,JSON.stringify(result.json));assert.deepEqual(state(f),before)
        assert.equal((await f.call('/sales/'+saleId+'/amendments',result.body)).status,200,'late rollback releases same request identity')
      }else {
        assert.equal(result.status,409,JSON.stringify(result.json));assert.equal(result.json.code,'write_conflict')
        const after=state(f)
        if(fault==='identity'&&source==='tagged'){assert.equal(after.damaged_stock_lots[0].condition_tag,'opened');after.damaged_stock_lots[0].condition_tag=before.damaged_stock_lots[0].condition_tag}
        if(fault==='identity'&&source==='ordinary'){assert.equal(after.product_batches[0].received_at,'2026-09-09');after.product_batches[0].received_at=before.product_batches[0].received_at}
        if(fault==='membership'){assert.ok(after.damaged_stock_lots.find(row=>row.id===90));after.damaged_stock_lots=after.damaged_stock_lots.filter(row=>row.id!==90)}
        if(fault==='allocation'){
          assert.equal(after.sale_item_batch_allocations[0].released_quantity,0.1);after.sale_item_batch_allocations[0].released_quantity=before.sale_item_batch_allocations[0].released_quantity
          assert.equal(after.sale_write_revisions[0].revision,before.sale_write_revisions[0].revision+1);after.sale_write_revisions[0].revision=before.sale_write_revisions[0].revision
        }
        assert.deepEqual(after,before,'only rival effects survive, including immutable receipt/cost/history')
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_mutation_receipts WHERE request_id='amendment-race'").get().n,0)
        const restoreSql=fault==='identity'?(source==='tagged'?"UPDATE damaged_stock_lots SET condition_tag='damaged' WHERE id=1":"UPDATE product_batches SET received_at='2026-09-01' WHERE id=1")
          :fault==='membership'?'DELETE FROM damaged_stock_lots WHERE id=90':'UPDATE sale_item_batch_allocations SET released_quantity=0 WHERE id=1'
        await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:restoreSql}],'once')
        assert.equal((await f.call('/sales/'+saleId+'/amendments',result.body)).status,200,'restored identity permits edited retry without effects from refusal')
      }
      console.log('PASS actual amendment race '+JSON.stringify({tier,source,operation,fault}))
    }finally{f.sql.close()}
  }
}
async function proveTailAndActivation(makeWorker) {
  for(const tier of ['free','paid'])for(const source of ['ordinary','tagged']) {
    const {f,amend,saleId}=await amendmentWorld(makeWorker,tier,source)
    try {
      const raw=f.env.DB,attempts=new Map(),failed=new Set()
      const retry=sql=>{
        const kind=/SELECT response_json FROM sale_mutation_receipts WHERE id=/.test(sql)?'receipt':/SELECT namespace, version FROM cache_versions/.test(sql)?'versions':/INSERT INTO quota_usage/.test(sql)?'quota':/INSERT INTO cache_versions/.test(sql)?'handoff':null
        if(!kind)return false
        attempts.set(kind,(attempts.get(kind)||0)+1)
        if(failed.has(kind))return false
        failed.add(kind);return true
      }
      const wrap=(statement,sql)=>new Proxy(statement,{get(target,key){if(key==='bind')return(...args)=>wrap(target.bind(...args),sql);if(['all','first','run'].includes(key))return(...args)=>retry(sql)?Promise.reject(new Error('D1_ERROR: network reset before tail attempt')):target[key](...args);return target[key]}})
      const hook=()=>{
        f.sql.exec("DELETE FROM cache_versions WHERE namespace IN ('stock','sales')")
        f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('Injected KV unavailable')},delete:async()=>{}}
        f.env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);if(key==='batch')return statements=>statements.some(statement=>retry(statement.text))?Promise.reject(new Error('D1_ERROR: network reset before tail attempt')):target.batch(statements);return target[key]}})
      }
      const result=await amend('line_quantity_decreased',0.1,'amendment-tail',hook)
      assert.equal(result.status,200,JSON.stringify(result.json))
      assert.deepEqual(Object.fromEntries(attempts),tier==='free'?{receipt:2,versions:2,quota:2,handoff:2}:{receipt:2,versions:2,handoff:2},'complete mutually exclusive successful tail counts')
      const after=state(f);assert.equal((await f.call('/sales/'+saleId+'/amendments',result.body)).status,200);assert.deepEqual(state(f),after)
      console.log('PASS full amendment bounded tail '+JSON.stringify({tier,source,attempts:Object.fromEntries(attempts)}))
    }finally{f.sql.close()}
  }
  for(const tier of ['free','paid']) {
    const {f,amend}=await amendmentWorld(makeWorker,tier,'ordinary')
    try {
      const stock=h.loadStockSession('lib/stockTransaction.ts'),db=h.loadStockSession('lib/db.ts').getDb(f.env)
      await stock.executeStockTransaction(db,[{sql:'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1'},
        {sql:'UPDATE product_batches SET is_active=0 WHERE id=1'}],'once')
      const before=state(f),result=await amend('line_quantity_decreased',0.1,'amendment-activate')
      assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(f.sql.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active,1)
      assert.equal(f.state().physical,0.7);assert.equal(f.state().lots[0].quantity,0.1)
      assert.equal(f.sql.prepare('SELECT received_quantity FROM product_batches WHERE id=1').get().received_quantity,before.product_batches[0].received_quantity)
      console.log('PASS exact captured original inactive receipt activation '+tier)
    }finally{f.sql.close()}
    const refusal=await amendmentWorld(makeWorker,tier,'ordinary')
    try {
      const {f,amend}=refusal
      f.sql.exec(`UPDATE sale_item_batch_allocations SET quantity=0.1 WHERE id=1;
        WITH RECURSIVE ids(n)AS(SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<20)
        INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity)SELECT 1,1,1,0.01,0 FROM ids`)
      const before=state(f),result=await amend('line_removed',undefined,'amendment-large')
      if(tier==='free'){assert.equal(result.status,409);assert.equal(result.json.code,'sale_amendment_over_plan_budget');assert.equal(result.json.outcome,'not_dispatched');assert.deepEqual(state(f),before)}
      else assert.equal(result.status,200,JSON.stringify(result.json))
      console.log('PASS bounded amendment allocation admission '+tier)
    }finally{refusal.f.sql.close()}
  }
}
async function provePreplanningAndOwnership(makeWorker) {
  for(const tier of ['free','paid'])for(const fault of ['saved_condition','owner','cache','unrelated_constraint']) {
    const source=fault==='saved_condition'?'tagged':'ordinary'
    const {f,amend}=await amendmentWorld(makeWorker,tier,source)
    try {
      if(fault==='owner')await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:"INSERT INTO products(id,name,stock_quantity,is_active)VALUES(2,'Rival owner',0,1)"}],'once')
      const before=state(f)
      const hook=async()=>{
        if(fault==='saved_condition')await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env),[{sql:"UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1"}],'once')
        else if(fault==='unrelated_constraint')f.sql.exec("CREATE TEMP TRIGGER unrelated_amendment_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: unrelated_audit_constraint');END")
        else f.competeBeforeCommit([{sql:fault==='owner'?'UPDATE product_batches SET variant_product_id=2 WHERE id=1':'UPDATE products SET stock_quantity=0.8 WHERE id=1'}])
      }
      const result=await amend('line_quantity_decreased',0.1,'amendment-specific-'+fault,hook)
      assert.equal(result.status,fault==='unrelated_constraint'?500:409,JSON.stringify(result.json))
      const after=state(f)
      if(fault==='saved_condition'){assert.equal(result.json.code,'sale_line_preimage_conflict');assert.equal(after.damaged_stock_lots[0].condition_tag,'opened');after.damaged_stock_lots[0].condition_tag=before.damaged_stock_lots[0].condition_tag}
      if(fault==='owner'){assert.equal(after.product_batches[0].variant_product_id,2);after.product_batches[0].variant_product_id=before.product_batches[0].variant_product_id}
      if(fault==='cache'){assert.equal(after.products[0].stock_quantity,0.8);after.products[0].stock_quantity=before.products[0].stock_quantity}
      assert.deepEqual(after,before,'named refusals and unknown errors preserve physical, receipts, allocations and all immutable history')
      console.log('PASS precise amendment discriminator '+JSON.stringify({tier,fault}))
    }finally{f.sql.close()}
  }
}
if(require.main===module)(async()=>{const makeWorker=await h.bundle.exports.bundleWorker();await main();await proveWriters(makeWorker);await proveRaces(makeWorker);await proveTailAndActivation(makeWorker);await provePreplanningAndOwnership(makeWorker)})().catch(error=>{console.error(error);process.exitCode=1})
module.exports={amendmentWorld,main,state,proveWriters,proveRaces,proveTailAndActivation,provePreplanningAndOwnership}
