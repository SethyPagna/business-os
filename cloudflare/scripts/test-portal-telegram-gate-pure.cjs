// G38 S3c: the gate (lib/portalTelegramGate.ts). Tests T-C1 and T-C2 of AMEND-g38-lean-writes-1.2 section 11.3.
// No network, no D1 (a counting fake). PORTAL_LIB_ROOT points the test at a scratch copy of src/lib (mutant runs).
// Run: node scripts/test-portal-telegram-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const libRoot = process.env.PORTAL_LIB_ROOT || path.join(cloudflareRoot, 'src', 'lib')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

const compiled = new Map()
function loadLib(name) {
  if (compiled.has(name)) return compiled.get(name).exports
  const file = path.join(libRoot, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  })
  const mod = { exports: {} }
  compiled.set(name, mod)
  const localRequire = (request) => (request.startsWith('./') ? loadLib(request.slice(2)) : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, localRequire, mod, file, libRoot)
  return mod.exports
}

const gateLib = loadLib('portalTelegramGate')
const { getPlanLimits } = loadLib('planTier')

const GOOD_ENV = () => ({
  PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-that-is-at-least-32-chars',
  PORTAL_TELEGRAM_BOT_TOKEN: '123456:TEST',
  PORTAL_TELEGRAM_WEBHOOK_SECRET: 'webhook-test-secret-with-at-least-32-chars-ok',
  PORTAL_TELEGRAM_BOT_USERNAME: 'example_test_bot',
})
const ON = { enabled: true, stage: 0 }

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// ---------------------------------------------------------------- T-C1
check('T-C1 available when all six conditions hold, with or without a leading @ and with the default address list', async () => {
  assert.equal(await gateLib.telegramSigninAvailable(GOOD_ENV(), ON), true)
  assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_BOT_USERNAME: '@example_test_bot' }, ON), true)
  assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_WEBHOOK_CIDRS: '149.154.160.0/20' }, ON), true)
})

check('T-C1 the switch off: false', async () => {
  assert.equal(await gateLib.telegramSigninAvailable(GOOD_ENV(), { enabled: false, stage: 0 }), false)
})

check('T-C1 the webhook secret missing, short, or equal to the bot token: false', async () => {
  for (const value of [undefined, '', 'short-secret', '123456:TEST', 'has spaces in it but is long enough to pass length 32']) {
    assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_WEBHOOK_SECRET: value }, ON), false, String(value))
  }
  const same = 'webhook-test-secret-with-at-least-32-chars-ok'
  assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_WEBHOOK_SECRET: same, TELEGRAM_BOT_TOKEN: same }, ON), false)
})

check('T-C1 the bot username missing or malformed: false (no default username)', async () => {
  for (const value of [undefined, '', '@', 'abcd', '1abcde', 'bad-name_bot', '@@example_test_bot', 'x'.repeat(33)]) {
    assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_BOT_USERNAME: value }, ON), false, String(value))
  }
})

check('T-C1 the abuse secret missing or under 32 characters: false (review 2.2)', async () => {
  for (const value of [undefined, '', 'x'.repeat(31)]) {
    assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_ABUSE_HMAC_SECRET: value }, ON), false, String(value))
  }
})

check('T-C1 the bot token missing or without a usable id: false', async () => {
  for (const value of [undefined, '', 'nocolon', 'abc:TEST', '0123:TEST']) {
    assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_BOT_TOKEN: value }, ON), false, String(value))
  }
})

check('T-C1 an address list that does not parse: false', async () => {
  for (const value of ['0.0.0.0/0', '149.154.160.0/20,bad', '10.0.0.1/24']) {
    assert.equal(await gateLib.telegramSigninAvailable({ ...GOOD_ENV(), PORTAL_TELEGRAM_WEBHOOK_CIDRS: value }, ON), false, value)
  }
})

check('T-C1 /config shows the button only at budget stage 0', async () => {
  assert.equal(await gateLib.telegramSigninShown(GOOD_ENV(), { enabled: true, stage: 0 }), true)
  for (const stage of [1, 2, 3]) assert.equal(await gateLib.telegramSigninShown(GOOD_ENV(), { enabled: true, stage }), false)
  assert.equal(await gateLib.telegramSigninShown({}, { enabled: true, stage: 0 }), false)
})

