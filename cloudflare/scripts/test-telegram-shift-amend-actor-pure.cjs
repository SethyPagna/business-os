const productStockGuard = require('./harness/product_stock_guard.cjs')
// Owner rule (13 Oct 2026, item 14 follow-up): "A status-change notification names
// who did it." Amending a shift (PATCH /api/shifts/:id) re-sends the whole shift
// report as a NEW message in the Shift topic, so that message carries ONE row,
// `Amended by: <username>`, in both languages, with the other who/which rows under
// the title: the chat can tell a fresh close from a corrected one, and who
// corrected it.
//
// What this pins, on the composed text only (the Telegram API is a local
// recorder installed before any module runs; nothing is sent anywhere):
//   0. the label is the packs' own words (shift_amended_by, en and km);
//   1. the row, in en / km / both, right after the ID row, naming the account;
//   2. no row when the send is not an amendment, or the account has no name;
//   3. the route passes the account USERNAME (lib/actorSnapshot.ts) and no other
//      send passes one -- never a phone number or an email, even when the
//      session user carries both;
//   4. the three shift cash rows (Opening, Additional change used, Closing) are
//      still all there on an amended report, in order.
//
// Run (from cloudflare/): node scripts/test-telegram-shift-amend-actor-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

const posts = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botTEST-TOKEN/sendMessage'), `unexpected fetch ${url}`)
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}

function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => {
    if (name in overrides) return overrides[name]
    if (name === './productStockGuard') return productStockGuard
    if (name.startsWith('.')) throw new Error(`${file} requires ${name}, which this test did not wire`)
    return require(name)
  }, m, m.exports)
  return m.exports
}

const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE shift_sessions(id INTEGER PRIMARY KEY, shift_code TEXT, scope_mode TEXT, user_id INTEGER, user_name TEXT,
 branch_id INTEGER, branch_name TEXT, business_date TEXT, opened_at TEXT,
 opening_float_usd REAL, opening_float_khr REAL, opening_float_usd_registered INTEGER, opening_float_khr_registered INTEGER,
 additional_cash_usd REAL, additional_cash_khr REAL, closed_at TEXT, closing_counted_usd REAL, closing_counted_khr REAL,
 cancelled_at TEXT, cancelled_by_user_name TEXT, cancel_reason TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER, cashier_id INTEGER,
 payment_method TEXT, payment_details TEXT, amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
 change_usd REAL, change_khr REAL, change_is_actual INTEGER, change_exchange_rate REAL,
 total_usd REAL DEFAULT 0, exchange_rate REAL DEFAULT 4100,
 delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL);
ALTER TABLE sales ADD COLUMN payments_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE sale_payment_events(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, direction TEXT NOT NULL, origin TEXT NOT NULL,
 payment_method TEXT NOT NULL, payment_details TEXT NOT NULL, amount_paid_usd REAL NOT NULL DEFAULT 0, amount_paid_khr REAL NOT NULL DEFAULT 0,
 change_usd REAL NOT NULL DEFAULT 0, change_khr REAL NOT NULL DEFAULT 0, change_is_actual INTEGER NOT NULL DEFAULT 0, change_exchange_rate REAL,
 exchange_rate REAL NOT NULL, drawer_effect INTEGER NOT NULL DEFAULT 1, received_at TEXT NOT NULL, branch_id INTEGER, cashier_id INTEGER);
