// The close BOUND on a LISTED shift row.
//
// The defect (D12, pre-existing since 3f9a6b56): the Shifts popup's close form
// (frontend/src/components/shifts/ShiftHistoryModal.tsx) prefilled the CURRENT
// minute and posted it to POST /shifts/:id/close -- the same route the POS
// carry-over close uses. intervalError refuses a closing time later than the
// opening of the segment that FOLLOWS the row (409 "Closing time overlaps the
// next shift segment."), so for any row still open with a later segment -- one
// forgotten day plus today, or two forgotten days -- the default press was
// always refused, and nothing on screen said which minute would be accepted.
// With nothing opened after the row, that very same press succeeded.
//
// The fix under test is on the READ side: every presented row that can still be
// closed carries `close_before`, computed with readAdjacentShift(..., 'next')
// -- literally the query the close is validated against, so the prefill and the
// check cannot disagree. It is the row-level twin of the
// `previous_open_close_before` that /current already reports for the POS
// carry-over (pinned in test-shift-carryover-close-pure.cjs).
//
// Pinned here, on the real route over an in-memory SQLite copy of the real
// shift migrations:
//
//   1. source shape -- the bound comes through readAdjacentShift 'next', and
//      the list maps its rows through the presenter that attaches it;
//   2. the LIST (plain and paged): an open row with a later segment carries
//      that segment's opening; an open row with nothing after it carries null;
//      a closed row and a cancelled row carry null;
//   3. the RECORD read and the write responses the popup replaces its selected
//      row from carry the same field, so no surface can lose it;
//   4. the composed proof of the defect: closing the stale row AT the value the
//      list handed back is accepted (200), while the clock reading the old form
//      prefilled is refused (409) on the very same row;
//   5. negative controls -- the executed assertions are re-run against mutated
//      copies of shifts.ts (the bound read 'previous' instead of 'next', and
//      the bound dropped entirely), and the run fails if a mutant passes.
//
// Run: node scripts/test-shift-list-close-bound-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))
const routePath = path.join(root, 'src', 'routes', 'shifts.ts')
const source = fs.readFileSync(routePath, 'utf8')
let checks = 0
const ok = (value, message) => { assert.ok(value, message); checks += 1 }
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1 }

// ---- harness (the shape test-shift-carryover-close-pure.cjs uses) ---------
function compile(text, sourcePath, overrides = {}) {
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}
function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  return compile(fs.readFileSync(sourcePath, 'utf8'), sourcePath, overrides)
}

function d1(sqlite) {
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
    async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
    async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
  })
  return {
    prepare: statement,
    async batch(items) {
      return sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values)
        return { meta: { changes: info.changes } }
      }))()
    },
  }
}

function database() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_active INTEGER DEFAULT 1);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0089_system_flags.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0119_shift_restore_guard.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0123_shift_reopen_segments.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0132_shift_opening_count_presence.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(root, 'migrations', '0147_shift_additional_cash.sql'), 'utf8'))
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Shop')
  return db
}

const CASHIER = { id: 7, name: 'Cashier', username: 'cashier', permissions: JSON.stringify({ pos: true }) }
const ADMIN = { id: 9, name: 'Boss', username: 'boss', role_code: 'admin', permissions: JSON.stringify({ pos: true }) }

