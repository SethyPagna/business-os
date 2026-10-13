// The shared store behind the "waiting for review" tags (owner, 13 Oct 2026).
//
// What this pins, in the order the plan (section 2.3) asks for it:
//   - ONE read per page visit, however many rows the page draws: 500 rows = 1 request.
//     A row only reads the store; a row that fetches is the regression.
//   - A requester never calls GET /api/review (the reviewer list). Reviewers read
//     everyone's open requests, every other user reads their own (/api/review/mine).
//   - The list refreshes when the review queue announces a change (the
//     `pendingActions` sync channel) and straight after the user's own write was
//     answered "queued for review".
//   - A row re-renders only when ITS answer flips (the Products memo boundaries stay).
//   - A failed read keeps the last list; another account never inherits the list, not even
//     when the old account's read is still on the wire (the new account starts its own).
//   - A scope change (the review permission arriving) never rides the read of the other scope.
//   - One announcement is one re-read, however many pages are mounted and hear it.
//   - The transport keeps no cached copy of the list (every open request's whole payload).
//
// The store is compiled from its source and run through a four-hook React stand-in so
// the real hooks (useSyncExternalStore, useEffect, useRef) execute their real code, and
// the transport, http layer and fetch are the real ones. Each mutant below is the same
// source with one rule removed; every scenario must go RED on the mutant it targets.
//
// Run: node tests/pendingReviewTargets.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import * as realHttp from '../src/api/http.ts'
import { __resetApiWriteDedupeForTests, cacheClearAll, cacheGet, cacheGetStale, setSyncServerUrl } from '../src/api/http.ts'
import * as realQuery from '../src/api/query.ts'
import * as realTransport from '../src/api/pendingReviewTargetsTransport.ts'

const require = createRequire(import.meta.url)
const storeSource = fs.readFileSync(new URL('../src/utils/pendingReviewTargets.ts', import.meta.url), 'utf8')
const transportSource = fs.readFileSync(new URL('../src/api/pendingReviewTargetsTransport.ts', import.meta.url), 'utf8')

// ---- a React stand-in: just enough hook semantics for the three hooks the store uses ----
type HookSlot = { value?: unknown; deps?: unknown[]; cleanup?: () => void }
type Mounted = {
  slots: HookSlot[]
  cursor: number
  effects: Array<() => void>
  renders: number
  result: unknown
  render: () => unknown
  run: () => void
  unmount: () => void
}
function createReactStandIn() {
  let current!: Mounted
  const module = {
    useRef: (initial: unknown) => {
      const slot = (current.slots[current.cursor] ??= { value: { current: initial } })
      current.cursor += 1
      return slot.value
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const host = current
      const slot = (host.slots[host.cursor] ??= {})
      host.cursor += 1
      const changed = !slot.deps || !deps || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps![index]))
      if (!changed) return
      slot.deps = deps
      host.effects.push(() => {
        slot.cleanup?.()
        const cleanup = effect()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
    // Subscribe once on mount (what React does), hand back the current snapshot every render.
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: () => unknown) => {
      const host = current
      const slot = (host.slots[host.cursor] ??= {})
      host.cursor += 1
      if (!slot.cleanup) {
        let last = getSnapshot()
        slot.cleanup = subscribe(() => {
          const next = getSnapshot()
          if (!Object.is(next, last)) { last = next; host.run() }
        })
      }
      return getSnapshot()
    },
  }
  function mount(render: () => unknown, options: { strict?: boolean } = {}): Mounted {
    const component: Mounted = {
      slots: [], cursor: 0, effects: [], renders: 0, result: undefined, render,
      run() {
        current = component
        component.cursor = 0
        component.renders += 1
        component.result = component.render()
        const queued = component.effects
        component.effects = []
        for (const effect of queued) effect()
      },
      unmount() {
        for (const slot of component.slots) { slot.cleanup?.(); slot.cleanup = undefined }
      },
    }
    component.run()
    if (options.strict) {
      // StrictMode: effects run, are cleaned up, then run again.
      for (const slot of component.slots) { slot.cleanup?.(); slot.cleanup = undefined; slot.deps = undefined }
      component.run()
    }
    return component
  }
  return { module, mount, rerender: (component: Mounted) => component.run() }
}
type ReactStandIn = ReturnType<typeof createReactStandIn>

