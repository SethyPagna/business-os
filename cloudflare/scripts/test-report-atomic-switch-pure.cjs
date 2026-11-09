'use strict'
// P1.4 (6.0.1050): the report_atomic and report_atomic_long switches, without a database. Proves the stored-row parser fails closed, the
// plan-sized memo (15 s on Free, 5 s on Paid: planTier.ts readSwitchMemoSeconds) behaves to the millisecond and no promise is shared between callers, the mode decision (OFF / ON / sampled shadow, never
// shadow on Free) is made per switch name, the router calls exactly the reader it should, and the shadow comparison tells a match, a real
// mismatch, a concurrent write and a refusal apart without ever putting a business value in the log line or the datapoint.
// Mutants of the source must each turn a check red.
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
  'shared-promise-returns': { file: 'readSwitches', edit: t => seam(t, 'async function load(env: Env, needEpoch: boolean): Promise<Memo> {', 'let shared: Promise<Memo> | null = null\n  function load(env: Env, needEpoch: boolean): Promise<Memo> {\n    if (shared) return shared\n    shared = loadOnce(env, needEpoch).finally(() => { shared = null })\n    return shared\n  }\n  async function loadOnce(env: Env, needEpoch: boolean): Promise<Memo> {') },
  'long-switch-reads-the-short-name': { file: 'reportAtomicSwitch', edit: t => seam(t, 'await readSwitchState(env, name)', 'await readSwitchState(env, REPORT_ATOMIC_SWITCH)') },
  'long-switch-unknown': { file: 'readSwitches', edit: t => seam(t, "'report_atomic', 'report_atomic_long', 'call_counting', 'expense_reads', 'ic_simple', 'ic_fix_stock', 'dash_overview_5m', 'ic_wired', 'catalog_ranked_scope'] as const", "'report_atomic', 'call_counting', 'expense_reads', 'ic_simple', 'ic_fix_stock', 'dash_overview_5m', 'ic_wired', 'catalog_ranked_scope'] as const") },
  'router-ignores-switch-option': { file: 'reportAtomicSwitch', edit: t => seam(t, 'reportAtomicMode(env, options.switch)', 'reportAtomicMode(env)') },
}

