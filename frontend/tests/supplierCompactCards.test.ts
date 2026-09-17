// P3 (owner): the supplier directory shows one compact card per persisted
// supplier -- real records, never a grouped section header rendered as an
// extra entry -- each card keyboard-reachable, with company and
// contact-person details kept in the detail modal instead of expanding
// every row.
//
// Sep 17 2026, superseded in ONE respect. This file used to assert that the
// cards took over at EVERY width, through SuppliersTab's cardsAtAllWidths
// opt-out. The owner rejected that: "supplier page/section still not using
// excel style for the suppliers in large screens". A large screen now gets
// the same wide table as Customers and Delivery, and these cards are the
// phone layout, exactly as on every other directory. The opt-out is gone
// from the shared component, and tests/contactDirectoryWideTable.test.ts
// pins that it stays gone. Everything else this file guards is unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const suppliers = fs.readFileSync(new URL('../src/components/contacts/SuppliersTab.tsx', import.meta.url), 'utf8')
const shared = fs.readFileSync(new URL('../src/components/contacts/shared.tsx', import.meta.url), 'utf8')

assert.match(suppliers, /rows=\{visibleSuppliers\}/, 'supplier directory renders real supplier records, not section pseudo-rows')
assert.doesNotMatch(suppliers, /rows=\{displayRows\}/, 'supplier directory must not render grouped header rows as extra cards')
assert.match(suppliers, /label: tr\('sort_by', 'Sort by'\)/, 'date/name choice remains an honest sort control after section headers are removed')
assert.match(suppliers, /key=\{supplier\.id\}[\s\S]*?role="button"[\s\S]*?tabIndex=\{0\}/, 'each persisted supplier id owns one keyboard reachable card')
assert.match(suppliers, /event\.target !== event\.currentTarget[\s\S]*?event\.key !== 'Enter'[\s\S]*?event\.key !== ' '/, 'card keyboard activation does not steal events from its selection checkbox')
assert.match(suppliers, /onClick=\{\(\) => handleContactCellClick\(supplier\)\}/, 'card click retains the existing detail-or-selection handler')
assert.doesNotMatch(suppliers, /cardMetaSecondary/, 'company and contact-person details stay in the detail modal instead of expanding every card')
assert.match(suppliers, /supplierId=\{selected\.id as number\}/, 'purchase drill remains keyed to the exact persisted supplier id')
assert.match(suppliers, /<SupplierInvoicesSection t=\{t\} \/>/, 'the separate supplier invoice ledger remains available')
assert.match(suppliers, /\[tr\('contact_options', 'Contact options'\), buildLocalizedSupplierContactOptionSummary\(options, tr\)\]/, 'supplier detail localizes its contact-options label and summary')
assert.match(suppliers, /rawLabel\.toLowerCase\(\) === 'default' \? tr\('default', 'Default'\) : rawLabel/, 'canonical Default is localized without translating user-defined option labels')
assert.match(suppliers, /<DetailModal[\s\S]*?wrapValuesAnywhere[\s\S]*?supplier_purchases/, 'only the supplier detail opts into unbroken-value wrapping')

assert.match(shared, /totalItems=\{totalItems\}/, 'server total continues to drive the shared pager')
assert.match(shared, /wrapValuesAnywhere \? 'min-w-0 \[overflow-wrap:anywhere\]' : ''/, 'opt-in detail values can shrink their grid track and wrap long unbroken text')

console.log('supplierCompactCards tests passed')
