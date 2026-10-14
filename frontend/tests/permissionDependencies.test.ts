// Rows the Worker refuses unless a second grant is held: the role editor names the grant on the row, shows the row as
// unavailable until it is held, and can() offers no page control without it.
//
// Run: node tests/permissionDependencies.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { PERMISSION_ACTIONS, outcomeAt, type PermissionAction } from '../src/utils/permissionActions.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const rowOf = (section: string, key: string): PermissionAction => PERMISSION_ACTIONS[section].find((action) => action.key === key)!
const can = (permissions: Record<string, unknown>, section: string, action: string, role = 'staff') =>
  effectivePermissions({ role_code: role, permissions }).can(section, action)
const COSTS = { product_cost_edit: true, product_cost_view: true }
const definitionOf = (key: string) => PERMISSION_SECTIONS.flatMap((section) => section.permissions).find((permission) => permission.key === key)

test('every second grant names a real permission or a real Full Access action, in words the editor already has', () => {
  for (const [section, actions] of Object.entries(PERMISSION_ACTIONS)) {
    for (const action of actions) {
      for (const requirement of action.requires ?? []) {
        const where = `${section}.${action.key} requires ${requirement.key}`
        assert.ok(requirement.tKey in en && requirement.tKey in km, `${where}: the label key is missing from a pack`)
        assert.equal(en[requirement.tKey], requirement.label, `${where}: the English fallback must equal the pack`)
        if (requirement.key.includes(':')) {
          const [other, otherAction] = requirement.key.split(':')
          const target = PERMISSION_ACTIONS[other]?.find((entry) => entry.key === otherAction)
          assert.ok(target, `${where}: no such action row`)
          assert.equal(outcomeAt(target, 'full'), 'allow', `${where}: only an action that is plainly allowed at Full Access can be required`)
        } else {
          const definition = definitionOf(requirement.key)
          assert.ok(definition, `${where}: not a permission the editor lists`)
          assert.equal(definition.tKey, requirement.tKey, `${where}: use the permission's own label key`)
          assert.equal(definition.label, requirement.label)
        }
      }
    }
  }
})

test('a control that follows a row rides that row, has no row of its own, and is stricter than it', () => {
  for (const [section, actions] of Object.entries(PERMISSION_ACTIONS)) {
    for (const action of actions.filter((entry) => entry.follows)) {
      const parent = actions.find((entry) => entry.key === action.follows)
      assert.ok(parent, `${section}.${action.key} follows an unknown row ${action.follows}`)
      assert.equal(parent.follows, undefined, `${section}.${action.key}: a control cannot follow another control`)
      assert.equal(action.review, 'block', `${section}.${action.key}: a followed control is the Full Access part of its row`)
      assert.ok(en[action.tKey] === action.label && km[action.tKey], `${section}.${action.key}: label must be in both packs`)
    }
  }
})

test('the inventory and sales import rows carry the same cost grants as the products import row', () => {
  const products = rowOf('products', 'import').requires
  assert.deepEqual(products?.map((requirement) => requirement.key), ['product_cost_edit', 'product_cost_view'])
  assert.deepEqual(rowOf('inventory', 'import').requires, products)
  assert.deepEqual(rowOf('sales', 'import').requires, products)
  assert.equal(rowOf('contacts', 'import').requires, undefined, 'contacts imports carry no costs')
})

