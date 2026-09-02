import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  cogsSheetRows,
  definitionsSheetRows,
  expensesSheetRows,
  reconciliationSheetRows,
  returnsSheetRows,
  salesSheetRows,
  summarySheetRows,
} from '../src/components/sales/businessWorkbookExport.ts'
import { buildWorksheet } from '../src/utils/xlsxExport.ts'

// Section 5 (Sep 2 2026 RC): unit coverage for the "Business summary"
// workbook's pure row-shaping layer (businessWorkbookExport.ts) and the
// new multi-sheet writer (xlsxExport.ts's downloadWorkbook). The network-
// fetching half of businessWorkbookExport.ts (collectAllPages /
// exportBusinessWorkbook itself) isn't exercised here -- it's a thin loop
// over api/reportsTransport.ts, whose own snapshot/cursor contract is
// pinned server-side by cloudflare/scripts/test-business-workbook-pure.cjs
// and, for the identical loop shape, by ExportModal.tsx's already-shipped
// CSV export. What matters most for THIS export -- the admin cost/profit
// gating never leaking a column into a non-admin file -- is fully covered
// below at the exact layer (salesSheetRows/cogsSheetRows) that decides it.

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

await runTest('summarySheetRows carries exactly the brief\'s Summary field list, no cost/profit columns ever', () => {
  const rows = summarySheetRows([{
    date: '2026-08-20', sales_count: 3, gross_sales_usd: 150, store_discount_usd: 10, membership_discount_usd: 0,
    discount_usd: 10, tax_usd: 5, delivery_usd: 2, refund_usd: 1, net_revenue_usd: 140, pending_revenue_usd: 0,
    collected_total_usd: 145, cost_usd: 50, gross_profit_usd: 90, margin_pct: 64.29, cost_missing_snapshot_lines: 1,
  }])
  const row = rows[0]
  assert.deepEqual(Object.keys(row), [
    'Date', 'Sales_Count', 'Gross_Sales_USD', 'Store_Discount_USD', 'Membership_Discount_USD',
    'Discount_USD', 'Tax_USD', 'Delivery_USD', 'Refund_USD', 'Net_Revenue_USD', 'Pending_Credit_USD', 'Collected_Total_USD',
  ])
  assert.ok(!('Cost_USD' in row) && !('Gross_Profit_USD' in row), 'Summary sheet never carries COGS columns -- those live in the separate admin-only sheet')
})

await runTest('cogsSheetRows shapes the admin-only per-day COGS/margin sheet', () => {
  const rows = cogsSheetRows([{
    date: '2026-08-20', net_revenue_usd: 140, cost_usd: 50, gross_profit_usd: 90, margin_pct: 64.29, cost_missing_snapshot_lines: 1,
  }])
  assert.deepEqual(rows[0], {
    Date: '2026-08-20', Net_Revenue_USD: 140, Cost_USD: 50, Gross_Profit_USD: 90, Margin_Pct: 64.29, Cost_Missing_Snapshot_Lines: 1,
  })
})

await runTest('salesSheetRows: admin row with cost data gets Cost_USD/Gross_Profit_USD/Cost_Missing_Snapshot_Lines', () => {
  const source = {
    receipt_number: '20260820-050000', date: '2026-08-20 05:00:00', business_date: '2026-08-20', branch: 'shop',
    cashier: 'Za', customer: 'Sok', customer_phone: '012345678', payment_method: 'cash', status: 'completed',
    gross_sales_usd: 100, store_discount_usd: 10, membership_discount_usd: 0, tax_usd: 5, delivery_usd: 0,
    refund_usd: 0, net_revenue_usd: 90, pending_revenue_usd: 0, collected_total_usd: 95,
    cost_usd: 30, gross_profit_usd: 60, cost_missing_snapshot_lines: 0,
  }
  const [row] = salesSheetRows([source], true)
  assert.equal(row.Cost_USD, 30)
  assert.equal(row.Gross_Profit_USD, 60)
  assert.equal(row.Cost_Missing_Snapshot_Lines, 0)
})

