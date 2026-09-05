import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { buildInventoryProductsSearchParams } from '../src/components/inventory/inventoryProductsQuery.ts'

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
  // N10: the params object moved into the pure buildInventoryProductsSearchParams
  // helper (tested behaviourally below) so the date mapping is provable; the
  // call site now hands it branch/query/page/pageSize AND the shared range.
  assert.match(inventory, /searchInventoryProducts\(buildInventoryProductsSearchParams\(\{[\s\S]{0,400}branchFilter,[\s\S]{0,300}query: deferredSearch,[\s\S]{0,200}page: productsPage,[\s\S]{0,120}pageSize: productsPageSize,[\s\S]{0,120}range: stripRange/)
  assert.match(inventory, /\[branchFilter, deferredSearch, isActive, needsProductsData, productsPage, productsPageSize, productsScope, searchMode, stripRange\.endDate, stripRange\.startDate, tr\]/)
  assert.doesNotMatch(inventory, /settleLoaderMap\([\s\S]{0,700}searchInventoryProducts/)
})

// N10 discriminating test: the Worker's /api/inventory/products/search has
// always scoped Net sold / Revenue / COGS / Profit by startDate/endDate
// (cloudflare/src/routes/inventory.ts attachInventoryProductMetrics); the
// frontend never sent them, so those columns silently answered "all time".
// These cases fail on the old inline params object, which had no date keys at
// all, and on a both-or-nothing implementation that drops a half-open range.
test('the products search params carry the shared range verbatim and omit it when blank', () => {
  const base = { branchFilter: 'all', query: '', searchMode: 'and', page: 1, pageSize: 20 }
  const blank = buildInventoryProductsSearchParams({ ...base, range: { startDate: '', endDate: '' } })
  assert.ok(!('startDate' in blank), 'a blank range must not send an empty startDate')
  assert.ok(!('endDate' in blank), 'a blank range must not send an empty endDate')
  assert.equal(blank.page, 1)
  assert.equal(blank.pageSize, 20)
  assert.ok(!('branchId' in blank), 'the all-branches filter is not a branch id')

  const scoped = buildInventoryProductsSearchParams({ ...base, branchFilter: '2', query: ' tea ', page: 3, range: { startDate: '2026-09-01', endDate: '2026-09-06' } })
  assert.equal(scoped.startDate, '2026-09-01')
  assert.equal(scoped.endDate, '2026-09-06')
  assert.equal(scoped.branchId, 2)
  assert.equal(scoped.query, ' tea ', 'the query is forwarded unchanged, as before')
  assert.equal(scoped.page, 3)

  const startOnly = buildInventoryProductsSearchParams({ ...base, range: { startDate: '2026-09-01', endDate: '' } })
  assert.equal(startOnly.startDate, '2026-09-01')
  assert.ok(!('endDate' in startOnly), 'a half-open range still sends the bound it has')
  const endOnly = buildInventoryProductsSearchParams({ ...base, range: { startDate: '', endDate: '2026-09-06' } })
  assert.equal(endOnly.endDate, '2026-09-06')
  assert.ok(!('startDate' in endOnly))
  assert.notDeepEqual(blank, scoped, 'the range must change the request, or the read cache would serve all-time rows')
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
  assert.match(inventory, /useEffect\(\(\) => \{\s*setProductsPage\(1\)\s*\}, \[branchFilter, deferredSearch, searchMode, stripRange\.endDate, stripRange\.startDate\]\)/)
  // The cached page is keyed by scope; without the range in the key a
  // date change would keep showing the previous window's money columns.
  assert.match(inventory, /const productsScope = JSON\.stringify\(\[inventoryStatsScope, productsPage, productsPageSize, stripRange\.startDate, stripRange\.endDate\]\)/)
})

test('compact grouped rows expose scoped quantity, barcode, detail popup and canonical link without SKU', () => {
  assert.match(surface, /function groupInventoryProducts/)
  assert.match(surface, /function scopedProductQuantity/)
  assert.match(surface, /row\.branch_id[\s\S]{0,120}branchFilter/)
  // N10: SKU is shown nowhere else in the app (the canonical Products page
  // has no such column), so this outlier column and its mobile line go.
  assert.doesNotMatch(surface, /t\('sku'\)/)
  assert.doesNotMatch(surface, /product\.sku/)
  assert.match(surface, /const columnCount = 12/)
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
  for (const label of ['cost', 'price', 'stock_val', 'branches', 'barcode']) assert.ok(html.includes(label), `${label} column should stay`)
  assert.ok(!html.includes('sku'), 'the SKU column and its mobile line are gone')
  assert.ok(!html.includes('>T<'), 'no stray SKU value survives the column removal')
  // Highlighting parity with Products.tsx: cost red column, price green column.
  assert.ok(html.includes('col-highlight-red') && html.includes('col-highlight-green'), 'cost/price carry the shared column tints')
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

test('nullable server metrics sum real merged members without recalculating business policy', () => {
  const metrics = rows.map((row, index) => ({ ...row, display_quantity: index ? 7 : 3, stock_value_usd: index ? 28 : 6, stock_value_khr: 0, qty_sold: index ? -1 : 4, revenue_usd: index ? -5 : 20, revenue_khr: index ? -20000 : 80000, cogs_usd: index ? -2 : 8, cogs_khr: 0, profit_usd: index ? -3 : 12 }))
  const [group] = api.groupInventoryProducts(metrics)
  const row = group.rows[0]
  assert.equal(api.mergedInventoryMetric(row, metrics, 'display_quantity'), 10)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'stock_value_usd'), 34)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'qty_sold'), 3)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'revenue_usd'), 15)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'revenue_khr'), 60000)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'cogs_usd'), 6)
  assert.equal(api.mergedInventoryMetric(row, metrics, 'profit_usd'), 9)
  assert.equal(api.mergedInventoryMetric(row, [metrics[0], { ...metrics[1], revenue_usd: null }], 'revenue_usd'), null)
  assert.equal(api.mergedInventoryMetric(row, [metrics[0]], 'revenue_usd'), null, 'incomplete merged members are not partial totals')
  assert.equal(api.mergedInventoryMetric(row, metrics, 'cogs_khr'), 0, 'explicit server zero is retained')
  const html = render(React.createElement(api.default, { ...props, items: metrics }))
  for (const label of ['net_sold', 'revenue', 'cogs', 'profit']) assert.ok(html.includes(label))
  for (const value of ['$34', '$15', '60000KHR', '$6', '$9']) assert.ok(html.includes(value))
  const missing = render(React.createElement(api.default, { ...props, items: [{ id: 8, name: 'Unknown' }], serverStats: null }))
  assert.ok(missing.includes('—'))
  assert.ok(!missing.includes('$0'), 'missing financial metrics are not fabricated zero')
})
// N10: this table is the compactness/highlighting outlier -- it had plain
// px-3 py-2 headers with no weight and no colour, while every sibling dense
// list (Products, Sales) uses font-semibold headers, the red/green column
// tints and py-1.5 rows. Profit follows the Products page's Margin
// convention: blue normally, yellow on a loss.
test('the products table matches the sibling dense-list header weight, column tints and row density', () => {
  const positive = render(React.createElement(api.default, { ...props, items: [{ ...rows[0], id: 5, profit_usd: 12 }] }))
  assert.ok(positive.includes('text-blue-600'), 'a profit reads blue like Products margin')
  assert.ok(!positive.includes('text-yellow-600'))
  const loss = render(React.createElement(api.default, { ...props, items: [{ ...rows[0], id: 6, profit_usd: -4 }] }))
  assert.ok(loss.includes('text-yellow-600'), 'a negative profit reads yellow like a negative Products margin')
  assert.ok(positive.includes('text-red-700') && positive.includes('text-green-700'), 'cost is red and price is green like Products')
  assert.match(surface, /<thead className="[^"]*font-semibold/)
  assert.doesNotMatch(surface, /<t[hd] className="[^"]*\bpy-2\b/, 'rows and headers use the compact py-1.5 rhythm')
  assert.ok(!positive.includes('py-2'), 'no rendered cell keeps the looser padding')
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
