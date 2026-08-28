// M7: the encoding-safety CONTRACT, pinned as tests -- template downloads,
// exports, and the import parsers preserve text barcodes (no scientific
// notation, no stripped leading zeros), Khmer text, and literal formats,
// including full round-trips through this app's own files:
//
//   - escapeCsvValue's Excel-injection guard ('-5, '+855...) is exactly
//     inverted by parseCsvRows, so exporting and re-importing this app's
//     own CSV is the identity for every value
//   - the xlsx→delimited-text bridge (spreadsheetImport) uses MACHINE
//     quoting -- a numeric -5 cell reaches the analyzers as -5, never '-5
//   - xlsxExport writes barcode-shaped columns as real Text cells and the
//     whole xlsx round-trip (buildWorksheet → write → read → parse) is the
//     identity for barcodes, Khmer, and negatives
//   - .csv entries inside export ZIPs carry the UTF-8 BOM (Excel's
//     codepage guess without one turns Khmer into '?')
//   - Screen 1's scientific-notation barcode rejection stays blocking
//
// The backend halves of these guarantees (importCsv.ts's identical
// unescapes, errors.csv's BOM, frontend↔backend parse PARITY) are pinned
// by cloudflare/scripts/test-encoding-safety-pure.cjs.
//
// Run: node tests/encodingSafety.test.ts
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { UTF8_BOM, buildCSV, csvFieldForMachine, escapeCsvValue, normalizeZipFile } from '../src/utils/csv.ts'
import { decodeTextBuffer, parseCsvRows } from '../src/utils/csvImport.ts'
import { buildWorksheet } from '../src/utils/xlsxExport.ts'
import { workbookToDelimitedText } from '../src/utils/spreadsheetImport.ts'
import {
  BLOCKING_PRODUCT_IMPORT_ISSUES,
  getProductImportBarcodeIssue,
  isBlockingProductImportIssue,
} from '../src/components/products/import/productImportPlanner.ts'

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

// One nasty row exercising every guarded/at-risk shape at once.
const NASTY = {
  name: '-Minus Leading Name',
  phone: '+855 12 345 678',
  formula: '=SUM(A1:A9)',
  handle: '@handle',
  barcode: '0123456789012',
  long_barcode: '8850006330012',
  khmer: 'ស្តុកចូល ១២៣',
  qty: '-5',
  note: 'has, comma and "quotes"',
}

await runTest('human CSV export → import is the identity for every guarded value', () => {
  const csv = buildCSV([NASTY])
  // The export really is guarded (this is what protects a person opening
  // the file in Excel from formula injection)...
  assert.ok(csv.includes("'-Minus"), 'leading-dash value is apostrophe-guarded in the file')
  assert.ok(csv.includes("'=SUM"), 'formula-shaped value is guarded in the file')
  // ...and the parser strips exactly that guard back off.
  const [row] = parseCsvRows(csv)
  for (const [key, value] of Object.entries(NASTY)) {
    assert.equal(row[key], value, `${key} round-trips exactly`)
  }
})

await runTest('the guard strip only fires on the exact inverse, never on real apostrophes', () => {
  const csv = 'name,note\n"\'O\'Brien","\'plain leading apostrophe"'
  const [row] = parseCsvRows(csv)
  assert.equal(row.name, "'O'Brien", 'an apostrophe before a normal letter is a real character, kept')
  assert.equal(row.note, "'plain leading apostrophe")
  const [wrapped] = parseCsvRows('barcode\n"=""0012345678905"""')
  assert.equal(wrapped.barcode, '0012345678905', 'the ="..." Excel text wrap unwraps to its value')
})

await runTest('csvFieldForMachine never injects the guard and still quotes correctly', () => {
  assert.equal(csvFieldForMachine('-5'), '-5')
  assert.equal(csvFieldForMachine('+855 12'), '+855 12')
  assert.equal(csvFieldForMachine('=SUM(A1)'), '=SUM(A1)')
  assert.equal(csvFieldForMachine('@x'), '@x')
  assert.equal(csvFieldForMachine('a,b'), '"a,b"')
  assert.equal(csvFieldForMachine('say "hi"'), '"say ""hi"""')
  assert.equal(csvFieldForMachine('two\nlines'), '"two\nlines"')
  // The human-download escape stays guarded -- the two functions are
  // different on purpose (files people open vs text our parsers read).
  assert.equal(escapeCsvValue('-5'), "'-5")
})

await runTest('xlsx cells cross the bridge literally: negatives, big barcodes, Khmer', () => {
  const sheet: XLSX.WorkSheet = {
    A1: { t: 's', v: 'qty' }, B1: { t: 's', v: 'barcode' }, C1: { t: 's', v: 'khmer' }, D1: { t: 's', v: 'note' },
    A2: { t: 'n', v: -5 }, B2: { t: 'n', v: 8850006330012 }, C2: { t: 's', v: 'ស្តុកចូល' }, D2: { t: 's', v: '=SUM(A1)' },
    '!ref': 'A1:D2',
  }
  const workbook: XLSX.WorkBook = { SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } }
  const text = workbookToDelimitedText(workbook)
  assert.ok(!text.includes("'-5"), 'a numeric -5 cell is not apostrophe-mangled on the machine path')
  const [row] = parseCsvRows(text)
  assert.equal(row.qty, '-5')
  assert.equal(row.barcode, '8850006330012', 'a numeric 13-digit barcode cell stringifies to digits, no exponent')
  assert.equal(row.khmer, 'ស្តុកចូល')
  assert.equal(row.note, '=SUM(A1)')
})

