// P-public-10 (owner, 2026-09-25): compact storefront filter -- the search owns
// the full row, Filters is one control at every breakpoint (floating layer
// below lg, slim collapsible panel at lg+), the most useful fields come first,
// and active filters show as removable chips.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPortalActiveFilterChips, withoutFilterValue } from '../src/components/catalog/portalActiveFilters.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')

const base = {
  categoryFilter: [] as string[],
  brandFilter: [] as string[],
  promoFacet: '',
  stockFilter: [] as string[],
  showStockStatus: true,
  branchFilter: [] as string[],
  initialFilter: 'all',
  promoLabel: 'Promotions only',
  stockLabel: (value: string) => ({ in_stock: 'In Stock', out_of_stock: 'Out of Stock' } as Record<string, string>)[value] || value,
  branchLabel: (value: string) => (value === '1' ? 'Main' : value),
  allInitialKey: 'all',
}

// 1. Nothing active -> no chips (and the 'all' letter is not a filter).
assert.deepEqual(buildPortalActiveFilterChips(base), [])

// 2. One chip per value, in panel order, with human labels for coded facets.
const chips = buildPortalActiveFilterChips({
  ...base,
  initialFilter: 'N',
  branchFilter: ['1'],
  stockFilter: ['out_of_stock'],
  promoFacet: 'rule:7',
  brandFilter: ['Nivea', 'Dove'],
  categoryFilter: ['Skin care'],
})
assert.deepEqual(chips.map((chip) => chip.key), ['category:Skin care', 'brand:Nivea', 'brand:Dove', 'promo:rule:7', 'stock:out_of_stock', 'branch:1', 'initial:N'])
assert.deepEqual(chips.map((chip) => chip.label), ['Skin care', 'Nivea', 'Dove', 'Promotions only', 'Out of Stock', 'Main', 'N'])

// 3. A hidden stock facet is not counted by portalActiveFilterCount, so it
//    must not surface as a chip either.
assert.deepEqual(buildPortalActiveFilterChips({ ...base, stockFilter: ['in_stock'], showStockStatus: false }), [])

// 4. Removing a chip drops that one value, not the facet.
assert.deepEqual(withoutFilterValue(['Nivea', 'Dove'], 'Nivea'), ['Dove'])
assert.deepEqual(withoutFilterValue(['Nivea'], 'Other'), ['Nivea'])

// 5. Wiring in the section.
const section = read('src/components/catalog/CatalogProductsSection.tsx')
assert.doesNotMatch(section, /lg:grid-cols-\[17rem_minmax\(0,1fr\)\]/, 'the permanent desktop rail that narrowed the search row is back')
assert.match(section, /<label htmlFor="portal-product-search" className="flex min-w-0 flex-1/, 'search takes the rest of the row')
assert.match(section, /data-portal-active-filters="true"[^>]*flex-wrap/, 'chips wrap instead of scrolling over the list')
assert.match(section, /onClick=\{\(\) => removeActiveFilterChip\(chip\)\}/)
assert.match(section, /copy\('removeActiveFilter', 'Remove filter: \{label\}'\)/)
const fields = section.slice(section.indexOf('const renderFilterFields = () => ('), section.indexOf('  return (\n    <SectionShell'))
const order = ["copy('category', 'Category')", "copy('brand', 'Brand')", "copy('promotionsFilter', 'Promotions only')", "copy('stockStatus', 'Stock status')"].map((needle) => fields.indexOf(needle))
assert.ok(order.every((at) => at >= 0), 'every field is still rendered')
assert.deepEqual([...order].sort((a, b) => a - b), order, 'fields are ordered most useful first: category, brand, promotions, stock')

// 6. Both packs carry the chip label, with the placeholder intact.
for (const pack of ['src/lang/en.json', 'src/lang/km.json']) {
  const value = JSON.parse(read(pack)).removeActiveFilter
  assert.ok(typeof value === 'string' && value.includes('{label}'), `${pack} removeActiveFilter`)
}
assert.notEqual(JSON.parse(read('src/lang/km.json')).removeActiveFilter, JSON.parse(read('src/lang/en.json')).removeActiveFilter, 'km is translated, not English')

console.log('PASS compact storefront filter: full-row search, collapsible desktop panel, ordered fields, removable chips')
