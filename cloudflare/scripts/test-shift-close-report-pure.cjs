// S4-7 -- the shift report actually leaves the building when a shift is closed.
//
// WHAT WAS WRONG. `sendTelegramShiftReport` had ZERO call sites. It existed,
// it was correct, its own doc comment named the handler that should call it --
// and nothing did. Closing a drawer pushed nothing, and the one message that
// carries BOTH the opening and the closing time was reachable only by someone
// typing /shift into the chat. That is the second half of the owner's report
// (Sep 4 2026: "sales open and closing time... currently, it only shows open
// time"): the times existed, nobody was ever sent them.
//
// WHAT THIS PINS, and why each one is not obvious:
//
//   1. POST /close sends the report -- ONCE. Not once per request: once per
//      close that actually WROTE. `AND closed_at IS NULL` is what makes "end
//      only once" true, and the send has to live inside the same condition, or
//      a double-tapped End Shift (or a retried request on a flaky till
//      connection) puts two identical reports in the owner's chat.
//   2. An already-closed shift sends NOTHING. That request still returns 200
//      with the existing row -- it is a deliberate no-op, not an error -- so
//      "it returned 200" is not evidence that it should have sent.
//   3. POST /open sends nothing. A shift report on an empty drawer is noise.
//   4. The response does not WAIT on Telegram. The promise goes through
//      executionCtx.waitUntil, so a slow or unreachable Telegram cannot delay
//      the response the till is blocking on.
//   5. Nothing is transmitted, ever, from this suite. The route is driven with
//      the telegram module stubbed, and the REAL sendTelegramShiftReport is
//      then driven separately against a Worker with no bot token, with
//      globalThis.fetch replaced by a throw, to prove the unconfigured path
//      cannot reach api.telegram.org.
//
// The route runs for real: migration 0116 in an in-memory SQLite, the real
// Hono app, real Requests. Only auth, audit and telegram are stubbed.
//
// Run (from cloudflare/): node scripts/test-shift-close-report-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')

const cloudflareRoot = path.join(__dirname, '..')
const Database = require(path.join(cloudflareRoot, 'node_modules', 'better-sqlite3'))

let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

// ---- a D1-shaped adapter over better-sqlite3 -------------------------------
// Mirrors lib/db.ts: the route writes SQLite-native `@name` placeholders and
// D1 binds positionally, so the same translation has to happen here or the
// route's own SQL would not run.
function d1(db) {
  const translate = (sql, params) => {
    const map = params || {}
    const values = []
    const translated = sql.replace(/@(\w+)/g, (_m, name) => { values.push(map[name] ?? null); return '?' })
    return { sql: translated, values }
  }
  return {
    prepare(sql) {
      return {
        async get(params) {
          const q = translate(sql, params)
          return db.prepare(q.sql).get(...q.values)
        },
        async all(params) {
          const q = translate(sql, params)
          return db.prepare(q.sql).all(...q.values)
        },
        async run(params) {
          const q = translate(sql, params)
          const info = db.prepare(q.sql).run(...q.values)
          // D1 reports row counts under meta.changes, and routes/shifts.ts
          // reads exactly that to decide whether the close won the race.
          return { changes: info.changes, meta: { changes: info.changes } }
        },
      }
    },
  }
}

const sqlite = new Database(':memory:')
sqlite.exec(fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
sqlite.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
sqlite.exec(fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))

// ---- the route, with only auth/audit/telegram replaced ---------------------
// businessDateWindow is passed through as the REAL module: the business-day
// offset it interpolates is part of what "today's shift" means, and a stub of
// it would quietly make the route look for the wrong day.
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const sent = []
const shiftsRoute = loadReal('routes/shifts.ts', {
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/db': { getDb: () => d1(sqlite) },
  '../lib/auth': {
    requireAuth: async (c, next) => { c.set('user', { id: 7, name: 'Za', username: 'za' }); await next() },
  },
  '../lib/permissions': { isAdminControlUser: () => false, hasPermission: () => false },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': {
    // The spy stands where the real sender does. It records and returns; it
    // has no token, no chat id and no fetch, so this file cannot transmit.
    sendTelegramShiftReport: async (env, shiftId) => { sent.push({ env, shiftId }); return true },
  },
})
const app = shiftsRoute.default || shiftsRoute

