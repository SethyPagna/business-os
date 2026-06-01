import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  __resetApiWriteDedupeForTests,
  apiFetch,
  buildApiRequestDedupeKey,
  createApiVersionMismatchError,
  isTransientGatewayError,
  isCloudflareAccessRedirectResponse,
  isReachableServerResponseStatus,
  route,
  shouldCompareRuntimeVersions,
  isApiVersionMismatchError,
  isRequiredRuntimeApiPath,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'
import { appendActorQuery, getCurrentUserContext } from '../src/api/actorQuery.ts'
import { getImageDataUrl, openImageDialog } from '../src/api/browserDialogs.ts'
import { buildAttemptedReturnItems, buildAttemptedSettings } from '../src/api/conflicts.ts'
import {
  clearDriveSyncStatusCooldown,
  clearNotificationSummaryMissing,
  getDriveSyncStatusFallback,
  getNotificationSummaryFallback,
  markDriveSyncStatusCooldown,
  markNotificationSummaryMissing,
  readDriveSyncStatusCooldown,
  readNotificationSummaryMissingUntil,
} from '../src/api/cooldownFallbacks.ts'
import { withExpectedUpdatedAt, withSettingsExpectedUpdatedAt } from '../src/api/expectedUpdatedAt.ts'
import { apiFormPost, buildMultipartHeaders, withImportDeviceInfo } from '../src/api/importTransport.ts'
import { mirrorReadResult } from '../src/api/localMirrors.ts'
import { fetchJsonWithTimeout, getPortalBaseUrl } from '../src/api/portalHttp.ts'
import { appendQuery, buildQueryString, normalizePositiveUniqueIds } from '../src/api/query.ts'
import { buildQueryCacheStorageKey } from '../src/api/queryCache.ts'
import { createClientRequestId, ensureClientRequestId } from '../src/api/requestIds.ts'
import { dispatchSyncUpdates, emitSyncQueueChanged } from '../src/api/syncRuntime.ts'
import { PENDING_SYNC_PREVIEW_LIMIT, serializePendingSyncPreview } from '../src/api/syncPreview.ts'

