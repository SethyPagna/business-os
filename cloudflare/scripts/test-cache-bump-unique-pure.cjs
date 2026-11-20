'use strict'
// icr0 slice 1 (DESIGN-ic-cache-versions section 4): the bump in lib/cache.ts. KV has no compare-and-set and a failed read was taken for "never bumped", so:
//   1. two bumps of one namespace that overlap (both read n) wrote n + 1 twice: a reader that cached between them under n + 1 was not invalidated by the second;
//   2. a KV get that threw was read as absent and the counter was written back to 1, making every entry cached under k2:1 reachable again;
//   3. a bump that threw was never tried again and never counted.
// Now every KV value a bump writes is unique and above every earlier one, a get that throws is unknown, a failed bump is tried once more, and one given up is recorded
// (cache_bump_failed) while the caller still never sees an error. Runs the REAL lib/cache.ts with a fake KV, a fake D1 and a fake quota guard; every plant of the
// old behaviour must turn a check red.
// Run: node scripts/test-cache-bump-unique-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = process.env.CACHE_TS || path.join(__dirname, '..', 'src', 'lib', 'cache.ts') // CACHE_TS=<file>: run the checks against another copy (the required-red run on the old code)
const quiet = console.error
console.error = () => {} // the bump logs every failure it is made to swallow
const original = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n')

function build(edits = []) {
  let text = original
  for (const [from, to] of edits) {
    assert.equal(text.split(from).length - 1, 1, `plant must match once: ${from.slice(0, 60)}`)
    text = text.replace(from, () => to)
  }
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const ctx = { kv: new Map(), puts: [], d1: new Map(), d1Batches: 0, quotaCalls: 0, quotaThrows: 0, analytics: [], getFails: 0, putFails: 0, gate: null, gets: 0 }
  const db = {
    prepare() { return { async get() { return undefined }, async all(params) { return params.filter((n) => ctx.d1.has(n)).map((namespace) => ({ namespace, version: ctx.d1.get(namespace) })) } } },
    async batch() { ctx.d1Batches += 1; if (ctx.d1BatchFails) throw new Error('D1 down'); return [] },
  }
  const requireFor = (id) => {
    if (id === './db') return { getDb: () => db }
    if (id === './quotaGuard') return { consumeQuota: async () => { ctx.quotaCalls += 1; if (ctx.quotaThrows > 0) { ctx.quotaThrows -= 1; throw new Error('quota guard down') } return { zone: 'ok' } } }
    if (id === './cacheKey') return { unsafeVersionToken: () => 'unsafe', cacheKeyRequest: async () => null, isUnsafeVersion: () => false, cacheIdentity: () => null, deploymentId: () => 'x' }
    if (id === './analytics') return { recordAnalytics: (_env, event) => ctx.analytics.push(event) }
    return require(id)
  }
  const mod = { exports: {} }
  // The clock stands still, so two bumps in one millisecond are the case under test (not a coincidence of timing).
  const clock = { now: () => 1_800_000_000_000 }
  new Function('exports', 'require', 'module', '__filename', '__dirname', 'Date', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename), clock)
  const env = {
    CACHE: {
      async get(key) {
        ctx.gets += 1
        if (ctx.getFails > 0) { ctx.getFails -= 1; throw new Error('KV get failed') }
        const value = ctx.kv.has(key) ? ctx.kv.get(key) : null
        if (ctx.gate) await ctx.gate()
        return value
      },
      async put(key, value) { if (ctx.putFails > 0) { ctx.putFails -= 1; throw new Error('KV put failed') } ctx.puts.push([key, value]); ctx.kv.set(key, value) },
      async delete(key) { ctx.kv.delete(key) },
    },
  }
  return { cache: mod.exports, ctx, env }
}

