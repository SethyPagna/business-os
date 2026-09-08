import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

function source(file: string): string {
  return readFileSync(new URL(`../src/components/contacts/${file}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
}

function loadSummary(): React.ComponentType<Record<string, unknown>> {
  const compiled = transformSync(source('InvoiceLedgerSummary.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', compiled)((id: string) => require(id), mod, mod.exports)
  return mod.exports.default as React.ComponentType<Record<string, unknown>>
}

const Summary = loadSummary()
const html = renderToStaticMarkup(React.createElement(Summary, {
  ariaLabel: 'Invoice summary',
  items: [
    { key: 'count', label: 'Invoices', value: '12' },
    { key: 'paid', label: 'Paid', value: '$90.00' },
    { key: 'owed', label: 'Owed (2)', value: '$30.00' },
  ],
  total: { key: 'total', label: 'Total billed', value: '$120.00' },
}))

assert.match(html, /<section[^>]*aria-label="Invoice summary"[^>]*data-invoice-ledger-summary="true"/)
assert.equal((html.match(/<dt/g) || []).length, 4, 'all labels use description-list terms')
assert.equal((html.match(/<dd/g) || []).length, 4, 'all values use description-list descriptions')
assert.ok(html.indexOf('Invoices') < html.indexOf('Paid') && html.indexOf('Paid') < html.indexOf('Owed (2)'))
assert.ok(html.indexOf('Owed (2)') < html.indexOf('Total billed'), 'the ruled total follows the compact facts')
assert.match(html, /border-t[^"<]*border-gray-200[^"<]*pt-2/, 'the final total has a visible report rule')
assert.ok((html.match(/tabular-nums/g) || []).length >= 2, 'summary facts and total align numeric glyphs')
for (const value of ['12', '$90.00', '$30.00', '$120.00']) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.equal((html.match(new RegExp(`>${escaped}<`, 'g')) || []).length, 1, `${value} renders once without presentation-side recomputation`)
}
console.log('PASS shared invoice summary renders a compact report hierarchy with one ruled total')

const sections = [
  ['ArInvoicesSection.tsx', '820'],
  ['ApInvoicesSection.tsx', '980'],
  ['StockInInvoicesSection.tsx', '860'],
] as const

for (const [file, minimumWidth] of sections) {
  const text = source(file)
  assert.match(text, /import InvoiceLedgerSummary from '\.\/InvoiceLedgerSummary\.tsx'/, `${file}: uses the shared hierarchy`)
  assert.equal((text.match(/<InvoiceLedgerSummary/g) || []).length, 1, `${file}: renders one summary below its filters`)
  assert.match(text, /pl-\[calc\(0\.75rem\+env\(safe-area-inset-left\)\)\]/, `${file}: keeps a 12px plus safe-area left gutter`)
  assert.match(text, /pr-\[calc\(0\.75rem\+env\(safe-area-inset-right\)\)\]/, `${file}: keeps a 12px plus safe-area right gutter`)
  assert.match(text, /data-invoice-ledger-scroll className="[^"]*max-w-full[^"]*overflow-x-auto[^"]*overscroll-x-contain/, `${file}: wide rows scroll inside their section`)
  assert.match(text, new RegExp(`min-w-\\[${minimumWidth}px\\][^\"]*tabular-nums`), `${file}: retains its full table width and tabular values`)
  assert.doesNotMatch(text, /grid grid-cols-2 gap-2 sm:grid-cols-4/, `${file}: removes the four disconnected stat cards`)
}
console.log('PASS all three ledgers use safe mobile gutters and contained dense tables')

const ar = source('ArInvoicesSection.tsx')
const arHeader = ar.slice(ar.indexOf('<thead'), ar.indexOf('</thead>'))
assert.ok(arHeader.indexOf("tr('invoice_date'") < arHeader.indexOf("tr('customer', 'Customer')"))
assert.ok(arHeader.indexOf("tr('customer', 'Customer')") < arHeader.indexOf("tr('invoice_no'"))
assert.ok(arHeader.indexOf("tr('invoice_no'") < arHeader.indexOf("tr('total', 'Total')"), 'AR date, customer, and invoice ID precede money')
assert.match(ar, /<time dateTime=\{row\.invoice_date\}>\{fmtDate\(row\.invoice_date\)\}<\/time>/)
assert.match(ar, /label: tr\('paid'[\s\S]*value: money\(totals\.paid_usd\)/)
assert.match(ar, /label: tr\('ar_total_billed'[\s\S]*value: money\(totals\.total_usd\)/)

const ap = source('ApInvoicesSection.tsx')
const apHeader = ap.slice(ap.indexOf('<thead'), ap.indexOf('</thead>'))
assert.ok(apHeader.indexOf("tr('invoice_date'") < apHeader.indexOf("tr('supplier', 'Supplier')"))
assert.ok(apHeader.indexOf("tr('supplier', 'Supplier')") < apHeader.indexOf("tr('invoice_no'"))
assert.ok(apHeader.indexOf("tr('invoice_no'") < apHeader.indexOf("tr('ap_taxable'"), 'AP date, supplier, and invoice ID precede money')
assert.match(ap, /<time dateTime=\{row\.invoice_date\}>\{fmtDate\(row\.invoice_date\)\}<\/time>/)
assert.match(ap, /row\.due_date \? <time dateTime=\{row\.due_date\}>/)
assert.match(ap, /label: tr\('ap_total_billed'[\s\S]*value: money\(totals\.total_usd\)/)

const stockIn = source('StockInInvoicesSection.tsx')
assert.doesNotMatch(stockIn, /invoice_no/, 'Stock-In does not invent a historical invoice number')
assert.match(stockIn, /<time dateTime=\{group\.received_day\}>\{fmtDateOnly\(group\.received_day\)\}<\/time>/)
assert.match(stockIn, /supplierLabel\(group\)/)
assert.match(stockIn, /label: tr\('purchase_cost'[\s\S]*value: money\(totals\.cost_usd\)/)
assert.match(stockIn, /aria-expanded=\{Boolean\(linesState\)\}/, 'existing expandable group accessibility remains')
console.log('PASS invoice dates and IDs remain truthful and existing API totals are only formatted')
