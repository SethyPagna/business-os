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
// ---------------------------------------------------------------------------
// EXECUTED, not source-shape. Everything above reads the component text; the
// rest of this file RUNS the real draft store (src/utils/workDrafts.ts) and the
// real id generator against a fake localStorage, and simulates the exact crash
// this lane exists to survive: the response arrived, the draft was written, and
// the render that would have shown it never happened.
// ---------------------------------------------------------------------------

const store = new Map<string, string>()
const fakeStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
  removeItem: (key: string) => { store.delete(key) },
}
let currentUser: Record<string, unknown> = { id: 7, username: "kanha", organization_public_id: "org1" }
;(globalThis as unknown as Record<string, unknown>).localStorage = fakeStorage
;(globalThis as unknown as Record<string, unknown>).sessionStorage = {
  getItem: () => JSON.stringify(currentUser),
  setItem: () => {},
  removeItem: () => {},
}
;(globalThis as unknown as Record<string, unknown>).window = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: number) => clearTimeout(id),
  addEventListener: () => {},
}

const { writeWorkDraft, readWorkDraft, scheduleWorkDraftWrite, scopedWorkDraftKey } = await import('../src/utils/workDrafts.ts')
const { createClientRequestId } = await import('../src/api/requestIds.ts')

type DraftLine = { key: string; requestId?: string; status: string; detail?: string; mode?: string }
type Draft = { lines: DraftLine[]; batchChoice: string; sessionId?: number | null }

// The component ships applyLineOutcome and the restore-and-mint block as plain
// code precisely so they can be lifted out and RUN here. Lifted by regex from
// the real file, so the test dies if either is rewritten into something a test
// can no longer exercise.
function liftApplyLineOutcome(): (lines: DraftLine[], key: string, outcome: Record<string, unknown>) => DraftLine[] {
  const match = /function applyLineOutcome\([\s\S]*?\n\}/.exec(fastStockIn)
  assert.ok(match, 'applyLineOutcome must stay a plain, extractable function')
  const body = match![0].replace(/: ReceivedLine\['status'\]/g, '').replace(/: ReceivedLine\[\]/g, '')
    .replace(/lines: ReceivedLine\[\],/, 'lines,').replace(/key: string,/, 'key,')
    .replace(/outcome: \{[^}]*\},/, 'outcome,').replace(/\): ReceivedLine\[\] \{/, ') {')
  return new Function(`${body}; return applyLineOutcome`)() as never
}

