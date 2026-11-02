// Review of 6.0.1041, finding F1: after a refused flip (409 read_switch_epoch_stale) the Server page says "Showing the current
// ones" and reloads the listing. That reload went through the 20 s client read cache, so it handed back the pre-flip listing and the
// next tap sent the old epoch again, and was refused again, for up to 20 s. The listing is a control panel: it is always read fresh.
//
// Runs the real api/http.ts, api/systemRuntime.ts and components/server/readSwitchesFlow.ts against a counting fake server.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundled = buildSync({
  stdin: {
    contents: "export * as runtime from './src/api/systemRuntime.ts'; export * as http from './src/api/http.ts'; export * as flow from './src/components/server/readSwitchesFlow.ts'",
    resolveDir: FRONTEND, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
}).outputFiles[0].text
const bundleModule = { exports: {} as Record<string, any> }
new Function('module', 'exports', 'require', bundled)(bundleModule, bundleModule.exports, (name: string) => { throw new Error(`unexpected require ${name}`) })
const { runtime, http, flow } = bundleModule.exports as {
  runtime: typeof import('../src/api/systemRuntime.ts')
  http: typeof import('../src/api/http.ts')
  flow: typeof import('../src/components/server/readSwitchesFlow.ts')
}

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function readableStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// The Worker's two read-switch handlers, reduced to what the panel sees: one epoch, a compare-and-swap on it.
async function withServer(run: (server: { epoch: number; gets: number; flipElsewhere: () => void }) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch
  const originalWindow = (globalThis as { window?: unknown }).window
  const server = { epoch: 4, gets: 0, flipElsewhere() { this.epoch += 1 } }
  ;(globalThis as { window?: unknown }).window = { location: { origin: 'https://admin.example.test', hostname: 'admin.example.test' }, localStorage: readableStorage(), sessionStorage: readableStorage(), dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} }
  http.__resetApiWriteDedupeForTests(); http.__resetApiHealthForTests(); http.cacheClearAll()
  http.setSyncServerUrl('https://admin.example.test'); http.setSyncToken('')
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = String(init?.method || 'GET').toUpperCase()
    if (!String(url).endsWith('/api/runtime/read-switches')) return json(404, { success: false })
    if (method === 'GET') {
      server.gets += 1
      return json(200, { success: true, epoch: server.epoch, memoSeconds: 15, switches: [{ name: 'probe', state: 'off', rate: 0 }] })
    }
    const body = JSON.parse(String(init?.body || '{}')) as { expectedEpoch?: number }
    if (body.expectedEpoch !== server.epoch) return json(409, { success: false, code: 'read_switch_epoch_stale', epoch: server.epoch })
    server.epoch += 1
    return json(200, { success: true, epoch: server.epoch })
  }) as typeof fetch
  try { await run(server) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    http.__resetApiWriteDedupeForTests(); http.__resetApiHealthForTests(); http.cacheClearAll(); http.setSyncServerUrl('')
  }
}

type Listing = import('../src/components/server/readSwitchesFlow.ts').ReadSwitchListing

// The panel as ReadSwitchesPanel wires it: `read` is its getReadSwitches, the flow reloads through it.
async function tapAfterAnotherAdminFlipped(read: () => Promise<unknown>, server: { epoch: number; flipElsewhere: () => void }) {
  let listing = flow.normalizeReadSwitches(await read()) as Listing
  assert.equal(listing.epoch, 4, 'the page loaded epoch 4')
  server.flipElsewhere()
  const notices: string[] = []
  const deps = {
    t: (key: string) => key,
    ask: async () => true,
    set: (payload: { name: string; state: 'on' | 'off'; expectedEpoch: number }) => runtime.setReadSwitch(payload),
    reload: async () => { listing = flow.normalizeReadSwitches(await read()) as Listing },
    notify: (message: string, type?: string) => { notices.push(`${type}:${message}`) },
  }
  const outcomes: string[] = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    outcomes.push(await flow.changeReadSwitch(deps, listing, listing.switches[0]))
    if (outcomes[outcomes.length - 1] === 'changed') break
  }
  return { outcomes, listingEpoch: listing.epoch, notices }
}

await runTest('POSITIVE CONTROL: a listing read through the 20 s client cache stays stale, so every retry resends the old epoch', () => withServer(async (server) => {
  const cached = () => http.route('system:readSwitches', () => http.apiFetch('GET', '/api/runtime/read-switches'), null)
  const result = await tapAfterAnotherAdminFlipped(cached, server)
  assert.deepEqual(result.outcomes, ['stale', 'stale', 'stale'], 'the old read shape keeps being refused')
  assert.equal(result.listingEpoch, 4, 'and keeps showing the pre-flip epoch')
  assert.equal(server.gets, 1, 'because only the first read ever reached the server')
}))

await runTest('the panel\'s own listing read bypasses the client cache: one refusal, then the retry carries the current epoch and lands', () => withServer(async (server) => {
  const result = await tapAfterAnotherAdminFlipped(() => runtime.getReadSwitches(), server)
  assert.deepEqual(result.outcomes, ['stale', 'changed'])
  assert.equal(result.listingEpoch, 6, 'the listing now shows the epoch the successful flip produced')
  assert.equal(server.epoch, 6)
  assert.ok(server.gets >= 3, 'the first load, the reload after the refusal and the reload after the flip each reached the server')
}))

await runTest('after a successful flip the reload shows the flip, not the listing cached before it', () => withServer(async (server) => {
  let listing = flow.normalizeReadSwitches(await runtime.getReadSwitches()) as Listing
  const deps = {
    t: (key: string) => key,
    ask: async () => true,
    set: (payload: { name: string; state: 'on' | 'off'; expectedEpoch: number }) => runtime.setReadSwitch(payload),
    reload: async () => { listing = flow.normalizeReadSwitches(await runtime.getReadSwitches()) as Listing },
    notify: () => {},
  }
  assert.equal(await flow.changeReadSwitch(deps, listing, listing.switches[0]), 'changed')
  assert.equal(listing.epoch, 5)
}))

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('readSwitchesFreshListing: all passed')
