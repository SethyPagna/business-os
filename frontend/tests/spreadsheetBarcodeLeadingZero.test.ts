// The SECOND root cause behind the 2026-09-06 owner report:
//
//   "I see that barcode scanner cannot scan the beginning with zero the
//    leading zero for products that actually have barcode with leading 0."
//
// A matcher can only find the zero if the catalog still HAS it. Barcodes
// arrive through the xlsx/csv import, and Excel stores a zero-padded
// barcode as a NUMBER with a display format: the cell is
// { t:'n', v:748485110011, w:'0748485110011' }. utils/spreadsheetImport.ts
// deliberately reads cell.v and never cell.w -- correct for the case that
// rule was written for (.w renders large numbers as "8.80123E+12" while .v
// keeps full precision), but it is exactly what silently drops the leading
// zero on the way in. The product is then STORED without the zero, and no
// amount of matcher work can recover a digit that never landed.
//
// The fix is the narrowest possible exception: trust .w only when it is
// pure digits, longer than the stringified .v, and still parses back to the
// same number. That admits '0748485110011' for 748485110011 and rejects
// scientific notation, separators, currency and percentages.
//
// Runs the REAL xlsx library and the REAL workbookToDelimitedText, so it
// pins the actual round-trip rather than a replica of it.
//
// Run: node tests/spreadsheetBarcodeLeadingZero.test.ts

import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { workbookToDelimitedText } from '../src/utils/spreadsheetImport.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// Builds a one-sheet workbook from explicit cell objects, so each test can
// state the exact { t, v, w } shape Excel produces.
function sheetFrom(rows: XLSX.CellObject[][]): XLSX.WorkBook {
  const sheet: XLSX.WorkSheet = {}
  rows.forEach((row, r) => {
    row.forEach((cell, c) => { sheet[XLSX.utils.encode_cell({ r, c })] = cell })
  })
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length - 1, c: Math.max(...rows.map((r) => r.length)) - 1 },
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
  return wb
}

const header: XLSX.CellObject[] = [
  { t: 's', v: 'name' },
  { t: 's', v: 'barcode' },
]
const text = (v: string): XLSX.CellObject => ({ t: 's', v })
const bodyOf = (out: string) => out.split(/\r?\n/).slice(1).filter(Boolean)

check('a zero-padded numeric barcode keeps its leading zero', () => {
  const wb = sheetFrom([
    header,
    [text('Padded Only Serum'), { t: 'n', v: 748485110011, w: '0748485110011' }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(
    row.includes('0748485110011'),
    `import dropped the leading zero: got ${JSON.stringify(row)}`,
  )
})

check('several leading zeros all survive', () => {
  const wb = sheetFrom([
    header,
    [text('Short Code'), { t: 'n', v: 12345, w: '0000012345' }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('0000012345'), `got ${JSON.stringify(row)}`)
})

check('a UPC-E written as a number keeps the number-system zero', () => {
  const wb = sheetFrom([
    header,
    [text('Small Package Balm'), { t: 'n', v: 1234565, w: '01234565' }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('01234565'), `got ${JSON.stringify(row)}`)
})

// --- the guard rails: .w is trusted ONLY for the padding case ----------

check('scientific-notation display text is still ignored in favour of .v', () => {
  // The case the read-.v rule exists for. .w must NOT win here.
  const wb = sheetFrom([
    header,
    [text('Big Code'), { t: 'n', v: 8801234567890, w: '8.80123E+12' }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('8801234567890'), `got ${JSON.stringify(row)}`)
  assert.ok(!row.includes('8.80123E+12'), 'exponent notation leaked into the import')
})

check('thousands separators, currency and percentages never win', () => {
  const wb = sheetFrom([
    [text('a'), text('b'), text('c')],
    [
      { t: 'n', v: 1234567, w: '1,234,567' },
      { t: 'n', v: 12.5, w: '$12.50' },
      { t: 'n', v: 0.25, w: '25%' },
    ],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('1234567'), `got ${JSON.stringify(row)}`)
  assert.ok(!row.includes('1,234,567'))
  assert.ok(!row.includes('$12.50'))
  assert.ok(!row.includes('25%'))
})

check('a plain number with no padding is unchanged', () => {
  const wb = sheetFrom([
    header,
    [text('Bare Only Cleanser'), { t: 'n', v: 885909950805, w: '885909950805' }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('885909950805'), `got ${JSON.stringify(row)}`)
})

check('a barcode already stored as TEXT is untouched', () => {
  const wb = sheetFrom([
    header,
    [text('Text Barcode'), text('0748485110011')],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('0748485110011'), `got ${JSON.stringify(row)}`)
})

check('a cell with no display text at all still reads its value', () => {
  const wb = sheetFrom([
    header,
    [text('No Format'), { t: 'n', v: 748485110011 }],
  ])
  const [row] = bodyOf(workbookToDelimitedText(wb))
  assert.ok(row.includes('748485110011'), `got ${JSON.stringify(row)}`)
})

console.log(`\nOK - ${passed} checks passed.`)
