// Regression test for the client-side half of the "employees and other roles
// open POS and it says No Data Found" bug.
//
// Two independent defects combined to empty the POS product grid with an
// HTTP 200 and no error banner, so nothing on screen said what had gone
// wrong -- the pagination count and the A-Z rail (computed by separate,
// unrestricted queries) kept showing real numbers above a blank grid.
//
//   1. A PRODUCTS-PAGE display restriction (`products_image_only`) was
//      applied to every caller of the shared product read endpoints,
//      including POS, stripping each row to five fields.
//
//   2. POS.tsx's applyCatalogProducts filtered rows with a bare
//      `.filter((p) => p?.is_active)`, which reads a MISSING column as
//      "archived". `is_active` is not in the image-only allowlist, so every
//      row was dropped.
//
// Defect 1 is now covered by test-product-surface-scoping-pure.cjs, because
// the fix changed shape: the first attempt taught the image-only predicate to
// also exclude anyone holding pos/sales/inventory, which worked but kept a
// Products concern coupled to three other pages' permissions -- correct only
// for as long as someone remembered to list every other page in it. It is now
// scoped by SURFACE (each page gated by its own permission, the restriction
// existing only on the products surface), so `isImageOnlyUser` no longer
// exists to assert against.
//
// Defect 2 lives here. It is genuinely independent -- reading an absent field
// as a business value is its own mistake, and it would still empty the grid
// for any future response shape that omits a column -- so it keeps its own
// test rather than being folded into the permission one.
//
// Source-level assertions, because a pure-logic test cannot mount POS.tsx --
// same technique test-route-permissions-pure.cjs uses to pin real call sites.
//
// Run: node scripts/test-pos-image-only-blank-grid-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const posSrc = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')

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

check('POS.tsx does not drop catalog rows whose is_active column is merely ABSENT', () => {
  assert.ok(
    !/\.filter\(\(product\) => product\?\.is_active\)/.test(posSrc),
    'applyCatalogProducts still uses the truthy is_active filter that reads a missing column as archived',
  )
  assert.ok(
    /is_active !== 0 && \w+\.is_active !== false/.test(posSrc),
    'applyCatalogProducts should hide a row only when is_active is explicitly 0/false',
  )
})

check('POS.tsx types is_active as boolean | number -- D1 sends INTEGER 0/1, not a bool', () => {
  assert.ok(/is_active\?: boolean \| number/.test(posSrc), 'ProductRecord.is_active should admit the numeric wire shape')
})

check('POS declares the surface it reads for, so it is never judged as the Products page', () => {
  assert.ok(
    /surface: 'pos'/.test(posSrc),
    'POS.tsx must send surface=pos with its catalog query -- see routes/products.ts parseProductReadSurface',
  )
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
