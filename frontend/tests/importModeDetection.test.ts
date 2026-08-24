import assert from 'node:assert/strict'
import {
  detectLikelyDatedReconciliation,
  type ImportModeDetectionRow,
} from '../src/components/products/import/importModeDetection.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('a plain add/update file (one row per product) is not flagged', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: 'Serum', branch: 'Main', date: '2026-08-01' },
    { name: 'Toner', branch: 'Main', date: '2026-08-01' },
    { name: 'Cleanser', branch: 'Main', date: '2026-08-02' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, false)
  assert.equal(result.repeatedGroupCount, 0)
  assert.equal(result.sampleProductName, null)
})

await runTest('a genuine dated-snapshot file (same product+branch, several dates) is flagged', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: 'Dior Glassy Glow Stick 017', branch: 'Main', date: '2026-08-16' },
    { name: 'Dior Glassy Glow Stick 017', branch: 'Main', date: '2026-08-18' },
    { name: 'Rare Beauty Blush', branch: 'Main', date: '2026-08-16' },
    { name: 'Rare Beauty Blush', branch: 'Main', date: '2026-08-19' },
    { name: 'Rare Beauty Blush', branch: 'Main', date: '2026-08-21' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, true)
  assert.equal(result.repeatedGroupCount, 2)
  assert.equal(result.sampleProductName, 'Dior Glassy Glow Stick 017')
})

await runTest('one stray duplicate-date row does not alone trigger the suggestion (below the 2-group floor)', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: 'Serum', branch: 'Main', date: '2026-08-01' },
    { name: 'Serum', branch: 'Main', date: '2026-08-05' },
    { name: 'Toner', branch: 'Main', date: '2026-08-01' },
    { name: 'Cleanser', branch: 'Main', date: '2026-08-02' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, false)
  assert.equal(result.repeatedGroupCount, 1)
})

await runTest('the same product name at two different branches is not merged into one group', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: 'Serum', branch: 'Main', date: '2026-08-01' },
    { name: 'Serum', branch: 'Downtown', date: '2026-08-01' },
    { name: 'Toner', branch: 'Main', date: '2026-08-01' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  // Different branches -> each is its own group with only 1 date -> no signal.
  assert.equal(result.likelyDatedReconciliation, false)
  assert.equal(result.repeatedGroupCount, 0)
})

await runTest('name matching is case/whitespace-insensitive, same as the rest of this app\'s grouping rules', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: '  Serum ', branch: 'Main', date: '2026-08-01' },
    { name: 'serum', branch: 'main', date: '2026-08-05' },
    { name: 'Toner', branch: 'Main', date: '2026-08-01' },
    { name: 'TONER', branch: 'MAIN', date: '2026-08-09' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, true)
  assert.equal(result.repeatedGroupCount, 2)
})

await runTest('falls back to received_date when date is blank, matching the Add/Update template\'s own column', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: 'Serum', branch: 'Main', received_date: '2026-08-01' },
    { name: 'Serum', branch: 'Main', received_date: '2026-08-05' },
    { name: 'Toner', branch: 'Main', received_date: '2026-08-01' },
    { name: 'Toner', branch: 'Main', received_date: '2026-08-09' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, true)
  assert.equal(result.repeatedGroupCount, 2)
})

await runTest('rows with no name or no date are ignored rather than crashing or forming a false group', () => {
  const rows: ImportModeDetectionRow[] = [
    { name: '', branch: 'Main', date: '2026-08-01' },
    { name: 'Serum', branch: 'Main', date: '' },
    { name: 'Toner', branch: 'Main' },
  ]
  const result = detectLikelyDatedReconciliation(rows)
  assert.equal(result.likelyDatedReconciliation, false)
  assert.equal(result.repeatedGroupCount, 0)
  assert.equal(result.sampleProductName, null)
})

await runTest('an empty row list returns a safe, non-flagged result', () => {
  const result = detectLikelyDatedReconciliation([])
  assert.equal(result.likelyDatedReconciliation, false)
  assert.equal(result.repeatedGroupCount, 0)
  assert.equal(result.sampleProductName, null)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll importModeDetection tests passed')
}
