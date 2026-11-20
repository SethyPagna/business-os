// QW1: the till's search index holds catalogue text and identity only, so a sale, a stock write or a pushed sales/inventory/returns update must not reset it, and a real catalogue change
// (create, rename, barcode, merge, deactivate: the plain 'products' invalidation) must refresh it. Before this change every sale's 'products:search' invalidation moved the whole 'products'
// read-scope entity, searchProductIndex found its scope stale, reset itself and returned null: POS fell back to the server text search (about 17,100 rows a request).
//
// Drives the real invalidation entry points (writeInvalidation.ts's map applied through http.ts cacheInvalidate, as apiFetch and the sync listener do) over the module's transport seam.
//
// Run: node tests/productSearchIndexSurvivesSales.test.ts
import assert from 'node:assert/strict'
import { cacheInvalidate, cacheInvalidateWithDerived } from '../src/api/http.ts'
import { invalidationsForWritePath } from '../src/api/writeInvalidation.ts'
import {
  __productSearchIndexTest,
  ensureProductSearchIndex,
  productSearchIndexStatus,
  productSearchRequest,
  searchProductIndex,
} from '../src/api/productSearchIndex.ts'

type Packed = [number, string, string, string, string, string]
const catalog = new Map<number, Packed>([
  [1, [1, 'Velvet Matte Lipstick', 'Maison', 'Lips', '8851000000011', 'SKU-1']],
  [2, [2, 'Hydra Glow Serum', 'Aurelle', 'Skincare', '8851000000028', 'SKU-2']],
  [3, [3, 'Rose Water Toner', 'Aurelle', 'Skincare', '8851000000035', 'SKU-3']],
])
function hashOf(rows: Packed[]): string {
  let hash = 0x811c9dc5
  const text = JSON.stringify(rows)
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash.toString(16).padStart(8, '0')
}
const requests: Array<{ page: number; have?: string }> = []
const { transport } = __productSearchIndexTest
transport.fetchPage = async (page, have) => {
  requests.push({ page, have })
  const rows = [...catalog.values()].sort((a, b) => a[0] - b[0])
  const hash = hashOf(rows)
  return have === hash ? { format: 1, page, buckets: [0], hash, unchanged: true } : { format: 1, page, buckets: [0], hash, rows }
}
transport.readStored = async () => null
transport.writeStored = async () => {}

await ensureProductSearchIndex()
assert.equal(productSearchIndexStatus(), 'ready')
assert.equal(searchProductIndex('serum')?.hits[0].id, 2, 'the index answers')
const loadedRequests = requests.length

// 1. Every write that moves stock or money, applied through the real map: the index is still used and nothing is requested.
const nonCatalogue = ['/api/sales', '/api/sales/12/payments', '/api/returns', '/api/review', '/api/inventory/adjust', '/api/batches', '/api/branches', '/api/transfers', '/api/inventory-checks', '/api/promotions']
for (const path of nonCatalogue) {
  const prefixes = invalidationsForWritePath(path)
  assert.ok(prefixes && prefixes.length, `${path} is a mapped write`)
  for (const prefix of prefixes) cacheInvalidate(prefix)
  assert.ok(searchProductIndex('serum'), `${path}: the index is still used after the write's invalidation`)
  assert.equal(productSearchIndexStatus(), 'ready', `${path}: still ready`)
}
// ...and the same for a change pushed from another device: sync:update for sales / inventory / returns (cacheInvalidateWithDerived(channel family)).
for (const family of ['sales', 'inventory', 'returns', 'batches', 'transfers']) {
  cacheInvalidateWithDerived(family)
  assert.ok(searchProductIndex('serum'), `a pushed ${family} update leaves the index in use`)
}
const request = productSearchRequest('serum')
assert.ok(request.params.rankIds, 'the till sends ranked ids, not the text, after a sale')
assert.equal(request.params.query, undefined)
await new Promise((resolve) => setTimeout(resolve, 1800))
assert.equal(requests.length, loadedRequests, 'no write of stock or money asked the server for the index again')

// 2. A rename: the products family clears the plain 'products' prefix. The index is kept (its old text still matches) and refreshes by hash, then finds the new name.
catalog.set(2, [2, 'Hydra Glow Essence Renamed', 'Aurelle', 'Skincare', '8851000000028', 'SKU-2'])
for (const prefix of invalidationsForWritePath('/api/products/2') || []) cacheInvalidate(prefix)
assert.ok(searchProductIndex('serum'), 'a rename does not drop the index either')
await new Promise((resolve) => setTimeout(resolve, 1800))
assert.ok(requests.length > loadedRequests, 'the rename made the index revalidate')
assert.ok(requests.slice(loadedRequests).every((r) => typeof r.have === 'string'), 'by hash (?have=), not a download from scratch')
assert.equal(searchProductIndex('renamed')?.hits[0].id, 2, 'the new name is found')
assert.equal(searchProductIndex('serum')?.total, 0, 'the old name no longer matches')

// 3. Create, barcode edit, merge and deactivate go through the same products family.
let seen = requests.length
catalog.set(4, [4, 'Cushion Foundation', 'Maison', 'Face', '8851000000042', 'SKU-4'])
for (const prefix of invalidationsForWritePath('/api/products') || []) cacheInvalidate(prefix)
await new Promise((resolve) => setTimeout(resolve, 1800))
assert.ok(requests.length > seen, 'a create revalidates')
assert.equal(searchProductIndex('cushion')?.hits[0].id, 4, 'the new product is found')
seen = requests.length
catalog.delete(3)
for (const prefix of invalidationsForWritePath('/api/products/merge-duplicates') || []) cacheInvalidate(prefix)
await new Promise((resolve) => setTimeout(resolve, 1800))
assert.ok(requests.length > seen, 'a merge or deactivation revalidates')
assert.equal(searchProductIndex('toner')?.total, 0, 'the removed product is gone')

console.log('PASS the search index survives sales, stock, returns and pushed updates; a catalogue change revalidates it by hash')
process.exit(0)