await runTest('salesSheetRows: non-admin row (server sent no cost_usd key at all) has NO cost/profit keys -- not blanked, genuinely absent', () => {
  const source = {
    receipt_number: '20260820-050000', date: '2026-08-20 05:00:00', business_date: '2026-08-20', branch: 'shop',
    cashier: 'Za', customer: 'Sok', customer_phone: '012345678', payment_method: 'cash', status: 'completed',
    gross_sales_usd: 100, store_discount_usd: 10, membership_discount_usd: 0, tax_usd: 5, delivery_usd: 0,
    refund_usd: 0, net_revenue_usd: 90, pending_revenue_usd: 0, collected_total_usd: 95,
    // no cost_usd / gross_profit_usd / cost_missing_snapshot_lines keys at all --
    // exactly what routes/reports.ts's buildSaleReportRow produces for isAdmin=false.
  }
  const [row] = salesSheetRows([source], false)
  assert.ok(!('Cost_USD' in row) && !('Gross_Profit_USD' in row) && !('Cost_Missing_Snapshot_Lines' in row))
})

await runTest('salesSheetRows: isAdmin=true but source has no cost_usd key (defensive -- must not fabricate a 0 column)', () => {
  const source = {
    receipt_number: '1', date: '2026-08-20', business_date: '2026-08-20', branch: '', cashier: '', customer: '',
    customer_phone: '', payment_method: 'cash', status: 'completed', gross_sales_usd: 10, store_discount_usd: 0,
    membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, net_revenue_usd: 10, pending_revenue_usd: 0,
    collected_total_usd: 10,
  }
  const [row] = salesSheetRows([source], true)
  assert.ok(!('Cost_USD' in row), 'isAdmin=true alone must not add cost columns when the underlying data never carried them')
})

await runTest('returnsSheetRows: Counts_Toward_Revenue reflects scope+status (Yes only for customer-scope, non-cancelled)', () => {
  const rows = returnsSheetRows([
    { return_number: 'R1', date: 'd', business_date: 'd', sale_receipt_number: 's', party: 'Sok', scope: 'customer', type: 'refund', reason: '', status: 'completed', refund_usd: 10, refund_khr: 0, counts_toward_revenue: 1 },
    { return_number: 'R2', date: 'd', business_date: 'd', sale_receipt_number: 's', party: 'Acme', scope: 'supplier', type: 'refund', reason: '', status: 'completed', refund_usd: 5, refund_khr: 0, counts_toward_revenue: 0 },
    { return_number: 'R3', date: 'd', business_date: 'd', sale_receipt_number: 's', party: 'Sok', scope: 'customer', type: 'refund', reason: '', status: 'cancelled', refund_usd: 99, refund_khr: 0, counts_toward_revenue: 0 },
  ])
  assert.equal(rows[0].Counts_Toward_Revenue, 'Yes')
  assert.equal(rows[1].Counts_Toward_Revenue, 'No')
  assert.equal(rows[2].Counts_Toward_Revenue, 'No')
})

await runTest('expensesSheetRows shapes date/type/label/amount fields', () => {
  const [row] = expensesSheetRows([{ date: '2026-08-20', created_at: '2026-08-20 09:00:00', type: 'rent', label: 'Shop rent', branch: 'shop', linked_sale_receipt_number: '', notes: 'Aug rent', amount_usd: 200, amount_khr: 0 }])
  assert.equal(row.Date, '2026-08-20')
  assert.equal(row.Type, 'rent')
  assert.equal(row.Label, 'Shop rent')
  assert.equal(row.Amount_USD, 200)
})

await runTest('reconciliationSheetRows: one uniform row shape across day / month-subtotal / grand-total blocks', () => {
  const rows = reconciliationSheetRows(
    [{ date: '2026-08-20', net_revenue_usd: 140, expenses_usd: 50, reconciliation_usd: 90 }],
    [{ month: '2026-08', net_revenue_usd: 140, expenses_usd: 50, reconciliation_usd: 90 }],
    { net_revenue_usd: 140, expenses_usd: 50, reconciliation_usd: 90 },
  )
  assert.equal(rows.length, 3)
  assert.equal(rows[0].Row_Type, 'Day')
  assert.equal(rows[0].Period, '2026-08-20')
  assert.equal(rows[1].Row_Type, 'Month subtotal')
  assert.equal(rows[1].Period, '2026-08')
  assert.equal(rows[2].Row_Type, 'Grand total')
  assert.equal(rows[2].Reconciliation_USD, 90)
  // Every row shares the exact same key set -- required for buildWorksheet's
  // "headers come from rows[0]" contract to render every row's data, not
  // just the first block's.
  const keySets = rows.map((r) => Object.keys(r).join(','))
  assert.ok(keySets.every((k) => k === keySets[0]), 'Day / Month subtotal / Grand total rows must share identical column keys')
})

