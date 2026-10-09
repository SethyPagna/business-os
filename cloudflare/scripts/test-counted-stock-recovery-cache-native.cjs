const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

const intake = { productId: 1, branchId: 1, type: 'add', quantity: 0.2, batchId: 'new',
  supplierName: 'Fixture', unitCostUsd: 3, receivedDate: '2026-10-09', reason: 'Recovery fixture' }
function request(route) {
  if (route === 'receive') return ['/batches', { product_id: 1, branch_id: 1, quantity: 0.2,
    supplier_name: 'Fixture', unit_cost_usd: 3, received_date: '2026-10-09', reason: 'Recovery fixture' }]
  if (route === 'adjust') return ['/inventory/adjust', intake]
  return ['/inventory/tagged-lots/' + route, { productId: 1, branchId: 1, quantity: 0.1,
    conditionTag: 'damaged', reason: 'Recovery fixture' }]
}
const business = f => ({ ...f.state(), batches: f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all(),
  audits: f.sql.prepare('SELECT * FROM audit_logs ORDER BY id').all() })

async function check(make, tier, route, mode) {
  const f = await h.world(make, tier, 'zero', sql => {
    h.seed(1, true)(sql)
    sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd) VALUES(1,1,1,1,0.3,0.3,'damaged','remove',2)")
  })
  const events = [], families = new Set(), failed = new Set()
  let attempts = 0, dispatches = 0, committed = false, failAck = !['normal', 'completion'].includes(mode), failConfirmation = mode === 'confirm-fail'
  const raw = f.env.DB
  f.env.CACHE = { get: async () => null, put: async () => { throw Error('Synthetic KV failure') },
    delete: async () => { if (mode === 'cache-delete-fail') throw Error('Synthetic KV delete failure') } }
  f.env.BROADCAST_HUB = { idFromName: name => name, get: name => ({ fetch: async (_url, options) => {
    events.push({ hub: name, ...JSON.parse(options.body) }); return new Response('{}')
  } }) }
  const fault = (sql, params) => {
    if (committed && failConfirmation && /SELECT .*request_json.*written/s.test(sql) && /FROM stock_mutation_receipts/.test(sql)) {
      throw Error('D1_ERROR: network confirmation unavailable')
    }
    if (!committed) return
    const family = /UPDATE stock_mutation_receipts SET response_status/.test(sql) ? 'completion'
      : /SELECT namespace, version FROM cache_versions/.test(sql) ? 'versions'
      : /INSERT INTO quota_usage/.test(sql) ? 'quota' : /INSERT INTO cache_versions/.test(sql) ? 'fallback' : null
    if (!family) return
    families.add(family)
    if (mode === 'completion' && family === 'completion') throw Error('D1_ERROR: network completion unavailable')
    if (mode === 'cache-fail' && family === 'fallback') throw Error('D1_ERROR: network cache unavailable')
    const key = family + JSON.stringify(params)
    if (mode === 'tails' && !failed.has(key)) { failed.add(key); throw Error('D1_ERROR: network first tail attempt') }
  }
  const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...args) => wrap(target.bind(...args), sql)
    if (['first', 'all', 'run'].includes(key)) return (...args) => { attempts++; fault(sql, target.params); return target[key](...args) }
    return target[key]
  } })
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'prepare') return sql => wrap(target.prepare(sql), sql)
    if (key === 'batch') return async statements => {
      attempts += statements.length
      const physical = statements.some(row => /stock_request_claim_lost/.test(row.text))
      if (physical) dispatches++
      for (const row of statements) fault(row.text, row.params)
      if (physical && mode === 'rollback') throw Error('CHECK constraint failed: fixture_rollback')
      const result = await target.batch(statements)
      if (physical) {
        committed = true
        if (mode === 'confirm-kind') f.sql.exec("UPDATE stock_mutation_receipts SET kind=CASE kind WHEN 'adjust' THEN 'receive' ELSE 'adjust' END")
        if (mode === 'confirm-body') f.sql.exec("UPDATE stock_mutation_receipts SET request_json='[]'")
        if (mode === 'confirm-unwritten') f.sql.exec('UPDATE stock_mutation_receipts SET written=0')
        if (mode === 'confirm-actor') f.sql.exec('UPDATE stock_mutation_receipts SET actor_id=999')
        if (mode === 'confirm-key') f.sql.exec("UPDATE stock_mutation_receipts SET request_id='unrelated-request-key'")
        if (failAck) { failAck = false; throw Error('D1_ERROR: network committed acknowledgement lost') }
      }
      return result
    }
    return target[key]
  } })
  try {
    const [url, base] = request(route), body = { ...base, client_request_id: 'stock-recovery-' + route + '-' + mode }
    const initial = business(f)
    const first = await f.call(url, body)
    const versions = () => f.sql.prepare('SELECT namespace,version FROM cache_versions ORDER BY namespace').all()
    const refreshed = () => {
      assert.deepEqual(versions().map(row => row.namespace), ['products', 'stock'])
      assert.ok(versions().every(row => row.version > 0))
      assert.deepEqual([...new Set(events.map(row => row.channel))].sort(), ['inventory', 'products'])
      assert.equal(events.length, 4, 'two channels reach each existing hub')
    }
    console.log('RECOVERY ' + JSON.stringify({ tier, route, mode, phase: 'first', status: first.status, attempts, dispatches, events: events.length, families: [...families] }))
    assert.ok(attempts <= (tier === 'free' ? 50 : 1000))
    if (mode === 'rollback') {
      assert.ok(first.status >= 400)
      assert.deepEqual(business(f), initial)
      assert.deepEqual(versions(), [])
      assert.equal(events.length, 0)
      return
    }
    assert.equal(first.status, mode === 'normal' ? 200 : 503, JSON.stringify(first.json))
    assert.equal(dispatches, 1)
    if (mode === 'normal') { assert.ok(events.length >= 4); return }
    assert.equal(first.json.code, 'stock_request_outcome_unknown')
    if (mode.startsWith('confirm-') && mode !== 'confirm-fail') {
      assert.equal(events.length,0,'only the exact actor/key/kind/body durable written receipt authorizes refresh')
      assert.deepEqual(versions(),[])
      assert.equal(initial.physical,1.3,'fixture migration converts the legacy 0.3 tag into counted physical stock')
      assert.equal(f.state().physical, route === 'adjust' || route === 'receive' ? 1.5 : route === 'dispose' ? 1.2 : 1.3)
      assert.equal(f.state().tags[0].quantity_remaining, route === 'restore' || route === 'dispose' ? 0.2 : 0.3)
      return
    }
    assert.equal(f.sql.prepare('SELECT written FROM stock_mutation_receipts').get().written, 1)
    if (mode === 'confirm-fail' || mode === 'cache-fail' || mode === 'cache-delete-fail') {
      assert.equal(events.length, 0, 'unconfirmed state or failed invalidation must not claim fresh views')
      assert.deepEqual(versions(), [])
    } else if (mode === 'completion') {
      assert.ok(events.length >= 4, 'the original committed response already scheduled its normal views')
    } else refreshed()
    const saved = business(f)
    events.length = 0; attempts = 0; failConfirmation = false
    if (mode === 'cache-fail' || mode === 'cache-delete-fail') mode = 'ack'
    const retry = await f.call(url, body)
    console.log('RECOVERY ' + JSON.stringify({ tier, route, mode, phase: 'retry', status: retry.status, attempts, dispatches, events: events.length }))
    assert.equal(retry.status, 409)
    assert.equal(retry.json.code, 'stock_request_partially_applied')
    assert.equal(dispatches, 1)
    assert.deepEqual(business(f), saved, 'view recovery must never repeat business stock, history or audit')
    refreshed()
    for (const conflict of ['kind', 'body', 'unwritten']) {
      events.length = 0
      const old = f.sql.prepare('SELECT * FROM stock_mutation_receipts').get()
      if (conflict === 'kind') f.sql.exec("UPDATE stock_mutation_receipts SET kind=CASE kind WHEN 'adjust' THEN 'receive' ELSE 'adjust' END")
      if (conflict === 'unwritten') f.sql.exec("UPDATE stock_mutation_receipts SET written=0,response_status=503,completed_at=CURRENT_TIMESTAMP")
      const priorVersions = versions()
      const refused = await f.call(url, conflict === 'body' ? { ...body, quantity: 0.25 } : body)
      assert.equal(refused.status, 409)
      if (conflict !== 'unwritten') assert.equal(refused.json.code, 'idempotency_conflict')
      assert.equal(events.length, 0)
      assert.deepEqual(versions(), priorVersions)
      assert.deepEqual(business(f), saved)
      f.sql.prepare('UPDATE stock_mutation_receipts SET kind=?,written=?,response_status=?,completed_at=?').run(old.kind,old.written,old.response_status,old.completed_at)
    }
  } finally { f.sql.close() }
}

