// Page independence for product reads.
//
// /search, /bootstrap and / are shared endpoints -- the Products page, POS
// and Inventory all read products through them. Sharing the query is fine.
// What was NOT fine was applying a PRODUCTS-PAGE display restriction
// (`products_image_only`, which exists so a photo uploader sees pictures and
// not pricing) to every caller regardless of which page was asking. A cashier
// granted {pos, sales} plus `products_image_only` had every catalog row
// stripped to five fields and POS rendered empty.
//
// The first fix taught the image-only predicate to also exclude anyone
// holding pos/sales/inventory. That worked, but it kept a Products concern
// coupled to three other pages' permissions -- it only stayed correct for as
// long as somebody remembered to list every other page in it.
//
// The real fix is scoping: the caller declares which SURFACE it reads for,
// each surface is gated by its OWN page permission, and the image-only
// restriction exists only on the products surface. That is what these
// assertions pin -- especially that declaring a surface can never ESCALATE,
// which is the property that makes the parameter safe to trust.
//
// Run: node scripts/test-product-surface-scoping-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-surface-'))
const tsPath = path.join(tmpDir, 'permissions.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'permissions.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { hasPermission, getPermissionTier } = require(path.join(tmpDir, 'permissions.js'))

// Lift the three real helpers out of routes/products.ts rather than
// reimplementing them -- reimplementing the rule is how the original bug
// survived a test suite in the first place.
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
function lift(signature, name) {
  const start = routeSrc.indexOf(signature)
  assert.ok(start > 0, `${name} not found in routes/products.ts -- update this test`)
  let depth = 0
  let i = routeSrc.indexOf('{', start)
  const open = i
  for (; i < routeSrc.length; i += 1) {
    if (routeSrc[i] === '{') depth += 1
    else if (routeSrc[i] === '}') { depth -= 1; if (depth === 0) break }
  }
  return routeSrc.slice(start, i + 1).slice(0, open - start) + routeSrc.slice(open, i + 1)
}

const body = [
  lift('export function parseProductReadSurface', 'parseProductReadSurface'),
  lift('export function productSurfaceDenialReason', 'productSurfaceDenialReason'),
  lift('function isImageOnlyRead', 'isImageOnlyRead'),
].join('\n\n')
  .replace(/: SessionUser/g, '')
  .replace(/: ProductReadSurface/g, '')
  .replace(/: unknown/g, '')
  .replace(/\): string \| null/g, ')')
  .replace(/\): ProductReadSurface/g, ')')
  .replace(/\): boolean/g, ')')
  .replace(/^export /gm, '')

const factory = new Function('hasPermission', 'getPermissionTier', `${body}\nreturn { parseProductReadSurface, productSurfaceDenialReason, isImageOnlyRead }`)
const { parseProductReadSurface, productSurfaceDenialReason, isImageOnlyRead } = factory(hasPermission, getPermissionTier)

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

// ---- the reported scenario, now guaranteed structurally ----
const cashierWithPhotoPermission = role({ pos: true, sales: true, products_image_only: true })

check('a cashier with products_image_only is NEVER field-restricted on the POS surface', () => {
  assert.equal(isImageOnlyRead(cashierWithPhotoPermission, 'pos'), false)
})

check('that same cashier IS still restricted on the Products surface -- the permission keeps working where it belongs', () => {
  assert.equal(isImageOnlyRead(cashierWithPhotoPermission, 'products'), true)
})

check('the image-only restriction never applies to the inventory surface either', () => {
  assert.equal(isImageOnlyRead(role({ inventory: true, products_image_only: true }), 'inventory'), false)
})

check('a real products grant is never restricted, on any surface', () => {
  for (const surface of ['products', 'pos', 'inventory']) {
    assert.equal(isImageOnlyRead(role({ products: true, products_image_only: true }), surface), false)
  }
})

// ---- declaring a surface must not escalate ----
check('claiming surface=pos without the pos permission is REFUSED, not silently downgraded', () => {
  const imageOnly = role({ products_image_only: true })
  assert.ok(productSurfaceDenialReason(imageOnly, 'pos'), 'an image-only user must not be able to read POS data by asking for it')
})

check('claiming surface=inventory without inventory access is refused', () => {
  assert.ok(productSurfaceDenialReason(role({ products: true }), 'inventory'))
})

check('each surface is allowed by its OWN page permission', () => {
  assert.equal(productSurfaceDenialReason(role({ pos: true }), 'pos'), null)
  assert.equal(productSurfaceDenialReason(role({ sales: true }), 'pos'), null, 'sales can read POS catalog data')
  assert.equal(productSurfaceDenialReason(role({ inventory: true }), 'inventory'), null)
  assert.equal(productSurfaceDenialReason(role({ products: true }), 'products'), null)
  assert.equal(productSurfaceDenialReason(role({ products_image_only: true }), 'products'), null, 'the image-only role still reaches the Products page')
})

check('a user with none of the page permissions is refused everywhere', () => {
  const nobody = role({ dashboard: true })
  for (const surface of ['products', 'pos', 'inventory']) {
    assert.ok(productSurfaceDenialReason(nobody, surface), `${surface} should be refused`)
  }
})

// ---- parsing ----
check('the surface parameter defaults to products, so pre-existing callers are unchanged', () => {
  for (const raw of [undefined, null, '', 'nonsense', 'PRODUCTS']) {
    assert.equal(parseProductReadSurface(raw), 'products')
  }
  assert.equal(parseProductReadSurface('pos'), 'pos')
  assert.equal(parseProductReadSurface('POS'), 'pos')
  assert.equal(parseProductReadSurface(' inventory '), 'inventory')
})

// ---- the products route must not consult other pages' permissions ----
check('the products read path no longer reaches into pos/sales/inventory permissions', () => {
  const readSection = routeSrc.slice(routeSrc.indexOf('function isImageOnlyRead'), routeSrc.indexOf('function restrictListPayloadForImageOnly'))
  assert.ok(
    !/hasPermission\(user, 'pos'\)|hasPermission\(user, 'sales'\)|getPermissionTier\(user, 'inventory'\)/.test(readSection),
    'the image-only predicate should be scoped by surface, not by enumerating every other page\'s permission',
  )
})

check('POS declares its surface so it is never judged as the Products page', () => {
  const posSrc = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')
  assert.ok(/surface: 'pos'/.test(posSrc), 'POS.tsx must send surface=pos with its catalog query')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
