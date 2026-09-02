// Real Excel (.xlsx) export, replacing plain CSV for the app's "Export"
// buttons. Two structural problems with CSV this fixes, not just papers
// over (see spreadsheetImport.ts's header comment for the read-side half of
// this):
//
//   1. Khmer (or any non-Latin script) text survives a re-save in Excel.
//      CSV depends on Excel's "CSV UTF-8" save option, which most people
//      never explicitly pick -- the plain "CSV (Comma delimited)" option
//      writes the system ANSI codepage instead, which can't represent
//      Khmer at all and silently turns it into '?'. XLSX has no such
//      ambiguity: text is always stored as UTF-8 in the underlying XML
//      regardless of which "Save" button gets clicked.
//
//   2. Barcode/SKU/phone/membership-number columns are written as real
//      Excel "Text" cells (numFmt '@'), not numbers -- so re-opening the
//      file never re-triggers Excel's General-format scientific notation
//      or leading-zero stripping. See columnsNeedingTextFormat below for
//      how a column gets flagged.
import * as XLSX from 'xlsx'
import { downloadBlob } from './csv.ts'

type ExportRow = Record<string, unknown>

// Anything this long (or longer) as a bare digit string is exactly the
// shape Excel's General number format mangles into scientific notation --
// UPC-12, EAN-13, GTIN-14 barcodes, membership numbers, long phone numbers.
// Short numeric codes (quantities, small IDs) are well under this and are
// unaffected either way, so they're still written as real numbers (keeps
// sorting/SUM/etc. working normally on those columns).
const FORCE_TEXT_MIN_DIGITS = 10

function looksLikeIdLikeNumber(raw: string): boolean {
  if (!/^\d+$/.test(raw)) return false
  if (raw.length >= FORCE_TEXT_MIN_DIGITS) return true
  // A leading zero on a *short* numeric code (e.g. a phone number missing
  // its country code) is destroyed by numeric interpretation regardless of
  // overall length, so this is checked independently of the length rule.
  if (raw.length > 1 && raw[0] === '0') return true
  return false
}

// A column is forced to Text format only when EVERY non-empty value in it
// looks id-like -- a mixed column (e.g. one row has a real barcode, another
// has an empty barcode) still qualifies since empty cells are skipped, but
// a column that's mostly free text with one coincidentally long number in
// it is left alone rather than guessing wrong.
function columnsNeedingTextFormat(headers: string[], rows: ExportRow[]): Set<string> {
  const forced = new Set<string>()
  for (const header of headers) {
    let sawValue = false
    let allIdLike = true
    for (const row of rows) {
      const value = row[header]
      if (value === undefined || value === null || value === '') continue
      sawValue = true
      if (!looksLikeIdLikeNumber(String(value))) {
        allIdLike = false
        break
      }
    }
    if (sawValue && allIdLike) forced.add(header)
  }
  return forced
}

function isPlainNumericString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim())
}

export function buildWorksheet(rows: ExportRow[]): XLSX.WorkSheet {
  const headers = Object.keys(rows[0] || {})
  const textColumns = columnsNeedingTextFormat(headers, rows)
  const sheet: XLSX.WorkSheet = {}

  headers.forEach((header, colIndex) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: colIndex })
    sheet[addr] = { t: 's', v: header }
  })

  rows.forEach((row, rowIndex) => {
    headers.forEach((header, colIndex) => {
      const raw = row[header]
      if (raw === undefined || raw === null || raw === '') return // leave the cell empty
      const addr = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })
      if (textColumns.has(header)) {
        // z: '@' is Excel's own "Text" number format -- forces the cell to
        // stay text even if a user later edits it in Excel and it still
        // looks like a number.
        sheet[addr] = { t: 's', v: String(raw), z: '@' }
        return
      }
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        sheet[addr] = { t: 'n', v: raw }
        return
      }
      // An id-like STRING in a column that didn't qualify for whole-column
      // Text forcing (a MIXED column -- some rows hold real barcodes, some
      // hold non-numeric codes) must still never become a number cell:
      // Number('035000463760') destroys the leading zero and long ids drift
      // into scientific display. Per-cell, the same rule as the column
      // check (M7 -- found by the migration pack's own twin validator).
      if (typeof raw === 'string' && isPlainNumericString(raw)) {
        if (looksLikeIdLikeNumber(raw.trim())) {
          sheet[addr] = { t: 's', v: raw, z: '@' }
          return
        }
        sheet[addr] = { t: 'n', v: Number(raw) }
        return
      }
      sheet[addr] = { t: 's', v: String(raw) }
    })
  })

  const lastRow = Math.max(rows.length, 0)
  const lastCol = Math.max(headers.length - 1, 0)
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } })
  // Reasonable default column widths so Khmer text and long id-like columns
  // are readable without the operator having to manually widen every column
  // by hand first.
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(40, Math.max(10, header.length + 2)),
  }))

  return sheet
}

// Multi-sheet workbook export (Section 5, Sep 2 2026 RC -- the "Business
// summary" workbook). `buildWorksheet` above already does all the per-sheet
// work (headers, id-like-column Text forcing, column widths); this just
// loops it once per named sheet and appends them into one workbook. Excel
// sheet names are capped at 31 chars and can't contain : \ / ? * [ ] --
// `safeSheetName` enforces that so a caller never has to know Excel's rules.
// A sheet with zero rows is still written (with just a header row) rather
// than skipped, so e.g. an admin exporting a range with no returns still
// sees an empty "Returns" tab instead of a missing one -- consistent shape
// beats a shorter file.
export type WorkbookSheet = { name: string; rows: ExportRow[] }

function safeSheetName(name: string, usedNames: Set<string>): string {
  let cleaned = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let candidate = cleaned
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase())) {
    const suffixStr = ` (${suffix})`
    candidate = cleaned.slice(0, 31 - suffixStr.length) + suffixStr
    suffix += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

export function downloadWorkbook(filename: string, sheets: WorkbookSheet[]): void {
  const usable = (Array.isArray(sheets) ? sheets : []).filter((s) => s && s.name)
  if (!usable.length) return
  const workbook = XLSX.utils.book_new()
  const usedNames = new Set<string>()
  for (const sheet of usable) {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : []
    // buildWorksheet reads headers from rows[0] -- an empty sheet still gets
    // a real (headerless but valid) worksheet rather than being skipped, via
    // a synthetic single blank row that produces an empty ref range.
    const worksheet = rows.length ? buildWorksheet(rows) : buildWorksheet([])
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name, usedNames))
  }
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  downloadBlob(filename, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

export function downloadXLSX(filename: string, rows: unknown[]): void {
  const dataRows = (Array.isArray(rows) ? rows : []) as ExportRow[]
  if (!dataRows.length) return
  const worksheet = buildWorksheet(dataRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  // `compression: true` deflates the entries inside the xlsx's underlying
  // zip container (SheetJS defaults this to off, i.e. stored/uncompressed
  // entries) -- container-level only, it never touches a cell value, so
  // the exported data is byte-for-byte the same on read, just packed
  // smaller for download/attach/share.
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  downloadBlob(filename, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
