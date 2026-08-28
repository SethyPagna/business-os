import assert from 'node:assert/strict'
import fs from 'node:fs'
import { decodeTextBuffer, getBlankCsvHeaderColumns, normalizeCsvKey, normalizeCsvMoney, parseCsvNumber, parseCsvRows } from '../src/utils/csvImport.ts'

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

await runTest('parseCsvRows handles quoted values and trims headers', () => {
  const rows = parseCsvRows(' "Name" , "Quantity" , "Note"\n"Alpha, Beta",2," hello " ')
  assert.deepEqual(rows, [
    { _rowNumber: 2, name: 'Alpha, Beta', quantity: '2', note: 'hello' },
  ])
})

await runTest('normalizeCsvKey lowercases and trims values', () => {
  assert.equal(normalizeCsvKey('  SKU-001  '), 'sku-001')
})

await runTest('parseCsvNumber falls back for invalid numbers', () => {
  assert.equal(parseCsvNumber('12.5', 0), 12.5)
  assert.equal(parseCsvNumber('oops', 7), 7)
})

await runTest('parseCsvRows preserves Khmer text and TSV delimiter input', () => {
  const rows = parseCsvRows('\uFEFFName\tDescription\tPrice\n\u1780\u17d2\u179a\u17c2\u1798\u179b\u17b6\u1794\u1798\u17bb\u1781\t\u17a2\u178f\u17d2\u1790\u1794\u1791\u1781\u17d2\u1798\u17c2\u179a\t\u17e1\u17e2\u17e3\u17e4.\u17e5\u17e6\u17e7')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.name, '\u1780\u17d2\u179a\u17c2\u1798\u179b\u17b6\u1794\u1798\u17bb\u1781')
  assert.equal(rows[0]?.description, '\u17a2\u178f\u17d2\u1790\u1794\u1791\u1781\u17d2\u1798\u17c2\u179a')
  assert.equal(normalizeCsvMoney(rows[0]?.price), 1234.57)
})

await runTest('normalizeCsvMoney rounds messy currency and decimal formats upward', () => {
  assert.equal(normalizeCsvMoney('$1,234.567'), 1234.57)
  assert.equal(normalizeCsvMoney('\u17db\u17e1\u17e2\u17e3\u17e4.\u17e5\u17e6\u17e1'), 1234.57)
  assert.equal(normalizeCsvMoney('1 234,567'), 1234.57)
  assert.equal(normalizeCsvMoney('3'), 3.00)
})

await runTest('decodeTextBuffer preserves Khmer UTF-8 content with BOM', () => {
  const encoded = new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...new TextEncoder().encode('\u179f\u17c1\u179a\u17c9\u17bc\u1798 CeraVe'),
  ])
  assert.equal(decodeTextBuffer(encoded), '\u179f\u17c1\u179a\u17c9\u17bc\u1798 CeraVe')
})

await runTest('decodeTextBuffer handles UTF-16LE spreadsheet exports', () => {
  const source = '\u179f\u17c1\u179a\u17c9\u17bc\u1798\tCeraVe'
  const bytes = [0xff, 0xfe]
  for (const char of source) {
    const code = char.charCodeAt(0)
    bytes.push(code & 0xff, code >> 8)
  }
  assert.equal(decodeTextBuffer(new Uint8Array(bytes)), source)
})

