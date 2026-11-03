'use strict'
// lib/buildShare.ts: costly work that several requests want at the same moment is done once WITHOUT any request awaiting a promise another
// request created (workerd ties a promise to its request; the 6.0.1048 review, B1). The first request sets a "building since <time>"
// marker, a plain value; the others poll for its FINISHED result with their own timer, for at most buildShareWaitMs.
//
// Every case runs the real module with small stubbed limits (poll 10 ms, wait 300 ms, stale 600 ms). The case that matters
// most is the dead builder: request A starts, never finishes (it answered, or it was cancelled), and request B must still answer within the
// wait plus its own work. A mutant in which B awaits A's promise hangs there.
//
// TIME. The timing cases run on a clock this file owns (see virtually()): setTimeout and Date.now are replaced by a scheduler that moves
// virtual time to the next timer once every promise has settled as far as it can. A case takes no real time and its bounds are exact, so they
// can be tight without ever being flaky (the real-timer version of these bounds went red on a loaded laptop at 521 ms against 500 ms, and
// the loosened version let a waiter that sat out 1.6x its cap through). Each timer costs MORE than it asks, as it does on a real host: a 10 ms
// timer takes 17.5 ms on the development laptop, which is what makes the wall-clock deadline, not the step count, the bound that ends a wait
// (the model "slow"). The model "ideal" costs exactly what a timer asks. Cases that depend on the difference run under both. Two cases
// still run on real timers, to show the module works with them; they assert no upper bound on the time.
//
// Run (from cloudflare/): node scripts/test-build-share-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
function load(rel, overrides = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path.basename(rel),
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, (request) => (Object.hasOwn(overrides, request) ? overrides[request] : require(request)), mod)
  return mod.exports
}
const KEY = Symbol.for('business-os.build-share.v1')
const LIMITS = { buildSharePollMs: 10, buildShareWaitMs: 300, buildShareStaleMs: 600 }
// A fresh module instance = a fresh isolate (its own markers and memo). It installs its hook on the global, as the Worker does.
function isolate(limits = LIMITS) {
  load('lib/buildShare.ts', { './planTier': { getPlanLimits: () => limits } })
  return globalThis[KEY]
}
const env = {}
const HELD = Symbol('held')

// ---- the clock this file owns --------------------------------------------------------------------------------------------------------
const SLOW = { name: 'slow timers', cost: (ms) => Math.ceil(ms * 1.75) }
const IDEAL = { name: 'ideal timers', cost: (ms) => ms }
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realNow = Date.now
const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

/** Runs `scenario(clock)` on virtual time. clock.now() is the virtual time; clock.step is what one poll step costs under this model. */
async function virtually(model, scenario) {
  let now = 1_000_000_000_000
  let order = 0
  const timers = []
  const clock = { now: () => now, step: model.cost(LIMITS.buildSharePollMs), cost: model.cost }
  globalThis.setTimeout = (callback, ms = 0, ...args) => { const timer = { at: now + model.cost(Math.max(0, ms)), order: order++, run: () => callback(...args), off: false }; timers.push(timer); return timer }
  globalThis.clearTimeout = (timer) => { if (timer) timer.off = true }
  Date.now = () => now
  try {
    let settled = false
    let outcome
    scenario(clock).then((value) => { outcome = { value }; settled = true }, (error) => { outcome = { error }; settled = true })
    while (!settled) {
      await nextTurn() // every promise chain runs to its next wait before time moves
      if (settled) break
      const live = timers.filter((timer) => !timer.off).sort((a, b) => a.at - b.at || a.order - b.order)
      if (!live.length) throw new Error('the scenario waits on something nothing will ever settle: no timer is left (a request awaited a promise another request created)')
      timers.splice(timers.indexOf(live[0]), 1)
      now = Math.max(now, live[0].at)
      live[0].run()
    }
    if (outcome.error) throw outcome.error
    return outcome.value
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
    Date.now = realNow
  }
}
// These two follow the clock in force when they are CALLED, so they are virtual inside virtually() and real outside it.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Answers within `ms` or says HELD: the check that a request is not waiting on something that never settles.
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => HELD)])

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
async function timed(name, models, scenario) {
  for (const model of models) await check(models.length > 1 ? `${name} [${model.name}]` : name, () => virtually(model, scenario))
}

