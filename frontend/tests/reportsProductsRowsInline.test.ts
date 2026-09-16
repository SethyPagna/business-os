// The Products report shows COGS and gross profit IN every row, no click
// (owner: "the products report can also show the COGS and profit in the
// rows. no need click. Arrange as two columns, one row: sales, quantity,
// second row: line sales, third row cogs, fourth row profit. compact
// size."). Pins three things:
//   1. `productRowCells` (the pure formatter behind the card) never shows a
//      missing profit figure as 0 -- '—' only.
//   2. the desktop (excel) columns are Sales, Quantity, Line sales, COGS,
//      Gross profit in that order, and cost_usd is visible by default (no
//      click-to-reveal through the column chooser).
//   3. the receipt-style (small screen) card renders the owner's exact
//      four-row, two-column arrangement, wired into ReportTable via the
//      shared `cardBody` plumbing (ReportTable -> ReceiptSheet body).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { fmtInt, fmtQty, fmtPct, num } from '../src/components/sales/reports/reportModel.ts'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const source = read('src/components/sales/reports/GroupedReport.tsx')

// ---------------------------------------------------------------------------
// 1. productRowCells -- pure, extracted and evaluated for real behaviour.
// ---------------------------------------------------------------------------

const helperStart = source.indexOf('export function productRowCells')
const helperEnd = source.indexOf('/** The receipt-style Products card body')
assert.ok(helperStart > -1 && helperEnd > helperStart, 'productRowCells must exist ahead of the card renderer')
const helperSrc = source.slice(helperStart, helperEnd).replaceAll('export function', 'function').replaceAll('export interface', 'interface')
const productRowCells = new Function(
  'fmtInt', 'fmtQty', 'fmtPct', 'num',
  `${stripTypeScriptTypes(helperSrc)}\nreturn productRowCells;`,
)(fmtInt, fmtQty, fmtPct, num) as (row: Record<string, unknown>, fmtMoney: (usd: number) => string) => {
  sales: string; quantity: string; lineSales: string; cogs: string; profit: string; marginPct: string; hasProfit: boolean
}

const fmtMoney = (usd: number) => `$${usd.toFixed(2)}`

const withProfit = productRowCells(
  { product_id: 1, product_name: 'Widget', sale_count: 3, qty: 5, line_sales_usd: 50, cost_usd: 20, profit_usd: 30, margin_pct: 60 },
  fmtMoney,
)
assert.equal(withProfit.sales, fmtInt(3))
assert.equal(withProfit.quantity, fmtQty(5))
assert.equal(withProfit.lineSales, '$50.00')
assert.equal(withProfit.cogs, '$20.00')
assert.equal(withProfit.profit, '$30.00')
assert.equal(withProfit.marginPct, fmtPct(60))
assert.equal(withProfit.hasProfit, true)

const withoutProfit = productRowCells(
  { product_id: 2, product_name: 'Gadget', sale_count: 1, qty: 2, line_sales_usd: 10 },
  fmtMoney,
)
assert.equal(withoutProfit.hasProfit, false)
assert.equal(withoutProfit.cogs, '—', 'a row with no cost snapshot must read as missing, never as a $0.00 cost')
assert.equal(withoutProfit.profit, '—', 'a row with no profit figure must read as missing, never as $0.00 profit')
assert.equal(withoutProfit.marginPct, '—')
assert.notEqual(withoutProfit.cogs, fmtMoney(0), 'never a real-looking zero for a missing figure')
assert.notEqual(withoutProfit.profit, fmtMoney(0), 'never a real-looking zero for a missing figure')

// ---------------------------------------------------------------------------
// 2. Desktop columns: Sales, Quantity, Line sales, COGS, Gross profit, and
//    COGS visible by default (no defaultVisible: false on cost_usd).
// ---------------------------------------------------------------------------

const productsBranchStart = source.indexOf("if (by === 'product') {")
const productsBranchEnd = source.indexOf("if (by === 'courier') {")
assert.ok(productsBranchStart > -1 && productsBranchEnd > productsBranchStart, 'the products branch must exist')
const productsBranch = source.slice(productsBranchStart, productsBranchEnd)
const productsColumns = productsBranch.slice(0, productsBranch.indexOf('const csv = () => rowsToCsvObjects(csvColumnsFor(columns, fmtMoney), productRows)'))

const columnKeys = [...productsColumns.matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1])
const wantOrder = ['product_name', 'sale_count', 'qty', 'line_sales_usd', 'cost_usd', 'profit_usd', 'margin_pct', 'share']
assert.deepEqual(columnKeys, wantOrder, `product columns must read Sales, Quantity, Line sales, COGS, Gross profit (got ${columnKeys.join(', ')})`)

