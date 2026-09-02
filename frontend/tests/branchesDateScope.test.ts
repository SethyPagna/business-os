import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const hubSource = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')
const inventorySource = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

test('Branches exposes one compact standalone date range beside one Export action', () => {
  assert.equal((source.match(/<StatsRangeRow/g) || []).length, 1)
  assert.doesNotMatch(source, /<DateTimeRangePicker/)
  assert.equal((source.match(/onClick=\{\(\) => \{ void openBranchExport\(\) \}\}/g) || []).length, 1)
  assert.match(source, /showDateRange \? \([\s\S]*?<StatsRangeRow[\s\S]*?actions=\{<>[\s\S]*?branchExportButton[\s\S]*?<\/>\}/)
})

test('the hub owns one range and controls both Inventory stats and Branches', () => {
  assert.match(hubSource, /const \[sharedDateRange, setSharedDateRange\] = useState<DateTimeRange>/)
  assert.match(hubSource, /<InventorySection[\s\S]{0,300}dateRange=\{sharedDateRange\}[\s\S]{0,160}onDateRangeChange=\{setSharedDateRange\}/)
  assert.match(hubSource, /<BranchesSection[\s\S]{0,300}dateRange=\{sharedDateRange\}[\s\S]{0,160}onDateRangeChange=\{setSharedDateRange\}[\s\S]{0,160}showDateRange=\{!canInventory\}/)
  assert.match(hubSource, /view="transfers"[\s\S]{0,180}dateRange=\{sharedDateRange\}[\s\S]{0,160}onDateRangeChange=\{setSharedDateRange\}/)
  assert.match(inventorySource, /const stripRange = dateRange \?\? localStripRange/)
  assert.match(inventorySource, /const handleStripRangeChange = onDateRangeChange \?\? setLocalStripRange/)
  assert.match(inventorySource, /range=\{stripRange\} onRangeChange=\{handleStripRangeChange\}/)
})

test('Branches restores branch-product Inventory and keeps Transfer history separate', () => {
  assert.match(hubSource, /type BranchesHubSection = 'overview' \| 'inventory' \| 'transfers' \| 'rfid'/)
  assert.match(hubSource, /id: 'overview'.*'Overview'/)
  assert.match(hubSource, /id: 'inventory'.*'Inventory'/)
  assert.match(hubSource, /id: 'transfers'.*trh\('transfer', 'Transfer'\)/)
  // Restored Sept 2 2026: the Inventory tab used to literally re-render
  // BranchesSection view="branches" (the same content as Overview's branch
  // cards) -- indistinguishable from Overview by design of that regression.
  // It now drives the branch-stock product workspace instead.
  assert.match(hubSource, /active === 'inventory'[\s\S]*hostSection="products"/)
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

test('embedded Branches removes its duplicate picker but keeps one adaptive Export', () => {
  assert.match(source, /\{!showDateRange \? <div className="flex min-w-0 items-stretch gap-1 overflow-x-auto pt-1">[\s\S]*?\{branchExportButton\}/)
  assert.equal((source.match(/const branchExportButton = \(/g) || []).length, 1)
  assert.match(hubSource, /showDateRange=\{!canInventory\}/)
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
})

test('transfer pagination keeps the server total and page-size controls', () => {
  assert.match(source, /setTransferTotal\(Math\.max\(0, Number\(pageResult\.total\) \|\| 0\)\)/)
  assert.ok((source.match(/<PaginationControls/g) || []).length >= 1)
  assert.ok((source.match(/onPageSizeChange=\{\(size\) => \{ setTransferPageSize\(size\); setTransferPage\(1\) \}\}/g) || []).length >= 1)
})
