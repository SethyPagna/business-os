// O8 + N5. The "End shift" chain, end to end on the server side, against a
// real SQLite database: the POS button posts to shiftTransport.closeShift ->
// POST /api/shifts/close -> routes/shifts.ts, and that request must actually
// CLOSE the shift and hand back the drawer breakdown the close dialog renders.
//
// What each section discriminates:
//
//   1. THE CLOSE COMMITS. Not "the endpoint answered 200" -- the stored row is
//      read back out of SQLite and must carry closed_at, the counted drawer and
//      the closer snapshot. A route that returns a cheerful body without
//      writing (the failure the owner asked to be ruled out) fails here.
//   2. THE BREAKDOWN COMES BACK, AND IT IS THE SHARED ONE. The response's
//      reconciliation is compared field by field against a call to the same
//      lib/shiftReconciliation.ts function, and against arithmetic written out
//      by hand from the fixture. A route that recomputes the drawer its own way
//      diverges from both.
//   3. IT IS NOT THE OLD FRONTEND FORMULA. shiftTransport.shiftCashDifference
//      used to answer `counted - opening float`, ignoring sales, refunds,
//      expenses and courier payouts entirely. This fixture is built so that
//      formula gives a DIFFERENT number, and the test asserts the difference is
//      not it.
//   4. THE ACTOR SNAPSHOT IS THE USERNAME (N13/O8), on the row and in audit.
//   5. THE SECOND PRESS IS SAFE. Closing again answers already_closed with the
//      same stored numbers instead of writing a second close.
//
// Run (from cloudflare/): node scripts/test-shift-close-chain-pure.cjs
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
      const run = sqlite.transaction(() => items.map(({ sql, params }) => {
        const q = translate(sql, params)
        return { meta: { changes: sqlite.prepare(q.sql).run(...q.values).changes } }
      }))
      return run()
    },
  }
}

const sqlite = new Database(':memory:')
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
sqlite.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER DEFAULT 1);
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,
    entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,
    device_name TEXT,device_tz TEXT,client_time TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0089_system_flags.sql'), 'utf8'))
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0119_shift_restore_guard.sql'), 'utf8'))
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0123_shift_reopen_segments.sql'), 'utf8'))

// The money tables the reconciliation reads. Column shapes copied from the
// production schema the kernel queries, not invented for this test.
sqlite.exec(`CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER,
  cashier_id INTEGER, payment_method TEXT, payment_details TEXT, amount_paid_usd REAL DEFAULT 0,
  amount_paid_khr REAL DEFAULT 0, change_usd REAL, change_khr REAL, change_is_actual INTEGER,
  change_exchange_rate REAL, total_usd REAL DEFAULT 0, exchange_rate REAL DEFAULT 4100,
  delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
  label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
  status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
  total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0)`)
sqlite.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Canonical Shop')
sqlite.prepare("INSERT INTO settings(key,value) VALUES ('pos_payment_methods',?)").run('["Cash USD","ABA"]')

const env = {}
const db = d1(sqlite)
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const saleTotals = loadReal('lib/saleTotals.ts')
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './businessDateWindow': businessDateWindow })
const reconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': { getDb: () => db },
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': salesAnalytics,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})

