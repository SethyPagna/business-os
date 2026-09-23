// A shift left OPEN on a previous business day must be closable from the POS.
//
// The defect: shifts.ts readCurrent() answers with TODAY only (that is the
// owner's daily prompt and must stay that way), so GET /api/shifts/current
// returned `shift: null, needs_registration: true` and the payload carried
// nothing that named yesterday's still-open row. POST /api/shifts/:id/close
// already accepts any business date -- the POS simply could not discover the
// id, and the row stayed open forever.
//
// The fix under test: a SECOND read, readPreviousOpen(), reported on
// GET /current as `previous_open_shift`, ALONGSIDE the unchanged prompt.
//
// Two later defects on the same path are pinned here as well:
//
//   * the CLOSE BOUND. intervalError refuses a closing time later than the
//     opening of the next segment, and the client used to guess that bound
//     from TODAY's opening. With two stale days the next segment is the next
//     STALE day, so the guess was always refused with 409 "Closing time
//     overlaps the next shift segment." /current now answers the bound
//     itself, as `previous_open_close_before`, from readAdjacentShift --
//     literally the query the close is validated against, so the prefill and
//     the check cannot disagree. Section (j) is the composed proof: the two
//     candidate bounds are different values there, and only the real one is
//     accepted.
//   * the EXEMPT read. The carry-over used to be skipped entirely for an
//     admin-exempt account, which under shop_wide is the only account allowed
//     to end a stale row another cashier opened -- see section (k). Exemption
//     governs the daily PROMPT, never what a caller may close.
//
// This file pins both halves on the real route, an in-memory SQLite copy of
// the real shift migrations, and the real permission/business-date helpers:
//
//   1. source shape -- readCurrent still scopes to today, readPreviousOpen
//      scopes to earlier days and to rows that are neither closed nor
//      cancelled, and the response key exists in exactly one place;
//   2. behaviour -- the carry-over is offered, closed, and then gone, while
//      needs_registration never stops being true until today is registered;
//   3. a DISCRIMINATING NEGATIVE for every filter: the same SQL lifted from
//      the source with one clause removed is run against the same database
//      and returns the row the real clause excludes. A green pin that cannot
//      go red proves nothing.
//
// Run: node scripts/test-shift-carryover-close-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))
const source = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')

// ---- harness (the shape test-shift-lifecycle-pure.cjs uses) ---------------
function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
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
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (2,?,1)').run('Second')
  return db
}

const CASHIER = { id: 7, name: 'Cashier', username: 'cashier', permissions: JSON.stringify({ pos: true }) }
const OTHER_CASHIER = { id: 8, name: 'Other', username: 'other', permissions: JSON.stringify({ pos: true }) }
const ADMIN = { id: 9, name: 'Boss', username: 'boss', role_code: 'admin', permissions: JSON.stringify({ pos: true }) }

function harness(sqlite) {
  const state = { user: CASHIER, reports: [] }
  const dbModule = { getDb: () => d1(sqlite) }
  // The reconciliation/figures kernel is NOT under test here, but it must be
  // observable: these stubs return a recognisable non-null value so that any
  // surface which attaches them shows up as a present key. The carry-over
  // banner must never carry one (see figuresFor's comment in the route).
  const shiftReconciliation = {
    loadShiftReconciliation: async () => ({ marker: 'reconciliation-was-computed' }),
    loadShiftFigures: async () => ({ marker: 'figures-were-computed' }),
  }
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': dbModule,
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/shiftReconciliation': shiftReconciliation,
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async (_env, id) => { state.reports.push(id); return true } },
  })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })
  const json = async (method, url, body) => {
    const res = await call(method, url, body)
    return { status: res.status, body: await res.json() }
  }
  return { state, call, json, as: (user) => { state.user = user } }
}

function days(sqlite) {
  return {
    today: sqlite.prepare("SELECT date('now', '+7 hours') AS d").get().d,
    yesterday: sqlite.prepare("SELECT date('now', '+7 hours', '-1 day') AS d").get().d,
    threeDaysAgo: sqlite.prepare("SELECT date('now', '+7 hours', '-3 day') AS d").get().d,
  }
}
function insertShift(sqlite, row) {
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(row)
  return sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(row.shift_code)
}
function openOnDate(sqlite, businessDate, overrides = {}) {
  return insertShift(sqlite, {
    shift_code: `S-CARRY-${Math.random().toString(36).slice(2, 8)}`, scope_mode: 'per_account',
    user_id: 7, user_name: 'cashier', branch_id: 1, branch_name: 'Shop',
    business_date: businessDate, opened_at: `${businessDate}T13:00:00.000Z`,
    opening_float_usd: 20, opening_float_khr: 40000,
    opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0, ...overrides,
  })
}
function openYesterday(sqlite, overrides = {}) {
  return openOnDate(sqlite, days(sqlite).yesterday, overrides)
}

