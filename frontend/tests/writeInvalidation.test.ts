// A write must drop every cached read it changes, in this tab, before any screen reads again.
// Covers the till reading 5 in stock after its own checkout sold one (server: 4), a return leaving the Sales list cached,
// and the coverage rule: every /api family the app can mutate is classified in api/writeInvalidation.ts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiFetch, cacheClearAll, cacheGet, cacheSet, ensureSyncUpdateCacheListener, route, setSyncServerUrl } from '../src/api/http.ts'
import { resetActorReadSession } from '../src/api/actorReadScope.ts'
import { searchProducts } from '../src/api/productReadTransport.ts'
import { apiFamilyOfPath, invalidationsForWritePath, WRITE_FAMILY_INVALIDATES } from '../src/api/writeInvalidation.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const storage = new Map<string, string>()
const listeners = new Map<string, Array<(event: unknown) => void>>()
class TestEvent { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail } }
Object.assign(globalThis, {
  CustomEvent: TestEvent,
  window: {
    location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) }, removeItem: (k: string) => { storage.delete(k) } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout,
    dispatchEvent: (event: { type: string }) => { for (const fn of listeners.get(event.type) || []) fn(event); return true },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, [...(listeners.get(type) || []), fn]) },
    removeEventListener: () => {},
  },
})
setSyncServerUrl('https://fixture.test')
storage.set('businessos_user', JSON.stringify({ id: 1 }))
resetActorReadSession()
cacheClearAll()
ensureSyncUpdateCacheListener()

let stock = 5
const fetched: string[] = []
globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
  const url = String(input).replace('https://fixture.test', '')
  const method = init?.method || 'GET'
  fetched.push(`${method} ${url}`)
  if (method === 'POST' && url === '/api/sales') stock -= 1
  const body = method === 'GET' ? { items: [{ id: 1, name: 'P', stock_quantity: stock }], total: 1 } : { id: 9, ok: true }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const posQuery = { page: 1, pageSize: 30, sort: 'name_asc', surface: 'pos' }
const shown = async () => ((await searchProducts(posQuery)) as { items: Array<{ stock_quantity: number }> }).items[0].stock_quantity
const reset = () => { stock = 5; fetched.length = 0; cacheClearAll() }

await runTest('the till shows the server stock after its own checkout, not the 20 s cached 5', async () => {
  reset()
  assert.equal(await shown(), 5)
  await route('sales:create', () => apiFetch('POST', '/api/sales', { lines: [] }), null, true)
  window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory', source: 'pos-checkout' } }))
  window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales', source: 'pos-checkout' } }))
  assert.equal(await shown(), 4)
  assert.equal(fetched.filter((call) => call.startsWith('GET /api/products/search')).length, 2)
})

await runTest('a raw apiFetch sale write with no route() wrapper also drops the cached grid', async () => {
  reset()
  assert.equal(await shown(), 5)
  await apiFetch('POST', '/api/sales', { lines: [] })
  assert.equal(await shown(), 4)
})

const stockMovers: Array<[string, string, string]> = [
  ['POST', '/api/sales/7/status', 'sale status change'],
  ['PUT', '/api/sales/7', 'sale amendment'],
  ['POST', '/api/sales/bulk-status', 'bulk status'],
  ['POST', '/api/returns', 'return or exchange'],
  ['POST', '/api/returns/bulk-update', 'bulk return'],
  ['POST', '/api/inventory/fast-stock-in', 'fast stock-in'],
  ['POST', '/api/inventory/sessions', 'stock session'],
  ['POST', '/api/inventory/transfer', 'transfer'],
  ['POST', '/api/branches/transfer-bulk', 'bulk transfer'],
  ['POST', '/api/batches/receive', 'batch receive'],
  ['POST', '/api/inventory-checks/3/apply', 'inventory check apply'],
  ['POST', '/api/products/adjust-stock', 'stock adjust'],
  ['POST', '/api/products/merge-duplicates', 'merge'],
  ['DELETE', '/api/products/4', 'product delete'],
  ['POST', '/api/review/5/approve', 'review approve'],
  ['POST', '/api/action-history/5/undo', 'undo'],
  ['POST', '/api/import-jobs/5/start', 'import'],
]
for (const [method, apiPath, label] of stockMovers) {
  await runTest(`${label} drops the cached product grid and Products bootstrap`, async () => {
    reset()
    cacheSet('products:search:q', 'old'); cacheSet('products:bootstrap:q', 'old'); cacheSet('products:byIds:1', 'old')
    await apiFetch(method, apiPath, {})
    for (const key of ['products:search:q', 'products:bootstrap:q', 'products:byIds:1']) assert.equal(cacheGet(key), null, `${key} survived ${method} ${apiPath}`)
  })
}