// The stub is only meaningful if the route imports the real thing by that
// name. A test that stubs a symbol the source never calls proves nothing.
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'shifts.ts'), 'utf8')
ok(/import \{ sendTelegramShiftReport \} from '\.\.\/lib\/telegram'/.test(routeSrc),
  'the route imports the real sendTelegramShiftReport -- the stub replaces something that is actually called')
ok(!/fetch\(/.test(routeSrc), 'and the route itself opens no network connection of its own')

const waited = []
const ctx = { waitUntil: (promise) => { waited.push(promise) }, passThroughOnException: () => {} }
const env = { TELEGRAM_BOT_TOKEN: '' }
const post = (route, body) => app.fetch(
  new Request(`http://till.local${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }),
  env,
  ctx,
)

async function main() {
  // ---- 1. Opening a shift sends nothing ------------------------------------
  const opened = await post('/open', { opening_float_usd: 50, opening_float_khr: 100000 })
  const openedBody = await opened.json()
  ok(opened.status === 201 && openedBody.shift && !openedBody.shift.closed_at,
    'a shift opens and is still open')
  ok(sent.length === 0, 'OPEN SENDS NOTHING: a report on an empty drawer would be noise')

  // ---- 2. Closing sends the report, exactly once ---------------------------
  const closed = await post('/close', { closing_counted_usd: 412.5, closing_counted_khr: 350000 })
  const closedBody = await closed.json()
  ok(closed.status === 200 && closedBody.shift.closed_at, 'the close writes closed_at')
  ok(closedBody.already_closed === false, 'and reports itself as the close that won')
  ok(sent.length === 1, `CLOSE SENDS ONCE: exactly one report was pushed (got ${sent.length})`)
  ok(sent[0].shiftId === openedBody.shift.id,
    'and it names the shift that was just closed, by id')
  ok(sent[0].env === env, 'the sender is handed the Worker env, not a copy')

  // ---- 3. The response never waits on Telegram -----------------------------
  ok(waited.length === 1, 'the report is handed to executionCtx.waitUntil, so the till is not blocked on it')
  ok(typeof waited[0].then === 'function', 'and what was handed over is the promise itself')

  // ---- 4. A second close sends NOTHING -------------------------------------
  // This request still answers 200 with the existing row (a double-tap is a
  // deliberate no-op), so the 200 is not evidence that anything should have
  // been sent. The guard is `changed > 0`, which is the same UPDATE ... AND
  // closed_at IS NULL that makes "end only once" true.
  const again = await post('/close', { closing_counted_usd: 999, closing_counted_khr: 1 })
  const againBody = await again.json()
  ok(again.status === 200 && againBody.already_closed === true,
    'a second close is a no-op that still answers 200')
  ok(sent.length === 1, `ALREADY CLOSED SENDS NOTHING: still exactly one report (got ${sent.length})`)
  ok(againBody.shift.closing_counted_usd === 412.5,
    'and the first count survived, so the no-op really was one')

  // ---- 4b. TWO closes at once still send ONE report ------------------------
  //
  // The interesting case, and the one section 4 does NOT cover: a second tap
  // that arrives while the first is still in flight never reaches the
  // `if (shift.closed_at)` early return, because when it read the row the
  // shift was still open. Both requests run the UPDATE and only one matches
  // `AND closed_at IS NULL` -- so `changed > 0` is the ONLY thing standing
  // between the owner and two identical reports. Moving the send one line out
  // of that branch is invisible to every other check in this file.
  //
  // A fresh day-scoped row is needed because the shift above is closed and
  // the UNIQUE(user_id, branch_id, business_date) index refuses a second one.
  sqlite.prepare('DELETE FROM shift_sessions').run()
  sent.length = 0
  const reopened = await post('/open', { opening_float_usd: 20, opening_float_khr: 0 })
  ok(reopened.status === 201, 'a fresh shift is open for the race')
  const [raceA, raceB] = await Promise.all([
    post('/close', { closing_counted_usd: 100, closing_counted_khr: 0 }),
    post('/close', { closing_counted_usd: 100, closing_counted_khr: 0 }),
  ])
  const [bodyA, bodyB] = [await raceA.json(), await raceB.json()]
  const winners = [bodyA, bodyB].filter((body) => body.already_closed === false)
  ok(winners.length === 1, `exactly one of the two simultaneous closes wrote (got ${winners.length})`)
  ok(sent.length === 1, `RACE SENDS ONCE: two simultaneous closes produced ${sent.length} report(s), expected exactly 1`)

  // ---- 5. A close with no shift at all sends nothing -----------------------
  // A migrated but EMPTY table, so the 404 comes from "no row for today" and
  // not from a missing table -- the sender here throws if it is ever reached.
  const empty = new Database(':memory:')
  empty.exec(fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  empty.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
  empty.exec(fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
  const stranger = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': businessDateWindow,
    '../lib/db': { getDb: () => d1(empty) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 9, name: 'Nobody' }); await next() } },
    '../lib/permissions': { isAdminControlUser: () => false, hasPermission: () => false },
    '../lib/audit': { audit: async () => {} },
    '../lib/telegram': { sendTelegramShiftReport: async () => { throw new Error('a shift that does not exist must not be reported') } },
  })
  const strangerApp = stranger.default || stranger
  const missing = await strangerApp.fetch(
    new Request('http://till.local/close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    env,
    ctx,
  )
  ok(missing.status === 404, 'closing a shift that was never registered is a 404, and sends nothing')

  // ---- 6. The REAL sender cannot transmit when Telegram is unconfigured ----
  // Sections 1-5 stub the sender, so they say nothing about what the real one
  // does. This drives the actual function with fetch replaced by a throw: an
  // unconfigured Worker must decide NOT to send before it ever touches the
  // network, and it must swallow that decision rather than failing the close.
  const settingsOnly = {
    prepare: () => ({ async get() { return undefined }, async all() { return [] } }),
  }
  const telegram = loadReal('lib/telegram.ts', {
    './db': { getDb: () => settingsOnly },
    './businessDateWindow': businessDateWindow,
    './telegramLang': loadReal('lib/telegramLang.ts'),
    // telegram.ts imports lib/saleTotals.ts (the receipt lane: a shop-absorbed
    // delivery fee must not be billed into the alert Total). Loaded REAL -- a
    // stub of that rule would test the stub. Without the key loadReal throws.
    './saleTotals': loadReal('lib/saleTotals.ts'),
    './salesAnalytics': loadReal('lib/salesAnalytics.ts', {
      './db': { getDb: () => settingsOnly }, './businessDateWindow': businessDateWindow,
    }),
  })
  const realFetch = globalThis.fetch
  let attempted = 0
  globalThis.fetch = () => { attempted += 1; throw new Error('this test must never reach the network') }
  try {
    const result = await telegram.sendTelegramShiftReport({ TELEGRAM_BOT_TOKEN: '' }, 1)
    ok(result === false, 'the real sender answers false on an unconfigured Worker rather than throwing into the close')
    ok(attempted === 0, 'NO TRANSMISSION: it never called fetch at all')
  } finally {
    globalThis.fetch = realFetch
  }

  console.log(`\nALL ${checks} CHECKS PASSED`)
}

main().catch((error) => { console.error(error); process.exit(1) })
