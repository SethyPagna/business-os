// The QR screen's status watcher (KHQR S7): one read at a time, a modest cadence, silent while hidden, and finished when the order is.
//
// Run: node tests/orderPoller.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { POLL_BACKOFF_MAX_MS, POLL_FAST_MS, POLL_FAST_WINDOW_MS, POLL_MIN_MS, POLL_SLOW_MS, POLL_GRACE_AFTER_EXPIRY_MS } from '../src/components/catalog/orders/orderLogic.ts'
import { createOrderPoller, giveUpTimeFor, type PollHost } from '../src/components/catalog/orders/orderPoller.ts'
import type { OrderApiResult, OrderStatusPoll } from '../src/components/catalog/orders/orderTypes.ts'

// A clock the test drives, with the same surface as the browser host.
function fakeHost() {
  let nowMs = 1_000_000
  let hidden = false
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const listeners = new Set<() => void>()
  const host: PollHost = {
    now: () => nowMs,
    setTimeout: (callback, ms) => { const id = nextId++; timers.set(id, { at: nowMs + ms, callback }); return id },
    clearTimeout: (id) => { timers.delete(id) },
    isHidden: () => hidden,
    onVisibilityChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return {
    host,
    get pending() { return timers.size },
    get nextDelay() { const soonest = [...timers.values()].map((t) => t.at - nowMs); return soonest.length ? Math.min(...soonest) : null },
    /** Advance time, firing every timer that comes due (each may schedule the next). Awaits microtasks between firings. */
    async advance(ms: number) {
      const end = nowMs + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        nowMs = Math.max(nowMs, due[1].at)
        due[1].callback()
        await settle()
      }
      nowMs = end
    },
    async setHidden(value: boolean) {
      hidden = value
      for (const listener of [...listeners]) listener()
      await settle()
    },
    get listenerCount() { return listeners.size },
  }
}
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }

const ok = (state: string): OrderApiResult<OrderStatusPoll> => ({ ok: true, data: { state, revision: 1, paid_at: null, total_usd: 5 }, skewMs: null })
const bad = (status: number): OrderApiResult<OrderStatusPoll> => ({ ok: false, code: 'unknown', status, retryable: status >= 500, extra: {}, token: null, orderNo: null })

test('a read happens one cadence after start, then again, and each result is reported in order', async () => {
  // CATCHES: reading at once on start (the page already has fresh data), a loop faster than the cadence, and lost results.
  const clock = fakeHost()
  const seen: string[] = []
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: async () => { reads += 1; return ok('awaiting_payment') }, onStatus: (s) => seen.push(s.state) })
  poller.start()
  assert.equal(reads, 0)
  await clock.advance(POLL_FAST_MS - 1)
  assert.equal(reads, 0)
  await clock.advance(1)
  assert.equal(reads, 1)
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 2)
  assert.deepEqual(seen, ['awaiting_payment', 'awaiting_payment'])
  poller.stop()
})

test('it never has two reads in flight and schedules the next only after the last finished', async () => {
  // CATCHES: a setInterval that fires again while a slow read is still out (a pile-up on a bad network).
  const clock = fakeHost()
  let inFlight = 0
  let maxInFlight = 0
  let reads = 0
  let release: () => void = () => {}
  const poller = createOrderPoller({
    host: clock.host,
    read: () => new Promise((resolve) => {
      reads += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight)
      release = () => { inFlight -= 1; resolve(ok('awaiting_payment')) }
    }),
    onStatus: () => {},
  })
  poller.start()
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 1)
  await clock.advance(60_000)
  assert.equal(reads, 1, 'a slow read blocks the next one for as long as it takes')
  release(); await settle()
  assert.equal(clock.pending, 1, 'the next read is scheduled once the first finished')
  assert.equal(maxInFlight, 1)
  poller.stop()
})

