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
assert.equal(employee.permissions.contacts, true, 'Employee Contacts is Full (owner, 20 Oct 2026)')
assert.equal(employee.permissions['contacts:bulk'], false)
assert.equal(employee.permissions['contacts:financial_history'], false)
assert.equal(employee.permissions.contacts_suppliers, false)
// Owner, 5 Oct 2026: Employee on Products = view, product information edits and image upload, never costs.
// (products:supplier, 19 Oct 2026, is off too.)
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
// The POS action row for pos:manage_address_presets narrows nothing by default: an absent key leaves the POS
// grant standing, so the Employee preset (and the Employee already stored) keeps managing saved addresses.
assert.equal(Object.hasOwn(employee.permissions, 'pos:manage_address_presets'), false)
assert.equal(employeeAuthority.can('pos', 'manage_address_presets'), true)
assert.equal(employee.permissions.all, undefined)
assert.equal(employee.permissions.settings, undefined)
assert.equal(employee.permissions.backup_restore, undefined)

// The one-click Employee preset EQUALS the server seed (cloudflare/src/lib/roleDefaults.ts): the same map, key for key. It is
// read from the source, not copied, so a change to either side that is not made to the other fails here. Fresh databases seed
// that map; existing role rows remain editable because core invariants only force-rewrite Admin.
const roleDefaults = fs.readFileSync(new URL('../../cloudflare/src/lib/roleDefaults.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const seedOpen = roleDefaults.indexOf('= {', roleDefaults.indexOf('const DEFAULT_ROLE_PERMISSIONS')) + 2
const seedMap = new Function('return ' + roleDefaults.slice(seedOpen, roleDefaults.indexOf('\n}\n', seedOpen) + 2))() as Record<string, Record<string, unknown>>
assert.ok(seedMap.employee && seedMap.admin, 'the Employee seed was read from roleDefaults.ts')
assert.deepEqual(employee.permissions, seedMap.employee, 'the Employee preset equals the Employee seed')
// The owner decisions that map encodes (5 Oct, 16 Sep, 19-20 Oct 2026).
assert.equal(Object.hasOwn(employee.permissions, 'dashboard'), false, 'Dashboard is off by default')
assert.equal(Object.hasOwn(employee.permissions, 'inventory'), false, 'an Employee never writes physical stock')
assert.equal(employee.permissions['products:supplier'], false)
assert.equal(employee.permissions['products:price'], false)
assert.equal(employee.permissions.receipt_settings, true)
const invariants = fs.readFileSync(new URL('../../cloudflare/src/lib/coreDataInvariants.ts', import.meta.url), 'utf8')
assert.match(invariants, /from '\.\/roleDefaults'/, 'the Worker seeds from roleDefaults.ts')
// Release review P2-1 (6 Oct 2026): the live Employee row has no Website Editor grant, so a preset-created Employee must
// not have one either -- the storefront announcement strip and posts are public content (routes/promotions.ts requireWebsiteEditor).
for (const grant of ['customer_portal', 'portal_posts', 'portal_faq', 'portal_about', 'settings']) {
  assert.equal(Object.hasOwn(employee.permissions, grant), false, 'the Employee preset must not carry ' + grant)
}
const stripKeys = ['portal_posts', 'customer_portal', 'settings'] // the Worker's WEBSITE_EDITOR_STRIP_KEYS
assert.equal(stripKeys.some((key) => (employee.permissions as Record<string, unknown>)[key] === true), false, 'a preset-created Employee cannot manage announcement strip cards')
assert.doesNotMatch(employee.description, /Website Editor/, 'the description no longer promises it')
assert.match(invariants, /if \(code === 'admin'\)/, 'only Admin may be force-reset by core invariants')

console.log('PASS Employee defaults grant individual Sales/Returns work and keep bulk, export, import, and contact finance denied')