// ---- a controllable account, and the real transport/http under a recording fetch ----
let authority = 'account-1'
const actorStandIn = {
  captureActorReadScope: (channel = '') => ({ authority, channel, revision: '0:0' }),
  isActorReadScopeCurrent: (scope: { authority: string }) => scope.authority === authority,
}

type Row = { section: string; entity_type: string; entity_id: number | null; status: string }
const open = (section: string, entity_type: string, entity_id: number | null): Row => ({ section, entity_type, entity_id, status: 'open' })

// What reached the wire, and what asked the transport to read. The http layer shares identical
// reads that are in flight at the same moment, so a store that asked 500 times could still put ONE
// request on the wire; the store itself must make one ask, and the spy at the transport boundary
// is what sees that.
const sent: string[] = []
const transportCalls: string[] = []
const transportSpy = {
  ...realTransport,
  getOpenPendingReviewRows: (scope: 'all' | 'mine') => { transportCalls.push(scope); return realTransport.getOpenPendingReviewRows(scope) },
}
let answers: Array<() => Promise<Response>> = []
let nextRows: Row[] = []
const jsonResponse = (rows: Row[], status = 200) =>
  new Response(JSON.stringify(status === 200 ? { success: true, data: rows } : { error: 'nope' }), { status, headers: { 'Content-Type': 'application/json' } })
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  sent.push(`${init?.method} ${new URL(String(url)).pathname}${new URL(String(url)).search}`)
  const scripted = answers.shift()
  return scripted ? scripted() : jsonResponse(nextRows)
}) as typeof fetch
setSyncServerUrl('https://sync.example.test')

type Store = typeof import('../src/utils/pendingReviewTargets.ts')
function loadStore(code = storeSource): { store: Store; react: ReactStandIn } {
  const react = createReactStandIn()
  const module: { exports: Record<string, unknown> } = { exports: {} }
  const compiled = transformSync(code, { loader: 'ts', format: 'cjs' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react') return react.module
    if (id.endsWith('actorReadScope.ts')) return actorStandIn
    if (id.endsWith('pendingReviewTargetsTransport.ts')) return transportSpy
    throw new Error(`Unexpected store dependency: ${id}`)
  }, module, module.exports)
  return { store: module.exports as unknown as Store, react }
}

function loadTransport(code = transportSource): typeof realTransport {
  const module: { exports: Record<string, unknown> } = { exports: {} }
  const compiled = transformSync(code, { loader: 'ts', format: 'cjs' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id.endsWith('http.ts')) return realHttp
    if (id.endsWith('query.ts')) return realQuery
    throw new Error(`Unexpected transport dependency: ${id}`)
  }, module, module.exports)
  return module.exports as unknown as typeof realTransport
}

function reset(): void {
  sent.length = 0
  transportCalls.length = 0
  answers = []
  nextRows = []
  authority = 'account-1'
  __resetApiWriteDedupeForTests()
  // A mutant that fails its scenario leaves a read hanging on the wire; the next scenario must not share it.
  cacheClearAll()
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 15))

/** A page: one loader, and `rows` row-level readers under it. Returns what hit the wire. */
async function visitPage(
  { store, react }: ReturnType<typeof loadStore>,
  options: { rows: number; reviewTier: string; strict?: boolean },
): Promise<{ loader: Mounted; rows: Mounted[] }> {
  const loader = react.mount(() => store.usePendingReviewTargetsLoader({ active: true, reviewTier: options.reviewTier }), { strict: options.strict })
  const rows = Array.from({ length: options.rows }, (_, index) =>
    react.mount(() => store.useIsPendingReview('products', 'product', [index + 1])))
  await settle()
  return { loader, rows }
}

