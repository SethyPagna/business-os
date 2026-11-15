import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canViewAcquisitionCosts, canEditAcquisitionCosts, holdsCostViewGrant, holdsCostEditGrant, omitUnauthorizedCatalogCosts } from '../src/utils/acquisitionCostAccess.ts'
import { buildProductExportRows } from '../src/components/products/helpers/productExport.ts'

// Owner, 15 Nov 2026: cost is ADMIN ONLY. The two grants give a non-admin nothing, whatever they say; the admin below is the control.
for (const view of [false, true]) for (const edit of [false, true]) {
  const user = { permissions: { products: true, inventory: true, product_cost_view: view, product_cost_edit: edit } }
  assert.equal(canViewAcquisitionCosts(user), false)
  assert.equal(canEditAcquisitionCosts(user), false)
  assert.equal(holdsCostViewGrant(user), view, 'the switch-back still reads the stored grant')
  assert.equal(holdsCostEditGrant(user), edit)
  const input = { name: 'Updated name', cost_price_usd: 5, purchase_price_khr: 20000, selling_price_usd: 8 }
  const payload = omitUnauthorizedCatalogCosts(input, user)
  assert.equal('cost_price_usd' in payload, false)
  assert.equal('purchase_price_khr' in payload, false)
  assert.equal(payload.name, 'Updated name')
  assert.equal(input.cost_price_usd, 5, 'input and cached snapshots are not mutated')
  const row = buildProductExportRows([{ name: 'Item', cost_price_usd: 5, cost_price_khr: 20000 }], { canViewCosts: view })[0]
  assert.equal('Cost_Price_USD' in row, view)
}
for (const user of [null, {}, { permissions: { products: true, inventory: true } }, { permissions: { product_cost_view: 'true', product_cost_edit: 'review' } }]) {
  assert.equal(canViewAcquisitionCosts(user), false)
  assert.equal(canEditAcquisitionCosts(user), false)
}
// The seeded admin as its session carries it: control comes from the admin
// role, not the name (FX-sec).
for (const user of [{ username: 'admin', role_code: 'admin', role_permissions: '{"all":true}' }, { role_code: 'admin' }, { permissions: { all: true, product_cost_view: false, product_cost_edit: false } }]) {
  assert.equal(canViewAcquisitionCosts(user), true)
  assert.equal(canEditAcquisitionCosts(user), true)
}
assert.equal(canViewAcquisitionCosts({ role_permissions: { product_cost_view: true }, permissions: { product_cost_view: false } }), false)
assert.equal(canViewAcquisitionCosts({ role_permissions: { product_cost_view: true } }), false, 'a role grant alone shows nothing')
assert.equal('cost_price_usd' in omitUnauthorizedCatalogCosts({ cost_price_usd: 5 }, { role_code: 'admin' }), true, 'an administrator keeps the cost fields')
const redacted = buildProductExportRows([{ name: 'Redacted' }], { canViewCosts: true })[0]
assert.ok(!('Cost_Price_USD' in redacted), 'redacted API values never become zero-valued export cells')
const form = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
assert.match(form, /omitUnauthorizedCatalogCosts<ProductSavePayload>/)
assert.match(form, /fieldset disabled=\{!canEditCosts\}/)
assert.match(form, /canViewCosts && activeTab === 'pricing'/)
console.log('PASS independent acquisition-cost permissions, admin override, payload omission and redacted exports')
