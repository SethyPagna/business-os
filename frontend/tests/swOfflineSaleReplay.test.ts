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
  // outcome; syncOutbox's catch routes that to markQueueFailure, which uses
  // putQueueRow (preserve + backoff), never deleteQueueRow.
  assert.match(body, /throw new Error\(result\?\.error/)
  assert.match(swSource, /catch \(error\)\s*\{\s*await markQueueFailure\(db, row, error\)/)
  const markBody = swSource.match(/async function markQueueFailure[\s\S]*?\n\}/)?.[0] || ''
  assert.match(markBody, /putQueueRow/)
  assert.doesNotMatch(markBody, /deleteQueueRow/)
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll service-worker offline-sale-replay tests passed')
