import assert from 'node:assert/strict'
import { createProductHistoryRequestId, orderProductRestoreSnapshots } from '../src/components/products/productHistoryHelpers.mjs'

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

await runTest('orderProductRestoreSnapshots restores parents before their deleted children', () => {
  const ordered = orderProductRestoreSnapshots([
    { id: 2, name: 'Child', parent_id: 1 },
    { id: 1, name: 'Parent', parent_id: null },
  ])
  assert.deepEqual(ordered.map((item) => item.id), [1, 2])
})

await runTest('orderProductRestoreSnapshots preserves independent items while honoring parent dependencies', () => {
  const ordered = orderProductRestoreSnapshots([
    { id: 4, name: 'Solo', parent_id: null },
    { id: 2, name: 'Child', parent_id: 1 },
    { id: 1, name: 'Parent', parent_id: null },
  ])
  assert.equal(ordered[0].id, 4)
  assert.equal(ordered[1].id, 1)
  assert.equal(ordered[2].id, 2)
})

await runTest('createProductHistoryRequestId creates a stable prefixed restore token', () => {
  const value = createProductHistoryRequestId('product_restore')
  assert.match(value, /^product_restore_\d+_[a-z0-9]+$/)
})

if (failed > 0) {
  process.exitCode = 1
}
