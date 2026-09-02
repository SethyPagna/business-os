// Regression lock for the Part-77 "read-cache keys missing their id parameter"
// finding. route()'s channel string is BOTH the 20s read-cache key and the
// in-flight dedupe key. Three get-one reads used a CONSTANT channel regardless
// of which record was requested:
//   getFee            -> 'fees:get-one'
//   getReturn         -> 'returns:getOne'
//   getCustomTableData-> 'customTables:data'
// so opening record/table B within the 20s window rendered record/table A's
// data (the same class as the earlier lots-per-channel bug). Each channel now
// embeds the id/tableName. These tests fail on the pre-fix source: the second
// call returns the first record and no second network request is made.
//
// Write-invalidation is unaffected: it clears by entity prefix
// (getChannelRefreshKey splits the channel on ':'), which still covers every
// per-id entry -- asserted below.

import assert from 'node:assert/strict'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  cacheGet,
  cacheClearAll,
  cacheInvalidateWithDerived,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'
import { getFee, getFees } from '../src/api/feesTransport.ts'
import { getReturn } from '../src/api/returnsReadTransport.ts'
import { getCustomTableData } from '../src/api/customTablesTransport.ts'
import { getPendingActions } from '../src/api/reviewQueueTransport.ts'
import { getSalesExport } from '../src/api/salesTransport.ts'

type FetchCall = Parameters<typeof fetch>

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function resetApiState() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  cacheClearAll()
  setSyncServerUrl('')
  setSyncToken('')
}

// Minimal window shim: the getReturn / getCustomTableData reads take route()'s
// local-fallback race path, which calls window.setTimeout/clearTimeout. The
// server stub resolves synchronously, so the server always wins the race well
// before the fallback timer -- but the timer must exist to be scheduled.
function installWindow(): () => void {
  const originalWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = {
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return () => { (globalThis as { window?: unknown }).window = originalWindow }
}

// Stub fetch so each request URL yields a distinct payload; record every URL.
function stubFetchByUrl(payloadFor: (url: string) => unknown): { urls: string[]; restore: () => void } {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    const url = String(args[0])
    urls.push(url)
    return Promise.resolve(new Response(JSON.stringify(payloadFor(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch
  return { urls, restore: () => { globalThis.fetch = originalFetch } }
}

await runTest('getFee keys the read cache per id -- opening fee B never renders fee A', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const { urls, restore } = stubFetchByUrl((url) =>
    ({ fee: { id: url.includes('/api/fees/2') ? 2 : 1 } }))
  try {
    const first = (await getFee(1)) as { fee: { id: number } }
    const second = (await getFee(2)) as { fee: { id: number } }

    assert.equal(first.fee.id, 1)
    assert.equal(second.fee.id, 2, 'fee 2 must NOT come back as the cached fee 1')
    assert.equal(urls.length, 2, 'each distinct fee id must issue its own request')

    assert.ok(cacheGet('fees:get-one:1'), 'per-id cache key for fee 1 must be populated')
    assert.ok(cacheGet('fees:get-one:2'), 'per-id cache key for fee 2 must be populated')
    assert.equal(cacheGet('fees:get-one'), null, 'the old shared constant key must never be used')
  } finally {
    restore()
    resetApiState()
  }
})

await runTest('getFees keys list reads by paging and filter query', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const { urls, restore } = stubFetchByUrl((url) => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0)
    return { fees: [{ id: offset + 1 }], total: 40, limit: 20, offset, summary: [] }
  })
  try {
    const first = await getFees({ search: 'delivery', limit: 20, offset: 0 })
    const second = await getFees({ search: 'delivery', limit: 20, offset: 20 })

    assert.equal(first.fees[0].id, 1)
    assert.equal(second.fees[0].id, 21, 'page 2 must not reuse page 1 from the route cache')
    assert.equal(urls.length, 2, 'each distinct list query must issue its own request')
    assert.equal(cacheGet('fees:get'), null, 'the old shared constant list key must never be used')
  } finally {
    restore()
    resetApiState()
  }
})

await runTest('review queue list cache is isolated by status and section filters', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const { urls, restore } = stubFetchByUrl((url) => {
    const status = new URL(url).searchParams.get('status') || 'all'
    return { data: [{ id: status === 'open' ? 1 : 2, status }] }
  })
  try {
    const open = await getPendingActions({ status: 'open', section: 'sales' })
    const approved = await getPendingActions({ status: 'approved', section: 'sales' })
    assert.equal(open.data[0].id, 1)
    assert.equal(approved.data[0].id, 2, 'approved review results must not reuse the open queue cache')
    assert.equal(urls.length, 2)
    assert.equal(cacheGet('review:list'), null, 'the old constant review-list key must never be used')
  } finally {
    restore()
    resetApiState()
  }
})

