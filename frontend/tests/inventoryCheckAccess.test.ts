import assert from 'node:assert/strict'
import { getInventoryCheckAccess, INVENTORY_CHECK_FIELDS } from '../src/utils/inventoryCheckAccess.ts'

const user = (role: Record<string, unknown> = {}, own: Record<string, unknown> = {}, role_code = 'employee') => ({
  role_code, role_permissions: JSON.stringify(role), permissions: JSON.stringify(own),
})

const hidden = getInventoryCheckAccess(user())
assert.equal(hidden.canView, false)
assert.equal(hidden.canCheck, false)
assert.ok(Object.values(hidden.fields).every(value => value === false))
assert.equal(getInventoryCheckAccess(user({ product_cost_view: true })).canView, false)

const full = getInventoryCheckAccess(user({ inventory: true }))
assert.equal(full.canView, true)
assert.equal(full.canCheck, true)
assert.ok(INVENTORY_CHECK_FIELDS.filter(field => field !== 'cost').every(field => full.fields[field]))
assert.equal(full.fields.cost, false)
assert.equal(full.canViewCustomerDetails, false)
assert.equal(full.fields.sales, true, 'aggregate sales do not require access to the Sales page')
assert.equal(full.fields.customers, true, 'scalar customer counts do not require Contacts access')

const partial = getInventoryCheckAccess(user({ inventory: 'review', inventory_check_show_stock: true }))
assert.equal(partial.canCheck, true)
assert.equal(partial.fields.stock, true)
assert.equal(partial.fields.price, false)
assert.equal(getInventoryCheckAccess(user({ inventory: 'review', 'inventory:check': false })).canCheck, false)
assert.equal(getInventoryCheckAccess(user({ inventory: true, 'inventory:view': false })).canCheck, false)
assert.equal(getInventoryCheckAccess(user({ inventory: true, inventory_check_show_price: true }, { inventory_check_show_price: false })).fields.price, false)
assert.equal(getInventoryCheckAccess(user({ inventory: 'review', inventory_check_show_price: false }, { inventory_check_show_price: true })).fields.price, true)
assert.equal(getInventoryCheckAccess(user({ inventory: true }, { inventory_check_show_price: 'false' })).fields.price, true, 'only explicit booleans override field defaults')
assert.equal(getInventoryCheckAccess(user({ inventory: 'review', product_cost_view: true, inventory_check_show_cost: true })).fields.cost, true)
assert.equal(getInventoryCheckAccess(user({ inventory: true, inventory_check_show_cost: true })).fields.cost, false)
assert.equal(getInventoryCheckAccess(user({ inventory: true, contacts: true })).canViewCustomerDetails, true)
assert.equal(getInventoryCheckAccess(user({ inventory: true, contacts: true, 'contacts:view': false, 'contacts:add': false, 'contacts:edit': false })).canViewCustomerDetails, false)
assert.equal(getInventoryCheckAccess(user({ inventory: true, contacts: true, 'contacts:view': false })).canViewCustomerDetails, true, 'existing Contacts writes continue to imply View')
for (const admin of [user({}, {}, 'admin'), user({ all: true, 'inventory:view': false, inventory_check_show_cost: false })]) {
  const access = getInventoryCheckAccess(admin)
  assert.ok(access.canView && access.canCheck && access.canViewCustomerDetails)
  assert.ok(Object.values(access.fields).every(Boolean))
}
assert.equal(getInventoryCheckAccess({ username: 'admin' }).canView, false)
const dedicated = getInventoryCheckAccess(user({ inventory_checks: true }))
assert.ok(dedicated.canView && dedicated.canCheck)
assert.ok(Object.values(dedicated.fields).every(value => value === false), 'a metadata grant does not expose stock, costs or customer data implicitly')
assert.equal(getInventoryCheckAccess(user({ inventory: true, inventory_checks: false })).canView, false, 'dedicated denial cannot fall back to physical Inventory authority')
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory_checks:view': false })).canView, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory_checks:check': false })).canCheck, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: 'review' })).canCheck, false, 'metadata checks have no approval tier')
console.log('PASS Inventory check field defaults, explicit grants, page/action boundaries and customer-detail dependencies')
