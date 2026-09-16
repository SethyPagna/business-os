import assert from 'node:assert/strict'
import {
  applyRowOutcome,
  classifyStockAdjustFailure,
  countRows,
  createRow,
  createRowId,
  dropFailedStockAttempt,
  failedAttemptsKey,
  hasUnsavedFailures,
  readFailedStockAttempts,
  recordFailedStockAttempt,
  rowsToSubmit,
  submitButtonState,
  MAX_FAILED_ATTEMPTS,
  type SimpleStorage,
  type StockAdjustRow,
} from '../src/utils/stockAdjustOutcome.ts'

// The rule this file pins (user, Sep 3): "if the adjustment (add, remove,
// set) fails for any reason it should not forget this... should not close the
// action, keep in same page, so user can edit the failed to correct".
//
// The kernel that makes that possible is pure, so it is tested here without a
// DOM: a failure must never touch a row's typed request, a committed row must
// never re-enter the retry set, and the server's reason must survive intact.

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

type Req = { productId: number; quantity: number; reason: string }

function seed(): StockAdjustRow<Req>[] {
  return [
    createRow({ productId: 1, quantity: 3, reason: 'count' }, 'row-a'),
    createRow({ productId: 2, quantity: 99, reason: 'count' }, 'row-b'),
    createRow({ productId: 3, quantity: 5, reason: 'count' }, 'row-c'),
  ]
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

runTest('a row id is unique and stable once created', () => {
  const ids = new Set([createRowId(), createRowId(), createRowId()])
  assert.equal(ids.size, 3)
  const row = createRow({ productId: 1, quantity: 1, reason: 'x' }, 'fixed')
  assert.equal(row.rowId, 'fixed')
  assert.equal(row.status, 'pending')
  assert.equal(row.failure, null)
})

runTest('a failure never mutates the row values the operator typed', () => {
  const rows = seed()
  const failure = classifyStockAdjustFailure(
    Object.assign(new Error('Cannot remove 99 - only 4 available in shop'), { status: 400 }),
  )
  const next = applyRowOutcome(rows, 'row-b', { status: 'failed', failure })
  const target = next.find((row) => row.rowId === 'row-b')
  assert.ok(target)
  assert.equal(target.status, 'failed')
  // The whole point: the request survives untouched.
  assert.deepEqual(target.request, { productId: 2, quantity: 99, reason: 'count' })
  assert.equal(target.failure?.message, 'Cannot remove 99 - only 4 available in shop')
  // The untouched rows are carried through by reference, not rebuilt.
  assert.equal(next[0], rows[0])
  assert.equal(next[2], rows[2])
})

runTest('a committed row is never resubmitted -- the no-double-apply guarantee', () => {
  let rows = seed()
  rows = applyRowOutcome(rows, 'row-a', { status: 'done' })
  rows = applyRowOutcome(rows, 'row-c', { status: 'done' })
  rows = applyRowOutcome(rows, 'row-b', {
    status: 'failed',
    failure: classifyStockAdjustFailure(new Error('Only 4 available in this batch at this branch')),
  })
  const retry = rowsToSubmit(rows)
  assert.deepEqual(retry.map((row) => row.rowId), ['row-b'])
  // Even after the retry succeeds, the done rows stay out of the set.
  const settled = applyRowOutcome(rows, 'row-b', { status: 'done' })
  assert.deepEqual(rowsToSubmit(settled), [])
  assert.deepEqual(countRows(settled), { total: 3, done: 3, failed: 0, pending: 0 })
})

runTest('marking a row done or pending clears its stale failure', () => {
  let rows = seed()
  rows = applyRowOutcome(rows, 'row-a', {
    status: 'failed',
    failure: classifyStockAdjustFailure(new Error('boom')),
  })
  assert.ok(rows[0].failure)
  rows = applyRowOutcome(rows, 'row-a', { status: 'done' })
  assert.equal(rows[0].failure, null)
})

runTest('insufficient stock is classified with the available quantity', () => {
  const branchShort = classifyStockAdjustFailure(
    Object.assign(new Error('Cannot remove 10 - only 2 available in shop'), { status: 400 }),
  )
  assert.equal(branchShort.kind, 'insufficient_stock')
  assert.equal(branchShort.available, 2)
  assert.equal(branchShort.requested, 10)
  assert.equal(branchShort.retryable, true)
  assert.equal(branchShort.offline, false)

  const batchShort = classifyStockAdjustFailure(new Error('Only 4 available in this batch at this branch'))
  assert.equal(batchShort.kind, 'insufficient_stock')
  assert.equal(batchShort.available, 4)

  const noStock = classifyStockAdjustFailure(new Error('No stock in this branch to remove'))
  assert.equal(noStock.kind, 'insufficient_stock')
  assert.equal(noStock.available, null)
})

runTest('offline / write-blocked failures are marked keep-the-rows, not discard', () => {
  const blocked = classifyStockAdjustFailure(Object.assign(
    new Error('Server is offline. Changes are invalid until the server reconnects.'),
    { code: 'write_requires_live_server', reason: 'server_offline' },
  ))
  assert.equal(blocked.kind, 'offline')
  assert.equal(blocked.offline, true)
  assert.equal(blocked.retryable, true)

  const unreachable = classifyStockAdjustFailure(Object.assign(new Error('nope'), { reason: 'server_unreachable' }))
  assert.equal(unreachable.kind, 'offline')

  const fetchDied = classifyStockAdjustFailure(new TypeError('Failed to fetch'))
  assert.equal(fetchDied.kind, 'offline')
  assert.equal(fetchDied.offline, true)
})

runTest('validation, permission, conflict and server failures are told apart', () => {
  const validation = classifyStockAdjustFailure(
    Object.assign(new Error('A reason is required for stock adjustments'), { status: 400 }),
  )
  assert.equal(validation.kind, 'validation')
  assert.equal(validation.retryable, true)

  const forbidden = classifyStockAdjustFailure(
    Object.assign(new Error('Stock adjustments require Full Access to Inventory'), { status: 403 }),
  )
  assert.equal(forbidden.kind, 'permission')
  // A retry cannot fix a permission refusal -- the UI must not offer one.
  assert.equal(forbidden.retryable, false)

  const conflict = classifyStockAdjustFailure(
    Object.assign(new Error('This item changed on another device. Refresh and try again.'), { status: 409 }),
  )
  assert.equal(conflict.kind, 'conflict')

  const boom = classifyStockAdjustFailure(Object.assign(new Error('Internal error'), { status: 500 }))
  assert.equal(boom.kind, 'server')
})

runTest('a `{success:false, error}` body classifies like a thrown rejection', () => {
  const fromBody = classifyStockAdjustFailure({ success: false, error: 'Cannot remove 7 - only 1 available in shop', status: 400 })
  assert.equal(fromBody.kind, 'insufficient_stock')
  assert.equal(fromBody.available, 1)
  // Nothing usable at all still produces a message rather than an empty box.
  assert.equal(classifyStockAdjustFailure(undefined).message, 'Adjustment failed')
})

runTest('the submit button reads Retry while failures exist', () => {
  const clean = seed()
  assert.deepEqual(submitButtonState(clean), { mode: 'submit', failedCount: 0, doneCount: 0 })
  assert.equal(hasUnsavedFailures(clean), false)

  let rows = applyRowOutcome(clean, 'row-a', { status: 'done' })
  rows = applyRowOutcome(rows, 'row-b', {
    status: 'failed',
    failure: classifyStockAdjustFailure(new Error('nope')),
  })
  rows = applyRowOutcome(rows, 'row-c', {
    status: 'failed',
    failure: classifyStockAdjustFailure(new Error('nope')),
  })
  assert.deepEqual(submitButtonState(rows), { mode: 'retry', failedCount: 2, doneCount: 1 })
  assert.equal(hasUnsavedFailures(rows), true)
})

runTest('failed attempts persist per user, newest first, and can be dropped', () => {
  const storage = memoryStorage()
  const failure = classifyStockAdjustFailure(new Error('Cannot remove 5 - only 2 available in shop'))
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
