// Rows the Worker refuses unless a second grant is held: the role editor names the grant on the row, shows the row as
// unavailable until it is held, and can() offers no page control without it.
//
// Run: node tests/permissionDependencies.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PERMISSION_ACTIONS, outcomeAt, type PermissionAction } from '../src/utils/permissionActions.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

let failed = 0
// The harness reads one shared document, so a test that throws before unmounting must not hand its editor to the next one.
const live: MountedSurface[] = []
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const rowOf = (section: string, key: string): PermissionAction => PERMISSION_ACTIONS[section].find((action) => action.key === key)!
const can = (permissions: Record<string, unknown>, section: string, action: string, role = 'staff') =>
  effectivePermissions({ role_code: role, permissions }).can(section, action)
const COSTS = { product_cost_edit: true, product_cost_view: true }
const definitionOf = (key: string) => PERMISSION_SECTIONS.flatMap((section) => section.permissions).find((permission) => permission.key === key)

await test('every second grant names a real permission or a real Full Access action, in words the editor already has', () => {
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

await test('a control that follows a row rides that row, has no row of its own, and is stricter than it', () => {
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

await test('the inventory and sales import rows carry the same cost grants as the products import row', () => {
  const products = rowOf('products', 'import').requires
  assert.deepEqual(products?.map((requirement) => requirement.key), ['product_cost_edit', 'product_cost_view'])
  assert.deepEqual(rowOf('inventory', 'import').requires, products)
  assert.deepEqual(rowOf('sales', 'import').requires, products)
  assert.deepEqual(rowOf('contacts', 'import').requires?.map((requirement) => requirement.key), ['contacts:bulk'], 'contacts imports carry no costs, only the umbrella bulk switch')
})

await test('contacts bulk delete, merge and import are unavailable while Select and change multiple contacts is off', () => {
  const base = { contacts: true }
  for (const action of ['bulk_delete', 'merge', 'import']) {
    assert.deepEqual(rowOf('contacts', action).requires?.map((requirement) => requirement.key), ['contacts:bulk'], `${action} names the umbrella switch`)
    assert.equal(can(base, 'contacts', action), true, `${action}: nothing switched off`)
    assert.equal(can({ ...base, 'contacts:bulk': false }, 'contacts', action), false, `${action}: the Worker refuses it without contacts:bulk`)
    assert.equal(can({ ...base, 'contacts:bulk': false, [`contacts:${action}`]: true }, 'contacts', action), false, `${action}: a stored true never grants`)
    assert.equal(can({ ...base, [`contacts:${action}`]: false }, 'contacts', action), false, `${action}: its own switch off`)
    assert.equal(can({ contacts: 'review' }, 'contacts', action), false, `${action}: Review never reaches it`)
    assert.equal(can({}, 'contacts', action, 'admin'), true, `${action}: an administrator holds every grant`)
  }
  assert.equal(can({ ...base, 'contacts:bulk': false }, 'contacts', 'delete'), true, 'a single delete is not behind the umbrella switch')
  assert.equal(can({ ...base, 'contacts:bulk': false }, 'contacts', 'export'), true, 'export is not behind the umbrella switch')
})

await test('Add variant needs Add product', () => {
  assert.deepEqual(rowOf('products', 'variant').requires?.map((requirement) => requirement.key), ['products:add'])
  assert.equal(can({ products: true }, 'products', 'variant'), true)
  assert.equal(can({ products: true, 'products:add': false }, 'products', 'variant'), false, 'the Worker refuses a variant without Add')
  assert.equal(can({ products: true, 'products:variant': false }, 'products', 'variant'), false, 'its own switch off')
  assert.equal(can({ products: 'review' }, 'products', 'variant'), false, 'Review never adds a variant')
  assert.equal(can({}, 'products', 'variant', 'admin'), true)
})

await test('opening stock and stock quantities in product imports are controls that need Adjust / receive at Full', () => {
  for (const [control, parent] of [['opening_stock', 'add'], ['import_stock', 'import']] as const) {
    const row = rowOf('products', control)
    assert.equal(row.follows, parent, `${control} rides ${parent}`)
    assert.deepEqual(row.requires?.map((requirement) => requirement.key), ['inventory:adjust'])
    const base: Record<string, unknown> = { products: true, ...COSTS }
    assert.equal(can(base, 'products', control), false, `${control}: no inventory grant`)
    assert.equal(can({ ...base, inventory: 'review' }, 'products', control), false, 'Inventory Review cannot adjust stock')
    assert.equal(can({ ...base, inventory: true }, 'products', control), true, `${control}: Inventory Full`)
    assert.equal(can({ ...base, inventory: true, 'inventory:adjust': false }, 'products', control), false, 'Adjust / receive switched off')
    assert.equal(can({ ...base, inventory: true, [`products:${parent}`]: false }, 'products', control), false, `${control} follows ${parent}: parent off`)
    assert.equal(can({ ...base, inventory: true, [`products:${control}`]: false }, 'products', control), true, 'a control has no switch of its own: only its parent narrows it')
    assert.equal(can({ products: 'review', inventory: true }, 'products', control), false, 'Review never reaches it')
    assert.equal(can({}, 'products', control, 'admin'), true)
  }
})

await test('stock quantities in inventory and stock-action imports are a control that needs Adjust / receive at Full, like the products import', () => {
  // 6.0.949 (P3-2): since 6.0.946 the Worker refuses any inventory or stock-actions file that moves stock without Adjust / receive at
  // Full, however Import is set (lib/importEngine.ts isStockAdjustImportType). The Import chip alone said "available".
  const row = rowOf('inventory', 'import_stock')
  assert.equal(row.follows, 'import', 'rides the inventory Import chip')
  assert.equal(row.review, 'block')
  assert.deepEqual(row.requires?.map((requirement) => requirement.key), ['inventory:adjust'])
  assert.deepEqual(row.requires, rowOf('products', 'import_stock').requires, 'the same second grant as the products import control')
  const base: Record<string, unknown> = { inventory: true, ...COSTS }
  assert.equal(can(base, 'inventory', 'import_stock'), true, 'Inventory Full holds Adjust / receive')
  assert.equal(can({ ...base, 'inventory:adjust': false }, 'inventory', 'import_stock'), false, 'Adjust / receive switched off: every file that moves stock is refused')
  assert.equal(can({ ...base, 'inventory:adjust': false }, 'inventory', 'import'), true, 'the Import chip itself keeps its own answer')
  assert.equal(can({ ...base, 'inventory:import': false }, 'inventory', 'import_stock'), false, 'follows Import: parent off')
  assert.equal(can({ ...base, 'inventory:import_stock': false }, 'inventory', 'import_stock'), true, 'a control has no switch of its own: only its parent narrows it')
  assert.equal(can({ inventory: 'review', ...COSTS }, 'inventory', 'import_stock'), false, 'Review never reaches it')
  assert.equal(can({}, 'inventory', 'import_stock', 'admin'), true)
})

await test('Import for products, inventory and sales is unavailable without both cost grants', () => {
  for (const [section, base] of [['products', { products: true }], ['inventory', { inventory: true }], ['sales', { sales: true }]] as const) {
    assert.equal(can(base, section, 'import'), false, `${section}: no cost grant`)
    assert.equal(can({ ...base, product_cost_edit: true }, section, 'import'), false, `${section}: creating a job needs edit, reading it back needs view`)
    assert.equal(can({ ...base, product_cost_view: true }, section, 'import'), false, `${section}: view alone cannot create the job`)
    assert.equal(can({ ...base, ...COSTS }, section, 'import'), true, `${section}: both grants`)
    assert.equal(can({ ...base, ...COSTS, [`${section}:import`]: false }, section, 'import'), false, `${section}: switched off wins`)
    assert.equal(can({}, section, 'import', 'admin'), true, `${section}: an administrator holds every grant`)
  }
  assert.equal(can({ products: 'review', ...COSTS }, 'products', 'import'), false, 'Review never imports')
  assert.equal(can({ sales: 'view', ...COSTS }, 'sales', 'import'), false, 'View never imports')
  assert.equal(can({ contacts: true }, 'contacts', 'import'), true, 'contacts imports carry no costs')
})

await test('replace-all import also needs Import, both cost grants and the destructive-import grant', () => {
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

await test('relinking sales needs Sales customer and Reassign customer at Full Access, while keeping a conflict and merging do not', () => {
  const contacts = { contacts: true }
  assert.equal(can(contacts, 'contacts', 'resolve_conflicts'), true, 'keep, reopen and merge need no sales grant')
  assert.equal(can(contacts, 'contacts', 'relink_sales'), false)
  const sales = { contacts: true, sales: true }
  assert.equal(can(sales, 'contacts', 'relink_sales'), true)
  for (const [name, mutate] of Object.entries({
    'Sales View': { sales: 'view' },
    'Change linked customer off': { 'sales:customer': false },
    'Reassign customer off': { 'sales:customer_reassign': false },
    'Resolve conflicts off': { 'contacts:resolve_conflicts': false },
    'Contacts Partial': { contacts: 'review' },
  })) assert.equal(can({ ...sales, ...mutate }, 'contacts', 'relink_sales'), false, name)
  assert.equal(can({ ...sales, 'sales:customer': false }, 'contacts', 'resolve_conflicts'), true, 'keep and merge stay available')
  assert.equal(can({}, 'contacts', 'relink_sales', 'admin'), true)
})

await test('renaming a saved inventory reason needs Full Access and follows the edit-reasons switch', () => {
  assert.equal(can({ inventory: true }, 'inventory', 'rename_reasons'), true)
  assert.equal(can({ inventory: 'review' }, 'inventory', 'edit_reasons'), true, 'Review still edits the list, queued')
  assert.equal(can({ inventory: 'review' }, 'inventory', 'rename_reasons'), false, 'but the rename is refused')
  assert.equal(can({ inventory: true, 'inventory:edit_reasons': false }, 'inventory', 'rename_reasons'), false)
  assert.equal(can({}, 'inventory', 'rename_reasons', 'admin'), true)
})

await test('the sale-link conflicts tab offers Relink and Resolve missing only with relink_sales, and keep or reopen with resolve_conflicts', () => {
  const source = readFileSync(new URL('../src/components/contacts/SaleLinkConflictsSection.tsx', import.meta.url), 'utf8')
  assert.match(source, /const canRelinkSales = can\('contacts', 'relink_sales'\)/)
  assert.match(source, /\{canRelinkSales && suggestion \? \(/, 'Relink')
  assert.match(source, /\{canRelinkSales && \(linkExisting \|\| canAddContact\) \? <div className="mt-1\.5">/, 'Resolve missing needs relink_sales, plus contacts Add unless linking an existing contact')
  assert.equal((source.match(/canResolveConflicts && row\.dismissed/g) || []).length, 2, 'Reopen stays on resolve_conflicts')
  assert.equal((source.match(/\) : canResolveConflicts \? \(/g) || []).length, 2, 'Keep stays on resolve_conflicts')
})

await test('the saved-reasons manager offers rename only with rename_reasons, and the list editor hides the control without a handler', () => {
  const manager = readFileSync(new URL('../src/components/shared/StockReasonsManagerModal.tsx', import.meta.url), 'utf8')
  assert.match(manager, /onRename=\{can\('inventory', 'rename_reasons'\) \? \(entry, to\) => catalog\.rename\(entry, to\) : undefined\}/)
  const editor = readFileSync(new URL('../src/components/shared/ReasonListEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /\{onRename \? \(\s*<button/, 'no handler, no rename control')
})

// The role editor, mounted for real with every row open: the second grant a row needs is named on the chip and in an
// amber line, the chip reads "needs another permission" until it is held, and a chip the level cannot reach reads
// "Full only". Each assertion reads the one chip (data-perm-action) or followed control (data-perm-control).
const harness = await createHarness()

const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)

async function render(pack: Record<string, string>, permissions: Record<string, unknown>): Promise<MountedSurface> {
  // The harness reads one shared document, so a second editor would be found beside the first: one at a time.
  for (const previous of live.splice(0)) await previous.unmount()
  const t = (key: string) => pack[key]
  const surface = await harness.mount({
    component: 'components/users/PermissionEditor.tsx',
    props: { permissions, onChange: () => {}, t },
    app: { t },
    doubles: {},
  })
  live.push(surface)
  for (const id of surface.findAll((node) => node.getAttribute('data-perm-module') !== null).map((node) => node.getAttribute('data-perm-module') as string)) {
    const root = surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
    const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  return surface
}
const chip = (surface: MountedSurface, module: string, key: string): MemoryNode => {
  const root = surface.find((node) => node.getAttribute('data-perm-module') === module, `module ${module}`)
  return surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-action') === key && within(node, root), `${module}.${key} chip`)
}
const control = (surface: MountedSurface, module: string, key: string): MemoryNode => {
  const root = surface.find((node) => node.getAttribute('data-perm-module') === module, `module ${module}`)
  return surface.find((node) => node.getAttribute('data-perm-control') === key && within(node, root), `${module}.${key} control`)
}
const hasChip = (surface: MountedSurface, module: string, key: string) => surface.findAll((node) => node.getAttribute('data-perm-action') === key && within(node, surface.find((entry) => entry.getAttribute('data-perm-module') === module, module))).length > 0
// The amber lines under a module's chips: one per chip or control that waits for a second grant.
const amberLines = (surface: MountedSurface, module: string): string[] => {
  const root = surface.find((node) => node.getAttribute('data-perm-module') === module, `module ${module}`)
  return surface.findAll((node) => node.tagName === 'P' && /text-amber-700/.test(node.className) && within(node, root)).map((node) => node.textContent.trim())
}
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_match, key) => values[key])
const list = (pack: Record<string, string>, keys: string[]) => keys.map((key) => pack[key]).join(', ')

for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
  const alsoNeeds = (keys: string[]) => fill(pack.perm_action_also_needs, { list: list(pack, keys) })
  const importNeeds = alsoNeeds(['perm_product_cost_edit', 'perm_product_cost_view'])
  const importLine = (keys: string[], label: string) => fill(pack.perm_action_control_also_needs, { control: label, list: list(pack, keys) })

  await test(`${name}: an import chip without the cost grants says what it needs and reads Needs another permission`, async () => {
    const surface = await render(pack, { products: true })
    const row = chip(surface, 'products', 'import')
    assert.ok((row.getAttribute('title') ?? '').includes(importNeeds), 'the tooltip names the grants')
    assert.equal(row.getAttribute('data-perm-mark'), 'needs', 'the chip is flagged while the grants are missing')
    assert.ok(amberLines(surface, 'products').some((line) => line.includes(list(pack, ['perm_product_cost_edit', 'perm_product_cost_view']))), 'the missing grants are named in an amber line under the chips')
    assert.equal(row.getAttribute('aria-pressed'), 'true', 'still a live switch for the level')
    assert.ok(row.getAttribute('aria-disabled') !== 'true')
  })

  await test(`${name}: an import chip with the cost grants reads Allowed and the amber line is gone`, async () => {
    // Inventory Full too: the import chip also carries its stock-quantity control, which needs Adjust / receive.
    const surface = await render(pack, { products: true, inventory: true, ...COSTS })
    const row = chip(surface, 'products', 'import')
    assert.equal(row.getAttribute('data-perm-mark'), 'allow')
    assert.ok(!(row.getAttribute('title') ?? '').includes(importNeeds))
    assert.equal(control(surface, 'products', 'import_stock').getAttribute('data-perm-mark'), 'allow', 'the stock-quantity control follows its parent')
    // Replace-all still needs the destructive-import grant, which this role lacks; the held grants are not repeated.
    assert.deepEqual(amberLines(surface, 'products'), [importLine(['perm_destructive_delete'], pack.perm_act_products_import_replace_all)], 'only the grant still missing is flagged')
  })

  await test(`${name}: the inventory import's stock-quantity control names Adjust / receive until it is held, and the Import chip stays allowed`, async () => {
    const line = importLine(['perm_act_inventory_adjust'], pack.perm_control_inventory_import_stock)
    const held = await render(pack, { inventory: true, ...COSTS })
    assert.equal(chip(held, 'inventory', 'import').getAttribute('data-perm-mark'), 'allow')
    assert.equal(control(held, 'inventory', 'import_stock').getAttribute('data-perm-mark'), 'allow', 'Inventory Full holds Adjust / receive')
    assert.ok(!amberLines(held, 'inventory').includes(line), 'nothing missing, nothing named')
    const lacking = await render(pack, { inventory: true, 'inventory:adjust': false, ...COSTS })
    assert.equal(chip(lacking, 'inventory', 'import').getAttribute('data-perm-mark'), 'allow', 'a file that moves no stock is still accepted')
    assert.equal(control(lacking, 'inventory', 'import_stock').getAttribute('data-perm-mark'), 'needs')
    assert.ok((control(lacking, 'inventory', 'import_stock').getAttribute('title') ?? '').includes(alsoNeeds(['perm_act_inventory_adjust'])), 'the tooltip names the grant')
    assert.ok(amberLines(lacking, 'inventory').includes(line), 'the missing grant is named in an amber line under the chips')
    const partial = await render(pack, { inventory: 'review' })
    assert.equal(control(partial, 'inventory', 'import_stock').getAttribute('data-perm-mark'), 'fullOnly', 'a level that blocks the chip blocks the control')
  })

  await test(`${name}: replace-all lists every second grant`, async () => {
    const surface = await render(pack, { products: true })
    const row = chip(surface, 'products', 'import_replace_all')
    assert.ok((row.getAttribute('title') ?? '').includes(alsoNeeds(['perm_act_products_import', 'perm_product_cost_edit', 'perm_product_cost_view', 'perm_destructive_delete'])))
    assert.equal(row.getAttribute('data-perm-mark'), 'needs')
  })

  await test(`${name}: a level that blocks the chip shows no hint`, async () => {
    const surface = await render(pack, { products: 'review' })
    const row = chip(surface, 'products', 'import')
    assert.ok(!(row.getAttribute('title') ?? '').includes(importNeeds))
    assert.equal(row.getAttribute('data-perm-mark'), 'fullOnly')
    assert.ok((row.getAttribute('title') ?? '').includes(pack.perm_outcome_full_only), 'the tooltip says only Full reaches it')
    assert.equal(row.getAttribute('aria-pressed'), null, 'an inert chip has no pressed state')
  })

  await test(`${name}: resolve conflicts names the sales grants its relink control needs, without hiding the chip`, async () => {
    const hint = importLine(['perm_req_sales_customer', 'perm_req_sales_customer_reassign'], pack.perm_control_relink_sales)
    const lacking = await render(pack, { contacts: true })
    assert.ok(amberLines(lacking, 'contacts').includes(hint), 'the control line is amber')
    assert.equal(chip(lacking, 'contacts', 'resolve_conflicts').getAttribute('data-perm-mark'), 'allow', 'keep, reopen and merge are still allowed')
    assert.equal(control(lacking, 'contacts', 'relink_sales').getAttribute('data-perm-mark'), 'needs')
    assert.ok((control(lacking, 'contacts', 'relink_sales').getAttribute('title') ?? '').includes(alsoNeeds(['perm_req_sales_customer', 'perm_req_sales_customer_reassign'])))
    const held = await render(pack, { contacts: true, sales: true })
    assert.ok(!amberLines(held, 'contacts').includes(hint))
    assert.equal(control(held, 'contacts', 'relink_sales').getAttribute('data-perm-mark'), 'allow')
    const partial = await render(pack, { contacts: 'review' })
    assert.ok(!amberLines(partial, 'contacts').includes(hint), 'a level that blocks the chip shows no hint')
    assert.equal(control(partial, 'contacts', 'relink_sales').getAttribute('data-perm-mark'), 'fullOnly')
  })

  await test(`${name}: a followed control has no chip of its own and nothing is left unfilled`, async () => {
    const surface = await render(pack, { contacts: true, inventory: 'review', products: true })
    for (const key of ['relink_sales', 'rename_reasons', 'opening_stock', 'import_stock']) {
      assert.equal(surface.findAll((node) => node.getAttribute('data-perm-action') === key).length, 0, `${key} must not be a chip`)
    }
    for (const [module, key] of [['contacts', 'relink_sales'], ['inventory', 'rename_reasons'], ['inventory', 'import_stock'], ['products', 'opening_stock'], ['products', 'import_stock']] as const) {
      assert.ok(control(surface, module, key), `${key} rides its parent chip`)
    }
    assert.ok(chip(surface, 'contacts', 'resolve_conflicts') && chip(surface, 'inventory', 'edit_reasons'), 'the chips they follow are rendered')
    const strings = surface.findAll(() => true).flatMap((node) => [node.textContent, node.getAttribute('title') ?? '', node.getAttribute('aria-label') ?? ''])
    assert.ok(!strings.some((text) => /\{(list|control)\}/.test(text)), 'every placeholder is replaced')
  })

  await test(`${name}: at Review the edit-reasons control says renaming needs Full Access, and not once switched off`, async () => {
    const sentence = fill(pack.perm_action_control_needs_full, { control: pack.perm_control_rename_reasons })
    const surface = await render(pack, { inventory: 'review' })
    assert.equal(control(surface, 'inventory', 'rename_reasons').getAttribute('data-perm-mark'), 'fullOnly')
    assert.ok((control(surface, 'inventory', 'rename_reasons').getAttribute('title') ?? '').includes(sentence))
    const off = await render(pack, { inventory: 'review', 'inventory:edit_reasons': false })
    assert.equal(control(off, 'inventory', 'rename_reasons').getAttribute('data-perm-mark'), 'off')
    assert.ok(!(control(off, 'inventory', 'rename_reasons').getAttribute('title') ?? '').includes(sentence))
  })

  await test(`${name}: a merge or image chip switched off never says an edit waits for approval`, async () => {
    for (const [label, key] of [['perm_act_products_merge_duplicates', 'merge_duplicates'], ['perm_act_products_image', 'image']] as const) {
      const on = chip(await render(pack, { products: 'review' }), 'products', key)
      assert.ok((on.getAttribute('title') ?? '').includes(pack.perm_action_review_tool_full), `${label}: on`)
      const off = chip(await render(pack, { products: 'review', [`products:${key}`]: false }), 'products', key)
      assert.ok(!(off.getAttribute('title') ?? '').includes(pack.perm_action_review_tool_full), `${label}: off`)
      assert.ok((off.getAttribute('title') ?? '').includes(pack.perm_tap_to_turn_on), `${label}: off still offers the hand-back`)
      assert.equal(off.getAttribute('data-perm-mark'), 'off')
    }
  })
}

await test('a module at None offers no action chip, so an unreachable action is never listed as live', async () => {
  const surface = await render(en, { products: false })
  assert.equal(hasChip(surface, 'products', 'import'), false)
})

await test('the new strings exist in both packs with the same placeholders, and the retired note is gone', async () => {
  const keys = ['perm_action_also_needs', 'perm_action_control_also_needs', 'perm_action_control_needs_full', 'perm_control_relink_sales', 'perm_control_rename_reasons', 'perm_req_sales_customer', 'perm_req_sales_customer_reassign']
  const holes = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join(',')
  for (const key of keys) {
    assert.ok(en[key] && km[key], `${key} must be in both packs`)
    assert.equal(holes(km[key]), holes(en[key]), `${key}: placeholders must match`)
  }
  assert.ok(!('perm_actions_requires_extra' in en) && !('perm_actions_requires_extra' in km))
})

await harness.close()
if (failed) {
  console.error(`${failed} test(s) FAILED`)
  process.exit(1)
}