// ---------------------------------------------------------------- T-C2
function fakeDb(plan) {
  const state = { calls: 0, sql: [] }
  state.prepare = (sql) => ({
    async all() {
      state.calls += 1
      state.sql.push(sql)
      return plan(state.calls)
    },
  })
  return state
}
const PERIOD = getPlanLimits({}).portalTelegramGateMemoSeconds * 1000
const T0 = Date.UTC(2026, 10, 24, 8, 0, 0)
const rowsOn = (stage) => [{ key: 'customer_portal_telegram_signin_enabled', value: 'true' }, ...(stage === undefined ? [] : [{ key: 'system_budget_stage', value: stage }])]

check('T-C2 the stage: absent is 0, 1 is paused, anything else is 3', async () => {
  assert.equal(gateLib.budgetStageFrom(undefined), 0)
  assert.equal(gateLib.budgetStageFrom(null), 0)
  for (const [value, stage] of [['0', 0], ['1', 1], ['2', 2], ['3', 3], [' 1 ', 1], ['x', 3], ['', 3], ['4', 3], ['-1', 3], ['1.5', 3], [7, 3]]) {
    assert.equal(gateLib.budgetStageFrom(value), stage, String(value))
  }
  assert.deepEqual(gateLib.gateFromRows(rowsOn()), { enabled: true, stage: 0 })
  assert.deepEqual(gateLib.gateFromRows(rowsOn('1')), { enabled: true, stage: 1 })
  assert.deepEqual(gateLib.gateFromRows(rowsOn('x')), { enabled: true, stage: 3 })
  assert.deepEqual(gateLib.gateFromRows([]), { enabled: false, stage: 0 })
})

check('T-C2 the switch is on only for the text true', async () => {
  for (const [value, enabled] of [['true', true], ['TRUE', true], [' true ', true], ['false', false], ['1', false], ['yes', false], ['', false], [null, false]]) {
    assert.equal(gateLib.gateFromRows([{ key: 'customer_portal_telegram_signin_enabled', value }]).enabled, enabled, String(value))
  }
})

check('T-C2 the memo: one S-G1 per period, a second one after it', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb(() => rowsOn('0'))
  const first = await gateLib.readPortalTelegramGate({}, db, T0)
  const again = await gateLib.readPortalTelegramGate({}, db, T0 + PERIOD - 1)
  assert.deepEqual(first, { enabled: true, stage: 0 })
  assert.deepEqual(again, first)
  assert.equal(db.calls, 1)
  await gateLib.readPortalTelegramGate({}, db, T0 + PERIOD)
  assert.equal(db.calls, 2)
  assert.match(db.sql[0], /FROM settings/)
  assert.match(db.sql[0], /customer_portal_telegram_signin_enabled/)
  assert.match(db.sql[0], /system_budget_stage/)
})

check('A3 concurrent requests with an empty memo each run their own S-G1 (no read is shared while in flight)', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb(() => rowsOn('0'))
  const answers = await Promise.all([1, 2, 3].map(() => gateLib.readPortalTelegramGate({}, db, T0)))
  assert.equal(db.calls, 3)
  for (const answer of answers) assert.deepEqual(answer, { enabled: true, stage: 0 })
  await gateLib.readPortalTelegramGate({}, db, T0 + 1000)
  assert.equal(db.calls, 3, 'the resolved value is still shared through the memo')
})

const settlesWithin = (promise, ms) => Promise.race([promise.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))])

check('A3 a first read that never settles does not leave the second request waiting', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb((call) => (call === 1 ? new Promise(() => {}) : rowsOn('0')))
  void gateLib.readPortalTelegramGate({}, db, T0)
  const second = gateLib.readPortalTelegramGate({}, db, T0)
  assert.equal(await settlesWithin(second, 500), true, 'the second request answered')
  assert.deepEqual(await second, { enabled: true, stage: 0 })
  assert.equal(db.calls, 2)
})

check('A3 a rejected first read does not change the second request answer', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb((call) => (call === 1 ? Promise.reject(new Error('D1 cancelled')) : rowsOn('0')))
  const first = gateLib.readPortalTelegramGate({}, db, T0)
  const second = gateLib.readPortalTelegramGate({}, db, T0)
  assert.equal(await settlesWithin(second, 500), true)
  assert.deepEqual(await second, { enabled: true, stage: 0 })
  assert.equal(await settlesWithin(first, 500), true, 'the failed request also answers (off, or the value the second read just stored)')
})

