import assert from 'node:assert/strict'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { collapseId, groupedParams, groupToAsk, inOpenGroups, UNSAVED_ROW_CLASS, type Grouping } from '../src/components/inventory/inventoryCheckGroups.ts'
import { buildSections, groupLabel } from '../src/components/inventory/inventoryCheckGroupSections.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// Grouped Inventory Check list (15 Nov): sections from the server's items and groups, the header count is the server's whole-scope total, collapsing is local, and unsaved counts get a soft blue.
const T: Record<string, string> = { inventory_check_group_never: 'Never checked', inventory_check_group_no_category: 'No category', inventory_check_group_continued: 'continued', inventory_check_group_continues: 'Continues on the next page', expand: 'Expand', collapse: 'Collapse' }
const t = (key: string) => T[key] ?? key
const row = (id: number, group_key: string, extra: Partial<InventoryCheckProduct> = {}): InventoryCheckProduct => ({ id, name: `Product ${id}`, quantity: 5, barcode: `88${id}`, check_status: 'not_checked', group_key, ...extra })
const summary = (key: string, products: number, label: string | null = null, more: { continued_before?: boolean; continues_after?: boolean } = {}) => ({ key, label, families: products, products, continued_before: false, continues_after: false, ...more })
// Server order: dates newest first, Never checked last. Two rows on this page for a group that holds 40 products in all.
const items = [row(1, 'd:2026-11-12'), row(2, 'd:2026-11-12'), row(3, 'd:2026-11-03'), row(4, 'never')]
const grouping: Grouping = { by: 'checked', unit: 'family', groups: [summary('d:2026-11-12', 40, null, { continues_after: true }), summary('d:2026-11-03', 7), summary('never', 120)] }

const harness = await createHarness({})
const live: MountedSurface[] = []
const track = async (surface: Promise<MountedSurface>) => { const mounted = await surface; live.push(mounted); return mounted }
const base = { drafts: {}, selecting: true, canViewStock: true, canViewCounts: true, t, onOpenProduct() {}, onCount() {}, onNote() {} }
const mountGrouped = (props: Record<string, unknown> = {}) => track(harness.mount({ component: 'components/inventory/InventoryCheckGroupedList.tsx', props: { ...base, products: items, grouping, collapsed: new Set<string>(), onToggle() {}, ...props }, app: {}, doubles: {} }))
const mountRows = (props: Record<string, unknown> = {}) => track(harness.mount({ component: 'components/inventory/InventoryCheckListRows.tsx', props: { ...base, products: items, ...props }, app: {}, doubles: {} }))
const headers = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-inventory-check-group') !== null)
const rowIds = (s: MountedSurface) => s.findAll(node => node.getAttribute('data-inventory-check-row') !== null).map(node => node.getAttribute('data-inventory-check-row'))
const flat = (node: MemoryNode) => node.textContent.replace(/\s+/g, ' ').trim()

