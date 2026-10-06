// PUBLIC-FILTER-MENU (owner, 5 Oct): "Public site browse: put view + sort in the
// filter menu; default by brand, user can switch (select/deselect)."
//
// What is pinned, and why each half needs its own check:
//
//   1. The model. The default VIEW is brand, the default SORT is featured, and
//      anything outside the allowlists (a stale bookmark, a hand-edited URL)
//      falls back to the default instead of reaching the request.
//   2. The request. Switching changes what is asked of the server -- and the
//      default asks for nothing extra, so an untouched storefront keeps its
//      URL and its cache entry.
//   3. The grouping. The same cards get different section headers under brand
//      and category, none under "all products".
//   4. The server mirror. The Worker enforces the same two allowlists; the lists
//      here are read against portal.ts so the copies cannot drift.
//   5. The menu. The chip row renders every option on its FIRST render, marks the
//      default chosen, and tapping the chosen chip again deselects back to the
//      default.
//   6. The wiring. Both storefront entries (PublicCatalogPage and CatalogPage)
//      send the params and re-search on change, and neither paints the
//      brand-ordered bootstrap payload for a shopper on another view or sort.
//
// Run: node tests/portalBrowse.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import {
  DEFAULT_PORTAL_BROWSE_SORT,
  DEFAULT_PORTAL_BROWSE_VIEW,
  PORTAL_BROWSE_SORTS,
  PORTAL_BROWSE_VIEWS,
  buildPortalGroupHeaders,
  isDefaultPortalBrowse,
  isPortalPriceSort,
  normalizePortalBrowseSort,
  normalizePortalBrowseView,
  portalBrowseParams,
  portalBrowseSearch,
  readPortalBrowseFromSearch,
} from '../src/components/catalog/portalBrowse.ts'
import { mergePortalCatalogProducts } from '../src/components/catalog/portalProductGrouping.ts'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- 1. the model -------------------------------------------------------------

check('the default view is brand and the default sort is featured', () => {
  assert.equal(DEFAULT_PORTAL_BROWSE_VIEW, 'brand')
  assert.equal(DEFAULT_PORTAL_BROWSE_SORT, 'featured')
  assert.deepEqual([...PORTAL_BROWSE_VIEWS], ['brand', 'category', 'all'])
  assert.equal(PORTAL_BROWSE_VIEWS[0], DEFAULT_PORTAL_BROWSE_VIEW, 'brand leads the list')
  assert.equal(PORTAL_BROWSE_SORTS[0], DEFAULT_PORTAL_BROWSE_SORT, 'featured leads the list')
  assert.equal(normalizePortalBrowseView(undefined), 'brand')
  assert.equal(normalizePortalBrowseView(null), 'brand')
  assert.equal(normalizePortalBrowseSort(undefined), 'featured')
  assert.ok(isDefaultPortalBrowse('brand', 'featured'))
  assert.ok(!isDefaultPortalBrowse('category', 'featured'))
  assert.ok(!isDefaultPortalBrowse('brand', 'name_desc'))
})

check('an unknown view or sort falls back to the default; a real one is kept', () => {
  for (const junk of ['', 'bogus', 'BRANDS', 'name_asc; DROP TABLE products', '__proto__', 'constructor', '1', ' ', 42, {}, [], false]) {
    assert.equal(normalizePortalBrowseView(junk), 'brand', `view ${JSON.stringify(junk)}`)
    assert.equal(normalizePortalBrowseSort(junk), 'featured', `sort ${JSON.stringify(junk)}`)
  }
  for (const view of PORTAL_BROWSE_VIEWS) assert.equal(normalizePortalBrowseView(view), view)
  for (const sort of PORTAL_BROWSE_SORTS) assert.equal(normalizePortalBrowseSort(sort), sort)
  // Case and padding of a real key are tolerated, as on the server.
  assert.equal(normalizePortalBrowseView(' Category '), 'category')
  assert.equal(normalizePortalBrowseSort(' Price_Desc '), 'price_desc')
})