// ==========================================================================
// 1. SOURCE SHAPE
// ==========================================================================
function sliceFunction(name) {
  const start = source.indexOf(`async function ${name}(`)
  assert.ok(start > -1, `shifts.ts still defines ${name}()`)
  return source.slice(start, source.indexOf('\n}', start))
}
const readCurrentSource = sliceFunction('readCurrent')
const readPreviousOpenSource = sliceFunction('readPreviousOpen')

// The daily prompt is untouched: readCurrent still means TODAY. Widening it
// instead of adding a second read would have deleted the prompt.
assert.match(readCurrentSource, /AND business_date = \$\{localTodayExpr\(\)\}/,
  'readCurrent still scopes the current shift to TODAY (the daily prompt)')
assert.match(readPreviousOpenSource, /AND business_date < \$\{localTodayExpr\(\)\}/,
  'readPreviousOpen looks at EARLIER business days only')
assert.match(readPreviousOpenSource, /AND closed_at IS NULL AND cancelled_at IS NULL/,
  'readPreviousOpen offers only a row that is still open and not cancelled')
assert.match(readPreviousOpenSource, /NOT EXISTS \(SELECT 1 FROM shift_sessions later WHERE later\.parent_shift_id = shift_sessions\.id\)/,
  'readPreviousOpen offers the LAST segment of a lineage, like the list read')
// When more than one earlier business day is still open (the daily-open flow
// never checks for one -- see POST /open), the row offered is whichever the
// ORDER BY names, and it must be the OLDEST: intervalError refuses to close a
// later segment while an earlier one is still open, so newest-first is the
// one order the POS cannot drain. Every other case in this file has only ONE
// open earlier-day candidate, so ASC and DESC agree there; see section (j)
// and the DESC discriminator below for the pin that distinguishes them.
assert.ok(readPreviousOpenSource.includes('ORDER BY business_date ASC, opened_at ASC, id ASC LIMIT 1'),
  'readPreviousOpen orders by business_date ASC (the OLDEST earlier open day first), tie-broken by opened_at/id ASC')
// The same continuation guard the list read uses -- copied, not invented.
assert.ok(source.includes('AND NOT EXISTS (SELECT 1 FROM shift_sessions later WHERE later.parent_shift_id = shift_sessions.id)'),
  'the list read carries the same continuation guard')
// The key is attached in exactly ONE place: GET /current. A write response
// that carried it would make the POS act on a snapshot taken before its own
// mutation.
const keyOccurrences = source.split('previous_open_shift').length - 1
assert.equal(keyOccurrences, 1, `previous_open_shift is attached in exactly one place (found ${keyOccurrences})`)

// ---- the CLOSE BOUND is the CLOSE's own bound -----------------------------
//
// Pinned as SOURCE, not only as behaviour: a hand-written second query would
// pass every single-stale-day case in this file and still drift away from the
// rule intervalError applies. There is exactly one query, and both callers use
// it.
const currentHandlerSource = source.slice(source.indexOf("app.get('/current'"), source.indexOf("app.get('/',"))
assert.ok(currentHandlerSource.includes('previous_open_close_before'), 'GET /current answers the close bound')
assert.match(currentHandlerSource, /await readAdjacentShift\(db, carryOver, carryOver\.opened_at, 'next'\)/,
  "the bound is computed through readAdjacentShift(..., 'next')")
assert.ok(!currentHandlerSource.includes('db.prepare('),
  'the /current handler writes no SQL of its own -- nothing that could drift from intervalError')
assert.match(sliceFunction('intervalError'), /readAdjacentShift\(db, shift, openedAt, 'next'\)/,
  'and the CLOSE is validated through the same helper, so the two can never disagree')
const boundOccurrences = source.split('previous_open_close_before').length - 1
assert.equal(boundOccurrences, 1, `previous_open_close_before is attached in exactly one place (found ${boundOccurrences})`)

// ---- the exemption governs the PROMPT, not the carry-over -----------------
assert.match(currentHandlerSource, /const carryOver = await readPreviousOpen\(db, policy, user\.id, requestedBranchId\)/,
  'the carry-over is read for EVERY caller, exempt administrators included')
assert.ok(!/carryOver = exempt \?/.test(currentHandlerSource),
  'the exempt short-circuit that hid a foreign shop-wide stale row from the only account able to close it is gone')
