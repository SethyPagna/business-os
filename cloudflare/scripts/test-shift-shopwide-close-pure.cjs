// Under the shop-wide shift setting the shared shift belongs to the shop (owner A79/A80, 24 Nov 2026): any account that may use
// shifts and can see the row closes TODAY's shop-wide shift, exactly as its opener does. Nothing else widens:
//   - an earlier-day row keeps the late-close rule (opener, administrator, or the grant);
//   - a per_account row stays the opener's / administrator's, and a shop_wide row kept from an old per_account period too;
//   - reopen and cancel are unchanged.
// The matrix {row scope x policy} x {actors} x {today, earlier day} x {open, closed, cancelled} is checked against an independent
// oracle on the capability (list, history, /current) and on all three close entries (/:id/close, the same with a request id,
// legacy POST /close). Env SHIFTS_ROUTE_SOURCE names a mutated copy of the route (mutant runs only).
// Run: node scripts/test-shift-shopwide-close-pure.cjs
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

function world(policy, rowScope, day, state) {
  const sqlite = database(); live.sqlite = sqlite
  sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('shift_scope_mode',?)").run(policy)
  const d = (modifier) => sqlite.prepare(`SELECT date('now', '+7 hours'${modifier ? `, '${modifier}'` : ''}) AS d`).get().d
  const today = d(), yesterday = d('-1 day')
  const openedAt = day === 'today'
    ? new Date(Math.max(Date.parse(`${yesterday}T17:00:00.000Z`), Date.now() - 5 * 60 * 1000)).toISOString()
    : `${yesterday}T13:00:00.000Z`
  const row = {
    shift_code: 'S-SW-1', scope_mode: rowScope, user_id: 7, user_name: 'opener', branch_id: 1, branch_name: 'Shop',
    business_date: day === 'today' ? today : yesterday, opened_at: openedAt, opening_float_usd: 20, opening_float_khr: 40000,
    opening_float_usd_registered: 1, opening_float_khr_registered: 1, revision: 0,
  }
  const endedAt = new Date(Date.parse(openedAt) + 1000).toISOString()
  if (state === 'closed') Object.assign(row, { closed_at: endedAt, closed_by_user_id: 7, closed_by_user_name: 'opener' })
  if (state === 'cancelled') Object.assign(row, { cancelled_at: endedAt, cancelled_by_user_id: 9, cancelled_by_user_name: 'boss', cancel_reason: 'test' })
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map((c) => '@' + c).join(',')})`).run(row)
  return { sqlite, shift: sqlite.prepare('SELECT * FROM shift_sessions WHERE shift_code=?').get('S-SW-1') }
}

// The rule written out from the owner ruling, independent of the route's helpers.
function oracle(actor, policy, rowScope, day, state) {
  if (actor === 'noShifts' || state !== 'open') return false
  const sharedToday = policy === 'shop_wide' && rowScope === 'shop_wide'
  const reach = actor === 'admin' || actor === 'opener' || sharedToday || (day === 'earlier' && actor === 'holder')
  if (!reach) return false
  if (actor === 'admin' || actor === 'opener') return true
  return day === 'today' ? sharedToday : actor === 'holder'
}

let passed = 0
async function matrix() {
  for (const policy of ['shop_wide', 'per_account']) for (const rowScope of ['shop_wide', 'per_account']) for (const day of ['today', 'earlier']) for (const state of ['open', 'closed', 'cancelled']) {
    for (const actorKey of Object.keys(ACTORS)) {
      const label = `${policy} policy, ${rowScope} row, ${day}, ${state}, ${actorKey}`
      const expected = oracle(actorKey, policy, rowScope, day, state)
      const actor = ACTORS[actorKey]
      {
        const w = world(policy, rowScope, day, state); live.user = actor
        const history = await call('GET', `/${w.shift.id}/history`)
        assert.equal(history.status === 200 ? history.body.shift.capabilities.can_close : false, expected, `history can_close: ${label}`)
        const list = await call('GET', '/?limit=50')
        const listed = list.status === 200 ? list.body.shifts.find((s) => s.id === w.shift.id) : undefined
        if (listed) assert.equal(listed.capabilities.can_close, expected, `list can_close: ${label}`)
        else assert.ok(!expected || (actorKey === 'holder' && day === 'earlier'), `list hides only the holder's earlier row: ${label}`)
        if (day === 'today' && actorKey !== 'admin') {
          const current = await call('GET', '/current?branch_id=1')
          const same = current.status === 200 && current.body.shift?.id === w.shift.id
          if (same) assert.equal(current.body.can_end, expected, `/current can_end: ${label}`)
          else assert.ok(current.status !== 200 || current.body.can_end === false, `/current can_end without the row: ${label}`)
          if (expected && rowScope === policy) assert.ok(same, `/current offers the row: ${label}`)
        }
      }
      for (const entry of ['plain', 'with-request-id', 'legacy']) {
        const w = world(policy, rowScope, day, state); live.user = actor
        const before = w.sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(w.shift.id)
        const body = { expected_revision: 0, ...(day === 'earlier' ? { reason: 'Forgot to close' } : {}) }
        let res
        if (entry === 'plain') res = await call('POST', `/${w.shift.id}/close`, body)
        else if (entry === 'with-request-id') res = await call('POST', `/${w.shift.id}/close`, { ...body, client_request_id: 'req-one-abcdefghijklmnop' })
        else res = await call('POST', '/close', { ...body, shift_id: w.shift.id, branch_id: 1, client_request_id: 'req-two-abcdefghijklmnop' })
        const after = w.sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(w.shift.id)
        const where = `${entry}: ${label} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`
        if (entry === 'legacy' && day === 'earlier') {
          assert.equal(after.closed_at, before.closed_at, `legacy never closes an earlier day: ${where}`)
          if (expected) assert.equal(res.body.code, 'shift_late_close_needs_reason', where)
          else assert.ok(res.status >= 400, where)
        } else if (expected) {
          assert.equal(res.status, 200, where)
          assert.ok(after.closed_at, where)
          assert.equal(after.closed_by_user_id, actor.id, `closed_by_user_id names the closer: ${where}`)
          const audit = w.sqlite.prepare("SELECT user_id FROM audit_logs WHERE action='shift.close' AND CAST(entity_id AS REAL)=?").all(w.shift.id)
          assert.ok(audit.some((line) => line.user_id === actor.id), `audit line names the closer: ${where}`)
          const amendment = w.sqlite.prepare('SELECT actor_user_id FROM shift_session_amendments WHERE shift_session_id=? ORDER BY id DESC LIMIT 1').get(w.shift.id)
          assert.equal(amendment.actor_user_id, actor.id, `amendment names the closer: ${where}`)
        } else {
          assert.ok(res.status >= 400, where)
          assert.equal(after.closed_at, before.closed_at, `nothing closed: ${where}`)
          assert.equal(after.revision, before.revision, `nothing written: ${where}`)
        }
        passed += 1
      }
    }
  }
}

