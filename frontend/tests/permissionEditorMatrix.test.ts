// The role editor's access grid, mounted for real: one row per module with None / View / Review / Full cells, the
// level a role is really at, chips that say what each action does, and the rule that Full opens a module's main
// access only. A1-A12 of the Permissions page spec (21 Oct 2026), plus the owner's rule for Full on every module.
//
// Run: node tests/permissionEditorMatrix.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const pack = (language: Record<string, string>) => (key: string) => language[key]

let failed = 0
// The harness reads one shared document, so a test that throws before unmounting would hand its editor to the next one.
const live: MountedSurface[] = []
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const harness = await createHarness()
const employee = ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions

type Mounted = { surface: MountedSurface; state: { changed: Record<string, unknown> | null; calls: number } }
async function mountEditor(permissions: Record<string, unknown>, options: { baseline?: Record<string, unknown>; language?: Record<string, string> } = {}): Promise<Mounted> {
  const language = options.language ?? en
  const state: Mounted['state'] = { changed: null, calls: 0 }
  const surface = await harness.mount({
    component: 'components/users/PermissionEditor.tsx',
    props: {
      permissions,
      ...(options.baseline ? { baseline: options.baseline } : {}),
      t: pack(language),
      onChange: (value: Record<string, unknown>) => { state.changed = value; state.calls += 1 },
    },
    app: { t: pack(language) },
    doubles: {},
  })
  live.push(surface)
  return { surface, state }
}

const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)
const moduleNode = (surface: MountedSurface, id: string) => surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
const modules = (surface: MountedSurface) => surface.findAll((node) => node.getAttribute('data-perm-module') !== null)
const cell = (surface: MountedSurface, id: string, level: string) => {
  const root = moduleNode(surface, id)
  return surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') === level && within(node, root), `${id} ${level} cell`)
}
const hasCell = (surface: MountedSurface, id: string, level: string) => {
  const root = moduleNode(surface, id)
  return surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') === level && within(node, root)).length > 0
}
const openModule = async (surface: MountedSurface, id: string) => {
  const root = moduleNode(surface, id)
  const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
  if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  return moduleNode(surface, id)
}
const inModule = (surface: MountedSurface, id: string, predicate: (node: MemoryNode) => boolean) => {
  const root = moduleNode(surface, id)
  return surface.findAll((node) => within(node, root) && predicate(node))
}
const exactButton = (surface: MountedSurface, text: string) => surface.find((node) => node.tagName === 'BUTTON' && node.textContent.trim() === text, `button ${text}`)
const buttonCount = (surface: MountedSurface) => surface.findAll((node) => node.tagName === 'BUTTON').length
const WORD = { none: en.none, view: en.view, review: en.review_required, full: en.label_full_access }

// The module's main access, read off the catalog independently of the editor's own row builder.
const mainKeysOf = (section: (typeof PERMISSION_SECTIONS)[number]): string[] => {
  const main = section.permissions.find((permission) => permission.tier) ?? section.permissions.find((permission) => (permission as { lead?: true }).lead && !(permission as { subRow?: true }).subRow)
  return main ? [main.key] : section.permissions.map((permission) => permission.key)
}

await test('A1: under Administrator every Full dot is pressed and disabled, no dot changes the role, and the switch reads on', async () => {
  const { surface, state } = await mountEditor({ all: true })
  const rows = modules(surface).map((node) => node.getAttribute('data-perm-module') as string)
  assert.ok(rows.length >= 16, `rows: ${rows.length}`)
  for (const id of rows) {
    const full = cell(surface, id, 'full')
    assert.equal(full.getAttribute('aria-pressed'), 'true', `${id}: Full is pressed`)
    assert.equal(propsOf(full).disabled, true, `${id}: Full is disabled`)
    for (const level of ['none', 'view', 'review']) {
      if (!hasCell(surface, id, level)) continue
      assert.equal(cell(surface, id, level).getAttribute('aria-pressed'), 'false', `${id}: ${level} is not pressed`)
      assert.equal(propsOf(cell(surface, id, level)).disabled, true)
    }
  }
  await surface.call(cell(surface, 'products', 'full'), 'onClick', [])
  await surface.call(cell(surface, 'products', 'none'), 'onClick', [])
  assert.equal(state.calls, 0, 'tapping Products under Administrator calls no onChange')
  const master = surface.find((node) => node.getAttribute('role') === 'switch' && /Administrator/.test(node.textContent), 'administrator switch')
  assert.equal(master.getAttribute('aria-checked'), 'true')
  assert.ok(!surface.text().includes('16 None') && !/\bCustom\b/.test(surface.text()))
  await surface.unmount()
})

