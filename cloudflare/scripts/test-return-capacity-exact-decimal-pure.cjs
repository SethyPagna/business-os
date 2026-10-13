'use strict'
// Return capacity is decimal arithmetic, not binary-float arithmetic.
//
// assertReturnCreateCapacity (lib/returnCreateAction.ts) summed a line's
// returned quantities as JS numbers: 0.2 + 0.1 = 0.30000000000000004, so the
// last 0.1 of a 0.3 line was refused with "Cannot return 0.30000000000000004
// of ... -- only 0.3 sold", and a product-matched 0.1 overflowed by 1.4e-17.
// The v0 status projection had the twin defect (0.7 + 0.1 < 0.8, so a fully
// returned line stayed partial_return). The fix sums and compares through
// moneyPrecision's subtractDecimalSum, the exact kernel the v1 entitlement
// already uses -- NOT an epsilon: the controls below refuse an excess of
// 1e-10, which a "round to 6 decimals" fix would wrongly accept.
//
// Transition table (one line, sold q, prior returns r_i, request x):
//   accept  iff  r_1 + ... + r_n + x <= q   (exact decimals)
//   refuse  otherwise, naming the exact sum (no float noise in the sentence)
//
// Run (from cloudflare/): node scripts/test-return-capacity-exact-decimal-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.join(__dirname, '..')
function load(rel) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8')
  const output = buildSync({ stdin: { contents: source, resolveDir: path.dirname(path.join(root, rel)), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}
const subject = load('src/lib/returnCreateAction.ts')

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n     ${String(error.message).split('\n').join('\n     ')}`) }
}
const refusal = (sold, committed, requested) => {
  try { subject.assertReturnCreateCapacity(sold, committed, requested) } catch (error) { return error }
  return null
}
const line = (quantity, extra = {}) => ({ id: 1, product_id: 5, product_name: 'A', quantity, ...extra })

check('by sale line: 0.2 then 0.1 on a 0.3 line is accepted (exactly full)', () => {
  assert.equal(refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.2 }], [{ sale_item_id: 1, quantity: 0.1 }]), null)
})
check('by sale line: 0.1 + 0.1 + 0.1 on a 0.3 line is accepted', () => {
  assert.equal(refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.1 }, { sale_item_id: 1, quantity: 0.1 }], [{ sale_item_id: 1, quantity: 0.1 }]), null)
})
check('control: 0.2 then 0.2 on a 0.3 line is still refused, and the sentence carries the exact sum', () => {
  const error = refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.2 }], [{ sale_item_id: 1, quantity: 0.2 }])
  assert.ok(error, 'must refuse')
  assert.equal(error.message, 'Cannot return 0.4 of A — only 0.3 sold')
  assert.deepEqual(error.params, { product: 'A', returned: 0.4, sold: 0.3 })
})
check('control: an exact excess of 1e-10 is refused (no epsilon, no 6-decimal rounding)', () => {
  const error = refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.2 }], [{ sale_item_id: 1, quantity: 0.1000000001 }])
  assert.ok(error, 'must refuse')
  assert.equal(error.message, 'Cannot return 0.3000000001 of A — only 0.3 sold')
})
check('by product: a product-matched 0.1 fills the 0.1 left after 0.2 (no 1.4e-17 overflow)', () => {
  assert.equal(refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.2 }], [{ product_id: 5, quantity: 0.1 }]), null)
})
check('control: a product-matched 0.2 overflows by exactly 0.1', () => {
  const error = refusal([line(0.3)], [{ sale_item_id: 1, quantity: 0.2 }], [{ product_id: 5, quantity: 0.2 }])
  assert.ok(error, 'must refuse')
  assert.equal(error.message, 'Cannot return 0.1 additional unit(s) of product #5 — only the unreturned sold quantity is eligible')
  assert.deepEqual(error.params, { product: 'A', returned: 0.4, sold: 0.3 })
})
check('by product across lines: 0.7 + 0.1 fills a 0.8 line, then 0.1 more lands on the next line', () => {
  const sold = [line(0.8), { id: 2, product_id: 5, product_name: 'A', quantity: 0.1 }]
  assert.equal(refusal(sold, [{ sale_item_id: 1, quantity: 0.7 }], [{ product_id: 5, quantity: 0.1 }, { product_id: 5, quantity: 0.1 }]), null)
  const error = refusal(sold, [{ sale_item_id: 1, quantity: 0.7 }], [{ product_id: 5, quantity: 0.3 }])
  assert.ok(error, 'must refuse 0.7 + 0.3 against 0.9 sold')
  assert.deepEqual(error.params, { product: 'A', returned: 1, sold: 0.9 })
})
check('integers are unchanged', () => {
  assert.equal(refusal([line(3)], [{ sale_item_id: 1, quantity: 2 }], [{ sale_item_id: 1, quantity: 1 }]), null)
  assert.equal(refusal([line(3)], [{ sale_item_id: 1, quantity: 2 }], [{ sale_item_id: 1, quantity: 2 }]).message, 'Cannot return 4 of A — only 3 sold')
})
check('v0 status projection: 0.7 + 0.1 on a 0.8 line is returned, 0.7 alone is partial_return', () => {
  assert.equal(subject.projectedSaleStatusForReturnCreate([line(0.8)], [{ sale_item_id: 1, quantity: 0.7 }], [{ sale_item_id: 1, quantity: 0.1 }], 'completed'), 'returned')
  assert.equal(subject.projectedSaleStatusForReturnCreate([line(0.8)], [], [{ sale_item_id: 1, quantity: 0.7 }], 'completed'), 'partial_return')
  assert.equal(subject.projectedSaleStatusForReturnCreate([line(0.8)], [], [{ product_id: 5, quantity: 0.7 }, { product_id: 5, quantity: 0.1 }], 'completed'), 'returned')
  assert.equal(subject.projectedSaleStatusForReturnCreate([line(0.8)], [], [], 'awaiting_delivery'), 'awaiting_delivery')
})
check('legacy remaining helper: 0.3 sold, 0.2 returned leaves exactly 0.1; a 0.1 request fits, 0.1000000001 does not', () => {
  assert.equal(subject.returnQuantityRemaining(0.3, [0.2]), 0.1)
  assert.equal(subject.returnQuantityRemaining(0.3, [0.2, 0.2]), 0, 'never negative')
  assert.equal(subject.returnQuantityExceeds(0.1, subject.returnQuantityRemaining(0.3, [0.2])), false)
  assert.equal(subject.returnQuantityExceeds(0.1000000001, subject.returnQuantityRemaining(0.3, [0.2])), true)
})

const failed = results.filter(result => !result.ok)
console.log(`${failed.length ? 'RED' : 'GREEN'} exact-decimal return capacity: ${results.length - failed.length}/${results.length}`)
if (failed.length) process.exitCode = 1
