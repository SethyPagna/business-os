// 6.0.880: the install precache follows the host. The storefront installs only
// its startup closure; the staff host installs its shell plus the language
// pack the staff app last loaded, never both packs and never POS-for-offline.
// Drives the real install code (source and shipped sw.js) against in-memory
// caches and a fake origin. Run: node tests/swPrecachePerHost.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const shipped = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

const asset = (name: string) => `/assets/${name}-AbCd1234.js`
const required = [asset('index'), asset('PublicCatalogRoot'), '/assets/index-AbCd1234.css']
const staffShell = [asset('AdminRoot'), asset('app-shared')]
const routes = [asset('POS'), asset('vendor'), asset('Products')]
const languagePacks = { en: asset('lang-en'), km: asset('lang-km') }
const manifest = {
  hash: 'fixture',
  languagePacks,
  hosts: {
    admin: { required, eager: [...required, ...staffShell], deferred: routes },
    shop: { required, eager: required, deferred: [] },
  },
}
const shell = `<!doctype html><html><head><script type="module" src="${asset('index')}"></script></head><body><div id="root"></div></body></html>`

type Store = Map<string, Map<string, Response>>
const pathOf = (input: unknown) => new URL(typeof input === 'string' ? input : (input as Request).url, 'https://fixture.test').pathname
function basic(response: Response): Response {
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}
function makeCaches(store: Store) {
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    const entries = store.get(name)!
    return {
      match: async (input: unknown) => { const hit = entries.get(pathOf(input)); return hit && basic(hit.clone()) },
      put: async (input: unknown, response: Response) => { entries.set(pathOf(input), response) },
      delete: async (input: unknown) => entries.delete(pathOf(input)),
    }
  }
  return {
    open,
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (input: unknown) => {
      for (const entries of store.values()) { const hit = entries.get(pathOf(input)); if (hit) return basic(hit.clone()) }
      return undefined
    },
  }
}

function worker(code: string, hostname: string, hash: string, store: Store) {
  const origin = `https://${hostname}`
  const fetched: string[] = []
  const listeners: Record<string, (event: unknown) => void> = {}
  const fetch = async (input: unknown) => {
    const path = pathOf(input)
    fetched.push(path)
    if (path === '/' || path === '/index.html') return basic(new Response(shell, { headers: { 'content-type': 'text/html' } }))
    if (path === '/business-os-precache.json') return basic(new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }))
    if (path.endsWith('.css')) return basic(new Response('body{}', { headers: { 'content-type': 'text/css' } }))
    if (path.endsWith('.js')) return basic(new Response('export {}', { headers: { 'content-type': 'text/javascript' } }))
    return basic(new Response('icon', { headers: { 'content-type': 'image/png' } }))
  }
  class FixtureRequest extends Request {
    constructor(input: unknown, init?: RequestInit) { super(new URL(typeof input === 'string' ? input : (input as Request).url, origin), init) }
  }
  const self = {
    location: { origin, hostname },
    addEventListener: (name: string, callback: (event: unknown) => void) => { listeners[name] = callback },
    registration: { active: null, waiting: null, installing: null, update: async () => {} },
    clients: { matchAll: async () => [], claim: async () => {} },
    skipWaiting: async () => {},
  }
  const context = vm.createContext({ self, caches: makeCaches(store), fetch, Request: FixtureRequest, Response, URL, MessageChannel, setTimeout, clearTimeout, console })
  vm.runInContext(code.replaceAll('__BUSINESS_OS_BUILD_HASH__', hash), context)
  return {
    fetched,
    install: () => vm.runInContext('precacheAppShell().then(() => pendingDeferredAssets)', context) as Promise<string[]>,
    async request(path: string) {
      const pending: Promise<unknown>[] = []
      listeners.fetch({ request: new FixtureRequest(path), respondWith: (value: Promise<unknown>) => pending.push(value), waitUntil: (value: Promise<unknown>) => pending.push(value) })
      await Promise.allSettled(pending)
    },
  }
}
const assets = (list: string[]) => list.filter((path) => path.startsWith('/assets/')).sort()
// What the generation's static cache holds (copied from an older generation or fetched).
const cached = (store: Store, hash: string) => [...(store.get(`business-os-static-${hash}`)?.keys() ?? [])].sort()

let failed = 0
async function runTest(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

for (const [label, code] of [['source', source], ['shipped sw.js', shipped]] as const) {
  await runTest(`the storefront installs only its startup closure and defers nothing (${label})`, async () => {
    const shopStore: Store = new Map()
    const shop = worker(code, 'leangcosmetics.example', 'one', shopStore)
    const deferred = await shop.install()
    assert.deepEqual(assets(shop.fetched), [...required].sort())
    assert.deepEqual(cached(shopStore, 'one'), [...required].sort())
    assert.deepEqual([...deferred], [])
    assert.ok(shop.fetched.includes('/portal-manifest.json'), 'the storefront keeps its install identity')
  })

  await runTest(`the staff host installs its shell, defers routes, and precaches no language pack it has not seen (${label})`, async () => {
    const admin = worker(code, 'admin.leangcosmetics.example', 'one', new Map())
    const deferred = await admin.install()
    assert.deepEqual(assets(admin.fetched), [...required, ...staffShell].sort())
    assert.deepEqual([...deferred].sort(), [...routes].sort(), 'POS and the receipt vendor chunk are background, not install, work')
    assert.ok(admin.fetched.includes('/manifest.json'), 'the staff host keeps its install identity')
  })

  await runTest(`a staff device that loaded the Khmer pack gets only that pack at the next install (${label})`, async () => {
    const store: Store = new Map()
    const running = worker(code, 'admin.leangcosmetics.example', 'one', store)
    await running.install()
    await running.request(languagePacks.km)
    const next = worker(code, 'admin.leangcosmetics.example', 'two', store)
    await next.install()
    assert.ok(cached(store, 'two').includes(languagePacks.km), 'the remembered pack is precached')
    assert.ok(!cached(store, 'two').includes(languagePacks.en), 'the other pack stays on demand')
    const remembered = await store.get('business-os-app-shell-two')?.get('/__business_os_ui_language__')?.clone().json()
    assert.equal(remembered?.language, 'km', 'the choice is carried into the new generation')
  })

  await runTest(`switching language moves the eager pack; the storefront never records one (${label})`, async () => {
    const store: Store = new Map()
    const running = worker(code, 'admin.leangcosmetics.example', 'one', store)
    await running.install()
    await running.request(languagePacks.km)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await running.request(languagePacks.en)
    const next = worker(code, 'admin.leangcosmetics.example', 'two', store)
    await next.install()
    assert.ok(cached(store, 'two').includes(languagePacks.en))
    assert.ok(!cached(store, 'two').includes(languagePacks.km))

    const shopStore: Store = new Map()
    const shop = worker(code, 'leangcosmetics.example', 'one', shopStore)
    await shop.install()
    await shop.request(languagePacks.km)
    assert.equal(shopStore.get('business-os-app-shell-one')?.has('/__business_os_ui_language__'), false)
  })
}

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll per-host precache tests passed')
