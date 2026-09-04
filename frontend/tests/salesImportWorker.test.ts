import assert from 'node:assert/strict'
import fs from 'node:fs'
import { countCsvDataRows } from '../src/utils/csvRowCounter.ts'
import { buildSalesImportRows, SALES_IMPORT_COLUMNS } from '../src/utils/salesImportContract.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('shared CSV row counter handles sales rows and quoted notes', () => {
  assert.equal(countCsvDataRows('receipt,product,quantity\nR-1,Serum,1\nR-2,Toner,2'), 2)
  assert.equal(countCsvDataRows('receipt,notes\nR-1,"line 1\nline 2"\nR-2,ok'), 2)
  assert.equal(countCsvDataRows('receipt,product\n\n'), 0)
})

await runTest('sales import modal analyzes rows in a worker with a sync fallback', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.tsx', import.meta.url), 'utf8')
  const worker = fs.readFileSync(new URL('../src/components/sales/salesImportWorker.ts', import.meta.url), 'utf8')
  assert.match(source, /new Worker\(new URL\('\.\/salesImportWorker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(source, /typeof Worker === 'undefined'[\s\S]*Promise\.resolve\(countCsvDataRows\(text\)\)/)
  assert.match(source, /SALES_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000/)
  assert.match(source, /catch \(_\) \{[\s\S]*nextCount = countCsvDataRows\(nextText\)/)
  assert.match(source, /rowCountRequestRef/, 'stale worker results should not overwrite newer sales CSV text')
  assert.match(source, /disabled=\{loading \|\| analyzingCsv \|\| !String\(csvText \|\| ''\)\.trim\(\)\}/)
  assert.match(worker, /countCsvDataRows\(text\)/)
})

await runTest('sales import stays in-modal for authoritative Screen 2 review and confirmation', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /setReviewJob\(\{ id: job\.id as string \| number, rowCount \}\)/)
  assert.match(source, /<ServerImportReviewScreen/)
  assert.doesNotMatch(source, /Review and approve it from the top progress bar/)
})

await runTest('sales export is an import-compatible compact multi-item contract', () => {
  const rows = buildSalesImportRows([{
    receipt_number: 'R-100', created_at: '2026-08-28T07:30:00.000Z', sale_status: 'completed',
    customer_name: 'Dara', customer_phone: '012345678', discount_usd: 1, amount_paid_usd: 14,
    items: [
      { product_name: 'Widget', sku: 'SKU-1', quantity: 2, applied_price_usd: 5, cost_price_usd: 3 },
      { product_name: 'Gadget', sku: 'SKU-2', quantity: 1, applied_price_usd: 5, cost_price_usd: 2 },
    ],
  }])
  assert.equal(rows.length, 2)
  assert.deepEqual(Object.keys(rows[0]), [...SALES_IMPORT_COLUMNS], 'export columns stay in authoritative import order')
  assert.equal(rows[0].receipt_number, 'R-100')
  // Not the day-first display string, on purpose. This column is read back
  // by the importer (parseSalesImportDateTime), whose slash branch is
  // month-first forever, so the export ships unambiguous ISO instead --
  // same instant, same Cambodia wall time, same 24-hour clock. See
  // fmtBusinessIsoDateTime. The round trip itself is pinned in
  // cloudflare/scripts/test-sales-export-import-roundtrip-pure.cjs.
  assert.equal(rows[0].sale_date, '2026-08-28 14:30', 'UTC storage exports as Cambodia 24-hour wall time')
  assert.equal(rows[0].customer_phone, '012345678')
  assert.equal(rows[1].receipt_number, '', 'continuation line does not repeat invoice data')
  assert.equal(rows[1].customer_name, '', 'continuation line inherits customer from the first line')
  assert.equal(rows[1].sku, 'SKU-2')
  assert.equal(rows[1].cost_price_usd, 2, 'historical COGS snapshot survives export')
})

await runTest('template, modal, selected export, and report CSV share the same sales contract', () => {
  const modal = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.tsx', import.meta.url), 'utf8')
  const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const report = fs.readFileSync(new URL('../src/components/sales/ExportModal.tsx', import.meta.url), 'utf8')
  const methods = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  assert.match(modal, /SALES_TEMPLATE_COLUMNS_TEXT/)
  assert.match(sales, /buildSalesImportRows/)
  assert.match(report, /const headers = \[\.\.\.SALES_IMPORT_COLUMNS\]/)
  assert.doesNotMatch(report, /'SALES EXPORT REPORT'/, 'download must not contain a decorative preamble that breaks re-import')
  assert.match(methods, /SALES_IMPORT_EXAMPLE_ROWS/)
})

if (failed > 0) {
  process.exitCode = 1
}