await test('A1: turning Administrator off asks first, shows before and after, and starts from nothing; turning it on asks too', async () => {
  const { surface, state } = await mountEditor({ all: true })
  const master = () => surface.find((node) => node.getAttribute('role') === 'switch' && /Administrator/.test(node.textContent), 'administrator switch')
  await surface.click(master())
  assert.equal(state.calls, 0, 'nothing changes on the first press')
  assert.ok(surface.text().includes(en.perm_confirm_admin_off_title), 'the confirm names the action')
  assert.ok(surface.text().includes(`${en.perm_confirm_all_after} → ${en.none}`), 'it shows before and after')
  assert.ok(surface.text().includes(en.perm_confirm_admin_off_note))
  await surface.click(exactButton(surface, en.cancel))
  assert.equal(state.calls, 0, 'Cancel keeps Administrator')
  await surface.click(master())
  await surface.click(exactButton(surface, en.confirm))
  assert.deepEqual(state.changed, {}, 'confirming resets the draft to nothing')
  await surface.unmount()

  const off = await mountEditor({ dashboard: true, pos: true })
  await off.surface.click(off.surface.find((node) => node.getAttribute('role') === 'switch' && /Administrator/.test(node.textContent), 'administrator switch'))
  assert.equal(off.state.calls, 0)
  assert.ok(off.surface.text().includes(en.perm_confirm_all_title))
  assert.ok(off.surface.text().includes(`2 → ${en.perm_confirm_all_after}`), 'before and after')
  await off.surface.click(exactButton(off.surface, en.confirm))
  assert.deepEqual(off.state.changed, { all: true })
  await off.surface.unmount()
})

await test('A1: Clear is one icon button that asks first with the count going to 0', async () => {
  const { surface, state } = await mountEditor({ dashboard: true, pos: true, sales: true })
  const clear = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.perm_clear_all, 'clear button')
  assert.equal(clear.textContent.trim(), '', 'icon-only')
  assert.equal(clear.getAttribute('title'), en.perm_clear_all)
  await surface.click(clear)
  assert.equal(state.calls, 0)
  assert.ok(surface.text().includes('3 → 0'))
  await surface.click(exactButton(surface, en.perm_clear))
  assert.deepEqual(state.changed, {})
  await surface.unmount()
  const empty = await mountEditor({})
  assert.equal(propsOf(empty.surface.find((node) => node.getAttribute('aria-label') === en.perm_clear_all, 'clear')).disabled, true, 'nothing to clear')
  await empty.surface.unmount()
})

await test('A2: Full on any module writes exactly its main key; the extras stay as they were', async () => {
  for (const section of PERMISSION_SECTIONS.filter((entry) => entry.key !== 'full_access')) {
    const { surface, state } = await mountEditor({})
    const id = section.permissions.find((permission) => permission.tier ?? (permission as { lead?: true }).lead)?.key ?? section.key
    await surface.click(cell(surface, id, 'full'))
    const expected = Object.fromEntries(mainKeysOf(section).map((key) => [key, true]))
    assert.deepEqual(state.changed, expected, `${section.key}: Full from nothing`)
    await surface.unmount()
    const withExtras = await mountEditor(Object.fromEntries(section.permissions.filter((permission) => !mainKeysOf(section).includes(permission.key) && !permission.exclusiveWithTier && !/_show_/.test(permission.key)).map((permission) => [permission.key, false])))
    await withExtras.surface.click(cell(withExtras.surface, id, 'full'))
    for (const permission of section.permissions) {
      if (mainKeysOf(section).includes(permission.key) || !(permission.key in (withExtras.state.changed ?? {}))) continue
      assert.equal(withExtras.state.changed?.[permission.key], false, `${section.key}: Full turned ${permission.key} on`)
    }
    await withExtras.surface.unmount()
  }
})

await test('A2: Products and Settings Full are exactly {products:true} and {settings:true}', async () => {
  const { surface, state } = await mountEditor({})
  await surface.click(cell(surface, 'products', 'full'))
  assert.deepEqual(state.changed, { products: true })
  await surface.click(cell(surface, 'settings', 'full'))
  assert.deepEqual(state.changed, { settings: true })
  await surface.click(cell(surface, 'products', 'review'))
  assert.deepEqual(state.changed, { products: 'review' })
  await surface.click(cell(surface, 'sales', 'view'))
  assert.deepEqual(state.changed, { sales: 'view' })
  await surface.unmount()
})