// ---- scenarios (each also runs against its mutant, which must fail it) ----

async function scenarioFiveHundredRowsOneRequest(loaded = loadStore()): Promise<void> {
  reset()
  nextRows = [open('products', 'product', 17)]
  const { rows } = await visitPage(loaded, { rows: 500, reviewTier: 'full' })
  assert.equal(transportCalls.length, 1, `500 rows must share one request, the transport was asked ${transportCalls.length} times`)
  assert.equal(sent.length, 1, `500 rows must share one request, saw ${sent.length} on the wire`)
  assert.deepEqual(sent, ['GET /api/review?status=open&fields=targets'])
  assert.equal(rows.filter((row) => row.result === true).length, 1, 'exactly the one pending row reads true')
  assert.equal(rows[16].result, true)
}

async function scenarioStrictModeStillOneRequest(loaded = loadStore()): Promise<void> {
  reset()
  await visitPage(loaded, { rows: 3, reviewTier: 'full', strict: true })
  assert.equal(transportCalls.length, 1, `React StrictMode runs the visit effect twice; the page must still ask for ONE read, asked ${transportCalls.length}`)
  assert.equal(sent.length, 1)
}

async function scenarioRequesterNeverReadsTheReviewerList(loaded = loadStore()): Promise<void> {
  for (const tier of ['none', 'review', undefined, '']) {
    reset()
    await visitPage(loaded, { rows: 5, reviewTier: tier as string })
    assert.deepEqual(sent, ['GET /api/review/mine?status=open&fields=targets'], `a ${JSON.stringify(tier)} review tier reads only its own requests`)
    assert.ok(!sent.some((line) => /\/api\/review(\?|$)/.test(line)), 'GET /api/review is the reviewer list; a requester must not call it')
  }
  for (const tier of ['full', 'view']) {
    reset()
    await visitPage(loaded, { rows: 5, reviewTier: tier })
    assert.deepEqual(sent, ['GET /api/review?status=open&fields=targets'], `a ${tier} reviewer reads every open request`)
  }
}

async function scenarioRereadAfterOwnQueuedWrite(loaded = loadStore()): Promise<void> {
  reset()
  const { store } = loaded
  // The first read is on the wire when the user's own write is answered 202: it was
  // answered before that write committed, so it cannot be the last word.
  let releaseFirst!: () => void
  answers.push(() => new Promise((resolve) => { releaseFirst = () => resolve(jsonResponse([])) }))
  nextRows = [open('products', 'product', 9)]
  const first = store.refreshPendingReviewTargets('mine')
  await settle()
  assert.equal(sent.length, 1)
  assert.equal(store.noteQueuedForReview({ success: true, pending: true }).pending, true, 'the response is handed back untouched')
  releaseFirst()
  await first
  assert.equal(sent.length, 2, 'a queued write that lands during a read triggers one more read')
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [9]), true, 'the new request is tagged')
  // Writes that applied (or never said pending) do not read again.
  store.noteQueuedForReview({ success: true })
  store.noteQueuedForReview({ success: true, pending: false })
  store.noteQueuedForReview(null)
  await settle()
  assert.equal(sent.length, 2)
  // A plain call during a read shares it.
  let releaseSecond!: () => void
  answers.push(() => new Promise((resolve) => { releaseSecond = () => resolve(jsonResponse(nextRows)) }))
  const a = store.refreshPendingReviewTargets()
  const b = store.refreshPendingReviewTargets()
  await settle()
  releaseSecond()
  await Promise.all([a, b])
  assert.equal(sent.length, 3, 'two callers in one moment cost one request')
}

const tagged = (store: Store, id: number) => store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [id])

