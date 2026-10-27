const productStockGuard = require('./harness/product_stock_guard.cjs')
// 13 Oct 2026, owner: "for the shift i don't see additional used in telegram. we
// have the opening closing and additional used."
//
// The drawer has THREE registered cash figures, in this order (owner, 14 Sep
// 2026: opening -> additional -> closing): Opening, Additional change used (the
// extra change money put in mid-shift and spent), and Closing counted. The shift
// report printed the additional row ONLY when it was non-zero, so every shift
// that never needed more change showed Opening and Closing with the middle line
// missing -- the owner saw "opening, closing" and no additional. The Summary
// topic overview that follows a close carried no cash figures at all; the owner's
// 13 Oct ruling (item 14: "Both: overview + app") gave it the closing shift's Cash
// count, so section 8a below now requires all three rows there, $0 included
// (test-telegram-shift-overview-pure.cjs pins the section's exact text).
//
// This pins, for every shift report the chat receives:
//   * the three rows are ALWAYS there, in that order, in the existing money
//     format -- an additional of 0 reads `$0.00 · 0៛`, never a missing line;
//   * an OPEN shift still has no closing row (no count was taken);
//   * a non-zero additional shows its own amounts, per currency;
//   * the labels are the app's own words (frontend lang packs), in en, km, both.
//
// Paths covered (the matrix is in the lane record):
//   shift OPEN, CLOSE (both routes), AMEND, REOPEN, CANCEL -> sendTelegramShiftReport
//   `/shift [date]`                                           -> telegramCommandReply
//   the Summary-topic overview after a close                  -> formatShiftOverview (the closing shift's Cash count)
//   `/report` and "Send today's summary"                      -> formatDaySummary (carries no shift cash)
//
// Nothing is sent: the Telegram API is a local recorder installed before any
// module runs, and every assertion is on the composed text. Each section is
// independent, so a RED run lists every broken path rather than the first.
//
// Run (from cloudflare/): node scripts/test-telegram-shift-additional-cash-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

// The API stand-in comes first, so no code path below can reach the network.
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