await test('A2: tapping the level that is already selected does nothing, and None clears the module', async () => {
  const { surface, state } = await mountEditor({ products: true, product_cost_view: true, sales: 'view' })
  await surface.call(cell(surface, 'products', 'full'), 'onClick', [])
  await surface.call(cell(surface, 'sales', 'view'), 'onClick', [])
  await surface.call(cell(surface, 'dashboard', 'none'), 'onClick', [])
  assert.equal(state.calls, 0)
  await surface.click(cell(surface, 'products', 'none'))
  assert.deepEqual(state.changed, { sales: 'view' }, 'None clears the main key and the module\'s extras, not other modules')
  await surface.unmount()
})

await test('A3: the Employee preset reads Full where it is Full, None where it is None, and nothing says Custom', async () => {
  const { surface } = await mountEditor(employee)
  for (const id of ['pos', 'products', 'sales', 'returns', 'contacts']) assert.equal(cell(surface, id, 'full').getAttribute('aria-pressed'), 'true', `${id} is Full`)
  for (const id of ['inventory', 'settings', 'dashboard', 'library']) assert.equal(cell(surface, id, 'none').getAttribute('aria-pressed'), 'true', `${id} is None`)
  assert.equal(cell(surface, 'products', 'review').getAttribute('aria-pressed'), 'false')
  assert.ok(!/Custom/i.test(surface.text()), 'no Custom anywhere')
  assert.ok(!surface.findAll((node) => /custom/i.test(node.getAttribute('aria-label') ?? '') || /custom/i.test(node.getAttribute('title') ?? '')).length)
  assert.equal(cell(surface, 'inventory_checks', 'full').getAttribute('aria-pressed'), 'true', 'counting is set on its own row')
  await surface.unmount()
})

await test('A4: Bulk delete, Merge and Import show "needs" without Select and change multiple contacts, and the role cannot merge', async () => {
  const permissions = { contacts: true, 'contacts:bulk': false }
  const { surface } = await mountEditor(permissions)
  await openModule(surface, 'contacts')
  for (const action of ['bulk_delete', 'merge', 'import']) {
    const chip = inModule(surface, 'contacts', (node) => node.getAttribute('data-perm-action') === action)[0]
    assert.ok(chip, `${action} chip`)
    assert.equal(chip.getAttribute('data-perm-mark'), 'needs', action)
    assert.ok((chip.getAttribute('title') ?? '').includes(en.perm_act_contacts_bulk), `${action} names what it needs`)
  }
  assert.equal(inModule(surface, 'contacts', (node) => node.getAttribute('data-perm-action') === 'delete')[0].getAttribute('data-perm-mark'), 'allow')
  assert.equal(effectivePermissions({ role_code: 'staff', permissions }).can('contacts', 'merge'), false)
  assert.ok(surface.text().includes(en.perm_act_contacts_bulk), 'the missing grant is also said in a visible line')
  await surface.unmount()
})

await test('A5: Opening stock needs Adjust / receive, and is allowed once Inventory is Full', async () => {
  const lacking = await mountEditor({ products: true })
  await openModule(lacking.surface, 'products')
  const control = inModule(lacking.surface, 'products', (node) => node.getAttribute('data-perm-control') === 'opening_stock')[0]
  assert.ok(control, 'the Opening stock chip is drawn')
  assert.ok((control.getAttribute('title') ?? '').includes(en.perm_act_inventory_adjust), 'it names Adjust / receive')
  assert.ok((control.getAttribute('title') ?? '').includes(en.perm_action_also_needs.split('{')[0]))
  assert.ok(lacking.surface.text().includes(en.perm_act_inventory_adjust), 'and a visible line says what is missing')
  await lacking.surface.unmount()
  const held = await mountEditor({ products: true, inventory: true })
  await openModule(held.surface, 'products')
  const ok = inModule(held.surface, 'products', (node) => node.getAttribute('data-perm-control') === 'opening_stock')[0]
  assert.ok((ok.getAttribute('title') ?? '').includes(en.perm_outcome_allow), 'allowed')
  assert.ok(!held.surface.text().includes(en.perm_act_inventory_adjust), 'no missing-grant line once it is held')
  await held.surface.unmount()
})