// Account 1's read is slow and still on the wire when account 2 signs in on the same till.
async function scenarioAccountSwitchWithReadInFlight(loaded = loadStore()): Promise<void> {
  reset()
  const { store } = loaded
  nextRows = [open('products', 'product', 5)]
  await store.refreshPendingReviewTargets('mine')
  assert.equal(tagged(store, 5), true)

  let releaseOld!: () => void
  answers.push(() => new Promise((resolve) => { releaseOld = () => resolve(jsonResponse([open('products', 'product', 5)])) }))
  const oldReading = store.refreshPendingReviewTargets('mine')
  await settle()
  assert.equal(sent.length, 2, "account 1's second read is on the wire")

  authority = 'account-2'
  cacheClearAll() // what the app does when the signed-in user changes: no read is shared across accounts
  let releaseNew!: () => void
  answers.push(() => new Promise((resolve) => { releaseNew = () => resolve(jsonResponse([open('products', 'product', 6)])) }))
  const newReading = store.refreshPendingReviewTargets('mine')
  await settle()
  assert.equal(sent.length, 3, "account 2 asks for its own list; it does not wait on account 1's read")
  assert.equal(tagged(store, 5), false, "account 1's tag is gone for account 2 while account 2's read is still on the wire")

  releaseOld()
  await oldReading
  assert.equal(tagged(store, 5), false, "account 1's late answer is dropped")
  releaseNew()
  await newReading
  assert.equal(tagged(store, 6), true, 'account 2 sees its own request')
  assert.equal(tagged(store, 5), false, "and never account 1's")
}

// The review permission arrives after the page first asked: the 'all' list must not be answered by the 'mine' read.
async function scenarioScopeChangeWithReadInFlight(loaded = loadStore()): Promise<void> {
  reset()
  const { store } = loaded
  let releaseMine!: () => void
  let releaseAll!: () => void
  answers.push(() => new Promise((resolve) => { releaseMine = () => resolve(jsonResponse([open('products', 'product', 1)])) }))
  const mineReading = store.refreshPendingReviewTargets('mine')
  await settle()
  answers.push(() => new Promise((resolve) => { releaseAll = () => resolve(jsonResponse([open('products', 'product', 2)])) }))
  const allReading = store.refreshPendingReviewTargets('all')
  await settle()
  assert.deepEqual(sent, ['GET /api/review/mine?status=open&fields=targets', 'GET /api/review?status=open&fields=targets'], 'the reviewer list is read, not answered by the requester read')
  releaseAll()
  await allReading
  assert.equal(tagged(store, 2), true)
  releaseMine()
  await mineReading
  assert.equal(tagged(store, 2), true, 'the superseded requester read does not overwrite the reviewer list')
  assert.equal(tagged(store, 1), false)
}

// Several pages mounted at once all hear the same pendingActions announcement.
async function scenarioOneAnnouncementOneRead(loaded = loadStore()): Promise<void> {
  const { store, react } = loaded
  const props = { active: true, reviewTier: 'full' as string, syncChannel: 'pendingActions' as string | null, syncTs: 100 as number | null }
  const mountLoaders = () => Array.from({ length: 4 }, () => react.mount(() => store.usePendingReviewTargetsLoader(props)))
  const announce = (loaders: Mounted[], ts: number) => { props.syncTs = ts; for (const loader of loaders) react.rerender(loader) }

  // Idle when the announcement lands: the first page reads once, the other three have nothing to add.
  reset()
  let loaders = mountLoaders()
  await settle()
  assert.equal(sent.length, 1, 'four pages visited in one moment cost one read')
  announce(loaders, 101)
  await settle()
  assert.equal(sent.length, 2, `one announcement with four pages mounted is ONE read, saw ${sent.length - 1}`)
  for (const loader of loaders) loader.unmount()

  // A read was already on the wire when it landed: that read may predate the change, so exactly one more follows it.
  reset()
  props.syncTs = 200
  let releaseVisit!: () => void
  answers.push(() => new Promise((resolve) => { releaseVisit = () => resolve(jsonResponse([])) }))
  loaders = mountLoaders()
  await settle()
  announce(loaders, 201)
  releaseVisit()
  await settle()
  assert.equal(sent.length, 2, `the visit read plus ONE re-read for the announcement, saw ${sent.length}`)
  for (const loader of loaders) loader.unmount()
}

