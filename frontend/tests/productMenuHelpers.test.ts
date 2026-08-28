import assert from 'node:assert/strict'
import {
  buildProductExportScopes,
  buildProductFilterSections,
  countActiveProductFilters,
} from '../src/components/products/helpers/productMenuHelpers.ts'
import { buildProductSupplierOptions } from '../src/components/products/helpers/productSupplierOptions.ts'

type ProductRow = Record<string, unknown>
type ActionLogEntry = [name: string, value: string]
type FilterSection = ReturnType<typeof buildProductFilterSections>[number]

const tr = (key: string, fallback?: string) => `${fallback} (${key})`

function requireSection(sections: FilterSection[], id: string): FilterSection {
  const section = sections.find((item) => item.id === id)
  assert.ok(section, `Missing filter section ${id}`)
  return section
}

// `FilterSection` is a union of this file's own plain-options sections and
// the shared FilterMenu.tsx section shape (whose `options` type also
// admits `null`/`undefined`/`false` entries, for callers that inline
// conditional pills) -- see productMenuHelpers.ts's own `FilterSection`
// comment. None of the sections built in this test ever take that
// `availabilitySection` branch, so every entry here is always a real
// option at runtime; this just filters/narrows the type to match so the
// assertions below don't have to null-check every access.
function sectionOptions(section: FilterSection): Array<{ id: string | number; active?: boolean; onClick: () => void }> {
  return (section.options || []).filter(Boolean) as Array<{ id: string | number; active?: boolean; onClick: () => void }>
}

const filtered = [{ id: 1 }]
const selectedProducts = [{ id: 2 }]
const products = [{ id: 1 }, { id: 2 }]

// buildProductExportScopes replaced the old buildProductExportItems (Aug
// 2026 export-panel redesign): instead of one flat menu row per active
// filter type -- up to 9 rows that all exported the identical `filtered`
// array under different filenames -- callers now get at most 3 genuinely
// distinct scopes (selected / current view / full list) for a single
// export panel to render as one choice.
const scopesWithFiltersActive = buildProductExportScopes({
  brandFilter: new Set(['Acme']),
  branchFilter: '3',
  catFilter: new Set(['Skin']),
  createdDateFrom: '2026-05-01',
  createdDateTo: '2026-05-31',
  filtered,
  products,
  selectedProducts,
  stockFilter: 'low',
  supplierFilter: new Set(['Supplier A']),
  tr,
})

assert.deepEqual(
  scopesWithFiltersActive.map((scope) => ({ id: scope.id, label: scope.label, count: scope.count, filePrefix: scope.filePrefix })),
  [
    { id: 'selected', label: 'Selected products (export_scope_selected)', count: 1, filePrefix: 'products-selected' },
    { id: 'visible', label: 'Current filtered results (export_scope_filtered)', count: 1, filePrefix: 'products-filtered' },
    { id: 'full', label: 'Full product list (ignore filters) (export_scope_full)', count: 2, filePrefix: 'products-all' },
  ],
  'export scopes collapse per-filter-type rows into one filtered scope, plus selected/full when they differ',
)
assert.deepEqual(scopesWithFiltersActive[0].rows, selectedProducts, 'selected scope carries the selected rows')
assert.deepEqual(scopesWithFiltersActive[1].rows, filtered, 'visible scope carries the filtered rows')
assert.deepEqual(scopesWithFiltersActive[2].rows, products, 'full scope carries every product')

// No filters active and nothing selected: visible === full, so the "full"
// scope is correctly omitted rather than duplicating an identical row.
const scopesNoFilters = buildProductExportScopes({ filtered: products, products, tr })
assert.deepEqual(
  scopesNoFilters.map((scope) => scope.id),
  ['visible'],
  'unfiltered/no-selection case collapses to a single scope, not a duplicate visible+full pair',
)

assert.deepEqual(
  buildProductSupplierOptions(['Beta', '', 'Alpha', 'Beta', null, 'Gamma']),
  ['Alpha', 'Beta', 'Gamma'],
  'supplier options dedupe, drop falsy entries, and sort',
)

assert.equal(
  countActiveProductFilters({
    brandFilter: new Set(['Acme']),
    branchFilter: 'all',
    catFilter: new Set(['Skin']),
    createdDateFrom: '2026-05-01',
    createdDateTo: '',
    groupFilter: 'group',
    initialFilter: 'A',
    productSortDirection: 'asc',
    stockFilter: 'low',
    supplierFilter: new Set(),
  }),
  7,
  'active filter count matches the Products header badge contract',
)

