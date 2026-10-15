const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={routeDb,request,postSale,app,executionCtx,setUser(value){currentUser=value}};', file)
const h = harness.exports
const admin = { id: 71, username: 'amendment_admin', role_code: 'admin', permissions: '{"all":true}' }
h.setUser(admin)

const quote = (quantity, price = 10) => ({ gross_usd: quantity * price, product_discount_usd: 0,
  manual_discount_usd: 0, total_usd: quantity * price, total_khr: quantity * price * 4000 })
const intent = (product, quantity, key) => ({ product_id: product, quantity, branch_id: 1,
  batch_id: product + 490, client_line_key: key, pricing_source: 'selling', pricing_quote: quote(quantity) })
const tables = ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'sales', 'sale_items',
  'sale_item_batch_allocations', 'inventory_movements', 'sale_amendments', 'sale_mutation_receipts', 'sale_mutation_members']
const snapshot = f => JSON.stringify(tables.map(table => f.raw.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
const stock = f => JSON.stringify(['products', 'branch_stock', 'branch_batch_stock', 'inventory_movements']
  .map(table => table === 'products' ? f.raw.db.prepare('SELECT id,stock_quantity FROM products ORDER BY id').all()
    : f.raw.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
const number = (f, sql) => Number(Object.values(f.raw.db.prepare(sql).get())[0])
const noPermit = f => assert.equal(number(f, "SELECT COUNT(*) FROM system_flags WHERE key='stock_transaction_permit'"), 0)

function seed(raw, run) {
  raw.db.exec('BEGIN IMMEDIATE')
  try {
    raw.db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    run()
    raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    raw.db.exec('COMMIT')
  } catch (error) { raw.db.exec('ROLLBACK'); throw error }
}

async function fixture() {
  const raw = openDb(loadAll())
  seed(raw, () => {
    raw.db.exec("INSERT INTO branches(id,name,role,is_default,is_active) VALUES(1,'Shop','shop',1,1),(2,'Second Shop','shop',0,1)")
    for (const product of [10, 11, 12]) {
      raw.db.prepare('INSERT INTO products(id,name,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(?,?,20,10,2,1)').run(product, `Admission ${product}`)
      raw.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,20)').run(product)
      raw.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(?,?,?,?,'2026-09-01',1,1)")
        .run(product + 490, product, `lot-${product}`, `lot-${product}`)
      raw.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,20)').run(product + 490)
    }
  })
  const control = { beforeAmendment: null, lostReply: false, physicalBatches: 0, ordinaryBatches: 0 }
  const route = h.routeDb(raw, { beforeBatch(_db, statements) {
    if (!statements.some(({ sql }) => /INSERT INTO sale_mutation_receipts/i.test(sql))) return
    const permitted = statements.some(({ sql }) => /INSERT INTO system_flags[\s\S]*stock_transaction_permit/.test(sql))
    if (permitted) control.physicalBatches += 1
    else control.ordinaryBatches += 1
    control.beforeAmendment?.()
  } })
  const batch = route.batch.bind(route)
  route.batch = async statements => {
    const results = await batch(statements)
    if (control.lostReply && statements.some(({ sql }) => /INSERT INTO sale_mutation_receipts/i.test(sql))) {
      control.lostReply = false
      throw new Error('simulated lost D1 response after commit')
    }
    return results
  }
  const f = { raw, route, control }
  noPermit(f)
  assert.throws(() => raw.db.exec('UPDATE branch_stock SET quantity=quantity+1 WHERE product_id=10'), /stock_transaction_required/)
  const created = await h.postSale(route, { ...h.request(crypto.randomUUID()), items: [intent(10, 3, 'first'), intent(11, 2, 'second')], amount_paid_usd: 50 })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  f.saleId = created.body.sale.id
  f.lineId = created.body.sale.items.find(line => Number(line.product_id) === 10).id
  noPermit(f)
  return f
}

function body(f, kind, extra = {}) {
  return { kind, sale_item_id: f.lineId, money_precision_version: 1, client_request_id: crypto.randomUUID(),
    expected_exchange_rate: 4000, ...extra }
}
async function request(f, payload, headers = {}) {
  noPermit(f)
  const response = await h.app.request(`/${f.saleId}/amendments`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload) }, { DB: f.route }, h.executionCtx)
  const result = { status: response.status, body: await response.json() }
  noPermit(f)
  return result
}
async function reviewed(f, payload, headers) {
  const before = snapshot(f)
  const first = await request(f, payload, headers)
  if (first.status !== 409 || first.body.code !== 'sale_header_quote_conflict') return first
  assert.equal(first.body.proven_uncommitted, true)
  assert.equal(snapshot(f), before)
  payload.expected_header_quote = first.body.header_quote
  return request(f, payload, headers)
}

let failures = 0
let checks = 0
async function check(name, run) {
  try { await run(); checks += 1; console.log(`PASS ${name}`) }
  catch (error) { failures += 1; console.error(`FAIL ${name}`, error) }
}