await runTest('xlsxExport forces barcode-shaped columns to Text cells', () => {
  const sheet = buildWorksheet([
    { barcode: '0123456789012', phone: '012345678', qty: 3, name: 'Serum ស្តុកចូល' },
    { barcode: '8850006330012', phone: '', qty: -5, name: 'Toner' },
  ])
  // Header order = Object.keys of the first row: A=barcode B=phone C=qty D=name.
  assert.deepEqual(sheet.A2, { t: 's', v: '0123456789012', z: '@' }, 'leading-zero barcode is a Text cell')
  assert.equal((sheet.A3 as XLSX.CellObject).z, '@', '13-digit barcode column stays Text')
  assert.deepEqual(sheet.B2, { t: 's', v: '012345678', z: '@' }, 'leading-zero short phone is Text too')
  assert.equal((sheet.C2 as XLSX.CellObject).t, 'n', 'ordinary quantities stay real numbers')
  assert.equal((sheet.C3 as XLSX.CellObject).v, -5)
  assert.equal((sheet.D2 as XLSX.CellObject).t, 's', 'free text stays text without a forced format')
  assert.equal((sheet.D2 as XLSX.CellObject).z, undefined, 'and gains no forced number format')
})

await runTest('full xlsx round-trip (export → read back → parse) is the identity', () => {
  const rows = [{ name: 'ស្តុកចូល Serum', barcode: '0123456789012', qty: -5, note: '=SUM(A1)' }]
  const worksheet = buildWorksheet(rows as never)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  const readBack = XLSX.read(bytes, { type: 'array', cellDates: true })
  const [row] = parseCsvRows(workbookToDelimitedText(readBack))
  assert.equal(row.name, 'ស្តុកចូល Serum')
  assert.equal(row.barcode, '0123456789012', 'leading zero survives the whole loop')
  assert.equal(row.qty, '-5')
  assert.equal(row.note, '=SUM(A1)')
})

await runTest('.csv entries inside export ZIPs carry the UTF-8 BOM', () => {
  const fromRows = normalizeZipFile({ name: 'stock.csv', rows: [{ name: 'ស្តុកចូល' }] })
  assert.ok(fromRows && fromRows.content.startsWith(UTF8_BOM), 'rows-built csv entry gains the BOM')
  const fromContent = normalizeZipFile({ name: 'report.csv', content: 'a,b\n1,2' })
  assert.ok(fromContent && fromContent.content.startsWith(UTF8_BOM), 'plain csv content gains the BOM')
  const alreadyBom = normalizeZipFile({ name: 'x.csv', content: `${UTF8_BOM}a` })
  assert.ok(alreadyBom && !alreadyBom.content.startsWith(`${UTF8_BOM}${UTF8_BOM}`), 'an existing BOM is not doubled')
  const html = normalizeZipFile({ name: 'report.html', content: '<html></html>' })
  assert.equal(html?.content, '<html></html>', 'non-CSV entries are left alone')
})

await runTest('decodeTextBuffer strips the BOM and keeps Khmer through UTF-8 and UTF-16', () => {
  const utf8 = new TextEncoder().encode('﻿name\nស្តុកចូល')
  assert.equal(decodeTextBuffer(utf8), 'name\nស្តុកចូល')
  const source = 'name\nស្តុកចូល'
  const utf16 = new Uint8Array(2 + source.length * 2)
  utf16[0] = 0xFF
  utf16[1] = 0xFE
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    utf16[2 + index * 2] = code & 0xFF
    utf16[3 + index * 2] = code >> 8
  }
  assert.equal(decodeTextBuffer(utf16), 'name\nស្តុកចូល')
})

await runTest('scientific-notation barcodes stay a BLOCKING import issue', () => {
  assert.equal(getProductImportBarcodeIssue('8.85001E+12'), 'barcode_scientific_notation')
  assert.equal(getProductImportBarcodeIssue('1.2e13'), 'barcode_scientific_notation')
  assert.equal(getProductImportBarcodeIssue('8850006330012'), '', 'a real barcode passes')
  assert.equal(getProductImportBarcodeIssue('0123456789012'), '', 'a leading-zero barcode passes')
  assert.ok(BLOCKING_PRODUCT_IMPORT_ISSUES.has('barcode_scientific_notation'))
  assert.ok(isBlockingProductImportIssue('barcode_scientific_notation'))
})

if (failed > 0) {
  console.error(`${failed} encodingSafety test(s) failed`)
  process.exit(1)
}
console.log('encodingSafety tests passed')
