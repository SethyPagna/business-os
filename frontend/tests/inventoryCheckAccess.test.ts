import assert from 'node:assert/strict'
import { getInventoryCheckAccess, INVENTORY_CHECK_FIELDS } from '../src/utils/inventoryCheckAccess.ts'

// Counting is its own grant (owner, 21 Oct 2026: Full = main access only). Migration 0270 wrote inventory_checks and the field
// switches for every role that used to count through Inventory; nothing here reads Inventory any more. Mirrors the Worker's
// lib/inventoryCheckAccess.ts (cloudflare/scripts/test-inventory-check-access.cjs drives the same table).
const user = (role: Record<string, unknown> = {}, own: Record<string, unknown> = {}, role_code = 'employee') => ({
  role_code, role_permissions: JSON.stringify(role), permissions: JSON.stringify(own),
})
const everyField = Object.fromEntries(INVENTORY_CHECK_FIELDS.map(field => [`inventory_check_show_${field}`, true]))

const hidden = getInventoryCheckAccess(user())
assert.equal(hidden.canView, false)
assert.equal(hidden.canCheck, false)
assert.ok(Object.values(hidden.fields).every(value => value === false))
assert.equal(getInventoryCheckAccess(user({ product_cost_view: true })).canView, false)

// Physical Inventory, at any tier and with every field switch on, grants nothing here.
for (const inventory of [true, 'review']) {
  const stock = getInventoryCheckAccess(user({ inventory, ...everyField }))
  assert.equal(stock.canView, false, `inventory ${String(inventory)} no longer implies counting`)
  assert.equal(stock.canCheck, false)
  assert.ok(Object.values(stock.fields).every(value => value === false))
}

const full = getInventoryCheckAccess(user({ inventory_checks: true, ...everyField }))
assert.equal(full.canView, true)
assert.equal(full.canCheck, true)
assert.ok(INVENTORY_CHECK_FIELDS.filter(field => field !== 'cost').every(field => full.fields[field]))
assert.equal(full.fields.cost, false)
assert.equal(full.canViewCustomerDetails, false)
assert.equal(full.fields.sales, true, 'aggregate sales do not require access to the Sales page')
assert.equal(full.fields.customers, true, 'scalar customer counts do not require Contacts access')

const partial = getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_stock: true }))
assert.equal(partial.canCheck, true)
assert.equal(partial.fields.stock, true)
assert.equal(partial.fields.price, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory_checks:check': false })).canCheck, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory_checks:view': false })).canView, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory:view': false })).canView, true, 'the retired Inventory overrides are not read')
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, 'inventory:check': false })).canCheck, true)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_price: true }, { inventory_check_show_price: false })).fields.price, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_price: false }, { inventory_check_show_price: true })).fields.price, true)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true }, { inventory_check_show_price: 'true' })).fields.price, false, 'only an explicit boolean true shows a field')
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, product_cost_view: true, inventory_check_show_cost: true })).fields.cost, true)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_cost: true })).fields.cost, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, ...everyField, contacts: true })).canViewCustomerDetails, true)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, ...everyField, contacts: true, 'contacts:view': false, 'contacts:add': false, 'contacts:edit': false })).canViewCustomerDetails, false)
assert.equal(getInventoryCheckAccess(user({ inventory_checks: true, ...everyField, contacts: true, 'contacts:view': false })).canViewCustomerDetails, true, 'existing Contacts writes continue to imply View')
for (const admin of [user({}, {}, 'admin'), user({ all: true, 'inventory_checks:view': false, inventory_check_show_cost: false })]) {
  const access = getInventoryCheckAccess(admin)
  assert.ok(access.canView && access.canCheck && access.canViewCustomerDetails)
  assert.ok(Object.values(access.fields).every(Boolean))
}
assert.equal(getInventoryCheckAccess({ username: 'admin' }).canView, false)
const dedicated = getInventoryCheckAccess(user({ inventory_checks: true }))
assert.ok(dedicated.canView && dedicated.canCheck)
assert.ok(Object.values(dedicated.fields).every(value => value === false), 'a metadata grant does not expose stock, costs or customer data implicitly')
assert.equal(getInventoryCheckAccess(user({ inventory: true, inventory_checks: false })).canView, false, 'dedicated denial cannot fall back to physical Inventory authority')
assert.equal(getInventoryCheckAccess(user({ inventory_checks: 'review' })).canCheck, false, 'metadata checks have no approval tier')
console.log('PASS Inventory check access is strict: its own grant, its own switches, nothing implied by Inventory')
