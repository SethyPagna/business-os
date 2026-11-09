'use strict'
// What the Inventory Check routes rely on from lib/readSwitches.ts (6.0.1048). The lane wrote this against its stand-in for P0.3's store; at compose
// (rc/20261105a) the stand-in is gone and P0.3's store is the module, so this now runs the REAL store with a fake clock and a fake D1 under the real
// lib/db.ts and keeps the lane's contract: both Inventory Check switches are known names, only the exact token 'on' is ON (the pre-P0.3 object shape
// is not), a bad read is OFF for the memo window, one statement serves every switch for the plan's window (Free 15 s: planTier.ts
// readSwitchMemoSeconds, no literal here), callers inside one request share a running read, and a reset forces the next read.
//
// Run: node scripts/test-read-switches-standin-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, requireFor = require) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}

const db = load('lib/db.ts', (id) => (id === './importMaintenanceFence' ? { getImportFencedDb() {}, withImportMaintenanceWriteFence() {}, isImportMaintenanceFenceError: () => false, ImportMaintenanceFenceError: class extends Error {} } : require(id)))
// The memo window is the plan's, so the plan module is the real one and its tier cache is shared with the store.
const planTier = load('lib/planTier.ts')
const sw = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics() {} } : id === './planTier' ? planTier : require(id)))
const MEMO_MS = planTier.getPlanLimits({ PLAN_TIER: 'free' }).readSwitchMemoSeconds * 1000

