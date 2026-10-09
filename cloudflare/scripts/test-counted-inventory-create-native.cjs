const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const { state } = require('./test-counted-add-budget-native.cjs')

const body = { productId: 1, branchId: 1, type: 'add', quantity: 0.2, batchId: 'new',
  supplierName: 'Fixture supplier', unitCostUsd: 3, receivedDate: '2026-10-09', paymentStatus: 'paid',
  unlockPricing: true, pricing: { barcode: '22222', cost_usd: 7, selling_price_usd: 9, wholesale_price_usd: 7 },
  reason: 'Sibling intake', client_request_id: 'sibling-intake-authority' }
const rivalProduct = barcode => `INSERT INTO products(id,name,barcode,is_active,stock_quantity)VALUES(900,'Fixture identity','${barcode}',1,0)`
const mutations = {
  actor: 'UPDATE users SET is_active=0 WHERE id=7',
  role: "UPDATE roles SET permissions='{}' WHERE id=(SELECT role_id FROM users WHERE id=7)",
  source: "UPDATE products SET name='Rival name',barcode='33333' WHERE id=1",
  price: 'UPDATE products SET selling_price_usd=12 WHERE id=1',
  identity: rivalProduct('022222'),
  wildcard: rivalProduct('broken'),
}
function catalog(f) { return f.sql.prepare('SELECT * FROM products ORDER BY id').all() }
function compete(f, sql) {
  f.sql.exec("INSERT INTO system_flags(key,value)VALUES('stock_transaction_permit','counted-tagged-subset-v1')")
  try { f.sql.exec(sql) } finally { f.sql.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'") }
}

async function probe(make, tier, kind) {
  const f = await h.world(make, tier, 'zero', sql => {
    h.seed(0.1, true)(sql)
    sql.exec("UPDATE products SET name='Fixture identity',barcode='11111',selling_price_usd=8,wholesale_price_usd=6 WHERE id=1")
    if (kind === 'existing') sql.exec(rivalProduct('22222'))
  })
  const request = kind === 'equivalent' ? { ...body, pricing: { ...body.pricing, barcode: '011111' } } : body
  const raw = f.env.DB
  let inserted = 0, injected = false, rival, rivalCatalog
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'batch') return async statements => {
      const creates = statements.some(row => /INSERT INTO products\s*\(/.test(row.text))
      if (creates) {
        inserted++
        if (!injected && mutations[kind]) {
          injected = true; compete(f, mutations[kind]); rival = state(f); rivalCatalog = catalog(f)
        }
      }
      const result = await target.batch(statements)
      if (creates && !injected && ['ack', 'after-actor', 'after-source'].includes(kind)) {
        injected = true
        if (kind === 'ack') throw new Error('D1_ERROR: network reset after catalog commit')
        compete(f, mutations[kind.slice(6)]); rival = state(f); rivalCatalog = catalog(f)
      }
      return result
    }
    return target[key]
  } })
  try {
    if (kind === 'physical-failure') f.sql.exec("CREATE TEMP TRIGGER create_intake_fail BEFORE INSERT ON branch_batch_stock BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: unrelated_catalog_intake'); END")
    const result = await f.call('/inventory/adjust', request)
    console.log('CATALOG_RESULT ' + JSON.stringify({ tier, kind, inserted, status: result.status, code: result.json.code, products: catalog(f).length }))
    if (mutations[kind] || kind.startsWith('after-')) {
      assert.equal(result.status, 409, JSON.stringify(result.json))
      assert.equal(result.json.code, 'counted_quantity_conflict')
      assert.deepEqual(state(f), rival, 'rival is the only stock/history change')
      assert.deepEqual(catalog(f), rivalCatalog, 'pre-insert authority refusal creates no catalog row; post-insert retains only its documented zero-stock row')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n, 0)
      assert.equal(inserted, 1)
    } else if (kind === 'ack' || kind === 'physical-failure') {
      assert.equal(result.status, kind === 'ack' ? 503 : 400, JSON.stringify(result.json))
      if (kind === 'ack') assert.equal(result.json.code, 'stock_transaction_outcome_unknown')
      assert.equal(inserted, 1, 'unknown catalog acknowledgement never blindly dispatches creation again')
      assert.equal(catalog(f).length, 2)
      assert.equal(catalog(f)[1].stock_quantity, 0)
      assert.equal(f.state().movements.length, 0)
      if (kind === 'physical-failure') f.sql.exec('DROP TRIGGER create_intake_fail')
      const retry = await f.call('/inventory/adjust', request)
      assert.equal(retry.status, 200, JSON.stringify(retry.json))
      assert.equal(retry.json.createdSibling, false)
      assert.equal(inserted, 1)
      assert.equal(catalog(f).length, 2)
      assert.equal(catalog(f)[1].stock_quantity, 0.2)
      const saved = state(f), products = catalog(f)
      assert.equal((await f.call('/inventory/adjust', request)).status, 200)
      assert.deepEqual(state(f), saved)
      assert.deepEqual(catalog(f), products)
    } else {
      assert.equal(result.status, 200, JSON.stringify(result.json))
      assert.equal(inserted, kind === 'new' ? 1 : 0)
      assert.equal(result.json.createdSibling, kind === 'new')
      assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=?').get(result.json.productId).stock_quantity, kind === 'equivalent' ? 0.3 : 0.2)
      assert.equal(f.state().movements.length, 1)
      const saved = state(f), products = catalog(f)
      assert.equal((await f.call('/inventory/adjust', request)).status, 200)
      assert.deepEqual(state(f), saved)
      assert.deepEqual(catalog(f), products)
    }
    console.log(`PASS ${tier}/${kind} catalog authority and once-only creation`)
  } finally { f.sql.close() }
}
async function main() {
  const make = await h.bundle.exports.bundleWorker()
  let failures = 0
  for (const tier of ['free', 'paid']) for (const kind of ['new', 'existing', 'equivalent', ...Object.keys(mutations), 'ack', 'after-actor', 'after-source', 'physical-failure']) {
    try { await probe(make, tier, kind) }
    catch (error) { failures++; console.error(`FAIL ${tier}/${kind}`, error) }
  }
  assert.equal(failures, 0)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
