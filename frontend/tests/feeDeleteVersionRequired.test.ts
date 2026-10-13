import assert from 'node:assert/strict'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import * as feesTransport from '../src/api/feesTransport.ts'

const { deleteFee } = feesTransport
// Read off the namespace so a base without the classifier fails the case that needs it, not the whole file at link time.
const feeDeleteStaleKind = (error: unknown): unknown => {
  const classify = (feesTransport as unknown as { feeDeleteStaleKind?: (error: unknown) => unknown }).feeDeleteStaleKind
  assert.equal(typeof classify, 'function', 'feesTransport exports feeDeleteStaleKind')
  return classify!(error)
}

// DELETE /api/fees/:id refuses an expense edited since the caller read it, but only
// when the DELETE states the version it read (expected_updated_at, the PUT's field). A DELETE with no body
// is held to the version the Worker itself read, so a stale screen still removes the newer record. The
// client must therefore ALWAYS put the field on the wire, and must recognise the two answers a stale
// delete gets (409 write_conflict for a changed row, 404 for one already removed).
type Wire = { method: string; url: string; body: Record<string, unknown> | null }
const sent: Wire[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  sent.push({ method: String(init?.method), url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
setSyncServerUrl('https://sync.example.test')

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    sent.length = 0
    __resetApiWriteDedupeForTests()
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
const last = (): Wire => sent[sent.length - 1]

try {
  await runTest('expense delete: the version the caller read is the DELETE body', async () => {
    await deleteFee(7, '2026-10-05T00:00:00.000Z')
    assert.equal(last().method, 'DELETE')
    assert.ok(last().url.endsWith('/api/fees/7'), `the id stays in the path: ${last().url}`)
    assert.deepEqual(last().body, { expected_updated_at: '2026-10-05T00:00:00.000Z' })
  })

  await runTest('expense delete: a legacy row with no version still states it, as null', async () => {
    await deleteFee(7, null)
    assert.deepEqual(last().body, { expected_updated_at: null })
    // A caller that bypasses the type still cannot leave the field out (the Worker would fall back
    // to the version it reads itself, which is the stale delete this field exists to refuse).
    await deleteFee(8 as never, undefined as never)
    const body = last().body
    assert.ok(body !== null && 'expected_updated_at' in body && body.expected_updated_at === null,
      'the key is present even when the caller left it out')
  })

  const conflict = (extra: Record<string, unknown> = {}) => Object.assign(new Error('This fee changed on another device. Refresh and try again.'),
    { status: 409, code: 'write_conflict', conflict: true, entity: 'fee', reason: 'updated', ...extra })

  await runTest('stale delete: a changed row and a removed row are told apart; anything else is not stale', () => {
    assert.equal(feeDeleteStaleKind(conflict()), 'changed')
    assert.equal(feeDeleteStaleKind(conflict({ reason: undefined })), 'changed')
    // The Worker answers 409 reason "deleted" when the row vanished between its read and its delete,
    // and a plain 404 when it was already gone at the read.
    assert.equal(feeDeleteStaleKind(conflict({ reason: 'deleted' })), 'gone')
    assert.equal(feeDeleteStaleKind(Object.assign(new Error('Fee not found'), { status: 404 })), 'gone')
    // Not stale: a permission refusal, a server fault, an unknown outcome, a conflict on another entity.
    assert.equal(feeDeleteStaleKind(Object.assign(new Error('nope'), { status: 403 })), null)
    assert.equal(feeDeleteStaleKind(Object.assign(new Error('boom'), { status: 500 })), null)
    assert.equal(feeDeleteStaleKind(Object.assign(new Error('timeout'), { code: 'request_timeout', outcome: 'unknown' })), null)
    assert.equal(feeDeleteStaleKind(conflict({ entity: 'sale' })), null)
    assert.equal(feeDeleteStaleKind(null), null)
    assert.equal(feeDeleteStaleKind('Fee not found'), null)
  })
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
}

if (failed) process.exit(1)