const cases: Array<[string, () => Promise<void>]> = [
  ['sections are built from the items and the server groups, in the server order, and a header names a date as dd/mm/yyyy', async () => {
    const built = buildSections(items, grouping)!
    assert.deepEqual(built.map(section => [section.key, section.products.map(product => product.id)]), [['d:2026-11-12', [1, 2]], ['d:2026-11-03', [3]], ['never', [4]]])
    assert.equal(groupLabel('d:2026-11-12', null, t), '12/11/2026')
    assert.equal(groupLabel('d:2026-01-05', null, t), '05/01/2026', 'day first, never month first')
    assert.equal(groupLabel('never', null, t), 'Never checked')
    assert.equal(groupLabel('none', null, t), 'No category')
    assert.equal(groupLabel('c:serum', 'Serum', t), 'Serum', 'a category reads as the server named it')
    const s = await mountGrouped()
    assert.deepEqual(headers(s).map(node => node.getAttribute('data-inventory-check-group')), ['d:2026-11-12', 'd:2026-11-03', 'never'])
    assert.ok(flat(headers(s)[0]).startsWith('12/11/2026'))
  }],
  ['Never checked and No category come last even when the answer lists them first', async () => {
    const early = [row(4, 'never'), row(1, 'd:2026-11-12')]
    assert.deepEqual(buildSections(early, { ...grouping, groups: [summary('never', 120), summary('d:2026-11-12', 40)] })!.map(section => section.key), ['d:2026-11-12', 'never'])
    const byCategory: Grouping = { by: 'category', unit: 'family', groups: [summary('none', 9), summary('c:serum', 3, 'Serum')] }
    assert.deepEqual(buildSections([row(1, 'none'), row(2, 'c:serum')], byCategory)!.map(section => section.key), ['c:serum', 'none'])
  }],
  ['a header counts the server total of products, never the rows on the page', async () => {
    const s = await mountGrouped()
    const counts = headers(s).map(node => flat(node))
    assert.ok(counts[0].includes('40') && !counts[0].includes(' 2'), `first group says 40 (two rows are on the page): ${counts[0]}`)
    assert.ok(counts[1].endsWith('7') && counts[2].endsWith('120'), counts.join(' | '))
    assert.equal(rowIds(s).length, 4)
  }],
  ['a group that continues over a page says so, before and after its rows', async () => {
    const s = await mountGrouped({ grouping: { ...grouping, groups: [summary('d:2026-11-12', 40, null, { continued_before: true, continues_after: true }), ...grouping.groups.slice(1)] } })
    assert.ok(flat(headers(s)[0]).toLowerCase().includes('continued'))
    assert.ok(s.text().includes('Continues on the next page'))
    await s.unmount()
    const plain = await mountGrouped({ grouping: { ...grouping, groups: grouping.groups.map(group => ({ ...group, continues_after: false })) } })
    assert.ok(!plain.text().includes('Continues on the next page') && !flat(headers(plain)[0]).toLowerCase().includes('continued'))
  }],
  ['a row naming a group the answer did not describe leaves the page as one list, not as a wrong count', async () => {
    assert.equal(buildSections([row(1, 'd:2099-01-01')], grouping), null)
    const s = await mountGrouped({ products: [row(1, 'd:2099-01-01')] })
    assert.equal(headers(s).length, 0)
    assert.deepEqual(rowIds(s), ['1'])
  }],
  ['a collapsed group draws its header only; the others keep their rows', async () => {
    const s = await mountGrouped({ collapsed: new Set([collapseId('checked', 'd:2026-11-12')]) })
    assert.deepEqual(rowIds(s), ['3', '4'])
    assert.equal(headers(s).length, 3, 'the header stays so the group can be opened again')
    assert.ok(s.button('Expand', headers(s)[0]), 'the collapsed header offers Expand')
  }],
  ['the toggle names its group by the by:key id', async () => {
    const seen: string[] = []
    const s = await mountGrouped({ onToggle: (id: string) => seen.push(id) })
    await s.click(s.button('Collapse', headers(s)[1]))
    assert.deepEqual(seen, ['checked:d:2026-11-03'])
    assert.notEqual(collapseId('checked', 'never'), collapseId('category', 'never'))
  }],
  ['Enter in a count moves to the next row that is on screen, skipping a collapsed group', async () => {
    const drafts = { 2: { selected: true, count: '5', checked: false, note: '' } }
    const s = await mountGrouped({ drafts, collapsed: new Set([collapseId('checked', 'd:2026-11-03')]) })
    const input = s.find(node => node.getAttribute('data-check-count') !== null && node.closest('[data-inventory-check-row="2"]') !== null, 'count of row 2')
    await s.call(input, 'onKeyDown', [{ key: 'Enter', preventDefault() {}, nativeEvent: {}, currentTarget: input, target: input }])
    const focused = s.body.ownerDocument.activeElement as MemoryNode
    assert.equal(focused.closest('[data-inventory-check-row]')?.getAttribute('data-inventory-check-row'), '4', 'row 3 is collapsed, so the focus lands on row 4')
  }],
  ['the page-wide mark acts only on rows of open groups', async () => {
    const open = inOpenGroups(items, grouping, new Set([collapseId('checked', 'd:2026-11-12')]))
    assert.deepEqual(open.map(product => product.id), [3, 4])
    assert.deepEqual(inOpenGroups(items, grouping, new Set()).map(product => product.id), [1, 2, 3, 4])
    assert.deepEqual(inOpenGroups(items, undefined, new Set(['checked:d:2026-11-12'])).map(product => product.id), [1, 2, 3, 4], 'no grouping, nothing is collapsed')
    assert.deepEqual(inOpenGroups(items, { ...grouping, by: 'category' }, new Set(['checked:d:2026-11-12'])).map(product => product.id), [1, 2, 3, 4], 'a collapse of another grouping does not hide this one')
  }],
  ['the grouped request carries groupBy and no sort; the plain one is untouched', async () => {
    assert.deepEqual(groupedParams({ page: 1, sortBy: 'name', sortDirection: 'asc', query: 'a' }, 'checked'), { page: 1, query: 'a', groupBy: 'checked' })
    assert.equal(groupToAsk('', null), null, 'no capability, no groupBy')
    assert.equal(groupToAsk('', []), null)
    assert.equal(groupToAsk('', ['checked', 'category']), 'checked', 'the default is the last checked date')
    assert.equal(groupToAsk('category', ['checked', 'category']), 'category')
    assert.equal(groupToAsk('category', ['checked']), 'checked', 'category only when it is listed')
    assert.equal(groupToAsk('none', ['checked', 'category']), null, 'name A-Z is the ungrouped choice')
  }],
  ['the shape the Worker answers (family header rows carry group_key, dates and the tail have label null, a category keeps the case of the first row) builds the same sections', async () => {
    // Fixture in the shape of buildGroupingBlock / the grouped oracle: a parent header row (is_group, not checkable) sits in its family's group.
    const wire = {
      items: [{ id: 90, name: 'Serum family', is_group: true, checkable: false, group_key: 'c:serum' }, { id: 91, name: 'Serum A', quantity: 3, group_key: 'c:serum' }, { id: 92, name: 'Serum B', quantity: 1, group_key: 'c:serum' }, { id: 93, name: 'Loose', quantity: 2, group_key: 'none' }],
      grouping: { by: 'category', unit: 'family', groups: [
        { key: 'c:serum', label: 'Serum', families: 1, products: 12, continued_before: true, continues_after: false },
        { key: 'none', label: null, families: 4, products: 30, continued_before: false, continues_after: false }] },
    }
    const built = buildSections(wire.items as InventoryCheckProduct[], wire.grouping as Grouping)!
    assert.deepEqual(built.map(section => [section.key, section.products.map(product => product.id)]), [['c:serum', [90, 91, 92]], ['none', [93]]], 'the header row stays with its family')
    const s = await mountGrouped({ products: wire.items, grouping: wire.grouping })
    assert.deepEqual(rowIds(s), ['90', '91', '92', '93'])
    assert.ok(flat(headers(s)[0]).startsWith('Serum') && flat(headers(s)[0]).includes('12') && flat(headers(s)[0]).toLowerCase().includes('continued'))
    assert.ok(flat(headers(s)[1]).startsWith('No category') && flat(headers(s)[1]).endsWith('30'))
  }],
  ['an unsaved count gives its row a soft see-through blue; a saved row has none, and it is not the selected look', async () => {
    const draft = { selected: true, count: '4', checked: false, note: '' }
    const s = await mountRows({ drafts: { 1: draft } })
    const unsaved = s.find(node => node.getAttribute('data-inventory-check-row') === '1', 'row 1')
    assert.ok(unsaved.className.includes(UNSAVED_ROW_CLASS), 'the unsaved row wears the tint')
    assert.notEqual(unsaved.getAttribute('data-unsaved'), null)
    assert.ok(!unsaved.className.includes('bg-sky-50/70'), 'not the old near-white selected tint')
    const saved = s.find(node => node.getAttribute('data-inventory-check-row') === '2', 'row 2')
    assert.ok(!saved.className.includes(UNSAVED_ROW_CLASS) && saved.getAttribute('data-unsaved') === null)
    await s.render({ ...base, products: items, drafts: {} })
    assert.ok(!s.find(node => node.getAttribute('data-inventory-check-row') === '1', 'row 1').className.includes(UNSAVED_ROW_CLASS), 'once saved the draft is gone and so is the tint')
    assert.match(UNSAVED_ROW_CLASS, /\/\d+/, 'see-through: an alpha, not a solid colour')
    assert.match(UNSAVED_ROW_CLASS, /dark:/, 'and a dark-mode value')
    assert.ok(UNSAVED_ROW_CLASS.includes('bg-') && !/ring|border/.test(UNSAVED_ROW_CLASS), 'a tint only')
    const SELECTED_ROW = 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20 bg-sky-50/70 dark:bg-sky-950/20'
    assert.ok(UNSAVED_ROW_CLASS.split(' ').every(word => !SELECTED_ROW.split(' ').includes(word)), 'it shares no class with the selected-row blue')
  }],
]
let failed = 0
try {
  for (const [name, run] of cases) {
    try { await run(); console.log('PASS', name) } catch (error) { failed += 1; console.error('FAIL', name); console.error(error) }
    for (const surface of live.splice(0)) await surface.unmount().catch(() => {})
  }
} finally { for (const surface of live) await surface.unmount().catch(() => {}) }
if (failed) { await harness.close(); process.exit(1) }
await harness.close()
console.log(`inventoryCheckGroups: ${cases.length} cases passed`)
