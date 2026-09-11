import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const salesSurface = readFileSync(new URL('../src/components/sales/SalesListSurface.tsx', import.meta.url), 'utf8')
const statusBadge = readFileSync(new URL('../src/components/sales/StatusBadge.tsx', import.meta.url), 'utf8')
const salesPage = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const reports = readFileSync(new URL('../src/components/sales/ReportsHub.tsx', import.meta.url), 'utf8')
const contactsShared = readFileSync(new URL('../src/components/contacts/shared.tsx', import.meta.url), 'utf8')
const customers = readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
const suppliers = readFileSync(new URL('../src/components/contacts/SuppliersTab.tsx', import.meta.url), 'utf8')
const delivery = readFileSync(new URL('../src/components/contacts/DeliveryTab.tsx', import.meta.url), 'utf8')
const promotions = readFileSync(new URL('../src/components/promotions/PromotionsPage.tsx', import.meta.url), 'utf8')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

// N23: the surface key and the column list moved into salesListColumns.ts, and
// the key was bumped once so a preference written before the Driver column
// existed stops hiding it (tests/salesDriverColumn.test.ts owns that
// behavior). What this file pins is unchanged: the columns are read through
// the shared preference hook rather than hand-rolled on this surface.
assert.match(salesSurface, /useColumnPreferences\(SALES_COLUMNS_SURFACE_KEY, SALES_OPTIONAL_COLUMNS\)/)
assert.match(salesSurface, /<ColumnChooser[\s\S]*columns=\{chooserColumns\}/)
assert.match(salesSurface, /cols\.isVisible\('cashier'\)/)
assert.match(salesSurface, /cols\.isVisible\('branch'\)/)
assert.match(detail, /modal-viewport-safe[\s\S]*modal-panel-safe/, 'sale detail must respect every iPhone safe-area edge')
// The sale detail's line items are a real table, and it is the SAME table at
// every width. This used to be two assertions -- a `min-w-[34rem]` table plus
// a separate `space-y-2 sm:hidden` phone card list -- and both were part of
// the shape the user called broken on Sep 3 2026: the 34rem floor starved the
// product column to 151px inside a per-cell horizontal scroll box at 1280,
// and the phone fork silently dropped the Qty and Unit price columns (and the
// unit KHR) that the desktop table showed. The invariant that mattered --
// "the phone must not be handed a wide desktop table that scrolls the page"
// -- is now met by the table wrapping its own scroll container and dropping
// the width floor, so it fits 375 with no scroll at all.
assert.match(detail, /<div className="overflow-x-auto">\s*<table className="w-full text-sm">/, 'sale detail items must be a table inside its own horizontal-scroll container')
assert.doesNotMatch(detail, /min-w-\[34rem\]/, 'the items table must not carry a width floor that starves the product column')
assert.doesNotMatch(detail, /data-sale-detail-mobile-items|space-y-2 sm:hidden/, 'the sale detail must not fork a phone-only item list that drops columns')
assert.match(detail, /data-sale-detail-mobile-contact=""[\s\S]*?sm:hidden/, 'the approved compact phone row is metadata, separate from the one shared items table')
assert.match(reports, /useState<DateTimeRange>\(\(\) => todayDateTimeRange\(\)\)/)
assert.match(salesSurface, /border-collapse text-xs/)
assert.match(salesSurface, /setDetailSale\(sale\)/)
assert.match(salesSurface, /flex flex-nowrap items-center justify-end/)
assert.match(salesSurface, /space-y-2 md:hidden/, 'sales mobile cards remain separate from the dense desktop table through tablet widths')

