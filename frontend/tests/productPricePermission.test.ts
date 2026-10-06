// Owner, 5 Oct 2026 (evening revision):
//   - a merge applies the standing rule on its own (highest selling + wholesale price, weighted cost, the barcode
//     without leading zeros) and needs no permission; only a MANUAL pick of a price other than the rule needs
//     Edit product (full tier) AND the price action (cloudflare/scripts/test-merge-price-rule-native.cjs);
//   - the Employee default edits product information and images but never a product's default selling or wholesale
//     price (the action `products:price` is off in the preset and in the seed), and the form shows those fields
//     read-only with a translated tooltip.
//
//   UTIL    canChangeProductPrices / canOverrideMergePrice mirror the Worker gates
//   PRESET  the Employee preset keeps view, edit and image but not price, and the seed matches the preset
//   PACKS   every new string exists in BOTH language packs
//   SOURCE  the form fields are read-only behind the util, with the tooltip
//
// Run: node tests/productPricePermission.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canChangeProductPrices, canOverrideMergePrice } from '../src/utils/productMergePriceAccess.ts'
import { effectivePermissions, type PermissionUser } from '../src/utils/permissions.ts'
import { PERMISSION_ACTIONS } from '../src/utils/permissionActions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'

const MERGER: PermissionUser = { role_code: 'manager', permissions: { products: true, 'products:edit': false } }
const EDITOR: PermissionUser = { role_code: 'manager', permissions: { products: true } }
const NO_PRICE: PermissionUser = { role_code: 'manager', permissions: { products: true, 'products:price': false } }
const PARTIAL: PermissionUser = { role_code: 'manager', permissions: { products: 'review' } }
const ADMIN: PermissionUser = { role_code: 'admin', permissions: { products: true, 'products:edit': false, 'products:price': false } }
const NO_PRODUCTS: PermissionUser = { role_code: 'manager', permissions: {} }
const EMPLOYEE: PermissionUser = { role_code: 'employee', permissions: ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions }

let failed = 0
function test(name: string, run: () => void) {
  try { run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}

test('UTIL: changing a default price needs Edit product AND the price action', () => {
  assert.equal(canChangeProductPrices(EDITOR), true)
  assert.equal(canChangeProductPrices(ADMIN), true, 'administrator control is never narrowed')
  assert.equal(canChangeProductPrices(EMPLOYEE), false, 'the employee default may edit information, not the price')
  assert.equal(canChangeProductPrices(NO_PRICE), false)
  assert.equal(canChangeProductPrices(MERGER), false)
  assert.equal(canChangeProductPrices(NO_PRODUCTS), false)
  assert.equal(canChangeProductPrices(null), false)
})

test('UTIL: a merge price override also needs FULL tier; the rule itself needs nothing', () => {
  assert.equal(canOverrideMergePrice(EDITOR), true)
  assert.equal(canOverrideMergePrice(ADMIN), true)
  assert.equal(canOverrideMergePrice(EMPLOYEE), false)
  assert.equal(canOverrideMergePrice(NO_PRICE), false)
  assert.equal(canOverrideMergePrice(MERGER), false)
  assert.equal(canOverrideMergePrice(PARTIAL), false, 'Partial access queues edits; the Worker needs FULL')
  assert.equal(canOverrideMergePrice(NO_PRODUCTS), false)
  assert.equal(canOverrideMergePrice(null), false)
  assert.equal(canOverrideMergePrice({ role_code: 'manager', role_permissions: { products: true }, permissions: { 'products:price': false } }), false, 'a user override beats the role')
})

test('PRESET: the Employee default keeps view, edit and image and loses price; cost stays hidden', () => {
  const { can } = effectivePermissions(EMPLOYEE)
  assert.equal(can('products', 'view'), true)
  assert.equal(can('products', 'edit'), true)
  assert.equal(can('products', 'image'), true)
  assert.equal(can('products', 'price'), false)
  for (const action of ['add', 'delete', 'bulk_delete', 'variant', 'import', 'export', 'merge_duplicates', 'zero_qty_cleanup', 'manage_lookups']) assert.equal(can('products', action), false, action)
  assert.equal((EMPLOYEE.permissions as Record<string, unknown>).product_cost_view, false)
  assert.equal((EMPLOYEE.permissions as Record<string, unknown>).product_cost_edit, false)
  assert.ok(PERMISSION_ACTIONS.products.some((row) => row.key === 'price' && row.tKey === 'perm_act_products_price'))
})

test('PRESET: the Worker seed row switches the same price action off', () => {
  const seed = readFileSync(new URL('../../cloudflare/src/lib/coreDataInvariants.ts', import.meta.url), 'utf8')
  assert.match(seed, /'products:price': false,/)
})

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL('../src/lang/' + lang + '.json', import.meta.url), 'utf8')) as Record<string, string>]))
test('PACKS: every new string exists in both languages and Khmer is translated', () => {
  for (const key of ['perm_act_products_price', 'product_price_read_only', 'resolve_price_locked', 'merge_needs_product_edit']) {
    assert.ok(packs.en[key], 'en ' + key)
    assert.ok(packs.km[key], 'km ' + key)
    assert.notEqual(packs.en[key], packs.km[key], key + ' is translated')
    assert.match(packs.km[key], /[ក-៿]/, key + ' is Khmer script')
  }
  for (const key of ['merge_price_needs_edit', 'selected_conflict_product_edit_permission_required']) {
    assert.equal(packs.en[key], undefined, 'the retired refusal string ' + key + ' is gone (en)')
    assert.equal(packs.km[key], undefined, 'the retired refusal string ' + key + ' is gone (km)')
  }
})

test('SOURCE: the product form makes both price fields read-only behind the util, with the tooltip', () => {
  const form = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8').replace(/\r/g, '')
  assert.match(form, /const canEditPrices = canChangeProductPrices\(user\)/)
  assert.equal((form.match(/<fieldset disabled=\{!canEditPrices\} title=\{priceReadOnlyTip\}/g) || []).length, 2, 'selling and wholesale')
  assert.match(form, /tr\('product_price_read_only'/)
})

test('SOURCE: the merge dialog no longer gates automatic merges', () => {
  const dialog = readFileSync(new URL('../src/components/products/MergeStockChoiceDialog.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(dialog, /canCopyMergePrice|canOverrideMergePrice|confirmDisabledReason/)
})

process.exitCode = failed ? 1 : 0
