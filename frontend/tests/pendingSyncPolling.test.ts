// F2: the pending-sale queue banner (App.tsx useSyncErrorBanner) used to
// re-read the queue every 20 s for the whole session -- an /api/sync/owner
// request plus an IndexedDB scan -- although offline mode was cancelled and a
// queue that a confirmed read found empty cannot refill without an event the
// banner already listens to. Fails before F2: the module does not exist and
// App.tsx still starts scheduleDeferredPendingSyncPolling.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

async function runTest(name: string, fn: () => void | Promise<void>) {
  await fn()
  console.log(`ok - ${name}`)
}

await runTest('pending-sale queue polling stops once a confirmed read reports nothing pending', async () => {
  const { createPendingSyncPoll, pendingSyncNeedsPolling } = await import('../src/app/pendingSyncPolling.ts')
  assert.equal(pendingSyncNeedsPolling({ owner: { id: 1 }, total: 0 }), false)
  assert.equal(pendingSyncNeedsPolling({ owner: { id: 1 }, total: 2 }), true)
  assert.equal(pendingSyncNeedsPolling({ owner: null, total: 0 }), true, 'an unconfirmed owner means the zero is unknown')
  assert.equal(pendingSyncNeedsPolling(null), true)

  let active: (() => void) | null = null
  let visibilityListener: (() => void) | null = null
  let reads = 0
  let hidden = false
  let clock = 1_000_000
  const poll = createPendingSyncPoll(() => { reads += 1 }, 20_000, {
    now: () => clock,
    isHidden: () => hidden,
    onVisibilityChange: (listener) => { visibilityListener = listener; return () => { visibilityListener = null } },
    setInterval: (cb) => { active = cb; return 1 },
    clearInterval: () => { active = null },
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  assert.equal(poll.isPolling(), false, 'no interval before the first read')
  poll.observe({ owner: { id: 1 }, total: 3 })
  assert.equal(poll.isPolling(), true, 'retained sales keep the poll running')
  active!()
  assert.equal(reads, 1)
  hidden = true; visibilityListener!()
  assert.equal(active, null, 'a hidden tab has no interval at all')
  clock += 60_000
  hidden = false; visibilityListener!()
  assert.equal(reads, 2, 'showing the tab reads once at once')
  assert.notEqual(active, null, 'and resumes the interval')
  poll.observe({ owner: { id: 1 }, total: 0 })
  assert.equal(poll.isPolling(), false, 'the drained queue stops the poll')
  poll.observe({ owner: { id: 1 }, total: 1 })
  assert.equal(poll.isPolling(), true, 'a later read that finds sales restarts it')
  poll.cancel()
  poll.observe({ owner: { id: 1 }, total: 1 })
  assert.equal(poll.isPolling(), false, 'a cancelled poll never restarts')
})

await runTest('App.tsx drives the pending-sale poll from each read and keeps the startup read', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /scheduleDeferredPendingSyncPolling/, 'the session-long 20 s interval is gone')
  assert.match(app, /const pendingSyncPoll = createPendingSyncPoll\(\(\) => refreshPendingSync\(\), PENDING_SYNC_POLL_INTERVAL_MS\)/)
  assert.match(app, /setPendingSync\([^\n]*\)\s*pendingSyncPoll\.observe\(/, 'every completed read feeds the poll')
  assert.match(app, /const cancelInitialPendingSyncRefresh = scheduleInitialPendingSyncRefresh\(refreshPendingSync\)/, 'the one startup read stays')
  assert.match(app, /pendingSyncPoll\.cancel\(\)/, 'the poll is cancelled on cleanup')
})

console.log('pending sync polling tests passed')