test('the cadence is quick for the first two minutes, then slow', async () => {
  // CATCHES: a poller that stays at the fast rate for the whole life of the page.
  const clock = fakeHost()
  const stamps: number[] = []
  const poller = createOrderPoller({ host: clock.host, read: async () => { stamps.push(clock.host.now()); return ok('awaiting_payment') }, onStatus: () => {} })
  poller.start()
  const start = clock.host.now()
  await clock.advance(POLL_FAST_WINDOW_MS + 60_000)
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i])
  assert.ok(stamps[0] - start === POLL_FAST_MS)
  assert.ok(gaps.slice(0, 5).every((gap) => gap === POLL_FAST_MS), `early gaps ${gaps.slice(0, 5)}`)
  assert.equal(gaps[gaps.length - 1], POLL_SLOW_MS)
  assert.ok(gaps.every((gap) => gap >= POLL_MIN_MS), 'never tighter than the floor')
  poller.stop()
})

test('a failed read backs off and a good one resets the pace', async () => {
  // CATCHES: hammering a Worker that is already answering errors, and a back-off that never recovers.
  const clock = fakeHost()
  const results = [bad(503), bad(503), bad(503), ok('awaiting_payment')]
  const stamps: number[] = []
  const poller = createOrderPoller({ host: clock.host, read: async () => { stamps.push(clock.host.now()); return results.shift() ?? ok('awaiting_payment') }, onStatus: () => {} })
  poller.start()
  await clock.advance(120_000)
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i])
  assert.deepEqual(gaps.slice(0, 3), [POLL_FAST_MS * 2, POLL_FAST_MS * 4, POLL_BACKOFF_MAX_MS], 'doubling after each failure, then the cap (4 s x 8 = 32 s is held to 30 s)')
  assert.ok(Math.max(...gaps) <= POLL_BACKOFF_MAX_MS)
  assert.equal(gaps[3], POLL_FAST_MS, 'the first good read resets it')
  poller.stop()
})

test('a thrown read counts as a failure and the loop survives', async () => {
  // CATCHES: an unhandled rejection that silently ends the watching.
  const clock = fakeHost()
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: async () => { reads += 1; if (reads === 1) throw new Error('boom'); return ok('awaiting_payment') }, onStatus: () => {} })
  poller.start()
  await clock.advance(POLL_FAST_MS * 4)
  assert.ok(reads >= 2)
  assert.equal(poller.running, true)
  poller.stop()
})

test('it stops by itself when the order is paid, and reports that last result first', async () => {
  // CATCHES: still polling a paid order, and a paid result swallowed because the loop stopped before reporting it.
  const clock = fakeHost()
  const seen: string[] = []
  const results = [ok('awaiting_payment'), ok('paid')]
  const poller = createOrderPoller({ host: clock.host, read: async () => results.shift()!, onStatus: (s) => seen.push(s.state) })
  poller.start()
  await clock.advance(POLL_FAST_MS * 3)
  assert.deepEqual(seen, ['awaiting_payment', 'paid'])
  assert.equal(poller.running, false)
  assert.equal(clock.pending, 0)
  assert.equal(clock.listenerCount, 0, 'the visibility listener is released')
})

test('every finished state ends the watching', async () => {
  for (const state of ['paid', 'review', 'expired', 'cancelled', 'fulfilled', 'qr_failed']) {
    const clock = fakeHost()
    const poller = createOrderPoller({ host: clock.host, read: async () => ok(state), onStatus: () => {} })
    poller.start()
    await clock.advance(POLL_FAST_MS)
    assert.equal(poller.running, false, state)
  }
})

test('a 404 ends the watching (the link is wrong or the order is gone); a 503 does not', async () => {
  // CATCHES: polling a missing order forever, and giving up on a Worker that only had a bad minute.
  for (const [status, running] of [[404, false], [503, true], [429, true]] as const) {
    const clock = fakeHost()
    const poller = createOrderPoller({ host: clock.host, read: async () => bad(status), onStatus: () => {} })
    poller.start()
    await clock.advance(POLL_FAST_MS)
    assert.equal(poller.running, running, String(status))
    poller.stop()
  }
})

