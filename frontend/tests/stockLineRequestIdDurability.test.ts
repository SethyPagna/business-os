import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The POS defect, in the stock-in flow.
//
// POS persisted the PENDING checkout id before the request but left the
// COMMITTED state to a React effect that ran after render; a render crash
// (Chrome Translate mangling the DOM into a React removeChild error) meant the
// order stayed pending forever and every retry re-fetched and re-crashed.
//
// FastStockInModal had the same shape and worse consequences: the work draft
// was written by a DEBOUNCED effect (scheduleWorkDraftWrite, 800ms) and
// performCommit/performCommitSequential moved each line saving -> saved in
// React state only. A crash between the response and the debounce left every
// line reading "queued" in localStorage, and commitSession re-sends everything
// that is not 'saved' -- so the retry posted stock the server had already
// applied. Nothing on the Worker side deduped it (see
// cloudflare/scripts/test-stock-mutation-receipt-pure.cjs for that half).
//
// This file pins the client half: a stable per-line id minted once and
// persisted in the SAME tick as the line, and every committed outcome written
// synchronously BEFORE it is handed to React.

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

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
}

const fastStockIn = source('components/inventory/FastStockInModal.tsx')

runTest('every queued fast stock-in line carries a stable dedup id minted once', () => {
  assert.match(fastStockIn, /requestId: string/, 'a line must carry its own request id')
  assert.match(
    fastStockIn,
    /requestId: \(editingKey \? received\.find\(\(line\) => line\.key === editingKey\)\?\.requestId : ''\) \|\| createClientRequestId\('stockline'\)/,
    'editing a queued line must REUSE its id; only a genuinely new line mints one',
  )
  // A restored draft written before this field existed must not commit with an
  // empty id, which the Worker would read as "no id" and happily double-apply.
  assert.match(
    fastStockIn,
    /requestId: line\.requestId \|\| createClientRequestId\('stockline'\)/,
    'an older draft restores with a minted id rather than none',
  )
  assert.match(fastStockIn, /import \{ createClientRequestId \} from '\.\.\/\.\.\/api\/requestIds\.ts'/)
})

runTest('the id reaches the Worker on both stock wires', () => {
  // Last field of each adjust body, deliberately: tests/stockInModeSwitch.test.ts
  // pins the receipt fields of all three bodies in their original order.
  const adjustBodies = fastStockIn.match(/sessionId: sessionIdRef\.current,[\s\S]{0,320}?client_request_id: line\.requestId,\s*\r?\n\s*\} \}/g) || []
  assert.equal(adjustBodies.length, 3, 'all three adjust-wire bodies (remove, set, tagged add) send the id')
  assert.match(
    fastStockIn,
    /wire: 'receive', body: \{\s*\n\s*clientRequestId: line\.requestId,/,
    'the receive wire sends the id too',
  )
  const transport = source('api/batchesTransport.ts')
  assert.match(
    transport,
    /client_request_id: payload\.clientRequestId \|\| null,/,
    'receiveBatchWireBody must forward the id to POST /api/batches',
  )
})

