import assert from 'node:assert/strict'
import { createHarness, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { getInventoryCheckAccess } from '../src/utils/inventoryCheckAccess.ts'

// Counting is its own grant (owner, 21 Oct 2026: Full = main access only). The field switches are plain on/off grants on the
// Inventory check sessions row: absent is off, nothing is inherited from Inventory, and toggling one writes only that key.
// Price, cost, units sold and customer counts left the list (owner, 1 Nov 2026): the editor no longer offers them, and their stored values are never touched.
const inventory = PERMISSION_SECTIONS.find(section => section.key === 'inventory')!
const fields = inventory.permissions.filter(permission => permission.key.startsWith('inventory_check_show_'))
assert.deepEqual(fields.filter(permission => !permission.retired).map(permission => permission.key), ['barcode', 'category', 'brand', 'stock', 'received'].map(field => `inventory_check_show_${field}`), 'the five fields the list still shows')
assert.deepEqual(fields.filter(permission => permission.retired).map(permission => permission.key), ['price', 'sales', 'customers', 'cost'].map(field => `inventory_check_show_${field}`), 'the four retired ones stay defined, so reviews and summaries still name and count the stored grants')
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
  // A retired grant stored on a role has no chip, and editing a live field leaves it exactly as stored.
  await surface.render({ ...props, permissions: { inventory_checks: true, inventory_check_show_sales: true, inventory_check_show_cost: false, inventory_check_show_price: true } })
  await openSessions()
  for (const word of [/Show units sold/, /Show customer counts/, /Show selling prices/, /Show costs when permitted/]) assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && word.test(node.getAttribute('aria-label') ?? '')).length, 0, `${word} is retired from the editor`)
  await surface.click(surface.button(/Show recorded stock/, section()))
  assert.deepEqual(changed, { inventory_checks: true, inventory_check_show_sales: true, inventory_check_show_cost: false, inventory_check_show_price: true, inventory_check_show_stock: true }, 'stored retired grants survive an edit')
  changed = { inventory_checks: true, inventory_check_show_stock: true }
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
  assert.equal((changed as Record<string, unknown>).inventory_check_show_stock, true)
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
  // Approve counts (ic_fix_stock, 6.0.1045): a switch of the count sessions row, off unless granted, implied by nothing, cleared with the row.
  const approve = PERMISSION_SECTIONS.flatMap(permissionSection => permissionSection.permissions).find(permission => permission.key === 'inventory_check_approve')!
  assert.ok(approve, 'the grant is defined')
  assert.deepEqual([approve.extraOf, approve.sensitivity, Object.hasOwn(approve, 'defaultFromFull'), Object.hasOwn(approve, 'retired')], ['inventory_checks', 'high', false, false])
  const countingAction = (await import('../src/utils/permissionActions.ts')).PERMISSION_ACTIONS.inventory_checks.find(action => action.key === 'check')!
  assert.equal(countingAction.label, 'Count and submit', 'the counting grant is named for what it does')
  await surface.render({ ...props, permissions: { inventory: true, inventory_checks: true, inventory_check_show_stock: true } })
  await openSessions()
  const approveSwitch = () => surface.find(node => node.getAttribute('data-perm-grant') === 'inventory_check_approve', 'approve switch')
  assert.ok(within(approveSwitch(), section()), 'it sits on the count sessions row')
  assert.equal(surface.findAll(node => node.getAttribute('data-perm-grant') === 'inventory_check_approve' && within(node, moduleRow('inventory'))).length, 0, 'and not on Inventory')
  assert.equal(approveSwitch().getAttribute('aria-checked'), 'false', 'counting plus the stock field do not imply approving')
  assert.match(approveSwitch().getAttribute('title') ?? '', /Approve counts.*Also needs Adjust/, 'its tooltip names the other right it needs')
  await surface.click(approveSwitch())
  assert.deepEqual(changed, { inventory: true, inventory_checks: true, inventory_check_show_stock: true, inventory_check_approve: true }, 'turning it on writes only that key')
  assert.equal(getInventoryCheckAccess({ permissions: JSON.stringify(changed) }).canCheck, true)
  await surface.render({ ...props, permissions: { inventory: true, inventory_checks: true, inventory_check_approve: true } })
  await surface.click(levelDot('inventory_checks', 'none'))
  assert.deepEqual(changed, { inventory: true }, 'taking the count sessions row to None takes its extra with it')
  await surface.render({ ...props, permissions: { inventory: true } })
  await surface.click(levelDot('inventory_checks', 'full'))
  assert.deepEqual(changed, { inventory: true, inventory_checks: true }, 'Full on the row gives the main access only, never the extra')
  await surface.unmount()
  console.log('PASS Inventory permission editor writes plain on/off count grants: nothing inherited from Inventory, Review preserved')
} finally { await harness.close() }
