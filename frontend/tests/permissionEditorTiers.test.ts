// Role editor and user detail (B-M2, B-R1, B-R2, B-R7, B-R8, B-R13, B-M4, B-M5): confirm before the two
// bulk buttons, real switches, one tier vocabulary that the glance line, section chip and picker share,
// field chips, and a user sheet that names every permission instead of printing its key.
//
// Run: node tests/permissionEditorTiers.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const editorSource = read('../src/components/users/PermissionEditor.tsx')

let failed = 0
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
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
  return { surface, state }
}

const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const allNodes = (surface: MountedSurface) => surface.findAll(() => true)
const buttonsNamed = (surface: MountedSurface, label: string) => surface.findAll((node) => node.tagName === 'BUTTON' && node.textContent.trim() === label)
const sectionNode = (surface: MountedSurface, key: string) => surface.find((node) => node.getAttribute('id') === `perm-section-${key}`, `section ${key}`)
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)

await test('AC-B1: Select all asks first and shows before and after; Cancel keeps the draft; Confirm applies', async () => {
  const { surface, state } = await mountEditor({ dashboard: true, pos: true })
  await surface.click(surface.button('Select all'))
  assert.equal(state.calls, 0, 'nothing changes on the first press')
  assert.ok(surface.text().includes(en.perm_confirm_all_title), 'the confirm dialog names the action')
  assert.ok(surface.text().includes(`2 → ${en.perm_confirm_all_after}`), 'it shows the permission count before and after')
  await surface.click(surface.button('Cancel'))
  assert.equal(state.calls, 0, 'Cancel keeps the draft')
  assert.ok(!surface.text().includes(en.perm_confirm_all_title), 'the dialog closed')
  await surface.click(surface.button('Select all'))
  const confirms = buttonsNamed(surface, 'Select all')
  await surface.click(confirms[confirms.length - 1])
  assert.deepEqual(state.changed, { all: true })
  await surface.unmount()
})

await test('AC-B1: Clear asks first with the count going to 0; the master administrator switch asks too', async () => {
  const { surface, state } = await mountEditor({ dashboard: true, pos: true, sales: true })
  await surface.click(surface.button(en.deselect_all))
  assert.equal(state.calls, 0)
  assert.ok(surface.text().includes('3 → 0'), 'before and after')
  const confirms = buttonsNamed(surface, en.deselect_all)
  await surface.click(confirms[confirms.length - 1])
  assert.deepEqual(state.changed, {})
  state.calls = 0
  const master = surface.find((node) => node.getAttribute('role') === 'switch' && /Administrator/.test(node.textContent), 'administrator switch')
  await surface.click(master)
  assert.equal(state.calls, 0, 'turning the administrator switch on is also confirmed')
  assert.ok(surface.text().includes(en.perm_confirm_all_title))
  await surface.unmount()
})

await test('AC-B3: every on/off row is a switch with aria-checked and no literal OK; every picker and chip button is aria-pressed', async () => {
  const { surface } = await mountEditor({ dashboard: true, pos: true, inventory: true, products: 'review', 'inventory_check_show_stock': false })
  const switches = surface.findAll((node) => node.getAttribute('role') === 'switch')
  assert.ok(switches.length > 8, 'on/off rows render as switches')
  for (const node of switches) assert.ok(['true', 'false'].includes(node.getAttribute('aria-checked') ?? ''), `switch "${node.textContent.trim()}" has aria-checked`)
  assert.ok(!allNodes(surface).some((node) => node.childNodes.length === 1 && node.textContent === 'OK'), 'no literal OK text')
  const groups = surface.findAll((node) => node.getAttribute('role') === 'group')
  assert.ok(groups.length > 10)
  for (const group of groups) {
    const buttons = surface.findAll((node) => node.tagName === 'BUTTON' && within(node, group))
    for (const button of buttons) assert.ok(['true', 'false'].includes(button.getAttribute('aria-pressed') ?? ''), `"${button.textContent.trim()}" in ${group.getAttribute('aria-label')} has aria-pressed`)
  }
  await surface.unmount()
})

const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b|\b[a-z_]+:[a-z_]+\b/
const visibleStrings = (surface: MountedSurface): string[] => allNodes(surface).flatMap((node) => [
  node.childNodes.length === 1 && node.childNodes[0].nodeType === 3 ? node.textContent : '',
  node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '', node.getAttribute('placeholder') ?? '',
].filter(Boolean))

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`AC-B4: ${name} editor shows no raw permission key`, async () => {
    const everything: Record<string, unknown> = {}
    for (const section of PERMISSION_SECTIONS) for (const permission of section.permissions) everything[permission.key] = permission.tier ? 'review' : true
    Object.assign(everything, { 'sales:amend': false, 'products:merge_duplicates': false, 'inventory:adjust': false })
    delete everything.all
    const { surface } = await mountEditor(everything, language)
    const offenders = visibleStrings(surface).filter((text) => RAW_KEY.test(text) && !/[ក-៿]/.test(text))
    assert.deepEqual(offenders, [], `raw keys rendered: ${offenders.slice(0, 5).join(' | ')}`)
    await surface.unmount()
  })
}

