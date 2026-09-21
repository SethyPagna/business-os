// SHIFT CLOSE: THE DEVICE CLOCK IS NOT THE TIME AUTHORITY.
//
// Production shift 20 (2026-09-21) could not be ended from POS. The End Shift
// button stamped the closing moment with the phone's own clock, and
// POST /:id/close refused anything even one second ahead of the Worker's clock
// ("Closing time cannot be in the future."). The operator finally closed it
// from the Shifts popup by picking an earlier minute (closed_at landed on
// 13:02:00.000Z, stamped by the server at 13:03:16Z).
//
// This drives the real routes/shifts.ts over a real SQLite database and pins:
//
//   1. closed_at ABSENT (the live POS close)      -> 200, server stamps now
//   2. closed_at a few seconds AHEAD of the server -> 200, clamped to now
//   3. closed_at ten minutes ahead                 -> 400 (positive control:
//      a genuine future time is still refused, so the harness can see one)
//   4. the exact same request replayed after commit-> 200 already_closed, no
//      second amendment (lost acknowledgement, Retry button)
//   5. two identical requests in flight at once    -> both 200, ONE commit
//      (duplicate clicks / two tabs)
//   6. a different pos-only account on the same shift -> 403 (permission
//      model preserved; shop_wide close stays with owner or admin)
//   7. a counted drawer far from expected           -> 200 (reconciliation is
//      informational, never a gate)
//   8. PATCH /:id with a closed_at seconds ahead    -> 200 clamped;
//      ten minutes ahead                             -> 400
//
// Discriminating: at 9997674a case 1 was 400 "A valid closing time is
// required." and case 2 was 400 "Closing time cannot be in the future.".
//
// Run (from cloudflare/): node scripts/test-shift-close-clock-skew-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

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
  return db
}

// Real pure arithmetic from lib/shiftReconciliation.ts; D1 halves stubbed.
const recon = loadReal('lib/shiftReconciliation.ts', {
  './db': { getDb: () => { throw new Error('no database reads in this fixture') } },
  './salesAnalytics': { deliveryActualCostExpr: () => '0', shiftWindowWhere: () => ({ clauses: ['1=1'], params: {} }) },
  './nativeSaleChange': { resolveStoredNativeSaleChange: () => ({ kind: 'none', usd: 0, khr: 0 }) },
  './paymentMethodRegistry': {
    hasConfiguredCashMethod: () => true, isCashPaymentMethod: () => true,
    parseConfiguredMethods: () => [], parsePaymentMethodKinds: () => ({}),
    PAYMENT_METHOD_KINDS_SETTING: 'pos_payment_method_kinds',
  },
})
const reconciliationFor = async (_env, shift) => recon.computeShiftReconciliation({
  opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
  cashSales: { usd: 40, khr: 40000 }, refunds: { usd: 0, khr: 0 }, expenses: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 },
  counted: { usd: shift.closing_counted_usd ?? null, khr: shift.closing_counted_khr ?? null },
})

const owner = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }
const otherCashier = { id: 8, name: 'Other', username: 'other', permissions: JSON.stringify({ pos: true }) }

function scenario() {
  const sqlite = database()
  let actor = owner
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); await next() } },
    '../lib/permissions': loadReal('lib/permissions.ts'),
    '../lib/telegram': { sendTelegramShiftReport: async () => true },
    '../lib/shiftReconciliation': { ...recon, loadShiftReconciliation: reconciliationFor },
  })
  const app = route.default || route
  const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {}, { waitUntil() {}, passThroughOnException() {} })
  const row = (id) => sqlite.prepare('SELECT * FROM shift_sessions WHERE id=?').get(id)
  const amendments = (id) => sqlite.prepare('SELECT COUNT(*) AS n FROM shift_session_amendments WHERE shift_session_id=?').get(id).n
  const open = async () => {
    const res = await call('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 10000 })
    assert.equal(res.status, 201)
    return (await res.json()).shift
  }
  return { call, row, amendments, open, actAs: (next) => { actor = next }, sqlite }
}

const closeBody = (shift, extra) => ({ expected_revision: shift.revision, client_request_id: crypto.randomUUID(),
  closing_counted_usd: 50, closing_counted_khr: 50000, ...extra })
