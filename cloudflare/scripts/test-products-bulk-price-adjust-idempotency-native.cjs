// PROD-PERM follow-up (loophole review N6): POST /products/bulk-price-adjust is a RELATIVE change ("add 1.00 to every
// price"), so a retry after a lost response used to apply it a second time. The apply now carries a client request id;
// the receipt is the route's own audit row, claimed in the same D1 batch as the price writes. Real routes/products.ts
// against the full migration chain in SQLite. Each case asserts the prices themselves, not only the status, and the
// first case proves the fixture would catch a double apply (a different id applies again).
//
// Run (from cloudflare/): node scripts/test-products-bulk-price-adjust-idempotency-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const OTHER = { id: 8, username: 'admin2', name: 'Admin Two', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

let h = null
function fixture(user = ADMIN) {
  if (!h) h = createProductsRouteHarness({ user })
  h.setUser(user)
  h.raw.db.exec(`
    DELETE FROM audit_logs; DELETE FROM product_cost_entries; DELETE FROM products; DELETE FROM branches;
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, wholesale_price_usd, stock_quantity, is_active) VALUES
      (1, 'Gloss One', '8850000000011', 2, 5, 4, 0, 1),
      (2, 'Serum Other', '8850000000033', 4, 9, 7, 0, 1);
  `)
  return h
}
const sellingPrices = () => h.raw.prepare('SELECT selling_price_usd AS v FROM products ORDER BY id').all([]).map((row) => Number(row.v))
const receipts = () => h.raw.prepare("SELECT details, old_value, new_value FROM audit_logs WHERE entity = 'product' AND entity_id = 'bulk-price-adjust' ORDER BY id").all([])
const body = (extra = {}) => ({ direction: 'increase', amount: 1, fields: ['selling_price_usd'], client_request_id: 'adjust_req_aaaaaaaa', ...extra })

