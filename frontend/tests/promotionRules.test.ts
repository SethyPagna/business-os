import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  normalizePromotionRule,
  isRuleActive,
  ruleAppliesToProduct,
  evaluatePromotionPricing,
  promotionBadgeForProduct,
  isProductPromoted,
  partitionPromotedFirst,
  type PromotionRule,
} from '../src/utils/promotionRules.ts'
import { resolveCartPriceValues, repricePromotionCartLines } from '../src/components/pos/posCore.ts'
import { buildPromotionsFilterSection } from '../src/components/shared/PromotionsFilterOptions.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const here = dirname(fileURLToPath(import.meta.url))

// Overrides are RAW ROW fields (what normalizePromotionRule ingests --
// is_active as 0/1, product_ids as a JSON string), not the parsed shape.
function rule(overrides: Record<string, unknown> = {}): PromotionRule {
  const normalized = normalizePromotionRule({
    id: 1,
    title: 'Deal',
    show_title: 1,
    rule_type: 'percent_off',
    percent_off: 10,
    scope_type: 'products',
    product_ids: JSON.stringify([7]),
    is_active: 1,
    ...overrides,
  })
  assert.ok(normalized, 'test rule must normalize')
  return normalized
}

const product = { id: 7, name: 'Serum', category: 'Skincare', brand: 'Dior', selling_price_usd: 20, selling_price_khr: 82000 }

// ---------------------------------------------------------------------------
runTest('the two kernel copies are code-identical from the first export on (hand-sync drift guard)', () => {
  const marker = 'export type PromotionRuleType'
  const front = readFileSync(join(here, '..', 'src', 'utils', 'promotionRules.ts'), 'utf8').replace(/\r\n/g, '\n')
  const back = readFileSync(join(here, '..', '..', 'cloudflare', 'src', 'lib', 'promotionRules.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(front.slice(front.indexOf(marker)), back.slice(back.indexOf(marker)),
    'frontend/src/utils/promotionRules.ts and cloudflare/src/lib/promotionRules.ts must stay byte-identical after their headers -- POS charges and the portal advertises from the SAME math')
})

runTest('normalizePromotionRule parses ids, clamps percent, defaults bad colors', () => {
  const parsed = normalizePromotionRule({
    id: 3, rule_type: 'percent_off', percent_off: 150, scope_type: 'products',
    product_ids: '[1, 1, "2", -5, "x"]', badge_color: 'red', is_active: 1,
  })
  assert.ok(parsed)
  assert.deepEqual(parsed.product_ids, [1, 2])
  assert.equal(parsed.percent_off, 100)
  assert.equal(parsed.badge_color, '#e11d48')
})

runTest('isRuleActive: window, benefit and scope must all hold', () => {
  const now = new Date('2026-08-28T10:00:00Z')
  assert.equal(isRuleActive(rule(), now), true)
  assert.equal(isRuleActive(rule({ is_active: 0 }), now), false)
  assert.equal(isRuleActive(rule({ percent_off: 0 }), now), false)
  assert.equal(isRuleActive(rule({ product_ids: '[]' }), now), false)
  assert.equal(isRuleActive(rule({ starts_at: '2026-09-01' }), now), false, 'future start = inactive')
  assert.equal(isRuleActive(rule({ ends_at: '2026-08-27' }), now), false, 'past end = inactive')
  assert.equal(isRuleActive(rule({ rule_type: 'quantity_save', min_quantity: 0, save_usd: 5 }), now), false, 'quantity rule needs min_quantity >= 1')
  assert.equal(isRuleActive(rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5 }), now), true)
})

runTest('scope matching: ids, category (multi-value), brand', () => {
  assert.equal(ruleAppliesToProduct(rule(), product), true)
  assert.equal(ruleAppliesToProduct(rule({ product_ids: '[8]' }), product), false)
  assert.equal(ruleAppliesToProduct(rule({ scope_type: 'category', category: 'skincare', product_ids: '[]' }), product), true, 'case-insensitive category')
  assert.equal(ruleAppliesToProduct(
    rule({ scope_type: 'category', category: 'Gift Set', product_ids: '[]' }),
    { ...product, categories: 'Skincare||Gift Set' },
  ), true, 'multi-value categories column counts')
  assert.equal(ruleAppliesToProduct(rule({ scope_type: 'brand', brand: 'DIOR', product_ids: '[]' }), product), true)
})

runTest('percent rule prices exactly like the equivalent per-product discount', () => {
  const viaRule = evaluatePromotionPricing(product, 2, [rule({ percent_off: 25 })], 4100)
  const viaDiscount = evaluatePromotionPricing(
    { ...product, discount_enabled: 1, discount_type: 'percent', discount_percent: 25 }, 2, [], 4100)
  assert.equal(viaRule.unit_price_usd, viaDiscount.unit_price_usd)
  assert.equal(viaRule.line_total_usd, viaDiscount.line_total_usd)
  assert.equal(viaRule.unit_price_usd, 15)
})

