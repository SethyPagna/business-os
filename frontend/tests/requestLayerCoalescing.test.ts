// Lane 6.0.879: request counts for the shared request layer. Each block runs the production code
// (AppContext's sync handler, the bell's sync effect, Dashboard's loaders, http.ts route()) against
// a fake clock and a counting fetch, and asserts how many reads one burst costs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {
  createPermissionRefreshAccumulator,
  beginPermissionRefresh,
  escalatePermissionRefresh,
  finishPermissionRefresh,
  FOREGROUND_RESUME_REASON,
  notePermissionRefreshIntent,
  permissionSnapshotKey,
} from '../src/utils/permissionRefreshAccumulator.ts'
import { isOwnSettingsWrite } from '../src/utils/settingsSave.ts'
import { beginTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import * as syncRuntime from '../src/api/syncRuntime.ts'

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// A fake clock whose timers run in time order when advanced.
function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number; fn: () => unknown }>()
  return {
    now: () => now,
    setTimeout: (fn: () => unknown, delayMs = 0) => { timers.set(++nextId, { at: now + delayMs, fn }); return nextId },
    clearTimeout: (id: number) => { timers.delete(id) },
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); now = due[1].at
        await due[1].fn()
      }
      now = end
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Finding 5: AppContext's real sync:update handler, extracted the way
// permissionRefreshAccumulator.test.ts does. One setSyncChannel = one refresh on every page that
// listens for that channel, so publishes are the per-page request count.
const appContext = read('../src/AppContext.tsx')
function appContextSyncHandler(clock: ReturnType<typeof fakeClock>) {
  const syncSection = appContext.indexOf('  // Sync event listeners')
  const start = appContext.indexOf('    let disposed = false', syncSection)
  const end = appContext.indexOf('    const onStatus = (e: Event) => {', start)
  assert.ok(start >= 0 && end > start, 'AppContext handler extraction boundaries changed')
  const code = ts.transpileModule(`${appContext.slice(start, end)}\nglobalThis.onUpdate = onUpdate;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const published: Array<{ channel: string; at: number }> = []
  const context: Record<string, unknown> = {
    ...syncRuntime,
    eventDetail: (event: { detail: unknown }) => event.detail,
    debounceRef: { current: {} }, // the base handler's own timer map
    permissionRefreshRef: { current: createPermissionRefreshAccumulator() },
    permissionRefreshTimerRef: { current: null },
    schedulePermissionRefreshRef: { current: () => {} },
    beginPermissionRefresh, escalatePermissionRefresh, finishPermissionRefresh, FOREGROUND_RESUME_REASON,
    isOwnSettingsWrite, notePermissionRefreshIntent, permissionSnapshotKey,
    clearTimeout: clock.clearTimeout,
    window: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    SYNC: { EVENT_DEBOUNCE_MS: 150 },
    user: { id: 'me', role_id: 'cashier' },
    loadSettings: async () => {},
    setSyncChannel: (value: { channel: string }) => { published.push({ channel: value.channel, at: clock.now() }) },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  const onUpdate = (context as { onUpdate: (event: { detail: unknown }) => void }).onUpdate
  return { published, fire: (detail: Record<string, unknown>) => onUpdate({ detail }) }
}
// What websocket.ts dispatches for a push, and what this device's own write dispatches.
const remote = (channel: string) => ({ channel, payload: { action: 'create', id: 1 } })
const own = (channel: string) => ({ channel })

await test('own write refreshes its own views at once (150 ms debounce, not the remote window)', async () => {
  const clock = fakeClock()
  const handler = appContextSyncHandler(clock)
  handler.fire(own('sales'))
  await clock.advance(150)
  assert.deepEqual(handler.published, [{ channel: 'sales', at: 150 }])
})

await test('remote burst of 5 sales pushes -> 1 refresh per page (was 5)', async () => {
  const clock = fakeClock()
  const handler = appContextSyncHandler(clock)
  for (let i = 0; i < 5; i++) { handler.fire(remote('sales')); await clock.advance(250) }
  await clock.advance(2_000)
  assert.equal(handler.published.length, 1, JSON.stringify(handler.published))
  assert.equal(handler.published[0].at, 1_500, 'one publish, 1.5 s after the first push of the burst')
})

await test('an own write during a pending remote wait publishes once, at once', async () => {
  const clock = fakeClock()
  const handler = appContextSyncHandler(clock)
  handler.fire(remote('inventory'))
  await clock.advance(300)
  handler.fire(own('inventory'))
  await clock.advance(3_000)
  assert.deepEqual(handler.published, [{ channel: 'inventory', at: 450 }])
})

await test('a steady remote stream still refreshes (no starvation), one per window', async () => {
  const clock = fakeClock()
  const handler = appContextSyncHandler(clock)
  for (let i = 0; i < 20; i++) { handler.fire(remote('returns')); await clock.advance(300) }
  await clock.advance(2_000)
  assert.equal(handler.published.length, 4, JSON.stringify(handler.published))
})

await test('remote pushes on other channels keep the 150 ms debounce; channels coalesce independently', async () => {
  const clock = fakeClock()
  const handler = appContextSyncHandler(clock)
  handler.fire(remote('products'))
  handler.fire(remote('sales'))
  handler.fire(remote('inventory'))
  await clock.advance(2_000)
  assert.deepEqual(handler.published, [{ channel: 'products', at: 150 }, { channel: 'sales', at: 1_500 }, { channel: 'inventory', at: 1_500 }])
})

await test('remote vs local is told apart by websocket.ts payload key, and no local dispatch carries one', () => {
  assert.equal(syncRuntime.isRemoteSyncUpdate({ channel: 'sales', payload: null }), true)
  assert.equal(syncRuntime.isRemoteSyncUpdate({ channel: 'sales', reason: 'x', ts: 1 }), false)
  const websocket = read('../src/api/websocket.ts')
  assert.match(websocket, /new CustomEvent\('sync:update', \{ detail: \{ channel: data\.channel, payload: data\.payload \?\? null \} \}\)/)
  const srcRoot = new URL('../src/', import.meta.url)
  const offenders: string[] = []
  const walk = (dir: URL) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) { walk(url); continue }
      if (!/\.(ts|tsx)$/.test(entry.name) || url.pathname.endsWith('/api/websocket.ts')) continue
      const text = fs.readFileSync(url, 'utf8')
      for (const match of text.matchAll(/new CustomEvent\('sync:update'|dispatchSyncUpdates\(|refreshAppData\(/g)) {
        const call = text.slice(match.index, match.index! + 240).split(/\)\)|\n\s*\}\)\)/)[0]
        if (/\bpayload\s*:/.test(call)) offenders.push(`${url.pathname.split('/src/')[1]}@${match.index}`)
      }
    }
  }
  walk(srcRoot)
  assert.deepEqual(offenders, [], 'a local sync:update with a payload key would be delayed as if it came from another device')
})

// ---------------------------------------------------------------------------------------------
// Finding 5 (bell): the bell no longer reacts to sales pushes at all. One shared store reads the summary at most once a
// minute while visible and at once only for a 'notifications' push; its behaviour is executed in notificationSummaryStore.test.ts.
const bellSource = read('../src/components/shared/NotificationCenter.tsx')
const bellStoreSource = read('../src/utils/notificationSummaryStore.ts')
await test('bell: sales pushes do not reload the summary; the shared store polls once per 60 s and reads a notifications push at once', () => {
  assert.ok(!/\bsyncChannel\b|\buseSync\b/.test(bellSource), 'the bell does not watch the lossy single-slot channel')
  assert.ok(bellStoreSource.includes("subscribeSyncSignals(['notifications'],"), 'only a notifications push is listened to')
  assert.ok(!/'sales'|'inventory'/.test(bellStoreSource.slice(bellStoreSource.indexOf('export const notificationSummaryStore'))), 'no sale or stock push reads the summary')
  assert.ok(bellStoreSource.includes('NOTIFICATION_POLL_INTERVAL_MS = 60_000'), 'one read per minute while visible')
})

// ---------------------------------------------------------------------------------------------
// Finding 10: Dashboard's real loadSummary + loadAnalytics, through the real route() de-dup.
const httpModule = await import('../src/api/http.ts')
const queryModule = await import('../src/api/query.ts')
const dashboardFetches: string[] = []
const transportModule = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> }
new Function('require', 'module', 'exports', ts.transpileModule(read('../src/api/dashboardTransport.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(
  (name: string) => name.includes('query') ? queryModule : {
    route: httpModule.route,
    apiFetch: async (_method: string, url: string) => {
      dashboardFetches.push(url.split('?')[0])
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (url.startsWith('/api/dashboard/startup')) return { summary: { half: 'summary' }, analytics: { half: 'analytics' } }
      if (url.startsWith('/api/analytics')) return { half: 'analytics' }
      return { half: 'summary' }
    },
  }, transportModule, transportModule.exports)
await test('Dashboard refresh: the one startup read is shared while in flight and re-read after a sale', async () => {
  httpModule.setSyncServerUrl('https://sync.example.test')
  httpModule.cacheClearAll()
  dashboardFetches.length = 0
  const range = { startDate: '2026-10-20', endDate: '2026-10-20', granularity: 'day' }
  const startup = transportModule.exports.getDashboardStartup
  // A sync refresh and the Retry button asking in the same moment make one request, and both get both halves.
  const [first, second] = await Promise.all([startup(range), startup(range)])
  assert.deepEqual(dashboardFetches, ['/api/dashboard/startup'])
  assert.deepEqual(first, { summary: { half: 'summary' }, analytics: { half: 'analytics' } })
  assert.deepEqual(second, first)
  // A sale invalidates the derived dashboard read; the next refresh is again one read.
  httpModule.cacheInvalidateWithDerived('sales')
  await startup(range)
  assert.equal(dashboardFetches.length, 2)
  const dashboardSource = read('../src/components/dashboard/Dashboard.tsx')
  assert.equal((dashboardSource.match(/getDashboardStartup\(/g) || []).length, 1, 'the page has one call site for the startup read')
  httpModule.cacheClearAll()
  httpModule.setSyncServerUrl('')
})

await test('the Worker builds /dashboard/startup from the same two calls /dashboard and /analytics answer with', () => {
  const compat = read('../../cloudflare/src/routes/compat.ts')
  const handler = (path: string) => compat.slice(compat.indexOf(`app.get('${path}', async (c) => {`), compat.indexOf('\n})', compat.indexOf(`app.get('${path}', async (c) => {`)))
  assert.match(handler('/dashboard'), /dashboardSummary\(c\.env, c\.req\.query\(\), dashboardOverviewContext\(c\)\)/)
  assert.match(handler('/analytics'), /dashboardAnalytics\(c\.env, c\.req\.query\(\), c\.get\('user'\), dashboardOverviewContext\(c\)\)/)
  const startup = handler('/dashboard/startup')
  assert.match(startup, /dashboardSummary\(c\.env, c\.req\.query\(\), dashboardOverviewContext\(c\)\)/)
  assert.match(startup, /dashboardAnalytics\(c\.env, c\.req\.query\(\), c\.get\('user'\), dashboardOverviewContext\(c\)\)/)
  assert.match(startup, /return c\.json\(\{ summary, analytics \}\)/)
  for (const path of ['/dashboard', '/analytics', '/dashboard/startup']) assert.match(handler(path), /denyUnless\(c, 'dashboard'\)[\s\S]*dashboardRangeError/)
  assert.match(compat, /app\.use\('\/dashboard\/\*', acquisitionCostResponses\)/, 'the same cost projection covers /dashboard/startup')
})

// ---------------------------------------------------------------------------------------------
// Finding 11: per-channel TTL for stable lookups, only while the sync socket is open.
function storage(): Storage {
  const values = new Map<string, string>()
  return { get length() { return values.size }, clear: () => values.clear(), key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, String(v)) }, removeItem: (k: string) => { values.delete(k) } }
}
await test('lookup TTL: cached with the socket open, refetched when closed, after reopen and after sync:update', async () => {
  const target = new EventTarget()
  const fakeWindow = Object.assign(target, { localStorage: storage(), sessionStorage: storage(), setTimeout, clearTimeout })
  ;(fakeWindow.sessionStorage as Storage).setItem('businessos_user', JSON.stringify({ id: 7 }))
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalNow = Date.now
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis
  globalThis.document = { visibilityState: 'hidden' } as Document
  let now = originalNow()
  Date.now = () => now
  try {
    httpModule.__resetApiHealthForTests()
    httpModule.setSyncServerUrl('https://sync.example.test')
    httpModule.cacheClearAll()
    httpModule.ensureHealthLifecycleListeners()
    httpModule.ensureSyncUpdateCacheListener()
    const calls: Record<string, number> = {}
    const readKey = (key: string) => httpModule.route(key, async () => { calls[key] = (calls[key] || 0) + 1; return [key] })
    const socket = (connected: boolean) => window.dispatchEvent(new CustomEvent('sync:status', { detail: { connected } }))
    const push = (channel: string) => window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel, payload: null } }))

    socket(true)
    for (const key of ['branches:get', 'categories:get', 'units:get']) await readKey(key)
    now += 4 * 60_000
    for (const key of ['branches:get', 'categories:get', 'units:get']) await readKey(key)
    assert.deepEqual({ ...calls }, { 'branches:get': 1, 'categories:get': 1, 'units:get': 1 }, 'served from cache 4 min later with the socket open')

    push('categories')
    await readKey('categories:get')
    assert.equal(calls['categories:get'], 2, 'sync:update on the channel clears it at once')
    push('products')
    await readKey('categories:get'); await readKey('units:get')
    assert.equal(calls['categories:get'], 3, 'a product push clears categories (GET lists product values)')
    assert.equal(calls['units:get'], 2, 'and units')

    socket(false)
    now += 30_000
    await readKey('branches:get')
    assert.equal(calls['branches:get'], 2, 'socket closed: back to the 20 s TTL')
    now += 10_000
    await readKey('branches:get')
    assert.equal(calls['branches:get'], 2, 'still the normal 20 s cache while closed')
    socket(true)
    await readKey('branches:get')
    assert.equal(calls['branches:get'], 3, 'reopening drops entries read while a push could have been missed')

    // Permission, role, user, session and stock reads never get the long TTL.
    const shortKeys = ['roles:get', 'users:get', 'auth:bootstrap', 'session:current', 'branches:summary', 'branches:stock:1:']
    for (const key of shortKeys) await readKey(key)
    now += 25_000
    for (const key of shortKeys) await readKey(key)
    for (const key of shortKeys) assert.equal(calls[key], 2, `${key} refetched after 25 s with the socket open`)
  } finally {
    Date.now = originalNow
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    httpModule.cacheClearAll()
    httpModule.__resetApiHealthForTests()
    httpModule.setSyncServerUrl('')
  }
})

// ---------------------------------------------------------------------------------------------
// Finding 13: the sale money-precision capability is read once per actor/permission/session and
// shared by every surface (POS, each SaleDetailModal open); retry and a Worker redeploy read again.
await test('money capability: 1 read per actor session across surfaces (was 1 per open); retry/redeploy re-read; fresh probe untouched', async () => {
  const { transformSync } = await import('esbuild')
  let actor = 'A'
  const requests: Array<{ path: string; resolve: (value: unknown) => void }> = []
  const capabilityModule = { exports: {} as Record<string, any> }
  // A minimal React: one component instance per slot array; effects run after render.
  const hooks = { slots: [] as any[], cursor: 0, effects: [] as Array<() => void> }
  const react = {
    useRef(value: unknown) { const i = hooks.cursor++; return hooks.slots[i] ??= { current: value } },
    useState(value: unknown) { const i = hooks.cursor++; if (!(i in hooks.slots)) hooks.slots[i] = value; const slots = hooks.slots; return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useEffect(callback: any, deps: any[]) { const i = hooks.cursor++; const slots = hooks.slots; const old = slots[i]; if (!old || deps.some((x, j) => !Object.is(x, old.deps[j]))) hooks.effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: callback() } }) },
  }
  new Function('require', 'module', 'exports', transformSync(read('../src/components/sales/useSaleMoneyCapability.ts'), { loader: 'ts', format: 'cjs' }).code)(
    (name: string) => name === 'react' ? react : name.includes('actorReadScope') ? {
      captureActorReadScope: () => ({ authority: actor, revision: 1 }),
      isActorReadScopeCurrent: (scope: any) => scope.authority === actor,
    } : { apiFetch: (_method: string, path: string) => new Promise((resolve) => requests.push({ path, resolve })) },
    capabilityModule, capabilityModule.exports)
  const instance = () => ({ slots: [] as any[] })
  const render = (component: { slots: any[] }) => {
    hooks.slots = component.slots; hooks.cursor = 0
    const result = capabilityModule.exports.useSaleMoneyCapability(true, 'sales-full', false)
    hooks.effects.splice(0).forEach((run) => run())
    return result
  }
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
  const ready = { money_precision_version: 1, schema_ready: true }
  const originalWindow = globalThis.window
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  try {
    const pos = instance()
    render(pos); assert.equal(requests.length, 1)
    requests[0].resolve(ready); await flush()
    assert.equal(render(pos).ready, true)
    for (let open = 0; open < 3; open++) {
      const modal = instance()
      render(modal); await flush()
      assert.equal(render(modal).ready, true, 'a later surface is ready from the confirmed capability')
    }
    assert.equal(requests.length, 1, 'POS + 3 sale-detail opens = 1 capability read')

    const fresh = render(pos).assertFreshReady()
    assert.equal(requests.length, 2, 'the pre-write fresh probe still asks the server')
    requests[1].resolve(ready); await fresh

    actor = 'B'
    render(instance()); assert.equal(requests.length, 3, 'another actor reads its own')
    requests[2].resolve({ money_precision_version: 1, schema_ready: false }); await flush()
    render(instance()); assert.equal(requests.length, 4, 'a not-ready answer is never kept')
    requests[3].resolve(ready); await flush()
    const later = instance(); render(later); await flush()
    assert.equal(requests.length, 4)
    render(later).retry(); render(later)
    assert.equal(requests.length, 5, 'retry asks the server again')
    requests[4].resolve(ready); await flush()

    window.dispatchEvent(new Event('runtime:version-mismatch'))
    render(instance()); assert.equal(requests.length, 6, 'a Worker redeploy forgets confirmed capabilities')
    requests[5].resolve(ready); await flush()
  } finally {
    globalThis.window = originalWindow
  }
})

if (failed) {
  console.error(`${failed} request-layer test(s) failed`)
  process.exit(1)
}
console.log('request layer coalescing: ok')
