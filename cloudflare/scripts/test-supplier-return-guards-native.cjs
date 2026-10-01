const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const cut = source.indexOf(';(async () => {')
assert.ok(cut > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = Module._nodeModulePaths(path.dirname(file))
let head = source.slice(0, cut).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
head = head.replace("fs.readFileSync(sourcePath, 'utf8')", "(process.env.SUPPLIER_GUARD_SOURCE_SHA && ['routes/returns.ts','lib/supplierReturnGuard.ts'].includes(rel) ? require('node:child_process').execFileSync('git',['show',process.env.SUPPLIER_GUARD_SOURCE_SHA + ':cloudflare/src/' + rel],{cwd:path.join(__dirname,'..'),encoding:'utf8'}) : fs.readFileSync(sourcePath, 'utf8'))")
head = head.replace('sendTelegramEvent: async () => {},', 'sendTelegramEvent: async () => {}, sendReturnTelegramEvent: async () => {}, sendReturnStatusTelegramEvents: async () => {},')
head = head.replace('bumpVersion: async () => {},', 'bumpVersion: async () => {}, bumpVersions: async () => {},')
harness._compile(head + '\nmodule.exports={fixture,load,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
const app = h.load('routes/returns.ts').default
const user = { ...h.USER, permissions: '{"all":true}' }
h.setUser(user)
function fixture(hooks) {
  const f = h.fixture(hooks)
  f.raw.prepare("INSERT INTO suppliers(id,name) VALUES(1,'Selected supplier'),(2,'Other supplier')").run()
  f.raw.prepare("UPDATE product_batches SET supplier_id=2,supplier_name='Other supplier',received_quantity=6,received_cost_usd=24,unit_cost_usd=4,payment_status='credit' WHERE id=500").run()
  f.raw.prepare('UPDATE branch_batch_stock SET quantity=6 WHERE batch_id=500').run()
  f.raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,supplier_name,received_quantity,received_cost_usd,unit_cost_usd,payment_status) VALUES(501,10,'selected-lot','SELECTED','2026-09-02',1,2,1,'Selected supplier',4,28,7,'credit')").run()
  f.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,4)').run()
  return f
}
const body = (key = 'supplier_guard_key') => ({ client_request_id: key, branch_id: 1, supplier_id: 1, supplier_name: 'Selected supplier', reason: 'broken in delivery', settlement: 'credit', supplier_compensation_usd: 14, supplier_compensation_khr: 0, items: [{ product_id: 10, quantity: 3, unit_cost_usd: 7, batch_id: 501 }] })
async function post(f, value, route = '/supplier') {
  const response = await app.request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
function unchanged(f) {
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 0)
  assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 10)
}
async function main() {
  if (['money', 'quote'].includes(process.env.SUPPLIER_GUARD_PHASE)) {
    const f = fixture()
    try {
      const value = body()
      if (process.env.SUPPLIER_GUARD_PHASE === 'quote') { value.items[0].unit_cost_usd = 1; value.supplier_compensation_usd = 0 }
      else value.supplier_compensation_usd = -5
      const result = await post(f, value)
      assert.equal(result.status, 400, JSON.stringify(result))
      unchanged(f)
    } finally { f.raw.db.close() }
    return
  }
  if (process.env.SUPPLIER_GUARD_PHASE === 'replay') {
    const f = fixture()
    try {
      assert.equal((await post(f, body())).status, 200)
      const changed = body(); changed.items[0].quantity = 4
      const result = await post(f, changed)
      assert.equal(result.status, 409, JSON.stringify(result))
    } finally { f.raw.db.close() }
    return
  }
  const f = fixture()
  try {
    const result = await post(f, body())
    assert.equal(result.status, 200, JSON.stringify(result))
    const rows = f.raw.prepare('SELECT batch_id,quantity FROM return_item_batch_allocations').all()
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ batch_id: 501, quantity: 3 }])
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=500').get().quantity, 6)
    console.log('PASS exact selected supplier lot, neighboring supplier untouched')
  } finally { f.raw.db.close() }
  for (const edit of [v => { v.items[0].batch_id = 500 }, v => { v.items[0].batch_id = null }, v => { v.items[0].quantity = 5 }, v => { v.items[0].branch_id = 2 }, v => { v.supplier_id = 2 }]) {
    const f = fixture()
    try {
      const value = body(); edit(value)
      const result = await post(f, value)
      assert.ok([400, 409].includes(result.status), JSON.stringify(result))
      unchanged(f)
    } finally { f.raw.db.close() }
  }
  const fifo = fixture()
  try {
    const value = body(); delete value.items[0].batch_id
    const result = await post(fifo, value)
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(fifo.raw.prepare('SELECT batch_id FROM return_item_batch_allocations').get().batch_id, 501)
  } finally { fifo.raw.db.close() }
  const cumulative = fixture()
  try {
    const value = body(); value.items.push({ ...value.items[0], quantity: 2 })
    const result = await post(cumulative, value)
    assert.equal(result.status, 400, JSON.stringify(result))
    unchanged(cumulative)
  } finally { cumulative.raw.db.close() }
  for (const sql of ["UPDATE product_batches SET supplier_id=2 WHERE id=501", 'UPDATE product_batches SET received_cost_usd=32 WHERE id=501', 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=501', 'DELETE FROM branch_batch_stock WHERE batch_id=501']) {
    const raced = fixture({ beforeBatch(db) { db.prepare(sql).run() } })
    try {
      const result = await post(raced, body())
      assert.notEqual(result.status, 200, JSON.stringify(result))
      unchanged(raced)
      assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM return_item_batch_allocations').get().n, 0)
      assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    } finally { raced.raw.db.close() }
  }
  console.log('PASS selected identity refusals and omitted-selection supplier-constrained FIFO at native depth100')
  for (const edit of [v => { v.supplier_compensation_usd = -5 }, v => { v.supplier_compensation_khr = -1 }, v => { v.supplier_compensation_usd = 'NaN' }, v => { v.supplier_compensation_usd = Infinity }, v => { v.supplier_compensation_usd = 14.005 }, v => { v.supplier_compensation_khr = 0.5 }, v => { v.supplier_compensation_usd = 22 }, v => { v.settlement = 'writeoff' }, v => { v.settlement = 'invalid' }, v => { v.exchange_rate = 0 }, v => { v.payment_status = 'paid' }, v => { v.items[0].quantity = Infinity }, v => { v.items[0].unit_cost_usd = -7 }, v => { v.items[0].cost_price_usd = 4 }, v => { v.items[0].unit_cost_usd = 1 }, v => { v.items[0].unit_cost_khr = 'NaN' }]) {
    const f = fixture()
    try {
      const value = body(); edit(value)
      const result = await post(f, value)
      assert.equal(result.status, 400, JSON.stringify(result))
      unchanged(f)
    } finally { f.raw.db.close() }
  }
  for (const [settlement, compensation, loss] of [['credit', 14, 7], ['refund', 21, 0], ['writeoff', 0, 21], ['replacement', 0, 21]]) {
    const f = fixture()
    try {
      const value = body(); value.settlement = settlement; value.supplier_compensation_usd = compensation
      delete value.items[0].unit_cost_usd
      const result = await post(f, value)
      assert.equal(result.status, 200, JSON.stringify(result))
      const returned = f.raw.prepare('SELECT supplier_compensation_usd,supplier_loss_usd FROM returns').get()
      assert.equal(returned.supplier_compensation_usd, compensation)
      assert.equal(returned.supplier_loss_usd, loss)
      assert.equal(returned.supplier_compensation_usd + returned.supplier_loss_usd, 21)
      assert.equal(f.raw.prepare('SELECT total_usd FROM return_items').get().total_usd, 21)
      assert.equal(f.raw.prepare('SELECT unit_cost_usd FROM inventory_movements').get().unit_cost_usd, 7)
    } finally { f.raw.db.close() }
  }
  console.log('PASS finite/nonnegative costs and compensation, alias/settlement/precision conflicts, actual lot cost conservation')
  const shared = fixture()
  try {
    shared.raw.prepare('UPDATE product_batches SET received_quantity=12,received_cost_usd=20,unit_cost_usd=2 WHERE id=501').run()
    const value = body(); value.items[0].unit_cost_usd = 1.6667; value.supplier_compensation_usd = 2
    assert.equal((await post(shared, value)).status, 200)
    const returned = shared.raw.prepare('SELECT supplier_loss_usd FROM returns').get()
    assert.equal(returned.supplier_loss_usd, 3)
    assert.equal(shared.raw.prepare('SELECT total_usd FROM return_items').get().total_usd, 5)
  } finally { shared.raw.db.close() }
  const unknown = fixture()
  try {
    unknown.raw.prepare('UPDATE product_batches SET received_cost_usd=NULL,unit_cost_usd=NULL WHERE id=501').run()
    assert.equal((await post(unknown, body())).status, 400)
    unchanged(unknown)
  } finally { unknown.raw.db.close() }
  const legacyQuote = fixture()
  try {
    const value = body(); delete value.items[0].batch_id; value.items[0].unit_cost_usd = 1; value.supplier_compensation_usd = 0
    assert.equal((await post(legacyQuote, value)).status, 200)
    assert.equal(legacyQuote.raw.prepare('SELECT total_usd FROM return_items').get().total_usd, 3)
    console.log('LIMITATION inherited unselected FIFO valuation intentionally remains caller quote, actual selected receipt basis only')
  } finally { legacyQuote.raw.db.close() }
  const replay = fixture()
  try {
    const first = await post(replay, body())
    assert.equal(first.status, 200, JSON.stringify(first))
    const receipt = replay.raw.prepare('SELECT request_json,sale_id FROM return_create_receipts').get()
    assert.equal(receipt.sale_id, null)
    assert.equal(JSON.parse(receipt.request_json).scope, 'supplier_return_v1')
    replay.raw.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=501').run()
    const same = await post(replay, body())
    assert.equal(same.status, 200, JSON.stringify(same))
    assert.equal(same.body.id, first.body.id)
    assert.equal(same.body.duplicate, true)
    for (const edit of [v => { v.items[0].quantity = 4 }, v => { v.items[0].product_id = 11 }, v => { v.items[0].batch_id = 500 }, v => { delete v.items[0].batch_id }, v => { v.supplier_id = 2 }, v => { v.items[0].branch_id = 2 }, v => { v.supplier_compensation_usd = 0 }, v => { v.settlement = 'refund' }, v => { v.reason = 'different reason' }, v => { v.notes = 'different note' }, v => { v.items[0].unit_cost_usd = 6 }, v => { v.exchange_rate = 4100 }]) {
      const changed = body(); edit(changed)
      const result = await post(replay, changed)
      assert.equal(result.status, 409, JSON.stringify(result))
      assert.equal(result.body.code, 'idempotency_conflict')
    }
    for (const edit of [v => { v.treatment = 'keep' }, v => { v.items[0].return_to_stock = true }, v => { v.items[0].disposition = 'remove' }]) {
      const changed = body(); edit(changed)
      assert.equal((await post(replay, changed)).status, 400)
    }
    h.setUser({ ...user, id: 72 })
    const other = await post(replay, body())
    assert.equal(other.status, 409, JSON.stringify(other))
    assert.equal(other.body.id, undefined)
    h.setUser({ ...user, permissions: '{"returns":false}' })
    assert.equal((await post(replay, body())).status, 403)
    for (const permissions of [{ returns: true, product_cost_view: true }, { returns: true, product_cost_edit: true }]) {
      h.setUser({ ...user, permissions: JSON.stringify(permissions) })
      assert.equal((await post(replay, body())).status, 403)
    }
    h.setUser(user)
    const customer = await post(replay, { client_request_id: body().client_request_id, reason: 'customer reason', branch_id: 1, items: [{ product_id: 10, quantity: 1, applied_price_usd: 1, return_to_stock: false }] }, '/')
    assert.equal(customer.status, 409, JSON.stringify(customer))
    assert.equal(replay.raw.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 1)
    assert.equal(replay.raw.prepare('SELECT COUNT(*) AS n FROM return_create_receipts').get().n, 1)
  } finally { h.setUser(user); replay.raw.db.close() }
  const lost = fixture({ afterBatchThrow: true })
  try {
    const result = await post(lost, body())
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(result.body.duplicate, true)
    assert.equal(lost.raw.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 1)
    assert.equal(lost.raw.prepare('SELECT COUNT(*) AS n FROM return_create_receipts').get().n, 1)
    assert.equal(lost.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 7)
  } finally { lost.raw.db.close() }
  for (const different of [false, true]) {
    let injected = false, raced
    raced = fixture({ async beforeBatch() {
      if (injected) return
      injected = true
      const winning = body(); if (different) winning.items[0].quantity = 2
      const result = await post(raced, winning)
      assert.equal(result.status, 200, JSON.stringify(result))
    } })
    try {
      const result = await post(raced, body())
      assert.equal(result.status, different ? 409 : 200, JSON.stringify(result))
      assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM returns').get().n, 1)
      assert.equal(raced.raw.prepare('SELECT COUNT(*) AS n FROM return_create_receipts').get().n, 1)
      assert.equal(raced.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, different ? 8 : 7)
    } finally { raced.raw.db.close() }
  }
  const legacy = fixture()
  try {
    legacy.raw.prepare("INSERT INTO returns(return_number,client_request_id,return_scope,status) VALUES('SRET-LEGACY',?,'supplier','completed')").run([body().client_request_id])
    assert.equal((await post(legacy, body())).status, 409)
  } finally { legacy.raw.db.close() }
  for (const key of ['', 'x'.repeat(121), 'ក'.repeat(41)]) {
    const f = fixture()
    try {
      const value = body(key)
      assert.equal((await post(f, value)).status, 400)
      unchanged(f)
    } finally { f.raw.db.close() }
  }
  for (const mode of ['receipt', 'reset', 'restore']) {
    const f = fixture({ beforeBatch(db, statements) {
      if (mode === 'receipt') statements.find(statement => /INSERT INTO return_create_receipts/.test(statement.sql)).params.request_json = '{bad'
      else db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run([JSON.stringify({ mode })])
    } })
    try {
      assert.notEqual((await post(f, body())).status, 200)
      unchanged(f)
      assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM return_create_receipts').get().n, 0)
      assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM return_items').get().n, 0)
      assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    } finally { f.raw.db.close() }
  }
  console.log('PASS same-intent durable replay, changed intent/actor/customer scope conflicts, lost response and competing intent races')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