check('T-C2 a failed first read counts as switch off, and that answer is memoised for the period', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb(() => { throw new Error('D1 down') })
  const gate = await gateLib.readPortalTelegramGate({}, db, T0)
  assert.equal(gate.enabled, false)
  await gateLib.readPortalTelegramGate({}, db, T0 + 1000)
  assert.equal(db.calls, 1)
})

check('T-C2 a failed refresh keeps the previous value for one more period, then goes off; a later success recovers', async () => {
  gateLib.resetPortalTelegramGateMemo()
  let fail = false
  const db = fakeDb(() => { if (fail) throw new Error('D1 down'); return rowsOn('0') })
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0)).enabled, true)
  fail = true
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0 + PERIOD)).enabled, true, 'kept for one more period')
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0 + PERIOD + 1000)).enabled, true, 'still inside the extra period')
  assert.equal(db.calls, 2)
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0 + 2 * PERIOD)).enabled, false, 'second failure is off')
  fail = false
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0 + 3 * PERIOD)).enabled, true)
})

// R2-1 (review F1): the grace decision is made once per refresh outcome, against the memo as it is when the outcome lands.
check('R2-1 two concurrent failed refreshes use one grace: both answer on, and a request later in the period still does', async () => {
  for (const burst of [2, 3]) {
    gateLib.resetPortalTelegramGateMemo()
    let fail = false
    const db = fakeDb(() => { if (fail) return Promise.reject(new Error('D1 blip')); return rowsOn('0') })
    assert.equal((await gateLib.readPortalTelegramGate({}, db, T0)).enabled, true)
    fail = true
    const t1 = T0 + PERIOD + 1
    const answers = await Promise.all(Array.from({ length: burst }, () => gateLib.readPortalTelegramGate({}, db, t1)))
    assert.deepEqual(answers.map((g) => g.enabled), Array(burst).fill(true), `burst of ${burst}`)
    fail = false
    assert.equal((await gateLib.readPortalTelegramGate({}, db, t1 + 1000)).enabled, true, 'inside the one grace period')
    assert.equal(db.calls, 1 + burst, 'the memo answered the later request')
  }
})

check('R2-1 a slow failure that settles after a newer success changes nothing; the later failure still gets its grace', async () => {
  gateLib.resetPortalTelegramGateMemo()
  let mode = 'ok'
  let rejectSlow
  const db = fakeDb((call) => {
    if (mode === 'ok') return rowsOn('0')
    if (mode === 'slow') return new Promise((_, reject) => { rejectSlow = reject })
    if (mode === 'fast') return rowsOn('0')
    return Promise.reject(new Error('D1 blip'))
  })
  assert.equal((await gateLib.readPortalTelegramGate({}, db, T0)).enabled, true)
  mode = 'slow'
  const slow = gateLib.readPortalTelegramGate({}, db, T0 + PERIOD)
  mode = 'fast'
  const t1 = T0 + PERIOD + 5
  assert.equal((await gateLib.readPortalTelegramGate({}, db, t1)).enabled, true)
  rejectSlow(new Error('D1 slow failure'))
  assert.equal((await slow).enabled, true, 'the slow request answers with the newer success')
  mode = 'fail'
  const t2 = t1 + PERIOD
  assert.equal((await gateLib.readPortalTelegramGate({}, db, t2)).enabled, true, 'the success kept its unused grace')
})

check('T-C2 an invalid stage text in D1 pauses (3), it is never read as 0', async () => {
  gateLib.resetPortalTelegramGateMemo()
  const db = fakeDb(() => rowsOn('x'))
  assert.deepEqual(await gateLib.readPortalTelegramGate({}, db, T0), { enabled: true, stage: 3 })
})

check('T-C1 source: no shop, bot username, host or chat id literal in the S3c lib files', async () => {
  for (const name of ['portalTelegramGate', 'portalTelegramSignIn', 'portalTelegramText']) {
    const file = path.join(libRoot, `${name}.ts`)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /t\.me\/|https?:\/\/|leang|\bbot\d|_bot\b/i, name)
  }
})

;(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn()
      passed += 1
    } catch (error) {
      console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
      process.exitCode = 1
    }
  }
  console.log(`${passed}/${tests.length} portal telegram gate checks passed`)
})()
