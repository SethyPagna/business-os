// CACHE-LIFECYCLE T-CL4 client part (lane 6.0.1048, R2/R6). The database gets a new data epoch at a restore, a branch cutover or a forced
// maintenance clear. The Worker names it with 8 hex characters on every /api response (X-BOS-Epoch) and in the bootstrap runtime
// (dataEpoch). A tab that sees a tag it has not seen before: drops its memory read cache, resets the product search index in memory
// and on disk (a load already running is fenced from storing anything), refreshes the screens through ONE staggered burst, and does
// NOT reload, sign out, unregister the worker or touch a draft, a cart or an unsent checkout. A tag it already left is an echo from an
// isolate whose 15 s memo has not refreshed, not a second change. Runs the real api/http.ts against a stubbed fetch and a recording window.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  cacheClearAll,
  cacheGet,
  cacheSet,
  setSyncServerUrl,
} from '../src/api/http.ts'
import {
  DATA_EPOCH_EVENT,
  __resetDataEpochForTests,
  createEpochTracker,
  currentDataEpoch,
  observeDataEpoch,
  seedDataEpoch,
} from '../src/api/dataEpoch.ts'
import { __dataEpochResetTest, installDataEpochReset } from '../src/api/epochReset.ts'
import { __productSearchIndexTest, ensureProductSearchIndex, resetProductSearchIndexForNewEpoch } from '../src/api/productSearchIndex.ts'
import { __resetServerSignalsForTests } from '../src/api/serverSignals.ts'
import { normalizeRuntimeDescriptor, readStoredRuntimeDescriptor, shouldResetForRuntimeChange } from '../src/platform/runtime/clientRuntime.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(FRONTEND, relative), 'utf8').split('\r\n').join('\n')

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

const EPOCH_A = 'aaaaaaaa'
const EPOCH_B = 'bbbbbbbb'
const EPOCH_C = 'cccccccc'
const WATCHED = [DATA_EPOCH_EVENT, 'sync:update', 'sync:reconnected', 'server:health', 'sync:app-update-available']
const DRAFT_KEY = 'businessos_draft_v2_%5B%22origin%22%5D_product'
const CART_KEY = 'businessos_pos_orders_7'
const DRAFT = JSON.stringify({ schema: 1, at: 1, data: { name: 'half typed ខ្មែរ' } })
const CART = JSON.stringify([{ id: 'o1', schema: 1, cart: [{ id: 5, qty: 2 }], checkoutRequestId: 'req-1' }])
const UNRESOLVED = JSON.stringify([{ id: 'o9', checkoutRequestId: 'req-9' }])

type Page = { events: Array<{ type: string; detail: any }>; epochHeader: { value: string | null }; reloads: number; local: Storage; session: Storage }

async function onPage(run: (page: Page) => Promise<void>): Promise<void> {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage
  const originalFetch = globalThis.fetch
  const target = new EventTarget()
  const local = memoryStorage({ [DRAFT_KEY]: DRAFT, [CART_KEY]: CART, 'businessos_pos_checkout_unresolved_v1:x': UNRESOLVED })
  const session = memoryStorage({ [CART_KEY]: CART })
  const page: Page = { events: [], epochHeader: { value: null }, reloads: 0, local, session }
  for (const type of WATCHED) target.addEventListener(type, (event) => page.events.push({ type, detail: (event as CustomEvent).detail }))
  ;(globalThis as { window?: unknown }).window = Object.assign(target, {
    location: { origin: 'https://sync.example.test', hostname: 'sync.example.test', reload: () => { page.reloads += 1 }, replace: () => { page.reloads += 1 }, assign: () => { page.reloads += 1 } },
    localStorage: local, sessionStorage: session,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
  ;(globalThis as { localStorage?: unknown }).localStorage = local
  globalThis.fetch = (async (url: string) => {
    const where = String(url).replace('https://sync.example.test', '')
    if (where === '/health') return new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...(page.epochHeader.value ? { 'X-BOS-Epoch': page.epochHeader.value } : {}) } })
  }) as typeof fetch
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); __resetServerSignalsForTests(); __resetDataEpochForTests(); __dataEpochResetTest.reset(); cacheClearAll()
  setSyncServerUrl('https://sync.example.test')
  const { transport, state } = __productSearchIndexTest
  const originals = { ...transport }
  try { await run(page) } finally {
    Object.assign(transport, originals)
    __productSearchIndexTest.reset()
    state.resets = 0
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    ;(globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage
    __resetApiHealthForTests(); __resetServerSignalsForTests(); __resetDataEpochForTests(); cacheClearAll(); setSyncServerUrl('')
  }
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setImmediate(resolve)) }
const epochEvents = (page: Page) => page.events.filter((event) => event.type === DATA_EPOCH_EVENT)
const refreshBursts = (page: Page) => page.events.filter((event) => event.type === 'sync:update').length

