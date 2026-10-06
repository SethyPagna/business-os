import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canAddProductVariant, canAdjustAllProductPrices } from '../src/utils/productActionAccess.ts'
import { getActionTier, getPermissionTier } from '../../cloudflare/src/lib/permissions.ts'

// PROD-PERM (loophole review 6 Oct 2026, N6 and N8). "Apply to ALL products in the system" ignored the Edit product
// switch and "Add variant" ignored the Add variant and Add product switches, on the server AND in the UI (the detail
// modal gated Add variant on Add product alone, the row menu on nothing). The Worker now checks the action tiers; the
// UI helpers must give the same answer for every role, so a hidden control is one the API refuses and a shown control
// is one it accepts. The Worker's own expressions are evaluated here against the real server kernel, not re-typed.

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const staff = (grants: Record<string, unknown>) => ({
  id: 21, username: 'staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}',
})
const admin = { id: 7, username: 'admin', role_code: 'admin', role_permissions: '{}', permissions: JSON.stringify({ all: true }) }

// The same expressions as cloudflare/src/routes/products.ts (pinned verbatim below).
const serverAllowsVariant = (user: ReturnType<typeof staff>) =>
  !(getActionTier(user, 'products', 'variant') !== 'full' || getActionTier(user, 'products', 'add') !== 'full')
const serverAllowsAdjustAll = (user: ReturnType<typeof staff>) =>
  !(getPermissionTier(user, 'products') !== 'full' || getActionTier(user, 'products', 'edit') !== 'full')

const ROLES: Array<[string, Record<string, unknown>, { variant: boolean; adjustAll: boolean }]> = [
  ['Products Full', { products: true }, { variant: true, adjustAll: true }],
  ['Edit product off', { products: true, 'products:edit': false }, { variant: true, adjustAll: false }],
  ['Add variant off', { products: true, 'products:variant': false }, { variant: false, adjustAll: true }],
  ['Add product off', { products: true, 'products:add': false }, { variant: false, adjustAll: true }],
  ['Employee-style: add, variant, price off', { products: true, 'products:add': false, 'products:variant': false }, { variant: false, adjustAll: true }],
  ['Review Required', { products: 'review' }, { variant: false, adjustAll: false }],
  ['View only products', { products: 'view' }, { variant: false, adjustAll: false }],
  ['No Products', {}, { variant: false, adjustAll: false }],
]

runTest('the UI helpers return the expected answer for every role shape', () => {
  for (const [label, grants, expected] of ROLES) {
    assert.equal(canAddProductVariant(staff(grants)), expected.variant, `${label}: add variant`)
    assert.equal(canAdjustAllProductPrices(staff(grants)), expected.adjustAll, `${label}: adjust all prices`)
  }
  assert.equal(canAddProductVariant(admin), true)
  assert.equal(canAdjustAllProductPrices(admin), true)
  assert.equal(canAddProductVariant(null), false)
  assert.equal(canAdjustAllProductPrices(undefined), false)
})

runTest('the UI helpers agree with the Worker for every role shape (hidden = refused, shown = accepted)', () => {
  for (const [label, grants] of ROLES) {
    const user = staff(grants)
    assert.equal(canAddProductVariant(user), serverAllowsVariant(user), `${label}: variant parity`)
    assert.equal(canAdjustAllProductPrices(user), serverAllowsAdjustAll(user), `${label}: adjust-all parity`)
  }
})

const productsRoute = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const lookupsRoute = readFileSync(new URL('../../cloudflare/src/routes/lookups.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const productsPage = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function routeBlock(source: string, start: string): string {
  const at = source.indexOf(start)
  assert.ok(at >= 0, `route ${start} exists`)
  return source.slice(at, at + 1400)
}

runTest('the Worker routes carry the exact gates the helpers mirror', () => {
  assert.match(routeBlock(productsRoute, "app.post('/bulk-price-adjust'"),
    /getPermissionTier\(user, 'products'\) !== 'full' \|\| getActionTier\(user, 'products', 'edit'\) !== 'full'/)
  const variant = routeBlock(productsRoute, "app.post('/variant'")
  assert.match(variant, /getActionTier\(user, 'products', 'variant'\) !== 'full' \|\| getActionTier\(user, 'products', 'add'\) !== 'full'/)
  assert.doesNotMatch(variant, /hasPermission\(user, 'products'\)/, 'the section grant alone no longer decides /variant')
  assert.match(routeBlock(productsRoute, "app.post('/bulk-delete-jobs/:id/cancel'"), /getActionTier\(user, 'products', 'bulk_delete'\) !== 'full'/)
  assert.match(lookupsRoute, /getActionTier\(c\.get\('user'\), 'products', 'manage_lookups'\) !== 'full'/)
  assert.doesNotMatch(lookupsRoute, /hasPermission/, 'every lookup write goes through the action check')
})

runTest('the Products page gates Add variant and Apply to ALL on the helpers, everywhere they appear', () => {
  assert.match(productsPage, /const canAddVariant = canAddProductVariant\(user\)/)
  assert.match(productsPage, /const canAdjustAllPrices = canAdjustAllProductPrices\(user\)/)
  assert.match(productsPage, /onAddVariant=\{canAddVariant \? /, 'the detail modal no longer offers Add variant on Add product alone')
  assert.doesNotMatch(productsPage, /onAddVariant=\{canAddProduct/)
  assert.match(productsPage, /\.\.\.\(canAddVariant \? \[\{ label: tr\('add_variant'/, 'the row menu entry is conditional')
  assert.match(productsPage, /\}, \[canAddVariant, openProductFormTab, tr\]\)/, 'the memoized row menu re-renders when the permission changes')
  assert.match(productsPage, /\{canAdjustAllPrices \? \(\s*<button[^>]*\s[^>]*onClick=\{runBulkPriceAdjustAllProducts\}/s, 'the catalog-wide button is conditional')
  assert.equal(productsPage.match(/setVariantModal\(/g)?.length, 4, 'setVariantModal callers: the two gated entries, the close, and the modal reset')
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
