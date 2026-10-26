const productStockGuard = require('./harness/product_stock_guard.cjs')
// T10 (owner, 23 Sep 2026): "One minute after a shift closes, the Reports
// overview is sent to Telegram too" -- a Free-plan path, a Paid path with
// automatic fallback, and ONE send per shift.
//
// Pure: the REAL lib/telegram.ts and lib/telegramLang.ts over an in-memory
// SQLite that carries the REAL migration 0194. The Telegram API is a local
// function that records the text it is given; nothing leaves this process.
// The kernel (getSalesTotals / getSalesGroupedTotals) is a recording stub so
// the test can prove the message prints the kernel's figure for exactly the
// filters GET /api/reports/overview would use.
//
// What it pins:
//   1. The message text, exactly, in 'en' and 'km' (and the 'both' title and
//      section headers): `=====Name=====` sections, `·` rows.
//   2. Paid path: a close schedules one delayed queue message (delaySeconds
//      60) and one pending row, before anything is sent.
//   3. Free / fallback path: no queue binding, or a queue send that throws,
//      leaves a fallback row that the drain sends once it is due, not before.
//   4. Exactly one send across a duplicate queue delivery, the drain racing
//      the queue, a retried schedule, and a failed Telegram call that is
//      retried. A reopen + reclose is a NEW segment and sends once more.
//   5. The toggle: off at schedule time schedules nothing; off by send time
//      sends nothing. Automation off wins over both.
//   6. Revenue parity: the kernel is called with the Overview's own filters,
//      and the fees/returns clauses are routes/reports.ts reportRecordRange's.
//   7. Fees with no branch (R-telegram X1, FX-exc1 28 Sep 2026): a branch's
//      overview prints the day's on their own row beside -- never inside --
//      its expense total and delivery split; the all-branches overview counts
//      them in its own totals and prints no such row.
//   8. Cash count (owner, 13 Oct 2026, item 14: "we have the opening closing
//      and additional used", shown everywhere and always, $0 included): the
//      closing shift's drawer -- Opening, Additional change used and Closing,
//      in that order and in the packs' words -- with nothing added
//      (`$0.00 · 0៛`), with an amount, a NULL column, and read from the stored
//      row at send time. The section is the SHIFT's, not the day's: it is the
//      drawer of the shift the header names (the ID is printed once, there), and
//      it is not summed across the day's tills. Two tills closing within the same
//      minute each get their own drawer through the REAL delivery path, whichever
//      order the sends run in (the day's latest or first closed shift is not it).
//
// Run (from cloudflare/): node scripts/test-telegram-shift-overview-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { if (request === './productStockGuard') return productStockGuard; return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, sourcePath, path.dirname(sourcePath)) }
  finally { Module._load = original }
  return mod.exports
}

// ---- database ---------------------------------------------------------------
const sqlite = new Database(':memory:')
sqlite.exec(fs.readFileSync(path.join(root, 'migrations', '0194_telegram_scheduled_sends.sql'), 'utf8'))
sqlite.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE shift_sessions (
    id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, shift_code TEXT, scope_mode TEXT, user_id INTEGER, user_name TEXT,
    branch_id INTEGER, branch_name TEXT, business_date TEXT, opened_at TEXT,
    opening_float_usd REAL, opening_float_khr REAL, opening_float_usd_registered INTEGER DEFAULT 1, opening_float_khr_registered INTEGER DEFAULT 1,
    additional_cash_usd REAL, additional_cash_khr REAL, closed_at TEXT, closing_counted_usd REAL, closing_counted_khr REAL,
    cancelled_at TEXT, cancelled_by_user_name TEXT, cancel_reason TEXT, parent_shift_id INTEGER
  );
  CREATE TABLE fees (id INTEGER PRIMARY KEY, branch_id INTEGER, fee_date TEXT, fee_type TEXT, amount_usd REAL, amount_khr REAL, created_at TEXT, sale_id INTEGER);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, branch_id INTEGER, created_at TEXT, status TEXT, return_scope TEXT, reason TEXT, total_refund_usd REAL, total_refund_khr REAL);
  CREATE TABLE sales (id INTEGER PRIMARY KEY, branch_id INTEGER, created_at TEXT, sale_status TEXT, delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL);
  INSERT INTO settings VALUES ('business_name', 'Leang Cosmetics'), ('telegram_chat_id', '-1001234567890');
  -- The shift's day and branch: 5.00 + 4,000៛ of expenses...
  INSERT INTO fees VALUES (1, 1, '2026-09-23', 'expense', 5, 4000, '2026-09-23T03:00:00Z', NULL);
  -- ...and nothing from another branch or another day.
  INSERT INTO fees VALUES (2, 2, '2026-09-23', 'expense', 99, 0, '2026-09-23T03:00:00Z', NULL);
  INSERT INTO fees VALUES (3, 1, '2026-09-22', 'expense', 77, 0, '2026-09-22T03:00:00Z', NULL);
  -- A shop-wide fee with no branch on the day (R-telegram X1: the branch
  -- overview dropped it without a trace), typed delivery so the delivery
  -- split is seen to stay the branch's own; and one on another day.
  INSERT INTO fees VALUES (4, NULL, '2026-09-23', 'delivery', 2, 1000, '2026-09-23T04:00:00Z', NULL);
  INSERT INTO fees VALUES (5, NULL, '2026-09-22', 'expense', 66, 0, '2026-09-22T04:00:00Z', NULL);
  -- The courier money paid on the day's sales on the branch: 2.50 + 2.00
  -- (the second one at 00:30 local on the 23rd). The kernel stub below
  -- answers the same 4.50. Another branch, another day and a cancelled
  -- sale stay out of the Expenses.
  INSERT INTO sales VALUES (1, 1, '2026-09-23T04:00:00Z', 'completed', 2.5, NULL);
  INSERT INTO sales VALUES (2, 1, '2026-09-22T17:30:00Z', 'completed', 2, NULL);
  INSERT INTO sales VALUES (3, 2, '2026-09-23T04:00:00Z', 'completed', 60, NULL);
  INSERT INTO sales VALUES (4, 1, '2026-09-22T04:00:00Z', 'completed', 70, NULL);
  INSERT INTO sales VALUES (5, 1, '2026-09-23T05:00:00Z', 'cancelled', 80, NULL);
  -- Two customer returns taken on the day (local UTC+7; 17:30Z on the 22nd is
  -- 00:30 on the 23rd), one cancelled return, one on another branch. Each
  -- carries its riel twin at 4,100, as every writer stores a refund.
  INSERT INTO returns VALUES (1, 1, '2026-09-22T17:30:00Z', 'completed', 'customer', 'Damaged', 7.5, 30750);
  INSERT INTO returns VALUES (2, 1, '2026-09-23T09:00:00Z', 'completed', NULL, '', 2.5, 10250);
  INSERT INTO returns VALUES (3, 1, '2026-09-23T09:10:00Z', 'cancelled', 'customer', '', 40, 164000);
  INSERT INTO returns VALUES (4, 2, '2026-09-23T09:20:00Z', 'completed', 'customer', '', 60, 246000);
