// The SheetJS half of the Excel import: bytes of an .xlsx/.xls/.xlsm in, the
// same delimited text a .csv upload produces out. It is the ONLY module that
// reads a workbook, and it runs only inside spreadsheetParse.worker.ts (see
// spreadsheetImport.ts for why): SheetJS 0.18.5 has prototype-pollution and
// ReDoS advisories, so an untrusted file must never reach it on the UI thread.
import * as XLSX from 'xlsx'
import { csvFieldForMachine } from './csv.ts'

// The ONE case where a numeric cell's DISPLAY text carries a digit its
// stored value does not: a zero-padding custom format ("0000000000000"),
// which is what an operator applies to keep a leading-zero barcode looking
// right in Excel. The workbook then holds { t:'n', v:123, w:'0123' } and
// reading .v alone silently drops the zero -- the second root cause behind
// "products that actually have barcode with leading 0" (verified against
// SheetJS: a cell written with z:'0000' round-trips exactly like that).
//
// Deliberately as narrow as the claim: the formatted text must be nothing
// but digits, must be LONGER than the plain stringified number, and must
// still parse back to the same number. That admits '0123' for 123 and
// rejects everything else -- thousands separators, currency, percentages,
// and above all the "8.85107E+12" scientific rendering the next case is
// specifically written not to trust.
function zeroPaddedNumericText(cell: XLSX.CellObject): string {
  const formatted = typeof cell.w === 'string' ? cell.w.trim() : ''
  if (!/^0[0-9]*$/.test(formatted)) return ''
  const plain = String(cell.v)
  if (formatted.length <= plain.length) return ''
  return Number(formatted) === Number(cell.v) ? formatted : ''
}

// Converts one cell to the text that should appear in the equivalent CSV.
// Reads cell.v (the raw stored value), not cell.w (Excel's *display* text)
// -- for a numeric cell, .w is what shows "8.80123E+12" in Excel's UI, but
// .v is still the full-precision number underneath. Numbers this size (real
// barcodes are well under JavaScript's 2^53 safe-integer ceiling) stringify
// back to plain digits with no exponent, which is exactly what String()
// already does for anything under 1e21. The single exception is the
// zero-padded rendering above, where .w holds a digit .v cannot.
function cellToText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n':
      return zeroPaddedNumericText(cell) || String(cell.v)
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'd': {
      const date = cell.v as Date
      if (Number.isNaN(date.getTime())) return ''
      // Excel date cells are calendar values, not UTC instants. Converting a
      // local-midnight cell through toISOString() can shift it to the previous
      // day on UTC+ timezones. Preserve the calendar fields exactly as SheetJS
      // decoded them so an imported 09/01 remains 2026-09-01 everywhere.
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    default:
      // 's' (shared string) / 'str' (formula result string) -- exact
      // Unicode text as parsed straight out of the XLSX XML. Khmer, or any
      // other script, comes through untouched: there's no intermediate
      // byte-encoding step for SheetJS to get wrong here the way a raw CSV
      // byte stream can.
      return String(cell.v)
  }
}

export function workbookToDelimitedText(workbook: XLSX.WorkBook, sheetName?: string): string {
  const targetSheetName = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0]
  const sheet = targetSheetName ? workbook.Sheets[targetSheetName] : undefined
  if (!sheet || !sheet['!ref']) return ''

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const lines: string[] = []
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: string[] = []
    let rowHasValue = false
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
      const text = cellToText(cell)
      if (text !== '') rowHasValue = true
      // Machine quoting, not escapeCsvValue: this text goes straight into
      // this app's own parsers, never Excel, and the injection guard's
      // leading apostrophe would corrupt real cell values -- a numeric -5
      // (negative adjustment) became the unparseable text '-5 (M7).
      cells.push(csvFieldForMachine(text))
    }
    // Skip fully blank rows (matches parseDelimitedRows' own blank-row
    // filtering in csvImport.ts, so behavior is identical either way a file
    // arrives).
    if (rowHasValue) lines.push(cells.join(','))
  }
  return lines.join('\n')
}

export function spreadsheetBytesToDelimitedText(bytes: ArrayBuffer, sheetName?: string): string {
  // cellDates: true -- date-formatted cells come back as JS Date objects
  // (cell.t === 'd') instead of raw Excel serial numbers, so cellToText
  // can format them sensibly rather than emitting a meaningless integer.
  return workbookToDelimitedText(XLSX.read(bytes, { type: 'array', cellDates: true }), sheetName)
}
