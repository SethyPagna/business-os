// B3 (REVIEW-wave1-B) + round-2 review: the write-invalidation map must clear every stock or money read the app caches.
//
// The read channels are RECORDED AT RUNTIME, not read from source: every transport under src/api is imported, every exported
// function is called with a stub fetch, and the real http.ts route() logs the channel of each call that sent only GETs
// (getCallLog). That sees the channels a wrapper builds (routeCachedProductQuery, routeMirrored, a cacheKey variable) which a
// source scan cannot. Inventory Check reads are plain apiFetch GETs with no route channel, so they hold no per-channel cache.
//
// Checks, all through the real cache (cacheSet, then the write's prefixes through cacheInvalidate, then cacheGet):
//   1. every recorded channel of a stock or money entity is cleared by at least one write family;
//   2. per-family expectations: a sale, return, transfer, stock adjust or receive clears the product grid and every
//      inventory read; a promotion clears every product read; a sale or return also clears the money reads;
//   3. positive controls: remove ONE family->prefix link and the test names that family and channel.
//
// Run: node tests/readChannelCoverage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const storage = new Map<string, string>()
Object.assign(globalThis, {
  CustomEvent: class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail } },
  window: {
    location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) }, removeItem: (k: string) => { storage.delete(k) } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
  },
})
const http = await import('../src/api/http.ts')
const { resetActorReadSession } = await import('../src/api/actorReadScope.ts')
const { WRITE_FAMILY_INVALIDATES, apiFamilyOfPath, invalidationsForWritePath } = await import('../src/api/writeInvalidation.ts')
http.setSyncServerUrl('https://fixture.test')
storage.set('businessos_user', JSON.stringify({ id: 1 }))
resetActorReadSession()
http.cacheClearAll()

