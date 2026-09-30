// READS-CUT (8): the notification bell re-read GET /api/notifications/summary
// on each of nine sync channels, in hidden tabs too. One sale broadcasts on
// several channels within a moment, so a tab paid for the same ~60k-row read
// several times over. The bell now asks once per burst (quiet window after the
// last signal, capped by a max wait) and never from a hidden tab.
// The wrong-but-plausible versions this rejects: a leading-edge debounce that
// fires before the burst's last write, a window with no cap that a steady
// stream postpones forever, a timer that still runs a read after the tab hid,
// and a signal remembered while hidden (it must be dropped -- the visibility
// reload owns catch-up).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCoalescedRefresh, type CoalescedRefreshHost } from '../src/utils/coalescedRefresh.ts'

function fakeHost() {
  const state = { now: 1_000, hidden: false, nextId: 1 }
  const timers = new Map<number, { at: number; callback: () => void }>()
  const host: CoalescedRefreshHost = {
    now: () => state.now,
    isHidden: () => state.hidden,
    setTimeout: (callback, ms) => { const id = state.nextId++; timers.set(id, { at: state.now + ms, callback }); return id },
    clearTimeout: (id) => { timers.delete(id) },
  }
  return {
    host,
    state,
    pending: () => timers.size,
    advance(ms: number) {
      const target = state.now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        state.now = due[1].at
        due[1].callback()
      }
      state.now = target
    },
  }
}

function test(name: string, fn: () => void) { fn(); console.log(`ok - ${name}`) }
const OPTIONS = { quietMs: 1500, maxWaitMs: 5000 }

test('nine signals in one burst run one refresh, after the quiet window following the last', () => {
  const h = fakeHost()
  let runs = 0
  const refresh = createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host })
  for (let i = 0; i < 9; i++) { refresh.request(); h.advance(100) }
  assert.equal(runs, 0, 'nothing runs while the burst is still arriving')
  h.advance(1399)
  assert.equal(runs, 0, 'not yet: 1399 ms after the last signal')
  h.advance(1)
  assert.equal(runs, 1, 'exactly one refresh, 1500 ms after the last signal')
  h.advance(60_000)
  assert.equal(runs, 1)
})

test('a lone signal runs once after the quiet window', () => {
  const h = fakeHost()
  let runs = 0
  createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host }).request()
  h.advance(1499)
  assert.equal(runs, 0)
  h.advance(1)
  assert.equal(runs, 1)
})

test('a steady stream cannot postpone the refresh past the max wait', () => {
  const h = fakeHost()
  let runs = 0
  const refresh = createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host })
  for (let elapsed = 0; elapsed < 5000; elapsed += 500) { refresh.request(); h.advance(500) }
  assert.equal(runs, 1, 'forced at the 5 s cap although a signal arrived every 500 ms')
  refresh.request()
  h.advance(1500)
  assert.equal(runs, 2, 'a later burst starts a fresh window')
})

test('a hidden tab never refreshes and forgets the signal', () => {
  const h = fakeHost()
  let runs = 0
  const refresh = createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host })
  h.state.hidden = true
  refresh.request()
  assert.equal(h.pending(), 0, 'no timer is even armed in a hidden tab')
  h.advance(60_000)
  assert.equal(runs, 0)
  h.state.hidden = false
  h.advance(60_000)
  assert.equal(runs, 0, 'the signal was dropped, not queued for the moment the tab is shown')
})

test('a tab that hides while a refresh is pending does not read', () => {
  const h = fakeHost()
  let runs = 0
  const refresh = createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host })
  refresh.request()
  h.advance(1000)
  h.state.hidden = true
  h.advance(1000)
  assert.equal(runs, 0)
  refresh.request()
  assert.equal(h.pending(), 0, 'and a signal while hidden clears the leftover timer')
})

test('cancel drops a pending refresh', () => {
  const h = fakeHost()
  let runs = 0
  const refresh = createCoalescedRefresh(() => { runs++ }, { ...OPTIONS, host: h.host })
  refresh.request()
  refresh.cancel()
  h.advance(10_000)
  assert.equal(runs, 0)
})

test('the bell wires the nine channels through the coalescer, not straight into a read', () => {
  const source = fs.readFileSync(new URL('../src/components/shared/NotificationCenter.tsx', import.meta.url), 'utf8')
  assert.match(source, /import \{ createCoalescedRefresh, type CoalescedRefresh \} from '\.\.\/\.\.\/utils\/coalescedRefresh\.ts'/)
  const channels = /const NOTIFICATION_SUMMARY_SYNC_CHANNELS = \[([^\]]+)\]/.exec(source)
  assert.ok(channels, 'the channel list is a named constant')
  assert.deepEqual(
    channels![1].split(',').map((item) => item.trim().replace(/'/g, '')).filter(Boolean).sort(),
    ['catalog', 'customers', 'deliveryContacts', 'inventory', 'notifications', 'returns', 'sales', 'settings', 'suppliers'],
    'the same nine channels as before',
  )
  assert.match(source, /const NOTIFICATION_SUMMARY_SYNC_QUIET_MS = 1500/)
  assert.match(source, /const NOTIFICATION_SUMMARY_SYNC_MAX_WAIT_MS = 5000/)
  assert.match(source, /NOTIFICATION_SUMMARY_SYNC_CHANNELS\.includes\(syncChannel\.channel\)\) syncRefreshRef\.current\?\.request\(\)/)
  const effect = /useEffect\(\(\) => \{\s*if \(!visibilityActive\) return\s*if \(!syncChannel\?\.channel\) return[\s\S]*?\}, \[[^\]]*syncChannel\?\.ts[^\]]*\]\)/.exec(source)
  assert.ok(effect, 'the sync effect exists')
  assert.doesNotMatch(effect![0], /loadSummary/, 'the sync effect no longer calls the read directly')
  // The visibility reload still owns catch-up for a tab that was hidden.
  assert.match(source, /document\.addEventListener\('visibilitychange', onVisible\)/)
})

console.log('coalesced refresh: ok')