function fakeEnv(raw, extraRows = []) {
  const state = { sql: [], binds: [], attempts: 0, raw, fail: null, gate: null, PLAN_TIER: 'free' }
  const all = async () => {
    state.attempts += 1
    if (state.gate) await state.gate
    if (state.fail) throw state.fail
    const results = [...(state.raw === null ? [] : [{ key: 'read_switches', value: state.raw }]), ...extraRows]
    return { results, meta: { rows_read: results.length, rows_written: 0, duration: 0.1 } }
  }
  state.DB = { prepare(sql) { state.sql.push(sql); return { bind(...values) { state.binds.push(values); return { all } } } } }
  return state
}
const stored = (obj) => JSON.stringify(obj)
let clock = 1_000_000
const newStore = () => sw.createReadSwitchStore({ now: () => clock })

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the two Inventory Check switches are known names, and every unreadable shape is off for both', () => {
    for (const name of ['ic_simple', 'ic_fix_stock']) assert.ok(sw.KNOWN_READ_SWITCHES.includes(name), name + ' is in KNOWN_READ_SWITCHES (an unlisted name reads OFF whatever is stored)')
    for (const raw of [null, undefined, '', '{}', 'not json', '[]', '"on"', '42', 'null', stored({ switches: [] }), stored({ switches: 'on' }), stored({ switches: { ic_simple: 'ON' } }), stored({ switches: { ic_simple: true } }),
      stored({ switches: { ic_simple: 1 } }), stored({ switches: { ic_simple: { state: 'on' }, ic_fix_stock: { state: 'on' } } }), stored({ switches: { ic_simple: ' on' } }), stored({ switch: { ic_simple: 'on' } })]) {
      const parsed = sw.parseReadSwitches(raw)
      assert.deepEqual(Object.keys(parsed.switches), [...sw.KNOWN_READ_SWITCHES], 'only names this build knows')
      for (const name of sw.KNOWN_READ_SWITCHES) assert.deepEqual(parsed.switches[name], { state: 'off', rate: 0 }, `${name}: ${String(raw)}`)
    }
  })

  await check('the exact tokens parse: on, off, shadow:<rate> clamped to 0.1; the pre-P0.3 object shape, a bare shadow and shadow:0 are off', () => {
    const parsed = sw.parseReadSwitches(stored({ epoch: 7, set_at: '2026-11-03T00:05:00Z', set_by: 5, switches: { ic_simple: 'on', ic_fix_stock: 'shadow:0.05' } }))
    // The store lists every known switch (other slices' names read off here), so the two of this lane are compared by name.
    assert.deepEqual({ ...parsed, switches: { ic_simple: parsed.switches.ic_simple, ic_fix_stock: parsed.switches.ic_fix_stock } },
      { epoch: 7, setAt: '2026-11-03T00:05:00Z', setBy: 5, switches: { ic_simple: { state: 'on', rate: 0 }, ic_fix_stock: { state: 'shadow', rate: 0.05 } } })
    for (const name of sw.KNOWN_READ_SWITCHES.filter((known) => known !== 'ic_simple' && known !== 'ic_fix_stock')) assert.deepEqual(parsed.switches[name], { state: 'off', rate: 0 }, name + ' is not set by this document')
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { ic_simple: 'shadow:0.5' } })).switches.ic_simple, { state: 'shadow', rate: 0.1 })
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { ic_simple: 'off' } })).switches.ic_simple, { state: 'off', rate: 0 })
    for (const token of ['shadow', 'shadow:0', 'shadow:', 'shadow:-1', 'shadow:abc', 'On', 'yes']) assert.equal(sw.parseSwitchToken(token).state, 'off', token)
    assert.equal(sw.formatSwitchToken(sw.parseSwitchToken('on')), 'on'); assert.equal(sw.formatSwitchToken(sw.parseSwitchToken('shadow:0.05')), 'shadow:0.05')
    assert.equal(sw.parseReadSwitches(stored({ epoch: 3, switches: { ic_simple: 'ON' } })).epoch, 3, 'a bad token does not discard the epoch')
    for (const epoch of [1.5, -1, '3', null, true, {}, [2]]) assert.equal(sw.parseReadSwitches(stored({ epoch })).epoch, 0, JSON.stringify(epoch))
  })

  await check('one statement reads both switches for the plan\'s window: the statement and its binds are P0.3\'s, the second switch costs no call', async () => {
    const env = fakeEnv(stored({ epoch: 4, switches: { ic_simple: 'on', ic_fix_stock: 'off' } }), [{ key: 'data_epoch', value: 'a'.repeat(32) }])
    const store = newStore()
    assert.equal((await store.read(env, 'ic_simple')).on, true)
    assert.equal((await store.read(env, 'ic_fix_stock')).on, false)
    assert.deepEqual(await store.read(env, 'ic_simple'), { state: 'on', rate: 0, epoch: 4, on: true })
    assert.equal(env.attempts, 1, 'a cold isolate asks once')
    assert.equal(sw.SWITCH_ROWS_SQL, 'SELECT key, value FROM system_flags WHERE key IN (@switches, @epoch)')
    assert.deepEqual(env.sql, ['SELECT key, value FROM system_flags WHERE key IN (?1, ?2)'])
    assert.deepEqual(env.binds, [['read_switches', 'data_epoch']])
    assert.equal(sw.READ_SWITCH_MEMO_MS, undefined, 'the window is the plan\'s (planTier.ts readSwitchMemoSeconds), not a literal in the module')
    clock += MEMO_MS - 1
    await store.read(env, 'ic_simple'); assert.equal(env.attempts, 1, 'still the memo one millisecond before it expires')
    clock += 1
    env.raw = stored({ epoch: 5, switches: { ic_simple: 'off', ic_fix_stock: 'on' } })
    assert.deepEqual([(await store.read(env, 'ic_simple')).on, (await store.read(env, 'ic_fix_stock')).on], [false, true])
    assert.equal(env.attempts, 2, 'at the end of the window the next caller asks again and sees the new document')
  })

  await check('a reset forgets the memo at once; the next caller reads', async () => {
    const env = fakeEnv(stored({ switches: { ic_simple: 'on' } }))
    const store = newStore()
    assert.equal((await store.read(env, 'ic_simple')).on, true)
    env.raw = stored({ switches: { ic_simple: 'off' } })
    assert.equal((await store.read(env, 'ic_simple')).on, true, 'inside the window the old answer stands')
    store.reset()
    assert.equal((await store.read(env, 'ic_simple')).on, false)
    assert.equal(env.attempts, 2)
  })

  await check('callers inside one request share a running read', async () => {
    const env = fakeEnv(stored({ switches: { ic_simple: 'on', ic_fix_stock: 'on' } }))
    let open; env.gate = new Promise((resolve) => { open = resolve })
    const store = newStore()
    // P0.3 shares a pending read inside one request only (a promise belongs to the request that made it, 6.0.1048 review B1).
    const pending = store.inRequest(() => [store.read(env, 'ic_simple'), store.read(env, 'ic_fix_stock'), store.read(env, 'ic_simple')])
    await Promise.resolve()
    open()
    assert.deepEqual((await Promise.all(pending)).map((reading) => reading.on), [true, true, true])
    assert.equal(env.attempts, 1, 'three callers, one statement')
  })

  await check('a failed read is OFF for the window, with one attempt and no retry; the next window reads again', async () => {
    const env = fakeEnv(stored({ switches: { ic_simple: 'on' } }))
    env.fail = new Error('D1_ERROR: unreachable')
    const store = newStore()
    assert.equal((await store.read(env, 'ic_simple')).on, false)
    assert.equal(env.attempts, 1, 'allOnce: the retry kernel does not run')
    env.fail = null
    assert.equal((await store.read(env, 'ic_simple')).on, false, 'inside the window the failure stands (fail closed)')
    clock += MEMO_MS
    assert.equal((await store.read(env, 'ic_simple')).on, true)
  })

  await check('an unknown name is off whatever is stored, and readSwitch / readSwitchState / resetReadSwitchMemo are the module-level forms of the same store', async () => {
    const env = fakeEnv(stored({ epoch: 2, switches: { ic_simple: 'on', other: 'on' } }))
    assert.equal(await sw.readSwitch(env, 'other'), false)
    assert.equal(await sw.readSwitch(env, 'ic_simple'), true)
    assert.deepEqual(await sw.readSwitchState(env, 'ic_fix_stock'), { state: 'off', rate: 0, epoch: 2, on: false })
    assert.equal(env.attempts, 1)
    env.raw = stored({ switches: { ic_simple: 'off' } })
    sw.resetReadSwitchMemo()
    assert.equal(await sw.readSwitch(env, 'ic_simple'), false)
    assert.equal(env.attempts, 2)
  })

  console.log(`${passed} groups passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
