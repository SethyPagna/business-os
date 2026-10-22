// Role editor (B-M2, B-R1, B-R2, B-R7, B-R13): confirm before the bulk buttons, real switches, one level
// vocabulary that the row dots and counters share, field chips, search, and a label that wraps instead of
// truncating. Written against the access grid of 21 Oct 2026: the old per-section picker, the glance line, the
// jump chips and "Select all" are gone by design (the Administrator switch and the Clear icon replace the two
// bulk buttons), so each case keeps its intent and is asked of the control that now carries it. The two
// user-detail cases that used to sit here moved, unchanged, to userDetailPermissions.test.ts.
//
// Run: node tests/permissionEditorTiers.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { MODULE_ROWS, levelsOf, roleTierCounts } from '../src/components/users/permissionSummary.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const editorSource = read('../src/components/users/PermissionEditor.tsx')

let failed = 0
// One shared document: a test that throws before unmounting must not hand its editor to the next one.
const live: MountedSurface[] = []
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const harness = await createHarness()
type Changed = Record<string, unknown> | null
const pack = (language: Record<string, string>) => (key: string) => language[key]

async function mountEditor(permissions: Record<string, unknown>, language = en) {
  const state: { changed: Changed; calls: number } = { changed: null, calls: 0 }
  const surface = await harness.mount({
    component: 'components/users/PermissionEditor.tsx',
    props: { permissions, t: pack(language), onChange: (value: Record<string, unknown>) => { state.changed = value; state.calls += 1 } },
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
const allNodes = (surface: MountedSurface) => surface.findAll(() => true)
const exactButtons = (surface: MountedSurface, label: string) => surface.findAll((node) => node.tagName === 'BUTTON' && node.textContent.trim() === label)
const moduleNode = (surface: MountedSurface, id: string) => surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
const moduleIds = (surface: MountedSurface) => surface.findAll((node) => node.getAttribute('data-perm-module') !== null).map((node) => node.getAttribute('data-perm-module') as string)
const levelCells = (surface: MountedSurface, id: string) => {
  const root = moduleNode(surface, id)
  return surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') !== null && within(node, root))
}
const pressedLevels = (surface: MountedSurface, id: string) => levelCells(surface, id).filter((node) => node.getAttribute('aria-pressed') === 'true').map((node) => node.getAttribute('data-perm-level') as string)
const openAll = async (surface: MountedSurface) => {
  for (const id of moduleIds(surface)) {
    const root = moduleNode(surface, id)
    const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
}
const administratorSwitch = (surface: MountedSurface) => surface.find((node) => node.getAttribute('role') === 'switch' && /Administrator/.test(node.textContent), 'administrator switch')

await test('AC-B1: the Administrator switch asks first and shows before and after; Cancel keeps the draft; Confirm applies', async () => {
  const { surface, state } = await mountEditor({ dashboard: true, pos: true })
  await surface.click(administratorSwitch(surface))
  assert.equal(state.calls, 0, 'nothing changes on the first press')
  assert.ok(surface.text().includes(en.perm_confirm_all_title), 'the confirm dialog names the action')
  assert.ok(surface.text().includes(`2 → ${en.perm_confirm_all_after}`), 'it shows the permission count before and after')
  await surface.click(surface.button('Cancel'))
  assert.equal(state.calls, 0, 'Cancel keeps the draft')
  assert.ok(!surface.text().includes(en.perm_confirm_all_title), 'the dialog closed')
  await surface.click(administratorSwitch(surface))
  await surface.click(surface.button(en.confirm))
  assert.deepEqual(state.changed, { all: true })
})

await test('AC-B1: Clear asks first with the count going to 0, then empties the draft', async () => {
  const { surface, state } = await mountEditor({ dashboard: true, pos: true, sales: true })
  await surface.click(surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.perm_clear_all, 'clear button'))
  assert.equal(state.calls, 0)
  assert.ok(surface.text().includes('3 → 0'), 'before and after')
  const confirms = exactButtons(surface, en.perm_clear)
  assert.equal(confirms.length, 1, 'the confirm button is the Clear verb')
  await surface.click(confirms[0])
  assert.deepEqual(state.changed, {})
})

await test('AC-B3: every on/off grant is a switch with aria-checked and no literal OK; every level dot and chip is aria-pressed', async () => {
  const { surface } = await mountEditor({ dashboard: true, pos: true, inventory: true, products: 'review', 'inventory_check_show_stock': false })
  await openAll(surface)
  const switches = surface.findAll((node) => node.getAttribute('role') === 'switch')
  assert.ok(switches.length > 8, 'on/off grants render as switches')
  for (const node of switches) assert.ok(['true', 'false'].includes(node.getAttribute('aria-checked') ?? ''), `switch "${node.getAttribute('aria-label') ?? node.textContent.trim()}" has aria-checked`)
  assert.ok(!allNodes(surface).some((node) => node.childNodes.length === 1 && node.textContent === 'OK'), 'no literal OK text')
  const dots = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-level') !== null)
  assert.equal(dots.length, MODULE_ROWS.reduce((sum, row) => sum + levelsOf(row).length, 0), 'every module offers exactly the dots its levels name')
  for (const dot of dots) assert.ok(['true', 'false'].includes(dot.getAttribute('aria-pressed') ?? ''), `dot "${dot.getAttribute('aria-label')}" has aria-pressed`)
  const chips = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-action') !== null)
  assert.ok(chips.length > 10, 'action chips render')
  for (const chip of chips) {
    // A chip the level cannot reach is inert: no pressed state, and it says so by being disabled.
    const pressed = chip.getAttribute('aria-pressed')
    assert.ok(['true', 'false'].includes(pressed ?? '') || chip.getAttribute('aria-disabled') === 'true', `chip "${chip.getAttribute('aria-label')}" has aria-pressed or is disabled`)
  }
  for (const toggle of surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null)) assert.ok(['true', 'false'].includes(toggle.getAttribute('aria-expanded') ?? ''))
})

const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b|\b[a-z_]+:[a-z_]+\b/
const visibleStrings = (surface: MountedSurface): string[] => allNodes(surface).flatMap((node) => [
  node.childNodes.length === 1 && node.childNodes[0].nodeType === 3 ? node.textContent : '',
  node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '', node.getAttribute('placeholder') ?? '',
].filter(Boolean))

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`AC-B4: ${name} editor shows no raw permission key, with every row open`, async () => {
    const everything: Record<string, unknown> = {}
    for (const section of PERMISSION_SECTIONS) for (const permission of section.permissions) everything[permission.key] = permission.tier ? 'review' : true
    Object.assign(everything, { 'sales:amend': false, 'products:merge_duplicates': false, 'inventory:adjust': false })
    delete everything.all
    const { surface } = await mountEditor(everything, language)
    await openAll(surface)
    const offenders = visibleStrings(surface).filter((text) => RAW_KEY.test(text) && !/[ក-៿]/.test(text))
    assert.deepEqual(offenders, [], `raw keys rendered: ${offenders.slice(0, 5).join(' | ')}`)
  })
}