async function pressure(make, tier, route, padding, expectedRefresh) {
  const f = await h.world(make, tier, 'zero', sql => {
    h.seed(1, true)(sql)
    sql.exec("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd) VALUES(1,1,1,1,0.3,0.3,'damaged','remove',2)")
  })
  const [url, base] = request(route), body = { ...base, client_request_id: 'stock-recovery-pressure' }
  const events = [], failed = new Set(), families = new Set()
  let replay = false, padded = false, attempts = 0, dispatches = 0
  const raw = f.env.DB
  f.env.CACHE = { get: async () => null, put: async () => { throw Error('Synthetic KV failure') }, delete: async () => {} }
  f.env.BROADCAST_HUB = { idFromName: n => n, get: () => ({ fetch: async () => { events.push(1); return new Response('{}') } }) }
  const fault = (sql, params) => {
    if (!replay) return
    const family = /SELECT namespace, version FROM cache_versions/.test(sql) ? 'versions'
      : /INSERT INTO quota_usage/.test(sql) ? 'quota' : /INSERT INTO cache_versions/.test(sql) ? 'fallback' : null
    if (!family) return
    families.add(family)
    const key = family + JSON.stringify(params)
    if (!failed.has(key)) { failed.add(key); throw Error('D1_ERROR: network budget-tail retry') }
  }
  const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...args) => wrap(target.bind(...args), sql)
    if (['first','all','run'].includes(key)) return async (...args) => {
      if (replay && !padded && /SELECT .*request_json.*written/s.test(sql) && /FROM stock_mutation_receipts/.test(sql)) {
        padded = true
        const db = h.loadStockSession('lib/db.ts').getDb(f.env)
        for (let index = 0; index < padding; index++) await db.prepare('SELECT 1 AS recovery_budget_pressure').get()
      }
      attempts++; fault(sql,target.params); return target[key](...args)
    }
    return target[key]
  } })
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'prepare') return sql => wrap(target.prepare(sql),sql)
    if (key === 'batch') return async statements => {
      attempts += statements.length
      for (const row of statements) fault(row.text,row.params)
      const physical = statements.some(row => /stock_request_claim_lost/.test(row.text))
      if (physical) dispatches++
      const result = await target.batch(statements)
      if (physical) throw Error('D1_ERROR: network committed acknowledgement lost')
      return result
    }
    return target[key]
  } })
  try {
    assert.equal((await f.call(url,body)).status,503)
    const saved = business(f)
    f.sql.exec('DELETE FROM cache_versions')
    replay = true; attempts = 0; events.length = 0
    const recovered = await f.call(url,body)
    console.log('RECOVERY_PRESSURE '+JSON.stringify({tier,route,padding,expectedRefresh,attempts,events:events.length,families:[...families]}))
    assert.equal(recovered.status,409)
    assert.equal(recovered.json.code,'stock_request_partially_applied')
    assert.equal(dispatches,1)
    assert.deepEqual(business(f),saved)
    assert.equal(events.length,expectedRefresh?4:0)
    assert.ok(attempts <= (tier==='free'?50:1000))
    if(expectedRefresh) {
      assert.equal(attempts,tier==='free'?50:1000)
      assert.deepEqual([...families].sort(),(tier==='free'?['versions','quota','fallback']:['versions','fallback']).sort())
    } else assert.equal(families.size,0,'insufficient capacity must defer the entire refresh')
  } finally { f.sql.close() }
}

