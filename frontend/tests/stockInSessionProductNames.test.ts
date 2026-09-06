import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// N26 (2026-09-06): "stock in sessions when clicked on did not show the
// products full name, got cut by elipses."
//
// A product name is the one thing an operator reads a receipt line by. On the
// three stock-in surfaces that list product lines -- the Stock-in Sessions
// receipt, the Add-products session's saved list, and the fast stock-in queue
// -- the name renders in FULL: it wraps onto a second line instead of being
// clipped, the Product column is flexible rather than a fixed narrow share,
// and the barcode sits under the name in muted mono. Where a one-line label
// is unavoidable the shared TruncatedText reveals the full value; a dead-end
// "…" is never acceptable on a name.

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const sectionSource = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const createModalSource = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')
const fastModalSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')

// A span whose class list clips to one line, wrapping a product-name binding.
const CLIPPED_NAME = /className="[^"]*\b(?:truncate|dense-cell-truncate)\b[^"]*"[^>]*>[^<{]*\{(?:row\.product_name|row\.name|line\.productName)\}/
// The dense table's one-line class must never sit on the name itself.
const DENSE_TRUNCATED_NAME = /dense-cell-truncate[^>]*>\{row\.product_name\}/

runTest('the receipt shows the full product name, wrapped, with the barcode under it', () => {
  const receipt = sectionSource.slice(sectionSource.indexOf('<table className="dense-data-table min-w-[720px]">'), sectionSource.indexOf('<div className="mobile-cards-only space-y-1">'))
  assert.ok(receipt.length > 0, 'receipt table located')
  assert.doesNotMatch(receipt, CLIPPED_NAME)
  assert.doesNotMatch(receipt, DENSE_TRUNCATED_NAME)
  // the name wraps
  assert.match(receipt, /<span className="break-words font-semibold">\{row\.product_name\}<\/span>/)
  // no title tooltip standing in for text the cell should simply show
  assert.doesNotMatch(receipt, /title=\{row\.product_name\}/)
  // barcode under the name, muted mono
  assert.match(receipt, /<span className="block break-all dense-id text-gray-400">\{row\.barcode \|\| tr\('barcode_not_recorded', 'Barcode not recorded'\)\}<\/span>/)
  // ...and therefore no separate Barcode column stealing width from the name
  assert.doesNotMatch(receipt, /<th>\{tr\('barcode', 'Barcode'\)\}<\/th>/)
  // the Product column is the flexible one; fixed widths go to the numbers
  assert.match(receipt, /<colgroup><col \/><col className="w-\[7rem\]" \/><col className="w-\[22%\]" \/><col className="w-\[6rem\]" \/><col className="w-\[7rem\]" \/><col className="w-10" \/><\/colgroup>/)
})

runTest('the Add-products saved list wraps the name and puts the barcode under it', () => {
  const list = createModalSource.slice(createModalSource.indexOf('{rows.length ? <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">'), createModalSource.indexOf("tr('create_products_none_yet'"))
  assert.ok(list.length > 0, 'saved list located')
  assert.doesNotMatch(list, CLIPPED_NAME)
  assert.match(list, /<span className="block break-words">\{row\.status === 'saved' \? '✅' : '•'\} \{row\.name\}<\/span>/)
  assert.match(list, /\{row\.barcode \? <span className="block break-all dense-id text-\[10px\] text-gray-400">\{row\.barcode\}<\/span> : null\}/)
  // the meta line wraps too -- brand · supplier · branch · date · lot is
  // exactly the row an operator checks, not decoration to clip
  assert.match(list, /<span className="block break-words text-\[10px\] text-gray-500">/)
  assert.doesNotMatch(list, /block truncate/)
})

runTest('the fast stock-in queue wraps the name and shows the barcode under it', () => {
  const start = fastModalSource.indexOf('{received.map((line) => (')
  const queue = fastModalSource.slice(start, fastModalSource.indexOf('))}', start))
  assert.ok(start > 0 && queue.length > 0, 'queue located')
  assert.doesNotMatch(queue, CLIPPED_NAME)
  assert.match(queue, /<span className="block break-words">[^]*?\{line\.productName\}[^]*?<\/span>/)
  assert.match(queue, /\{line\.product\.barcode \? <span className="block break-all dense-id text-\[10px\] text-gray-400">\{line\.product\.barcode\}<\/span> : null\}/)
  assert.doesNotMatch(queue, /min-w-0 truncate/)
})

if (failed > 0) {
  process.exitCode = 1
}