await test('AC-B5: every row\'s pressed dot is the level its stored value means; the dot counts equal the role-card counts; the "off" counters add up', async () => {
  // Expected level per module, read off the stored value by hand (a tier string, true or absent) and never off the model.
  const levelOf = (value: unknown) => (value === 'review' ? 'review' : value === 'view' ? 'view' : value ? 'full' : 'none')
  const rows = [
    ['products', 'products'], ['sales', 'sales'], ['inventory', 'inventory'], ['settings', 'settings'], ['dashboard', 'dashboard'],
    ['contacts', 'contacts'], ['returns', 'returns'], ['fees', 'fees'], ['review', 'review'], ['audit_log', 'audit_log'], ['branches', 'branches'], ['promotions', 'promotions'],
  ] as const
  const roles: Array<{ role: Record<string, unknown>; off: Record<string, number> }> = [
    { role: { products: 'review', product_cost_view: true, settings: 'view', sales: true, 'sales:amend': false, inventory: true, 'inventory:adjust': false, 'inventory:edit_reasons': false, dashboard: true }, off: { sales: 1, inventory: 2 } },
    { role: { products: true, contacts: 'review', returns: true, fees: 'review', 'products:merge_duplicates': false }, off: { products: 1 } },
    { role: { review: 'view', audit_log: 'view', branches: true, promotions: 'view' }, off: {} },
  ]
  for (const { role, off } of roles) {
    const { surface } = await mountEditor(role)
    const counts: Record<string, number> = { none: 0, view: 0, review: 0, full: 0 }
    for (const id of moduleIds(surface)) {
      if (id === 'inventory_checks') continue
      const pressed = pressedLevels(surface, id)
      assert.equal(pressed.length, 1, `${id}: exactly one dot is pressed (${pressed.join(', ')})`)
      counts[pressed[0]] += 1
    }
    for (const [id, key] of rows) {
      if (!moduleIds(surface).includes(id)) continue
      assert.deepEqual(pressedLevels(surface, id), [levelOf(role[key])], `${id}: the dot matches the stored value`)
    }
    const model = roleTierCounts(role as never)
    assert.deepEqual({ none: model.none, view: model.view, review: model.review, full: model.full }, counts, 'the role-card counts are the pressed dots of the grid')
    let sectionOff = 0
    for (const id of moduleIds(surface)) {
      const marker = surface.findAll((node) => node.getAttribute('role') === 'img' && /^\d+ off$/.test(node.getAttribute('aria-label') ?? '') && within(node, moduleNode(surface, id)))[0]
      const count = marker ? Number(marker.getAttribute('aria-label')?.match(/\d+/)?.[0]) : 0
      assert.equal(count, off[id] ?? 0, `${id}: the "n off" counter`)
      sectionOff += count
    }
    assert.equal(sectionOff, model.off, 'the "n off" counters add up to the model total')
    await surface.unmount()
  }
  const { surface } = await mountEditor({ products: true, 'products:merge_duplicates': false, 'products:import': false })
  const marker = surface.findAll((node) => node.getAttribute('role') === 'img' && within(node, moduleNode(surface, 'products')) && /off/.test(node.getAttribute('aria-label') ?? ''))[0]
  assert.equal(marker?.getAttribute('aria-label'), '2 off', 'switched-off actions are counted on the module')
})

