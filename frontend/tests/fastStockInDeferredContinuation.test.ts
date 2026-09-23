import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  commitStockInLinesInRounds,
  isDeferredStockInResult,
  type FastStockInCommitLineResult,
  type FastStockInCommitSettled,
} from '../src/api/inventoryWriteTransport.ts'
import { stockFailureText, stockLineNeedsRemoval } from '../src/utils/stockAdjustOutcome.ts'

// The Worker's fast stock-in commit attempts only its plan's
// stockInLinesPerRequest lines per invocation (D1 allows 50 queries per
// invocation on Free, 1000 on Paid) and answers the rest
// { ok: false, code: 'deferred' } without touching them
// (cloudflare/src/routes/stockInCommit.ts). The client re-sends ONLY those,
// round after round, and never a line the Worker answered any other way.
//
// Behavioural: the real continuation loop runs against a fake Worker that
// applies the same prefix rule, with the request injected.

type Line = { key: string }
const DEFERRED_ERROR = 'Not saved yet: this request reached its line limit. Complete again to save this line.'
const deferred = (key: string): FastStockInCommitLineResult => ({ ok: false, key, error: DEFERRED_ERROR, code: 'deferred' })

// A Worker with a per-request cap. `fail` names keys that are refused for a
// real reason; `throwOnRound` makes that request fail as a whole.
function fakeWorker(cap: number, options: { fail?: string[]; throwOnRound?: number; error?: unknown } = {}) {
  const sent: string[][] = []
  const applied: string[] = []
  const send = async (batch: Line[]) => {
    sent.push(batch.map((line) => line.key))
    if (options.throwOnRound === sent.length) throw options.error ?? new Error('network down')
    return batch.map((line, index): FastStockInCommitLineResult => {
      if (index >= cap) return deferred(line.key)
      if (options.fail?.includes(line.key)) return { ok: false, key: line.key, error: 'Only 2 available', code: null }
      applied.push(line.key)
      return { ok: true, key: line.key }
    })
  }
  return { send, sent, applied }
}

const lines = (...keys: string[]): Line[] => keys.map((key) => ({ key }))

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('only the deferred lines are re-sent, round after round, until none remain', async () => {
  const worker = fakeWorker(2)
  const rounds: number[][] = []
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c', 'd', 'e'), worker.send, (settled) => {
    rounds.push(settled.map(({ index }) => index))
  })
  assert.deepEqual(worker.sent, [['a', 'b', 'c', 'd', 'e'], ['c', 'd', 'e'], ['e']])
  assert.deepEqual(worker.applied, ['a', 'b', 'c', 'd', 'e'], 'every line applied exactly once')
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, true, true])
  assert.deepEqual(results.map((r) => r.key), ['a', 'b', 'c', 'd', 'e'], 'results line up with the input order')
  assert.deepEqual(rounds, [[0, 1], [2, 3], [4]], 'each round is reported once, before the next is sent')
})

await runTest('a Free-sized cap of one still commits the whole session, one line per request', async () => {
  const worker = fakeWorker(1)
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c'), worker.send)
  assert.deepEqual(worker.sent, [['a', 'b', 'c'], ['b', 'c'], ['c']])
  assert.ok(results.every((r) => r.ok))
})

await runTest('a real failure stops the loop; the still-deferred lines come back deferred, never attempted', async () => {
  const worker = fakeWorker(2, { fail: ['b'] })
  const settledRounds: FastStockInCommitSettled[] = []
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c', 'd', 'e'), worker.send, (settled) => settledRounds.push(settled))
  assert.deepEqual(worker.sent, [['a', 'b', 'c', 'd', 'e']], 'no second request after a real failure')
  assert.deepEqual(worker.applied, ['a'])
  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, false)
  assert.equal(isDeferredStockInResult(results[1]), false, 'the real failure is not mistaken for a deferral')
  assert.ok(results.slice(2).every((r) => isDeferredStockInResult(r)), 'c, d and e are reported deferred so the caller keeps them queued')
  assert.equal(settledRounds.length, 1)
  assert.deepEqual(settledRounds[0].map(({ index }) => index), [0, 1, 2, 3, 4], 'the final round reports every line it carried')
})