test('Import for products, inventory and sales is unavailable without both cost grants', () => {
  for (const [section, base] of [['products', { products: true }], ['inventory', { inventory: true }], ['sales', { sales: true }]] as const) {
    assert.equal(can(base, section, 'import'), false, `${section}: no cost grant`)
    assert.equal(can({ ...base, product_cost_edit: true }, section, 'import'), false, `${section}: creating a job needs edit, reading it back needs view`)
    assert.equal(can({ ...base, product_cost_view: true }, section, 'import'), false, `${section}: view alone cannot create the job`)
    assert.equal(can({ ...base, ...COSTS }, section, 'import'), true, `${section}: both grants`)
    assert.equal(can({ ...base, ...COSTS, [`${section}:import`]: false }, section, 'import'), false, `${section}: switched off wins`)
    assert.equal(can({}, section, 'import', 'admin'), true, `${section}: an administrator holds every grant`)
  }
  assert.equal(can({ products: 'review', ...COSTS }, 'products', 'import'), false, 'Partial Access never imports')
  assert.equal(can({ sales: 'view', ...COSTS }, 'sales', 'import'), false, 'View only never imports')
  assert.equal(can({ contacts: true }, 'contacts', 'import'), true, 'contacts imports carry no costs')
})

test('replace-all import also needs Import, both cost grants and the destructive-import grant', () => {
  const full = { products: true, ...COSTS, destructive_delete: true }
  assert.equal(can(full, 'products', 'import_replace_all'), true)
  for (const [name, mutate] of Object.entries({
    'no destructive grant': { destructive_delete: false },
    'no cost edit': { product_cost_edit: false },
    'no cost view': { product_cost_view: false },
    'Import switched off': { 'products:import': false },
    'its own switch off': { 'products:import_replace_all': false },
  })) assert.equal(can({ ...full, ...mutate }, 'products', 'import_replace_all'), false, name)
})

test('relinking sales needs Sales customer and Reassign customer at Full Access, while keeping a conflict and merging do not', () => {
  const contacts = { contacts: true }
  assert.equal(can(contacts, 'contacts', 'resolve_conflicts'), true, 'keep, reopen and merge need no sales grant')
  assert.equal(can(contacts, 'contacts', 'relink_sales'), false)
  const sales = { contacts: true, sales: true }
  assert.equal(can(sales, 'contacts', 'relink_sales'), true)
  for (const [name, mutate] of Object.entries({
    'Sales View only': { sales: 'view' },
    'Change linked customer off': { 'sales:customer': false },
    'Reassign customer off': { 'sales:customer_reassign': false },
    'Resolve conflicts off': { 'contacts:resolve_conflicts': false },
    'Contacts Partial': { contacts: 'review' },
  })) assert.equal(can({ ...sales, ...mutate }, 'contacts', 'relink_sales'), false, name)
  assert.equal(can({ ...sales, 'sales:customer': false }, 'contacts', 'resolve_conflicts'), true, 'keep and merge stay available')
  assert.equal(can({}, 'contacts', 'relink_sales', 'admin'), true)
})

test('renaming a saved inventory reason needs Full Access and follows the edit-reasons switch', () => {
  assert.equal(can({ inventory: true }, 'inventory', 'rename_reasons'), true)
  assert.equal(can({ inventory: 'review' }, 'inventory', 'edit_reasons'), true, 'Partial Access still edits the list, queued')
  assert.equal(can({ inventory: 'review' }, 'inventory', 'rename_reasons'), false, 'but the rename is refused')
  assert.equal(can({ inventory: true, 'inventory:edit_reasons': false }, 'inventory', 'rename_reasons'), false)
  assert.equal(can({}, 'inventory', 'rename_reasons', 'admin'), true)
})