const pack = {
  en: require(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json')),
  km: require(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json')),
}
const NOW = Date.parse('2026-09-20T12:00:00Z')
const ENV = { TELEGRAM_BOT_TOKEN: 'TEST-TOKEN' }

// ---- the fixture ---------------------------------------------------------------
// One shift per business day so `/shift <day>` answers exactly one block.
// Fake numbers throughout: opening $50.00 · 100,000៛, counted $182.50 · 240,000៛.
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

/** What the chat receives when a route calls sendTelegramShiftReport(env, id): open, close, amend, reopen, cancel. */
async function sentShiftReport(id) {
  const before = posts.length
  assert.equal(await telegram.sendTelegramShiftReport(ENV, id, NOW), true, `shift ${id} was not sent`)
  assert.equal(posts.length, before + 1, 'exactly one message per call')
  return posts[posts.length - 1].text
}
/** What `/shift <day>` answers. */
const shiftCommand = (shift) => telegram.telegramCommandReply({}, `/shift ${shift.business_date.slice(8)}/09/2026`, NOW, 'both')

// ---- reading a message ---------------------------------------------------------
const rowsOf = (text) => text.split('\n').reduce((joined, line) => {
  if (line.startsWith(lang.HANGING_INDENT) && joined.length) joined[joined.length - 1] += ` ${line.trim()}`
  else joined.push(line)
  return joined
}, [])
const KEYS = ['cashOpen', 'additionalCash', 'cashEnd']
/** The row for a label key, or undefined. Matches the whole label, so 'Opening cash' is never 'Expected cash'. */
const rowFor = (text, key, mode = 'both') => {
  const previous = lang.getTelegramLanguage()
  lang.setTelegramLanguage(mode)
  try {
    const prefix = `${lang.ROW_BULLET}${lang.label(key)}: `
    return rowsOf(text).find((row) => row.startsWith(prefix))
  } finally { lang.setTelegramLanguage(previous) }
}
const valueOf = (text, key, mode) => { const row = rowFor(text, key, mode); return row === undefined ? undefined : row.slice(row.indexOf(': ') + 2) }
const indexOfRow = (text, key, mode) => { const row = rowFor(text, key, mode); return row === undefined ? -1 : rowsOf(text).indexOf(row) }
/** The registered rows are all there, opening < additional < closing. `closing: false` = an open shift. */
function registeredRowsOk(text, { closing, mode } = {}) {
  const open = indexOfRow(text, 'cashOpen', mode); const added = indexOfRow(text, 'additionalCash', mode); const end = indexOfRow(text, 'cashEnd', mode)
  if (open < 0 || added < 0) return false
  if (!(open < added)) return false
  if (closing) return end > added
  return end === -1
}

;(async () => {
  const failures = []
  /** One named section; a failure is recorded and the next section still runs, so a RED run shows every broken path at once. */
  const section = async (name, run) => {
    try { await run(); console.log(`PASS [${name}]`) } catch (error) {
      failures.push({ name, message: String((error && error.message) || error).split('\n').slice(0, 14).join('\n') })
      console.log(`FAIL [${name}]`)
    }
  }

  const zero = seed()
  const some = seed({ additional_cash_usd: 12.5, additional_cash_khr: 8000 })
  const usdOnlyShift = seed({ additional_cash_usd: 7.5, additional_cash_khr: 0 })
  const khrOnlyShift = seed({ additional_cash_usd: 0, additional_cash_khr: 20000 })
  const open = seed({ closed_at: null, closing_counted_usd: null, closing_counted_khr: null })
  const nullShift = seed({ additional_cash_usd: null, additional_cash_khr: null })
  const unregisteredShift = seed({ opening_float_usd_registered: 0, opening_float_khr_registered: 0 })
  const cancelledShift = seed({ cancelled_at: '2026-09-20T05:00:00.000Z', cancelled_by_user_name: 'Admin', cancel_reason: 'Opened by mistake' })
  const amended = seed()
  const reopened = seed({ closed_at: null, closing_counted_usd: null, closing_counted_khr: null, opening_float_usd: 0, opening_float_khr: 0 })

  await section('0. labels are the app packs\' own words', async () => {
    assert.deepEqual(
      [lang.TELEGRAM_LABELS.cashOpen, lang.TELEGRAM_LABELS.additionalCash, lang.TELEGRAM_LABELS.cashEnd],
      [
        { en: pack.en.shift_opening_cash, km: pack.km.shift_opening_cash },
        { en: pack.en.shift_additional_cash, km: pack.km.shift_additional_cash },
        { en: pack.en.shift_counted_cash, km: pack.km.shift_counted_cash },
      ])
    assert.equal(pack.en.shift_additional_cash, pack.en.shift_recon_additional_cash)
    assert.equal(pack.km.shift_additional_cash, pack.km.shift_recon_additional_cash)
  })

  await section('1. close push, additional = 0: three rows in order, middle reads $0.00 · 0៛', async () => {
    const text = await sentShiftReport(zero.id)
    console.log(`--- closed shift, additional 0 ---\n${text}\n---`)
    assert.ok(registeredRowsOk(text, { closing: true }), text)
    assert.equal(valueOf(text, 'cashOpen'), '$50.00 · 100,000៛')
    assert.equal(valueOf(text, 'additionalCash'), '$0.00 · 0៛')
    assert.equal(valueOf(text, 'cashEnd'), '$182.50 · 240,000៛')
  })

  await section('2. close push, additional > 0: the exact amounts per currency', async () => {
    const text = await sentShiftReport(some.id)
    assert.ok(registeredRowsOk(text, { closing: true }), text)
    assert.equal(valueOf(text, 'additionalCash'), '$12.50 · 8,000៛')
    const usdOnly = await sentShiftReport(usdOnlyShift.id)
    assert.equal(valueOf(usdOnly, 'additionalCash'), '$7.50 · 0៛')
    const khrOnly = await sentShiftReport(khrOnlyShift.id)
    assert.equal(valueOf(khrOnly, 'additionalCash'), '$0.00 · 20,000៛')
    assert.ok(registeredRowsOk(usdOnly, { closing: true }) && registeredRowsOk(khrOnly, { closing: true }))
    // The same figure moves the expected drawer (no sales in this fixture): 50 -> 62.50.
    assert.equal(valueOf(text, 'expectedCash'), '$62.50 · 108,000៛', text)
  })

  await section('3. shift-open push: opening + additional (0), still no closing row', async () => {
    const text = await sentShiftReport(open.id)
    console.log(`--- open shift ---\n${text}\n---`)
    assert.ok(registeredRowsOk(text, { closing: false }), text)
    assert.equal(valueOf(text, 'additionalCash'), '$0.00 · 0៛')
    assert.ok(indexOfRow(text, 'additionalCash') < indexOfRow(text, 'expectedCash'), 'additional comes before the expected drawer')
  })

  await section('4. data path: NULL columns read as 0; unregistered opening stays N/A; cancel push has all three', async () => {
    // A column that is NULL (a row from a caller that never set it) is "none was added", not "unknown".
    const nullText = await sentShiftReport(nullShift.id)
    assert.equal(valueOf(nullText, 'additionalCash'), '$0.00 · 0៛')
    // An opening nobody registered stays N/A (unknown is not zero); the additional row is independent of it.
    const unregistered = await sentShiftReport(unregisteredShift.id)
    assert.equal(valueOf(unregistered, 'cashOpen'), 'N/A · N/A')
    assert.equal(valueOf(unregistered, 'additionalCash'), '$0.00 · 0៛')
    assert.ok(registeredRowsOk(unregistered, { closing: true }))
    const cancelled = await sentShiftReport(cancelledShift.id)
    assert.ok(registeredRowsOk(cancelled, { closing: true }), cancelled)
  })

  // routes/shifts.ts PATCH /:id writes the new additional in its batch, reads the row
  // back, and then calls sendTelegramShiftReport(saved.id) -- the same call as above.
  await section('5. amend and reopen: the re-sent report carries the saved additional', async () => {
    const beforeAmend = await sentShiftReport(amended.id)
    assert.equal(valueOf(beforeAmend, 'additionalCash'), '$0.00 · 0៛')
    sql.prepare('UPDATE shift_sessions SET additional_cash_usd = 15, additional_cash_khr = 30000 WHERE id = ?').run(amended.id)
    const afterAmend = await sentShiftReport(amended.id)
    assert.equal(valueOf(afterAmend, 'additionalCash'), '$15.00 · 30,000៛')
    assert.ok(registeredRowsOk(afterAmend, { closing: true }))
    // A reopened shift is a NEW segment row: a fresh opening, additional 0, no count yet.
    const reopenReport = await sentShiftReport(reopened.id)
    assert.ok(registeredRowsOk(reopenReport, { closing: false }), reopenReport)
    assert.equal(valueOf(reopenReport, 'additionalCash'), '$0.00 · 0៛')
  })

  await section('6. /shift [date]: the same three rows and the same text as the close push', async () => {
    const viaCommand = await shiftCommand(zero)
    assert.ok(registeredRowsOk(viaCommand, { closing: true }), viaCommand)
    assert.equal(valueOf(viaCommand, 'additionalCash'), '$0.00 · 0៛')
    assert.ok(registeredRowsOk(await shiftCommand(open), { closing: false }))
    assert.equal(viaCommand, await sentShiftReport(zero.id), '`/shift` and the close push are the same composer for the same row')
  })

  // Rows composed from the app packs' words, not re-typed Khmer.
  const expectedRows = (mode) => {
    const word = (entry) => (mode === 'en' ? entry.en : mode === 'km' ? entry.km : `${entry.en}${lang.BILINGUAL_SEPARATOR}${entry.km}`)
    return [
      `· ${word({ en: pack.en.shift_opening_cash, km: pack.km.shift_opening_cash })}: $50.00 · 100,000៛`,
      `· ${word({ en: pack.en.shift_additional_cash, km: pack.km.shift_additional_cash })}: $0.00 · 0៛`,
      `· ${word({ en: pack.en.shift_counted_cash, km: pack.km.shift_counted_cash })}: $182.50 · 240,000៛`,
    ]
  }
  await section('7. shift report in en, km and both: three adjacent rows with the packs\' words', async () => {
    try {
      for (const mode of ['en', 'km', 'both']) {
        setLanguage(mode)
        const text = await sentShiftReport(zero.id)
        const rows = rowsOf(text)
        const at = rows.indexOf(expectedRows(mode)[0])
        assert.ok(at >= 0, `[${mode}] no opening row:\n${text}`)
        assert.deepEqual(rows.slice(at, at + 3), expectedRows(mode), `[${mode}] the three rows, adjacent and in order:\n${text}`)
        if (mode === 'en') assert.ok(!/[ក-៿]/.test(text.replace(/៛/g, '')), 'en mode carries no Khmer word')
        if (mode === 'km') assert.ok(!/Additional change used|Opening cash|Closing cash/.test(text), 'km mode carries no English label')
      }
    } finally { setLanguage('both') }
  })

  // The Summary-topic overview (T10) is the DAY's Reports overview for the closing shift's
  // branch. Its default shape was five sections (the owner's 29 Sep 2026 "overview only by
  // default"); the owner's 13 Oct ruling (item 14) added the closing shift's Cash count as
  // the sixth, so the three drawer rows are ALWAYS there, $0 included -- never none, never
  // a partial set.
  await section('8a. Summary-topic overview: always all three rows (the closing shift\'s Cash count)', async () => {
    const text = telegram.formatShiftOverview('Fixture Shop', zero, {
      revenueUsd: 412.5, profitUsd: 150.25, grossSalesUsd: 450, itemDiscountUsd: 0, invoiceDiscountUsd: 0,
      deliveryFeeUsd: 0, creditUsd: 0, refundUsd: 0, invoices: 18, cancelled: 1,
      paymentMethods: [{ method: 'Cash', count: 12, usd: 300 }],
      expenses: { fees: { usd: 0, khr: 0 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 } },
      unbranchedFees: null, returns: { count: 0, refundUsd: 0 },
    }, undefined, NOW)
    const present = KEYS.filter((key) => rowFor(text, key) !== undefined)
    assert.equal(present.length, 3, `all three drawer rows, none missing:\n${text}`)
    assert.ok(registeredRowsOk(text, { closing: true }), text)
  })

  // They are the shop-wide day summary: no single drawer to describe. If a later change
  // ever adds shift cash there, it must add all three rows, not one or two.
  await section('8b. /report day summary: no shift cash row, or all three (never a partial set)', async () => {
    const dayText = telegram.formatDaySummary({
      date: '2026-09-20',
      sales: { count: 3, usd: 50, cancelled: 0, refundUsd: 0, profitUsd: 30, deliveryFeeUsd: 0, creditUsd: 0, deliveryCostUsd: 0 },
      fees: null, stockIn: null, stockOut: null,
    }, [{ cashier: 'Za', count: 3, usd: 50 }])
    const present = KEYS.filter((key) => rowFor(dayText, key) !== undefined)
    assert.ok(present.length === 0 || present.length === 3, dayText)
  })

  await section('9. structure: one composer per row, one column list, seven route call sites', async () => {
    const telegramSource = fs.readFileSync(path.join(root, 'src', 'lib', 'telegram.ts'), 'utf8')
    const routesSource = fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8')
    const occurrences = (source, pattern) => (source.match(pattern) || []).length
    assert.equal(occurrences(telegramSource, /labeled\('cashOpen'/g), 1, 'the opening row is composed in exactly one place (every message that carries a drawer shares it)')
    assert.equal(occurrences(telegramSource, /labeled\('additionalCash'/g), 1, 'the additional row is composed in exactly one place')
    assert.equal(occurrences(telegramSource, /labeled\('cashEnd'/g), 1, 'the closing row is composed in exactly one place')
    const at = telegramSource.indexOf('const SHIFT_COLUMNS = `')
    const columns = telegramSource.slice(at, telegramSource.indexOf('/**', at))
    assert.match(columns, /additional_cash_usd,\s*additional_cash_khr/, 'SHIFT_COLUMNS selects both additional-cash columns')
    assert.match(telegramSource, /OVERVIEW_SHIFT_COLUMNS = `revision, \$\{SHIFT_COLUMNS\}`/, 'the overview reads the same columns')
    assert.equal(occurrences(telegramSource, /SELECT \$\{OVERVIEW_SHIFT_COLUMNS\} FROM shift_sessions/g), 1, 'the overview delivery selects the overview column list')
    assert.equal(occurrences(telegramSource, /SELECT \$\{SHIFT_COLUMNS\} FROM shift_sessions/g), 3, 'the close push, the stale-drawer alert and /shift read through SHIFT_COLUMNS')
    // Every route that announces a shift hands the report the saved shift's id AFTER its write.
    const calls = routesSource.split('\n').filter((line) => /sendTelegramShiftReport\(c\.env, /.test(line))
    assert.equal(calls.length, 7, 'open x2, close x2, cancel, reopen, amend')
    assert.ok(!/cashOpen|cashEnd|\blabeled\(|\blabel\(/.test(routesSource), 'no route composes shift cash text of its own')
  })

  await section('10. discriminating: a dropped row, a swapped order, an open shift with a closing row all fail the predicate', async () => {
    // Built from the shift report itself, so the predicate is exercised against a real message.
    const good = await sentShiftReport(some.id)
    assert.ok(registeredRowsOk(good, { closing: true }), 'the predicate needs a good message to be tested against')
    // (a) the previous behaviour: the additional row dropped.
    const dropped = good.split('\n').filter((line) => !line.startsWith(`${lang.ROW_BULLET}${lang.label('additionalCash')}:`)).join('\n')
    assert.equal(registeredRowsOk(dropped, { closing: true }), false)
    // (b) the row printed after the closing count (the order the owner rejected on 14 Sep).
    const lines = good.split('\n')
    const a = lines.findIndex((line) => line.startsWith(`${lang.ROW_BULLET}${lang.label('additionalCash')}:`))
    const e = lines.findIndex((line) => line.startsWith(`${lang.ROW_BULLET}${lang.label('cashEnd')}:`));
    [lines[a], lines[e]] = [lines[e], lines[a]]
    assert.equal(registeredRowsOk(lines.join('\n'), { closing: true }), false)
    // (c) an open shift that grew a closing row.
    assert.equal(registeredRowsOk(good, { closing: false }), false)
  })

  if (failures.length) {
    console.log(`\n${failures.length} section(s) FAILED:`)
    for (const failure of failures) console.log(`\n--- ${failure.name} ---\n${failure.message}`)
    process.exit(1)
  }
  console.log('test-telegram-shift-additional-cash-pure: all sections ok')
})().catch((error) => { console.error(error); process.exit(1) })
