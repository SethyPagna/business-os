import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P10-15 -- owner: "the supplier display is not consistent like excel style
// in large screens".
//
// The Suppliers tab's directory (SuppliersTab -> shared.tsx's ContactTable)
// and its AP invoice ledger (ApInvoicesSection) both render the house
// Excel-style shape on large screens: a bordered <table> with a header row,
// hidden on phones (`hidden ... md:block`), with a card list taking over
// below `md`. The Stock-In Invoices ledger -- the literal sibling of
// ApInvoicesSection, switched by one chip in the same section -- used to be
// a bare stacked list of buttons at EVERY width, never a table. This pins
// that it now matches its sibling instead of drifting back to a bare list.

let failed = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

runTest('StockInInvoicesSection renders a real <table> with a header row on large screens', () => {
  const file = src('components/contacts/StockInInvoicesSection.tsx')
  // A desktop table block, hidden on phones, matching its AP sibling's split.
  assert.match(file, /hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200 dark:border-gray-700 md:block/)
  assert.match(file, /<table className="w-full min-w-\[860px\] text-left text-xs tabular-nums">/)
  assert.match(file, /<thead className="bg-gray-50 text-\[11px\] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">/)
  // The row-per-invoice body, still opening the same detail float on click.
  assert.match(file, /<tbody>\s*\{invoices\.map\(\(group\) => \{/)
  assert.match(file, /onClick=\{\(\) => openGroup\(group\)\}/)
  // The mobile card fallback survives, scoped to small screens only (it used
  // to be the ONLY rendering, at every width).
  assert.match(file, /<div className="space-y-2 md:hidden">/)
})

runTest('the Stock-In table and its AP sibling agree on header cell markup', () => {
  const stockIn = src('components/contacts/StockInInvoicesSection.tsx')
  const ap = src('components/contacts/ApInvoicesSection.tsx')
  const headerCell = /<th className="px-3 py-2">/
  assert.match(stockIn, headerCell)
  assert.match(ap, headerCell)
  const rightHeaderCell = /<th className="px-3 py-2 text-right">/
  assert.match(stockIn, rightHeaderCell)
  assert.match(ap, rightHeaderCell)
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} supplier-list excel-table test(s) failed`)
} else {
  console.log('\nAll supplier-list excel-table tests passed')
}
