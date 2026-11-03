'use strict'
// lib/buildShare.ts: costly work that several requests want at the same moment is done once WITHOUT any request awaiting a promise another
// request created (workerd ties a promise to its request; the 6.0.1048 review, B1). The first request sets a "building since <time>"
// marker, a plain value; the others poll for its FINISHED result with their own timer, for at most buildShareWaitMs.
//
// Every case runs the real module with real timers and small stubbed limits (poll 10 ms, wait 300 ms, stale 600 ms). The case that matters
// most is the dead builder: request A starts, never finishes (it answered, or it was cancelled), and request B must still answer within the
// wait plus its own work. A mutant in which B awaits A's promise hangs there.
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const LIMITS = { buildSharePollMs: 10, buildShareWaitMs: 300, buildShareStaleMs: 600 }
// A fresh module instance = a fresh isolate (its own markers and memo). It installs its hook on the global, as the Worker does.
function isolate(limits = LIMITS) {
  load('lib/buildShare.ts', { './planTier': { getPlanLimits: () => limits } })
  return globalThis[KEY]
}
const env = {}
const HELD = Symbol('held')
// Answers within `ms` or says HELD: the check that a request is not waiting on something that never settles.
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => HELD)])

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the hook installs under the shared key and offers run and remember', async () => {
    const share = isolate()
    assert.equal(typeof share.run, 'function')
    assert.equal(typeof share.remember, 'function')
    assert.equal(KEY, Symbol.for('business-os.build-share.v1'))
  })

  await check('CONTROL: a lone request builds once and does not wait', async () => {
    const share = isolate()
    let builds = 0
    const started = Date.now()
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'a' }, () => undefined), 'a')
    assert.equal(builds, 1)
    assert.ok(Date.now() - started < 100, 'no marker, no wait')
  })

  await check('A slow, B arrives meanwhile: B returns A\'s finished result and builds nothing', async () => {
    const share = isolate()
    const memo = {}
    const peek = () => memo.value
    const built = []
    const a = share.run(env, 'k', async () => { built.push('A'); await sleep(120); memo.value = 'A-result'; return 'A-result' }, peek)
    await sleep(20)
    const b = share.run(env, 'k', async () => { built.push('B'); memo.value = 'B-result'; return 'B-result' }, peek)
    assert.equal(await a, 'A-result')
    assert.equal(await b, 'A-result', 'B took A\'s result')
    assert.deepEqual(built, ['A'], 'one build for two requests')
  })

  await check('five requests behind one slow builder: still one build', async () => {
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

  await check('DEAD BUILDER: A starts and never finishes; B answers within the wait plus its own work, and never hangs', async () => {
    const share = isolate()
    const memo = {}
    void share.run(env, 'k', () => new Promise(() => {}), () => memo.value)
    await sleep(20)
    const started = Date.now()
    const b = await within(share.run(env, 'k', async () => { await sleep(30); memo.value = 'B-result'; return 'B-result' }, () => memo.value), 2000)
    const waited = Date.now() - started
    assert.notEqual(b, HELD, 'B must not wait on A\'s promise')
    assert.equal(b, 'B-result', 'B did the work itself')
    assert.ok(waited >= LIMITS.buildShareWaitMs * 0.8, `B first gave A the wait (${waited} ms)`)
    assert.ok(waited < LIMITS.buildShareWaitMs + 30 + 150, `then built at once (${waited} ms)`)
    // The next caller finds B's result, not A's dead marker.
    assert.equal(await within(share.run(env, 'k', async () => 'never', () => memo.value), 500), 'B-result')
  })

  await check('A fails: the marker goes with it, so B does not sit out the wait', async () => {
    const share = isolate()
    const memo = {}
    const a = share.run(env, 'k', async () => { await sleep(80); throw new Error('boom') }, () => memo.value)
    a.catch(() => {})
    await sleep(20)
    const started = Date.now()
    const b = await share.run(env, 'k', async () => { memo.value = 'B-result'; return 'B-result' }, () => memo.value)
    assert.equal(b, 'B-result')
    assert.ok(Date.now() - started < LIMITS.buildShareWaitMs * 0.6, `B started building when A failed (${Date.now() - started} ms)`)
    await assert.rejects(a, /boom/)
  })

  await check('a result that cannot be stored (no memo) ends the wait when the builder finishes, not at the cap', async () => {
    const share = isolate()
    const a = share.run(env, 'k', async () => { await sleep(80); return 'A' }, () => undefined)
    await sleep(20)
    const started = Date.now()
    assert.equal(await share.run(env, 'k', async () => 'B', () => undefined), 'B')
    assert.ok(Date.now() - started < LIMITS.buildShareWaitMs * 0.6)
    await a
  })

  await check('a stale marker is ignored, and a waiter never outlasts its marker', async () => {
    const limits = { buildSharePollMs: 10, buildShareWaitMs: 300, buildShareStaleMs: 100 }
    const share = isolate(limits)
    void share.run(env, 'k', () => new Promise(() => {}), () => undefined)
    await sleep(40)
    let started = Date.now()
    await share.run(env, 'k', async () => 'B', () => undefined)
    const partial = Date.now() - started
    assert.ok(partial < 100 && partial >= 20, `B arrived at marker age 40 of 100 and waited out the rest, not the 300 ms wait (${partial} ms)`)
    void share.run(env, 'other', () => new Promise(() => {}), () => undefined)
    await sleep(150)
    started = Date.now()
    await share.run(env, 'other', async () => 'C', () => undefined)
    assert.ok(Date.now() - started < 40, 'a marker older than the staleness window costs nothing')
  })

  await check('a clock that does not move cannot lengthen the wait: the step count bounds it as well', async () => {
    const share = isolate()
    const realNow = Date.now
    const frozen = realNow.call(Date)
    void share.run(env, 'k', () => new Promise(() => {}), () => undefined)
    await sleep(10)
    Date.now = () => frozen
    try {
      const started = performance.now()
      assert.notEqual(await within(share.run(env, 'k', async () => 'B', () => undefined), 2000), HELD)
      const waited = performance.now() - started
      assert.ok(waited >= LIMITS.buildShareWaitMs * 0.8 && waited < LIMITS.buildShareWaitMs + 200, `${Math.round(waited)} ms with a frozen clock`)
    } finally { Date.now = realNow }
  })

  await check('different keys never wait on each other', async () => {
    const share = isolate()
    void share.run(env, 'x', () => new Promise(() => {}), () => undefined)
    await sleep(10)
    const started = Date.now()
    assert.equal(await share.run(env, 'y', async () => 'y', () => undefined), 'y')
    assert.ok(Date.now() - started < 60)
  })

  await check('a finished result in the memo is returned with no build and no wait', async () => {
    const share = isolate()
    let builds = 0
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'x' }, () => 'done'), 'done')
    assert.equal(builds, 0)
  })

  await check('remember: the short memo serves a repeat run for the wait window, then lets go', async () => {
    const share = isolate()
    share.remember(env, 'k', { body: 1 })
    let builds = 0
    assert.deepEqual(await share.run(env, 'k', async () => { builds += 1; return { body: 2 } }), { body: 1 })
    assert.equal(builds, 0, 'served from the memo')
    await sleep(LIMITS.buildShareWaitMs + 40)
    assert.deepEqual(await share.run(env, 'k', async () => { builds += 1; return { body: 2 } }), { body: 2 })
    assert.equal(builds, 1, 'after the window the work is done again')
  })

  await check('remember never outlives the stored entry it mirrors: a lifetime shorter than the window wins', async () => {
    const share = isolate()
    share.remember(env, 'short', 'body', 40)
    assert.equal(await share.run(env, 'short', async () => 'rebuilt'), 'body')
    await sleep(80)
    assert.equal(await share.run(env, 'short', async () => 'rebuilt'), 'rebuilt', 'the 40 ms entry is gone although the window is 300 ms')
  })

  await check('waiting on the short memo: the builder remembers its result, the waiter takes it', async () => {
    const share = isolate()
    let builds = 0
    const a = share.run(env, 'k', async () => { builds += 1; await sleep(100); share.remember(env, 'k', 'A-body'); return 'A-body' })
    await sleep(20)
    assert.equal(await share.run(env, 'k', async () => { builds += 1; return 'B-body' }), 'A-body')
    assert.equal(builds, 1)
    await a
  })

  await check('the limits are the plan\'s: Paid waits 1,000 ms on a dead builder, Free 2,000 ms', async () => {
    for (const [tier, expected] of [['paid', 1000], ['free', 2000]]) {
      const planTier = load('lib/planTier.ts')
      const tierEnv = { PLAN_TIER: tier }
      load('lib/buildShare.ts', { './planTier': planTier })
      const share = globalThis[KEY]
      assert.equal(planTier.getPlanLimits(tierEnv).buildShareWaitMs, expected)
      void share.run(tierEnv, 'k', () => new Promise(() => {}), () => undefined)
      await sleep(10)
      const started = Date.now()
      await share.run(tierEnv, 'k', async () => 'B', () => undefined)
      const waited = Date.now() - started
      assert.ok(waited >= expected * 0.9 && waited < expected + 300, `${tier}: waited ${waited} ms for a ${expected} ms cap`)
    }
  })

  console.log(`\n${passed} passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