await test('AC-B5: every section chip equals its pressed picker button; glance counts and "n off" are the same numbers', async () => {
  const roles: Array<Record<string, unknown>> = [
    { products: 'review', product_cost_view: true, settings: 'view', sales: true, 'sales:amend': false, inventory: true, 'inventory:adjust': false, 'inventory:edit_reasons': false, dashboard: true },
    { products: true, contacts: 'review', returns: true, fees: 'review', 'products:merge_duplicates': false },
    { review: 'view', audit_log: 'view', branches: true, promotions: 'view' },
  ]
  for (const role of roles) {
    const { surface } = await mountEditor(role)
    const counts: Record<string, number> = {}
    let sectionOff = 0
    for (const section of PERMISSION_SECTIONS.filter((entry) => entry.key !== 'full_access')) {
      const node = sectionNode(surface, section.key)
      const chip = surface.findAll((child) => child.getAttribute('data-perm-chip') === 'mode' && within(child, node))[0]
      assert.ok(chip, `${section.key} has a state chip`)
      const label = chip.textContent.trim()
      counts[label] = (counts[label] ?? 0) + 1
      const picker = surface.findAll((child) => child.getAttribute('role') === 'group' && /access/.test(child.getAttribute('aria-label') ?? '') && within(child, node))[0]
      if (picker) {
        const pressed = surface.findAll((child) => child.tagName === 'BUTTON' && child.getAttribute('aria-pressed') === 'true' && within(child, picker)).map((child) => child.textContent.trim())
        assert.deepEqual(pressed, [label], `${section.key}: chip "${label}" and picker ${JSON.stringify(pressed)} agree`)
      }
      const off = surface.findAll((child) => child.getAttribute('data-perm-chip') === 'off' && within(child, node))[0]
      if (off) sectionOff += Number(off.textContent.match(/\d+/)?.[0])
    }
    const glance = Object.fromEntries(surface.findAll((node) => node.getAttribute('data-perm-chip') === 'glance').map((node) => {
      const [, count, label] = node.textContent.trim().match(/^(\d+) (.+)$/) ?? []
      return [label, Number(count)]
    }))
    assert.deepEqual(glance, counts, 'the glance line counts the same sections the chips show')
    const total = surface.findAll((node) => node.getAttribute('data-perm-chip') === 'glance-off')[0]
    assert.equal(total ? Number(total.textContent.match(/\d+/)?.[0]) : 0, sectionOff, 'the "n off" totals agree')
    await surface.unmount()
  }
  const { surface } = await mountEditor({ products: true, 'products:merge_duplicates': false, 'products:import': false })
  const off = surface.findAll((node) => node.getAttribute('data-perm-chip') === 'off' && within(node, sectionNode(surface, 'products')))[0]
  assert.equal(off?.textContent.trim(), '2 off', 'switched-off actions are counted on the section')
  await surface.unmount()
})

await test('one vocabulary: View / Review / Full, "Partial Access" is gone and the sensitive badge is a shield', async () => {
  const { surface } = await mountEditor({ products: 'review', settings: 'view' })
  const products = sectionNode(surface, 'products')
  const labels = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-pressed') !== null && within(node, products) && node.getAttribute('role') !== 'switch').map((node) => node.textContent.trim())
  assert.ok(['None', 'Review', 'Full', 'Custom'].every((label) => labels.includes(label)), `Products picker offers ${labels.join(', ')}`)
  const settings = sectionNode(surface, 'settings')
  const settingsLabels = surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-pressed') !== null && within(node, settings)).map((node) => node.textContent.trim())
  assert.ok(settingsLabels.includes('View') && !settingsLabels.includes('Review'), `Settings offers the View tier only: ${settingsLabels.join(', ')}`)
  assert.ok(!surface.text().includes('Partial Access'))
  assert.equal(en.review_required, 'Review')
  assert.equal(en.permission_sensitive_high, en.permission_sensitive_critical, 'sensitivity is one word, the shield tooltip')
  const marks = surface.findAll((node) => node.getAttribute('role') === 'img' && node.getAttribute('title') === 'Sensitive')
  assert.ok(marks.length > 0, 'sensitive rows carry the shield with a Sensitive tooltip')
  assert.ok(!allNodes(surface).some((node) => node.tagName === 'SPAN' && node.textContent === 'Review' && /uppercase/.test(node.className)), 'no uppercase Review badge remains')
  await surface.unmount()
})