test('the sale-link conflicts tab offers Relink and Resolve missing only with relink_sales, and keep or reopen with resolve_conflicts', () => {
  const source = readFileSync(new URL('../src/components/contacts/SaleLinkConflictsSection.tsx', import.meta.url), 'utf8')
  assert.match(source, /const canRelinkSales = can\('contacts', 'relink_sales'\)/)
  assert.match(source, /\{canRelinkSales && suggestion \? \(/, 'Relink')
  assert.match(source, /\{canRelinkSales \? <div className="mt-1\.5">/, 'Resolve missing')
  assert.equal((source.match(/canResolveConflicts && row\.dismissed/g) || []).length, 2, 'Reopen stays on resolve_conflicts')
  assert.equal((source.match(/\) : canResolveConflicts \? \(/g) || []).length, 2, 'Keep stays on resolve_conflicts')
})

test('the saved-reasons manager offers rename only with rename_reasons, and the list editor hides the control without a handler', () => {
  const manager = readFileSync(new URL('../src/components/shared/StockReasonsManagerModal.tsx', import.meta.url), 'utf8')
  assert.match(manager, /onRename=\{can\('inventory', 'rename_reasons'\) \? \(entry, to\) => catalog\.rename\(entry, to\) : undefined\}/)
  const editor = readFileSync(new URL('../src/components/shared/ReasonListEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /\{onRename \? \(\s*<button/, 'no handler, no rename control')
})

const stubs: Record<string, string> = {
  InfoHint: `export default function InfoHint(props) { return null }`,
  AppSelect: `export default function AppSelect(props) { return null }`,
}
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  plugins: [{
    name: 'stub-shared-widgets',
    setup(b) {
      b.onResolve({ filter: /shared\/(InfoHint|AppSelect)\.tsx$/ }, (args) => ({ path: args.path.replace(/.*shared\/(\w+)\.tsx$/, '$1'), namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    },
  }],
})
const mod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(nodeRequire, mod, mod.exports)
const PermissionEditor = mod.exports.default as React.ComponentType<Record<string, unknown>>

const render = (pack: Record<string, string>, permissions: Record<string, unknown>) => renderToStaticMarkup(React.createElement(PermissionEditor, {
  permissions, onChange: () => {}, t: (key: string) => pack[key],
}))
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rowButton = (html: string, label: string): string => {
  const found = html.match(new RegExp(`<button(?:(?!</button>)[\\s\\S])*?>${escapeRegExp(label)}<(?:(?!</button>)[\\s\\S])*?</button>`))
  assert.ok(found, `the editor renders no "${label}" row`)
  return found[0]
}
const attribute = (button: string, name: string): string | null => button.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_match, key) => values[key])
const list = (pack: Record<string, string>, keys: string[]) => keys.map((key) => pack[key]).join(', ')

for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
  const alsoNeeds = (keys: string[]) => fill(pack.perm_action_also_needs, { list: list(pack, keys) })
  const importNeeds = alsoNeeds(['perm_product_cost_edit', 'perm_product_cost_view'])

  test(`${name}: an import row without the cost grants says what it needs and reads Hidden`, () => {
    const row = rowButton(render(pack, { products: true }), pack.perm_act_products_import)
    assert.ok(row.includes(importNeeds), 'the hint')
    assert.ok(row.includes('text-amber-700'), 'the missing grant is flagged')
    assert.ok(row.includes(`>${pack.perm_outcome_block}<`), 'the badge reads Hidden while the grants are missing')
    assert.equal(attribute(row, 'aria-pressed'), 'true', 'still a live switch for the tier')
  })

  test(`${name}: an import row with the cost grants reads Allowed and keeps a quiet hint`, () => {
    const row = rowButton(render(pack, { products: true, ...COSTS }), pack.perm_act_products_import)
    assert.ok(row.includes(importNeeds))
    assert.ok(!row.includes('text-amber-700'))
    assert.ok(row.includes(`>${pack.perm_outcome_allow}<`))
  })

  test(`${name}: replace-all lists every second grant`, () => {
    const row = rowButton(render(pack, { products: true }), pack.perm_act_products_import_replace_all)
    assert.ok(row.includes(alsoNeeds(['perm_act_products_import', 'perm_product_cost_edit', 'perm_product_cost_view', 'perm_destructive_delete'])))
  })

  test(`${name}: a tier that blocks the row shows no hint`, () => {
    const row = rowButton(render(pack, { products: 'review' }), pack.perm_act_products_import)
    assert.ok(!row.includes(importNeeds))
    assert.equal(attribute(row, 'title'), pack.perm_action_tier_blocked)
  })

  test(`${name}: resolve conflicts names the sales grants its relink control needs, without hiding the row`, () => {
    const hint = fill(pack.perm_action_control_also_needs, {
      control: pack.perm_control_relink_sales,
      list: list(pack, ['perm_req_sales_customer', 'perm_req_sales_customer_reassign']),
    })
    const lacking = rowButton(render(pack, { contacts: true }), pack.perm_act_contacts_resolve_conflicts)
    assert.ok(lacking.includes(hint) && lacking.includes('text-amber-700'))
    assert.ok(lacking.includes(`>${pack.perm_outcome_allow}<`), 'keep, reopen and merge are still allowed')
    const held = rowButton(render(pack, { contacts: true, sales: true }), pack.perm_act_contacts_resolve_conflicts)
    assert.ok(held.includes(hint) && !held.includes('text-amber-700'))
    const partial = rowButton(render(pack, { contacts: 'review' }), pack.perm_act_contacts_resolve_conflicts)
    assert.ok(!partial.includes(hint), 'a tier that blocks the row shows no hint')
  })

  test(`${name}: a followed control has no row of its own and nothing is left unfilled`, () => {
    const html = render(pack, { contacts: true, inventory: 'review', products: true })
    const rowLabel = (label: string) => `text-xs text-gray-600 dark:text-gray-300">${label}<`
    for (const key of ['perm_control_relink_sales', 'perm_control_rename_reasons']) {
      assert.ok(!html.includes(rowLabel(pack[key])), `${key} must not be a row`)
    }
    assert.ok(html.includes(rowLabel(pack.perm_act_contacts_resolve_conflicts)) && html.includes(rowLabel(pack.perm_act_inventory_edit_reasons)), 'the rows they follow are rendered')
    assert.ok(!/\{(list|control)\}/.test(html), 'every placeholder is replaced')
  })

  test(`${name}: at Partial Access the edit-reasons row says renaming needs Full Access, and not once switched off`, () => {
    const sentence = fill(pack.perm_action_control_needs_full, { control: pack.perm_control_rename_reasons })
    const row = rowButton(render(pack, { inventory: 'review' }), pack.perm_act_inventory_edit_reasons)
    assert.ok((attribute(row, 'title') ?? '').includes(sentence))
    const off = rowButton(render(pack, { inventory: 'review', 'inventory:edit_reasons': false }), pack.perm_act_inventory_edit_reasons)
    assert.ok(!(attribute(off, 'title') ?? '').includes(sentence))
  })

  test(`${name}: a merge or image row switched off never says an edit waits for approval`, () => {
    for (const label of ['perm_act_products_merge_duplicates', 'perm_act_products_image']) {
      const on = rowButton(render(pack, { products: 'review' }), pack[label])
      assert.ok((attribute(on, 'title') ?? '').includes(pack.perm_action_review_tool_full), `${label}: on`)
      const off = rowButton(render(pack, { products: 'review', [`products:${label.replace('perm_act_products_', '')}`]: false }), pack[label])
      assert.ok(!(attribute(off, 'title') ?? '').includes(pack.perm_action_review_tool_full), `${label}: off`)
      assert.ok((attribute(off, 'title') ?? '').includes(pack.perm_action_restore), `${label}: off still offers the hand-back`)
    }
  })
}

test('the new strings exist in both packs with the same placeholders, and the retired note is gone', () => {
  const keys = ['perm_action_also_needs', 'perm_action_control_also_needs', 'perm_action_control_needs_full', 'perm_control_relink_sales', 'perm_control_rename_reasons', 'perm_req_sales_customer', 'perm_req_sales_customer_reassign']
  const holes = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join(',')
  for (const key of keys) {
    assert.ok(en[key] && km[key], `${key} must be in both packs`)
    assert.equal(holes(km[key]), holes(en[key]), `${key}: placeholders must match`)
  }
  assert.ok(!('perm_actions_requires_extra' in en) && !('perm_actions_requires_extra' in km))
})

if (failed) {
  console.error(`${failed} test(s) FAILED`)
  process.exit(1)
}
