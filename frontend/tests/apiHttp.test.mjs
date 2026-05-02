import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  __resetApiWriteDedupeForTests,
  apiFetch,
  buildApiRequestDedupeKey,
  setAuthSessionToken,
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
  setAuthSessionToken('')
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

await runTest('import job delete prefers canonical DELETE route with legacy fallback', () => {
  const source = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
  assert.match(source, /deleteImportJob\s*=\s*\(id,[\s\S]*apiFetch\('DELETE',\s*`\/api\/import-jobs\/\$\{encodedId\}/)
  assert.match(source, /apiFetch\('POST',\s*`\/api\/import-jobs\/\$\{encodedId\}\/delete`/)
})

await runTest('empty local mirrors are not treated as usable server read fallback data', () => {
  const source = fs.readFileSync(new URL('../src/api/http.js', import.meta.url), 'utf8')
  assert.match(source, /if\s*\(\s*Array\.isArray\(value\)\s*\)\s*return\s+value\.length\s*>\s*0/)
})

if (failed > 0) {
  process.exitCode = 1
}
