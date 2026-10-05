// A fixed discount larger than the price is refused, not silently capped to a $0 line (owner,
// 5 Oct 2026). Same for a whole-sale discount larger than the subtotal. The refusal carries a
// stable code the till restates from the language pack:
//   sale_discount_exceeds_price     a fixed line discount over the line's price
//   sale_discount_exceeds_subtotal  the sale discount over the subtotal
// Percent > 100 stays refused (generic sale_item_pricing_invalid, unchanged).
//
// Recorded sales must keep replaying: the evaluator still clamps unless a caller opts in, because
// parseSaleItemPricing / validateCapturedSaleBasket re-run saved snapshots through it.
//
// Run: node scripts/test-sale-discount-over-price-pure.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs'), source = fs.readFileSync(file, 'utf8'), boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const fixtureModule = new Module(file, module); fixtureModule.filename = file; fixtureModule.paths = module.paths
fixtureModule._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  .replace("fs.readFileSync(sourcePath, 'utf8')", "(fs.readFileSync(sourcePath, 'utf8')+(rel==='routes/sales.ts'?'\\nexport {capturePrecisionBasket};':''))")
  + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = fixtureModule.exports
const pricing = h.load('lib/saleItemPricing.ts'), historical = h.load('lib/historicalSalePricing.ts')
const EXCEEDS_PRICE = 'sale_discount_exceeds_price', EXCEEDS_SUBTOTAL = 'sale_discount_exceeds_subtotal'
const refusal = code => error => error instanceof pricing.SaleDiscountRefusedError && error instanceof pricing.SaleItemPricingError && error.code === code

// ---- 1. The evaluator ------------------------------------------------------------------------
const poolOf = (manual, rules = [], source = 'selling') => ({ version: 1, pool_key: 'p', evaluation_time: '2026-10-05T00:00:00.000Z', exchange_rate: 4000, rules,
  lines: [{ line_key: 'a', source, product: { id: 7, selling_price_usd: 10, selling_price_khr: 1 }, selling_price_input_usd: null, manual }] })
const total = (manual, qty, options) => pricing.evaluateCapturedPricingPool(poolOf(manual), { a: qty }, options).get('a').total_usd
assert.throws(() => total({ type: 'fixed', value: 10.0001 }, 1, { refuseOversizedFixed: true }), refusal(EXCEEDS_PRICE), 'a cent over the price is refused')
assert.throws(() => total({ type: 'fixed', value: 100 }, 3, { refuseOversizedFixed: true }), refusal(EXCEEDS_PRICE))
assert.equal(total({ type: 'fixed', value: 10 }, 1, { refuseOversizedFixed: true }), 0, 'a discount equal to the price is a free line, not an error')
assert.equal(total({ type: 'fixed', value: 9.9999 }, 2, { refuseOversizedFixed: true }), 0.0002)
// The replay default is unchanged: recorded snapshots saved before the rule still evaluate.
assert.equal(total({ type: 'fixed', value: 100 }, 3), 0, 'default replay clamps to a $0 line, as recorded sales were saved')
assert.equal(total({ type: 'fixed', value: 100 }, 3, { refuseOversizedFixed: false }), 0)
// Only the named lines are held to it.
assert.equal(total({ type: 'fixed', value: 100 }, 1, { refuseOversizedFixed: new Set(['other']) }), 0)
assert.throws(() => total({ type: 'fixed', value: 100 }, 1, { refuseOversizedFixed: new Set(['a']) }), refusal(EXCEEDS_PRICE))
// "The price" is the line after any promotion: 3 x $10 with a $1 quantity_save leaves $29.
const rule = { id: 1, rule_type: 'quantity_save', scope_type: 'products', product_ids: [7], is_active: true, min_quantity: 3, save_usd: 1, save_khr: 0, min_spend_usd: 0, min_spend_khr: 0, percent_off: 0, title: 'x' }
const promo = manual => () => pricing.evaluateCapturedPricingPool(poolOf(manual, [rule], 'promotion'), { a: 3 }, { refuseOversizedFixed: true }).get('a')
assert.equal(promo({ type: 'fixed', value: 9.6666 })().total_usd, 0.0002)
assert.throws(promo({ type: 'fixed', value: 9.6667 }), refusal(EXCEEDS_PRICE), 'over the promoted price is over the price')
// Percent over 100 stays the generic refusal, and a normal percent is untouched.
assert.throws(() => total({ type: 'percent', value: 100.0001 }, 1, { refuseOversizedFixed: true }), error => error instanceof pricing.SaleItemPricingError && error.code === 'sale_item_pricing_invalid')
assert.equal(total({ type: 'percent', value: 100 }, 1, { refuseOversizedFixed: true }), 0)
assert.equal(total({ type: 'fixed', value: 2.5 }, 4, { refuseOversizedFixed: true }), 30)

// ---- 2. The whole-sale discount ----------------------------------------------------------------
const ctx = discount => ({ version: 1, lines: [{ line_key: 'a', amount: 10 }, { line_key: 'b', amount: 5 }], discount_usd: discount, membership_discount_usd: 0, tax_usd: 0 })
assert.equal(pricing.allocateReceiptLines(ctx(15)).get('a').discount_usd, 10, 'a discount equal to the subtotal is allowed')
assert.throws(() => pricing.allocateReceiptLines(ctx(15.0001)), refusal(EXCEEDS_SUBTOTAL))
const snapshotPool = poolOf({ type: 'none', value: 0 })
assert.throws(() => pricing.serializeSaleItemPricing(snapshotPool, { a: 1 }, 'a', { version: 1, lines: [{ line_key: 'a', amount: 10 }], discount_usd: 11, membership_discount_usd: 0, tax_usd: 0 }), refusal(EXCEEDS_SUBTOTAL))