check('a price sort is refused while prices are hidden, a name sort is not', () => {
  assert.equal(normalizePortalBrowseSort('price_asc', false), 'featured')
  assert.equal(normalizePortalBrowseSort('price_desc', false), 'featured')
  assert.equal(normalizePortalBrowseSort('name_desc', false), 'name_desc')
  assert.equal(normalizePortalBrowseSort('price_desc', true), 'price_desc')
  assert.ok(isPortalPriceSort('price_asc') && isPortalPriceSort('price_desc'))
  assert.ok(!isPortalPriceSort('name_asc') && !isPortalPriceSort('featured') && !isPortalPriceSort(undefined))
})

// --- 2. the request and the URL -------------------------------------------------

check('switching changes the request; the default asks for nothing extra', () => {
  assert.deepEqual(portalBrowseParams('brand', 'featured'), { view: '', sort: '' })
  assert.deepEqual(portalBrowseParams('category', 'featured'), { view: 'category', sort: '' })
  assert.deepEqual(portalBrowseParams('brand', 'price_asc'), { view: '', sort: 'price_asc' })
  assert.deepEqual(portalBrowseParams('all', 'name_desc'), { view: 'all', sort: 'name_desc' })
  // Discriminating: the three views are three different requests.
  const requests = PORTAL_BROWSE_VIEWS.map((view) => JSON.stringify(portalBrowseParams(view, 'featured')))
  assert.equal(new Set(requests).size, PORTAL_BROWSE_VIEWS.length)
})

check('the URL is read with a fallback for junk and written without disturbing other params', () => {
  assert.deepEqual(readPortalBrowseFromSearch(''), { view: 'brand', sort: 'featured' })
  assert.deepEqual(readPortalBrowseFromSearch('?view=category&sort=price_desc'), { view: 'category', sort: 'price_desc' })
  assert.deepEqual(readPortalBrowseFromSearch('?view=nonsense&sort=%27%3B--'), { view: 'brand', sort: 'featured' })
  assert.deepEqual(readPortalBrowseFromSearch('?utm_source=x'), { view: 'brand', sort: 'featured' })
  // Defaults leave the URL clean; a choice adds only its own keys.
  assert.equal(portalBrowseSearch('', 'brand', 'featured'), '')
  assert.equal(portalBrowseSearch('', 'category', 'featured'), '?view=category')
  assert.equal(portalBrowseSearch('?utm_source=x', 'all', 'name_asc'), '?utm_source=x&view=all&sort=name_asc')
  assert.equal(portalBrowseSearch('?utm_source=x&view=all&sort=name_asc', 'brand', 'featured'), '?utm_source=x', 'back to default removes only its own keys')
  // Round trip, for every combination.
  for (const view of PORTAL_BROWSE_VIEWS) {
    for (const sort of PORTAL_BROWSE_SORTS) {
      assert.deepEqual(readPortalBrowseFromSearch(portalBrowseSearch('?ref=1', view, sort)), { view, sort })
    }
  }
})

// --- 3. the grouping -------------------------------------------------------------

const labels = { promotionsLabel: 'Promotions', noBrandLabel: 'Other Brands', noCategoryLabel: 'Other categories' }
const cards = [
  { brand: 'Acme', category: 'Hair' },
  { brand: 'acme', category: 'Skincare' },
  { brand: 'Zed', category: 'Skincare' },
  { brand: '', category: '' },
  { brand: '  ', category: '   ' },
]