await runTest('sales export cache is isolated by its date and branch query', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const { urls, restore } = stubFetchByUrl((url) => {
    const branchId = new URL(url).searchParams.get('branchId') || 'all'
    return { branchId }
  })
  try {
    const branchOne = await getSalesExport({ startDate: '2026-09-01', branchId: 1 }) as { branchId: string }
    const branchTwo = await getSalesExport({ startDate: '2026-09-01', branchId: 2 }) as { branchId: string }
    assert.equal(branchOne.branchId, '1')
    assert.equal(branchTwo.branchId, '2', 'branch 2 export must not reuse branch 1 export data')
    assert.equal(urls.length, 2)
    assert.equal(cacheGet('sales:export'), null, 'the old constant sales-export key must never be used')
  } finally {
    restore()
    resetApiState()
  }
})

await runTest('getReturn keys the read cache per id -- opening return B never renders return A', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const restoreWindow = installWindow()
  const { urls, restore } = stubFetchByUrl((url) =>
    ({ return: { id: url.includes('/api/returns/202') ? 202 : 101 } }))
  try {
    const first = (await getReturn(101)) as { return: { id: number } }
    const second = (await getReturn(202)) as { return: { id: number } }

    assert.equal(first.return.id, 101)
    assert.equal(second.return.id, 202, 'return 202 must NOT come back as the cached return 101')
    assert.equal(urls.length, 2, 'each distinct return id must issue its own request')

    assert.ok(cacheGet('returns:getOne:101'), 'per-id cache key for return 101 must be populated')
    assert.ok(cacheGet('returns:getOne:202'), 'per-id cache key for return 202 must be populated')
    assert.equal(cacheGet('returns:getOne'), null, 'the old shared constant key must never be used')
  } finally {
    restore()
    restoreWindow()
    resetApiState()
  }
})

await runTest('getCustomTableData keys the read cache per table -- opening table B never renders table A', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const restoreWindow = installWindow()
  const { urls, restore } = stubFetchByUrl((url) =>
    (url.includes('beta') ? [{ id: 2 }] : [{ id: 1 }]))
  try {
    const first = (await getCustomTableData({ tableName: 'alpha' })) as Array<{ id: number }>
    const second = (await getCustomTableData({ tableName: 'beta' })) as Array<{ id: number }>

    assert.equal(first[0].id, 1)
    assert.equal(second[0].id, 2, "table 'beta' must NOT come back as cached table 'alpha'")
    assert.equal(urls.length, 2, 'each distinct table must issue its own request')

    assert.ok(cacheGet('customTables:data:alpha'), "per-table cache key for 'alpha' must be populated")
    assert.ok(cacheGet('customTables:data:beta'), "per-table cache key for 'beta' must be populated")
    assert.equal(cacheGet('customTables:data'), null, 'the old shared constant key must never be used')
  } finally {
    restore()
    restoreWindow()
    resetApiState()
  }
})

await runTest('an entity write still invalidates every per-id read cache entry', async () => {
  resetApiState()
  // Two fees cached under distinct per-id keys...
  const { restore } = stubFetchByUrl((url) => ({ fee: { id: url.includes('/api/fees/2') ? 2 : 1 } }))
  setSyncServerUrl('https://sync.example.test')
  try {
    await getFee(1)
    await getFee(2)
    assert.ok(cacheGet('fees:get-one:1'))
    assert.ok(cacheGet('fees:get-one:2'))

    // ...a fees write invalidates by entity prefix ('fees'), which must clear
    // both per-id entries, not just a single constant slot.
    cacheInvalidateWithDerived('fees')
    assert.equal(cacheGet('fees:get-one:1'), null, 'fee 1 read cache must clear on a fees write')
    assert.equal(cacheGet('fees:get-one:2'), null, 'fee 2 read cache must clear on a fees write')
  } finally {
    restore()
    resetApiState()
  }
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll read-cache key isolation tests passed')
