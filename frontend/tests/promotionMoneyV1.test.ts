import assert from 'node:assert/strict'
import { evaluatePromotionPricing, evaluateCartPromotionAdjustments, normalizePromotionRule } from '../src/utils/promotionRules.ts'
import { multiplyMoney4, sumMoney4 } from '../src/utils/moneyPrecision.ts'
import { resolveCartPriceValues, repricePromotionCartLines } from '../src/components/pos/posCore.ts'

const now = new Date('2026-09-13T00:00:00Z')
const product = { id: 7, selling_price_usd: 1, selling_price_khr: 4000, discount_enabled: 1, discount_type: 'percent', discount_percent: 0.005 }
assert.equal(evaluatePromotionPricing(product, 1, [], 4000, now).unit_price_usd, 0.99, 'default historical ceil-discount unchanged')
assert.equal(evaluatePromotionPricing(product, 1, [], 4000, now, 1).unit_price_usd, 0.9999, 'half4 rounds once away from zero')
assert.equal(evaluatePromotionPricing({ ...product, discount_percent: 0.0049 }, 1, [], 4000, now, 1).unit_price_usd, 1)
assert.equal(evaluatePromotionPricing({ id: 7, selling_price_usd: 1.2345 }, 0.5, [], 4000, now, 1).line_total_usd, 0.62, 'fresh selling base ceiling and exact fractional quantity')
const rule = (fields: Record<string, unknown>) => normalizePromotionRule({ id: 1, is_active: 1, scope_type: 'products', product_ids: [7, 8], rule_type: 'percent_off', ...fields }, 1)!
assert.equal(rule({ save_usd: 0.0001 }).save_usd, 0.0001)
const plain = { id: 7, selling_price_usd: 1, selling_price_khr: 4000 }
const spread = evaluatePromotionPricing(plain, 3, [rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 1 })], 4000, now, 1)
assert.equal(spread.unit_price_usd, 0.6667)
assert.equal(multiplyMoney4(spread.unit_price_usd, 3), 2.0001, 'canonical sale line uses priced unit4 times quantity, not an invented override')
const mixed = evaluateCartPromotionAdjustments([
  { line_id: 'expensive', product: { ...plain, id: 8, selling_price_usd: 2 }, quantity: 1 },
  { line_id: 'cheap', product: plain, quantity: 1 },
], [rule({ rule_type: 'next_item', min_quantity: 1, percent_off: 12.3456 })], 4000, now, 1)
assert.equal(mixed.get('expensive')?.line_discount_usd, 0)
assert.equal(mixed.get('cheap')?.line_discount_usd, 0.1235)
assert.equal(mixed.get('cheap')?.unit_price_usd, 0.8765)
const lines = Array.from({ length: 100 }, (_, i) => ({ line_id: String(i), product, quantity: 1 }))
const hundred = evaluateCartPromotionAdjustments(lines, [], 4000, now, 1)
assert.equal(sumMoney4([...hundred.values()].map(line => line.unit_price_usd)), 99.99)
const initial = resolveCartPriceValues(product, 'promotion', 4000, {}, [], 1)
assert.equal(initial.base_price_usd, 0.9999)
const cart = [{ ...product, ...initial, cart_line_id: 'p7', quantity: 1, manual_discount_type: 'fixed', manual_discount_value: 0.1234 }]
const repriced = repricePromotionCartLines(cart, [], 4000, 1)
assert.equal(repriced.cart[0].applied_price_usd, 0.8765, 'promotion refresh preserves independent manual discount')
assert.equal(repricePromotionCartLines(repriced.cart, [], 4000, 1).changed, false, 'stable v1 cart does not create an effect loop')
assert.equal(resolveCartPriceValues({ selling_price_usd: 1.2345 }, 'selling', 4000, {}, [], 1).base_price_usd, 1.24)
for (const kind of ['percent_off', 'quantity_percent', 'fixed_off', 'quantity_save', 'spend_save', 'next_item']) {
  const benefit = rule({ rule_type: kind, percent_off: 12.3456, min_quantity: 1, min_spend_usd: 1, save_usd: 0.1234 })
  const result = evaluatePromotionPricing(plain, 4, [benefit], 4000, now, 1)
  assert.ok(result.unit_price_usd >= 0 && result.unit_price_usd <= 1, kind)
  assert.equal(Math.round(result.unit_price_usd * 10000), result.unit_price_usd * 10000, kind)
}
console.log('PASS opt-in promotion v1: exact percent, fractional quantities, cheapest pairing, 100 lines and v0 defaults')
