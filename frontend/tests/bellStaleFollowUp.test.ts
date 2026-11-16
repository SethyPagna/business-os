// S1 r2, F3 (owner 11 Nov: the bell is at most 5 minutes old, with an "as of" time). A sync-triggered reload can be answered by the Worker's cached entry, computed BEFORE the write
// that triggered it, and the next timed refresh used to be two hours away. NotificationCenter now reads once more as that entry expires (planBellStaleFollowUp).
// This runs the bell's REAL sync effect, scheduleRefresh and loadSummary (extracted from the component source) against a fake clock and a fake Worker that serves a cached entry for
// 300 s and counts its recomputes (the reads). Mutants: no follow-up refresh, the sync event never recorded, the follow-up planned from the wrong side.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { beginTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import { FOREGROUND_RESUME_REASON } from '../src/utils/permissionRefreshAccumulator.ts'
import * as syncRuntime from '../src/api/syncRuntime.ts'

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const BELL_SOURCE = read('../src/components/shared/NotificationCenter.tsx')

function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number; fn: () => unknown }>()
  return {
    now: () => now,
    setTimeout: (fn: () => unknown, delayMs = 0) => { timers.set(++nextId, { at: now + delayMs, fn }); return nextId },
    clearTimeout: (id: number) => { timers.delete(id) },
    pending: () => timers.size,
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

const START = Date.UTC(2026, 10, 16, 8, 0, 0)
const SERVER_TTL_MS = 300_000

function parts(source: string) {
  const tree = ts.createSourceFile('NotificationCenter.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = (name: string): string => {
    let found = ''
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) found = node.initializer.getText(tree)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    assert.ok(found, `declaration ${name}`)
    return found
  }
  let syncEffect = ''
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('syncChannel.reason === FOREGROUND_RESUME_REASON')) syncEffect = node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(syncEffect, 'bell sync effect')
  const constants: Record<string, unknown> = {}
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      const name = decl.name.getText(tree)
      if (/^NOTIFICATION_(SYNC|IMMEDIATE|SUMMARY)/.test(name) && decl.initializer) constants[name] = new Function(`return (${ts.transpileModule(decl.initializer.getText(tree), {}).outputText.trim().replace(/;$/, '')})`)()
    }
  }
  return { declaration, syncEffect, constants }
}
const js = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, '')

// One bell on a fake clock against a fake Worker. `truth` is the real unread count; the Worker serves an entry for 300 s, then recomputes (a recompute = one read).
function bell(options: { source?: string; planOverride?: unknown } = {}) {
  const clock = fakeClock()
  const { declaration, syncEffect, constants } = parts(options.source ?? BELL_SOURCE)
  const server = { truth: 3, entry: null as null | { at: number; count: number }, computes: 0, requests: 0 }
  const shown = { count: -1, generatedAt: '' }
  const getSummary = async () => {
    server.requests++
    if (!server.entry || clock.now() - server.entry.at >= SERVER_TTL_MS) { server.computes++; server.entry = { at: clock.now(), count: server.truth } }
    return { unreadCount: server.entry.count, sections: [], generatedAt: new Date(START + server.entry.at).toISOString(), preferences: {} }
  }
  const ref = <T,>(value: T) => ({ current: value })
  const env: Record<string, unknown> = {
    ...constants,
    useCallback: (fn: unknown) => fn,
    window: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    document: { visibilityState: 'visible' },
    Date: { now: () => START + clock.now(), parse: Date.parse },
    console,
    aliveRef: ref(true), refreshTimerRef: ref<number | null>(null), refreshDueWhileHiddenRef: ref(false),
    lastSummaryLoadAtRef: ref(0), lastBellSyncEventAtRef: ref(0), bellFollowUpRef: ref({ generatedAtMs: 0, fired: 0 }),
    requestRef: ref(0), visibleLoadRequestRef: ref(0), failureCountRef: ref(0), expandedSectionsRef: ref(new Set<string>()), loadMoreItemsRef: ref(async () => {}),
    beginTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout: (fn: () => unknown) => fn(), getErrorMessage: (e: Error) => e?.message,
    getNotificationSummaryRequest: getSummary,
    setLoading() {}, setFullSectionItems() {}, setFullSectionGeneratedAt() {},
    setSummary: (next: unknown) => { const v = typeof next === 'function' ? (next as (c: unknown) => { unreadCount: number; generatedAt?: string })(shown) : (next as { unreadCount: number; generatedAt?: string }); shown.count = v.unreadCount; shown.generatedAt = v.generatedAt ?? '' },
    planThrottledSyncReload: syncRuntime.planThrottledSyncReload,
    planBellStaleFollowUp: options.planOverride ?? syncRuntime.planBellStaleFollowUp,
    FOREGROUND_RESUME_REASON, visibilityActive: true, syncChannel: null as unknown,
  }
  const factory = (code: string) => new Function('env', `with(env){return (${code})}`)(env)
  env.scheduleRefresh = factory(js(declaration('scheduleRefresh')))
  env.loadSummary = factory(js(declaration('loadSummary')))
  const effect = factory(js(`(${syncEffect.replace(/^useEffect\(/, '').replace(/,\s*\[[^\]]*\]\)$/, '')})`)) as () => void
  return {
    clock, server, shown, env,
    load: () => (env.loadSummary as (silent?: boolean) => Promise<void>)(true),
    // A write from another device: the truth changes, the Worker has not recomputed, and a sync event reaches this tab.
    async remoteWrite(channel = 'inventory') {
      server.truth += 1
      env.syncChannel = { channel, ts: clock.now(), reason: null }
      effect()
      await clock.advance(0)
    },
    ageOfBadgeMs: () => (START + clock.now()) - Date.parse(shown.generatedAt),
  }
}