async function main() {
  await check('the hook installs under the shared key and offers run and remember', async () => {
    const share = isolate()
    assert.equal(typeof share.run, 'function')
    assert.equal(typeof share.remember, 'function')
    assert.equal(KEY, Symbol.for('business-os.build-share.v1'))
  })

  await timed('CONTROL: a lone request builds once and does not wait', [SLOW, IDEAL], async (clock) => {
    const share = isolate()
    let builds = 0
    const started = clock.now()
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'a' }, () => undefined), 'a')
    assert.equal(builds, 1)
    assert.equal(clock.now() - started, 0, 'no marker, no wait')
  })

  await timed('A slow, B arrives meanwhile: B returns A\'s finished result at the first look after A is done, and builds nothing', [SLOW, IDEAL], async (clock) => {
    const share = isolate()
    const memo = {}
    const peek = () => memo.value
    const built = []
    const a = share.run(env, 'k', async () => { built.push('A'); await sleep(120); memo.value = 'A-result'; memo.at = clock.now(); return 'A-result' }, peek)
    await sleep(20)
    const b = share.run(env, 'k', async () => { built.push('B'); memo.value = 'B-result'; return 'B-result' }, peek)
    assert.equal(await a, 'A-result')
    assert.equal(await b, 'A-result', 'B took A\'s result')
    assert.deepEqual(built, ['A'], 'one build for two requests')
    assert.ok(clock.now() - memo.at <= clock.step, `B answered within one poll step of A finishing (${clock.now() - memo.at} against ${clock.step})`)
  })

  await timed('five requests behind one slow builder: still one build', [SLOW], async () => {
    const share = isolate()
    const memo = {}
    let builds = 0
    const work = async () => { builds += 1; await sleep(100); memo.value = builds; return builds }
    const first = share.run(env, 'k', work, () => memo.value)
    await sleep(10)
    const rest = await Promise.all(Array.from({ length: 5 }, () => share.run(env, 'k', work, () => memo.value)))
    assert.deepEqual([await first, ...rest], [1, 1, 1, 1, 1, 1])
    assert.equal(builds, 1)
  })

  await timed('DEAD BUILDER: A starts and never finishes; B answers after exactly the wait (to the next poll step) plus its own work, and never hangs', [SLOW, IDEAL], async (clock) => {
    const share = isolate()
    const memo = {}
    void share.run(env, 'k', () => new Promise(() => {}), () => memo.value)
    await sleep(20)
    const started = clock.now()
    const buildCost = clock.cost(30)
    const b = await within(share.run(env, 'k', async () => { await sleep(30); memo.value = 'B-result'; return 'B-result' }, () => memo.value), 2000)
    const gaveA = clock.now() - started - buildCost
    assert.notEqual(b, HELD, 'B must not wait on A\'s promise')
    assert.equal(b, 'B-result', 'B did the work itself')
    assert.ok(gaveA >= LIMITS.buildShareWaitMs, `B first gave A the whole wait (${gaveA} ms of ${LIMITS.buildShareWaitMs})`)
    assert.ok(gaveA < LIMITS.buildShareWaitMs + clock.step, `and then built at once, not a step late (${gaveA} ms; one step is ${clock.step})`)
    // The next caller finds B's result, not A's dead marker.
    assert.equal(await within(share.run(env, 'k', async () => 'never', () => memo.value), 500), 'B-result')
  })

  await timed('A fails: the marker goes with it, so B starts building within one step of the failure and does not sit out the wait', [SLOW], async (clock) => {
    const share = isolate()
    const memo = {}
    let failedAt = 0
    const a = share.run(env, 'k', async () => { await sleep(80); failedAt = clock.now(); throw new Error('boom') }, () => memo.value)
    a.catch(() => {})
    await sleep(20)
    const b = await share.run(env, 'k', async () => { memo.value = 'B-result'; return 'B-result' }, () => memo.value)
    assert.equal(b, 'B-result')
    assert.ok(clock.now() - failedAt <= clock.step, `B built within one step of A failing (${clock.now() - failedAt} ms)`)
    await assert.rejects(a, /boom/)
  })

  await timed('a result that cannot be stored (no memo) ends the wait when the builder finishes, not at the cap', [SLOW], async (clock) => {
    const share = isolate()
    let finishedAt = 0
    const a = share.run(env, 'k', async () => { await sleep(80); finishedAt = clock.now(); return 'A' }, () => undefined)
    await sleep(20)
    assert.equal(await share.run(env, 'k', async () => 'B', () => undefined), 'B')
    assert.ok(clock.now() - finishedAt <= clock.step, `B started building within one step of A finishing (${clock.now() - finishedAt} ms)`)
    await a
  })

  await timed('a stale marker is ignored, and a waiter never outlasts its marker', [SLOW], async (clock) => {
    const limits = { ...LIMITS, buildShareStaleMs: 100 }
    const share = isolate(limits)
    const born = clock.now()
    void share.run(env, 'k', () => new Promise(() => {}), () => undefined)
    await sleep(40)
    const age = clock.now() - born
    assert.ok(age < limits.buildShareStaleMs, 'the marker is still fresh when B arrives')
    let started = clock.now()
    await share.run(env, 'k', async () => 'B', () => undefined)
    const partial = clock.now() - started
    assert.ok(partial >= limits.buildShareStaleMs - age && partial < limits.buildShareStaleMs - age + clock.step, `B waited out the rest of the marker's life (${partial} ms of ${limits.buildShareStaleMs - age}), not the ${limits.buildShareWaitMs} ms wait`)
    void share.run(env, 'other', () => new Promise(() => {}), () => undefined)
    await sleep(150)
    started = clock.now()
    await share.run(env, 'other', async () => 'C', () => undefined)
    assert.equal(clock.now() - started, 0, 'a marker older than the staleness window costs nothing')
  })

  await timed('a clock that does not move cannot lengthen the wait: the step count bounds it as well, to exactly that many steps', [SLOW, IDEAL], async (clock) => {
    const share = isolate()
    const frozen = Date.now()
    const moving = Date.now
    void share.run(env, 'k', () => new Promise(() => {}), () => undefined)
    await sleep(10)
    Date.now = () => frozen
    try {
      const started = clock.now() // the scheduler's own reading: Date.now is the thing held still
      assert.notEqual(await within(share.run(env, 'k', async () => 'B', () => undefined), 5000), HELD)
      const steps = Math.ceil(LIMITS.buildShareWaitMs / LIMITS.buildSharePollMs)
      assert.equal(clock.now() - started, steps * clock.step, `${steps} timer steps with a frozen clock, no more and no fewer`)
    } finally { Date.now = moving }
  })

  await timed('different keys never wait on each other', [SLOW], async (clock) => {
    const share = isolate()
    void share.run(env, 'x', () => new Promise(() => {}), () => undefined)
    await sleep(10)
    const started = clock.now()
    assert.equal(await share.run(env, 'y', async () => 'y', () => undefined), 'y')
    assert.equal(clock.now() - started, 0, 'a different key has no marker to wait on')
  })

  await check('a finished result in the memo is returned with no build and no wait', async () => {
    const share = isolate()
    let builds = 0
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'x' }, () => 'done'), 'done')
    assert.equal(builds, 0)
  })

  await check('remember is not a cache: a request that finds no builder running builds for itself, whatever was remembered', async () => {
    const share = isolate()
    share.remember(env, 'k', { body: 1 })
    let builds = 0
    assert.deepEqual(await share.run(env, 'k', async () => { builds += 1; return { body: 2 } }), { body: 2 })
    assert.equal(builds, 1, 'a repeat request sees what it would have seen without the module (a setting changed a moment ago shows at once)')
  })

  await timed('waiting on the short memo: the builder remembers its result, the waiter takes it', [SLOW], async () => {
    const share = isolate()
    let builds = 0
    const a = share.run(env, 'k', async () => { builds += 1; await sleep(100); share.remember(env, 'k', 'A-body'); return 'A-body' })
    await sleep(20)
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'B-body' }), 'A-body')
    assert.equal(builds, 1)
    await a
  })

  await timed('a waiter takes only a result stored after the builder it waited on started, never an older one', [SLOW], async () => {
    const share = isolate()
    share.remember(env, 'k', 'OLD-body')
    await sleep(15)
    let builds = 0
    const a = share.run(env, 'k', async () => { builds += 1; await sleep(100); share.remember(env, 'k', 'NEW-body'); return 'NEW-body' })
    await sleep(20)
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'B-body' }), 'NEW-body', 'not the body remembered before the builder started')
    assert.equal(builds, 1)
    await a
  })

  await timed('remember never outlives the stored entry it mirrors: a lifetime shorter than the window wins', [SLOW], async () => {
    const share = isolate()
    // The builder stores its result at once (lifetime 40 ms, or the full window) and keeps working; a waiter that arrives later looks at it.
    for (const [key, lifetime, expected] of [['short', 40, 'rebuilt'], ['long', undefined, 'body']]) {
      const a = share.run(env, key, async () => { share.remember(env, key, 'body', lifetime); await sleep(220); return 'A' })
      await sleep(100)
      assert.equal(await share.run(env, key, async () => 'rebuilt'), expected, key === 'short' ? 'the 40 ms entry is gone although the window is 300 ms' : 'inside the window the entry is taken')
      await a
    }
  })

  await timed('the limits are the plan\'s: Paid waits 1,000 ms on a dead builder, Free 2,000 ms', [SLOW], async (clock) => {
    for (const [tier, expected, polls] of [['paid', 1000, 50], ['free', 2000, 100]]) {
      const planTier = load('lib/planTier.ts')
      const tierEnv = { PLAN_TIER: tier }
      load('lib/buildShare.ts', { './planTier': planTier })
      const share = globalThis[KEY]
      const limits = planTier.getPlanLimits(tierEnv)
      assert.deepEqual([limits.buildShareWaitMs, limits.buildSharePollMs], [expected, polls])
      void share.run(tierEnv, 'k', () => new Promise(() => {}), () => undefined)
      await sleep(10)
      const started = clock.now()
      await share.run(tierEnv, 'k', async () => 'B', () => undefined)
      const waited = clock.now() - started
      assert.ok(waited >= expected && waited < expected + clock.cost(polls), `${tier}: waited ${waited} ms for a ${expected} ms cap (one step is ${clock.cost(polls)})`)
    }
  })

  // ---- real timers: the module works with them. No upper bound on the time: that is what the cases above are for.
  await check('real timers: A slow, B arrives meanwhile and takes A\'s result', async () => {
    const share = isolate()
    const memo = {}
    const built = []
    const a = share.run(env, 'k', async () => { built.push('A'); await sleep(120); memo.value = 'A-result'; return 'A-result' }, () => memo.value)
    await sleep(20)
    const b = share.run(env, 'k', async () => { built.push('B'); return 'B-result' }, () => memo.value)
    assert.equal(await a, 'A-result')
    assert.equal(await b, 'A-result')
    assert.deepEqual(built, ['A'])
  })

  await check('real timers: DEAD BUILDER, B answers and never hangs', async () => {
    const share = isolate()
    const memo = {}
    void share.run(env, 'k', () => new Promise(() => {}), () => memo.value)
    await sleep(20)
    const b = await within(share.run(env, 'k', async () => { memo.value = 'B-result'; return 'B-result' }, () => memo.value), 5000)
    assert.equal(b, 'B-result')
  })

  console.log(`\n${passed} passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
