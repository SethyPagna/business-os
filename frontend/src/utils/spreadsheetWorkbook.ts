// The SheetJS half of the Excel import: workbook bytes in, the delimited text a
// .csv upload would produce out. It is the only module that reads a workbook and
// runs only inside spreadsheetParse.worker.ts, so untrusted bytes never reach
// SheetJS on the UI thread.
import * as XLSX from 'xlsx'
import { csvFieldForMachine } from './csv.ts'

const MS_PER_DAY = 86_400_000
const SERIAL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30)
const DAYS_1900_TO_1904_SYSTEM = 1462

// A zero-padding number format ("0000000000000") is how a leading-zero barcode
// stays a number in Excel: the stored value is 123, the displayed text '0123'.
// The displayed text is trusted only when it is digits, longer than the stored
// value's text and parses back to the same number, so '8.85107E+12', thousands
// separators, currency and percentages are never trusted.
function zeroPaddedNumericText(cell: XLSX.CellObject): string {
  const formatted = typeof cell.w === 'string' ? cell.w.trim() : ''
  if (!/^0[0-9]*$/.test(formatted)) return ''
  const plain = String(cell.v)
  if (formatted.length <= plain.length) return ''
  return Number(formatted) === Number(cell.v) ? formatted : ''
}

function isoDayText(utcMs: number): string {
  const day = new Date(utcMs)
  if (Number.isNaN(day.getTime())) return ''
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
}

const dateFormatByCode = new Map<string, boolean>()

type DateFormatLibrary = { is_date?: (format: string) => boolean }

// The bundler build of SheetJS exports SSF by name; Node loads the CommonJS
// build, which carries it on the default export. Both reads are static member
// accesses, so the bundler keeps only SSF, not the whole library.
function dateFormatDetector(): (format: string) => boolean {
  const ssf: DateFormatLibrary | undefined = XLSX.SSF ?? (XLSX as unknown as { default?: { SSF?: DateFormatLibrary } }).default?.SSF
  if (!ssf?.is_date) throw new Error('SheetJS date-format detector is missing')
  return ssf.is_date
}

function isDateFormat(format: unknown): boolean {
  if (typeof format !== 'string' || format === '') return false
  let known = dateFormatByCode.get(format)
  if (known === undefined) {
    known = Boolean(dateFormatDetector()(format))
    dateFormatByCode.set(format, known)
  }
  return known
}

// A stored serial is a day count, so its calendar day is plain arithmetic on
// the number: the device's time zone has no part in it. Serials 1 to 59 are
// shifted one day because Excel's 1900 system counts a 29 February 1900 that
// never existed; a 1904-system workbook counts from 1904-01-01.
function serialDateText(serial: number, date1904: boolean): string {
  const days = Math.floor(Math.round(serial * MS_PER_DAY) / MS_PER_DAY)
  const leapQuirk = !date1904 && days >= 1 && days < 60 ? 1 : 0
  return isoDayText(SERIAL_EPOCH_UTC_MS + (days + leapQuirk + (date1904 ? DAYS_1900_TO_1904_SYSTEM : 0)) * MS_PER_DAY)
}

// A Date SheetJS built from text or a BIFF record carries the exact local
// calendar day; its fields are read back as that day, never through
// toISOString, so a UTC+ zone cannot step an imported 09/01 back to 08/31.
function localDateText(date: Date, date1904: boolean): string {
  const day = new Date(0)
  day.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate() + (date1904 ? DAYS_1900_TO_1904_SYSTEM : 0))
  return isoDayText(day.getTime())
}

const SHEETJS_SERIAL_BASE = new Date(1899, 11, 30, 0, 0, 0)

// A stored t="d" cell is read as a serial computed from its local Date. This
// returns that Date: the arithmetic inverse of SheetJS's own Date-to-serial
// step, so the calendar day the file wrote comes back exactly.
function dateFromSheetjsSerial(serial: number): Date {
  const baseMs = SHEETJS_SERIAL_BASE.getTime()
  const baseOffset = SHEETJS_SERIAL_BASE.getTimezoneOffset()
  const at = (offset: number) => new Date(Math.round(baseMs + serial * MS_PER_DAY + (offset - baseOffset) * 60_000))
  let date = at(baseOffset)
  for (let pass = 0; pass < 3; pass += 1) {
    const next = at(date.getTimezoneOffset())
    if (next.getTime() === date.getTime()) break
    date = next
  }
  return date
}

const WORKSHEET_PART = /^\/?xl\/worksheets\/[^/]+\.xml$/i
const CHAR_SPACE = 0x20
const CHAR_QUOTES = [0x22, 0x27]
const CHAR_T = 0x74
const CHAR_EQUALS = 0x3d
const CHAR_D = 0x64

