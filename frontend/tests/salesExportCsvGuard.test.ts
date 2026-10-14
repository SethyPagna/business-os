// The downloadable sales CSV (Sales -> Export) is opened in a spreadsheet, and its text cells carry customer names,
// notes, addresses and product names that anyone with a till login can type. A cell that starts with = + - @ (or a tab
// or carriage return) runs as a formula when the file is opened, so the export puts an apostrophe in front of it
// (escapeCsvValue). ExportModal.buildCsvFallback used to carry its own quote-only escape that left every such cell
// bare. The file also has to round-trip straight through Sales Import, so BOTH import parsers must read the guarded
// cell back as the value that was exported.
//
// Run (from frontend/): node tests/salesExportCsvGuard.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { buildSalesExportCsv, SALES_IMPORT_COLUMNS } from '../src/utils/salesImportContract.ts'
import { parseCsvRows } from '../src/utils/csvImport.ts'

// The Worker's own reader, loaded from its source (it imports nothing), not a copy of it.
const workerSource = stripTypeScriptTypes(fs.readFileSync(new URL('../../cloudflare/src/lib/importCsv.ts', import.meta.url), 'utf8'))
const { parseCsvRows: parseCsvRowsOnWorker } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`) as { parseCsvRows: typeof parseCsvRows }

let passed = 0
const test = (name: string, fn: () => void): void => { fn(); passed += 1; console.log(`PASS ${name}`) }

// One sale row whose free-text cells are the formula shapes a spreadsheet would run.
const FORMULAS: Record<string, string> = {
  customer_name: '=1+1',
  customer_address: '+cmd|calc',
  notes: '@SUM(A1:A9)',
  name: '-2+3',
  batch_label: '\t=HYPERLINK("http://example.test")',
  customer_phone: '=1+1,"quoted"\nsecond line',
}
const PLAIN: Record<string, string> = { receipt_number: 'R-1', payment_method: 'Cash', sku: "O'Brien" }
const row = { ...Object.fromEntries(SALES_IMPORT_COLUMNS.map((column) => [column, ''])), ...PLAIN, ...FORMULAS, quantity: 2, product_discount_usd: -0.5 }

/** RFC 4180 cells of the first record after the header, exactly as they sit in the file. */
function dataCells(csv: string): string[] {
  const text = csv.replace(/^﻿/, '')
  const cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '""'; i += 1 } else { if (ch === '"') quoted = false; cell += ch }
    } else if (ch === '"') { quoted = true; cell += ch }
    else if (ch === ',') { if (line === 1) cells.push(cell); cell = '' }
    else if (ch === '\n') { if (line === 1) { cells.push(cell); return cells } line += 1; cell = '' }
    else cell += ch
  }
  if (line === 1) cells.push(cell)
  return cells
}

const csv = buildSalesExportCsv([row])

test('control: the quote-only escape ExportModal used to carry leaves every formula-shaped cell bare', () => {
  const old = (value: unknown): string => {
    if (value == null) return ''
    const text = String(value)
    return text.includes(',') || text.includes('"') || text.includes('\n') ? `"${text.replace(/"/g, '""')}"` : text
  }
  assert.equal(old('=1+1'), '=1+1', 'the instrument sees the injection in the old escape')
  assert.equal(old('+cmd|calc'), '+cmd|calc')
  assert.equal(old('@SUM(A1:A9)'), '@SUM(A1:A9)')
})

test('no cell of the export starts with a formula character: each is guarded with an apostrophe', () => {
  const cells = dataCells(csv)
  assert.equal(cells.length, SALES_IMPORT_COLUMNS.length, 'one cell per import column')
  const header = csv.replace(/^﻿/, '').split('\n')[0]
  assert.equal(header, SALES_IMPORT_COLUMNS.join(','), 'the header row is the import contract, untouched')
  for (const cell of cells) assert.ok(!/^"?[=+\-@\t\r]/.test(cell), `bare formula cell: ${JSON.stringify(cell)}`)
  const byColumn = Object.fromEntries(SALES_IMPORT_COLUMNS.map((column, index) => [column, cells[index]]))
  assert.equal(byColumn.customer_name, "'=1+1")
  assert.equal(byColumn.customer_address, "'+cmd|calc")
  assert.equal(byColumn.notes, "'@SUM(A1:A9)")
  assert.equal(byColumn.name, "'-2+3")
  assert.equal(byColumn.product_discount_usd, "'-0.5", 'a negative number is guarded the same way as everywhere else a person downloads')
  assert.equal(byColumn.quantity, '2', 'a plain number is untouched')
  assert.equal(byColumn.sku, "O'Brien", 'an apostrophe inside a value is a real character')
})

test('the file keeps its BOM, its comma/quote/newline quoting and one line per record', () => {
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM so Excel reads Khmer correctly')
  const cells = dataCells(csv)
  const phone = cells[SALES_IMPORT_COLUMNS.indexOf('customer_phone')]
  assert.equal(phone, `"'=1+1,""quoted""\nsecond line"`, 'guarded first, then quoted')
})

for (const [label, parse] of [['the frontend import parser', parseCsvRows], ['the Worker import parser', parseCsvRowsOnWorker]] as const) {
  test(`round trip: ${label} reads every guarded cell back as the exported value`, () => {
    const [read] = parse(csv)
    for (const [column, value] of Object.entries({ ...PLAIN, ...FORMULAS })) {
      assert.equal(read[column], value, `${column} comes back as exported`)
    }
    assert.equal(read.quantity, '2')
    assert.equal(read.product_discount_usd, '-0.5', 'the negative number reaches the importer as typed, not as \'-0.5')
  })
}

test('ExportModal builds its CSV through the shared export and keeps no escape of its own', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/ExportModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const builder = source.slice(source.indexOf('const buildCsvFallback'), source.indexOf('const handlePreview'))
  assert.match(builder, /return buildSalesExportCsv\(data\.sales\)/)
  assert.doesNotMatch(builder, /const escape\b|replace\(\/"\/g/, 'no local quote-only escape in the download path')
})

console.log(`\n${passed} sales export CSV guard tests passed`)