await runTest('a real failure in a later round stops there and never re-sends earlier rounds', async () => {
  const worker = fakeWorker(2, { fail: ['d'] })
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c', 'd', 'e'), worker.send)
  assert.deepEqual(worker.sent, [['a', 'b', 'c', 'd', 'e'], ['c', 'd', 'e']])
  assert.deepEqual(worker.applied, ['a', 'b', 'c'])
  assert.deepEqual(results.map((r) => (r.ok ? 'ok' : isDeferredStockInResult(r) ? 'deferred' : 'failed')), ['ok', 'ok', 'ok', 'failed', 'deferred'])
})

await runTest('the first request failing as a whole still throws, so the 404 fallback and the one-message failure keep working', async () => {
  const notFound = Object.assign(new Error('Not found'), { status: 404 })
  const worker = fakeWorker(2, { throwOnRound: 1, error: notFound })
  await assert.rejects(() => commitStockInLinesInRounds(lines('a', 'b', 'c'), worker.send), (error) => error === notFound)
  assert.deepEqual(worker.applied, [])
})

await runTest('a later request failing as a whole fails only its own lines; committed rounds stand', async () => {
  const worker = fakeWorker(2, { throwOnRound: 2 })
  const rounds: FastStockInCommitSettled[] = []
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c', 'd'), worker.send, (settled) => rounds.push(settled))
  assert.deepEqual(results.map((r) => r.ok), [true, true, false, false])
  assert.equal(results[2].error, 'network down')
  assert.equal(results[2].key, 'c')
  assert.equal(isDeferredStockInResult(results[2]), false, 'a line whose request died may have been attempted: it is an error, not a deferral')
  assert.deepEqual(rounds.map((round) => round.map(({ index }) => index)), [[0, 1], [2, 3]])
})

await runTest('a round with no progress stops instead of looping', async () => {
  const worker = fakeWorker(0)
  const results = await commitStockInLinesInRounds(lines('a', 'b'), worker.send)
  assert.equal(worker.sent.length, 1)
  assert.ok(results.every((r) => isDeferredStockInResult(r)))
})

await runTest('new client + old Worker (no cap, no deferrals): exactly one request, results passed through', async () => {
  const worker = fakeWorker(Number.POSITIVE_INFINITY, { fail: ['b'] })
  const results = await commitStockInLinesInRounds(lines('a', 'b', 'c'), worker.send)
  assert.deepEqual(worker.sent, [['a', 'b', 'c']])
  assert.deepEqual(results.map((r) => r.ok), [true, false, true])
})

await runTest('a short answer is a failure for the missing lines, not a deferral', async () => {
  const results = await commitStockInLinesInRounds(lines('a', 'b'), async () => [{ ok: true, key: 'a' }])
  assert.equal(results[0].ok, true)
  assert.equal(results[1], undefined, 'no result for b, which the modal reports as an error')
})

// ---------------------------------------------------------------------------
// Old client + new Worker. A client built before this change sends every
// non-saved line in one request and treats each non-ok result as a line
// error. Its three decisions are made by the helpers and filter below, which
// this change does not touch.
// ---------------------------------------------------------------------------
const modal = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')

await runTest('old client + new Worker: a deferred line is a retryable failure with an actionable sentence', () => {
  const result = deferred('c')
  assert.equal(stockLineNeedsRemoval(result), false, 'retryable: the row keeps its retry path, not the Remove signpost')
  assert.equal(stockFailureText(result, (_key, fallback) => fallback, 'Error'), DEFERRED_ERROR, 'the Worker sentence is what the old client shows')
})

await runTest('old client + new Worker: pressing Complete again sends only the lines that are not saved', () => {
  assert.match(modal, /const pending = received\.filter\(\(line\) => line\.status !== 'saved'\)/)
})

await runTest('the modal folds each round durably before the next round, and returns never-attempted lines to queued', () => {
  const start = modal.indexOf('const performCommit = async (pending: ReceivedLine[]) => {')
  const body = modal.slice(start, modal.indexOf('\n  const successCount', start))
  assert.match(body, /batched = await commitFastStockIn\(pending\.map\(buildLineRequest\), foldRound\)/)
  assert.match(body, /\} else if \(isDeferredStockInResult\(result\)\) \{\s*failed \+= 1\s*lines = applyLineOutcome\(lines, line\.key, \{ status: 'queued', detail: '' \}\)/,
    'a deferred leftover is queued (no new UI text) and still keeps the modal open')
  assert.match(body, /persistSessionDraft\(lines\)\s*\n\s*setReceived\(lines\.map\(\(item\) => \(unsettled\.has\(item\.key\)/,
    'the round is written to the draft before it is rendered')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All fastStockInDeferredContinuation tests passed')
}
