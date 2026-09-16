import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'

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
for (const unrelated of ['dashboard:', 'customer_portal:', 'products:', 'inventory:']) {
  assert.doesNotMatch(seededEmployee, new RegExp(unrelated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `fresh runtime Employee seed must not add unrelated ${unrelated}`)
}
assert.match(invariants, /if \(code === 'admin'\)/, 'only Admin may be force-reset by core invariants')

console.log('PASS Employee defaults grant individual Sales/Returns work and keep bulk, export, import, and contact finance denied')
