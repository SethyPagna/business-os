import assert from 'node:assert/strict'
import { fmtCount, fmtDate, fmtShort, fmtTime } from '../src/utils/formatters.ts'

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

if (failed > 0) {
  process.exitCode = 1
}