async function main() {
  for (const [kind, extra, expected] of [
    ['line_quantity_increased', { quantity: 1, pricing_quote: quote(4) }, 16],
    ['line_quantity_decreased', { quantity: 1, pricing_quote: quote(2) }, 18],
    ['line_updated', { quantity: 4, pricing_quote: quote(4) }, 16],
    ['line_removed', {}, 20],
  ]) await check(`active ${kind} admits all stock ledgers and exact retry`, async () => {
    const f = await fixture(), payload = body(f, kind, extra)
    const result = await reviewed(f, payload)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(number(f, 'SELECT stock_quantity FROM products WHERE id=10'), expected)
    assert.equal(number(f, 'SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1'), expected)
    assert.equal(number(f, 'SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1'), expected)
    assert.equal(f.control.physicalBatches, 1)
    const committed = snapshot(f)
    assert.deepEqual(await request(f, payload), result)
    assert.equal(snapshot(f), committed)
    assert.equal((await request(f, { ...payload, notes: 'different intent' })).status, 409)
    assert.equal(snapshot(f), committed)
  })

  await check('equal-unit replacement moves both products despite net zero units', async () => {
    const f = await fixture(), payload = body(f, 'line_replaced', { replacement: intent(12, 3, 'replacement') })
    const result = await reviewed(f, payload)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(number(f, 'SELECT stock_quantity FROM products WHERE id=10'), 20)
    assert.equal(number(f, 'SELECT stock_quantity FROM products WHERE id=12'), 17)
    assert.equal(number(f, 'SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=1'), 20)
    assert.equal(number(f, 'SELECT quantity FROM branch_batch_stock WHERE batch_id=502 AND branch_id=1'), 17)
    assert.equal(number(f, 'SELECT SUM(units_moved) FROM sale_amendments'), 0)
    assert.equal(number(f, 'SELECT COUNT(*) FROM sale_amendments WHERE units_moved!=0'), 2)
    assert.equal(f.control.physicalBatches, 1)
  })

  await check('ledger failure rolls back stock, line, money and idempotency receipt', async () => {
    const f = await fixture(), payload = body(f, 'line_removed')
    const before = snapshot(f)
    f.raw.db.exec("CREATE TRIGGER fail_amendment BEFORE INSERT ON sale_amendments BEGIN SELECT RAISE(ABORT,'forced amendment ledger failure'); END")
    const result = await reviewed(f, payload)
    assert.ok(result.status >= 400, JSON.stringify(result.body))
    assert.equal(snapshot(f), before)
    f.raw.db.exec('DROP TRIGGER fail_amendment')
    assert.equal((await reviewed(f, payload)).status, 200)
    assert.equal(number(f, 'SELECT COUNT(*) FROM sale_mutation_receipts'), 1)
  })

  await check('lost batch acknowledgement reconciles the committed receipt once', async () => {
    const f = await fixture(), payload = body(f, 'line_removed')
    f.control.lostReply = true
    const result = await reviewed(f, payload)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const committed = snapshot(f)
    assert.deepEqual(await request(f, payload), result)
    assert.equal(snapshot(f), committed)
    assert.equal(number(f, 'SELECT stock_quantity FROM products WHERE id=10'), 20)
    assert.equal(number(f, 'SELECT COUNT(*) FROM sale_mutation_receipts'), 1)
  })

  for (const physical of [true, false]) await check(`maintenance race refuses ${physical ? 'stock' : 'price-only'} amendment atomically`, async () => {
    const f = await fixture()
    const payload = physical ? body(f, 'line_removed') : body(f, 'line_updated', { selling_price_input_usd: 11, pricing_quote: quote(3, 11) })
    const before = snapshot(f)
    f.control.beforeAmendment = () => f.raw.db.exec("INSERT OR IGNORE INTO system_flags(key,value) VALUES('maintenance','{}')")
    assert.ok((await reviewed(f, payload)).status >= 400)
    assert.equal(snapshot(f), before)
    assert.equal(f.control.physicalBatches, physical ? 1 : 0)
    assert.equal(f.control.ordinaryBatches, physical ? 0 : 1)
  })

  await check('price-only amendment keeps stock unchanged without a stock permit', async () => {
    const f = await fixture(), before = stock(f)
    const result = await reviewed(f, body(f, 'line_updated', { selling_price_input_usd: 11, pricing_quote: quote(3, 11) }))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(stock(f), before)
    assert.equal(f.control.physicalBatches, 0)
    assert.equal(f.control.ordinaryBatches, 1)
  })

  await check('stock-skipped historical sale amendment never moves physical stock', async () => {
    const f = await fixture()
    f.raw.db.prepare('UPDATE sales SET stock_skipped=1 WHERE id=?').run(f.saleId)
    const before = stock(f)
    assert.equal((await reviewed(f, body(f, 'line_removed'))).status, 200)
    assert.equal(stock(f), before)
    assert.equal(f.control.physicalBatches, 0)
  })

  await check('retired branch amendment requires confirmed redirect and preserves sale provenance', async () => {
    const f = await fixture(), payload = body(f, 'line_removed')
    seed(f.raw, () => {
      f.raw.db.exec('UPDATE branch_stock SET branch_id=2 WHERE branch_id=1')
      f.raw.db.exec('UPDATE branch_batch_stock SET branch_id=2 WHERE branch_id=1')
      f.raw.db.exec('UPDATE branches SET is_default=0,is_active=0,successor_branch_id=2 WHERE id=1')
      f.raw.db.exec('UPDATE branches SET is_default=1 WHERE id=2')
    })
    const before = snapshot(f)
    const refused = await request(f, payload)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'branch_redirect_required')
    assert.equal(snapshot(f), before)
    const result = await reviewed(f, payload, { 'x-branch-redirect': '2' })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(number(f, 'SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2'), 20)
    assert.equal(number(f, 'SELECT quantity FROM branch_batch_stock WHERE batch_id=500 AND branch_id=2'), 20)
    assert.equal(number(f, `SELECT branch_id FROM sales WHERE id=${f.saleId}`), 1)
    assert.equal(f.control.physicalBatches, 1)
    const committed = snapshot(f)
    assert.deepEqual(await request(f, payload, { 'x-branch-redirect': '2' }), result)
    assert.equal(snapshot(f), committed)
  })

  console.log(`${checks} amendment admission checks passed; ${failures} failed`)
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
