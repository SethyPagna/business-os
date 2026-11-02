'use strict'
// P1.4 (6.0.1050): the report_atomic switch, without a database. Proves the stored-row parser fails closed, the 15 s memo and the
// in-flight share behave to the millisecond, the mode decision (OFF / ON / sampled shadow, never shadow on Free), the router calls
// exactly the reader it should, and the shadow comparison tells a match, a real mismatch, a concurrent write and a refusal apart
// without ever putting a business value in the log line or the datapoint. Five mutants of the source must each turn a check red.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const LIB = path.join(__dirname, '..', 'src', 'lib')
const FILES = ['readSwitches', 'reportAtomicSwitch', 'analytics', 'planTier', 'reportMoneyPrecision', 'moneyPrecision']

const read = name => fs.readFileSync(path.join(LIB, name + '.ts'), 'utf8').replace(/\r\n/g, '\n')
function seam(text, before, after) {
  assert.equal(text.split(before).length, 2, 'MUTANT_SEAM_MISSING: ' + before)
  return text.replace(before, () => after)
}
const MUTANTS = {
  'shadow-clamp-removed': { file: 'readSwitches', edit: t => seam(t, 'Math.min(rate, READ_SWITCH_SHADOW_MAX_RATE)', 'rate') },
  'shadow-allowed-on-free': { file: 'reportAtomicSwitch', edit: t => seam(t, " || resolvePlanTier(env) === 'free'", '') },
  'no-write-between': { file: 'reportAtomicSwitch', edit: t => seam(t, 'if (reportCanonicalJson(again) === servedJson) {', 'if (true) {') },
  'sample-boundary-inclusive': { file: 'reportAtomicSwitch', edit: t => seam(t, 'sampler() < reading.rate', 'sampler() <= reading.rate') },
  'no-inflight-share': { file: 'readSwitches', edit: t => seam(t, '  if (inflight) return inflight\n', '') },
}

