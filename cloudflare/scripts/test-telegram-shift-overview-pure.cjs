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
  Module._load = function (request, parent, main) { return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
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
  CREATE TABLE fees (id INTEGER PRIMARY KEY, branch_id INTEGER, fee_date TEXT, fee_type TEXT, amount_usd REAL, amount_khr REAL, created_at TEXT);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, branch_id INTEGER, created_at TEXT, status TEXT, return_scope TEXT, reason TEXT, total_refund_usd REAL, total_refund_khr REAL);
  INSERT INTO settings VALUES ('business_name', 'Leang Cosmetics'), ('telegram_chat_id', '-1001234567890');
  -- The shift's day and branch: 5.00 + 4,000៛ of expenses...
  INSERT INTO fees VALUES (1, 1, '2026-09-23', 'expense', 5, 4000, '2026-09-23T03:00:00Z');
  -- ...and nothing from another branch or another day.
  INSERT INTO fees VALUES (2, 2, '2026-09-23', 'expense', 99, 0, '2026-09-23T03:00:00Z');
  INSERT INTO fees VALUES (3, 1, '2026-09-22', 'expense', 77, 0, '2026-09-22T03:00:00Z');
  -- Two customer returns taken on the day (local UTC+7; 17:30Z on the 22nd is
  -- 00:30 on the 23rd), one cancelled return, one on another branch.
  INSERT INTO returns VALUES (1, 1, '2026-09-22T17:30:00Z', 'completed', 'customer', 'Damaged', 7.5, 0);
  INSERT INTO returns VALUES (2, 1, '2026-09-23T09:00:00Z', 'completed', NULL, '', 2.5, 0);
  INSERT INTO returns VALUES (3, 1, '2026-09-23T09:10:00Z', 'cancelled', 'customer', '', 40, 0);
  INSERT INTO returns VALUES (4, 2, '2026-09-23T09:20:00Z', 'completed', 'customer', '', 60, 0);
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
  delivery_usd: 6, pending_revenue_usd: 40, refund_usd: 10, tx_count: 18, cancelled_tx_count: 1,
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
    '· Not Paid: $40.00',
    '· Refunds: $10.00',
    '=====Invoices=====',
    '· Total: 18 · Cancelled: 1',
    '=====Payment methods=====',
    '· Cash: 12 · $300.00',
    '· ABA Pay: 6 · $112.50',
    '=====Expenses=====',
    '· Actual delivery cost: $4.50',
    '· Other expenses: $5.00 · 4,000៛',
    '· Total: $9.50 · 4,000៛',
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
    '· ប្រាក់ជំពាក់: $40.00',
    '· ការសងប្រាក់: $10.00',
    '=====វិក្កយបត្រ=====',
    '· សរុប: 18 · បានបោះបង់: 1',
    '=====វិធីទូទាត់=====',
    '· Cash: 12 · $300.00',
    '· ABA Pay: 6 · $112.50',
    '=====ចំណាយ=====',
    '· ថ្លៃដឹកដើម: $4.50',
    '· ចំណាយផ្សេងទៀត: $5.00 · 4,000៛',
    '· សរុប: $9.50 · 4,000៛',
    '=====ការប្រគល់មកវិញ=====',
    '· សរុប: 2 · $10.00',
  ])
  check('KM: the overview text, line for line, Khmer labels from the packs', true)
  check('both: the title carries both languages', both[0] === '📈 Reports overview/ទិដ្ឋភាពរួមរបាយការណ៍: 23/09/2026', both[0])
  const headers = both.filter((line) => /^=+[^=].*[^=]=+$/.test(line))
  const expectedHeaders = ['sales', 'invoices', 'paymentMethods', 'expenses', 'returns'].map((key) => telegram.sectionHeader(key, telegramLang.REPORT_SECTION_EDGE))
  check('both: five `=====Name=====` sections, drawn by the shared sectionHeader (fewer marks when five would wrap)',
    JSON.stringify(headers) === JSON.stringify(expectedHeaders) && headers.includes('=====Payment methods/វិធីទូទាត់====='), headers.join('\n'))
  check('both: every other row is a `·` row', both.slice(1).every((line) => line.startsWith('· ') || headers.includes(line) || line.startsWith('     ')))
  const pack = { en: require(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json')), km: require(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json')) }
  check('the title words are the pack key telegram_reports_overview in both packs',
    pack.en.telegram_reports_overview === 'Reports overview' && pack.km.telegram_reports_overview === telegramLang.TELEGRAM_LABELS.reportsOverview.km)

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
  const compiled = ts.transpileModule([fn('parseFilters'), fn('isClock'), fn('parseViewFilters'), fn('reportRecordRange')].join('\n') + '\nexports.parseViewFilters = parseViewFilters; exports.reportRecordRange = reportRecordRange',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const reports = { exports: {} }
  new Function('exports', 'module', 'shiftWindowBound', 'localDateAtOrAfter', 'localDateAtOrBefore', compiled)(
    reports.exports, reports, salesAnalyticsReal.shiftWindowBound, businessDateWindow.localDateAtOrAfter, businessDateWindow.localDateAtOrBefore)
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
  check('the returns and expenses figures leave the other branch, day and cancelled rows out',
    figures.returns.count === 2 && figures.returns.refundUsd === 10 && figures.otherExpenseUsd === 5 && figures.otherExpenseKhr === 4000, JSON.stringify(figures))

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

  // ---- the table itself ---------------------------------------------------
  let rejected = false
  try { sqlite.prepare("INSERT INTO telegram_scheduled_sends (send_key, kind, shift_id, due_at, created_at) VALUES (?, 'shift_overview', 1, 'x', 'x')").run(paidKey) } catch { rejected = true }
  check('0194: the send key is UNIQUE', rejected)
  const migration = fs.readFileSync(path.join(root, 'migrations', '0194_telegram_scheduled_sends.sql'), 'utf8')
  check('0194 is LF-only', !migration.includes('\r'))
  check('every post was a real overview message', posts.every((post) => post.text.startsWith('📈 ')))

  console.log(`\n${passed} checks passed; ${posts.length} overview messages composed and handed to the local Telegram stand-in (none sent anywhere).`)
}

main().catch((error) => { console.error(error); process.exit(1) })
