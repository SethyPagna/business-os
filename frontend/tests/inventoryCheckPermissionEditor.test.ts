import assert from 'node:assert/strict'
import { createHarness, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { getInventoryCheckAccess } from '../src/utils/inventoryCheckAccess.ts'

// Counting is its own grant (owner, 21 Oct 2026: Full = main access only). The nine field switches are plain on/off grants on the
// Inventory check sessions row: absent is off, nothing is inherited from Inventory, and toggling one writes only that key.
const inventory = PERMISSION_SECTIONS.find(section => section.key === 'inventory')!
const fields = inventory.permissions.filter(permission => permission.key.startsWith('inventory_check_show_'))
assert.equal(fields.length, 9)
for (const permission of fields) assert.equal(Object.hasOwn(permission, 'defaultFromFull'), false, `${permission.key} inherits nothing from Inventory`)

const harness = await createHarness()
let changed: Record<string, boolean | 'review' | 'view'> = {}
const props = { permissions: { inventory_checks: true }, onChange: (value: typeof changed) => { changed = value } }
try {
  const surface: MountedSurface = await harness.mount({ component: 'components/users/PermissionEditor.tsx', props, app: {}, doubles: {} })
  const within = (node: MemoryNode, root: MemoryNode): boolean => { for (let current: MemoryNode | null = node; current; current = current.parentNode) if (current === root) return true; return false }
  const moduleRow = (id: string) => surface.find(node => node.getAttribute('data-perm-module') === id, `${id} row`)
  const section = () => moduleRow('inventory_checks')
  const openSessions = async () => {
    const toggle = surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, section()), 'sessions row toggle')
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  await openSessions()
  // Turning a field on writes exactly that key; the others stay absent (off).
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.deepEqual(changed, { inventory_checks: true, inventory_check_show_stock: true })
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).fields.stock, true)
  assert.equal(Object.hasOwn(changed, 'inventory_check_show_price'), false, 'editing one field does not materialize unrelated defaults')
  // Turning it off again removes the key: absent and false mean the same.
  await surface.render({ ...props, permissions: changed })
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.deepEqual(changed, { inventory_checks: true })
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).fields.stock, false)
  // Inventory Full or Review neither shows a field nor grants counting.
  for (const inventoryValue of [true, 'review'] as const) {
    await surface.render({ ...props, permissions: { inventory: inventoryValue } })
    assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify({ inventory: inventoryValue }) }).canView, false)
    assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && /Show recorded stock/.test(node.getAttribute('aria-label') ?? '')).length, 0, 'the field chips wait for the sessions grant')
  }
  // A field toggle preserves Review on Inventory and never grants cost access.
  await surface.render({ ...props, permissions: { inventory: 'review', inventory_checks: true } })
  await openSessions()
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.equal((changed as Record<string, unknown>).inventory, 'review', 'a field toggle preserves Review')
  assert.equal(changed.inventory_check_show_stock, true)
  const access = getInventoryCheckAccess({ permissions: JSON.stringify(changed) })
  assert.equal(access.fields.stock, true)
  assert.equal(access.fields.cost, false, 'field controls never grant acquisition cost access')
  // None on Inventory leaves the sessions grant alone; None on the sessions row removes only itself.
  await surface.render({ ...props, permissions: { inventory: true, inventory_checks: true } })
  const levelDot = (id: string, level: string) => surface.find(node => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') === level && within(node, moduleRow(id)), `${id} ${level} dot`)
  await surface.click(levelDot('inventory', 'none'))
  assert.deepEqual(changed, { inventory_checks: true }, 'Inventory None does not take counting with it')
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canView, true)
  await surface.render({ ...props, permissions: { inventory: true, inventory_checks: true } })
  await surface.click(levelDot('inventory_checks', 'none'))
  assert.deepEqual(changed, { inventory: true })
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canView, false)
  await surface.unmount()
  console.log('PASS Inventory permission editor writes plain on/off count grants: nothing inherited from Inventory, Review preserved')
} finally { await harness.close() }
