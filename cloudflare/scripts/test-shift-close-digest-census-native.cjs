'use strict'
// Wave 3, slice B, M9 step 2 (REVIEW-d1-money-2): the close RESPONSE no longer re-computes the drawer and the sale tenders to learn that nothing drifted. It
// re-reads the close's own inputs digest (the one its batch committed the figures on) and, when it still reads the same, answers close_drift = null. That is exact
// only if EVERY writer of what the digest reads moves the digest. The digest reads: the window's sales (count, ids, sum of sale_write_revisions), the delivery fees
// linked to them, the window's fees (ids and amounts), the window's refunds, the payment-method settings, and the window's payment events. Every sale, line,
// allocation, return, amendment and fee writer funnels through the triggers of migration 0120 (+ 0271), which bump sale_write_revisions.
//
// This file pins, on the REAL migration chain:
//   1. STRUCTURE: for every table that can change what a drawer shows, an INSERT, an UPDATE and a DELETE trigger that writes sale_write_revisions (so a new writer
//      added in any route is covered by construction; a table without the triggers fails here).
//   2. BEHAVIOUR: each concrete writer -- courier payout, tender relabel, status change, a new / deleted sale, line, allocation, return and its lines, amendment,
//      expense and delivery fee insert / edit / delete, a payment event, the payment-method settings -- moves the digest of a closed shift's window.
//      CONTROL: a write OUTSIDE the window (another cashier, another day) and a plain re-read do NOT move it, so the digest is not a constant.
//   3. THE DRIFT GATE ITSELF: a write that lands between the commit and the response takes the full path and reports the drift, byte-identical to the base commit.
//
// Run (from cloudflare/): node scripts/test-shift-close-digest-census-native.cjs
const { execFileSync } = require('node:child_process')
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

