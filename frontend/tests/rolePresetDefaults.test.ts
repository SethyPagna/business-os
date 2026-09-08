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
  "'contacts:financial_history': false",
]) assert.match(seededEmployee, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.match(invariants, /if \(code === 'admin'\)/, 'only Admin may be force-reset by core invariants')

console.log('PASS Employee defaults grant individual Sales work and keep bulk, export, import, and contact finance denied')
