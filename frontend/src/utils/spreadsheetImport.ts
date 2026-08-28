// Universal import-file reader: CSV, TSV, and real Excel (.xlsx/.xls/.xlsm).
//
// WHY THIS EXISTS: every import entry point in this app (products, inventory,
// contacts, sales) ends up calling openCSVDialog() (api/browserDialogs.ts),
// which used to only accept .csv/.tsv and read the file as raw text via
// decodeTextBuffer. That's the root cause of two separate real-world bugs
// reported by operators:
//
//   1. "Khmer text turns into question marks" -- this almost never happens
//      on the read side (decodeTextBuffer already handles UTF-8/UTF-16
//      correctly). It happens earlier: a CSV round-tripped through Excel
//      gets re-saved using Excel's plain "CSV (Comma delimited)" option,
//      which writes the system ANSI codepage (e.g. Windows-1252), not UTF-8
//      -- Windows-1252 cannot represent Khmer glyphs at all, so they become
//      literal '?' before the file ever reaches this app. Plain CSV has no
//      way to prevent that; it's a structural limitation of the format.
//
//   2. "Barcode numbers turn into scientific notation / lose digits" --
//      Excel's default "General" number format switches to scientific
//      notation once an integer gets long enough (which most 12-13 digit
//      barcodes are), and CSV has no per-column type info to mark a column
//      "Text" and stop that.
//
// Real .xlsx sidesteps both structurally: it always stores text as UTF-8 in
// its underlying XML (no ANSI ambiguity, ever), and cells carry real type
// info so a column can be explicitly typed Text (see utils/xlsxExport.ts for
// the export side, which forces barcode-shaped columns to Text so a file
// this app generates never re-introduces the problem on the next round
// trip).
//
// This module converts a parsed .xlsx sheet into the exact same delimited
// text shape a .csv upload already produces, so nothing downstream --
// analyzeProductImportText, parseCsvRows, the backend's importCsv.ts, all of
// it -- needs to know or care that the original file was Excel.
import * as XLSX from 'xlsx'
import { decodeTextBuffer } from './csvImport.ts'
import { csvFieldForMachine } from './csv.ts'

export type ImportFileResult = {
  content: string
  name: string
}

const SPREADSHEET_EXTENSION_PATTERN = /\.(xlsx|xlsm|xls)$/i

export function isSpreadsheetFileName(fileName: string): boolean {
  return SPREADSHEET_EXTENSION_PATTERN.test(String(fileName || '').trim())
}

// Converts one cell to the text that should appear in the equivalent CSV.
// Deliberately reads cell.v (the raw stored value), never cell.w (Excel's
// *display* text) -- for a numeric cell, .w is what shows "8.80123E+12" in
// Excel's UI, but .v is still the full-precision number underneath. Numbers
// this size (real barcodes are well under JavaScript's 2^53 safe-integer
// ceiling) stringify back to plain digits with no exponent, which is exactly
// what String() already does for anything under 1e21.
function cellToText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n':
      return String(cell.v)
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'd': {
      const date = cell.v as Date
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
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

// List every sheet name in a workbook -- used when a file has multiple
// tabs and the caller wants to let the operator pick one instead of
// silently always taking the first.
export function listWorkbookSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames || []
}

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer()
  // cellDates: true -- date-formatted cells come back as JS Date objects
  // (cell.t === 'd') instead of raw Excel serial numbers, so cellToText
  // can format them sensibly rather than emitting a meaningless integer.
  return XLSX.read(buffer, { type: 'array', cellDates: true })
}

// Single entry point every import dialog/drop-zone should call. Detects
// CSV/TSV vs. Excel by extension and returns the same { content, name }
// shape either way -- callers (openCSVDialog, FileDropZone, and every
// *ImportModal.tsx that consumes their result) don't need to change at all.
export async function parseImportFile(file: File, sheetName?: string): Promise<ImportFileResult> {
  const name = file.name || 'import'
  if (isSpreadsheetFileName(name)) {
    const workbook = await readWorkbook(file)
    return { content: workbookToDelimitedText(workbook, sheetName), name }
  }
  const content = decodeTextBuffer(await file.arrayBuffer())
  return { content, name }
}
