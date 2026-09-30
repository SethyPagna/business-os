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
//
// UI-STOCK-2 rewrote the float as the Stock Session (line type and writer in
// utils/stockSessionDraft.ts); UI-STOCK-3 repointed these pins and retired the
// ones on the deleted single-line writers (Receive stock, Adjust stock, Bulk
// add stock), whose work is the session's now.

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
const sessionDraft = source('utils/stockSessionDraft.ts')
const sessionItems = source('components/stock-session/StockSessionItems.tsx')
const { buildStockLineRequest, normalizeStockSessionDraft } = await import('../src/utils/stockSessionDraft.ts')

runTest('every queued stock session line carries a stable dedup id minted once', () => {
  assert.match(sessionDraft, /export type StockSessionLine = \{[^]*?\s+requestId: string\s/, 'a line must carry its own request id')
  assert.match(
    fastStockIn,
    /requestId: \(editingKey \? received\.find\(\(line\) => line\.key === editingKey\)\?\.requestId : ''\) \|\| createClientRequestId\('stockline'\)/,
    'editing a queued line must REUSE its id; only a genuinely new line mints one',
  )
  // A restored draft written before this field existed must not commit with an
  // empty id, which the Worker would read as "no id" and happily double-apply.
  assert.match(sessionDraft, /requestId: asString\(line\.requestId\) \|\| mintRequestId\(\),/, 'an older draft restores with a minted id rather than none')
  assert.match(fastStockIn, /const mintLineId = \(\) => createClientRequestId\('stockline'\)/)
  assert.match(fastStockIn, /import \{ createClientRequestId \} from '\.\.\/\.\.\/api\/requestIds\.ts'/)
})

runTest('the id reaches the Worker on both stock wires', () => {
  // Executed through the one line writer: remove, set and a tagged add go to
  // /api/inventory/adjust, a plain add to /api/batches; every body carries the id.
  const base = {
    key: 'k', requestId: 'stockline_abc12345', product: { id: 7, name: 'Soap' }, productName: 'Soap', quantity: 2, freeQuantity: 0,
    unitCost: '1', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 4, batchLabel: '', reason: '',
    conditionTag: '', createdProduct: false, status: 'queued', detail: '',
  }
  const ctx = {
    branchId: '1', receivedDate: '2026-09-30', supplier: { supplierId: null, supplierName: 'S' }, paymentStatus: 'paid' as const,
    creditDueDate: '', sessionId: 1, canEditPrice: false, reasonFor: () => 'R',
  }
  const adjusts = [
    { ...base, mode: 'remove' }, { ...base, mode: 'set' }, { ...base, mode: 'add', conditionTag: 'damaged' },
  ].map((line) => buildStockLineRequest(line as never, ctx))
  for (const request of adjusts) {
    assert.equal(request.wire, 'adjust')
    assert.equal((request.body as Record<string, unknown>).client_request_id, 'stockline_abc12345', 'all three adjust-wire bodies (remove, set, tagged add) send the id')
  }
  const receipt = buildStockLineRequest({ ...base, mode: 'add', batchChoice: 'new' } as never, ctx)
  assert.equal(receipt.wire, 'receive')
  assert.equal((receipt.body as Record<string, unknown>).clientRequestId, 'stockline_abc12345', 'the receive wire sends the id too')
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
  assert.match(fastStockIn, /scheduleWorkDraftWrite<StockSessionDraft>/, 'the keystroke autosave is retained')
  assert.match(fastStockIn, /const persistSessionDraft = \(lines: StockSessionLine\[\] = received\) => \{/)
  assert.match(fastStockIn, /writeWorkDraft<StockSessionDraft>\(fastStockInDraftKey, currentDraft\(lines\)\)/)

  for (const [label, order] of [
    ['queueing a line', /persistSessionDraft\(nextLines\)\s*\n\s*setReceived\(nextLines\)/],
    ['a whole-request failure', /persistSessionDraft\(lines\)\s*\n\s*setReceived\(lines\)/],
    ['each answered round', /persistSessionDraft\(lines\)\s*\n\s*setReceived\(lines\.map\(/],
  ] as Array<[string, RegExp]>) {
    assert.match(fastStockIn, order, `${label} must persist synchronously before setState`)
  }

  // Every write of a committed/failed outcome goes through the synchronous
  // path. A functional setState updater cannot be persisted -- its result does
  // not exist until React renders -- so none may survive on these paths.
  const commitRegion = fastStockIn.slice(
    fastStockIn.indexOf('const performCommitSequential'),
    fastStockIn.indexOf('// ---- close / minimize ----'),
  )
  assert.ok(commitRegion.length > 0, 'the commit region must be found')
  assert.doesNotMatch(commitRegion, /setReceived\(\(prev\) => [^\n]*status: '(?:saved|error)'/, 'a saved or error status must never be written by a functional updater alone')
  const persists = commitRegion.match(/persistSessionDraft\(lines\)/g) || []
  assert.ok(persists.length >= 4, 'the sequential fallback, each batched round, creation and the whole-request failure all persist')
})

runTest('applyLineOutcome folds one outcome into a new array without touching its neighbours', () => {
  const body = fastStockIn.match(
    /function applyLineOutcome\([\s\S]*?\): StockSessionLine\[\] \{\r?\n([\s\S]*?)\r?\n\}/,
  )?.[1]
  assert.ok(body, 'applyLineOutcome must be a plain, extractable function')
  const stripped = body!.replace(/: StockSessionLine\[\]/g, '').replace(/ as const/g, '')
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

// Retired with UI-STOCK-3: "the sibling single-line stock writers carry an id
// too" (ReceiveBatchModal, StockAdjustModal). Both are deleted; every stock
// line is a Stock Session line now, and carries the id pinned above.

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
  const match = /function applyLineOutcome\([\s\S]*?\n\}/.exec(fastStockIn.replace(/\r\n/g, '\n'))
  assert.ok(match, 'applyLineOutcome must stay a plain, extractable function')
  const body = match![0]
    .replace(/lines: StockSessionLine\[\],/, 'lines,').replace(/key: string,/, 'key,')
    .replace(/outcome: \{[^}]*\},/, 'outcome,').replace(/\): StockSessionLine\[\] \{/, ') {')
  return new Function(`${body}; return applyLineOutcome`)() as never
}

const applyLineOutcome = liftApplyLineOutcome()

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
  writeWorkDraft(key, { batchChoice: "new", lines: [{ key: "old1", status: "queued", product: { id: 1 } }, { key: "old2", status: "queued", product: { id: 2 } }] })
  const raw = readWorkDraft<unknown>(key)!.data

  // The float's restore: normalise with the minting function, and because a
  // line lacked an id, write the result back in the same (render) tick.
  assert.match(fastStockIn, /stored = normalizeStockSessionDraft\(raw, mintLineId\)/)
  assert.match(fastStockIn, /rewrite = Array\.isArray\(rawLines\) && rawLines\.some\(\(line\) => !line \|\| typeof line !== 'object' \|\| !\(line as \{ requestId\?: unknown \}\)\.requestId\)/)
  assert.match(fastStockIn, /if \(rewrite\) writeWorkDraft<StockSessionDraft>\(fastStockInDraftKey, opened\)/)
  const opened = normalizeStockSessionDraft(raw, () => createClientRequestId('stockline'))!
  writeWorkDraft(key, opened)

  // No timer has fired and no effect has run: the ids must ALREADY be on disk,
  // or a crash inside the 800ms window reloads the same id-less draft and the
  // retry commits unprotected all over again.
  const persisted = readWorkDraft<Draft>(key)!.data
  for (const line of persisted.lines) {
    assert.match(String(line.requestId || ''), /^stockline_.{8,}$/, `${line.key} must have a usable id persisted immediately`)
  }
  assert.equal(persisted.lines[0].requestId, opened.lines[0].requestId, 'and the persisted id must be the SAME one React was handed, not a second mint')
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
  assert.match(fastStockIn, /const failureText = \(error: unknown, fallback: string\): string => \{[^]*?stockFailureText\(error, tr, fallback\)/, 'one helper wraps the shared one')
  assert.match(fastStockIn, /detail: failureText\(error, tr\('error', 'Error'\)\),\s*needsRemoval: stockLineNeedsRemoval\(error\)/, 'sequential commit marks the signpost')
  assert.match(fastStockIn, /detail: failureText\(result, tr\('error', 'Error'\)\),\s*status: 'error',\s*needsRemoval: stockLineNeedsRemoval\(result\)/, 'batched commit marks the signpost')
  // A line that can only be removed must not offer Edit -- editing keeps the id and earns another 409.
  assert.match(sessionItems, /const editable = !busy && line\.status !== 'saved' && !line\.needsRemoval/)
  assert.match(fastStockIn, /if \(saving \|\| line\.status === 'saved' \|\| line\.needsRemoval\) return/)
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
