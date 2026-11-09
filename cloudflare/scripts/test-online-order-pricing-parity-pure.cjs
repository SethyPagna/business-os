// KHQR S2: an online order is priced exactly as the till prices the same basket. priceOrder() is compared with the sale pricing kernel
// and computeSaleTotals driven directly (the path POS takes), and with totals worked out by hand, over fixtures that include a
// promotion, a total that needs settlement rounding to the cent (down and up), a taxed shop, and a basket the cap refuses. Delivery never enters the amount.
//
// Run: node scripts/test-online-order-pricing-parity-pure.cjs
const assert = require('node:assert/strict')
const { loadTsLibGraph } = require('./harness/load_ts_lib.cjs')
const graph = loadTsLibGraph(['onlineOrders', 'saleItemPricing', 'saleTotals', 'promotionRules', 'planTier'])
const { onlineOrders: O, saleItemPricing: P, saleTotals: T, promotionRules: R } = graph

let passed = 0
function check(name, fn) { graph.planTier.__resetPlanTierCacheForTests(); fn(); passed += 1; console.log(`PASS ${name}`) }
const PAID = { PLAN_TIER: 'paid' }
const RATE = 4000
const NOW = new Date(Date.UTC(2026, 10, 9, 3, 0, 0))

const product = (id, price, over = {}) => ({
  id, selling_price_usd: price, selling_price_khr: price * RATE, wholesale_price_usd: price, discount_enabled: 0, discount_type: 'percent',
  discount_percent: 0, discount_amount_usd: 0, discount_amount_khr: 0, category: 'Skin', brand: 'Acme', ...over,
})
const PRODUCTS = new Map([
  [1, product(1, 7.99)], [2, product(2, 12.5)], [3, product(3, 0.01)], [4, product(4, 3.33)], [5, product(5, 19.99)],
  [6, product(6, 10, { discount_enabled: 1, discount_type: 'percent', discount_percent: 15 })],
])
const rule = (over) => R.normalizePromotionRule({
  id: 1, title: 'Test', rule_type: 'percent_off', scope_type: 'products', product_ids: [1], percent_off: 10, is_active: 1, ...over,
}, 1)

// The till's path, written out here and not shared with priceOrder: pool -> kernel -> computeSaleTotals.
function tillTotal(lines, rules, taxUsd = 0) {
  const pool = {
    version: 1, pool_key: 'till', evaluation_time: NOW.toISOString(), exchange_rate: RATE, rules: rules.filter((r) => r.is_active),
    lines: lines.map((l) => ({ line_key: `p${l.product_id}`, source: 'promotion', product: P.capturePricingProduct(PRODUCTS.get(l.product_id)), selling_price_input_usd: null, manual: { type: 'none', value: 0 } })),
  }
  const evaluated = P.evaluateCapturedPricingPool(pool, Object.fromEntries(lines.map((l) => [`p${l.product_id}`, l.quantity])))
  const subtotal = [...evaluated.values()].reduce((sum, a) => Math.round((sum + a.total_usd) * 10000) / 10000, 0)
  return T.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: subtotal, discountUsd: 0, membershipDiscountUsd: 0, taxUsd, isDelivery: false, deliveryFeeUsd: 0,
    deliveryFeePaidBy: 'customer', exchangeRate: RATE, rawAmountPaidUsd: undefined, rawAmountPaidKhr: undefined,
  }).totalUsd
}
const price = (lines, rules = [], taxUsd = 0) => O.priceOrder({ lines, products: PRODUCTS, rules, exchangeRate: RATE, now: NOW, taxUsd }, PAID)

const FIXTURES = [
  ['one line, whole price', [{ product_id: 2, quantity: 2 }], [], 25],
  ['several lines', [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 1 }, { product_id: 4, quantity: 2 }], [], 43.13],
  ['smallest price, large quantity', [{ product_id: 3, quantity: 99 }], [], 0.99],
  ['product discount on the row', [{ product_id: 6, quantity: 2 }], [], 17],
  ['percent promotion: 21.573 settles to the cent the till would ask', [{ product_id: 1, quantity: 3 }], [rule({})], 21.57],
  ['percent promotion that settles UP: 2.997 -> 3.00', [{ product_id: 4, quantity: 1 }], [rule({ id: 3, product_ids: [4] })], 3],
  ['promotion that does not apply to the line', [{ product_id: 2, quantity: 1 }], [rule({})], 12.5],
  ['inactive promotion is ignored', [{ product_id: 1, quantity: 3 }], [rule({ is_active: 0 })], 23.97],
  ['quantity_save promotion', [{ product_id: 5, quantity: 3 }], [rule({ id: 2, rule_type: 'quantity_save', product_ids: [5], min_quantity: 3, save_usd: 5, percent_off: 0 })], 54.97],
]