let user = { id: 21, username: 'za', name: 'Roune Rath', permissions: JSON.stringify({ pos: true }) }
let telegramReportsFor = []
const route = loadReal('routes/shifts.ts', {
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } },
  '../lib/permissions': loadReal('lib/permissions.ts'),
  '../lib/telegram': { sendTelegramShiftReport: async (_env, id) => { telegramReportsFor.push(id); return true } },
  // REAL, over the same database: the whole point is that the close dialog and
  // the bot are fed by one function, so a stub here would prove nothing.
  '../lib/shiftReconciliation': reconciliation,
})
const app = route.default || route
const call = (method, url, body) => app.fetch(new Request(`http://test${url}`, {
  method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env, { waitUntil() {}, passThroughOnException() {} })

const round2 = (n) => Math.round(n * 100) / 100

;(async () => {
  // ---- open the shift the POS "Register float" step opens -------------------
  const opened = await call('POST', '/open', { branch_id: 1, opening_float_usd: 50, opening_float_khr: 100000 })
  assert.equal(opened.status, 201)
  const openedShift = (await opened.json()).shift
  assert.equal(openedShift.user_name, 'za', 'the opener snapshot is the username')

  // The money that happened during the shift. `openedAt` is the real opened_at
  // the route just wrote, so every row lands inside the half-open window.
  // Backdate the opening by an hour so the money below can sit INSIDE the
  // half-open window: this test opens and closes within the same second, and
  // a row stamped after closed_at is correctly excluded by the kernel.
  sqlite.prepare("UPDATE shift_sessions SET opened_at = datetime('now','-60 minutes') WHERE id=?").run(openedShift.id)
  const openedAt = sqlite.prepare('SELECT opened_at FROM shift_sessions WHERE id=?').get(openedShift.id).opened_at
  // Offsets computed BY SQLITE from the stored opened_at. Doing the arithmetic
  // in JS would reinterpret SQLite's space-separated stamp as local time and
  // silently move every row out of the window by the machine timezone.
  const at = (minutes) => sqlite.prepare("SELECT datetime(?, '+' || ? || ' minutes') v").get(openedAt, minutes).v
  sqlite.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,
    amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,delivery_actual_cost_usd,delivery_actual_cost_khr)
    VALUES (1,?,'completed',1,21,'Cash USD',40,0,40,4100,NULL,NULL),
           (2,?,'completed',1,21,'ABA',25,0,25,4100,NULL,NULL),
           (3,?,'completed',1,21,'Cash USD',0,82000,20,4100,NULL,NULL),
           (4,?,'completed',1,21,'Cash USD',10,0,10,4100,3,4000)`).run(at(5), at(10), at(15), at(20))
  sqlite.prepare(`INSERT INTO fees(id,created_at,branch_id,sale_id,fee_type,label,amount_usd,amount_khr,created_by)
    VALUES (1,?,1,NULL,'expense','Ice',4,0,21), (2,?,NULL,NULL,'expense','Moto',0,20000,21)`).run(at(6), at(7))
  sqlite.prepare(`INSERT INTO returns(id,created_at,branch_id,cashier_id,status,return_scope,total_refund_usd,total_refund_khr)
    VALUES (1,?,1,21,'completed','customer',6,0), (2,?,1,21,'completed','customer',0,10000)`).run(at(8), at(9))

  // ---- 1. the End shift press -----------------------------------------------
  telegramReportsFor = []
  const closed = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 100, closing_counted_khr: 150000 })
  assert.equal(closed.status, 200, 'POST /api/shifts/close answers the POS End shift button')
  const body = await closed.json()
  assert.equal(body.is_open, false)
  assert.equal(body.already_closed, false)

  const stored = sqlite.prepare('SELECT closed_at,closing_counted_usd,closing_counted_khr,closed_by_user_name,revision FROM shift_sessions WHERE id=?').get(openedShift.id)
  assert.ok(stored.closed_at, 'the shift is CLOSED in the database, not merely reported closed')
  assert.equal(stored.closing_counted_usd, 100)
  assert.equal(stored.closing_counted_khr, 150000)
  assert.equal(stored.closed_by_user_name, 'za', 'the closer snapshot is the username, not the display name')
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='shift.close'").get().n, 1, 'the close is audited in the same batch')
  assert.equal(sqlite.prepare("SELECT user_name FROM audit_logs WHERE action='shift.close'").get().user_name, 'za')
  assert.deepEqual(telegramReportsFor, [openedShift.id], 'the close sends the shift report exactly once')
  console.log('PASS chain: POST /close writes closed_at, the counts, the username snapshot and one audited report')

  // ---- 2. the breakdown, and that it is the shared one ----------------------
  const recon = body.shift.reconciliation
  assert.ok(recon, 'the close returns the drawer breakdown the dialog renders')
  // By hand from the fixture, per currency, nothing converted:
  //   USD: 50 opening + 50 cash (40 + 10; ABA is not cash) - 6 refunds
  //        - 4 expenses - 3 courier = 87.00
  //   KHR: 100,000 + 82,000 - 10,000 - 20,000 - 4,000 = 148,000
  assert.deepEqual(recon.opening, { usd: 50, khr: 100000 })
  assert.deepEqual(recon.cash_sales, { usd: 50, khr: 82000 })
  assert.deepEqual(recon.refunds, { usd: 6, khr: 10000 })
  assert.deepEqual(recon.expenses, { usd: 4, khr: 20000 })
  assert.deepEqual(recon.courier, { usd: 3, khr: 4000 })
  assert.deepEqual(recon.expected, { usd: 87, khr: 148000 })
  assert.deepEqual(recon.counted, { usd: 100, khr: 150000 })
  assert.deepEqual(recon.difference, { usd: 13, khr: 2000 })
  assert.equal(recon.needs_review, false)
  assert.equal(round2(50 + 50 - 6 - 4 - 3), 87)

  const direct = await reconciliation.loadShiftReconciliation(env, {
    scope_mode: 'per_account', user_id: 21, branch_id: 1,
    opened_at: openedAt, closed_at: stored.closed_at,
    opening_float_usd: 50, opening_float_khr: 100000,
    closing_counted_usd: 100, closing_counted_khr: 150000,
  }, Date.now())
  assert.deepEqual(recon, direct, 'the route returns the SAME function\'s answer, not its own arithmetic')
  console.log('PASS breakdown: the close hands back the shared reconciliation, component for component')

  // ---- 3. NOT the old frontend formula --------------------------------------
  // shiftCashDifference used to answer counted - opening float:
  //   USD 100 - 50 = 50.00, KHR 150,000 - 100,000 = 50,000.
  assert.notDeepEqual(recon.difference, { usd: 50, khr: 50000 },
    'the difference is still counted minus the opening float, ignoring the shift entirely')
  // And not the old Telegram formula either (opening + cash - expenses),
  // which had no refund and no courier term: 50 + 50 - 4 = 96.00.
  assert.notDeepEqual(recon.expected, { usd: 96, khr: 162000 },
    'refunds and courier payouts are missing from the expected drawer')
  console.log('PASS discrimination: neither the old app formula nor the old report formula gives these numbers')

  // ---- 4. the reads carry the same breakdown -------------------------------
  const current = await (await call('GET', '/current?branch_id=1')).json()
  assert.deepEqual(current.shift.reconciliation, recon, 'GET /current carries the breakdown for a closed shift')
  const history = await (await call('GET', `/${openedShift.id}/history`)).json()
  assert.deepEqual(history.shift.reconciliation, recon, 'GET /:id/history carries it too')
  console.log('PASS reads: /current and /:id/history return the same breakdown as the close')

  // ---- 5. a second press is safe -------------------------------------------
  telegramReportsFor = []
  const again = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 999, closing_counted_khr: 999 })
  assert.equal(again.status, 200)
  const againBody = await again.json()
  assert.equal(againBody.already_closed, true)
  assert.deepEqual(againBody.shift.reconciliation.counted, { usd: 100, khr: 150000 }, 'the second press cannot overwrite the count')
  assert.equal(sqlite.prepare('SELECT closing_counted_usd FROM shift_sessions WHERE id=?').get(openedShift.id).closing_counted_usd, 100)
  assert.deepEqual(telegramReportsFor, [], 'and it does not send a second report')
  console.log('PASS idempotence: pressing End shift twice reports the stored close and writes nothing')

  console.log('OK shift close chain: button -> transport -> route -> committed close + shared breakdown')
})().catch((error) => { console.error(error); process.exit(1) })