// route() caches every answer; nothing serves this channel from the cache, so the payloads must not stay there.
async function scenarioNoPayloadsRetained(transport: typeof realTransport = realTransport): Promise<void> {
  reset()
  nextRows = [{ ...open('products', 'product', 5), payload_json: JSON.stringify({ cost_usd: 1.25, description: 'x'.repeat(200) }) } as Row]
  const rows = await transport.getOpenPendingReviewRows('all')
  assert.equal(rows.length, 1, 'the caller still gets the rows')
  assert.equal(cacheGet('review:targets:all'), null, "the open requests' payloads are not retained in the read cache")
  assert.equal(cacheGetStale('review:targets:all').data, null)
}

// ---- the tests ----

test('keys are section:entity_type:entity_id, with * for a request that has no record yet', () => {
  const { store } = loadStore()
  assert.equal(store.pendingReviewKey('products', 'product', 42), 'products:product:42')
  assert.equal(store.pendingReviewKey('fees', 'fee', '7'), 'fees:fee:7')
  assert.equal(store.pendingReviewKey('products', 'product', null), 'products:product:*')
  assert.equal(store.pendingReviewKey('inventory', 'inventory_reason'), 'inventory:inventory_reason:*')
  assert.equal(store.PENDING_REVIEW_NEW, '*')
})

test('the snapshot counts only open requests, keyed per record, and creates are counted under *', () => {
  const { store } = loadStore()
  const snapshot = store.buildPendingReviewSnapshot([
    open('products', 'product', 7),
    open('products', 'product', 7),
    open('products', 'product', null),
    open('products', 'product', null),
    open('products', 'product', null),
    open('fees', 'fee', 7),
    open('branches', 'branch', 2),
    { section: 'products', entity_type: 'product', entity_id: 8, status: 'approved' },
    { section: 'products', entity_type: 'product', entity_id: 9, status: 'rejected' },
    { section: '', entity_type: 'product', entity_id: 10, status: 'open' },
    { entity_type: 'product', entity_id: 11 },
    { section: 'products', entity_id: 12, status: 'open' },
  ], 'account-1')
  assert.equal(snapshot.authority, 'account-1')
  assert.equal(snapshot.counts.get('products:product:7'), 2)
  assert.equal(store.pendingReviewCount(snapshot, 'products', 'product'), 3, 'three product creates are waiting')
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [7]), true)
  assert.equal(store.isPendingReview(snapshot, 'fees', 'fee', [7]), true)
  assert.equal(store.isPendingReview(snapshot, 'branches', 'branch', [2]), true)
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [8]), false, 'an approved request is not waiting')
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [9]), false, 'a rejected request is not waiting')
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [10, 11, 12]), false, 'a row without a section or entity type is ignored')
  assert.equal(store.isPendingReview(snapshot, 'fees', 'fee', [8]), false)
  assert.equal(store.pendingReviewCount(snapshot, 'fees', 'fee'), 0)
})

test('a merged display row is tagged when ANY of its record ids is waiting; a missing id never matches creates', () => {
  const { store } = loadStore()
  const snapshot = store.buildPendingReviewSnapshot([open('products', 'product', 31), open('products', 'product', null)])
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [30, 31, 32]), true)
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [30, 32]), false)
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [undefined, null]), false, 'a row with no id must not match the creates key')
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', []), false)
  assert.equal(store.isPendingReview(snapshot, 'products', 'product', [store.PENDING_REVIEW_NEW]), true, 'the creates slot is asked for explicitly')
})

test('only the review permission lists everyone; every other tier reads its own requests', () => {
  const { store } = loadStore()
  for (const tier of ['full', 'view']) assert.equal(store.pendingReviewScopeFor(tier), 'all')
  for (const tier of ['none', 'review', '', undefined, null, 'true', 'admin']) assert.equal(store.pendingReviewScopeFor(tier as string), 'mine')
})

