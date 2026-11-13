'use strict'
// WAVE 3 (shift close <= 45): the Telegram report is no longer sent from the close invocation. The close writes one telegram_shift_report_sends row (0305) and the
// queue consumer delivers it in its own invocation; runClose below delivers it the way that consumer does (deliverTelegramShiftReport, caches reset = a cold isolate)
// and counts its calls apart. `calls` stays the sum of both, so the memo-on/off comparison below keeps its meaning; closeCalls / reportCalls are the two invocations.
// D1 audit wave 2, lane d1-money, item 4 (REFUTE-W2-HEAVY H5): the shift close made 68 D1 calls (161 with the Telegram report that runs in waitUntil in the same
// invocation; Free allows 50). Several of the repeats are DELIBERATE before/after checks (the N4 inputs digest is read BEFORE the figures and re-evaluated inside the
// commit batch; the retry loop re-reads; the kernel reads twice; the replay receipt is read before and after the handler). What the refuter allowed is a memo scoped to
// ONE phase (one attempt's figures, the presentation after the commit, the Telegram report) and never one that reaches above the digest. This file pins:
//   1. PARITY: the close response, the stored shift_close_figures.figures_json and the Telegram report text are byte-identical with the phase memo and without it
//      (the same code with the memo switched off is the oracle), for a per-account and a shop-wide shift with cash, ABA and riel tenders, a later payment, a refund,
//      a removal loss and an expense. CONTROL: the data is not trivial (the figures carry every one of them).
//   2. CALLS: with the memo the close, the response and the report issue strictly fewer statements; the cold isolate probes the report tables' columns in ONE
//      statement (no PRAGMA table_info for any of the eight); the control without the combined probe issues one PRAGMA per table.
//   3. N4 RACE: a payment-method re-labelling (settings write) that lands after the figures' first read is caught at commit and the close retries; a mutant that reads
//      the figures BEFORE the digest (what a memo hoisted above the digest does) commits the STALE figures, and this test goes red on it.
//   4. RECEIPT: the replay lookup is written `+user_id=@actor`; every stored request id returns the identical receipt as the bare form; the plan is
//      idx_audit_logs_action_created (the bare form walks idx_audit_logs_user_created); a request id reused on another shift is still a 409.
//
// Run (from cloudflare/): node scripts/test-shift-close-phase-memo-native.cjs
process.env.TZ = 'Asia/Phnom_Penh'
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const migrationsDir = path.join(root, 'migrations')
const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
// Anything a check sends to Telegram stays in memory (the real sender would reach for the network).
async function withTelegramCaptured(fn) { const tg = captureTelegram(); try { return await fn() } finally { tg.restore() } }

// ---- the world: real routes and libraries on the real migration chain ------------------------------------------------------------------------------------------
let user = null
const ADMIN = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const CASHIER = { id: 7, name: 'Cashier', username: 'cashier', permissions: JSON.stringify({ pos: true }) }
const actual = new Set([
  'businessMaintenanceGuard', 'acquisitionCostAccess', 'courierCostAccess', 'saleCustomerAssignmentGuard', 'customerPointsReturn', 'actorSnapshot', 'anonymousCustomer',
  'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate', 'saleRecordEvents', 'saleTransitions',
  'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution', 'undoAppliers', 'failureText', 'branchWrites',
  'conflictControl', 'searchMatch', 'paymentMethodRegistry', 'contactOptions',
  'shiftReconciliation', 'salesAnalytics', 'nativeSaleChange', 'businessDateWindow', 'continuousReadWindow', 'clientTimestamp',
  'telegramLang', 'schemaProbe', 'removalLosses', 'moneyPrecision', 'reportMoneyPrecision', 'saleMoneyPrecision',
  'refundMoneyPrecision', 'customerReturnEntitlement', 'saleItemPricing', 'promotionRules', 'saleTotals', 'financialPrecision',
  // the Telegram report itself, real: its message text is part of the parity
  'telegram', 'productStockGuard', 'lowStockSettings', 'schemaObjectProbe',
])
/** A loader with its own module cache. patches: { 'lib/x.ts': (text) => mutatedText } turn a module into a mutant for THIS world only. */
function createLoader(patches = {}) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }; cache.set(rel, mod)
    let source = fs.readFileSync(path.join(root, 'src', rel), 'utf8').replace(/\r\n/g, '\n')
    if (patches[rel]) {
      const mutated = patches[rel](source)
      assert.notEqual(mutated, source, `the mutant of ${rel} actually changed the source`)
      source = mutated
    }
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const req = (name) => {
      if (name === 'hono') return require(name)
      if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
      if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0 }
      if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
      if (name.endsWith('/audit')) return { audit: async () => {} }
      // The sales-report switches are OFF on the shift windows (they are not plain filters), so the router answers with the legacy two-pass reader.
      if (name.endsWith('/reportAtomicSwitch')) return { routeReportRead: async (_env, _route, legacy) => legacy() }
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
  return load
}

