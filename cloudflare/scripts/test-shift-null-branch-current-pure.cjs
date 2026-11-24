// A shift opened while the POS showed All branches has branch_id NULL; a till filtered to a branch must still see it as its current shift,
// the carry-over, and POST /open must answer already_registered for it (never a second open shift).
// Run: node scripts/test-shift-null-branch-current-pure.cjs
process.env.TZ = 'Asia/Phnom_Penh'
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
const ACTORS = {
  opener: user(7, 'opener', { pos: true }),
  otherPos: user(8, 'otherpos', { pos: true }),
  otherSales: user(14, 'othersales', { sales: true }),
  noShifts: user(13, 'noshifts', { inventory: true }),
  holder: user(10, 'holder', { pos: true, shift_close_forgotten: true }),
  admin: user(9, 'boss', { pos: true }, { role_code: 'admin' }),
}

const SHIFTS_SOURCE = process.env.SHIFTS_ROUTE_SOURCE || null
const live = { sqlite: null, user: ACTORS.opener }
const route = loadReal('routes/shifts.ts', {
  '../lib/saleStatusResolution': require('./harness/sale_status_resolution.cjs'),
  '../lib/branchRedirectWrite': require('./harness/branch_redirect_write.cjs'),
  '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  '../lib/shiftLateClose': loadReal('lib/shiftLateClose.ts'),
  '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'), '../lib/phoneAccess': { phoneSearchAccessOf: () => ({ fullPhone: true }) }, '../lib/phoneSearchGuard': { searchableColumnSql: (column) => (typeof column === 'string' ? column : column.sql) },
  '../lib/db': { getDb: () => d1(live.sqlite) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', live.user); await next() } },
  '../lib/permissions': loadReal('lib/permissions.ts'),
  '../lib/shiftReconciliation': {
    SHIFT_REVIEW: { earlierClose: 'closed_at_earlier_time', laterOpen: 'opened_at_later_time', reopenedAfterEarlierClose: 'reopened_after_earlier_close', closedLate: 'closed_late' },
    async shiftLastActivityMs(_env, shift, _nowMs, window = {}) {
      const row = await d1(live.sqlite).prepare('SELECT MAX(at) AS at FROM activity WHERE at >= @from AND (@until IS NULL OR at < @until)').get({ from: window.from ?? shift.opened_at, until: window.until ?? null })
      return row?.at ? Date.parse(row.at) : null
    },
    async readShiftTimeReview() { return null },
    loadShiftReconciliation: async () => ({ marker: 'reconciliation-was-computed' }),
    loadShiftFigures: async () => ({ marker: 'figures-were-computed' }),
  },
  '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
  '../lib/planTier': { getPlanLimits: () => ({ d1QueriesPerInvocation: 1000, forgottenShiftListMax: 50 }) },
  '../lib/acquisitionCostAccess': { holdsCostViewGrant: () => true },
  '../lib/telegram': { scheduleTelegramShiftOverview: async () => 'unavailable', scheduleTelegramShiftReport: async () => 'unavailable', loadTelegramConfig: async () => ({}), sendTelegramShiftReport: async () => true, sendTelegramStaleShiftAlert: async () => true },
}, SHIFTS_SOURCE)
const app = route.default || route
const call = async (method, url, body) => {
  const res = await app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}


function world(policy) {
  const sqlite = database(); live.sqlite = sqlite
  sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode',?)").run(policy)
  sqlite.prepare("INSERT INTO branches(id,name,is_active) VALUES (2,'Second',1)").run()
  const d = (modifier) => sqlite.prepare(`SELECT date('now', '+7 hours'${modifier ? `, '${modifier}'` : ''}) AS d`).get().d
  const today = d(), yesterday = d('-1 day')
  const todayAt = new Date(Math.max(Date.parse(`${yesterday}T17:00:00.000Z`), Date.now() - 5 * 60 * 1000)).toISOString()
  let n = 0
  const add = (overrides) => {
    const row = { shift_code: `S-NB-${++n}`, scope_mode: policy, user_id: 7, user_name: 'opener', branch_id: null, branch_name: null,
      business_date: today, opened_at: todayAt, opening_float_usd: 20, opening_float_khr: 40000,
      opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0, ...overrides }
    const columns = Object.keys(row)
    sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(row)
    return sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get(row.shift_code)
  }
  const earlier = (overrides) => add({ business_date: yesterday, opened_at: `${yesterday}T13:00:00.000Z`, ...overrides })
  const openCount = () => sqlite.prepare('SELECT COUNT(*) AS n FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL').get().n
  return { sqlite, add, earlier, openCount, todayAt }
}

let passed = 0
const check = async (name, fn) => { await fn(); passed += 1; console.log('PASS ' + name) }

async function main() {
  for (const policy of ['per_account', 'shop_wide']) {
    await check(`${policy}: a NULL-branch shift of today is the current shift of a branch-filtered till`, async () => {
      const w = world(policy); const row = w.add({}); live.user = ACTORS.opener
      const current = await call('GET', '/current?branch_id=1')
      assert.equal(current.body.shift?.id, row.id, JSON.stringify(current.body).slice(0, 200))
      assert.equal(current.body.is_open, true)
      assert.equal(current.body.needs_registration, false)
      assert.equal(current.body.can_end, true)
    })
    await check(`${policy}: POST /open from a branch-filtered till answers already_registered for that row and creates nothing`, async () => {
      const w = world(policy); const row = w.add({}); live.user = ACTORS.opener
      const res = await call('POST', '/open', { branch_id: 1, opening_float_usd: 5 })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.already_registered, true)
      assert.equal(res.body.shift.id, row.id)
      assert.equal(w.openCount(), 1, 'never a second open shift')
    })
    await check(`${policy}: the exact-branch row comes before the NULL-branch row`, async () => {
      const w = world(policy); w.add({ opened_at: new Date(Date.now() - 60 * 1000).toISOString() })
      const exact = w.add({ branch_id: 1, branch_name: 'Shop', opened_at: new Date(Date.now() - 120 * 1000).toISOString() }); live.user = ACTORS.opener
      assert.equal((await call('GET', '/current?branch_id=1')).body.shift?.id, exact.id, 'older but exact wins over newer NULL')
    })
    await check(`${policy}: another branch's row is not matched, and with no branch requested only NULL rows are`, async () => {
      const w = world(policy); w.add({ branch_id: 2, branch_name: 'Second' }); live.user = ACTORS.opener
      assert.equal((await call('GET', '/current?branch_id=1')).body.shift, null, 'branch 2 row is not branch 1 current')
      const exact = w.add({ branch_id: 1, branch_name: 'Shop' })
      assert.equal((await call('GET', '/current')).body.shift, null, 'no branch requested: an exact-branch row is not matched')
      assert.equal((await call('GET', '/current?branch_id=1')).body.shift.id, exact.id)
    })
    await check(`${policy}: an earlier-day NULL-branch row is offered as the carry-over to a branch-filtered till`, async () => {
      const w = world(policy); const old = w.earlier({}); live.user = ACTORS.opener
      const current = await call('GET', '/current?branch_id=1')
      assert.equal(current.body.previous_open_shift?.id, old.id, JSON.stringify(current.body).slice(0, 200))
    })
  }
  console.log(`\nALL ${passed} CHECKS PASSED`)
}
main().catch((error) => { console.error(error); process.exit(1) })
