const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { Hono } = require('hono')
const f = require('./test-stock-bridge-core-native.cjs')
f.actor.permissions = JSON.stringify({ all: true })
const { sql, load, raw, db } = f
const executor = load('lib/stockTransaction.ts')
const app = new Hono()
app.route('/inventory', load('routes/inventory.ts').default)
app.route('/returns', load('routes/returns.ts').default)
app.onError((error, c) => c.json(executor.stockTransactionRefusal(error) || { error: error.message }, 503))
const frozen = new Hono()
frozen.route('/inventory', load('routes/inventory.ts', execFileSync('git', ['show', '9dec3a3ab906ee2183db81f4205cb56f38a417ff:cloudflare/src/routes/inventory.ts'], { encoding: 'utf8' })).default)
frozen.route('/returns', load('routes/returns.ts', execFileSync('git', ['show', '9dec3a3ab906ee2183db81f4205cb56f38a417ff:cloudflare/src/routes/returns.ts'], { encoding: 'utf8' })).default)
const physical = () => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','inventory_movements','action_history'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
const total = () => Number(sql.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1001 AND branch_id=1').get().q)
const tagged = () => Number(sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0) q FROM damaged_stock_lots WHERE product_id=1001').get().q)
let sequence = 0, checks = 0
const body = (extra = {}) => ({ productId: 1001, branchId: 1, type: 'remove', quantity: 1, reason: 'Fixture adjustment', client_request_id: `bridge-route-${++sequence}`, ...extra })
async function send(url, body, target = app, method = 'POST') {
  const pending = []
  const response = await target.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: raw, PLAN_TIER: 'paid' }, { waitUntil(p) { pending.push(Promise.resolve(p)) } })
  await Promise.allSettled(pending)
  return { status: response.status, body: await response.json() }
}
async function check(name, run) { await run(); assert.equal(f.permits(),0); checks++; console.log(`PASS ${name}`) }
async function main() {
  await check('old route refuses auto-removal; current route commits once', async () => {
    const request = body(), before = physical(), beforeTotal = total()
    const old = await send('/inventory/adjust', request, frozen)
    assert.notEqual(old.status,200,JSON.stringify(old)); assert.equal(physical(),before)
    const saved = await send('/inventory/adjust', request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(total(),beforeTotal-1)
    const after = physical(); assert.equal((await send('/inventory/adjust',request)).status,200); assert.equal(physical(),after)
  })
  await check('named tagged removal and restoration share guarded receipt', async () => {
    const beforeTotal = total(), beforeTag = tagged()
    const removed = await send('/inventory/adjust',body({ batchId: 1001, conditionTag: 'broken' }))
    assert.equal(removed.status,200,JSON.stringify(removed)); assert.equal(total(),beforeTotal-1); assert.equal(tagged(),beforeTag+1)
    const request = body({ conditionTag: 'broken' })
    const restored = await send('/inventory/tagged-lots/restore',request)
    assert.equal(restored.status,200,JSON.stringify(restored)); assert.equal(total(),beforeTotal); assert.equal(tagged(),beforeTag)
    const after = physical(); assert.equal((await send('/inventory/tagged-lots/restore',request)).status,200); assert.equal(physical(),after)
  })
  await check('condition-only damaged ledger action is guarded and rollback-safe', async () => {
    assert.equal((await send('/inventory/adjust',body({ conditionTag: 'broken' }))).status,200)
    const before = physical(), request = body({ conditionTag:'broken' })
    f.failSql(/INSERT INTO inventory_movements/)
    const result = await send('/inventory/tagged-lots/dispose',request)
    assert.notEqual(result.status,200,JSON.stringify(result)); assert.equal(physical(),before)
    assert.equal((await send('/inventory/tagged-lots/dispose',request)).status,200)
  })
  await check('wrong epoch is retryable refusal rather than false unknown write', async () => {
    const request = body(), before = physical()
    sql.exec("UPDATE system_flags SET value='future-epoch' WHERE key='stock_schema_epoch'")
    const result = await send('/inventory/adjust',request)
    assert.equal(result.status,503,JSON.stringify(result)); assert.equal(result.body.code,'stock_schema_unavailable')
    assert.equal(physical(),before)
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts WHERE request_id=?').get(request.client_request_id).n,0)
    sql.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(executor.STOCK_SCHEMA_EPOCH)
    assert.equal((await send('/inventory/adjust',request)).status,200)
  })
  await check('lost acknowledgement preserves durable marker and cannot repeat removal', async () => {
    const request = body(), before = total()
    f.loseNextAcknowledgement()
    const result = await send('/inventory/adjust',request)
    assert.equal(result.status,503,JSON.stringify(result)); assert.equal(total(),before-1)
    const after = physical(), replay = await send('/inventory/adjust',request)
    assert.equal(replay.status,200,JSON.stringify(replay)); assert.equal(replay.body.replayed,true); assert.equal(physical(),after)
    const receipt=sql.prepare('SELECT written,response_status,response_json,completed_at FROM stock_mutation_receipts WHERE request_id=?').get(request.client_request_id)
    assert.equal(receipt.written,1); assert.equal(receipt.response_status,200); assert.ok(receipt.completed_at)
    assert.deepEqual(replay.body,{...JSON.parse(receipt.response_json),replayed:true})
  })
  await check('move-row physical, destination identity and history are one guarded transaction', async () => {
    await load('lib/productBatches.ts').receiveBatchStock(db,{ productId:1001, branchId:1, batchId:1001, quantity:5, historicalReceiptReplay:true })
    const request = { sourceProductId:1001, destinationProductId:1002, branchId:1, quantity:1, reason:'Fixture movement' }
    const before = physical(), beforeTotal = total()
    assert.notEqual((await send('/inventory/move-row',request,frozen)).status,200); assert.equal(physical(),before)
    const saved = await send('/inventory/move-row',request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(total(),beforeTotal-1)
  })
  await check('customer return stock and durable RETURNING receipt commit under barrier', async () => {
    const request = { client_request_id:'bridge-customer-return-1', reason:'Fixture return', branch_id:1,
      items:[{ product_id:1001, product_name:'Stock', quantity:1, stock_action:'restock', branch_id:1, batch_id:1001, applied_price_usd:2, applied_price_khr:0 }] }
    const before = physical(), beforeTotal = total()
    const old = await send('/returns',request,frozen)
    assert.notEqual(old.status,200,JSON.stringify(old)); assert.equal(physical(),before)
    const saved = await send('/returns',request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(total(),beforeTotal+1)
    const after = physical(); assert.equal((await send('/returns',request)).status,200); assert.equal(physical(),after)
  })
  await check('damaged-only customer return cannot evade physical writer barrier', async () => {
    const request = { client_request_id:'bridge-damaged-return-1', reason:'Fixture tagged return', branch_id:1,
      items:[{ product_id:1001, product_name:'Stock', quantity:1, stock_action:'damaged', condition_tag:'broken', damaged_disposition:'keep', branch_id:1, batch_id:1001, applied_price_usd:2, applied_price_khr:0 }] }
    const before = physical(), beforeTag = tagged(), beforeTotal = total()
    assert.notEqual((await send('/returns',request,frozen)).status,200); assert.equal(physical(),before)
    const saved = await send('/returns',request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(tagged(),beforeTag+1); assert.equal(total(),beforeTotal)
    const after = physical(); assert.equal((await send('/returns',request)).status,200); assert.equal(physical(),after)
  })
  await check('damaged-only return edit guards both reversal and replacement', async () => {
    const row = sql.prepare("SELECT id,updated_at FROM returns WHERE client_request_id='bridge-damaged-return-1'").get()
    const request = { client_request_id:'bridge-damaged-return-edit', expected_updated_at:row.updated_at, reason:'Fixture tagged edit',
      items:[{ product_id:1001, product_name:'Stock', quantity:2, stock_action:'damaged', condition_tag:'broken', damaged_disposition:'keep', branch_id:1, applied_price_usd:2, applied_price_khr:0 }] }
    const before = physical(), beforeTag = tagged(), beforeTotal = total()
    const old = await send(`/returns/${row.id}`,request,frozen,'PATCH')
    assert.notEqual(old.status,200,JSON.stringify(old)); assert.equal(physical(),before)
    const saved = await send(`/returns/${row.id}`,request,app,'PATCH')
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(tagged(),beforeTag+1); assert.equal(total(),beforeTotal)
    const after = physical(); assert.equal((await send(`/returns/${row.id}`,request,app,'PATCH')).status,200); assert.equal(physical(),after)
  })
  await check('supplier return preserves one guarded debit and replay', async () => {
    const request = { client_request_id:'bridge-supplier-return', reason:'Fixture supplier return', branch_id:1, supplier_name:'Fixture', settlement:'refund',
      items:[{ product_id:1001, product_name:'Stock', quantity:1, branch_id:1, cost_price_usd:2, cost_price_khr:0 }] }
    const before = physical(), beforeTotal = total()
    assert.notEqual((await send('/returns/supplier',request,frozen)).status,200); assert.equal(physical(),before)
    const saved = await send('/returns/supplier',request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(total(),beforeTotal-1)
    const after = physical(); assert.equal((await send('/returns/supplier',request)).status,200); assert.equal(physical(),after)
  })
  await check('non-restock return keeps metadata availability at a future stock epoch', async () => {
    sql.exec("UPDATE system_flags SET value='future-epoch' WHERE key='stock_schema_epoch'")
    const before = physical()
    const request = { client_request_id:'bridge-no-stock-return', reason:'Fixture no restock', branch_id:1,
      items:[{ product_id:1001, product_name:'Stock', quantity:1, stock_action:'none', branch_id:1, applied_price_usd:2, applied_price_khr:0 }] }
    const saved = await send('/returns',request)
    assert.equal(saved.status,200,JSON.stringify(saved)); assert.equal(physical(),before)
    sql.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(executor.STOCK_SCHEMA_EPOCH)
  })
  console.log(`PASS ${checks} mounted inventory/return bridge groups using actual SQLite and full0243`)
}
main().catch(error => { console.error(error); process.exitCode=1 }).finally(() => sql.close())
