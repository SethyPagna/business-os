'use strict'
// Wave 3, slice B (M9 of REVIEW-d1-money-2): a shift close must fit Cloudflare Free's 50 D1 calls per invocation, with margin (the ceiling is 45).
//
// Two invocations now, measured apart on the REAL routes and libraries over the real migration chain:
//   * the CLOSE (POST /api/shifts/:id/close, everything that runs in that invocation incl. waitUntil work), and
//   * the REPORT (the queue consumer's invocation: deliverTelegramShiftReport on a cold isolate -- caches reset).
// Both run with a D1 that REFUSES call 51 exactly as Cloudflare does, so a close that overflows fails here the way it fails on Free (null figures, a lost report).
//
// What this file pins:
//   1. CEILING: close <= 45 and report <= 45 calls, in every scenario (per-account, shop-wide, a rich day with later payments / refunds / expenses / removals,
//      overnight 20 h and 50 h, Telegram on and off). The numbers are printed.
//   2. ORACLE = THE BASE COMMIT (M10): the close response, the stored figures_json and the Telegram text are byte-identical to what the commit before this lane
//      (BASE_REF, the B7 release) produces for the same data -- not to HEAD with a memo switched off.
//   3. REQUIRED RED: the base commit's close (with its inline report) is over the ceiling and over Free's 50, so this file goes red on it.
//   4. EXACTLY ONE report per close revision: a retried close, concurrent closes [200, 409] and a queue redelivery all leave one row and one message.
//
// Run (from cloudflare/): node scripts/test-shift-close-call-ceiling-native.cjs
const { execFileSync } = require('node:child_process')
const BASE_REF = '09e0d8123'
const CEILING = 45
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
function createLoader(patches = {}, ref = null) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }; cache.set(rel, mod)
    let source = (ref ? execFileSync('git', ['show', `${ref}:cloudflare/src/${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : fs.readFileSync(path.join(root, 'src', rel), 'utf8')).replace(/\r\n/g, '\n')
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
  const note = (text, kind) => { fx.calls += 1; fx.log.push({ sql: text, kind }); if (fx.refuseAfter && fx.calls > fx.refuseAfter) throw new Error('D1_ERROR: Too many API requests by single Worker invocation.') }
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

let OPENED = new RealDate(FIXED_NOW - 8 * 3600 * 1000) // 09:00 Phnom Penh
const sqlTime = (minutesAfterOpen) => new RealDate(OPENED.getTime() + minutesAfterOpen * 60000).toISOString().replace('T', ' ').slice(0, 19)

/** Open a cashier shift backdated eight hours and fill the window with every kind of money the drawer and the report carry. */
async function seededDay(shifts, { shopWide = false, hours = 8, telegramOn = true } = {}) {
  OPENED = new RealDate(FIXED_NOW - hours * 3600 * 1000)
  const f = fixture()
  if (!telegramOn) f.sql.prepare("UPDATE settings SET value = 'false' WHERE key = 'telegram_automation_enabled'").run()
  if (shopWide) f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('shift_scope_mode','shop_wide','v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  user = CASHIER
  // Opening a shift also reports it to Telegram in the background: let that finish (and discard it) so it cannot run into the close that is measured.
  const openTelegram = captureTelegram()
  const opened = await f.call(shifts, '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
  await Promise.all(f.background); f.background.length = 0; openTelegram.restore()
  assert.equal(opened.status, 201, JSON.stringify(opened.body))
  const id = opened.body.shift.id
  f.sql.prepare("UPDATE shift_sessions SET opened_at = ?, business_date = ? WHERE id=?").run(OPENED.toISOString(), new RealDate(OPENED.getTime() + 7 * 3600e3).toISOString().slice(0, 10), id)
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

async function runClose(load, { shopWide = false, requestId = 'req-close-0000000001', hook, hours = 8, telegramOn = true, refuse = 0, afterClose } = {}) {
  const shifts = load('routes/shifts.ts').default
  const { f, id, revision } = await seededDay(shifts, { shopWide, hours, telegramOn })
  load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
  if (hook) hook(f)
  user = ADMIN
  const telegram = captureTelegram()
  let close, closeCalls = 0, reportCalls = 0, reportLogStart = 0
  try {
    f.log.length = 0; f.calls = 0; f.refuseAfter = refuse
    close = await withFixedClock(async () => {
      const response = await f.call(shifts, `/${id}/close`, { client_request_id: requestId, expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
      await Promise.all(f.background)
      return response
    })
    closeCalls = f.calls
    // A write that lands between the close and the queue's delivery (seconds on the queue, minutes on the cron): the report must still say what the close said.
    if (afterClose) { await withFixedClock(async () => { await afterClose(f, shifts, id); await Promise.all(f.background); f.background.length = 0 }); f.sql.exec("UPDATE telegram_shift_report_sends SET status = 'skipped' WHERE send_key NOT LIKE '%:close'") }
    // The queue consumer's invocation: a cold isolate, the recorded row, the shared clock reading.
    const row = f.sql.prepare("SELECT send_key FROM telegram_shift_report_sends WHERE status = 'pending' AND send_key LIKE '%:close'").get()
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

// ---- scenarios: each one seeds more of the day's money before the close --------------------------------------------------------------------------------------
const isoZ = (minutesAfterOpen) => new RealDate(OPENED.getTime() + minutesAfterOpen * 60000).toISOString()
const insertMovement = (f, createdAt) => f.sql.prepare(`INSERT INTO inventory_movements(product_id, product_name, branch_id, branch_name, movement_type, quantity, unit_cost_usd, total_cost_usd, reason, user_id, user_name, created_at)
  VALUES (1,'Soap',1,'Shop','remove',1,2,2,'damaged',7,'cashier',?)`).run(createdAt)
const SCENARIOS = [
  { name: 'per-account, rich day' },
  { name: 'shop-wide, rich day', shopWide: true },
  { name: 'overnight 20 h', hours: 20 },
  { name: 'overnight 50 h', hours: 50 },
  { name: 'Telegram off', telegramOn: false },
  { name: 'a cancelled sale', hook: (f) => f.sql.prepare("UPDATE sales SET sale_status = 'cancelled' WHERE id = 3").run() },
  { name: 'Not Paid sale with riel, paid later inside the shift', hook: (f) => {
    f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,created_at,updated_at,payments_version)
      VALUES (20,'R-NOTPAID',?,1,'Shop',7,'cashier','Cash','[]','KHR',4100,0,0,0,0,10,41000,?,'v1',1)`).run('awaiting_payment', sqlTime(12))
    f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-np-20',20,'in','late_record','Cash',?,0,4100,?,1,7,'cashier',?)`).run(JSON.stringify([{ method: 'Cash', amount_usd: 0, amount_khr: 20500 }]), sqlTime(50), sqlTime(50))
  } },
  { name: 'a later payment landing after the shift closed', hook: (f) => {
    f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-after-3',3,'in','late_record','ABA',?,5,4100,?,1,7,'cashier',?)`).run(JSON.stringify([{ method: 'ABA', amount_usd: 5, amount_khr: 0 }]), new RealDate(FIXED_NOW + 3600e3).toISOString(), new RealDate(FIXED_NOW + 3600e3).toISOString())
  } },
  { name: 'riel refund and riel expense', hook: (f) => {
    f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at)
      VALUES (2,'RT2',2,'R-CASH-30',7,'cashier',1,'Shop','riel',0,8200,4100,'completed',?)`).run(sqlTime(36))
    f.sql.prepare("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9902, ?, '2026-10-20', 1, 'other', 'Riel snack', 0, 12300, 7)").run(sqlTime(42))
  } },
  { name: 'removals in four timestamp formats', hook: (f) => {
    insertMovement(f, isoZ(50)); insertMovement(f, sqlTime(51)); insertMovement(f, isoZ(52).replace('Z', '+07:00')); insertMovement(f, sqlTime(53).slice(0, 10))
  } },
  { name: 'R1 riel cash rounded to 100 (sale, change, refund rounded down, riel expense)', hook: (f) => {
    f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,created_at,updated_at,payments_version)
      VALUES (30,'R-RIEL-RND','completed',1,'Shop',7,'cashier','Cash',?,'KHR',4100,0,50000,0,7500,10.37,42500,?,'v1',0)`).run(JSON.stringify([{ method: 'Cash', amount_usd: 0, amount_khr: 50000 }]), sqlTime(21))
    f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at,refund_currency)
      VALUES (3,'RT3',30,'R-RIEL-RND',7,'cashier',1,'Shop','riel',1.99,8100,4100,'completed',?,'KHR')`).run(sqlTime(37))
    f.sql.prepare("INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9903, ?, '2026-10-20', 1, 'other', 'Riel', 0, 4100, 7)").run(sqlTime(43))
  } },
  { name: 'R2 exchange with riel refund (return + replacement sale)', hook: (f) => {
    f.sql.prepare(`INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,reason,total_refund_usd,total_refund_khr,exchange_rate,status,created_at,refund_currency)
      VALUES (4,'RT4',2,'R-CASH-30',7,'cashier',1,'Shop','exchange',0,4100,4100,'completed',?,'KHR')`).run(sqlTime(38))
    f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,created_at,updated_at,payments_version,source_return_id)
      VALUES (31,'R-EXCH','completed',1,'Shop',7,'cashier','Cash',?,'USD',4100,4,0,0,0,4,0,?,'v1',0,4)`).run(JSON.stringify([{ method: 'Cash', amount_usd: 4, amount_khr: 0 }]), sqlTime(39))
  } },
  { name: 'R3 later payments taken in ANOTHER shift (other cashier in-window; before open)', hook: (f) => {
    f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-other-1',1,'in','late_record','Cash',?,3,4100,?,1,8,'other cashier',?)`).run(JSON.stringify([{ method: 'Cash', amount_usd: 3, amount_khr: 0 }]), sqlTime(55), sqlTime(55))
    const before = new RealDate(OPENED.getTime() - 3600e3).toISOString().replace('T', ' ').slice(0, 19)
    f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-prev-2',2,'in','late_record','ABA',?,2,4100,?,1,7,'cashier',?)`).run(JSON.stringify([{ method: 'ABA', amount_usd: 2, amount_khr: 0 }]), before, before)
  } },
  { name: 'R3b same, shop-wide', shopWide: true, hook: (f) => {
    f.sql.prepare(`INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-other-1',1,'in','late_record','Cash',?,3,4100,?,1,8,'other cashier',?)`).run(JSON.stringify([{ method: 'Cash', amount_usd: 3, amount_khr: 0 }]), sqlTime(55), sqlTime(55))
  } },
  { name: 'R4 a sale in the window cancelled after the close, before the queue delivers', drawerOnly: true, afterClose: async (f) => {
    f.sql.prepare("UPDATE sales SET sale_status = 'cancelled' WHERE id = 2").run()
  } },
  { name: 'R5 the shift amended (recount) seconds after the close, before the queue delivers', afterClose: async (f, shifts, id) => {
    const rev = f.sql.prepare('SELECT revision FROM shift_sessions WHERE id = ?').get(id).revision
    const r = await f.call(shifts, '/' + id, { reason: 'recount', expected_revision: rev, closing_counted_usd: 99 }, 'PATCH')
    if (r.status !== 200) throw new Error('amend ' + JSON.stringify(r.body))
  } },
]


