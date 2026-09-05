import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MOBILE_HOME_TILE_COLUMNS,
  buildMobileHomeLayout,
  mobileHomeSectionsPanelId,
} from '../src/utils/mobileHomeTiles.ts'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Item = { id: string }
const items: Item[] = [
  { id: 'dashboard' }, { id: 'pos' }, { id: 'products' }, { id: 'sales' },
  { id: 'branches' }, { id: 'contacts' }, { id: 'settings' },
]
const sectionsById: Record<string, string[]> = {
  products: ['products', 'stock_changes', 'stock_in_sessions', 'duplicates'],
  sales: ['sales', 'returns', 'fees', 'reports'],
  branches: ['overview', 'products', 'transfers', 'rfid'],
  settings: ['settings', 'users', 'backup'],
}
const sectionsOf = (id: string): string[] => sectionsById[id] || []
const shape = (entries: ReturnType<typeof buildMobileHomeLayout<Item, string>>): string[] =>
  entries.map((entry) => (entry.kind === 'tile' ? entry.key : `[${entry.ownerId}]`))

runTest('closed home is exactly the tiles, in the account nav order', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, null, sectionsOf)
  assert.deepEqual(shape(entries), ['dashboard', 'pos', 'products', 'sales', 'branches', 'contacts', 'settings'])
  assert.equal(entries.every((entry) => entry.kind === 'tile'), true)
  assert.deepEqual(
    entries.filter((entry) => entry.kind === 'tile' && entry.hasSections).map((entry) => entry.key),
    ['products', 'sales', 'branches', 'settings'],
    'only tiles that own sections may advertise the unfold affordance',
  )
})

// THE discriminating case. `products` is at index 2 -- column 0 of row 1 in a
// 2-column grid. The obvious implementation (splice the panel in directly
// after the open tile) puts the sub-grid BETWEEN products and sales, which
// splits that row and shifts `sales` into the next row on its own. The
// reference accordion opens under the whole row, so the panel belongs after
// `sales`. Both implementations agree when the open tile sits in the LAST
// column, which is why the two cases below have to be asserted together.
runTest('an unfolded tile in column 0 opens its sections under its whole row', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, 'products', sectionsOf)
  assert.deepEqual(shape(entries), ['dashboard', 'pos', 'products', 'sales', '[products]', 'branches', 'contacts', 'settings'])
})

runTest('an unfolded tile in the last column opens directly beneath itself', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, 'sales', sectionsOf)
  assert.deepEqual(shape(entries), ['dashboard', 'pos', 'products', 'sales', '[sales]', 'branches', 'contacts', 'settings'])
})

runTest('an unfolded tile in a short final row keeps its panel last', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, 'settings', sectionsOf)
  assert.deepEqual(shape(entries), ['dashboard', 'pos', 'products', 'sales', 'branches', 'contacts', 'settings', '[settings]'])
})

runTest('only one tile is ever unfolded, and it carries that tile\'s own sections', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, 'branches', sectionsOf)
  const panels = entries.filter((entry) => entry.kind === 'sections')
  assert.equal(panels.length, 1)
  assert.equal(panels[0].kind === 'sections' && panels[0].ownerId, 'branches')
  assert.deepEqual(panels[0].kind === 'sections' ? panels[0].sections : [], ['overview', 'products', 'transfers', 'rfid'])
  assert.deepEqual(entries.filter((entry) => entry.kind === 'tile' && entry.expanded).map((entry) => entry.key), ['branches'])
})

runTest('a tile with no sections never unfolds, and an unknown open id unfolds nothing', () => {
  assert.deepEqual(shape(buildMobileHomeLayout<Item, string>(items, 'pos', sectionsOf)), shape(buildMobileHomeLayout<Item, string>(items, null, sectionsOf)))
  assert.deepEqual(shape(buildMobileHomeLayout<Item, string>(items, 'nowhere', sectionsOf)), shape(buildMobileHomeLayout<Item, string>(items, null, sectionsOf)))
  const emptyPage = buildMobileHomeLayout<Item, string>(items, 'contacts', () => [])
  assert.equal(emptyPage.some((entry) => entry.kind === 'sections'), false, 'a permission-emptied section list must not open an empty panel')
})