async function versionRead(make,tier,source,failRead) {
  const f = await h.world(make,tier,'zero',h.seed(0.125,true))
  const kv = new Map(source === 'kv' ? [['v2:products','1'],['v2:stock','1']] : [])
  if (source === 'd1') f.sql.exec("INSERT INTO cache_versions(namespace,version,updated_at)VALUES('products',9,CURRENT_TIMESTAMP),('stock',11,CURRENT_TIMESTAMP)")
  const events = [], writes = []
  let committed = false, loseAck = true, broken = failRead, dispatches = 0, attempts = 0
  const raw = f.env.DB
  f.env.CACHE = { get: async key => {
    if(committed && broken && source==='kv' && key.startsWith('v2:')) throw Error('Synthetic version read failure')
    return kv.get(key) ?? null
  }, put: async (key,value) => { writes.push([key,value]);kv.set(key,value) }, delete: async key => { kv.delete(key) } }
  f.env.BROADCAST_HUB = { idFromName:n=>n,get:()=>({fetch:async()=>{events.push(1);return new Response('{}')}}) }
  const wrap = (statement,sql) => new Proxy(statement,{get(target,key){
    if(key==='bind')return(...args)=>wrap(target.bind(...args),sql)
    if(['first','all','run'].includes(key))return(...args)=>{
      attempts++
      if(committed && broken && source==='d1' && /SELECT namespace, version FROM cache_versions/.test(sql))throw Error('D1_ERROR: network version read failure')
      return target[key](...args)
    }
    return target[key]
  }})
  f.env.DB=new Proxy(raw,{get(target,key){
    if(key==='prepare')return sql=>wrap(target.prepare(sql),sql)
    if(key==='batch')return async statements=>{
      attempts+=statements.length
      const physical=statements.some(row=>/stock_request_claim_lost/.test(row.text))
      if(physical)dispatches++
      const result=await target.batch(statements)
      if(physical){committed=true;if(loseAck){loseAck=false;throw Error('D1_ERROR: network committed acknowledgement lost')}}
      return result
    }
    return target[key]
  }})
  const versions=()=>({kv:[...kv],d1:f.sql.prepare('SELECT namespace,version FROM cache_versions ORDER BY namespace').all()})
  try {
    const initial=versions(),body={...intake,client_request_id:'version-read-recovery'}
    const first=await f.call('/inventory/adjust',body)
    assert.equal(first.status,503)
    assert.equal(first.json.code,'stock_request_outcome_unknown')
    assert.equal(f.state().physical,0.325)
    assert.ok(attempts<=(tier==='free'?50:1000))
    const refreshed=()=>{
      assert.equal(events.length,4)
      if(source==='kv')assert.deepEqual(versions(),{kv:[['v2:products','2'],['v2:stock','2']],d1:[]})
      else assert.deepEqual(versions(),{kv:[],d1:[{namespace:'products',version:10},{namespace:'stock',version:12}]})
    }
    console.log('RECOVERY_VERSION_READ '+JSON.stringify({tier,source,failRead,attempts,events:events.length,writes:writes.length}))
    if(failRead){
      assert.deepEqual(versions(),initial,'an unknown version must never be treated as absent')
      assert.equal(writes.length,0)
      assert.equal(events.length,0,'failed version proof cannot publish freshness')
      broken=false;attempts=0
      const saved=business(f),retry=await f.call('/inventory/adjust',body)
      assert.equal(retry.status,409)
      assert.equal(retry.json.code,'stock_request_partially_applied')
      assert.deepEqual(business(f),saved)
      refreshed()
    } else refreshed()
    assert.equal(dispatches,1)
  }finally{f.sql.close()}
}