const ms = (iso) => new Date(iso).getTime()
// Read a body exactly once: status assertion message and parsed JSON share it.
async function expect(res, status, label) {
  const text = await res.text()
  assert.equal(res.status, status, `${label}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  // 1. Live POS close: no closed_at at all, the server stamps its own clock.
  {
    const { call, row, amendments, open } = scenario()
    const shift = await open()
    const before = Date.now()
    const res = await call('POST', `/${shift.id}/close`, closeBody(shift))
    const after = Date.now()
    const body = await expect(res, 200, 'live close without closed_at')
    assert.equal(body.already_closed, false)
    const stored = row(shift.id)
    assert.ok(stored.closed_at, 'the shift is closed')
    assert.ok(ms(stored.closed_at) >= before && ms(stored.closed_at) <= after, `server-stamped close ${stored.closed_at} lies within the request window`)
    assert.equal(stored.revision, shift.revision + 1)
    assert.equal(amendments(shift.id), 1, 'one before/after record for the close')
    assert.equal(body.shift.reconciliation, null, 'the drawer comparison is admin-facing; a pos-only cashier gets none')

    // 8. Amend that closed row with a closing time seconds ahead of the server.
    const ahead = new Date(Date.now() + 2_000).toISOString()
    const amendBefore = Date.now()
    const amended = await call('PATCH', `/${shift.id}`, { expected_revision: stored.revision, reason: 'Fast device clock', closed_at: ahead })
    await expect(amended, 200, 'amend with a slightly-ahead closing time')
    const afterAmend = row(shift.id)
    assert.ok(ms(afterAmend.closed_at) <= Date.now() && ms(afterAmend.closed_at) >= amendBefore, 'amended closing time is clamped to the server clock, never the requested future instant')
    assert.notEqual(afterAmend.closed_at, ahead)
    const farAmend = await call('PATCH', `/${shift.id}`, { expected_revision: afterAmend.revision, reason: 'Really future', closed_at: new Date(Date.now() + 10 * 60_000).toISOString() })
    assert.equal(farAmend.status, 400, 'ten minutes ahead is still a future time on amend')
    assert.equal(row(shift.id).revision, afterAmend.revision, 'refused amend writes nothing')
  }

  // 2 + 4. A device running three seconds fast, then the exact retry.
  {
    const { call, row, amendments, open } = scenario()
    const shift = await open()
    const requested = new Date(Date.now() + 3_000).toISOString()
    const body = closeBody(shift, { closed_at: requested })
    const before = Date.now()
    const res = await call('POST', `/${shift.id}/close`, body)
    await expect(res, 200, 'close with a device clock three seconds fast')
    const stored = row(shift.id)
    assert.ok(ms(stored.closed_at) >= before && ms(stored.closed_at) <= Date.now(), 'a slightly-ahead device time is clamped to the server now')
    assert.notEqual(stored.closed_at, requested, 'the future instant itself is never stored')
    assert.equal(amendments(shift.id), 1)
    // Lost acknowledgement: the frozen request is sent again unchanged.
    const replay = await call('POST', `/${shift.id}/close`, body)
    const replayed = await expect(replay, 200, 'exact retry of the committed close')
    assert.equal(replayed.already_closed, true, 'exact retry answers with the committed close')
    assert.equal(replayed.mutation_committed, true)
    assert.equal(replayed.shift.id, shift.id)
    assert.equal(amendments(shift.id), 1, 'the retry writes no second amendment')
    assert.equal(row(shift.id).closed_at, stored.closed_at, 'the retry does not move the closing time')
    assert.equal(row(shift.id).revision, shift.revision + 1)
  }

  // 3. Positive control: a genuinely future time is still refused.
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', `/${shift.id}/close`, closeBody(shift, { closed_at: new Date(Date.now() + 10 * 60_000).toISOString() }))
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /future/)
    assert.equal(row(shift.id).closed_at, null, 'refused close leaves the shift open')
    const garbage = await call('POST', `/${shift.id}/close`, closeBody(shift, { closed_at: 'not a time' }))
    assert.equal(garbage.status, 400, 'an unparseable time is still refused, not silently replaced by now')
  }

  // 5. Duplicate clicks: two identical requests in flight together.
  {
    const { call, row, amendments, open } = scenario()
    const shift = await open()
    const body = closeBody(shift)
    const [first, second] = await Promise.all([call('POST', `/${shift.id}/close`, body), call('POST', `/${shift.id}/close`, body)])
    const bodies = [await first.text(), await second.text()]
    assert.deepEqual([first.status, second.status], [200, 200], bodies.join(' / '))
    const outcomes = bodies.map((text) => JSON.parse(text).already_closed)
    assert.deepEqual(outcomes.sort(), [false, true], 'exactly one request committed, the other received the receipt')
    assert.equal(amendments(shift.id), 1, 'one commit, one amendment')
    assert.equal(row(shift.id).revision, shift.revision + 1, 'revision advanced exactly once')
  }

  // 6. Another pos-only account cannot end someone else's shift.
  {
    const { call, row, open, actAs } = scenario()
    const shift = await open()
    actAs(otherCashier)
    const res = await call('POST', `/${shift.id}/close`, closeBody(shift))
    assert.equal(res.status, 403)
    assert.equal(row(shift.id).closed_at, null)
    actAs(owner)
    const stale = await call('POST', `/${shift.id}/close`, closeBody(shift, { expected_revision: shift.revision + 5 }))
    assert.equal(stale.status, 409, 'a stale revision is a readable rejection, not a pending retry')
    assert.equal(row(shift.id).closed_at, null)
  }

  // 7. Reconciliation is informational: a wildly wrong count still closes.
  {
    const { call, row, open, actAs } = scenario()
    const shift = await open()
    actAs({ ...owner, role_code: 'admin' })
    const res = await call('POST', `/${shift.id}/close`, closeBody(shift, { closing_counted_usd: 999, closing_counted_khr: 0, additional_cash_usd: 5 }))
    const body = await expect(res, 200, 'close with a count far from expected')
    const stored = row(shift.id)
    assert.equal(stored.closing_counted_usd, 999)
    assert.equal(stored.additional_cash_usd, 5)
    assert.ok(body.shift.reconciliation && body.shift.reconciliation.difference, 'difference is reported, not enforced')
  }

  console.log('PASS shift close: server-stamped live close, clock-skew clamp, far-future refusal, exact retry receipt, duplicate in-flight clicks, permission and informational reconciliation')
}

main().catch((error) => { console.error(error); process.exit(1) })