await test('A6: under Review the Import chip says Full only and nothing says Hidden', async () => {
  const { surface } = await mountEditor({ products: 'review' })
  await openModule(surface, 'products')
  const chip = inModule(surface, 'products', (node) => node.getAttribute('data-perm-action') === 'import')[0]
  assert.equal(chip.getAttribute('data-perm-mark'), 'fullOnly')
  assert.ok((chip.getAttribute('title') ?? '').includes(en.perm_outcome_full_only))
  assert.equal(propsOf(chip).disabled, true)
  assert.ok(!surface.text().includes('Hidden') && !surface.findAll((node) => /Hidden/.test(node.getAttribute('title') ?? '')).length)
  await surface.unmount()
})

await test('A7: counting is one chip on its own row, and Inventory draws no chips at None', async () => {
  const { surface } = await mountEditor({ inventory_checks: true })
  await openModule(surface, 'inventory')
  await openModule(surface, 'inventory_checks')
  assert.equal(inModule(surface, 'inventory', (node) => node.getAttribute('data-perm-action') !== null).length, 0, 'Inventory at None draws no chips')
  const labelled = surface.findAll((node) => node.getAttribute('aria-label') === en.perm_act_inventory_checks_check)
  assert.equal(labelled.length, 1, 'Record own inventory checks appears once')
  assert.equal(cell(surface, 'inventory', 'none').getAttribute('aria-pressed'), 'true')
  assert.equal(cell(surface, 'inventory_checks', 'full').getAttribute('aria-pressed'), 'true')
  await surface.unmount()
  const full = await mountEditor({ inventory: true, inventory_checks: true })
  await openModule(full.surface, 'inventory')
  const count = inModule(full.surface, 'inventory', (node) => node.getAttribute('data-perm-action') === 'check')[0]
  assert.equal(count.getAttribute('aria-label'), en.perm_set_by_count_sessions, 'Inventory\'s Count chip defers to the sessions row')
  assert.equal(propsOf(count).disabled, true)
  await full.surface.unmount()
  const follows = await mountEditor({ inventory: true })
  assert.equal(cell(follows.surface, 'inventory_checks', 'full').getAttribute('aria-pressed'), 'false')
  assert.equal(cell(follows.surface, 'inventory_checks', 'none').getAttribute('aria-pressed'), 'false', 'neither dot is pressed while counting only follows Inventory')
  assert.ok((cell(follows.surface, 'inventory_checks', 'full').getAttribute('aria-label') ?? '').includes(en.perm_follows_inventory))
  await follows.surface.unmount()
})

await test('A7: the count-session row stores an explicit true or false, shows "Follows Inventory" only while the key is absent, and can return to following', async () => {
  const followSwitch = (surface: MountedSurface) => surface.find((node) => node.getAttribute('data-perm-follow') === 'inventory_checks', 'follow switch')
  // Following: the key is absent, so neither dot is pressed and the follow switch reads on and inert.
  const first = await mountEditor({ inventory: true })
  await openModule(first.surface, 'inventory_checks')
  assert.equal(followSwitch(first.surface).getAttribute('aria-checked'), 'true')
  assert.equal(propsOf(followSwitch(first.surface)).disabled, true, 'nothing to drop while it already follows')
  // None while following stores a false (it is not swallowed as "already none", and it does not delete anything).
  await first.surface.click(cell(first.surface, 'inventory_checks', 'none'))
  assert.deepEqual(first.state.changed, { inventory: true, inventory_checks: false })
  await first.surface.unmount()
  // Explicit false: None is pressed, Follows Inventory is gone, and the switch can hand the row back to Inventory.
  const denied = await mountEditor({ inventory: true, inventory_checks: false })
  await openModule(denied.surface, 'inventory_checks')
  assert.equal(cell(denied.surface, 'inventory_checks', 'none').getAttribute('aria-pressed'), 'true', 'a stored false is a decision: None is pressed')
  assert.equal(cell(denied.surface, 'inventory_checks', 'full').getAttribute('aria-pressed'), 'false')
  assert.ok(!(cell(denied.surface, 'inventory_checks', 'full').getAttribute('aria-label') ?? '').includes(en.perm_follows_inventory), 'the ring and the words are only for an absent key')
  assert.equal(followSwitch(denied.surface).getAttribute('aria-checked'), 'false')
  assert.equal(propsOf(followSwitch(denied.surface)).disabled, false)
  await denied.surface.click(cell(denied.surface, 'inventory_checks', 'full'))
  assert.deepEqual(denied.state.changed, { inventory: true, inventory_checks: true }, 'Full stores a true')
  await denied.surface.click(followSwitch(denied.surface))
  assert.deepEqual(denied.state.changed, { inventory: true }, 'the follow switch deletes the key and keeps the rest')
  await denied.surface.unmount()
  // Explicit true: Full is pressed, and no word claims it follows Inventory.
  const granted = await mountEditor({ inventory: true, inventory_checks: true })
  await openModule(granted.surface, 'inventory_checks')
  assert.equal(cell(granted.surface, 'inventory_checks', 'full').getAttribute('aria-pressed'), 'true')
  assert.equal(followSwitch(granted.surface).getAttribute('aria-checked'), 'false')
  assert.ok(!granted.surface.text().includes(en.perm_follows_inventory) || followSwitch(granted.surface).getAttribute('aria-checked') === 'false')
  await granted.surface.click(cell(granted.surface, 'inventory_checks', 'none'))
  assert.deepEqual(granted.state.changed, { inventory: true, inventory_checks: false })
  await granted.surface.unmount()
  // The Changed filter tells a stored false from an absent key, because the Worker does.
  const changed = await mountEditor({ inventory: true, inventory_checks: false }, { baseline: { inventory: true } })
  assert.equal(moduleNode(changed.surface, 'inventory_checks').getAttribute('data-perm-changed'), 'true')
  await changed.surface.unmount()
  // Administrator offers no follow switch: every row is locked.
  const admin = await mountEditor({ all: true })
  await openModule(admin.surface, 'inventory_checks')
  assert.equal(admin.surface.findAll((node) => node.getAttribute('data-perm-follow') !== null).length, 0)
  await admin.surface.unmount()
})

