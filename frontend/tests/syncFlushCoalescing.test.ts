// Lane 6.0.1002 (perf-transport): a burst of sync:update events reaches a listening page as ONE sync:flush.
// Runs the real api/syncRuntime.ts collector on a fake clock, then the window wiring and subscribeSyncFlush.
import assert from 'node:assert/strict'
import {
  createSyncFlushCollector,
  dispatchSyncUpdates,
  FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS,
  SYNC_FLUSH_EVENT,
  subscribeSyncFlush,
  type SyncFlushDetail,
  type SyncFlushEvent,
} from '../src/api/syncRuntime.ts'

let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// A fake clock whose timers run in time order when advanced.
function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number; fn: () => unknown }>()
  return {
    now: () => now,
    setTimeout: (fn: () => unknown, delayMs = 0) => { timers.set(++nextId, { at: now + delayMs, fn }); return nextId },
    clearTimeout: (id: number) => { timers.delete(id) },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); now = due[1].at
        due[1].fn()
      }
      now = end
    },
  }
}

function collectorOnClock() {
  const clock = fakeClock()
  const flushes: Array<SyncFlushDetail & { at: number }> = []
  const collector = createSyncFlushCollector(clock, (detail) => flushes.push({ ...detail, at: clock.now() }))
  return { clock, flushes, note: (event: SyncFlushEvent) => collector.note(event) }
}
const own = (channel: string, extra: Partial<SyncFlushEvent> = {}): SyncFlushEvent => ({ channel, remote: false, ...extra })
const push = (channel: string): SyncFlushEvent => ({ channel, remote: true })

await test('the till dispatches inventory then sales for one sale: one flush carrying both', () => {
  const t = collectorOnClock()
  t.note(own('inventory', { source: 'pos-checkout' }))
  t.note(own('sales', { source: 'pos-checkout' }))
  t.clock.advance(1_000)
  assert.equal(t.flushes.length, 1, JSON.stringify(t.flushes))
  assert.deepEqual(t.flushes[0].channels, ['inventory', 'sales'])
  assert.equal(t.flushes[0].at, 250)
  assert.equal(t.flushes[0].remote, false)
  assert.equal(t.flushes[0].source, 'pos-checkout', 'a shared source survives so the till can skip its own echo')
})

await test('a mixed source publishes null, and a sub-channel is its first segment', () => {
  const t = collectorOnClock()
  t.note(own('dashboard:get:x', { source: 'a' }))
  t.note(own('sales', { source: 'b' }))
  t.clock.advance(300)
  assert.deepEqual(t.flushes[0].channels, ['dashboard', 'sales'])
  assert.equal(t.flushes[0].source, null)
})

await test('the pushes of one remote sale, 300 ms apart, are one flush at 1.5 s', () => {
  const t = collectorOnClock()
  t.note(push('sales'))
  t.clock.advance(300); t.note(push('inventory'))
  t.clock.advance(300); t.note(push('returns'))
  t.clock.advance(3_000)
  assert.equal(t.flushes.length, 1, JSON.stringify(t.flushes))
  assert.equal(t.flushes[0].at, 1_500)
  assert.deepEqual(t.flushes[0].channels, ['sales', 'inventory', 'returns'])
  assert.equal(t.flushes[0].remote, true)
})

await test('an own write during a remote wait pulls the flush in to 250 ms after it', () => {
  const t = collectorOnClock()
  t.note(push('sales'))
  t.clock.advance(700); t.note(own('inventory'))
  t.clock.advance(3_000)
  assert.deepEqual(t.flushes.map((f) => [f.at, f.remote]), [[950, false]])
})

await test('a steady remote stream still flushes once per 1.5 s window (no starvation)', () => {
  const t = collectorOnClock()
  for (let i = 0; i < 20; i++) { t.note(push('returns')); t.clock.advance(300) }
  t.clock.advance(2_000)
  assert.equal(t.flushes.length, 4, JSON.stringify(t.flushes.map((f) => f.at)))
})

await test('a steady stream of own writes flushes each 250 ms after a burst starts, never held back by newer events', () => {
  const t = collectorOnClock()
  for (let i = 0; i < 10; i++) { t.note(own('products')); t.clock.advance(100) }
  t.clock.advance(1_000)
  assert.deepEqual(t.flushes.map((f) => f.at), [250, 550, 850, 1_150], 'a debounce would have flushed once, after the stream ended')
})

await test('a resume dispatching 22 channels is one bulk flush with the shared reason', () => {
  const t = collectorOnClock()
  for (let i = 0; i < 22; i++) t.note(own(`channel${i}`, { reason: 'foreground-resume' }))
  t.clock.advance(300)
  assert.equal(t.flushes.length, 1)
  assert.equal(t.flushes[0].channels.length, 22)
  assert.equal(t.flushes[0].bulk, true)
  assert.equal(t.flushes[0].reason, 'foreground-resume')
})

