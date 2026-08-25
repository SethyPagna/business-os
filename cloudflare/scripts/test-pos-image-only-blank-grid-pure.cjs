// Regression test for the "employees and other roles open POS and it says
// No Data Found" bug.
//
// Two independent defects combined to empty the POS product grid with an
// HTTP 200 and no error banner, so nothing on screen said what had gone
// wrong -- the pagination count and the A-Z rail (computed by separate,
// unrestricted queries) kept showing real numbers above a blank grid.
//
//   1. routes/products.ts's isImageOnlyUser() decided "this user's only
//      route into product data is the restricted image-only role" by
//      looking at the `products` permission tier ALONE. A cashier role
//      granted { pos, sales } plus `products_image_only` -- a natural way
//      to say "let the cashier see product photos" -- therefore matched,
//      and every catalog row was stripped to IMAGE_ONLY_BASE_FIELDS
//      (id/name/image_path/image_gallery/updated_at). lib/productWrites.ts's
//      own docstring on restrictToImageOnlyFields already claimed the
//      function excluded users holding real `products`/`pos`/`inventory`
//      access; the code simply never implemented the pos/sales/inventory
//      half. Selling requires prices, stock and branch data by definition,
//      so a user who can operate POS/Sales/Inventory can never be an
//      image-only user.
//
//   2. POS.tsx's applyCatalogProducts filtered rows with a bare
//      `.filter((p) => p?.is_active)`, which reads a MISSING column as
//      "archived". `is_active` is not in the image-only allowlist, so every
//      row was dropped. Every product list endpoint already filters
//      `WHERE p.is_active = 1` server-side (routes/products.ts), so a row
//      that reaches the client is active by construction and an absent
//      column must never be treated as a business value.
//
// Fixing either one alone resolves the reported symptom; both are fixed and
// both are locked in here, because they are different failure classes (a
// permission-scope bug and a missing-field-read-as-false bug) and either
// could regress on its own.
//
// Run: node scripts/test-pos-image-only-blank-grid-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')

// ---------------------------------------------------------------------------
// Compile the REAL lib/permissions.ts, then lift the REAL isImageOnlyUser
// out of routes/products.ts and run it against those functions -- same
// "extract and transpile the real source, don't reimplement it" approach
// test-route-permissions-pure.cjs and test-products-image-only-pure.cjs use.
// Reimplementing the predicate here would test this file's copy of the rule,
// which is precisely the mistake that let the original bug through.
// ---------------------------------------------------------------------------
const permissionsSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'permissions.ts'), 'utf8')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-image-only-'))
const tsPath = path.join(tmpDir, 'permissions.ts')
fs.writeFileSync(tsPath, permissionsSrc)
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { hasPermission, getPermissionTier } = require(path.join(tmpDir, 'permissions.js'))

const productsRoutePath = path.join(cloudflareRoot, 'src', 'routes', 'products.ts')
const productsRouteSrc = fs.readFileSync(productsRoutePath, 'utf8')

const fnMatch = productsRouteSrc.match(/function isImageOnlyUser\(user: SessionUser\): boolean \{[\s\S]*?\n\}/)
assert.ok(fnMatch, 'isImageOnlyUser not found in routes/products.ts -- source shape changed, update this test')
const isImageOnlyUser = new Function(
  'hasPermission',
  'getPermissionTier',
  `${fnMatch[0].replace(': SessionUser', '').replace('): boolean', ')')}\nreturn isImageOnlyUser`,
)(hasPermission, getPermissionTier)

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

const role = (permissions) => ({ role_permissions: JSON.stringify(permissions), permissions: null, username: 'staff1', role_code: 'cashier' })

// ---- the exact reported scenario ----
check('a cashier with {pos, sales} + products_image_only is NOT treated as image-only (the reported POS blank-grid bug)', () => {
  const cashier = role({ pos: true, sales: true, products_image_only: true })
  assert.equal(isImageOnlyUser(cashier), false)
})

check('pos alone is enough to disqualify image-only restriction -- selling needs price and stock', () => {
  assert.equal(isImageOnlyUser(role({ pos: true, products_image_only: true })), false)
})

check('sales alone is enough to disqualify image-only restriction', () => {
  assert.equal(isImageOnlyUser(role({ sales: true, products_image_only: true })), false)
})

check('inventory access disqualifies image-only restriction, at either tier', () => {
  assert.equal(isImageOnlyUser(role({ inventory: true, products_image_only: true })), false)
  assert.equal(isImageOnlyUser(role({ inventory: 'review', products_image_only: true })), false)
})

check('real products access still disqualifies it, at either tier (the case that already worked)', () => {
  assert.equal(isImageOnlyUser(role({ products: true, products_image_only: true })), false)
  assert.equal(isImageOnlyUser(role({ products: 'review', products_image_only: true })), false)
})

// ---- the role the restriction actually exists for must STILL be restricted ----
check('a genuine image-only user (products_image_only and nothing else) IS still restricted', () => {
  assert.equal(isImageOnlyUser(role({ products_image_only: true })), true)
})

check('image-only plus unrelated grants (dashboard, contacts) is still restricted -- none of those read product rows', () => {
  assert.equal(isImageOnlyUser(role({ products_image_only: true, dashboard: true, contacts: true })), true)
})

check('a user without products_image_only at all is never restricted', () => {
  assert.equal(isImageOnlyUser(role({ pos: true })), false)
  assert.equal(isImageOnlyUser(role({})), false)
})

// ---------------------------------------------------------------------------
// Source lock-in for the client-side half. A pure-logic test can't mount
// POS.tsx, so assert on its source directly -- same technique
// test-route-permissions-pure.cjs uses to pin real call sites.
// ---------------------------------------------------------------------------
const posSrc = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')

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

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