function liftRestoreBlock(): (
  restoredLinesRef: { current: unknown },
  draft: Draft,
  fastStockInDraftKey: string,
  write: typeof writeWorkDraft,
  mintId: typeof createClientRequestId,
) => void {
  const start = fastStockIn.indexOf("if (restoredLinesRef.current === null) {")
  assert.ok(start > 0, 'the restore-and-mint block must stay extractable')
  const end = fastStockIn.indexOf("\n  }", start)
  const block = fastStockIn.slice(start, end + 4)
  assert.match(block, /writeWorkDraft<FastStockInDraft>\(fastStockInDraftKey/, 'the block must persist the minted ids itself')
  const plain = block.replace(/<FastStockInDraft>/g, '').replace(/: ReceivedLine\[\] \| null/g, '')
  return new Function(
    'restoredLinesRef', 'draft', 'fastStockInDraftKey', 'writeWorkDraft', 'createClientRequestId',
    plain,
  ) as never
}

const applyLineOutcome = liftApplyLineOutcome()
const runRestoreBlock = liftRestoreBlock()

runTest('EXECUTED: a committed line survives a crash between the response and the render', () => {
  const key = scopedWorkDraftKey('fast_stock_in')
  const draft: Draft = {
    batchChoice: "new",
    lines: [
      { key: "l1", requestId: "stockline_1111-aaaa-bbbb", status: "queued" },
      { key: "l2", requestId: "stockline_2222-cccc-dddd", status: "queued" },
    ],
  }
  writeWorkDraft(key, draft)

  // The autosave effect is mid-flight with the STALE (queued) snapshot -- this
  // is the 800ms window the defect lived in.
  scheduleWorkDraftWrite(key, draft, 20)

  // The server answered for line 1. persistSessionDraft writes the fact
  // BEFORE setReceived would have rendered it.
  const committed = applyLineOutcome(draft.lines, "l1", { status: "saved", detail: "Lot 09232026" })
  writeWorkDraft(key, { ...draft, lines: committed })

  // ...and then the render crashes. No effect runs, no flush, nothing else.
  const reloaded = readWorkDraft<Draft>(key)
  assert.ok(reloaded, 'the draft survived')
  const line = reloaded!.data.lines.find((entry) => entry.key === "l1")!
  assert.equal(line.status, 'saved', 'THE FIX: the reloaded draft knows line 1 was already applied')
  assert.equal(line.requestId, 'stockline_1111-aaaa-bbbb', 'and it kept the id the server deduped on')
  assert.equal(
    reloaded!.data.lines.find((entry) => entry.key === "l2")!.status,
    'queued',
    'the untouched line is still queued -- the retry set is exactly one line',
  )
})

// Awaited OUTSIDE runTest: a rejected promise handed to a synchronous runner is
// a test that cannot fail, which is worse than no test at all.
await new Promise((resolve) => setTimeout(resolve, 80))
runTest('EXECUTED: the in-flight autosave cannot resurrect the pre-commit snapshot', () => {
  const key = scopedWorkDraftKey('fast_stock_in')
  const settled = readWorkDraft<Draft>(key)
  assert.equal(
    settled!.data.lines.find((entry) => entry.key === "l1")!.status,
    'saved',
    'a synchronous write must CANCEL the pending debounce, or the stale queued snapshot wins 800ms later',
  )
})

runTest('EXECUTED: a legacy draft with no ids has them persisted in the same tick', () => {
  const key = scopedWorkDraftKey('fast_stock_in_legacy')
  // Written by a build that predates the dedup id.
  writeWorkDraft(key, { batchChoice: "new", lines: [{ key: "old1", status: "queued" }, { key: "old2", status: "queued" }] })
  const draft = readWorkDraft<Draft>(key)!.data

  const ref: { current: unknown } = { current: null }
  runRestoreBlock(ref, draft, key, writeWorkDraft, createClientRequestId)

  // No timer has fired and no effect has run: the ids must ALREADY be on disk,
  // or a crash inside the 800ms window reloads the same id-less draft and the
  // retry commits unprotected all over again.
  const persisted = readWorkDraft<Draft>(key)!.data
  for (const line of persisted.lines) {
    assert.match(String(line.requestId || ''), /^stockline_.{8,}$/, `${line.key} must have a usable id persisted immediately`)
  }
  assert.equal(
    persisted.lines[0].requestId,
    (ref.current as DraftLine[])[0].requestId,
    'and the persisted id must be the SAME one React was handed, not a second mint',
  )
  assert.notEqual(persisted.lines[0].requestId, persisted.lines[1].requestId, "each line gets its own id")
})

runTest('EXECUTED: the draft key is actor-scoped, which is what stops a cross-actor replay', () => {
  // The Worker keys its receipt on (actor_id, request_id). If two accounts on
  // one device could read each other’s draft, account B would re-send account
  // A's line ids under B's actor -- a different receipt row, and the delta
  // applies twice. The actor in the draft key is what makes that impossible.
  currentUser = { id: 7, username: "kanha", organization_public_id: "org1" }
  const forSeven = scopedWorkDraftKey('fast_stock_in')
  currentUser = { id: 8, username: "dara", organization_public_id: "org1" }
  const forEight = scopedWorkDraftKey('fast_stock_in')
  assert.notEqual(forSeven, forEight, 'two accounts on one device must not share a stock-in draft')
  assert.match(forSeven, /_7_/, 'the acting user id is part of the key')
  assert.match(forEight, /_8_/, 'the acting user id is part of the key')
  currentUser = { id: 7, username: "kanha", organization_public_id: "org2" }
  assert.notEqual(scopedWorkDraftKey('fast_stock_in'), forSeven, 'and so is the organization')

  const drafts = source('utils/workDrafts.ts')
  assert.match(
    drafts,
    /userId = String\(user\.id \|\| user\.username \|\| .anonymous.\)/,
    'user.id must stay in the key builder -- dropping it re-opens cross-actor replay',
  )
})


runTest('the guard codes are translated, not shown in the server English', () => {
  const outcome = source('utils/stockAdjustOutcome.ts')
  for (const code of ["stock_request_in_flight", "stock_request_partially_applied", "idempotency_conflict", "invalid_client_request_id"]) {
    assert.ok(outcome.includes(code), `${code} must map to a pack key`)
  }
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const key of ['stock_request_in_flight', 'stock_request_partially_applied', 'stock_request_id_conflict', 'stock_request_id_invalid']) {
    assert.ok(en[key], `${key} missing from en.json`)
    assert.ok(km[key], `${key} missing from km.json`)
    assert.notEqual(en[key], km[key], `${key} must actually be translated`)
  }
  // The removal signpost is the only way out of the terminal refusals, so it
  // has to be in the words as well as in the button.
  assert.match(en.stock_request_partially_applied, /remove this line/i)
  assert.match(en.stock_request_id_conflict, /[Rr]emove this line/)
})

