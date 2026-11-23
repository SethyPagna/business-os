// The forgotten-shifts list (GET /api/shifts?forgotten=1): the cheapest read that lets a grant holder or an administrator find the open
// earlier-day shifts of other cashiers (per_account mode lists only the caller's own rows). Measured in a pure harness:
//   - statements: ONE, whatever the number of rows: each row's next-segment opening is a correlated scalar subquery inside the list statement
//     (NEXT_OPENING_SQL, the rule readAdjacentShift/intervalError use), so 1, 3 and the maximum number of rows cost the same; with a
//     branch filter one more (branchExists). It reads no shift policy, no setting and no sale.
//   - rows: the plan scans the PARTIAL index idx_shift_sessions_open (open rows only), so on 2,000 stored shifts it reads the open rows
//     and nothing else; a normal day is a handful (asserted at most 50).
//   - the normal paged list statement keeps its registered fingerprint, and this statement's fingerprint is the one registered in
//     scripts/read-budget/fingerprints/api_shifts.json under the shape shifts-forgotten.
// Run: node scripts/test-shift-forgotten-list-pure.cjs
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

const stats = { prepare: 0, batch: 0, sqls: [] }
function d1(sqlite) {
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => {
    stats.prepare += 1; stats.sqls.push(sql)
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
  for (const file of ['0089_system_flags', '0118_shift_policy_and_amendments', '0119_shift_restore_guard', '0123_shift_reopen_segments', '0132_shift_opening_count_presence', '0147_shift_additional_cash', '0306_shift_adjacent_indexes']) {
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

const SHIFTS_SOURCE = null
const LIB_SOURCE = null

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


const crypto = require('node:crypto')
const normalize = (sql) => String(sql).replace(/\s+/g, ' ').trim()
const dbSource = fs.readFileSync(path.join(root, 'src', 'lib', 'db.ts'), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const translateStart = dbSource.indexOf('function translate(')
const translateSource = dbSource.slice(translateStart, dbSource.indexOf('\n}\n', translateStart) + 2)
const translate = new Function('return ' + ts.transpileModule(translateSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText.replace(/^function translate/, 'function'))()
const hashOf = (sql, params) => crypto.createHash('sha1').update(normalize(translate(sql, params).sql)).digest('hex').slice(0, 12)
const FINGERPRINTS = path.join(root, 'scripts', 'read-budget', 'fingerprints', 'api_shifts.json')

// The separate seek a close performs (readAdjacentShift 'next'), written out as the oracle.
function separateSeek(sqlite, row) {
  const user = row.scope_mode === 'shop_wide' ? '' : 'AND user_id = @userId'
  const branch = row.branch_id == null ? 'branch_id IS NULL' : 'branch_id = @branchId'
  const found = sqlite.prepare('SELECT opened_at FROM shift_sessions WHERE id = (SELECT id FROM shift_sessions WHERE scope_mode = @scopeMode ' + user + ' AND ' + branch +
    ' AND id != @id AND cancelled_at IS NULL AND opened_at >= @openedAt ORDER BY opened_at ASC, id ASC LIMIT 1)')
    .get({ id: row.id, scopeMode: row.scope_mode, openedAt: row.opened_at, ...(row.branch_id == null ? {} : { branchId: row.branch_id }), ...(row.scope_mode === 'shop_wide' ? {} : { userId: row.user_id }) })
  return found ? found.opened_at : null
}
async function sameDayAndRowCount() {
  const counts = {}
  for (const rows of [1, 3, 50, 60]) {
    const w = world()
    for (let i = 0; i < rows; i += 1) w.open(w.yesterday, { user_id: 200 + i, user_name: 'c' + i, shift_code: 'S-N-' + i, opened_at: w.yesterday + 'T13:' + String(10 + (i % 40)).padStart(2, '0') + ':00.000Z' })
    w.h.as(HOLDER)
    stats.prepare = 0; stats.sqls.length = 0
    const res = await w.h.json('GET', '/?forgotten=1')
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.shifts.length, Math.min(rows, 50), 'rows capped at the plan limit')
    counts[rows] = stats.prepare
  }
  console.log('statements at 1, 3, 50 (max), 60 rows:', JSON.stringify(counts))
  assert.deepEqual(Object.values(counts), [1, 1, 1, 1], 'the statement count is the same for 1, 3 and the maximum number of rows')

  const w = world()
  w.sqlite.exec('DROP TRIGGER IF EXISTS shift_reopen_segment_validate_insert') // fixture only: an open row followed by a later same-day segment is the shape under test, a reopen never writes it
  const a1 = w.open(w.yesterday, { shift_code: 'S-A1', user_id: 7, opened_at: w.yesterday + 'T13:00:00.000Z' })
  const a2 = w.open(w.yesterday, { shift_code: 'S-A2', parent_shift_id: a1.id, user_id: 7, opened_at: w.yesterday + 'T14:00:00.000Z', closed_at: w.yesterday + 'T15:00:00.000Z', closed_by_user_id: 1, closed_by_user_name: 'x' })
  w.open(w.yesterday, { shift_code: 'S-A3', parent_shift_id: a2.id, user_id: 7, opened_at: w.yesterday + 'T16:00:00.000Z', cancelled_at: w.yesterday + 'T16:30:00.000Z', cancelled_by_user_id: 1, cancelled_by_user_name: 'x', cancel_reason: 'r' })
  const b1 = w.open(w.yesterday, { shift_code: 'S-B1', user_id: 8, user_name: 'colleague', opened_at: w.yesterday + 'T13:30:00.000Z' })
  const c1 = w.open(w.yesterday, { shift_code: 'S-C1', user_id: 9, user_name: 'boss', opened_at: w.yesterday + 'T12:00:00.000Z' })
  const s1 = w.open(w.yesterday, { shift_code: 'S-S1', scope_mode: 'shop_wide', user_id: 7, opened_at: w.yesterday + 'T11:00:00.000Z' })
  w.open(w.yesterday, { shift_code: 'S-S2', parent_shift_id: s1.id, scope_mode: 'shop_wide', user_id: 8, user_name: 'colleague', opened_at: w.yesterday + 'T11:00:00.000Z', closed_at: w.yesterday + 'T12:30:00.000Z', closed_by_user_id: 1, closed_by_user_name: 'x' })
  const n1 = w.open(w.yesterday, { shift_code: 'S-N1', user_id: 30, user_name: 'noBranch', branch_id: null, branch_name: null, opened_at: w.yesterday + 'T13:00:00.000Z' })
  w.open(w.yesterday, { shift_code: 'S-N2', parent_shift_id: n1.id, user_id: 30, user_name: 'noBranch', branch_id: null, branch_name: null, opened_at: w.yesterday + 'T13:00:00.000Z', closed_at: w.yesterday + 'T13:20:00.000Z', closed_by_user_id: 1, closed_by_user_name: 'x' })
  w.h.as(HOLDER)
  const res = await w.h.json('GET', '/?forgotten=1')
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const byCode = Object.fromEntries(res.body.shifts.map((shift) => [shift.shift_code, shift.close_before]))
  const expected = [[a1, w.yesterday + 'T14:00:00.000Z'], [b1, null], [c1, null], [s1, w.yesterday + 'T11:00:00.000Z'], [n1, w.yesterday + 'T13:00:00.000Z']]
  for (const [row, value] of expected) {
    assert.equal(separateSeek(w.sqlite, row), value, 'the separate seek for ' + row.shift_code)
    assert.equal(byCode[row.shift_code], value, 'the list value equals the separate seek for ' + row.shift_code)
  }
  assert.ok(a2 && byCode['S-A1'] === w.yesterday + 'T14:00:00.000Z', 'a same-day second segment bounds the first, a cancelled later one does not')
  for (const shift of res.body.shifts) assert.equal(shift.close_before, separateSeek(w.sqlite, w.sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(shift.shift_code)), 'seek parity for ' + shift.shift_code)
  assert.ok(!res.body.shifts.some((shift) => 'next_opened_at' in shift), 'the helper column is not part of the response')
}

async function main() {
  const w = world()
  for (let day = 2; day < 2000; day += 1) {
    const date = new Date(Date.UTC(2024, 0, 1) + day * 86400000).toISOString().slice(0, 10)
    w.open(date, { user_id: 100 + (day % 40), user_name: 'old' + day, shift_code: 'S-OLD-' + day, closed_at: date + 'T15:00:00.000Z', closed_by_user_id: 1, closed_by_user_name: 'x' })
  }
  const storedRows = w.sqlite.prepare('SELECT COUNT(*) AS n FROM shift_sessions').get().n
  w.dayOne(); w.open(w.yesterday, { user_id: 8, user_name: 'colleague', shift_code: 'S-FORGOT-2' }); w.open(w.yesterday, { user_id: 9, user_name: 'boss', shift_code: 'S-FORGOT-3' }); w.dayTwo({ user_id: 22, shift_code: 'S-TODAY' })
  w.h.as(HOLDER)

  stats.prepare = 0; stats.sqls.length = 0
  const res = await w.h.json('GET', '/?forgotten=1')
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.shifts.length, 3, 'the three open earlier-day rows, not the closed ones or today')
  const listSql = stats.sqls[0]
  console.log('forgotten list: statements', stats.prepare, '(one list statement, next openings inside it) for', res.body.shifts.length, 'rows; stored shifts', storedRows)
  assert.equal(stats.prepare, 1, 'one list statement, whatever the rows; no per-row seek, no policy, settings or sale read')
  assert.ok(!stats.sqls.some((sql) => /shift_scope_mode|FROM sales|FROM returns/i.test(sql)))

  const params = { today: w.today, branchId: null, limit: 50 }
  const bound = translate(listSql, params)
  const flat = []
  const flatSql = bound.sql.replace(/\?(\d+)/g, (_m, n) => { flat.push(bound.values[Number(n) - 1]); return '?' })
  const plan = w.sqlite.prepare('EXPLAIN QUERY PLAN ' + flatSql).all(...flat).map((row) => row.detail)
  console.log('plan:', plan.filter((detail) => /shift_sessions/.test(detail)).slice(0, 2).join(' | '))
  assert.ok(plan.some((detail) => /SCAN shift_sessions USING (COVERING )?INDEX idx_shift_sessions_open/.test(detail)), plan.join('\n'))
  assert.ok(!plan.some((detail) => /^SCAN shift_sessions$/.test(detail)), 'no full table scan')
  console.log('plan (subquery):', plan.filter((detail) => /SEARCH/.test(detail)).join(' | '))
  assert.ok(plan.some((detail) => /SEARCH nx USING INDEX idx_shift_sessions_scope_branch_opened .*scope_mode=/.test(detail)), 'a shop-wide next opening is a seek on the 0306 shop index:\n' + plan.join('\n'))
  assert.ok(plan.some((detail) => /SEARCH nx USING INDEX idx_shift_sessions_scope_user_branch_opened .*scope_mode=/.test(detail)), 'a per-account next opening is a seek on the 0306 user index:\n' + plan.join('\n'))
  assert.ok(!plan.some((detail) => /nx USING (COVERING )?INDEX idx_shift_sessions_open/.test(detail)) && !plan.some((detail) => /SCAN nx/.test(detail)), 'the subquery never scans')
  const openRows = w.sqlite.prepare('SELECT COUNT(*) AS n FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL').get().n
  assert.equal(openRows, 4, 'the partial index holds only open rows: that is every row the list scans')
  assert.ok(openRows <= 50, 'a normal day reads at most 50 rows')

  assert.match(listSql, /closed_at IS NULL AND cancelled_at IS NULL AND business_date < @today/, 'only open rows of earlier days')
  const route = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')
  assert.ok(route.includes('limit: getPlanLimits(c.env).forgottenShiftListMax'), 'the limit comes from getPlanLimits(env)')

  w.sqlite.prepare('INSERT INTO branches(id,name,is_active) VALUES (2,?,1)').run('Other')
  stats.prepare = 0
  await w.h.json('GET', '/?forgotten=1&branch_id=1')
  assert.equal(stats.prepare, 1 + 1, 'a branch filter adds the one branchExists statement')

  console.log('FP', hashOf(listSql, params), normalize(bound.sql).slice(0, 110))
  const registered = JSON.parse(fs.readFileSync(FINGERPRINTS, 'utf8'))['shifts-forgotten']
  assert.ok(registered, 'the shape is registered in the fingerprint file')
  assert.ok(registered.some(([hash]) => hash === hashOf(listSql, params)), 'the registered fingerprint is the list statement as the Worker sends it: ' + hashOf(listSql, params))

  stats.sqls.length = 0
  w.h.as(ADMIN)
  await w.h.json('GET', '/?page=1&page_size=20')
  const paged = stats.sqls.find((sql) => /WITH matched AS/.test(sql))
  assert.ok(paged, 'the paged list ran')
  const pagedHash = hashOf(paged, { reviewer: 1, selfId: 1, shopWide: 0, requestedUserId: null, branchId: null, from: null, to: null, search: null, page: 1, pageSize: 20 })
  assert.equal(pagedHash, JSON.parse(fs.readFileSync(FINGERPRINTS, 'utf8'))['shifts-list'].find(([, head]) => /WITH matched AS/.test(head))[0], 'the paged list statement is byte-for-byte what was registered')
  await sameDayAndRowCount()
  console.log('PASS the forgotten list reads open earlier-day rows through idx_shift_sessions_open, within the registered shape')
}
main().catch((error) => { console.error(error); process.exit(1) })
