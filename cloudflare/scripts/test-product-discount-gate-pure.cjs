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
  const priceNone = "getActionTier(user, 'products', 'price') === 'none' && stockSessionAddsProductDiscount(request)"
  assert.equal(stockSession.split(priceNone).length - 1, 2, 'create_receive commit AND replay (undo and redo) both check it')
  assert.ok(stockSession.includes("line.kind === 'create_receive' && line.product && productDiscountChanged(null, line.product"), 'the helper judges the create lines')
  assert.ok(stockSession.includes(priceNone + ') fail(\'Product price permission is required to reverse'), 'replayStockSession refuses undo and redo')
})

check('WRITERS left alone on purpose: they carry no products:price gate for the selling price either', () => {
  // Import (products:import is its own Full-only action), merges (the standing rule decides prices) and the receipt
  // unlocked-pricing block do not gate the SELLING price on products:price today, so a discount there follows the same
  // gate (none). Pinned so that if one of them gains a selling-price gate, this test says the discount must follow.
  for (const [rel, needle] of [['lib/importEngine.ts', "getActionTier(user, 'products', 'price')"], ['routes/importJobs.ts', "'products', 'price'"]]) {
    assert.equal(read(rel).includes(needle), false, `${rel} gained a price gate: gate its discount columns the same way`)
  }
})

// ---- Delta review, 6 Oct 2026: the gate and the stored column must see the same value ----
const { normalizeDiscountEnabled, normalizeDiscountType, normalizeProductDiscountBody } = mod.exports

check('discount_enabled: only real on/off spellings normalise; every other value a reader would call truthy is refused', () => {
  for (const [value, expected] of [[true, 1], [1, 1], ['1', 1], ['true', 1], [' TRUE ', 1], [' 1 ', 1], [false, 0], [0, 0], ['0', 0], ['false', 0], ['', 0], [null, 0], [undefined, 0]]) {
    assert.strictEqual(normalizeDiscountEnabled(value), expected, JSON.stringify(value))
  }
  // The bypass spellings from the delta verifier: each activated a stored discount while the gate saw "unchanged".
  for (const value of ['1.0', '01', 2, -1, 1.5, 'yes', 'on', 'y', 'enabled', [], {}, NaN, '0.0', 'null']) {
    assert.strictEqual(normalizeDiscountEnabled(value), null, JSON.stringify(value))
  }
})

check('discount_type: trimmed and case-folded to the exact enum, blank is percent, anything else is refused', () => {
  for (const [value, expected] of [['percent', 'percent'], ['fixed', 'fixed'], ['fixed ', 'fixed'], [' FIXED', 'fixed'], ['Percent ', 'percent'], ['', 'percent'], ['  ', 'percent'], [null, 'percent'], [undefined, 'percent']]) {
    assert.strictEqual(normalizeDiscountType(value), expected, JSON.stringify(value))
  }
  for (const value of ['bogus', 'fixed;', 'fix ed', 5, true, ['fixed'], {}]) assert.strictEqual(normalizeDiscountType(value), null, JSON.stringify(value))
})

check('normalizeProductDiscountBody rewrites the body in place to the exact stored forms and returns the refusal for the rest', () => {
  const body = { name: 'x', discount_enabled: ' true ', discount_type: ' FIXED ', discount_percent: 5 }
  assert.equal(normalizeProductDiscountBody(body), null)
  assert.deepEqual(body, { name: 'x', discount_enabled: 1, discount_type: 'fixed', discount_percent: 5 })
  assert.strictEqual(normalizeProductDiscountBody({ name: 'only the name' }), null, 'a body without the keys is untouched')
  const bad = { discount_enabled: 'yes' }
  assert.equal(normalizeProductDiscountBody(bad).code, 'invalid_discount_enabled')
  assert.equal(normalizeProductDiscountBody({ discount_type: 'bogus' }).code, 'invalid_discount_type')
})

