const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
function seedFixture(raw, seed) {
  const value = seedStockFixture(raw, seed)
  assert.throws(() => raw.exec("INSERT INTO products(name) VALUES('unadmitted fixture probe')"), /stock_transaction_required/)
  return value
}
// Sibling check for the return-edit guard (6.0.41, return_edit_empty): can a
// SALE edit empty a sale the way PATCH /api/returns/:id emptied a return?
//
// No. There is no PATCH /api/sales/:id that takes a line list; a sale's lines
// change only through POST /api/sales/:id/amendments, which refuses removing
// the last priced line (409 sale_last_line_remove_refused -- cancel the sale
// instead) and refuses a quantity decrease that would leave a line at 0
// (400 "Use Remove ..."). Neither refusal was pinned by any test. This file
// pins both against the real route and proves a refusal writes nothing, with
// a positive control that removing one of two lines still works.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0, 'the sale-create fixture still exposes its setup block')
const fixtureModule = new Module(file, module)
fixtureModule.filename = file
fixtureModule.paths = module.paths
fixtureModule._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = fixtureModule.exports

const quote = { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 }
const line = (key, quantity = 1) => ({ product_id: 10, quantity, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'selling',
  pricing_quote: { ...quote, gross_usd: 9.5 * quantity, total_usd: 9.5 * quantity, total_khr: 38000 * quantity } })

async function saleWith(requestId, items, stock) {
  const f = h.fixture()
  seedFixture(f.raw.db, () => f.raw.prepare('UPDATE branch_stock SET quantity=@q WHERE product_id=10').run({ q: stock }))
  seedFixture(f.raw.db, () => f.raw.prepare('UPDATE branch_batch_stock SET quantity=@q WHERE batch_id=500').run({ q: stock }))
  seedFixture(f.raw.db, () => f.raw.prepare('UPDATE products SET stock_quantity=@q WHERE id=10').run({ q: stock }))
  const total = items.reduce((sum, item) => sum + item.pricing_quote.total_usd, 0)
  const created = await h.postSale(f.route, { ...h.request(requestId), money_precision_version: 1, items, amount_paid_usd: total })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const id = created.body.sale.id
  const send = async (payload) => {
    const response = await h.app.request(`/${id}/amendments`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ money_precision_version: 1, expected_exchange_rate: 4000, ...payload }) }, { DB: f.route }, h.executionCtx)
    return { status: response.status, body: await response.json() }
  }
  // The route asks the client to confirm the recalculated header first; a
  // refusal that precedes that review is returned as it is.
  const reviewed = async (payload) => {
    const first = await send(payload)
    if (first.status === 409 && first.body.code === 'sale_header_quote_conflict') return send({ ...payload, expected_header_quote: first.body.header_quote })
    return first
  }
  const state = () => JSON.stringify({
    sale: f.raw.prepare('SELECT id,sale_status,subtotal_usd,total_usd,updated_at FROM sales WHERE id=@id').get({ id }),
    items: f.raw.prepare('SELECT * FROM sale_items WHERE sale_id=@id ORDER BY id').all({ id }),
    allocations: f.raw.prepare('SELECT a.* FROM sale_item_batch_allocations a JOIN sale_items i ON i.id=a.sale_item_id WHERE i.sale_id=@id ORDER BY a.id').all({ id }),
    branchStock: f.raw.prepare('SELECT * FROM branch_stock ORDER BY product_id,branch_id').all(),
    lotStock: f.raw.prepare('SELECT * FROM branch_batch_stock ORDER BY batch_id,branch_id').all(),
    product: f.raw.prepare('SELECT stock_quantity FROM products WHERE id=10').get(),
    movements: f.raw.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
    amendments: f.raw.prepare('SELECT COUNT(*) n FROM sale_amendments').get().n,
  })
  const lines = () => f.raw.prepare('SELECT id,quantity FROM sale_items WHERE sale_id=@id ORDER BY id').all({ id })
  return { f, id, reviewed, state, lines }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })

  // 1. The only line cannot be removed: 409, nothing written.
  const single = await saleWith('sale-last-line', [line('only')], 3)
  const [only] = single.lines()
  const beforeRemove = single.state()
  const removed = await single.reviewed({ client_request_id: 'remove-last', kind: 'line_removed', sale_item_id: only.id })
  assert.equal(removed.status, 409, JSON.stringify(removed.body))
  assert.equal(removed.body.code, 'sale_last_line_remove_refused', JSON.stringify(removed.body))
  assert.equal(single.state(), beforeRemove, 'a refused last-line removal writes nothing')

  // 2. The only line cannot be decreased to 0: 400, nothing written.
  const decreased = await single.reviewed({ client_request_id: 'decrease-to-zero', kind: 'line_quantity_decreased', sale_item_id: only.id, quantity: 1 })
  assert.equal(decreased.status, 400, JSON.stringify(decreased.body))
  assert.match(String(decreased.body.error), /Use Remove/, JSON.stringify(decreased.body))
  assert.equal(single.state(), beforeRemove, 'a refused decrease to zero writes nothing')

  // 3. Control: one of two lines can still be removed, and the sale keeps the other.
  const pair = await saleWith('sale-two-lines', [line('first'), line('second')], 3)
  const [first, second] = pair.lines()
  const removedOne = await pair.reviewed({ client_request_id: 'remove-one', kind: 'line_removed', sale_item_id: second.id })
  assert.equal(removedOne.status, 200, JSON.stringify(removedOne.body))
  assert.deepEqual(pair.lines().map((row) => row.id), [first.id], 'the sale keeps its other line')

  console.log('PASS sale edits cannot empty a sale: last-line removal 409 sale_last_line_remove_refused and decrease-to-zero 400 write nothing; removing one of two lines still works')
})().catch((error) => { console.error(error); process.exitCode = 1 })