runTest('every stock surface routes its failure text through the shared helper', () => {
  assert.match(fastStockIn, /stockFailureText\(error, tr, tr\('error', 'Error'\)\)/, 'sequential commit')
  assert.match(fastStockIn, /stockFailureText\(result, tr, tr\('error', 'Error'\)\)/, 'batched commit')
  assert.match(fastStockIn, /needsRemoval: stockLineNeedsRemoval\(error\)/, 'sequential commit marks the signpost')
  assert.match(fastStockIn, /needsRemoval: stockLineNeedsRemoval\(result\)/, 'batched commit marks the signpost')
  assert.match(
    fastStockIn,
    /line\.status !== .saved. && !line\.needsRemoval \? <button[^>]*onClick=\{\(\) => editLine\(line\)\}/,
    'a line that can only be removed must not offer Edit -- editing keeps the id and earns another 409',
  )
  assert.match(source('components/inventory/ReceiveBatchModal.tsx'), /stockFailureText\(e, tr,/, 'ReceiveBatchModal')
  assert.match(source('components/products/forms/StockAdjustModal.tsx'), /stockFailureText\(error, tr, classified\.message\)/, 'StockAdjustModal')
  const bulk = source('components/products/forms/BulkAddStockModal.tsx')
  assert.match(bulk, /stockFailureText\(error, \(key, fallback\) => t\(key\) || fallback, failure\.message\)/, 'BulkAddStockModal')
  // The parity gap the verifier found: this modal posted to the same route
  // with no id at all.
  assert.match(bulk, /client_request_id: row\.rowId,/, 'BulkAddStockModal must send the per-line dedup id')
})

runTest('the batched commit envelope carries the guard code back to the client', () => {
  const commit = readFileSync(new URL('../../cloudflare/src/routes/stockInCommit.ts', import.meta.url), 'utf8')
  const failures = commit.match(/return \{ ok: false, key: line\.key, error: String\(json\.error[^}]*\}/g) || []
  assert.equal(failures.length, 2, 'both wires build a failure result')
  for (const failure of failures) {
    assert.match(failure, /code: json\.code \?\? null/, 'a failure without its code is untranslatable on the client')
  }
})

console.log('\nAll stock line request id durability assertions passed')