type TestCallback = () => void | Promise<void>
type FetchCall = Parameters<typeof fetch>

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function createDeferredResponse(payload: unknown = { ok: true }): { promise: Promise<Response>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<Response>((done) => {
    resolve = () => done(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  })
  return { promise, resolve }
}

function resetApiState() {
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

await runTest('write dedupe key is stable for equivalent JSON bodies', () => {
  assert.equal(
    buildApiRequestDedupeKey('post', '/api/products', { b: 2, a: 1 }),
    buildApiRequestDedupeKey('POST', '/api/products', { a: 1, b: 2 }),
  )
  assert.equal(
    buildApiRequestDedupeKey('POST', '/api/products', { name: 'A', client_request_id: 'first' }),
    buildApiRequestDedupeKey('POST', '/api/products', { name: 'A', client_request_id: 'second' }),
  )
  assert.equal(buildApiRequestDedupeKey('GET', '/api/products', { a: 1 }), '')
})

await runTest('identical in-flight write requests reuse one network call', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const deferred = createDeferredResponse({ success: true, id: 7 })
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return deferred.promise
  }) as typeof fetch

  try {
    const first = apiFetch('POST', '/api/products', { name: 'Serum', qty: 1, client_request_id: 'first' }, 1000)
    const second = apiFetch('POST', '/api/products', { qty: 1, name: 'Serum', client_request_id: 'second' }, 1000)

    assert.equal(calls.length, 1)
    deferred.resolve()
    assert.deepEqual(await first, { success: true, id: 7 })
    assert.deepEqual(await second, { success: true, id: 7 })
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('write dedupe clears after settle and keeps different writes separate', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const payloads = [{ success: true, id: 1 }, { success: true, id: 2 }, { success: true, id: 3 }]
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    const payload = payloads.shift()
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch

  try {
    assert.deepEqual(await apiFetch('POST', '/api/products', { name: 'A' }, 1000), { success: true, id: 1 })
    assert.deepEqual(await apiFetch('POST', '/api/products', { name: 'A' }, 1000), { success: true, id: 2 })
    assert.deepEqual(await apiFetch('POST', '/api/products', { name: 'B' }, 1000), { success: true, id: 3 })
    assert.equal(calls.length, 3)
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('GET, HEAD, and OPTIONS requests never serialize a request body', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch

  try {
    await apiFetch('GET', '/api/system/integration-doctor', null, 1000)
    await apiFetch('HEAD', '/api/health', { unsafe: true }, 1000)
    await apiFetch('OPTIONS', '/api/products', { unsafe: true }, 1000)

    for (const [, init] of calls) {
      assert.ok(init)
      assert.ok(!Object.prototype.hasOwnProperty.call(init, 'body') || init.body === undefined)
    }
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('apiFetch uses HttpOnly cookie credentials and no JS-readable auth header', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch

  try {
    await apiFetch('POST', '/api/products', { name: 'Cookie Only' }, 1000)
    assert.equal(calls.length, 1)
    const [, init] = calls[0]
    assert.ok(init)
    assert.equal(init.credentials, 'include')
    assert.equal(Object.prototype.hasOwnProperty.call(init.headers, `x-auth-${'session'}`), false)
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('transient gateway statuses are classified for Cloudflare and proxy outages', () => {
  assert.equal(isTransientGatewayError(502), true)
  assert.equal(isTransientGatewayError(503), true)
  assert.equal(isTransientGatewayError(504), true)
  assert.equal(isTransientGatewayError(520), true)
  assert.equal(isTransientGatewayError(530), true)
  assert.equal(isTransientGatewayError(500), false)
  assert.equal(isTransientGatewayError(409), false)
})

await runTest('health connectivity check treats auth failures as reachable but gateway outages as offline', () => {
  assert.equal(isReachableServerResponseStatus(200), true)
  assert.equal(isReachableServerResponseStatus(401), true)
  assert.equal(isReachableServerResponseStatus(403), true)
  assert.equal(isReachableServerResponseStatus(500), true)
  assert.equal(isReachableServerResponseStatus(530), false)
  assert.equal(isReachableServerResponseStatus(0), false)
})

await runTest('api requests detect Cloudflare Access redirects without following them cross-origin', async () => {
  resetApiState()
  setSyncServerUrl('https://admin.example.test')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response('', {
      status: 302,
      headers: { Location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/admin.example.test?redirect_url=%2Fapi%2Fproducts' },
    }))
  }) as typeof fetch

  try {
    await assert.rejects(
      () => apiFetch('GET', '/api/products', undefined, 1000),
      (error: unknown) => (error as { code?: string })?.code === 'cloudflare_access_required',
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1]?.redirect, 'manual')
    assert.equal(calls[0][1]?.credentials, 'include')
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('Cloudflare Access redirect classifier handles opaque browser redirects', () => {
  assert.equal(isCloudflareAccessRedirectResponse({ type: 'opaqueredirect' }), true)
  assert.equal(isCloudflareAccessRedirectResponse(new Response('', { status: 200 })), false)
})

await runTest('read routes return fallback on transient gateway errors without sync:error', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const events: Event[] = []
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class TestCustomEvent extends Event {
      detail: unknown

      constructor(type: string, init: CustomEventInit = {}) {
        super(type)
        this.detail = init.detail
      }
    } as unknown as typeof CustomEvent
  }
  globalThis.window = {
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event) => events.push(event),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as Window & typeof globalThis
  globalThis.fetch = (() => Promise.resolve(new Response('Gateway unavailable', { status: 530 }))) as typeof fetch

  try {
    const result = await route(
      'transient:read',
      () => apiFetch('GET', '/api/transient-read', undefined, 1000),
      () => ({ items: ['cached'] }),
    )
    assert.deepEqual(result, { items: ['cached'] })
    assert.equal(events.some((event) => event.type === 'sync:error'), false)
    assert.equal(events.some((event) => event.type === 'sync:transient-outage'), true)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
    resetApiState()
  }
})

await runTest('integration doctor is a read-only route and does not pass a null GET body', () => {
  const source = fs.readFileSync(new URL('../src/api/systemRuntime.ts', import.meta.url), 'utf8')
  const block = source.match(/export function getIntegrationDoctor[\s\S]*?\n}/)?.[0] || ''
  assert.match(block, /apiFetch\('GET',\s*`\/api\/system\/integration-doctor\$\{suffix\}`,\s*undefined,/)
  assert.doesNotMatch(block, /apiFetch\('GET'[\s\S]*,\s*null\s*,/)
  assert.doesNotMatch(block, /\n\s*true,\s*\n\s*\)/)
})

await runTest('import job delete prefers canonical DELETE route with legacy fallback', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  assert.match(source, /deleteImportJob\s*=\s*\(id,[\s\S]*apiFetch\('DELETE',\s*`\/api\/import-jobs\/\$\{encodedId\}/)
  assert.match(source, /apiFetch\('POST',\s*`\/api\/import-jobs\/\$\{encodedId\}\/delete`/)
})

await runTest('read-only 530 pollers use fallback data and backoff hooks', () => {
  const methodsSource = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const trackerSource = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(methodsSource, /isTransientGatewayError\(error\?\.status\)/)
  assert.match(methodsSource, /lastImportJobsByQuery/)
  assert.match(methodsSource, /transient:\s*true/)
  assert.match(trackerSource, /pollBackoffMs/)
  assert.match(trackerSource, /nextImportTrackerBackoff/)
  assert.match(trackerSource, /IMPORT_TRACKER_LOAD_TIMEOUT_MS/)
  assert.match(trackerSource, /IMPORT_TRACKER_PREFLIGHT_TIMEOUT_MS/)
  assert.match(trackerSource, /withLoaderTimeout\(/)
  assert.match(trackerSource, /DISMISSABLE_STATUSES/)
  assert.match(trackerSource, /handleDismiss/)
  assert.match(appContextSource, /syncErrorLogAtRef/)
  assert.match(appContextSource, /console\.warn\('\[sync:transient\]'/)
  assert.match(appSource, /sync:transient-outage/)
  assert.match(appSource, /Server\/tunnel reconnecting/)
})

await runTest('app bootstrap converts invalid sessions into an explicit unauthorized result', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  assert.match(source, /if\s*\(isInvalidSessionError\(error\)\)/)
  assert.match(source, /unauthorized:\s*true/)
  assert.match(source, /authError:\s*error\?\.message \|\| 'Please sign in again to continue\.'/)
})

await runTest('paged audit and user-attributed activity APIs expose user filters', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const inventoryTransportSource = fs.readFileSync(new URL('../src/api/inventoryTransport.ts', import.meta.url), 'utf8')
  assert.match(source, /getAuditLogs\s*=\s*\(params\s*=\s*\{\}\)/)
  assert.match(source, /appendQuery\('\/api\/system\/audit-logs', q\)/)
  assert.match(source, /const auditRows = Array\.isArray\(result\) \? result : \(result\?\.items \|\| \[\]\)/)
  assert.match(source, /await mirrorTable\('audit_logs'\)\(auditRows\)\.catch\(\(\) => \{\}\)/)
  assert.match(source, /return result/)
  assert.doesNotMatch(source, /return mirrorTable\('audit_logs'\)\(rows\)/)
  assert.match(source, /getActionHistory\s*=\s*\([^)]*params\s*=\s*\{\}/)
  assert.match(source, /getInventoryMovements\s*=\s*\(params\s*=\s*\{\}/)
  assert.match(inventoryTransportSource, /export function getInventoryMovements\(\{[\s\S]*userId/)
  assert.match(source, /getSales\s*=\s*\(params\)/)
})

await runTest('client API query strings use one shared builder', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const querySource = fs.readFileSync(new URL('../src/api/query.ts', import.meta.url), 'utf8')
  const actionHistoryTransportSource = fs.readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
  assert.match(source, /import \{ appendQuery, buildQueryString, normalizePositiveUniqueIds \} from '\.\/query\.ts'/)
  assert.match(
    querySource,
    /export function buildQueryString\([\s\S]*for \(const key of Object\.keys\(params \|\| \{\}\)\)[\s\S]*appendQueryValue\(query, key, value, skipEmpty\)/,
  )
  assert.match(querySource, /export function appendQuery\(path: string, query: string\): string/)
  assert.equal(buildQueryString({ userId: 7, search: '', active: false }), 'userId=7&active=false')
  assert.equal(buildQueryString({ search: '' }, { skipEmpty: false }), 'search=')
  assert.equal(buildQueryString({ initial: ['A', 'B'], empty: '' }), 'initial=A&initial=B')
  assert.equal(appendQuery('/api/products', 'page=2'), '/api/products?page=2')
  assert.equal(appendQuery('/api/products', ''), '/api/products')
  assert.match(source, /const q = buildQueryString\(params\)/)
  assert.match(actionHistoryTransportSource, /const query = buildQueryString\(\{ scope, limit, \.\.\.\(params \|\| \{\}\) \}\)/)
  assert.match(source, /getSales\s*=\s*\(params\)[\s\S]*buildQueryString\(params, \{ skipEmpty: false \}\)/)
  assert.match(source, /getReturns\s*=\s*\(params\)[\s\S]*buildQueryString\(params, \{ skipEmpty: false \}\)/)
  assert.doesNotMatch(source, /new URLSearchParams\(Object\.entries/)
  assert.doesNotMatch(source, /\$\{q \? `\?\$\{q\}` : ''\}/)
  assert.doesNotMatch(source, /\$\{q \? '\?' \+ q : ''\}/)
})

await runTest('product id lookup normalizes ids without intermediate map/filter arrays', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const querySource = fs.readFileSync(new URL('../src/api/query.ts', import.meta.url), 'utf8')
  assert.match(
    querySource,
    /export function normalizePositiveUniqueIds\(ids: unknown\[\] = \[\], limit = 100\): number\[\][\s\S]*const seen = new Set<number>\(\)[\s\S]*for \(const value of ids \|\| \[\]\)[\s\S]*uniqueIds\.push\(id\)[\s\S]*if \(uniqueIds\.length >= limit\) break/,
  )
  assert.match(source, /const uniqueIds = normalizePositiveUniqueIds\(ids, 100\)/)
  assert.deepEqual(normalizePositiveUniqueIds([3, '3', '2', 0, -1, 'x', 4], 2), [3, 2])
  assert.doesNotMatch(source, /Array\.from\(new Set\(\(ids \|\| \[\]\)\.map/)
})

await runTest('idempotency request payload helpers preserve existing ids and cap user-provided ids', () => {
  const generated = createClientRequestId('sale')
  assert.match(generated, /^sale_/)
  assert.deepEqual(
    ensureClientRequestId({ client_request_id: ` ${'x'.repeat(125)} `, name: 'Serum' }, 'product'),
    { client_request_id: 'x'.repeat(120), name: 'Serum' },
  )
  const ensured = ensureClientRequestId({ name: 'Serum' }, 'product')
  assert.equal(ensured.name, 'Serum')
  assert.match(String(ensured.client_request_id), /^product_/)
})

await runTest('conflict preview helpers strip metadata and keep return item intent compact', () => {
  assert.deepEqual(
    buildAttemptedSettings({ storeName: 'Leang', updatedAt: 'server', expected_updated_at: 'old' }),
    { storeName: 'Leang' },
  )
  assert.deepEqual(
    buildAttemptedReturnItems([
      { product_name: 'Mask', quantity: 2 },
      { product_name: 'Serum', quantity: 0, return_to_stock: false },
    ]),
    [
      { product_name: 'Mask', quantity: 2, return_to_stock: true },
      { product_name: 'Serum', quantity: 0, return_to_stock: false },
    ],
  )
})

await runTest('pending sync preview serializes only the compact visible queue slice', () => {
  const items = Array.from({ length: PENDING_SYNC_PREVIEW_LIMIT + 2 }, (_, index) => ({
    _seq: index + 1,
    channel: 'sales:create',
    operation: '',
    entity_id: index + 10,
    status: index === 0 ? '' : 'failed',
    retry_count: String(index),
  }))
  const preview = serializePendingSyncPreview(items)
  assert.equal(preview.length, PENDING_SYNC_PREVIEW_LIMIT)
  assert.deepEqual(preview[0], {
    _seq: 1,
    channel: 'sales:create',
    operation: null,
    entity_table: null,
    entity_id: 10,
    entity_name: null,
    status: 'pending',
    created_at: null,
    updated_at: null,
    retry_count: 0,
    retry_at: null,
    error: null,
  })
  assert.equal(preview.at(-1)?._seq, PENDING_SYNC_PREVIEW_LIMIT)
})

await runTest('actor query helper appends current user context and extra parameters without empty values', () => {
  const originalWindow = globalThis.window
  const sessionValues = new Map<string, string>([
    ['businessos_user', JSON.stringify({ id: 42, name: ' Admin User ' })],
  ])
  const storage = {
    getItem: (key: string) => sessionValues.get(key) || null,
    setItem: (key: string, value: string) => sessionValues.set(key, value),
    removeItem: (key: string) => sessionValues.delete(key),
  }
  globalThis.window = {
    sessionStorage: storage,
    localStorage: storage,
  } as unknown as Window & typeof globalThis

  try {
    assert.deepEqual(getCurrentUserContext(), { userId: 42, userName: 'Admin User' })
    assert.equal(
      appendActorQuery('/api/users?limit=10', { page: 2, search: '', enabled: false }),
      '/api/users?limit=10&userId=42&userName=Admin+User&page=2&enabled=false',
    )
  } finally {
    globalThis.window = originalWindow
  }
})

await runTest('portal HTTP helper prefers browser origin and keeps fetch abort signals wired', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test/')
  assert.equal(getPortalBaseUrl(), 'https://sync.example.test')

  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.window = {
    location: { origin: 'https://browser.example.test/' },
  } as unknown as Window & typeof globalThis
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch

  try {
    assert.equal(getPortalBaseUrl(), 'https://browser.example.test')
    const response = await fetchJsonWithTimeout('https://browser.example.test/api/portal/config', {
      headers: { 'bypass-tunnel-reminder': 'true' },
    }, 500)
    assert.equal(response.ok, true)
    assert.equal(calls.length, 1)
    assert.ok(calls[0][1]?.signal instanceof AbortSignal)
  } finally {
    globalThis.window = originalWindow
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('import transport helper posts multipart forms through the live server path', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test/')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ data: { uploaded: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }) as typeof fetch

  try {
    const headers = buildMultipartHeaders()
    assert.equal(headers['bypass-tunnel-reminder'], 'true')
    assert.equal(typeof headers['x-client-time'], 'string')
    assert.equal(withImportDeviceInfo({ source: 'ui' }).source, 'ui')
    const form = new FormData()
    form.append('file', new Blob(['id\n1\n'], { type: 'text/csv' }), 'products.csv')
    assert.deepEqual(await apiFormPost('/api/import-jobs/7/csv', form, 'importJobs:csv'), { uploaded: 1 })
    assert.equal(calls.length, 1)
    assert.equal(String(calls[0][0]), 'https://sync.example.test/api/import-jobs/7/csv')
    assert.equal(calls[0][1]?.method, 'POST')
    assert.equal(calls[0][1]?.credentials, 'include')
    assert.equal((calls[0][1]?.headers as Record<string, string>)?.['bypass-tunnel-reminder'], 'true')
    assert.equal(calls[0][1]?.body, form)
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('cooldown fallback helpers keep typed notification and Drive fallbacks', () => {
  clearNotificationSummaryMissing()
  clearDriveSyncStatusCooldown()

  assert.deepEqual(getNotificationSummaryFallback({ unavailable: true }), {
    unreadCount: 0,
    sections: [],
    preferences: {},
    unavailable: true,
  })
  assert.deepEqual(getDriveSyncStatusFallback({ cooldownUntil: 123 }), {
    item: null,
    unavailable: true,
    cooldownUntil: 123,
  })

  const notificationUntil = markNotificationSummaryMissing(1_000)
  const driveUntil = markDriveSyncStatusCooldown(2_000)
  assert.ok(notificationUntil > 1_000)
  assert.ok(driveUntil > 2_000)
  assert.equal(readNotificationSummaryMissingUntil(), notificationUntil)
  assert.equal(readDriveSyncStatusCooldown(), driveUntil)

  clearNotificationSummaryMissing()
  clearDriveSyncStatusCooldown()
  assert.equal(readNotificationSummaryMissingUntil(), 0)
  assert.equal(readDriveSyncStatusCooldown(), 0)
})

await runTest('expected updated-at helpers preserve explicit and row timestamp metadata', async () => {
  assert.deepEqual(
    await withExpectedUpdatedAt('products', 1, { name: 'Serum', expected_updated_at: 'server-value' }),
    { name: 'Serum', expected_updated_at: 'server-value' },
  )
  assert.deepEqual(
    await withExpectedUpdatedAt('products', 1, { name: 'Serum', updated_at: 'row-value' }),
    { name: 'Serum', updated_at: 'row-value', expectedUpdatedAt: 'row-value' },
  )
  assert.deepEqual(
    await withSettingsExpectedUpdatedAt({ theme: 'dark', expectedUpdatedAt: 'existing' }),
    { theme: 'dark', expectedUpdatedAt: 'existing' },
  )
})

await runTest('local mirror helper returns server data while mirroring asynchronously', async () => {
  const result = { ok: true }
  let mirrored: unknown = null
  assert.equal(mirrorReadResult(async (value) => { mirrored = value }, result), result)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(mirrored, result)
})

await runTest('sync runtime helpers emit compact window events with timestamps', () => {
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const events: Event[] = []
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class TestCustomEvent extends Event {
      detail: unknown

      constructor(type: string, init: CustomEventInit = {}) {
        super(type)
        this.detail = init.detail
      }
    } as unknown as typeof CustomEvent
  }
  globalThis.window = {
    dispatchEvent: (event: Event) => events.push(event),
  } as unknown as Window & typeof globalThis

  try {
    dispatchSyncUpdates(['products', 'dashboard'], 'unit-test')
    emitSyncQueueChanged({ reason: 'unit-test-queue', queued: 1 })
    assert.equal(events.length, 3)
    assert.equal(events[0].type, 'sync:update')
    assert.equal((events[0] as CustomEvent).detail.channel, 'products')
    assert.equal((events[1] as CustomEvent).detail.channel, 'dashboard')
    assert.equal(events[2].type, 'sync:queue-changed')
    assert.equal((events[2] as CustomEvent).detail.queued, 1)
    assert.equal(typeof (events[2] as CustomEvent).detail.ts, 'number')
  } finally {
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }
})

await runTest('browser dialog image fallbacks stay null for browser-hosted media', async () => {
  assert.equal(await openImageDialog(), null)
  assert.equal(await getImageDataUrl('/uploads/product.jpg'), null)
})

await runTest('actor query and query cache cleanup avoid chained entry/filter allocations', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const actorQuerySource = fs.readFileSync(new URL('../src/api/actorQuery.ts', import.meta.url), 'utf8')
  const expectedUpdatedAtSource = fs.readFileSync(new URL('../src/api/expectedUpdatedAt.ts', import.meta.url), 'utf8')
  const localMirrorsSource = fs.readFileSync(new URL('../src/api/localMirrors.ts', import.meta.url), 'utf8')
  const portalHttpSource = fs.readFileSync(new URL('../src/api/portalHttp.ts', import.meta.url), 'utf8')
  const portalTransportSource = fs.readFileSync(new URL('../src/api/portalTransport.ts', import.meta.url), 'utf8')
  const lookupTransportSource = fs.readFileSync(new URL('../src/api/lookupTransport.ts', import.meta.url), 'utf8')
  const actionHistoryTransportSource = fs.readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
  const inventoryTransportSource = fs.readFileSync(new URL('../src/api/inventoryTransport.ts', import.meta.url), 'utf8')
  const rfidTransportSource = fs.readFileSync(new URL('../src/api/rfidTransport.ts', import.meta.url), 'utf8')
  const aiTransportSource = fs.readFileSync(new URL('../src/api/aiTransport.ts', import.meta.url), 'utf8')
  const authTransportSource = fs.readFileSync(new URL('../src/api/authTransport.ts', import.meta.url), 'utf8')
  const browserDialogsSource = fs.readFileSync(new URL('../src/api/browserDialogs.ts', import.meta.url), 'utf8')
  const importTransportSource = fs.readFileSync(new URL('../src/api/importTransport.ts', import.meta.url), 'utf8')
  const queryCacheSource = fs.readFileSync(new URL('../src/api/queryCache.ts', import.meta.url), 'utf8')
  const syncRuntimeSource = fs.readFileSync(new URL('../src/api/syncRuntime.ts', import.meta.url), 'utf8')
  const systemJobsSource = fs.readFileSync(new URL('../src/api/systemJobs.ts', import.meta.url), 'utf8')
  const systemRuntimeSource = fs.readFileSync(new URL('../src/api/systemRuntime.ts', import.meta.url), 'utf8')
  const driveSyncSource = fs.readFileSync(new URL('../src/api/driveSync.ts', import.meta.url), 'utf8')
  const notificationSummarySource = fs.readFileSync(new URL('../src/api/notificationSummary.ts', import.meta.url), 'utf8')
  assert.equal(buildQueryCacheStorageKey(' products:search:x '), 'read_cache:products:search:x')
  assert.match(source, /import \{ appendActorQuery, getCurrentUserContext \} from '\.\/actorQuery\.ts'/)
  assert.match(source, /from '\.\/lookupTransport\.ts'/)
  assert.match(source, /from '\.\/aiTransport\.ts'/)
  assert.match(source, /from '\.\/actionHistoryTransport\.ts'/)
  assert.match(source, /from '\.\/inventoryTransport\.ts'/)
  assert.match(source, /from '\.\/rfidTransport\.ts'/)
  assert.match(source, /from '\.\/portalTransport\.ts'/)
  assert.match(source, /from '\.\/authTransport\.ts'/)
  assert.match(source, /import \{ apiFormPost, buildMultipartHeaders, withImportDeviceInfo \} from '\.\/importTransport\.ts'/)
  assert.match(source, /from '\.\/queryCache\.ts'/)
  assert.match(source, /import \{ withExpectedUpdatedAt, withSettingsExpectedUpdatedAt \} from '\.\/expectedUpdatedAt\.ts'/)
  assert.match(source, /import \{ mirrorTable, purgeSensitiveLiveServerMirrors, routeMirrored \} from '\.\/localMirrors\.ts'/)
  assert.match(source, /from '\.\/syncRuntime\.ts'/)
  assert.match(source, /from '\.\/systemJobs\.ts'/)
  assert.match(source, /from '\.\/systemRuntime\.ts'/)
  assert.match(source, /from '\.\/driveSync\.ts'/)
  assert.match(source, /from '\.\/notificationSummary\.ts'/)
  assert.match(source, /export \{ getImageDataUrl, openCSVDialog, openImageDialog \} from '\.\/browserDialogs\.ts'/)
  assert.match(expectedUpdatedAtSource, /export async function withExpectedUpdatedAt\([\s\S]*body\.expectedUpdatedAt = body\.updated_at[\s\S]*table\?\.get\?\.\(id\)/)
  assert.match(localMirrorsSource, /export function mirrorReadResult[\s\S]*return result/)
  assert.match(localMirrorsSource, /export function mirrorTable[\s\S]*for \(const row of Array\.isArray\(rows\) \? rows : \[\]\)[\s\S]*replaceTableContents/)
  assert.match(lookupTransportSource, /export function getCategories/)
  assert.match(lookupTransportSource, /routeMirrored\(/)
  assert.match(lookupTransportSource, /withExpectedUpdatedAt\(config\.kind, id, payload\)/)
  assert.match(lookupTransportSource, /config\.kind === 'units' \? 'PATCH' : 'PUT'/)
  assert.doesNotMatch(lookupTransportSource, /refreshAppData/)
  assert.match(
    actorQuerySource,
    /export function appendActorQuery\(path: string, extra: ActorQueryParams = \{\}\): string[\s\S]*for \(const key of Object\.keys\(extra \|\| \{\}\)\)[\s\S]*const queryString = query\.toString\(\)[\s\S]*return `\$\{path\}\$\{path\.includes\('\?'\) \? '&' : '\?'\}\$\{queryString\}`/,
  )
  assert.match(portalHttpSource, /export async function fetchJsonWithTimeout\([\s\S]*const controller = new AbortController\(\)[\s\S]*signal: controller\.signal/)
  assert.match(portalTransportSource, /export async function searchPortalCatalogProducts/)
  assert.match(portalTransportSource, /getApiVersionMismatchCooldown\(path\)/)
  assert.match(portalTransportSource, /markApiVersionMismatch\(path, res\.status\)/)
  assert.match(portalTransportSource, /export function getPortalSubmissionsForReview/)
  assert.match(actionHistoryTransportSource, /export function getActionHistory/)
  assert.match(actionHistoryTransportSource, /appendQuery\('\/api\/action-history', query\)/)
  assert.match(actionHistoryTransportSource, /export function undoActionHistory/)
  assert.match(inventoryTransportSource, /export function searchInventoryProducts/)
  assert.match(inventoryTransportSource, /readCachedQueryResult\(cacheKey\)/)
  assert.match(inventoryTransportSource, /export function saveInventoryReasons/)
  assert.match(rfidTransportSource, /export function getRfidStatus/)
  assert.match(rfidTransportSource, /encodeURIComponent\(String\(id\)\)/)
  assert.match(rfidTransportSource, /export function applyRfidSession/)
  assert.match(aiTransportSource, /export function getAiProviders/)
  assert.match(aiTransportSource, /appendActorQuery\('\/api\/ai\/providers'\)/)
  assert.match(aiTransportSource, /export function getAiResponses/)
  assert.match(authTransportSource, /export function login/)
  assert.match(authTransportSource, /getClientDeviceInfo\(\)/)
  assert.match(authTransportSource, /export function otpSetup/)
  assert.match(authTransportSource, /export function otpStatus/)
  assert.match(authTransportSource, /export function startGoogleOauth/)
  assert.match(authTransportSource, /export function searchOrganizations/)
  assert.match(importTransportSource, /export async function apiFormPost\([\s\S]*requireLiveServerWrite\(channel,[\s\S]*credentials: 'include'[\s\S]*body: form/)
  assert.match(
    queryCacheSource,
    /export async function clearCachedQueryResults\(prefixes: string\[\] = \[\]\): Promise<void>[\s\S]*const keys: string\[\] = \[\][\s\S]*for \(const value of Array\.isArray\(prefixes\) \? prefixes : \[\]\)[\s\S]*const matchingKeys: string\[\] = \[\][\s\S]*for \(const row of rows\)[\s\S]*for \(const prefix of keys\)/,
  )
  assert.doesNotMatch(source, /Object\.entries\(extra \|\| \{\}\)\.forEach/)
  assert.doesNotMatch(source, /apiFetch\('POST', '\/api\/auth\/login'/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/categories'/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/units'/)
  assert.doesNotMatch(source, /apiFetch\('POST', '\/api\/auth\/otp\/setup'/)
  assert.doesNotMatch(source, /apiFetch\('GET', appendActorQuery\('\/api\/ai\/providers'\)/)
  assert.doesNotMatch(source, /apiFetch\('POST', '\/api\/ai\/providers'/)
  assert.doesNotMatch(source, /fetchJsonWithTimeout\(`\$\{base\}\/api\/portal\/catalog\/products`/)
  assert.doesNotMatch(source, /getApiVersionMismatchCooldown\('\/api\/portal\/catalog\/products\/search'\)/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/portal\/submissions\/review'/)
  assert.doesNotMatch(source, /apiFetch\('GET', appendQuery\('\/api\/action-history', query\)/)
  assert.doesNotMatch(source, /apiFetch\('POST', `\/api\/action-history\/\$\{id\}\/undo`/)
  assert.doesNotMatch(source, /apiFetch\('POST', '\/api\/inventory\/adjust'/)
  assert.doesNotMatch(source, /apiFetch\('GET', appendQuery\('\/api\/inventory\/products\/search'/)
  assert.doesNotMatch(source, /apiFetch\('GET', appendQuery\('\/api\/inventory\/rfid\/status'/)
  assert.doesNotMatch(source, /apiFetch\('POST', '\/api\/inventory\/rfid\/tags'/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/organizations\/bootstrap'/)
  assert.doesNotMatch(source, /\.map\(\(row\) => String\(row\?\.key \|\| ''\)\)\s*\.filter/)
  assert.doesNotMatch(source, /const QUERY_CACHE_PREFIX/)
  assert.doesNotMatch(source, /LIVE_SERVER_SENSITIVE_MIRROR_TABLES/)
  assert.doesNotMatch(source, /function registerOutboxBackgroundSync/)
  assert.doesNotMatch(source, /function hasStoredUserSession/)
  assert.doesNotMatch(source, /document\.createElement\('input'\)/)
  assert.doesNotMatch(source, /decodeTextBuffer/)
  assert.doesNotMatch(source, /function wait\(ms\)/)
  assert.doesNotMatch(source, /const startedAt = Date\.now\(\)/)
  assert.doesNotMatch(source, /driveSyncStatusRequestPromise/)
  assert.doesNotMatch(source, /markDriveSyncStatusCooldown/)
  assert.doesNotMatch(source, /clearDriveSyncStatusCooldown/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/system\/config'/)
  assert.doesNotMatch(source, /apiFetch\('GET', '\/api\/system\/debug\/log'/)
  assert.doesNotMatch(source, /notificationSummaryRequestPromise/)
  assert.doesNotMatch(source, /markNotificationSummaryMissing/)
  assert.doesNotMatch(source, /clearNotificationSummaryMissing/)
  assert.match(syncRuntimeSource, /export function registerOutboxBackgroundSync/)
  assert.match(syncRuntimeSource, /export function dispatchSyncUpdates/)
  assert.match(syncRuntimeSource, /export function emitSyncQueueChanged/)
  assert.match(browserDialogsSource, /export function openCSVDialog/)
  assert.match(browserDialogsSource, /decodeTextBuffer\(await file\.arrayBuffer\(\)\)/)
  assert.match(systemJobsSource, /export async function pollSystemJob/)
  assert.match(systemJobsSource, /await wait\(pollMs\)/)
  assert.match(systemJobsSource, /export async function queueBackupFolderExport/)
  assert.match(systemRuntimeSource, /export function getSystemConfig/)
  assert.match(systemRuntimeSource, /export function getSystemDebugLog/)
  assert.match(systemRuntimeSource, /export function getIntegrationDoctor/)
  assert.match(systemRuntimeSource, /export async function resetData/)
  assert.match(systemRuntimeSource, /export async function testSyncServer/)
  assert.match(systemRuntimeSource, /export function browseDir/)
  assert.doesNotMatch(systemRuntimeSource, /resetClientRuntimeState/)
  assert.doesNotMatch(systemRuntimeSource, /function invalidateClientRuntimeState/)
  assert.match(driveSyncSource, /let driveSyncStatusRequestPromise/)
  assert.match(driveSyncSource, /markDriveSyncStatusCooldown/)
  assert.match(driveSyncSource, /export function queueGoogleDriveSyncNow/)
  assert.match(notificationSummarySource, /let notificationSummaryRequestPromise/)
  assert.match(notificationSummarySource, /markNotificationSummaryMissing/)
  assert.match(notificationSummarySource, /export async function getNotificationSummary/)
})

await runTest('empty local mirrors are not treated as usable server read fallback data', () => {
  const source = fs.readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
  assert.match(source, /if\s*\(\s*Array\.isArray\(value\)\s*\)\s*return\s+value\.length\s*>\s*0/)
})

await runTest('required paged search APIs are classified as runtime contract routes', () => {
  assert.equal(isRequiredRuntimeApiPath('/api/products/search?page=1&pageSize=20'), true)
  assert.equal(isRequiredRuntimeApiPath('/api/products/filters'), true)
  assert.equal(isRequiredRuntimeApiPath('/api/inventory/products/search?page=1'), true)
  assert.equal(isRequiredRuntimeApiPath('/api/portal/catalog/products/search?page=1'), true)
  assert.equal(isRequiredRuntimeApiPath('/api/products'), false)
})

await runTest('api version mismatch errors are explicit and detectable', () => {
  const error = createApiVersionMismatchError('/api/products/search?page=1', 404)
  assert.equal(error.code, 'api_version_mismatch')
  assert.equal(error.reason, 'missing_required_api')
  assert.equal(error.status, 404)
  assert.equal(isApiVersionMismatchError(error), true)
})

await runTest('runtime version guard compares served frontend metadata, not backend source revision', () => {
  const frontend = { revision: 'browser-rev', hash: 'browser-hash' }
  assert.equal(shouldCompareRuntimeVersions({
    revision: 'backend-newer-rev',
    frontend: { revision: 'browser-rev', hash: 'browser-hash' },
  }, frontend), false)
  assert.equal(shouldCompareRuntimeVersions({
    revision: 'backend-newer-rev',
    frontend: { revision: 'server-frontend-rev', hash: 'server-frontend-hash' },
  }, frontend), true)
  assert.equal(shouldCompareRuntimeVersions({
    revision: 'backend-newer-rev',
  }, frontend), false)
})

await runTest('runtime version guard still compares hashes when packaged runtimes report dev revisions', () => {
  const frontend = { revision: 'dev', hash: 'browser-hash' }
  assert.equal(shouldCompareRuntimeVersions({
    revision: 'backend-rev',
    frontend: { revision: 'dev', hash: 'browser-hash' },
  }, frontend), false)
  assert.equal(shouldCompareRuntimeVersions({
    revision: 'backend-rev',
    frontend: { revision: 'dev', hash: 'server-old-hash' },
  }, frontend), true)
})

await runTest('health payload exposes data, storage, queue, cache, and analytics drivers', () => {
  const payload = {
    status: 'ok',
    drivers: {
      database: 'postgres',
      objectStorage: 'minio',
      queue: 'bullmq',
      cache: 'redis',
      analytics: 'duckdb',
      parquetStore: 'minio',
    },
    analytics: {
      engine: 'duckdb',
      parquetStore: 'minio',
      roles: ['import_staging', 'analytics_snapshots'],
    },
  }
  assert.equal(payload.drivers.analytics, 'duckdb')
  assert.equal(payload.drivers.parquetStore, 'minio')
  assert.equal(payload.analytics.roles.includes('import_staging'), true)
})

await runTest('large search methods do not use empty local fallbacks for required APIs', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const inventoryTransportSource = fs.readFileSync(new URL('../src/api/inventoryTransport.ts', import.meta.url), 'utf8')
  assert.match(source, /return routeMirrored\(\s*cacheKey,\s*\(\) => apiFetch\('GET', appendQuery\('\/api\/products\/search', q\)/)
  assert.match(inventoryTransportSource, /return routeMirrored\(\s*cacheKey,\s*\(\) => apiFetch\('GET', appendQuery\('\/api\/inventory\/products\/search', query\)/)
  assert.doesNotMatch(source, /products:search:\$\{q\}`,[\s\S]{0,240}\(\)\s*=>\s*\(\{\s*items:\s*\[\]/)
  assert.doesNotMatch(source, /inventory:products:search:\$\{q\}`,[\s\S]{0,260}\(\)\s*=>\s*\(\{\s*items:\s*\[\]/)
})

if (failed > 0) {
  process.exitCode = 1
}
