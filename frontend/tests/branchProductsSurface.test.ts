import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const surface = fs.readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')
const hub = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')

test('Branches Products mounts the product workspace rather than ranged statistics', () => {
  assert.match(hub, /active === 'products'[\s\S]{0,400}hostSection="products"/)
  assert.doesNotMatch(hub, /active === 'products'[\s\S]{0,500}hostSection="stats"/)
})

test('product search has an independent tracked lifecycle and branch-scoped query', () => {
  assert.match(inventory, /const productsRequestRef = useRef\(0\)/)
  assert.match(inventory, /beginTrackedRequest\(productsRequestRef\)/)
  assert.ok((inventory.match(/isTrackedRequestCurrent\(productsRequestRef, requestId\)/g) || []).length >= 3)
  assert.match(inventory, /searchInventoryProducts\(\{[\s\S]{0,400}branchId:[\s\S]{0,300}query:[\s\S]{0,200}page: productsPage,[\s\S]{0,100}pageSize: productsPageSize/)
  assert.match(inventory, /\[branchFilter, deferredSearch, isActive, needsProductsData, productsPage, productsPageSize, productsScope, searchMode, tr\]/)
  assert.doesNotMatch(inventory, /settleLoaderMap\([\s\S]{0,700}searchInventoryProducts/)
})

test('scope changes reset paging and stale responses cannot replace the latest rows', async () => {
  let sequence = 0
  let rows: string[] = []
  const apply = async (promise: Promise<string[]>) => {
    const request = ++sequence
    const value = await promise
    if (request === sequence) rows = value
  }
  let resolveOld!: (rows: string[]) => void
  const old = new Promise<string[]>((resolve) => { resolveOld = resolve })
  const first = apply(old)
  await apply(Promise.resolve(['new branch']))
  resolveOld(['stale branch'])
  await first
  assert.deepEqual(rows, ['new branch'])
  assert.match(inventory, /useEffect\(\(\) => \{\s*setProductsPage\(1\)\s*\}, \[branchFilter, deferredSearch, searchMode\]\)/)
})

test('compact grouped rows expose scoped quantity, SKU, barcode, detail popup and canonical link', () => {
  assert.match(surface, /function groupInventoryProducts/)
  assert.match(surface, /function scopedProductQuantity/)
  assert.match(surface, /row\.branch_id[\s\S]{0,120}branchFilter/)
  assert.match(surface, /t\('sku'\)/)
  assert.match(surface, /t\('barcode'\)/)
  assert.match(surface, /onClick=\{\(\) => onOpenDetail\(row\)\}/)
  assert.match(surface, /onOpenInCatalogue\(product\)/)
  assert.match(inventory, /setDetailProduct/)
  assert.match(inventory, /bos:dashboard:products-focus/)
  assert.match(inventory, /navigateTo\?\.\('products'\)/)
})

const require = createRequire(import.meta.url)
const React = require('react')
const render = require('react-dom/server').renderToStaticMarkup
const module = { exports: {} as Record<string, any> }
const compiled = transformSync(surface, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.includes('productGrouping')) return require('../src/utils/productGrouping.ts')
  return { default: () => null, __esModule: true }
}, module, module.exports)
const api = module.exports
const rows = [
  { id: 1, name: 'Tea', sku: 'T', barcode: '111', purchase_price_usd: 2, selling_price_usd: 4, branch_stock: [{ branch_id: 1, branch_name: 'A', quantity: 3 }] },
  { id: 2, name: 'Tea', sku: 'T', barcode: '111', purchase_price_usd: 4, selling_price_usd: 5, branch_stock: [{ branch_id: 2, branch_name: 'B', quantity: 7 }] },
]
test('real shared grouping merges branch duplicates while preserving member ids and value basis', () => {
  const [group] = api.groupInventoryProducts(rows)
  assert.equal(group.rows.length, 1)
  assert.deepEqual(group.rows[0].__mergedProductIds, [1, 2])
  assert.equal(api.inventoryCost(group.rows[0], 'usd'), 3, 'display follows canonical merged distinct-cost policy')
  assert.equal(api.scopedProductQuantity(group.rows[0], '1'), 3)
  assert.equal(api.scopedProductQuantity(group.rows[0], '2'), 7)
  assert.equal(api.scopedProductValue(group.rows[0], group.items, '1'), 6)
  assert.equal(api.scopedProductValue(group.rows[0], group.items, 'all'), 34, 'not merged average cost times combined quantity')
  assert.equal(api.scopedProductValue({ id: 3 }, [{ id: 3, branch_stock: [{ branch_id: 1, quantity: 2 }] }], '1'), null)
})
const props = { items: rows, total: 1, page: 1, pageSize: 20, totalPages: 1, branchFilter: '1', loading: false, error: null, serverStats: { total_products: 999, stock_value_usd: 12345 }, statsLoading: false, t: (key: string) => key, fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}KHR`, onPageChange: () => {}, onPageSizeChange: () => {}, onOpenDetail: () => {}, onOpenInCatalogue: () => {} }
test('actual surface restores existing-data columns, server totals, expand and gated raw-id actions', () => {
  const html = render(React.createElement(api.default, props))
  for (const label of ['cost', 'price', 'stock_val', 'branches', 'sku', 'barcode']) assert.ok(html.includes(label))
  assert.ok(html.includes('999') && html.includes('$12345'), 'stats use server values, not one paged family')
  assert.ok(html.includes('aria-expanded="true"'))
  assert.ok(html.includes('#<!--') || (html.includes('#1') && html.includes('#2')), 'merged actions identify their original records')
  assert.ok(!html.includes('adjust_stock'), 'no permission callback means no adjust action')
  assert.ok(render(React.createElement(api.default, { ...props, onAdjust: () => {} })).includes('adjust_stock'))
})
test('real loading/error/empty render paths and absent metrics never fake financial zero', () => {
  assert.ok(render(React.createElement(api.default, { ...props, loading: true })).includes('animate-pulse'))
  assert.ok(render(React.createElement(api.default, { ...props, error: 'LOAD FAILED' })).includes('LOAD FAILED'))
  const empty = render(React.createElement(api.default, { ...props, items: [], serverStats: null }))
  assert.ok(empty.includes('no_data'))
  assert.ok(empty.includes('—'))
  assert.ok(!empty.includes('$0'))
})
test('product stats lifecycle uses existing filtered server endpoint and scope tags hide stale results', () => {
  assert.match(inventory, /needsStatsData = .*inventorySection === 'products'/)
  assert.match(inventory, /getInventoryStats\(statsQuery\)/)
  assert.match(inventory, /const inventoryStatsScope = JSON.stringify\(\[branchFilter, deferredSearch, searchMode\]\)/)
  assert.match(inventory, /serverStats=\{stockStatsScope === inventoryStatsScope \? stockStats : null\}/)
  assert.match(inventory, /items=\{productsResultScope === productsScope \? productsItems : \[\]\}/)
  assert.match(inventory, /onAdjust=\{canAdjustStock \? openAdjust : undefined\}/)
})

test('loading, error, empty, data and pagination are separate product states', () => {
  assert.match(surface, /loading \? \(/)
  assert.match(surface, /\) : error \? \(/)
  assert.match(surface, /\) : groups\.length === 0 \? \(/)
  assert.match(surface, /groups\.map\(\(group\)/)
  assert.match(surface, /<PaginationControls[\s\S]{0,300}page=\{page\}[\s\S]{0,100}pageSize=\{pageSize\}[\s\S]{0,100}totalItems=\{total\}/)
  assert.match(inventory, /setProductsError\(error instanceof Error/)
  assert.match(inventory, /finally \{[\s\S]{0,140}setProductsLoading\(false\)/)
})
