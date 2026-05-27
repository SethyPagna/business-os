import assert from 'node:assert/strict'
import { fmtCount, fmtDate, fmtShort, fmtTime } from '../src/utils/formatters.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
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
