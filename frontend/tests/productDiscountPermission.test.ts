// Owner ruling, 6 Oct 2026 (release security review P2-2): a product-level discount is a price change, so it needs
// the same `products:price` action as the default selling and wholesale price. The Worker refuses a CHANGED
// discount value (routes/products.ts + lib/productDiscountGate.ts); an unchanged block still saves, because the
// editors post the whole block back. Cart discounts at sale time are a different thing and stay as they were.
//
//   FIELDS  the Worker's price-bearing discount columns are exactly what the editors write (label and colour are not price)
//   GATE    the only discount editor (Promotions > Discounts) and its hub tile need Edit product AND the price action
//   FORM    ProductForm has no discount inputs to disable: it only carries the stored block back unchanged
//   ROLES   the Employee preset cannot reach the editor; a Manager and an administrator can
//
// Run: node tests/productDiscountPermission.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectivePermissions, type PermissionUser } from '../src/utils/permissions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { getHubDestinations } from '../src/components/shared/hubNavigation.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').split('\r\n').join('\n')
const worker = read('../../cloudflare/src/lib/productDiscountGate.ts')
const page = read('../src/components/promotions/PromotionsPage.tsx')
const form = read('../src/components/products/forms/ProductForm.tsx')

let failed = 0
function test(name: string, run: () => void) {
  try { run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}

const workerFields = (() => {
  const match = worker.match(/PRODUCT_DISCOUNT_PRICE_FIELDS = \[([^\]]+)\] as const/)
  assert.ok(match, 'the Worker declares PRODUCT_DISCOUNT_PRICE_FIELDS')
  return match![1].split(',').map((part) => part.trim().replace(/['"]/g, '')).filter(Boolean)
})()

test('FIELDS: every price-bearing discount column the Worker gates is one the Promotions editor writes', () => {
  assert.deepEqual([...workerFields].sort(), [
    'discount_amount_khr', 'discount_amount_usd', 'discount_enabled', 'discount_ends_at', 'discount_percent', 'discount_starts_at', 'discount_type',
  ])
  const saveStart = page.indexOf('await updateProduct(discountDraft.product.id, {')
  assert.ok(saveStart > 0, 'the editor saves through updateProduct')
  const payload = page.slice(saveStart, page.indexOf('})', saveStart))
  for (const field of workerFields) assert.ok(payload.includes(`${field}:`), `the editor writes ${field}`)
})

test('GATE: the discount editor needs View, Edit product and the price action; its hub tile mirrors it', () => {
  assert.match(page, /const canManageDiscounts = can\('products', 'view'\) && can\('products', 'edit'\) && can\('products', 'price'\)/)
  const hub = read('../src/components/shared/hubNavigation.ts')
  assert.match(hub, /\['discounts', 'promo_tab_discounts', 'Discounts', can\('products'\) && act\('products', 'edit'\) && act\('products', 'price'\)\]/)
})

test('FORM: ProductForm has no discount inputs; it carries the loaded block back so a save changes nothing', () => {
  assert.equal(/name="discount_|id="discount_|value=\{form\.discount_/.test(form), false, 'an input appeared: disable it behind canEditPrices like the price blocks')
  assert.match(form, /discount_enabled: form\.discount_enabled \? 1 : 0,/)
  assert.match(form, /discount_percent: parseNumericInput\(form\.discount_percent\),/)
})

const access = (user: PermissionUser) => {
  const { can, getPermissionTier } = effectivePermissions(user)
  return getHubDestinations('promotions', { getPermissionTier, hasPermission: () => false, can }).map((item) => item.id)
}
test('ROLES: the Employee preset is not offered the discount editor; a Manager and an administrator are', () => {
  const employee: PermissionUser = { role_code: 'employee', permissions: ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions }
  const manager: PermissionUser = { role_code: 'manager', permissions: ROLE_PRESETS.find((preset) => preset.key === 'manager')!.permissions }
  assert.equal(access(employee).includes('discounts'), false)
  assert.equal(access(manager).includes('discounts'), true)
  assert.equal(access({ role_code: 'admin', permissions: {} }).includes('discounts'), true)
  assert.equal(access({ role_code: 'manager', permissions: { products: true, 'products:price': false } }).includes('discounts'), false)
  assert.equal(access({ role_code: 'employee', permissions: { ...employee.permissions as object, 'products:price': true } }).includes('discounts'), true, 'an admin can grant the price action to a named employee')
})

if (failed) process.exit(1)
console.log('productDiscountPermission: all checks passed')
