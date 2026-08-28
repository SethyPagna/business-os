import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fmtCount, fmtDate, fmtShort, fmtTime, parseServerTimestampMs } from '../src/utils/formatters.ts'

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
  assert.ok(Number.isNaN(parseServerTimestampMs('')), 'empty input stays NaN for the caller to handle')
  // The import tracker's staleness check must use the UTC-aware parser.
  const trackerSource = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  assert.match(trackerSource, /parseServerTimestampMs\(String\(job\?\.updated_at/)
  assert.doesNotMatch(trackerSource, /Date\.parse\(String\(job\?\.updated_at/)
})

if (failed > 0) {
  process.exitCode = 1
}