await test('field rows collapse to one toggle chip row with accessible pressed state', async () => {
  const { surface, state } = await mountEditor({ inventory: true, inventory_check_show_stock: false, products_image_only: true, products_image_only_show_price: true })
  const groups = surface.findAll((node) => node.getAttribute('role') === 'group' && node.getAttribute('aria-label') === 'Fields shown')
  assert.equal(groups.length, 2, 'inventory checks and image-only role each get one row')
  const sizes = groups.map((group) => surface.findAll((node) => node.tagName === 'BUTTON' && within(node, group)).length).sort()
  assert.deepEqual(sizes, [8, 9])
  assert.ok(!surface.findAll((node) => node.getAttribute('role') === 'switch' && /Show recorded stock|Image-only role/.test(node.textContent)).length, 'no per-field switch rows remain')
  const stock = surface.button(/Show recorded stock/)
  assert.equal(stock.getAttribute('aria-pressed'), 'false')
  assert.equal(surface.button(/Image-only role: show selling price/).getAttribute('aria-pressed'), 'true')
  await surface.click(stock)
  assert.equal(state.changed?.inventory_check_show_stock, true)
  await surface.unmount()
})

await test('Find permission filters sections and reports an empty result', async () => {
  const { surface } = await mountEditor({ dashboard: true })
  const input = surface.find((node) => node.getAttribute('aria-label') === en.perm_find && node.tagName === 'INPUT', 'find input')
  await surface.type(input, 'Dashboard')
  assert.ok(surface.findAll((node) => node.getAttribute('id') === 'perm-section-dashboard').length === 1)
  assert.ok(surface.findAll((node) => /^perm-section-/.test(node.getAttribute('id') ?? '')).length < PERMISSION_SECTIONS.length, 'other sections are hidden')
  await surface.type(input, 'zzzzqq')
  assert.ok(surface.text().includes(en.perm_find_none))
  await surface.unmount()
})

await test('section labels are neither truncated nor uppercased, and touch targets reach 44px', async () => {
  assert.doesNotMatch(editorSource, /truncate[^"`]*uppercase|uppercase[^"`]*truncate/)
  assert.match(editorSource, /break-words text-sm font-semibold leading-6/, 'the section label wraps with room for Khmer')
  assert.ok((editorSource.match(/\$\{TOUCH_TARGET\}/g) || []).length >= 6, 'bulk buttons, find, jump chips, picker, switch rows and action rows use the touch floor')
  assert.match(editorSource, /\[@media\(pointer:coarse\)\]:min-h-\[44px\]/)
  assert.doesNotMatch(editorSource, /access mode`/, 'no hard-coded English group label')
})

const sheetProps = (language: Record<string, string>) => ({
  user: { id: 7, name: 'Dara', username: 'dara', role_id: 3, is_active: 1, permissions: JSON.stringify({ products: 'view', 'sales:amend': false, pos: true }) },
  roles: [{ id: 3, name: 'Cashier', permissions: JSON.stringify({ sales: 'view', settings: 'view', products: 'review', pos: true, 'sales:status': false, contacts: true }) }],
  t: pack(language),
})
for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`AC-B4 / B-R8 / B-M4 / B-M5: ${name} user detail names permissions, shows View, denials and individual exceptions`, async () => {
    const surface = await harness.mount({ component: 'components/users/UserDetailSheet.tsx', props: sheetProps(language), app: { t: pack(language) }, doubles: {} })
    const text = surface.text()
    assert.ok(!RAW_KEY.test(text.replace(/@dara/, '')), `raw key rendered: ${text.match(RAW_KEY)?.[0]}`)
    assert.ok(text.includes(`${language.perm_sales}`), 'a section reads by its label')
    assert.ok(text.includes(`${language.perm_sales} (${language.view})`) || text.includes(`${language.perm_settings ?? language.perm_section_settings} (${language.view})`), 'the View tier is shown')
    assert.ok(text.includes(`(${language.review_required})`), 'the Review tier is shown')
    assert.ok(text.includes(language.perm_switched_off_heading) && text.includes(`${language.perm_sales}: ${language.perm_act_sales_status}`), 'an explicit denial is listed by name')
    const two = language.perm_user_exceptions_other.replace('{n}', '3')
    assert.ok(text.includes(two), `individual exceptions are counted: ${two}`)
    await surface.unmount()
  })
}

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1
