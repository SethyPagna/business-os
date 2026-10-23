// The role editor's model (components/users/permissionSummary.ts), tested without React: which rows the access grid
// has, what level a role is at in each, what an action chip says, what a tap on a level writes, and whether a row
// differs from the saved role.
//
// Run: node tests/permissionSummary.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import {
  MODULE_ROWS, applyModuleLevel, chipStates, levelsOf, moduleCanDo, moduleChanged, moduleIsOn, moduleState,
  roleTierCounts, searchRow, toggleGrant, type Level, type ModuleRow, type PermissionState,
} from '../src/components/users/permissionSummary.ts'
import { effectivePermissions, normalizePermissionState } from '../src/utils/permissions.ts'

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const tr = (key: string, fallback: string) => en[key] ?? fallback
const state = (value: Record<string, unknown>): PermissionState => normalizePermissionState(value)
const row = (id: string): ModuleRow => MODULE_ROWS.find((entry) => entry.id === id)!
const employee = state(ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions)
// A group row's grants are also its extras (they are the same keys), so the set counts each key once.
const allKeys = (entry: ModuleRow): string[] => [...new Set([
  ...(entry.lead ? [entry.lead.key] : []), ...entry.group.map((def) => def.key), ...entry.extras.map((def) => def.key), ...entry.fields.map((def) => def.key),
  ...(entry.imageOnly ? [entry.imageOnly.toggle.key, ...entry.imageOnly.fields.map((def) => def.key)] : []),
])]

test('the grid has one row per module and an Inventory check sessions sub-row', () => {
  const modules = MODULE_ROWS.filter((entry) => !entry.sub)
  assert.equal(modules.length, PERMISSION_SECTIONS.length - 1, 'every section but Full Administrator Access is a module')
  assert.deepEqual(MODULE_ROWS.filter((entry) => entry.sub).map((entry) => entry.id), ['inventory_checks'])
  assert.equal(MODULE_ROWS[MODULE_ROWS.findIndex((entry) => entry.id === 'inventory') + 1].id, 'inventory_checks', 'the sub-row sits under Inventory')
  assert.equal(new Set(MODULE_ROWS.map((entry) => entry.id)).size, MODULE_ROWS.length, 'row ids are unique')
})

test('every permission key lands in exactly one place of exactly one row', () => {
  const seen = new Map<string, string>()
  for (const entry of MODULE_ROWS) {
    for (const key of allKeys(entry)) {
      assert.ok(!seen.has(key), `${key} is in ${seen.get(key)} and ${entry.id}`)
      seen.set(key, entry.id)
    }
  }
  const catalog = PERMISSION_SECTIONS.filter((section) => section.key !== 'full_access').flatMap((section) => section.permissions.map((def) => def.key))
  assert.deepEqual([...seen.keys()].sort(), catalog.sort(), 'no key is dropped from the grid and none is invented')
})

test('levels, extras and fields follow the design: tiered rows offer their middle level, the rest None and Full', () => {
  assert.deepEqual(levelsOf(row('products')), ['none', 'review', 'full'])
  assert.deepEqual(levelsOf(row('sales')), ['none', 'view', 'full'])
  assert.deepEqual(levelsOf(row('settings')), ['none', 'view', 'full'])
  for (const id of ['dashboard', 'pos', 'backup', 'library', 'inventory_checks', 'customer_portal']) assert.deepEqual(levelsOf(row(id)), ['none', 'full'], id)
  const extras = (id: string) => row(id).extras.map((def) => def.key)
  assert.deepEqual(extras('products'), ['product_cost_view', 'product_cost_edit', 'destructive_delete'])
  assert.deepEqual(extras('contacts'), ['contacts_suppliers'])
  assert.deepEqual(extras('dashboard'), ['dashboard_export'])
  assert.deepEqual(extras('backup'), ['backup_restore'])
  assert.deepEqual(extras('settings'), ['business_identity', 'sales_policy', 'receipt_settings', 'drive_credentials'])
  assert.deepEqual(extras('library'), ['ai_providers'], 'AI provider keys sit beside the Library as a separate critical switch')
  assert.deepEqual(extras('customer_portal'), ['portal_posts', 'portal_faq', 'portal_about', 'customer_portal'])
  assert.deepEqual(row('customer_portal').group.map((def) => def.key), extras('customer_portal'), 'the Website Editor level is derived from its four grants')
  assert.equal(row('customer_portal').lead, null)
  assert.equal(row('inventory').fields.length, 0, 'the count-session fields belong to the sub-row')
  assert.equal(row('inventory_checks').fields.length, 9)
  assert.equal(row('products').imageOnly?.fields.length, 8)
  assert.equal(row('products').imageOnly?.toggle.key, 'products_image_only')
})

