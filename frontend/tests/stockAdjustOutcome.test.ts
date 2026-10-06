import assert from 'node:assert/strict'
import {
  dropFailedStockAttempt,
  failedAttemptsKey,
  readFailedStockAttempts,
  recordFailedStockAttempt,
  MAX_FAILED_ATTEMPTS,
  type SimpleStorage,
  type StockAdjustFailure,
} from '../src/utils/stockAdjustOutcome.ts'

// The rule this file pins (user, Sep 3): "if the adjustment (add, remove,
// set) fails for any reason it should not forget this... should not close the
// action ... also show the failed in the stock change as well". The unsaved
// failed attempt store is pure, so it is tested here without a DOM. The per-row
// retry kernel that sat beside it left with the retired adjust modals.

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function memoryStorage(): SimpleStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => (map.has(key) ? String(map.get(key)) : null),
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
  }
}

runTest('failed attempts persist per user, newest first, and can be dropped', () => {
  const storage = memoryStorage()
  const failure: StockAdjustFailure = {
    kind: 'insufficient_stock', code: '', message: 'Cannot remove 5 - only 2 available in shop',
    available: 2, requested: 5, status: 400, retryable: true, offline: false,
  }
  const attempt = (id: string) => ({
    id,
    createdAt: '2026-09-03T04:00:00.000Z',
    source: 'adjust',
    rows: [{
      rowId: `${id}-r1`,
      productId: 7,
      productName: 'Widget',
      type: 'remove',
      quantity: 5,
      branchId: 1,
      branchName: 'shop',
      batchId: null,
      receivedDate: '',
      reason: 'stock count',
      note: '',
      failure,
    }],
  })

  recordFailedStockAttempt(storage, 42, attempt('a1'))
  recordFailedStockAttempt(storage, 42, attempt('a2'))
  const stored = readFailedStockAttempts(storage, 42)
  assert.deepEqual(stored.map((entry) => entry.id), ['a2', 'a1'])
  // Every value the operator typed comes back with it.
  assert.equal(stored[1].rows[0].quantity, 5)
  assert.equal(stored[1].rows[0].reason, 'stock count')
  assert.equal(stored[1].rows[0].failure.available, 2)

  // Per user -- another user sees none of it.
  assert.deepEqual(readFailedStockAttempts(storage, 43), [])
  assert.ok(storage.map.has(failedAttemptsKey(42)))

  // Re-recording the same id replaces rather than duplicates.
  recordFailedStockAttempt(storage, 42, attempt('a1'))
  assert.deepEqual(readFailedStockAttempts(storage, 42).map((entry) => entry.id), ['a1', 'a2'])

  const remaining = dropFailedStockAttempt(storage, 42, 'a1')
  assert.deepEqual(remaining.map((entry) => entry.id), ['a2'])
  assert.deepEqual(readFailedStockAttempts(storage, 42).map((entry) => entry.id), ['a2'])
})

runTest('the stored list is capped and survives corrupt or blocked storage', () => {
  const storage = memoryStorage()
  for (let i = 0; i < MAX_FAILED_ATTEMPTS + 5; i += 1) {
    recordFailedStockAttempt(storage, 'u', { id: `a${i}`, createdAt: '', source: 'adjust', rows: [] })
  }
  assert.equal(readFailedStockAttempts(storage, 'u').length, MAX_FAILED_ATTEMPTS)

  storage.map.set(failedAttemptsKey('u'), '{not json')
  assert.deepEqual(readFailedStockAttempts(storage, 'u'), [])

  const hostile: SimpleStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  // A blocked store must never take the modal down -- the rows are still on
  // screen, which is the part the user asked never to lose.
  assert.deepEqual(readFailedStockAttempts(hostile, 'u'), [])
  assert.doesNotThrow(() => recordFailedStockAttempt(hostile, 'u', { id: 'x', createdAt: '', source: 'adjust', rows: [] }))
  assert.deepEqual(readFailedStockAttempts(null, 'u'), [])
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nstockAdjustOutcome tests passed')
