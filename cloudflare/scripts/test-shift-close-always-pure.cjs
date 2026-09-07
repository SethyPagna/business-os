// N37. ENDING A SHIFT ALWAYS WORKS.
//
// Owner ruling, Sep 6 2026: "closing shift is only a breakdown for admins in
// reports and so on for you to know ... so it is not calculated in the
// internal system, it is calculated only for shift report ... only show
// expenses like delivery and other expenses just for visual without making it
// a necessity to match the expected".
//
// The counted drawer is therefore a RECORD, never a gate. This test drives the
// real routes/shifts.ts over a real SQLite database and pins the four ways the
// close is allowed to be attempted:
//
//   1. counted FAR from expected            -> 200, stored, difference printed
//   2. counted absent from the body         -> 200, stored as NULL
//   3. counted sent as empty strings        -> 200, stored as NULL
//   4. one currency counted, the other blank-> 200, that one stored, other NULL
//
// and the one that must still fail:
//
//   5. a negative count                     -> 400 (a typo is not "uncounted")
//
// plus the two adjacent paths a blank count used to strand:
//
//   6. POST /:id/close (the Shifts popup's historic close) accepts blank too
//   7. PATCH /:id can still amend a shift that was closed WITHOUT a count --
//      before this, such a row was permanently unamendable.
//
// Discriminating: at 01f0c93c both close routes ran `requiredMoney`, which
// returns null for a blank AND for a bad number, and answered 400 "Valid USD
// and KHR closing counts are required."; cases 2, 3, 4, 6 and 7 were 400 there.
// Case 5 is the positive control -- it proves the test can still see a refusal,
// so a run that reports every close as accepted is not just a broken harness.
//
// Run (from cloudflare/): node scripts/test-shift-close-always-pure.cjs
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
  db.prepare('INSERT INTO branches(id,name,is_active) VALUES (1,?,1)').run('Shop')
  return db
}

// The REAL pure arithmetic out of lib/shiftReconciliation.ts. Its D1-reading
// halves are never called here, so their imports are stubbed; the formula the
// route's response carries is the shipped one, not a copy.
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

// A drawer that took $40 of cash on a $10 float: expected is $50, so every
// count below is a MISMATCH by construction and the close must not care.
const reconciliationFor = async (_env, shift) => recon.computeShiftReconciliation({
  opening: { usd: shift.opening_float_usd, khr: shift.opening_float_khr },
  cashSales: { usd: 40, khr: 40000 },
  refunds: { usd: 0, khr: 0 },
  expenses: { usd: 0, khr: 0 },
  courier: { usd: 0, khr: 0 },
  counted: { usd: shift.closing_counted_usd ?? null, khr: shift.closing_counted_khr ?? null },
})

// One shift per day per cashier is the schema's own rule (migration 0116) and
// migration 0119's restore guard refuses a DELETE, so each case gets its own
// database rather than trying to reset one. Same route module, same fixture.
const user = { id: 7, name: 'Owner', username: 'owner', permissions: JSON.stringify({ pos: true }) }

function scenario() {
  const sqlite = database()
  const route = loadReal('routes/shifts.ts', {
    '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
    '../lib/db': { getDb: () => d1(sqlite) },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); await next() } },
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
  const open = async () => {
    const res = await call('POST', '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 10000 })
    assert.equal(res.status, 201)
    return (await res.json()).shift
  }
  return { call, row, open }
}

