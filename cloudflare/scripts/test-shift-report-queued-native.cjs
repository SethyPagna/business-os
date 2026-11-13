'use strict'
// Wave 3, slice B: the Telegram shift report is its OWN send (migration 0305, lib/telegram.ts scheduleTelegramShiftReport / deliverTelegramShiftReport / the cron
// drain, src/index.ts queue consumer). The real routes and libraries over the real migration chain; Telegram is a local function; the queue is a recording stub.
//
// Pinned here:
//   1. SCHEDULE: one row (pending, dispatch queue) and ONE queue message {kind, key} with no delay, carrying the clock reading and the actor names; nothing is sent
//      before the consumer runs. A failed queue send flips the row to the cron fallback; no binding is the fallback from the start; a repeat is a duplicate.
//   2. ONE SEND: two deliveries racing each other send once; a redelivery sends nothing; a failed Telegram call is NOT retried (a part may be in the chat).
//   3. THE CRON ONLY: the request drain never delivers a report; the cron drain delivers ONE report per tick (it has its own 50 calls), a queued row only after the
//      grace, and a claim that never reported back is swept to failed, never re-sent.
//   4. SWITCHES: Telegram off at schedule time records nothing; off by send time sends nothing; the shift gone sends nothing.
//   5. NO 0305: before the migration the route sends the report inline, as it always did (either deploy order is safe).
//   6. REQUIRED RED: a mutant whose delivery does not claim the row sends twice, and this file goes red on it.
//   7. The consumer (index.ts) delivers a report message, acknowledges it whatever the outcome, and leaves other backup-queue messages to their handler.
//
// Run (from cloudflare/): node scripts/test-shift-report-queued-native.cjs
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