// ---- 3. A recorded legacy line edit -----------------------------------------------------------
const legacy = { id: 1, quantity: 3, applied_price_usd: 9, base_price_usd: 10, manual_discount_type: 'fixed', manual_discount_value: 1, manual_discount_usd: 1, pricing_snapshot_json: null, cost_price_usd: null, total_usd: 27, total_khr: 108000 }
assert.throws(() => historical.planHistoricalSaleLine(legacy, { manual_discount_type: 'fixed', manual_discount_value: 11 }, 3, 4000), refusal(EXCEEDS_PRICE))
assert.throws(() => historical.planHistoricalSaleLine(legacy, { selling_price_input_usd: 0.5 }, 3, 4000), refusal(EXCEEDS_PRICE), 'lowering the price below the standing discount is refused too')
assert.equal(historical.planHistoricalSaleLine(legacy, { manual_discount_value: 10 }, 3, 4000).row.total_usd, 0, 'equal to the price is allowed')
assert.equal(historical.planHistoricalSaleLine({ ...legacy, manual_discount_value: 50, manual_discount_usd: 10, applied_price_usd: 0, total_usd: 0 }, {}, 2, 4000).row.total_usd, 0, 'a quantity-only edit of an already-clamped recorded line still goes through')

// ---- 4. The routes ----------------------------------------------------------------------------
const manualLine = (key, value, extra = {}) => ({ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'manual', selling_price_input_usd: 21,
  manual_discount_type: 'fixed', manual_discount_value: value, ...extra,
  pricing_quote: { gross_usd: 21, product_discount_usd: 0, manual_discount_usd: Math.min(value, 21), total_usd: Math.max(0, 21 - value), total_khr: Math.max(0, 21 - value) * 4000 } })
const plain = key => ({ product_id: 10, quantity: 1, branch_id: 1, batch_id: 500, client_line_key: key, pricing_source: 'selling', pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } })
const counts = raw => ({ sales: raw.prepare('SELECT COUNT(*) n FROM sales').get().n, items: raw.prepare('SELECT COUNT(*) n FROM sale_items').get().n })
;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  {
    const f = h.fixture()
    // The quote below is the clamped one the old server happily accepted, so only the refusal can stop it.
    const over = await h.postSale(f.route, { ...h.request('over-price'), items: [manualLine('over', 30)], amount_paid_usd: 0 })
    assert.equal(over.status, 400, JSON.stringify(over.body)); assert.equal(over.body.code, EXCEEDS_PRICE)
    assert.match(over.body.error, /cannot be larger than the item price/)
    assert.deepEqual(counts(f.raw), { sales: 0, items: 0 }, 'nothing recorded')
    const edge = await h.postSale(f.route, { ...h.request('edge-price'), items: [manualLine('edge', 21)], amount_paid_usd: 0 })
    assert.equal(edge.status, 200, JSON.stringify(edge.body)); assert.equal(f.raw.prepare('SELECT total_usd FROM sale_items').get().total_usd, 0)
    console.log('PASS POST /sales refuses a fixed line discount over the price (400 + code) and still takes one equal to it')
  }
  {
    const f = h.fixture()
    const over = await h.postSale(f.route, { ...h.request('over-subtotal'), discount_usd: 9.51 })
    assert.equal(over.status, 400, JSON.stringify(over.body)); assert.equal(over.body.code, EXCEEDS_SUBTOTAL)
    assert.deepEqual(counts(f.raw), { sales: 0, items: 0 })
    const edge = await h.postSale(f.route, { ...h.request('edge-subtotal'), discount_usd: 9.5, amount_paid_usd: 0 })
    assert.equal(edge.status, 200, JSON.stringify(edge.body))
    console.log('PASS POST /sales refuses a sale discount over the subtotal with its own code')
  }
  {
    const f = h.fixture()
    const created = await h.postSale(f.route, { ...h.request('base-sale'), items: [plain('base')] })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = created.body.sale.id, before = counts(f.raw)
    const send = async (route, payload) => { const r = await h.app.request(`/${id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ money_precision_version: 1, expected_exchange_rate: 4000, ...payload }) }, { DB: f.route }, h.executionCtx); return { status: r.status, body: await r.json() } }
    const lineId = f.raw.prepare('SELECT id FROM sale_items WHERE sale_id=?').get([id]).id
    const added = await send('items', { client_request_id: 'add-over', items: [manualLine('added-over', 30)] })
    assert.equal(added.status, 400, JSON.stringify(added.body)); assert.equal(added.body.code, EXCEEDS_PRICE)
    const replaced = await send('amendments', { client_request_id: 'replace-over', kind: 'line_replaced', sale_item_id: lineId, replacement: manualLine('replacement-over', 30) })
    assert.equal(replaced.status, 400, JSON.stringify(replaced.body)); assert.equal(replaced.body.code, EXCEEDS_PRICE)
    const edited = await send('amendments', { client_request_id: 'edit-over', kind: 'line_updated', sale_item_id: lineId, quantity: 1, selling_price_input_usd: 21, manual_discount_type: 'fixed', manual_discount_value: 30,
      pricing_quote: { gross_usd: 21, product_discount_usd: 0, manual_discount_usd: 21, total_usd: 0, total_khr: 0 } })
    assert.equal(edited.status, 400, JSON.stringify(edited.body)); assert.equal(edited.body.code, EXCEEDS_PRICE)
    assert.deepEqual(counts(f.raw), before, 'no line was added, replaced or changed')
    console.log('PASS add-items, line replacement and line edit refuse a fixed discount over the price (400 + code)')
  }
})().catch(error => { console.error(error); process.exit(1) })