runTest('a line is durable BEFORE React renders it, never only after a debounce', () => {
  // The debounced autosave stays -- it is right for keystrokes. What must not
  // depend on it is a FACT: the id of a queued line and the saved status of a
  // committed one.
  assert.match(fastStockIn, /scheduleWorkDraftWrite<FastStockInDraft>/, 'the keystroke autosave is retained')
  assert.match(fastStockIn, /const persistSessionDraft = \(lines: ReceivedLine\[\] = received\) => \{/)
  assert.match(fastStockIn, /writeWorkDraft<FastStockInDraft>\(fastStockInDraftKey, \{/)

  for (const [label, order] of [
    ['queueing a line', /persistSessionDraft\(nextLines\)\s*\n\s*setReceived\(nextLines\)/],
    ['the batched commit', /persistSessionDraft\(lines\)\s*\n\s*setReceived\(lines\)/],
  ] as Array<[string, RegExp]>) {
    assert.match(fastStockIn, order, `${label} must persist synchronously before setState`)
  }

  // Every write of a committed/failed outcome goes through the synchronous
  // path. A functional setState updater cannot be persisted -- its result does
  // not exist until React renders -- so none may survive on these paths.
  const commitRegion = fastStockIn.slice(
    fastStockIn.indexOf('const performCommitSequential'),
    fastStockIn.indexOf('const successCount'),
  )
  assert.ok(commitRegion.length > 0, 'the commit region must be found')
  assert.doesNotMatch(
    commitRegion,
    /setReceived\(\(prev\) => prev\.map\(\(item\) => item\.key === line\.key \? \{ \.\.\.item, status: 'saved'/,
    'a saved status must never be written by a functional updater alone',
  )
  assert.doesNotMatch(
    commitRegion,
    /setReceived\(\(prev\) => prev\.map\(\(item\) => item\.key === line\.key \? \{ \.\.\.item, status: 'error'/,
    'an error status must never be written by a functional updater alone',
  )
  const persists = commitRegion.match(/persistSessionDraft\(lines\)/g) || []
  assert.equal(persists.length, 3, 'the sequential fallback, the batched path and the whole-request failure all persist')
})

runTest('applyLineOutcome folds one outcome into a new array without touching its neighbours', () => {
  const body = fastStockIn.match(
    /function applyLineOutcome\([\s\S]*?\): ReceivedLine\[\] \{\r?\n([\s\S]*?)\r?\n\}/,
  )?.[1]
  assert.ok(body, 'applyLineOutcome must be a plain, extractable function')
  const stripped = body!.replace(/: ReceivedLine\[\]/g, '').replace(/ as const/g, '')
  const applyLineOutcome = new Function('lines', 'key', 'outcome', stripped) as (
    lines: Array<Record<string, unknown>>,
    key: string,
    outcome: Record<string, unknown>,
  ) => Array<Record<string, unknown>>

  const lines = [
    { key: 'a', requestId: 'stockline_a', status: 'saving', detail: '' },
    { key: 'b', requestId: 'stockline_b', status: 'saving', detail: '' },
  ]
  const next = applyLineOutcome(lines, 'a', { status: 'saved', detail: 'Received' })
  assert.notEqual(next, lines, 'a new array, so it can be persisted and rendered from one value')
  assert.equal(next[0].status, 'saved')
  assert.equal(next[0].requestId, 'stockline_a', 'the dedup id survives the outcome')
  assert.equal(next[1].status, 'saving', 'a neighbour is untouched')

  // THE DOUBLE-APPLY CASE, on the client side: once a line reads 'saved' in
  // the persisted draft, the retry must not pick it up again. commitSession
  // re-sends exactly `status !== 'saved'`.
  const resend = next.filter((line) => line.status !== 'saved')
  assert.deepEqual(resend.map((line) => line.key), ['b'], 'a saved line is never re-sent')

  // THE REVERSAL: an outcome applied twice is the same array content, so a
  // duplicated response cannot corrupt the queue.
  const again = applyLineOutcome(next, 'a', { status: 'saved', detail: 'Received' })
  assert.deepEqual(again, next, 'applying the same outcome twice is idempotent')
})

runTest('the sibling single-line stock writers carry an id too', () => {
  const receiveModal = source('components/inventory/ReceiveBatchModal.tsx')
  assert.match(
    receiveModal,
    /clientRequestId: createClientRequestId\('receive'\),/,
    'ReceiveBatchModal parks the id with the request it confirms',
  )
  const parkAt = receiveModal.indexOf('setPendingReceipt({')
  const idAt = receiveModal.indexOf("createClientRequestId('receive')")
  const commitAt = receiveModal.indexOf('const commitReceive')
  assert.ok(parkAt > 0 && idAt > parkAt && commitAt > idAt, 'the id is minted when the request is parked, not per confirm')

  const adjustModal = source('components/products/forms/StockAdjustModal.tsx')
  assert.match(
    adjustModal,
    /client_request_id: createClientRequestId\('stockadjust'\),/,
    'StockAdjustModal parks the id with the request it confirms',
  )
  const adjustParkAt = adjustModal.indexOf('const adjustmentRequest = {')
  const adjustCommitAt = adjustModal.indexOf('const commitAdjust')
  const adjustIdAt = adjustModal.indexOf("createClientRequestId('stockadjust')")
  assert.ok(
    adjustParkAt > 0 && adjustIdAt > adjustParkAt && adjustCommitAt > adjustIdAt,
    'the id belongs to the parked request, so re-confirming after a failure replays it',
  )
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll stock line request id durability assertions passed')
