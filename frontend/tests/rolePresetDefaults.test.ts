import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { canViewAcquisitionCosts, canEditAcquisitionCosts } from '../src/utils/acquisitionCostAccess.ts'
import { PERMISSION_ACTIONS } from '../src/utils/permissionActions.ts'

const employee = ROLE_PRESETS.find((preset) => preset.key === 'employee')
assert.ok(employee, 'Employee preset must exist')
assert.equal(employee.permissions.sales, true, 'Employee must receive the Sales page')
for (const action of ['status', 'customer', 'add_items', 'amend']) {
  assert.equal(employee.permissions[`sales:${action}`], true, `Employee must receive individual sales action ${action}`)
}
for (const action of ['bulk', 'import', 'export']) {
  assert.equal(employee.permissions[`sales:${action}`], false, `Employee must not receive sales action ${action}`)
}
assert.equal(employee.permissions.returns, true, 'Employee must receive individual Returns actions')
for (const action of ['bulk', 'export']) {
  assert.equal(employee.permissions[`returns:${action}`], false, `Employee must not receive returns action ${action}`)
}
assert.equal(employee.permissions.contacts, 'review', 'Employee contact changes remain Partial Access')
assert.equal(employee.permissions['contacts:bulk'], false)
assert.equal(employee.permissions['contacts:financial_history'], false)
assert.equal(employee.permissions.contacts_suppliers, false)
// Owner, 5 Oct 2026: Employee on Products = view, product information edits and image upload, never costs.
const ALLOWED_PRODUCT_ACTIONS = ['view', 'edit', 'image']
assert.equal(employee.permissions.products, true, 'Employee products is Full tier so image upload is not blocked; every other action is switched off below')
assert.equal(employee.permissions.product_cost_view, false, 'cost price is never visible by default')
assert.equal(employee.permissions.product_cost_edit, false, 'cost price is never editable by default')
const employeeUser = { role_code: 'employee', permissions: employee.permissions }
assert.equal(canViewAcquisitionCosts(employeeUser), false)
assert.equal(canEditAcquisitionCosts(employeeUser), false)
const employeeAuthority = effectivePermissions(employeeUser)
for (const action of PERMISSION_ACTIONS.products) {
  assert.equal(employeeAuthority.can('products', action.key), ALLOWED_PRODUCT_ACTIONS.includes(action.key), 'Employee products action ' + action.key)
}
assert.equal(employee.permissions.all, undefined)
assert.equal(employee.permissions.settings, undefined)
assert.equal(employee.permissions.backup_restore, undefined)

// Fresh databases must seed the same safe Employee baseline. Existing role
// rows remain editable because core invariants only force-rewrite Admin.
const invariants = fs.readFileSync(new URL('../../cloudflare/src/lib/coreDataInvariants.ts', import.meta.url), 'utf8')
const employeeStart = invariants.indexOf('employee: {')
const employeeEnd = invariants.indexOf('\n  },', employeeStart)
assert.ok(employeeStart >= 0 && employeeEnd > employeeStart)
const seededEmployee = invariants.slice(employeeStart, employeeEnd)
for (const fragment of [
  'sales: true',
  "'sales:status': true",
  "'sales:customer': true",
  "'sales:add_items': true",
  "'sales:amend': true",
  "'sales:bulk': false",
  "'sales:import': false",
  "'sales:export': false",
  'returns: true',
  "'returns:bulk': false",
  "'returns:export': false",
  "contacts: 'review'",
  "'contacts:bulk': false",
  "'contacts:financial_history': false",
  'contacts_suppliers: false',
]) assert.match(seededEmployee, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const fragment of [
  'products: true',
  "'products:add': false",
  "'products:delete': false",
  "'products:bulk_delete': false",
  "'products:variant': false",
  "'products:import': false",
  "'products:import_replace_all': false",
  "'products:export': false",
  "'products:merge_duplicates': false",
  "'products:zero_qty_cleanup': false",
  "'products:manage_lookups': false",
  'product_cost_view: false',
  'product_cost_edit: false',
]) assert.match(seededEmployee, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the fresh Employee seed carries ' + fragment)
// The seed and the one-click preset must say the same thing about Products and costs.
for (const key of Object.keys(employee.permissions).filter((name) => name === 'products' || name.startsWith('products:') || name.startsWith('product_cost_'))) {
  const expected: string = JSON.stringify(employee.permissions[key])
  const seeded: RegExpMatchArray | null = seededEmployee.match(new RegExp("(?:'" + key + "'|" + key + "): ([^,\\n]+),"))
  assert.ok(seeded, 'seed carries ' + key)
  assert.equal(seeded[1].replace(/'/g, '"'), expected, 'seed and preset agree on ' + key)
}
for (const unrelated of ['dashboard:', 'customer_portal:', 'inventory:']) {
  assert.doesNotMatch(seededEmployee, new RegExp(unrelated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `fresh runtime Employee seed must not add unrelated ${unrelated}`)
}
assert.match(invariants, /if \(code === 'admin'\)/, 'only Admin may be force-reset by core invariants')

console.log('PASS Employee defaults grant individual Sales/Returns work and keep bulk, export, import, and contact finance denied')
