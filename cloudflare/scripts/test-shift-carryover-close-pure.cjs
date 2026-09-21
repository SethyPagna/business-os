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
  }
}
function insertShift(sqlite, row) {
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(row)
  return sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(row.shift_code)
}
function openYesterday(sqlite, overrides = {}) {
  const { yesterday } = days(sqlite)
  return insertShift(sqlite, {
    shift_code: `S-CARRY-${Math.random().toString(36).slice(2, 8)}`, scope_mode: 'per_account',
    user_id: 7, user_name: 'cashier', branch_id: 1, branch_name: 'Shop',
    business_date: yesterday, opened_at: `${yesterday}T13:00:00.000Z`,
    opening_float_usd: 20, opening_float_khr: 40000,
    opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0, ...overrides,
  })
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
// The same continuation guard the list read uses -- copied, not invented.
assert.ok(source.includes('AND NOT EXISTS (SELECT 1 FROM shift_sessions later WHERE later.parent_shift_id = shift_sessions.id)'),
  'the list read carries the same continuation guard')
// The key is attached in exactly ONE place: GET /current. A write response
// that carried it would make the POS act on a snapshot taken before its own
// mutation.
const keyOccurrences = source.split('previous_open_shift').length - 1
assert.equal(keyOccurrences, 1, `previous_open_shift is attached in exactly one place (found ${keyOccurrences})`)

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
  await new Promise((resolve) => setTimeout(resolve, 20))
  const overlap = await trap.json('POST', `/${trapCarry.id}/close`, {
    expected_revision: trapCarry.revision, closed_at: new Date().toISOString(),
  })
  assert.equal(overlap.status, 409, 'closing the carry-over NOW would swallow today\'s shift')
  assert.equal(overlap.body.error, 'Closing time overlaps the next shift segment.')
  const beforeToday = new Date(new Date(trapOpen.body.shift.opened_at).getTime() - 1000).toISOString()
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
  // (g) an exempt administrator is not prompted and gets no carry-over
  // ========================================================================
  const adminDb = database()
  const admin = harness(adminDb)
  const adminCarry = openYesterday(adminDb, { user_id: ADMIN.id, user_name: 'boss', shift_code: 'S-ADMIN-CARRY' })
  admin.as(ADMIN)
  const exemptView = await admin.json('GET', '/current?branch_id=1')
  assert.equal(exemptView.body.exempt, true, 'admin_exempt defaults on')
  assert.equal(exemptView.body.needs_registration, false)
  assert.equal(exemptView.body.previous_open_shift, null, 'an exempt account is asked nothing at all')
  // DISCRIMINATING NEGATIVE: turn the exemption off and the very same row
  // appears -- still with no report attached, while the history read (which
  // IS a report surface) attaches one from the same stub.
  adminDb.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_admin_exempt','false')").run()
  const boundView = await admin.json('GET', '/current?branch_id=1')
  assert.equal(boundView.body.exempt, false)
  assert.equal(boundView.body.previous_open_shift.id, adminCarry.id)
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

  console.log('PASS a shift left open on a previous business day is discoverable, closable once, and never replaces the daily prompt')
}

main().catch((error) => { console.error(error); process.exit(1) })