assert.equal(countActiveProductFilters(), 0, 'default filters count as inactive')

const actionLog: ActionLogEntry[] = []
const action = (name: string) => (value: string) => actionLog.push([name, value])
const multiAction = (name: string) => (value: Set<string>) => actionLog.push([name, value.size ? [...value].join(',') : 'all'])
// Plain object matching FilterMenu.tsx's shared FilterSection shape --
// the real CreatedDateFilterOptions.tsx builder returns JSX (a .tsx file,
// same reason AvailabilityFilterOptions.tsx isn't exercised by this
// plain-node harness either), so this mock just verifies
// buildProductFilterSections slots a supplied createdSection into the
// right position rather than re-testing the JSX builder itself.
const mockCreatedSection = { id: 'created', label: 'Created', options: [] }
const sections = buildProductFilterSections({
  createdSection: mockCreatedSection,
  branches: [{ id: 1, name: 'Main' }, { id: 2, name: 'Mall' }],
  brandOptions: ['Acme'],
  categories: [{ id: 5, name: 'Skin' }],
  filters: {
    brandFilter: new Set(['Acme']),
    branchFilter: '2',
    catFilter: new Set(['Skin']),
    groupFilter: 'group',
    productSortDirection: 'asc',
    stockFilter: 'low',
    supplierFilter: new Set(['Supplier A']),
  },
  setBrandFilter: multiAction('brand'),
  setBranchFilter: action('branch'),
  setCatFilter: multiAction('category'),
  setGroupFilter: action('group'),
  setProductSortDirection: action('sort'),
  setStockFilter: action('stock'),
  setSupplierFilter: multiAction('supplier'),
  suppliers: ['Supplier A'],
  t: (key) => ({
    all: 'All',
    all_brands: 'All Brands',
    branch: 'Branch',
    brand: 'Brand',
    category: 'Category',
    group: 'Group',
    groups: 'Groups',
    in_stock: 'In Stock',
    low_stock: 'Low',
    month: 'Month',
    newest_first: 'Newest first',
    oldest_first: 'Oldest first',
    out_of_stock: 'Out',
    sort: 'Sort',
    standalone: 'Standalone',
    stock_status: 'Stock status',
    supplier: 'Supplier',
    suppliers: 'All Suppliers',
    year: 'Year',
  }[key] || key),
})

// The Products filter menu shows only Availability (merged Branch+Group+
// Stock), Created, Category, and Brand -- 'sort' and 'supplier' sections
// were removed (the list itself stays locked to alphabetical rather than
// offering a manual sort toggle; supplierFilter/setSupplierFilter/suppliers
// stay in this function's params for countActiveProductFilters and the
// export menu, just no longer render a section here). 'created' only
// appears when a caller supplies a pre-built createdSection (see
// CreatedDateFilterOptions.tsx, a JSX builder this plain-node test can't
// construct itself -- mockCreatedSection above stands in for it).
assert.deepEqual(
  sections.map((section) => section.id),
  // G1b order: everyday facets first (availability trio, category, brand),
  // range/diagnostic controls (created) after them.
  ['branch', 'group', 'stock', 'category', 'brand', 'created'],
  'filter sections preserve Products menu ordering',
)
assert.equal(sectionOptions(requireSection(sections, 'branch'))[2]?.active, true)
assert.equal(sectionOptions(requireSection(sections, 'brand'))[1]?.active, true)
assert.equal(requireSection(sections, 'created'), mockCreatedSection, 'createdSection is passed through unchanged')

sectionOptions(requireSection(sections, 'branch'))[2]?.onClick()
// stock section is now [all, in_stock, healthy, low, out] -- index 4 is
// 'out' (was index 3 before the 'healthy' pill was added between
// in_stock and low).
sectionOptions(requireSection(sections, 'stock'))[4]?.onClick()
assert.deepEqual(
  actionLog,
  [
    ['branch', 'all'],
    ['stock', 'out'],
  ],
  'filter section actions support multi-select toggling',
)

assert.deepEqual(buildProductFilterSections({ isOpen: false }), [], 'closed filter menu avoids section construction')

console.log('productMenuHelpers tests passed')