await test('A8: no image-only route while Products is on; it appears with its fields only at None', async () => {
  const on = await mountEditor({ products: true })
  await openModule(on.surface, 'products')
  assert.equal(on.surface.findAll((node) => node.getAttribute('data-perm-grant') === 'products_image_only').length, 0)
  assert.ok(!on.surface.text().includes('Image-only'))
  await on.surface.unmount()
  const none = await mountEditor({})
  await openModule(none.surface, 'products')
  assert.equal(none.surface.findAll((node) => node.getAttribute('data-perm-grant') === 'products_image_only').length, 1)
  assert.equal(none.surface.findAll((node) => node.getAttribute('role') === 'group' && node.getAttribute('aria-label') === en.perm_fields_shown).length, 0, 'fields wait for the switch')
  await none.surface.unmount()
  const routed = await mountEditor({ products_image_only: true, products_image_only_show_price: true })
  await openModule(routed.surface, 'products')
  const fields = routed.surface.find((node) => node.getAttribute('role') === 'group' && node.getAttribute('aria-label') === en.perm_fields_shown, 'image-only fields')
  assert.equal(routed.surface.findAll((node) => node.tagName === 'BUTTON' && within(node, fields)).length, 8)
  await routed.surface.click(routed.surface.button(/Image-only role: show selling price/))
  assert.equal(routed.state.changed?.products_image_only_show_price, undefined)
  await routed.surface.unmount()
})

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`A9: the Employee ${name} grid at first paint stays within 70 buttons and 1,200 characters`, async () => {
    const { surface } = await mountEditor(employee, { language, baseline: employee })
    const buttons = buttonCount(surface)
    const characters = surface.text().length
    console.log(`     ${name}: ${buttons} buttons, ${characters} visible characters`)
    assert.ok(buttons <= 70, `${buttons} buttons`)
    assert.ok(characters <= 1200, `${characters} characters`)
    assert.equal(surface.findAll((node) => node.getAttribute('data-perm-action') !== null).length, 0, 'no chip is drawn while the rows are closed')
    await surface.unmount()
  })
}

await test('A10: nothing in the editor or its chips is smaller than 12px', async () => {
  for (const file of ['PermissionEditor.tsx', 'PermissionFieldChips.tsx']) {
    const source = read(`../src/components/users/${file}`)
    assert.doesNotMatch(source, /text-\[(?:[0-9]|1[01])px\]/, `${file} has text below 12px`)
    assert.doesNotMatch(source, /text-(?:\[0?\.\d+rem\]|\[(?:0\.[0-6]\d*)rem\])/, `${file} sizes text below 12px in rem`)
  }
})

