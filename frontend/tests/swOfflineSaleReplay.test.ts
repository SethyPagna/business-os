// Regression lock for the two service-worker offline-sale-replay defects that
// silently DELETED queued POS sales while reporting them "synced":
//
//   1. Digest mismatch. replayQueuedSale digested the in-memory sale object,
//      which keeps undefined-valued keys (POS sets `delivery_actual_cost_usd:
//      undefined` on every non-delivery sale). The wire body uses
//      JSON.stringify, which drops those keys, and the server re-digests the
//      parsed payload -- so the digest could never match and every such sale
//      came back `payload_digest_failed`.
//   2. Delete-on-any-2xx. /api/sync/outbox returns HTTP 200 with
//      { success:false, results:[...] } for a per-operation rejection (only a
//      real conflict is 409). The SW deleted the queued sale whenever
//      response.ok was true, so a digest-rejected sale was discarded as
//      "synced" and the revenue was lost.
//
// This test (a) reproduces the digest algorithm both sides run and proves the
// JSON-clean fix makes them agree where the raw object did not, and (b) locks
// the shipped service-worker.ts source so a future edit can't reintroduce
// either defect. Run: node tests/swOfflineSaleReplay.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const swSource = fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8')
const builtSw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

// The exact canonicalizer both service-worker.ts and routes/sync.ts run
// (sorted keys, JSON.stringify for scalars). Reproduced here so the parity
// claim is executable, not asserted.
function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) as string
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}
const sha = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : stableStringify(v)).digest('hex')

await runTest('BEFORE/AFTER: digesting the raw sale object disagrees with the server; JSON-cleaning agrees', () => {
  // A realistic non-delivery POS sale: the delivery cost key is present but
  // undefined, exactly as POS.tsx emits it, and IndexedDB preserves it.
  const queuedSale: Record<string, unknown> = {
    client_request_id: 'req-123',
    total_usd: 12.5,
    total_khr: 51250,
    is_delivery: false,
    delivery_actual_cost_usd: undefined,
    items: [{ product_id: 1, quantity: 2, applied_price_usd: 6.25 }],
  }

  // Server side: it only ever sees the JSON body, so undefined keys are gone.
  const serverPayload = JSON.parse(JSON.stringify(queuedSale))
  const serverDigest = sha(serverPayload)

  // OLD (buggy) SW behaviour: digest the raw object with the undefined key.
  const rawDigest = sha(queuedSale)
  assert.notEqual(rawDigest, serverDigest, 'the raw-object digest must differ from the server digest (this was the bug)')

  // NEW SW behaviour: clean first, then digest -- must match the server.
  const cleanedDigest = sha(JSON.parse(JSON.stringify(queuedSale)))
  assert.equal(cleanedDigest, serverDigest, 'the JSON-cleaned digest must equal the server digest (the fix)')
})

