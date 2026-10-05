import assert from 'node:assert/strict'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import {
  createPromotion, createPromotionRule, deletePromotion, deletePromotionRule, reorderPromotions, updatePromotion, updatePromotionRule,
} from '../src/api/promotionsTransport.ts'

// N13: the Worker REFUSES (400) every promotions write without a request id (and an edit or delete of one
// row without expected_updated_at), so nothing may reach the wire without them.
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
  await runTest('promotions strip: create/edit/delete/reorder each carry a request id; edit and delete carry the version', async () => {
    await createPromotion({ title: 'A' })
    assert.equal(last().method, 'POST'); assert.match(String(last().body.client_request_id), REQUEST_ID)
    await updatePromotion(3, { title: 'B' }, '2026-10-05 10:00:00')
    assert.equal(last().method, 'PUT'); assert.match(String(last().body.client_request_id), REQUEST_ID)
    assert.equal(last().body.expected_updated_at, '2026-10-05 10:00:00')
    await updatePromotion(3, { title: 'B' }, null)
    assert.ok('expected_updated_at' in last().body && last().body.expected_updated_at === null)
    await deletePromotion(3, '2026-10-05 10:00:00')
    assert.equal(last().method, 'DELETE'); assert.match(String(last().body.client_request_id), REQUEST_ID)
    assert.equal(last().body.expected_updated_at, '2026-10-05 10:00:00')
    await reorderPromotions([3, 2, 1])
    assert.match(String(last().body.client_request_id), REQUEST_ID); assert.deepEqual(last().body.order, [3, 2, 1])
  })

  await runTest('promotions rules: create/edit/delete each carry a request id; edit and delete carry the version', async () => {
    const rule = { rule_type: 'percent_off', scope_type: 'category', percent_off: 5, category: 'Drinks' } as const
    await createPromotionRule(rule)
    assert.match(String(last().body.client_request_id), REQUEST_ID)
    await updatePromotionRule(9, rule, '2026-10-05 10:00:00')
    assert.match(String(last().body.client_request_id), REQUEST_ID); assert.equal(last().body.expected_updated_at, '2026-10-05 10:00:00')
    await deletePromotionRule(9, '2026-10-05 10:00:00')
    assert.equal(last().method, 'DELETE'); assert.match(String(last().body.client_request_id), REQUEST_ID)
    assert.equal(last().body.expected_updated_at, '2026-10-05 10:00:00')
  })
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
}

if (failed) process.exit(1)
