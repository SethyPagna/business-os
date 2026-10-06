// Owner, 6 Oct 2026 (release security review P2-2): a product-level discount is a price change, so every
// writer that carries the discount block needs the same products:price action as the default selling and
// wholesale price. lib/productDiscountGate.ts decides whether the block CHANGED, because the editors post
// the whole block back with every save and an unchanged block must still pass.
//
// The route-level 403s (PUT, POST, POST /variant for the seeded Employee, Manager, admin) live in
// test-employee-products-default-native.cjs; this file pins the comparison itself and the writers.
//
//   COMPARE  null, '', 0, false and a missing key are all "no discount"; a real difference in any price-bearing
//            column is a change; label and badge colour are not price
//   WRITERS  every writer of the discount columns is either gated here or named as deliberately left alone
//
// Run (from cloudflare/): node scripts/test-product-discount-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\r\n').join('\n')
const mod = { exports: {} }
new Function('module', 'exports', ts.transpileModule(read('lib/productDiscountGate.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports)
const { productDiscountChanged, PRODUCT_DISCOUNT_PRICE_FIELDS, PRODUCT_DISCOUNT_SELECT } = mod.exports

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

const NONE = { discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_amount_usd: 0, discount_amount_khr: 0, discount_starts_at: null, discount_ends_at: null }
const LIVE = { discount_enabled: 1, discount_type: 'fixed', discount_percent: 0, discount_amount_usd: 2.5, discount_amount_khr: 10000, discount_starts_at: '2026-10-01', discount_ends_at: '2026-10-31' }

check('the price-bearing columns are exactly the discount value columns, not the label or colour', () => {
  assert.deepEqual([...PRODUCT_DISCOUNT_PRICE_FIELDS].sort(), [
    'discount_amount_khr', 'discount_amount_usd', 'discount_enabled', 'discount_ends_at', 'discount_percent', 'discount_starts_at', 'discount_type',
  ])
  assert.equal(PRODUCT_DISCOUNT_SELECT, PRODUCT_DISCOUNT_PRICE_FIELDS.join(', '))
})

check('an unchanged block is not a change, in every spelling the editors and the database use', () => {
  assert.equal(productDiscountChanged(NONE, { ...NONE }), false)
  assert.equal(productDiscountChanged(LIVE, { ...LIVE }), false)
  // The database holds nulls, the form posts empty text, zero and 0/1.
  assert.equal(productDiscountChanged({ discount_enabled: null, discount_type: null, discount_percent: null, discount_amount_usd: null, discount_amount_khr: null, discount_starts_at: null, discount_ends_at: null },
    { discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_amount_usd: 0, discount_amount_khr: 0, discount_starts_at: '', discount_ends_at: null }), false)
  assert.equal(productDiscountChanged(NONE, { discount_enabled: false, discount_type: 'PERCENT' }), false)
  assert.equal(productDiscountChanged(LIVE, { discount_enabled: true, discount_type: 'Fixed', discount_amount_usd: '2.50', discount_amount_khr: 10000.00001 }), false, 'string and sub-4dp noise is the same value')
  assert.equal(productDiscountChanged(LIVE, { discount_enabled: '1' }), false)
  assert.equal(productDiscountChanged(NONE, {}), false, 'a body with no discount key writes none')
  assert.equal(productDiscountChanged(NONE, { name: 'Only the name' }), false)
})

check('a different value in ANY price-bearing column is a change', () => {
  for (const [field, value] of [
    ['discount_enabled', 1], ['discount_enabled', true], ['discount_type', 'fixed'], ['discount_percent', 90], ['discount_percent', 0.01],
    ['discount_amount_usd', 5], ['discount_amount_khr', 4000], ['discount_starts_at', '2026-10-01'], ['discount_ends_at', '2026-12-31'],
  ]) assert.equal(productDiscountChanged(NONE, { [field]: value }), true, `${field}=${value}`)
  for (const [field, value] of [
    ['discount_enabled', 0], ['discount_type', 'percent'], ['discount_amount_usd', 2.51], ['discount_amount_khr', 0], ['discount_starts_at', ''], ['discount_ends_at', null], ['discount_percent', 5],
  ]) assert.equal(productDiscountChanged(LIVE, { [field]: value }), true, `LIVE ${field}=${value}`)
})

check('label and badge colour are description, not price', () => {
  assert.equal(productDiscountChanged(LIVE, { ...LIVE, discount_label: 'Mega sale', discount_badge_color: '#000000' }), false)
})

check('a create compares against "no discount": zeros pass, anything real is a change', () => {
  assert.equal(productDiscountChanged(null, { ...NONE }), false)
  assert.equal(productDiscountChanged(undefined, {}), false)
  assert.equal(productDiscountChanged(null, { discount_enabled: 1, discount_type: 'percent', discount_percent: 10 }), true)
  assert.equal(productDiscountChanged(null, { discount_amount_usd: 1 }), true)
})

check('WRITERS: the PUT, create, variant and stock-session create_receive writers are gated on the price action', () => {
  const products = read('routes/products.ts')
  const stockSession = read('lib/stockSession.ts')
  const gated = (products.match(/getActionTier\(user, 'products', 'price'\) === 'none'\s*&&\s*(?:\n\s*)?(?:productDiscountChanged\(null, body\)|PRODUCT_DISCOUNT_PRICE_FIELDS)/g) || []).length
  assert.equal(gated, 3, 'PUT /:id, POST / and POST /variant')
  assert.match(products, /productDiscountChanged\(storedDiscount, body\)/, 'the PUT compares against the stored row')
  assert.match(stockSession, /getActionTier\(user, 'products', 'price'\) === 'none'\s*&&\s*request\.items\.some\(\(line\) => line\.kind === 'create_receive' && line\.product && productDiscountChanged\(null, line\.product/, 'create_receive')
})

check('WRITERS left alone on purpose: they carry no products:price gate for the selling price either', () => {
  // Import (products:import is its own Full-only action), merges (the standing rule decides prices) and the receipt
  // unlocked-pricing block do not gate the SELLING price on products:price today, so a discount there follows the same
  // gate (none). Pinned so that if one of them gains a selling-price gate, this test says the discount must follow.
  for (const [rel, needle] of [['lib/importEngine.ts', "getActionTier(user, 'products', 'price')"], ['routes/importJobs.ts', "'products', 'price'"]]) {
    assert.equal(read(rel).includes(needle), false, `${rel} gained a price gate: gate its discount columns the same way`)
  }
})

console.log(`${passed} checks passed`)
