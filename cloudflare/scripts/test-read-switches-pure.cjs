'use strict'
// Read switches (lib/readSwitches.ts): one system_flags row, every unreadable shape is OFF, a 15 s memo, a header built from the
// memo alone. Runs the real module with a fake clock and a fake D1 under the real lib/db.ts, so "one attempt, no retry" is the
// real retry kernel's answer.
//
// Run: node scripts/test-read-switches-pure.cjs
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

const events = []
const db = load('lib/db.ts', (id) => (id === './importMaintenanceFence' ? { getImportFencedDb() {}, withImportMaintenanceWriteFence() {}, isImportMaintenanceFenceError: () => false, ImportMaintenanceFenceError: class extends Error {} } : require(id)))
// The memo window is the plan's (planTier.ts readSwitchMemoSeconds), so the plan module is the real one and its tier cache is shared with the store.
const planTier = load('lib/planTier.ts')
const sw = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics: (_env, event) => events.push(event) } : id === './planTier' ? planTier : require(id)))

function fakeEnv(rows, epoch = null) {
  // Free by default: its 15 s window is the one every timing below was written against; the plan check names Paid explicitly.
  const state = { sql: [], binds: [], attempts: 0, rows, epoch, fail: null, PLAN_TIER: 'free' }
  const all = async () => {
    state.attempts += 1
    if (state.fail) throw state.fail
    const results = [...(state.rows === null ? [] : [{ key: 'read_switches', value: state.rows }]), ...(state.epoch === null ? [] : [{ key: 'data_epoch', value: state.epoch }])]
    return { results, meta: { rows_read: results.length, rows_written: 0, duration: 0.1 } }
  }
  state.DB = {
    prepare(sql) {
      state.sql.push(sql)
      return { bind(...values) { state.binds.push(values); return { all } } }
    },
  }
  return state
}
const stored = (obj) => JSON.stringify(obj)
// Every switch any slice reads lives in this store (P0.3 'probe', P1.4 report_atomic / report_atomic_long, P1.1 call_counting, E1-F expense_reads, IC ic_simple / ic_fix_stock, TIME-1 dash_overview_5m, INV-A ic_wired / catalog_ranked_scope / products_parent_seek, ledger_keyset, ic_lot_counts, stock_bump_narrow, ledger_summary_lean, products_typed_order_js): the header lists them all, in this order.
const REPORT_NAMES = ['report_atomic', 'report_atomic_long', 'call_counting', 'expense_reads', 'ic_simple', 'ic_fix_stock', 'dash_overview_5m', 'ic_wired', 'catalog_ranked_scope', 'products_parent_seek', 'ledger_keyset', 'ic_lot_counts', 'stock_bump_narrow', 'ledger_summary_lean', 'products_typed_order_js']
const REPORT_OFF = { report_atomic: { state: 'off', rate: 0 }, report_atomic_long: { state: 'off', rate: 0 }, call_counting: { state: 'off', rate: 0 }, expense_reads: { state: 'off', rate: 0 }, ic_simple: { state: 'off', rate: 0 }, ic_fix_stock: { state: 'off', rate: 0 }, dash_overview_5m: { state: 'off', rate: 0 }, ic_wired: { state: 'off', rate: 0 }, catalog_ranked_scope: { state: 'off', rate: 0 }, products_parent_seek: { state: 'off', rate: 0 }, ledger_keyset: { state: 'off', rate: 0 }, ic_lot_counts: { state: 'off', rate: 0 }, stock_bump_narrow: { state: 'off', rate: 0 }, ledger_summary_lean: { state: 'off', rate: 0 }, products_typed_order_js: { state: 'off', rate: 0 } }
const REPORT_HEADER = ';report_atomic=0;report_atomic_long=0;call_counting=0;expense_reads=0;ic_simple=0;ic_fix_stock=0;dash_overview_5m=0;ic_wired=0;catalog_ranked_scope=0;products_parent_seek=0;ledger_keyset=0;ic_lot_counts=0;stock_bump_narrow=0;ledger_summary_lean=0;products_typed_order_js=0'
let clock = 1_000_000
const newStore = (extra = {}) => sw.createReadSwitchStore({ now: () => clock, ...extra })

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the parse matrix: absent, empty, garbage, wrong type and unknown values are all off with epoch 0', () => {
    for (const raw of [null, undefined, '', '{}', 'not json', '[]', '"on"', '42', 'null', stored({ switches: [] }), stored({ switches: 'on' }), stored({ epoch: 3, switches: { probe: 'ON' } }), stored({ switches: { probe: true } }), stored({ switches: { probe: 1 } }), stored({ switches: { probe: { state: 'on' } } }), stored({ switches: { probe: 'true' } }), stored({ switches: { probe: 'shadow' } }), stored({ switches: { probe: 'shadow:' } }), stored({ switches: { probe: 'shadow:-1' } }), stored({ switches: { probe: 'shadow:0' } }), stored({ switches: { probe: 'shadow:abc' } }), stored({ switches: { probe: ' on' } }), stored({ switches: { nope: 'on' } })]) {
      const parsed = sw.parseReadSwitches(raw)
      assert.equal(parsed.switches.probe.state, 'off', String(raw))
      assert.equal(parsed.switches.probe.rate, 0, String(raw))
      assert.deepEqual(Object.keys(parsed.switches), ['probe', ...REPORT_NAMES], 'only names this build knows')
    }
    assert.equal(sw.parseReadSwitches(null).epoch, 0)
    assert.equal(sw.parseReadSwitches(stored({ epoch: 3, switches: { probe: 'ON' } })).epoch, 3, 'a bad token does not discard the epoch')
  })

  await check('the exact tokens parse: on, shadow:<rate> with the rate clamped to 0.1, off', () => {
    assert.deepEqual(sw.parseReadSwitches(stored({ epoch: 7, set_at: '2026-11-02T00:05:00Z', set_by: 5, switches: { probe: 'on' } })), { epoch: 7, setAt: '2026-11-02T00:05:00Z', setBy: 5, switches: { probe: { state: 'on', rate: 0 }, ...REPORT_OFF } })
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { probe: 'shadow:0.05' } })).switches.probe, { state: 'shadow', rate: 0.05 })
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { probe: 'shadow:0.5' } })).switches.probe, { state: 'shadow', rate: 0.1 })
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { probe: 'shadow:5' } })).switches.probe, { state: 'shadow', rate: 0.1 })
    assert.deepEqual(sw.parseReadSwitches(stored({ switches: { probe: 'off' } })).switches.probe, { state: 'off', rate: 0 })
  })

  await check('a non-integer, negative or oversized epoch is 0; set_at and set_by are kept only when well formed', () => {
    for (const epoch of [1.5, -1, '3', null, true, Number.MAX_SAFE_INTEGER + 2, {}, [2]]) assert.equal(sw.parseReadSwitches(stored({ epoch })).epoch, 0, JSON.stringify(epoch))
    assert.equal(sw.parseReadSwitches(stored({ epoch: 2 })).epoch, 2)
    const bad = sw.parseReadSwitches(stored({ set_at: 12, set_by: '5' }))
    assert.equal(bad.setAt, null)
    assert.equal(bad.setBy, null)
    assert.equal(sw.parseReadSwitches(stored({ set_at: 'x'.repeat(41) })).setAt, null)
  })

  await check('the flip grammar accepts only off, on and shadow:<rate>; ON, true, shadow:0 and shadow: are refused, shadow:5 is clamped', () => {
    assert.deepEqual(sw.parseFlipState('off'), { state: 'off', rate: 0 })
    assert.deepEqual(sw.parseFlipState('on'), { state: 'on', rate: 0 })
    assert.deepEqual(sw.parseFlipState('shadow:5'), { state: 'shadow', rate: 0.1 })
    assert.deepEqual(sw.parseFlipState('shadow:0.02'), { state: 'shadow', rate: 0.02 })
    for (const bad of ['ON', 'On', 'true', true, 1, 'shadow', 'shadow:', 'shadow:0', 'shadow:-1', 'shadow:1e3', ' on', 'on ', '', null, undefined, {}, ['on'], 'observe', 'enforce']) assert.equal(sw.parseFlipState(bad), null, JSON.stringify(bad))
  })

  await check('serializing a flip keeps known names, bumps nothing by itself, and carries tokens a newer build wrote', () => {
    const previous = stored({ epoch: 4, set_at: 'a', set_by: 1, switches: { probe: 'shadow:0.05', future_slice: 'on', 'Bad Name': 'on', other: 7 } })
    const next = JSON.parse(sw.serializeReadSwitches(previous, { name: 'probe', entry: { state: 'on', rate: 0 } }, { epoch: 5, setAt: '2026-11-02T01:00:00.000Z', setBy: 9 }))
    assert.deepEqual(next, { epoch: 5, set_at: '2026-11-02T01:00:00.000Z', set_by: 9, switches: { future_slice: 'on', probe: 'on', report_atomic: 'off', report_atomic_long: 'off', call_counting: 'off', expense_reads: 'off', ic_simple: 'off', ic_fix_stock: 'off', dash_overview_5m: 'off', ic_wired: 'off', catalog_ranked_scope: 'off', products_parent_seek: 'off', ledger_keyset: 'off', ic_lot_counts: 'off', stock_bump_narrow: 'off', ledger_summary_lean: 'off', products_typed_order_js: 'off' } })
    const fresh = JSON.parse(sw.serializeReadSwitches('garbage', { name: 'probe', entry: { state: 'shadow', rate: 0.1 } }, { epoch: 1, setAt: 't', setBy: 2 }))
    assert.deepEqual(fresh, { epoch: 1, set_at: 't', set_by: 2, switches: { probe: 'shadow:0.1', report_atomic: 'off', report_atomic_long: 'off', call_counting: 'off', expense_reads: 'off', ic_simple: 'off', ic_fix_stock: 'off', dash_overview_5m: 'off', ic_wired: 'off', catalog_ranked_scope: 'off', products_parent_seek: 'off', ledger_keyset: 'off', ic_lot_counts: 'off', stock_bump_narrow: 'off', ledger_summary_lean: 'off', products_typed_order_js: 'off' } })
    assert.equal(sw.parseReadSwitches(sw.serializeReadSwitches(null, { name: 'probe', entry: { state: 'on', rate: 0 } }, { epoch: 1, setAt: 't', setBy: 2 })).switches.probe.state, 'on', 'round trip')
  })

  await check('readSwitch is true only for ON; shadow, off, an unknown name and an empty store are false', async () => {
    for (const [token, expected] of [['on', true], ['off', false], ['shadow:0.05', false], ['bogus', false]]) {
      const store = newStore()
      assert.equal((await store.read(fakeEnv(stored({ epoch: 1, switches: { probe: token } })), 'probe')).on, expected, token)
    }
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'on', unknown_here: 'on' } }))
    assert.equal((await store.read(env, 'unknown_here')).on, false, 'a name this build does not know is off even when stored ON')
    assert.equal((await newStore().read(fakeEnv(null), 'probe')).on, false, 'no row')
    const reading = await newStore().read(fakeEnv(stored({ epoch: 6, switches: { probe: 'shadow:0.5' } })), 'probe')
    assert.deepEqual(reading, { state: 'shadow', rate: 0.1, epoch: 6, on: false })
  })

  await check('the memo: one read per 15 s, refreshed at exactly 15 s, a fake clock, and a flip is seen by the next refresh', async () => {
    clock = 1_000_000
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'off' } }))
    assert.equal((await store.read(env, 'probe')).on, false)
    for (let i = 0; i < 5; i += 1) await store.read(env, 'probe')
    assert.equal(env.attempts, 1, 'six consults inside the period read once')
    env.rows = stored({ epoch: 2, switches: { probe: 'on' } })
    clock += 14_999
    assert.equal((await store.read(env, 'probe')).on, false, 'still the memo at 14.999 s')
    assert.equal(env.attempts, 1)
    clock += 1
    const refreshed = await store.read(env, 'probe')
    assert.equal(refreshed.on, true, 'refreshed at 15 s')
    assert.equal(refreshed.epoch, 2)
    assert.equal(env.attempts, 2)
    clock -= 60_000
    await store.read(env, 'probe')
    assert.equal(env.attempts, 3, 'a clock that went backwards never extends the memo')
  })

  await check('the read is the one PK lookup on system_flags, issued only when a switch is consulted, once per period', async () => {
    clock = 2_000_000
    const store = newStore()
    const env = fakeEnv(null)
    assert.equal(env.attempts, 0, 'building the store reads nothing')
    assert.equal(store.header(), null)
    assert.equal(store.salt(), null, 'no memo, no safe key')
    await store.read(env, 'probe')
    assert.deepEqual(env.sql.map((s) => s.replace(/\s+/g, ' ').trim()), ['SELECT key, value FROM system_flags WHERE key IN (?1, ?2)'])
    assert.deepEqual(env.binds, [['read_switches', 'data_epoch']], 'the switches row and the data epoch row share one statement')
  })

  await check('a D1 error is all OFF for the period, writes one fallback datapoint, and is not retried (one attempt on the real retry kernel)', async () => {
    clock = 3_000_000
    events.length = 0
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 9, switches: { probe: 'on' } }))
    env.fail = new Error('D1_ERROR: network connection lost')
    const reading = await store.read(env, 'probe')
    assert.deepEqual(reading, { state: 'off', rate: 0, epoch: 0, on: false })
    assert.equal(env.attempts, 1, 'a switch read is never retried (isRetryableD1Error would retry this message)')
    assert.deepEqual(events, [{ kind: 'switch_read', labels: ['fallback'] }])
    await store.read(env, 'probe')
    await store.read(env, 'probe')
    assert.equal(env.attempts, 1, 'the fallback is memoized for the period')
    assert.equal(events.length, 1, 'one datapoint per failed read, not per request')
    env.fail = null
    clock += 15_000
    assert.equal((await store.read(env, 'probe')).on, true, 'the next period reads the row again')
  })

  await check('the cap text and an unparsable row are both off, never on', async () => {
    clock = 4_000_000
    const store = newStore()
    const env = fakeEnv('{"epoch":2,"switches":{"probe":"on"')
    assert.equal((await store.read(env, 'probe')).on, false)
    const capped = fakeEnv(null)
    capped.fail = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.")
    assert.equal((await newStore().read(capped, 'probe')).on, false)
    assert.equal(capped.attempts, 1)
  })

  await check('the header is built from the memo alone: omitted while empty or older than the period, e=<epoch>;<name>=0|1 when fresh', async () => {
    clock = 5_000_000
    const store = newStore()
    assert.equal(store.header(), null, 'empty memo')
    const env = fakeEnv(stored({ epoch: 7, switches: { probe: 'on', future: 'on' } }))
    await store.read(env, 'probe')
    const attempts = env.attempts
    assert.equal(store.header(), 'e=7;probe=1' + REPORT_HEADER)
    assert.equal(env.attempts, attempts, 'building the header does no I/O')
    clock += 14_999
    assert.equal(store.header(), 'e=7;probe=1' + REPORT_HEADER)
    clock += 1
    assert.equal(store.header(), null, 'an expired memo says nothing about now')
    env.rows = stored({ epoch: 8, switches: { probe: 'shadow:0.05' } })
    await store.read(env, 'probe')
    assert.equal(store.header(), 'e=8;probe=0' + REPORT_HEADER, 'shadow is not on for a client')
    assert.ok(!/future/.test(store.header()), 'only names this build knows')
  })

  await check('the key salt is sw<epoch> while the memo is fresh and readable, and null otherwise: a flip off then on changes it, a failed or expired read has no key', async () => {
    clock = 5_500_000
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'on' } }))
    assert.equal(store.salt(), null)
    await store.read(env, 'probe')
    assert.equal(store.salt(), 'sw1')
    const seen = [store.salt()]
    for (const [epoch, token] of [[2, 'off'], [3, 'on']]) {
      store.prime(env, sw.parseReadSwitches(stored({ epoch, switches: { probe: token } })))
      seen.push(store.salt())
    }
    assert.deepEqual(seen, ['sw1', 'sw2', 'sw3'])
    assert.notEqual(seen[0], seen[2], 'off then on is a different salt: nothing cached before the flip is reachable after it')
    clock += 15_000
    assert.equal(store.salt(), null, 'an expired memo is no key')
    const failing = fakeEnv(null)
    failing.fail = new Error('D1_ERROR: network connection lost')
    const closed = newStore()
    await closed.read(failing, 'probe')
    assert.equal(closed.salt(), null, 'an unreadable store never falls back to a shared zero token')
    assert.equal(closed.header(), null, 'and claims nothing in the header')
  })

  await check('the data epoch is read with the switches, in the same call, and is null unless it is a well formed value on a readable store', async () => {
    clock = 5_600_000
    const good = fakeEnv(stored({ epoch: 1, switches: {} }), '0123456789abcdef0123456789abcdef')
    const store = newStore()
    assert.equal(await store.epoch(good), '0123456789abcdef0123456789abcdef')
    await store.read(good, 'probe')
    assert.equal(good.attempts, 1, 'the epoch costs no call of its own')
    assert.equal(await newStore().epoch(fakeEnv(stored({ epoch: 1, switches: {} }))), null, 'no data_epoch row yet')
    for (const bad of ['', 'XYZ', 'ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcdef0', 'short', ' 0123456789abcdef']) assert.equal(await newStore().epoch(fakeEnv(null, bad)), null, JSON.stringify(bad))
    const failing = fakeEnv(null, '0123456789abcdef0123456789abcdef')
    failing.fail = new Error('D1_ERROR: network connection lost')
    assert.equal(await newStore().epoch(failing), null, 'an unreadable store has no epoch')
    const rotates = newStore()
    const env = fakeEnv(null, '0123456789abcdef0123456789abcdef')
    assert.equal(await rotates.epoch(env), '0123456789abcdef0123456789abcdef')
    env.epoch = 'fedcba9876543210fedcba9876543210'
    clock += 15_000
    assert.equal(await rotates.epoch(env), 'fedcba9876543210fedcba9876543210', 'a rotation is seen by the next refresh')
  })

  await check('callers of ONE request that arrive while the flags are being read share that read: a cold isolate answering N cached sections reads once, not N times', async () => {
    clock = 5_900_000
    const env = fakeEnv(stored({ epoch: 2, switches: { probe: 'off' } }), '0123456789abcdef0123456789abcdef')
    const store = newStore()
    const answers = await store.inRequest(() => Promise.all([store.epoch(env), store.epoch(env), store.read(env, 'probe'), store.epoch(env), store.read(env, 'probe')]))
    assert.equal(env.attempts, 1, 'five concurrent callers, one statement')
    assert.deepEqual(answers.map((a) => (typeof a === 'string' ? a : a.epoch)), ['0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef', 2, '0123456789abcdef0123456789abcdef', 2])
    await store.epoch(env)
    assert.equal(env.attempts, 1, 'the fresh memo answers the next caller')
    clock += 15_000
    await store.inRequest(() => Promise.all([store.epoch(env), store.epoch(env), store.epoch(env)]))
    assert.equal(env.attempts, 2, 'the next period is one more statement, shared again')
    // Control: outside a request nothing is shared, so the check above is not passing by accident.
    clock += 15_000
    await Promise.all([store.epoch(env), store.epoch(env), store.epoch(env)])
    assert.equal(env.attempts, 5, 'three callers in no request: three statements')
    // A reset drops the shared read: the caller after it starts a new one and never joins a read that began before the reset.
    const slow = fakeEnv(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const gate = new Promise((resolve) => { slow.release = resolve })
    const realPrepare = slow.DB.prepare
    slow.DB.prepare = (sql) => { const statement = realPrepare(sql); return { bind: (...values) => { const bound = statement.bind(...values); return { all: async () => { const answer = await bound.all(); await gate; return answer } } } } }
    const rotating = newStore()
    const before = rotating.epoch(slow)
    rotating.reset()
    slow.epoch = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const after = rotating.epoch(slow)
    slow.release()
    assert.equal(await before, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    assert.equal(await after, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'a caller after a reset reads the world as it is now')
    assert.equal(slow.attempts, 2)
  })

  await check('B1 (review of 6.0.1048): a read another request started and never finished cannot hold this request: it reads for itself and answers', async () => {
    clock = 6_200_000
    const never = fakeEnv(stored({ epoch: 1, switches: {} }), 'cccccccccccccccccccccccccccccccc')
    never.DB = { prepare() { return { bind() { return { all: () => new Promise(() => {}) } } } } }
    const store = newStore()
    // Request A starts the read without waiting for it and answers (the 401 path of the bootstrap, a Promise.all that rejected early, a cancelled request).
    store.inRequest(() => { void store.epoch(never); return 'answered' })
    const fine = fakeEnv(stored({ epoch: 1, switches: {} }), 'dddddddddddddddddddddddddddddddd')
    const hung = () => new Promise((resolve) => setTimeout(() => resolve('HUNG'), 500))
    const raced = await Promise.race([store.inRequest(() => store.epoch(fine)), hung()])
    assert.equal(raced, 'dddddddddddddddddddddddddddddddd', 'request B is not held by request A read')
    assert.equal(fine.attempts, 1)
    // The same through the other doors: a switch read, and a later period with A's read still never finished.
    const read = await Promise.race([store.inRequest(() => store.read(fine, 'probe')), hung()])
    assert.notEqual(read, 'HUNG')
    clock += 15_000
    const later = await Promise.race([store.inRequest(() => store.epoch(fine)), hung()])
    assert.equal(later, 'dddddddddddddddddddddddddddddddd')
  })

  await check('N1: a read that started before a reset stores nothing; the memo stays empty until a caller after the reset reads', async () => {
    clock = 6_300_000
    const slow = fakeEnv(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const realPrepare = slow.DB.prepare
    slow.DB.prepare = (sql) => { const statement = realPrepare(sql); return { bind: (...values) => { const bound = statement.bind(...values); return { all: async () => { const answer = await bound.all(); await gate; return answer } } } } }
    const store = newStore()
    const before = store.epoch(slow)
    store.reset()
    release()
    assert.equal(await before, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'the caller of the old read still gets its answer')
    assert.equal(store.peek(), null, 'the old read stored nothing')
    assert.equal(store.epochTagNow(), null)
    const fresh = fakeEnv(null, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    assert.equal(await store.epoch(fresh), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    assert.equal(fresh.attempts, 1)
  })

  await check('N9: the next epoch read after a flip keeps the flip value; only the epoch half is read', async () => {
    clock = 6_400_000
    const store = newStore()
    // The database still says epoch 1 / off: only a kept primed value can make the memo say 2 / on afterwards.
    const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'off' } }), 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    store.prime(env, sw.parseReadSwitches(stored({ epoch: 2, switches: { probe: 'on' } })))
    assert.equal(await store.epoch(env), 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    assert.equal(env.attempts, 1)
    assert.equal(store.peek().epoch, 2, 'the flip survived the epoch read')
    assert.equal((await store.read(env, 'probe')).on, true)
    assert.equal(env.attempts, 1, 'and answers the next switch read without another statement')
    assert.equal(store.header(), 'e=2;probe=1' + REPORT_HEADER)
  })

  await check('B1: X-BOS-Build never waits on another request read: pending means the header is left off; a read that never settles is given up', async () => {
    const isolated = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics() {} } : id === './planTier' ? planTier : require(id)))
    isolated.resetBuildHash()
    let calls = 0
    const hungAssets = { STATIC_ASSETS: { fetch: () => { calls += 1; return new Promise(() => {}) } } }
    void isolated.frontendBuildHash(hungAssets, 1_000)
    const raced = await Promise.race([isolated.frontendBuildHash(hungAssets, 1_001), new Promise((resolve) => setTimeout(() => resolve('HUNG'), 300))])
    assert.equal(raced, null, 'a second request gets no header at once, not a wait')
    assert.equal(calls, 1, 'and does not start a second read while the first is pending')
    const healthy = { STATIC_ASSETS: { fetch: async () => Response.json({ hash: 'build-abc' }) } }
    assert.equal(await isolated.frontendBuildHash(healthy, 1_000 + 10_001), 'build-abc', 'a read pending for longer than the limit is given up and read again')
    assert.equal(await isolated.frontendBuildHash(hungAssets, 1_000 + 10_002), 'build-abc', 'the hash is remembered')
    isolated.resetBuildHash()
  })

  await check('F2 (review of 6.0.1041): priming a flip never makes an old data epoch look fresh; the next epoch read goes to the database', async () => {
    clock = 6_500_000
    const OLD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const NEW = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    // The control: inside its period a plain memo does answer the epoch it read, so the assertions below can tell the two apart.
    const plain = newStore()
    const plainEnv = fakeEnv(stored({ epoch: 1, switches: {} }), OLD)
    assert.equal(await plain.epoch(plainEnv), OLD)
    clock += 5_000
    plainEnv.epoch = NEW
    assert.equal(await plain.epoch(plainEnv), OLD, 'a memo inside its period answers without reading')
    assert.equal(plainEnv.attempts, 1)
    // The defect: the epoch was read ten minutes ago, a restore rotated it since, and an admin flip primes the memo.
    clock = 7_000_000
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 1, switches: {} }), OLD)
    assert.equal(await store.epoch(env), OLD)
    clock += 10 * 60_000
    env.epoch = NEW
    env.rows = stored({ epoch: 2, switches: { probe: 'on' } })
    store.prime(env, sw.parseReadSwitches(env.rows))
    assert.equal(store.epochTagNow(), null, 'no tag of the old epoch is announced after a prime')
    assert.equal(await store.epoch(env), NEW, 'the epoch is read again, not carried over from ten minutes ago')
    assert.equal(env.attempts, 2)
    assert.equal(store.peek().epoch, 2, 'the flip itself is still what the memo holds')
    assert.equal(store.header(), 'e=2;probe=1' + REPORT_HEADER)
  })

  await check('a committed flip is primed into the memo; a read that started before it cannot overwrite it', async () => {
    clock = 6_000_000
    const store = newStore()
    const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'off' } }))
    await store.read(env, 'probe')
    clock += 20_000
    let release
    const slow = { DB: { prepare() { return { bind() { return { all: () => new Promise((resolve) => { release = () => resolve({ results: [{ value: stored({ epoch: 1, switches: { probe: 'off' } }) }], meta: {} }) }) } } } } } }
    const late = store.read(slow, 'probe')
    clock += 50
    store.prime(env, sw.parseReadSwitches(stored({ epoch: 2, switches: { probe: 'on' } })))
    release()
    await late
    assert.equal(store.peek().epoch, 2, 'the primed flip survives the older read')
    assert.equal(store.header(), 'e=2;probe=1' + REPORT_HEADER)
  })

  await check('the consulted state is recorded through the request-metrics hook, only for names this build knows', async () => {
    const seen = []
    globalThis[Symbol.for('business-os.request-metrics.v1')] = { d1Start() {}, d1Call() {}, flag(name, state) { seen.push([name, state]) } }
    try {
      clock = 7_000_000
      const store = newStore()
      const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'shadow:0.05' } }))
      await store.read(env, 'probe')
      await store.read(env, 'not_a_switch')
      assert.deepEqual(seen, [['probe', 'shadow']])
      globalThis[Symbol.for('business-os.request-metrics.v1')] = { d1Start() {}, d1Call() {}, flag() { throw new Error('observer broke') } }
      assert.equal((await store.read(env, 'probe')).state, 'shadow', 'an observer that throws never changes a read')
    } finally { delete globalThis[Symbol.for('business-os.request-metrics.v1')] }
  })

  await check('the middleware adds the header from the memo, adds no I/O, and survives an immutable response', async () => {
    clock = 8_000_000
    const events2 = []
    const isolated = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics: (_e, ev) => events2.push(ev) } : id === './planTier' ? planTier : require(id)))
    const env = fakeEnv(stored({ epoch: 3, switches: { probe: 'on' } }))
    const noHeader = { res: new Response('x') }
    await isolated.readSwitchHeader(noHeader, async () => {})
    assert.equal(noHeader.res.headers.get('X-BOS-Switches'), null, 'nothing consulted yet: no header')
    await isolated.readSwitch(env, 'probe')
    const ctx = { res: new Response('x') }
    await isolated.readSwitchHeader(ctx, async () => {})
    assert.equal(ctx.res.headers.get('X-BOS-Switches'), 'e=3;probe=1' + REPORT_HEADER)
    const immutable = { res: Response.redirect('https://example.test/next', 302) }
    await isolated.readSwitchHeader(immutable, async () => {})
    assert.equal(immutable.res.headers.get('X-BOS-Switches'), 'e=3;probe=1' + REPORT_HEADER)
    assert.equal(immutable.res.status, 302)
    assert.equal(env.attempts, 1)
  })

  await check('the stand-in contract other slices code against: readSwitch(env, name) resolves to a boolean, false by default', async () => {
    const env = fakeEnv(null)
    const result = sw.readSwitch(env, 'probe')
    assert.ok(result instanceof Promise)
    assert.equal(await result, false)
    assert.equal(typeof sw.readSwitchState, 'function')
    assert.deepEqual([...sw.KNOWN_READ_SWITCHES], ['probe', ...REPORT_NAMES])
    assert.equal(sw.READ_SWITCH_KEY, 'read_switches')
    assert.equal(sw.READ_SWITCH_MEMO_MS, undefined, 'the window is not a literal in the module: it is a plan field')
    sw.resetReadSwitchMemo()
  })

  await check('the memo window is the deployment plan\'s: Free 15 s, Paid 5 s, for reads, primes and the restore settle', async () => {
    const dataEpoch = load('lib/dataEpoch.ts', (id) => (id === './db' ? db : id === './readSwitches' ? sw : id === './dataEpochSql' ? load('lib/dataEpochSql.ts') : require(id)))
    for (const [tier, seconds] of [['free', 15], ['paid', 5]]) {
      planTier.__resetPlanTierCacheForTests()
      clock = 9_000_000
      const store = newStore()
      const env = fakeEnv(stored({ epoch: 1, switches: { probe: 'on' } }))
      env.PLAN_TIER = tier
      assert.equal(sw.readSwitchMemoMs(env), seconds * 1000, tier)
      assert.equal(dataEpoch.epochSettleMs(env), seconds * 1000 + 500, `${tier}: a restore waits one memo period plus the margin`)
      assert.equal(dataEpoch.epochSettleMs({ ...env, EPOCH_SETTLE_MS: '0' }), 0, 'the override still wins')
      await store.read(env, 'probe')
      assert.equal(env.attempts, 1)
      clock += seconds * 1000 - 1
      await store.read(env, 'probe')
      assert.equal(env.attempts, 1, `${tier}: inside the window`)
      assert.equal(store.header(), 'e=1;probe=1' + REPORT_HEADER)
      clock += 1
      assert.equal(store.header(), null, `${tier}: the window closes exactly at the plan's number`)
      await store.read(env, 'probe')
      assert.equal(env.attempts, 2, `${tier}: one statement per window`)
      store.prime(env, sw.parseReadSwitches(stored({ epoch: 2, switches: { probe: 'off' } })))
      clock += seconds * 1000 - 1
      assert.equal(store.header(), 'e=2;probe=0' + REPORT_HEADER, `${tier}: a primed flip lives the plan's window`)
      clock += 1
      assert.equal(store.header(), null)
    }
    planTier.__resetPlanTierCacheForTests()
    planTier.getPlanLimits({ PLAN_TIER: 'free' })
    sw.resetReadSwitchMemo()
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
