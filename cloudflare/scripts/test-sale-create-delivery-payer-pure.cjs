// M6a (SCAN1, 2026-09-28): sale create normalises delivery_fee_paid_by and
// refuses anything but the two real payers, with the PATCH's own message.
//
// POST /api/sales stored String(body.delivery_fee_paid_by || 'customer')
// verbatim. The engines then split on an off-enum value: v1 totals and returns
// test `=== 'customer'` (so " CUSTOMER " dropped the customer-paid fee from the
// total), every report tests `= 'store'` (so "Shop" counted as customer-billed
// revenue), and saleMutationHeaderQuote refused every later header-quoted edit
// of the sale. The delivery-fee amendment already trims, lower-cases and
// refuses; create now does the same.
//
// Real Hono route, fully migrated schema. Also proves the read-only detection
// query ops/queries/forensics-m6-delivery-payer-off-enum.sql.
//
// Run: node scripts/test-sale-create-delivery-payer-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const harnessFile = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const harnessSource = fs.readFileSync(harnessFile, 'utf8')
const boundary = harnessSource.indexOf(';(async () => {')
assert.ok(boundary > 0, 'test-sale-create-atomic-pure.cjs changed shape; update this harness import')
const harness = new Module(harnessFile, module)
harness.filename = harnessFile
harness.paths = module.paths
harness._compile(harnessSource.slice(0, boundary)
  + '\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,USER,setUser(value){currentUser=value}};', harnessFile)
const h = harness.exports

const PAYER_ERROR = 'Delivery fee must be paid by the customer or by the store.'

function saleBody(key, payer, isDelivery = true) {
  const body = { ...h.request(key), amount_paid_usd: 20 }
  if (isDelivery) Object.assign(body, { is_delivery: true, delivery_fee_usd: 2 })
  if (payer !== undefined) body.delivery_fee_paid_by = payer
  return body
}

function stored(f, key) {
  return f.raw.db.prepare('SELECT id, delivery_fee_paid_by, total_usd FROM sales WHERE client_request_id=?').get(key)
}

const detection = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'queries', 'forensics-m6-delivery-payer-off-enum.sql'), 'utf8')

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: JSON.stringify({ all: true }) })
  const f = h.fixture()

  await check('a case/space variant is normalised to the real payer, and the totals follow it', async () => {
    const store = await h.postSale(f.route, saleBody('m6-store', 'Store'))
    assert.equal(store.status, 200, JSON.stringify(store.body))
    assert.deepEqual({ ...stored(f, 'm6-store'), id: 0 }, { id: 0, delivery_fee_paid_by: 'store', total_usd: 9.5 })
    const customer = await h.postSale(f.route, saleBody('m6-customer', ' CUSTOMER '))
    assert.equal(customer.status, 200, JSON.stringify(customer.body))
    assert.deepEqual({ ...stored(f, 'm6-customer'), id: 0 }, { id: 0, delivery_fee_paid_by: 'customer', total_usd: 11.5 },
      'a customer-paid fee is part of the total')
  })

  await check('an off-enum payer is refused before any write, with the delivery-fee amendment message', async () => {
    for (const [key, payer, isDelivery] of [
      ['m6-shop', 'shop', true], ['m6-blank', '   ', true], ['m6-number', 5, true], ['m6-object', { who: 'store' }, true],
      ['m6-shop-pickup', 'shop', false],
    ]) {
      const before = h.creationState(f.raw)
      const refused = await h.postSale(f.route, saleBody(key, payer, isDelivery))
      assert.equal(refused.status, 400, `${JSON.stringify(payer)}: ${JSON.stringify(refused.body)}`)
      assert.equal(refused.body.error, PAYER_ERROR)
      assert.deepEqual(h.creationState(f.raw), before, `${JSON.stringify(payer)} wrote something`)
      assert.equal(stored(f, key), undefined)
    }
  })

  await check('an absent or empty payer still means the customer (existing callers keep working)', async () => {
    for (const [key, payer] of [['m6-absent', undefined], ['m6-empty', ''], ['m6-null', null]]) {
      const created = await h.postSale(f.route, saleBody(key, payer))
      assert.equal(created.status, 200, `${JSON.stringify(payer)}: ${JSON.stringify(created.body)}`)
      assert.equal(stored(f, key).delivery_fee_paid_by, 'customer')
    }
  })

  await check('the delivery-fee amendment refuses the same value with the same words (parity)', async () => {
    const saleId = stored(f, 'm6-customer').id
    const response = await h.app.request(`/${saleId}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'delivery_fee_changed', delivery_fee_usd: 3, delivery_fee_paid_by: 'shop', client_request_id: 'm6-amend-shop', money_precision_version: 1, expected_exchange_rate: 4000 }),
    }, { DB: f.route }, h.executionCtx)
    const body = await response.json()
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal(body.error, PAYER_ERROR)
  })

  await check('detection query flags stored off-enum payers only', () => {
    const raw = f.raw.db
    const add = (id, payer, isDelivery) => raw.prepare(`INSERT INTO sales (id, receipt_number, branch_id, sale_status, is_delivery, delivery_fee_usd, delivery_fee_paid_by, subtotal_usd, total_usd)
      VALUES (?, ?, 1, 'completed', ?, 2, ?, 10, 10)`).run(id, `R-M6-${id}`, isDelivery, payer)
    add(8101, 'Store', 1) // positive: case variant the old create stored verbatim
    add(8102, 'shop', 1) // positive: not a payer at all
    add(8103, ' customer', 0) // positive: whitespace variant on a pickup sale
    add(8104, 'store', 1) // negative
    add(8105, null, 0) // negative: NULL reads as the customer everywhere
    const rows = raw.prepare(detection).all()
    assert.deepEqual(rows.map((row) => row.sale_id).sort((a, b) => a - b), [8101, 8102, 8103])
    const variant = rows.find((row) => row.sale_id === 8101)
    assert.equal(variant.normalized_payer, 'store')
    assert.equal(rows.find((row) => row.sale_id === 8102).normalized_payer, null)
    assert.equal(variant.total_minus_base_usd, 0, 'the stored total already excludes the fee (store-paid shape)')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