// The two scenarios the follow-up is judged by. Each throws when the behaviour is wrong, so a mutant must make them throw.
async function staleScenario(b: ReturnType<typeof bell>) {
  await b.load() // t=0: computes, shows 3
  assert.equal(b.shown.count, 3)
  await b.clock.advance(100_000)
  await b.remoteWrite() // t=100 s: the write; the reload runs now (>30 s since the last) and is served the t=0 entry
  assert.equal(b.shown.count, 3, 'the reload was served the older entry: the badge still shows the pre-write count')
  assert.equal(b.server.computes, 1)
  await b.clock.advance(200_000) // t=300 s
  assert.equal(b.shown.count, 3, 'not before the entry has expired')
  await b.clock.advance(10_000) // t=310 s: the follow-up is due at the entry time + 300 s + 10 s
  assert.equal(b.shown.count, 4, 'the follow-up shows the write by 310 s (entry time + bound + margin)')
  assert.equal(b.server.computes, 2, 'exactly one recompute for the window')
  assert.ok(b.ageOfBadgeMs() <= 1_000, 'and the badge is fresh again')
  const requests = b.server.requests
  await b.clock.advance(60 * 60_000)
  assert.equal(b.server.requests, requests, 'nothing more is read for the next hour: the idle timer is back')
  assert.equal(b.server.computes, 2)
}
async function freshScenario(b: ReturnType<typeof bell>) {
  await b.load()
  await b.clock.advance(400_000) // the t=0 entry is long expired
  await b.remoteWrite() // the reload recomputes (entry expired): it already reflects the write
  assert.equal(b.shown.count, 4)
  assert.equal(b.server.computes, 2)
  const requests = b.server.requests
  await b.clock.advance(60 * 60_000)
  assert.equal(b.server.requests, requests, 'no follow-up read when the answer already reflects the write')
}
const { planBellStaleFollowUp } = syncRuntime

await test('a sync reload served an entry older than the write is followed by one read as that entry expires', () => staleScenario(bell()))
await test('a reload answered by an entry computed after the write needs no follow-up; no extra read', () => freshScenario(bell()))

await test('a burst of writes inside one entry lifetime costs one follow-up read, not one per event', async () => {
  const b = bell()
  await b.load()
  for (let i = 0; i < 8; i++) { await b.clock.advance(20_000); await b.remoteWrite('sales') }
  const requestsAfterBurst = b.server.requests
  const computesAfterBurst = b.server.computes
  assert.equal(computesAfterBurst, 1, 'every reload in the burst was served the cached entry')
  await b.clock.advance(5 * 60_000)
  assert.equal(b.server.computes, 2, 'one recompute at the expiry, however many events came')
  assert.ok(b.server.requests - requestsAfterBurst <= 2, `the burst adds at most the follow-up (and one throttled trailing reload): ${b.server.requests - requestsAfterBurst}`)
  assert.equal(b.shown.count, b.server.truth, 'the badge shows the latest count')
})

await test('a quiet bell (no event) schedules no follow-up: the idle timer alone', async () => {
  const b = bell()
  await b.load()
  assert.equal(b.clock.pending(), 1, 'only the idle timer')
  await b.clock.advance(90 * 60_000)
  assert.equal(b.server.requests, 1, 'no read until the idle refresh')
})

