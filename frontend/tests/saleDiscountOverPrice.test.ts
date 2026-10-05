// A fixed discount larger than the price is refused, not silently capped to a $0 line (owner,
// 5 Oct 2026); same for a whole-sale discount over the subtotal. Frontend half of
// cloudflare/scripts/test-sale-discount-over-price-pure.cjs: the POS cart line, the sale-line edit
// preview, the basket totals, the pack text for the stable codes, and parity with the Worker's
// evaluator and historical kernel.
//
// Run: node tests/saleDiscountOverPrice.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyManualDiscount, posV1BasketTotals, quoteSaleCartLines } from '../src/components/pos/posCore.ts'
import { allocateReceiptLines, evaluateCapturedPricingPool, materializeCapturedPricingRow, SaleDiscountRefusedError, SaleItemPricingError, type CapturedPricingPool } from '../src/utils/saleItemPricing.ts'
import { planHistoricalSaleLine } from '../src/utils/historicalSalePricing.ts'
import { capturedSaleLineEdit } from '../src/utils/saleLineEditor.ts'
import { saleSubmitRefusalText } from '../src/api/saleSubmitErrors.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, relative), 'utf8').replace(/\r/g, '')
const EXCEEDS_PRICE = 'sale_discount_exceeds_price', EXCEEDS_SUBTOTAL = 'sale_discount_exceeds_subtotal'
const refusal = (code: string) => (error: unknown) => error instanceof SaleDiscountRefusedError && error instanceof SaleItemPricingError && error.code === code

// 1. POS cart line: both money versions refuse; equal to the price is allowed; percent is untouched.
for (const version of [0, 1] as const) {
  assert.throws(() => applyManualDiscount(10, 40000, 4000, 'fixed', 10.01, version), refusal(EXCEEDS_PRICE), `v${version}: a cent over the price`)
  assert.throws(() => applyManualDiscount(10, 40000, 4000, 'fixed', 100, version), refusal(EXCEEDS_PRICE), `v${version}: far over the price`)
  const edge = applyManualDiscount(10, 40000, 4000, 'fixed', 10, version)
  assert.equal(edge.applied_price_usd, 0, `v${version}: equal to the price is a free line`)
  assert.equal(edge.manual_discount_usd, 10)
  assert.equal(applyManualDiscount(10, 40000, 4000, 'fixed', 2.5, version).applied_price_usd, 7.5)
  assert.equal(applyManualDiscount(10, 40000, 4000, 'percent', 150, version).manual_discount_value, 100, `v${version}: percent keeps its existing 100 ceiling`)
  assert.equal(applyManualDiscount(10, 40000, 4000, 'fixed', 0, version).manual_discount_type, null, `v${version}: a zero value is no discount`)
}
// Lowering the price under a standing fixed discount goes through the same call, so it is refused too.
assert.throws(() => applyManualDiscount(4, 16000, 4000, 'fixed', 5, 1), refusal(EXCEEDS_PRICE))

// 2. The cart quote (new basket) refuses with the line named; the pool replays recorded sales unchanged.
const pool = (manual: { type: 'none' | 'fixed' | 'percent'; value: number }): CapturedPricingPool => ({ version: 1, pool_key: 'pool', evaluation_time: '2026-10-05T00:00:00.000Z', exchange_rate: 4000, rules: [],
  lines: [{ line_key: 'line-1', source: 'selling', product: { id: 7, selling_price_usd: 10, selling_price_khr: 1 }, selling_price_input_usd: null, manual }] })
const cart = (value: number) => [{ id: 7, cart_line_id: 'line-1', price_mode: 'selling', quantity: 2, selling_price_usd: 10, selling_price_khr: 40000, applied_price_usd: 10, applied_price_khr: 40000, manual_discount_type: 'fixed', manual_discount_value: value }]
assert.throws(() => quoteSaleCartLines(cart(10.01) as never, [], 4000), (error: unknown) => refusal(EXCEEDS_PRICE)(error) && (error as SaleDiscountRefusedError).lineKey === 'line-1')
assert.equal(quoteSaleCartLines(cart(10) as never, [], 4000).get('line-1')!.total_usd, 0)
assert.equal(evaluateCapturedPricingPool(pool({ type: 'fixed', value: 100 }), { 'line-1': 2 }).get('line-1')!.total_usd, 0, 'default replay still clamps: recorded sales keep reading')

// 3. Whole-sale discount over the subtotal.
const basket = (discountUsd: string) => posV1BasketTotals({ lines: [{ total_usd: 10 }, { total_usd: 5 }], exchangeRate: 4000, discountType: 'fixed', discountPercent: '', discountUsd, discountKhr: '', membershipUsd: '', membershipKhr: '', taxPercent: 0, feeUsd: '', customerPaysFee: false })
assert.throws(() => basket('15.0001'), refusal(EXCEEDS_SUBTOTAL))
assert.equal(basket('15').afterDiscUsd, 0, 'a discount equal to the subtotal is allowed')
assert.throws(() => allocateReceiptLines({ version: 1, lines: [{ line_key: 'a', amount: 10 }], discount_usd: 10.0001, membership_discount_usd: 0, tax_usd: 0 }), refusal(EXCEEDS_SUBTOTAL))

