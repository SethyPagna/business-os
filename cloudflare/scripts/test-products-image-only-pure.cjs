// Regression test for the "image upload only" restricted Products role
// (progress.md backlog item #7, Part 241; field-visibility made
// per-permission-configurable in Part 243): lib/productWrites.ts's
// isImageOnlyWritePayload(), restrictToImageOnlyFields(), and
// computeImageOnlyVisibleFields() -- the functions that decide what this
// role can see and write.
//
// Same "lift the real functions verbatim via extraction, don't drag in the
// whole module's ./db/./media side effects" approach
// test-products-stock-clamp-pure.cjs already uses for this same source
// file -- these two functions have zero dependency on getDb/sanitizeMediaList
// themselves, so extracting just their source (plus the two const sets they
// close over) and transpiling that alone is both correct and avoids needing
// this test's own D1/R2 stubs.
//
// Run (from cloudflare/): node scripts/test-products-image-only-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'productWrites.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

// Extracts everything from the "IMAGE_ONLY" section marker comment through
// the end of the file -- simpler and less fragile than matching each
// declaration's closing bracket individually (which a one-line `new
// Set([...])` vs. a multi-line one makes inconsistent to regex for). This
// section is the last thing in the file (see productWrites.ts itself), so
// grabbing from its start marker to EOF is exactly the five real
// declarations under test, verbatim.
const sectionStart = source.indexOf('// "Image actions only" restricted role')
if (sectionStart === -1) throw new Error('IMAGE_ONLY section marker not found in productWrites.ts -- source may have changed')
const combinedSource = source.slice(sectionStart)