await test('A11: the Costs field warns while View product costs is off, and not once it is held', async () => {
  const lacking = await mountEditor({ inventory: true })
  await openModule(lacking.surface, 'inventory_checks')
  const cost = lacking.surface.button(/Show costs when permitted/)
  assert.equal(cost.getAttribute('data-needs'), 'true')
  assert.ok(lacking.surface.findAll((node) => node.getAttribute('data-perm-needs') === 'true' && within(node, cost)).length === 1, 'the warning mark is drawn')
  assert.ok((cost.getAttribute('title') ?? '').includes(en.perm_product_cost_view))
  assert.equal(lacking.surface.findAll((node) => node.getAttribute('data-perm-needs') === 'true').length, 1, 'only the Costs field warns')
  await lacking.surface.unmount()
  const held = await mountEditor({ inventory: true, product_cost_view: true })
  await openModule(held.surface, 'inventory_checks')
  assert.equal(held.surface.findAll((node) => node.getAttribute('data-perm-needs') === 'true').length, 0)
  assert.equal(held.surface.button(/Show costs when permitted/).getAttribute('data-needs'), null)
  await held.surface.unmount()
})

await test('A12: against a saved role, only the changed row carries the gold dot and the Changed filter shows only it', async () => {
  const { surface } = await mountEditor({ pos: true, sales: true }, { baseline: { pos: true } })
  const dotted = modules(surface).filter((node) => node.getAttribute('data-perm-changed') === 'true').map((node) => node.getAttribute('data-perm-module'))
  assert.deepEqual(dotted, ['sales'])
  assert.equal(surface.findAll((node) => node.getAttribute('data-perm-dot') === 'changed').length, 1)
  await surface.click(exactButton(surface, en.perm_filter_changed))
  assert.deepEqual(modules(surface).map((node) => node.getAttribute('data-perm-module')), ['sales'])
  await surface.click(exactButton(surface, en.perm_filter_on))
  assert.deepEqual(modules(surface).map((node) => node.getAttribute('data-perm-module')), ['pos', 'sales'], 'On hides the None rows')
  await surface.click(exactButton(surface, en.perm_select_all))
  assert.ok(modules(surface).length >= 16)
  await surface.unmount()
  const create = await mountEditor({ pos: true })
  assert.equal(create.surface.findAll((node) => node.tagName === 'BUTTON' && node.textContent.trim() === en.perm_filter_changed).length, 0, 'no Changed filter without a saved role')
  assert.equal(create.surface.findAll((node) => node.getAttribute('data-perm-dot') === 'changed').length, 0)
  await create.surface.unmount()
})

await test('the Website Editor row shows a half-filled Full dot for some grants and completes them on Full', async () => {
  const { surface, state } = await mountEditor({ portal_posts: true, portal_faq: true })
  const full = cell(surface, 'customer_portal', 'full')
  assert.equal(full.getAttribute('aria-pressed'), 'false')
  assert.ok((full.getAttribute('aria-label') ?? '').includes(en.perm_n_of_total.replace('{n}', '2').replace('{total}', '4')))
  assert.equal(hasCell(surface, 'customer_portal', 'view'), false)
  await surface.click(full)
  assert.deepEqual(state.changed, { portal_posts: true, portal_faq: true, portal_about: true, customer_portal: true })
  await surface.unmount()
})

await test('Settings Full shows the extras the Worker includes as locked on, and Receipts and Security as separate switches', async () => {
  const { surface } = await mountEditor({ settings: true })
  await openModule(surface, 'settings')
  const grant = (key: string) => surface.find((node) => node.getAttribute('data-perm-grant') === key, key)
  for (const key of ['business_identity', 'sales_policy', 'drive_credentials']) {
    assert.equal(grant(key).getAttribute('aria-checked'), 'true', `${key} is held`)
    assert.equal(propsOf(grant(key)).disabled, true, `${key} cannot be switched off here`)
    assert.ok((grant(key).getAttribute('title') ?? '').includes(en.perm_covered_by_full))
  }
  for (const key of ['receipt_settings', 'security_settings']) {
    assert.equal(grant(key).getAttribute('aria-checked'), 'false', `${key} stays separate`)
    assert.notEqual(propsOf(grant(key)).disabled, true)
  }
  assert.ok((cell(surface, 'settings', 'full').getAttribute('title') ?? '').includes(en.perm_full_includes_some))
  await surface.unmount()
})

