// N7 (LOOPHOLE-REVIEW-20261006, cutover blocker): a shift outlives its branch.
//
// The Shop -> LC Store cutover retires Shop as the inactive "Old Shop". Before
// this fix every shift read required branches.is_active = 1, so on that day
// all of Shop's shift history would vanish from the list and its detail, close
// and cancel would answer 404. The rule now (routes/shifts.ts, BRANCH_ACTIVE_SQL):
//
//   reads (list, branch filter, history, carry-over)  always, labelled with the
//                                                     branch_name stored at open;
//   POST /open                                        active branch only;
//   close / cancel of a shift still open there        allowed (nobody trapped);
//   amend / reopen                                    409 shift_branch_inactive,
//                                                     with the why and the where.
//
// CONTROL: the same scenario runs against the route with the three 4ab47676e
// guards re-inserted verbatim (list filter, history 404, close 404). The control
// must HIDE the shift and refuse the close -- otherwise this file proves nothing.
//
// Run (from cloudflare/): node scripts/test-shift-inactive-branch-pure.cjs
process.env.TZ = 'Asia/Phnom_Penh'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

const ROUTE_PATH = path.join(root, 'src', 'routes', 'shifts.ts')
// LF-normalised: a Windows checkout (autocrlf) carries CRLF, CI carries LF.
const ROUTE_SOURCE = fs.readFileSync(ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n')

function loadText(sourcePath, text, overrides = {}) {
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
const loadReal = (rel, overrides) => { const p = path.join(root, 'src', rel); return loadText(p, fs.readFileSync(p, 'utf8'), overrides) }

function d1(sqlite) {
  const translate = (sql, params = {}) => {
    const values = []; return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  const statement = (sql) => ({
    async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
    async all(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values) },
    async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, meta: { changes: info.changes } } },
  })
  return {
    prepare: statement,
    async batch(items) {
      // A one-shot hook that lands a concurrent write between the route's
      // reads and its commit.
      if (sqlite.beforeBatch) { const land = sqlite.beforeBatch; sqlite.beforeBatch = null; land() }
      return sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values)
        return { meta: { changes: info.changes } }
      }))()
    },
  }
}

function database() {
  const db = new Database(':memory:')
  const migration = (file) => db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  migration('0116_shift_sessions.sql')
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, successor_branch_id INTEGER);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
      entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
      device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  for (const file of ['0089_system_flags.sql', '0118_shift_policy_and_amendments.sql', '0119_shift_restore_guard.sql',
    '0123_shift_reopen_segments.sql', '0132_shift_opening_count_presence.sql', '0147_shift_additional_cash.sql']) migration(file)
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1),(2,?,1)').run('Shop', 'LC Store')
  const insert = (code, userId, userName, days, closed) => db.prepare(`INSERT INTO shift_sessions
    (shift_code,scope_mode,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at,
     opening_float_usd,opening_float_khr,opening_float_usd_registered,opening_float_khr_registered,closing_counted_usd)
    VALUES (?, 'per_account', ?, ?, 1, 'Shop', date(datetime('now', ?), '+7 hours'), datetime('now', ?), ?, 10, 0, 1, 1, ?)`)
    .run(code, userId, userName, `-${days} days`, `-${days} days`, closed ? `${new Date(Date.now() - days * 86400000 + 3600000).toISOString()}` : null, closed ? 12 : null)
  insert('S-SHOP-CLOSED', 7, 'cashier', 2, true)
  insert('S-SHOP-OPEN', 7, 'cashier', 1, false)
  insert('S-SHOP-OTHER', 8, 'other', 1, false)
  // The cutover: Shop is renamed and retired. Nothing touches shift_sessions.
  db.prepare("UPDATE branches SET name='Old Shop', is_active=0, successor_branch_id=2 WHERE id=1").run()
  const id = (code) => db.prepare('SELECT id FROM shift_sessions WHERE shift_code=?').get(code).id
  return { db, closedId: id('S-SHOP-CLOSED'), openId: id('S-SHOP-OPEN'), otherId: id('S-SHOP-OTHER') }
}

