// A shift left open on an earlier Cambodia day can be closed late (owner A74, A75, A76, 23 Nov 2026): POST /api/shifts/:id/close.
//   - by the cashier who opened it, an administrator, or a holder of "Close forgotten shifts"; everybody gives a reason;
//   - the time is on that day (default 23:59:59, never later), after the day's last money record and before the next segment opens;
//   - the late close adds no statement and no row to a same-day close (A76): the one last-activity read is bounded, nothing else;
//   - the shift carries the "closed_late" review with its reason, and the amendment text is "Late close: <reason>".
// Cases 1 to 4 and 6 to 13 follow the design's S2 list; case 5 is the A76 form (money after the close stays out, no gap check).
// The last-activity read is a stub that runs ONE real statement over a small table with the same [from, until) contract as the Worker's
// read, so a route that forgets the bound reads the next day's sale and the test sees it.
// Env SHIFTS_ROUTE_SOURCE / SHIFT_LATE_CLOSE_SOURCE name a mutated copy of the route / the rule library (mutant runs only).
// Run: node scripts/test-shift-late-close-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function loadReal(relPath, overrides = {}, sourceOverride = null) {
  const sourcePath = sourceOverride || path.join(root, 'src', relPath)
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

const stats = { prepare: 0, batch: 0 }
function d1(sqlite) {
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => {
    stats.prepare += 1
    return {
      async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
      async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
      async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
    }
  }
  return {
    prepare: statement,
    async batch(items) {
      stats.batch += 1
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
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL);
    CREATE TABLE review_log (id INTEGER PRIMARY KEY)`)
  for (const file of ['0089_system_flags', '0118_shift_policy_and_amendments', '0119_shift_restore_guard', '0123_shift_reopen_segments', '0132_shift_opening_count_presence', '0147_shift_additional_cash']) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', `${file}.sql`), 'utf8'))
  }
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Shop')
  return db
}

const user = (id, name, permissions, extra = {}) => ({ id, name, username: name, permissions: JSON.stringify(permissions), ...extra })
const CASHIER = user(7, 'cashier', { pos: true })
const COLLEAGUE = user(8, 'colleague', { pos: true })
const HOLDER = user(10, 'holder', { pos: true, shift_close_forgotten: true })
const STRING_HOLDER = user(11, 'stringholder', { pos: true, shift_close_forgotten: 'true' })
const ROLE_HOLDER = user(12, 'rolemanager', { pos: true }, { role_permissions: JSON.stringify({ shift_close_forgotten: true }) })
const ADMIN = user(9, 'boss', { pos: true }, { role_code: 'admin' })

const SHIFTS_SOURCE = process.env.SHIFTS_ROUTE_SOURCE || null
const LIB_SOURCE = process.env.SHIFT_LATE_CLOSE_SOURCE || null

function harness(sqlite) {
  const state = { user: CASHIER, windows: [], reports: [] }
  const dbModule = { getDb: () => d1(sqlite) }
  const shiftReconciliation = {
    SHIFT_REVIEW: { earlierClose: 'closed_at_earlier_time', laterOpen: 'opened_at_later_time', reopenedAfterEarlierClose: 'reopened_after_earlier_close', closedLate: 'closed_late' },
    async shiftLastActivityMs(_env, shift, _nowMs, window = {}) {
      state.windows.push({ shiftId: shift.id, window })
      const row = await dbModule.getDb().prepare('SELECT MAX(at) AS at FROM activity WHERE at >= @from AND (@until IS NULL OR at < @until)')
        .get({ from: window.from ?? shift.opened_at, until: window.until ?? null })
      return row?.at ? Date.parse(row.at) : null
    },
    async readShiftTimeReview() { await dbModule.getDb().prepare('SELECT 1 AS one FROM review_log').get({}); return null },
    loadShiftReconciliation: async () => ({ marker: 'reconciliation-was-computed' }),
    loadShiftFigures: async () => ({ marker: 'figures-were-computed' }),
  }
  const route = loadReal('routes/shifts.ts', {
    '../lib/saleStatusResolution': require('./harness/sale_status_resolution.cjs'),
    '../lib/branchRedirectWrite': require('./harness/branch_redirect_write.cjs'),
    '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/shiftLateClose': loadReal('lib/shiftLateClose.ts', {}, LIB_SOURCE),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'), '../lib/phoneAccess': { phoneSearchAccessOf: () => ({ fullPhone: true }) }, '../lib/phoneSearchGuard': { searchableColumnSql: (column) => (typeof column === 'string' ? column : column.sql) },
    '../lib/db': dbModule,
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/shiftReconciliation': shiftReconciliation,
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/planTier': { getPlanLimits: () => ({ d1QueriesPerInvocation: 1000, forgottenShiftListMax: 50 }) },
    '../lib/acquisitionCostAccess': { holdsCostViewGrant: () => true },
    '../lib/telegram': { scheduleTelegramShiftOverview: async () => 'unavailable', scheduleTelegramShiftReport: async () => 'unavailable', loadTelegramConfig: async () => ({}), sendTelegramShiftReport: async (_env, id) => { state.reports.push(id); return true }, sendTelegramStaleShiftAlert: async () => true },
  }, SHIFTS_SOURCE)
  const app = route.default || route
  const json = async (method, url, body) => {
    const res = await app.fetch(new Request(`http://test${url}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }), {}, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  return { state, json, as: (who) => { state.user = who } }
}

function world() {
  const sqlite = database()
  const d = (modifier) => sqlite.prepare(`SELECT date('now', '+7 hours'${modifier ? `, '${modifier}'` : ''}) AS d`).get().d
  const today = d(), yesterday = d('-1 day')
  const dayEnd = (date) => `${date}T16:59:59.000Z`
  const nextMidnight = (date) => `${date}T17:00:00.000Z`
  const startOfToday = Date.parse(`${yesterday}T17:00:00.000Z`)
  const todayOpenedAt = new Date(Math.max(startOfToday, Date.now() - 5 * 60 * 1000)).toISOString()
  const insert = (row) => {
    const columns = Object.keys(row)
    sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(row)
    return sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(row.shift_code)
  }
  const open = (businessDate, overrides = {}) => insert({
    shift_code: `S-LATE-${Math.random().toString(36).slice(2, 8)}`, scope_mode: 'per_account', user_id: 7, user_name: 'cashier', branch_id: 1, branch_name: 'Shop',
    business_date: businessDate, opened_at: `${businessDate}T13:00:00.000Z`, opening_float_usd: 20, opening_float_khr: 40000,
    opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0, ...overrides,
  })
  const dayOne = (overrides = {}) => open(yesterday, overrides)
  const dayTwo = (overrides = {}) => open(today, { opened_at: todayOpenedAt, ...overrides })
  const sale = (at) => sqlite.prepare('INSERT INTO activity(at) VALUES (?)').run(at)
  const stored = (id) => sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(id)
  const amendment = (id) => sqlite.prepare('SELECT * FROM shift_session_amendments WHERE shift_session_id=? ORDER BY id DESC LIMIT 1').get(id)
  const review = (id) => JSON.parse(amendment(id).after_json).time_review || []
  return { sqlite, h: harness(sqlite), today, yesterday, dayEnd, nextMidnight, dayOne, dayTwo, open, sale, stored, amendment, review }
}

let passed = 0
const keepGoing = process.env.SHIFT_LATE_CLOSE_KEEP_GOING === '1'
const failed = []
const check = async (name, fn) => {
  try { await fn(); passed += 1; console.log('PASS ' + name) } catch (error) {
    if (!keepGoing) throw error
    failed.push(name); console.log('FAIL ' + name + ' :: ' + String(error.message).split('\n')[0].slice(0, 160))
  }
}
const REASON = 'Forgot to close'
const close = (w, shift, body = {}) => w.h.json('POST', `/${shift.id}/close`, { expected_revision: shift.revision, ...body })

async function main() {
  await check('1. an employee closes the earlier day with a reason after today is registered: 200 at 23:59:59 of that day (late rule applied)', async () => {
    const w = world(); const late = w.dayOne(); w.dayTwo()
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(w.stored(late.id).closed_at, w.dayEnd(w.yesterday), 'the close is stamped at 23:59:59 on the shift\'s own day')
    assert.equal(w.stored(late.id).business_date, w.yesterday)
  })

  await check('1b. before today is registered the close is the same', async () => {
    const w = world(); const late = w.dayOne()
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(w.stored(late.id).closed_at, w.dayEnd(w.yesterday))
  })

  await check('2. no reason, blank or over 500 characters: 400 shift_late_reason_required, nothing written (reason optional)', async () => {
    for (const reason of [undefined, '', '   ', 'a'.repeat(501), 5]) {
      const w = world(); const late = w.dayOne(); w.dayTwo()
      const res = await close(w, late, reason === undefined ? {} : { reason })
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.code, 'shift_late_reason_required')
      assert.equal(w.stored(late.id).closed_at, null)
    }
    const w = world(); const late = w.dayOne()
    assert.equal((await close(w, late, { reason: 'a'.repeat(500) })).status, 200, 'exactly 500 characters is accepted')
  })

  await check('3. a same-day close needs no reason and is stamped now (reason required on every close)', async () => {
    const w = world(); const same = w.dayTwo()
    const res = await close(w, same, {})
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.ok(Math.abs(Date.parse(w.stored(same.id).closed_at) - Date.now()) < 60 * 1000, 'stamped now')
    assert.equal(w.amendment(same.id).reason, 'Historic manual close', 'the same-day amendment text is unchanged')
    assert.ok(!w.review(same.id).some((entry) => entry.code === 'closed_late'))
  })

  await check('4. an employee time on a later day is refused: 409 shift_late_close_outside_day (any employee time accepted)', async () => {
    const w = world(); const late = w.dayOne()
    for (const closed_at of [w.nextMidnight(w.yesterday), `${w.today}T05:00:00.000Z`, '2099-01-01T00:00:00.000Z']) {
      const res = await close(w, late, { reason: REASON, closed_at })
      assert.equal(res.status, 409, `${closed_at} ${JSON.stringify(res.body)}`)
      assert.equal(res.body.code, 'shift_late_close_outside_day')
    }
    assert.equal(w.stored(late.id).closed_at, null)
    const inDay = `${w.yesterday}T15:00:00.000Z`
    const ok = await close(w, late, { reason: REASON, closed_at: inDay })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(w.stored(late.id).closed_at, inDay, 'a time on the day is honoured for an employee')
    const bad = world(); const badLate = bad.dayOne()
    assert.equal((await close(bad, badLate, { reason: REASON, closed_at: 'not a time' })).status, 400)
  })

  await check('5. money on the next day before it was registered stays out of the shift: 200, tagged closed_late, no gap check', async () => {
    const w = world(); const late = w.dayOne(); w.dayTwo()
    w.sale(`${w.today}T00:30:00.000Z`)
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(w.stored(late.id).closed_at, w.dayEnd(w.yesterday))
    const tag = w.review(late.id).find((entry) => entry.code === 'closed_late')
    assert.deepEqual(tag, { code: 'closed_late', by: 'cashier', reason: REASON })
    assert.ok(!w.review(late.id).some((entry) => entry.code === 'closed_at_earlier_time'))
    const raw = JSON.stringify(res.body)
    assert.ok(!/money_after/.test(raw), 'no money-after code exists')
  })

  await check('5b. the reason is in the amendment, the audit line and the time review; an administrator is named by the account', async () => {
    const w = world(); const late = w.dayOne()
    w.h.as(ADMIN)
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(w.amendment(late.id).reason, `Late close: ${REASON}`)
    const audit = w.sqlite.prepare("SELECT details FROM audit_logs WHERE action='shift.close'").get()
    assert.equal(JSON.parse(audit.details).reason, `Late close: ${REASON}`)
    assert.deepEqual(w.review(late.id).find((entry) => entry.code === 'closed_late'), { code: 'closed_late', by: 'boss', reason: REASON })
  })

  await check('6. the last-activity read is bounded to the day and the next segment: a sale on the next day does not flag the close', async () => {
    const w = world(); const late = w.dayOne(); const next = w.dayTwo()
    w.sale(`${w.yesterday}T14:00:00.000Z`)
    w.sale(new Date(Date.parse(next.opened_at) + 60 * 1000).toISOString())
    w.h.as(ADMIN)
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(w.stored(late.id).closed_at, w.dayEnd(w.yesterday))
    assert.ok(!w.review(late.id).some((entry) => entry.code === 'closed_at_earlier_time'), 'the next day\'s sale is not this shift\'s activity')
    const call = w.h.state.windows.at(-1)
    assert.equal(call.window.until, new Date(Math.min(Date.parse(next.opened_at), Date.parse(w.nextMidnight(w.yesterday)))).toISOString(), 'until is the earlier of the next opening and the next midnight')
    const alone = world(); const lonely = alone.dayOne()
    await close(alone, lonely, { reason: REASON })
    assert.equal(alone.h.state.windows.at(-1).window.until, alone.nextMidnight(alone.yesterday), 'with nothing after it, until is the next midnight')
    const employee = world(); const mine = employee.dayOne(); employee.dayTwo(); employee.sale(`${employee.today}T03:00:00.000Z`)
    assert.equal((await close(employee, mine, { reason: REASON })).status, 200, 'an employee is not refused for the next day\'s sale either')
  })

  await check('6b. an employee cannot close before the day\'s last record; an administrator can, flagged closed_at_earlier_time', async () => {
    const w = world(); const late = w.dayOne()
    w.sale(`${w.yesterday}T15:30:00.000Z`)
    const early = await close(w, late, { reason: REASON, closed_at: `${w.yesterday}T15:00:00.000Z` })
    assert.equal(early.status, 409, JSON.stringify(early.body))
    assert.equal(early.body.code, 'shift_close_before_last_activity')
    w.h.as(ADMIN)
    const admin = await close(w, late, { reason: REASON, closed_at: `${w.yesterday}T15:00:00.000Z` })
    assert.equal(admin.status, 200, JSON.stringify(admin.body))
    assert.ok(w.review(late.id).some((entry) => entry.code === 'closed_at_earlier_time' && entry.by === 'boss'))
    assert.ok(w.review(late.id).some((entry) => entry.code === 'closed_late'))
  })

  await check('7. who may close: opener, administrator, holder of the grant; per-account rows of others stay 404 for non-holders', async () => {
    const w = world(); const late = w.dayOne()
    w.h.as(COLLEAGUE)
    const hidden = await close(w, late, { reason: REASON })
    assert.equal(hidden.status, 404, 'a per-account row of another cashier stays hidden')
    w.h.as(STRING_HOLDER)
    assert.equal((await close(w, late, { reason: REASON })).status, 404, 'a stored string "true" is not the grant')
    w.h.as(HOLDER)
    const held = await close(w, late, { reason: REASON })
    assert.equal(held.status, 200, JSON.stringify(held.body))
    assert.equal(w.stored(late.id).closed_by_user_name, 'holder')
  })

  await check('7b. shop-wide: a non-holder colleague gets 403 shift_late_close_not_permitted; the grant (user or role), an administrator pass', async () => {
    for (const [who, status] of [[COLLEAGUE, 403], [STRING_HOLDER, 403], [HOLDER, 200], [ROLE_HOLDER, 200], [ADMIN, 200], [CASHIER, 200]]) {
      const w = world(); w.sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
      const late = w.dayOne({ scope_mode: 'shop_wide' })
      w.h.as(who)
      const res = await close(w, late, { reason: REASON })
      assert.equal(res.status, status, `${who.name}: ${JSON.stringify(res.body)}`)
      if (status === 403) { assert.equal(res.body.code, 'shift_late_close_not_permitted'); assert.equal(w.stored(late.id).closed_at, null) }
    }
  })

  await check('7c. the same through a request identity (the replay middleware): 403 code for a non-holder, 200 for a holder', async () => {
    for (const [who, status] of [[COLLEAGUE, 403], [HOLDER, 200]]) {
      const w = world(); w.sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
      const late = w.dayOne({ scope_mode: 'shop_wide' })
      w.h.as(who)
      const res = await close(w, late, { reason: REASON, client_request_id: 'late-close-request-0001' })
      assert.equal(res.status, status, JSON.stringify(res.body))
      if (status === 403) assert.equal(res.body.code, 'shift_late_close_not_permitted')
    }
  })

  await check('7d. a same-day row of another cashier keeps the old 403 (no new code)', async () => {
    const w = world(); w.sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
    const same = w.dayTwo({ scope_mode: 'shop_wide' })
    w.h.as(HOLDER)
    const res = await close(w, same, {})
    assert.equal(res.status, 403)
    assert.equal(res.body.code, undefined)
  })

  await check('8. the legacy POST /close on an earlier-day row: 409 shift_late_close_needs_reason; a same-day row still closes', async () => {
    const w = world(); const late = w.dayOne()
    const input = (shift, id) => ({ shift_id: shift.id, expected_revision: shift.revision, client_request_id: id })
    const refused = await w.h.json('POST', '/close', input(late, 'legacy-close-late-0001'))
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'shift_late_close_needs_reason')
    assert.equal(w.stored(late.id).closed_at, null)
    const fresh = world(); const same = fresh.dayTwo()
    const ok = await fresh.h.json('POST', '/close', input(same, 'legacy-close-same-0001'))
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  await check('9. after the earlier day is closed, the employee ends today\'s shift', async () => {
    const w = world(); const late = w.dayOne(); const today = w.dayTwo()
    assert.equal((await close(w, today, {})).status, 409, 'today stays locked behind the open earlier day')
    assert.equal((await close(w, late, { reason: REASON })).status, 200)
    const ended = await close(w, w.stored(today.id), {})
    assert.equal(ended.status, 200, JSON.stringify(ended.body))
  })

  await check('10. a cash count is refused while today is registered and kept when it is not', async () => {
    const w = world(); const late = w.dayOne(); w.dayTwo()
    for (const body of [{ closing_counted_usd: 25 }, { closing_counted_khr: 41000 }, { closing_counted_usd: 0 }]) {
      const res = await close(w, late, { reason: REASON, ...body })
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.code, 'shift_late_close_not_counted')
    }
    assert.equal((await close(w, late, { reason: REASON, closing_counted_usd: '', closing_counted_khr: null })).status, 200, 'blank counts are no count')
    const alone = world(); const lonely = alone.dayOne()
    const counted = await close(alone, lonely, { reason: REASON, closing_counted_usd: 25, closing_counted_khr: 41000 })
    assert.equal(counted.status, 200, JSON.stringify(counted.body))
    assert.equal(alone.stored(lonely.id).closing_counted_usd, 25)
  })

  await check('11. a second after the last record that falls past 23:59:59 is refused as outside the day', async () => {
    const w = world(); const late = w.dayOne()
    w.sale(w.dayEnd(w.yesterday))
    const res = await close(w, late, { reason: REASON })
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.code, 'shift_late_close_outside_day')
    const ok = world(); const fine = ok.dayOne()
    ok.sale(`${ok.yesterday}T16:59:58.000Z`)
    assert.equal((await close(ok, fine, { reason: REASON })).status, 200, 'a record one second earlier leaves 23:59:59 free')
  })

  await check('12. an administrator gives a reason too (administrator without a reason accepted)', async () => {
    const w = world(); const late = w.dayOne(); w.h.as(ADMIN)
    const res = await close(w, late, {})
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.code, 'shift_late_reason_required')
    assert.equal((await close(w, late, { reason: REASON })).status, 200)
  })

  await check('13. /current marks the earlier-day row late_close and nothing else; a holder is offered it and may close it', async () => {
    const w = world(); const late = w.dayOne()
    const own = await w.h.json('GET', '/current?branch_id=1')
    assert.equal(own.body.previous_open_shift.id, late.id)
    assert.equal(own.body.previous_open_shift.late_close, true)
    assert.equal(own.body.previous_open_shift.capabilities.can_close, true)
    const same = world(); same.dayTwo()
    assert.equal((await same.h.json('GET', '/current?branch_id=1')).body.previous_open_shift, null)
    const wide = world(); wide.sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
    const wideLate = wide.dayOne({ scope_mode: 'shop_wide' })
    wide.h.as(COLLEAGUE)
    const colleague = await wide.h.json('GET', '/current?branch_id=1')
    assert.equal(colleague.body.previous_open_shift.capabilities.can_close, false, 'the screen is not told a non-holder may close it')
    wide.h.as(HOLDER)
    const holder = await wide.h.json('GET', '/current?branch_id=1')
    assert.equal(holder.body.previous_open_shift.id, wideLate.id)
    assert.equal(holder.body.previous_open_shift.capabilities.can_close, true)
  })

  await check('14. statements: a late close sends no more statements than a same-day close (A76: no read and no write beyond today\'s close)', async () => {
    const measure = async (build) => {
      const w = build(); stats.prepare = 0; stats.batch = 0
      const res = await close(w.w, w.shift, w.body)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      return { prepare: stats.prepare, batch: stats.batch }
    }
    const same = await measure(() => { const w = world(); return { w, shift: w.dayTwo(), body: {} } })
    console.log('statements same-day', JSON.stringify(same))
    const lateWithNext = await measure(() => { const w = world(); const shift = w.dayOne(); w.dayTwo(); return { w, shift, body: { reason: REASON } } })
    const lateAlone = await measure(() => { const w = world(); return { w, shift: w.dayOne(), body: { reason: REASON } } })
    console.log('statements same-day', JSON.stringify(same), 'late with next', JSON.stringify(lateWithNext), 'late alone', JSON.stringify(lateAlone))
    assert.deepEqual(lateWithNext, same, 'a late close with today registered sends exactly the statements of a same-day close')
    assert.deepEqual(lateAlone, same, 'and so does a late close with nothing after it')
    assert.deepEqual(same, SAME_DAY_AT_27CCAC698, 'and a same-day close sends what it sent before this slice')
  })

  await check('15. a holder closes another cashier\'s open earlier-day row but cannot amend it: PATCH is 404 as at 27ccac698 and writes nothing', async () => {
    const w = world(); const late = w.dayOne()
    const amendBody = { expected_revision: late.revision, reason: 'fix float', opening_float_usd: 999 }
    w.h.as(COLLEAGUE)
    assert.equal((await w.h.json('PATCH', `/${late.id}`, amendBody)).status, 404, 'a colleague without the grant: hidden')
    w.h.as(HOLDER)
    const patch = await w.h.json('PATCH', `/${late.id}`, amendBody)
    assert.equal(patch.status, 404, JSON.stringify(patch.body))
    assert.equal(w.stored(late.id).opening_float_usd, 20, 'nothing was written')
    assert.equal(w.stored(late.id).revision, late.revision)
    assert.equal(w.sqlite.prepare('SELECT COUNT(*) AS n FROM shift_session_amendments').get().n, 0)
    const keyed = await w.h.json('PATCH', `/${late.id}`, { ...amendBody, client_request_id: 'holder-amend-request-0001' })
    assert.equal(keyed.status, 404, 'the same through a request identity (the replay middleware)')
    assert.equal(w.stored(late.id).opening_float_usd, 20)
    const history = await w.h.json('GET', `/${late.id}/history`)
    assert.equal(history.status, 200, 'the close form still reads the row\'s history')
    const closed = await close(w, late, { reason: REASON })
    assert.equal(closed.status, 200, JSON.stringify(closed.body))
    assert.equal(w.stored(late.id).closed_by_user_name, 'holder')
  })

  await check('16. a holder cannot see, read or close another cashier\'s closed or cancelled earlier-day row, or a same-day open row (404, nothing written)', async () => {
    const attempt = async (w, row) => {
      w.h.as(HOLDER)
      const before = JSON.stringify(w.stored(row.id))
      const outcomes = {
        history: (await w.h.json('GET', `/${row.id}/history`)).status,
        patch: (await w.h.json('PATCH', `/${row.id}`, { expected_revision: row.revision, reason: 'x', opening_float_usd: 5 })).status,
        close: (await close(w, row, { reason: REASON })).status,
        keyedClose: (await close(w, row, { reason: REASON, client_request_id: 'holder-hidden-close-0001' })).status,
      }
      for (const [name, status] of Object.entries(outcomes)) assert.equal(status, 404, `${name}: ${status}`)
      assert.equal(JSON.stringify(w.stored(row.id)), before, 'nothing was written')
    }
    const closedRow = world(); await attempt(closedRow, closedRow.dayOne({ closed_at: `${closedRow.yesterday}T15:00:00.000Z`, closed_by_user_id: 7, closed_by_user_name: 'cashier' }))
    const cancelledRow = world(); await attempt(cancelledRow, cancelledRow.dayOne({ cancelled_at: `${cancelledRow.yesterday}T15:00:00.000Z`, cancelled_by_user_id: 9, cancelled_by_user_name: 'boss', cancel_reason: 'mistake' }))
    const sameDay = world(); await attempt(sameDay, sameDay.dayTwo())
  })

  await check('17. a holder\'s retry of its own committed late close returns the stored result; another account\'s retry of that request id is 404', async () => {
    const id = 'holder-late-close-retry-0001'
    const w = world(); const late = w.dayOne()
    w.h.as(HOLDER)
    const first = await close(w, late, { reason: REASON, client_request_id: id })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    const retry = await close(w, late, { reason: REASON, client_request_id: id })
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.equal(retry.body.mutation_committed, true)
    assert.equal(retry.body.already_closed, true)
    assert.equal(retry.body.shift.id, late.id)
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='shift.close'").get().n, 1, 'the retry wrote nothing')
    const other = user(13, 'otherholder', { pos: true, shift_close_forgotten: true })
    for (const who of [other, COLLEAGUE, STRING_HOLDER]) {
      w.h.as(who)
      const stranger = await close(w, late, { reason: REASON, client_request_id: id })
      assert.equal(stranger.status, 404, `${who.name}: ${JSON.stringify(stranger.body)}`)
      assert.equal(stranger.body.mutation_committed, undefined, 'the stored result is not handed to another account')
    }
    w.h.as(HOLDER)
    const changed = await close(w, late, { reason: 'a different reason', client_request_id: id })
    assert.equal(changed.status, 409, 'the same request id with different values is still refused')
  })

  await check('18. a late close skips no next-segment check: a segment that opened later the same day bounds it (409 shift_overlaps_next_segment)', async () => {
    const w = world(); const late = w.dayOne()
    w.open(w.today, { opened_at: `${w.yesterday}T15:00:00.000Z`, shift_code: 'S-LATE-NEXT' })
    const refused = await close(w, late, { reason: REASON })
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'shift_overlaps_next_segment')
    assert.equal(w.stored(late.id).closed_at, null)
    const ok = await close(w, late, { reason: REASON, closed_at: `${w.yesterday}T14:30:00.000Z` })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })

  await check('19. the refusal sentence names the opener, an administrator and the allowed, not a manager', async () => {
    const w = world(); w.sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode','shop_wide')").run()
    const late = w.dayOne({ scope_mode: 'shop_wide' })
    w.h.as(COLLEAGUE)
    for (const body of [{ reason: REASON }, { reason: REASON, client_request_id: 'wording-late-close-0001' }]) {
      const res = await close(w, late, body)
      assert.equal(res.status, 403)
      assert.equal(res.body.error, 'Only the cashier who opened it, an administrator, or someone allowed can close it.')
    }
  })

  await check('20. the forgotten list: a holder and an administrator get the open earlier-day rows; everyone else is refused; the normal list is unchanged', async () => {
    const w = world(); const mine = w.dayOne(); const theirs = w.open(w.yesterday, { user_id: 8, user_name: 'colleague', shift_code: 'S-LATE-THEIRS' })
    w.open(w.yesterday, { user_id: 20, user_name: 'done', shift_code: 'S-LATE-DONE', closed_at: `${w.yesterday}T15:00:00.000Z` })
    w.open(w.yesterday, { user_id: 21, user_name: 'gone', shift_code: 'S-LATE-GONE', cancelled_at: `${w.yesterday}T15:00:00.000Z`, cancelled_by_user_id: 9, cancelled_by_user_name: 'boss', cancel_reason: 'mistake' })
    w.dayTwo({ user_id: 22, user_name: 'today', shift_code: 'S-LATE-TODAY' })
    for (const who of [HOLDER, ADMIN, ROLE_HOLDER]) {
      w.h.as(who)
      const res = await w.h.json('GET', '/?forgotten=1')
      assert.equal(res.status, 200, `${who.name}: ${JSON.stringify(res.body)}`)
      assert.deepEqual(res.body.shifts.map((shift) => shift.id).sort(), [mine.id, theirs.id].sort(), `${who.name}: only open rows of earlier days`)
      assert.equal(res.body.shifts[0].capabilities.can_close, true)
    }
    for (const who of [COLLEAGUE, STRING_HOLDER, CASHIER]) {
      w.h.as(who)
      const res = await w.h.json('GET', '/?forgotten=1')
      assert.equal(res.status, 403, who.name)
      assert.equal(res.body.shifts, undefined)
    }
    w.h.as(HOLDER)
    assert.equal((await w.h.json('GET', '/?forgotten=yes')).status, 400)
    const normal = await w.h.json('GET', '/')
    assert.deepEqual(normal.body.shifts.map((shift) => shift.id), [], 'a holder\'s normal list still carries only its own rows')
    w.sqlite.prepare('INSERT INTO branches(id,name,is_active) VALUES (2,?,1)').run('Other')
    assert.equal((await w.h.json('GET', '/?forgotten=1&branch_id=1')).body.shifts.length, 2)
    const branch = await w.h.json('GET', '/?forgotten=1&branch_id=2')
    assert.deepEqual(branch.body.shifts, [])
  })

  if (failed.length) { console.log(`\n${failed.length} FAILED, ${passed} passed`); process.exit(1) }
  console.log(`\nALL ${passed} CHECKS PASSED`)
}
const SAME_DAY_AT_27CCAC698 = { prepare: 7, batch: 1 }

main().catch((error) => { console.error(error); process.exit(1) })