async function main() {
  const make = await h.bundle.exports.bundleWorker()
  const failures = []
  for(const tier of ['free','paid'])for(const source of ['kv','d1'])for(const failRead of [false,true]){
    try{await versionRead(make,tier,source,failRead)}catch(error){failures.push({tier,source,failRead,error:error.stack});console.error('FAIL version read',tier,source,failRead,error.message)}
  }
  if(process.argv.includes('--version-only')) {assert.deepEqual(failures,[]);console.log('PASS existing version read authority');return}
  for (const tier of ['free', 'paid']) for (const route of ['adjust', 'receive', 'restore', 'dispose']) {
    if (!process.argv.includes('--pressure-only')) for (const mode of ['normal', 'ack', 'rollback', 'confirm-fail', 'confirm-kind', 'confirm-body', 'confirm-unwritten', 'confirm-actor', 'confirm-key', 'cache-fail', 'cache-delete-fail', 'tails', 'completion']) {
      try { await check(make, tier, route, mode) }
      catch (error) { failures.push({ tier, route, mode, error: error.stack }); console.error('FAIL', tier, route, mode, error.message) }
    }
    const capacity = (tier === 'free' ? 40 : 992) + (route === 'restore' || route === 'dispose' ? 1 : 0)
    for (const extra of [0,1]) {
      try { await pressure(make,tier,route,capacity+extra,extra===0) }
      catch (error) { failures.push({tier,route,extra,error:error.stack}); console.error('FAIL pressure',tier,route,extra,error.message) }
    }
  }
  assert.deepEqual(failures, [])
  console.log('PASS stock recovery and exact next-query budget worlds')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { check, pressure, versionRead }