runTest('quantity_save engages exactly at the threshold and spreads across units', () => {
  const quantityRule = rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, percent_off: 0 })
  const under = evaluatePromotionPricing(product, 2, [quantityRule], 4100)
  assert.equal(under.active, false, '2 < 3: no benefit yet')
  const at = evaluatePromotionPricing(product, 3, [quantityRule], 4100)
  assert.equal(at.active, true)
  assert.equal(at.line_discount_usd, 5)
  assert.equal(at.line_total_usd, 55, '3 x $20 - $5')
  assert.ok(Math.abs(at.unit_price_usd * 3 - at.line_total_usd) < 0.05, 'per-unit derives from the line total')
})

runTest('best single benefit wins -- never stacked', () => {
  const withBoth = evaluatePromotionPricing(
    { ...product, discount_enabled: 1, discount_type: 'percent', discount_percent: 10 },
    1,
    [rule({ percent_off: 30 })],
    4100,
  )
  assert.equal(withBoth.source, 'rule', 'the 30% rule beats the 10% product discount')
  assert.equal(withBoth.unit_price_usd, 14)
  const productWins = evaluatePromotionPricing(
    { ...product, discount_enabled: 1, discount_type: 'percent', discount_percent: 50 },
    1,
    [rule({ percent_off: 30 })],
    4100,
  )
  assert.equal(productWins.source, 'product_discount')
  assert.equal(productWins.unit_price_usd, 10)
})

runTest('fixed_off clamps at the selling price -- a line can never go negative', () => {
  const big = evaluatePromotionPricing(product, 1, [rule({ rule_type: 'fixed_off', save_usd: 999, percent_off: 0 })], 4100)
  assert.equal(big.unit_price_usd, 0)
  assert.equal(big.line_discount_usd, 20)
})

runTest('badge: price rules cut at qty 1, quantity rules advertise as hints', () => {
  const priceBadge = promotionBadgeForProduct(product, [rule({ percent_off: 20 })])
  assert.equal(priceBadge.kind, 'price')
  const hint = promotionBadgeForProduct(product, [rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, percent_off: 0 })])
  assert.equal(hint.kind, 'quantity_hint')
  assert.equal(hint.min_quantity, 3)
  assert.equal(isProductPromoted(product, [rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, percent_off: 0 })]), true,
    'a not-yet-earned quantity deal still counts as promoted (it must surface in the promoted-first block)')
})

runTest('partitionPromotedFirst is stable within both blocks', () => {
  const items = [
    { id: 1, name: 'A', selling_price_usd: 5 },
    { id: 7, name: 'B', selling_price_usd: 5 },
    { id: 3, name: 'C', selling_price_usd: 5 },
  ]
  const ordered = partitionPromotedFirst(items, [rule()])
  assert.deepEqual(ordered.map((p) => p.id), [7, 1, 3])
})

// ---------------------------------------------------------------------------
runTest('resolveCartPriceValues honors promotion mode even before a quantity threshold', () => {
  const quantityRule = rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, percent_off: 0 })
  const values = resolveCartPriceValues(product, 'promotion', 4100, {}, [quantityRule])
  assert.equal(values.price_mode, 'promotion', 'line stays in promotion mode so crossing the threshold can reprice it')
  assert.equal(values.applied_price_usd, 20, 'no benefit at qty 1 -> full price')
})

runTest('repricePromotionCartLines drops the price when quantity crosses the threshold and restores it when it falls back', () => {
  const quantityRule = rule({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 6, percent_off: 0 })
  const line = {
    ...product,
    price_mode: 'promotion',
    quantity: 3,
    applied_price_usd: 20, applied_price_khr: 82000,
    base_price_usd: 20, base_price_khr: 82000,
  }
  const { cart, changed } = repricePromotionCartLines([line], [quantityRule], 4100)
  assert.equal(changed, true)
  assert.equal(cart[0].applied_price_usd, 18, '(60 - 6) / 3')
  const back = repricePromotionCartLines([{ ...cart[0], quantity: 1 }], [quantityRule], 4100)
  assert.equal(back.changed, true)
  assert.equal(back.cart[0].applied_price_usd, 20, 'under the threshold the line returns to full price')
  const settled = repricePromotionCartLines(back.cart, [quantityRule], 4100)
  assert.equal(settled.changed, false, 'second pass settles (no render loop)')
})

runTest('repricePromotionCartLines never touches selling/special lines', () => {
  const line = { ...product, price_mode: 'selling', quantity: 5, applied_price_usd: 20 }
  const { changed } = repricePromotionCartLines([line], [rule({ percent_off: 50 })], 4100)
  assert.equal(changed, false)
})

// ---------------------------------------------------------------------------
runTest('promotions filter section: states, one-active-chip, rule entries', () => {
  let value = 'all'
  const section = buildPromotionsFilterSection({
    promoFilter: 'rule:9',
    setPromoFilter: (next) => { value = next },
    promotionOptions: [{ id: 9, title: 'Buy 3 Save $5' }],
  })
  assert.equal(section.active, true)
  assert.equal(section.summary, 'Buy 3 Save $5')
  const ruleOption = (section.options || []).flatMap((option) => (option ? [option] : [])).find((option) => option.id === 'rule-9')
  assert.ok(ruleOption?.active)
  ruleOption?.onClick?.()
  assert.equal(value, 'all', 'clicking the active rule clears back to all')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll promotionRules tests passed')