async function main() {
  // ---- 1. counted far from expected -------------------------------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 3, closing_counted_khr: 0 })
    assert.equal(res.status, 200, 'a drawer that does not match expected still closes')
    const body = await res.json()
    assert.equal(body.is_open, false)
    assert.equal(row(shift.id).closing_counted_usd, 3)
    // The mismatch is REPORTED, not enforced: -$47 against a $50 expected.
    assert.equal(body.shift.reconciliation.expected.usd, 50)
    assert.equal(body.shift.reconciliation.difference.usd, -47)
    assert.ok(!('requires_confirmation' in body) && !('variance_blocked' in body),
      'the close response carries no confirmation gate')
  }

  // ---- 2. no counts in the body at all ----------------------------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', '/close', { branch_id: 1 })
    assert.equal(res.status, 200, 'a close with no counted drawer at all is accepted')
    const stored = row(shift.id)
    assert.ok(stored.closed_at, 'the shift is actually closed')
    assert.equal(stored.closing_counted_usd, null)
    assert.equal(stored.closing_counted_khr, null)
    const body = await res.json()
    assert.deepEqual(body.shift.reconciliation.counted, { usd: null, khr: null })
    assert.deepEqual(body.shift.reconciliation.difference, { usd: null, khr: null },
      'an uncounted drawer reports no difference rather than a fake zero')
    // Expected is still there: the report half of the close is unaffected.
    assert.equal(body.shift.reconciliation.expected.usd, 50)
  }

  // ---- 3. blank strings (what an untouched form field posts) -------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', '/close', { branch_id: 1, closing_counted_usd: '', closing_counted_khr: '' })
    assert.equal(res.status, 200, 'blank count fields close the shift')
    assert.equal(row(shift.id).closing_counted_usd, null)
    assert.equal(row(shift.id).closing_counted_khr, null)
  }

  // ---- 4. one currency only ---------------------------------------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 12.5, closing_counted_khr: '' })
    assert.equal(res.status, 200, 'a drawer counted in dollars only closes')
    assert.equal(row(shift.id).closing_counted_usd, 12.5)
    assert.equal(row(shift.id).closing_counted_khr, null, 'the uncounted currency is NULL, not a fabricated 0')
  }

  // ---- 5. positive control: a bad number is still refused ----------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', '/close', { branch_id: 1, closing_counted_usd: -5, closing_counted_khr: 0 })
    assert.equal(res.status, 400, 'a negative count is a typo, not "uncounted"')
    assert.equal(row(shift.id).closed_at, null, 'the refused close wrote nothing')
    const notANumber = await call('POST', '/close', { branch_id: 1, closing_counted_usd: 'abc', closing_counted_khr: 0 })
    assert.equal(notANumber.status, 400, 'a non-numeric count is refused')
  }

  // ---- 6. the historic close (Shifts popup) accepts blank too ------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const res = await call('POST', `/${shift.id}/close`, {
      expected_revision: shift.revision, closed_at: new Date().toISOString(),
    })
    assert.equal(res.status, 200, 'POST /:id/close accepts a shift closed without a count')
    assert.equal(row(shift.id).closing_counted_usd, null)
    const negative = row(shift.id)
    assert.ok(negative.closed_at, 'the historic close committed')
  }

  // ---- 7. an uncounted closed shift is still amendable -------------------
  {
    const { call, row, open } = scenario()
    const shift = await open()
    const closed = await call('POST', '/close', { branch_id: 1 })
    assert.equal(closed.status, 200)
    const stored = row(shift.id)
    const amend = await call('PATCH', `/${shift.id}`, {
      expected_revision: stored.revision,
      reason: 'Correcting the opening note',
      opened_at: stored.opened_at,
      closed_at: stored.closed_at,
      opening_note: 'Counted by the morning cashier',
    })
    assert.equal(amend.status, 200, 'a shift closed without a count must stay amendable')
    assert.equal(row(shift.id).opening_note, 'Counted by the morning cashier')
    assert.equal(row(shift.id).closing_counted_usd, null, 'the amend did not invent a count')
  }

  // ---- the source carries no variance gate ------------------------------
  const source = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')
  assert.doesNotMatch(source, /Valid USD and KHR closing counts are required/,
    'the close no longer demands both counted currencies')
  assert.doesNotMatch(source, /difference[^\n]*\?\s*c\.json/,
    'no route branches on the drawer difference')

  console.log('shift close always works: PASS')
}

main().catch((error) => { console.error(error); process.exit(1) })
