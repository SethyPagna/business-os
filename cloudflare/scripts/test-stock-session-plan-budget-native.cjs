const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { Hono } = require('hono')
const { fixture, loadStockSession, user, receiveRequest, seedDistinctProducts } = require('./test-stock-session-atomic.cjs')
const { stockTransactionStatementCount } = loadStockSession('lib/stockTransaction.ts')
const coldKernelStatements = stockTransactionStatementCount(33)
function measuredFixture() {
  const f = fixture(), raw = f.env.DB
  let queries = 0, batches = 0, calls = 0
  const batchSql = []
  const statement = p => new Proxy(p, { get(t,k) {
    if(k === 'bind') return (...params) => statement(t.bind(...params))
    if(['first','all','run'].includes(k)) return (...params) => { queries += 1; calls += 1; return t[k](...params) }
    return t[k]
  } })
  f.env.DB = new Proxy(raw, { get(t,k) {
    if(k === 'prepare') return sql => statement(t.prepare(sql))
    if(k === 'batch') return statements => { batchSql.push(statements.map(statement => statement.text)); queries += statements.length; calls += 1; batches += 1; return t.batch(statements) }
    return t[k]
  } })
  // count = every statement run; calls = D1 calls (a db.batch() is ONE), the unit of the per-invocation limit.
  return Object.assign(f, { count: () => queries, calls: () => calls, batches: () => batches, batchSql, reset() { queries = 0; calls = 0; batches = 0; batchSql.length = 0 } })
}
async function outerProof(staleAuth) {
  const f=measuredFixture(),core=loadStockSession('lib/coreDataInvariants.ts')
  await core.ensureCoreDataInvariants(f.env)
  f.sql.exec("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) SELECT 7,'admin','Admin','fixture',id,'{\"all\":true}',1 FROM roles WHERE code='admin' LIMIT 1")
  await core.ensureCoreDataInvariants(f.env)
  const token='budget-cookie',hash=createHash('sha256').update(token).digest('hex'),now=Date.now()
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(7,?,?,?,?)').run(hash,new Date(now-(staleAuth?48*3600000:3600000)).toISOString(),new Date(now+3600000*(staleAuth?1:48)).toISOString(),staleAuth?null:new Date(now).toISOString())
  f.env.PLAN_TIER='free';f.env.CACHE={get:async()=>null,put:async()=>{}}
  const auth=loadStockSession('lib/auth.ts'),maintenance=loadStockSession('lib/maintenance.ts'),cache=loadStockSession('lib/cache.ts'),telegram=loadStockSession('lib/telegram.ts'),kernel=loadStockSession()
  const tasks=[],ctx={waitUntil(p){tasks.push(p)},passThroughOnException(){}}
  const app=new Hono()
  app.use('*',async(c,next)=>{await core.ensureCoreDataInvariantsForBuild(c.env,{buildKey:'outer-proof',reverifyAfterMs:3600000});assert.equal(f.count(),6);assert.equal(await maintenance.getMaintenance(c.env),null);await next()})
  app.use('*',auth.requireAuth)
  app.post('/',async c=>{await Promise.all(tasks);try{return c.json(await kernel.commitStockSession(c.env,c.get('user'),await c.req.json(),null,{statementsUsed:f.calls,reserveStatements:4}))}catch(e){return c.json({code:e.code},e.statusCode||500)}})
  f.reset()
  const response=await app.request('/',{method:'POST',headers:{cookie:'bos_session='+token,'content-type':'application/json'},body:JSON.stringify(receiveRequest('outer-proof-'+staleAuth))},f.env,ctx)
  {assert.equal(response.status,200);await cache.bumpVersion(f.env,'products');await telegram.drainDueTelegramShiftOverviews(f.env);console.log(staleAuth?'Cold renewed-auth outer+cache fallback+empty drain':'Cold healthy outer+cache fallback+empty drain',f.count());assert.ok(f.calls()<=50);assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5)}
}

