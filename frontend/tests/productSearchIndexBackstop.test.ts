// The search index's backstop depends on the sync socket. Socket up: a catalogue change anywhere is pushed (and marks the index stale, revalidated after about 1.5 s), so the backstop is 15
// minutes. Socket down or unknown: nothing is pushed, so it stays the 60 s it was. A change marked while a load runs must not be lost to the longer backstop: the load runs once more.
// A sale still asks for nothing. Fails on the old single 60 s backstop (a) and on a load that clears a mark it did not see (c).
//
// Run: node tests/productSearchIndexBackstop.test.ts
import assert from 'node:assert/strict'
import { cacheInvalidate } from '../src/api/http.ts'
import { invalidationsForWritePath } from '../src/api/writeInvalidation.ts'
import { __productSearchIndexTest, ensureProductSearchIndex, productSearchIndexStatus, searchProductIndex } from '../src/api/productSearchIndex.ts'

type Packed = [number, string, string, string, string, string]
const catalog: Packed[] = [[1, 'Velvet Matte Lipstick', 'Maison', 'Lips', '8851000000011', 'SKU-1'], [2, 'Hydra Glow Serum', 'Aurelle', 'Skincare', '8851000000028', 'SKU-2']]
const hash = (rows: Packed[]) => { let h = 0x811c9dc5; const s = JSON.stringify(rows); for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
const requests: Array<{ page: number; have?: string }> = []
let gate: Promise<void> | null = null
let socketUp = true
const { transport } = __productSearchIndexTest
transport.socketUp = () => socketUp
transport.fetchPage = async (page, have) => {
  requests.push({ page, have })
  const answer = have === hash(catalog) ? { format: 1, page, buckets: [0], hash: hash(catalog), unchanged: true } : { format: 1, page, buckets: [0], hash: hash(catalog), rows: catalog.map((r) => [...r] as Packed) }
  if (gate) await gate
  return answer
}
transport.readStored = async () => null
transport.writeStored = async () => {}

let offset = 0
const realNow = Date.now.bind(Date)
Date.now = () => realNow() + offset
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

await ensureProductSearchIndex()
assert.equal(productSearchIndexStatus(), 'ready')
const loaded = requests.length

// (a) socket up, no catalogue change: five minutes of searches send nothing.
for (let minute = 1; minute <= 5; minute += 1) {
  offset = minute * 60_000
  assert.ok(searchProductIndex('serum'), 'the index answers')
}
await sleep(50)
assert.equal(requests.length, loaded, '(a) socket up: 5 minutes of searches send no refresh request')
offset = 16 * 60_000
searchProductIndex('serum')
await sleep(50)
assert.equal(requests.length, loaded + 1, '(a) socket up: the 15 minute backstop still fires')

// (b) socket down: a refresh is sent after 60 s.
socketUp = false
const before = requests.length
offset += 30_000
searchProductIndex('serum')
await sleep(50)
assert.equal(requests.length, before, '(b) 30 s: nothing yet')
offset += 31_000
searchProductIndex('serum')
await sleep(50)
assert.equal(requests.length, before + 1, '(b) socket down: a refresh is sent after 60 s')
socketUp = true

// (d) a sale still triggers none.
const afterB = requests.length
for (const prefix of invalidationsForWritePath('/api/sales') || []) cacheInvalidate(prefix)
await sleep(1800)
assert.equal(requests.length, afterB, '(d) a sale asks for nothing')

// (c) a change marked while a load runs triggers exactly one more load.
// The first load of a tab is the case that matters: the status is not 'ready' yet, so the catalogue-change handler schedules no revalidation of its own, and the mark would otherwise wait for the backstop.
__productSearchIndexTest.reset()
let release: () => void = () => {}
gate = new Promise<void>((resolve) => { release = resolve })
const running = ensureProductSearchIndex(true)
await sleep(20)
assert.equal(requests.length, afterB + 1, 'the forced load is in flight')
catalog.push([3, 'Rose Water Toner', 'Aurelle', 'Skincare', '8851000000035', 'SKU-3'])
for (const prefix of invalidationsForWritePath('/api/products') || []) cacheInvalidate(prefix)
gate = null
release()
await running
await sleep(1800)
assert.equal(requests.length, afterB + 2, '(c) exactly one more load after the one a change landed in')
assert.equal(searchProductIndex('toner')?.hits[0]?.id, 3, '(c) the change that landed during the load is in the index')

Date.now = realNow
console.log('PASS the search index backstop: 15 min with the socket up, 60 s without; a change marked during a load is caught by one more load; a sale asks for nothing')
process.exit(0)