await runTest('definitionsSheetRows includes COGS/profit terms only for admin, and the frozen-header-rows caveat always', () => {
  const adminRows = definitionsSheetRows({ startDate: '2026-08-01', endDate: '2026-08-31' }, true)
  const nonAdminRows = definitionsSheetRows({ startDate: '2026-08-01', endDate: '2026-08-31' }, false)
  const terms = (rows: Record<string, unknown>[]) => rows.map((r) => r.Term)
  assert.ok(terms(adminRows).includes('Cost (COGS)'))
  assert.ok(terms(adminRows).includes('Gross profit / Margin %'))
  assert.ok(!terms(nonAdminRows).includes('Cost (COGS)'), 'non-admin Definitions sheet must not even describe the COGS formula')
  assert.ok(terms(adminRows).includes('Frozen header rows') && terms(nonAdminRows).includes('Frozen header rows'), 'the frozen-header-rows limitation is documented for every export, admin or not')
})

await runTest('downloadWorkbook (xlsxExport.ts) builds one worksheet per named sheet, sanitizing Excel-illegal sheet names', () => {
  // buildWorksheet already has its own test coverage elsewhere in this repo's
  // suite (implicitly, via every existing xlsx export) -- what's new here is
  // downloadWorkbook's multi-sheet loop + safeSheetName, so this asserts the
  // XLSX.utils.book_new()/book_append_sheet() call shape directly via the
  // source (no jsdom Blob download harness needed for a shape check) plus a
  // real buildWorksheet call for each sheet's own correctness.
  const source = fs.readFileSync(new URL('../src/utils/xlsxExport.ts', import.meta.url), 'utf8')
  assert.match(source, /export function downloadWorkbook\(filename: string, sheets: WorkbookSheet\[\]\)/)
  assert.match(source, /XLSX\.utils\.book_append_sheet\(workbook, worksheet, safeSheetName\(sheet\.name, usedNames\)\)/)
  assert.match(source, /function safeSheetName\(/, 'a sheet-name sanitizer exists')
  assert.match(source, /\.slice\(0, 31\)/, 'sheet names are capped at Excel\'s 31-char limit')
  assert.match(source, /usedNames\.add\(/, 'duplicate sheet names are disambiguated, not silently overwritten')

  // buildWorksheet itself, exercised directly for one of this workbook's
  // sheets, to prove the per-sheet rows really do turn into real cells.
  // (downloadWorkbook's own XLSX.write()+download path needs a DOM --
  // document.createElement('a') -- so it isn't invoked here; that's the
  // same reason no existing test in this suite calls downloadXLSX/
  // downloadCSV directly either, per csvImport.test.ts/exportOptions.test.ts.)
  const worksheet = buildWorksheet([{ Date: '2026-08-20', Net_Revenue_USD: 140 }])
  assert.equal(worksheet.A1?.v, 'Date')
  assert.equal(worksheet.B1?.v, 'Net_Revenue_USD')
  assert.equal(worksheet.A2?.v, '2026-08-20')
  assert.equal(worksheet.B2?.v, 140)
})

await runTest('routes/reports.ts source-lock: the /business-summary aggregate always returns an is_admin flag (the field businessWorkbookExport.ts trusts as its single source of truth)', () => {
  const source = fs.readFileSync(new URL('../../cloudflare/src/routes/reports.ts', import.meta.url), 'utf8')
  assert.match(source, /is_admin:\s*isAdmin,/)
  const clientSource = fs.readFileSync(new URL('../src/components/sales/businessWorkbookExport.ts', import.meta.url), 'utf8')
  assert.match(clientSource, /const isAdmin = !!summaryResp\?\.is_admin/, 'the client must read the server\'s is_admin flag, not re-derive admin-ness from the logged-in user object')
})

if (failed > 0) {
  process.exitCode = 1
}
