import assert from 'node:assert/strict'
import { listCatalogPriceAttempts, prepareCatalogPriceAttempt, readCatalogPriceAttempt, settleCatalogPriceAttempt } from '../src/utils/productBulkPriceAttempt.ts'
import { writeWorkDraft } from '../src/utils/workDrafts.ts'

const memory = new Map<string, string>()
let blocked = false
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { if (blocked) throw Error('full'); memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) }, get length() { return memory.size }, key: (i: number) => [...memory.keys()][i] ?? null }
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: { location: { origin: 'https://app.test' } } })
memory.set('businessos_user', JSON.stringify({ id: 7 }))
memory.set('businessos_sync_server', 'https://server.test')
const intent = { direction: 'increase' as const, amount: 1, fields: ['selling_price_usd'], skip_zero: false }
const first = prepareCatalogPriceAttempt(intent, 2)
assert.deepEqual(readCatalogPriceAttempt(intent), first.attempt)
assert.equal(prepareCatalogPriceAttempt(intent, 99).attempt.count, 2, 'reload preserves original review count')
const changed = prepareCatalogPriceAttempt({ ...intent, amount: 2 }, 2)
assert.notEqual(changed.attempt.payload.client_request_id, first.attempt.payload.client_request_id)
assert.equal(listCatalogPriceAttempts().length, 2)
memory.set('businessos_sync_server', 'https://other.test')
assert.equal(listCatalogPriceAttempts().length, 0)
assert.equal(readCatalogPriceAttempt(intent), null)
memory.set('businessos_sync_server', 'https://server.test')
memory.set('businessos_user', JSON.stringify({ id: 8 }))
assert.equal(listCatalogPriceAttempts().length, 0)
memory.set('businessos_user', JSON.stringify({ id: 7 }))
const draftKey = [...memory.keys()].find(k => k.includes('catalog_price_adjust:') && k.endsWith(encodeURIComponent(JSON.stringify(intent))))!
writeWorkDraft(draftKey, { ...first.attempt, payload: { ...first.attempt.payload, client_request_id: 'replacement_request_id' } })
assert.equal(settleCatalogPriceAttempt(first.attempt, first.saved), false, 'late ACK cannot erase replaced draft')
assert.equal(readCatalogPriceAttempt(intent)?.payload.client_request_id, 'replacement_request_id')
memory.set(draftKey, '{broken')
assert.throws(() => prepareCatalogPriceAttempt(intent, 2), /could not be saved/)
assert.equal(memory.get(draftKey), '{broken', 'malformed saved authority is never overwritten')
blocked = true
assert.throws(() => prepareCatalogPriceAttempt({ ...intent, amount: 3 }, 2), /could not be saved/)
assert.equal(readCatalogPriceAttempt({ ...intent, amount: 3 }), null)
console.log('catalog price durable attempt PASS: original identity/count, changed intent, actor/server isolation, CAS, corruption/storage refusal')