CREATE TABLE sale_amendments(id INTEGER PRIMARY KEY, sale_id INTEGER);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0, owed_reduction_usd REAL NOT NULL DEFAULT 0, refund_currency TEXT);
INSERT INTO settings VALUES('pos_payment_methods','["Cash","ABA"]');
INSERT INTO settings VALUES('business_name','Fixture Shop');
INSERT INTO settings VALUES('telegram_chat_id','-100000000001');
`)

const db = {
  prepare(query) {
    const bind = (params) => {
      if (Array.isArray(params)) return { stmt: sql.prepare(query), values: params }
      const values = []
      const text = query.replace(/@(\w+)/g, (_, key) => { values.push((params || {})[key] ?? null); return '?' })
      return { stmt: sql.prepare(text), values }
    }
    return {
      async get(params) { const b = bind(params); return b.stmt.get(...b.values) },
      async all(params) { const b = bind(params); return b.stmt.all(...b.values) },
      async run(params) { const b = bind(params); return b.stmt.run(...b.values) },
    }
  },
}
const dbModule = { getDb: () => db }

const KERNEL = {
  revenue_usd: 50, cost_usd: 20, profit_usd: 30, delivery_usd: 0, pending_revenue_usd: 0, refund_usd: 0,
  delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0,
  item_discount_usd: 0, discount_usd: 0, gross_sales_usd: 50,
}
const businessDateWindow = load('lib/businessDateWindow.ts')
const moneyPrecision = load('lib/moneyPrecision.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = load('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const realAnalytics = load('lib/salesAnalytics.ts', { './saleStatusResolution': require('./harness/sale_status_resolution.cjs'), './db': dbModule, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const analytics = {
  ...realAnalytics,
  getSalesTotals: async () => ({ ...KERNEL }),
  getPaymentMethodBreakdown: async () => [],
  getDeliveryContactTotals: async () => [],
}
const reconciliation = load('lib/shiftReconciliation.ts', {
  './db': dbModule, './salesAnalytics': analytics, './nativeSaleChange': nativeSaleChange,
  './paymentMethodRegistry': load('lib/paymentMethodRegistry.ts'),
})
const lang = load('lib/telegramLang.ts')
const lowStockRule = load('lib/lowStockSettings.ts', { './db': dbModule })
const telegram = load('lib/telegram.ts', {
  './db': dbModule, './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './saleTotals': saleTotals, './businessDateWindow': businessDateWindow, './telegramLang': lang,
  './salesAnalytics': analytics, './shiftReconciliation': reconciliation, './nativeSaleChange': nativeSaleChange,
})
const actor = load('lib/actorSnapshot.ts')

const pack = {
  en: require(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json')),
  km: require(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json')),
}
const NOW = Date.parse('2026-09-20T12:00:00Z')
const ENV = { TELEGRAM_BOT_TOKEN: 'TEST-TOKEN' }
const KHMER = /[ក-៿]/

// One closed shift, fake numbers: opening $50.00 · 100,000៛, counted $182.50 · 240,000៛,
// nothing added. Cashier Za; the amender in these tests is a different account, Sok.
let nextId = 0
function seed(extra = {}) {
  nextId += 1
  const day = String(nextId).padStart(2, '0')
  const shift = {
    id: nextId, shift_code: `S-202609${day}-0807-Za`, scope_mode: 'per_account', user_id: 7, user_name: 'Za',
    branch_id: 2, branch_name: 'Store', business_date: `2026-09-${day}`, opened_at: `2026-09-${day}T01:07:00.000Z`,
    opening_float_usd: 50, opening_float_khr: 100000, opening_float_usd_registered: 1, opening_float_khr_registered: 1,
    additional_cash_usd: 0, additional_cash_khr: 0,
    closed_at: `2026-09-${day}T11:30:00.000Z`, closing_counted_usd: 182.5, closing_counted_khr: 240000,
    cancelled_at: null, cancelled_by_user_name: null, cancel_reason: null, ...extra,
  }
  const columns = Object.keys(shift)
  sql.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((c) => shift[c]))
  return shift
}
const setLanguage = (mode) => sql.prepare("INSERT INTO settings VALUES('telegram_language', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode)

/** What the chat receives when the amend route calls sendTelegramShiftReport. */
async function sent(id, options) {
  const before = posts.length
  assert.equal(await telegram.sendTelegramShiftReport(ENV, id, NOW, options), true, `shift ${id} was not sent`)
  assert.equal(posts.length, before + 1, 'exactly one message per call')
  return posts[posts.length - 1].text
}

const SEP = lang.BILINGUAL_SEPARATOR
/** The label as the chat shows it, built from the PACK keys, not from the Worker table. */
const packLabel = (mode, key) => (mode === 'en' ? pack.en[key] : mode === 'km' ? pack.km[key] : `${pack.en[key]}${SEP}${pack.km[key]}`)
const idLabel = (mode) => (mode === 'en' ? lang.TELEGRAM_LABELS.shift.en : mode === 'km' ? lang.TELEGRAM_LABELS.shift.km : `${lang.TELEGRAM_LABELS.shift.en} ${lang.TELEGRAM_LABELS.shift.km}`)

;(async () => {
  const failures = []
  const section = async (name, run) => {
    try { await run(); console.log(`PASS [${name}]`) } catch (error) {
      failures.push({ name, message: String((error && error.message) || error).split('\n').slice(0, 14).join('\n') })
      console.log(`FAIL [${name}]`)
    }
  }

  const shift = seed()

  await section('0. the label is the packs\' own words (shift_amended_by), Khmer in the Khmer pack', async () => {
    assert.deepEqual(lang.TELEGRAM_LABELS.amendedBy, { en: pack.en.shift_amended_by, km: pack.km.shift_amended_by })
    assert.equal(pack.en.shift_amended_by, 'Amended by')
    assert.equal(pack.km.shift_amended_by, 'កែប្រែដោយ')
    assert.ok(KHMER.test(pack.km.shift_amended_by) && pack.km.shift_amended_by !== pack.en.shift_amended_by, 'km.json carries Khmer, not the English value')
    // The "<verb>ដោយ" shape of the packs' other "by" labels (shift_opened_by, recorded_by): the verb of
    // shift_edited / shift_amend, then the Worker's own By word.
    assert.ok(pack.km.shift_edited.includes('កែប្រែ') && pack.km.shift_amended_by === `កែប្រែ${lang.TELEGRAM_LABELS.by.km}`, pack.km.shift_amended_by)
  })

  await section('1. the amended report names who amended, in en / km / both, right after the ID row', async () => {
    for (const mode of ['en', 'km', 'both']) {
      setLanguage(mode)
      const text = await sent(shift.id, { amendedBy: 'sok' })
      const rows = text.split('\n')
      const expectedRow = `· ${packLabel(mode, 'shift_amended_by')}: sok`
      assert.equal(rows.filter((row) => row === expectedRow).length, 1, `[${mode}] exactly one "${expectedRow}" row\n${text}`)
      const at = rows.indexOf(`· ${idLabel(mode)}: ${shift.shift_code}`)
      assert.ok(at >= 0 && rows[at + 1] === expectedRow, `[${mode}] the row follows the ID row\n${text}`)
      if (mode === 'en') assert.ok(!KHMER.test(text.replace(/៛/g, '')), 'en mode carries no Khmer word')
      if (mode === 'km') assert.ok(!/Amended by/.test(text), 'km mode carries no English label')
    }
    setLanguage('both')
  })

  await section('2. no row when the send is not an amendment or the account has no name', async () => {
    for (const options of [undefined, {}, { amendedBy: null }, { amendedBy: '' }, { amendedBy: '   ' }]) {
      const text = await sent(shift.id, options)
      assert.ok(!text.includes(packLabel('both', 'shift_amended_by')) && !text.includes('Amended by'), `no amended row for ${JSON.stringify(options)}\n${text}`)
    }
    const direct = telegram.formatShiftReport('Fixture Shop', shift, { invoices: 0, cancelled: 0, edited: 0, revenueUsd: 0, profitUsd: 0, itemDiscountUsd: 0, invoiceDiscountUsd: 0, grossSalesUsd: 0, deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0, refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0, paymentMethods: [], deliveries: [], expenseDetails: [] }, NOW)
    assert.ok(!direct.includes('Amended by'), 'formatShiftReport without options is the report it always was')
    // A name is cleaned like every other value: angle brackets dropped, whitespace collapsed, capped.
    const cleaned = await sent(shift.id, { amendedBy: '  so<k>   dara  ' })
    assert.ok(cleaned.split('\n').includes(`· ${packLabel('both', 'shift_amended_by')}: sok dara`), cleaned)
  })

  await section('3. the route passes the amender\'s name only (never a phone or email), and only the amend send passes one', async () => {
    const routes = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8').replace(/\r\n/g, '\n')
    const calls = routes.split('\n').filter((line) => /sendTelegramShiftReport\(c\.env, /.test(line))
    assert.equal(calls.length, 7, 'open x2, close x2, cancel, reopen, amend')
    const passing = calls.filter((line) => /amendedBy/.test(line))
    assert.equal(passing.length, 1, 'only one send names an amender')
    assert.match(passing[0], /\{ amendedBy: actorName \}/, 'the amender is the handler\'s actorName')
    const handler = routes.slice(routes.indexOf("app.patch('/:id'"))
    assert.ok(handler.includes(passing[0].trim()), 'and it is the PATCH /:id handler')
    // actorName is the very name the amendment record stores, so the chat and the app agree.
    assert.match(handler, /const actorName = displayName\(user\)/)
    assert.match(handler, /INSERT INTO shift_session_amendments \(shift_session_id, actor_user_id, actor_name,[\s\S]*?params: \{ id, actorId: user\.id, actorName, reason,/, 'the amendment record stores the same actorName')
    assert.ok(!/\.(phone|email)\b|phone_lookup/.test(handler), 'the amend handler never reads a phone or an email')
    // displayName is the username (the full name only for an account with none): no phone, no email.
    const displayNameSource = routes.match(/function displayName\(user: SessionUser\)[^\n]*/)[0]
    assert.equal(displayNameSource, 'function displayName(user: SessionUser): string | null { return user.username || user.name || null }')
    const displayName = new Function(`${ts.transpileModule(displayNameSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText}; return displayName`)()
    // Whatever else the session user carries never reaches the chat: only the name is passed on.
    const sessionUser = { id: 9, username: 'sok', name: 'Sok Dara', phone: '+85512345678', email: 'sok@example.com' }
    assert.equal(displayName(sessionUser), 'sok')
    setLanguage('both')
    const text = await sent(shift.id, { amendedBy: displayName(sessionUser) })
    for (const secret of ['+85512345678', '12345678', 'sok@example.com', 'example.com', 'Sok Dara']) assert.ok(!text.includes(secret), `${secret} must not reach the chat\n${text}`)
  })

  await section('4. the three cash rows survive the amend line, in order, $0 included', async () => {
    setLanguage('both')
    const text = await sent(shift.id, { amendedBy: 'sok' })
    const rows = text.split('\n')
    const at = rows.indexOf(`· ${packLabel('both', 'shift_opening_cash')}: $50.00 · 100,000៛`)
    assert.ok(at >= 0, text)
    assert.deepEqual(rows.slice(at, at + 3), [
      `· ${packLabel('both', 'shift_opening_cash')}: $50.00 · 100,000៛`,
      `· ${packLabel('both', 'shift_additional_cash')}: $0.00 · 0៛`,
      `· ${packLabel('both', 'shift_counted_cash')}: $182.50 · 240,000៛`,
    ])
  })

  if (failures.length) {
    console.log(`\n${failures.length} section(s) FAILED:`)
    for (const failure of failures) console.log(`\n--- ${failure.name} ---\n${failure.message}`)
    process.exit(1)
  }
  console.log('test-telegram-shift-amend-actor-pure: all sections ok')
})().catch((error) => { console.error(error); process.exit(1) })
