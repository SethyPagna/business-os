import assert from 'node:assert/strict'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { adjustStock } from '../src/api/inventoryWriteTransport.ts'

// N13: the Worker REFUSES (400) a stock adjust without a client_request_id, so the client must always
// send one: a caller that owns a stable id keeps it, every other caller gets one minted.
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
  await runTest('stock adjust: a caller without an id gets one minted; a supplied id goes through unchanged', async () => {
    await adjustStock({ productId: 1, type: 'remove', quantity: 1 })
    assert.match(String(last().body.client_request_id), REQUEST_ID, 'a minted id the Worker accepts')
    const minted = last().body.client_request_id
    await adjustStock({ productId: 2, type: 'remove', quantity: 1 })
    assert.notEqual(last().body.client_request_id, minted, 'a new call is a new request')
    await adjustStock({ productId: 1, type: 'remove', quantity: 1, client_request_id: 'stockline_fixed_0001' })
    assert.equal(last().body.client_request_id, 'stockline_fixed_0001')
    await adjustStock({ productId: 1, type: 'remove', quantity: 1, clientRequestId: 'camel_fixed_0001' })
    assert.equal(last().body.client_request_id, 'camel_fixed_0001', 'the camelCase spelling the Worker also reads is not replaced by a second id')
  })
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
}

if (failed) process.exit(1)
