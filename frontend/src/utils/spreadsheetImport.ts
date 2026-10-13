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
import { decodeTextBuffer } from './csvImport.ts'
import { spreadsheetBytesToDelimitedText } from './spreadsheetWorkbook.ts'

export type ImportFileResult = {
  content: string
  name: string
}

const SPREADSHEET_EXTENSION_PATTERN = /\.(xlsx|xlsm|xls)$/i

export function isSpreadsheetFileName(fileName: string): boolean {
  return SPREADSHEET_EXTENSION_PATTERN.test(String(fileName || '').trim())
}

// Single entry point every import dialog/drop-zone should call. Detects
// CSV/TSV vs. Excel by extension and returns the same { content, name }
// shape either way -- callers (openCSVDialog, FileDropZone, and every
// *ImportModal.tsx that consumes their result) don't need to change at all.
export async function parseImportFile(file: File, sheetName?: string): Promise<ImportFileResult> {
  const name = file.name || 'import'
  if (isSpreadsheetFileName(name)) {
    return { content: spreadsheetBytesToDelimitedText(await file.arrayBuffer(), sheetName), name }
  }
  const content = decodeTextBuffer(await file.arrayBuffer())
  return { content, name }
}
