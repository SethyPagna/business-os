// N4 (LOOPHOLE-REVIEW-20261006): a closed shift's expected cash must not
// silently change.
//
// Before: expected cash was recomputed on every read from sale rows that stay
// mutable. Close $50 short, bulk-relabel $50 of Cash sales as ABA, and the
// closed shift balanced -- no trace.
// After: the close stores the figures it was made on (migration 0237,
// shift_close_figures, written in the close batch). The report shows those;
// later drift is a separate close_drift block naming the components and the
// sales that moved, with today's computed figures beside them.
//
// Sections:
//   1. MIGRATION 0237 on the real chain: LF-only, one file with the number, the
//      header's pre/post assertions, IDEMPOTENT (a second run is a no-op and
//      keeps the rows), immutable (UPDATE never, DELETE only in restore
//      maintenance), CHECKs, FK, and the header's recovery statements.
//   2. END TO END on the real chain, real routes: open, ring sales, close $50
//      short, relabel a Cash sale as ABA through the real POST /bulk-update.
//      CONTROL: the computed path (what every read showed before N4) moves the
//      expected cash and hides the shortage. NEW: the stored figures are byte-
//      identical, the report still shows the shortage, and close_drift names
//      the relabelled sale (with its receipt) and the moved components.
//   3. An amended count after close is drift too; a shift closed before 0237
//      reads "computed"; a cashier never receives the admin comparison.
//
// Run (from cloudflare/): node scripts/test-shift-close-figures-pure.cjs
process.env.TZ = 'Asia/Phnom_Penh'
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const migrationsDir = path.join(root, 'migrations')
const FILE = '0237_shift_close_figures.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')
const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// ---- 1. the migration -------------------------------------------------------
function chainBefore() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of chain.filter((f) => f < FILE)) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  db.pragma('foreign_keys = ON')
  return db
}
const OBJECTS = "SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('shift_close_figures','shift_close_figures_no_update','shift_close_figures_no_delete')"
const schemaOf = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'shift_close_figures%' ORDER BY name").all()
function seedShift(db, code, day = '01') {
  db.prepare(`INSERT INTO shift_sessions (shift_code, user_id, user_name, branch_id, branch_name, business_date, opened_at, closed_at)
    VALUES (?, 7, 'cashier', 1, 'Shop', ?, ?, ?)`).run(code, `2026-10-${day}`, `2026-10-${day}T01:00:00.000Z`, `2026-10-${day}T09:00:00.000Z`)
  return db.prepare('SELECT id FROM shift_sessions WHERE shift_code=?').get(code).id
}