runTest('the panel id is the one both the tile and the sub-grid use', () => {
  const entries = buildMobileHomeLayout<Item, string>(items, 'products', sectionsOf)
  const panel = entries.find((entry) => entry.kind === 'sections')
  assert.equal(panel?.key, mobileHomeSectionsPanelId('products'))
  assert.equal(mobileHomeSectionsPanelId('products'), 'mobile-sections-products')
})

runTest('degenerate column counts fall back to a single column instead of dividing by zero', () => {
  assert.equal(MOBILE_HOME_TILE_COLUMNS, 2)
  assert.deepEqual(shape(buildMobileHomeLayout<Item, string>(items, 'products', sectionsOf, 0)), ['dashboard', 'pos', 'products', '[products]', 'sales', 'branches', 'contacts', 'settings'])
  assert.deepEqual(shape(buildMobileHomeLayout<Item, string>(items, 'products', sectionsOf, 1)), ['dashboard', 'pos', 'products', '[products]', 'sales', 'branches', 'contacts', 'settings'])
  assert.deepEqual(shape(buildMobileHomeLayout<Item, string>([], 'products', sectionsOf)), [])
})

// Source-shape half: the tile grid classes at the compact breakpoint, and the
// guarded-history / section-anchor wiring that the reshape must not drop.
const sidebar = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')

runTest('the compact home renders a 2-column tile grid whose sub-grid spans the row', () => {
  assert.match(sidebar, /buildMobileHomeLayout\(/, 'the sheet must render the shared layout, not its own ordering')
  assert.match(sidebar, /grid grid-cols-2 gap-2 px-3 pb-4/, 'the compact home must be a 2-column tile grid')
  assert.doesNotMatch(sidebar, /className="space-y-1 px-3 pb-4"/, 'the one-column full-width group list must be gone')
  assert.match(sidebar, /col-span-2 grid min-w-0 grid-cols-2/, 'an unfolded tile\'s sections must be a full-width 2-column sub-grid')
  assert.equal((sidebar.match(/min-h-16/g) || []).length >= 1, true, 'tiles must stay comfortably above the 44px touch minimum')
  assert.match(sidebar, /data-bos-section=\{`\$\{entry\.ownerId\}:\$\{section\.id\}`\}/, 'section buttons keep their addressable test hook')
  assert.match(sidebar, /id=\{mobileHomeSectionsPanelId\(entry\.ownerId\)\}/, 'the sub-grid id comes from the shared helper')
  assert.match(sidebar, /aria-controls=\{hasSections \? mobileHomeSectionsPanelId\(item\.id\) : undefined\}/, 'the tile points at that same id')
})

runTest('the reshape keeps the guarded navigation hooks the lineage ships', () => {
  assert.match(sidebar, /mobileGroupAction\(expandedGroup, id, destinations\(id\), inline\)/, 'one-open-at-a-time still comes from the shared action')
  assert.match(sidebar, /navigateTo\(entry\.ownerId, hubAnchor\(entry\.ownerId, section\.id\)\)/, 'section taps still commit through the guarded navigateTo')
  assert.match(sidebar, /const openSectionMenu = \(\) => \{\s*setExpandedGroup\(currentSections\.length \? page : null\)/, 'the header Back button still opens the current page unfolded')
  assert.match(sidebar, /resolveHubSection\(page, location\.pathname, location\.hash/, 'the header title still resolves the committed section from the URL')
  assert.match(sidebar, /id="section-export-action-host"/, 'the mobile title bar keeps its export host')
  assert.match(sidebar, /<QuickPreferenceToggles \/>/, 'the header quick preferences stay in place')
})

if (failed > 0) process.exitCode = 1