check('brand and category views group the same cards differently, "all" not at all', () => {
  const byBrand = buildPortalGroupHeaders(cards, { view: 'brand', promotedRun: 0, ...labels })
  assert.deepEqual([...byBrand], [[0, 'Acme'], [2, 'Zed'], [3, 'Other Brands']], 'brand: case-insensitive, blank and whitespace-only share one group')
  const byCategory = buildPortalGroupHeaders(cards, { view: 'category', promotedRun: 0, ...labels })
  assert.deepEqual([...byCategory], [[0, 'Hair'], [1, 'Skincare'], [3, 'Other categories']])
  assert.notDeepEqual([...byBrand], [...byCategory], 'switching the view changes the grouping')
  assert.equal(buildPortalGroupHeaders(cards, { view: 'all', promotedRun: 0, ...labels }).size, 0)
})

check('the promoted block gets one header and group headers start after it', () => {
  const headers = buildPortalGroupHeaders(cards, { view: 'brand', promotedRun: 2, ...labels })
  assert.deepEqual([...headers], [[0, 'Promotions'], [2, 'Zed'], [3, 'Other Brands']])
  // The promoted block alone survives under "all products".
  assert.deepEqual([...buildPortalGroupHeaders(cards, { view: 'all', promotedRun: 2, ...labels })], [[0, 'Promotions']])
  // A run longer than the page cannot index past it.
  assert.deepEqual([...buildPortalGroupHeaders(cards.slice(0, 1), { view: 'brand', promotedRun: 9, ...labels })], [[0, 'Promotions']])
  assert.equal(buildPortalGroupHeaders([], { view: 'brand', promotedRun: 0, ...labels }).size, 0)
})

check('merging the storefront payload keeps the server order, so each brand stays together', () => {
  // The server pages brand-first (Chanel, Dior x2, Sulwhasoo). Sorted A-Z by
  // name on the client, Dior's two cards were split by Chanel and Sulwhasoo and
  // the brand header printed three times.
  const served = [
    { id: 1, name: 'Body Lotion', brand: 'Chanel', selling_price_usd: 5 },
    { id: 2, name: 'Argan Oil', brand: 'Dior', selling_price_usd: 7 },
    { id: 3, name: 'Zinc', brand: 'Dior', selling_price_usd: 1 },
    { id: 4, name: 'Cream', brand: 'Sulwhasoo', selling_price_usd: 9 },
  ]
  const kept = mergePortalCatalogProducts(served, true)
  assert.deepEqual(kept.map((card) => card.name), ['Body Lotion', 'Argan Oil', 'Zinc', 'Cream'])
  assert.equal(buildPortalGroupHeaders(kept, { view: 'brand', promotedRun: 0, ...labels }).size, 3, 'one header per brand')
  // Control: the old default re-sorts by name and splits Dior, which is what this check guards against.
  const resorted = mergePortalCatalogProducts(served)
  assert.equal(buildPortalGroupHeaders(resorted, { view: 'brand', promotedRun: 0, ...labels }).size, 4, 'control: A-Z splits a brand')
})

// --- 4. the server mirror --------------------------------------------------------