async function migrationChecks() {
  await check('0237 text: LF-only, the only file with its number, after 0236 on every ref, header complete', () => {
    assert.ok(!migration.includes('\r'), 'LF-only (cloudflare/migrations/*.sql is eol=lf)')
    assert.deepEqual(chain.filter((f) => f.startsWith('0237_')), [FILE])
    assert.ok(chain.every((f) => f === FILE || f < FILE), 'the newest file in the chain')
    for (const section of ['Pre-assert:', 'Post-assert:', 'Deploy order:', 'Recovery:']) assert.ok(migration.includes(section), section)
    assert.match(migration, /IF NOT EXISTS shift_close_figures/)
  })

  await check('0237 pre/post assertions hold on the real chain, and no existing row changes', () => {
    const db = chainBefore()
    seedShift(db, 'S-PRE')
    const shiftsBefore = JSON.stringify(db.prepare('SELECT * FROM shift_sessions ORDER BY id').all())
    assert.equal(db.prepare(OBJECTS).get().n, 0, 'pre-assert: none of the three objects exists')
    db.exec(migration)
    assert.equal(db.prepare(OBJECTS).get().n, 3, 'post-assert: table and both triggers')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM shift_close_figures').get().n, 0, 'post-assert: empty -- existing closed shifts get NULL figures')
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM shift_sessions ORDER BY id').all()), shiftsBefore, 'shift_sessions untouched')
  })

  await check('0237 is idempotent: a second run is a no-op that keeps the schema and the stored rows', () => {
    const db = chainBefore()
    const id = seedShift(db, 'S-IDEM')
    db.exec(migration)
    db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (?, '2026-10-01T09:00:00.000Z', '{\"v\":1}')").run(id)
    const schema = schemaOf(db); const rows = db.prepare('SELECT * FROM shift_close_figures').all()
    assert.doesNotThrow(() => db.exec(migration), 'second run does not fail')
    assert.doesNotThrow(() => db.exec(migration), 'third run does not fail')
    assert.deepEqual(schemaOf(db), schema, 'same objects, same SQL')
    assert.deepEqual(db.prepare('SELECT * FROM shift_close_figures').all(), rows, 'the stored figures survive a re-run')
  })

  await check('0237 rows are immutable outside restore maintenance; CHECKs and the FK hold', () => {
    const db = chainBefore()
    const id = seedShift(db, 'S-IMM')
    db.exec(migration)
    db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (?, 'x', '{\"v\":1}')").run(id)
    assert.throws(() => db.prepare("UPDATE shift_close_figures SET figures_json='{\"v\":2}'").run(), /immutable/, 'no UPDATE')
    assert.throws(() => db.prepare('DELETE FROM shift_close_figures').run(), /immutable/, 'no DELETE')
    const id2 = seedShift(db, 'S-IMM-2', '02')
    assert.throws(() => db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (?, 'x', 'not json')").run(id2), /CHECK/)
    assert.throws(() => db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (?, 'x', '[1]')").run(id2), /CHECK/, 'an object, not an array')
    assert.throws(() => db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (99999, 'x', '{}')").run(), /FOREIGN KEY/)
    assert.throws(() => db.prepare("INSERT INTO shift_close_figures (shift_session_id, closed_at, figures_json) VALUES (?, 'x', '{}')").run(id), /UNIQUE|PRIMARY/, 'one row per shift')
    db.prepare("INSERT INTO system_flags(key, value) VALUES ('maintenance', '{\"mode\":\"restore\"}')").run()
    assert.throws(() => db.prepare("UPDATE shift_close_figures SET closed_at='y'").run(), /immutable/, 'not even during a restore')
    assert.doesNotThrow(() => db.prepare('DELETE FROM shift_close_figures').run(), 'a restore may replace the rows')
  })

  await check('0237 recovery: the header statements remove exactly the three objects; re-applying restores them', () => {
    const db = chainBefore()
    seedShift(db, 'S-REC')
    db.exec(migration)
    const shifts = JSON.stringify(db.prepare('SELECT * FROM shift_sessions').all())
    const recovery = migration.split('\n').filter((line) => /^--\s+DROP (TRIGGER|TABLE) IF EXISTS shift_close_figures/.test(line))
      .map((line) => line.replace(/^--\s+/, ''))
    assert.equal(recovery.length, 3, 'three recovery statements in the header')
    for (const statement of recovery) db.exec(statement)
    assert.equal(db.prepare(OBJECTS).get().n, 0)
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM shift_sessions').all()), shifts, 'shift_sessions untouched by recovery')
    db.exec(migration)
    assert.equal(db.prepare(OBJECTS).get().n, 3)
  })
}

// ---- 2. the routes on the real chain ---------------------------------------
let user = null
const cache = new Map()
const actual = new Set([
  // the sales bulk-update stack (as test-sale-bulk-update-pure.cjs loads it)
  'businessMaintenanceGuard', 'acquisitionCostAccess', 'saleCustomerAssignmentGuard', 'actorSnapshot', 'anonymousCustomer',
  'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate', 'saleRecordEvents', 'saleTransitions',
  'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution', 'undoAppliers', 'branchWrites',
  'conflictControl', 'searchMatch', 'paymentMethodRegistry', 'contactOptions',
  // the shift route and its drawer arithmetic, all real
  'shiftReconciliation', 'salesAnalytics', 'nativeSaleChange', 'businessDateWindow', 'continuousReadWindow', 'clientTimestamp',
  'telegramLang', 'schemaProbe', 'removalLosses', 'moneyPrecision', 'reportMoneyPrecision', 'saleMoneyPrecision',
  'refundMoneyPrecision', 'customerReturnEntitlement', 'saleItemPricing', 'promotionRules', 'saleTotals', 'financialPrecision',
])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name === 'hono') return require(name)
    if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0 }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.endsWith('/audit')) return { audit: async () => {} }
    if (name.endsWith('/telegram')) return { sendTelegramShiftReport: async () => true, scheduleTelegramShiftOverview: async () => true }
    if (rel.endsWith('saleRecordEvents.ts') && name === './saleRecords') return { SALE_RECORD_FIELDS: recordContract.fields, SALE_RECORD_KINDS: recordContract.kinds }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of chain) sql.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  sql.exec(`INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA"]','settings-v1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    INSERT INTO branches(id,name) VALUES(1,'Shop');`)
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return {
          text, params,
          async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
          async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
          async run() { const r = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((s) => { const r = sqliteD1Call(sql.prepare(s.text), 'run', s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
    },
  } }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const call = async (app, url, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await app.request(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx)
    const text = await response.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json }
  }
  return { sql, env, call }
}