test('Full writes exactly the module\'s main key, for every module and every level', () => {
  for (const entry of MODULE_ROWS) {
    const main = entry.group.length ? entry.group.map((def) => def.key) : [entry.lead!.key]
    for (const level of levelsOf(entry).filter((candidate): candidate is Level => candidate !== 'none')) {
      const written = applyModuleLevel(entry, level, {})
      const expected = Object.fromEntries(main.map((key) => [key, level === 'full' || entry.group.length ? true : level]))
      assert.deepEqual(written, expected, `${entry.id} ${level} from nothing`)
      // Extras stay exactly as they were, whatever they were: a tap never grants one and never takes one away.
      const extras = Object.fromEntries(entry.extras.filter((def) => !entry.group.includes(def)).map((def) => [def.key, true]))
      const withExtras = applyModuleLevel(entry, level, extras)
      assert.deepEqual(Object.keys(withExtras).filter((key) => !(key in extras)).sort(), main.slice().sort(), `${entry.id} ${level} over extras that are on`)
      for (const key of Object.keys(extras)) assert.equal(withExtras[key], true, `${entry.id} ${level} left ${key} on`)
      const bare = Object.fromEntries(entry.extras.filter((def) => !entry.group.includes(def)).map((def) => [def.key, false]))
      for (const [key, value] of Object.entries(applyModuleLevel(entry, level, bare))) {
        if (key in bare) assert.equal(value, false, `${entry.id} ${level} turned ${key} on`)
      }
    }
  }
})

test('the sensitive extras are never written by any level tap', () => {
  const separate = ['product_cost_view', 'product_cost_edit', 'destructive_delete', 'drive_credentials', 'ai_providers', 'business_identity', 'sales_policy', 'receipt_settings', 'backup_restore', 'contacts_suppliers']
  for (const entry of MODULE_ROWS) {
    for (const level of levelsOf(entry)) {
      for (const key of separate) assert.ok(applyModuleLevel(entry, level, {})[key] !== true, `${entry.id} ${level} wrote ${key}`)
    }
  }
})

test('nothing is held by inclusion: after a Full tap on any row, no extra is held, and the catalog carries no fallback marks', () => {
  for (const entry of MODULE_ROWS) {
    const perms = applyModuleLevel(entry, 'full', {})
    const authority = effectivePermissions({ permissions: perms })
    for (const def of [...entry.extras, ...(entry.imageOnly ? [entry.imageOnly.toggle] : [])]) {
      if (entry.group.includes(def)) continue
      assert.equal(authority.hasPermission(def.key), false, `${entry.id} Full: ${def.key} is held without being stored`)
      assert.equal(perms[def.key], undefined, `${entry.id} Full wrote ${def.key}`)
    }
  }
  for (const def of PERMISSION_SECTIONS.flatMap((section) => section.permissions)) {
    assert.equal(Object.hasOwn(def, 'coveredBy'), false, `${def.key} still carries coveredBy`)
    assert.equal(Object.hasOwn(def, 'defaultFromFull'), false, `${def.key} still carries defaultFromFull`)
  }
  assert.equal(PERMISSION_SECTIONS.flatMap((section) => section.permissions).some((def) => def.key === 'security_settings'), false, 'the Security row is hidden: no Worker route reads it')
})

