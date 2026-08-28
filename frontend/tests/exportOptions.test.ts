// H1+X5 (Part 401): the shared export machinery -- projection, labels,
// remembered columns, and the print/PDF document builder.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildPrintDocument,
  exportColumnLabel,
  loadRememberedColumns,
  projectExportRows,
  type ExportColumn,
} from '../src/utils/exportOptions.ts'

let passed = 0
function ok(label: string) {
  passed += 1
  console.log(`PASS ${label}`)
}

const columns: ExportColumn[] = [
  { key: 'receipt_number', label: 'Receipt Number' },
  { key: 'delivery_actual_cost_usd', label: 'Delivery Actual Cost USD' },
  { key: 'notes', label: 'Notes' },
]
const rows = [
  { receipt_number: 'R-1', delivery_actual_cost_usd: 1.5, notes: 'a & b', secret: 'never' },
  { receipt_number: 'R-2', delivery_actual_cost_usd: '', notes: null },
]

{
  const projected = projectExportRows(rows, columns, new Set(['notes', 'receipt_number']))
  assert.deepEqual(Object.keys(projected[0]), ['Receipt Number', 'Notes'],
    'projection keeps the COLUMN order, not the selection order')
  assert.ok(!('secret' in projected[0]) && !('Delivery Actual Cost USD' in projected[0]),
    'unticked and unknown fields never leak into the file')
  assert.equal(projected[1].Notes, '', 'null exports as blank, not "null"')
  ok('projection keeps order, drops unticked columns, blanks nulls')
}

{
  assert.equal(exportColumnLabel('delivery_actual_cost_usd'), 'Delivery Actual Cost USD')
  assert.equal(exportColumnLabel('amount_paid_khr'), 'Amount Paid KHR')
  ok('labels humanize snake_case and uppercase currency suffixes')
}

{
  // No localStorage in plain node -- the loader must fail SOFT (null =
  // use defaults), because browsers can block storage too.
  assert.equal(loadRememberedColumns('sales', columns), null)
  ok('remembered-columns read fails soft without storage')
}

{
  const html = buildPrintDocument({
    title: 'Sales <export>',
    subtitle: '2 records',
    headers: ['Receipt Number', 'Notes'],
    rows: projectExportRows(rows, columns, new Set(['receipt_number', 'notes'])),
  })
  assert.ok(html.includes('Sales &lt;export&gt;'), 'title is HTML-escaped')
  assert.ok(html.includes('a &amp; b'), 'cell values are HTML-escaped')
  assert.ok(html.includes('<th>Receipt Number</th>') && html.includes('<th>Notes</th>'), 'headers render')
  assert.ok(html.includes('window.print()'), 'the document prints itself (save-as-PDF path)')
  assert.ok(html.includes('display: table-header-group'), 'table headers repeat across printed pages')
  assert.ok(/Noto Sans Khmer|Khmer OS/.test(html), 'Khmer system fonts are in the stack')
  ok('print document: escaping, headers, auto-print, Khmer fonts')
}

{
  // C4 wiring pin: the sales contract now carries the staff-only actual
  // delivery cost columns, and the Sales page feeds the dialog from that
  // exact contract.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const contract = readFileSync(path.join(here, '..', 'src', 'utils', 'salesImportContract.ts'), 'utf8')
  assert.ok(contract.includes("'delivery_actual_cost_usd', 'delivery_actual_cost_khr'"),
    'sales contract carries the C4 columns')
  const sales = readFileSync(path.join(here, '..', 'src', 'components', 'sales', 'Sales.tsx'), 'utf8')
  assert.ok(/SALES_IMPORT_COLUMNS\.map\(\(key\) => \(\{ key, label: exportColumnLabel\(key\) \}\)\)/.test(sales),
    'Sales feeds the dialog from the contract, so chooser and file can never disagree')
  assert.ok(!/downloadXLSX\(`\$\{filePrefix\}/.test(sales), 'the old fixed-column direct download is gone')
  ok('C4 columns present; Sales export routes through the options dialog')
}

console.log(`\nexportOptions tests passed (${passed})`)