await test('a client clock far ahead of the Worker: the follow-up comes back with the same entry, is retried once, then stops', async () => {
  const b = bell()
  await b.load()
  await b.clock.advance(100_000)
  // The Worker's clock runs 120 s behind the client's: the entry is "younger" there than here.
  let skewedNow = () => b.clock.now() - 120_000
  b.env.getNotificationSummaryRequest = async () => {
    b.server.requests++
    if (!b.server.entry || skewedNow() - b.server.entry.at >= SERVER_TTL_MS) { b.server.computes++; b.server.entry = { at: skewedNow(), count: b.server.truth } }
    return { unreadCount: b.server.entry.count, sections: [], generatedAt: new Date(START + b.server.entry.at).toISOString(), preferences: {} }
  }
  b.server.entry = { at: skewedNow() - 100_000, count: 3 }
  await b.remoteWrite()
  const before = b.server.requests
  await b.clock.advance(30 * 60_000)
  assert.ok(b.server.requests - before <= 3, `bounded retries under skew: ${b.server.requests - before}`)
  skewedNow = () => 0
})

await test('mutants: each wrong planner or wiring turns a scenario red', async () => {
  const mutants: Array<[string, () => ReturnType<typeof bell>, 'stale' | 'fresh']> = [
    ['no follow-up refresh', () => bell({ planOverride: () => null }), 'stale'],
    ['the sync event is never recorded', () => { const m = BELL_SOURCE.replace('      lastBellSyncEventAtRef.current = Date.now()\n', ''); assert.notEqual(m, BELL_SOURCE); return bell({ source: m }) }, 'stale'],
    ['planned from the reload time, not the entry time', () => bell({ planOverride: (a: { generatedAtMs: number; lastEventAtMs: number }) => (a.generatedAtMs < a.lastEventAtMs ? SERVER_TTL_MS + syncRuntime.BELL_FOLLOW_UP_MARGIN_MS : null) }), 'stale'],
    ['planned a minute after the margin', () => bell({ planOverride: (a: { generatedAtMs: number; lastEventAtMs: number; nowMs: number }) => (a.generatedAtMs < a.lastEventAtMs ? a.generatedAtMs + SERVER_TTL_MS + 70_000 - a.nowMs : null) }), 'stale'],
    ['a follow-up even when the answer already reflects the write', () => bell({ planOverride: (a: { generatedAtMs: number; nowMs: number }) => Math.max(a.generatedAtMs + SERVER_TTL_MS + 10_000 - a.nowMs, 1_000) }), 'fresh'],
  ]
  for (const [name, make, scenario] of mutants) {
    await assert.rejects(() => (scenario === 'stale' ? staleScenario(make()) : freshScenario(make())), `mutant "${name}" survived`)
  }
  assert.match(BELL_SOURCE, /scheduleRefresh\(followUpDelay, generatedAtMs\)/, 'the real code schedules the follow-up')
})

await test('planBellStaleFollowUp: table', () => {
  const plan = syncRuntime.planBellStaleFollowUp
  const T = START
  assert.equal(plan({ generatedAtMs: T, lastEventAtMs: 0, nowMs: T + 50_000, followUpsFired: 0 }), null, 'no event, no follow-up')
  assert.equal(plan({ generatedAtMs: T + 50_000, lastEventAtMs: T + 50_000, nowMs: T + 50_000, followUpsFired: 0 }), null, 'entry computed at the event: not stale')
  assert.equal(plan({ generatedAtMs: T + 60_000, lastEventAtMs: T + 50_000, nowMs: T + 61_000, followUpsFired: 0 }), null, 'entry newer than the event')
  assert.equal(plan({ generatedAtMs: T, lastEventAtMs: T + 1, nowMs: T + 1, followUpsFired: 0 }), 309_999, 'stale by 1 ms: due at expiry + margin')
  assert.equal(plan({ generatedAtMs: T, lastEventAtMs: T + 400_000, nowMs: T + 400_000, followUpsFired: 0 }), 1_000, 'already past expiry: read at once (1 s floor)')
  assert.equal(plan({ generatedAtMs: T, lastEventAtMs: T + 400_000, nowMs: T + 400_000, followUpsFired: 1 }), 30_000, 'a retry waits at least 30 s')
  assert.equal(plan({ generatedAtMs: T, lastEventAtMs: T + 400_000, nowMs: T + 400_000, followUpsFired: 2 }), null, 'two follow-ups per entry at most')
  assert.equal(plan({ generatedAtMs: Number.NaN, lastEventAtMs: T, nowMs: T, followUpsFired: 0 }), null, 'an unreadable generatedAt plans nothing')
})

await test('own-sale rule is untouched: a sale write still arms no fresh bell read', async () => {
  const { bellRelevantInvalidations } = await import('../src/api/bellFreshness.ts')
  assert.equal(bellRelevantInvalidations(['inventory', 'sales'], '/api/sales'), false)
  assert.equal(bellRelevantInvalidations(['inventory'], '/api/inventory/adjust'), true)
})

if (failed) { console.error(`bellStaleFollowUp.test.ts: ${failed} failed`); process.exit(1) }
console.log('bellStaleFollowUp.test.ts: ok')