test('500 rows on a page send exactly one request (and a revisit sends one more)', async () => {
  await scenarioFiveHundredRowsOneRequest()
  const loaded = loadStore()
  reset()
  const first = await visitPage(loaded, { rows: 500, reviewTier: 'full' })
  assert.equal(sent.length, 1)
  first.loader.unmount()
  const revisit = await visitPage(loaded, { rows: 500, reviewTier: 'full' })
  assert.equal(sent.length, 2, 'a new page visit reads once more, however many rows it draws')
  assert.ok(revisit.rows.length === 500)
})

test('React StrictMode double-running the visit effect still sends one request', async () => {
  await scenarioStrictModeStillOneRequest()
})

test('a requester never calls GET /api/review; a reviewer reads everyone, everyone else reads their own', async () => {
  await scenarioRequesterNeverReadsTheReviewerList()
})

test('the page reads again when the review queue announces a change, and not for anything else', async () => {
  const loaded = loadStore()
  const { store, react } = loaded
  reset()
  const props = { active: true, reviewTier: 'full' as string, syncChannel: 'products' as string | null, syncTs: 100 as number | null }
  const loader = react.mount(() => store.usePendingReviewTargetsLoader(props))
  await settle()
  assert.equal(sent.length, 1, 'the visit read')

  // The announcement that was already on screen when the page mounted was answered by the visit read.
  props.syncChannel = 'pendingActions'
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 1, 'a pendingActions announcement older than the visit is not a change')

  props.syncTs = 101
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 2, 'a newer pendingActions announcement reads once')

  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 2, 'the same announcement never reads twice')

  props.syncChannel = 'products'
  props.syncTs = 102
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 2, 'other channels do not touch the tags')

  props.syncChannel = 'pendingActions'
  props.syncTs = 103
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 3)
})

test('a page that is not active does not read, and reads once when it becomes active', async () => {
  const { store, react } = loadStore()
  reset()
  const props = { active: false, reviewTier: 'full' as string, syncChannel: 'pendingActions' as string | null, syncTs: 5 as number | null }
  const loader = react.mount(() => store.usePendingReviewTargetsLoader(props))
  await settle()
  props.syncTs = 6
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 0, 'a hidden page stays quiet, announcements included')
  props.active = true
  react.rerender(loader)
  await settle()
  assert.equal(sent.length, 1, 'becoming active is the visit; the announcement it missed is covered by that read')
})

test('after the user\'s own queued write the list is re-read, even when a read is already on the wire', async () => {
  await scenarioRereadAfterOwnQueuedWrite()
})

test('a row re-renders only when its own answer flips', async () => {
  const { store, react } = loadStore()
  reset()
  nextRows = []
  const rows = Array.from({ length: 500 }, (_, index) => react.mount(() => store.useIsPendingReview('products', 'product', [index + 1])))
  await store.refreshPendingReviewTargets('mine')
  const before = rows.map((row) => row.renders)
  nextRows = [open('products', 'product', 17)]
  await store.refreshPendingReviewTargets('mine')
  const rerendered = rows.filter((row, index) => row.renders !== before[index])
  assert.equal(rerendered.length, 1, `only the row whose request arrived re-renders, saw ${rerendered.length}`)
  assert.equal(rerendered[0], rows[16])
  // The same list again changes nothing for anyone.
  const mid = rows.map((row) => row.renders)
  await store.refreshPendingReviewTargets('mine')
  assert.ok(rows.every((row, index) => row.renders === mid[index]), 'an identical list re-renders no row')
})

test('a failed read keeps the last list and raises nothing', async () => {
  const { store } = loadStore()
  reset()
  nextRows = [open('branches', 'branch', 3)]
  await store.refreshPendingReviewTargets('mine')
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'branches', 'branch', [3]), true)
  answers.push(async () => jsonResponse([], 500))
  await store.refreshPendingReviewTargets('mine')
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'branches', 'branch', [3]), true, 'a failed read does not erase tags that are still true')
  // A body without a list is a failed read too, not "nothing is pending".
  answers.push(async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await store.refreshPendingReviewTargets('mine')
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'branches', 'branch', [3]), true)
})

