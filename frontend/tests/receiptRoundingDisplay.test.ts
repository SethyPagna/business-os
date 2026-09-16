import assert from 'node:assert/strict'
import { receiptRoundingDisplay } from '../src/utils/receiptRoundingDisplay.ts'
const fmt = (amount: number) => `$${amount.toFixed(2)}`
assert.deepEqual(receiptRoundingDisplay(-.0036, fmt), { labelKey: 'money_rounding_down', amount: '< $0.01' })
assert.deepEqual(receiptRoundingDisplay(.0036, fmt), { labelKey: 'money_rounding_up', amount: '< $0.01' })
assert.equal(receiptRoundingDisplay(0, fmt), null)
assert.equal(receiptRoundingDisplay(-0, fmt), null)
for (const value of [.005, .006, -.005, -.006]) assert.deepEqual(receiptRoundingDisplay(value, fmt), { labelKey: 'money_rounding_adjustment', amount: `${value < 0 ? '-' : '+'}$0.01` })
assert.throws(() => receiptRoundingDisplay(NaN, fmt))
console.log('PASS receipt adjustment presentation: subcent direction, two-decimal threshold, zero hidden, ordinary boundaries')
