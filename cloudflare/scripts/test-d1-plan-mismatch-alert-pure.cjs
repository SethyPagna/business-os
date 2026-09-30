// A Free-plan D1 quota refusal while PLAN_TIER says paid means the Cloudflare
// account is on the Free plan but the Paid profile is live (the 30 Sep 2026
// outage). db.ts must name that in one clear log line, without changing what
// the caller sees: the same error, after one attempt. The real TypeScript
// module is transpiled and executed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'db.ts')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const loaded = { exports: {} }
const requireForDb = (id) => (id === './importMaintenanceFence' ? {} : require(id))
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  loaded.exports, requireForDb, loaded, sourcePath, path.dirname(sourcePath),
)
const { D1Compat, getDb, __resetPlanMismatchAlertForTests } = loaded.exports

const READ_LIMIT = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
const WRITE_LIMIT = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
const STORAGE_LIMIT = "D1_ERROR: Your account has exceeded D1's maximum account storage limit, please contact Cloudflare to raise your limit"

function rawDb(failure) {
  let attempts = 0
  const attempt = () => { attempts += 1; if (failure) throw failure }
  return {
    get attempts() { return attempts },
    prepare() {
      return { bind() { return { async all() { attempt(); return { results: [], meta: {} } }, async run() { attempt(); return { meta: {} } } } } }
    },
    async batch() { attempt(); return [] },
  }
}

// Runs fn with console.error captured; returns the captured lines.
async function capture(fn) {
  const lines = []
  const original = console.error
  console.error = (...args) => { lines.push(args.map(String).join(' ')) }
  try { await fn() } finally { console.error = original }
  return lines
}

const attempts = {
  get: (db) => db.prepare('SELECT 1').get(),
  all: (db) => db.prepare('SELECT 1').all(),
  run: (db) => db.prepare('UPDATE t SET v = 1').run(),
  batch: (db) => db.batch([{ sql: 'UPDATE t SET v = 1' }]),
  batchOnce: (db) => db.batchOnce([{ sql: 'UPDATE t SET v = 1' }]),
}

async function main() {
  for (const [method, call] of Object.entries(attempts)) {
    __resetPlanMismatchAlertForTests()
    const failure = new Error(method === 'run' || method === 'batch' ? WRITE_LIMIT : READ_LIMIT)
    const raw = rawDb(failure)
    const lines = await capture(async () => {
      await assert.rejects(() => call(new D1Compat(raw, 'paid')), (error) => error === failure, `${method} must rethrow the same error`)
    })
    assert.equal(raw.attempts, 1, `${method}: still exactly one attempt`)
    assert.equal(lines.length, 1, `${method}: exactly one alert line, got ${JSON.stringify(lines)}`)
    assert.match(lines[0], /^\[plan-mismatch\] ALERT/, `${method}: greppable prefix`)
    assert.match(lines[0], /Free-plan/, `${method}: names the Free plan`)
    assert.match(lines[0], /PLAN_TIER/, `${method}: names the setting`)
    assert.match(lines[0], /paid/, `${method}: names what it said`)
    assert.match(lines[0], /upgrade|free profile|wrangler\.free\.toml/i, `${method}: says what to do`)
  }
  console.log('PASS a Free-plan quota refusal under PLAN_TIER=paid alerts once per method and changes nothing else')

  // Unset PLAN_TIER runs as paid too (planTier.resolvePlanTier), so it alerts as well.
  __resetPlanMismatchAlertForTests()
  const unset = await capture(async () => {
    await assert.rejects(() => attempts.get(new D1Compat(rawDb(new Error(READ_LIMIT)), '')), /free tier/)
  })
  assert.equal(unset.length, 1)
  console.log('PASS an unset PLAN_TIER (which runs as paid) alerts')

  __resetPlanMismatchAlertForTests()
  for (const label of ['free', ' FREE ']) {
    const quiet = await capture(async () => {
      await assert.rejects(() => attempts.get(new D1Compat(rawDb(new Error(READ_LIMIT)), label)), /free tier/)
    })
    assert.deepEqual(quiet, [], `PLAN_TIER=${JSON.stringify(label)} on the Free plan is expected, not an alert`)
  }
  const unlabeled = await capture(async () => {
    await assert.rejects(() => attempts.get(new D1Compat(rawDb(new Error(READ_LIMIT)))), /free tier/)
  })
  assert.deepEqual(unlabeled, [], 'a D1Compat built without a plan label (tests, harness) stays silent')
  console.log('PASS no alert on Free, or without a plan label')

  __resetPlanMismatchAlertForTests()
  for (const message of [STORAGE_LIMIT, 'D1_ERROR: Exceeded maximum DB size.', 'D1_ERROR: internal error', 'D1_ERROR: no such table: x']) {
    const quiet = await capture(async () => {
      await assert.rejects(() => attempts.get(new D1Compat(rawDb(new Error(message)), 'paid')))
    })
    assert.deepEqual(quiet, [], `only the Free-tier daily limits prove a Free account: ${message}`)
  }
  console.log('PASS storage limits and ordinary errors do not claim a Free account')

  // One line per window, not one per failing query: a dead quota fails every request.
  __resetPlanMismatchAlertForTests()
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    const db = new D1Compat(rawDb(new Error(READ_LIMIT)), 'paid')
    const first = await capture(async () => { for (let i = 0; i < 5; i += 1) await assert.rejects(() => attempts.get(db)) })
    assert.equal(first.length, 1, 'five failures inside the window log once')
    now += 11 * 60_000
    const later = await capture(async () => { await assert.rejects(() => attempts.get(db)) })
    assert.equal(later.length, 1, 'the alert repeats once the window has passed, so a long outage stays visible')
  } finally {
    Date.now = realNow
  }
  console.log('PASS the alert is rate limited but repeats during a long outage')

  // getDb passes PLAN_TIER to both databases, main and import staging.
  for (const [name, pick] of [['main', (db) => db], ['staging', (db) => db.staging]]) {
    __resetPlanMismatchAlertForTests()
    const db = getDb({ DB: rawDb(new Error(READ_LIMIT)), IMPORT_DB: rawDb(new Error(READ_LIMIT)), PLAN_TIER: 'paid' })
    const lines = await capture(async () => { await assert.rejects(() => attempts.get(pick(db))) })
    assert.equal(lines.length, 1, `getDb: ${name} database alerts`)
    __resetPlanMismatchAlertForTests()
    const free = getDb({ DB: rawDb(new Error(READ_LIMIT)), IMPORT_DB: rawDb(new Error(READ_LIMIT)), PLAN_TIER: 'free' })
    assert.deepEqual(await capture(async () => { await assert.rejects(() => attempts.get(pick(free))) }), [], `getDb: ${name} on a free deployment stays quiet`)
  }
  console.log('PASS getDb hands the deployment plan to the main and the import database')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