const costColumn = productsColumns.slice(productsColumns.indexOf("key: 'cost_usd'"), productsColumns.indexOf("key: 'profit_usd'"))
assert.doesNotMatch(costColumn, /defaultVisible:\s*false/, 'COGS must be visible by default, not hidden behind the column chooser')
assert.match(costColumn, /tr\('cogs',/, 'COGS column must use the shared cogs label key')

// ---------------------------------------------------------------------------
// 3. Receipt-style card: the owner's four-row, two-column arrangement, wired
//    through ReportTable's cardBody prop.
// ---------------------------------------------------------------------------

assert.match(productsBranch, /cardBody=\{\(row\) => renderProductCard\(row, tr, fmtMoney\)\}/, 'the products ReportTable must wire the compact card renderer')

const cardStart = source.indexOf('function renderProductCard')
const cardEnd = source.indexOf('export interface CourierRow')
assert.ok(cardStart > -1 && cardEnd > cardStart, 'renderProductCard must exist')
const card = source.slice(cardStart, cardEnd)

assert.match(card, /grid-cols-2/, 'the card is a two-column grid')
const idxSales = card.indexOf("tr('sales'")
const idxQty = card.indexOf("tr('quantity'")
const idxBorder = card.indexOf('border-t')
const idxLineSales = card.indexOf("tr('rpt_line_sales'")
const idxCogs = card.indexOf("tr('cogs'")
const idxProfit = card.indexOf("tr('rpt_gross_profit'")
for (const [label, idx] of [['sales', idxSales], ['quantity', idxQty], ['border rule', idxBorder], ['line sales', idxLineSales], ['cogs', idxCogs], ['gross profit', idxProfit]] as const) {
  assert.ok(idx > -1, `the card must render ${label}`)
}
assert.ok(idxSales < idxQty, 'row 1: Sales before Quantity')
assert.ok(idxQty < idxBorder, 'Sales/Quantity sit above the rule that opens row 2')
assert.ok(idxBorder < idxLineSales, 'row 2 (Line sales) starts at the rule')
assert.ok(idxLineSales < idxCogs, 'row 3 (COGS) follows Line sales')
assert.ok(idxCogs < idxProfit, 'row 4 (Gross profit) follows COGS')

// Rows 2-4 each span both grid columns (full-width ledger rows), never
// squeezed into the two-up tile row that Sales/Quantity use.
const fullWidthRows = card.match(/col-span-2/g) || []
assert.ok(fullWidthRows.length >= 3, 'Line sales, COGS and Gross profit must each span both columns')

// hasProfit gates COGS/Gross profit so a permission-denied or cost-missing
// row never renders a misleading pair of dashes as if they were real figures
// -- it simply omits the rows, matching the desktop's allProfit gate.
assert.match(card, /c\.hasProfit \?/, 'COGS/Gross profit rows must be gated on hasProfit')

// ---------------------------------------------------------------------------
// 4. Shared plumbing: ReportTable forwards cardBody into ReceiptSheet's body,
//    for both row and totals blocks, and ReceiptSheet renders it in place of
//    the standard line list.
// ---------------------------------------------------------------------------

const table = read('src/components/sales/reports/ReportTable.tsx')
assert.match(table, /cardBody\?\s*:\s*\(row: Row\) => ReactNode/, 'ReportTable must accept an optional cardBody override')
assert.match(table, /body:\s*cardBody \? cardBody\(row\) : undefined/, 'row cards must carry the custom body when supplied')
assert.match(table, /body:\s*cardBody \? cardBody\(totalsRow\) : undefined/, 'the totals card must carry the custom body too')

const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
assert.match(sheet, /body\?\s*:\s*ReactNode/, 'ReceiptBlock must declare the optional body override')
assert.match(sheet, /block\.body != null \?/, 'ReceiptSheet must render the custom body in place of the standard line list')

// ---------------------------------------------------------------------------
// 5. Every label the card and columns use exists in both language packs.
// ---------------------------------------------------------------------------

const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
for (const key of ['sales', 'quantity', 'rpt_line_sales', 'cogs', 'rpt_gross_profit', 'rpt_margin']) {
  assert.ok(en[key], `en.json is missing "${key}"`)
  assert.ok(km[key], `km.json is missing "${key}"`)
}

console.log('PASS reports products rows show COGS/profit inline, both styles, both packs')
