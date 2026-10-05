import assert from 'node:assert/strict'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { updateFee } from '../src/api/feesTransport.ts'

// N13: the Worker REFUSES (400) an expense edit that does not state the version it read
// (expected_updated_at), so the client must always send the field, whatever the caller passed.
type Wire = { method: string; url: string; body: Record<string, unknown> }
const sent: Wire[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  sent.push({ method: String(init?.method), url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} })
  return new Response(JSON.stringify({ success: true, fee: {}, deleted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
setSyncServerUrl('https://sync.example.test')

let failed = 0
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
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
const REQUEST_ID = /^[A-Za-z0-9_-]{8,120}$/

try {
  await runTest('expense edit: expectedUpdatedAt is always on the wire, null when the row has none', async () => {
    await updateFee(5, { label: 'x', expectedUpdatedAt: '2026-10-05T00:00:00.000Z' })
    assert.equal(last().method, 'PUT')
    assert.equal(last().body.expectedUpdatedAt, '2026-10-05T00:00:00.000Z')
    await updateFee(5, { label: 'x', expectedUpdatedAt: null })
    assert.ok('expectedUpdatedAt' in last().body && last().body.expectedUpdatedAt === null)
    // A caller that bypasses the type still cannot omit the field.
    await updateFee(5, { label: 'x' } as never)
    assert.ok('expectedUpdatedAt' in last().body, 'the key is present even when the caller left it out')
  })
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
}

if (failed) process.exit(1)