const ADMIN = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const CASHIER = { id: 7, name: 'Cashier', username: 'cashier', permissions: JSON.stringify({ pos: true }) }

async function routeChecks() {
  const shifts = load('routes/shifts.ts').default
  const sales = load('routes/sales.ts').default
  const reconciliation = load('lib/shiftReconciliation.ts')

  // One shop day: open with $10, ring $50 + $30 cash and $20 ABA, count $40.
  // Expected 10 + 80 = 90, so the drawer closed $50 SHORT.
  const f = fixture()
  user = CASHIER
  const opened = await f.call(shifts, '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
  assert.equal(opened.status, 201, JSON.stringify(opened.body))
  const shiftId = opened.body.shift.id
  // Backdated with its business date, so the amendment below stays inside it
  // whatever the hour this runs at.
  f.sql.prepare("UPDATE shift_sessions SET opened_at = datetime('now','-60 minutes'), business_date = date(datetime('now','-60 minutes'), '+7 hours') WHERE id=?").run(shiftId)
  const openedAt = f.sql.prepare('SELECT opened_at FROM shift_sessions WHERE id=?').get(shiftId).opened_at
  const at = (minutes) => f.sql.prepare("SELECT datetime(?, '+' || ? || ' minutes') v").get(openedAt, minutes).v
  const sale = f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,
      payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,created_at,updated_at)
    VALUES (?,?,'completed',1,'Shop',7,'cashier',?,?,'USD',4100,?,0,0,0,?,?,'v1')`)
  sale.run(1, 'R-CASH-50', 'Cash', '[{"method":"Cash","amount_usd":50,"amount_khr":0}]', 50, 50, at(5))
  sale.run(2, 'R-CASH-30', 'Cash', '[{"method":"Cash","amount_usd":30,"amount_khr":0}]', 30, 30, at(10))
  sale.run(3, 'R-ABA-20', 'ABA', '[{"method":"ABA","amount_usd":20,"amount_khr":0}]', 20, 20, at(15))

  const close = await f.call(shifts, `/${shiftId}/close`, { expected_revision: opened.body.shift.revision, closing_counted_usd: 40, closing_counted_khr: 0 })
  assert.equal(close.status, 200, JSON.stringify(close.body))
  const closedRow = f.sql.prepare('SELECT * FROM shift_sessions WHERE id=?').get(shiftId)

  await check('the close stores the figures it was made on, in the close batch: expected $90, counted $40, $50 short, per-sale tender', () => {
    const row = f.sql.prepare('SELECT * FROM shift_close_figures WHERE shift_session_id=?').get(shiftId)
    assert.ok(row, 'a cashier close writes the figures row')
    assert.equal(row.closed_at, closedRow.closed_at, 'taken for exactly the stored closed_at')
    const figures = JSON.parse(row.figures_json)
    assert.equal(figures.v, 1)
    assert.deepEqual([figures.reconciliation.opening.usd, figures.reconciliation.cash_sales.usd, figures.reconciliation.expected.usd,
      figures.reconciliation.counted.usd, figures.reconciliation.difference.usd], [10, 80, 90, 40, -50])
    assert.deepEqual(figures.sales, [[1, 50, 0, 0, 0], [2, 30, 0, 0, 0], [3, 0, 0, 20, 0]], 'the per-sale fingerprint')
    assert.deepEqual(figures.other_tenders, { usd: 20, khr: 0 })
  })
  const storedJson = f.sql.prepare('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?').get(shiftId).figures_json

  user = ADMIN
  await check('before any change: the report reads the stored figures and shows no drift', async () => {
    const history = await f.call(shifts, `/${shiftId}/history`)
    assert.equal(history.status, 200)
    assert.equal(history.body.shift.reconciliation_source, 'stored')
    assert.equal(history.body.shift.reconciliation.expected.usd, 90)
    assert.equal(history.body.shift.close_drift, null, 'nothing moved, so there is no drift line')
  })

  // The loophole: relabel the $50 Cash sale as ABA through the real bulk route.
  const relabel = await f.call(sales, '/bulk-update', { client_request_id: 'relabel-after-close-1',
    items: [{ id: 1, expected_updated_at: 'v1' }], action: { kind: 'payment_method', source: 'Cash', target: 'ABA' } })
  assert.equal(relabel.status, 200, JSON.stringify(relabel.body))
  assert.equal(f.sql.prepare('SELECT payment_method FROM sales WHERE id=1').get().payment_method, 'ABA', 'the relabel landed')

  await check('CONTROL: the computed path (every read before N4) now expects $40 and the $50 shortage has vanished', async () => {
    const computed = await reconciliation.loadShiftReconciliation(f.env, closedRow, Date.now())
    assert.equal(computed.expected.usd, 40, 'expected cash moved after the close')
    assert.equal(computed.difference.usd, 0, 'the closed shift now "balances" -- the loophole')
  })

  await check('NEW: the stored figures are byte-identical, the report still shows $50 short, and the drift names the sale', async () => {
    assert.equal(f.sql.prepare('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?').get(shiftId).figures_json, storedJson,
      'the stored close figures did not move')
    const history = await f.call(shifts, `/${shiftId}/history`)
    assert.equal(history.status, 200)
    const shift = history.body.shift
    assert.equal(shift.reconciliation_source, 'stored')
    assert.deepEqual([shift.reconciliation.expected.usd, shift.reconciliation.counted.usd, shift.reconciliation.difference.usd], [90, 40, -50],
      'the report shows the drawer as it was closed')
    const drift = shift.close_drift
    assert.ok(drift, 'a changed-after-close block is present')
    const byKey = Object.fromEntries(drift.components.map((c) => [c.key, c]))
    assert.deepEqual(Object.keys(byKey).sort(), ['cash_sales', 'expected', 'other_tenders'])
    assert.deepEqual([byKey.cash_sales.stored.usd, byKey.cash_sales.current.usd], [80, 30])
    assert.deepEqual([byKey.expected.stored.usd, byKey.expected.current.usd], [90, 40])
    assert.deepEqual([byKey.other_tenders.stored.usd, byKey.other_tenders.current.usd], [20, 70])
    assert.equal(drift.sales_total, 1)
    assert.equal(drift.sales_unavailable, false)
    assert.deepEqual(drift.sales.map((s) => [s.sale_id, s.change, s.receipt_number, s.before, s.after]),
      [[1, 'changed', 'R-CASH-50', [50, 0, 0, 0], [0, 0, 50, 0]]], 'the relabelled sale, with its receipt for the link')
    assert.equal(drift.current.expected.usd, 40, "today's computed figure is shown beside, not instead")
  })

  await check('a cashier never receives the comparison, stored or drifted', async () => {
    user = CASHIER
    const history = await f.call(shifts, `/${shiftId}/history`)
    assert.equal(history.status, 200)
    assert.equal(history.body.shift.reconciliation, null)
    assert.equal(history.body.shift.close_drift, null)
    user = ADMIN
  })

  await check('an amended count and a cancelled sale after close are drift too; the stored row still does not move', async () => {
    const revision = f.sql.prepare('SELECT revision FROM shift_sessions WHERE id=?').get(shiftId).revision
    const amend = await f.call(shifts, `/${shiftId}`, { expected_revision: revision, reason: 'Recount', closing_counted_usd: 45 }, 'PATCH')
    assert.equal(amend.status, 200, JSON.stringify(amend.body))
    f.sql.prepare("UPDATE sales SET sale_status='cancelled' WHERE id=2").run()
    const drift = (await f.call(shifts, `/${shiftId}/history`)).body.shift.close_drift
    const byKey = Object.fromEntries(drift.components.map((c) => [c.key, c]))
    assert.deepEqual([byKey.counted.stored.usd, byKey.counted.current.usd], [40, 45], 'the recount shows as drift')
    assert.deepEqual(drift.sales.map((s) => [s.sale_id, s.change, s.sale_status]), [[1, 'changed', 'completed'], [2, 'changed', 'cancelled']])
    assert.equal(f.sql.prepare('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?').get(shiftId).figures_json, storedJson)
  })

  await check('a sale backdated into the closed window is listed as added', async () => {
    sale.run(4, 'R-LATE', 'Cash', '[{"method":"Cash","amount_usd":5,"amount_khr":0}]', 5, 5, at(20))
    const drift = (await f.call(shifts, `/${shiftId}/history`)).body.shift.close_drift
    assert.deepEqual(drift.sales.find((s) => s.sale_id === 4), { sale_id: 4, change: 'added', before: null, after: [5, 0, 0, 0],
      receipt_number: 'R-LATE', created_at: at(20), sale_status: 'completed' })
  })

  await check('a shift closed before 0237 has no stored row and reads "computed" (fallback, not an error)', async () => {
    f.sql.prepare(`INSERT INTO shift_sessions (shift_code, user_id, user_name, branch_id, branch_name, business_date, opened_at, closed_at,
        opening_float_usd, opening_float_khr, opening_float_usd_registered, opening_float_khr_registered, closing_counted_usd)
      VALUES ('S-OLD', 7, 'cashier', 1, 'Shop', '2026-09-01', '2026-09-01T01:00:00.000Z', '2026-09-01T09:00:00.000Z', 5, 0, 1, 1, 5)`).run()
    const oldId = f.sql.prepare("SELECT id FROM shift_sessions WHERE shift_code='S-OLD'").get().id
    const history = await f.call(shifts, `/${oldId}/history`)
    assert.equal(history.status, 200)
    assert.equal(history.body.shift.reconciliation_source, 'computed')
    assert.equal(history.body.shift.reconciliation.expected.usd, 5)
    assert.equal(history.body.shift.close_drift, null)
  })

  await check('parseShiftCloseFigures tolerates an older/partial row and refuses a foreign one', () => {
    const partial = reconciliation.parseShiftCloseFigures('{"v":1,"reconciliation":{"expected":{"usd":9,"khr":null}}}')
    assert.equal(partial.reconciliation.expected.usd, 9)
    assert.equal(partial.reconciliation.cash_sales.usd, 0, 'a field the row lacks reads as zero, never as undefined')
    assert.equal(partial.reconciliation.counted.usd, null, 'an unknown count stays unknown')
    assert.equal(partial.sales, null)
    assert.equal(reconciliation.parseShiftCloseFigures('{"v":2}'), null)
    assert.equal(reconciliation.parseShiftCloseFigures('not json'), null)
  })
}

;(async () => {
  await migrationChecks()
  await routeChecks()
  console.log(`OK ${passed} checks: a closed shift's figures are stored at close and later drift is shown, not absorbed (N4)`)
})().catch((error) => { console.error(error); process.exit(1) })
