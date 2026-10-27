import assert from 'node:assert/strict'
import fs from 'node:fs'

const windowEvents = new EventTarget()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event) => windowEvents.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => windowEvents.removeEventListener(type, listener),
  },
})

const { createSyncSignalsSubscriber, subscribeSyncBurst, SYNC_BURST_SETTLE_MS, transportReissuesStaleReadScope } = await import('../src/utils/syncSignals.ts')
const { dispatchSyncUpdates, FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS } = await import('../src/api/syncRuntime.ts')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const emit = (channel: string, detail: Record<string, unknown> = {}) => windowEvents.dispatchEvent(new CustomEvent('sync:update', { detail: { channel, ...detail } }))

await runTest('without the coalesced API the raw events are used, filtered to the asked channels', () => {
  const subscribe = createSyncSignalsSubscriber({ isRemoteSyncUpdate: () => false })
  const seen: string[] = []
  const stop = subscribe(['sales', 'dashboard'], (signal) => { if (signal.type === 'update') seen.push(signal.channel) })
  emit('sales'); emit('customers'); emit('dashboard:get:x'); emit('sales', { reason: 'cache-refresh' })
  stop()
  emit('sales')
  assert.deepEqual(seen, ['sales', 'dashboard'], 'unasked channels, cache-refresh echoes and events after unsubscribe are ignored')
})

await runTest('with the coalesced API, one flush is delivered once per channel and the raw events are not also heard', () => {
  const flushHandlers: Array<(detail: any) => void> = []
  let asked: readonly string[] = []
  let stopped = 0
  const subscribe = createSyncSignalsSubscriber({
    isRemoteSyncUpdate: () => false,
    subscribeSyncFlush: (channels: readonly string[], handler: (detail: any) => void) => { asked = channels; flushHandlers.push(handler); return () => { stopped += 1 } },
  })
  const seen: Array<[string, string | null, boolean]> = []
  const stop = subscribe(['sales', 'dashboard'], (signal) => { if (signal.type === 'update') seen.push([signal.channel, signal.reason, signal.remote]) })
  assert.deepEqual([...asked].sort(), ['dashboard', 'sales'])
  emit('sales')
  assert.deepEqual(seen, [], 'a raw event is not a second source')
  flushHandlers[0]({ channels: ['sales', 'dashboard'], remote: true, reason: 'foreground-resume-gap', source: null, bulk: false, ts: 1 })
  assert.deepEqual(seen, [['sales', 'foreground-resume-gap', true], ['dashboard', 'foreground-resume-gap', true]])
  stop()
  assert.equal(stopped, 1, 'unsubscribing releases the flush subscription')
})

await runTest('a reconnect reaches the listener in both modes', () => {
  for (const runtime of [{ isRemoteSyncUpdate: () => false }, { isRemoteSyncUpdate: () => false, subscribeSyncFlush: () => () => {} }]) {
    const subscribe = createSyncSignalsSubscriber(runtime)
    let reconnects = 0
    const stop = subscribe(['sales'], (signal) => { if (signal.type === 'reconnected') reconnects += 1 })
    windowEvents.dispatchEvent(new Event('sync:reconnected'))
    stop()
    windowEvents.dispatchEvent(new Event('sync:reconnected'))
    assert.equal(reconnects, 1)
  }
})

await runTest('a tab resume (22 channels) is ONE Sales refresh, and it carries the users channel', async () => {
  const bursts: Array<{ channels: string[]; reason: string | null }> = []
  const stop = subscribeSyncBurst(['sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings'], (burst) => bursts.push(burst))
  dispatchSyncUpdates(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS, 'foreground-resume-gap')
  assert.equal(bursts.length, 0, 'nothing before the burst settles')
  await sleep(SYNC_BURST_SETTLE_MS + 40)
  assert.equal(bursts.length, 1, 'one refresh for the whole burst')
  assert.ok(bursts[0].channels.includes('sales') && bursts[0].channels.includes('users'))
  assert.ok(!bursts[0].channels.includes('pendingActions'), 'only the asked channels')
  assert.equal(bursts[0].reason, 'foreground-resume-gap')
  emit('sales'); emit('sales')
  await sleep(SYNC_BURST_SETTLE_MS + 40)
  assert.equal(bursts.length, 2, 'a later burst is a later refresh')
  emit('sales')
  stop()
  await sleep(SYNC_BURST_SETTLE_MS + 40)
  assert.equal(bursts.length, 2, 'unsubscribing cancels a pending burst')
  emit('sales')
  await sleep(SYNC_BURST_SETTLE_MS + 40)
  assert.equal(bursts.length, 2, 'and stops listening')
})

await runTest('this build has no route() re-issue, so the Dashboard keeps its own silent stale_read_scope retry', () => {
  assert.equal(transportReissuesStaleReadScope, false)
})

await runTest('Sales listens through the burst adapter, not the lossy syncChannel slot', () => {
  const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(!/useSync\b|syncChannel/.test(sales), 'no AppContext slot')
  assert.ok(sales.includes('subscribeSyncBurst(SALES_REFRESH_CHANNELS'), 'one adapter')
  assert.ok(sales.includes("if (channels.includes('users')) setUserOptionsLoaded(false)"), 'a users change still resets the cashier options')
})

if (failed) process.exit(1)
console.log('PASS sync signals adapter')