for (const [name, lines, rules, expected] of FIXTURES) {
  check(`parity: ${name} = ${expected}`, () => {
    const priced = price(lines, rules)
    assert.equal(priced.goodsTotalUsd, expected, 'worked out by hand')
    assert.equal(priced.goodsTotalUsd, tillTotal(lines, rules), 'equal to the till path')
    assert.ok(Number.isInteger(Math.round(priced.goodsTotalUsd * 100)) && Math.abs(priced.goodsTotalUsd * 100 - Math.round(priced.goodsTotalUsd * 100)) < 1e-9, 'whole cents')
    assert.equal(priced.goodsTotalKhr, Math.round(expected * RATE))
    assert.equal(priced.lines.length, lines.length)
    assert.equal(priced.pricingVersion, 1)
  })
}

check('a taxed shop: the tax the caller computes goes through the same kernel, so the QR equals the till total', () => {
  const lines = [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 1 }]
  const withTax = price(lines, [], 3.2)
  assert.equal(withTax.goodsTotalUsd, tillTotal(lines, [], 3.2))
  assert.equal(withTax.goodsTotalUsd, 39.67, '7.99 x 3 + 12.50 = 36.47, plus 3.20 tax')
})

check('delivery is never part of the amount: the order is goods only, whatever the address', () => {
  const lines = [{ product_id: 2, quantity: 2 }]
  assert.equal(price(lines).goodsTotalUsd, 25)
  const withFeeAtTill = T.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: 25, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: 0, isDelivery: true, deliveryFeeUsd: 3, deliveryFeePaidBy: 'customer',
    exchangeRate: RATE, rawAmountPaidUsd: 25, rawAmountPaidKhr: 0,
  })
  assert.equal(withFeeAtTill.totalUsd, 28, 'the fee joins the SALE at fulfilment')
  assert.equal(withFeeAtTill.totalUsd - price(lines).goodsTotalUsd, 3, 'so the sale is Not Paid for exactly the fee after the QR money is recorded')
})

check('POSITIVE CONTROL: the fixtures discriminate (a wrong implementation would not match them all)', () => {
  const lines = [{ product_id: 1, quantity: 3 }]
  const rules = [rule({})]
  const exact = price(lines, rules).goodsTotalUsd
  assert.equal(exact, 21.57)
  assert.notEqual(21.573, exact, 'the calculated total is not a payable amount; the settled one is')
  assert.notEqual(Math.ceil(21.573 * 100) / 100, exact, 'a flat ceiling would charge 21.58, a cent more than the till')
  assert.notEqual(price(lines, []).goodsTotalUsd, exact, 'the promotion changes the amount')
  assert.notEqual(price([{ product_id: 1, quantity: 3 }, { product_id: 1, quantity: 0 }].slice(0, 1), rules, 1).goodsTotalUsd, exact, 'tax changes it')
})

check('the cart rules guard pricing: too many lines, bad quantities and unknown products never reach the kernel', () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ product_id: i + 1, quantity: 1 }))
  assert.throws(() => price(many), /order_too_many_lines/)
  assert.throws(() => price([]), /order_lines_required/)
  assert.throws(() => price([{ product_id: 1, quantity: 100 }]), /order_invalid_line/)
  assert.throws(() => price([{ product_id: 99, quantity: 1 }]), /order_product_missing/)
  assert.throws(() => price([{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 1 }]), /order_duplicate_product/)
  graph.planTier.__resetPlanTierCacheForTests()
  assert.throws(() => O.priceOrder({ lines: Array.from({ length: 21 }, (_, i) => ({ product_id: 1 + (i % 5), quantity: 1 })), products: PRODUCTS, rules: [], exchangeRate: RATE, now: NOW }, { PLAN_TIER: 'free' }), /order_(too_many_lines|duplicate_product)/)
})

check('line results carry the unit price and total the till would print', () => {
  const priced = price([{ product_id: 1, quantity: 3 }], [rule({})])
  assert.deepEqual(priced.lines, [{ product_id: 1, quantity: 3, unit_price_usd: 7.191, line_total_usd: 21.573 }])
  assert.equal(priced.subtotalUsd, 21.573)
  assert.equal(priced.calculatedTotalUsd, 21.573)
  assert.equal(priced.roundingAdjustmentUsd, -0.003)
  assert.equal(priced.goodsTotalUsd, 21.57)
})

console.log(`\n${passed} checks passed`)