await runTest('import modals notify parent pages only after handoff or explicit review outcome', () => {
  const files = [
    '../src/components/inventory/InventoryImportModal.tsx',
    '../src/components/sales/SalesImportModal.tsx',
    '../src/components/contacts/ContactImportModal.tsx',
    '../src/components/products/import/BulkImportModal.tsx',
  ]
  // Most of these modals call signalDone(<queued result var>) directly at the
  // point the job is queued. BulkImportModal.tsx instead routes through a
  // handOffToBackgroundTracker(payload) wrapper (it closes the modal and
  // points the person at the top-right import tracker instead of showing a
  // dead-end confirmation screen -- see the code comment above that
  // function), which itself calls signalDone(payload) and is invoked with
  // the queued result. Both are valid ways to notify the parent; accept
  // either the direct call or a wrapper-forwarded one.
  const directCall = /await\s+signalDone\(.*queuedResult|await\s+signalDone\(response\)|await\s+signalDone\(nextResult\)/
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /signalDone\s*=\s*async\s*\(payload(?::[^)]*)?\)/, `${file} should define a queued import callback helper`)
    if (/InventoryImportModal|SalesImportModal|BulkImportModal/.test(file)) {
      assert.match(source, /<(?:ServerImportReviewScreen|ProductServerImportReviewScreen)/, `${file} should keep the server-backed review in the same modal`)
      assert.match(source, /onApproved=\{async \(\) => \{[\s\S]{0,500}?await signalDone\(/, `${file} should notify after explicit approval`)
      assert.match(source, /onReviewLater=\{(?:async \(\) => \{|\(\) => )[\s\S]{0,500}?(?:await signalDone\(|handOffToBackgroundTracker\()/, `${file} should notify after explicit background handoff`)
      continue
    }
    if (directCall.test(source)) continue
    const wrapperMatch = source.match(/const (\w+) = async \(payload(?::[^)]*)?\)[\s\S]{0,200}?await\s+signalDone\(payload\)/)
    assert.ok(wrapperMatch, `${file} should notify the parent after queueing an import job`)
    const wrapperName = wrapperMatch[1]
    const wrapperCallPattern = new RegExp(`await\\s+${wrapperName}\\((?:.*queuedResult|response|nextResult)\\)`)
    assert.match(source, wrapperCallPattern, `${file} should invoke its signalDone wrapper (${wrapperName}) with the queued job result`)
  }
})


await runTest('contact/sales list exports use XLSX (barcode-as-text safe), not plain CSV', () => {
  // Products already exports XLSX via xlsxExport.ts. This locks in the same
  // conversion for the other row-export buttons across the app so a
  // spreadsheet round-trip never re-introduces the barcode-scientific-
  // notation or Khmer-mangled-by-ANSI-CSV problems described in
  // spreadsheetImport.ts -- see that file's header comment for why.
  const files = [
    '../src/components/contacts/CustomersTab.tsx',
    '../src/components/contacts/DeliveryTab.tsx',
    '../src/components/contacts/SuppliersTab.tsx',
  ]
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    // Part 405: the tabs no longer download directly -- every export opens
    // the shared ExportOptionsDialog, whose DEFAULT format is xlsx (the
    // barcode-safety decision this test protects) with CSV behind an
    // explicit Excel-breaks-barcodes warning. The pin follows the intent:
    // the dialog is the only export path, the old direct CSV call is gone.
    assert.match(source, /ExportOptionsDialog/, `${file} should export through the shared ExportOptionsDialog`)
    assert.doesNotMatch(source, /downloadCSV\(`[^`]+\.csv`/, `${file} should not still call the old downloadCSV export path`)
  }
  const salesSource = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  // H1+X5 (Part 401): Sales no longer downloads directly at all -- every
  // scope opens the shared ExportOptionsDialog. The barcode-safety decision
  // this test protects lives on in the dialog: its DEFAULT format is xlsx,
  // and the CSV option exists for re-import/machine use with its hint
  // carrying an explicit Excel-breaks-barcodes warning.
  assert.doesNotMatch(salesSource, /downloadCSV\(`[^`]+\.csv`/, 'Sales.tsx should not still call the old downloadCSV export path')
  assert.doesNotMatch(salesSource, /downloadXLSX\(`[^`]+\.xlsx`/, 'Sales.tsx direct downloads are gone -- exports go through the options dialog')
  assert.match(salesSource, /openExportOptions\(/, 'Sales export scopes open the shared options dialog')
  const exportDialogSource = fs.readFileSync(new URL('../src/components/shared/ExportOptionsDialog.tsx', import.meta.url), 'utf8')
  assert.match(exportDialogSource, /useState<ExportFormat>\('xlsx'\)/, 'the export dialog DEFAULTS to xlsx (barcode-as-text safe)')
})

await runTest('product/inventory/sales import modals accept a dropped file, not just the file-dialog picker', () => {
  // Each of these historically only supported clicking "Choose File" /
  // "Upload CSV" (native dialog). This checks the drop-handling half of
  // that story is wired end to end: a real onDrop/onDropFile prop, backed
  // by a handler that reads the file with parseImportFile (so a dropped
  // .xlsx behaves identically to one picked via the dialog) and feeds the
  // same analysis path the picker uses.
  //
  const bulkImportSource = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
  assert.match(bulkImportSource, /import \{ parseImportFile \} from '\.\.\/\.\.\/\.\.\/utils\/spreadsheetImport\.ts'/)
  assert.match(bulkImportSource, /const handleDropCSV = async \(file: File\)/)
  assert.match(bulkImportSource, /await parseImportFile\(file\)/)
  assert.match(bulkImportSource, /onDrop=\{handleDropCSVEvent\}/)

  const inventorySource = fs.readFileSync(new URL('../src/components/inventory/InventoryImportModal.tsx', import.meta.url), 'utf8')
  assert.match(inventorySource, /import \{ parseImportFile \} from '\.\.\/\.\.\/utils\/spreadsheetImport\.ts'/)
  assert.match(inventorySource, /const handleDropFile = async \(file: File\)/)
  assert.match(inventorySource, /onDropFile=\{handleDropFile\}/)

  const salesImportSource = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.tsx', import.meta.url), 'utf8')
  assert.match(salesImportSource, /import \{ parseImportFile \} from '\.\.\/\.\.\/utils\/spreadsheetImport\.ts'/)
  assert.match(salesImportSource, /const handleDropFile = async \(file: File\)/)
  assert.match(salesImportSource, /onDropFile=\{handleDropFile\}/)

  // ContactImportModal.tsx doesn't use the shared CsvImportPreview/
  // onDropFile prop pattern (it has its own inline "no file selected" box,
  // same as BulkImportModal) -- so it wires a local handleDropFile straight
  // to an onDrop={handleDropCSVEvent} div, matching BulkImportModal's shape
  // rather than Inventory/Sales's onDropFile-prop shape.
  const contactImportSource = fs.readFileSync(new URL('../src/components/contacts/ContactImportModal.tsx', import.meta.url), 'utf8')
  assert.match(contactImportSource, /import \{ parseImportFile \} from '\.\.\/\.\.\/utils\/spreadsheetImport\.ts'/)
  assert.match(contactImportSource, /const handleDropFile = async \(file: File\)/)
  assert.match(contactImportSource, /await parseImportFile\(file\)/)
  assert.match(contactImportSource, /onDrop=\{handleDropCSVEvent\}/)
})

// Real-file audit (Aug 23 2026, chat) -- getBlankCsvHeaderColumns, found
// via the user's own uploaded customers-template-final.csv (a blank header
// at column 3 with real phone-number data underneath it).
await runTest('getBlankCsvHeaderColumns flags a blank header with real data under it', () => {
  const text = 'name,membership_number,,email\nBelie Bee,,0965196900,'
  assert.deepEqual(getBlankCsvHeaderColumns(text), [3])
})

await runTest('getBlankCsvHeaderColumns ignores a genuinely empty spare column (no header, no data)', () => {
  const text = 'name,email,\nBelie Bee,belie@example.com,'
  assert.deepEqual(getBlankCsvHeaderColumns(text), [])
})

await runTest('getBlankCsvHeaderColumns flags multiple blank-header columns, 1-based and in order', () => {
  const text = 'name,,email,,notes\nBelie Bee,012,belie@example.com,extra,'
  assert.deepEqual(getBlankCsvHeaderColumns(text), [2, 4])
})

await runTest('getBlankCsvHeaderColumns returns empty for a file with no blank headers at all', () => {
  const text = 'name,email\nBelie Bee,belie@example.com'
  assert.deepEqual(getBlankCsvHeaderColumns(text), [])
})

if (failed > 0) {
  process.exitCode = 1
}
