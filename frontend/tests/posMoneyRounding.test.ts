import assert from 'node:assert/strict'
import fs from 'node:fs'
import './financialPrecision.test.ts'
import { parsePosInternalAmount, posV1BasketTotals } from '../src/components/pos/posCore.ts'
import { nativeChangeAmounts } from '../src/utils/moneyPrecision.ts'

// Actual component declarations: v0 retains cents/whole-riel calculations;
// v1 components remain4dp, only physical change uses native denominations.
const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8').replace(/\r/g, '')
function declaration(name: string, env: Record<string, unknown>): number {
  const start = pos.indexOf('  const ' + name + ' ')
  assert.ok(start > 0, 'production declaration ' + name)
  const end = pos.indexOf('\n  const ', start + 1)
  const code = pos.slice(start, end)
  return new Function(...Object.keys(env), code + '\n; return ' + name + ';')(...Object.values(env))
}
for (const [input, v0, v1] of [['0.25', .25, .25], ['0.50', .5, .5], ['1.2345', 1.23, 1.2345]] as const) {
  const env = { settings: { customer_portal_redeem_value_usd: input }, asText: String, parsePosInternalAmount }
  assert.equal(declaration('redeemValueUsdStep', { ...env, moneyVersion: 0 }), v0)
  assert.equal(declaration('redeemValueUsdStep', { ...env, moneyVersion: 1 }), v1)
}
assert.equal(declaration('taxKhr', { moneyVersion: 0, afterDiscKhr: 101.5, taxRate: .1 }), 10)
assert.equal(declaration('totalKhr', { moneyVersion: 0, afterDiscKhr: 101.5, taxKhr: 10, customerFeeKhr: 0 }), 112)
assert.equal(declaration('changeKhr', { moneyVersion: 0, changeUsd: .005, changeExchangeRate: 4020 }), 20)
const basket = posV1BasketTotals({ lines: [{ total_usd: 1.2345 }], exchangeRate: 4020, discountType: 'fixed', discountPercent: '', discountUsd: '0.0001', discountKhr: '', membershipUsd: '0.0001', membershipKhr: '', taxPercent: '10', feeUsd: '0', customerPaysFee: false })
assert.equal(basket.discKhr, .402)
assert.equal(basket.membershipDiscKhr, .402)
assert.equal(basket.taxKhr, 496.068)
assert.equal(declaration('taxKhr', { moneyVersion: 1, v1Basket: { totals: basket } }), basket.taxKhr)
assert.equal(declaration('totalKhr', { moneyVersion: 1, v1Basket: { totals: basket } }), basket.totalKhr)
const native = nativeChangeAmounts({ paidUsd: 1, paidKhr: 20, payableUsd: 1, exchangeRate: 4020, changeExchangeRate: 4020 })
assert.deepEqual(native, { changeUsd: 0, changeKhr: 20, hasOverpayment: true })
assert.equal(declaration('changeKhr', { moneyVersion: 1, computedNativeChange: native }), 20)
assert.match(pos, /subtotal_usd: subtotalUsd, subtotal_khr: subtotalKhr/, 'v1 payload preserves internal components, not a whole-riel display conversion')
await import('./posMoneyV1.test.ts') // actual checkout payload and frozen retry
console.log('PASS actual POS declarations: legacy precision unchanged, v1 internal4 and native change')
