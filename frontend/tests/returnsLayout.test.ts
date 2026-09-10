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

assert.match(returnsSource, /<StatsStrip[\s\S]*?range=\{stripRange\}[\s\S]*?onRangeChange=\{setStripRange\}[\s\S]*?showPresets/, 'StatsStrip should own the Returns date range and preset rail')
assert.doesNotMatch(returnsSource, /<StatsRangeRow\b/, 'Returns should not repeat the date range in a separate row')
assert.match(returnsSource, /<ExportMenu[\s\S]*?iconOnly[\s\S]*?triggerClassName=\{toolbarIconButtonClassName\}/, 'Export should use the shared borderless icon-only header action')
assert.match(returnsSource, /className=\{primaryToolbarButtonClassName\}/, 'Add Return actions should use the shared 40px Manage-height contract')
assert.match(returnsSource, /className=\{manageToolbarButtonClassName\}/, 'Returns secondary toolbar actions should use the shared 40px Manage-height contract')
assert.match(returnsSource, /tr\('return', 'Return'\)\.replace\(\/\^ការ\/u, ''\)/, 'visible Khmer Return action should drop only the redundant nominal prefix')
assert.match(returnsSource, /aria-label=\{tr\('add_return', 'Add Return'\)\}/, 'the compact Add Return copy should retain its full accessible label')

const filterSectionsStart = returnsSource.indexOf('const filterSections = useMemo')
const filterSectionsEnd = returnsSource.indexOf('const activeFilterCount', filterSectionsStart)
const filterSectionsSource = returnsSource.slice(filterSectionsStart, filterSectionsEnd)
assert.match(filterSectionsSource, /id: 'sort'/, 'arrange-by choices should live inside Filters')
assert.doesNotMatch(returnsSource, /<SortChip\b/, 'Returns should not reserve separate toolbar width for arrange-by')
assert.match(returnsSource, /className="min-w-0 flex-1"[\s\S]*?placeholder=\{tr\('search_returns_placeholder'/, 'Search should explicitly occupy the width freed by arrange-by')

assert.match(returnsSource, /const buildReturnSections = useCallback/, 'Returns should use one business-day section builder for every arrangement')
assert.doesNotMatch(returnsSource, /id: 'sorted'/, 'non-date arrangements must not replace business-day headings with a synthetic all-results section')
assert.match(returnsSource, /fmtTime=\{fmtClock24\}/, 'grouped return rows should receive the 24-hour time-only formatter')
assert.match(returnsSurfaceSource, /tr\('time', 'Time'\)/, 'the desktop grouped row column should be labelled Time, not Date')
assert.doesNotMatch(returnsSurfaceSource, /text-blue-600 dark:text-blue-400[^\n]*ret\.receipt_number/, 'receipt references should not use link-like blue styling')

const primaryMetaAt = returnsSurfaceSource.indexOf('data-return-primary-meta')
const secondaryMetaAt = returnsSurfaceSource.indexOf('data-return-secondary-meta')
assert.ok(primaryMetaAt >= 0 && secondaryMetaAt > primaryMetaAt, 'mobile returns should have a compact primary row followed by one metadata row')
const primaryMeta = returnsSurfaceSource.slice(primaryMetaAt, secondaryMetaAt)
assert.ok(primaryMeta.indexOf('ret.return_number') < primaryMeta.indexOf('ret.receipt_number'), 'mobile primary row should start with return ID then receipt reference')
assert.ok(primaryMeta.indexOf('ret.receipt_number') < primaryMeta.indexOf('fmtTime(ret.created_at)'), 'mobile primary row should put 24-hour time after the receipt reference')
const secondaryMeta = returnsSurfaceSource.slice(secondaryMetaAt, secondaryMetaAt + 2200)
const cashierAt = secondaryMeta.indexOf("tr('cashier'")
const branchAt = secondaryMeta.indexOf("tr('branch'")
const customerAt = secondaryMeta.indexOf("tr('customer'")
const reasonAt = secondaryMeta.indexOf("tr('reason'")
assert.ok(cashierAt >= 0 && cashierAt < branchAt && branchAt < customerAt && customerAt < reasonAt, 'mobile metadata should stay Cashier, Branch, Customer, Reason')

const pagerMatches = returnsSource.match(/<PaginationControls[\s\S]*?rangeAsPageSize/g) || []
assert.equal(pagerMatches.length, 2, 'Returns should render the labeled shared pager above and below the list')
const topPagerAt = returnsSource.indexOf('<PaginationControls', returnsSource.indexOf('id="returns-search"'))
const listAt = returnsSource.indexOf('<ReturnsListSurface', topPagerAt)
assert.ok(topPagerAt >= 0 && topPagerAt < listAt, 'the first pager should sit directly below filters and before the list')

const detailHeaderAt = returnDetailSource.indexOf('data-return-detail-header')
const detailBodyAt = returnDetailSource.indexOf('className="modal-scroll', detailHeaderAt)
const detailHeader = returnDetailSource.slice(detailHeaderAt, detailBodyAt)
assert.match(detailHeader, /flex items-start justify-between/, 'return ID and window controls should share one header row at every width')
assert.doesNotMatch(detailHeader, /flex-col/, 'the close action must never be pushed onto a second header row')
assert.ok(detailHeader.indexOf('<CopyableId') < detailHeader.indexOf('<MinimizeButton') && detailHeader.indexOf('<MinimizeButton') < detailHeader.indexOf('aria-label={tr(\'close\''), 'header order should be receipt, minimize, close')
assert.match(returnsSource, /minimizeWork\(\{[\s\S]*?kind: 'return_detail'[\s\S]*?setDetailRet\(null\)/, 'minimize should park a reachable return-detail tray entry before closing the float')
assert.match(returnDetailSource, /value=\{ret\.receipt_number\}[\s\S]*?text-gray-800 dark:text-gray-200/, 'original receipt should use plain copyable text styling')
assert.doesNotMatch(returnDetailSource, /value=\{ret\.receipt_number\}[\s\S]{0,300}text-blue-600/, 'original receipt should not look like a link')

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
