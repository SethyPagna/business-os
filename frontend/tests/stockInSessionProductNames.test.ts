import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
function renderColumns(source: string, canViewCosts: boolean): string {
  const code = ts.transpileModule(`module.exports = (${source})`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    fileName: 'session-columns.tsx',
  }).outputText
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', 'canViewCosts', code)(require, module, module.exports, canViewCosts)
  return renderToStaticMarkup(module.exports)
}

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
// The Add-products saved list (CreateProductsSessionModal) and the fast
// stock-in queue are one Items list now (UI-STOCK-2/3): StockSessionItems.
const itemsSource = readFileSync(new URL('../src/components/stock-session/StockSessionItems.tsx', import.meta.url), 'utf8')

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
  const colgroup = receipt.match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0]
  assert.ok(colgroup, 'receipt column sizing located')
  const granted = renderColumns(colgroup, true)
  const denied = renderColumns(colgroup, false)
  // N6: the last column holds two icon actions (Edit line, Remove), hence w-16.
  assert.equal(granted, '<colgroup><col/><col class="w-[7rem]"/><col class="w-[22%]"/><col class="w-[6rem]"/><col class="w-[7rem]"/><col class="w-16"/></colgroup>')
  assert.equal(denied, '<colgroup><col/><col class="w-[7rem]"/><col class="w-[22%]"/><col class="w-[6rem]"/><col class="w-16"/></colgroup>', 'no-view omits only the cost column; product remains flexible')
  assert.match(receipt, /\{canViewCosts \? <th[^>]*>\{tr\('cost_price', 'Cost price'\)\}<\/th> : null\}/)
  assert.match(receipt, /\{canViewCosts \? <td[^>]*>\{unitCost == null[^]*?<\/td> : null\}/)
})

runTest('the Stock Session Items list wraps the full name, never clipping it', () => {
  const start = itemsSource.indexOf('{line.productName}')
  assert.ok(start > 0, 'Items list located')
  const row = itemsSource.slice(itemsSource.lastIndexOf('<li ', start), itemsSource.indexOf('</li>', start))
  assert.doesNotMatch(row, CLIPPED_NAME)
  assert.match(row, /<span className="min-w-0 break-words[^"]*">\s*\{line\.productName\}/)
  assert.doesNotMatch(row, /min-w-0 truncate|line-clamp-1/)
})

const ledgerSource = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')

// One figure, one name, and one historical source. Stock Changes calls the
// action's movement snapshot "Cost price" like the receiving surfaces, but it
// must not silently substitute the current lot valuation when that snapshot
// was never recorded.
runTest('the Stock change detail names and sources historical movement cost honestly', () => {
  assert.match(ledgerSource, /tr\(t, 'cost_price', 'Cost price'\)/)
  assert.match(ledgerSource, /recordedCostLabel\(detailCosts\?\.unitUsd/)
  assert.match(ledgerSource, /tr\(t, 'not_recorded', 'Not recorded'\)/)
  const detailStart = ledgerSource.indexOf('{detail ? (')
  const detailEnd = ledgerSource.indexOf('{adjustType ? (', detailStart)
  const detail = ledgerSource.slice(detailStart, detailEnd)
  assert.doesNotMatch(detail, /batch_unit_cost_usd|batch_received_cost_usd/)
  assert.doesNotMatch(ledgerSource, /tr\(t, 'unit_cost', 'Unit cost'\)/)
  // and the surfaces it now agrees with, so the pair cannot drift apart again
  assert.match(sectionSource, /tr\('cost_price', 'Cost price'\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