function harness(sqlite, routeSource = source) {
  const state = { user: CASHIER }
  const route = compile(routeSource, routePath, {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/shiftReconciliation': {
      loadShiftReconciliation: async () => ({ marker: 'reconciliation' }),
      loadShiftFigures: async () => ({ marker: 'figures' }),
    },
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
  })
  const app = route.default || route
  const json = async (method, url, body) => {
    const res = await app.fetch(new Request(`http://test${url}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), {}, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  return { state, json, as: (user) => { state.user = user } }
}

function days(sqlite) {
  return {
    today: sqlite.prepare("SELECT date('now', '+7 hours') AS d").get().d,
    yesterday: sqlite.prepare("SELECT date('now', '+7 hours', '-1 day') AS d").get().d,
    twoDaysAgo: sqlite.prepare("SELECT date('now', '+7 hours', '-2 day') AS d").get().d,
    threeDaysAgo: sqlite.prepare("SELECT date('now', '+7 hours', '-3 day') AS d").get().d,
  }
}
let codeSeed = 0
function insertShift(sqlite, row) {
  const full = {
    shift_code: `S-BOUND-${++codeSeed}`, scope_mode: 'per_account', user_id: 7, user_name: 'cashier',
    branch_id: 1, branch_name: 'Shop', opening_float_usd: 20, opening_float_khr: 40000,
    opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0, ...row,
  }
  const columns = Object.keys(full)
  sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(full)
  return sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(full.shift_code)
}
/** An hour of today that is already in the past, whatever the clock says when
 *  this file runs: the today row has to be opened BEFORE "now" for the 409
 *  reproduction to be about the interval rule and not about a future stamp. */
function earlierTodayIso() {
  return new Date(Date.now() - 90 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}
const rowById = (body, id) => (body.shifts || []).find((shift) => shift.id === id)

// ==========================================================================
// 1. SOURCE SHAPE
// ==========================================================================
function sliceFunction(text, name) {
  const start = text.indexOf(`async function ${name}(`)
  assert.ok(start > -1, `shifts.ts still defines ${name}()`)
  return text.slice(start, text.indexOf('\n}', start))
}
const closeBoundSource = sliceFunction(source, 'closeBoundFor')
const presentSource = sliceFunction(source, 'presentShift')

// The bound is the SAME query the close is validated against. Guessing it from
// today's opening is the defect the POS lane already had to fix once.
ok(/readAdjacentShift\(db, shift, shift\.opened_at, 'next'\)/.test(closeBoundSource),
  "closeBoundFor reads the next segment with readAdjacentShift(..., 'next'), the query intervalError uses")
ok(/if \(shift\.closed_at \|\| shift\.cancelled_at\) return null/.test(closeBoundSource),
  'a row that cannot be closed answers null without touching D1')
ok(/close_before: await closeBoundFor\(db, shift\)/.test(presentSource),
  'presentShift attaches the bound to the row it presents')
ok(/const shifts = await Promise\.all\(rows\.filter\([\s\S]{0,240}?presentShift\(db, user, shift\)\)\)/.test(source),
  'the PAGED list maps its rows through that presenter')
ok(/shifts: await Promise\.all\(\[\.\.\.openShifts, \.\.\.closedShifts\]\.map\(\(shift\) => presentShift\(db, user, shift\)\)\)/.test(source),
  'and so does the plain list')
ok(/segments: await Promise\.all\(segments\.map\(\(segment\) => presentShift\(db, user, segment\)\)\)/.test(source),
  'the record read presents its segments the same way')
ok(/const shift = await presentShift\(getDb\(env\), user, row\)/.test(source),
  'and reconciledShift -- the record read and every close/replay response -- goes through it too')
console.log('  ok - source: the bound comes from readAdjacentShift(next) and every presented row carries it')

// ==========================================================================
// 2. THE LIST
// ==========================================================================
// One account, four business days, in the order they happened: a closed day,
// a cancelled day, the day whose drawer was never ended, and today -- already
// opened, which is what makes the stale row's close bounded at all. Only the
// per-day root is inserted (migration 0123 allows one root per account/day).
async function listCase(routeSource = source) {
  const sqlite = database()
  const day = days(sqlite)
  const closed = insertShift(sqlite, {
    business_date: day.threeDaysAgo, opened_at: `${day.threeDaysAgo} 01:00:00`,
    closed_at: `${day.threeDaysAgo} 09:00:00`, closing_counted_usd: 30, closing_counted_khr: 0, revision: 1,
  })
  const cancelled = insertShift(sqlite, {
    business_date: day.twoDaysAgo, opened_at: `${day.twoDaysAgo} 01:00:00`,
    cancelled_at: `${day.twoDaysAgo} 02:00:00`, cancelled_by_user_id: 9, cancel_reason: 'Opened twice', revision: 1,
  })
  const stale = insertShift(sqlite, { business_date: day.yesterday, opened_at: `${day.yesterday} 01:00:00` })
  const today = insertShift(sqlite, { business_date: day.today, opened_at: earlierTodayIso() })
  const app = harness(sqlite, routeSource)
  return { sqlite, day, stale, today, closed, cancelled, app }
}

async function main() {
{
  const { stale, today, closed, cancelled, app } = await listCase()
  const list = await app.json('GET', '/?branch_id=1')
  eq(list.status, 200, 'the list read answers')
  eq(rowById(list.body, stale.id).close_before, today.opened_at,
    "an OPEN row with a later segment carries that segment's opening as close_before")
  eq(rowById(list.body, today.id).close_before, null,
    'an OPEN row with nothing after it carries null -- any time up to now is accepted')
  eq(rowById(list.body, closed.id).close_before, null, 'a CLOSED row carries null')
  eq(rowById(list.body, cancelled.id).close_before, null,
    'a CANCELLED row carries null even though a later segment exists -- it cannot be closed at all')
  ok('close_before' in rowById(list.body, closed.id),
    'the key is present on every row, so "no bound" never has to be told from "old Worker" by shape')

  const paged = await app.json('GET', '/?branch_id=1&page=1&page_size=20')
  eq(paged.status, 200, 'the paged list read answers')
  eq(rowById(paged.body, stale.id).close_before, today.opened_at, 'the PAGED list carries the same bound (sibling parity)')
  eq(rowById(paged.body, today.id).close_before, null, 'and the same null for the row with nothing after it')
  console.log('  ok - executed: the list states the bound on open rows and null everywhere else')
}

// ==========================================================================
// 3. THE RECORD READ AND THE WRITE RESPONSES
// ==========================================================================
{
  const { stale, today, app } = await listCase()
  const history = await app.json('GET', `/${stale.id}/history`)
  eq(history.status, 200, 'the record read answers')
  eq(history.body.shift.close_before, today.opened_at,
    'the record read carries the bound -- it is what the popup selects once the list row is opened')
  eq(history.body.segments[0].close_before, today.opened_at, 'and so does the segment the record stands for')

  app.as(ADMIN)
  const amended = await app.json('PATCH', `/${stale.id}`, {
    expected_revision: 0, reason: 'Correct the opening float', opening_float_usd: 25, opening_float_khr: 40000,
  })
  eq(amended.status, 200, 'an amendment on the open row is accepted')
  eq(amended.body.shift.close_before, today.opened_at,
    'and its response still carries the bound, so the close form cannot lose it after an edit')
  console.log('  ok - executed: the record read and the write responses keep the bound')
}

// ==========================================================================
// 4. THE DEFECT ITSELF, COMPOSED
// ==========================================================================
{
  const { stale, today, app } = await listCase()
  const list = await app.json('GET', '/?branch_id=1')
  const bound = rowById(list.body, stale.id).close_before
  eq(bound, today.opened_at, 'the list states the bound the form will seed from')

  // What the old form sent: the current minute. A later segment exists, so this
  // is exactly the 409 the operator met on the default press.
  const clockClose = await app.json('POST', `/${stale.id}/close`, { expected_revision: 0 })
  eq(clockClose.status, 409, 'closing the stale row AT THE CLOCK is refused -- the D12 defect, reproduced')
  eq(clockClose.body.error, 'Closing time overlaps the next shift segment.', 'with the interval sentence')

  // What the seeded form sends: a minute before the stated bound.
  const seeded = new Date(Date.parse(`${bound.replace(' ', 'T')}Z`) - 60_000).toISOString()
  const seededClose = await app.json('POST', `/${stale.id}/close`, { expected_revision: 0, closed_at: seeded })
  eq(seededClose.status, 200, 'and closing it a minute before the STATED bound is accepted')
  eq(seededClose.body.shift.closed_at, seeded, 'at exactly the moment the form offered')
  eq(seededClose.body.shift.close_before, null, 'after which the row is closed and states no bound at all')
  console.log('  ok - executed: the stated bound is accepted where the clock reading is refused')
}

// ==========================================================================
// 5. NEGATIVE CONTROLS
// ==========================================================================
{
  // (a) the bound read BACKWARDS. 'previous' is a real value of the same
  //     helper, so this mutant is the closest wrong answer there is.
  const backwards = source.replace(
    "return (await readAdjacentShift(db, shift, shift.opened_at, 'next'))?.opened_at ?? null",
    "return (await readAdjacentShift(db, shift, shift.opened_at, 'previous'))?.opened_at ?? null")
  assert.notEqual(backwards, source, 'the backwards negative control could not find its target')
  const first = await listCase(backwards)
  const mutantBound = rowById((await first.app.json('GET', '/?branch_id=1')).body, first.stale.id).close_before
  assert.notEqual(mutantBound, first.today.opened_at,
    'NOT DISCRIMINATING -- reading the PREVIOUS segment produced the same bound')
  checks += 1

  // (b) no bound at all: the state the popup was in before this change.
  const dropped = source.replace(
    'return { ...shift, close_before: await closeBoundFor(db, shift) }',
    'return { ...shift, close_before: null }')
  assert.notEqual(dropped, source, 'the dropped-bound negative control could not find its target')
  const second = await listCase(dropped)
  const none = rowById((await second.app.json('GET', '/?branch_id=1')).body, second.stale.id).close_before
  assert.notEqual(none, second.today.opened_at, 'NOT DISCRIMINATING -- dropping the bound produced the same value')
  eq(none, null, 'the mutant answers null, which is what the list looked like before this change')
  console.log('  ok - executed: both mutants are caught, so the assertions above can fail')
}

console.log(`shift list close bound: ${checks} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
