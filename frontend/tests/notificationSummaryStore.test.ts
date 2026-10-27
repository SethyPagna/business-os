import assert from 'node:assert/strict'

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
  },
})

const {
  createNotificationSummaryStore,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_OPEN_MAX_AGE_MS,
} = await import('../src/utils/notificationSummaryStore.ts')

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

// Manual clock with the same surface the app's visibility polling uses.
function createWorld() {
  let now = 5_000_000
  let hidden = false
  let nextId = 1
  const timers = new Map<number, { at: number; every?: number; callback: () => void }>()
  const visibilityListeners = new Set<() => void>()
  const pushListeners = new Set<() => void>()
  const channelListeners = new Set<(m: { type: 'summary'; at: number; data: unknown }) => void>()
  const host = {
    isHidden: () => hidden,
    onVisibilityChange: (listener: () => void) => { visibilityListeners.add(listener); return () => { visibilityListeners.delete(listener) } },
    setInterval: (callback: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, every: ms, callback }); return id },
    clearInterval: (id: number) => { timers.delete(id) },
    setTimeout: (callback: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, callback }); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
    now: () => now,
  }
  async function advance(ms: number) {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      if (due[1].every) due[1].at += due[1].every
      else timers.delete(due[0])
      due[1].callback()
      await settle()
    }
    now = target
    await settle()
  }
  function setHidden(value: boolean) {
    hidden = value
    for (const listener of [...visibilityListeners]) listener()
  }
  // A BroadcastChannel stand-in shared by every store made in this world; a sender does not hear itself.
  function makeShare() {
    const own = new Set<(m: { type: 'summary'; at: number; data: unknown }) => void>()
    return {
      post: (message: { type: 'summary'; at: number; data: unknown }) => { for (const l of channelListeners) if (!own.has(l)) l(message) },
      onMessage: (listener: (m: { type: 'summary'; at: number; data: unknown }) => void) => { own.add(listener); channelListeners.add(listener); return () => { own.delete(listener); channelListeners.delete(listener) } },
    }
  }
  return { host, advance, setHidden, makeShare, now: () => now, push: () => { for (const l of [...pushListeners]) l() }, onPush: (l: () => void) => { pushListeners.add(l); return () => { pushListeners.delete(l) } } }
}

function makeStore(world: ReturnType<typeof createWorld>, options: { share?: boolean; fail?: () => boolean } = {}) {
  let reads = 0
  const store = createNotificationSummaryStore({
    fetchSummary: async () => {
      reads += 1
      if (options.fail?.()) throw new Error('boom')
      return { unreadCount: reads, sections: [] }
    },
    now: world.now,
    visibilityHost: world.host,
    share: options.share ? world.makeShare() : null,
    onNotificationsPush: world.onPush,
  })
  return { store, reads: () => reads }
}

await runTest('the desktop and mobile bell together are one read, not two', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  const stopA = store.subscribe(() => {})
  const stopB = store.subscribe(() => {})
  await world.advance(1)
  assert.equal(reads(), 1)
  stopA(); stopB()
})

await runTest('while visible it reads once a minute, not on every push', async () => {
  const world = createWorld()
  assert.equal(NOTIFICATION_POLL_INTERVAL_MS, 60_000, 'the owner-set cadence')
  const { store, reads } = makeStore(world)
  const stop = store.subscribe(() => {})
  await world.advance(1)
  assert.equal(reads(), 1)
  await world.advance(60_000 - 10_000)
  assert.equal(reads(), 1, 'nothing before the minute is up')
  await world.advance(10_000)
  assert.equal(reads(), 2)
  await world.advance(60_000 * 8)
  assert.equal(reads(), 10, 'a tenth minute, a tenth read')
  stop()
})

await runTest('hidden tabs do not read; showing the tab after a long absence reads once', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  const stop = store.subscribe(() => {})
  await world.advance(1)
  world.setHidden(true)
  await world.advance(NOTIFICATION_POLL_INTERVAL_MS * 30)
  assert.equal(reads(), 1, 'half an hour hidden costs nothing')
  world.setHidden(false)
  await world.advance(1)
  assert.equal(reads(), 2, 'one catch-up read on return')
  stop()
})

await runTest('opening the panel reads unless a read just finished', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  const stop = store.subscribe(() => {})
  await world.advance(1)
  await store.refresh({ maxAgeMs: NOTIFICATION_OPEN_MAX_AGE_MS })
  assert.equal(reads(), 1, 'reused a read from a moment ago')
  await world.advance(NOTIFICATION_OPEN_MAX_AGE_MS + 1_000)
  await store.refresh({ maxAgeMs: NOTIFICATION_OPEN_MAX_AGE_MS })
  assert.equal(reads(), 2, 'refreshed on open')
  stop()
})

await runTest('only a notifications push reads at once; sales pushes are the poll\'s business', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  const stop = store.subscribe(() => {})
  await world.advance(1)
  await world.advance(NOTIFICATION_OPEN_MAX_AGE_MS + 1_000)
  const before = reads()
  world.push()
  await world.advance(1)
  assert.equal(reads(), before + 1)
  stop()
})

await runTest('overlapping refreshes share one request', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  await Promise.all([store.refresh({ force: true }), store.refresh({ force: true }), store.refresh({ force: true })])
  assert.equal(reads(), 1)
})

await runTest('a second browser tab uses the result of the first tab instead of reading again', async () => {
  const world = createWorld()
  const first = makeStore(world, { share: true })
  const second = makeStore(world, { share: true })
  const stopFirst = first.store.subscribe(() => {})
  await world.advance(1_000)
  const stopSecond = second.store.subscribe(() => {})
  await world.advance(1)
  assert.equal(first.reads(), 1)
  assert.equal(second.reads(), 1, 'a tab opened later reads once for itself')
  // Both polls come due within a second of each other: only the first reads.
  await world.advance(NOTIFICATION_POLL_INTERVAL_MS + 1_000)
  assert.equal(first.reads() + second.reads(), 3, 'one read for the pair at the minute, not two')
  stopFirst(); stopSecond()
})

await runTest('a failed read keeps the last count and the next tick tries again', async () => {
  const world = createWorld()
  let failNext = false
  const { store, reads } = makeStore(world, { fail: () => failNext })
  let last: unknown = null
  const stop = store.subscribe((state) => { last = state.data })
  await world.advance(1)
  failNext = true
  await world.advance(NOTIFICATION_POLL_INTERVAL_MS)
  assert.deepEqual(last, { unreadCount: 1, sections: [] })
  failNext = false
  await world.advance(NOTIFICATION_POLL_INTERVAL_MS)
  assert.equal(reads(), 3)
  assert.deepEqual(last, { unreadCount: 3, sections: [] })
  stop()
})

await runTest('the last unsubscribe stops the poll', async () => {
  const world = createWorld()
  const { store, reads } = makeStore(world)
  const stop = store.subscribe(() => {})
  await world.advance(1)
  stop()
  await world.advance(NOTIFICATION_POLL_INTERVAL_MS * 10)
  assert.equal(reads(), 1)
})

if (failed) process.exit(1)
console.log('PASS notification summary store')
