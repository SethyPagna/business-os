import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fmtClock24, fmtCount, fmtDate, fmtDateTime24, fmtShort, fmtTime, fmtTimezoneLabel, parseServerTimestampMs } from '../src/utils/formatters.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('formatters keep empty timestamps stable', () => {
  assert.equal(fmtTime(''), fmtDate(null))
  assert.notEqual(fmtTime(''), '')
})

await runTest('formatters accept database timestamp shapes', () => {
  assert.notEqual(fmtTime('2026-05-19 10:30:00'), 'â€”')
  assert.notEqual(fmtDate('2026-05-19T10:30:00+0700'), 'â€”')
  assert.match(fmtClock24('2026-05-19 10:30:00'), /^\d{2}:\d{2}$/)
})

await runTest('receipt date formatting accepts every supported timestamp representation', () => {
  const instant = Date.parse('2026-09-02T01:59:00.000Z')
  // 2026-09-02 is the 2nd day of the 9th month: day-first renders 02/09.
  // (User, Sep 4 2026: 'change the whole app to dd-mm-yyy'.) What this test
  // really pins is that ALL five timestamp representations agree -- that
  // contract is unchanged; only the order inside the string moved.
  const expected = '02/09/2026 08:59'
  assert.equal(fmtDateTime24(instant), expected)
  assert.equal(fmtDateTime24(new Date(instant)), expected)
  assert.equal(fmtDateTime24('2026-09-02T01:59:00.000Z'), expected)
  assert.equal(fmtDateTime24('2026-09-02 01:59:00'), expected)
  assert.equal(fmtDateTime24('2026-09-02 08:59:00+07:00'), expected)
  const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  assert.match(receiptSource, /const dateStr = fmtDateTime24\(createdAt \|\| new Date\(\)\)/)
})

await runTest('day-grouped sales use time only while the clicked detail keeps the full timestamp', () => {
  const listPage = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const detailPage = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  assert.match(listPage, /fmtTime=\{fmtClock24\}/)
  assert.match(detailPage, /fmtTime\(sale\.created_at\)/)
})

await runTest('short numeric formatters abbreviate values', () => {
  assert.equal(fmtShort(1200), '$1.2k')
  assert.equal(fmtShort(3_500_000), '$3.5M')
  assert.equal(fmtCount(1249), '1.2k')
})

await runTest('Y8: server timestamps parse as UTC regardless of the viewer timezone', () => {
  // SQLite CURRENT_TIMESTAMP writes timezone-less UTC. A bare Date.parse
  // reads that shape as LOCAL time, which made every active import job look
  // hours stale to a UTC+7 viewer (the false "may have stopped" warning).
  assert.equal(parseServerTimestampMs('2026-08-28 14:33:20'), Date.parse('2026-08-28T14:33:20Z'))
  assert.equal(parseServerTimestampMs('2026-08-28T14:33:20Z'), Date.parse('2026-08-28T14:33:20Z'))
  assert.equal(parseServerTimestampMs('2026-08-28T14:33:20+07:00'), Date.parse('2026-08-28T07:33:20Z'))
  // DATE-ONLY values end in "-DD". They must be recognized before the
  // short-offset parser or 2026-09-01 becomes the invalid 2026-09-01:00.
  assert.equal(parseServerTimestampMs('2026-09-01'), Date.parse('2026-09-01T00:00:00Z'))
  assert.notEqual(fmtDate('2026-09-01'), '—')
  assert.ok(Number.isNaN(parseServerTimestampMs('')), 'empty input stays NaN for the caller to handle')
  // The import tracker's staleness check must use the UTC-aware parser.
  const trackerSource = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  assert.match(trackerSource, /parseServerTimestampMs\(String\(job\?\.updated_at/)
  assert.doesNotMatch(trackerSource, /Date\.parse\(String\(job\?\.updated_at/)
})

await runTest('timezone labels say Phnom Penh, never Bangkok (user, Aug 30 2026)', () => {
  // Same UTC+07:00 wall clock -- naming only, values elsewhere untouched.
  assert.equal(fmtTimezoneLabel('Asia/Bangkok'), 'Asia/Phnom_Penh')
  assert.equal(fmtTimezoneLabel('Asia/Phnom_Penh'), 'Asia/Phnom_Penh')
  assert.equal(fmtTimezoneLabel('  Asia/Bangkok  '), 'Asia/Phnom_Penh')
  assert.equal(fmtTimezoneLabel('Europe/Paris'), 'Europe/Paris')
  assert.equal(fmtTimezoneLabel(null), '')
  // Every surface that prints a captured zone routes through the label.
  const auditLog = fs.readFileSync(new URL('../src/components/utils-settings/AuditLog.tsx', import.meta.url), 'utf8')
  assert.match(auditLog, /fmtTimezoneLabel\(log\?\.device_tz\)/)
  const saleDetail = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  // S4-24 (user, Sep 4 2026): the sale detail stopped showing a Timezone row
  // at all -- it reads like a receipt now, and no receipt prints one. The rule
  // this case exists for is unchanged and gets stricter here: the surface must
  // not print a captured zone RAW either, which is the only way Bangkok could
  // still reach a reader from this file.
  assert.doesNotMatch(saleDetail, /{s*sale.device_tzs*}/, 'the sale detail must never print a raw captured timezone')
  const serverPage = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')
  assert.match(serverPage, /fmtTimezoneLabel\(settings\?\.display_timezone \|\| displayTimezone\)/)
  assert.match(serverPage, /fmtTimezoneLabel\(deviceTimezone\)/)
  const settingsPage = fs.readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
  assert.match(settingsPage, /fmtTimezoneLabel\(deviceTimezone\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