await test('one vocabulary: None / View / Review / Full on the dots, no "Custom" or "Partial Access", and the sensitive badge is a shield', async () => {
  const { surface } = await mountEditor({ products: 'review', settings: 'view', product_cost_view: true })
  const offered = (id: string) => levelCells(surface, id).map((node) => node.getAttribute('data-perm-level'))
  assert.deepEqual(offered('products'), ['none', 'review', 'full'], 'Products offers None, Review and Full')
  assert.deepEqual(offered('settings'), ['none', 'view', 'full'], 'Settings offers the View level only')
  assert.deepEqual(pressedLevels(surface, 'products'), ['review'])
  assert.deepEqual(pressedLevels(surface, 'settings'), ['view'])
  assert.ok(!/\bCustom\b/.test(surface.text()), 'no Custom state: a role is at a level, or it is not')
  assert.ok(!surface.text().includes('Partial Access'))
  assert.equal(en.review_required, 'Review')
  assert.equal(en.permission_sensitive_high, en.permission_sensitive_critical, 'sensitivity is one word, the shield tooltip')
  const marks = surface.findAll((node) => node.getAttribute('role') === 'img' && node.getAttribute('title') === 'Sensitive')
  assert.ok(marks.length > 0, 'sensitive rows carry the shield with a Sensitive tooltip')
  assert.ok(!allNodes(surface).some((node) => node.tagName === 'SPAN' && node.textContent === 'Review' && /uppercase/.test(node.className)), 'no uppercase Review badge remains')
})

await test('field rows collapse to one toggle chip row with accessible pressed state', async () => {
  const { surface, state } = await mountEditor({ inventory: true, inventory_check_show_stock: false, products_image_only: true, products_image_only_show_price: true })
  await openAll(surface)
  const groups = surface.findAll((node) => node.getAttribute('role') === 'group' && node.getAttribute('aria-label') === 'Fields shown')
  assert.equal(groups.length, 2, 'inventory checks and image-only role each get one row')
  const sizes = groups.map((group) => surface.findAll((node) => node.tagName === 'BUTTON' && within(node, group)).length).sort()
  const countFields = (prefix: string) => PERMISSION_SECTIONS.flatMap((section) => section.permissions).filter((permission) => permission.key.startsWith(prefix)).length
  assert.deepEqual(sizes, [countFields('products_image_only_show_'), countFields('inventory_check_show_')].sort(), 'one chip per field, none left over as a switch row')
  assert.ok(!surface.findAll((node) => node.getAttribute('role') === 'switch' && /Show recorded stock|Image-only role/.test(node.textContent)).length, 'no per-field switch rows remain')
  const stock = surface.button(/Show recorded stock/)
  assert.equal(stock.getAttribute('aria-pressed'), 'false')
  assert.equal(surface.button(/Image-only role: show selling price/).getAttribute('aria-pressed'), 'true')
  await surface.click(stock)
  assert.equal(state.changed?.inventory_check_show_stock, true)
})

await test('Find permission filters the modules and reports an empty result', async () => {
  const { surface } = await mountEditor({ dashboard: true })
  const total = moduleIds(surface).length
  const input = surface.find((node) => node.getAttribute('aria-label') === en.perm_find && node.tagName === 'INPUT', 'find input')
  await surface.type(input, 'Dashboard')
  assert.ok(moduleIds(surface).includes('dashboard'), 'the matching module stays')
  assert.ok(moduleIds(surface).length < total, 'other modules are hidden')
  await surface.type(input, 'zzzzqq')
  assert.ok(surface.text().includes(en.perm_find_none))
  assert.equal(moduleIds(surface).length, 0)
})

await test('module names are neither truncated nor uppercased, and touch targets reach 44px', async () => {
  assert.doesNotMatch(editorSource, /truncate[^"`]*uppercase|uppercase[^"`]*truncate/)
  assert.match(editorSource, /min-w-0 break-words/, 'the module name wraps')
  assert.match(editorSource, /text-\[13px\] font-semibold leading-6/, 'the name line keeps room for Khmer glyphs')
  assert.ok((editorSource.match(/\$\{TOUCH_(?:TARGET|SQUARE)\}/g) || []).length >= 6, 'search, clear, the switch, filters, hints, chips and dots use the touch floor')
  assert.match(editorSource, /\[@media\(pointer:coarse\)\]:min-h-\[44px\]/)
  assert.doesNotMatch(editorSource, /access mode`/, 'no hard-coded English group label')
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
