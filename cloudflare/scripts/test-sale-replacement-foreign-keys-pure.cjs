const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const fixtureModule = new Module(file, module)
fixtureModule.filename = file
fixtureModule.paths = module.paths
fixtureModule._compile(source.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = fixtureModule.exports

async function amend(route, saleId, body) {
  const send = async payload => {
    const response = await h.app.request(`/${saleId}/amendments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { DB: route }, h.executionCtx)
    return { status: response.status, body: await response.json(), request: payload }
  }
  const reviewed = await send(body)
  return reviewed.status === 409 && reviewed.body.code === 'sale_header_quote_conflict'
    ? send({ ...body, expected_header_quote: reviewed.body.header_quote }) : reviewed
}
function snapshot(db) {
  return Object.fromEntries(['sales', 'sale_items', 'sale_item_batch_allocations', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'sale_amendments', 'sale_mutation_receipts', 'sale_mutation_members', 'sale_write_revisions'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

;(async () => {
  h.setUser({ ...h.USER, permissions: JSON.stringify({ all: true }) })
  const f = h.fixture(), errors = []
  f.raw.prepare("INSERT INTO users(id,username,name,password,is_active) VALUES(71,'sale_cashier','Sale Cashier','disposable-fixture',1)").run()
  f.raw.prepare("INSERT INTO products(id,name,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(20,'Balm',10,3,12000,1.2345,4938,1)").run()
  f.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(20,1,10)').run()
  f.raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(600,20,'balm-lot','BALM-LOT','2026-09-01',1,1)").run()
  f.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,10)').run()
  f.raw.exec('PRAGMA foreign_keys=ON')
  assert.equal(f.raw.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.deepEqual(f.raw.prepare('PRAGMA foreign_key_check').all(), [])
  const batch = f.route.batch.bind(f.route)
  f.route.batch = async statements => { try { return await batch(statements) } catch (error) { errors.push(error.message); throw error } }
  const created = await h.postSale(f.route, { ...h.request('replacement-fk-create'), sale_status: 'awaiting_payment', amount_paid_usd: 0 })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const saleId = created.body.sale.id, lineId = created.body.sale.items[0].id
  h.setUser({ ...h.USER, role_code: 'employee', permissions: JSON.stringify({ sales: true, 'sales:amend': true, 'sales:add_items': false, products: false, product_cost_view: false, product_cost_edit: false }) })
  const increased = await amend(f.route, saleId, { kind: 'line_updated', sale_item_id: lineId, quantity: 2, money_precision_version: 1, client_request_id: 'replacement-fk-increase', expected_exchange_rate: 4000, expected_updated_at: created.body.sale.updated_at, pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } })
  assert.equal(increased.status, 200, JSON.stringify(increased.body))
  const before = snapshot(f.raw)
  const body = { kind: 'line_replaced', sale_item_id: lineId, money_precision_version: 1, client_request_id: 'replacement-fk-replace', expected_exchange_rate: 4000, expected_updated_at: increased.body.updated_at, replacement: { product_id: 20, quantity: 2, branch_id: 1, client_line_key: 'replacement-balm', pricing_source: 'selling', pricing_quote: { gross_usd: 6, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 6, total_khr: 24000 } } }
  const replaced = await amend(f.route, saleId, body)
  if (replaced.status !== 200) console.error(JSON.stringify({ refusal: replaced, underlyingBatchErrors: errors, rolledBack: JSON.stringify(snapshot(f.raw)) === JSON.stringify(before) }))
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body))
  const after = snapshot(f.raw), row = after.sale_items[0]
  assert.deepEqual(after.sale_items.map(r => [r.product_id, r.quantity]), [[20, 2]])
  assert.equal(after.sales[0].total_usd, 6)
  assert.equal(after.branch_stock.find(r => r.product_id === 10).quantity, 10)
  assert.equal(after.branch_batch_stock.find(r => r.batch_id === 500).quantity, 10)
  assert.equal(after.branch_stock.find(r => r.product_id === 20).quantity, 8)
  assert.equal(after.branch_batch_stock.find(r => r.batch_id === 600).quantity, 8)
  assert.equal(after.sale_item_batch_allocations[0].sale_item_id, row.id)
  assert.equal(after.sale_item_batch_allocations[0].quantity, 2)
  assert.deepEqual(replaced.body.sale.items.map(r => [r.id, r.product_id, r.quantity]), [[row.id, 20, 2]])
  assert.equal(replaced.body.sale.total_usd, 6)
  assert.equal(Object.hasOwn(replaced.body.sale.items[0], 'cost_price_usd'), false)
  assert.deepEqual(f.raw.prepare('PRAGMA foreign_key_check').all(), [])
  const receipt = after.sale_mutation_receipts.find(r => r.request_id === body.client_request_id)
  assert.equal(JSON.parse(receipt.after_json).lines[0].id, row.id)
  assert.equal(receipt.sale_revision, after.sale_write_revisions[0].revision)
  const retried = await amend(f.route, saleId, replaced.request)
  assert.equal(retried.status, 200, JSON.stringify(retried.body))
  assert.deepEqual(retried.body, replaced.body)
  assert.deepEqual(snapshot(f.raw), after)
  f.route.batch = statements => batch([...statements, { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)', params: {} }])
  const failed = await amend(f.route, saleId, { ...body, sale_item_id: row.id, expected_updated_at: replaced.body.updated_at, client_request_id: 'replacement-fk-rollback', replacement: { ...body.replacement, product_id: 10, client_line_key: 'replacement-powder', pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } } })
  assert.equal(failed.status, 409)
  assert.equal(failed.body.code, 'write_conflict')
  assert.deepEqual(snapshot(f.raw), after, 'a late batch failure rolls back the receipt, its members, both stock ledgers and all financial effects')
  assert.deepEqual(f.raw.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('PASS replacement with immediate foreign keys: employee quantity-edit/Replace, stock/lot inverse, final receipt identity/revision/redaction, exact replay and late atomic rollback')
})().catch(error => { console.error(error); process.exitCode = 1 })