// U17 keeps translations as source data, but removes their decorative prefixes
// only in the compact status badge. Both English and Khmer retain plain text.
assert.match(statusBadge, /STATUS_DECORATION_PREFIX = \/\^\[⏳🚚↩️\\s\]\+\/u/)
assert.match(statusBadge, /getStatusBadgeLabel\(s, t\)/)
for (const translations of [en, km]) {
  for (const key of ['status_awaiting_payment', 'status_awaiting_delivery', 'status_partial_return', 'status_returned']) {
    const label = translations[key].replace(/^[⏳🚚↩️\s]+/u, '').trim()
    assert.ok(label.length > 0, `${key} has concise visible text`)
    assert.doesNotMatch(label, /^[⏳🚚↩️]/u, `${key} badge text omits its decorative icon`)
  }
}
assert.deepEqual(
  ['status_awaiting_payment', 'status_awaiting_delivery', 'status_partial_return', 'status_returned'].map((key) => en[key].replace(/^[⏳🚚↩️\s]+/u, '').trim()),
  ['Not Paid', 'Awaiting Delivery', 'Partial Return', 'Returned'],
  'English badges remove every current source prefix while retaining the requested Not Paid label',
)
assert.deepEqual(
  ['status_awaiting_payment', 'status_awaiting_delivery', 'status_partial_return', 'status_returned'].map((key) => km[key].replace(/^[⏳🚚↩️\s]+/u, '').trim()),
  ['ប្រាក់ជំពាក់', 'រង់ចាំការដឹកជញ្ជូន', 'ប្រគល់ខ្លះ', 'បានប្រគល់'],
  'Khmer badges remove every current source prefix while retaining concise translated status text',
)
assert.match(statusBadge, /awaiting_payment: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900\/40 dark:text-yellow-200'/)
assert.match(statusBadge, /awaiting_delivery: 'bg-blue-100 text-blue-800 dark:bg-blue-900\/40 dark:text-blue-200'/)
assert.match(statusBadge, /partial_return: 'bg-blue-100 text-blue-800 dark:bg-blue-900\/40 dark:text-blue-200'/)
assert.match(statusBadge, /returned: 'bg-blue-200 text-blue-900 dark:bg-blue-900\/60 dark:text-blue-100'/)

// The print action shares the narrow terminal column with the column chooser;
// mobile keeps its separate card layout below md.
assert.match(salesSurface, /const columnCount = 8 \+ cols\.visibleCount/)
assert.doesNotMatch(salesSurface, /t\('actions'\) \|\| 'Actions'/)
assert.match(salesSurface, /<th className="w-10 px-1 py-2 text-right">\s*<ColumnChooser className="hidden lg:inline-block"/)
assert.match(salesSurface, /<td className="w-10 px-1 py-1\.5 text-right"[\s\S]*?<Printer className="h-3\.5 w-3\.5"/)
assert.doesNotMatch(salesSurface, /<td className="hidden lg:table-cell"\s*\/>/, 'each rendered sale row has no orphan chooser cell after the print cell')
assert.doesNotMatch(salesPage, /CurrentShiftSummary/, 'the full current-shift block no longer occupies the space above sales stats')
assert.equal((salesPage.match(/<ShiftHistoryModal/g) || []).length, 1, 'the compact header exposes one Shift action')
assert.match(salesPage, /rangeActions=\{\([\s\S]*?<ShiftHistoryModal[\s\S]*?<SectionExportAction>/, 'Shift and export stay together in the responsive stats-header actions')

assert.match(contactsShared, /border-collapse text-xs/)
assert.match(contactsShared, /space-y-2 md:hidden/, 'contact mobile cards remain separate from the dense desktop table')
for (const source of [customers, suppliers, delivery]) {
  assert.match(source, /handleContactCellClick/, 'desktop contact cells keep click-to-detail behavior')
  assert.match(source, /px-3 py-1\.5/, 'desktop contact rows use the compact cell rhythm')
}

assert.equal((promotions.match(/hidden overflow-x-auto rounded-xl border border-slate-200/g) || []).length >= 2, true, 'rules and discounts each expose a desktop table')
assert.equal((promotions.match(/space-y-2 md:hidden/g) || []).length >= 2, true, 'promotion mobile cards remain responsive')
assert.match(promotions, /PR-\{row\.id\}/)
assert.match(promotions, /PD-\{String\(product\.id\)\}/)
assert.match(promotions, /onClick=\{\(\) => \{ if \(canManagePromotions\) openEditRule\(row\) \}\}/)

console.log('PASS dense Sales, Contacts, and Promotions desktop tables preserve mobile cards and detail actions')
assert.match(salesPage, /onRangeChange=\{setStripRange\}\s*showTime/, 'Sales retains its supported 24-hour date range controls')

assert.equal((salesPage.match(/<PaginationControls/g) || []).length, 2, 'Sales exposes a top and bottom labeled pager')
assert.match(salesPage, /range=\{stripRange\}[\s\S]*?onRangeChange=\{setStripRange\}/)
assert.doesNotMatch(salesPage, /translateOr\('sales_strip_period_scope'|translateOr\('sales_strip_choose_range'/)
assert.match(salesSurface, /data-copy-value=\{copyText\(children\)\}/, 'related sale metadata supports plain hold/keyboard copy')
assert.match(detail, /data-sale-detail-secondary-meta=""[^\n]*overflow-x-auto whitespace-nowrap/, 'long cashier/branch metadata cannot push header controls down')
assert.match(detail, /data-sale-line-qty=""/)
assert.match(detail, /data-sale-line-price=""/)
assert.match(detail, /data-sale-line-total=""/)
assert.match(detail, /batchDisplayLabel\([^\n]+, ''\)\.trim\(\)/, 'the compact supplier/date row omits the Received date label')
assert.match(detail, /id=\{`amend-qty-\$\{lineId\}`\}[^\n]*type="number"/)
assert.match(detail, /id=\{`amend-price-\$\{lineId\}`\}[^\n]*type="number"/)
assert.match(detail, /id=\{`amend-discount-\$\{lineId\}`\}[^\n]*type="number"/)
assert.match(detail, /if \(amendDiscountType !== type\) setAmendDiscountText\('0'\)/, 'switching %/$ resets the numeric value like POS instead of silently reinterpreting it')
assert.match(detail, /data-sale-actual-cost=""/)
const actualCost = detail.slice(detail.indexOf('data-sale-actual-cost=""'), detail.indexOf('{/* The note the cashier'))
assert.doesNotMatch(actualCost, /fmtKHR/)
assert.match(detail, /data-sale-status-recovery=""[^\n]*grid-cols-1/, 'narrow recovery message stays above its actions')
assert.match(detail, /saving=\{statusSaving\}/, 'only the active status mutation disables the workflow controls')
assert.doesNotMatch(detail, /saving=\{statusSaving \|\| pendingStatus\}/)