assert.match(currentHandlerSource, /const shift = exempt \? undefined : await readCurrent\(/,
  'while the DAILY PROMPT read stays exempt-gated -- that is what the exemption is for')

// The SQL, lifted from the source, for the discriminating negatives below.
const sqlTemplate = readPreviousOpenSource.match(/db\.prepare\(`([\s\S]*?)`\)/)
assert.ok(sqlTemplate, 'readPreviousOpen builds one SQL template')
const CARRY_SQL = sqlTemplate[1]
  .replace('${SHIFT_COLUMNS}', 'id, business_date, closed_at, cancelled_at, parent_shift_id')
  .replace('${accountClause}', 'AND user_id = @userId')
  .replace('${localTodayExpr()}', "date('now', '+7 hours')")
assert.ok(!CARRY_SQL.includes('${'), `every template hole was filled: ${CARRY_SQL}`)
const CLAUSES = {
  day: "AND business_date < date('now', '+7 hours')",
  state: 'AND closed_at IS NULL AND cancelled_at IS NULL',
  lineage: 'AND NOT EXISTS (SELECT 1 FROM shift_sessions later WHERE later.parent_shift_id = shift_sessions.id)',
}
for (const [name, clause] of Object.entries(CLAUSES)) {
  assert.ok(CARRY_SQL.includes(clause), `the filled SQL still contains the ${name} clause verbatim: ${clause}`)
}
/** The real query minus ONE clause, run on the same database. This is the
 * instrument that makes every "null" pin below falsifiable. */
function withoutClause(sqlite, clause, params) {
  return sqlite.prepare(CARRY_SQL.replace(clause, '')).get({ branchId: null, userId: null, scopeMode: null, ...params })
}
const ORDER_CLAUSE = 'ORDER BY business_date ASC, opened_at ASC, id ASC'
assert.ok(CARRY_SQL.includes(ORDER_CLAUSE), `the filled SQL still contains the order clause verbatim: ${ORDER_CLAUSE}`)
/** The real query with ASC swapped for DESC on every ordering column, run on
 * the same database. Every "null"/"one candidate" pin above and below would
 * stay green under this swap; this is the instrument that would not. */
function withDescendingOrder(sqlite, params) {
  const flipped = CARRY_SQL.replace(ORDER_CLAUSE, 'ORDER BY business_date DESC, opened_at DESC, id DESC')
  assert.notEqual(flipped, CARRY_SQL, 'the DESC swap actually changed the SQL under test')
  return sqlite.prepare(flipped).get({ branchId: null, userId: null, scopeMode: null, ...params })
}
function carryQuery(sqlite, params) {
  return sqlite.prepare(CARRY_SQL).get({ branchId: null, userId: null, scopeMode: null, ...params })
}
const PER_ACCOUNT_7 = { scopeMode: 'per_account', userId: 7, branchId: 1 }

async function main() {
  // ========================================================================
  // (a) the carry-over is DISCOVERABLE, and the daily prompt still fires
  // ========================================================================
  const sqlite = database()
  const app = harness(sqlite)
  const carry = openYesterday(sqlite)
  const { today, yesterday } = days(sqlite)
  assert.notEqual(today, yesterday)

  const first = await app.json('GET', '/current?branch_id=1')
  assert.equal(first.status, 200)
  assert.equal(first.body.shift, null, 'yesterday\'s row is NOT today\'s current shift')
  assert.equal(first.body.needs_registration, true, 'the daily prompt still fires (owner rule)')
  assert.equal(first.body.is_open, false)
  assert.equal(first.body.can_end, false)
  assert.ok(first.body.previous_open_shift, 'the open previous-day shift is reported')
  assert.equal(first.body.previous_open_shift.id, carry.id)
  assert.equal(first.body.previous_open_shift.business_date, yesterday)
  assert.equal(first.body.previous_open_shift.closed_at, null)
  assert.equal(first.body.previous_open_shift.capabilities.can_close, true, 'the POS may close it')
  assert.equal(first.body.previous_open_shift.capabilities.can_reopen, false, 'an open shift is not reopenable')
  // A polled banner is not a report: no kernel run is attached to it.
  assert.ok(!('reconciliation' in first.body.previous_open_shift), 'the carry-over carries no reconciliation')
  assert.ok(!('figures' in first.body.previous_open_shift), 'the carry-over carries no figures')
  // The CLOSE BOUND travels with the offer. One stale day and today NOT open:
  // nothing was opened after that row, so there is no bound at all and any
  // moment up to the server's now is accepted.
  assert.ok('previous_open_close_before' in first.body, 'the close bound key is always answered')
  assert.equal(first.body.previous_open_close_before, null,
    'no later segment means no bound, and the POS may stamp the clock')

  // ========================================================================
  // (b) it CLOSES through the existing route, keeping its own business date
  // ========================================================================
  const closed = await app.json('POST', `/${carry.id}/close`, {
    expected_revision: carry.revision, closed_at: new Date().toISOString(),
    closing_counted_usd: 25, closing_counted_khr: 41000,
  })
  assert.equal(closed.status, 200, `closing the carry-over succeeds: ${JSON.stringify(closed.body)}`)
  assert.equal(closed.body.is_open, false)
  assert.ok(!('previous_open_shift' in closed.body), 'a write response never carries the carry-over key')
  const storedAfterClose = sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(carry.id)
  assert.equal(storedAfterClose.business_date, yesterday, 'the close does not move the shift to today')
  assert.ok(storedAfterClose.closed_at, 'the close stamped a real closing time')
  assert.equal(storedAfterClose.closing_counted_usd, 25)
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.close'").get().n, 1,
    'exactly one shift.close audit row')
  const amendments = sqlite.prepare('SELECT * FROM shift_session_amendments WHERE shift_session_id=?').all(carry.id)
  assert.equal(amendments.length, 1, 'the close writes exactly one before/after journal row')
  assert.equal(amendments[0].reason, 'Historic manual close')
  assert.equal(JSON.parse(amendments[0].before_json).closed_at, null)
  assert.equal(JSON.parse(amendments[0].after_json).closed_at, storedAfterClose.closed_at)

  // ========================================================================
  // (c) once closed it is gone -- and the prompt is STILL waiting for today
  // ========================================================================
  const afterClose = await app.json('GET', '/current?branch_id=1')
  assert.equal(afterClose.body.previous_open_shift, null, 'a closed carry-over is no longer offered')
  // NO CARRY-OVER: the bound key is still present, and it is null. An absent
  // key would mean "this Worker does not answer the bound" to the client.
  assert.ok('previous_open_close_before' in afterClose.body, 'the key is answered even with nothing to close')
  assert.equal(afterClose.body.previous_open_close_before, null, 'no carry-over, no bound')
  assert.equal(afterClose.body.needs_registration, true, 'today is still unregistered, so the prompt stands')
  assert.equal(afterClose.body.shift, null)
  // DISCRIMINATING NEGATIVE: without the closed/cancelled clause the same
  // query would hand the POS a shift that was already ended.
  assert.equal(withoutClause(sqlite, CLAUSES.state, PER_ACCOUNT_7)?.id, carry.id,
    'dropping "closed_at IS NULL AND cancelled_at IS NULL" would re-offer the closed shift')

  // ========================================================================
  // (d) registering today changes nothing about the carry-over key
  // ========================================================================
  const opened = await app.json('POST', '/open', { branch_id: 1, opening_float_usd: 30, opening_float_khr: 50000 })
  assert.equal(opened.status, 201, `today registers normally: ${JSON.stringify(opened.body)}`)
  assert.equal(opened.body.shift.business_date, today)
  assert.ok(!('previous_open_shift' in opened.body), 'POST /open does not carry the carry-over key')
  const afterOpen = await app.json('GET', '/current?branch_id=1')
  assert.equal(afterOpen.body.shift.id, opened.body.shift.id)
  assert.equal(afterOpen.body.is_open, true)
  assert.equal(afterOpen.body.needs_registration, false)
  assert.equal(afterOpen.body.previous_open_shift, null, 'today\'s own open shift is never offered as a carry-over')
  assert.equal(afterOpen.body.previous_open_close_before, null,
    'and with nothing offered there is no bound, however many shifts today holds')
  // DISCRIMINATING NEGATIVE: the business_date clause is what keeps today's
  // row out. Removing it (i.e. widening the read) would surface it, which is
  // exactly the double-offer the second query exists to avoid.
  assert.equal(withoutClause(sqlite, CLAUSES.day, PER_ACCOUNT_7)?.id, opened.body.shift.id,
    'dropping "business_date <" would offer TODAY\'s open shift as a carry-over')

  // ========================================================================
  // (e) ordering trap: the carry-over may not swallow today's shift
  // ========================================================================
  const trapDb = database()
  const trap = harness(trapDb)
  const trapCarry = openYesterday(trapDb)
  const trapOpen = await trap.json('POST', '/open', { branch_id: 1, opening_float_usd: 5, opening_float_khr: 5000 })
  assert.equal(trapOpen.status, 201)
  const trapCurrent = await trap.json('GET', '/current?branch_id=1')
  assert.equal(trapCurrent.body.previous_open_shift.id, trapCarry.id,
    'an open carry-over is still offered while today is registered')
  // ONE stale day and today OPEN: the bound is today's opening, which is the
  // next segment after the carry-over.
  assert.equal(trapCurrent.body.previous_open_close_before, trapOpen.body.shift.opened_at,
    'the bound handed to the POS is today\'s opening -- the next segment after the carry-over')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const overlap = await trap.json('POST', `/${trapCarry.id}/close`, {
    expected_revision: trapCarry.revision, closed_at: new Date().toISOString(),
  })
  assert.equal(overlap.status, 409, 'closing the carry-over NOW would swallow today\'s shift')
  assert.equal(overlap.body.error, 'Closing time overlaps the next shift segment.')
  // Closed against the bound the SERVER said, not a value this test guessed.
  const beforeToday = new Date(Date.parse(trapCurrent.body.previous_open_close_before) - 1000).toISOString()
  const tidy = await trap.json('POST', `/${trapCarry.id}/close`, {
    expected_revision: trapCarry.revision, closed_at: beforeToday,
  })
  assert.equal(tidy.status, 200, `closing it before today's opening is accepted: ${JSON.stringify(tidy.body)}`)
  assert.equal(trapDb.prepare('SELECT closed_at FROM shift_sessions WHERE id=?').get(trapCarry.id).closed_at, beforeToday)
  assert.equal((await trap.json('GET', '/current?branch_id=1')).body.previous_open_shift, null)

  // ========================================================================
  // (f) another account's carry-over is neither shown nor closable
  // ========================================================================
  const scopeDb = database()
  const scope = harness(scopeDb)
  const scopeCarry = openYesterday(scopeDb)
  scope.as(OTHER_CASHIER)
  const otherView = await scope.json('GET', '/current?branch_id=1')
  assert.equal(otherView.body.previous_open_shift, null, 'per_account scope hides another cashier\'s carry-over')
  const otherClose = await scope.json('POST', `/${scopeCarry.id}/close`, {
    expected_revision: scopeCarry.revision, closed_at: new Date().toISOString(),
  })
  assert.equal(otherClose.status, 403, 'another cashier cannot close it either')
  // DISCRIMINATING POSITIVE CONTROL: the owner, on the same database, sees
  // and closes it -- so the two nulls above are scope, not a dead query.
  scope.as(CASHIER)
  assert.equal((await scope.json('GET', '/current?branch_id=1')).body.previous_open_shift.id, scopeCarry.id)
  assert.equal((await scope.json('POST', `/${scopeCarry.id}/close`, {
    expected_revision: scopeCarry.revision, closed_at: new Date().toISOString(),
  })).status, 200)

  // ========================================================================
  // (g) an exempt administrator is not PROMPTED -- but still sees the row
  // ========================================================================
  // The exemption answers "must this account register its own day?", never
  // "what may this account close". The carry-over read used to be skipped for
  // an exempt account entirely, which hid a stale row from the one account
  // most able to deal with it (section (k) is the case where it is the ONLY
  // one able to).
  const adminDb = database()
  const admin = harness(adminDb)
  const adminCarry = openYesterday(adminDb, { user_id: ADMIN.id, user_name: 'boss', shift_code: 'S-ADMIN-CARRY' })
  admin.as(ADMIN)
  const exemptView = await admin.json('GET', '/current?branch_id=1')
  assert.equal(exemptView.body.exempt, true, 'admin_exempt defaults on')
  assert.equal(exemptView.body.needs_registration, false, 'an exempt account is not asked to register TODAY')
  assert.equal(exemptView.body.shift, null, 'and it is answered no current shift, exactly as before')
  assert.equal(exemptView.body.is_open, false)
  assert.equal(exemptView.body.can_end, false)
  assert.ok(exemptView.body.previous_open_shift, 'the exempt account is still TOLD about the earlier day left open')
  assert.equal(exemptView.body.previous_open_shift.id, adminCarry.id,
    'but the earlier day left open IS reported to it')
  assert.equal(exemptView.body.previous_open_shift.capabilities.can_close, true, 'and it may close it')
  assert.equal(exemptView.body.previous_open_close_before, null, 'nothing opened after that row, so no bound')
  assert.ok(!('reconciliation' in exemptView.body.previous_open_shift),
    'even for an exempt administrator the carry-over is a banner, not a report')
  // DISCRIMINATING NEGATIVE: turning the exemption off moves the PROMPT and
  // nothing else -- the same row is still offered, still with no report
  // attached, while the history read (which IS a report surface) attaches one
  // from the same stub.
  adminDb.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_admin_exempt','false')").run()
  const boundView = await admin.json('GET', '/current?branch_id=1')
  assert.equal(boundView.body.exempt, false)
  assert.equal(boundView.body.needs_registration, true, 'the exemption is what moved, and it moves the prompt')
  assert.equal(boundView.body.previous_open_shift.id, adminCarry.id, 'the offered row did not move with it')
  assert.equal(boundView.body.previous_open_close_before, null)
  assert.ok(!('reconciliation' in boundView.body.previous_open_shift),
    'even for an administrator the carry-over is a banner, not a report')
  assert.ok(!('figures' in boundView.body.previous_open_shift))
  const history = await admin.json('GET', `/${adminCarry.id}/history`)
  assert.equal(history.body.shift.reconciliation.marker, 'reconciliation-was-computed',
    'positive control: a report surface DOES attach the kernel, so its absence above is real')

  // ========================================================================
  // (h) a cancelled previous-day row is never offered
  // ========================================================================
  const cancelDb = database()
  const cancelled = harness(cancelDb)
  const cancelledRow = openYesterday(cancelDb, {
    shift_code: 'S-CANCELLED', cancelled_at: `${days(cancelDb).yesterday}T15:00:00.000Z`,
    cancelled_by_user_id: 9, cancelled_by_user_name: 'boss', cancel_reason: 'Opened by mistake',
  })
  // Same day, same account, a DIFFERENT till that is genuinely open.
  const liveRow = openYesterday(cancelDb, { shift_code: 'S-OTHER-BRANCH', branch_id: 2, branch_name: 'Second' })
  assert.equal((await cancelled.json('GET', '/current?branch_id=1')).body.previous_open_shift, null,
    'a cancelled previous-day row is not a shift to close')
  assert.equal((await cancelled.json('GET', '/current?branch_id=2')).body.previous_open_shift.id, liveRow.id,
    'positive control: the open till on the other branch IS offered')
  assert.equal(withoutClause(cancelDb, CLAUSES.state, PER_ACCOUNT_7)?.id, cancelledRow.id,
    'dropping the state clause would offer the cancelled row')

  // ========================================================================
  // (i) a previous-day segment that was CONTINUED is not offered
  // ========================================================================
  // Only the last segment of a lineage stands for the record (the list read's
  // rule). The route can never leave an open parent with a child, so the
  // shape is built through the schema's own restore path -- which is exactly
  // the path that can reintroduce it in production.
  const chainDb = database()
  const chain = harness(chainDb)
  const parent = openYesterday(chainDb, { shift_code: 'S-PARENT' })
  const chainYesterday = days(chainDb).yesterday
  chainDb.prepare(`INSERT INTO system_flags (key,value,updated_at) VALUES ('maintenance','{"mode":"restore"}',datetime('now'))`).run()
  const child = insertShift(chainDb, {
    shift_code: 'S-CHILD', scope_mode: 'per_account', user_id: 7, user_name: 'cashier',
    branch_id: 1, branch_name: 'Shop', business_date: chainYesterday,
    opened_at: `${chainYesterday}T16:00:00.000Z`, closed_at: `${chainYesterday}T18:00:00.000Z`,
    opening_float_usd: 0, opening_float_khr: 0, revision: 0,
    parent_shift_id: parent.id, reopen_reason: 'Recount', reopened_by_user_id: 7, reopened_by_user_name: 'cashier',
  })
  chainDb.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
  assert.equal(chainDb.prepare('SELECT COUNT(*) n FROM shift_sessions WHERE parent_shift_id=?').get(parent.id).n, 1)
  assert.ok(child.closed_at, 'the continuation segment is the one that was ended')
  assert.equal((await chain.json('GET', '/current?branch_id=1')).body.previous_open_shift, null,
    'a continued segment is not the row that stands for the record')
  assert.equal(withoutClause(chainDb, CLAUSES.lineage, PER_ACCOUNT_7)?.id, parent.id,
    'dropping the continuation guard would offer the superseded parent segment')
  // And the guard does not swallow an ordinary un-continued row.
  assert.equal(carryQuery(chainDb, { scopeMode: 'per_account', userId: 7, branchId: 2 }), undefined)
  const plain = openYesterday(chainDb, { shift_code: 'S-PLAIN', branch_id: 2, branch_name: 'Second' })
  assert.equal(carryQuery(chainDb, { scopeMode: 'per_account', userId: 7, branchId: 2 }).id, plain.id,
    'positive control: an un-continued open row on the same database IS returned')

  // ========================================================================
  // (j) TWO earlier open days: the offer is the OLDEST one, not the nearest
  // ========================================================================
  // POST /open never checks for an earlier still-open row (only readCurrent,
  // scoped to TODAY, gates it -- see the route above), so two earlier days
  // can genuinely both sit open at once. Every case so far has exactly one
  // open earlier-day candidate, so ASC and DESC agree everywhere else in
  // this file; this is the only case that tells them apart.
  const orderDb = database()
  const order = harness(orderDb)
  const { yesterday: orderYesterday, threeDaysAgo } = days(orderDb)
  const olderDay = openOnDate(orderDb, threeDaysAgo, { shift_code: 'S-OLDER-CARRY' })
  const newerDay = openOnDate(orderDb, orderYesterday, { shift_code: 'S-NEWER-CARRY' })
  // TODAY is registered too, so the two candidate bounds are DIFFERENT
  // values: the segment after the oldest stale day is the NEWER STALE DAY,
  // not today's opening. Today's opening is what the client used to guess,
  // and this is the shape in which that guess is always refused.
  const orderToday = await order.json('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 10000 })
  assert.equal(orderToday.status, 201, `today registers alongside two stale days: ${JSON.stringify(orderToday.body)}`)
  const todayOpenedAt = orderToday.body.shift.opened_at
  assert.notEqual(todayOpenedAt, newerDay.opened_at, 'the two candidate bounds are genuinely different values')

  // Why oldest first: shifts.ts enforces (in intervalError, account/branch-
  // wide, not just within one lineage) that a still-open earlier segment must
  // close before a later one can. Closing the NEWER row while the older one is
  // still open is refused, so an offer that named the newer day first would
  // hand the cashier a close that can only fail.
  const closeNewerFirst = await order.json('POST', `/${newerDay.id}/close`, {
    expected_revision: newerDay.revision, closed_at: new Date().toISOString(),
  })
  assert.equal(closeNewerFirst.status, 409, 'closing the nearer day first is refused while an older day is still open')
  assert.equal(closeNewerFirst.body.error, 'Opening time overlaps the previous shift segment.')

  const firstOffer = await order.json('GET', '/current?branch_id=1')
  assert.equal(firstOffer.body.previous_open_shift.id, olderDay.id,
    'business_date ASC offers the OLDEST earlier day (three days ago) first, the only one that can close')
  assert.equal(firstOffer.body.previous_open_shift.business_date, threeDaysAgo)
  // THE BOUND for that offer is the NEWER STALE DAY's opening.
  assert.equal(firstOffer.body.previous_open_close_before, newerDay.opened_at,
    'the bound is the next segment -- the newer stale day, not today')
  assert.notEqual(firstOffer.body.previous_open_close_before, todayOpenedAt,
    'and it is NOT today\'s opening, which is what the client used to guess')

  // DISCRIMINATING NEGATIVE, the verifier's D7 exactly: closing the offered
  // row one minute before TODAY's opening -- the old guess -- is refused,
  // because the newer stale day opened first.
  const oldGuess = await order.json('POST', `/${olderDay.id}/close`, {
    expected_revision: olderDay.revision, closed_at: new Date(Date.parse(todayOpenedAt) - 60_000).toISOString(),
  })
  assert.equal(oldGuess.status, 409, 'a prefill seeded from today\'s opening is refused with two stale days open')
  assert.equal(oldGuess.body.error, 'Closing time overlaps the next shift segment.')

  // Close the offered (older) day AT THE BOUND THE SERVER SAID minus a
  // minute; the offer then moves to the nearer day.
  const closeOlder = await order.json('POST', `/${olderDay.id}/close`, {
    expected_revision: olderDay.revision,
    closed_at: new Date(Date.parse(firstOffer.body.previous_open_close_before) - 60_000).toISOString(),
  })
  assert.equal(closeOlder.status, 200, `closing the offered older day at its own bound succeeds: ${JSON.stringify(closeOlder.body)}`)
  const secondOffer = await order.json('GET', '/current?branch_id=1')
  assert.equal(secondOffer.body.previous_open_shift.id, newerDay.id,
    'the nearer day is offered next once the older day is closed')
  // With the older day drained the next segment after the remaining stale day
  // IS today's opening, so the bound moves to it.
  assert.equal(secondOffer.body.previous_open_close_before, todayOpenedAt,
    'the bound follows the offer: today\'s opening is now the next segment')

  // Now the nearer day closes against its own bound, and nothing is left to
  // drain: the chain drains oldest to newest, every step accepted first try.
  const closeNewerSecond = await order.json('POST', `/${newerDay.id}/close`, {
    expected_revision: newerDay.revision,
    closed_at: new Date(Date.parse(secondOffer.body.previous_open_close_before) - 60_000).toISOString(),
  })
  assert.equal(closeNewerSecond.status, 200, `closing the nearer day succeeds once the older day is closed: ${JSON.stringify(closeNewerSecond.body)}`)
  const drained = await order.json('GET', '/current?branch_id=1')
  assert.equal(drained.body.previous_open_shift, null,
    'once both earlier days are closed, nothing is left to offer')
  assert.equal(drained.body.previous_open_close_before, null, 'and no bound is left either')
  assert.equal(drained.body.is_open, true, 'while today\'s own shift -- never a carry-over -- is still open')

  // DISCRIMINATING NEGATIVE: the real SQL with ASC swapped for DESC, run on
  // a fresh two-open-row database, picks the NEWER day -- the one the route
  // refuses to close first -- proving the ASC pin above is falsifiable.
  const descDb = database()
  const descOlder = openOnDate(descDb, threeDaysAgo, { shift_code: 'S-OLDER-DESC' })
  const descNewer = openOnDate(descDb, orderYesterday, { shift_code: 'S-NEWER-DESC' })
  const descPick = withDescendingOrder(descDb, { scopeMode: 'per_account', userId: 7, branchId: 1 })
  assert.equal(descPick.id, descNewer.id,
    'swapping ASC for DESC would offer the NEWER day first -- the close the route refuses; this is the gap the real ORDER BY closes')
  assert.notEqual(descPick.id, descOlder.id)

  // ========================================================================
  // (k) shop_wide: the exempt administrator is the account that can drain it
  // ========================================================================
  // Under shop_wide the shift belongs to the BRANCH, so a stale row opened by
  // one cashier can only be ended by its owner or an administrator. When that
  // cashier is away, the administrator is the only account left -- and the
  // administrator is exactly the account the exempt short-circuit used to
  // answer "nothing to see" to.
  const wideDb = database()
  const wide = harness(wideDb)
  wideDb.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
  const wideCarry = openYesterday(wideDb, { shift_code: 'S-WIDE-CARRY', scope_mode: 'shop_wide' })
  // A plain cashier who does not own it SEES it (shop_wide is the shop's
  // shift, not an account's) and may not end it. Unchanged.
  wide.as(OTHER_CASHIER)
  const wideCashier = await wide.json('GET', '/current?branch_id=1')
  assert.equal(wideCashier.body.previous_open_shift.id, wideCarry.id, 'a shop_wide row is visible to the shop')
  assert.equal(wideCashier.body.previous_open_shift.capabilities.can_close, false,
    'but a cashier who does not own the row cannot close it')
  assert.equal(wideCashier.body.needs_registration, true, 'and that cashier is still prompted for today')
  // The administrator: exempt, so asked nothing about its own day, and now
  // offered the foreign row it is the only account able to end.
  wide.as(ADMIN)
  const wideAdmin = await wide.json('GET', '/current?branch_id=1')
  assert.equal(wideAdmin.body.exempt, true)
  assert.equal(wideAdmin.body.needs_registration, false, 'the exempt admin is still not prompted to register')
  assert.equal(wideAdmin.body.shift, null, 'and still has no current shift of its own')
  assert.equal(wideAdmin.body.is_open, false)
  assert.equal(wideAdmin.body.can_end, false)
  assert.ok(wideAdmin.body.previous_open_shift,
    'the exempt administrator is not answered "nothing to see" about a foreign shop-wide stale row')
  assert.equal(wideAdmin.body.previous_open_shift.id, wideCarry.id,
    'the foreign shop-wide stale row IS offered to the exempt administrator')
  assert.equal(wideAdmin.body.previous_open_shift.capabilities.can_close, true,
    'and the administrator may close it -- can_end above is about TODAY, not this row')
  assert.equal(wideAdmin.body.previous_open_close_before, null, 'nothing opened after it, so there is no bound')
  assert.ok(!('reconciliation' in wideAdmin.body.previous_open_shift), 'still a banner, not a report')
  // The offer is ACTIONABLE, not decorative: the close the banner promises
  // goes through on the same identity that read it.
  const wideClose = await wide.json('POST', `/${wideCarry.id}/close`, {
    expected_revision: wideCarry.revision, closed_at: new Date().toISOString(),
  })
  assert.equal(wideClose.status, 200, `the exempt admin ends the foreign shop-wide row: ${JSON.stringify(wideClose.body)}`)
  assert.equal((await wide.json('GET', '/current?branch_id=1')).body.previous_open_shift, null,
    'and once ended it is gone for that account too')

  console.log('PASS a shift left open on a previous business day is discoverable by every account that may end it, '
    + 'closable once at the bound the Worker itself enforces, and never replaces the daily prompt')
}

main().catch((error) => { console.error(error); process.exit(1) })