`)
const preparedSql = []
function d1() {
  const translate = (sql, params = {}) => {
    const values = []
    return { sql: sql.replace(/@(\w+)/g, (_m, key) => { values.push(params[key] ?? null); return '?' }), values }
  }
  return {
    prepare(sql) {
      preparedSql.push(sql)
      return {
        async get(params) { const q = translate(sql, params); return sqlite.prepare(q.sql).get(...q.values) },
        async all(params) {
          if (Array.isArray(params)) return sqlite.prepare(sql).all(...params)
          const q = translate(sql, params); return sqlite.prepare(q.sql).all(...q.values)
        },
        async run(params) { const q = translate(sql, params); const info = sqlite.prepare(q.sql).run(...q.values); return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) } },
      }
    },
  }
}

// ---- modules ----------------------------------------------------------------
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const telegramLang = loadReal('lib/telegramLang.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const dbModule = { getDb: () => d1() }
const salesAnalyticsReal = loadReal('lib/salesAnalytics.ts', { './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': dbModule, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })

// The kernel's answer for the shift's day and branch. Recorded, so the test
// can say which filters it was asked with.
const KERNEL_TOTALS = {
  revenue_usd: 412.5, profit_usd: 150.25, gross_sales_usd: 450, item_discount_usd: 12.5, discount_usd: 25,
  delivery_usd: 6, pending_revenue_usd: 40, not_paid_owed_usd: 40, refund_usd: 10, tx_count: 18, cancelled_tx_count: 1,
  delivery_actual_cost_usd: 4.5, delivery_actual_cost_count: 2,
}
const KERNEL_PAYMENTS = [
  { key: 'cash', label: 'Cash', tx_count: 12, revenue_usd: 300 },
  { key: 'aba', label: 'ABA Pay', tx_count: 6, revenue_usd: 112.5 },
]
const kernelCalls = []
const salesAnalytics = {
  ...salesAnalyticsReal,
  getSalesTotals: async (_env, filters) => { kernelCalls.push(['totals', filters]); return { ...KERNEL_TOTALS } },
  getSalesGroupedTotals: async (_env, filters, groupBy) => { kernelCalls.push(['grouped', filters, groupBy]); return KERNEL_PAYMENTS.map((row) => ({ ...row })) },
}
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': dbModule })
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': dbModule, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './db': dbModule, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
  './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange,
  './shiftReconciliation': shiftReconciliation,
})

// ---- the Telegram API, locally ---------------------------------------------
// A stand-in for fetch: it records the text and never opens a socket.
const posts = []
let failNextPosts = 0
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botTEST-TOKEN/sendMessage'), `unexpected fetch ${url}`)
  if (failNextPosts > 0) { failNextPosts -= 1; return { ok: false, status: 502, text: async () => 'Bad Gateway' } }
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}
const queued = []
const queue = (behaviour = 'ok') => ({
  async send(body, options) {
    if (behaviour === 'throw') throw new Error('queue unavailable')
    queued.push({ body, options })
  },
})

let passed = 0
const check = (label, cond, detail) => { assert.ok(cond, detail ? `${label}\n${detail}` : label); passed += 1; console.log(`PASS ${label}`) }
const setting = (key, value) => sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
const clearSetting = (key) => sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key)
const rowFor = (key) => sqlite.prepare('SELECT * FROM telegram_scheduled_sends WHERE send_key = ?').get(key)

const CLOSED_AT = '2026-09-23T11:30:00.000Z' // 18:30 local
const T0 = Date.parse(CLOSED_AT)
let nextShiftId = 40
function closedShift(extra = {}) {
  nextShiftId += 1
  const shift = {
    id: nextShiftId, revision: 3, shift_code: 'S-20260923-0807-Za', scope_mode: 'per_account', user_id: 7, user_name: 'Za',
    branch_id: 1, branch_name: 'Toul Kork', business_date: '2026-09-23', opened_at: '2026-09-23T01:07:00.000Z',
    opening_float_usd: 10, opening_float_khr: 10000, closed_at: CLOSED_AT, closing_counted_usd: 120, closing_counted_khr: 50000, ...extra,
  }
  const columns = Object.keys(shift)
  sqlite.prepare(`INSERT INTO shift_sessions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((c) => shift[c]))
  return shift
}

