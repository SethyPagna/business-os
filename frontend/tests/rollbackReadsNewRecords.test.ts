// CACHE-LIFECYCLE T-CL3 (lane 6.0.1048, R8, rollback compatibility). The build before this slice (736929e91) can be put back in front of the
// device at any time. What this build keeps for the person at the till -- POS carts and form drafts -- must still be read, whole, by
// that build's own readers (tests/fixtures/rollback-736929e91-readers.ts: the old code, copied verbatim). The new fields (schema,
// money_precision_version) are extra keys the old readers never look at. The reverse direction (this build reads the old build's
// records) is tests/persistedRecordSchema.test.ts.
//
// Positive control: a record shaped so that the old reader cannot use it (the draft's `data` renamed) is reported unreadable, so a green
// result here is not the harness being unable to say no. Mutant: a writer that renames the field is caught by the same assertions.
import assert from 'node:assert/strict'
import { oldRestoreOrders, readWorkDraft as oldReadWorkDraft } from './fixtures/rollback-736929e91-readers.ts'
import { writeWorkDraft } from '../src/utils/workDrafts.ts'
import { POS_ORDERS_SCHEMA, KNOWN_MONEY_PRECISION } from '../src/utils/posOrdersSchema.ts'
import { WORK_DRAFT_SCHEMA } from '../src/utils/persistedRecordSchema.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

function withStorage<T>(run: (local: Storage) => T): T {
  const original = (globalThis as { localStorage?: unknown }).localStorage
  const local = memoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = local
  try { return run(local) } finally { ;(globalThis as { localStorage?: unknown }).localStorage = original }
}

const FORM = { name: 'half typed ខ្មែរ', barcode: '8800000000011', price: '12.50' }
const CART_LINE = { id: 5, qty: 2, name: 'Lipstick', price_usd: 4.5 }

await runTest('a draft this build wrote is read by the old build: same data, same time, and it is not deleted', () => withStorage((local) => {
  const key = 'businessos_draft_v2_rollback_product'
  writeWorkDraft(key, FORM)
  const stored = JSON.parse(local.getItem(key) as string)
  assert.equal(stored.schema, WORK_DRAFT_SCHEMA, 'sanity: this build stamps the schema')
  const read = oldReadWorkDraft<typeof FORM>(key)
  assert.deepEqual(read?.data, FORM)
  assert.equal(read?.at, stored.at)
  assert.ok(local.getItem(key), 'the old reader leaves the record in place')
  // and with the freshness floor the old build uses against the server's updated_at
  assert.deepEqual(oldReadWorkDraft<typeof FORM>(key, { notOlderThanMs: stored.at - 1 })?.data, FORM)
}))

await runTest('a cart this build wrote is read by the old build: every order, every line, the checkout request id and the money rule survive', () => {
  // The orders as this build stores them: the old order shape plus the two version fields (POS.tsx normalizeOrder stamps schema after the spread).
  const written = [
    { id: 'o1', label: 'Order 1', checkoutRequestId: 'req-1', schema: POS_ORDERS_SCHEMA, money_precision_version: KNOWN_MONEY_PRECISION, cart: [CART_LINE], customer: { name: 'Sok', phone: '012000111' } },
    { id: 'o2', label: 'Order 2', checkoutRequestId: '', schema: POS_ORDERS_SCHEMA, money_precision_version: KNOWN_MONEY_PRECISION, cart: [] },
  ]
  const restored = oldRestoreOrders(JSON.stringify(written))
  assert.equal(restored.length, 2)
  assert.deepEqual(restored.map((order) => order.id), ['o1', 'o2'])
  assert.deepEqual(restored[0].cart, [CART_LINE], 'the cart lines are what was saved')
  assert.equal(restored[0].checkoutRequestId, 'req-1', 'an unsent checkout keeps the id that makes a retry safe')
  assert.equal(restored[0].money_precision_version, KNOWN_MONEY_PRECISION, 'the money rule the cart was priced under is kept')
  assert.equal((restored[0].customer as Record<string, unknown>).name, 'Sok')
  assert.deepEqual(restored[1].cart, [])
})

await runTest('POSITIVE CONTROL: a record the old reader cannot use is reported as lost, so the assertions above can fail', () => withStorage(() => {
  const key = 'businessos_draft_v2_rollback_control'
  ;(globalThis as { localStorage: Storage }).localStorage.setItem(key, JSON.stringify({ schema: 1, at: 5, payload: FORM }))
  assert.equal(oldReadWorkDraft(key), null, 'a draft whose data field was renamed reads as nothing, and the old reader removes it')
  assert.equal((globalThis as { localStorage: Storage }).localStorage.getItem(key), null)
  const lost = oldRestoreOrders(JSON.stringify({ orders: [{ id: 'x', cart: [CART_LINE] }] }))
  assert.equal(lost.length, 1)
  assert.deepEqual(lost[0].cart, [], 'a cart stored under another shape comes back empty')
}))

await runTest('MUTANT: a writer that moved the draft body out of `data` is caught by the draft assertion', () => withStorage((local) => {
  const key = 'businessos_draft_v2_rollback_mutant'
  writeWorkDraft(key, FORM)
  const stored = JSON.parse(local.getItem(key) as string)
  local.setItem(key, JSON.stringify({ schema: stored.schema, at: stored.at, payload: stored.data }))
  assert.throws(() => assert.deepEqual(oldReadWorkDraft<typeof FORM>(key)?.data, FORM))
}))

if (failed) { console.error(`${failed} rollbackReadsNewRecords test(s) failed`); process.exit(1) }
console.log('rollbackReadsNewRecords tests passed')
