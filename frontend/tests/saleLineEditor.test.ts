import assert from 'node:assert/strict'
import { saleLineEditorResult } from '../src/utils/saleLineEditor.ts'

{
  const result = saleLineEditorResult({ quantity: 2, basePriceUsd: 30, manualDiscountType: 'fixed', manualDiscountValue: 3, productDiscountUsd: 0 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.appliedPriceUsd, 27)
    assert.equal(result.totalDiscountUsd, 3)
    assert.equal(result.lineTotalUsd, 54)
  }
}

{
  const result = saleLineEditorResult({ quantity: 3, basePriceUsd: 8, manualDiscountType: 'percent', manualDiscountValue: 12.5, productDiscountUsd: 2 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.sellingPriceUsd, 10)
    assert.equal(result.totalDiscountUsd, 3, 'product and manual savings are each counted once')
    assert.equal(result.appliedPriceUsd, 7)
    assert.equal(result.lineTotalUsd, 21)
  }
}

assert.deepEqual(saleLineEditorResult({ quantity: 0, basePriceUsd: 10, manualDiscountType: null, manualDiscountValue: 0 }), { ok: false, code: 'quantity' })
assert.deepEqual(saleLineEditorResult({ quantity: 0.001, basePriceUsd: 100, manualDiscountType: null, manualDiscountValue: 0 }), { ok: false, code: 'quantity' })
{
  const result = saleLineEditorResult({ quantity: 1.234, basePriceUsd: 100, manualDiscountType: null, manualDiscountValue: 0 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.quantity, 1.23)
    assert.equal(result.lineTotalUsd, 123, 'preview and submitted quantity must use the same normalized value')
  }
}
assert.deepEqual(saleLineEditorResult({ quantity: 1, basePriceUsd: -1, manualDiscountType: null, manualDiscountValue: 0 }), { ok: false, code: 'price' })
assert.deepEqual(saleLineEditorResult({ quantity: 1, basePriceUsd: 10, manualDiscountType: 'fixed', manualDiscountValue: -1 }), { ok: false, code: 'discount' })
assert.deepEqual(saleLineEditorResult({ quantity: 1, basePriceUsd: 10, manualDiscountType: 'fixed', manualDiscountValue: 11 }), { ok: false, code: 'discount_exceeds_price' })
assert.deepEqual(saleLineEditorResult({ quantity: 1, basePriceUsd: 10, manualDiscountType: 'percent', manualDiscountValue: 101 }), { ok: false, code: 'discount_exceeds_price' })

console.log('sale line editor arithmetic: all cases pass')