async function main() {
  await check('a different request id applies again (the fixture can see a double apply)', async () => {
    fixture()
    assert.equal((await h.request('POST', '/bulk-price-adjust', body())).status, 200)
    assert.equal((await h.request('POST', '/bulk-price-adjust', body({ client_request_id: 'adjust_req_bbbbbbbb' }))).status, 200)
    assert.deepEqual(sellingPrices(), [7, 11])
    assert.equal(receipts().length, 2)
  })

  await check('the same request id sent again applies ONCE and answers from the receipt', async () => {
    fixture()
    const first = await h.request('POST', '/bulk-price-adjust', body())
    assert.equal(first.status, 200, JSON.stringify(first.json))
    assert.equal(first.json.changed, 2)
    assert.deepEqual(sellingPrices(), [6, 10])
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retry = await h.request('POST', '/bulk-price-adjust', body())
      assert.equal(retry.status, 200, JSON.stringify(retry.json))
      assert.equal(retry.json.success, true)
      assert.equal(retry.json.replayed, true)
      assert.equal(retry.json.changed, 2, 'the replay reports the first run\'s count')
    }
    assert.deepEqual(sellingPrices(), [6, 10], 'three retries changed nothing')
    assert.equal(receipts().length, 1, 'one audit row, not one per attempt')
    const details = JSON.parse(receipts()[0].details)
    assert.equal(details.rowsTouched, 2)
    assert.equal(details.client_request_id, 'adjust_req_aaaaaaaa')
    assert.ok(receipts()[0].new_value, 'the catalog totals before and after are still recorded')
  })

  await check('two equal requests in flight together apply once', async () => {
    fixture()
    const [a, b] = await Promise.all([h.request('POST', '/bulk-price-adjust', body()), h.request('POST', '/bulk-price-adjust', body())])
    assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.json, b.json]))
    assert.deepEqual(sellingPrices(), [6, 10], 'the price moved once')
    assert.equal(receipts().length, 1)
    assert.equal([a.json, b.json].filter((json) => json.replayed === true).length, 1, 'exactly one of the two was answered as a replay')
  })

  await check('the in-batch claim alone stops the writes when the pre-read misses an equal request that already committed', async () => {
    fixture()
    assert.equal((await h.request('POST', '/bulk-price-adjust', body())).status, 200)
    assert.deepEqual(sellingPrices(), [6, 10])
    // Blind the route's pre-read once, as if the equal request committed after it looked. Only the batch guard is left.
    const realPrepare = h.db.prepare
    let blinded = 0
    h.db.prepare = (sql) => {
      const statement = realPrepare(sql)
      if (blinded === 0 && /SELECT details FROM audit_logs/.test(sql)) {
        blinded += 1
        return { ...statement, get: async () => null }
      }
      return statement
    }
    try {
      const raced = await h.request('POST', '/bulk-price-adjust', body())
      assert.equal(blinded, 1, 'the pre-read was blinded, so the batch really ran')
      assert.equal(raced.status, 200, JSON.stringify(raced.json))
      assert.equal(raced.json.replayed, true, 'answered from the winner\'s receipt')
    } finally {
      h.db.prepare = realPrepare
    }
    assert.deepEqual(sellingPrices(), [6, 10], 'the losing batch changed no price')
    assert.equal(receipts().length, 1, 'and left no second receipt')
  })

  await check('the same id with a different adjustment is refused, and changes nothing', async () => {
    fixture()
    assert.equal((await h.request('POST', '/bulk-price-adjust', body())).status, 200)
    const conflict = await h.request('POST', '/bulk-price-adjust', body({ amount: 5 }))
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.code, 'idempotency_conflict')
    const otherField = await h.request('POST', '/bulk-price-adjust', body({ fields: ['wholesale_price_usd'] }))
    assert.equal(otherField.status, 409)
    assert.deepEqual(sellingPrices(), [6, 10])
  })

  await check('an apply without a request id is refused before anything is written; a preview needs none', async () => {
    fixture()
    const missing = await h.request('POST', '/bulk-price-adjust', body({ client_request_id: undefined }))
    assert.equal(missing.status, 400)
    assert.equal(missing.json.code, 'client_request_id_required')
    const malformed = await h.request('POST', '/bulk-price-adjust', body({ client_request_id: 'x' }))
    assert.equal(malformed.status, 400)
    assert.deepEqual(sellingPrices(), [5, 9])
    assert.equal(receipts().length, 0)
    const preview = await h.request('POST', '/bulk-price-adjust', body({ client_request_id: undefined, preview: true }))
    assert.equal(preview.status, 200)
    assert.equal(preview.json.count, 2)
    assert.equal(receipts().length, 0, 'a preview leaves no receipt')
  })

  await check('request ids are per actor: another administrator reusing the id still applies', async () => {
    fixture()
    assert.equal((await h.request('POST', '/bulk-price-adjust', body())).status, 200)
    h.setUser(OTHER)
    const second = await h.request('POST', '/bulk-price-adjust', body())
    assert.equal(second.status, 200)
    assert.notEqual(second.json.replayed, true)
    assert.deepEqual(sellingPrices(), [7, 11])
  })

  await check('a cost adjustment records its cost entries once, however often it is retried', async () => {
    fixture()
    const cost = body({ fields: ['cost_price_usd'], client_request_id: 'adjust_req_cost0001' })
    assert.equal((await h.request('POST', '/bulk-price-adjust', cost)).status, 200)
    const entries = () => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM product_cost_entries').get([]).n)
    const afterFirst = entries()
    assert.equal(afterFirst, 2)
    assert.equal((await h.request('POST', '/bulk-price-adjust', cost)).json.replayed, true)
    assert.equal(entries(), afterFirst)
    assert.deepEqual(h.raw.prepare('SELECT cost_price_usd AS v FROM products ORDER BY id').all([]).map((row) => Number(row.v)), [3, 5])
  })

  if (failed) { console.log(`${failed} FAILED`); process.exit(1) }
  console.log('bulk price adjust idempotency OK')
}
main().catch((error) => { console.error(error); process.exit(1) })
