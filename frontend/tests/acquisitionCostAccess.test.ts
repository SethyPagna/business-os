import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canViewAcquisitionCosts, canEditAcquisitionCosts, holdsCostViewGrant, holdsCostEditGrant, omitUnauthorizedCatalogCosts } from '../src/utils/acquisitionCostAccess.ts'
import { buildProductExportRows } from '../src/components/products/helpers/productExport.ts'

// Owner, 17 Nov 2026 (reverses 15 Nov): cost is admin only BY DEFAULT and follows the two grants. A non-admin sees cost and profit
// with product_cost_view and writes a cost with product_cost_edit; neither implies the other. The admin below is the control.
for (const view of [false, true]) for (const edit of [false, true]) {
  const user = { permissions: { products: true, inventory: true, product_cost_view: view, product_cost_edit: edit } }
  assert.equal(canViewAcquisitionCosts(user), view)
  assert.equal(canEditAcquisitionCosts(user), edit)
  assert.equal(holdsCostViewGrant(user), view)
  assert.equal(holdsCostEditGrant(user), edit)
  const input = { name: 'Updated name', cost_price_usd: 5, purchase_price_khr: 20000, selling_price_usd: 8 }
  const payload = omitUnauthorizedCatalogCosts(input, user)
  assert.equal('cost_price_usd' in payload, edit)
  assert.equal('purchase_price_khr' in payload, edit)
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
assert.equal(canViewAcquisitionCosts({ role_permissions: { product_cost_view: true } }), true, 'a role grant reaches its users')
assert.equal(canEditAcquisitionCosts({ role_permissions: { product_cost_edit: true } }), true)
assert.equal(canEditAcquisitionCosts({ role_permissions: { product_cost_view: true } }), false, 'view does not imply edit')
assert.equal(canViewAcquisitionCosts({ role_code: 'employee', permissions: { product_cost_view: false }, role_permissions: { all: false } }), false, 'an explicit false is a no')
assert.equal('cost_price_usd' in omitUnauthorizedCatalogCosts({ cost_price_usd: 5 }, { role_code: 'admin' }), true, 'an administrator keeps the cost fields')
const redacted = buildProductExportRows([{ name: 'Redacted' }], { canViewCosts: true })[0]
assert.ok(!('Cost_Price_USD' in redacted), 'redacted API values never become zero-valued export cells')
const form = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
assert.match(form, /omitUnauthorizedCatalogCosts<ProductSavePayload>/)
assert.match(form, /fieldset disabled=\{!canEditCosts\}/)
assert.match(form, /canViewCosts && activeTab === 'pricing'/)
console.log('PASS independent acquisition-cost grants, admin override, payload omission and redacted exports')
