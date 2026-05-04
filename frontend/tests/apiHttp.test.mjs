import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  __resetApiWriteDedupeForTests,
  apiFetch,
  buildApiRequestDedupeKey,
  createApiVersionMismatchError,
  isTransientGatewayError,
  route,
  shouldCompareRuntimeVersions,
  isApiVersionMismatchError,
  isRequiredRuntimeApiPath,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function createDeferredResponse(payload = { ok: true }) {
  let resolve
  const promise = new Promise((done) => {
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
  const calls = []
  globalThis.fetch = (...args) => {
    calls.push(args)
    return deferred.promise
  }

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
  const calls = []
  globalThis.fetch = (...args) => {
    calls.push(args)
    const payload = payloads.shift()
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }

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
  const calls = []
  globalThis.fetch = (...args) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }

  try {
    await apiFetch('GET', '/api/system/integration-doctor', null, 1000)
    await apiFetch('HEAD', '/api/health', { unsafe: true }, 1000)
    await apiFetch('OPTIONS', '/api/products', { unsafe: true }, 1000)

    for (const [, init] of calls) {
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
  const calls = []
  globalThis.fetch = (...args) => {
    calls.push(args)
    return Promise.resolve(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  }

  try {
    await apiFetch('POST', '/api/products', { name: 'Cookie Only' }, 1000)
    assert.equal(calls.length, 1)
    const [, init] = calls[0]
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

await runTest('read routes return fallback on transient gateway errors without sync:error', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent
  const events = []
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type
        this.detail = init.detail
      }
    }
  }
  globalThis.window = {
    setTimeout,
    clearTimeout,
    dispatchEvent: (event) => events.push(event),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.fetch = () => Promise.resolve(new Response('Gateway unavailable', { status: 530 }))

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
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  const block = source.match(/export async function getIntegrationDoctor[\s\S]*?\n}/)?.[0] || ''
  assert.match(block, /apiFetch\('GET',\s*`\/api\/system\/integration-doctor\$\{suffix\}`,\s*undefined,/)
  assert.doesNotMatch(block, /apiFetch\('GET'[\s\S]*,\s*null\s*,/)
  assert.doesNotMatch(block, /\n\s*true,\s*\n\s*\)/)
})

await runTest('import job delete prefers canonical DELETE route with legacy fallback', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  assert.match(source, /deleteImportJob\s*=\s*\(id,[\s\S]*apiFetch\('DELETE',\s*`\/api\/import-jobs\/\$\{encodedId\}/)
  assert.match(source, /apiFetch\('POST',\s*`\/api\/import-jobs\/\$\{encodedId\}\/delete`/)
})

await runTest('read-only 530 pollers use fallback data and backoff hooks', () => {
  const methodsSource = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  const trackerSource = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.jsx', import.meta.url), 'utf8')
  const appContextSource = fs.readFileSync(new URL('../src/AppContext.jsx', import.meta.url), 'utf8')
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

  assert.match(methodsSource, /isTransientGatewayError\(error\?\.status\)/)
  assert.match(methodsSource, /lastImportJobsByQuery/)
  assert.match(methodsSource, /transient:\s*true/)
  assert.match(trackerSource, /pollBackoffMs/)
  assert.match(trackerSource, /nextImportTrackerBackoff/)
  assert.match(appContextSource, /syncErrorLogAtRef/)
  assert.match(appContextSource, /console\.warn\('\[sync:transient\]'/)
  assert.match(appSource, /sync:transient-outage/)
  assert.match(appSource, /Server\/tunnel reconnecting/)
})

await runTest('paged audit and user-attributed activity APIs expose user filters', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  assert.match(source, /getAuditLogs\s*=\s*\(params\s*=\s*\{\}\)/)
  assert.match(source, /\/api\/system\/audit-logs\$\{q \? `\?\$\{q\}` : ''\}/)
  assert.match(source, /const auditRows = Array\.isArray\(result\) \? result : \(result\?\.items \|\| \[\]\)/)
  assert.match(source, /await mirrorTable\('audit_logs'\)\(auditRows\)\.catch\(\(\) => \{\}\)/)
  assert.match(source, /return result/)
  assert.doesNotMatch(source, /return mirrorTable\('audit_logs'\)\(rows\)/)
  assert.match(source, /getActionHistory\s*=\s*\([^)]*params\s*=\s*\{\}/)
  assert.match(source, /getInventoryMovements\s*=\s*\([^)]*userId/)
  assert.match(source, /getSales\s*=\s*\(params\)/)
})

await runTest('empty local mirrors are not treated as usable server read fallback data', () => {
  const source = fs.readFileSync(new URL('../src/api/http.js', import.meta.url), 'utf8')
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
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  assert.match(source, /return route\(`products:search:\$\{q\}`,\s*\(\) => apiFetch\('GET', `\/api\/products\/search/)
  assert.match(source, /return route\(`inventory:products:search:\$\{q\}`,\s*\(\) => apiFetch\('GET', `\/api\/inventory\/products\/search/)
  assert.doesNotMatch(source, /products:search:\$\{q\}`,[\s\S]{0,240}\(\)\s*=>\s*\(\{\s*items:\s*\[\]/)
  assert.doesNotMatch(source, /inventory:products:search:\$\{q\}`,[\s\S]{0,260}\(\)\s*=>\s*\(\{\s*items:\s*\[\]/)
})

if (failed > 0) {
  process.exitCode = 1
}
