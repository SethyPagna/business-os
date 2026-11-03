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
const sw = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics: (_env, event) => events.push(event) } : require(id)))

function fakeEnv(rows, epoch = null) {
  const state = { sql: [], binds: [], attempts: 0, rows, epoch, fail: null }
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
      assert.deepEqual(Object.keys(parsed.switches), ['probe'], 'only names this build knows')
    }
    assert.equal(sw.parseReadSwitches(null).epoch, 0)
    assert.equal(sw.parseReadSwitches(stored({ epoch: 3, switches: { probe: 'ON' } })).epoch, 3, 'a bad token does not discard the epoch')
  })

  await check('the exact tokens parse: on, shadow:<rate> with the rate clamped to 0.1, off', () => {
    assert.deepEqual(sw.parseReadSwitches(stored({ epoch: 7, set_at: '2026-11-02T00:05:00Z', set_by: 5, switches: { probe: 'on' } })), { epoch: 7, setAt: '2026-11-02T00:05:00Z', setBy: 5, switches: { probe: { state: 'on', rate: 0 } } })
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
    assert.deepEqual(next, { epoch: 5, set_at: '2026-11-02T01:00:00.000Z', set_by: 9, switches: { future_slice: 'on', probe: 'on' } })
    const fresh = JSON.parse(sw.serializeReadSwitches('garbage', { name: 'probe', entry: { state: 'shadow', rate: 0.1 } }, { epoch: 1, setAt: 't', setBy: 2 }))
    assert.deepEqual(fresh, { epoch: 1, set_at: 't', set_by: 2, switches: { probe: 'shadow:0.1' } })
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
    assert.equal(store.header(), 'e=7;probe=1')
    assert.equal(env.attempts, attempts, 'building the header does no I/O')
    clock += 14_999
    assert.equal(store.header(), 'e=7;probe=1')
    clock += 1
    assert.equal(store.header(), null, 'an expired memo says nothing about now')
    env.rows = stored({ epoch: 8, switches: { probe: 'shadow:0.05' } })
    await store.read(env, 'probe')
    assert.equal(store.header(), 'e=8;probe=0', 'shadow is not on for a client')
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
      store.prime(sw.parseReadSwitches(stored({ epoch, switches: { probe: token } })))
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

  await check('callers that arrive while the flags are being read share that read: a cold isolate answering N cached sections reads once, not N times', async () => {
    clock = 5_900_000
    const env = fakeEnv(stored({ epoch: 2, switches: { probe: 'off' } }), '0123456789abcdef0123456789abcdef')
    const store = newStore()
    const answers = await Promise.all([store.epoch(env), store.epoch(env), store.read(env, 'probe'), store.epoch(env), store.read(env, 'probe')])
    assert.equal(env.attempts, 1, 'five concurrent callers, one statement')
    assert.deepEqual(answers.map((a) => (typeof a === 'string' ? a : a.epoch)), ['0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef', 2, '0123456789abcdef0123456789abcdef', 2])
    await store.epoch(env)
    assert.equal(env.attempts, 1, 'the fresh memo answers the next caller')
    clock += 15_000
    await Promise.all([store.epoch(env), store.epoch(env), store.epoch(env)])
    assert.equal(env.attempts, 2, 'the next period is one more statement, shared again')
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
    store.prime(sw.parseReadSwitches(env.rows))
    assert.equal(store.epochTagNow(), null, 'no tag of the old epoch is announced after a prime')
    assert.equal(await store.epoch(env), NEW, 'the epoch is read again, not carried over from ten minutes ago')
    assert.equal(env.attempts, 2)
    assert.equal(store.peek().epoch, 2, 'the flip itself is still what the memo holds')
    assert.equal(store.header(), 'e=2;probe=1')
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
    store.prime(sw.parseReadSwitches(stored({ epoch: 2, switches: { probe: 'on' } })))
    release()
    await late
    assert.equal(store.peek().epoch, 2, 'the primed flip survives the older read')
    assert.equal(store.header(), 'e=2;probe=1')
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
    const isolated = load('lib/readSwitches.ts', (id) => (id === './db' ? db : id === './analytics' ? { recordAnalytics: (_e, ev) => events2.push(ev) } : require(id)))
    const env = fakeEnv(stored({ epoch: 3, switches: { probe: 'on' } }))
    const noHeader = { res: new Response('x') }
    await isolated.readSwitchHeader(noHeader, async () => {})
    assert.equal(noHeader.res.headers.get('X-BOS-Switches'), null, 'nothing consulted yet: no header')
    await isolated.readSwitch(env, 'probe')
    const ctx = { res: new Response('x') }
    await isolated.readSwitchHeader(ctx, async () => {})
    assert.equal(ctx.res.headers.get('X-BOS-Switches'), 'e=3;probe=1')
    const immutable = { res: Response.redirect('https://example.test/next', 302) }
    await isolated.readSwitchHeader(immutable, async () => {})
    assert.equal(immutable.res.headers.get('X-BOS-Switches'), 'e=3;probe=1')
    assert.equal(immutable.res.status, 302)
    assert.equal(env.attempts, 1)
  })

  await check('the stand-in contract other slices code against: readSwitch(env, name) resolves to a boolean, false by default', async () => {
    const env = fakeEnv(null)
    const result = sw.readSwitch(env, 'probe')
    assert.ok(result instanceof Promise)
    assert.equal(await result, false)
    assert.equal(typeof sw.readSwitchState, 'function')
    assert.deepEqual([...sw.KNOWN_READ_SWITCHES], ['probe'])
    assert.equal(sw.READ_SWITCH_KEY, 'read_switches')
    assert.equal(sw.READ_SWITCH_MEMO_MS, 15000)
    sw.resetReadSwitchMemo()
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
