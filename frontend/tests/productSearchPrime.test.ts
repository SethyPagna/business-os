import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as scopes from '../src/api/actorReadScope.ts'
import * as http from '../src/api/http.ts'
import * as query from '../src/api/query.ts'

// INV-B S4b: primeProductSearch / peekProductSearch (api/productReadTransport.ts). Inventory Check primes the shared Products store with an IC answer that IS the Products answer,
// and peeks it to skip its own list request. Tab memory only: it is the http.ts read cache under Products' own key, so an actor change, a products sync event and a write drop it,
// and searchProducts finds it first (no request).
const storage = new Map<string, string>()
Object.assign(globalThis, { window: {
  location: { origin: 'https://fixture.test' }, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } },
  sessionStorage: { getItem: () => null }, setTimeout: (fn: () => void, ms: number) => (ms === 10000 ? 1 : setTimeout(fn, ms)), clearTimeout, dispatchEvent: () => true, addEventListener: () => {},
} })
http.setSyncServerUrl('https://fixture.test')
function actor(id: number) { storage.set('businessos_user', JSON.stringify({ id })); scopes.resetActorReadSession(); http.cacheClearAll() }
function loadModule(path: string, dependencies: Record<string, unknown>): any {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', 'require', code)(exports, (name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name] })
  return exports
}
const transport = loadModule('../src/api/productReadTransport.ts', { './actorReadScope.ts': scopes, './http.ts': http, './query.ts': query, './queryCache.ts': {} })
let fetched: string[] = []
const oldFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown) => { fetched.push(String(input)); return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch

const q = 'page=1&pageSize=20&searchMode=AND&sort=name_asc&include=branch_stock%2Cimages%2Cbatches%2Ctagged_lots'
const answer = { items: [{ id: 1, name: 'Held', branch_stock: [{ branch_id: 1, quantity: 4 }] }], total: 1, page: 1, pageSize: 20, totalPages: 1 }
try {
  actor(1)
  assert.equal(transport.peekProductSearch(q), null, 'nothing held at first')
  transport.primeProductSearch(q, answer, { products: 5 })
  assert.equal(transport.peekProductSearch(q), answer, 'the primed answer is held')
  const read = await transport.searchProducts({ page: 1, pageSize: 20, searchMode: 'AND', sort: 'name_asc', include: 'branch_stock,images,batches,tagged_lots' })
  assert.equal(read, answer, 'searchProducts finds it first: the same object, Products reuses the rows')
  assert.deepEqual(fetched, [], 'and sends no request')

  transport.primeProductSearch(q, { ...answer, total: 99 }, { products: 4 })
  assert.equal(transport.peekProductSearch(q), answer, 'an answer older than the one held does not replace it')
  const newer = { ...answer, total: 2 }
  transport.primeProductSearch(q, newer, { products: 6 })
  assert.equal(transport.peekProductSearch(q), newer, 'a newer one does')

  assert.equal(transport.peekProductSearch(q + '&x=1'), null, 'another query holds nothing')
  await transport.searchProducts({ page: 2, pageSize: 20, searchMode: 'AND', sort: 'name_asc', include: 'branch_stock,images,batches,tagged_lots' })
  assert.equal(fetched.length, 1, 'a query that was not primed goes to the server')

  http.cacheInvalidateWithDerived('products')
  assert.equal(transport.peekProductSearch(q), null, 'a products change drops it, like any read')
  transport.primeProductSearch(q, answer, { products: 7 })
  actor(2)
  assert.equal(transport.peekProductSearch(q), null, 'another account never sees it')
  console.log('productSearchPrime passed: prime, peek, searchProducts first, version order, invalidation, actor change')
} finally {
  globalThis.fetch = oldFetch
}