// ---- a world with one OPEN shift, a queue stub and a controllable Telegram -----------------------------------------------------------------------------------
const NOW = Date.UTC(2026, 9, 20, 10, 0, 0)
async function world(load = createLoader(), { queue = 'ok', dropTable = false } = {}) {
  const f = fixture()
  if (dropTable) f.sql.exec('DROP TABLE telegram_shift_report_sends')
  const sent = []
  const realFetch = globalThis.fetch
  const posts = { failNext: 0 }
  globalThis.fetch = async (_url, init) => {
    if (posts.failNext > 0) { posts.failNext -= 1; return new Response('Bad Gateway', { status: 502 }) }
    const body = typeof init?.body === 'string' ? init.body : ''
    sent.push(body.startsWith('{') ? JSON.parse(body).text : new URLSearchParams(body).get('text') || body)
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const queued = []
  if (queue) f.env.BACKUP_QUEUE = { async send(body, options) { if (queue === 'throw') throw new Error('queue unavailable'); queued.push({ body, options }) } }
  const shifts = load('routes/shifts.ts').default
  user = CASHIER
  const opened = await f.call(shifts, '/open', { branch_id: 1, opening_float_usd: 10, opening_float_khr: 0 })
  await Promise.all(f.background); f.background.length = 0
  assert.equal(opened.status, 201, JSON.stringify(opened.body))
  if (!dropTable) f.sql.exec("DELETE FROM telegram_shift_report_sends") // the open's own report is not under test
  sent.length = 0; queued.length = 0
  const telegram = load('lib/telegram.ts')
  const row = (key) => f.sql.prepare('SELECT * FROM telegram_shift_report_sends WHERE send_key = ?').get(key)
  return { f, load, shifts, telegram, sent, queued, posts, row, id: opened.body.shift.id, restore: () => { globalThis.fetch = realFetch } }
}
const KEY = (id, revision = 3, action = 'close') => `shift-report:${id}:r${revision}:${action}`

async function main() {
  await check('SCHEDULE: one pending row and ONE queue message (kind + key, no delay) carrying the clock reading and the names; nothing is sent yet', async () => {
    const w = await world()
    try {
      const outcome = await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW, { closedBy: 'Admin', closedById: 1 })
      assert.equal(outcome, 'queued')
      assert.deepEqual(w.queued.map((entry) => entry.body), [{ kind: 'telegram-shift-report', key: KEY(w.id) }])
      assert.equal(w.queued[0].options, undefined, 'no delay: a delay literal would be a plan-literal; the report is not delayed')
      const stored = w.row(KEY(w.id))
      assert.equal(stored.status, 'pending'); assert.equal(stored.dispatch, 'queue'); assert.equal(stored.shift_id, w.id)
      assert.deepEqual(JSON.parse(stored.payload_json), { nowMs: NOW, options: { closedBy: 'Admin', closedById: 1 } })
      assert.equal(w.sent.length, 0)
      assert.equal(await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW + 5), 'duplicate', 'a repeat of the same write')
      assert.equal(w.queued.length, 1)
      assert.equal(await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 4, 'close', NOW), 'queued', 'the next revision is a new report')
    } finally { w.restore() }
  })
  await check('SCHEDULE: a queue send that throws leaves the row on the cron fallback; no binding is the fallback from the start', async () => {
    const thrown = await world(createLoader(), { queue: 'throw' })
    try {
      assert.equal(await thrown.telegram.scheduleTelegramShiftReport(thrown.f.env, thrown.id, 3, 'close', NOW), 'fallback')
      assert.equal(thrown.row(KEY(thrown.id)).dispatch, 'fallback')
    } finally { thrown.restore() }
    const none = await world(createLoader(), { queue: null })
    try {
      assert.equal(await none.telegram.scheduleTelegramShiftReport(none.f.env, none.id, 3, 'close', NOW), 'fallback')
      assert.equal(none.row(KEY(none.id)).dispatch, 'fallback')
    } finally { none.restore() }
  })
  await check('ONE SEND: two deliveries racing, then a redelivery, send exactly once; the row says sent once', async () => {
    const w = await world()
    try {
      await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW, { closedBy: 'Admin', closedById: 1 })
      const outcomes = await Promise.all([w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW), w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW)])
      assert.deepEqual([...outcomes].sort(), ['sent', 'taken'])
      assert.equal(await w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW), 'taken')
      assert.equal(w.sent.length, 1)
      assert.equal(w.row(KEY(w.id)).status, 'sent'); assert.equal(w.row(KEY(w.id)).attempts, 1)
      assert.match(w.sent[0], /Admin/, 'the carried closer name is in the text')
    } finally { w.restore() }
  })
  await check('ONE SEND: a Telegram failure is recorded and NOT retried (no second send on a redelivery or on the cron)', async () => {
    const w = await world()
    try {
      await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW)
      w.posts.failNext = 1
      assert.equal(await w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW), 'failed')
      assert.equal(w.row(KEY(w.id)).status, 'failed'); assert.match(w.row(KEY(w.id)).last_error, /502|rejected/)
      assert.equal(await w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW), 'taken')
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW + 3_600_000, { sweepStale: true }), 0)
      assert.equal(w.sent.length, 0)
    } finally { w.restore() }
  })
  await check('THE CRON ONLY: the request drain delivers no report; the cron delivers ONE per tick, a queued row only after the grace, and a dead claim is swept, never re-sent', async () => {
    const w = await world(createLoader(), { queue: null })
    try {
      await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW)
      await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 4, 'amend', NOW + 1)
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW + 60_000), 0, 'the request drain (no sweepStale) leaves reports alone')
      assert.equal(w.sent.length, 0)
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW + 60_000, { limit: 10, sweepStale: true }), 1, 'the cron sends ONE per tick')
      assert.equal(w.sent.length, 1)
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW + 360_000, { limit: 10, sweepStale: true }), 1, 'and the next one on the next tick')
      assert.equal(w.sent.length, 2)
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW + 720_000, { limit: 10, sweepStale: true }), 0)
    } finally { w.restore() }
    const queuedWorld = await world()
    try {
      await queuedWorld.telegram.scheduleTelegramShiftReport(queuedWorld.f.env, queuedWorld.id, 3, 'close', NOW)
      assert.equal(await queuedWorld.telegram.drainDueTelegramShiftOverviews(queuedWorld.f.env, NOW + 60_000, { limit: 10, sweepStale: true }), 0, 'a queued row on time is the queue\'s')
      assert.equal(await queuedWorld.telegram.drainDueTelegramShiftOverviews(queuedWorld.f.env, NOW + 6 * 60_000, { limit: 10, sweepStale: true }), 1, 'a queued row the queue never delivered is the cron\'s after five minutes')
    } finally { queuedWorld.restore() }
    const dead = await world()
    try {
      await dead.telegram.scheduleTelegramShiftReport(dead.f.env, dead.id, 3, 'close', NOW)
      dead.f.sql.prepare("UPDATE telegram_shift_report_sends SET status = 'sending', claimed_at = ? WHERE send_key = ?").run(new RealDate(NOW - 11 * 60_000).toISOString(), KEY(dead.id))
      assert.equal(await dead.telegram.drainDueTelegramShiftOverviews(dead.f.env, NOW, { limit: 10, sweepStale: true }), 0)
      assert.equal(dead.row(KEY(dead.id)).status, 'failed'); assert.equal(dead.sent.length, 0)
    } finally { dead.restore() }
  })
  await check('SWITCHES: Telegram off at schedule time records nothing; off by send time sends nothing; a shift that is gone sends nothing', async () => {
    const off = await world()
    try {
      off.f.sql.prepare("UPDATE settings SET value = 'false' WHERE key = 'telegram_automation_enabled'").run()
      assert.equal(await off.telegram.scheduleTelegramShiftReport(off.f.env, off.id, 3, 'close', NOW), 'off')
      assert.equal(off.f.sql.prepare('SELECT COUNT(*) n FROM telegram_shift_report_sends').get().n, 0); assert.equal(off.queued.length, 0)
    } finally { off.restore() }
    const late = await world()
    try {
      await late.telegram.scheduleTelegramShiftReport(late.f.env, late.id, 3, 'close', NOW)
      late.f.sql.prepare("UPDATE settings SET value = 'false' WHERE key = 'telegram_automation_enabled'").run()
      assert.equal(await late.telegram.deliverTelegramShiftReport(late.f.env, KEY(late.id), NOW), 'skipped')
      assert.equal(late.row(KEY(late.id)).status, 'skipped'); assert.equal(late.sent.length, 0)
    } finally { late.restore() }
    const gone = await world()
    try {
      await gone.telegram.scheduleTelegramShiftReport(gone.f.env, 999, 3, 'close', NOW)
      assert.equal(await gone.telegram.deliverTelegramShiftReport(gone.f.env, KEY(999), NOW), 'skipped'); assert.equal(gone.sent.length, 0)
    } finally { gone.restore() }
  })
  await check('NO 0305 YET: the table is absent, the scheduler answers unavailable and the close route sends the report inline, once, as before', async () => {
    const w = await world(createLoader(), { dropTable: true })
    try {
      assert.equal(await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW), 'unavailable')
      assert.equal(await w.telegram.drainDueTelegramShiftOverviews(w.f.env, NOW, { limit: 10, sweepStale: true }), 0, 'the cron drain is a no-op without the table')
      user = ADMIN
      const closed = await withFixedClock(async () => {
        w.f.sql.prepare("UPDATE shift_sessions SET opened_at = ?, business_date = '2026-10-20' WHERE id = ?").run(new RealDate(NOW - 3 * 3600e3).toISOString(), w.id)
        const out = await w.f.call(w.shifts, `/${w.id}/close`, { client_request_id: 'req-no-table-00000001', expected_revision: w.f.sql.prepare('SELECT revision FROM shift_sessions WHERE id = ?').get(w.id).revision, closing_counted_usd: 10, closing_counted_khr: 0 })
        await Promise.all(w.f.background)
        return out
      })
      assert.equal(closed.status, 200, JSON.stringify(closed.body))
      assert.equal(w.sent.length, 1, 'inline, once')
      assert.equal(w.queued.filter((entry) => entry.body.kind === 'telegram-shift-report').length, 0, 'no report message (the overview message is another thing)')
    } finally { w.restore() }
  })
  await check('REQUIRED RED: a delivery that does not claim the row (the mutant) sends twice under a race -- this file is red on it', async () => {
    const mutant = createLoader({ 'lib/telegram.ts': (text) => text.replace("WHERE send_key = @key AND status = 'pending' AND due_at <= @now RETURNING shift_id, payload_json", 'WHERE send_key = @key AND due_at <= @now RETURNING shift_id, payload_json') })
    const w = await world(mutant)
    try {
      await w.telegram.scheduleTelegramShiftReport(w.f.env, w.id, 3, 'close', NOW)
      await Promise.all([w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW), w.telegram.deliverTelegramShiftReport(w.f.env, KEY(w.id), NOW)])
      assert.equal(w.sent.length, 2, 'the mutant double-sends: the claim is what makes the send once')
    } finally { w.restore() }
  })
  await check('THE CONSUMER: index.ts delivers a report message and acknowledges it whatever the outcome; other backup-queue messages still reach their handler; the request drain has no sweepStale', () => {
    const index = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.match(index, /isShiftReportQueueMessage\(message\.body\)\)\n\s+for \(const message of reports\) \{\n\s+try \{ await deliverTelegramShiftReport\(env, \(message\.body as \{ key: string \}\)\.key\) \} catch/)
    assert.match(index, /console\.error\('\[telegram\] shift report queue delivery failed; the cron drain will pick it up', error\)\n\s+\}\n\s+message\.ack\(\)/)
    assert.match(index, /overviews\.length \+ reports\.length === batch\.messages\.length\) return/)
    assert.match(index, /!isShiftOverviewQueueMessage\(message\.body\) && !isShiftReportQueueMessage\(message\.body\)/)
    assert.match(index, /runBackground\(c\.env, 'telegram-drain', \(\) => drainDueTelegramShiftOverviews\(c\.env, now\)\)/, 'the request drain passes no sweepStale, so it never reaches the report drain')
    const telegram = fs.readFileSync(path.join(root, 'src', 'lib', 'telegram.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.match(telegram, /if \(options\.sweepStale\) \{\n\s+let taken[^\n]*\n\s+try \{ taken = await drainOneDueShiftReport\(env, nowMs\) \}[^\n]*\n\s+if \(taken !== 'none' && taken !== 'taken'\) return/, 'a tick that took a report sends nothing else (the overview waits one tick)')
    assert.match(telegram, /ORDER BY due_at LIMIT 1`\)\.get<\{ send_key: string \}>/, 'ONE report per cron tick')
  })

  console.log(`${passed} checks passed.`)
}
main().catch((error) => { console.error(error); process.exit(1) })