const { outputText } = ts.transpileModule(combinedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'products-image-only-pure.ts',
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { isImageOnlyWritePayload, restrictToImageOnlyFields, computeImageOnlyVisibleFields, IMAGE_ONLY_BASE_FIELDS, IMAGE_ONLY_OPTIONAL_FIELDS, IMAGE_ONLY_VISIBLE_FIELDS } = moduleObj.exports

assert.ok(Array.isArray(IMAGE_ONLY_VISIBLE_FIELDS) && IMAGE_ONLY_VISIBLE_FIELDS.includes('image_path'), 'IMAGE_ONLY_VISIBLE_FIELDS must include image_path')
assert.ok(Array.isArray(IMAGE_ONLY_BASE_FIELDS) && IMAGE_ONLY_BASE_FIELDS.includes('image_path'), 'IMAGE_ONLY_BASE_FIELDS must include image_path')

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

const REAL_PRODUCT_ROW = {
  id: 42,
  name: 'Rose Gold Lipstick',
  sku: 'LIP-042',
  barcode: '8801234567890',
  category: 'Lipstick',
  brand: 'Acme',
  selling_price_usd: 12.5,
  selling_price_khr: 50000,
  cost_price_usd: 4.2,
  cost_price_khr: 16800,
  stock_quantity: 37,
  low_stock_threshold: 10,
  image_path: '/uploads/lipstick-42.jpg',
  supplier: 'Acme Cosmetics Co',
  is_active: 1,
  updated_at: '2026-08-21T00:00:00.000Z',
}

check('restrictToImageOnlyFields with no permissions granted keeps only id/name/image_path/updated_at -- pricing and everything else hidden by default (Part 243)', () => {
  const restricted = restrictToImageOnlyFields(REAL_PRODUCT_ROW)
  assert.deepStrictEqual(Object.keys(restricted).sort(), ['id', 'image_path', 'name', 'updated_at'].sort())
  assert.strictEqual(restricted.name, 'Rose Gold Lipstick')
  assert.strictEqual(restricted.image_path, '/uploads/lipstick-42.jpg')
  assert.strictEqual('selling_price_usd' in restricted, false, 'selling price must stay hidden with nothing granted')
})

check('restrictToImageOnlyFields strips cost/stock/sku/barcode/brand/supplier with nothing granted -- the whole point of this role', () => {
  const restricted = restrictToImageOnlyFields(REAL_PRODUCT_ROW)
  for (const forbidden of ['cost_price_usd', 'cost_price_khr', 'stock_quantity', 'low_stock_threshold', 'sku', 'barcode', 'brand', 'supplier', 'category', 'is_active']) {
    assert.strictEqual(forbidden in restricted, false, `${forbidden} must not be visible to an image-only user with nothing granted`)
  }
})

check('restrictToImageOnlyFields tolerates a row missing some visible fields (no crash, just omits them)', () => {
  const restricted = restrictToImageOnlyFields({ id: 1, name: 'Bare Row' })
  assert.deepStrictEqual(restricted, { id: 1, name: 'Bare Row' })
})

// -- Part 243: each optional field is independently grantable via its own
// permission key, and defaults to hidden when that key is absent/false. --
check('computeImageOnlyVisibleFields returns only base fields when no optional permission is granted', () => {
  assert.deepStrictEqual(computeImageOnlyVisibleFields({}).sort(), [...IMAGE_ONLY_BASE_FIELDS].sort())
  assert.deepStrictEqual(computeImageOnlyVisibleFields(null).sort(), [...IMAGE_ONLY_BASE_FIELDS].sort())
  assert.deepStrictEqual(computeImageOnlyVisibleFields(undefined).sort(), [...IMAGE_ONLY_BASE_FIELDS].sort())
})

check('computeImageOnlyVisibleFields adds selling_price_usd/khr only when products_image_only_show_price is granted', () => {
  const fields = computeImageOnlyVisibleFields({ products_image_only_show_price: true })
  assert.ok(fields.includes('selling_price_usd') && fields.includes('selling_price_khr'), 'price fields must be present once granted')
  assert.deepStrictEqual(computeImageOnlyVisibleFields({ products_image_only_show_price: 'review' }), [...IMAGE_ONLY_BASE_FIELDS], 'anything other than a strict === true grant must not unlock the field')
})

check('computeImageOnlyVisibleFields is additive -- multiple grants stack, each independent of the others', () => {
  const fields = computeImageOnlyVisibleFields({
    products_image_only_show_price: true,
    products_image_only_show_barcode: true,
    products_image_only_show_stock: true,
  })
  assert.ok(fields.includes('selling_price_usd'))
  assert.ok(fields.includes('barcode'))
  assert.ok(fields.includes('stock_quantity'))
  assert.ok(!fields.includes('category'), 'category must stay hidden -- not granted in this scenario')
  assert.ok(!fields.includes('brand'), 'brand must stay hidden -- not granted in this scenario')
})

check('restrictToImageOnlyFields honors a merged-permissions map, granting exactly the requested optional fields', () => {
  const restricted = restrictToImageOnlyFields(REAL_PRODUCT_ROW, {
    products_image_only_show_price: true,
    products_image_only_show_category: true,
  })
  assert.deepStrictEqual(
    Object.keys(restricted).sort(),
    ['id', 'image_path', 'name', 'updated_at', 'selling_price_usd', 'selling_price_khr', 'category'].sort(),
  )
  assert.strictEqual(restricted.selling_price_usd, 12.5)
  assert.strictEqual(restricted.category, 'Lipstick')
  assert.strictEqual('barcode' in restricted, false, 'barcode must stay hidden -- not granted in this scenario')
  assert.strictEqual('brand' in restricted, false, 'brand must stay hidden -- not granted in this scenario')
  assert.strictEqual('stock_quantity' in restricted, false, 'stock must stay hidden -- not granted in this scenario')
})

check('IMAGE_ONLY_OPTIONAL_FIELDS covers exactly the six expected optional keys, each mapping to real product columns', () => {
  assert.deepStrictEqual(Object.keys(IMAGE_ONLY_OPTIONAL_FIELDS).sort(), [
    'products_image_only_show_barcode',
    'products_image_only_show_brand',
    'products_image_only_show_category',
    'products_image_only_show_price',
    'products_image_only_show_stock',
    // VIP price is its own grant, separate from selling price (Aug 28) --
    // an org can show shelf price while keeping VIP terms private.
    'products_image_only_show_vip',
  ])
  assert.deepStrictEqual(IMAGE_ONLY_OPTIONAL_FIELDS.products_image_only_show_price, ['selling_price_usd', 'selling_price_khr'])
  assert.deepStrictEqual(IMAGE_ONLY_OPTIONAL_FIELDS.products_image_only_show_vip, ['special_price_usd', 'special_price_khr'])
})

check('isImageOnlyWritePayload accepts an image_path-only body (the one real use case)', () => {
  assert.strictEqual(isImageOnlyWritePayload({ image_path: '/uploads/new.jpg' }), true)
})

check('isImageOnlyWritePayload accepts image_path plus ordinary request metadata (device info, expected-updated-at, client-request id)', () => {
  assert.strictEqual(isImageOnlyWritePayload({
    image_path: '/uploads/new.jpg',
    expectedUpdatedAt: '2026-08-21T00:00:00.000Z',
    deviceName: 'Chrome on macOS',
    deviceTz: 'Asia/Phnom_Penh',
    clientTime: '2026-08-21T00:00:01.000Z',
    client_request_id: 'abc123',
  }), true)
})

check('isImageOnlyWritePayload rejects a body with ANY other real field alongside image_path -- not partial credit', () => {
  assert.strictEqual(isImageOnlyWritePayload({ image_path: '/uploads/new.jpg', cost_price_usd: 1 }), false)
  assert.strictEqual(isImageOnlyWritePayload({ image_path: '/uploads/new.jpg', name: 'Sneaky rename' }), false)
  assert.strictEqual(isImageOnlyWritePayload({ image_path: '/uploads/new.jpg', stock_quantity: 999 }), false)
})

check('isImageOnlyWritePayload rejects a body missing image_path entirely, even if every key is otherwise metadata', () => {
  assert.strictEqual(isImageOnlyWritePayload({ expectedUpdatedAt: '2026-08-21T00:00:00.000Z' }), false)
  assert.strictEqual(isImageOnlyWritePayload({}), false)
})

check('isImageOnlyWritePayload accepts image_gallery (this role now gets full image actions -- view/add/remove/reorder the gallery, not just the single row image)', () => {
  assert.strictEqual(isImageOnlyWritePayload({ image_gallery: ['/uploads/a.jpg', '/uploads/b.jpg'] }), true)
  assert.strictEqual(isImageOnlyWritePayload({ image_path: '/uploads/new.jpg', image_gallery: ['/uploads/a.jpg'] }), true)
})

check('isImageOnlyWritePayload still rejects image_gallery alongside any other real field', () => {
  assert.strictEqual(isImageOnlyWritePayload({ image_gallery: ['/uploads/a.jpg'], name: 'New name' }), false)
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) {
  console.error('SOME CHECKS FAILED')
  process.exit(1)
}
