import assert from 'node:assert/strict'
import { pruneSelectionToVisibleIds } from '../src/utils/rowSelection.ts'

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

await runTest('drops selected ids that are no longer valid/visible', () => {
  const current = new Set([1, 2, 3])
  const valid = new Set([2, 3, 4])
  const result = pruneSelectionToVisibleIds(current, valid)
  assert.deepEqual([...result].sort(), [2, 3])
})

await runTest('keeps every selected id when all are still valid', () => {
  const current = new Set([1, 2])
  const valid = new Set([1, 2, 3])
  const result = pruneSelectionToVisibleIds(current, valid)
  assert.deepEqual([...result].sort(), [1, 2])
})

await runTest('returns an empty Set when nothing overlaps', () => {
  const result = pruneSelectionToVisibleIds(new Set([1, 2]), new Set([3, 4]))
  assert.equal(result.size, 0)
})

await runTest('works with string ids, not just numeric ones (collapsed-section keys)', () => {
  const current = new Set(['2026-04', '2026-05'])
  const valid = new Set(['2026-05', '2026-06'])
  const result = pruneSelectionToVisibleIds(current, valid)
  assert.deepEqual([...result], ['2026-05'])
})

await runTest('accepts a plain array (or any iterable) for validIds, not just a Set', () => {
  const result = pruneSelectionToVisibleIds(new Set([1, 2, 3]), [2, 3])
  assert.deepEqual([...result].sort(), [2, 3])
})

await runTest('null/undefined current or validIds behave like empty, never throw', () => {
  assert.equal(pruneSelectionToVisibleIds(null, new Set([1])).size, 0)
  assert.equal(pruneSelectionToVisibleIds(new Set([1]), null).size, 0)
  assert.equal(pruneSelectionToVisibleIds(undefined, undefined).size, 0)
})

await runTest('returns a new Set instance, never the same reference as the input', () => {
  const current = new Set([1, 2])
  const result = pruneSelectionToVisibleIds(current, new Set([1, 2]))
  assert.notEqual(result, current)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exitCode = 1
}