check('a spelling that is not a recognised on/off reads as a CHANGE (fail closed), even against a stored on', () => {
  for (const value of ['1.0', '01', 2, -1, 1.5, 'yes']) {
    assert.equal(productDiscountChanged(LIVE, { discount_enabled: value }), true, 'LIVE ' + JSON.stringify(value))
    assert.equal(productDiscountChanged(NONE, { discount_enabled: value }), true, 'NONE ' + JSON.stringify(value))
  }
  assert.equal(productDiscountChanged(NONE, { discount_type: 'fixed ' }), true, "'fixed ' is the fixed kind, a change from percent")
  assert.equal(productDiscountChanged(LIVE, { discount_type: 'fixed ' }), false, "'fixed ' is the stored fixed once normalised, and is WRITTEN as 'fixed'")
  assert.equal(productDiscountChanged(NONE, { discount_type: 'bogus' }), true)
})

check('the inlined readers in routes/inventory.ts (unlocked pricing) give the SAME answers as the lib over every spelling', () => {
  const inventory = read('routes/inventory.ts')
  const take = (name) => {
    const start = inventory.indexOf(`function ${name}(`)
    assert.ok(start > 0, `${name} exists in routes/inventory.ts`)
    return inventory.slice(start, inventory.indexOf('\n}\n', start) + 3)
  }
  const out = ts.transpileModule(`${take('discountEnabledFlag')}\n${take('discountKind')}\nreturn { discountEnabledFlag, discountKind }`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const inline = new Function(out.replace(/^return/m, 'return'))()
  const spellings = [true, false, 0, 1, '0', '1', 'true', 'false', ' TRUE ', '', '  ', null, undefined, '1.0', '01', 2, -1, 1.5, 'yes', 'on', [], {}, NaN]
  for (const value of spellings) {
    const lib = normalizeDiscountEnabled(value)
    assert.strictEqual(inline.discountEnabledFlag(value), lib === null ? null : lib === 1, 'enabled ' + JSON.stringify(value))
  }
  for (const value of ['percent', 'fixed', 'fixed ', ' FIXED', 'Percent ', '', '  ', null, undefined, 'bogus', 'fixed;', 5, true, ['fixed'], {}]) {
    assert.strictEqual(inline.discountKind(value), normalizeDiscountType(value), 'kind ' + JSON.stringify(value))
  }
})

check('READERS: POS, rules, SQL and portal read discount_type identically (trim + case-fold), so no stored spelling splits them', () => {
  const frontendPricing = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'pricing.ts'), 'utf8')
  assert.match(frontendPricing, /String\(value \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'fixed'/, 'POS pricing.ts trims')
  for (const rel of ['lib/saleItemPricing.ts', '../../frontend/src/utils/saleItemPricing.ts']) {
    assert.match(read(rel), /String\(capture\.product\.discount_type\|\|'percent'\)\.trim\(\)\.toLowerCase\(\)==='fixed'/, rel + ' trims')
  }
  assert.match(read('lib/portalAi.ts'), /String\(product\.discount_type \|\| 'percent'\)\.trim\(\)\.toLowerCase\(\)/, 'portalAi trims')
  assert.equal((read('lib/promotionRulesSql.ts').match(/lower\(trim\(COALESCE\(p\.discount_type, 'percent'\)\)\)/g) || []).length, 2, 'the SQL reader trims in both branches')
})

check('WRITERS: every body that reaches a products write is normalised first, before the price gate', () => {
  const products = read('routes/products.ts')
  assert.equal((products.match(/normalizeProductDiscountBody\(body\)/g) || []).length, 3, 'PUT /:id, POST / and POST /variant')
  for (const route of ["app.put('/:id'", "app.post('/'", "app.post('/variant'"]) {
    const start = products.indexOf(route + ', async')
    assert.ok(start > 0, route)
    const handler = products.slice(start, products.indexOf('\napp.', start + 10))
    assert.ok(handler.indexOf('normalizeProductDiscountBody(body)') > 0, route + ' normalises')
    assert.ok(handler.indexOf('normalizeProductDiscountBody(body)') < handler.indexOf('productDiscountChanged('), route + ' normalises BEFORE the gate compares')
  }
  assert.match(read('lib/stockSession.ts'), /normalizeDiscountType\(value\)/, 'stock-session lines normalise the kind (the switch is already strictly 0/1/boolean there)')
  assert.match(read('lib/importEngine.ts'), /data\.discount_enabled = toBool01\(/, 'import maps the switch to 0/1')
  assert.match(read('lib/importEngine.ts'), /data\.discount_type = str\(row\.discount_type\)\.toLowerCase\(\) === 'fixed'/, 'import maps the kind to the exact enum')
})

console.log(`${passed} checks passed`)