await runTest('the tracker: first sighting adopts, same is silent, a new tag is one change, a tag already left is an echo, garbage is invalid', () => {
  const tracker = createEpochTracker()
  assert.equal(tracker.observe(EPOCH_A), 'first')
  assert.equal(tracker.observe(EPOCH_A), 'same')
  assert.equal(tracker.observe(EPOCH_B), 'changed')
  assert.equal(tracker.observe(EPOCH_B), 'same')
  assert.equal(tracker.observe(EPOCH_A), 'echo', 'a stale isolate answering with the previous tag is not a second change')
  assert.equal(tracker.observe(EPOCH_B), 'same')
  assert.equal(tracker.observe(EPOCH_C), 'changed')
  assert.equal(tracker.observe(EPOCH_A), 'echo')
  assert.equal(tracker.observe(EPOCH_B), 'echo')
  for (const bad of [null, undefined, '', 'AAAAAAAA', 'aaaaaaa', 'aaaaaaaaa', 'gggggggg', 42, {}, 'aaaaaaaa\n']) assert.equal(tracker.observe(bad), 'invalid', String(bad))
  assert.equal(tracker.current(), EPOCH_C)
})

await runTest('flapping between isolates (A, B, A, B, A, B) is exactly one change', () => {
  const tracker = createEpochTracker(EPOCH_A)
  const decisions = [EPOCH_B, EPOCH_A, EPOCH_B, EPOCH_A, EPOCH_B].map((tag) => tracker.observe(tag))
  assert.deepEqual(decisions, ['changed', 'echo', 'same', 'echo', 'same'])
})

await runTest('a stored tag from the earlier session is adopted once and never replaces one already in use', () => {
  const tracker = createEpochTracker()
  tracker.seed(EPOCH_A)
  tracker.seed(EPOCH_B)
  assert.equal(tracker.current(), EPOCH_A)
  assert.equal(tracker.observe(EPOCH_B), 'changed', 'a restore while the browser was closed is still noticed')
  const fresh = createEpochTracker()
  fresh.seed('nonsense')
  assert.equal(fresh.current(), null)
})

await runTest('a data epoch is not a hard runtime key: it never resets local state, while a different data root, storage version or organisation still does', () => {
  assert.equal(shouldResetForRuntimeChange({ dataEpoch: EPOCH_A }, { dataEpoch: EPOCH_B }), false)
  assert.equal(shouldResetForRuntimeChange({ dataEpoch: EPOCH_A, organizationPublicId: 'o' }, { dataEpoch: EPOCH_B, organizationPublicId: 'o' }), false)
  assert.equal(shouldResetForRuntimeChange({ dataRootKey: 'root-a' }, { dataRootKey: 'root-b' }), true)
  assert.equal(shouldResetForRuntimeChange({ storageVersion: '1' }, { storageVersion: '2' }), true)
  assert.equal(shouldResetForRuntimeChange({ organizationPublicId: 'a' }, { organizationPublicId: 'b' }), true)
  assert.equal(normalizeRuntimeDescriptor({ dataEpoch: ` ${EPOCH_A} ` }).dataEpoch, EPOCH_A)
})

