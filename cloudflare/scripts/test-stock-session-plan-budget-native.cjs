const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest, seedDistinctProducts } = require('./test-stock-session-atomic.cjs')
function measuredFixture() {
  const f = fixture(), raw = f.env.DB
  let queries = 0, batches = 0
  const statement = p => new Proxy(p, { get(t,k) {
    if(k === 'bind') return (...params) => statement(t.bind(...params))
    if(['first','all','run'].includes(k)) return (...params) => { queries += 1; return t[k](...params) }
    return t[k]
  } })
  f.env.DB = new Proxy(raw, { get(t,k) {
    if(k === 'prepare') return sql => statement(t.prepare(sql))
    if(k === 'batch') return statements => { queries += statements.length; batches += 1; return t.batch(statements) }
    return t[k]
  } })
  return Object.assign(f, { count: () => queries, batches: () => batches, reset() { queries = 0; batches = 0 } })
}
;(async () => {
  const { commitStockSession } = loadStockSession()
  const f = measuredFixture(); f.env.PLAN_TIER = 'free'
  const body = receiveRequest('free-one-line-budget')
  const receipt = await commitStockSession(f.env,user,body)
  assert.ok(f.count() <= 38, `cold kernel ${f.count()} must leave measured outer headroom`)
  assert.equal(f.batches(),1)
  f.reset(); await commitStockSession(f.env,user,body,null,{statementsUsed:()=>49,reserveStatements:12})
  assert.equal(f.count(),1,'stored success must resolve first')
  const large = measuredFixture(); large.env.PLAN_TIER = 'free'; seedDistinctProducts(large,2)
  const input=receiveRequest('free-two-line-budget'); input.items.push({...input.items[0],line_id:'second',product_id:2})
  await assert.rejects(()=>commitStockSession(large.env,user,input),e=>e.code==='stock_session_query_budget_exceeded')
  assert.equal(large.batches(),0)
  assert.equal(large.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n,0)
  assert.equal(large.sql.prepare('SELECT SUM(stock_quantity) n FROM products').get().n,0)
  console.log('stock-session plan budget native: PASS')
})().catch(e=>{console.error(e);process.exitCode=1})
