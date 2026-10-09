const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const body = (quantity, key) => ({branch_id:1, reason:'Supplier return', supplier_name:'Fixture supplier', settlement:'refund', exchange_rate:4000, client_request_id:key, items:[{product_id:1,quantity,cost_price_usd:2,branch_id:1}]})
async function main() {
  const make = await h.bundle.exports.bundleWorker()
  for (const tier of ['free','paid']) for (const receipt of [false,true]) for (const tagged of [false,true]) {
    const f = await h.world(make,tier,'zero',sql=>{
      h.seed(tagged ? 0.5 : 0.3,receipt)(sql)
      if (tagged) sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,${receipt ? 1 : 'NULL'},.25,.25,'damaged','remove',2)`)
    })
    try {
      if (tagged) {
        const before = f.state()
        const refused = await f.call('/returns/supplier',body(.75,'supplier-refused'))
        assert.equal(refused.status,409,'ordinary supplier return cannot silently consume tagged stock')
        assert.deepEqual(f.state(),before)
        const saved=await f.call('/returns/supplier',body(.5,'supplier-ordinary'))
        assert.equal(saved.status,200)
        assert.equal(f.state().physical,.25)
        assert.equal(f.state().cache,.25)
        assert.equal(f.state().tags[0].quantity_remaining,.25)
      } else {
        const saved=await f.call('/returns/supplier',body(.1,'supplier-fraction'))
        assert.equal(saved.status,200)
        assert.equal(f.state().physical,.2)
        assert.equal(f.state().cache,.2)
        if (receipt) assert.equal(f.state().lots[0].quantity,.2)
      }
    } finally { f.sql.close() }
  }
  const savedRows = f => ({ ...f.state(), returns:f.sql.prepare('SELECT * FROM returns ORDER BY id').all(),
    items:f.sql.prepare('SELECT * FROM return_items ORDER BY id').all(), allocations:f.sql.prepare('SELECT * FROM return_item_batch_allocations ORDER BY id').all(),
    audits:f.sql.prepare("SELECT * FROM audit_logs WHERE entity='supplier_return' ORDER BY id").all() })
  for (const tier of ['free','paid']) for (const receipt of [false,true]) {
    for (const mode of ['normal','ack','late','condition','membership','physical','owner','active','actor','cache','zero','unsupported','repeated']) {
      const f=await h.world(make,tier,'zero',sql=>h.seed(mode==='zero'?0:.3,receipt)(sql))
      try {
        const input=body(.1,'supplier-'+mode)
        const before=savedRows(f)
        if (mode==='ack') f.loseNextCommitAcknowledgement()
        if (mode==='late') f.sql.exec("CREATE TRIGGER supplier_late BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'unrelated supplier failure'); END")
        if (mode==='condition') f.competeBeforeCommit([{sql:"INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,NULL,.1,.1,'opened','remove',2)",params:{}}])
        if (mode==='membership') f.competeBeforeCommit([{sql:"INSERT INTO branches(id,name,is_active)VALUES(2,'Other',1)",params:{}},{sql:'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0)',params:{}}])
        if (mode==='physical') f.competeBeforeCommit([{sql:'UPDATE branch_stock SET quantity=.2 WHERE product_id=1 AND branch_id=1',params:{}},{sql:'UPDATE products SET stock_quantity=.2 WHERE id=1',params:{}}])
        if (mode==='owner') f.competeBeforeCommit([{sql:'UPDATE product_batches SET variant_product_id=999 WHERE id=1',params:{}}])
        if (mode==='active') f.competeBeforeCommit([{sql:'UPDATE products SET is_active=0 WHERE id=1',params:{}}])
        if (mode==='actor') f.beforeCommit(sql=>sql.prepare('UPDATE users SET is_active=0 WHERE id=7').run())
        if (mode==='cache') f.competeBeforeCommit([{sql:'UPDATE products SET stock_quantity=.4 WHERE id=1',params:{}}])
        if (mode==='unsupported') input.items[0].condition_tag='damaged'
        if (mode==='repeated') input.items=[{...input.items[0]},{...input.items[0],quantity:.2}]
        const result=await f.call('/returns/supplier',input)
        if (['condition','membership','physical','owner','active','actor','cache','zero'].includes(mode)) {
          assert.equal(result.status,409,mode)
          assert.deepEqual(savedRows(f).returns,before.returns)
          assert.deepEqual(savedRows(f).items,before.items)
          assert.deepEqual(savedRows(f).allocations,before.allocations)
          assert.deepEqual(savedRows(f).movements,before.movements)
          assert.deepEqual(savedRows(f).audits,before.audits)
          if (!['physical','cache'].includes(mode)) assert.equal(f.state().physical,before.physical)
          if (mode==='condition') assert.equal(f.state().tags[0].quantity_remaining,.1,'intentional rival preserved')
        } else if (mode==='unsupported') {
          assert.equal(result.status,400)
          assert.equal(result.json.code,'supplier_return_condition_selection_required')
          assert.deepEqual(savedRows(f),before)
        } else if (mode==='late') {
          assert.equal(result.status,503)
          assert.equal(result.json.code,'supplier_return_outcome_unknown')
          assert.deepEqual(savedRows(f),before)
          f.sql.exec('DROP TRIGGER supplier_late')
          assert.equal((await f.call('/returns/supplier',input)).status,200)
        } else {
          assert.equal(result.status,mode==='ack'?503:200)
          const committed=savedRows(f)
          assert.equal(committed.physical,mode==='repeated'?0:.2)
          assert.equal(committed.cache,committed.physical)
          assert.equal(committed.audits.length,1,'audit commits atomically, including lost ACK')
          assert.equal(committed.returns.length,1)
          assert.equal(committed.items.length,mode==='repeated'?2:1)
          assert.equal(committed.movements.length,mode==='repeated'?2:1)
          const retry=await f.call('/returns/supplier',input)
          assert.equal(retry.status,200)
          assert.equal(retry.json.duplicate,true)
          assert.deepEqual(savedRows(f),committed,'canonical retry preserves original histories and physical values')
          assert.equal(committed.movements[0].user_name,'admin')
          assert.equal(committed.movements[0].unit_cost_usd,2)
          assert.equal(committed.items[0].cost_price_usd,2)
        }
      } finally { f.sql.close() }
    }
  }
  for (const tier of ['free','paid']) for (const receipt of [false,true]) {
    let refused = false
    let lastAccepted = 0
    for (let count=1;count<=10;count++) {
      const f=await h.world(make,tier,'zero',sql=>h.seed(1,receipt)(sql))
      try {
        const before=savedRows(f)
        const input=body(.1,'supplier-boundary-'+count)
        input.items=Array.from({length:count},()=>({...input.items[0]}))
        const result=await f.call('/returns/supplier',input)
        if (result.status===400) {
          assert.equal(result.json.code,'supplier_return_over_plan_budget')
          assert.equal(result.json.outcome,'not_dispatched')
          assert.deepEqual(savedRows(f),before,'admission refusal has no physical, history or receipt effects')
          assert.ok(lastAccepted>0,'normal small cart remains usable')
          refused=true
          console.log(JSON.stringify({tier,receipt,acceptedBoundary:lastAccepted,firstRefused:count}))
          break
        }
        assert.equal(result.status,200)
        assert.equal(f.state().physical,h.loadStockSession('lib/countedDamagedStock.ts').subtractCountedQuantity(1,Array(count).fill(.1)))
        assert.equal(savedRows(f).items.length,count)
        assert.equal(savedRows(f).movements.length,count)
        lastAccepted=count
      } finally {f.sql.close()}
    }
    assert.equal(refused,tier==='free','Free refuses the next resource boundary; Paid keeps these common shapes')
  }
  for (const count of [4,5]) {
    const f=await h.world(make,'free','zero',sql=>h.seed(1,true)(sql))
    try {
      f.env.CACHE={get:async()=>null,put:async()=>{throw new Error('KV unavailable')},delete:async()=>{}}
      f.sql.prepare("INSERT INTO quota_usage(resource,window_key,used,updated_at)VALUES('kv_write',?,9999,CURRENT_TIMESTAMP)").run(new Date().toISOString().slice(0,10))
      const raw=f.env.DB, injected=new Set()
      const group=text=>text.includes('quota_usage')?'quota':text.includes('cache_versions')?(text.includes('INSERT')?'cache-write':'cache-read'):text.includes('FROM return_items ri LEFT JOIN')?'notification-items':text.includes('FROM return_replacement_items WHERE return_id')?'notification-replacements':text.includes('SELECT key, value FROM settings WHERE key IN')?'notification-config':null
      const wrap=statement=>new Proxy(statement,{get(target,key){
        if(key==='bind')return(...args)=>wrap(target.bind(...args))
        if(['first','all','run'].includes(key))return async(...args)=>{
          const result=await target[key](...args), kind=group(target.text||'')
          if(kind&&!injected.has(kind)&&f.sql.prepare('SELECT COUNT(*) n FROM returns').get().n){injected.add(kind);throw new Error('D1_ERROR: simulated read acknowledgement loss')}
          return result
        }
        return target[key]
      }})
      f.env.DB=new Proxy(raw,{get(target,key){
        if(key==='prepare')return text=>wrap(target.prepare(text))
        if(key==='batch')return async statements=>{
          const result=await target.batch(statements)
          if(statements.some(row=>(row.text||'').includes('INSERT INTO cache_versions'))&&!injected.has('cache-write')){injected.add('cache-write');throw new Error('D1_ERROR: simulated cache acknowledgement loss')}
          return result
        }
        return target[key]
      }})
      const before=savedRows(f), input=body(.1,'supplier-tail-'+count)
      input.items=Array.from({length:count},()=>({...input.items[0]}))
      const result=await f.call('/returns/supplier',input)
      assert.equal(result.status,count===4?200:400)
      if(count===4){assert.equal(injected.size,6,'all cache quota/fallback and notification retry paths were counted');assert.equal(savedRows(f).items.length,4)}
      else {assert.equal(result.json.outcome,'not_dispatched');assert.deepEqual(savedRows(f),before);assert.equal(injected.size,0)}
    } finally {f.sql.close()}
  }
  console.log('counted supplier return ordinary entitlement/fraction/source/actor/atomic history/retry/admission/full failed tails: PASS')
}
if (require.main===module) main().catch(error=>{console.error(error);process.exitCode=1})
