// F2: the shared "no poll in a hidden tab" primitives (src/utils/visibilityPolling.ts).
// The wrong-but-plausible implementations these reject: skipping ticks while
// the interval keeps firing (the timer still wakes a hidden tab), resuming
// without the catch-up read, a duplicate 'visible' event starting a second
// interval, and a delayed poll that fires in a hidden tab.
import assert from 'node:assert/strict'
import { runWhenVisible, startVisibleInterval, visibleTimeout, type VisibilityHost } from '../src/utils/visibilityPolling.ts'

function fakeHost() {
  const intervals = new Map<number, () => void>()
  const timeouts = new Map<number, () => void>()
  const listeners = new Set<() => void>()
  let nextId = 1
  const state = { hidden: false }
  const host: VisibilityHost = {
    isHidden: () => state.hidden,
    onVisibilityChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    setInterval: (cb) => { const id = nextId++; intervals.set(id, cb); return id },
    clearInterval: (id) => { intervals.delete(id) },
    setTimeout: (cb) => { const id = nextId++; timeouts.set(id, cb); return id },
    clearTimeout: (id) => { timeouts.delete(id) },
  }
  return {
    host,
    intervals,
    timeouts,
    listeners,
    setHidden(hidden: boolean) { state.hidden = hidden; for (const l of [...listeners]) l() },
    fireIntervals() { for (const cb of [...intervals.values()]) cb() },
    fireTimeouts() { const all = [...timeouts.entries()]; timeouts.clear(); for (const [, cb] of all) cb() },
  }
}

function test(name: string, fn: () => void) {
  fn()
  console.log(`ok - ${name}`)
}

test('startVisibleInterval clears the timer while hidden and catches up once on resume', () => {
  const env = fakeHost()
  let ticks = 0
  const stop = startVisibleInterval(() => { ticks += 1 }, 1000, { host: env.host })
  assert.equal(env.intervals.size, 1)
  env.fireIntervals()
  assert.equal(ticks, 1)
  env.setHidden(true)
  assert.equal(env.intervals.size, 0, 'no interval exists in a hidden tab')
  env.setHidden(false)
  assert.equal(ticks, 2, 'one immediate read on resume')
  assert.equal(env.intervals.size, 1, 'cadence resumes')
  env.setHidden(false)
  assert.equal(ticks, 2, "a repeated 'visible' is not a resume")
  assert.equal(env.intervals.size, 1, 'and never starts a second interval')
  stop()
  assert.equal(env.intervals.size, 0)
  assert.equal(env.listeners.size, 0, 'stop() removes the visibility listener')
  env.setHidden(true); env.setHidden(false)
  assert.equal(ticks, 2, 'a stopped poll never ticks again')
})

test('startVisibleInterval started in a hidden tab waits; refreshOnVisible:false resumes without the catch-up', () => {
  const env = fakeHost()
  env.setHidden(true)
  let ticks = 0
  startVisibleInterval(() => { ticks += 1 }, 1000, { host: env.host, refreshOnVisible: false })
  assert.equal(env.intervals.size, 0)
  env.setHidden(false)
  assert.equal(ticks, 0)
  assert.equal(env.intervals.size, 1)
})

test('runWhenVisible defers a hidden call to the next show, and cancel() drops it', () => {
  const env = fakeHost()
  let calls = 0
  runWhenVisible(() => { calls += 1 }, env.host)
  assert.equal(calls, 1, 'visible: runs now')
  env.setHidden(true)
  runWhenVisible(() => { calls += 1 }, env.host)
  assert.equal(calls, 1)
  env.setHidden(false)
  assert.equal(calls, 2)
  env.setHidden(true); env.setHidden(false)
  assert.equal(calls, 2, 'runs once, not on every show')
  env.setHidden(true)
  const cancel = runWhenVisible(() => { calls += 1 }, env.host)
  cancel()
  env.setHidden(false)
  assert.equal(calls, 2)
})

test('visibleTimeout waits out the delay, then for visibility', () => {
  const env = fakeHost()
  let calls = 0
  visibleTimeout(() => { calls += 1 }, 500, env.host)
  env.setHidden(true)
  env.fireTimeouts()
  assert.equal(calls, 0, 'a delayed poll that comes due in a hidden tab does not run')
  env.setHidden(false)
  assert.equal(calls, 1)
  const cancel = visibleTimeout(() => { calls += 1 }, 500, env.host)
  cancel()
  env.fireTimeouts()
  assert.equal(calls, 1, 'cancel before the delay')
  const cancelLate = visibleTimeout(() => { calls += 1 }, 500, env.host)
  env.setHidden(true)
  env.fireTimeouts()
  cancelLate()
  env.setHidden(false)
  assert.equal(calls, 1, 'cancel while waiting for visibility')
})

console.log('visibility polling tests passed')