async function main() {
  const envPaid = { DB: {}, TELEGRAM_BOT_TOKEN: 'TEST-TOKEN', BACKUP_QUEUE: queue() }
  const envFree = { DB: {}, TELEGRAM_BOT_TOKEN: 'TEST-TOKEN' }

  // ---- 1. the text -------------------------------------------------------
  const shift = closedShift()
  const figures = await telegram.shiftOverviewFigures(envPaid, shift)
  const render = (mode) => {
    const previous = telegramLang.getTelegramLanguage()
    telegramLang.setTelegramLanguage(mode)
    try { return telegram.formatShiftOverview('Leang Cosmetics', shift, figures, undefined, T0 + 60_000) } finally { telegramLang.setTelegramLanguage(previous) }
  }
  const en = render('en').split('\n')
  const km = render('km').split('\n')
  const both = render('both').split('\n')
  console.log(`--- en ---\n${en.join('\n')}\n--- km ---\n${km.join('\n')}\n--- both ---\n${both.join('\n')}\n---`)
  assert.deepStrictEqual(en, [
    '📈 Reports overview: 23/09/2026',
    '· Shop: Leang Cosmetics',
    '· Branch: Toul Kork',
    '· Cashier: Za',
    '· ID: S-20260923-0807-Za',
    '· Open: 23/09/2026 08:07',
    '· Close: 23/09/2026 18:30',
    '=====Sales=====',
    '· Revenue: $412.50',
    '· Discount on items: $12.50',
    '· Discount on invoices: $25.00',
    '· Gross sales: $450.00',
    '· Profit: $150.25',
    '· Delivery fee: $6.00',
    '· Still owed: $40.00',
    '· Refunds: $10.00',
    '=====Invoices=====',
    '· Total: 18 · Cancelled: 1',
    '=====Payment methods=====',
    '· Cash: 12 · $300.0000',
    '· ABA Pay: 6 · $112.5000',
    // The closing shift's drawer (owner, 13 Oct 2026): Opening, Additional
    // change used, Closing -- always all three, even with nothing added. The
    // shift is the one the ID row above names; it is not printed twice.
    '=====Cash count=====',
    '· Opening cash: $10.00 · 10,000៛',
    '· Additional change used: $0.00 · 0៛',
    '· Closing cash: $120.00 · 50,000៛',
    '=====Expenses=====',
    '· Actual delivery cost: $4.50',
    '· Other expenses: $5.00 · 4,000៛',
    '· Total: $9.50 · 4,000៛',
    '· No branch (not in total): $2.00 · 1,000៛',
    '=====Returns=====',
    '· Total: 2 · $10.00',
  ])
  check('EN: the overview text, line for line', true)
  assert.deepStrictEqual(km, [
    '📈 ទិដ្ឋភាពរួមរបាយការណ៍: 23/09/2026',
    '· ហាង: Leang Cosmetics',
    '· សាខា: Toul Kork',
    '· អ្នកគិតប្រាក់: Za',
    '· សម្គាល់: S-20260923-0807-Za',
    '· បើក: 23/09/2026 08:07',
    '· បិទ: 23/09/2026 18:30',
    '=====ការលក់=====',
    '· ចំណូល: $412.50',
    '· ការបញ្ចុះតម្លៃលើទំនិញ: $12.50',
    '· ការបញ្ចុះតម្លៃលើវិក្កយបត្រ: $25.00',
    '· ការលក់សរុប: $450.00',
    '· ចំណេញ: $150.25',
    '· ថ្លៃដឹក: $6.00',
    '· ប្រាក់នៅជំពាក់: $40.00',
    '· ការសងប្រាក់: $10.00',
    '=====វិក្កយបត្រ=====',
    '· សរុប: 18 · បានបោះបង់: 1',
    '=====វិធីទូទាត់=====',
    '· Cash: 12 · $300.0000',
    '· ABA Pay: 6 · $112.5000',
    '=====ការរាប់សាច់ប្រាក់=====',
    '· សាច់ប្រាក់ដើមវេន: $10.00 · 10,000៛',
    '· ប្រាក់អាប់បន្ថែមដែលបានប្រើ: $0.00 · 0៛',
    '· សាច់ប្រាក់បិទវេន: $120.00 · 50,000៛',
    '=====ចំណាយ=====',
    '· ថ្លៃដឹកដើម: $4.50',
    '· ចំណាយផ្សេងទៀត: $5.00 · 4,000៛',
    '· សរុប: $9.50 · 4,000៛',
    '· គ្មានសាខា (មិនរាប់ក្នុងសរុប): $2.00 · 1,000៛',
    '=====ការប្រគល់មកវិញ=====',
    '· សរុប: 2 · $10.00',
  ])
  check('KM: the overview text, line for line, Khmer labels from the packs', true)
  check('both: the title carries both languages', both[0] === '📈 Reports overview/ទិដ្ឋភាពរួមរបាយការណ៍: 23/09/2026', both[0])
  const headers = both.filter((line) => /^=+[^=].*[^=]=+$/.test(line))
  const expectedHeaders = ['sales', 'invoices', 'paymentMethods', 'cashCount', 'expenses', 'returns'].map((key) => telegram.sectionHeader(key, telegramLang.REPORT_SECTION_EDGE))
  check('both: six `=====Name=====` sections (Cash count of the closing shift among them), drawn by the shared sectionHeader (fewer marks when six would wrap)',
    JSON.stringify(headers) === JSON.stringify(expectedHeaders) && headers.includes('=====Payment methods/វិធីទូទាត់====='), headers.join('\n'))
  check('both: every other row is a `·` row', both.slice(1).every((line) => line.startsWith('· ') || headers.includes(line) || line.startsWith('     ')))
  const pack = { en: require(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json')), km: require(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json')) }
  check('the title words are the pack key telegram_reports_overview in both packs',
    pack.en.telegram_reports_overview === 'Reports overview' && pack.km.telegram_reports_overview === telegramLang.TELEGRAM_LABELS.reportsOverview.km)

  // ---- 1b. Cash count: the closing shift's drawer (owner, 13 Oct 2026) -------
  // Item 14: "Opening -> Additional change used -> Closing are always shown,
  // including a $0 additional ... the after-shift Summary overview". The section
  // follows the Payment methods with the closing shift's drawer: the three
  // registered rows. Every other section is the whole day on the branch and a day
  // holds several shifts (one per cashier, plus reopened segments), so the drawer
  // is ONE of them -- the shift the header names (Cashier, ID, Open, Close). The
  // ID is not repeated in the section: the header carries it in every variant. The
  // rows are composed from the pack keys here, not re-typed, so a drifting label
  // fails against the app.
  {
    const word = (mode, key) => (mode === 'en' ? pack.en[key] : mode === 'km' ? pack.km[key] : `${pack.en[key]}${telegramLang.BILINGUAL_SEPARATOR}${pack.km[key]}`)
    const cashRows = (mode, additional) => [
      `· ${word(mode, 'shift_opening_cash')}: $10.00 · 10,000៛`,
      `· ${word(mode, 'shift_additional_cash')}: ${additional}`,
      `· ${word(mode, 'shift_counted_cash')}: $120.00 · 50,000៛`,
    ]
    const overviewFor = (shiftRow, mode, categories) => {
      const previous = telegramLang.getTelegramLanguage()
      telegramLang.setTelegramLanguage(mode)
      try { return telegram.formatShiftOverview('Leang Cosmetics', shiftRow, figures, categories, T0 + 60_000).split('\n') } finally { telegramLang.setTelegramLanguage(previous) }
    }
    // The section title in a mode's own words (its mark count depends on the language).
    const cashHeader = (mode) => {
      const previous = telegramLang.getTelegramLanguage()
      telegramLang.setTelegramLanguage(mode)
      try { return telegram.sectionHeader('cashCount', telegramLang.REPORT_SECTION_EDGE) } finally { telegramLang.setTelegramLanguage(previous) }
    }
    const sectionAfterHeader = (rows, mode, length = 3) => {
      const at = rows.indexOf(cashHeader(mode))
      return at < 0 ? null : rows.slice(at + 1, at + 1 + length)
    }
    for (const mode of ['en', 'km', 'both']) {
      // Nothing added: the row is still there, as zero in the existing money format.
      const zeroRows = overviewFor(shift, mode)
      assert.deepStrictEqual(sectionAfterHeader(zeroRows, mode), cashRows(mode, '$0.00 · 0៛'), `[${mode}] additional = 0\n${zeroRows.join('\n')}`)
      // Something added: its own amounts, per currency.
      const added = { ...shift, additional_cash_usd: 12.5, additional_cash_khr: 8000 }
      assert.deepStrictEqual(sectionAfterHeader(overviewFor(added, mode), mode), cashRows(mode, '$12.50 · 8,000៛'), `[${mode}] additional > 0`)
      const usdOnly = { ...shift, additional_cash_usd: 7.5, additional_cash_khr: 0 }
      const khrOnly = { ...shift, additional_cash_usd: 0, additional_cash_khr: 20000 }
      assert.deepStrictEqual(sectionAfterHeader(overviewFor(usdOnly, mode), mode), cashRows(mode, '$7.50 · 0៛'))
      assert.deepStrictEqual(sectionAfterHeader(overviewFor(khrOnly, mode), mode), cashRows(mode, '$0.00 · 20,000៛'))
      // A NULL column (a caller that never set it) is none added, not unknown.
      assert.deepStrictEqual(sectionAfterHeader(overviewFor({ ...shift, additional_cash_usd: null, additional_cash_khr: null }, mode), mode), cashRows(mode, '$0.00 · 0៛'))
    }
    check('Cash count: Opening -> Additional change used -> Closing, always all three, with the packs\' words (en, km, both; zero, USD, KHR, NULL)', true)

    const rows = overviewFor(shift, 'both')
    const at = (prefix) => rows.findIndex((line) => line.startsWith(prefix))
    check('Cash count sits after Payment methods and before Expenses, so the day\'s money reads first and the drawer next',
      at('=====Payment methods') < at(cashHeader('both')) && at(cashHeader('both')) < at('=====Expenses'), rows.join('\n'))
    check('the section is exactly the three registered rows: Expected and Difference are sales-derived and not repeated here',
      !rows.some((line) => /^· (Expected cash|Difference)\//.test(line)) && sectionAfterHeader(rows, 'both', 4).length === 4 && rows[rows.indexOf(cashHeader('both')) + 4].startsWith('=====Expenses'))
    // The shift ID is printed once -- in the header block -- and not again in the section.
    const idLabel = `${telegramLang.TELEGRAM_LABELS.shift.en} ${telegramLang.TELEGRAM_LABELS.shift.km}`
    check('the shift ID appears once, in the header block under the title, and is not repeated inside the Cash count',
      rows.filter((line) => line.includes(shift.shift_code)).length === 1 && rows.findIndex((line) => line === `· ${idLabel}: ${shift.shift_code}`) < at('=====Sales'), rows.join('\n'))
    // The drawer is a count, not takings: the Sales / Fees switches leave it.
    const switchedOff = overviewFor(shift, 'both', { sales: false, fees: false })
    check('the Sales and Fees category switches do not remove the drawer counts (they are counts, not revenue)',
      JSON.stringify(sectionAfterHeader(switchedOff, 'both')) === JSON.stringify(cashRows('both', '$0.00 · 0៛')) && !switchedOff.some((line) => line.startsWith('· Revenue')), switchedOff.join('\n'))
    // A day with two tills: the overview is the whole day's, the drawer is the closing shift's.
    // Each close sends its own overview and each carries ITS drawer -- neither the other's,
    // and not the two added together. (The delivery path is driven below.)
    const second = { ...shift, id: shift.id + 500, shift_code: 'S-20260923-1130-Sok', user_name: 'Sok', opening_float_usd: 40, opening_float_khr: 0,
      additional_cash_usd: 5, additional_cash_khr: 0, closing_counted_usd: 90, closing_counted_khr: 1000 }
    const secondRows = overviewFor(second, 'en')
    assert.deepStrictEqual(sectionAfterHeader(secondRows, 'en'), [
      '· Opening cash: $40.00 · 0៛', '· Additional change used: $5.00 · 0៛', '· Closing cash: $90.00 · 1,000៛',
    ], secondRows.join('\n'))
    assert.ok(secondRows.includes('· ID: S-20260923-1130-Sok') && secondRows.includes('· Cashier: Sok'), 'and its header names that shift')
    check('two tills on one day: each overview carries its own closing shift\'s drawer under its own header, never the other\'s and never the two summed', true)
    // An overview is only ever sent for a closed shift; handed an open one it must not invent a closing row.
    const openRows = overviewFor({ ...shift, closed_at: null, closing_counted_usd: null, closing_counted_khr: null }, 'both')
    check('an open shift (composed defensively) has the opening and additional rows and no closing row',
      JSON.stringify(sectionAfterHeader(openRows, 'both', 2)) === JSON.stringify(cashRows('both', '$0.00 · 0៛').slice(0, 2))
      && !openRows.some((line) => line.startsWith(`· ${word('both', 'shift_counted_cash')}:`)), openRows.join('\n'))
    // An opening nobody registered stays unknown (N/A), while the additional row stays a measured zero.
    const unregistered = overviewFor({ ...shift, opening_float_usd: null, opening_float_khr: null }, 'en')
    check('an unregistered opening reads N/A and does not hide the additional row',
      JSON.stringify(sectionAfterHeader(unregistered, 'en').slice(0, 2)) === JSON.stringify([`· ${pack.en.shift_opening_cash}: N/A · N/A`, `· ${pack.en.shift_additional_cash}: $0.00 · 0៛`]), unregistered.join('\n'))
  }

  const longName = closedShift({ branch_name: 'Branch with a very long name that wraps', branch_id: 1 })
  const longFigures = { ...figures, paymentMethods: [{ method: 'ABA Pay merchant QR for the Toul Kork branch', count: 3, usd: 45 }] }
  telegramLang.setTelegramLanguage('en')
  const longRows = telegram.formatShiftOverview('Leang Cosmetics', longName, longFigures, undefined, T0).split('\n')
  telegramLang.setTelegramLanguage('both')
  const payAt = longRows.indexOf('=====Payment methods=====')
  check('a long payment row continues on the hanging indent', longRows[payAt + 1].startsWith('· ') && longRows[payAt + 2].startsWith('     '), longRows.slice(payAt, payAt + 4).join('\n'))

  const off = render('en')
  telegramLang.setTelegramLanguage('en')
  const noFees = telegram.formatShiftOverview('Leang Cosmetics', shift, figures, { fees: false }, T0).split('\n')
  telegramLang.setTelegramLanguage('both')
  check('the Fees category switch takes the Expenses section out, as in the day summary', !noFees.includes('=====Expenses=====') && off.includes('=====Expenses====='))

  // ---- 6. revenue parity ---------------------------------------------------
  const overviewFilters = { startDate: '2026-09-23', endDate: '2026-09-23', branchId: 1 }
  check('the kernel is asked for the shift day on the shift branch -- the Overview filters',
    kernelCalls.length === 2 && kernelCalls.every(([, filters]) => JSON.stringify(filters) === JSON.stringify(overviewFilters)) && kernelCalls[1][2] === 'payment_method',
    JSON.stringify(kernelCalls))
  // What routes/reports.ts parseViewFilters builds from ?startDate=D&endDate=D&branchId=1.
  const reportsSource = fs.readFileSync(path.join(root, 'src', 'routes', 'reports.ts'), 'utf8')
  const ast = ts.createSourceFile('reports.ts', reportsSource, ts.ScriptTarget.Latest, true)
  const fn = (name) => ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)
  const compiled = ts.transpileModule([fn('parseFilters'), fn('parseViewFilters'), fn('reportRecordRange')].join('\n') + '\nexports.parseViewFilters = parseViewFilters; exports.reportRecordRange = reportRecordRange',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const reports = { exports: {} }
  new Function('exports', 'module', 'shiftWindowBound', 'localDateAtOrAfter', 'localDateAtOrBefore', 'localRangeClockError', 'isLocalRangeClock', compiled)(
    reports.exports, reports, salesAnalyticsReal.shiftWindowBound, businessDateWindow.localDateAtOrAfter, businessDateWindow.localDateAtOrBefore, businessDateWindow.localRangeClockError, businessDateWindow.isLocalRangeClock)
  assert.throws(() => reports.exports.parseViewFilters({ startTime: '24:00', endTime: '24:00' }),
    { name: 'RangeError', message: 'Use valid 24-hour HH:MM times; 24:00 is allowed only as the range end.' })
  assert.deepEqual(reports.exports.parseViewFilters({ startTime: '00:00', endTime: '24:00' }),
    { startDate: null, endDate: null, branchId: null, startTime: '00:00', endTime: '24:00' })
  check('actual reports parser rejects start 24:00 and accepts end 24:00', true)
  const routeFilters = reports.exports.parseViewFilters({ startDate: '2026-09-23', endDate: '2026-09-23', branchId: '1' })
  check('parseViewFilters of the same query is the same filter set (branch id as the query string carries it)',
    JSON.stringify({ ...routeFilters, branchId: Number(routeFilters.branchId) }) === JSON.stringify(overviewFilters), JSON.stringify(routeFilters))
  check('Revenue in the message is the kernel\'s revenue_usd for those filters, unaltered', en.includes(`· Revenue: $${KERNEL_TOTALS.revenue_usd.toFixed(2)}`))
  const feesSql = preparedSql.find((sql) => /FROM fees/.test(sql)).replace(/\s+/g, ' ')
  const returnsSql = preparedSql.find((sql) => /FROM returns/.test(sql)).replace(/\s+/g, ' ')
  const expensesRange = reports.exports.reportRecordRange('expenses', 'fees', routeFilters).sql
  const returnsRange = reports.exports.reportRecordRange('returns', 'returns', routeFilters).sql
  check('the expenses clause is reportRecordRange(\'expenses\')', feesSql.includes(`WHERE ${expensesRange}`), `${feesSql}\n${expensesRange}`)
  check('the returns clause is reportRecordRange(\'returns\')', returnsSql.includes(`AND ${returnsRange}`), `${returnsSql}\n${returnsRange}`)
  check('the returns and expenses figures leave the other branch, day and cancelled rows out; a refund carries no riel twin',
    JSON.stringify(figures.returns) === JSON.stringify({ count: 2, refundUsd: 10 })
      && JSON.stringify(figures.expenses) === JSON.stringify({ fees: { usd: 5, khr: 4000 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 4.5, khr: 0 } }),
    JSON.stringify(figures))
  // R-telegram X1 (FX-exc1 item 5): the day's shop-wide fees are reported
  // beside a branch's figures, never inside its totals or its delivery split.
  check('a branch overview carries the day\'s no-branch fees on their own, and only the day\'s',
    JSON.stringify(figures.unbranchedFees) === JSON.stringify({ usd: 2, khr: 1000 }), JSON.stringify(figures))
  const orgShift = closedShift({ branch_id: null, branch_name: null })
  const orgWide = await telegram.shiftOverviewFigures(envPaid, orgShift)
  check('an all-branches overview counts the no-branch fee in its own totals (and its delivery split) and has nothing beside them',
    JSON.stringify(orgWide.expenses.fees) === JSON.stringify({ usd: 106, khr: 5000 })
      && JSON.stringify(orgWide.expenses.deliveryFees) === JSON.stringify({ usd: 2, khr: 1000 }) && orgWide.unbranchedFees === null,
    JSON.stringify(orgWide))
  telegramLang.setTelegramLanguage('en')
  const orgText = telegram.formatShiftOverview('Leang Cosmetics', orgShift, orgWide, undefined, T0).split('\n')
  const zeroText = telegram.formatShiftOverview('Leang Cosmetics', shift, { ...figures, unbranchedFees: { usd: 0, khr: 0 } }, undefined, T0).split('\n')
  const hiddenText = telegram.formatShiftOverview('Leang Cosmetics', shift, figures, { fees: false }, T0).split('\n')
  telegramLang.setTelegramLanguage('both')
  const noBranchRow = (text) => text.some((line) => line.startsWith('· No branch'))
  check('the no-branch row prints only on a branch overview with such fees, and only where expenses are shown',
    !noBranchRow(orgText) && !noBranchRow(zeroText) && !noBranchRow(hiddenText), `${orgText.join('\n')}\n---\n${zeroText.join('\n')}\n---\n${hiddenText.join('\n')}`)

  // ---- 2. Paid path: a delayed queue message ------------------------------
  const paid = closedShift()
  const paidKey = telegram.shiftOverviewKey(paid.id, paid.revision)
  check('a close is scheduled on the queue', (await telegram.scheduleTelegramShiftOverview(envPaid, paid.id, T0)) === 'queued')
  check('one queue message, delayed 60 s, carrying only the key',
    queued.length === 1 && queued[0].options.delaySeconds === 60 && queued[0].body.kind === 'telegram-shift-overview' && queued[0].body.key === paidKey, JSON.stringify(queued))
  const paidRow = rowFor(paidKey)
  check('the idempotency row exists before any send: pending, queue, due one minute after the close',
    paidRow.status === 'pending' && paidRow.dispatch === 'queue' && paidRow.due_at === new Date(T0 + 60_000).toISOString() && posts.length === 0, JSON.stringify(paidRow))
  check('a retried schedule for the same close is a duplicate and queues nothing',
    (await telegram.scheduleTelegramShiftOverview(envPaid, paid.id, T0 + 1000)) === 'duplicate' && queued.length === 1)
  check('the request drain leaves a queued row to the queue while it is on time', (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 61_000)) === 0 && posts.length === 0)
  check('the queue delivery sends it', (await telegram.deliverTelegramShiftOverview(envPaid, paidKey, T0 + 60_000)) === 'sent' && posts.length === 1)
  check('it went to the alerts chat', posts[0].chat_id === '-1001234567890' && posts[0].text.startsWith('📈 Reports overview/ទិដ្ឋភាពរួមរបាយការណ៍: 23/09/2026'))
  check('a duplicate queue delivery sends nothing', (await telegram.deliverTelegramShiftOverview(envPaid, paidKey, T0 + 61_000)) === 'taken' && posts.length === 1)
  check('the cron drain afterwards sends nothing', (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 3_600_000, { sweepStale: true })) === 0 && posts.length === 1)
  // 6.0.984: the every-5-minutes cron tick must not scan the schema.
  telegram.__resetScheduledSendsProbeForTests()
  const idleFrom = preparedSql.length
  check('an idle cron tick sends nothing', (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 7_200_000, { limit: 10, sweepStale: true })) === 0)
  const idleSql = preparedSql.slice(idleFrom)
  check('and reads no sqlite_master, only the telegram_scheduled_sends statements', idleSql.length > 0 && !idleSql.some((sql) => /sqlite_master/i.test(sql)) && idleSql.every((sql) => /telegram_scheduled_sends/.test(sql)), JSON.stringify(idleSql))
  check('the row says sent, once', rowFor(paidKey).status === 'sent' && rowFor(paidKey).attempts === 1)

  // A queue message that is delivered early is not sent early.
  const early = closedShift()
  await telegram.scheduleTelegramShiftOverview(envPaid, early.id, T0)
  const earlyKey = telegram.shiftOverviewKey(early.id, early.revision)
  check('an early delivery is not-due and sends nothing', (await telegram.deliverTelegramShiftOverview(envPaid, earlyKey, T0 + 10_000)) === 'not-due' && posts.length === 1)
  // A queue message that never arrives: the drain takes over after the grace.
  check('a lost queue message is sent by the drain five minutes after it fell due',
    (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 60_000 + 5 * 60_000)) === 1 && posts.length === 2)

  // ---- 3. Free / fallback path --------------------------------------------
  const free = closedShift()
  const freeKey = telegram.shiftOverviewKey(free.id, free.revision)
  check('no queue binding: the fallback is used', (await telegram.scheduleTelegramShiftOverview(envFree, free.id, T0)) === 'fallback')
  check('the fallback row is pending, dispatch fallback', rowFor(freeKey).status === 'pending' && rowFor(freeKey).dispatch === 'fallback')
  check('the drain does not send it before it is due', (await telegram.drainDueTelegramShiftOverviews(envFree, T0 + 30_000)) === 0 && posts.length === 2)
  check('the next request after it falls due sends it', (await telegram.drainDueTelegramShiftOverviews(envFree, T0 + 60_000)) === 1 && posts.length === 3)
  check('and never again', (await telegram.drainDueTelegramShiftOverviews(envFree, T0 + 120_000)) === 0 && posts.length === 3)

  const broken = closedShift()
  const brokenKey = telegram.shiftOverviewKey(broken.id, broken.revision)
  const queuedBefore = queued.length
  check('a queue send that throws falls back automatically', (await telegram.scheduleTelegramShiftOverview({ ...envPaid, BACKUP_QUEUE: queue('throw') }, broken.id, T0)) === 'fallback' && queued.length === queuedBefore)
  check('the fallback row is drained once it is due', rowFor(brokenKey).dispatch === 'fallback' && (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 60_000)) === 1 && posts.length === 4)

  // ---- 4. races, retries, reopen + reclose -------------------------------
  const raced = closedShift()
  const racedKey = telegram.shiftOverviewKey(raced.id, raced.revision)
  await telegram.scheduleTelegramShiftOverview(envPaid, raced.id, T0)
  const postsBeforeRace = posts.length
  const outcomes = await Promise.all([
    telegram.deliverTelegramShiftOverview(envPaid, racedKey, T0 + 7 * 60_000),
    telegram.deliverTelegramShiftOverview(envPaid, racedKey, T0 + 7 * 60_000),
    telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 7 * 60_000),
  ])
  check('two queue deliveries and the drain racing: exactly one send', posts.length === postsBeforeRace + 1, JSON.stringify(outcomes))

  const flaky = closedShift()
  const flakyKey = telegram.shiftOverviewKey(flaky.id, flaky.revision)
  await telegram.scheduleTelegramShiftOverview(envPaid, flaky.id, T0)
  const postsBeforeFlaky = posts.length
  failNextPosts = 1
  check('a Telegram error is a retry, not a send', (await telegram.deliverTelegramShiftOverview(envPaid, flakyKey, T0 + 60_000)) === 'retry' && posts.length === postsBeforeFlaky)
  const retryRow = rowFor(flakyKey)
  check('the retry goes back to pending a minute on, for the drain', retryRow.status === 'pending' && retryRow.dispatch === 'fallback' && retryRow.due_at === new Date(T0 + 120_000).toISOString() && /502/.test(retryRow.last_error), JSON.stringify(retryRow))
  check('the drain sends it once', (await telegram.drainDueTelegramShiftOverviews(envPaid, T0 + 120_000)) === 1 && posts.length === postsBeforeFlaky + 1)
  failNextPosts = 3
  const dead = closedShift()
  const deadKey = telegram.shiftOverviewKey(dead.id, dead.revision)
  await telegram.scheduleTelegramShiftOverview(envFree, dead.id, T0)
  for (const at of [60_000, 120_000, 180_000, 240_000]) await telegram.drainDueTelegramShiftOverviews(envFree, T0 + at)
  check('three failed attempts end as failed, and nothing more is tried', rowFor(deadKey).status === 'failed' && rowFor(deadKey).attempts === 3 && failNextPosts === 0)

  // A claim whose Worker died mid-send is never re-sent (at most once).
  const stranded = closedShift()
  const strandedKey = telegram.shiftOverviewKey(stranded.id, stranded.revision)
  await telegram.scheduleTelegramShiftOverview(envFree, stranded.id, T0)
  sqlite.prepare("UPDATE telegram_scheduled_sends SET status = 'sending', claimed_at = ? WHERE send_key = ?").run(new Date(T0 + 60_000).toISOString(), strandedKey)
  const postsBeforeStranded = posts.length
  await telegram.drainDueTelegramShiftOverviews(envFree, T0 + 60_000 + 11 * 60_000, { sweepStale: true })
  check('a stranded claim is marked failed by the cron and not re-sent', rowFor(strandedKey).status === 'failed' && posts.length === postsBeforeStranded)

  // Reopen + close again. The shift report is pushed on every close of every
  // segment; a reopen is a NEW segment row, so its close is a new key and
  // the overview is sent again -- once.
  const segment = closedShift({ parent_shift_id: paid.id, revision: 1 })
  const segmentKey = telegram.shiftOverviewKey(segment.id, segment.revision)
  check('reopen + reclose: the new segment has its own key', segmentKey !== paidKey)
  const postsBeforeSegment = posts.length
  await telegram.scheduleTelegramShiftOverview(envPaid, segment.id, T0 + 600_000)
  await telegram.deliverTelegramShiftOverview(envPaid, segmentKey, T0 + 660_000)
  await telegram.deliverTelegramShiftOverview(envPaid, segmentKey, T0 + 660_000)
  check('reopen + reclose sends one more overview, and only one', posts.length === postsBeforeSegment + 1)
  check('the original close is still sent exactly once', rowFor(paidKey).status === 'sent' && rowFor(paidKey).attempts === 1)

  // An open or cancelled shift is not a close.
  const open = closedShift({ closed_at: null })
  check('an open shift is not scheduled', (await telegram.scheduleTelegramShiftOverview(envPaid, open.id, T0)) === 'not-closed')
  const cancelled = closedShift({ cancelled_at: CLOSED_AT })
  check('a cancelled shift is not scheduled', (await telegram.scheduleTelegramShiftOverview(envPaid, cancelled.id, T0)) === 'not-closed')

  // ---- 5. the toggle -------------------------------------------------------
  const rowsBefore = sqlite.prepare('SELECT COUNT(*) AS n FROM telegram_scheduled_sends').get().n
  setting('telegram_shift_overview_enabled', 'false')
  const quiet = closedShift()
  check('toggle off: nothing is scheduled', (await telegram.scheduleTelegramShiftOverview(envPaid, quiet.id, T0)) === 'off'
    && sqlite.prepare('SELECT COUNT(*) AS n FROM telegram_scheduled_sends').get().n === rowsBefore)
  clearSetting('telegram_shift_overview_enabled')
  setting('telegram_automation_enabled', 'false')
  check('automation off: nothing is scheduled even with the toggle unset', (await telegram.scheduleTelegramShiftOverview(envPaid, quiet.id, T0)) === 'off')
  clearSetting('telegram_automation_enabled')
  const late = closedShift()
  const lateKey = telegram.shiftOverviewKey(late.id, late.revision)
  check('toggle unset means on (it follows the shift report)', (await telegram.scheduleTelegramShiftOverview(envPaid, late.id, T0)) === 'queued')
  setting('telegram_shift_overview_enabled', 'false')
  const postsBeforeLate = posts.length
  check('toggle turned off during the minute: skipped at send time, nothing sent',
    (await telegram.deliverTelegramShiftOverview(envPaid, lateKey, T0 + 60_000)) === 'skipped' && posts.length === postsBeforeLate && rowFor(lateKey).status === 'skipped')
  clearSetting('telegram_shift_overview_enabled')
  check('a skipped send is final: turning it back on does not resend', (await telegram.deliverTelegramShiftOverview(envPaid, lateKey, T0 + 120_000)) === 'taken' && posts.length === postsBeforeLate)

  const SHIFT_TOPIC = 9001
  const SUMMARY_TOPIC = 9007
  const deliverOne = async () => {
    const routed = closedShift()
    const key = telegram.shiftOverviewKey(routed.id, routed.revision)
    await telegram.scheduleTelegramShiftOverview(envFree, routed.id, T0)
    const before = posts.length
    const outcome = await telegram.deliverTelegramShiftOverview(envFree, key, T0 + 60_000)
    assert.equal(outcome, 'sent')
    assert.equal(posts.length, before + 1)
    return posts[posts.length - 1]
  }
  setting('telegram_topic_shift', String(SHIFT_TOPIC))
  setting('telegram_topic_reports', String(SUMMARY_TOPIC))
  const toSummary = await deliverOne()
  check('the overview goes to the Summary topic when one is set', toSummary.message_thread_id === SUMMARY_TOPIC, JSON.stringify(toSummary))
  clearSetting('telegram_topic_reports')
  const toShift = await deliverOne()
  check('with no Summary topic it falls back to the Shift topic', toShift.message_thread_id === SHIFT_TOPIC, JSON.stringify(toShift))
  clearSetting('telegram_topic_shift')
  const toGeneral = await deliverOne()
  check('with neither topic set it goes to the group itself, with no thread id at all', !('message_thread_id' in toGeneral), JSON.stringify(toGeneral))
  setting('telegram_topic_reports', String(SUMMARY_TOPIC))
  const summaryOnly = await deliverOne()
  check('a Summary topic alone is used without a Shift topic', summaryOnly.message_thread_id === SUMMARY_TOPIC, JSON.stringify(summaryOnly))

  // The data path (owner, 13 Oct 2026): the delivery re-reads the shift row from D1
  // at send time, so the Cash count carries what is stored THEN -- an additional
  // saved with the close, or amended inside the minute, and a NULL column as none.
  {
    const idLabel = `${telegramLang.TELEGRAM_LABELS.shift.en} ${telegramLang.TELEGRAM_LABELS.shift.km}`
    const additionalLabel = `${pack.en.shift_additional_cash}${telegramLang.BILINGUAL_SEPARATOR}${pack.km.shift_additional_cash}`
    const stored = closedShift({ additional_cash_usd: 12.5, additional_cash_khr: 8000 })
    const storedKey = telegram.shiftOverviewKey(stored.id, stored.revision)
    await telegram.scheduleTelegramShiftOverview(envFree, stored.id, T0)
    sqlite.prepare('UPDATE shift_sessions SET additional_cash_usd = 15, additional_cash_khr = 30000 WHERE id = ?').run(stored.id)
    check('the overview delivery reads the additional from the stored row at send time (amended inside the minute: $15.00 · 30,000៛)',
      (await telegram.deliverTelegramShiftOverview(envFree, storedKey, T0 + 60_000)) === 'sent'
      && posts[posts.length - 1].text.split('\n').includes(`· ${additionalLabel}: $15.00 · 30,000៛`), posts[posts.length - 1].text)
    const storedLines = posts[posts.length - 1].text.split('\n')
    check('and the shift it came from is named once, in the header block, not again inside the Cash count',
      storedLines.filter((line) => line.includes(stored.shift_code)).length === 1 && storedLines.indexOf(`· ${idLabel}: ${stored.shift_code}`) > 0, posts[posts.length - 1].text)
    const never = closedShift()
    const neverKey = telegram.shiftOverviewKey(never.id, never.revision)
    await telegram.scheduleTelegramShiftOverview(envFree, never.id, T0)
    check('a stored row with no additional (NULL column) is delivered with a zero Additional change used row',
      (await telegram.deliverTelegramShiftOverview(envFree, neverKey, T0 + 60_000)) === 'sent'
      && posts[posts.length - 1].text.split('\n').includes(`· ${additionalLabel}: $0.00 · 0៛`), posts[posts.length - 1].text)

    // ---- two tills on one branch-day, through the REAL delivery path ----
    // Till A (Za) and till B (Sok) are the same branch and business day, with DIFFERENT drawers,
    // and both have closed before either overview is sent (the queue's minute, or the drain's
    // five). A delivery that read "the day's latest closed shift" would give A's message B's
    // drawer; one that read "the first" would give B's message A's. Each message must carry the
    // drawer of the shift whose close scheduled it, under that shift's own header, and not a sum.
    // Both orders of delivery are driven, so neither variant can pass.
    const word = (key) => `${pack.en[key]}${telegramLang.BILINGUAL_SEPARATOR}${pack.km[key]}`
    const cashHeaderBoth = telegram.sectionHeader('cashCount', telegramLang.REPORT_SECTION_EDGE)
    const drawerOf = (text) => {
      const lines = text.split('\n')
      const at = lines.indexOf(cashHeaderBoth)
      return at < 0 ? null : lines.slice(at + 1, at + 4)
    }
    const tillA = closedShift({ shift_code: 'S-20260923-0900-Za', user_name: 'Za', closed_at: '2026-09-23T11:29:00.000Z',
      opening_float_usd: 10, opening_float_khr: 10000, additional_cash_usd: 0, additional_cash_khr: 0, closing_counted_usd: 120, closing_counted_khr: 50000 })
    const tillB = closedShift({ shift_code: 'S-20260923-0915-Sok', user_name: 'Sok', closed_at: '2026-09-23T11:30:30.000Z',
      opening_float_usd: 40, opening_float_khr: 0, additional_cash_usd: 5, additional_cash_khr: 0, closing_counted_usd: 90, closing_counted_khr: 1000 })
    const drawerA = [`· ${word('shift_opening_cash')}: $10.00 · 10,000៛`, `· ${word('shift_additional_cash')}: $0.00 · 0៛`, `· ${word('shift_counted_cash')}: $120.00 · 50,000៛`]
    const drawerB = [`· ${word('shift_opening_cash')}: $40.00 · 0៛`, `· ${word('shift_additional_cash')}: $5.00 · 0៛`, `· ${word('shift_counted_cash')}: $90.00 · 1,000៛`]
    assert.notDeepStrictEqual(drawerA, drawerB, 'the fixture needs two different drawers to discriminate')
    for (const till of [tillA, tillB]) await telegram.scheduleTelegramShiftOverview(envFree, till.id, T0)
    const deliver = async (till) => {
      assert.equal(await telegram.deliverTelegramShiftOverview(envFree, telegram.shiftOverviewKey(till.id, till.revision), T0 + 60_000), 'sent')
      return posts[posts.length - 1].text
    }
    const textA = await deliver(tillA)
    assert.deepStrictEqual(drawerOf(textA), drawerA, `till A's overview must carry A's drawer, not the day's latest closed shift's\n${textA}`)
    assert.ok(textA.split('\n').includes(`· ${idLabel}: S-20260923-0900-Za`) && !textA.includes('S-20260923-0915-Sok'), 'and A\'s header')
    const textB = await deliver(tillB)
    assert.deepStrictEqual(drawerOf(textB), drawerB, `till B's overview must carry B's drawer, not the day's first closed shift's\n${textB}`)
    assert.ok(textB.split('\n').includes(`· ${idLabel}: S-20260923-0915-Sok`) && !textB.includes('S-20260923-0900-Za'), 'and B\'s header')
    check('two tills closed within the minute: each delivered overview carries its own shift\'s drawer under its own header (never the latest or first closed shift\'s, never a sum)', true)
  }

  const warnings = []
  const realWarn = console.warn
  const stubFetch = globalThis.fetch
  let deletedOnce = true
  console.warn = (...args) => warnings.push(args.join(' '))
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (deletedOnce && body.message_thread_id === SUMMARY_TOPIC) {
      deletedOnce = false
      return { ok: false, status: 400, text: async () => '{"ok":false,"description":"Bad Request: message thread not found"}' }
    }
    return stubFetch(url, init)
  }
  try {
    const retried = await deliverOne()
    check('a deleted Summary topic retries once into the group and the warning names telegram_topic_reports',
      !('message_thread_id' in retried) && warnings.some((line) => line.includes('telegram_topic_reports')) && !warnings.some((line) => line.includes('telegram_topic_shift')),
      warnings.join('\n'))
  } finally {
    console.warn = realWarn
    globalThis.fetch = stubFetch
    clearSetting('telegram_topic_reports')
  }

  // ---- the table itself ---------------------------------------------------
  let rejected = false
  try { sqlite.prepare("INSERT INTO telegram_scheduled_sends (send_key, kind, shift_id, due_at, created_at) VALUES (?, 'shift_overview', 1, 'x', 'x')").run(paidKey) } catch { rejected = true }
  check('0194: the send key is UNIQUE', rejected)
  const migration = fs.readFileSync(path.join(root, 'migrations', '0194_telegram_scheduled_sends.sql'), 'utf8')
  check('0194 is LF-only', !migration.includes('\r'))
  check('every post was a real overview message', posts.every((post) => post.text.startsWith('📈 ')))
  check('and every one of them carries the Additional change used row (the drawer is never missing a line)',
    posts.every((post) => post.text.split('\n').some((line) => line.startsWith(`· ${pack.en.shift_additional_cash}${telegramLang.BILINGUAL_SEPARATOR}${pack.km.shift_additional_cash}: `))))

  console.log(`\n${passed} checks passed; ${posts.length} overview messages composed and handed to the local Telegram stand-in (none sent anywhere).`)
}

main().catch((error) => { console.error(error); process.exit(1) })