;(async () => {
  const { commitStockSession, replayStockSession } = loadStockSession()
  const f = measuredFixture(); f.env.PLAN_TIER = 'free'
  const body = receiveRequest('free-one-line-budget')
  const beforeProduct = f.sql.prepare('SELECT * FROM products WHERE id=1').get()
  const receipt = await commitStockSession(f.env,user,body)
  assert.equal(f.count(), coldKernelStatements)
  assert.equal(f.batches(),1)
  const coldKernelCalls = f.calls()
  assert.equal(coldKernelCalls, coldKernelStatements - (f.batchSql[0].length - 1), 'the batch is one call; every other statement is a call of its own')
  console.log('one-line commit: statements',coldKernelStatements,'calls',coldKernelCalls)
  assert.match(f.batchSql[0][0], /INSERT INTO system_flags[\s\S]*stock_transaction_permit/)
  assert.match(f.batchSql[0].at(-1), /DELETE FROM system_flags[\s\S]*stock_transaction_permit/)
  assert.equal(f.batchSql[0].filter(sql => /(?:INSERT INTO|DELETE FROM) system_flags[\s\S]*stock_transaction_permit/.test(sql)).length, 2)
  assert.equal(f.count() - 2, 33, 'the original business and read statement count is unchanged')
  const operation = f.sql.prepare('SELECT * FROM stock_session_operations WHERE id=?').get(receipt.operationId)
  const snapshot = JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=?').get(operation.snapshot_id).payload_json)
  assert.deepEqual(snapshot.after.products, f.sql.prepare('SELECT * FROM products WHERE id=1').all())
  assert.deepEqual(snapshot.before.products[0], beforeProduct)
  const batch = f.sql.prepare('SELECT * FROM product_batches').get(); delete batch.received_branch_name
  assert.deepEqual(snapshot.after.batches,[batch])
  assert.deepEqual(snapshot.after.branchStock,f.sql.prepare('SELECT * FROM branch_stock').all())
  assert.deepEqual(snapshot.after.branchBatchStock,f.sql.prepare('SELECT * FROM branch_batch_stock').all())
  f.reset(); await commitStockSession(f.env,user,body,null,{statementsUsed:()=>49,reserveStatements:12})
  assert.equal(f.count(),1,'stored success must resolve first')
  const large = measuredFixture(); large.env.PLAN_TIER = 'free'; seedDistinctProducts(large,2)
  const input=receiveRequest('free-two-line-budget'); input.items.push({...input.items[0],line_id:'second',product_id:2})
  // Two lines are still ONE db.batch(): one call. They used to be refused on Free because every statement of the batch was charged.
  await commitStockSession(large.env,user,input)
  assert.equal(large.batches(),1)
  assert.ok(large.calls()<=50,'two lines stay inside the Free call budget')
  assert.equal(large.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,1)
  assert.equal(large.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,10)
  for (const tier of ['free','paid']) {
    for (const extra of [0,1]) {
      const bound=measuredFixture();bound.env.PLAN_TIER=tier
      const offset=(tier==='free'?50:1000)-coldKernelCalls+extra
      const boundedKernel=loadStockSession()
      const perform=()=>boundedKernel.commitStockSession(bound.env,user,receiveRequest('boundary-'+tier+'-'+extra),null,{statementsUsed:()=>offset,reserveStatements:0})
      if(extra){await assert.rejects(perform,e=>e.code==='stock_session_query_budget_exceeded');assert.equal(bound.batches(),0);assert.equal(bound.auditRows().length,0)}
      else {await perform();assert.equal(bound.count(),coldKernelStatements)}
    }
  }
  const paid=measuredFixture();paid.env.PLAN_TIER='paid';seedDistinctProducts(paid,25)
  const paidBody=receiveRequest('paid-full-25-lines');paidBody.items=Array.from({length:25},(_,i)=>({...paidBody.items[0],line_id:'paid-'+i,product_id:i+1}))
  const paidKernel=loadStockSession()
  const paidReceipt=await paidKernel.commitStockSession(paid.env,user,paidBody)
  console.log('Paid25 total',paid.count());assert.ok(paid.count()<400);assert.equal(paid.batches(),1)
  const history=paid.sql.prepare('SELECT * FROM action_history WHERE id=?').get(paidReceipt.actionHistoryId)
  paid.env.PLAN_TIER='free';paid.reset()
  const undo=JSON.parse(history.undo_payload)
  await assert.rejects(()=>loadStockSession().replayStockSession(paid.env,user,'undo',paidReceipt.actionHistoryId,0,undo),e=>e.code==='stock_session_query_budget_exceeded')
  assert.equal(paid.batches(),0);assert.equal(paid.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,125)
  paid.env.PLAN_TIER='paid';paid.reset();await paidKernel.replayStockSession(paid.env,user,'undo',paidReceipt.actionHistoryId,0,undo)
  console.log('Paid25 undo total',paid.count());assert.equal(paid.batches(),1)
  paid.reset();await paidKernel.replayStockSession(paid.env,user,'undo',paidReceipt.actionHistoryId,0,undo,{statementsUsed:()=>999,reserveStatements:12})
  assert.equal(paid.count(),1,'successful compensation replay must resolve first')
  const lost=measuredFixture();lost.env.PLAN_TIER='free';lost.loseNextCommitAcknowledgement()
  const lostResult=await commitStockSession(lost.env,user,receiveRequest('free-lost-reply-budget'))
  assert.equal(lostResult.replayed,true);assert.equal(lost.batches(),1);assert.equal(lost.count(),coldKernelStatements)
  assert.equal(lost.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,1)
  assert.equal(lost.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5)
  f.reset()
  const smallHistory=f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(receipt.actionHistoryId)
  f.loseNextCommitAcknowledgement()
  await replayStockSession(f.env,user,'undo',receipt.actionHistoryId,0,JSON.parse(smallHistory.undo_payload))
  const undoQueries=f.count()-1,undoCalls=f.calls()-1
  assert.equal(f.batches(),1,'lost undo acknowledgement cannot retry the atomic mutation')
  assert.equal(f.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,0)
  assert.equal(f.sql.prepare('SELECT generation n FROM stock_session_operations WHERE id=?').get(receipt.operationId).n,1)
  for(const tier of ['free','paid']) for(const extra of [0,1]) {
    const c=measuredFixture();c.env.PLAN_TIER=tier;const k=loadStockSession()
    const r=await k.commitStockSession(c.env,user,receiveRequest('replay-bound-'+tier+'-'+extra))
    const row=c.sql.prepare('SELECT * FROM action_history WHERE id=?').get(r.actionHistoryId),payload=JSON.parse(row.undo_payload)
    c.reset();const offset=(tier==='free'?50:1000)-undoCalls-1+extra
    const perform=()=>k.replayStockSession(c.env,user,'undo',r.actionHistoryId,0,payload,{statementsUsed:()=>offset,reserveStatements:0})
    if(extra){await assert.rejects(perform,e=>e.code==='stock_session_query_budget_exceeded');assert.equal(c.batches(),0);assert.equal(c.sql.prepare('SELECT generation n FROM stock_session_operations WHERE id=?').get(r.operationId).n,0);assert.equal(c.sql.prepare('SELECT stock_quantity n FROM products WHERE id=1').get().n,5)}
    else {await perform();assert.equal(c.count(),undoQueries)}
  }
  console.log('one-line undo',undoQueries)
  const transient=measuredFixture();transient.env.PLAN_TIER='free'
  const transientDb=transient.env.DB;let attempts=0
  const failing=p=>new Proxy(p,{get(t,k){if(k==='bind')return(...params)=>failing(t.bind(...params));if(k==='all')return(...params)=>{attempts+=1;if(attempts===1)throw new Error('D1_ERROR: network reset before schema reply');return t.all(...params)};return t[k]}})
  transient.env.DB=new Proxy(transientDb,{get(t,k){if(k==='prepare')return sql=>/^SELECT t.value table_name/.test(sql)?failing(t.prepare(sql)):t.prepare(sql);return t[k]}})
  await assert.rejects(()=>loadStockSession().commitStockSession(transient.env,user,receiveRequest('free-transient-once-budget')),/network reset/)
  assert.equal(attempts,1,'budgeted preflight must never retry implicitly')
  assert.equal(transient.batches(),0);assert.equal(transient.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,0)
  await outerProof(false)
  await outerProof(true)
  console.log('stock-session plan budget native: PASS')
})().catch(e=>{console.error(e);process.exitCode=1})


