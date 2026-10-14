// An Excel date cell imports as the calendar date the sheet shows, on every
// device time zone and from every file kind: .xlsx, .xls (BIFF8 and BIFF5),
// .xlsb, XML 2003, HTML or CSV saved as .xls, and cells stored as t="d" text.
// A date-time anywhere in the day, 00:00:00 to 23:59:59, keeps its own date.
//
// Each zone runs in its own child process (TZ is process-wide) and parses real
// workbook bytes written by the app's writer through the real conversion.
// Expected dates are computed here with plain UTC day arithmetic.
//
// Run: node tests/spreadsheetDateZones.test.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.join(here, '..')
const workbookModule = pathToFileURL(path.join(frontendRoot, 'src', 'utils', 'spreadsheetWorkbook.ts')).href

const MS_PER_DAY = 86_400_000
const EPOCH_UTC_MS = Date.UTC(1899, 11, 30)

const CHILD = `
const XLSX = await import('xlsx')
const { spreadsheetBytesToDelimitedText } = await import(process.env.WORKBOOK_MODULE)
const cases = JSON.parse(process.env.DATE_CASES)
const out = {}
for (const [name, spec] of Object.entries(cases)) {
  const sheet = {}
  const cells = spec.dates ? spec.dates.map(([y, m, d]) => ({ t: 'd', v: new Date(y, m, d) })) : spec.serials.map((v) => ({ t: 'n', v, z: spec.format }))
  cells.forEach((cell, r) => { sheet[XLSX.utils.encode_cell({ r, c: 0 })] = cell })
  sheet['!ref'] = 'A1:A' + cells.length
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'S')
  if (spec.date1904) wb.Workbook = { WBProps: { date1904: true } }
  const bytes = XLSX.write(wb, { bookType: spec.bookType || 'xlsx', type: 'array', cellDates: Boolean(spec.dates) })
  out[name] = spreadsheetBytesToDelimitedText(bytes).split('\\n')
}
process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }))
`

const FIRST_DATE_CHILD = `
const XLSX = await import('xlsx')
const { spreadsheetBytesToDelimitedText } = await import(process.env.WORKBOOK_MODULE)
const sheet = {}
JSON.parse(process.env.FIRST_CASE).forEach((v, r) => { sheet['A' + (r + 1)] = { t: 'n', v, z: 'dd/mm/yyyy' } })
sheet['!ref'] = 'A1:A4'
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, sheet, 'S')
const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out: spreadsheetBytesToDelimitedText(bytes).split('\\n') }))
`

const PATHS_CHILD = `
const XLSX = await import('xlsx')
const { spreadsheetBytesToDelimitedText } = await import(process.env.WORKBOOK_MODULE)
const { days, seconds } = JSON.parse(process.env.PATH_CASES)
const EPOCH = Date.UTC(1899, 11, 30)
const pad = (n) => String(n).padStart(2, '0')
const clock = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
const dayOf = (serial) => new Date(EPOCH + serial * 86400000)
const convert = (bytes) => {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  return spreadsheetBytesToDelimitedText(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)).split('\\n')
}
const book = (cells) => {
  const sheet = {}
  cells.forEach((cell, r) => { sheet['A' + (r + 1)] = cell })
  sheet['!ref'] = 'A1:A' + cells.length
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'S')
  return wb
}
const cartesian = days.flatMap((day) => seconds.map((s) => ({ day, s })))
const encode = (text) => new TextEncoder().encode(text)
const out = {}

for (const bookType of ['xlsx', 'biff8', 'biff5', 'xlsb', 'xlml']) {
  const wb = book(cartesian.map(({ day, s }) => ({ t: 'n', v: day + s / 86400, z: 'yyyy-mm-dd hh:mm:ss' })))
  out[bookType] = convert(XLSX.write(wb, { bookType, type: 'array' }))
}

const usText = ({ day, s }) => {
  const d = dayOf(day)
  const [h, m, sec] = clock(s)
  return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear() + ' ' + pad(h) + ':' + pad(m) + ':' + pad(sec)
}
out.html = convert(encode('<table>' + cartesian.map((c) => '<tr><td>' + usText(c) + '</td></tr>').join('') + '</table>'))
out.csv = convert(encode(cartesian.map(usText).join('\\n')))

out.literal = convert(XLSX.write(book(cartesian.map(({ day, s }) => {
  const d = dayOf(day)
  const [h, m, sec] = clock(s)
  return { t: 'd', v: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, sec) }
})), { bookType: 'xlsx', type: 'array', cellDates: true }))

out.book1904 = {}
for (const bookType of ['xlsx', 'biff8', 'biff5']) {
  const wb = book([0, 1, 59, 60, 44000 - 1462, 46266 - 1462].map((v) => ({ t: 'n', v, z: 'dd/mm/yyyy' })))
  wb.Workbook = { WBProps: { date1904: true } }
  out.book1904[bookType] = convert(XLSX.write(wb, { bookType, type: 'array' }))
}

out.leap1900 = {}
for (const bookType of ['xlsx', 'biff8']) {
  out.leap1900[bookType] = convert(XLSX.write(book([1, 31, 32, 59, 61].map((v) => ({ t: 'n', v, z: 'dd/mm/yyyy' }))), { bookType, type: 'array' }))
}
process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }))
`