await runTest('SW cleans the payload with a JSON round-trip before digesting and sending', () => {
  assert.match(swSource, /const payload = JSON\.parse\(JSON\.stringify\(row\.payload \|\| \{\}\)\)/)
  assert.match(swSource, /payload_digest: await sha256\(payload\)/)
  assert.match(builtSw, /JSON\.parse\(JSON\.stringify\(row\.payload/)
})

await runTest('SW deletes a queued sale ONLY when the per-operation result is applied', () => {
  const body = swSource.match(/async function replayQueuedSale[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(body, 'replayQueuedSale must exist')
  // The applied decision must read the per-operation result, not just response.ok.
  assert.match(body, /responsePayload\?\.results/)
  assert.match(body, /result\?\s*\.\s*status === 'applied'|result\.status === 'applied'/)
  // deleteQueueRow must be reached only inside the `applied` branch.
  const appliedIdx = body.indexOf('const applied =')
  const deleteIdx = body.indexOf('deleteQueueRow')
  assert.ok(appliedIdx > 0 && deleteIdx > appliedIdx, 'deleteQueueRow must come after the applied gate')
  // The old unconditional `if (response.ok) { deleteQueueRow }` must be gone.
  assert.doesNotMatch(body, /if \(response\.ok\) \{\s*await deleteQueueRow/)
})

await runTest('a non-applied outbox result keeps the sale queued (thrown -> markQueueFailure) rather than deleting it', () => {
  const body = swSource.match(/async function replayQueuedSale[\s\S]*?\n\}/)?.[0] || ''
  // The tail of the handler throws for any non-applied, non-conflict, non-auth
  // outcome; the handler's catch routes that to markQueueFailure, which uses
  // putQueueRow (preserve + backoff), never deleteQueueRow.
  assert.match(body, /throw new Error\(result\?\.error/)
  assert.match(body, /catch \(error\)[\s\S]*await markQueueFailure\(db, row, error\)/)
  const background = swSource.match(/function syncOutboxOnce[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(background, /syncOutbox\(/, 'old background events cannot dispatch legacy sales')
  const markBody = swSource.match(/async function markQueueFailure[\s\S]*?\n\}/)?.[0] || ''
  assert.match(markBody, /putQueueRow/)
  assert.doesNotMatch(markBody, /deleteQueueRow/)
})

// A 'rejected' outbox result (the server refused the operation for good, for
// example sale_created_at_too_old) must quarantine the row -- failed, carrying
// the server's code, retry_at null -- and never reach markQueueFailure, whose
// backoff would resend it forever. Drives the real replayQueuedSale and
// isReplayEligible source with stubbed storage and network.
const replayFunction = swSource.match(/async function replayQueuedSale[\s\S]*?\n\}/)?.[0] || ''
const eligibleFunction = swSource.match(/function isReplayEligible[\s\S]*?\n\}/)?.[0] || ''
const stubOwner = { authority: 'https://app.test', actor_id: 7 }

async function replayAgainst(results: unknown[], httpStatus = 200) {
  const seen = { updates: [] as Record<string, unknown>[], deleted: 0, failures: 0 }
  const factory = new Function(
    'normalizeOfflineSaleOwner', 'saleReplayAuthorityUnchanged', 'currentSaleReplayOwner', 'offlineSaleOwnersMatch',
    'putQueueRow', 'sha256', 'fetch', 'deleteQueueRow', 'broadcastSyncEvent', 'markQueueFailure', 'OFFLINE_OWNER_REVIEW_MESSAGE',
    `${replayFunction}\nreturn replayQueuedSale`,
  )
  const replay = factory(
    () => stubOwner, async () => true, async () => stubOwner, () => true,
    async (_db: unknown, row: Record<string, unknown>, updates: Record<string, unknown>) => { seen.updates.push(updates); return { ...row, ...updates } },
    async () => 'digest',
    async () => ({ ok: httpStatus < 400, status: httpStatus, text: async () => JSON.stringify({ success: false, results }) }),
    async () => { seen.deleted += 1; return true }, () => {}, async () => { seen.failures += 1 }, 'owner review',
  )
  const row = { _seq: 1, id: 'row-1', client_request_id: 'req-1', payload: { offline_owner: stubOwner }, status: 'pending' }
  const returned = await replay({}, row, 'https://app.test')
  return { returned, seen, final: seen.updates.reduce((merged, update) => ({ ...merged, ...update }), { ...row }) }
}
const eligible = (row: Record<string, unknown>): boolean => new Function('SYNC_LEASE_MS', `${eligibleFunction}\nreturn isReplayEligible`)(60_000)(row)

await runTest('a rejected outbox result quarantines the queued sale: failed with the server code, no retry, never deleted', async () => {
  assert.ok(replayFunction && eligibleFunction, 'both functions must exist')
  const refusal = { client_request_id: 'req-1', operation_id: 'sales.create', status: 'rejected', code: 'sale_created_at_too_old', error: 'Nothing was recorded.' }
  const { returned, seen, final } = await replayAgainst([refusal])
  assert.equal(returned, false)
  assert.equal(seen.failures, 0, 'a rejected result must not go through markQueueFailure and its retry backoff')
  assert.equal(seen.deleted, 0, 'a rejected sale is kept, never deleted as synced')
  assert.equal(final.status, 'failed')
  assert.equal(final.retry_at, null)
  assert.equal(final.retryable, false)
  assert.equal(final.reason, 'sale_created_at_too_old')
  assert.equal(final.error, 'Nothing was recorded.')
  assert.equal(eligible(final), false, 'a quarantined row is not replay-eligible again')
})

await runTest('a rejected result without a code is still quarantined, and a transient failure still retries with backoff (controls)', async () => {
  const bare = await replayAgainst([{ client_request_id: 'req-1', operation_id: 'sales.create', status: 'rejected' }])
  assert.equal(bare.seen.failures, 0)
  assert.equal(bare.final.status, 'failed')
  assert.equal(bare.final.retry_at, null)
  assert.equal(bare.final.reason, 'rejected')
  assert.equal(eligible(bare.final), false)

  const transient = await replayAgainst([{ client_request_id: 'req-1', operation_id: 'sales.create', status: 'failed', code: 'transient_replay_error', error: 'network' }])
  assert.equal(transient.seen.failures, 1, 'a transient failure still reaches markQueueFailure')
  assert.equal(transient.seen.deleted, 0)

  assert.equal(eligible({ status: 'failed', retry_at: null }), true, 'a plain failed row without the quarantine flag stays eligible')
  assert.equal(eligible({ status: 'failed', retry_at: null, retryable: false }), false)
})

await runTest('the generic outbox loop quarantines a rejected result too', () => {
  const generic = swSource.match(/async function syncOutbox\(\)[\s\S]*?\n\}/)?.[0] || ''
  const rejectedAt = generic.indexOf("result?.status === 'rejected'")
  const retryAt = generic.indexOf('...nextRetryAt(row)')
  assert.ok(rejectedAt > 0 && retryAt > rejectedAt, 'the rejected branch must come before the retry-with-backoff branch')
  const branch = generic.slice(rejectedAt, retryAt)
  assert.match(branch, /status: 'failed'/)
  assert.match(branch, /retry_at: null/)
  assert.match(branch, /retryable: false/)
  assert.match(branch, /reason: String\(result\.code \|\| 'rejected'\)/)
  assert.match(builtSw, /result\?\.status === 'rejected'/, 'the generated sw.js carries the same branch')
  assert.match(builtSw, /if \(row\?\.retryable === false\)\s+return false/)
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll service-worker offline-sale-replay tests passed')