test('another account never inherits the list, and an answer for the old account is dropped', async () => {
  const { store } = loadStore()
  reset()
  nextRows = [open('products', 'product', 5)]
  await store.refreshPendingReviewTargets('mine')
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [5]), true)

  // Account 2 signs in: its tags start empty while its own read is on the wire.
  authority = 'account-2'
  let release!: () => void
  answers.push(() => new Promise((resolve) => { release = () => resolve(jsonResponse([open('products', 'product', 6)])) }))
  const reading = store.refreshPendingReviewTargets('mine')
  await settle()
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [5]), false, 'account 1\'s tag is gone for account 2')
  release()
  await reading
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [6]), true)

  // The account changes AGAIN while a read is on the wire: that answer belongs to nobody now.
  answers.push(() => new Promise((resolve) => { release = () => resolve(jsonResponse([open('products', 'product', 99)])) }))
  const late = store.refreshPendingReviewTargets('mine')
  await settle()
  authority = 'account-3'
  release()
  await late
  assert.equal(store.isPendingReview(store.getPendingReviewSnapshot(), 'products', 'product', [99]), false, 'a stale answer is not published')
})

test("an account that signs in while another account's read is on the wire starts its own read and never shows the old tags", async () => {
  await scenarioAccountSwitchWithReadInFlight()
})

test('a scope change while a read is on the wire reads the new scope, and the old read cannot overwrite it', async () => {
  await scenarioScopeChangeWithReadInFlight()
})

test('one announcement is one re-read however many pages are mounted', async () => {
  await scenarioOneAnnouncementOneRead()
})

test('the transport keeps no cached copy of the review list', async () => {
  await scenarioNoPayloadsRetained()
})

