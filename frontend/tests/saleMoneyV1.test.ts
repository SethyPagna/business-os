import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { saleLineEditorResult } from '../src/utils/saleLineEditor.ts'
import { applyManualDiscount } from '../src/components/pos/posCore.ts'
import { receiptTotalsFigures, receiptTotalsFootingErrorUsd } from '../src/utils/receiptTotals.ts'
import { deliveryAmountChanged, parseDeliveryAmountUsd } from '../src/utils/deliveryAmounts.ts'
import { settlementRounding4 } from '../src/utils/moneyPrecision.ts'
import { canonicalSaleReceipt, saleMoneyResponseFields, SaleMoneyUnavailableError, frozenSaleCheckoutBody, SaleCheckoutRecoveryRequiredError } from '../src/utils/saleMoneyV1.ts'

const line = { quantity: 100, basePriceUsd: 1.2345, manualDiscountType: 'percent', manualDiscountValue: 12.3456, productDiscountUsd: 0.0001 }
const legacy = saleLineEditorResult(line)
assert.equal(legacy.ok && legacy.basePriceUsd, 1.23)
const version1 = saleLineEditorResult({ ...line, moneyPrecisionVersion: 1 })
assert.equal(version1.ok && version1.basePriceUsd, 1.2345, 'derived promotion base is never re-ceiled')
assert.equal(version1.ok && version1.manualDiscountValue, 12.3456)
assert.equal(version1.ok && version1.manualDiscountUsd, 0.1524)
assert.equal(version1.ok && version1.lineTotalUsd, 108.21)
const typed = saleLineEditorResult({ ...line, moneyPrecisionVersion: 1, sellingPriceInputUsd: '1.2345' })
assert.equal(typed.ok && typed.basePriceUsd, 1.24)
assert.equal(saleLineEditorResult({ ...line, moneyPrecisionVersion: 1, sellingPriceInputUsd: 'invalid' }).ok, false)
assert.equal(saleLineEditorResult({ ...line, moneyPrecisionVersion: 1, sellingPriceInputUsd: '1.2345', manualDiscountType: 'fixed', manualDiscountValue: 1.235 }).ok, true)
assert.equal(applyManualDiscount(0.0001, 0.4, 4000, 'percent', 49.99, 1).manual_discount_usd, 0)
assert.equal(applyManualDiscount(0.0001, 0.4, 4000, 'percent', 50, 1).manual_discount_usd, 0.0001)
assert.deepEqual(parseDeliveryAmountUsd('1.2345', 1), { ok: true, usd: 1.2345 })
assert.deepEqual(parseDeliveryAmountUsd('0x10', 1), { ok: false, code: 'not_a_number' })
assert.deepEqual(parseDeliveryAmountUsd('1e-25', 1), { ok: false, code: 'not_a_number' })
assert.equal(deliveryAmountChanged(1.23456, 1.2346, 1), true, 'explicit edit compares exact historical before value')
assert.equal(deliveryAmountChanged(1.2301, 1.2349, 1), true)
assert.equal(deliveryAmountChanged(1.2301, 1.2349), false, 'legacy no-op semantics preserved')
for (const raw of [1.2345, 1.235]) {
  const rounding = settlementRounding4(raw)
  const totals = receiptTotalsFigures({ money_precision_version: 1, subtotal_usd: raw, calculated_total_usd: raw, rounding_adjustment_usd: rounding.roundingAdjustment4, total_usd: rounding.payableTotal2, amount_paid_usd: rounding.payableTotal2 })
  assert.equal(totals.totalUsd, rounding.payableTotal2)
  assert.equal(totals.calculatedTotalUsd, raw)
  assert.equal(totals.outstandingUsd, 0)
  assert.equal(receiptTotalsFootingErrorUsd(totals), 0)
}
const oldReceipt = receiptTotalsFigures({ total_usd: 1.2345, subtotal_usd: 1.2345 })
assert.equal(oldReceipt.totalUsd, 1.2345)
assert.equal(oldReceipt.calculatedTotalUsd, null)
assert.equal(oldReceipt.roundingAdjustmentUsd, 0)
const saved = { id: 17, subtotal_usd: 1.2345, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, exchange_rate: 4000, amount_paid_usd: 1.23, amount_paid_khr: 0, items: [{ quantity: 1, applied_price_usd: 1.2345, total_usd: 1.2345 }], money_precision_version: 1, calculated_total_usd: 1.2345, rounding_adjustment_usd: -0.0045, total_usd: 1.23, subtotal_khr: 4938, discount_khr: 0, membership_discount_khr: 0, tax_khr: 0, total_khr: 4920, delivery_fee_usd: 0, delivery_fee_khr: 0, change_usd: 0, change_khr: 0 }
assert.deepEqual(canonicalSaleReceipt({ id: 17, sale: saved }), saved, 'create envelope prints authoritative saved snapshot only')
assert.deepEqual(saleMoneyResponseFields({ totalUsd: 1.23, total_usd: undefined, calculatedTotalUsd: 1.2345 }), { total_usd: 1.23, calculated_total_usd: 1.2345 })
assert.deepEqual(saleMoneyResponseFields({ totalUsd: undefined }), {}, 'partial response cannot erase saved amounts')
assert.throws(() => canonicalSaleReceipt({ id: 17, receiptNumber: 'R17' }), SaleMoneyUnavailableError, 'id alone cannot become a locally reconstructed receipt')
assert.throws(() => canonicalSaleReceipt({ ...saved, rounding_adjustment_usd: 0 }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...saved, calculated_total_usd: null }), SaleMoneyUnavailableError)
assert.equal(canonicalSaleReceipt({ ...saved, total_usd: 1.2345, money_precision_version: 0, calculated_total_usd: null, rounding_adjustment_usd: 0 }).total_usd, 1.2345, 'legacy saved amounts are not requantized')
assert.equal(canonicalSaleReceipt({ ...saved, money_precision_version: 0, calculated_total_usd: null, rounding_adjustment_usd: 0 }).calculated_total_usd, null)
const original = { client_request_id: 'request-1', money_precision_version: 1, items: [{ quantity: 1, applied_price_usd: 1.2345 }], subtotal_usd: 1.2345, total_usd: 1.23, amount_paid_usd: 1.23, amount_paid_khr: 0, exchange_rate: 4000, sale_status: 'completed' }
const frozen = frozenSaleCheckoutBody('request-1', undefined, () => original)
original.items[0].applied_price_usd = 20
assert.equal((frozen.items as any[])[0].applied_price_usd, 1.2345)
assert.equal(JSON.stringify(frozenSaleCheckoutBody('request-1', frozen, () => { throw new Error('must not rebuild retry') })), JSON.stringify(frozen))
const oldBody = { ...original, client_request_id: 'legacy', money_precision_version: undefined, total_usd: 1.234567 }
assert.equal(JSON.stringify(frozenSaleCheckoutBody('legacy', oldBody)), JSON.stringify(oldBody), 'legacy exact retry remains unversioned and unrecalculated')
assert.throws(() => frozenSaleCheckoutBody('id-only', undefined), SaleCheckoutRecoveryRequiredError, 'old pending id without original body requires read-only recovery')
assert.throws(() => frozenSaleCheckoutBody('wrong-id', frozen), SaleCheckoutRecoveryRequiredError)
assert.throws(() => frozenSaleCheckoutBody('new', undefined, () => ({ client_request_id: 'new' })), SaleCheckoutRecoveryRequiredError)
assert.throws(() => frozenSaleCheckoutBody('legacy', { client_request_id: 'legacy' }), SaleCheckoutRecoveryRequiredError)
for (const change of [
  { subtotal_usd: 999 }, { exchange_rate: 0 }, { total_usd: '' },
  { items: [] }, { items: [null] }, { items: [{ quantity: -1, applied_price_usd: 1.2345, total_usd: 1.2345 }] },
  { items: [{ quantity: 1, applied_price_usd: 'bad', total_usd: 1.2345 }] },
  { items: [{ quantity: 1, applied_price_usd: 999, total_usd: 1.2345 }] },
]) assert.throws(() => canonicalSaleReceipt({ ...saved, ...change }), SaleMoneyUnavailableError)
const detached = canonicalSaleReceipt(saved)
assert.notEqual(detached.items, saved.items)
assert.notEqual((detached.items as unknown[])[0], saved.items[0])
const delivered = { ...saved, subtotal_usd: 1, subtotal_khr: 4000, total_usd: 2, total_khr: 8000, calculated_total_usd: 2, rounding_adjustment_usd: 0, amount_paid_usd: 2, is_delivery: 1, delivery_fee_paid_by: 'customer', delivery_fee_usd: 1, delivery_fee_khr: 4000, items: [{ quantity: 1, applied_price_usd: 1, total_usd: 1 }] }
const camelDelivered = Object.fromEntries(Object.entries(delivered).map(([key, value]) => [key.replace(/_([a-z])/g, (_match, char) => char.toUpperCase()), value]))
const fromSnake = canonicalSaleReceipt(delivered), fromCamel = canonicalSaleReceipt(camelDelivered)
for (const key of Object.keys(delivered)) assert.deepEqual(fromCamel[key], fromSnake[key], `equivalent canonical delivery alias: ${key}`)
assert.throws(() => canonicalSaleReceipt({ ...delivered, delivery_fee_khr: 999 }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...camelDelivered, deliveryFeeKhr: 999 }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...delivered, is_delivery: '0' }), SaleMoneyUnavailableError)
const storePaid = { ...delivered, delivery_fee_paid_by: 'store', total_usd: 1, total_khr: 4000, calculated_total_usd: 1, amount_paid_usd: 1 }
assert.equal(canonicalSaleReceipt(storePaid).total_usd, 1, 'store-paid fee does not enter customer footing')
assert.throws(() => canonicalSaleReceipt({ ...saved, change_usd: 999 }), SaleMoneyUnavailableError, 'unmarked nonzero change lacks durable intent')
assert.throws(() => canonicalSaleReceipt({ ...saved, change_is_actual: 0, change_usd: 999 }), SaleMoneyUnavailableError, 'computed USD change must match current saved tender')
const computed = { ...saved, amount_paid_usd: 2.23, change_usd: 1, change_khr: 4100, change_is_actual: 0, change_exchange_rate: null }
assert.equal(canonicalSaleReceipt(computed).change_khr, 4100, 'computed change may use a distinct rate that was not captured; never substitute sale rate4000')
assert.equal(canonicalSaleReceipt({ ...computed, change_exchange_rate: 4100 }).change_khr, 4100)
assert.throws(() => canonicalSaleReceipt({ ...computed, change_exchange_rate: 4000 }), SaleMoneyUnavailableError, 'captured computed change rate proves KHR independently')
for (const invalidRate of [0, -1, '', '4100', NaN]) assert.throws(() => canonicalSaleReceipt({ ...computed, change_exchange_rate: invalidRate }), SaleMoneyUnavailableError)
// Execute the actual native backend helper, not a copied denomination formula.
const nativeModule = { exports: {} as Record<string, (...args: any[]) => any> }
const nativeCode = buildSync({ entryPoints: [fileURLToPath(new URL('../../cloudflare/src/lib/saleTotals.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
new Function('module', 'exports', nativeCode)(nativeModule, nativeModule.exports)
const nativeBoundary = nativeModule.exports.computeSaleTotals({ subtotalUsd: 1, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: 0, isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: 4020, changeExchangeRate: 4020, rawAmountPaidUsd: 1, rawAmountPaidKhr: 20 })
assert.equal(nativeBoundary.changeUsd, 0)
assert.equal(nativeBoundary.changeKhr, 20)
const boundaryReceipt = { ...saved, subtotal_usd: 1, subtotal_khr: 4020, total_usd: 1, total_khr: 4020, calculated_total_usd: 1, rounding_adjustment_usd: 0, exchange_rate: 4020, amount_paid_usd: 1, amount_paid_khr: 20, change_usd: nativeBoundary.changeUsd, change_khr: nativeBoundary.changeKhr, change_is_actual: 0, change_exchange_rate: 4020, items: [{ quantity: 1, applied_price_usd: 1, total_usd: 1 }] }
assert.equal(canonicalSaleReceipt(boundaryReceipt).change_khr, 20, '20/4020 must not round to .005 before the cent boundary')
assert.equal(canonicalSaleReceipt({ ...boundaryReceipt, change_exchange_rate: null }).change_usd, 0, 'missing historical rate retains exact USD proof without invented KHR proof')
assert.throws(() => canonicalSaleReceipt({ ...boundaryReceipt, change_usd: 0.01 }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...boundaryReceipt, change_khr: 21 }), SaleMoneyUnavailableError)
assert.equal(canonicalSaleReceipt({ ...boundaryReceipt, amount_paid_khr: 21, change_usd: 0.01, change_khr: 21 }).change_usd, 0.01, 'opposite side of the half-cent boundary')
assert.equal(canonicalSaleReceipt({ ...boundaryReceipt, exchange_rate: 1_000_000, subtotal_khr: 1_000_000, total_khr: 1_000_000, amount_paid_khr: 1, change_khr: 1, change_exchange_rate: null }).change_khr, 1, 'sub-four-decimal surplus remains positive without fabricating its missing change rate')
assert.throws(() => canonicalSaleReceipt({ ...boundaryReceipt, amount_paid_khr: 0, change_exchange_rate: null }), SaleMoneyUnavailableError, 'zero surplus cannot have nonzero computed KHR even without a saved change rate')
const historicalSplit = { ...saved, change_is_actual: 1, change_exchange_rate: 4000, change_usd: 0.5, change_khr: 2000 }
assert.equal(canonicalSaleReceipt(historicalSplit).change_khr, 2000, 'captured actual split change survives subsequent payment/basket edits')
assert.equal(canonicalSaleReceipt({ ...historicalSplit, change_usd: 999 }).change_usd, 999, 'current basket cannot disprove a recorded historical change event without its original event basis')
assert.throws(() => canonicalSaleReceipt({ ...historicalSplit, change_exchange_rate: null }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...historicalSplit, change_usd: 0.001 }), SaleMoneyUnavailableError)
assert.throws(() => canonicalSaleReceipt({ ...historicalSplit, change_khr: 2000.1 }), SaleMoneyUnavailableError)


console.log('PASS v1 line/receipt/delivery calculations and frozen v0 behavior')
