import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS, permissionDefinitionValue } from '../src/components/users/permissionDefinitions.ts'
import { getInventoryCheckAccess } from '../src/utils/inventoryCheckAccess.ts'

const inventory = PERMISSION_SECTIONS.find(section => section.key === 'inventory')!
const fields = inventory.permissions.filter(permission => permission.defaultFromFull === 'inventory')
assert.equal(fields.length, 9)
for (const permission of fields) {
  assert.equal(permissionDefinitionValue(permission, { inventory: true }), true)
  assert.equal(permissionDefinitionValue(permission, { inventory: 'review' }), false)
  assert.equal(permissionDefinitionValue(permission, { inventory: true, [permission.key]: false }), false)
}

const harness = await createHarness()
let changed: Record<string, boolean | 'review' | 'view'> = {}
const props = { permissions: { inventory: true }, onChange: (value: typeof changed) => { changed = value } }
try {
  const surface = await harness.mount({ component: 'components/users/PermissionEditor.tsx', props, app: {}, doubles: {} })
  const section = () => surface.find(node => node.tagName === 'SECTION' && /^Inventory/.test(node.textContent), 'Inventory permission section')
  await surface.click(surface.button('Custom', section()))
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.equal(changed.inventory, true)
  assert.equal(changed.inventory_check_show_stock, false, 'turning off an inherited field must persist false instead of deleting it')
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).fields.stock, false)
  assert.equal(Object.hasOwn(changed, 'inventory_check_show_price'), false, 'editing one field does not materialize unrelated defaults')
  await surface.render({ ...props, permissions: changed })
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.equal(changed.inventory_check_show_stock, true)
  await surface.render({ ...props, permissions: { inventory: 'review' } })
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.equal(changed.inventory, 'review', 'a field toggle preserves Partial Access')
  assert.equal(changed.inventory_check_show_stock, true)
  const access = getInventoryCheckAccess({ permissions: JSON.stringify(changed) })
  assert.equal(access.fields.stock, true)
  assert.equal(access.fields.cost, false, 'field controls never grant acquisition cost access')
  await surface.render({ ...props, permissions: { inventory: true } })
  await surface.click(surface.button('None', section()))
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canView, false)
  await surface.unmount()
  console.log('PASS Inventory permission editor preserves inherited defaults, explicit hidden fields and Partial Access')
} finally { await harness.close() }