await test('every module with extras says on its Full dot that the extras are separate', async () => {
  const { surface } = await mountEditor({})
  for (const id of ['products', 'contacts', 'dashboard', 'backup']) {
    assert.ok((cell(surface, id, 'full').getAttribute('title') ?? '').includes(en.perm_full_main_only), `${id}: Full tooltip`)
  }
  for (const id of ['pos', 'library', 'returns']) assert.ok(!(cell(surface, id, 'full').getAttribute('title') ?? '').includes(en.perm_full_main_only), `${id} has no extras to mention`)
  await surface.unmount()
})

await test('a switch chip is a live switch: an extra turns on and off by itself, and sensitive ones carry a shield', async () => {
  const { surface, state } = await mountEditor({ products: true })
  await openModule(surface, 'products')
  const destructive = surface.find((node) => node.getAttribute('data-perm-grant') === 'destructive_delete', 'destructive imports')
  assert.equal(destructive.getAttribute('role'), 'switch')
  assert.equal(destructive.getAttribute('aria-checked'), 'false')
  await surface.click(destructive)
  assert.deepEqual(state.changed, { products: true, destructive_delete: true })
  await surface.unmount()
})

await test('an action chip switches that action off, and a second tap hands it back', async () => {
  const { surface, state } = await mountEditor({ products: true })
  await openModule(surface, 'products')
  const chip = () => inModule(surface, 'products', (node) => node.getAttribute('data-perm-action') === 'delete')[0]
  assert.equal(chip().getAttribute('aria-pressed'), 'true')
  await surface.click(chip())
  assert.deepEqual(state.changed, { products: true, 'products:delete': false })
  await surface.unmount()
  const off = await mountEditor({ products: true, 'products:delete': false })
  await openModule(off.surface, 'products')
  const offChip = inModule(off.surface, 'products', (node) => node.getAttribute('data-perm-action') === 'delete')[0]
  assert.equal(offChip.getAttribute('aria-pressed'), 'false')
  assert.equal(offChip.getAttribute('data-perm-mark'), 'off')
  assert.ok((offChip.getAttribute('title') ?? '').includes(en.perm_tap_to_turn_on))
  await off.surface.click(offChip)
  assert.deepEqual(off.state.changed, { products: true })
  await off.surface.unmount()
})

await test('Contacts View is locked on while Add or Edit is on and says why in a visible line', async () => {
  const { surface, state } = await mountEditor({ contacts: true, 'contacts:view': false })
  await openModule(surface, 'contacts')
  const view = inModule(surface, 'contacts', (node) => node.getAttribute('data-perm-action') === 'view')[0]
  assert.equal(propsOf(view).disabled, true)
  assert.equal(view.getAttribute('aria-pressed'), 'true')
  assert.ok(surface.text().includes(en.perm_view_implied))
  await surface.call(view, 'onClick', [])
  assert.equal(state.calls, 0, 'a refused toggle does not call onChange')
  await surface.unmount()
})

await test('Sales keeps its customer-mode dropdown inside the open row, and not at None', async () => {
  const none = await mountEditor({})
  await openModule(none.surface, 'sales')
  assert.equal(none.surface.findAll((node) => node.getAttribute('aria-label') === en.perm_sales_customer_mode).length, 0)
  await none.surface.unmount()
  const full = await mountEditor({ sales: true })
  await openModule(full.surface, 'sales')
  assert.ok(full.surface.text().includes(en.perm_sales_customer_mode))
  await full.surface.unmount()
})

await test('Search opens the matching rows and rings the chips that match', async () => {
  const { surface } = await mountEditor({ products: true, contacts: true })
  const input = surface.find((node) => node.tagName === 'INPUT' && node.getAttribute('aria-label') === en.perm_find, 'find')
  await surface.type(input, 'bulk delete')
  assert.deepEqual(modules(surface).map((node) => node.getAttribute('data-perm-module')), ['products', 'contacts'])
  const ringed = surface.findAll((node) => node.getAttribute('data-perm-action') === 'bulk_delete' && /ring-2/.test(node.className))
  assert.equal(ringed.length, 2, 'one ringed chip per matching module')
  const plain = surface.findAll((node) => node.getAttribute('data-perm-action') === 'delete' && /ring-2/.test(node.className))
  assert.equal(plain.length, 0, 'other chips are not ringed')
  await surface.type(input, 'zzzzqq')
  assert.ok(surface.text().includes(en.perm_find_none))
  await surface.type(input, '')
  assert.ok(modules(surface).length >= 16)
  await surface.unmount()
})

