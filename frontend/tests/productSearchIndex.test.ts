// G37 phase 1: the client search index (src/api/productSearchIndex.ts),
// driven through its transport seam by a fake Worker that serves the real
// /search-index page contract (fixed id-range pages, ?have= -> unchanged,
// occupied buckets) over the committed real-catalog fixture.
//
// Covers: first load pages every bucket; a revalidation sends every held
// hash and receives "unchanged"; an edit re-downloads and rebuilds; a new
// id range adds a bucket and a vanished one is dropped; a stored index is
// used before the network answers; a 403 leaves the pickers on the server
// search; productSearchRequest hands ranked ids (or the text, when the
// index is not ready or found nothing).
//
// Run: node tests/productSearchIndex.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  __productSearchIndexTest,
  ensureProductSearchIndex,
  markProductSearchIndexStale,
  productSearchIndexStatus,
  productSearchRequest,
  rankedIdParams,
  searchProductIndex,
} from '../src/api/productSearchIndex.ts'

type Row = { id: number; name: string; brand: string | null; category: string | null; barcode: string | null; sku: string | null }
type Packed = [number, string, string, string, string, string]
const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'search-core-catalog-sample.json')
const rows = (JSON.parse(readFileSync(fixture, 'utf8')) as { rows: Row[] }).rows
const PAGE_IDS = 2000

const catalog = new Map(rows.map((row) => [row.id, { ...row }]))
function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
function servePage(page: number, have?: string) {
  const ids = [...catalog.keys()].sort((a, b) => a - b)
  const buckets = [...new Set(ids.map((id) => Math.floor(id / PAGE_IDS)))]
  const packed: Packed[] = ids.filter((id) => Math.floor(id / PAGE_IDS) === page).map((id) => {
    const row = catalog.get(id) as Row
    return [id, row.name || '', row.brand || '', row.category || '', row.barcode || '', row.sku || '']
  })
  const hash = fnv(`1:${page}:${JSON.stringify(packed)}`)
  if (have && have === hash) return { format: 1, page, buckets, pageIds: PAGE_IDS, hash, unchanged: true }
  return { format: 1, page, buckets, pageIds: PAGE_IDS, hash, rows: packed }
}

const requests: Array<{ page: number; have?: string }> = []
let denied = false
let stored: unknown = null
const { transport } = __productSearchIndexTest
transport.fetchPage = async (page, have) => {
  requests.push({ page, have })
  if (denied) throw Object.assign(new Error('forbidden'), { status: 403 })
  return servePage(page, have)
}
transport.readStored = async () => stored
transport.writeStored = async (value) => { stored = JSON.parse(JSON.stringify(value)) }
const nameOf = (id: number): string => String(catalog.get(id)?.name || '')

const buckets = servePage(0).buckets
assert.ok(buckets.length >= 2, 'fixture spans several pages')

// 1. Not ready yet: the pickers keep the server text search.
assert.equal(searchProductIndex('Blush Palette'), null)
assert.deepEqual(productSearchRequest('Blush Palette').params, { query: 'Blush Palette' })

// 2. First load: page 0, then every other occupied bucket.
await ensureProductSearchIndex()
assert.equal(productSearchIndexStatus(), 'ready')
assert.deepEqual(requests.map((r) => r.page).sort((a, b) => a - b), buckets)
assert.ok(requests.every((r) => !r.have), 'nothing held yet')
const blush = searchProductIndex('Blush Palette')
assert.ok(blush && blush.hits.slice(0, 30).some((hit) => /evil eye/i.test(nameOf(hit.id))))
const request = productSearchRequest('Blush Palette')
assert.equal(request.params.rankIds.split(',').length, blush.total)
assert.equal(request.params.rankTiers.length, blush.total)
assert.deepEqual(rankedIdParams(blush, 3).rankIds.split(',').map(Number), blush.hits.slice(0, 3).map((hit) => hit.id))
assert.deepEqual(productSearchRequest('zzzz').params, { query: 'zzzz' }, 'nothing found: the server is asked')
assert.deepEqual(productSearchRequest('   ').params, {})
assert.ok(stored, 'the index is stored for the next session')

// 3. Revalidation: every held page goes out with its hash, all unchanged.
requests.length = 0
markProductSearchIndexStale()
await ensureProductSearchIndex()
assert.equal(requests.length, buckets.length)
assert.ok(requests.every((r) => typeof r.have === 'string' && r.have.length === 8))
const generationBefore = __productSearchIndexTest.state.generation

// 4. An edit on another device re-downloads its page; the rename is searchable.
const target = rows.find((row) => /evil eye/i.test(row.name)) as Row
;(catalog.get(target.id) as Row).name = 'Zzyzx Renamed Essence'
markProductSearchIndexStale()
await ensureProductSearchIndex()
assert.ok(__productSearchIndexTest.state.generation > generationBefore)
assert.equal(searchProductIndex('zzyzx')?.hits[0].id, target.id)
assert.ok(!searchProductIndex('evil eye')?.hits.some((hit) => hit.id === target.id), 'the old name no longer matches')

// 5. A new id range brings a new bucket; a vanished one is dropped.
catalog.set(46001, { id: 46001, name: 'Brand New Blush Palette Qwerty', brand: 'Hourglass', category: null, barcode: null, sku: null })
markProductSearchIndexStale()
await ensureProductSearchIndex()
assert.equal(searchProductIndex('qwerty')?.hits[0].id, 46001)
catalog.delete(46001)
markProductSearchIndexStale()
await ensureProductSearchIndex()
assert.equal(searchProductIndex('qwerty')?.total, 0)

// 6. A new session starts from the stored index before the network answers.
__productSearchIndexTest.reset()
let release: () => void = () => {}
const gate = new Promise<void>((resolve) => { release = resolve })
const realFetch = transport.fetchPage
transport.fetchPage = async (page, have) => { await gate; return realFetch(page, have) }
const loading = ensureProductSearchIndex()
for (let i = 0; i < 200 && productSearchIndexStatus() !== 'ready'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
assert.equal(productSearchIndexStatus(), 'ready', 'ready from storage')
assert.ok((searchProductIndex('zzyzx')?.total ?? 0) >= 1)
release()
await loading
transport.fetchPage = realFetch

// 7. A denied account keeps the server search.
__productSearchIndexTest.reset()
stored = null
denied = true
await ensureProductSearchIndex()
assert.equal(productSearchIndexStatus(), 'unavailable')
assert.equal(searchProductIndex('Blush Palette'), null)
assert.deepEqual(productSearchRequest('Blush Palette').params, { query: 'Blush Palette' })

console.log('PASS productSearchIndex')
