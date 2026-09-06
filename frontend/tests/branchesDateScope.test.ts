import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import './branchProductsSurface.test.ts'

const source = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const hubSource = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')
const inventorySource = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

test('Branches exposes one compact standalone date range and one Export action', () => {
  assert.equal((source.match(/<StatsRangeRow/g) || []).length, 1)
  assert.doesNotMatch(source, /<DateTimeRangePicker/)
  assert.equal((source.match(/onClick=\{\(\) => \{ void openBranchExport\(\) \}\}/g) || []).length, 1)
  assert.match(source, /showDateRange \? \([\s\S]*?<StatsRangeRow/)
  assert.match(source, /\{showDateRange \? branchExportButton : null\}/)
})

// N10 reverses the earlier contract this test used to pin. Products showed
// per-product Net sold / Revenue / COGS / Profit that the Worker already
// scopes by startDate/endDate, so leaving the tab rangeless did not mean "no
// dated statistics" -- it meant those columns silently answered all-time
// while Overview and Transfers answered the picked window. All three data
// tabs now run off the hub's one clock.
test('the hub owns ONE range for Overview, Products and Transfers', () => {
  assert.match(hubSource, /const \[sharedDateRange, setSharedDateRange\] = useState<DateTimeRange>/)
  assert.match(hubSource, /active === 'products'[\s\S]{0,300}<InventorySection[\s\S]{0,120}hostSection="products"/)
  const productsMount = hubSource.match(/active === 'products'[\s\S]*?<InventorySection([\s\S]*?)\/>/)?.[1] || ''
  assert.match(productsMount, /dateRange=\{sharedDateRange\}/)
  assert.match(productsMount, /onDateRangeChange=\{setSharedDateRange\}/)
  assert.doesNotMatch(hubSource, /Products uses\s*\n?\s*\/\/ branch\/search scope/, 'the stale rangeless-Products comment is gone')
  assert.match(hubSource, /<BranchesSection[\s\S]{0,300}dateRange=\{sharedDateRange\}[\s\S]{0,160}onDateRangeChange=\{setSharedDateRange\}[\s\S]{0,160}showDateRange/)
  assert.match(hubSource, /view="transfers"[\s\S]{0,180}dateRange=\{sharedDateRange\}[\s\S]{0,160}onDateRangeChange=\{setSharedDateRange\}/)
  assert.match(inventorySource, /const stripRange = dateRange \?\? localStripRange/)
  assert.match(inventorySource, /const handleStripRangeChange = onDateRangeChange \?\? setLocalStripRange/)
  assert.match(inventorySource, /range=\{stripRange\} onRangeChange=\{handleStripRangeChange\}/)
  // The products range row lives in the same sticky wrapper as the search
  // row, per the app-wide sticky search + date rows convention, and only
  // when the stats strip is not already drawing that one control.
  assert.match(inventorySource, /showProductsSection && !showInventoryStats \? \([\s\S]{0,400}<StatsRangeRow/)
  // Stock cards stay unscoped: the stats key never grows date dimensions.
  assert.match(inventorySource, /const inventoryStatsScope = JSON\.stringify\(\[branchFilter, deferredSearch, searchMode\]\)/)
})

// N10 sibling parity: SKU left the Products tab, so the Overview per-branch
// stock cards must not keep printing it either -- SKU is now shown only on a
// product's own detail surfaces, nowhere in the Branches hub.
test('Branches overview stock cards no longer print a SKU line', () => {
  assert.doesNotMatch(source, /font-mono text-\[10px\] leading-tight text-gray-400">\{product\.sku\}/)
  assert.doesNotMatch(source, /\{product\.sku \? </, 'no conditional SKU sub-line is rendered in any card')
  assert.match(source, /whitespace-normal break-words font-medium text-gray-800/, 'the product name line itself stays')
  // The CSV export keeps its SKU column: an extract is data, not screen copy.
  assert.match(source, /SKU: product\.sku \|\| ''/)
})

test('Branches keeps branch Overview, product stock and Transfer history separate', () => {
  assert.match(hubSource, /type BranchesHubSection = 'overview' \| 'products' \| 'transfers' \| 'rfid'/)
  assert.match(hubSource, /id: 'overview'.*'Overview'/)
  assert.match(hubSource, /id: 'products'.*'Products'/)
  assert.match(hubSource, /id: 'transfers'.*trh\('transfer', 'Transfer'\)/)
  assert.match(hubSource, /active === 'products'[\s\S]*hostSection="products"/)
  assert.doesNotMatch(hubSource, /active === 'products'[\s\S]{0,500}view="branches"/)
  assert.doesNotMatch(hubSource, /hostSection="movements"/)
  assert.match(hubSource, /focus === 'movements'\) navigateTo\('products'\)/)
  assert.ok((hubSource.match(/showSectionNavigation=\{false\}/g) || []).length >= 2)
  assert.match(hubSource, /view="branches"/)
  assert.match(hubSource, /view="transfers"/)
  assert.doesNotMatch(hubSource, /active === 'transfers'[\s\S]{0,240}hostSection="movements"/)
  assert.match(source, /const tab = view \?\? internalTab/)
  assert.match(source, /\{showSectionNavigation \? <div/)
  assert.match(inventorySource, /export type InventoryHostSection = 'all' \| 'stats' \| 'products' \| 'movements' \| 'rfid'/)
})

test('the shared branch range scopes both transfer history and its export', () => {
  assert.match(source, /const branchDateRange = dateRange \?\? localBranchDateRange/)
  assert.ok((source.match(/startDate: branchDateRange\.startDate \|\| undefined/g) || []).length >= 2)
  assert.ok((source.match(/endDate: branchDateRange\.endDate \|\| undefined/g) || []).length >= 2)
  assert.match(source, /onRangeChange=\{\(range\) => \{\s*handleBranchDateRangeChange\(range\)\s*setTransferPage\(1\)/)
  assert.doesNotMatch(source, /transferStartDate|transferEndDate/)
})

test('embedded Branches removes its duplicate picker and keeps actions on one row', () => {
  assert.match(source, /\{!showDateRange \? <div className="flex min-w-0 items-stretch gap-1 overflow-x-auto pt-1">[\s\S]*?\{branchExportButton\}/)
  assert.equal((source.match(/const branchExportButton = \(/g) || []).length, 1)
  assert.ok((hubSource.match(/showDateRange/g) || []).length >= 2)
  assert.match(source, /\{showDateRange \? <ActionHistoryBar[\s\S]{0,300}\{showDateRange \? branchExportButton : null\}/)
})

test('Export follows the visible branch section and transfer remains icon plus label', () => {
  assert.match(source, /if \(tab === 'transfers'\) \{[\s\S]*?baseName: 'branch-transfers'/)
  assert.match(source, /baseName: 'branch-stock'/)
  assert.match(source, /runConcurrentTasks<BranchRecord, Array<Record<string, unknown>> \| null>[\s\S]*?\{ concurrency: 4 \}/)
  assert.doesNotMatch(source, /Promise\.all\(branches\.map/)
  assert.match(source, /<ArrowRightLeft className="h-4 w-4 shrink-0" \/>[\s\S]{0,180}<span>\{tr\('transfer', 'Transfer'\)\}<\/span>/)
})

test('Transfer is permission gated and available from both hub-controlled branch views', () => {
  assert.match(source, /const canTransferStock = can\('branches', 'transfer'\)/)
  assert.match(source, /\{canTransferStock \? \([\s\S]{0,900}onClick=\{\(\) => setModal\('transfer'\)\}/)
  assert.doesNotMatch(source, /tab === 'branches'[\s\S]{0,160}canTransferStock/)
  assert.ok((hubSource.match(/<BranchesSection/g) || []).length >= 2)
})

test('transfer rows use compact traceable references and restrained semantic columns', () => {
  assert.match(source, /function formatTransferReference/)
  assert.match(source, /return value \? `TRF-\$\{value\}` : 'TRF—'/)
  assert.match(source, /tr\('reference', 'Reference'\)/)
  assert.match(source, /tr\('route', 'Route'\)/)
  assert.match(source, /bg-violet-50\/70/)
  assert.match(source, /bg-blue-50\/60/)
  assert.match(source, /className="table-bordered w-full text-xs" style=\{\{ minWidth: 680 \}\}/)
  const tableStart = source.indexOf('<table className="table-bordered w-full text-xs"')
  const tableEnd = source.indexOf('</table>', tableStart)
  const transferTable = source.slice(tableStart, tableEnd)
  assert.doesNotMatch(transferTable, /tr\('from_branch', 'From'\)|tr\('to_branch', 'To'\)/)
  assert.ok((source.match(/<ArrowRight className="h-3 w-3 shrink-0 text-gray-400"/g) || []).length >= 2)
})

test('transfer pagination keeps the server total and page-size controls', () => {
  assert.match(source, /setTransferTotal\(Math\.max\(0, Number\(pageResult\.total\) \|\| 0\)\)/)
  assert.ok((source.match(/<PaginationControls/g) || []).length >= 1)
  assert.ok((source.match(/onPageSizeChange=\{\(size\) => \{ setTransferPageSize\(size\); setTransferPage\(1\) \}\}/g) || []).length >= 1)
})
