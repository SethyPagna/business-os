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
  MODULE_ROWS, applyModuleLevel, chipStates, followInventory, isCoveredByFull, levelsOf, moduleCanDo, moduleChanged, moduleIsOn, moduleState,
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
  assert.deepEqual(extras('settings'), ['business_identity', 'sales_policy', 'receipt_settings', 'security_settings', 'drive_credentials'])
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
  const separate = ['product_cost_view', 'product_cost_edit', 'destructive_delete', 'security_settings', 'drive_credentials', 'backup_restore', 'contacts_suppliers']
  for (const entry of MODULE_ROWS) {
    for (const level of levelsOf(entry)) {
      for (const key of separate) assert.ok(applyModuleLevel(entry, level, {})[key] !== true, `${entry.id} ${level} wrote ${key}`)
    }
  }
})

test('Full leaves a module\'s sensitive extras to the Worker\'s own reading: only the declared included ones are held', () => {
  // Effective grants after a Full tap, asked of the real authority: an extra is held only when the catalog says Full includes it.
  const included = new Set<string>()
  for (const entry of MODULE_ROWS) {
    const perms = applyModuleLevel(entry, 'full', {})
    const authority = effectivePermissions({ permissions: perms })
    for (const def of [...entry.extras, ...(entry.imageOnly ? [entry.imageOnly.toggle] : [])]) {
      if (entry.group.includes(def)) continue
      const held = authority.hasPermission(def.key)
      assert.equal(held, !!def.coveredBy, `${entry.id} Full: ${def.key} ${held ? 'is' : 'is not'} held but the catalog says ${def.coveredBy ? 'included' : 'separate'}`)
      assert.equal(isCoveredByFull(def, perms), held, `${def.key}: the editor's reading matches the authority`)
      if (held) included.add(def.key)
    }
  }
  assert.deepEqual([...included].sort(), ['business_identity', 'drive_credentials', 'sales_policy'], 'Settings Full still covers these three on the Worker today')
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
  assert.deepEqual(applyModuleLevel(row('inventory_checks'), 'none', inventory), { inventory: true, inventory_checks: false, inventory_check_show_stock: false }, 'and the sub-row denies only itself, with a stored false')
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

test('Inventory check sessions follows Inventory while it is not set', () => {
  const sub = row('inventory_checks')
  assert.deepEqual([moduleState(sub, state({ inventory: true })).level, moduleState(sub, state({ inventory: true })).follows], ['none', true])
  assert.equal(moduleState(sub, state({})).follows, false, 'nothing to follow while Inventory is None')
  assert.equal(moduleState(sub, state({ inventory: true, inventory_checks: true })).follows, false)
  assert.equal(moduleState(sub, state({ inventory: true, inventory_checks: true })).level, 'full')
  assert.equal(moduleState(sub, state({ inventory: true, inventory_checks: false })).follows, false, 'a stored false is a decision, not an absence')
  assert.equal(moduleIsOn(sub, state({ inventory: true })), true)
  assert.equal(moduleIsOn(sub, state({})), false)
})

test('Inventory check sessions stores an explicit true or false, and only an absent key follows Inventory', () => {
  const sub = row('inventory_checks')
  const following = state({ inventory: true })
  // From following: Full grants, None denies. Both write the key; the Worker reads whether it is present.
  assert.deepEqual(applyModuleLevel(sub, 'full', following), { inventory: true, inventory_checks: true })
  assert.deepEqual(applyModuleLevel(sub, 'none', following), { inventory: true, inventory_checks: false }, 'None while following stores a false; it is not a no-op and not a delete')
  assert.equal(moduleState(sub, applyModuleLevel(sub, 'none', following)).follows, false, 'after the tap the row no longer follows')
  assert.equal(moduleState(sub, applyModuleLevel(sub, 'none', following)).level, 'none')
  // From a stored value: the other level flips it; the same level changes nothing.
  const on = state({ inventory: true, inventory_checks: true })
  const off = state({ inventory: true, inventory_checks: false })
  assert.deepEqual(applyModuleLevel(sub, 'none', on), off)
  assert.deepEqual(applyModuleLevel(sub, 'full', off), on)
  assert.equal(applyModuleLevel(sub, 'full', on), on)
  assert.equal(applyModuleLevel(sub, 'none', off), off)
  // Inventory off: None still stores the decision, so turning Inventory on later does not hand counting back.
  assert.deepEqual(applyModuleLevel(sub, 'none', state({})), { inventory_checks: false })
  // A stored false and an absent key are different to the Changed filter, because the Worker treats them differently.
  assert.equal(moduleChanged(sub, off, following), true)
  assert.equal(moduleChanged(sub, following, off), true)
  assert.equal(moduleChanged(sub, off, off), false)
  assert.equal(moduleChanged(sub, state({ inventory: true }), state({ inventory: true })), false)
})

test('following Inventory again drops the count-session row’s own setting and nothing else', () => {
  const sub = row('inventory_checks')
  const own = state({ inventory: true, inventory_checks: false, inventory_check_show_stock: false, sales: true })
  assert.deepEqual(followInventory(sub, own), { inventory: true, inventory_check_show_stock: false, sales: true })
  assert.deepEqual(followInventory(sub, state({ inventory: true, inventory_checks: true })), { inventory: true })
  const none = state({ inventory: true })
  assert.equal(followInventory(sub, none), none, 'already following: the same map')
  assert.equal(followInventory(row('inventory'), own), own, 'only the count-session row follows anything')
  const admin = state({ all: true, inventory_checks: false })
  assert.equal(followInventory(sub, admin), admin, 'Administrator is never edited from here')
  assert.equal(moduleState(sub, followInventory(sub, own)).follows, true)
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

test('chips: Inventory\'s Count chip defers to Inventory check sessions whenever that key is stored, and counting is one chip', () => {
  const deferred = chip('inventory', { inventory: true, inventory_checks: true }, 'check')
  assert.deepEqual([deferred.setByCountSessions, deferred.canToggle, deferred.pressed], [true, false, undefined])
  const own = chip('inventory', { inventory: true }, 'check')
  assert.deepEqual([own.setByCountSessions, own.canToggle, own.pressed], [false, true, true])
  assert.equal(chip('inventory', { inventory: true, inventory_checks: false }, 'check').setByCountSessions, true)
  assert.deepEqual(chipStates(row('inventory_checks'), state({ inventory: true })), [], 'the sub-row has no chips while it only follows Inventory')
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
  assert.ok(moduleCanDo(row('settings'), state({ settings: true }), tr).includes('Google Drive'), 'an included extra reads as held')
})

test('the highest sensitivity the role holds in a row drives the shield', () => {
  assert.equal(moduleState(row('dashboard'), state({ dashboard: true })).sensitivity, 'normal')
  assert.equal(moduleState(row('sales'), state({ sales: 'view' })).sensitivity, 'high')
  assert.equal(moduleState(row('sales'), state({})).sensitivity, 'normal', 'nothing held, no shield')
  assert.equal(moduleState(row('products'), state({ products: true })).sensitivity, 'normal')
  assert.equal(moduleState(row('products'), state({ products: true, destructive_delete: true })).sensitivity, 'critical')
  assert.equal(moduleState(row('settings'), state({ settings: true })).sensitivity, 'critical', 'Settings Full includes Google Drive, which is critical')
})

test('Settings Full shows its included extras as held and locked; View and None do not', () => {
  const settings = row('settings')
  for (const key of ['business_identity', 'sales_policy', 'drive_credentials']) {
    const def = settings.extras.find((entry) => entry.key === key)!
    assert.equal(isCoveredByFull(def, state({ settings: true })), true, key)
    assert.equal(isCoveredByFull(def, state({ settings: 'view' })), false, key)
    assert.deepEqual(toggleGrant(state({ settings: true }), key), state({ settings: true }), `${key} cannot be switched off under Full`)
    assert.equal(toggleGrant(state({ settings: 'view' }), key)[key], true, `${key} is a normal switch under View`)
  }
  for (const key of ['receipt_settings', 'security_settings']) {
    assert.equal(isCoveredByFull(settings.extras.find((entry) => entry.key === key)!, state({ settings: true })), false, `${key} stays separate`)
  }
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
  assert.equal(moduleChanged(row('inventory_checks'), state({ inventory_checks: true, inventory_check_show_stock: false }), { inventory_checks: true }), true, 'a field switch is a change')
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