await runTest('a return drops the cached Sales list, stats and header strip', async () => {
  for (const apiPath of ['/api/returns', '/api/returns/bulk-update']) {
    reset()
    for (const key of ['sales:get:page=1', 'sales:stats:x', 'returns:get', 'dashboard:startup', 'customers:get']) cacheSet(key, 'old')
    await apiFetch('POST', apiPath, {})
    for (const key of ['sales:get:page=1', 'sales:stats:x', 'returns:get', 'dashboard:startup', 'customers:get']) assert.equal(cacheGet(key), null, `${key} survived ${apiPath}`)
  }
})

await runTest('a change another device pushed over sync drops the same product reads', () => {
  reset()
  cacheSet('products:search:q', 'old')
  for (const channel of ['inventory', 'sales', 'returns', 'batches']) {
    cacheSet('products:search:q', 'old')
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel } }))
    assert.equal(cacheGet('products:search:q'), null, channel)
  }
})

await runTest('writes that do not touch stock keep the product and sales caches (the read saving stays)', async () => {
  const writes: Array<[string, string]> = [['POST', '/api/settings'], ['POST', '/api/notes'], ['PUT', '/api/users/3'], ['POST', '/api/telegram/test'], ['POST', '/api/roles']]
  for (const [method, apiPath] of writes) {
    reset()
    cacheSet('products:search:q', 'kept'); cacheSet('sales:get:page=1', 'kept')
    await apiFetch(method, apiPath, {})
    assert.equal(cacheGet('products:search:q'), 'kept', `${apiPath} dropped products:search`)
    assert.equal(cacheGet('sales:get:page=1'), 'kept', `${apiPath} dropped sales`)
  }
  reset()
  cacheSet('settings:get', 'kept'); cacheSet('users:get', 'kept'); cacheSet('products:search:q', 'old')
  await apiFetch('POST', '/api/sales', {})
  for (const key of ['settings:get', 'users:get']) assert.equal(cacheGet(key), 'kept', `a sale must not drop ${key}`)
  assert.equal(cacheGet('products:search:q'), null)
})

await runTest('a quote or preview POST writes nothing, so it keeps every cached read', async () => {
  reset()
  cacheSet('products:search:q', 'kept'); cacheSet('sales:get:page=1', 'kept')
  for (const apiPath of ['/api/products/resolve/cost-preview', '/api/products/receiving-cost-preview', '/api/returns/quote', '/api/returns/legacy-convert/preview', '/api/inventory/dated-stock-count/preview']) {
    await apiFetch('POST', apiPath, {})
    assert.equal(cacheGet('products:search:q'), 'kept', apiPath)
    assert.equal(cacheGet('sales:get:page=1'), 'kept', apiPath)
  }
})

await runTest('a mutation to a family nobody mapped clears every cached read instead of leaving one stale', async () => {
  reset()
  cacheSet('products:search:q', 'old'); cacheSet('sales:get:page=1', 'old')
  assert.equal(invalidationsForWritePath('/api/brand-new-thing/1'), null)
  await apiFetch('POST', '/api/brand-new-thing/1', {})
  assert.equal(cacheGet('products:search:q'), null)
  assert.equal(cacheGet('sales:get:page=1'), null)
})

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}
const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

await runTest('every /api family the app references is classified in the write-invalidation map', () => {
  const families = new Map<string, string>()
  for (const file of sourceFiles(srcRoot)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"`]\/api\/([a-z][a-z-]*)/g)) if (!families.has(match[1])) families.set(match[1], path.relative(srcRoot, file))
  }
  assert.ok(families.size > 20, 'the scan found the app families')
  const unmapped = [...families].filter(([family]) => !Object.prototype.hasOwnProperty.call(WRITE_FAMILY_INVALIDATES, apiFamilyOfPath(`/api/${family}`)))
  assert.deepEqual(unmapped, [], `classify these /api families in src/api/writeInvalidation.ts: ${unmapped.map(([f, file]) => `${f} (${file})`).join(', ')}`)
})

await runTest('every literal mutating apiFetch call resolves to a mapped family', () => {
  const bad: string[] = []
  let seen = 0
  for (const file of sourceFiles(srcRoot)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/apiFetch\(\s*['"](POST|PUT|PATCH|DELETE)['"]\s*,\s*[`'"](\/api\/[^`'"?$]*)/g)) {
      seen += 1
      if (invalidationsForWritePath(match[2]) === null) bad.push(`${match[1]} ${match[2]} in ${path.relative(srcRoot, file)}`)
    }
  }
  assert.ok(seen > 100, `expected the scan to see the mutating calls, saw ${seen}`)
  assert.deepEqual(bad, [])
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('writeInvalidation: all passed')