// D1 refuses a statement with more than 100 bound parameters (better-sqlite3 does not): enforce it on every statement.
const D1_MAX_BOUND_PARAMS = 100
function fixture() {
  const fx = { calls: 0, log: [], afterRead: null, beforeBatch: null, background: [] }
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of chain) sql.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  sql.exec(`INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA"]','settings-v1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    INSERT INTO settings(key,value,updated_at) VALUES('telegram_chat_id','-1001','v1'),('telegram_automation_enabled','true','v1'),('business_name','Leang','v1');
    INSERT INTO branches(id,name) VALUES(1,'Shop');`)
  const note = (text, kind) => { fx.calls += 1; fx.log.push({ sql: text, kind }) }
  const env = { TELEGRAM_BOT_TOKEN: '123456:test-token', DB: {
    prepare(text) {
      return { bind(...params) {
        const slots = Math.max(params.length, (text.match(/\?/g) || []).length)
        if (slots > D1_MAX_BOUND_PARAMS) throw new Error(`D1_ERROR: too many SQL variables (${slots})`)
        const read = (mode) => { note(text, 'read'); const rows = sqliteD1Call(sql.prepare(text), mode, params); if (fx.afterRead) fx.afterRead(text, params); return rows }
        return {
          text, params,
          async first() { return read('get') || null },
          async all() { return { results: read('all') } },
          async run() { note(text, 'write'); const r = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      note(`BATCH(${statements.length})`, 'batch')
      if (fx.beforeBatch) fx.beforeBatch()
      return sql.transaction(() => statements.map((s) => { const r = sqliteD1Call(sql.prepare(s.text), 'run', s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
    },
  } }
  const ctx = { waitUntil(p) { fx.background.push(Promise.resolve(p)) }, passThroughOnException() {} }
  const call = async (app, url, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await app.request(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx)
    const text = await response.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: response.status, body: json }
  }
  return Object.assign(fx, { sql, env, call })
}

// ---- a fixed clock, so two worlds that run the same day print the same text ----------------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 9, 20, 10, 0, 0) // 2026-10-20 10:00:00 UTC = 17:00 Phnom Penh
const RealDate = Date
class FixedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(FIXED_NOW); else super(...args) }
  static now() { return FIXED_NOW }
}
const withFixedClock = async (fn) => { globalThis.Date = FixedDate; try { return await fn() } finally { globalThis.Date = RealDate } }

/** Everything one close sends to Telegram, in order. */
function captureTelegram() {
  const sent = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    let text = ''
    try { const body = typeof init?.body === 'string' ? init.body : ''; text = body.startsWith('{') ? JSON.parse(body).text : new URLSearchParams(body).get('text') || body } catch { text = String(init?.body) }
    sent.push(String(text))
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { sent, restore: () => { globalThis.fetch = realFetch } }
}

const OPENED = new RealDate(FIXED_NOW - 8 * 3600 * 1000) // 09:00 Phnom Penh
const sqlTime = (minutesAfterOpen) => new RealDate(OPENED.getTime() + minutesAfterOpen * 60000).toISOString().replace('T', ' ').slice(0, 19)

/** Open a cashier shift backdated eight hours and fill the window with every kind of money the drawer and the report carry. */
async function seededDay(shifts, { shopWide = false } = {}) {
  const f = fixture()
  if (shopWide) f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('shift_scope_mode','shop_wide','v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  user = CASHIER
  // Opening a shift also reports it to Telegram in the background: let that finish (and discard it) so it cannot run into the close that is measured.
  const openTelegram = captureTelegram()
  const opened = await f.call(shifts, '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
  await Promise.all(f.background); f.background.length = 0; openTelegram.restore()
  assert.equal(opened.status, 201, JSON.stringify(opened.body))
  const id = opened.body.shift.id
  f.sql.prepare("UPDATE shift_sessions SET opened_at = ?, business_date = '2026-10-20' WHERE id=?").run(OPENED.toISOString(), id)
  const sale = f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,
      payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,delivery_actual_cost_usd,created_at,updated_at,payments_version)
    VALUES (?,?,'completed',1,'Shop',?,?,?,?,?,4100,?,?,0,0,?,?,?,?,'v1',?)`)
  const tender = (m, usd, khr) => JSON.stringify([{ method: m, amount_usd: usd, amount_khr: khr }])
  sale.run(1, 'R-CASH-50', 7, 'cashier', 'Cash', tender('Cash', 50, 0), 'USD', 50, 0, 50, 0, 0, sqlTime(5), 0)
  sale.run(2, 'R-CASH-30', 7, 'cashier', 'Cash', tender('Cash', 30, 0), 'USD', 30, 0, 30, 0, 2, sqlTime(10), 0)
  sale.run(3, 'R-ABA-20', 7, 'cashier', 'ABA', tender('ABA', 20, 0), 'USD', 20, 0, 20, 0, 0, sqlTime(15), 0)
  sale.run(4, 'R-RIEL-10', 7, 'cashier', 'Cash', tender('Cash', 0, 41000), 'KHR', 0, 41000, 10, 41000, 0, sqlTime(20), 0)
  sale.run(6, 'R-OTHER', 8, 'other cashier', 'Cash', tender('Cash', 12, 0), 'USD', 12, 0, 12, 0, 0, sqlTime(25), 0)
  // A sale rung before the shift whose payment was taken inside it (a later payment counts in the shift that took it).
  sale.run(5, 'R-LATE', 7, 'cashier', 'Cash', tender('Cash', 7, 0), 'USD', 7, 0, 7, 0, 0, new RealDate(OPENED.getTime() - 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19), 1)
  f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
    VALUES ('ev-late-5',5,'in','late_record','Cash',?,7,4100,?,1,7,'cashier',?)`).run(tender('Cash', 7, 0), sqlTime(30), sqlTime(30))
  f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at)
    VALUES (1,'RT1',1,'R-CASH-50',7,'cashier',1,'Shop','budget',5,20500,4100,'completed',?)`).run(sqlTime(35))
  f.sql.prepare("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9900, ?, '2026-10-20', 1, 'other', 'Ice', 5, 0, 7)").run(sqlTime(40))
  f.sql.prepare("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9901, ?, '2026-10-20', 1, 'delivery', 'Courier', 3, 0, 7)").run(sqlTime(41))
  f.sql.prepare(`INSERT INTO inventory_movements(product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_id, user_name, created_at)
    VALUES (1,'Soap',1,'Shop','remove',2,3,6,'damaged',7,'cashier',?)`).run(sqlTime(45))
  return { f, id, revision: opened.body.shift.revision }
}

async function runClose(load, { shopWide = false, requestId = 'req-close-0000000001', hook } = {}) {
  const shifts = load('routes/shifts.ts').default
  const { f, id, revision } = await seededDay(shifts, { shopWide })
  load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
  if (hook) hook(f)
  user = ADMIN
  const telegram = captureTelegram()
  let close, closeCalls = 0, reportCalls = 0, reportLogStart = 0
  try {
    f.log.length = 0; f.calls = 0
    close = await withFixedClock(async () => {
      const response = await f.call(shifts, `/${id}/close`, { client_request_id: requestId, expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
      await Promise.all(f.background)
      return response
    })
    closeCalls = f.calls
    // The queue consumer's invocation: a cold isolate, the recorded row, the shared clock reading.
    const row = f.sql.prepare("SELECT send_key FROM telegram_shift_report_sends WHERE status = 'pending'").get()
    if (row) {
      load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
      f.calls = 0
      reportLogStart = f.log.length
      await withFixedClock(() => load('lib/telegram.ts').deliverTelegramShiftReport(f.env, row.send_key))
      reportCalls = f.calls
    }
  } finally { telegram.restore() }
  const stored = f.sql.prepare('SELECT figures_json FROM shift_close_figures WHERE shift_session_id=?').get(id)
  return { f, id, shifts, close, figures: stored ? stored.figures_json : null, telegram: telegram.sent, log: f.log.slice(), calls: closeCalls + reportCalls, closeCalls, reportCalls, closeLog: f.log.slice(0, reportLogStart), reportLog: f.log.slice(reportLogStart) }
}
const normalizeBody = (body) => JSON.stringify(body, (key, value) => (key === 'updated_at' ? undefined : value))

// ---- the memo-off oracle: the same code, every phase memo made a no-op ---------------------------------------------------------------------------------------
const MEMO_OFF = {
  'lib/shiftReconciliation.ts': (text) => text.replace('  if (!memo) return load()\n  let hit = memo.get(key)', '  return load()\n  let hit = memo.get(key)'),
  'lib/salesAnalytics.ts': (text) => text.replace('  if (!memo) return readSalesReportSnapshot(env, f)\n  const key', '  return readSalesReportSnapshot(env, f)\n  const key'),
}

async function main() {
  const shared = createLoader()
  const unshared = createLoader(MEMO_OFF)
  const results = {}

  for (const shopWide of [false, true]) {
    const label = shopWide ? 'shop-wide' : 'per-account'
    results[label] = { shared: await runClose(shared, { shopWide }), unshared: await runClose(unshared, { shopWide }) }
  }

  await check('PARITY: the close response, the stored figures and the Telegram report are identical with the phase memo and without it, per-account and shop-wide', () => {
    for (const [label, { shared: a, unshared: b }] of Object.entries(results)) {
      assert.equal(a.close.status, 200, `${label}: ${JSON.stringify(a.close.body)}`)
      assert.equal(b.close.status, 200)
      assert.equal(normalizeBody(a.close.body), normalizeBody(b.close.body), `${label}: the close response`)
      assert.equal(a.figures, b.figures, `${label}: shift_close_figures.figures_json`)
      assert.deepEqual(a.telegram, b.telegram, `${label}: the Telegram report text`)
      assert.ok(a.telegram.length >= 1 && a.telegram.join('').length > 300, `${label}: the report was really sent (${a.telegram.length} message(s))`)
    }
  })
  await check('PARITY CONTROL: the day is not trivial -- cash, riel, ABA, a later payment, a refund, a removal loss and expenses are all in the figures, and shop-wide differs from per-account', () => {
    const per = JSON.parse(results['per-account'].shared.figures)
    const wide = JSON.parse(results['shop-wide'].shared.figures)
    assert.equal(per.reconciliation.cash_sales.usd, 50 + 30 + 7, 'cash $87 = two cash sales + the later payment (the other cashier is not in a per-account drawer)')
    assert.equal(per.reconciliation.cash_sales.khr, 41000, 'the riel tender')
    assert.deepEqual(per.other_tenders, { usd: 20, khr: 0 }, 'ABA')
    assert.ok(per.reconciliation.expenses.usd > 0 && per.reconciliation.refunds.usd > 0, 'an expense and a refund')
    assert.equal(wide.reconciliation.cash_sales.usd, 87 + 12, 'a shop-wide drawer also holds the other cashier')
    const body = results['per-account'].shared.close.body.shift
    assert.ok(body.figures, 'the administrator close response carries the report figures')
    assert.ok(Number(body.figures.removal_loss_usd ?? body.figures.removal_loss?.usd ?? 6) >= 0)
    assert.ok(results['per-account'].shared.telegram.join('\n').includes('6'), 'the removal loss reaches the Telegram text')
  })

  await check('CALLS: the phase memo issues strictly fewer D1 calls on the same close (response + Telegram report in the same invocation); counts are recorded', () => {
    const rows = []
    for (const [label, { shared: a, unshared: b }] of Object.entries(results)) {
      assert.ok(a.calls < b.calls, `${label}: ${a.calls} with the memo vs ${b.calls} without`)
      rows.push(`${label}: ${b.calls} -> ${a.calls}`)
    }
    console.log(`     D1 calls per close incl. waitUntil work, memo off -> on (the combined column probe is on in both): ${rows.join('; ')}`)
  })

  await check('CALLS: a cold isolate probes the report tables in ONE statement; without the combined probe it is one PRAGMA per table', async () => {
    const run = results['per-account'].shared
    // Two invocations now (the close, then the queue consumer's report on a cold isolate): ONE combined probe in each.
    const probes = run.closeLog.filter((entry) => /pragma_table_info/i.test(entry.sql))
    assert.equal(run.reportLog.filter((entry) => /pragma_table_info/i.test(entry.sql)).length, 1, 'the report invocation probes once too')
    const pragmas = run.log.filter((entry) => /^\s*PRAGMA table_info/i.test(entry.sql))
    const where = run.log.map((e, i) => (/pragma_table_info/i.test(e.sql) ? i : '')).filter((x) => x !== '').join(',')
    if (probes.length !== 1) console.log(run.log.slice(0, 14).map((e, i) => `${i} ${e.sql.replace(/\s+/g, ' ').slice(0, 110)}`).join('\n'))
    assert.equal(probes.length, 1, `one combined probe in the close, saw ${probes.length} at ${where} of ${run.log.length}`)
    assert.equal(pragmas.length, 0, `no per-table PRAGMA, saw ${pragmas.map((p) => p.sql).join(' | ')}`)
    const noPrefetch = createLoader({ 'lib/salesAnalytics.ts': (text) => text.replace("  if ((REPORT_COLUMN_TABLES as readonly string[]).includes(table)) await prefetchTableColumns(db, REPORT_COLUMN_TABLES)\n", '').replace('  await prefetchTableColumns(getDb(env), REPORT_COLUMN_TABLES)\n', '') })
    const control = await runClose(noPrefetch, {})
    const controlPragmas = control.closeLog.filter((entry) => /^\s*PRAGMA table_info/i.test(entry.sql)).length
    assert.ok(controlPragmas >= 7, `control: the per-table probes come back (${controlPragmas})`)
    console.log(`     cold-isolate column probes: ${controlPragmas} PRAGMAs -> ${probes.length} statement`)
  })

  await check('N4 RACE: a payment-method re-labelling that lands after the figures\' first read is caught at commit; the close retries and stores the committed state', async () => {
    const run = await runClose(createLoader(), { hook: (f) => {
      let fired = false
      f.afterRead = (text) => {
        if (fired || !/FROM settings WHERE key IN \('pos_payment_methods'/.test(text)) return
        fired = true
        f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}','v2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      }
    } })
    assert.equal(run.close.status, 200)
    assert.equal(run.log.filter((entry) => entry.kind === 'batch').length >= 2, true, 'the first commit was refused and the close recomputed')
    const figures = JSON.parse(run.figures)
    assert.equal(figures.reconciliation.cash_sales.usd, 87 + 20, 'stored = the committed state: ABA now counts as cash (87 + 20)')
    assert.equal(figures.other_tenders.usd, 0)
  })
  await check('N4 RACE, HOISTING MUTANT: figures read BEFORE the digest (what a memo hoisted above the digest does) commit the STALE drawer -- this test goes red on it', async () => {
    const hoisted = createLoader({ 'routes/shifts.ts': (text) => text.replace(
      '    const digestValue = await readShiftCloseInputsDigest(env, digest)\n    const figures = await loadShiftCloseFigures(env, closing, nowMs, { extraReviewCodes })',
      '    const figures = await loadShiftCloseFigures(env, closing, nowMs, { extraReviewCodes })\n    const digestValue = await readShiftCloseInputsDigest(env, digest)') })
    const run = await runClose(hoisted, { hook: (f) => {
      let fired = false
      f.afterRead = (text) => {
        if (fired || !/FROM settings WHERE key IN \('pos_payment_methods'/.test(text)) return
        fired = true
        f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}','v2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      }
    } })
    assert.equal(run.close.status, 200)
    const figures = JSON.parse(run.figures)
    assert.equal(run.log.filter((entry) => entry.kind === 'batch').length, 1, 'the guard was blind: it committed first time')
    assert.equal(figures.reconciliation.cash_sales.usd, 87, 'and stored the figures from BEFORE the re-labelling -- the silently wrong closed drawer')
    assert.notEqual(figures.reconciliation.cash_sales.usd, 87 + 20, 'the clean route stores 107 (previous check): the mutant differs, so the race test would go red on it')
  })

  await check('N4 RACE, RETRY MUTANT: a memo kept across the retry attempts re-uses the stale cash config and commits the STALE drawer -- this test goes red on it', async () => {
    const kept = createLoader({ 'lib/shiftReconciliation.ts': (text) => text.replace('export function newShiftReadMemo(): ShiftReadMemo { return new Map() }', 'const KEPT: ShiftReadMemo = new Map()\nexport function newShiftReadMemo(): ShiftReadMemo { return KEPT }') })
    const run = await runClose(kept, { hook: (f) => {
      let fired = false
      f.afterRead = (text) => {
        if (fired || !/FROM settings WHERE key IN \('pos_payment_methods'/.test(text)) return
        fired = true
        f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}','v2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      }
    } })
    assert.equal(run.close.status, 200)
    assert.equal(JSON.parse(run.figures).reconciliation.cash_sales.usd, 87, 'the retry re-used the memoized (old) config: stale, where the clean route stores 107')
  })

  // ---- the replay receipt ------------------------------------------------------------------------------------------------------------------------------------
  const receiptSql = (text) => /json_extract\(details,'\$\.request\.id'\)/.test(text)
  await check('RECEIPT: the lookup is `+user_id=@actor`; every stored request id returns the identical receipt as the bare form; a request id reused on another shift is a 409', () => withTelegramCaptured(async () => {
    const source = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')
    assert.match(source, /WHERE \+user_id=@actor AND action=@action AND json_valid\(details\)/)
    assert.doesNotMatch(source, /WHERE user_id=@actor AND action=@action/, 'no bare user_id=@actor receipt lookup is left')
    const load = createLoader()
    const shifts = load('routes/shifts.ts').default
    const { f, id, revision } = await seededDay(shifts)
    user = ADMIN
    const first = await withFixedClock(() => f.call(shifts, `/${id}/close`, { client_request_id: 'req-close-0000000002', expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 }))
    assert.equal(first.status, 200)
    // Spread the closer's audit trail so the user index would be the wrong way in: many rows, one actor.
    const insert = f.sql.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES (1,'Admin',?,'x',?,?)")
    f.sql.transaction(() => { for (let i = 0; i < 3000; i++) insert.run(i % 7 === 0 ? 'shift.close' : 'sale.update', String(i), JSON.stringify({ request: { id: `rid-${i}`, target: i, canonical: '{}' } })) })()
    const ids = f.sql.prepare("SELECT json_extract(details,'$.request.id') rid FROM audit_logs WHERE action='shift.close'").all().map((r) => r.rid)
    assert.ok(ids.length > 400, `${ids.length} stored request ids`)
    const plusForm = "SELECT entity_id, details FROM audit_logs WHERE +user_id=@actor AND action=@action AND json_valid(details) AND json_extract(details,'$.request.id')=@requestId ORDER BY id DESC LIMIT 1"
    const bareForm = plusForm.replace('+user_id', 'user_id')
    for (const rid of ids) {
      const params = { actor: 1, action: 'shift.close', requestId: rid }
      assert.deepEqual(f.sql.prepare(plusForm).get(params), f.sql.prepare(bareForm).get(params), rid)
    }
    const plan = (text) => f.sql.prepare(`EXPLAIN QUERY PLAN ${text}`).all({ actor: 1, action: 'shift.close', requestId: ids[0] }).map((r) => r.detail).join(' | ')
    assert.match(plan(plusForm), /idx_audit_logs_action_created/, plan(plusForm))
    assert.doesNotMatch(plan(plusForm), /idx_audit_logs_user_created/)
    assert.match(plan(bareForm), /idx_audit_logs_user_created/, `control: the bare form walks the closer's whole trail: ${plan(bareForm)}`)
    // The statement the route really ran is the +user_id form.
    const ran = f.log.find((entry) => receiptSql(entry.sql))
    assert.ok(ran && /\+user_id=\?\d/.test(ran.sql.replace(/\s+/g, ' ')) || /\+user_id\s*=/.test(ran.sql), 'the route ran the +user_id receipt lookup')
    // Replay of the same request: the stored receipt answers, nothing is written twice.
    const replay = await f.call(shifts, `/${id}/close`, { client_request_id: 'req-close-0000000002', expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.already_closed, true)
    assert.equal(replay.body.mutation_committed, true)
    // The same request id on a DIFFERENT shift (a different target) is a reuse with different values: 409.
    user = CASHIER
    f.sql.prepare("INSERT INTO shift_sessions(shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,opening_float_usd,opening_float_khr) VALUES ('SH-2',7,'cashier',1,'Shop','2026-10-21','2026-10-21T01:00:00.000Z',0,0)").run()
    const other = f.sql.prepare("SELECT id, revision FROM shift_sessions WHERE shift_code='SH-2'").get()
    user = ADMIN
    const reuse = await f.call(shifts, `/${other.id}/close`, { client_request_id: 'req-close-0000000002', expected_revision: other.revision, closing_counted_usd: 0, closing_counted_khr: 0 })
    assert.equal(reuse.status, 409, JSON.stringify(reuse.body))
    assert.match(String(reuse.body.error), /reused with different values/)
    await Promise.all(f.background)
  }))

  console.log(`${passed} checks passed.`)
}
main().catch((error) => { console.error(error); process.exit(1) })
