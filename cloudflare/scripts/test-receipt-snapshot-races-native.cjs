// Exercise the existing full-index/auth/native D1 world, retaining its actual
// request metrics, physical-attempt caps and settled background work.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const file = path.join(__dirname, 'test-intake-full-request-budget.cjs')
const worldSource = fs.readFileSync(file, 'utf8').split(';(async () => {')[0]
function loadWorld(removeGuard) {
  const originalRead = fs.readFileSync
  let removed = 0
  if (removeGuard) fs.readFileSync = function (target, ...args) {
    const value = originalRead.call(this, target, ...args)
    if (String(target).replaceAll('\\','/').endsWith('/src/lib/productBatches.ts')) {
      const condition = removeGuard === 'unit-cost' ? 'unit_cost_usd IS @unitCostUsd' : 'received_cost_usd IS @receivedCostBefore'
      assert.equal(value.split(condition).length - 1, 1, 'remove exactly the corresponding atomic guard condition')
      removed++
      return value.replace(condition, '1=1')
    }
    return value
  }
  try {
    const exported = new Function('require','__dirname',worldSource + ';return {world};')(require,__dirname)
    if (removeGuard) assert.equal(removed,1,'actual business module loaded once with one test-local guard mutation')
    return exported.world
  } finally { fs.readFileSync = originalRead }
}
function state(f, ownId) {
  const tables = ['products','branch_stock','branch_batch_stock','product_batches','inventory_movements','damaged_stock_lots',
    'action_history','undo_snapshots','audit_log','audit_logs','stock_session_guards','stock_mutation_receipts']
  return JSON.stringify(tables.filter(table => f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
    .map(table => [table, f.sql.prepare(`SELECT * FROM ${table}${table === 'stock_mutation_receipts' ? ' WHERE request_id<>?' : ''} ORDER BY rowid`).all(...(table === 'stock_mutation_receipts' ? [ownId] : []))]))
}
async function run(tier, kind, negative = false) {
  const world = loadWorld(negative ? kind : null)
  const f = await world(tier,'add',false)
  try {
    const warmup = await f.call(true)
    assert.equal(warmup.status,200)
    const cap = tier === 'free' ? 50 : 1000
    assert.ok(warmup.physical <= cap, 'warmup includes actual auth, stock and settled tails within the invocation cap')
    f.body.client_request_id += '-snapshot-race-' + kind
    const id = f.body.client_request_id, batchId = warmup.body.batchId
    f.body.batchId = batchId
    const beforeEffects = f.effects()
    let snapshotRead = false, physicalBatch = false, fired = false, competingState
    const binding = f.env.DB
    f.env.DB = new Proxy(binding,{ get(target,key) {
      if (key === 'prepare') return sql => {
        const prepared = target.prepare(sql)
        const wrap = statement => new Proxy(statement,{ get(row,method) {
          if (method === 'bind') return (...params) => wrap(row.bind(...params))
          if (method === 'all') return async (...params) => {
            const result = await row.all(...params)
            if (/SELECT pb\.id,pb\.batch_key,pb\.received_at/.test(sql)) snapshotRead = true
            return result
          }
          return row[method]
        } })
        return wrap(prepared)
      }
      if (key === 'batch') return statements => {
        if (statements.some(statement => /UPDATE product_batches SET/.test(statement.text))) physicalBatch = true
        return target.batch(statements)
      }
      return target[key]
    } })
    f.beforeCommit(sql => {
      assert.equal(snapshotRead,true,'competing edit occurs after the actual combined snapshot returned')
      assert.equal(physicalBatch,true,'competing edit occurs immediately before the physical atomic batch')
      fired = true
      sql.prepare(kind === 'unit-cost' ? 'UPDATE product_batches SET unit_cost_usd=9 WHERE id=?'
        : 'UPDATE product_batches SET received_cost_usd=received_cost_usd+100 WHERE id=?').run(batchId)
      competingState = state(f,id)
    })
    const answer = await f.call()
    assert.equal(fired,true,'the native beforeCommit hook must actually fire')
    assert.ok(answer.physical <= cap, 'failed batch, cleanup, auth and tails remain within actual invocation cap')
    console.log('MEASURED '+JSON.stringify({tier,kind,negative,warmupPhysical:warmup.physical,...answer}))
    if (negative) {
      assert.equal(answer.status,200,'removing only this guard must admit the stale receipt and discriminate the fixture')
      assert.equal(answer.effects.stock,beforeEffects.stock+3)
      assert.equal(answer.effects.movement,beforeEffects.movement+1)
      assert.equal(answer.effects.written,beforeEffects.written+1)
      assert.notEqual(state(f,id),competingState)
      if (kind === 'unit-cost') assert.equal(f.sql.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=?').get(batchId).unit_cost_usd,9)
      else assert.equal(f.sql.prepare('SELECT received_cost_usd FROM product_batches WHERE id=?').get(batchId).received_cost_usd,22,'unsafe top-up overwrites the competing116 total with stale16+6')
    } else {
      assert.notEqual(answer.status,200,'changed receipt facts cannot succeed')
      assert.notEqual(answer.body.code,'stock_request_query_budget_exceeded','a warmed admitted race must reach its financial guard, not be hidden by budget refusal')
      assert.deepEqual(answer.effects,beforeEffects)
      assert.equal(state(f,id),competingState,'preserve the competing mutation and every other business/history row')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts WHERE request_id=?').get(id).n,0,'rolled-back request leaves no partial/written receipt')
      const lot = f.sql.prepare('SELECT unit_cost_usd,received_cost_usd FROM product_batches WHERE id=?').get(batchId)
      assert.equal(kind === 'unit-cost' ? lot.unit_cost_usd : lot.received_cost_usd,kind === 'unit-cost' ? 9 : 116)
    }
  } finally { f.sql.close() }
}
;(async () => {
  for (const tier of ['free','paid']) for (const kind of ['unit-cost','cumulative-cost']) {
    await run(tier,kind); console.log('PASS '+tier+' '+kind+' snapshot-to-batch race preserves winner and refuses all receipt effects')
  }
  for (const kind of ['unit-cost','cumulative-cost']) {
    await run('paid',kind,true); console.log('PASS negative '+kind+' removes only its guard and exposes stale receipt acceptance')
  }
  console.log('PASS 6 bounded receipt snapshot races and guard discriminators')
})().catch(error => { console.error(error); process.exitCode = 1 })