test('Settings Full holds none of the extras: the Website Editor, the Library, Identity, Policies, Receipts, Drive and AI keys all read off, and a tap on each works', () => {
  const full = state({ settings: true })
  for (const id of ['customer_portal', 'library']) {
    const entry = row(id)
    const held = moduleState(entry, full)
    assert.deepEqual([held.level, held.partial], ['none', null], id)
    assert.equal(moduleIsOn(entry, full), false, `${id} is not On under Settings Full`)
    const first = entry.group[0]?.key ?? entry.lead!.key
    assert.equal(applyModuleLevel(entry, 'full', full)[first], true, `a tap on ${id} Full writes the grant`)
  }
  for (const key of ['business_identity', 'sales_policy', 'receipt_settings', 'drive_credentials', 'ai_providers']) {
    assert.equal(effectivePermissions({ permissions: full }).hasPermission(key), false, `${key} is not implied by Settings`)
    assert.equal(toggleGrant(full, key)[key], true, `${key} is a normal switch under Settings Full`)
    assert.equal(toggleGrant(state({ settings: true, [key]: true }), key)[key], undefined, `${key} can be switched off under Settings Full`)
  }
  assert.deepEqual(moduleCanDo(row('customer_portal'), state({ settings: true, portal_posts: true, customer_portal: true }), tr), ['Posts', 'Site setup'], 'the role summary lists only the areas that are stored')
  assert.equal(moduleState(row('settings'), state({ settings: true, all: true })).admin, true)
})