async function runClose(load, { shopWide = false, requestId = 'req-close-0000000001', hook, hours = 8, telegramOn = true, refuse = 0 } = {}) {
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

const BASE_REF = '09e0d8123'
const WINDOW_FROM = '2026-10-20T02:00:00.000Z'
const WINDOW_TO = '2026-10-20T10:00:00.000Z'
const inWindow = '2026-10-20 03:00:00'
const otherDay = '2026-10-18 03:00:00'
const tender = (method, usd) => JSON.stringify([{ method, amount_usd: usd, amount_khr: 0 }])

/** A closed per-account shift (cashier 7, branch 1) and a window with every kind of record the drawer reads. */
async function digestWorld() {
  const load = createLoader()
  const f = fixture()
  const insertSale = f.sql.prepare(`INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_id,cashier_name,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,change_usd,change_khr,total_usd,total_khr,delivery_actual_cost_usd,created_at,updated_at,payments_version)
    VALUES (?,?,'completed',1,'Shop',?,?,?,?,'USD',4100,?,0,0,0,?,0,?,?,'v1',?)`)
  insertSale.run(1, 'R1', 7, 'cashier', 'Cash', tender('Cash', 50), 50, 50, null, inWindow, 1)
  insertSale.run(2, 'R2', 7, 'cashier', 'Cash', tender('Cash', 30), 30, 30, null, inWindow, 0)
  insertSale.run(3, 'R3', 7, 'cashier', 'ABA', tender('ABA', 20), 20, 20, null, inWindow, 0)
  insertSale.run(4, 'R4-other-cashier', 8, 'other', 'Cash', tender('Cash', 12), 12, 12, null, inWindow, 0)
  insertSale.run(5, 'R5-other-day', 7, 'cashier', 'Cash', tender('Cash', 9), 9, 9, null, otherDay, 0)
  f.sql.exec(`INSERT INTO sale_items(id, sale_id) VALUES (1, 1), (2, 1);
    INSERT INTO sale_item_batch_allocations(id, sale_item_id, batch_id, quantity) VALUES (1, 1, 1, 1), (2, 2, 1, 1);
    INSERT INTO returns(id, return_number, sale_id, receipt_number, cashier_id, branch_id, reason, total_refund_usd, total_refund_khr, exchange_rate, status, created_at)
      VALUES (1, 'RT1', 1, 'R1', 7, 1, 'x', 5, 20500, 4100, 'completed', '${inWindow}');
    INSERT INTO return_items(id, return_id) VALUES (1, 1), (2, 1);
    INSERT INTO return_item_batch_allocations(id, return_item_id, batch_id, quantity) VALUES (1, 1, 1, 1), (2, 2, 1, 1);
    INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (9900, '${inWindow}', '2026-10-20', 1, 'other', 'Ice', 5, 0, 7);
    INSERT INTO fees(id, created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by, sale_id) VALUES (9901, '${inWindow}', '2026-10-20', 1, 'delivery', 'Courier', 3, 0, 7, 2);
    INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at)
      VALUES ('ev-1',1,'in','late_record','Cash','${tender('Cash', 7)}',7,4100,'${inWindow}',1,7,'cashier','${inWindow}');`)
  const shift = { id: 1, scope_mode: 'per_account', user_id: 7, branch_id: 1, opened_at: WINDOW_FROM, closed_at: WINDOW_TO, cancelled_at: null,
    opening_float_usd: 10, opening_float_khr: 0, additional_cash_usd: 0, additional_cash_khr: 0, closing_counted_usd: 100, closing_counted_khr: 0 }
  const lib = load('lib/shiftReconciliation.ts')
  const digest = lib.shiftCloseInputsDigestSql(shift, Date.UTC(2026, 9, 20, 10, 0, 0))
  const read = () => lib.readShiftCloseInputsDigest(f.env, digest)
  return { f, read, shift, digest, lib, load }
}

async function main() {
  await check('STRUCTURE: every table that can change what a drawer shows has an INSERT, UPDATE and DELETE trigger that bumps sale_write_revisions (append-only ledgers refuse the writes they cannot bump)', () => {
    const f = fixture()
    const triggers = f.sql.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'").all()
    const spec = {
      sales: ['INSERT', 'UPDATE', 'DELETE'], sale_items: ['INSERT', 'UPDATE', 'DELETE'], sale_item_batch_allocations: ['INSERT', 'UPDATE', 'DELETE'],
      returns: ['INSERT', 'UPDATE', 'DELETE'], return_items: ['INSERT', 'UPDATE', 'DELETE'], return_item_batch_allocations: ['INSERT', 'UPDATE', 'DELETE'],
      sale_amendments: ['INSERT', 'UPDATE', 'DELETE'], fees: ['INSERT', 'UPDATE', 'DELETE'], sale_payment_events: ['INSERT'],
    }
    for (const [table, operations] of Object.entries(spec)) {
      for (const operation of operations) {
        const bump = triggers.find((trigger) => trigger.tbl_name === table && new RegExp(`AFTER ${operation} ON ${table}\\b`, 'i').test(trigger.sql) && /sale_write_revisions/.test(trigger.sql))
        const refused = triggers.find((trigger) => trigger.tbl_name === table && new RegExp(`BEFORE ${operation} ON ${table}\\b`, 'i').test(trigger.sql) && /RAISE\s*\(/i.test(trigger.sql))
        assert.ok(bump || refused, `${table}: no ${operation} trigger bumps sale_write_revisions (or refuses the write)`)
      }
    }
    for (const table of ['sale_amendments', 'sale_payment_events']) {
      for (const operation of ['UPDATE', 'DELETE']) {
        assert.ok(triggers.some((trigger) => trigger.tbl_name === table && new RegExp(`BEFORE ${operation} ON ${table}\\b`, 'i').test(trigger.sql) && /RAISE\s*\(/i.test(trigger.sql)), `${table} is append-only for ${operation}`)
      }
    }
  })

  const writers = [
    ['a courier payout recorded on a sale', (f) => f.sql.prepare('UPDATE sales SET delivery_actual_cost_usd = 2 WHERE id = 1').run()],
    ['a tender relabelled on a sale', (f) => f.sql.prepare("UPDATE sales SET payment_method = 'ABA', payment_details = ? WHERE id = 2").run(tender('ABA', 30))],
    ['a sale cancelled', (f) => f.sql.prepare("UPDATE sales SET sale_status = 'cancelled' WHERE id = 3").run()],
    ['a sale added to the window', (f) => f.sql.prepare("INSERT INTO sales(id,receipt_number,sale_status,branch_id,cashier_id,total_usd,created_at,updated_at) VALUES (10,'R10','completed',1,7,4,?,'v1')").run(inWindow)],
    ['a sale deleted', (f) => f.sql.prepare('DELETE FROM sales WHERE id = 3').run()],
    ['a sale moved into the window by its created_at', (f) => f.sql.prepare('UPDATE sales SET created_at = ? WHERE id = 5').run(inWindow)],
    ['a line added', (f) => f.sql.prepare('INSERT INTO sale_items(sale_id) VALUES (1)').run()],
    ['a line changed', (f) => f.sql.prepare("UPDATE sale_items SET product_name = 'x' WHERE id = 1").run()],
    ['a line removed', (f) => f.sql.prepare('DELETE FROM sale_items WHERE id = 1').run()],
    ['a batch allocation added', (f) => f.sql.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id, batch_id, quantity) VALUES (1, 2, 1)').run()],
    ['a batch allocation changed', (f) => f.sql.prepare('UPDATE sale_item_batch_allocations SET quantity = 3 WHERE id = 1').run()],
    ['a batch allocation removed', (f) => f.sql.prepare('DELETE FROM sale_item_batch_allocations WHERE id = 1').run()],
    ['a refund taken', (f) => f.sql.prepare("INSERT INTO returns(return_number, sale_id, receipt_number, cashier_id, branch_id, reason, total_refund_usd, total_refund_khr, exchange_rate, status, created_at) VALUES ('RT2', 2, 'R2', 7, 1, 'x', 3, 0, 4100, 'completed', ?)").run(inWindow)],
    ['a refund amended', (f) => f.sql.prepare('UPDATE returns SET total_refund_usd = 9 WHERE id = 1').run()],
    ['a refund removed', (f) => f.sql.prepare('DELETE FROM returns WHERE id = 1').run()],
    ['a return line added', (f) => f.sql.prepare('INSERT INTO return_items(return_id) VALUES (1)').run()],
    ['a return line changed', (f) => f.sql.prepare("UPDATE return_items SET quantity = 4 WHERE id = 1").run()],
    ['a return line removed', (f) => f.sql.prepare('DELETE FROM return_items WHERE id = 1').run()],
    ['a return batch allocation added', (f) => f.sql.prepare('INSERT INTO return_item_batch_allocations(return_item_id, batch_id, quantity) VALUES (1, 3, 1)').run()],
    ['a return batch allocation changed', (f) => f.sql.prepare('UPDATE return_item_batch_allocations SET quantity = 5 WHERE id = 1').run()],
    ['a return batch allocation removed', (f) => f.sql.prepare('DELETE FROM return_item_batch_allocations WHERE id = 1').run()],
    ['a sale amendment (line / delivery / courier cost)', (f) => f.sql.prepare("INSERT INTO sale_amendments(sale_id, kind) VALUES (1, 'delivery_actual_cost_changed')").run()],
    ['an expense added', (f) => f.sql.prepare("INSERT INTO fees(created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (?, '2026-10-20', 1, 'other', 'Snack', 1, 0, 7)").run(inWindow)],
    ['an expense amount edited', (f) => f.sql.prepare('UPDATE fees SET amount_usd = 6 WHERE id = 9900').run()],
    ['an expense removed', (f) => f.sql.prepare('DELETE FROM fees WHERE id = 9900').run()],
    ['a delivery fee linked to a window sale edited', (f) => f.sql.prepare('UPDATE fees SET amount_usd = 4 WHERE id = 9901').run()],
    ['a delivery fee linked to a window sale removed', (f) => f.sql.prepare('DELETE FROM fees WHERE id = 9901').run()],
    ['a later payment recorded', (f) => f.sql.prepare("INSERT INTO sale_payment_events(event_id,sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,exchange_rate,received_at,branch_id,cashier_id,cashier_name,created_at) VALUES ('ev-2',1,'in','late_record','Cash',?,3,4100,?,1,7,'cashier',?)").run(tender('Cash', 3), inWindow, inWindow)],
    ['the payment-method kinds re-labelled (settings)', (f) => f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}','v2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()],
  ]
  await check(`BEHAVIOUR: each of ${writers.length} writers moves the digest of a closed shift's window (and a plain re-read does not)`, async () => {
    for (const [name, write] of writers) {
      const world = await digestWorld()
      const before = await world.read()
      assert.equal(await world.read(), before, `${name}: a plain re-read is stable`)
      write(world.f)
      assert.notEqual(await world.read(), before, `${name}: the digest did not move`)
    }
  })
  await check('CONTROL: writes outside the drawer (another cashier, another day, another shift\'s expense) leave the digest where it was, so the digest is not a constant', async () => {
    const controls = [
      ['another cashier\'s sale edited', (f) => f.sql.prepare('UPDATE sales SET total_usd = 99 WHERE id = 4').run()],
      ['a sale of another day edited', (f) => f.sql.prepare('UPDATE sales SET total_usd = 99 WHERE id = 5').run()],
      ['another cashier\'s expense', (f) => f.sql.prepare("INSERT INTO fees(created_at, fee_date, branch_id, fee_type, label, amount_usd, amount_khr, created_by) VALUES (?, '2026-10-20', 1, 'other', 'Theirs', 1, 0, 8)").run(inWindow)],
      ['an unrelated setting', (f) => f.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('some_other_setting','x','v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()],
    ]
    for (const [name, write] of controls) {
      const world = await digestWorld()
      const before = await world.read()
      write(world.f)
      assert.equal(await world.read(), before, `${name}: moved the digest`)
    }
  })

  // ---- the gate in the route: a write between the commit and the response takes the full path -------------------------------------------------------------------
  const closeWithLateWrite = async (load, late) => {
    const shifts = load('routes/shifts.ts').default
    const { f, id, revision } = await seededDay(shifts, {})
    load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests()
    user = ADMIN
    f.log.length = 0; f.calls = 0 // the seeding's own batch (the open) must not count as the close's commit
    const telegram = captureTelegram()
    try {
      let fired = false
      if (late) {
        // The first read after the close batch is the row read back; a write landing right there is "after the commit, before the response".
        f.afterRead = (text) => {
          if (fired || !f.log.some((entry) => entry.kind === 'batch') || !/^SELECT id, shift_code/.test(text)) return
          fired = true
          f.sql.prepare("UPDATE sales SET payment_method = 'ABA', payment_details = ? WHERE id = 2").run(tender('ABA', 30))
        }
      }
      const out = await withFixedClock(async () => {
        const answer = await f.call(shifts, `/${id}/close`, { client_request_id: 'req-late-write-00001', expected_revision: revision, closing_counted_usd: 100, closing_counted_khr: 41000 })
        await Promise.all(f.background)
        return answer
      })
      return { answer: out, fired, calls: f.calls }
    } finally { telegram.restore() }
  }
  const scrubbed = (answer) => JSON.stringify(answer.body, (key, value) => (key === 'updated_at' || key === 'shift_code' ? undefined : value))
  const base = createLoader({}, BASE_REF)
  const head = createLoader()
  await check('THE GATE: with nothing moved close_drift is null as before; a write landing after the commit is reported as drift exactly as the base commit reports it', async () => {
    const [quietOld, quietNew] = [await closeWithLateWrite(base, false), await closeWithLateWrite(head, false)]
    assert.equal(quietNew.answer.status, 200); assert.equal(quietNew.answer.body.shift.close_drift, null)
    assert.equal(scrubbed(quietNew.answer), scrubbed(quietOld.answer), 'quiet close: byte-identical to the base')
    const [lateOld, lateNew] = [await closeWithLateWrite(base, true), await closeWithLateWrite(head, true)]
    assert.ok(lateOld.fired && lateNew.fired, 'the late write landed in both worlds')
    assert.ok(lateOld.answer.body.shift.close_drift && lateOld.answer.body.shift.close_drift.components.length > 0, 'CONTROL: the base reports a drift for that write')
    assert.ok(lateNew.answer.body.shift.close_drift, 'the gate did not swallow it')
    assert.equal(scrubbed(lateNew.answer), scrubbed(lateOld.answer), 'late write: byte-identical to the base (drift components, sales and current figures)')
  })
  await check('THE GATE, REQUIRED RED: a response that always answers "no drift" (the mutant) hides that write -- this file is red on it', async () => {
    const mutant = createLoader({ 'routes/shifts.ts': (text) => text.replace('if (digestNow === closedOn.digestValue) {', 'if (true) {') })
    const late = await closeWithLateWrite(mutant, true)
    assert.equal(late.answer.body.shift.close_drift, null, 'the mutant swallows the drift the base reports')
  })

  console.log(`${passed} checks passed.`)
}
main().catch((error) => { console.error(error); process.exit(1) })