// ---- record the read channels at runtime ----
const methodsSeen: string[] = []
globalThis.fetch = (async (_input: unknown, init?: { method?: string }) => {
  methodsSeen.push(init?.method || 'GET')
  return new Response(JSON.stringify({ items: [], rows: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

/** `products:dataGaps:kind=1` -> `products:dataGaps`: keep the leading name segments, drop ids, queries and placeholders. */
function channelHead(channel: string): string {
  const keep: string[] = []
  for (const segment of channel.split(':')) {
    if (!/^[A-Za-z][\w-]*$/.test(segment) || segment === 'undefined' || segment === 'NaN') break
    keep.push(segment)
  }
  return keep.join(':')
}

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'api')
const ARG_SHAPES: unknown[][] = [[], [{}], [1, {}], [[1, 2]]]
const recorded = new Map<string, string>()
const recordedBy = new Set<string>()
const importFailures: string[] = []
for (const file of fs.readdirSync(apiDir).filter((name) => /(Transport|Mirrors|methods|notificationSummary)\.ts$/.test(name)).sort()) {
  let mod: Record<string, unknown>
  try { mod = await import(pathToFileURL(path.join(apiDir, file)).href) } catch { importFailures.push(file); continue }
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue
    for (const args of ARG_SHAPES) {
      if (recordedBy.has(`${file}:${name}`)) break
      http.cacheClearAll(); http.clearCallLog(); methodsSeen.length = 0
      try { await Promise.race([(fn as (...a: unknown[]) => unknown)(...args), new Promise((resolve) => setTimeout(resolve, 8))]) } catch { /* a throwing shape is skipped */ }
      await new Promise((resolve) => setTimeout(resolve, 2))
      if (methodsSeen.length && methodsSeen.every((method) => method === 'GET')) {
        for (const entry of http.getCallLog()) { const head = channelHead(entry.channel); if (head) { recorded.set(head, `${file}:${name}`); recordedBy.add(`${file}:${name}`) } }
      }
    }
  }
}
http.cacheClearAll()

// ---- classify entities: derived from the map, with a fail-safe for a new one ----
// Stock or money = an entity the stock- and money-moving write families clear. An entity that is neither that nor listed
// in NOT_STOCK_OR_MONEY fails the test, so a new read family has to be classified deliberately instead of slipping past.
const MOVERS = ['sales', 'returns', 'products', 'inventory', 'batches', 'branches', 'transfers']
const stockMoneyEntities = new Set(MOVERS.flatMap((family) => WRITE_FAMILY_INVALIDATES[family] || []).map((prefix) => prefix.split(':')[0]))
const NOT_STOCK_OR_MONEY = new Set([
  'actionHistory', 'ai', 'audit_log', 'auth', 'categories', 'deliveryContacts', 'files', 'importJobs', 'notes', 'notifications',
  'organizations', 'portalSubmissions', 'review', 'roles', 'settings', 'suppliers', 'system', 'units', 'users',
])
const entityOf = (channel: string): string => channel.split(':')[0]
const stockMoney = [...recorded.keys()].filter((channel) => stockMoneyEntities.has(entityOf(channel)))

type Lookup = (writePath: string) => readonly string[] | null
const realLookup: Lookup = invalidationsForWritePath

/**
 * The expectations name a PREFIX link, not just a cleared channel: the cache also drops every read of an entity when any prefix
 * of that entity is cleared (the per-entity read revision), which would hide a removed link behind a sibling one.
 */
const covers = (prefixes: readonly string[], channel: string): boolean => prefixes.some((prefix) => channel.startsWith(prefix))

/** Cached under `channel`, then the write's prefixes applied through the real cache: is the channel still readable? */
function clearedBy(prefixes: readonly string[], channel: string): boolean {
  http.cacheClearAll()
  http.cacheSet(channel, 'old')
  for (const prefix of prefixes) http.cacheInvalidate(prefix)
  const cleared = http.cacheGet(channel) === null
  http.cacheClearAll()
  return cleared
}

const STOCK_MOVING_WRITES = ['/api/sales', '/api/sales/7/status', '/api/returns', '/api/returns/bulk-update', '/api/inventory/adjust', '/api/inventory/transfer', '/api/branches/transfer-bulk', '/api/batches/receive', '/api/products/adjust-stock']
const MONEY_WRITES = ['/api/sales', '/api/returns']
const MONEY_ENTITIES = ['sales', 'returns', 'dashboard', 'analytics', 'shifts', 'customers', 'fees']
const PRODUCT_GRID_READS = ['products:search', 'products:bootstrap', 'products:byIds:v2', 'products:filters', 'products:get']

/** The per-family expectations, as failure strings naming the write and the read it leaves cached. */
function expectationFailures(lookup: Lookup): string[] {
  const out: string[] = []
  const productGrid = stockMoney.filter((channel) => PRODUCT_GRID_READS.includes(channel) && channel !== 'products:filters')
  const filters = stockMoney.filter((channel) => channel === 'products:filters')
  const inventory = stockMoney.filter((channel) => entityOf(channel) === 'inventory')
  const money = stockMoney.filter((channel) => MONEY_ENTITIES.includes(entityOf(channel)))
  const check = (writePath: string, channels: string[]) => {
    const prefixes = lookup(writePath)
    for (const channel of channels) {
      if (!prefixes || !covers(prefixes, channel) || !clearedBy(prefixes, channel)) out.push(`${apiFamilyOfPath(writePath)} (${writePath}) leaves ${channel} cached`)
    }
  }
  for (const writePath of STOCK_MOVING_WRITES) { check(writePath, productGrid); check(writePath, inventory) }
  // The filter facets (low stock, stock state) are cleared through the products entity: judged at runtime, not by prefix.
  for (const writePath of STOCK_MOVING_WRITES) for (const channel of filters) { const prefixes = lookup(writePath); if (!prefixes || !clearedBy(prefixes, channel)) out.push(`${apiFamilyOfPath(writePath)} (${writePath}) leaves ${channel} cached`) }
  for (const writePath of ['/api/promotions', '/api/promotions/3']) check(writePath, productGrid)
  for (const writePath of MONEY_WRITES) check(writePath, money)
  return out
}

await runTest('the runtime walk recorded the wrapper-built channels a source scan missed', () => {
  assert.deepEqual(importFailures.filter((file) => !/appBootstrap/.test(file)), [], 'a transport failed to import')
  for (const channel of ['products:search', 'products:bootstrap', 'products:byIds:v2', 'products:filters', 'products:get', 'inventory:products:search:v2', 'returns:get', 'sales:stats', 'sales:get', 'shifts:list', 'shifts:current', 'branches:summary', 'inventory:stats', 'dashboard:startup', 'fees:get:all', 'transfers:get']) {
    assert.ok(stockMoney.includes(channel), `not recorded: ${channel} (recorded: ${stockMoney.join(', ')})`)
  }
  assert.ok(stockMoney.length >= 40, `expected the stock and money channels, found ${stockMoney.length}`)
})

await runTest('every recorded read entity is classified (stock/money by the map, or listed as neither)', () => {
  const unclassified = [...new Set([...recorded.keys()].map(entityOf))].filter((entity) => !stockMoneyEntities.has(entity) && !NOT_STOCK_OR_MONEY.has(entity))
  assert.deepEqual(unclassified, [], `classify these read entities in the map or in NOT_STOCK_OR_MONEY: ${unclassified.join(', ')}`)
})

await runTest('every stock and money read channel is cleared by at least one write family', () => {
  const missing = stockMoney.filter((channel) => !Object.values(WRITE_FAMILY_INVALIDATES).some((prefixes) => clearedBy(prefixes, channel)))
  assert.deepEqual(missing, [], `no write family clears: ${missing.map((channel) => `${channel} (${recorded.get(channel)})`).join(', ')}`)
})

await runTest('per-family expectations hold: stock-moving writes clear the product grid and inventory reads, promotions clear every product read, sales and returns clear the money reads', () => {
  assert.deepEqual(expectationFailures(realLookup), [])
})

await runTest('positive control: dropping the single products:search link from the sales family is reported by name', () => {
  const salesWithout = WRITE_FAMILY_INVALIDATES.sales.filter((prefix) => prefix !== 'products:search')
  const lookup: Lookup = (writePath) => (/^\/api\/sales(\/|$)/.test(writePath) ? salesWithout : realLookup(writePath))
  const failures = expectationFailures(lookup)
  assert.ok(failures.some((line) => line.startsWith('sales (/api/sales)') && line.endsWith('leaves products:search cached')), `the control saw: ${failures.join(' | ') || 'nothing'}`)
  assert.ok(!failures.some((line) => line.startsWith('returns')), 'an untouched family is not reported')
})

await runTest('positive control: dropping the inventory prefix from the returns family is reported by name', () => {
  const returnsWithout = WRITE_FAMILY_INVALIDATES.returns.filter((prefix) => prefix !== 'inventory')
  const lookup: Lookup = (writePath) => (/^\/api\/returns(\/|$)/.test(writePath) ? returnsWithout : realLookup(writePath))
  const failures = expectationFailures(lookup)
  assert.ok(failures.some((line) => line.startsWith('returns (/api/returns)') && line.includes('inventory:')), `the control saw: ${failures.join(' | ') || 'nothing'}`)
})

process.exit(failed > 0 ? 1 : 0)