test('nothing is read while the tab is hidden; coming back reads once, at once, then resumes', async () => {
  // CATCHES: a hidden tab that keeps costing the Worker requests, and one that waits a whole interval after the buyer returns.
  const clock = fakeHost()
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: async () => { reads += 1; return ok('awaiting_payment') }, onStatus: () => {} })
  poller.start()
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 1)
  await clock.setHidden(true)
  assert.equal(clock.pending, 0, 'the timer is cleared, not skipped')
  await clock.advance(10 * 60_000)
  assert.equal(reads, 1, 'ten hidden minutes cost nothing')
  await clock.setHidden(false)
  assert.equal(reads, 2, 'one catch-up read the moment it is visible again')
  assert.equal(clock.pending, 1, 'and the cadence resumes')
  await clock.advance(POLL_SLOW_MS)
  assert.equal(reads, 3)
  poller.stop()
})

test('stop() is final: a read that lands afterwards reports nothing and schedules nothing', async () => {
  // CATCHES: a late response painting a stale state onto a page that moved on, and a timer left running after the page closed.
  const clock = fakeHost()
  const seen: string[] = []
  let release: () => void = () => {}
  const poller = createOrderPoller({ host: clock.host, read: () => new Promise((resolve) => { release = () => resolve(ok('paid')) }), onStatus: (s) => seen.push(s.state) })
  poller.start()
  await clock.advance(POLL_FAST_MS)
  poller.stop()
  release(); await settle()
  assert.deepEqual(seen, [])
  assert.equal(clock.pending, 0)
  assert.equal(clock.listenerCount, 0)
})

test('it gives up shortly after the QR\'s own expiry, and keeps going before it', async () => {
  // CATCHES: polling for ever after the QR ran out, and giving up before a payment made in the last seconds can be seen.
  const clock = fakeHost()
  const expiry = clock.host.now() + 60_000
  assert.equal(giveUpTimeFor(expiry), expiry + POLL_GRACE_AFTER_EXPIRY_MS)
  assert.equal(giveUpTimeFor(null), null)
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: async () => { reads += 1; return ok('awaiting_payment') }, onStatus: () => {}, giveUpAt: () => giveUpTimeFor(expiry) })
  poller.start()
  await clock.advance(60_000 + POLL_GRACE_AFTER_EXPIRY_MS - 1_000)
  assert.equal(poller.running, true)
  const before = reads
  await clock.advance(60_000)
  assert.equal(poller.running, false)
  assert.ok(reads >= before)
  assert.equal(clock.pending, 0)
})

test('start() twice does not double the loop', async () => {
  // CATCHES: a re-render that restarts the poller and doubles the request rate.
  const clock = fakeHost()
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: async () => { reads += 1; return ok('awaiting_payment') }, onStatus: () => {} })
  poller.start()
  poller.start()
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 1)
  poller.stop()
})

test('a read that finishes while the tab is hidden schedules nothing until the tab is back', async () => {
  // CATCHES: a response landing in a background tab arming a fresh timer (the hidden tab would keep reading from then on).
  const clock = fakeHost()
  let reads = 0
  let release: () => void = () => {}
  const poller = createOrderPoller({ host: clock.host, read: () => new Promise((resolve) => { reads += 1; release = () => resolve(ok('awaiting_payment')) }), onStatus: () => {} })
  poller.start()
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 1)
  await clock.setHidden(true)
  release(); await settle()
  assert.equal(clock.pending, 0, 'no timer armed while hidden')
  await clock.advance(5 * 60_000)
  assert.equal(reads, 1)
  poller.stop()
})

test('hiding and showing the tab while a read is out does not start a second read', async () => {
  // CATCHES: the catch-up read racing the one already in flight (two requests, and the older answer can land last).
  const clock = fakeHost()
  let reads = 0
  const poller = createOrderPoller({ host: clock.host, read: () => new Promise(() => { reads += 1 }), onStatus: () => {} })
  poller.start()
  await clock.advance(POLL_FAST_MS)
  assert.equal(reads, 1)
  await clock.setHidden(true)
  await clock.setHidden(false)
  assert.equal(reads, 1)
  poller.stop()
})
