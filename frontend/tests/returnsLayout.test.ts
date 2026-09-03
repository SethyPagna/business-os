import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const returnsSource = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const returnsSurfaceSource = readFileSync(new URL('../src/components/returns/ReturnsListSurface.tsx', import.meta.url), 'utf8')
const newReturnSource = readFileSync(new URL('../src/components/returns/NewReturnModal.tsx', import.meta.url), 'utf8')
const returnDetailSource = readFileSync(new URL('../src/components/returns/ReturnDetailModal.tsx', import.meta.url), 'utf8')
const saleDetailSource = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const searchInputSource = readFileSync(new URL('../src/components/shared/SearchInput.tsx', import.meta.url), 'utf8')
const columnChooserSource = readFileSync(new URL('../src/components/shared/ColumnChooser.tsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')
const km = readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')

const statsIndex = returnsSource.indexOf("tr('total_refunded'")
const searchIndex = returnsSource.indexOf('id="returns-search"')

assert.ok(statsIndex >= 0, 'Returns page should render stats cards')
assert.ok(searchIndex >= 0, 'Returns page should render search input')
assert.ok(statsIndex < searchIndex, 'Returns page should show stats before search and filters')
assert.match(returnsSource, /<SearchInput\b/, 'Returns search should use the shared SearchInput component')
// The leading search icon was removed from the shared component (it ate
// into the field's usable width for no real benefit) -- assert its
// absence now, the inverse of what this test checked for before.
assert.doesNotMatch(searchInputSource, /<Search className=/, 'Shared SearchInput should no longer render a leading search icon')
assert.match(returnsSurfaceSource, /matchMedia\('\(max-width: 767px\)'\)/, 'Returns list surface should keep phone-sized and narrow PWA viewports on the mobile card layout')
assert.match(returnsSurfaceSource, /\{!isMobileViewport \? \(/, 'Returns desktop list should only render for desktop viewports')
assert.match(returnsSurfaceSource, /\{isMobileViewport \? \(/, 'Returns mobile cards should only render for mobile viewports')
assert.doesNotMatch(en, /"search_returns_placeholder":\s*"[^"]*ðŸ”/)
assert.doesNotMatch(km, /"search_returns_placeholder":\s*"[^"]*ðŸ”/)
assert.match(columnChooserSource, /createPortal\([\s\S]*document\.body/, 'column option menus must portal outside fixed cards and table clipping layers')
assert.match(columnChooserSource, /className="fixed z-\[1200\]/, 'column option menus must use a fixed top layer')
assert.match(columnChooserSource, /menuRef\.current\?\.contains\(target\)/, 'clicks inside the portaled column menu must not be mistaken for outside clicks')

console.log('PASS returns layout shows stats first, uses icon-only search, and gates list surfaces by viewport')

// Regression: the type filter (Restocked / Written Off / Refund Only / ...)
// used to be sent to the server when loading returns, which shrank `rows`
// itself down to just the selected type. Because the scope stat tiles
// (Total Refunded / Restocked / Written Off / Refund Only, and their
// supplier-scope equivalents) were computed from that same narrowed data,
// picking any one type made every other tile collapse to zero, and the
// Type filter's own dropdown options (built from `rows`) shrank to just
// the currently selected type. Fixed by keeping `type` entirely
// client-side and computing the tiles from a search-only-filtered view
// of the full dataset instead of the type-filtered one.
const loadReturnsParamsSection = returnsSource.slice(
  returnsSource.indexOf('const loadReturns = useCallback'),
  returnsSource.indexOf('const loadReturns = useCallback') + 1200,
)
assert.doesNotMatch(loadReturnsParamsSection, /typeFilter !== 'all' \? \{ type: typeFilter \}/, 'Returns should not send the type filter to the server -- it would narrow `rows` itself and break the scope stat tiles')
assert.match(returnsSource, /const searchFiltered = useMemo\(/, 'Returns should compute a search-only (no type) view of the data for the scope stat tiles')
assert.match(returnsSource, /for \(const ret of searchFiltered\)/, 'Returns scope stat tiles should sum from the search-only filtered view, not the type-filtered list view')

console.log('PASS returns type filter stays client-side so scope stat tiles and type options always reflect the full dataset')

assert.match(newReturnSource, /Search another product by name, SKU or barcode/, 'replacement sale should search the full catalog by name/SKU/barcode')
assert.match(newReturnSource, /searchProducts\(\{ query, page: 1, pageSize: 30 \}\)/, 'replacement catalog search should use the normal product search transport')
assert.doesNotMatch(newReturnSource, /if \(exactBarcode\) pickReplacementRow\(/, 'a scan must never auto-pick a replacement row -- it only narrows the candidate list, the operator chooses')
assert.doesNotMatch(newReturnSource, /normName\(row\.name\).*normName\(name\)/, 'replacement choices must not be filtered back to the returned product name')
assert.match(newReturnSource, /replacementReceiptNumber/, 'successful exchange should surface the linked replacement receipt number')
assert.match(returnDetailSource, /replacement_receipt_number/, 'return detail should show the linked replacement sale receipt')
assert.match(saleDetailSource, /returned_quantity/, 'sale detail should tag returned item quantities')
assert.match(saleDetailSource, /source_return_id/, 'replacement sale detail should identify the source return')

console.log('PASS returns can replace with any barcode-searched product and expose linked return/sale receipt tags')