// fields=targets sends just the columns the tags use; a Worker that refuses it is asked again for the whole list.
async function scenarioSlimReadWithFallback(transport: typeof realTransport = realTransport): Promise<void> {
  reset()
  nextRows = [open('products', 'product', 5)]
  const slim = await transport.getOpenPendingReviewRows('all')
  assert.deepEqual(sent, ['GET /api/review?status=open&fields=targets'], 'the slim projection is asked for first')
  assert.equal(slim.length, 1)
  reset()
  nextRows = [open('products', 'product', 6)]
  answers.push(async () => new Response(JSON.stringify({ success: false, code: 'invalid_fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  const rows = await transport.getOpenPendingReviewRows('mine')
  assert.deepEqual(sent, ['GET /api/review/mine?status=open&fields=targets', 'GET /api/review/mine?status=open'], 'a refused projection falls back to the whole list')
  assert.equal(rows[0].entity_id, 6, 'and its rows are used')
}

test('the transport asks for the slim projection and falls back to the whole list when it is refused', async () => {
  await scenarioSlimReadWithFallback()
})

test('MUTANT no fallback: a Worker that refuses fields=targets leaves the tags unread', async () => {
  const code = transportSource.replace("    if ((error as { status?: number } | null)?.status !== 400) throw error\n    response = await readRows(scope, channel, false)\n", '    throw error\n')
  assert.notEqual(code, transportSource, 'negative control anchor must match the live transport')
  await assert.rejects(scenarioSlimReadWithFallback(loadTransport(code)))
})

// ---- negative controls: the same source with one rule removed must fail its scenario ----

function mutant(from: string | RegExp, to: string): string {
  const matches = typeof from === 'string' ? storeSource.split(from).length - 1 : (storeSource.match(from) || []).length
  assert.equal(matches, 1, `negative control anchor ${String(from)} must match the live source exactly once, matched ${matches}`)
  const code = storeSource.replace(from, to)
  assert.notEqual(code, storeSource)
  return code
}

test('MUTANT one request per row: a reader that fetches its own copy fails the 500-row scenario', async () => {
  const code = mutant(
    '  listeners.add(listener)\n  return () => { listeners.delete(listener) }',
    '  void getOpenPendingReviewRows(scope)\n  listeners.add(listener)\n  return () => { listeners.delete(listener) }',
  )
  await assert.rejects(scenarioFiveHundredRowsOneRequest(loadStore(code)), /500 rows must share one request/)
})

test('MUTANT no read sharing: callers that do not share an in-flight read fail the StrictMode scenario', async () => {
  const code = mutant('  if (reading?.key === key) {', '  if (false as boolean) {')
  await assert.rejects(scenarioStrictModeStillOneRequest(loadStore(code)), /ONE read/)
})

test('MUTANT requester reads the reviewer list: every tier asking for "all" fails the requester scenario', async () => {
  const code = mutant("return reviewTier === 'full' || reviewTier === 'view' ? 'all' : 'mine'", "return 'all'")
  await assert.rejects(scenarioRequesterNeverReadsTheReviewerList(loadStore(code)), /reads only its own requests|must not call it/)
})

test('MUTANT no re-read after a queued write: the new request\'s tag would be missing', async () => {
  const code = mutant('    if (options.afterChange) reading.again = true\n', '')
  await assert.rejects(scenarioRereadAfterOwnQueuedWrite(loadStore(code)), /one more read/)
})

test("MUTANT joins any read on the wire: a new account borrows the old account's read and keeps its tags", async () => {
  const code = mutant('  if (reading?.key === key) {', '  if (reading) {')
  await assert.rejects(scenarioAccountSwitchWithReadInFlight(loadStore(code)), /asks for its own list/)
})

test('MUTANT the read key ignores the scope: the reviewer list is answered by the requester read', async () => {
  const code = mutant('const key = `${actor.authority}|${scope}`', 'const key = actor.authority')
  await assert.rejects(scenarioScopeChangeWithReadInFlight(loadStore(code)), /reviewer list is read/)
})

test("MUTANT a superseded read publishes: the old scope's late answer overwrites the new list", async () => {
  const code = mutant('if (reading === run && isActorReadScopeCurrent(actor, false))', 'if (isActorReadScopeCurrent(actor, false))')
  await assert.rejects(scenarioScopeChangeWithReadInFlight(loadStore(code)), /does not overwrite/)
})

test("MUTANT the previous account's tags stay until the new answer lands", async () => {
  const code = mutant('  if (snapshot.authority !== actor.authority) publish({ authority: actor.authority, counts: new Map() })\n', '')
  await assert.rejects(scenarioAccountSwitchWithReadInFlight(loadStore(code)), /gone for account 2 while/)
})

test('MUTANT announcements are not coalesced: every page that hears one forces its own re-read', async () => {
  const code = mutant('    if (lastChange?.id === options.changeId && lastChange.key === key) return reading?.key === key ? reading.promise : Promise.resolve()\n', '')
  await assert.rejects(scenarioOneAnnouncementOneRead(loadStore(code)), /is ONE read/)
})

test('MUTANT the transport leaves the answer in the read cache', async () => {
  const code = transportSource.replace('  cacheSet(channel, null)\n', '')
  assert.notEqual(code, transportSource, 'negative control anchor must match the live transport')
  await assert.rejects(scenarioNoPayloadsRetained(loadTransport(code)), /payloads are not retained/)
})

test('the controls above really exercise the live source (each anchor exists once, the live scenarios pass)', async () => {
  await scenarioFiveHundredRowsOneRequest()
  await scenarioStrictModeStillOneRequest()
  await scenarioRequesterNeverReadsTheReviewerList()
  await scenarioRereadAfterOwnQueuedWrite()
  await scenarioAccountSwitchWithReadInFlight()
  await scenarioScopeChangeWithReadInFlight()
  await scenarioOneAnnouncementOneRead()
  await scenarioNoPayloadsRetained()
  await scenarioNoPayloadsRetained(loadTransport())
})

test.after(() => {
  globalThis.fetch = realFetch
  setSyncServerUrl('')
  __resetApiWriteDedupeForTests()
  void require
})