// 4. Sale-line edit preview (captured v1 sale): a changed price or discount is held to the rule; a
// quantity-only edit of a line recorded with an over-discount (replay clamp) is not.
const row = (manual: { type: 'none' | 'fixed' | 'percent'; value: number }) => materializeCapturedPricingRow({ id: 70, product_id: 7 }, pool(manual), { 'line-1': 2 }, 'line-1',
  { version: 1, lines: [{ line_key: 'line-1', amount: evaluateCapturedPricingPool(pool(manual), { 'line-1': 2 }).get('line-1')!.total_usd }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 })
const sale = (line: Record<string, unknown>) => ({ id: 17, money_precision_version: 1, items: [line], exchange_rate: 4000, subtotal_usd: line.total_usd, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 })
const plainLine = row({ type: 'none', value: 0 })
assert.throws(() => capturedSaleLineEdit([plainLine], sale(plainLine), 70, { quantity: 2, manual_discount_type: 'fixed', manual_discount_value: 10.01 }), refusal(EXCEEDS_PRICE))
assert.throws(() => capturedSaleLineEdit([plainLine], sale(plainLine), 70, { quantity: 2, selling_price_input_usd: 5, manual_discount_type: 'fixed', manual_discount_value: 5.01 }), refusal(EXCEEDS_PRICE))
assert.equal(capturedSaleLineEdit([plainLine], sale(plainLine), 70, { quantity: 2, manual_discount_type: 'fixed', manual_discount_value: 10 }).lineTotalUsd, 0, 'equal to the price is allowed')
const clampedLine = row({ type: 'fixed', value: 100 })
assert.equal(clampedLine.total_usd, 0)
assert.equal(capturedSaleLineEdit([clampedLine], sale(clampedLine), 70, { quantity: 3 }).lineTotalUsd, 0, 'quantity-only edit of an already-clamped recorded line still goes through')
assert.throws(() => capturedSaleLineEdit([clampedLine], sale(clampedLine), 70, { quantity: 3, manual_discount_value: 100 }), refusal(EXCEEDS_PRICE), 'but touching its discount puts it under the rule')

// 5. Legacy (pre-v1) recorded line edit.
const legacy = { id: 1, quantity: 3, applied_price_usd: 9, base_price_usd: 10, manual_discount_type: 'fixed', manual_discount_value: 1, manual_discount_usd: 1, pricing_snapshot_json: null, cost_price_usd: null, total_usd: 27, total_khr: 108000 }
assert.throws(() => planHistoricalSaleLine(legacy, { manual_discount_type: 'fixed', manual_discount_value: 11 }, 3, 4000), refusal(EXCEEDS_PRICE))
assert.equal(planHistoricalSaleLine(legacy, { manual_discount_value: 10 }, 3, 4000).row.total_usd, 0)

// 6. The codes restate from both language packs (the till never shows the Worker's English).
for (const pack of ['en', 'km']) {
  const lang = JSON.parse(read(`../src/lang/${pack}.json`)) as Record<string, string>
  for (const code of [EXCEEDS_PRICE, EXCEEDS_SUBTOTAL]) {
    assert.ok(lang[code]?.trim(), `${pack} pack carries ${code}`)
    assert.equal(saleSubmitRefusalText({ code }, key => lang[key]), lang[code], `${pack}: ${code} is restated from the pack`)
  }
}
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>, km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
for (const code of [EXCEEDS_PRICE, EXCEEDS_SUBTOTAL]) {
  assert.notEqual(km[code], en[code], `${code}: no English placeholder in km`)
  assert.match(km[code], /[ក-៿]/)
}

// 7. The POS shows the refusal instead of capturing it: a price or discount edit that is refused keeps the cart untouched.
const pos = read('../src/components/pos/POS.tsx')
assert.equal((pos.match(/catch \(error\) \{ refusal = error; return item \}/g) || []).length, 2, 'price edit and discount edit both keep the line and surface the refusal')
assert.equal((pos.match(/if \(refusal\) \{ notify\(pricingRefusalText\(refusal\), 'error'\); return \}/g) || []).length, 2)
assert.match(pos, /throw pricedCart\.error \?\? new Error\('money_precision_unavailable'\)/, 'the basket keeps the refusal code instead of flattening it')
assert.match(pos, /<div role="alert" className="text-red-600">\{pricingRefusalText\(v1Basket\.error\)\}<\/div>/)

// 8. Parity with the Worker: identical evaluator body and the same refusal in the historical kernel.
const worker = read('../../cloudflare/src/lib/saleItemPricing.ts'), front = read('../src/utils/saleItemPricing.ts')
const body = (source: string) => source.split('/** Guard the exact authorized SELECT * capture')[0].replace(/from '\.\/(moneyPrecision|promotionRules)(?:\.ts)?'/g, "from './$1'").trim()
assert.equal(body(front), body(worker), 'evaluator, refusal classes and receipt allocation are byte-identical')
const workerHistorical = read('../../cloudflare/src/lib/historicalSalePricing.ts').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"), frontHistorical = read('../src/utils/historicalSalePricing.ts')
assert.equal(frontHistorical, workerHistorical, 'historical kernel is identical apart from import suffixes')
const routes = read('../../cloudflare/src/routes/sales.ts')
assert.equal((routes.match(/refuseOversizedFixed:true/g) || []).length, 3, 'create, add-items and replacement refuse every new line')
assert.match(routes, /refuseOversizedFixed:discountOrPriceChanged\?new Set\(\[target\.line_key\]\):false/, 'line edit refuses only a changed price or discount')
assert.equal((routes.match(/error instanceof SaleDiscountRefusedError/g) || []).length, 2, 'add-items and amendments answer 400, not the 409 pricing-conflict status')

console.log('PASS fixed discount over the price and sale discount over the subtotal are refused everywhere, with stable codes and both language packs')
