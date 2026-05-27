import assert from 'node:assert/strict'
import {
  buildProductExportItems,
  buildProductFilterSections,
  buildProductSupplierOptions,
  countActiveProductFilters,
} from '../src/components/products/helpers/productMenuHelpers.mjs'

const calls = []
const exportProductsCsv = (rows, prefix) => calls.push({ rows, prefix })
const tr = (key, fallback) => `${fallback} (${key})`

const filtered = [{ id: 1 }]
const selectedProducts = [{ id: 2 }]
const products = [{ id: 1 }, { id: 2 }]

const exportItems = buildProductExportItems({
  brandFilter: 'Acme',
  branchFilter: '3',
  catFilter: 'Skin',
  createdMonthFilter: '05',
  createdYearFilter: '2026',
  exportProductsCsv,
  filtered,
  products,
  selectedProducts,
  stockFilter: 'low',
  supplierFilter: 'Supplier A',
  tr,
})

assert.deepEqual(
  exportItems.map((item) => (item === 'divider' ? item : item.label)),
  [
    'Export visible products (export_visible_products)',
    'Export selected products (export_selected_products)',
    'Export filtered stock state (export_filtered_stock_state)',
    'Export filtered category (export_filtered_category)',
    'Export filtered brand (export_filtered_brand)',
    'Export filtered supplier (export_filtered_supplier)',
    'Export filtered branch (export_filtered_branch)',
    'Export filtered created-time range (export_filtered_created_time)',
    'divider',
    'Export full product list (export_full_product_list)',
  ],
  'export menu includes active filter choices in stable order',
)

exportItems[1].onClick()
exportItems[2].onClick()
exportItems.at(-1).onClick()
assert.deepEqual(
  calls,
  [
    { rows: selectedProducts, prefix: 'products-selected' },
    { rows: filtered, prefix: 'products-low' },
    { rows: products, prefix: 'products-all' },
  ],
  'export menu callbacks preserve row sets and file prefixes',
)

assert.deepEqual(
  buildProductSupplierOptions(['Beta', '', 'Alpha', 'Beta', null, 'Gamma']),
  ['Alpha', 'Beta', 'Gamma'],
  'supplier options dedupe, drop falsy entries, and sort',
)

assert.equal(
  countActiveProductFilters({
    brandFilter: 'Acme',
    branchFilter: 'all',
    catFilter: 'Skin',
    createdMonthFilter: 'all',
    createdYearFilter: '2026',
    groupFilter: 'grouped',
    initialFilter: 'A',
    productSortDirection: 'asc',
    stockFilter: 'low',
    supplierFilter: 'all',
  }),
  7,
  'active filter count matches the Products header badge contract',
)

assert.equal(countActiveProductFilters(), 0, 'default filters count as inactive')

const actionLog = []
const action = (name) => (value) => actionLog.push([name, value])
const sections = buildProductFilterSections({
  availableCreatedYears: [2025, 2026],
  branches: [{ id: 1, name: 'Main' }, { id: 2, name: 'Mall' }],
  brandOptions: ['Acme'],
  categories: [{ id: 5, name: 'Skin' }],
  filters: {
    brandFilter: 'Acme',
    branchFilter: '2',
    catFilter: 'Skin',
    createdMonthFilter: '05',
    createdYearFilter: '2026',
    groupFilter: 'grouped',
    productSortDirection: 'asc',
    stockFilter: 'low',
    supplierFilter: 'Supplier A',
  },
  monthOptions: [['05', 'May']],
  setBrandFilter: action('brand'),
  setBranchFilter: action('branch'),
  setCatFilter: action('category'),
  setCreatedMonthFilter: action('month'),
  setCreatedYearFilter: action('year'),
  setGroupFilter: action('group'),
  setProductSortDirection: action('sort'),
  setStockFilter: action('stock'),
  setSupplierFilter: action('supplier'),
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

assert.deepEqual(
  sections.map((section) => section.id),
  ['sort', 'created-year', 'created-month', 'branch', 'group', 'stock', 'category', 'brand', 'supplier'],
  'filter sections preserve Products menu ordering',
)
assert.equal(sections.find((section) => section.id === 'branch').options[2].active, true)
assert.equal(sections.find((section) => section.id === 'brand').options[1].active, true)
sections.find((section) => section.id === 'created-year').options[0].onClick()
sections.find((section) => section.id === 'created-year').options[2].onClick()
sections.find((section) => section.id === 'created-month').options[1].onClick()
sections.find((section) => section.id === 'branch').options[2].onClick()
sections.find((section) => section.id === 'stock').options[3].onClick()
assert.deepEqual(
  actionLog,
  [
    ['year', 'all'],
    ['month', 'all'],
    ['year', 'all'],
    ['month', 'all'],
    ['month', 'all'],
    ['branch', 'all'],
    ['stock', 'out'],
  ],
  'filter section actions preserve toggles and linked year/month reset behavior',
)

assert.deepEqual(buildProductFilterSections({ isOpen: false }), [], 'closed filter menu avoids section construction')

console.log('productMenuHelpers tests passed')
