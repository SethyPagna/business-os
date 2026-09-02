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
assert.match(detail, /<table className="w-full min-w-\[34rem\] text-sm">/)
assert.match(detail, /<div className="space-y-2 sm:hidden">/)
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