// ---- the other reporters: amend, reopen, cancel (and the open), and the one-send rules ---------------------------------------------------------------------------
/** Drive one step as the queue consumer would: run it, let its waitUntil work finish, then deliver every recorded report (twice: a redelivery), collecting what reached Telegram. */
async function step(load, f, telegram, run) {
  const before = telegram.sent.length
  const result = await withFixedClock(async () => { const out = await run(); await Promise.all(f.background); f.background.length = 0; return out })
  const telegramModule = load('lib/telegram.ts')
  const rows = typeof telegramModule.deliverTelegramShiftReport === 'function' ? f.sql.prepare("SELECT send_key FROM telegram_shift_report_sends WHERE status = 'pending'").all() : []
  for (const row of rows) {
    await withFixedClock(() => telegramModule.deliverTelegramShiftReport(f.env, row.send_key))
    await withFixedClock(() => telegramModule.deliverTelegramShiftReport(f.env, row.send_key))
  }
  return { result, sent: telegram.sent.slice(before), keys: rows.map((row) => row.send_key) }
}
async function lifecycle(load) {
  const shifts = load('routes/shifts.ts').default
  const { f, id } = await seededDay(shifts, {})
  f.sql.exec("UPDATE telegram_shift_report_sends SET status = 'skipped'") // the open's report is not this lifecycle's
  user = ADMIN
  const telegram = captureTelegram()
  const out = {}
  try {
    const rev = () => f.sql.prepare('SELECT revision FROM shift_sessions WHERE id = ?').get(id).revision
    out.close = await step(load, f, telegram, () => f.call(shifts, `/${id}/close`, { client_request_id: 'req-life-close-000001', expected_revision: rev(), closing_counted_usd: 100, closing_counted_khr: 41000 }))
    out.amend = await step(load, f, telegram, () => f.call(shifts, `/${id}`, { reason: 'recount', expected_revision: rev(), closing_counted_usd: 99 }, 'PATCH'))
    out.reopen = await step(load, f, telegram, () => f.call(shifts, `/${id}/reopen`, { reason: 'forgot a sale', expected_revision: rev() }))
    const child = f.sql.prepare('SELECT id, revision FROM shift_sessions WHERE parent_shift_id = ?').get(id)
    out.cancel = child ? await step(load, f, telegram, () => f.call(shifts, `/${child.id}/cancel`, { reason: 'wrong drawer', expected_revision: child.revision })) : null
    out.rowsTotal = typeof load('lib/telegram.ts').deliverTelegramShiftReport === 'function' ? f.sql.prepare('SELECT COUNT(*) n FROM telegram_shift_report_sends').get().n : null
  } finally { telegram.restore() }
  return out
}
/** GET /api/shifts/:id/history of a closed, amended and reopened record (an administrator, a cold isolate): its body and the statements it ran. */
async function historyOf(load) {
  const shifts = load('routes/shifts.ts').default
  const { f, id, revision } = await seededDay(shifts, {})
  f.sql.exec("UPDATE telegram_shift_report_sends SET status = 'skipped'")
  user = ADMIN
  const telegram = captureTelegram()
  try {
    await withFixedClock(async () => {
      await f.call(shifts, `/${id}/close`, { client_request_id: 'req-hist-close-000001', expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
      await Promise.all(f.background); f.background.length = 0
      const current = f.sql.prepare('SELECT revision FROM shift_sessions WHERE id = ?').get(id).revision
      await f.call(shifts, `/${id}`, { reason: 'recount', expected_revision: current, closing_counted_usd: 99 }, 'PATCH')
      await Promise.all(f.background); f.background.length = 0
    })
    load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
    f.log.length = 0; f.calls = 0
    const answer = await withFixedClock(async () => { const out = await f.call(shifts, `/${id}/history`); await Promise.all(f.background); return out })
    return { answer, calls: f.calls, log: f.log.slice() }
  } finally { telegram.restore() }
}

/** Two closes of one shift: an exact retry, and two different requests racing. Every recorded report is delivered twice. */
async function closePair(load, mode) {
  const shifts = load('routes/shifts.ts').default
  const { f, id, revision } = await seededDay(shifts, {})
  f.sql.exec("UPDATE telegram_shift_report_sends SET status = 'skipped'")
  user = ADMIN
  const telegram = captureTelegram()
  try {
    const body = (rid) => ({ client_request_id: rid, expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
    const answers = await step(load, f, telegram, async () => (mode === 'retry'
      ? [await f.call(shifts, `/${id}/close`, body('req-pair-000000000001')), await f.call(shifts, `/${id}/close`, body('req-pair-000000000001'))]
      : Promise.all([f.call(shifts, `/${id}/close`, body('req-pair-000000000001')), f.call(shifts, `/${id}/close`, body('req-pair-000000000002'))])))
    return { statuses: answers.result.map((answer) => answer.status), sent: answers.sent, keys: answers.keys }
  } finally { telegram.restore() }
}

// The shift code carries the wall-clock minute the shift was opened in (the open runs outside the fixed clock): two worlds a minute apart still print the same text once it is scrubbed.
const scrub = (text) => text.replace(/S-\d{8}-\d{4}-/g, 'S-DATE-')
const normalizeBody = (body) => scrub(JSON.stringify(body, (key, value) => (key === 'updated_at' ? undefined : value)))
const texts = (run) => scrub(JSON.stringify(run.telegram))
async function main() {
  const base = createLoader({}, BASE_REF)
  const head = createLoader()
  const runs = []
  for (const scenario of SCENARIOS) {
    const options = { shopWide: scenario.shopWide, hours: scenario.hours, telegramOn: scenario.telegramOn, hook: scenario.hook, afterClose: scenario.afterClose }
    const requestId = 'req-close-0000000001'
    const oldRun = await runClose(base, { ...options, requestId })
    const newRun = await runClose(head, { ...options, requestId, refuse: 50 })
    runs.push({ scenario, oldRun, newRun })
  }
  const table = runs.map(({ scenario, oldRun, newRun }) => `${scenario.name}: base ${oldRun.calls} (close+waitUntil) -> close ${newRun.closeCalls} / queued report ${newRun.reportCalls}`)
  console.log(`     D1 calls (cold, call_counting ON, no call refused here; the refusal runs are below):\n       ${table.join('\n       ')}`)
  // TRACE=<scenario index> prints every statement of that scenario's close and of its queued report (what the next saving has to remove).
  if (process.env.TRACE != null) {
    const shown = runs[Number(process.env.TRACE) || 0].newRun
    const line = (entry, index) => `${index} [${entry.kind}] ${entry.sql.replace(/\s+/g, ' ').slice(0, 150)}`
    console.log(`${shown.closeLog.map(line).join('\n')}\n---- the queued report\n${shown.reportLog.map(line).join('\n')}`)
  }

  await check('ORACLE (the base commit): the close response, the stored figures and the Telegram text are byte-identical in every scenario', () => {
    for (const { scenario, oldRun, newRun } of runs) {
      assert.equal(oldRun.close.status, 200, `${scenario.name}: base ${JSON.stringify(oldRun.close.body)}`)
      assert.equal(newRun.close.status, 200, `${scenario.name}: ${JSON.stringify(newRun.close.body)}`)
      assert.equal(normalizeBody(newRun.close.body), normalizeBody(oldRun.close.body), `${scenario.name}: the close response`)
      assert.equal(newRun.figures, oldRun.figures, `${scenario.name}: shift_close_figures.figures_json`)
      if (scenario.drawerOnly) continue // the sales-side lines of a write that lands after the close are checked below
      // The base sent the close message AND (where the scenario amends) the amend message inline; the queued path sends the close message, the amend is retired by the harness.
      if (scenario.afterClose) assert.equal(scrub(newRun.telegram[0]), scrub(oldRun.telegram[0]), `${scenario.name}: the CLOSE message`)
      else assert.equal(texts(newRun), texts(oldRun), `${scenario.name}: the Telegram report text`)
      assert.equal(newRun.telegram.length > 0, scenario.telegramOn !== false, `${scenario.name}: the report was sent exactly when Telegram is on`)
    }
  })
  await check('AS OF THE CLOSE (REVIEW-w3-shift F3): a recount amended before the queue delivers does not change what the close message says it closed on ($100, as the base printed)', () => {
    const r5 = runs.find(({ scenario }) => scenario.name.startsWith('R5'))
    assert.match(r5.oldRun.telegram[0], /Closing cash[^\n]*\$100\.00/, 'the base printed the counted $100')
    assert.doesNotMatch(r5.oldRun.telegram[0], /\$99\.00/)
    assert.match(r5.newRun.telegram[0], /Closing cash[^\n]*\$100\.00/, 'the queued close message prints the counted $100')
    assert.doesNotMatch(r5.newRun.telegram[0], /\$99\.00/, 'and not the amended $99')
    const payload = JSON.parse(r5.newRun.f.sql.prepare("SELECT payload_json FROM telegram_shift_report_sends WHERE send_key LIKE '%:close'").get().payload_json)
    assert.equal(payload.shift.closing_counted_usd, 100, 'the shift row as the close read it back rides in the payload')
    assert.ok(payload.shift.closed_at, 'with its closed_at')
  })
  await check('AS OF THE CLOSE: a sale cancelled after the close leaves the drawer block (Cash count, Expenses, Delivery) as the base printed it; only the sales-kernel sections (Invoices, Sales, Payment methods) read the later state', () => {
    const r4 = runs.find(({ scenario }) => scenario.name.startsWith('R4'))
    const sections = (text) => { const out = {}; let section = ''; for (const line of scrub(text).split('\n')) { if (/^=+[^=]+=+$/.test(line.trim())) { section = line.replace(/=/g, '').trim(); out[section] = [] } else (out[section] ||= []).push(line) } return out }
    const [was, now] = [sections(r4.oldRun.telegram[0]), sections(r4.newRun.telegram[0])]
    const drift = Object.keys({ ...was, ...now }).filter((name) => JSON.stringify(was[name]) !== JSON.stringify(now[name]))
    assert.ok(drift.length > 0, 'CONTROL: the later cancel is visible somewhere (the sales side is not frozen)')
    for (const name of drift) assert.match(name, /^(Invoices|Sales|Payment methods|Delivery)/, `the drawer section "${name}" differs from what the base printed at the close`)
    for (const name of Object.keys(was).filter((n) => /^(Cash count|Expenses)/.test(n))) assert.deepEqual(now[name], was[name], `"${name}" is as the close printed it`)
  })
  await check('ORACLE CONTROL: the days are not trivial -- the reports are long, the scenarios differ from each other, and the figures carry the seeded money', () => {
    for (const { scenario, newRun } of runs.filter((r) => r.scenario.telegramOn !== false)) assert.ok(newRun.telegram.join('').length > 300, scenario.name)
    assert.notEqual(runs[0].newRun.figures, runs[1].newRun.figures, 'shop-wide differs from per-account')
    assert.notEqual(runs[0].newRun.figures, runs[5].newRun.figures, 'a cancelled sale moves the figures')
    assert.notEqual(runs[0].newRun.figures, runs[6].newRun.figures, 'a Not Paid sale paid later moves the figures')
    assert.notEqual(runs[0].newRun.figures, runs[8].newRun.figures, 'a riel refund and expense move the figures')
    assert.notEqual(texts(runs[0].newRun), texts(runs[9].newRun), 'a removal in four formats moves the text')
    for (const { newRun } of runs) assert.ok(newRun.close.body.shift && newRun.close.body.shift.reconciliation, 'the response carries the drawer (not nulled by a refused call)')
    assert.ok(runs.every(({ newRun }) => newRun.close.body.shift.figures), 'and the report figures')
  })
  await check(`CEILING: the close is <= ${CEILING} D1 calls and the queued report is <= ${CEILING}, cold, with call 51 refused, in every scenario`, () => {
    for (const { scenario, newRun } of runs) {
      assert.ok(newRun.closeCalls <= CEILING, `${scenario.name}: the close made ${newRun.closeCalls} calls`)
      if (scenario.telegramOn !== false) assert.ok(newRun.reportCalls <= CEILING, `${scenario.name}: the queued report made ${newRun.reportCalls} calls`)
    }
  })
  await check('REQUIRED RED: the base commit\'s close (its report runs in the same invocation) is over the ceiling and over the 50 Free allows -- this file is red on it', () => {
    const over = runs.filter(({ scenario }) => scenario.telegramOn !== false).map(({ oldRun }) => oldRun.calls)
    assert.ok(over.every((calls) => calls > CEILING), `base calls ${over.join(',')}`)
    assert.ok(over.every((calls) => calls > 50), `base calls ${over.join(',')}`)
  })

  await check('OTHER REPORTERS: close, amend, reopen and cancel send the text they sent before (the base commit is the oracle), once each, through the queue path, even when each row is delivered twice', async () => {
    const [oldLife, newLife] = [await lifecycle(base), await lifecycle(head)]
    for (const name of ['close', 'amend', 'reopen', 'cancel']) {
      assert.ok(oldLife[name] && newLife[name], `${name}: the step ran`)
      assert.ok([200, 201].includes(oldLife[name].result.status), `${name}: base ${JSON.stringify(oldLife[name].result.body)}`)
      assert.equal(newLife[name].result.status, oldLife[name].result.status, `${name}: the answer`)
      assert.equal(oldLife[name].sent.length, 1, `${name}: the base sends one message`)
      assert.equal(newLife[name].sent.length, 1, `${name}: the queued report is sent once (it was delivered twice)`)
      assert.equal(scrub(newLife[name].sent[0]), scrub(oldLife[name].sent[0]), `${name}: the report text`)
      assert.equal(newLife[name].keys.length, 1, `${name}: one recorded report`)
      assert.match(newLife[name].keys[0], new RegExp(`^shift-report:\\d+:r\\d+:${name}$`), `${name}: the key names the shift, the revision and the action`)
    }
    assert.equal(newLife.rowsTotal, 5, 'one row per reporting write: the open (skipped above) plus close, amend, reopen and cancel')
    assert.notEqual(scrub(newLife.close.sent[0]), scrub(newLife.cancel.sent[0]), 'CONTROL: the four texts are not all the same text')
    assert.notEqual(scrub(newLife.amend.sent[0]), scrub(newLife.reopen.sent[0]), 'CONTROL: amend and reopen differ')
  })
  await check('EXACTLY ONE report per close: an exact retry [200, 200] and two racing closes [200, 409] each leave one row and one message, as the base sends one', async () => {
    for (const mode of ['retry', 'concurrent']) {
      const oldPair = await closePair(base, mode)
      const newPair = await closePair(head, mode)
      assert.deepEqual([...newPair.statuses].sort(), [...oldPair.statuses].sort(), `${mode}: the answers are the base's`)
      assert.equal(oldPair.sent.length, 1, `${mode}: the base sends one`)
      assert.equal(newPair.sent.length, 1, `${mode}: one message`)
      assert.equal(newPair.keys.length, 1, `${mode}: one row`)
    }
  })
  await check('OPEN: a shift opening records one open report and sends one message, whose first line is the base\'s', async () => {
    const opened = async (load) => {
      const f = fixture(); const shifts = load('routes/shifts.ts').default; user = CASHIER
      const telegram = captureTelegram()
      try {
        // Real clock: the open reads its own row back by today's business date, which a fixed clock in another year cannot satisfy.
        const answer = await f.call(shifts, '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
        await Promise.all(f.background)
        const deliver = load('lib/telegram.ts').deliverTelegramShiftReport
        const keys = typeof deliver === 'function' ? f.sql.prepare("SELECT send_key FROM telegram_shift_report_sends WHERE status = 'pending'").all().map((row) => row.send_key) : []
        for (const key of keys) { await deliver(f.env, key); await deliver(f.env, key) }
        return { status: answer.status, sent: telegram.sent.slice(), keys }
      } finally { telegram.restore() }
    }
    const [oldOpen, newOpen] = [await opened(base), await opened(head)]
    assert.equal(newOpen.status, 201); assert.equal(oldOpen.status, 201)
    assert.equal(oldOpen.sent.length, 1); assert.equal(newOpen.sent.length, 1)
    assert.equal(newOpen.sent[0].split('\n')[0], oldOpen.sent[0].split('\n')[0])
    assert.match(newOpen.keys[0], /^shift-report:\d+:r\d+:open$/)
  })
  await check(`HISTORY (I5): GET /api/shifts/:id/history is <= ${CEILING} D1 calls cold and its body is byte-identical to the base commit's`, async () => {
    const [oldHistory, newHistory] = [await historyOf(base), await historyOf(head)]
    console.log(`     history (cold, closed + amended record): base ${oldHistory.calls} -> ${newHistory.calls} calls`)
    if (process.env.TRACE_HISTORY) console.log(newHistory.log.map((entry, index) => `${index} [${entry.kind}] ${entry.sql.replace(/\s+/g, ' ').slice(0, 150)}`).join('\n'))
    assert.equal(oldHistory.answer.status, 200, JSON.stringify(oldHistory.answer.body))
    assert.equal(newHistory.answer.status, 200)
    assert.equal(normalizeBody(newHistory.answer.body), normalizeBody(oldHistory.answer.body), 'the history body')
    assert.ok(newHistory.answer.body.shift.reconciliation && newHistory.answer.body.amendments.length >= 2, 'CONTROL: a real record with figures and its amendments')
    assert.ok(newHistory.calls <= CEILING, `the history made ${newHistory.calls} calls`)
  })

  console.log(`${passed} checks passed.`)
}
main().catch((error) => { console.error(error); process.exit(1) })