function load(mutant) {
  const compiled = {}
  const exportsOf = {}
  const state = { dates: [], db: null }
  const require_ = (from) => (request) => {
    if (request === './db') return { getDb: env => env.__db }
    const name = request.replace(/^\.\//, '')
    if (FILES.includes(name)) return exportsOf[name] || (exportsOf[name] = evaluate(name))
    throw new Error('unexpected require ' + request + ' from ' + from)
  }
  const evaluate = name => {
    let text = read(name)
    if (mutant && MUTANTS[mutant].file === name) text = MUTANTS[mutant].edit(text)
    const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module_ = { exports: {} }
    new Function('module', 'exports', 'require', out)(module_, module_.exports, require_(name))
    return module_.exports
  }
  for (const name of FILES) { exportsOf[name] = exportsOf[name] || evaluate(name) }
  void compiled
  return { switches: exportsOf.readSwitches, router: exportsOf.reportAtomicSwitch, money: exportsOf.reportMoneyPrecision, plan: exportsOf.planTier, state }
}

// A fake D1: counts statements, can delay, fail, or answer with a stored row; AE collects datapoints.
function envWith({ row, delay = 0, fail = false, tier = 'paid' } = {}) {
  const points = []
  const env = { PLAN_TIER: tier, Business_OS_Analytics: { writeDataPoint: p => { points.push(p) } }, statements: 0, __db: null }
  env.__db = { prepare: sql => ({ all: async params => {
    env.statements += 1
    assert.match(sql, /FROM system_flags WHERE key IN/)
    assert.deepEqual(Object.keys(params).sort(), ['epoch', 'switches'])
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    if (fail) throw new Error('D1_ERROR')
    return row === undefined ? [] : [{ key: 'read_switches', value: row }, { key: 'data_epoch', value: '"not used here"' }]
  } }) }
  return { env, points }
}
const stored = state => JSON.stringify({ epoch: 3, switches: { report_atomic: state } })

async function runAll(mutant) {
  const m = load(mutant)
  const { switches, router } = m
  const queued = []
  const check = (name, fn) => queued.push({ name, fn })
  // The plan tier is read once per isolate, so every case starts from a clean one.
  const freshMemo = () => { switches.resetReadSwitchMemo(); m.plan.__resetPlanTierCacheForTests() }

  check('token parser: only on and shadow:<rate> count, a rate is clamped to the share limit', () => {
    const off = { state: 'off', rate: 0 }
    for (const bad of ['ON', 'On', 'true', true, 1, null, undefined, '', ' on', 'on ', 'shadow', 'shadow:', 'shadow:0', 'shadow:0.0', 'shadow:-1', 'shadow:1e-1', 'shadow:0.1 ', ' shadow:0.1', 'shadow: 0.1', 'shadow:1000', 'shadow:0,1', 'shadow:NaN', 'shadow:Infinity', {}, [], ['on'], 'shadow:0.0000001'])
      assert.deepEqual(switches.parseSwitchToken(bad), off, 'must be OFF: ' + JSON.stringify(bad))
    assert.deepEqual(switches.parseSwitchToken('on'), { state: 'on', rate: 0 })
    assert.deepEqual(switches.parseSwitchToken('shadow:0.05'), { state: 'shadow', rate: 0.05 })
    assert.deepEqual(switches.parseSwitchToken('shadow:0.1'), { state: 'shadow', rate: 0.1 })
    assert.deepEqual(switches.parseSwitchToken('shadow:5'), { state: 'shadow', rate: 0.1 }, 'a rate above the share limit is clamped, never honoured')
    assert.deepEqual(switches.parseSwitchToken('shadow:100'), { state: 'shadow', rate: 0.1 })
  })

  check('row parser: any parse error, wrong shape, unknown name or inherited key is OFF', () => {
    const off = { state: 'off', rate: 0 }
    for (const bad of [null, undefined, '', 'not json', '[]', 'null', '"on"', '1', 'true', '{', '{"switches":[]}', '{"switches":null}', '{"switches":"on"}', '{"epoch":1}', '{"switches":{"report_atomic_x":"on"}}', '{"switches":{"__proto__":{"report_atomic":"on"}}}', '{"switches":{"constructor":{"report_atomic":"on"}}}', '{"switches":{"REPORT_ATOMIC":"on"}}'])
      assert.deepEqual(switches.parseReadSwitches(bad).switches.report_atomic, off, 'must be OFF: ' + bad)
    assert.deepEqual(switches.parseReadSwitches(stored('on')), { epoch: 3, switches: { report_atomic: { state: 'on', rate: 0 } } })
    assert.equal(switches.parseReadSwitches('{"epoch":1.5,"switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.parseReadSwitches('{"epoch":-2,"switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.parseReadSwitches('{"epoch":"3","switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.isKnownReadSwitch('report_atomic'), true); assert.equal(switches.isKnownReadSwitch('toString'), false); assert.equal(switches.isKnownReadSwitch('constructor'), false)
  })

  check('memo: one statement per 15 s window, refetch at exactly 15 s, a clock that moves backwards refetches', async () => {
    const real = Date.now; let now = 1_000_000; Date.now = () => now
    try {
      freshMemo(); const { env } = envWith({ row: stored('on') })
      assert.equal((await switches.readSwitchState(env, 'report_atomic')).on, true); assert.equal(env.statements, 1)
      now += 14_999; assert.equal((await switches.readSwitchState(env, 'report_atomic')).on, true); assert.equal(env.statements, 1, '14.999 s is still the memo')
      now += 1; await switches.readSwitchState(env, 'report_atomic'); assert.equal(env.statements, 2, '15 s refetches')
      now -= 5_000; await switches.readSwitchState(env, 'report_atomic'); assert.equal(env.statements, 3, 'a clock that moved back must not extend the memo')
      assert.equal(await switches.readSwitch(env, 'unknown_switch'), false); assert.equal((await switches.readSwitchState(env, 'toString')).state, 'off')
    } finally { Date.now = real }
  })

  check('in-flight share: concurrent first readers cost one statement, and one failure is one fallback datapoint', async () => {
    freshMemo(); const slow = envWith({ row: stored('on'), delay: 20 })
    const readings = await Promise.all(Array.from({ length: 8 }, () => switches.readSwitchState(slow.env, 'report_atomic')))
    assert.equal(slow.env.statements, 1, 'eight concurrent callers share one statement'); assert.ok(readings.every(r => r.state === 'on'))
    freshMemo(); const broken = envWith({ fail: true, delay: 5 })
    const failed = await Promise.all(Array.from({ length: 4 }, () => switches.readSwitchState(broken.env, 'report_atomic')))
    assert.ok(failed.every(r => r.state === 'off' && r.on === false)); assert.equal(broken.env.statements, 1)
    assert.deepEqual(broken.points.map(p => [p.indexes[0], p.blobs[0]]), [['switch_read', 'fallback']])
  })

  check('mode: ON is on; shadow is sampled by rate, boundary excluded, and never on Free; anything else is OFF', async () => {
    const mode = async (row, { tier = 'paid', sample = 0 } = {}) => { freshMemo(); router.setReportShadowSamplerForTests(() => sample); return router.reportAtomicMode(envWith({ row, tier }).env) }
    assert.equal(await mode(stored('on')), 'on'); assert.equal(await mode(stored('on'), { tier: 'free' }), 'on', 'ON is the owner decision, tier does not change it')
    assert.equal(await mode(stored('off')), 'off'); assert.equal(await mode(undefined), 'off'); assert.equal(await mode('garbage'), 'off')
    assert.equal(await mode(stored('shadow:0.1'), { sample: 0 }), 'shadow'); assert.equal(await mode(stored('shadow:0.1'), { sample: 0.0999 }), 'shadow')
    assert.equal(await mode(stored('shadow:0.1'), { sample: 0.1 }), 'off', 'the boundary is excluded: a rate of 0.1 is a tenth, not a tenth and one')
    assert.equal(await mode(stored('shadow:0.1'), { sample: 0.5 }), 'off')
    assert.equal(await mode(stored('shadow:0.1'), { sample: 0, tier: 'free' }), 'off', 'a shadow doubles the reads: never on Free')
    assert.equal(await mode(stored('shadow:5'), { sample: 0.09 }), 'shadow'); assert.equal(await mode(stored('shadow:5'), { sample: 0.2 }), 'off', 'shadow:5 is a tenth')
    router.setReportShadowSamplerForTests(null)
  })

  const SECRET = '8675309.42'
  const routeWith = async (row, { sample = 0, tier = 'paid', legacy, atomic, compare } = {}) => {
    freshMemo(); router.setReportShadowSamplerForTests(() => sample)
    const { env, points } = envWith({ row, tier }); const calls = []
    const logged = []; const realError = console.error; console.error = (...args) => { logged.push(args.join(' ')) }
    try {
      const result = await router.routeReportRead(env, 'unit', async () => { calls.push('legacy'); return legacy ? legacy(calls) : { total: 1 } }, async () => { calls.push('atomic'); return atomic ? atomic(calls) : { total: 1 } }, compare === undefined ? {} : { compare })
      return { result, calls, points, logged }
    } catch (error) { return { error, calls, points, logged } } finally { console.error = realError; router.setReportShadowSamplerForTests(null) }
  }

  check('router: OFF runs only the old reader, ON only the new one, an unsampled shadow only the old one, compare:false never compares', async () => {
    assert.deepEqual((await routeWith(undefined)).calls, ['legacy']); assert.deepEqual((await routeWith('junk')).calls, ['legacy'])
    assert.deepEqual((await routeWith(stored('on'))).calls, ['atomic'])
    assert.deepEqual((await routeWith(stored('shadow:0.1'), { sample: 0.5 })).calls, ['legacy'])
    const noCompare = await routeWith(stored('shadow:0.1'), { sample: 0, compare: false }); assert.deepEqual(noCompare.calls, ['legacy']); assert.equal(noCompare.points.length, 0)
    const freeShadow = await routeWith(stored('shadow:0.1'), { sample: 0, tier: 'free' }); assert.deepEqual(freeShadow.calls, ['legacy']); assert.equal(freeShadow.points.length, 0)
  })

  check('shadow: a sampled request serves the old result and records match / mismatch / write_between / refused / error', async () => {
    const shadow = stored('shadow:0.1')
    const match = await routeWith(shadow, { legacy: () => ({ a: 1, b: { x: 2 } }), atomic: () => ({ b: { x: 2 }, a: 1 }) })
    assert.deepEqual(match.calls, ['legacy', 'atomic']); assert.deepEqual(match.result, { a: 1, b: { x: 2 } }); assert.deepEqual(match.points.map(p => p.blobs), [['unit', 'match']]); assert.equal(match.logged.length, 0)
    assert.deepEqual(match.points[0].indexes, ['report_atomic_shadow'])

    const mismatch = await routeWith(shadow, { legacy: () => ({ totals: { revenue: SECRET, tx: 1 }, series: [1] }), atomic: () => ({ totals: { revenue: '1.00', tx: 2 }, series: [1] }) })
    assert.deepEqual(mismatch.calls, ['legacy', 'atomic', 'legacy'], 'a difference re-reads the old side to rule out a concurrent write')
    assert.deepEqual(mismatch.result, { totals: { revenue: SECRET, tx: 1 }, series: [1] }, 'the served result is the old reader result')
    assert.deepEqual(mismatch.points[0].blobs, ['unit', 'mismatch', 'totals.revenue', 'totals.tx'])
    assert.ok(!JSON.stringify(mismatch.points).includes(SECRET) && !mismatch.logged.join('').includes(SECRET) && !mismatch.logged.join('').includes('1.00'), 'no business value in the datapoint or the log line')
    assert.match(mismatch.logged.join(''), /shadow unit: mismatch totals\.revenue,totals\.tx/)

    let reads = 0
    const between = await routeWith(shadow, { legacy: () => ({ total: ++reads }), atomic: () => ({ total: 99 }) })
    assert.deepEqual(between.points[0].blobs, ['unit', 'write_between'], 'the old side moved between its reads: not a mismatch'); assert.equal(between.logged.length, 0)

    const refused = await routeWith(shadow, { atomic: () => { throw new m.money.ReportMoneyPrecisionError('too_many_rows') } })
    assert.deepEqual(refused.result, { total: 1 }); assert.deepEqual(refused.points[0].blobs, ['unit', 'refused:too_many_rows'])
    const broken = await routeWith(shadow, { atomic: () => { throw new Error('boom ' + SECRET) } })
    assert.deepEqual(broken.result, { total: 1 }, 'an atomic failure never reaches the caller'); assert.deepEqual(broken.points[0].blobs, ['unit', 'error'])
    assert.ok(!JSON.stringify(broken.points).includes(SECRET)); assert.ok(!broken.logged.join('').includes(SECRET), 'the error message is not logged either')
    const servedFails = await routeWith(shadow, { legacy: () => { throw new m.money.ReportMoneyPrecisionError('maintenance_restore') } })
    assert.equal(servedFails.error.code, 'maintenance_restore'); assert.deepEqual(servedFails.calls, ['legacy']); assert.equal(servedFails.points.length, 0, 'a refusal by the served reader is not a shadow outcome')
    const manyPaths = await routeWith(shadow, { legacy: () => ({ a: { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 1, a9: 1 } }), atomic: () => ({ a: { a1: 2, a2: 2, a3: 2, a4: 2, a5: 2, a6: 2, a7: 2, a8: 2, a9: 2 } }) })
    assert.equal(manyPaths.points[0].blobs.length, 2 + 6, 'at most six field names per datapoint')
  })

  check('canonical json: key order does not matter, array order and types do', () => {
    const c = router.reportCanonicalJson
    assert.equal(c({ a: 1, b: [2, { y: 1, x: 2 }] }), c({ b: [2, { x: 2, y: 1 }], a: 1 }))
    assert.notEqual(c([1, 2]), c([2, 1])); assert.notEqual(c({ a: 1 }), c({ a: '1' })); assert.notEqual(c({ a: null }), c({}))
    assert.equal(c(undefined), 'undefined'); assert.equal(c(null), 'null')
  })

  // Serial on purpose: the checks share the memo, the sampler, the clock and the console.
  const results = []
  for (const { name, fn } of queued) { try { await fn(); results.push({ name, ok: true }) } catch (error) { results.push({ name, ok: false, error }) } }
  return results
}

async function main() {
  const base = await runAll(null)
  for (const r of base) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name)
  const failed = base.filter(r => !r.ok)
  if (failed.length) { console.error(failed.map(r => r.name + ': ' + (r.error && r.error.message)).join('\n')); process.exit(1) }
  const killed = {}
  for (const mutant of Object.keys(MUTANTS)) {
    const mutated = await runAll(mutant)
    killed[mutant] = mutated.filter(r => !r.ok).map(r => r.name)
    assert.ok(killed[mutant].length > 0, 'MUTANT ' + mutant + ' survived every check')
    console.log('PASS mutant ' + mutant + ' killed by ' + killed[mutant].length + ' check(s)')
  }
  console.log(JSON.stringify({ status: 'PASS', checks: base.length, mutants: Object.fromEntries(Object.entries(killed).map(([k, v]) => [k, v.length])) }))
}
main().catch(error => { console.error(error); process.exit(1) })