function mentionsLiteralDateType(bytes: ArrayLike<number>): boolean {
  const last = bytes.length - 5
  for (let i = 1; i < last; i += 1) {
    if (
      bytes[i] === CHAR_T &&
      bytes[i + 1] === CHAR_EQUALS &&
      bytes[i + 3] === CHAR_D &&
      bytes[i + 2] === bytes[i + 4] &&
      CHAR_QUOTES.includes(bytes[i + 2]) &&
      bytes[i - 1] <= CHAR_SPACE
    ) {
      return true
    }
  }
  return false
}

// The addresses of cells an .xlsx stores as t="d" (an ISO date text). They read
// as serials like every other cell, so only the file itself says which ones
// were written as dates.
function literalDateCellRefs(workbook: XLSX.WorkBook): ReadonlySet<string> {
  const refs = new Set<string>()
  const { keys, files } = workbook as unknown as { keys?: string[]; files?: Record<string, { content?: ArrayLike<number> } | undefined> }
  for (const key of keys || []) {
    const content = WORKSHEET_PART.test(key) ? files?.[key]?.content : undefined
    if (!content || !mentionsLiteralDateType(content)) continue
    const xml = new TextDecoder().decode(content instanceof Uint8Array ? content : Uint8Array.from(content))
    for (const tag of xml.match(/<c\b[^>]*>/g) || []) {
      const ref = /\sr=["']([A-Za-z]+[0-9]+)["']/.exec(tag)
      if (ref && /\st=["']d["']/.test(tag)) refs.add(ref[1].toUpperCase())
    }
  }
  return refs
}

// Reads the stored value, not the display text: .w shows a 13-digit barcode as
// '8.80123E+12' while .v keeps every digit and String() prints it without an
// exponent. The zero-padded rendering above is the one case .w holds a digit
// .v cannot.
function cellToText(cell: XLSX.CellObject | undefined, date1904: boolean, literalDate: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n':
      if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
        if (literalDate) return localDateText(dateFromSheetjsSerial(cell.v), false)
        if (isDateFormat(cell.z)) return serialDateText(cell.v, date1904)
      }
      return zeroPaddedNumericText(cell) || String(cell.v)
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'd': {
      const date = cell.v as Date
      if (Number.isNaN(date.getTime())) return ''
      return localDateText(date, date1904)
    }
    default:
      return String(cell.v)
  }
}

export function workbookToDelimitedText(workbook: XLSX.WorkBook, sheetName?: string, literalDateRefs?: ReadonlySet<string>): string {
  const targetSheetName = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0]
  const sheet = targetSheetName ? workbook.Sheets[targetSheetName] : undefined
  if (!sheet || !sheet['!ref']) return ''

  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904)
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const lines: string[] = []
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: string[] = []
    let rowHasValue = false
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col })
      const text = cellToText(sheet[ref], date1904, Boolean(literalDateRefs?.has(ref)))
      if (text !== '') rowHasValue = true
      // Machine quoting: this text goes to the app's own parsers, and the
      // injection guard's leading apostrophe would corrupt values like a
      // numeric -5.
      cells.push(csvFieldForMachine(text))
    }
    // Blank rows are skipped, as parseDelimitedRows skips them for CSV.
    if (rowHasValue) lines.push(cells.join(','))
  }
  return lines.join('\n')
}

type Container = 'zip' | 'biff' | 'text'

// The first bytes pick SheetJS's reader. Zip (.xlsx, .xlsb) and BIFF (.xls)
// files hold dates as stored serials, which are read exactly as numbers. Every
// other file (HTML or CSV saved as .xls, XML 2003) holds dates as text that
// SheetJS turns into exact local Dates.
function containerOf(bytes: ArrayBuffer): Container {
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength))
  const isCompoundFile = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => head[index] === byte)
  if (isCompoundFile || (head[0] === 0x09 && head[1] <= 0x08)) return 'biff'
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] < 0x09 && head[3] < 0x09) return 'zip'
  return 'text'
}

export function spreadsheetBytesToDelimitedText(bytes: ArrayBuffer, sheetName?: string): string {
  const container = containerOf(bytes)
  if (container === 'text') return workbookToDelimitedText(XLSX.read(bytes, { type: 'array', cellDates: true }), sheetName)
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true, bookFiles: container === 'zip' })
  const literalDateRefs = container === 'zip' ? literalDateCellRefs(workbook) : undefined
  delete (workbook as { files?: unknown }).files
  return workbookToDelimitedText(workbook, sheetName, literalDateRefs)
}
