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

// The local calendar and clock fields of a Date, read back as a UTC instant, so
// later arithmetic cannot be moved by the device's time zone.
function wallClockUtcMs(date: Date): number {
  const wall = new Date(0)
  wall.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  wall.setUTCHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds())
  return wall.getTime()
}

const sheetjsDateSkewByOffset = new Map<number, number>()

// SheetJS builds the Date for a date serial from a zone offset rounded to whole
// minutes, so where a zone's offset has seconds (Asia/Phnom_Penh, Asia/Hong_Kong,
// Asia/Kolkata ...) every date lands a few seconds before its midnight and reads
// as the previous day. The error is constant for a zone and offset era; reading
// one serial of that era through the same code measures it.
function measureSheetjsDateSkewMs(serial: number): number {
  try {
    const probe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(probe, { A1: { t: 'n', v: serial, z: 'yyyy-mm-dd' }, '!ref': 'A1' }, 'Probe')
    const bytes = XLSX.write(probe, { bookType: 'xlsx', type: 'array' })
    const cell = XLSX.read(bytes, { type: 'array', cellDates: true }).Sheets.Probe?.A1
    if (cell?.t !== 'd') return 0
    return Math.round(wallClockUtcMs(cell.v as Date) - (SERIAL_EPOCH_UTC_MS + serial * MS_PER_DAY))
  } catch {
    return 0
  }
}

function sheetjsDateSkewMs(date: Date): number {
  const era = date.getTimezoneOffset()
  let skew = sheetjsDateSkewByOffset.get(era)
  if (skew === undefined) {
    skew = measureSheetjsDateSkewMs(Math.floor((wallClockUtcMs(date) - SERIAL_EPOCH_UTC_MS) / MS_PER_DAY))
    sheetjsDateSkewByOffset.set(era, skew)
  }
  return skew
}

// A date cell is a calendar value, not an instant: its fields are read as UTC
// after undoing the early landing, never through toISOString or the local
// getters, so a UTC+ zone cannot step an imported 09/01 back to 08/31. A
// 1904-system workbook counts its serials from 1904-01-01.
function calendarDateText(date: Date, date1904: boolean): string {
  let ms = wallClockUtcMs(date)
  const skew = sheetjsDateSkewMs(date)
  if (skew < 0) ms -= skew
  if (date1904) ms += DAYS_1900_TO_1904_SYSTEM * MS_PER_DAY
  const day = new Date(ms)
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
}

// Reads the stored value, not the display text: .w shows a 13-digit barcode as
// '8.80123E+12' while .v keeps every digit and String() prints it without an
// exponent. The zero-padded rendering above is the one case .w holds a digit
// .v cannot.
function cellToText(cell: XLSX.CellObject | undefined, date1904: boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  switch (cell.t) {
    case 'n':
      return zeroPaddedNumericText(cell) || String(cell.v)
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE'
    case 'd': {
      const date = cell.v as Date
      if (Number.isNaN(date.getTime())) return ''
      return calendarDateText(date, date1904)
    }
    default:
      return String(cell.v)
  }
}

export function workbookToDelimitedText(workbook: XLSX.WorkBook, sheetName?: string): string {
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
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
      const text = cellToText(cell, date1904)
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

export function spreadsheetBytesToDelimitedText(bytes: ArrayBuffer, sheetName?: string): string {
  // cellDates: date-formatted cells come back as Date objects (t 'd') instead
  // of serial numbers.
  return workbookToDelimitedText(XLSX.read(bytes, { type: 'array', cellDates: true }), sheetName)
}