test('the Roles list strip counts what is stored: Settings Full is one Full module, the Manager preset reads Full in Settings, the Website Editor and the Library', () => {
  const total = MODULE_ROWS.filter((entry) => !entry.sub).length
  assert.deepEqual(roleTierCounts(state({ settings: true })), { none: total - 1, view: 0, review: 0, full: 1, off: 0 })
  assert.deepEqual(roleTierCounts(state({ settings: 'view' })), { none: total - 1, view: 1, review: 0, full: 0, off: 0 }, 'View includes nothing')
  const manager = state(ROLE_PRESETS.find((preset) => preset.key === 'manager')!.permissions)
  assert.equal(manager.settings, true)
  for (const key of ['portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'library', 'business_identity', 'sales_policy', 'receipt_settings', 'inventory_checks']) assert.equal(manager[key], true, `the Manager preset stores ${key} explicitly`)
  for (const key of ['drive_credentials', 'ai_providers']) assert.equal(manager[key], undefined, `and leaves ${key} off`)
  assert.ok(moduleState(row('library'), manager).level === 'full' && moduleState(row('customer_portal'), manager).level === 'full')
})

test('moduleChanged: moving Settings from View to Full changes only the Settings row', () => {
  const before = { settings: 'view' }
  const after = state({ settings: true })
  assert.deepEqual(MODULE_ROWS.filter((entry) => moduleChanged(entry, after, before)).map((entry) => entry.id), ['settings'])
  assert.equal(moduleChanged(row('library'), state({ settings: true, library: true }), { settings: true }), true, 'a stored key counts')
})

test('a level tap on the level already selected, on a level the row lacks, or under Administrator changes nothing', () => {
  const products = state({ products: true })
  assert.equal(applyModuleLevel(row('products'), 'full', products), products, 'same level returns the same object')
  const none = state({})
  assert.equal(applyModuleLevel(row('products'), 'none', none), none)
  assert.equal(applyModuleLevel(row('products'), 'view', none), none, 'Products has no View level')
  assert.equal(applyModuleLevel(row('sales'), 'review', none), none, 'Sales has no Review level')
  const admin = state({ all: true })
  for (const entry of MODULE_ROWS) for (const level of ['none', 'view', 'review', 'full'] as const) assert.equal(applyModuleLevel(entry, level, admin), admin, `${entry.id} ${level} under Administrator`)
  assert.equal(toggleGrant(admin, 'product_cost_view'), admin)
})

test('None clears the main key, the extras and the image-only keys, and nothing outside the row', () => {
  const full = state({
    products: true, product_cost_view: true, product_cost_edit: true, destructive_delete: true, products_image_only: true, products_image_only_show_price: true,
    'products:delete': false, inventory: true, sales: true,
  })
  const none = applyModuleLevel(row('products'), 'none', full)
  assert.deepEqual(Object.keys(none).sort(), ['inventory', 'products:delete', 'sales'], 'switches of the action table stay, other modules are untouched')
  const inventory = state({ inventory: true, inventory_checks: true, inventory_check_show_stock: false })
  assert.deepEqual(applyModuleLevel(row('inventory'), 'none', inventory), { inventory_checks: true, inventory_check_show_stock: false }, 'Inventory None leaves the count-session row alone')
  assert.deepEqual(applyModuleLevel(row('inventory_checks'), 'none', inventory), { inventory: true, inventory_check_show_stock: false }, 'and the sub-row removes only itself')
})

test('a real level on Products clears the narrower image-only route, as the tier picker did', () => {
  const imageOnly = state({ products_image_only: true, products_image_only_show_price: true, products_image_only_show_stock: true })
  assert.deepEqual(applyModuleLevel(row('products'), 'full', imageOnly), { products: true })
  assert.deepEqual(applyModuleLevel(row('products'), 'review', imageOnly), { products: 'review' })
  assert.equal(toggleGrant(state({ products: true }), 'products_image_only').products_image_only, undefined, 'the switch refuses while Products is on')
  assert.equal(toggleGrant(state({}), 'products_image_only').products_image_only, true)
})

test('the Website Editor level is derived: all four is Full, some is partial, none is None', () => {
  const portal = row('customer_portal')
  assert.deepEqual(moduleState(portal, state({})).level, 'none')
  const some = moduleState(portal, state({ portal_posts: true, portal_faq: true }))
  assert.deepEqual([some.level, some.partial], ['none', { on: 2, total: 4 }])
  const all = moduleState(portal, state({ portal_posts: true, portal_faq: true, portal_about: true, customer_portal: true }))
  assert.deepEqual([all.level, all.partial], ['full', null])
  assert.deepEqual(applyModuleLevel(portal, 'full', state({ portal_posts: true })), { portal_posts: true, portal_faq: true, portal_about: true, customer_portal: true }, 'Full on a partial grant completes it')
  assert.deepEqual(applyModuleLevel(portal, 'none', state({ portal_posts: true, customer_portal: true })), {})
  assert.deepEqual(toggleGrant(state({ portal_posts: true }), 'portal_faq'), { portal_posts: true, portal_faq: true })
})

test('levels read back as stored: Review, View, Full and None, never a "custom" mix', () => {
  assert.equal(moduleState(row('products'), state({ products: 'review' })).level, 'review')
  assert.equal(moduleState(row('settings'), state({ settings: 'view' })).level, 'view')
  assert.equal(moduleState(row('products'), employee).level, 'full', 'the Employee preset reads Full, not Custom')
  assert.equal(moduleState(row('contacts'), employee).level, 'full')
  assert.equal(moduleState(row('inventory'), employee).level, 'none')
  assert.equal(moduleState(row('settings'), employee).level, 'none')
  assert.equal(moduleState(row('settings'), employee).extrasOn, 1, 'Receipts is on although Settings is None')
  for (const entry of MODULE_ROWS) assert.equal(moduleState(entry, state({ all: true })).level, 'full', `${entry.id} under Administrator`)
})

test('Inventory check sessions is its own on/off grant: Inventory does not feed it, Full writes true, None removes the key', () => {
  const sub = row('inventory_checks')
  const inventoryOn = state({ inventory: true })
  assert.equal(moduleState(sub, inventoryOn).level, 'none', 'Inventory alone grants no counting')
  assert.equal(moduleIsOn(sub, inventoryOn), false)
  assert.equal(Object.hasOwn(moduleState(sub, inventoryOn), 'follows'), false, 'there is no "follows Inventory" state any more')
  assert.deepEqual(applyModuleLevel(sub, 'full', inventoryOn), { inventory: true, inventory_checks: true })
  const on = state({ inventory: true, inventory_checks: true })
  assert.equal(moduleState(sub, on).level, 'full')
  assert.deepEqual(applyModuleLevel(sub, 'none', on), { inventory: true }, 'None removes the key: absent and false are the same now')
  assert.equal(applyModuleLevel(sub, 'full', on), on)
  assert.equal(applyModuleLevel(sub, 'none', inventoryOn), inventoryOn)
  assert.equal(moduleChanged(sub, state({ inventory: true, inventory_checks: false }), inventoryOn), false, 'a stored false equals absent')
  assert.equal(moduleChanged(sub, on, inventoryOn), true)
  assert.deepEqual(toggleGrant(state({ inventory_checks: true }), 'inventory_check_show_stock'), { inventory_checks: true, inventory_check_show_stock: true }, 'a field switch is a plain on/off grant')
  assert.deepEqual(toggleGrant(state({ inventory_checks: true, inventory_check_show_stock: true }), 'inventory_check_show_stock'), { inventory_checks: true })
})

const chip = (id: string, perms: Record<string, unknown>, action: string) => chipStates(row(id), state(perms)).find((entry) => entry.action.key === action)!

test('chips: nothing is drawn at None or under Administrator', () => {
  assert.deepEqual(chipStates(row('products'), state({})), [])
  assert.deepEqual(chipStates(row('inventory'), state({ inventory_checks: true })), [], 'Inventory draws no chips at None')
  assert.deepEqual(chipStates(row('products'), state({ all: true })), [])
})

test('chips: contacts bulk delete, merge and import need the bulk switch', () => {
  for (const action of ['bulk_delete', 'merge', 'import']) {
    assert.equal(chip('contacts', { contacts: true }, action).mark, 'allow', action)
    const needs = chip('contacts', { contacts: true, 'contacts:bulk': false }, action)
    assert.equal(needs.mark, 'needs', action)
    assert.deepEqual(needs.missing.map((requirement) => requirement.key), ['contacts:bulk'])
    assert.equal(needs.canToggle, true, 'still its own live switch')
  }
  assert.equal(chip('contacts', { contacts: true, 'contacts:bulk': false }, 'bulk').mark, 'off')
  assert.equal(chip('contacts', { contacts: true, 'contacts:bulk': false }, 'delete').mark, 'allow')
})

test('chips: Add variant needs Add; opening stock and stock in imports need Adjust / receive', () => {
  assert.equal(chip('products', { products: true }, 'variant').mark, 'allow')
  assert.equal(chip('products', { products: true, 'products:add': false }, 'variant').mark, 'needs')
  const add = chip('products', { products: true }, 'add')
  assert.deepEqual(add.controls.map((control) => [control.action.key, control.mark]), [['opening_stock', 'needs']])
  assert.deepEqual(add.controls[0].missing.map((requirement) => requirement.key), ['inventory:adjust'])
  assert.deepEqual(chip('products', { products: true, inventory: true }, 'add').controls.map((control) => control.mark), ['allow'])
  assert.deepEqual(chip('products', { products: true, inventory: true, 'inventory:adjust': false }, 'add').controls.map((control) => control.mark), ['needs'])
  assert.deepEqual(chip('products', { products: true, inventory: true, 'products:add': false }, 'add').controls.map((control) => control.mark), ['off'], 'a control follows its parent\'s switch')
  const imp = chip('products', { products: true, product_cost_view: true, product_cost_edit: true, inventory: true }, 'import')
  assert.equal(imp.mark, 'allow')
  assert.deepEqual(imp.controls.map((control) => [control.action.key, control.mark]), [['import_stock', 'allow']])
  assert.deepEqual(chip('products', { products: true, inventory: true }, 'import').controls.map((control) => control.mark), ['needs'], 'the import itself is unavailable, so its stock control is too')
  assert.deepEqual(chip('products', { products: 'review', inventory: true }, 'add').controls.map((control) => control.mark), ['fullOnly'], 'Review never reaches a control')
  assert.deepEqual(chip('products', { products: 'review', inventory: true, 'products:add': false }, 'add').controls.map((control) => control.mark), ['off'], 'a switched-off parent beats the level: the control is off, not "Full only"')
  assert.deepEqual(chip('inventory', { inventory: 'review', 'inventory:edit_reasons': false }, 'edit_reasons').controls.map((control) => control.mark), ['off'])
  assert.deepEqual(chip('inventory', { inventory: 'review' }, 'edit_reasons').controls.map((control) => control.mark), ['fullOnly'])
})

test('chips: a level that blocks an action says Full only, never Hidden, and the chip is inert', () => {
  for (const action of ['import', 'bulk_delete', 'export']) {
    const blocked = chip('products', { products: 'review' }, action)
    assert.deepEqual([blocked.mark, blocked.canToggle, blocked.pressed], ['fullOnly', false, undefined], action)
  }
  const queued = chip('products', { products: 'review' }, 'add')
  assert.deepEqual([queued.mark, queued.canToggle, queued.pressed], ['queue', true, true])
  assert.equal(chip('products', { products: 'review' }, 'image').toolNeedsFull, true, 'the image tool itself needs Full')
  assert.equal(chip('products', { products: 'review', 'products:image': false }, 'image').toolNeedsFull, false, 'not once it is switched off')
  assert.equal(chip('contacts', { contacts: 'review' }, 'edit').mark, 'limited')
  assert.equal(chip('sales', { sales: 'view' }, 'status').mark, 'fullOnly')
  assert.equal(chip('sales', { sales: 'view' }, 'export').mark, 'allow')
})

test('chips: a switched-off action is handed back by a tap, and a stored false under a blocking level stays neutral', () => {
  const off = chip('products', { products: true, 'products:delete': false }, 'delete')
  assert.deepEqual([off.mark, off.pressed, off.canToggle], ['off', false, true])
  const neutral = chip('products', { products: 'review', 'products:bulk_delete': false }, 'bulk_delete')
  assert.deepEqual([neutral.mark, neutral.pressed, neutral.canToggle], ['fullOnly', undefined, false])
})

test('chips: Contacts View is locked on while Add or Edit is on', () => {
  const locked = chip('contacts', { contacts: true, 'contacts:view': false }, 'view')
  assert.deepEqual([locked.viewLocked, locked.canToggle, locked.mark, locked.pressed], [true, false, 'allow', true])
  const free = chip('contacts', { contacts: true, 'contacts:add': false, 'contacts:edit': false, 'contacts:view': false }, 'view')
  assert.deepEqual([free.viewLocked, free.canToggle, free.mark], [false, true, 'off'])
})

test('chips: Inventory has no Count chip (counting is its own grant) and the sub-row draws its two', () => {
  assert.equal(chipStates(row('inventory'), state({ inventory: true })).some((entry) => entry.action.key === 'check'), false)
  assert.deepEqual(chipStates(row('inventory_checks'), state({ inventory: true })), [], 'the sub-row has no chips while it is not granted')
  assert.deepEqual(chipStates(row('inventory_checks'), state({ inventory_checks: true })).map((entry) => entry.action.key), ['view', 'check'])
})

test('switched-off and waiting-for-approval counts match the Employee preset and Review', () => {
  const counts = roleTierCounts(employee)
  assert.deepEqual(counts, { none: 11, view: 0, review: 0, full: 5, off: 20 })
  assert.equal(moduleState(row('products'), employee).off, 13)
  assert.equal(moduleState(row('products'), state({ products: 'review' })).queued, 7, 'add, edit, delete, image, merge duplicates, price and supplier all wait for approval')
  assert.deepEqual(roleTierCounts(state({ all: true })), { none: 0, view: 0, review: 0, full: MODULE_ROWS.filter((entry) => !entry.sub).length, off: 0 })
})

test('what the role can do: allowed actions, then extras that are on; Administrator reads "All actions"', () => {
  assert.deepEqual(moduleCanDo(row('products'), state({ products: 'review' }), tr), ['View', 'History'], 'queued actions are counted on the row, not listed as done')
  assert.deepEqual(moduleCanDo(row('products'), state({ products: true, 'products:delete': false, 'products:bulk_delete': false, 'products:variant': false, 'products:add': false, product_cost_view: true }), tr).slice(0, 2), ['View', 'Edit'])
  assert.ok(moduleCanDo(row('products'), state({ products: true, product_cost_view: true }), tr).includes('See costs'))
  assert.deepEqual(moduleCanDo(row('settings'), employee, tr), ['Receipts'], 'an extra on under a None level still reads')
  assert.deepEqual(moduleCanDo(row('inventory'), state({}), tr), [], 'nothing to say at None')
  assert.deepEqual(moduleCanDo(row('products'), state({ all: true }), tr), ['All actions'])
  assert.equal(moduleCanDo(row('settings'), state({ settings: true }), tr).includes('Google Drive'), false, 'Settings Full does not include Google Drive')
  assert.ok(moduleCanDo(row('settings'), state({ settings: true, drive_credentials: true }), tr).includes('Google Drive'), 'a stored extra reads as held')
})

test('the highest sensitivity the role holds in a row drives the shield', () => {
  assert.equal(moduleState(row('dashboard'), state({ dashboard: true })).sensitivity, 'normal')
  assert.equal(moduleState(row('sales'), state({ sales: 'view' })).sensitivity, 'high')
  assert.equal(moduleState(row('sales'), state({})).sensitivity, 'normal', 'nothing held, no shield')
  assert.equal(moduleState(row('products'), state({ products: true })).sensitivity, 'normal')
  assert.equal(moduleState(row('products'), state({ products: true, destructive_delete: true })).sensitivity, 'critical')
  assert.equal(moduleState(row('settings'), state({ settings: true })).sensitivity, 'normal', 'Settings Full alone holds nothing critical')
  assert.equal(moduleState(row('settings'), state({ settings: true, drive_credentials: true })).sensitivity, 'critical', 'a stored Google Drive switch is critical')
})

test('changed: only the rows that differ from the saved role, by stored key, with absent equal to off', () => {
  const baseline = { pos: true }
  const draft = state({ pos: true, sales: true })
  assert.deepEqual(MODULE_ROWS.filter((entry) => moduleChanged(entry, draft, baseline)).map((entry) => entry.id), ['sales'])
  assert.equal(moduleChanged(row('pos'), draft, baseline), false)
  assert.equal(moduleChanged(row('pos'), draft, undefined), false, 'a new role has no baseline')
  assert.equal(moduleChanged(row('sales'), state({ pos: true, sales: false }), baseline), false, 'a stored false equals absent')
  assert.equal(moduleChanged(row('sales'), state({ pos: true, 'sales:amend': false }), baseline), true, 'a switched-off action is a change')
  assert.equal(moduleChanged(row('sales'), state({ pos: true, 'sales:amend': true }), baseline), false, 'a stored true switch equals the default')
  assert.equal(moduleChanged(row('sales'), draft, JSON.stringify({ pos: true, sales: true })), false, 'the baseline may be the stored JSON text')
  assert.equal(moduleChanged(row('inventory_checks'), state({ inventory_checks: true, inventory_check_show_stock: true }), { inventory_checks: true }), true, 'a field switch turned on is a change')
  assert.equal(moduleChanged(row('inventory_checks'), state({ inventory_checks: true, inventory_check_show_stock: false }), { inventory_checks: true }), false, 'a stored false field equals absent')
  assert.equal(MODULE_ROWS.filter((entry) => moduleChanged(entry, state({ all: true }), baseline)).length, MODULE_ROWS.length, 'Administrator changes every row')
})

test('search finds a row by its module, a chip by its words, and rings only the chips that match', () => {
  assert.equal(searchRow(row('products'), '', tr).hit, true)
  assert.equal(searchRow(row('sales'), 'dashboard', tr).hit, false)
  assert.equal(searchRow(row('dashboard'), 'DASH', tr).hit, true)
  const opening = searchRow(row('products'), 'bulk', tr)
  assert.deepEqual([...opening.chips], ['action:bulk_delete'])
  assert.equal(searchRow(row('products'), 'costs', tr).chips.has('grant:product_cost_view'), true)
  assert.equal(searchRow(row('inventory_checks'), 'recorded stock', tr).chips.has('grant:inventory_check_show_stock'), true)
  assert.equal(searchRow(row('inventory'), 'sessions', tr).hit, false, 'a sub-row word does not light the main row')
  assert.equal(searchRow(row('inventory_checks'), 'sessions', tr).hit, true)
})

test('the model stays free of React and of pack lookups, so the user detail can load it light', () => {
  const source = readFileSync(new URL('../src/components/users/permissionSummary.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(imports.sort(), ['../../utils/permissionActions.ts', '../../utils/permissions.ts', './permissionDefinitions.ts'])
  assert.doesNotMatch(source, /\breact\b|useState|\.json'/)
})

if (failed) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nall tests passed')
}