async function untouchedRules() {
  const closed = world('shop_wide', 'shop_wide', 'today', 'closed'); live.user = ACTORS.otherPos
  const reopen = await call('POST', `/${closed.shift.id}/reopen`, { expected_revision: 0, reason: 'again' })
  assert.equal(reopen.status, 403, `reopen stays the opener's or an administrator's: ${JSON.stringify(reopen.body)}`)
  assert.equal((await call('GET', `/${closed.shift.id}/history`)).body.shift.capabilities.can_reopen, false)
  const open = world('shop_wide', 'shop_wide', 'today', 'open'); live.user = ACTORS.otherPos
  assert.equal((await call('POST', `/${open.shift.id}/cancel`, { expected_revision: 0, reason: 'x' })).status, 403, 'cancel stays administrator-only')
  assert.equal((await call('GET', `/${open.shift.id}/history`)).body.shift.capabilities.can_cancel, false)
  passed += 1
}

// A close that committed stays answerable to the account that made it: its retry replays the receipt (200), and a second closer meets
// the closed row (409), never the permission wall (403). The permission check runs before the replay lookup, so it must not depend on the row still being open.
async function retryAfterCommit() {
  const w = world('shop_wide', 'shop_wide', 'today', 'open'); live.user = ACTORS.otherPos
  const input = { expected_revision: 0, client_request_id: 'req-retry-abcdefghijklmnop' }
  const first = await call('POST', `/${w.shift.id}/close`, input)
  assert.equal(first.status, 200, `a non-opener closes today's shop-wide shift: ${JSON.stringify(first.body)}`)
  const replay = await call('POST', `/${w.shift.id}/close`, input)
  assert.equal(replay.status, 200, `the closer's retry after commit is the receipt, not 403: ${JSON.stringify(replay.body)}`)
  assert.equal(replay.body.already_closed, true)
  assert.equal(w.sqlite.prepare('SELECT COUNT(*) AS n FROM shift_session_amendments WHERE shift_session_id=?').get(w.shift.id).n, 1, 'the replay writes nothing')
  for (const second of [ACTORS.otherSales, ACTORS.otherPos]) {
    live.user = second
    const plain = await call('POST', `/${w.shift.id}/close`, { expected_revision: 1 })
    assert.equal(plain.status, 409, `a second closer meets the closed row: ${second.name} ${plain.status} ${JSON.stringify(plain.body)}`)
    const keyed = await call('POST', `/${w.shift.id}/close`, { expected_revision: 1, client_request_id: 'req-second-abcdefghijklmnop' })
    assert.equal(keyed.status, 409, `a second keyed closer meets the closed row: ${second.name} ${keyed.status} ${JSON.stringify(keyed.body)}`)
  }
  live.user = ACTORS.noShifts
  assert.equal((await call('POST', `/${w.shift.id}/close`, { expected_revision: 1 })).status, 403, 'an account that may not use shifts still gets 403')
  passed += 1
}

async function main() {
  await matrix(); console.log(`PASS matrix, ${passed} close cases`)
  await untouchedRules(); console.log('PASS reopen and cancel unchanged')
  await retryAfterCommit(); console.log('PASS retry after commit replays, a second closer gets 409')
  console.log('\nALL CHECKS PASSED')
}
main().catch((error) => { console.error(error); process.exit(1) })