await runTest('a new epoch on a response resets the caches once, refreshes the screens in one burst, and reloads nothing', () => onPage(async (page) => {
  installDataEpochReset()
  cacheSet('products:get', { rows: [1, 2, 3] })
  const { state, transport } = __productSearchIndexTest
  let clears = 0
  transport.clearStored = async () => { clears += 1 }
  state.status = 'ready'
  state.index = {} as never
  state.pages = new Map([[0, { page: 0, hash: 'h', rows: [] }]])
  state.stale = false

  page.epochHeader.value = EPOCH_A
  await apiFetch('GET', '/api/ping'); await apiFetch('GET', '/api/ping2')
  await tick()
  assert.equal(epochEvents(page).length, 0, 'the first tag a tab sees is its baseline, not a change')
  assert.deepEqual(cacheGet('products:get'), { rows: [1, 2, 3] }, 'and the cache is untouched')
  assert.equal(refreshBursts(page), 0)

  page.epochHeader.value = EPOCH_B
  await apiFetch('GET', '/api/ping3')
  await tick()
  assert.equal(epochEvents(page).length, 1, 'one change event')
  assert.equal(cacheGet('products:get'), null, 'the memory read cache is empty')
  assert.equal(state.index, null, 'the search index is gone from memory')
  assert.equal(state.status, 'idle')
  assert.equal(state.pages.size, 0)
  assert.equal(clears, 1, 'and from disk, once')
  const burst = refreshBursts(page)
  assert.ok(burst > 0, 'the screens are told to refresh')
  assert.equal(readStoredRuntimeDescriptor().dataEpoch, EPOCH_B, 'the new tag is remembered for the next session')

  // The same tag again, and an echo of the old one from a lagging isolate: nothing more happens.
  cacheSet('products:get', { rows: ['after'] })
  page.epochHeader.value = EPOCH_B
  await apiFetch('GET', '/api/ping4')
  page.epochHeader.value = EPOCH_A
  await apiFetch('GET', '/api/ping5')
  await tick()
  assert.equal(epochEvents(page).length, 1, 'no second change')
  assert.equal(refreshBursts(page), burst, 'no second burst')
  assert.deepEqual(cacheGet('products:get'), { rows: ['after'] }, 'and the cache filled since is kept')
  assert.equal(clears, 1)
  assert.equal(page.reloads, 0, 'the tab never reloads, replaces or assigns its location')
  assert.equal(page.events.filter((event) => event.type === 'sync:app-update-available').length, 0, 'an epoch change is not an update either')
}))

await runTest('drafts, carts and unsent checkouts are byte for byte what they were, in both stores', () => onPage(async (page) => {
  installDataEpochReset()
  const before = [...Array(page.local.length).keys()].map((i) => page.local.key(i) as string).sort().map((key) => [key, page.local.getItem(key)])
  const sessionBefore = page.session.getItem(CART_KEY)
  page.epochHeader.value = EPOCH_A
  await apiFetch('GET', '/api/a')
  page.epochHeader.value = EPOCH_B
  await apiFetch('GET', '/api/b')
  await tick()
  assert.equal(epochEvents(page).length, 1)
  assert.equal(page.local.getItem(DRAFT_KEY), DRAFT)
  assert.equal(page.local.getItem(CART_KEY), CART)
  assert.equal(page.local.getItem('businessos_pos_checkout_unresolved_v1:x'), UNRESOLVED)
  assert.equal(page.session.getItem(CART_KEY), sessionBefore)
  const after = [...Array(page.local.length).keys()].map((i) => page.local.key(i) as string).filter((key) => key !== 'businessos_client_runtime').sort().map((key) => [key, page.local.getItem(key)])
  assert.deepEqual(after.filter(([key]) => before.some(([k]) => k === key)), before, 'nothing that was there changed')
}))