function route(sqlite, source, getUser) {
  const loaded = loadText(ROUTE_PATH, source, {
    '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/clientTimestamp': loadReal('lib/clientTimestamp.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', getUser()); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/telegramLang': loadReal('lib/telegramLang.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true, scheduleTelegramShiftOverview: async () => true },
    // No sales tables here: the branch rule is under test, not the arithmetic.
    '../lib/shiftReconciliation': {
      loadShiftReconciliation: async () => null, loadShiftFigures: async () => null,
      loadShiftCloseFigures: async () => null, loadShiftCloseDrift: async () => null,
    },
  })
  const app = loaded.default || loaded
  return async (method, url, body) => {
    const response = await app.fetch(new Request(`http://test${url}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }), {}, { waitUntil() {}, passThroughOnException() {} })
    const text = await response.text()
    let json = null; try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json }
  }
}

/** The 4ab47676e guards, re-inserted verbatim. Each replacement must land. */
function controlSource() {
  let text = ROUTE_SOURCE
  const swap = (anchor, replacement, label) => {
    assert.ok(text.includes(anchor), `control anchor present: ${label}`)
    text = text.replace(anchor, replacement)
  }
  swap('      AND (@branchId IS NULL OR branch_id = @branchId)\n      AND (@from IS NULL',
    '      AND (@branchId IS NULL OR branch_id = @branchId)\n      AND (branch_id IS NULL OR EXISTS (SELECT 1 FROM branches b WHERE b.id=shift_sessions.branch_id AND b.is_active=1))\n      AND (@from IS NULL',
    'list filter')
  swap("  if (!shift) return c.json({ error: 'Shift not found.' }, 404)\n  // 404, not 403:",
    "  if (!shift) return c.json({ error: 'Shift not found.' }, 404)\n  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)\n  // 404, not 403:",
    'history 404')
  swap("  // No branch-activity check: closing is allowed on a retired branch (N7).\n",
    "  if (shift.branch_id != null && !(await resolveBranch(db, shift.branch_id))) return c.json({ error: 'Shift not found.' }, 404)\n",
    'close 404')
  swap('\n        OR (user_id = @userId AND branch_id IS NOT NULL AND (${BRANCH_ACTIVE_SQL}) = 0))', ')', 'carry-over arm')
  swap("  if (requestedBranchId != null && !branchState) return c.json({ error: 'Branch not found.' }, 400)\n",
    "  if (requestedBranchId != null && !(await resolveBranch(db, requestedBranchId))) return c.json({ error: 'Branch not found or inactive.' }, 400)\n",
    '/current refusal')
  return text
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

const ADMIN = { id: 1, username: 'admin', role_code: 'admin' }
const CASHIER = { id: 7, username: 'cashier', permissions: JSON.stringify({ pos: true }) }

async function main() {
  await check('CONTROL: the 4ab47676e route hides every retired-branch shift and refuses to close one', async () => {
    const fx = database(); let user = ADMIN
    const call = route(fx.db, controlSource(), () => user)
    const list = await call('GET', '/')
    assert.equal(list.status, 200)
    assert.equal(list.body.shifts.some((s) => s.id === fx.closedId), false, 'control: the closed Shop shift is hidden from the list')
    assert.equal((await call('GET', `/${fx.closedId}/history`)).status, 404, 'control: its history is a 404')
    user = CASHIER
    const current = await call('GET', '/current?branch_id=2')
    assert.equal(current.body.previous_open_shift, null, 'control: the stale Shop drawer is never offered at LC Store')
    assert.equal((await call('GET', '/current?branch_id=1')).status, 400, 'control: a till still on the retired branch gets a bare 400')
    const close = await call('POST', `/${fx.openId}/close`, { expected_revision: 0, closed_at: new Date().toISOString() })
    assert.equal(close.status, 404, 'control: the drawer left open on the retired branch cannot be closed')
  })

  await check('reads: a retired-branch shift is listed, filterable by its branch id, and its history opens -- labelled with the stored name', async () => {
    const fx = database(); let user = ADMIN
    const call = route(fx.db, ROUTE_SOURCE, () => user)
    const list = await call('GET', '/')
    assert.equal(list.status, 200)
    const row = list.body.shifts.find((s) => s.id === fx.closedId)
    assert.ok(row, 'the closed Shop shift is listed')
    assert.equal(row.branch_name, 'Shop', 'labelled with the name stored at open, never today\'s "Old Shop"')
    assert.equal(row.branch_id, 1, 'identity is the branch id')
    assert.equal(row.branch_active, false, 'the row says its branch is retired')
    assert.deepEqual(row.capabilities, { can_edit: false, can_close: false, can_reopen: false, can_cancel: true },
      'a closed record on a retired branch offers no edit and no reopen')
    const filtered = await call('GET', '/?branch_id=1')
    assert.equal(filtered.status, 200, 'a retired branch is still a valid history filter')
    assert.ok(filtered.body.shifts.some((s) => s.id === fx.closedId))
    const paged = await call('GET', '/?branch_id=1&page=1&page_size=20')
    assert.equal(paged.status, 200)
    assert.ok(paged.body.shifts.some((s) => s.id === fx.closedId), 'the paged read lists it too')
    assert.equal((await call('GET', '/?branch_id=999')).status, 400, 'an unknown branch id is still refused')
    const history = await call('GET', `/${fx.closedId}/history`)
    assert.equal(history.status, 200, 'history opens')
    assert.equal(history.body.shift.branch_name, 'Shop')
    assert.equal(history.body.segments.length, 1)
    // The cashier sees their own retired-branch record; another cashier's stays hidden.
    user = CASHIER
    const own = await call('GET', '/')
    assert.ok(own.body.shifts.some((s) => s.id === fx.closedId), 'the cashier lists their own Shop shift')
    assert.equal(own.body.shifts.some((s) => s.id === fx.otherId), false, 'visibility rules are unchanged: another cashier stays hidden')
    assert.equal((await call('GET', `/${fx.otherId}/history`)).status, 404, 'and still answers 404 on probe')
  })

  await check('open: a new shift on a retired branch is refused; an active branch opens', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => CASHIER)
    const refused = await call('POST', '/open', { branch_id: 1, opening_float_usd: 5, opening_float_khr: 0 })
    assert.equal(refused.status, 400, 'opening on the retired branch is refused')
    assert.match(refused.body.error, /inactive/i)
    assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM shift_sessions WHERE branch_id=1 AND business_date=date('now','+7 hours')").get().n, 0, 'and writes nothing')
    const opened = await call('POST', '/open', { branch_id: 2, opening_float_usd: 5, opening_float_khr: 0 })
    assert.equal(opened.status, 201, 'the active branch opens')
    assert.equal(opened.body.shift.branch_active, true)
  })

  await check('nobody trapped: the cashier\'s drawer left open on the retired branch is offered at the new branch and closes', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => CASHIER)
    const current = await call('GET', '/current?branch_id=2')
    assert.equal(current.status, 200)
    assert.equal(current.body.previous_open_shift?.id, fx.openId, 'the stale retired-branch drawer is the carry-over at LC Store')
    assert.equal(current.body.previous_open_shift.capabilities.can_close, true)
    assert.equal(current.body.previous_open_shift.branch_name, 'Shop')
    const closed = await call('POST', `/${fx.openId}/close`, { expected_revision: 0, closed_at: new Date().toISOString(), closing_counted_usd: 9, client_request_id: 'inactive-close-000001' })
    assert.equal(closed.status, 200, 'closing a drawer on a retired branch is allowed')
    assert.ok(fx.db.prepare('SELECT closed_at FROM shift_sessions WHERE id=?').get(fx.openId).closed_at)
    const replay = await call('POST', `/${fx.openId}/close`, { expected_revision: 0, closed_at: closed.body.shift.closed_at, closing_counted_usd: 9, client_request_id: 'inactive-close-000001' })
    assert.equal(replay.status, 200, 'an exact retry replays the committed receipt')
    assert.equal(replay.body.mutation_committed, true)
    const after = await call('GET', '/current?branch_id=2')
    assert.equal(after.body.previous_open_shift, null, 'once closed it is no longer offered')
    // Another cashier's stale drawer there is NOT offered to this one.
    assert.notEqual(current.body.previous_open_shift.id, fx.otherId)
  })

  await check('/current on the retired branch: the own open drawer to close, never a bare 400, and the successor to switch to', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => CASHIER)
    const current = await call('GET', '/current?branch_id=1')
    assert.equal(current.status, 200, 'answered, not refused')
    assert.equal(current.body.code, 'branch_inactive')
    assert.deepEqual(current.body.branch_inactive, { branch_id: 1, branch_name: 'Old Shop', successor_branch_id: 2, successor_branch_name: 'LC Store' })
    assert.equal(current.body.shift?.id, fx.openId, "the caller's own drawer still open there")
    assert.equal(current.body.is_open, true)
    assert.equal(current.body.can_end, true, 'End Shift is offered')
    assert.equal(current.body.needs_registration, false, 'nothing can be registered on a retired branch')
    assert.equal(current.body.previous_open_shift, null, 'the same drawer is not offered twice')
    const closed = await call('POST', `/${fx.openId}/close`, { expected_revision: 0, closing_counted_usd: 9 })
    assert.equal(closed.status, 200)
    const after = await call('GET', '/current?branch_id=1')
    assert.equal(after.status, 200)
    assert.deepEqual([after.body.shift, after.body.is_open, after.body.needs_registration, after.body.code], [null, false, false, 'branch_inactive'],
      'with nothing left to close, the till is told the branch is closed')
    assert.equal(after.body.branch_inactive.successor_branch_name, 'LC Store')
    // A successor that is itself retired is not offered; nor is a missing one.
    fx.db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run()
    assert.equal((await call('GET', '/current?branch_id=1')).body.branch_inactive.successor_branch_id, null)
    fx.db.prepare('UPDATE branches SET successor_branch_id=NULL WHERE id=1').run()
    assert.equal((await call('GET', '/current?branch_id=1')).body.branch_inactive.successor_branch_name, null)
    assert.equal((await call('GET', '/current?branch_id=999')).status, 400, 'an unknown branch is still refused')
    // An active branch carries an explicit null notice.
    fx.db.prepare('UPDATE branches SET is_active=1 WHERE id=2').run()
    assert.equal((await call('GET', '/current?branch_id=2')).body.branch_inactive, null)
  })

  await check('/current on a retired branch without 0223 (no successor column) still answers', async () => {
    const fx = database()
    fx.db.exec('ALTER TABLE branches DROP COLUMN successor_branch_id')
    const current = await route(fx.db, ROUTE_SOURCE, () => CASHIER)('GET', '/current?branch_id=1')
    assert.equal(current.status, 200)
    assert.equal(current.body.branch_inactive.successor_branch_id, null)
  })

  await check('open racing a retirement: the branch must still be active at commit, or nothing is written', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => CASHIER)
    const rows = () => fx.db.prepare('SELECT COUNT(*) n FROM shift_sessions WHERE branch_id=2').get().n
    const before = rows()
    fx.db.beforeBatch = () => fx.db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run()
    const raced = await call('POST', '/open', { branch_id: 2, opening_float_usd: 5, opening_float_khr: 0 })
    assert.equal(raced.status, 400, JSON.stringify(raced.body))
    assert.equal(raced.body.code, 'shift_branch_inactive')
    assert.equal(rows(), before, 'no drawer was opened on the branch that retired mid-request')
    // CONTROL: without the commit-time guard the same race opens a drawer there.
    const unguarded = ROUTE_SOURCE.replace("      { sql: OPEN_BRANCH_ACTIVE_GUARD_SQL, params: { branchId: row.branchId } },\n", '')
    assert.notEqual(unguarded, ROUTE_SOURCE, 'control anchor present: open guard')
    const fx2 = database()
    fx2.db.beforeBatch = () => fx2.db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run()
    const opened = await route(fx2.db, unguarded, () => CASHIER)('POST', '/open', { branch_id: 2, opening_float_usd: 5, opening_float_khr: 0 })
    assert.equal(opened.status, 201, 'control: the unguarded open commits on a retired branch')
  })

  await check('plain deactivation is refused by the branch API itself (canonical lock), so it cannot strand an open drawer', () => {
    // N7 follow-up, exception 2. Every writer of branches.is_active outside the
    // cutover goes through branchUpdateStatements -> prepareCanonicalBranchUpdate
    // (PUT /branches/:id, review approval, undo/redo replay), and that refuses
    // ANY is_active change (409 canonical_branch_identity_locked, pinned in
    // test-canonical-branch-route-pure.cjs). The cutover is the only retire
    // path and its admission refuses while any shift is open. If this lock is
    // ever lifted, this check fails first: the open-shift refusal must ship
    // with it.
    const identity = loadReal('lib/canonicalBranchIdentity.ts', {
      './db': { toDbBool: (v, fallback = 1) => (v == null || v === '' ? fallback : (v === true || Number(v) === 1 || String(v).toLowerCase() === 'true') ? 1 : 0) },
      './branchRoles': loadReal('lib/branchRoles.ts'),
    })
    const shop = { id: 1, name: 'Shop', is_active: 1, is_default: 1 }
    assert.throws(() => identity.prepareCanonicalBranchUpdate(shop, { is_active: 0 }), (error) => error instanceof identity.CanonicalBranchIdentityError)
    assert.equal(identity.prepareCanonicalBranchUpdate(shop, { notes: 'x' }).is_active, 1, 'an ordinary edit keeps the branch active')
    const cutover = fs.readFileSync(path.join(root, 'src', 'lib', 'branchCutoverParent.ts'), 'utf8')
    assert.ok(cutover.includes('AND NOT EXISTS(SELECT 1 FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL)'),
      'the cutover admission still refuses while any drawer is open')
  })

  await check('legacy POST /close naming the retired branch still closes', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => CASHIER)
    const closed = await call('POST', '/close', { shift_id: fx.openId, expected_revision: 0, branch_id: 1, client_request_id: 'legacy-inactive-0001', closing_counted_usd: 1 })
    assert.equal(closed.status, 200, 'a till that still names the retired branch can end its drawer')
  })

  await check('cancel: an administrator can cancel a drawer left open on the retired branch', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => ADMIN)
    const cancelled = await call('POST', `/${fx.otherId}/cancel`, { expected_revision: 0, reason: 'Shop retired with this drawer open' })
    assert.equal(cancelled.status, 200)
    assert.ok(fx.db.prepare('SELECT cancelled_at FROM shift_sessions WHERE id=?').get(fx.otherId).cancelled_at)
  })

  await check('amend and reopen on a retired branch are refused with why and where, and write nothing', async () => {
    const fx = database()
    const call = route(fx.db, ROUTE_SOURCE, () => ADMIN)
    const before = JSON.stringify(fx.db.prepare('SELECT * FROM shift_sessions ORDER BY id').all())
    const amend = await call('PATCH', `/${fx.closedId}`, { expected_revision: 0, reason: 'fix count', closing_counted_usd: 99 })
    assert.equal(amend.status, 409)
    assert.equal(amend.body.code, 'shift_branch_inactive')
    assert.match(amend.body.error, /"Shop" is no longer active/, 'why: names the stored branch')
    assert.match(amend.body.error, /Shift history/, 'where: the record stays in Shift history')
    const reopen = await call('POST', `/${fx.closedId}/reopen`, { expected_revision: 0, reason: 'reopen', opening_float_usd: 1 })
    assert.equal(reopen.status, 409)
    assert.equal(reopen.body.code, 'shift_branch_inactive')
    const amendOpen = await call('PATCH', `/${fx.openId}`, { expected_revision: 0, reason: 'fix float', opening_float_usd: 3 })
    assert.equal(amendOpen.status, 409, 'an open drawer there is closed, not amended')
    assert.equal(JSON.stringify(fx.db.prepare('SELECT * FROM shift_sessions ORDER BY id').all()), before, 'no row changed')
    assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM shift_session_amendments').get().n, 0, 'no amendment journal row')
    // Positive control for the refusal: reactivate the branch and the same amend goes through.
    fx.db.prepare('UPDATE branches SET is_active=1 WHERE id=1').run()
    const allowed = await call('PATCH', `/${fx.closedId}`, { expected_revision: 0, reason: 'fix count', closing_counted_usd: 99 })
    assert.equal(allowed.status, 200, 'the same amend on an active branch succeeds, so the 409 was the branch rule')
  })

  console.log(`OK ${passed} checks: shift history outlives its branch (N7)`)
}
main().catch((error) => { console.error(error); process.exit(1) })