// ---- window wiring and subscribeSyncFlush ----
const clock = fakeClock()
const realDateNow = Date.now
Date.now = clock.now
const windowStub = Object.assign(new EventTarget(), {
  setTimeout: (fn: () => void, delayMs: number) => clock.setTimeout(fn, delayMs),
  clearTimeout: (id: number) => clock.clearTimeout(id),
})
;(globalThis as { window?: unknown }).window = windowStub
const fire = (detail: Record<string, unknown>) => windowStub.dispatchEvent(new CustomEvent('sync:update', { detail }))
const rawFlushes: SyncFlushDetail[] = []
windowStub.addEventListener(SYNC_FLUSH_EVENT, (event) => rawFlushes.push((event as CustomEvent<SyncFlushDetail>).detail))

await test('subscribers hear one call per burst, only for their channels, and a cache-refresh echo is ignored', () => {
  const dashboard: SyncFlushDetail[] = []
  const bell: SyncFlushDetail[] = []
  const stopDashboard = subscribeSyncFlush(['sales', 'inventory', 'dashboard'], (d) => dashboard.push(d))
  const stopBell = subscribeSyncFlush(['notifications'], (d) => bell.push(d))
  fire({ channel: 'inventory' })
  fire({ channel: 'sales' })
  fire({ channel: 'dashboard', reason: 'cache-refresh' })
  clock.advance(300)
  assert.equal(dashboard.length, 1)
  assert.deepEqual(dashboard[0].channels, ['inventory', 'sales'])
  assert.equal(bell.length, 0, 'a page is not called for channels it did not ask for')
  fire({ channel: 'products' })
  clock.advance(300)
  assert.equal(dashboard.length, 1)
  stopDashboard(); stopBell()
  fire({ channel: 'sales' })
  clock.advance(300)
  assert.equal(dashboard.length, 1, 'unsubscribed')
})

await test('a bulk flush reaches matching subscribers 400 ms apart, and an unsubscribe cancels the wait', () => {
  const calls: Array<[string, number]> = []
  const start = clock.now()
  const stops = [
    subscribeSyncFlush(['sales'], () => calls.push(['first', clock.now() - start])),
    subscribeSyncFlush(['sales', 'dashboard'], () => calls.push(['second', clock.now() - start])),
    subscribeSyncFlush(['dashboard'], () => calls.push(['third', clock.now() - start])),
    subscribeSyncFlush(['nothing-here'], () => calls.push(['never', 0])),
  ]
  for (let i = 0; i < 12; i++) fire({ channel: `c${i}`, reason: 'foreground-resume' })
  fire({ channel: 'sales', reason: 'foreground-resume' })
  fire({ channel: 'dashboard', reason: 'foreground-resume' })
  clock.advance(250)
  assert.deepEqual(calls, [['first', 250]])
  stops[2]()
  clock.advance(2_000)
  assert.deepEqual(calls, [['first', 250], ['second', 650]], 'the third was unsubscribed while it waited; the fourth matched nothing')
  stops.forEach((stop) => stop())
})

await test('the raw sync:flush event carries the unfiltered set', () => {
  rawFlushes.length = 0
  const stop = subscribeSyncFlush(['sales'], () => {})
  fire({ channel: 'sales' }); fire({ channel: 'customers' })
  clock.advance(300)
  assert.equal(rawFlushes.length, 1)
  assert.deepEqual(rawFlushes[0].channels, ['sales', 'customers'])
  stop()
})

await test('a real resume (22 channels from web-api.ts) is one bulk flush: each open page reloads once, 400 ms apart', () => {
  const calls: Array<[string, number]> = []
  const start = clock.now()
  const stops = [
    subscribeSyncFlush(['sales', 'products', 'returns', 'inventory', 'dashboard', 'settings'], () => calls.push(['dashboard', clock.now() - start])),
    subscribeSyncFlush(['sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings'], () => calls.push(['sales', clock.now() - start])),
    subscribeSyncFlush(['inventory', 'sales', 'returns', 'customers', 'suppliers', 'deliveryContacts', 'notifications', 'catalog', 'settings'], () => calls.push(['bell', clock.now() - start])),
  ]
  const before = rawFlushes.length
  dispatchSyncUpdates(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS, 'foreground-resume', { trigger: 'visibility-resume' })
  clock.advance(3_000)
  assert.equal(rawFlushes.length - before, 1, 'one flush for 22 events')
  assert.equal(rawFlushes[rawFlushes.length - 1].bulk, true)
  assert.deepEqual(calls, [['dashboard', 250], ['sales', 650], ['bell', 1_050]], '22 channels used to publish 6, 8 and 9 times to these pages')
  stops.forEach((stop) => stop())
})

Date.now = realDateNow
if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('syncFlushCoalescing: all passed')