await runTest('the bootstrap path: a stored tag that differs from the bootstrap tag is one change; none stored or the same is silent', () => onPage(async (page) => {
  installDataEpochReset()
  seedDataEpoch(EPOCH_A)
  assert.equal(observeDataEpoch(EPOCH_A, 'bootstrap'), 'same')
  assert.equal(epochEvents(page).length, 0)
  assert.equal(observeDataEpoch(EPOCH_B, 'bootstrap'), 'changed')
  await tick()
  assert.equal(epochEvents(page).length, 1)
  assert.equal(epochEvents(page)[0].detail.source, 'bootstrap')
  assert.equal(currentDataEpoch(), EPOCH_B)
  __resetDataEpochForTests()
  seedDataEpoch('')
  assert.equal(observeDataEpoch(EPOCH_A, 'bootstrap'), 'first', 'a device that never stored one adopts it')
  assert.equal(epochEvents(page).length, 1)
}))

await runTest('a search index load that began before the reset cannot store a page afterwards; without a reset the same load does (control)', () => onPage(async (page) => {
  void page
  const { transport, state } = __productSearchIndexTest
  let writes = 0
  let clears = 0
  transport.readStored = async () => null
  transport.writeStored = async () => { writes += 1 }
  transport.clearStored = async () => { clears += 1 }
  let release: () => void = () => {}
  transport.fetchPage = (pageNumber: number) => new Promise((resolve) => {
    release = () => resolve({ format: 1, page: pageNumber, buckets: [0], hash: 'h1', rows: [[1, 'Name', '', '', '', '']] } as never)
  })

  // control: the load completes and stores
  const control = ensureProductSearchIndex(true)
  await tick()
  release()
  await control
  assert.notEqual(state.index, null, 'control: the index was built')
  assert.equal(writes, 1, 'control: and stored once')

  __productSearchIndexTest.reset()
  state.resets = 0
  writes = 0
  const loading = ensureProductSearchIndex(true)
  await tick()
  const resetting = resetProductSearchIndexForNewEpoch()
  release()
  await Promise.all([loading, resetting])
  assert.equal(state.index, null, 'the fenced load built nothing')
  assert.equal(writes, 0, 'and stored nothing')
  assert.equal(state.status, 'idle')
  assert.equal(clears, 1)
}))

await runTest('nothing in the epoch path can reload, navigate, sign out or unregister the worker', () => {
  for (const file of ['src/api/dataEpoch.ts', 'src/api/epochReset.ts', 'src/api/serverSignals.ts']) {
    const text = read(file)
    assert.doesNotMatch(text, /location\s*\.\s*(reload|replace|assign|href)|history\.(push|replace)State|unregister\(|resetClientRuntimeState|clearLocalBusinessState|removeItem|localStorage\.clear|sessionStorage\.clear/, file)
  }
  const reset = read('src/api/epochReset.ts')
  assert.match(reset, /cacheClearAll\(\)/)
  assert.match(reset, /resetProductSearchIndexForNewEpoch\(\)/)
  assert.match(reset, /dispatchGlobalDataRefresh\(\)/)
  const context = read('src/AppContext.tsx')
  assert.match(context, /seedDataEpoch\(storedDataEpoch\)/)
  assert.match(context, /observeDataEpoch\(runtimeDescriptor\.dataEpoch, 'bootstrap'\)/)
  assert.match(context, /installDataEpochReset\(\)/)
  assert.match(context, /const hardRuntimeReset = shouldResetForRuntimeChange\(storedRuntimeDescriptor, runtimeDescriptor\)/)
})

await runTest('the Worker sends the tag as runtime.dataEpoch, never as the hard dataRootKey', () => {
  const auth = fs.readFileSync(path.join(FRONTEND, '..', 'cloudflare', 'src', 'routes', 'auth.ts'), 'utf8')
  assert.match(auth, /\.\.\.\(dataEpoch \? \{ dataEpoch \} : \{\}\)/)
  assert.doesNotMatch(auth.replace(/\/\/.*$/gm, ''), /dataRootKey/)
})

if (failed) { console.error(`${failed} epochReset test(s) failed`); process.exit(1) }
console.log('epochReset tests passed')
