import assert from 'node:assert/strict'
import {
  cloneHistorySnapshot,
  extractHistoryResultId,
  resolveCreatedHistorySnapshot,
} from '../src/utils/historyHelpers.mjs'

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

await runTest('cloneHistorySnapshot safely preserves nullish values', () => {
  assert.equal(cloneHistorySnapshot(null), null)
  assert.equal(cloneHistorySnapshot(undefined), undefined)
})

await runTest('extractHistoryResultId accepts common success payload shapes', () => {
  assert.equal(extractHistoryResultId({ id: 12 }), 12)
  assert.equal(extractHistoryResultId({ data: { id: 13 } }), 13)
  assert.equal(extractHistoryResultId({ item: { id: 14 } }), 14)
})

await runTest('resolveCreatedHistorySnapshot prefers an explicit created id', () => {
  const latestItems = [
    { id: 18, name: 'Alpha', client_request_id: 'older' },
    { id: 19, name: 'Beta', client_request_id: 'newer' },
  ]
  const result = resolveCreatedHistorySnapshot({
    result: { id: 19 },
    latestItems,
    clientRequestId: 'older',
  })
  assert.equal(result.id, 19)
  assert.equal(result.snapshot.name, 'Beta')
})

await runTest('resolveCreatedHistorySnapshot falls back to client request id matching', () => {
  const result = resolveCreatedHistorySnapshot({
    result: { success: true },
    latestItems: [
      { id: 22, name: 'Gamma', client_request_id: 'product_history_token' },
    ],
    clientRequestId: 'product_history_token',
    fallbackSnapshot: { name: 'Fallback' },
  })
  assert.equal(result.id, 22)
  assert.equal(result.snapshot.name, 'Gamma')
})

await runTest('resolveCreatedHistorySnapshot falls back to the provided snapshot when needed', () => {
  const result = resolveCreatedHistorySnapshot({
    result: { success: true },
    latestItems: [],
    fallbackSnapshot: { id: 31, name: 'Draft Product' },
  })
  assert.equal(result.id, 31)
  assert.equal(result.snapshot.name, 'Draft Product')
})

if (failed > 0) {
  process.exitCode = 1
}
