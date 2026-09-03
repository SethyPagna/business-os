import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const salesSurface = readFileSync(new URL('../src/components/sales/SalesListSurface.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const reports = readFileSync(new URL('../src/components/sales/ReportsHub.tsx', import.meta.url), 'utf8')
const contactsShared = readFileSync(new URL('../src/components/contacts/shared.tsx', import.meta.url), 'utf8')
const customers = readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
const suppliers = readFileSync(new URL('../src/components/contacts/SuppliersTab.tsx', import.meta.url), 'utf8')
const delivery = readFileSync(new URL('../src/components/contacts/DeliveryTab.tsx', import.meta.url), 'utf8')
const promotions = readFileSync(new URL('../src/components/promotions/PromotionsPage.tsx', import.meta.url), 'utf8')

assert.match(salesSurface, /useColumnPreferences\('sales', SALES_OPTIONAL_COLUMNS\)/)
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
assert.doesNotMatch(detail, /sm:hidden|md:hidden/, 'the sale detail must not fork a phone-only item list that drops columns')
assert.match(reports, /useState<DateTimeRange>\(\(\) => todayDateTimeRange\(\)\)/)
assert.match(salesSurface, /border-collapse text-xs/)
assert.match(salesSurface, /setDetailSale\(sale\)/)
assert.match(salesSurface, /flex flex-nowrap items-center justify-end/)
assert.match(salesSurface, /space-y-2 md:hidden/, 'sales mobile cards remain separate from the dense desktop table through tablet widths')

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