const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`) } }

/** Both bumps have read the counter before either writes: the barrier opens when two gets are waiting. */
async function overlap(w) {
  let waiting = 0
  const open = []
  w.ctx.gate = () => new Promise((resolve) => { open.push(resolve); waiting += 1; if (waiting === 2) for (const go of open) go() })
  w.ctx.kv.set('v2:x', '5')
  await Promise.all([w.cache.bumpVersions(w.env, ['x']), w.cache.bumpVersions(w.env, ['x'])])
  w.ctx.gate = null
}

const SCENARIOS = {
  'two overlapping bumps write different values, both above the counter they read': async (w) => {
    await overlap(w)
    assert.equal(w.ctx.puts.length, 2)
    const [a, b] = w.ctx.puts.map(([, value]) => Number(value))
    assert.notEqual(a, b, 'a reader that cached between the two bumps is invalidated by the second')
    assert.ok(a > 5 && b > 5)
  },
  'a get that throws is unknown: the counter is not written back below what it held': async (w) => {
    w.ctx.kv.set('v2:x', '57')
    w.ctx.getFails = 1
    await w.cache.bumpVersions(w.env, ['x'])
    assert.equal(w.ctx.puts.length, 1)
    assert.ok(Number(w.ctx.puts[0][1]) > 57, `wrote ${w.ctx.puts[0][1]}`)
  },
  'a failed bump is tried once more (the first attempt throws, the second writes)': async (w) => {
    w.ctx.quotaThrows = 1
    await w.cache.bumpVersions(w.env, ['x'])
    assert.equal(w.ctx.quotaCalls, 2, 'a second attempt ran')
    assert.equal(w.ctx.puts.length, 1)
    assert.equal(w.ctx.analytics.length, 0, 'a bump that landed on the retry is not a failure')
  },
  'a bump that fails twice is recorded, and the caller still gets no error': async (w) => {
    w.ctx.quotaThrows = 2
    await w.cache.bumpVersions(w.env, ['x', 'y'])
    assert.equal(w.ctx.quotaCalls, 2, 'exactly one retry')
    assert.equal(w.ctx.puts.length, 0)
    assert.deepEqual(w.ctx.analytics.map((event) => event.kind), ['cache_bump_failed'])
    assert.deepEqual(w.ctx.analytics[0].labels, ['x', 'y'])
  },
  'KV and D1 both failing is recorded (the D1 handoff failure is no longer swallowed inside the bump)': async (w) => {
    w.ctx.putFails = 2
    w.ctx.d1BatchFails = true
    await w.cache.bumpVersions(w.env, ['x'])
    assert.equal(w.ctx.analytics.length, 1, JSON.stringify(w.ctx.analytics))
  },
  'a run of bumps with reads failing at random never goes down, and never repeats': async (w) => {
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    w.ctx.kv.set('v2:x', '3')
    const seen = [3]
    for (let i = 0; i < 300; i += 1) {
      if (rand() < 0.4) w.ctx.getFails = 1
      await w.cache.bumpVersions(w.env, ['x'])
      seen.push(Number(w.ctx.kv.get('v2:x')))
    }
    for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] > seen[i - 1], `step ${i}: ${seen[i - 1]} then ${seen[i]}`)
    assert.ok(seen.every((n) => Number.isSafeInteger(n)))
  },
  'a healthy first bump still gives a positive integer and the D1 mode is untouched': async (w) => {
    w.ctx.d1.set('x', 9)
    await w.cache.bumpVersions(w.env, ['x'])
    assert.equal(w.ctx.puts.length, 0, 'a namespace held in D1 stays in D1')
    assert.equal(w.ctx.d1Batches, 1)
    await w.cache.bumpVersions(w.env, ['fresh'])
    assert.ok(Number(w.ctx.kv.get('v2:fresh')) >= 1)
  },
}

const PLANTS = [
  ['P1 the old +1 (overlapping bumps write the same value)', [['String(nextUniqueVersion(currentKv))', 'String(currentKv + 1)']], ['two overlapping bumps write different values, both above the counter they read', 'a get that throws is unknown: the counter is not written back below what it held']],
  ['P2 no lastIssued separation in one isolate', [['lastIssuedVersion = Math.max(candidate, lastIssuedVersion + 1)', 'lastIssuedVersion = candidate'], ['Date.now() * VERSION_CLOCK_SCALE + (random[0] % VERSION_CLOCK_SCALE)', 'Date.now() * VERSION_CLOCK_SCALE']], ['two overlapping bumps write different values, both above the counter they read']],
  ['P3 no retry', [['if (attempt === 1) continue', 'if (attempt === 1) { console.error("x"); return }']], ['a failed bump is tried once more (the first attempt throws, the second writes)']],
  ['P4 failure not recorded', [["kind: 'cache_bump_failed'", "kind: 'nothing'"]], ['a bump that fails twice is recorded, and the caller still gets no error']],
  ['P5 the D1 handoff failure swallowed again', [["entries.map((entry) => entry.namespace), error)\n    throw error", "entries.map((entry) => entry.namespace), error)"]], ['KV and D1 both failing is recorded (the D1 handoff failure is no longer swallowed inside the bump)']],
]

async function main() {
  for (const [name, run] of Object.entries(SCENARIOS)) await check(name, () => run(build()))
  for (const [name, edits, mustFail] of PLANTS) {
    await check(`plant caught: ${name}`, async () => {
      for (const scenario of mustFail) {
        let caught = false
        try { await SCENARIOS[scenario](build(edits)) } catch (error) { if (/plant must match/.test(String(error && error.message))) throw error; caught = true }
        assert.equal(caught, true, `not caught by: ${scenario}`)
      }
    })
  }
  console.error = quiet
  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log(`PASS test-cache-bump-unique-pure (${passed})`)
}
main().catch((error) => { console.error(error); process.exit(1) })
