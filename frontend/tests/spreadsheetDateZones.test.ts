// N1 (SONNET-REFUTE-SHEET-WORKER): an Excel date stored as a serial number
// ("01/09/2026" is 46266) must import as that calendar date on every device,
// whatever its time zone. SheetJS 0.18.5 builds the Date for a serial with a
// zone offset rounded to whole minutes, so in zones where that lands a few
// seconds early (Asia/Phnom_Penh, Asia/Hong_Kong, Asia/Kolkata ...) the date
// steps back a day: 2026-08-31 instead of 2026-09-01. A 1904-system workbook
// also read as a 1900-system one.
//
// Each zone runs in its own child process (TZ is process-wide) and parses
// real xlsx bytes written by the app's writer through the real conversion.
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
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: Boolean(spec.dates) })
  out[name] = spreadsheetBytesToDelimitedText(bytes).split('\\n')
}
process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out }))
`

function expectedDate(serial: number, date1904: boolean): string {
  const day = new Date(Date.UTC(1899, 11, 30) + (Math.floor(serial) + (date1904 ? 1462 : 0)) * MS_PER_DAY)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

const ANCHORS = [46266, 25569, 36526, 44000, 45000, 46023, 46631]
const ANCHOR_DATES = ['2026-09-01', '1970-01-01', '2000-01-01', '2020-06-18', '2023-03-15', '2026-01-01', '2027-09-01']

const ISO_DATES = [[2026, 8, 1], [2026, 0, 1], [2023, 2, 15], [2020, 5, 18], [2027, 11, 31], [1990, 6, 4]]
const ISO_EXPECTED = ['2026-09-01', '2026-01-01', '2023-03-15', '2020-06-18', '2027-12-31', '1990-07-04']

const MAIN_ZONES = ['Asia/Phnom_Penh', 'Asia/Hong_Kong', 'UTC', 'America/New_York']
const EXTRA_ZONES = [
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Kathmandu', 'Africa/Monrovia', 'America/Sao_Paulo',
  'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Honolulu', 'Australia/Lord_Howe', 'Europe/London',
]

function casesFor(zone: string) {
  const full = MAIN_ZONES.includes(zone)
  return {
    anchors: { serials: ANCHORS, format: 'dd/mm/yyyy', date1904: false },
    sweep: { serials: full ? range(42005, 49310) : range(45292, 46752), format: 'dd/mm/yyyy', date1904: false },
    withTime: { serials: [46266.5, 46266.999, 46265.999, 46266.00001, 46266.25], format: 'dd/mm/yyyy hh:mm:ss', date1904: false },
    book1904: { serials: [0, 1, 44000 - 1462, 46266 - 1462, 46631 - 1462], format: 'dd/mm/yyyy', date1904: true },
    timeOnly: { serials: [0.5, 0.25], format: 'hh:mm', date1904: false },
    isoDates: { dates: ISO_DATES, serials: [], format: '', date1904: false },
  }
}

let passed = 0
function runZone(zone: string) {
  const cases = casesFor(zone)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: frontendRoot,
    env: { ...process.env, TZ: zone, WORKBOOK_MODULE: workbookModule, DATE_CASES: JSON.stringify(cases) },
    encoding: 'utf8',
    timeout: 240_000,
  })
  assert.equal(result.status, 0, `${zone}: child failed\n${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as { zone: string; out: Record<string, string[]> }
  assert.equal(parsed.zone, new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone, `the child really ran in ${zone}`)

  assert.deepEqual(parsed.out.anchors, ANCHOR_DATES, `${zone}: anchor dates`)
  assert.deepEqual(parsed.out.anchors, ANCHORS.map((s) => expectedDate(s, false)))

  const sweep = cases.sweep.serials
  const wrong = sweep.filter((s, i) => parsed.out.sweep[i] !== expectedDate(s, false))
  assert.equal(wrong.length, 0, `${zone}: ${wrong.length} of ${sweep.length} daily dates are off, first serial ${wrong[0]} read as ${parsed.out.sweep[sweep.indexOf(wrong[0])]} (expected ${wrong[0] === undefined ? '' : expectedDate(wrong[0], false)})`)

  assert.deepEqual(parsed.out.withTime, cases.withTime.serials.map((s) => expectedDate(s, false)), `${zone}: a time of day never moves the date`)
  assert.deepEqual(parsed.out.book1904, cases.book1904.serials.map((s) => expectedDate(s, true)), `${zone}: 1904-system workbook`)
  assert.deepEqual(parsed.out.book1904.slice(0, 2), ['1904-01-01', '1904-01-02'])
  assert.deepEqual(parsed.out.isoDates, ISO_EXPECTED, `${zone}: a date stored as a date (not a serial) keeps its day`)
  assert.deepEqual(parsed.out.timeOnly, ['1899-12-30', '1899-12-30'], `${zone}: a time-only cell keeps its existing 1899-12-30 date`)
  passed += 1
  console.log(`PASS ${zone}: ${sweep.length} daily serials, anchors, times of day, 1904 book, time-only`)
}

for (const zone of [...MAIN_ZONES, ...EXTRA_ZONES]) runZone(zone)

console.log(`ALL PASS spreadsheetDateZones (${passed} zones)`)
