import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const BASE = '1cb7b746e4c65a8ff5df2735f7bd3fb66dc7a43b'
const oldWorker = execFileSync('git', ['show', `${BASE}:frontend/public/sw.js`], { encoding: 'utf8' })
const source = ts.transpileModule(fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const workers = process.env.SW_STORAGE_BASELINE === '1'
  ? [['original baseline', oldWorker]]
  : [['source', source], ['generated', fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')]]
const origin = 'https://admin.example.com'
const shell = '<!doctype html><html><body><div id="root"></div></body></html>'
const current = 'business-os-app-shell-__BUSINESS_OS_BUILD_HASH__'
const staticCurrent = current.replace('app-shell', 'static')
const failure = () => new DOMException('Storage unavailable', 'SecurityError')
const response = (body = 'export const healthy = true', mime = 'text/javascript', status = 200) => {
  const value = new Response(body, { status, headers: { 'content-type': mime } })
  Object.defineProperty(value, 'type', { value: 'basic' })
  return value
}
type Options = {
  open?: (name: string) => boolean
  match?: (name: string, key: string) => boolean
  putFails?: boolean
  deleteFails?: boolean
  offline?: boolean
  entries?: Record<string, Record<string, Response>>
  network?: (input: unknown) => Response
}
function fixture(worker: string, options: Options = {}) {
  const listeners: Record<string, (event: any) => void> = {}
  const fetches: { input: unknown, init: unknown }[] = []
  const writes: { name: string, key: string }[] = []
  const broadcasts: any[] = []
  let updates = 0
  const keyOf = (input: any) => typeof input === 'string' ? input : input.url
  const self = {
    location: { origin, hostname: 'admin.example.com' },
    addEventListener: (name: string, callback: (event: any) => void) => { listeners[name] = callback },
    registration: { update: async () => { updates++ }, waiting: null, installing: null },
    clients: { matchAll: async () => [{ postMessage: (message: any) => broadcasts.push(message) }] },
  }
  const caches = {
    keys: async () => { throw failure() },
    match: async () => { throw failure() },
    open: async (name: string) => {
      if (options.open?.(name)) throw failure()
      return {
        match: async (input: unknown) => {
          const key = keyOf(input)
          if (options.match?.(name, key)) throw failure()
          return options.entries?.[name]?.[key]
        },
        put: async (input: unknown) => {
          if (options.putFails) throw new DOMException('Quota full', 'QuotaExceededError')
          writes.push({ name, key: keyOf(input) })
        },
        delete: async () => { if (options.deleteFails) throw failure(); return true },
      }
    },
  }
  vm.runInNewContext(worker, { self, caches, URL, Response, Request, Headers, MessageChannel, setTimeout, clearTimeout,
    fetch: async (input: unknown, init: unknown) => {
      fetches.push({ input, init })
      if (options.offline) throw new TypeError('Network unavailable')
      return options.network?.(input) ?? (typeof input === 'string' ? response(shell, 'text/html') : response())
    },
  })
  function dispatch(path: string, mode = 'cors', method = 'GET') {
    const request = new Request(origin + path, { method, credentials: 'include', headers: { 'x-fixture': 'preserved' }, redirect: 'manual' })
    Object.defineProperty(request, 'mode', { value: mode })
    const pending: Promise<unknown>[] = []
    let answer: Promise<Response> | undefined
    listeners.fetch({ request, respondWith: (value: Promise<Response>) => { answer = value }, waitUntil: (value: Promise<unknown>) => pending.push(value) })
    return { request, answer, finish: () => Promise.all(pending) }
  }
  return { dispatch, fetches, writes, broadcasts, updates: () => updates }
}
const proof = () => response(JSON.stringify({ schema: 1, current, previous: 'business-os-app-shell-old', migrationStaticCaches: ['business-os-static-other'] }), 'application/json')
const asset = '/assets/app-AbCd1234.js'

for (const [label, worker] of workers) {
  for (const fault of ['open', 'match', 'put', 'miss'] as const) {
    for (const path of [asset, '/products', '/products?__bos_reload=1']) {
      test(`${label}: ${fault} with healthy network ${path}`, async () => {
        const navigation = !path.startsWith('/assets/')
        const f = fixture(worker, { open: () => fault === 'open', match: () => fault === 'match', putFails: fault === 'put',
          network: () => navigation ? response(shell, 'text/html') : response() })
        const run = f.dispatch(path, navigation ? 'navigate' : 'cors')
        assert.ok(run.answer)
        assert.equal(await (await run.answer).text(), navigation ? shell : 'export const healthy = true')
        await run.finish()
        assert.equal(f.fetches.length, 1, 'one healthy fetch, no duplicate fallback')
        assert.equal(f.fetches[0].input, run.request, 'same original Request')
        assert.equal(f.fetches[0].init, undefined, 'no init downgrades navigation or alters headers')
        assert.equal(run.request.headers.get('x-fixture'), 'preserved')
        assert.equal(run.request.credentials, 'include')
        assert.equal(run.request.redirect, 'manual')
        if (fault === 'open' || fault === 'put') assert.equal(f.writes.length, 0)
      })
    }
  }
  for (const fault of ['open', 'match'] as const) {
    for (const path of [asset, '/products', '/products?__bos_reload=1']) test(`${label}: ${fault} plus offline rejects honestly ${path}`, async () => {
      const f = fixture(worker, { open: () => fault === 'open', match: () => fault === 'match', offline: true })
      const run = f.dispatch(path, path === asset ? 'cors' : 'navigate')
      await assert.rejects(run.answer!, /Network unavailable/)
      assert.equal(f.fetches.length, 1)
    })
  }
  test(`${label}: failed index lookup still serves a healthy root cache entry offline`, async () => {
    const f = fixture(worker, { offline: true, match: (_name, key) => key === '/index.html', entries: { [current]: { '/': response(shell, 'text/html') } } })
    const run = f.dispatch('/products', 'navigate')
    assert.equal(await (await run.answer!).text(), shell)
    await run.finish()
    assert.equal(f.fetches.length, 1, 'ordinary shell background revalidation remains best effort')
  })
  for (const fault of ['open', 'match'] as const) test(`${label}: retained metadata ${fault} denial uses one healthy network request`, async () => {
    const f = fixture(worker, { open: name => fault === 'open' && name === current, match: (name, key) => fault === 'match' && name === current && key === '/__business_os_incumbent__' })
    assert.equal(await (await f.dispatch(asset).answer!).text(), 'export const healthy = true')
    assert.equal(f.fetches.length, 1)
  })
  test(`${label}: mutable static hit survives background put quota with one revalidation`, async () => {
    const path = '/theme-bootstrap.js'
    const f = fixture(worker, { putFails: true, entries: { [staticCurrent]: { [origin + path]: response('cached bootstrap') } } })
    const run = f.dispatch(path)
    assert.equal(await (await run.answer!).text(), 'cached bootstrap')
    await run.finish()
    assert.equal(f.fetches.length, 1)
    assert.equal(f.writes.length, 0)
  })
  for (const [body, mime] of [['challenge', 'text/html'], ['{}', 'application/json']]) test(`${label}: live ${mime} non-app response never becomes shell`, async () => {
    const f = fixture(worker, { network: () => response(body, mime) })
    const run = f.dispatch('/products', 'navigate')
    assert.equal(await (await run.answer!).text(), body)
    assert.equal(f.writes.length, 0)
    assert.equal(f.fetches.length, 1)
  })
  for (const fault of ['open', 'match'] as const) test(`${label}: retained ${fault} failure skips to another valid generation`, async () => {
    const f = fixture(worker, { open: name => fault === 'open' && name === 'business-os-static-old',
      match: name => fault === 'match' && name === 'business-os-static-old', entries: {
        [current]: { '/__business_os_incumbent__': proof() },
        'business-os-static-other': { [origin + asset]: response('retained bytes') },
      } })
    assert.equal(await (await f.dispatch(asset).answer!).text(), 'retained bytes')
    assert.equal(f.fetches.length, 0)
  })
  test(`${label}: retained failure or poisoned MIME falls back to exactly one live fetch`, async () => {
    const f = fixture(worker, { entries: { [current]: { '/__business_os_incumbent__': proof() },
      'business-os-static-old': { [origin + asset]: response(shell, 'text/html') } },
      match: name => name === 'business-os-static-other' })
    assert.equal(await (await f.dispatch(asset).answer!).text(), 'export const healthy = true')
    assert.equal(f.fetches.length, 1)
  })
  test(`${label}: immutable healthy hit has zero network and no dependency on global keys/match`, async () => {
    const f = fixture(worker, { entries: { [staticCurrent]: { [origin + asset]: response('cached bytes') } } })
    const run = f.dispatch(asset)
    assert.equal(await (await run.answer!).text(), 'cached bytes')
    await run.finish()
    assert.equal(f.fetches.length, 0)
  })
  test(`${label}: shell hit is immediate and invalid revalidation cannot overwrite it`, async () => {
    const f = fixture(worker, { entries: { [current]: { '/index.html': response(shell, 'text/html') } }, network: () => response('challenge', 'text/html') })
    const run = f.dispatch('/products', 'navigate')
    assert.equal(await (await run.answer!).text(), shell)
    await run.finish()
    assert.equal(f.fetches.length, 1)
    assert.equal(f.writes.length, 0)
  })
  test(`${label}: poisoned cached document with delete denial uses original navigation`, async () => {
    const f = fixture(worker, { deleteFails: true, entries: { [current]: { '/index.html': response('{}', 'application/json') } }, network: () => response(shell, 'text/html') })
    const run = f.dispatch('/products', 'navigate')
    assert.equal(await (await run.answer!).text(), shell)
    assert.equal(f.fetches[0].input, run.request)
    assert.equal(f.fetches[0].init, undefined)
  })
  for (const status of [200, 404]) test(`${label}: stale asset ${status} with storage denied remains honest404 and broadcasts`, async () => {
    const f = fixture(worker, { open: () => true, network: input => typeof input === 'string' ? response(shell, 'text/html') : response(shell, 'text/html', status) })
    const run = f.dispatch(asset)
    const result = await run.answer!
    assert.equal(result.status, 404)
    assert.equal(await result.text(), '')
    await run.finish()
    assert.equal(f.fetches.length, 1, 'no unused shell fetch when its cache cannot be opened')
    assert.equal(f.updates(), 1)
    assert.equal(f.broadcasts.filter(message => message.type === 'BUSINESS_OS_STALE_ASSET').length, 1)
  })
  for (const path of ['/api/products', '/health', '/uploads/photo.jpg', '/files/export', '/portal/uploads/photo.jpg']) {
    for (const method of ['GET', 'POST']) test(`${label}: passthrough ${method} ${path}`, () => {
      const f = fixture(worker, { open: () => true })
      assert.equal(f.dispatch(path, 'cors', method).answer, undefined)
      assert.equal(f.fetches.length, 0)
    })
  }
}
test('exact old worker negative control blocks healthy asset and navigation before any fetch', async () => {
  const f = fixture(oldWorker, { open: () => true })
  for (const [path, mode] of [[asset, 'cors'], ['/products', 'navigate']]) await assert.rejects(f.dispatch(path, mode).answer!, /Storage unavailable/)
  assert.equal(f.fetches.length, 0)
})