function isoDay(utcMs: number): string {
  const day = new Date(utcMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
}

function expectedDate(serial: number, date1904: boolean): string {
  return isoDay(EPOCH_UTC_MS + (Math.floor(serial) + (date1904 ? 1462 : 0)) * MS_PER_DAY)
}

const serialOf = (year: number, month: number, day: number) => (Date.UTC(year, month - 1, day) - EPOCH_UTC_MS) / MS_PER_DAY

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

const ANCHORS = [46266, 25569, 36526, 44000, 45000, 46023, 46631]
const ANCHOR_DATES = ['2026-09-01', '1970-01-01', '2000-01-01', '2020-06-18', '2023-03-15', '2026-01-01', '2027-09-01']

const ISO_DATES = [[2026, 8, 1], [2026, 0, 1], [2023, 2, 15], [2020, 5, 18], [2027, 11, 31], [1990, 6, 4]]
const ISO_EXPECTED = ['2026-09-01', '2026-01-01', '2023-03-15', '2020-06-18', '2027-12-31', '1990-07-04']

const MAIN_ZONES = ['Asia/Phnom_Penh', 'Asia/Hong_Kong', 'UTC', 'America/New_York']
const EXTRA_ZONES = [
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Kathmandu', 'Africa/Monrovia', 'America/Sao_Paulo',
  'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Honolulu', 'Australia/Lord_Howe', 'Europe/London', 'America/St_Johns',
]

// Seconds into the day: the first and last moments, where a few seconds of
// zone error moves a date, and the middle.
const SECONDS_OF_DAY = [0, 1, 3, 30, 43_200, 86_340, 86_370, 86_395, 86_398, 86_399]
const PATH_DAYS = [46266, 46630, 44000]
// The first date cell of a file is a date from an old offset era of its zone;
// each runs in a child of its own so no earlier file has warmed anything.
const FIRST_DATES = [serialOf(1904, 10, 31), serialOf(1906, 1, 2), serialOf(1920, 1, 1), serialOf(1920, 4, 1), serialOf(1920, 4, 2)]
const FIRST_DATE_ZONES = ['Asia/Phnom_Penh', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Singapore']

function casesFor(zone: string) {
  const full = MAIN_ZONES.includes(zone)
  return {
    anchors: { serials: ANCHORS, format: 'dd/mm/yyyy', date1904: false },
    sweep: { serials: full ? range(42005, 49310) : range(45292, 46752), format: 'dd/mm/yyyy', date1904: false },
    withTime: { serials: [46266.5, 46266.999, 46265.999, 46266.00001, 46266.25, 46266.999988], format: 'dd/mm/yyyy hh:mm:ss', date1904: false },
    book1904: { serials: [0, 1, 44000 - 1462, 46266 - 1462, 46631 - 1462], format: 'dd/mm/yyyy', date1904: true },
    timeOnly: { serials: [0.5, 0.25], format: 'hh:mm', date1904: false },
    isoDates: { dates: ISO_DATES, serials: [], format: '', date1904: false },
  }
}

function runChild(zone: string, script: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: frontendRoot,
    env: { ...process.env, TZ: zone, WORKBOOK_MODULE: workbookModule, ...env },
    encoding: 'utf8',
    timeout: 240_000,
  })
  assert.equal(result.status, 0, `${zone}: child failed\n${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as { zone: string; out: Record<string, any> }
  assert.equal(parsed.zone, new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone, `the child really ran in ${zone}`)
  return parsed.out
}

let passed = 0
function runZone(zone: string) {
  const cases = casesFor(zone)
  const out = runChild(zone, CHILD, { DATE_CASES: JSON.stringify(cases) }) as Record<string, string[]>

  assert.deepEqual(out.anchors, ANCHOR_DATES, `${zone}: anchor dates`)
  assert.deepEqual(out.anchors, ANCHORS.map((s) => expectedDate(s, false)))

  const sweep = cases.sweep.serials
  const wrong = sweep.filter((s, i) => out.sweep[i] !== expectedDate(s, false))
  assert.equal(wrong.length, 0, `${zone}: ${wrong.length} of ${sweep.length} daily dates are off, first serial ${wrong[0]} read as ${out.sweep[sweep.indexOf(wrong[0])]} (expected ${wrong[0] === undefined ? '' : expectedDate(wrong[0], false)})`)

  assert.deepEqual(out.withTime, cases.withTime.serials.map((s) => expectedDate(s, false)), `${zone}: a time of day never moves the date`)
  assert.deepEqual(out.book1904, cases.book1904.serials.map((s) => expectedDate(s, true)), `${zone}: 1904-system workbook`)
  assert.deepEqual(out.book1904.slice(0, 2), ['1904-01-01', '1904-01-02'])
  assert.deepEqual(out.isoDates, ISO_EXPECTED, `${zone}: a date stored as a date (not a serial) keeps its day`)
  assert.deepEqual(out.timeOnly, ['1899-12-30', '1899-12-30'], `${zone}: a time-only cell keeps its 1899-12-30 date`)
  passed += 1
  console.log(`PASS ${zone}: ${sweep.length} daily serials, anchors, times of day, 1904 book, time-only`)
}

function runFirstDateZone(zone: string) {
  for (const first of FIRST_DATES) {
    const serials = [first, 46266, 36526, 45000]
    const out = runChild(zone, FIRST_DATE_CHILD, { FIRST_CASE: JSON.stringify(serials) })
    assert.deepEqual(out, serials.map((s) => expectedDate(s, false)), `${zone}: a file whose first date is serial ${first} reads every date exactly`)
  }
  passed += 1
  console.log(`PASS ${zone}: ${FIRST_DATES.length} files that open on an old-era date`)
}

const PATH_ZONES = [
  'Asia/Phnom_Penh', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/St_Johns', 'Asia/Singapore',
  'Africa/Monrovia', 'America/Sao_Paulo', 'Europe/London', 'America/New_York', 'Pacific/Auckland', 'UTC',
]

function runPathsZone(zone: string) {
  const out = runChild(zone, PATHS_CHILD, { PATH_CASES: JSON.stringify({ days: PATH_DAYS, seconds: SECONDS_OF_DAY }) })
  const expectedRows = PATH_DAYS.flatMap((day) => SECONDS_OF_DAY.map(() => expectedDate(day, false)))

  for (const kind of ['xlsx', 'biff8', 'biff5', 'xlsb', 'xlml', 'html', 'csv', 'literal']) {
    assert.deepEqual(out[kind], expectedRows, `${zone}: ${kind} date-times from 00:00:00 to 23:59:59 keep their own date`)
  }

  const book1904 = [0, 1, 59, 60, 44000 - 1462, 46266 - 1462].map((s) => expectedDate(s, true))
  for (const kind of ['xlsx', 'biff8', 'biff5']) assert.deepEqual(out.book1904[kind], book1904, `${zone}: ${kind} 1904-system workbook`)
  assert.deepEqual(book1904.slice(0, 4), ['1904-01-01', '1904-01-02', '1904-02-29', '1904-03-01'])

  const leap1900 = ['1900-01-01', '1900-01-31', '1900-02-01', '1900-02-28', '1900-03-01']
  for (const kind of ['xlsx', 'biff8']) assert.deepEqual(out.leap1900[kind], leap1900, `${zone}: ${kind} serials 1 to 61 follow Excel's 1900 calendar`)
  passed += 1
  console.log(`PASS ${zone}: ${PATH_DAYS.length * SECONDS_OF_DAY.length} date-times through xlsx, biff8, biff5, xlsb, xlml, html, csv and t="d"`)
}

for (const zone of [...MAIN_ZONES, ...EXTRA_ZONES]) runZone(zone)
for (const zone of PATH_ZONES) runPathsZone(zone)
for (const zone of FIRST_DATE_ZONES) runFirstDateZone(zone)

console.log(`ALL PASS spreadsheetDateZones (${passed} zone runs)`)