function load(mutant) {
  const compiled = {}
  const exportsOf = {}
  const state = { dates: [], db: null }
  const require_ = (from) => (request) => {
    if (request === './db') return { getDb: env => env.__db }
    if (request === 'node:async_hooks') return require('node:async_hooks')
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
const storedPair = (short, long) => JSON.stringify({ epoch: 3, switches: { report_atomic: short, report_atomic_long: long } })

// P0.3's store binds `Date.now` when its module is evaluated, so a clock the test swaps in later is never seen. The clock is therefore
// installed before the modules are evaluated, as one stable function that forwards to `nowImpl`, and a check moves time by replacing nowImpl.
let nowImpl = () => Date.now()
async function runAll(mutant) {
  const realNow = Date.now
  nowImpl = () => realNow.call(Date)
  Date.now = () => nowImpl()
  try { return await runAllChecks(mutant) } finally { Date.now = realNow; nowImpl = () => realNow.call(Date) }
}

async function runAllChecks(mutant) {
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
    for (const bad of [null, undefined, '', 'not json', '[]', 'null', '"on"', '1', 'true', '{', '{"switches":[]}', '{"switches":null}', '{"switches":"on"}', '{"epoch":1}', '{"switches":{"report_atomic_x":"on"}}', '{"switches":{"report_atomic_longer":"on"}}', '{"switches":{"REPORT_ATOMIC_LONG":"on"}}', '{"switches":{"__proto__":{"report_atomic_long":"on"}}}', '{"switches":{"__proto__":{"report_atomic":"on"}}}', '{"switches":{"constructor":{"report_atomic":"on"}}}', '{"switches":{"REPORT_ATOMIC":"on"}}'])
      for (const name of ['report_atomic', 'report_atomic_long']) assert.deepEqual(switches.parseReadSwitches(bad).switches[name], off, `${name} must be OFF: ${bad}`)
    assert.deepEqual(switches.parseReadSwitches(stored('on')), { epoch: 3, setAt: null, setBy: null, switches: { probe: off, report_atomic: { state: 'on', rate: 0 }, report_atomic_long: off, call_counting: off, expense_reads: off, ic_simple: off, ic_fix_stock: off, dash_overview_5m: off, ic_wired: off, catalog_ranked_scope: off } }, 'a stored name turns on only itself')
    assert.deepEqual(switches.parseReadSwitches(storedPair('off', 'shadow:0.05')), { epoch: 3, setAt: null, setBy: null, switches: { probe: off, report_atomic: off, report_atomic_long: { state: 'shadow', rate: 0.05 }, call_counting: off, expense_reads: off, ic_simple: off, ic_fix_stock: off, dash_overview_5m: off, ic_wired: off, catalog_ranked_scope: off } })
    assert.deepEqual(switches.parseReadSwitches('{"switches":{"report_atomic_long":"on","report_atomic":"junk"}}').switches, { probe: off, report_atomic: off, report_atomic_long: { state: 'on', rate: 0 }, call_counting: off, expense_reads: off, ic_simple: off, ic_fix_stock: off, dash_overview_5m: off, ic_wired: off, catalog_ranked_scope: off }, 'one bad token does not spoil the other name')
    assert.equal(switches.parseReadSwitches('{"epoch":1.5,"switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.parseReadSwitches('{"epoch":-2,"switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.parseReadSwitches('{"epoch":"3","switches":{"report_atomic":"on"}}').epoch, 0)
    assert.equal(switches.isKnownReadSwitch('report_atomic'), true); assert.equal(switches.isKnownReadSwitch('report_atomic_long'), true); assert.equal(switches.isKnownReadSwitch('expense_reads'), true); assert.equal(switches.isKnownReadSwitch('report_atomic_longer'), false); assert.equal(switches.isKnownReadSwitch('toString'), false); assert.equal(switches.isKnownReadSwitch('constructor'), false)
  })

  check('memo: one statement per plan window (Free 15 s), refetch at exactly the window, a clock that moves backwards refetches', async () => {
    const real = nowImpl; let now = 1_000_000; nowImpl = () => now
    try {
      freshMemo(); const { env } = envWith({ row: stored('on'), tier: 'free' })
      assert.equal((await switches.readSwitchState(env, 'report_atomic')).on, true); assert.equal(env.statements, 1)
      now += 14_999; assert.equal((await switches.readSwitchState(env, 'report_atomic')).on, true); assert.equal(env.statements, 1, '14.999 s is still the memo')
      now += 1; await switches.readSwitchState(env, 'report_atomic'); assert.equal(env.statements, 2, '15 s refetches')
      now -= 5_000; await switches.readSwitchState(env, 'report_atomic'); assert.equal(env.statements, 3, 'a clock that moved back must not extend the memo')
      assert.equal(await switches.readSwitch(env, 'unknown_switch'), false); assert.equal((await switches.readSwitchState(env, 'toString')).state, 'off')
      // The window is the plan's number, not a literal: Paid refetches at exactly 5 s.
      freshMemo(); now = 2_000_000; const paid = envWith({ row: stored('on'), tier: 'paid' })
      await switches.readSwitchState(paid.env, 'report_atomic'); now += 4_999; await switches.readSwitchState(paid.env, 'report_atomic'); assert.equal(paid.env.statements, 1, 'Paid: 4.999 s is still the memo')
      now += 1; await switches.readSwitchState(paid.env, 'report_atomic'); assert.equal(paid.env.statements, 2, 'Paid: 5 s refetches')
    } finally { nowImpl = real }
  })

  check('no promise is shared between callers: each cold reader reads for itself, then the memo serves the rest; every failure is one fallback datapoint', async () => {
    freshMemo(); const slow = envWith({ row: stored('on'), delay: 20 })
    const readings = await Promise.all(Array.from({ length: 8 }, () => switches.readSwitchState(slow.env, 'report_atomic')))
    assert.equal(slow.env.statements, 8, 'eight concurrent cold callers make eight reads: a Worker request never awaits I/O begun for another request'); assert.ok(readings.every(r => r.state === 'on'))
    await switches.readSwitchState(slow.env, 'report_atomic_long'); assert.equal(slow.env.statements, 8, 'the finished reads left one memo for both names')
    freshMemo(); const broken = envWith({ fail: true, delay: 5 })
    const failed = await Promise.all(Array.from({ length: 4 }, () => switches.readSwitchState(broken.env, 'report_atomic')))
    assert.ok(failed.every(r => r.state === 'off' && r.on === false)); assert.equal(broken.env.statements, 4)
    assert.deepEqual(broken.points.map(p => [p.indexes[0], p.blobs[0]]), Array.from({ length: 4 }, () => ['switch_read', 'fallback']))
    assert.equal((await switches.readSwitchState(broken.env, 'report_atomic_long')).state, 'off'); assert.equal(broken.env.statements, 4, 'an unreadable row is remembered as OFF for the memo window')
  })

  check('mode: ON is on; shadow is sampled by rate, boundary excluded, and never on Free; anything else is OFF', async () => {
    const mode = async (row, { tier = 'paid', sample = 0, name } = {}) => { freshMemo(); router.setReportShadowSamplerForTests(() => sample); return router.reportAtomicMode(envWith({ row, tier }).env, name) }
    assert.equal(await mode(storedPair('on', 'off')), 'on', 'no name asked means report_atomic'); assert.equal(await mode(storedPair('on', 'off'), { name: 'report_atomic_long' }), 'off', 'report_atomic does not turn the long switch on')
    assert.equal(await mode(storedPair('off', 'on'), { name: 'report_atomic_long' }), 'on'); assert.equal(await mode(storedPair('off', 'on')), 'off', 'the long switch does not turn report_atomic on')
    assert.equal(await mode(storedPair('on', 'shadow:0.1'), { name: 'report_atomic_long', sample: 0 }), 'shadow'); assert.equal(await mode(storedPair('shadow:0.1', 'on'), { sample: 0 }), 'shadow')
    assert.equal(await mode(storedPair('off', 'shadow:0.1'), { name: 'report_atomic_long', sample: 0, tier: 'free' }), 'off', 'the long switch never shadows on Free either')
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
  const routeWith = async (row, { sample = 0, tier = 'paid', legacy, atomic, compare, name } = {}) => {
    freshMemo(); router.setReportShadowSamplerForTests(() => sample)
    const { env, points } = envWith({ row, tier }); const calls = []
    const logged = []; const realError = console.error; console.error = (...args) => { logged.push(args.join(' ')) }
    try {
      const result = await router.routeReportRead(env, 'unit', async () => { calls.push('legacy'); return legacy ? legacy(calls) : { total: 1 } }, async () => { calls.push('atomic'); return atomic ? atomic(calls) : { total: 1 } }, { ...(compare === undefined ? {} : { compare }), ...(name === undefined ? {} : { switch: name }) })
      return { result, calls, points, logged }
    } catch (error) { return { error, calls, points, logged } } finally { console.error = realError; router.setReportShadowSamplerForTests(null) }
  }

  check('router: OFF runs only the old reader, ON only the new one, an unsampled shadow only the old one, compare:false never compares', async () => {
    assert.deepEqual((await routeWith(undefined)).calls, ['legacy']); assert.deepEqual((await routeWith('junk')).calls, ['legacy'])
    assert.deepEqual((await routeWith(stored('on'))).calls, ['atomic'])
    assert.deepEqual((await routeWith(stored('shadow:0.1'), { sample: 0.5 })).calls, ['legacy'])
    const noCompare = await routeWith(stored('shadow:0.1'), { sample: 0, compare: false }); assert.deepEqual(noCompare.calls, ['legacy']); assert.equal(noCompare.points.length, 0)
    const freeShadow = await routeWith(stored('shadow:0.1'), { sample: 0, tier: 'free' }); assert.deepEqual(freeShadow.calls, ['legacy']); assert.equal(freeShadow.points.length, 0)
    // Two switches, two decisions: the route reads the name it was given, and the default name is report_atomic.
    assert.deepEqual((await routeWith(storedPair('on', 'off'), { name: 'report_atomic_long' })).calls, ['legacy'], 'report_atomic ON does not move a long-report route')
    assert.deepEqual((await routeWith(storedPair('off', 'on'), { name: 'report_atomic_long' })).calls, ['atomic'])
    assert.deepEqual((await routeWith(storedPair('off', 'on'))).calls, ['legacy'], 'report_atomic_long ON does not move a totals route')
    assert.deepEqual((await routeWith(storedPair('on', 'off'))).calls, ['atomic'])
    const longShadow = await routeWith(storedPair('on', 'shadow:0.1'), { name: 'report_atomic_long', sample: 0 }); assert.deepEqual(longShadow.calls, ['legacy', 'atomic']); assert.deepEqual(longShadow.points.map(p => p.blobs), [['unit', 'match']])
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
