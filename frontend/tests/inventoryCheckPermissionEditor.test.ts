import assert from 'node:assert/strict'
import { createHarness, type MemoryNode } from './mountedComponentHarness.ts'
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
  // The count fields live on the Inventory check sessions row, which follows Inventory while it is not set.
  const within = (node: MemoryNode, root: MemoryNode): boolean => { for (let current: MemoryNode | null = node; current; current = current.parentNode) if (current === root) return true; return false }
  const moduleRow = (id: string) => surface.find(node => node.getAttribute('data-perm-module') === id, `${id} row`)
  const section = () => moduleRow('inventory_checks')
  const openSessions = async () => {
    const toggle = surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, section()), 'sessions row toggle')
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  await openSessions()
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
  assert.equal(changed.inventory, 'review', 'a field toggle preserves Review')
  assert.equal(changed.inventory_check_show_stock, true)
  const access = getInventoryCheckAccess({ permissions: JSON.stringify(changed) })
  assert.equal(access.fields.stock, true)
  assert.equal(access.fields.cost, false, 'field controls never grant acquisition cost access')
  await surface.render({ ...props, permissions: { inventory: true } })
  const levelDot = (id: string, level: string) => surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') === level && within(node, moduleRow(id)), `${id} ${level} dot`)
  await surface.click(levelDot('inventory', 'none'))
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canView, false)
  // None on the sessions row while Inventory is on must DENY counting: the Worker and the page read whether the key is
  // present, so a deleted key would silently hand counting back to Inventory.
  await surface.render({ ...props, permissions: { inventory: true } })
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify({ inventory: true }) }).canView, true, 'control: following Inventory can count')
  await surface.click(levelDot('inventory_checks', 'none'))
  assert.deepEqual(changed, { inventory: true, inventory_checks: false })
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canView, false, 'a stored false denies counting even with Inventory on')
  await surface.unmount()
  console.log('PASS Inventory permission editor preserves inherited defaults, explicit hidden fields and Review')
} finally { await harness.close() }