check('the Worker enforces the same allowlists and defaults, and never interpolates them', () => {
  const portal = read('../cloudflare/src/routes/portal.ts')
  const list = (name: string): string[] => {
    const match = portal.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`))
    assert.ok(match, `portal.ts must export ${name}`)
    return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  }
  assert.deepEqual(list('PORTAL_BROWSE_VIEWS'), [...PORTAL_BROWSE_VIEWS], 'server views drifted from the client list')
  assert.deepEqual(list('PORTAL_BROWSE_SORTS'), [...PORTAL_BROWSE_SORTS], 'server sorts drifted from the client list')
  assert.match(portal, new RegExp(`DEFAULT_PORTAL_BROWSE_VIEW: PortalBrowseView = '${DEFAULT_PORTAL_BROWSE_VIEW}'`))
  assert.match(portal, new RegExp(`DEFAULT_PORTAL_BROWSE_SORT: PortalBrowseSort = '${DEFAULT_PORTAL_BROWSE_SORT}'`))
  // The request values only ever pick between fixed strings.
  const parser = portal.slice(portal.indexOf('export function parsePortalBrowse'), portal.indexOf('export function buildPortalBrowseOrder'))
  assert.equal((portal.match(/query\.sort\b/g) || []).length, 1, 'the raw sort is read once, inside parsePortalBrowse')
  assert.equal((portal.match(/query\.view\b/g) || []).length, 1, 'the raw view is read once, inside parsePortalBrowse')
  assert.match(parser, /query\.sort/)
  assert.match(parser, /query\.view/)
  assert.match(portal, /'stockState', 'initial', 'promo', 'productId', 'view', 'sort',/, 'view and sort are part of the cache key')
})

// --- 5. the menu -----------------------------------------------------------------

type AnyProps = Record<string, any>

function loadRow(): (props: AnyProps) => any {
  const compiled = transformSync(read('src/components/catalog/PortalBrowseRow.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', compiled)((id: string) => nodeRequire(id), mod, mod.exports)
  return mod.exports.default as (props: AnyProps) => any
}

// Every element in the tree the component returned, depth first.
function walk(node: any, visit: (element: any) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
  visit(node)
  walk(node.props?.children, visit)
}

const Icon = (props: AnyProps) => React.createElement('svg', { 'data-icon': 'true', ...props })
const viewOptions = [
  { value: 'brand', icon: Icon, label: 'Brand', tip: 'Group by brand' },
  { value: 'category', icon: Icon, label: 'Category', tip: 'Group by category' },
  { value: 'all', icon: Icon, label: 'All products', tip: 'One list, no groups' },
]

check('the chip row renders every option on its first render, default chosen, each with a tooltip', () => {
  const Row = loadRow()
  const tree = Row({ label: 'View', options: viewOptions, value: 'brand', defaultValue: 'brand', onChange: () => {} })
  const buttons: any[] = []
  walk(tree, (element) => { if (element.type === 'button') buttons.push(element) })
  assert.deepEqual(buttons.map((button) => button.props['data-browse-option']), ['brand', 'category', 'all'])
  assert.deepEqual(buttons.map((button) => button.props['aria-pressed']), [true, false, false], 'brand is the chosen view on first paint')
  assert.deepEqual(buttons.map((button) => button.props.title), viewOptions.map((option) => option.tip), 'icon-first chips carry a translated tooltip')
  const markup = (nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string)(React.createElement(Row, { label: 'View', options: viewOptions, value: 'brand', defaultValue: 'brand', onChange: () => {} }))
  for (const option of viewOptions) assert.ok(markup.includes(option.label), `${option.label} is in the first markup`)
  assert.match(markup, /role="group" aria-label="View"/)
  assert.equal((markup.match(/data-icon="true"/g) || []).length, 3, 'every chip is icon-first')
})

check('tapping selects, tapping the chosen one again deselects back to the default', () => {
  const Row = loadRow()
  const press = (value: string, option: string): string[] => {
    const calls: string[] = []
    const tree = Row({ label: 'View', options: viewOptions, value, defaultValue: 'brand', onChange: (next: string) => calls.push(next) })
    walk(tree, (element) => { if (element.type === 'button' && element.props['data-browse-option'] === option) element.props.onClick() })
    return calls
  }
  assert.deepEqual(press('brand', 'category'), ['category'], 'select another view')
  assert.deepEqual(press('category', 'category'), ['brand'], 'deselect the chosen non-default view: back to brand')
  assert.deepEqual(press('brand', 'brand'), ['brand'], 'the default itself can never be deselected to nothing')
  assert.deepEqual(press('category', 'all'), ['all'], 'switch straight from one view to another')
})

// --- 6. the wiring ---------------------------------------------------------------

check('both storefront entries send the params, re-search on change and skip the stale bootstrap', () => {
  for (const [label, file] of [
    ['PublicCatalogPage', 'src/components/catalog/PublicCatalogPage.tsx'],
    ['CatalogPage', 'src/components/catalog/CatalogPage.tsx'],
  ] as const) {
    const source = read(file)
    assert.match(source, /\.\.\.portalBrowseParams\(browseView, browseSort\)/, `${label} must send view/sort with the search`)
    assert.match(source, /browseSort,\s*browseView,/, `${label}'s search effect must depend on both`)
    assert.match(source, /isDefaultPortalBrowse\(browseRef\.current\.view, browseRef\.current\.sort\)/, `${label} must not paint the brand-ordered bootstrap for another view or sort`)
    assert.match(source, /isPortalPriceSort\(browseSort\)/, `${label} must drop a price sort when prices are hidden`)
    // One request per change: the page resets in the same update as the view or sort.
    assert.match(source, /changeBrowseView[^=]*= \(view\) => \{\s*set\w*Page\(1\)\s*setBrowseView\(view\)/, `${label}: a view change must reset the page in the same update`)
    assert.match(source, /changeBrowseSort[^=]*= \(sort\) => \{\s*set\w*Page\(1\)\s*setBrowseSort\(sort\)/, `${label}: a sort change must reset the page in the same update`)
    assert.match(source, /browseView=\{browseView\}|browseView,\n/, `${label} must hand the view to the catalog section`)
  }
  assert.match(read('src/components/catalog/PublicCatalogPage.tsx'), /usePortalBrowse\(true\)/, 'the live storefront syncs the URL')
  assert.match(read('src/components/catalog/CatalogPage.tsx'), /usePortalBrowse\(publicView\)/, 'the editor preview must not rewrite the admin address bar')
})

check('the storefront never re-sorts the server order on the client', () => {
  const source = read('src/components/catalog/PublicCatalogPage.tsx')
  assert.match(source, /mergePortalCatalogProducts\(next\.products, true\)/, 'bootstrap keeps the server order')
  assert.match(source, /mergePortalCatalogProducts\(data\.items, true\)/, 'search keeps the server order')
  // The defect this replaces: a browse payload re-sorted A-Z by name scattered
  // each brand across the page, so the brand headers repeated.
})

check('View and Sort come first in the filter menu and price sorts need visible prices', () => {
  const section = read('src/components/catalog/CatalogProductsSection.tsx')
  const menu = section.slice(section.indexOf('const renderFilterFields = () => ('))
  const view = menu.indexOf('<PortalBrowseRow label={copy(\'portalBrowseView\'')
  const sort = menu.indexOf('<PortalBrowseRow label={copy(\'portalBrowseSort\'')
  const category = menu.indexOf("copy('category', 'Category')")
  assert.ok(view > 0 && sort > view && category > sort, 'View, then Sort, then the facets')
  assert.match(section, /previewConfig\.showPrices === true \|\| !isPortalPriceSort\(option\.value\)/)
  assert.match(section, /browseView = DEFAULT_PORTAL_BROWSE_VIEW/, 'a caller that passes nothing gets the brand view')
  // One menu: the desktop panel and the phone layer share renderFilterFields.
  assert.equal((section.match(/renderFilterFields\(\)/g) || []).length, 2)
})

check('every View/Sort string is in the Khmer storefront table and in both language packs', () => {
  // The keys are read from the source so a label added later without Khmer fails here.
  const section = read('src/components/catalog/CatalogProductsSection.tsx')
  const keys = new Set([...section.matchAll(/copy\('((?:portal(?:Browse|View|Sort)|noCategory)\w*)'/g)].map((match) => match[1]))
  assert.ok(keys.size >= 17, `expected the browse copy keys, found ${keys.size}`)
  const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
  for (const key of keys) {
    const khmer = getPortalLanguageText('km', key)
    assert.match(khmer, /[ក-៿]/, `km storefront table has no Khmer for ${key}`)
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.equal(km[key], khmer, `km.json and the storefront table disagree on ${key}`)
    assert.notEqual(km[key], en[key], `${key} is untranslated in km.json`)
  }
})

if (failed > 0) {
  console.error(`${failed} portalBrowse check(s) failed`)
  process.exit(1)
}
console.log('portalBrowse tests passed')