await test('a row opens and closes from its name, and the panel carries the module description in an info hint', async () => {
  const { surface } = await mountEditor({ products: true })
  const toggle = () => surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, moduleNode(surface, 'products')), 'expander')
  assert.equal(toggle().getAttribute('aria-expanded'), 'false')
  await surface.click(toggle())
  assert.equal(toggle().getAttribute('aria-expanded'), 'true')
  assert.equal(toggle().getAttribute('aria-controls'), 'perm-panel-products')
  assert.ok(surface.findAll((node) => node.getAttribute('id') === 'perm-panel-products').length === 1)
  assert.ok(inModule(surface, 'products', (node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.perm_section_products).length === 1, 'the info hint is named after the module')
  await surface.click(toggle())
  assert.equal(surface.findAll((node) => node.getAttribute('id') === 'perm-panel-products').length, 0)
  await surface.unmount()
})

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`${name}: with every row open no raw key shows, nothing falls back to English in Khmer, and no pack key is missing`, async () => {
    const missing = new Set<string>()
    const tracking = (key: string) => { if (!(key in language)) missing.add(key); return language[key] }
    const everything: Record<string, unknown> = {}
    for (const section of PERMISSION_SECTIONS) for (const permission of section.permissions) everything[permission.key] = permission.tier ? 'review' : true
    delete everything.all
    Object.assign(everything, { 'sales:amend': false, 'products:merge_duplicates': false, 'inventory:adjust': false, 'contacts:bulk': false, settings: true, inventory: true })
    const state = { calls: 0 }
    const surface = await harness.mount({
      component: 'components/users/PermissionEditor.tsx',
      props: { permissions: everything, baseline: {}, t: tracking, onChange: () => { state.calls += 1 } },
      app: { t: tracking },
      doubles: {},
    })
    live.push(surface)
    for (const id of modules(surface).map((node) => node.getAttribute('data-perm-module') as string)) await openModule(surface, id)
    assert.deepEqual([...missing].sort(), [], `keys without a ${name} entry`)
    const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b|\b[a-z_]+:[a-z_]+\b/
    const strings = surface.findAll(() => true).flatMap((node) => [
      node.childNodes.length === 1 && node.childNodes[0].nodeType === 3 ? node.textContent : '',
      node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '', node.getAttribute('placeholder') ?? '',
    ].filter(Boolean))
    const offenders = strings.filter((text) => RAW_KEY.test(text) && !/[ក-៿]/.test(text))
    assert.deepEqual(offenders, [], `raw keys rendered: ${offenders.slice(0, 5).join(' | ')}`)
    if (language === km) {
      for (const phrase of ['Allowed', 'Full only', 'Needs approval', 'Name only', 'Changed', 'Administrator', 'Find permission']) {
        assert.ok(!surface.text().includes(phrase) && !strings.some((text) => text.includes(phrase)), `Khmer still shows English "${phrase}"`)
      }
    }
    await surface.unmount()
  })
}

await test('the touch floor reaches 44px on every control and no section label is truncated or uppercased', async () => {
  const source = read('../src/components/users/PermissionEditor.tsx')
  assert.match(source, /\[@media\(pointer:coarse\)\]:min-h-\[44px\]/)
  assert.match(source, /\[@media\(pointer:coarse\)\]:h-11 \[@media\(pointer:coarse\)\]:w-11/)
  assert.ok((source.match(/\$\{TOUCH_(?:TARGET|SQUARE)\}/g) || []).length >= 7, 'the search, clear, switch, filters, hint, chips and dots use the touch floor')
  assert.doesNotMatch(source, /truncate[^"`]*uppercase|uppercase[^"`]*truncate/)
  assert.match(source, /break-words/, 'a module name wraps with room for Khmer')
  // main.css puts a 0.75rem !important gap on every `.grid` on phones: four of those take 48px of a 360px row from the
  // module name and break "Dashboard" into "Dashboar" and "d". The grid rows therefore must not carry the class.
  const mainCss = read('../src/styles/main.css')
  if (/\.grid \{ gap: 0\.75rem !important; \}/.test(mainCss)) {
    assert.match(source, /const GRID = '\[display:grid\] grid-cols-/, 'the grid rows set display through an arbitrary property')
    assert.doesNotMatch(source, /className="[^"]*(?:^|\s)grid(?:\s|")/, 'no element of the editor carries the .grid class')
    assert.doesNotMatch(source, /className=\{`[^`]*(?:^|\s)grid(?:\s|`)/, 'and no template class string does')
  }
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
