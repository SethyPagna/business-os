const productStockGuard = require('./harness/product_stock_guard.cjs')
// H-io #2 (27 Sep 2026): the Telegram shift report and the in-app shift report
// disagreed about the SAME shift's "delivery cost" vs "other expenses" split.
//
// The app (lib/shiftReconciliation.ts composeShiftFigures, rendered by
// frontend shiftReportModel.ts as delivery_actual_cost / shift_other_expenses)
// counts a fee typed 'delivery' as delivery cost. The Telegram message counted
// ONLY the sale-level courier payout as delivery cost and listed the
// delivery-typed fee as one more "other" expense under its own label -- it
// never called shiftDeliveryFeeExpenses. Same shift, two answers.
//
// This drives the REAL lib/shiftReconciliation.ts and the REAL lib/telegram.ts
// over one real SQLite database, answers `/shift <day>` through
// telegramCommandReply (no bot token, no fetch: nothing is sent anywhere), and
// asserts the message's Expenses section against loadShiftFigures -- the
// function the in-app report reads -- for the same rows.
//
// Discriminating fixture: a $10 courier paid by hand and recorded as a fee
// typed 'delivery' (no sale carries it), a $4 ordinary expense, and a $3 /
// 4,000៛ courier payout recorded on a sale. The two plausible wrong answers:
//   (a) the pre-fix message: delivery cost $3.00, and "Moto courier $10.00"
//       listed as another expense;
//   (b) delivery cost right but the delivery fee ALSO listed as a row, so the
//       rows add up to more than the section total.
// Both fail below. The section total is unchanged by the fix ($17 + 4,000៛):
// the split moves money between rows, never in or out of the section.
//
// Run (from cloudflare/): node scripts/test-telegram-shift-delivery-split-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

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
CREATE TABLE sale_amendments(id INTEGER PRIMARY KEY, sale_id INTEGER);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0);

INSERT INTO settings VALUES('pos_payment_methods','["Cash","ABA"]');
INSERT INTO settings VALUES('business_name','Split Test Shop');

-- One closed shift, 02:00 -> 06:00 UTC on 6 Sep 2026, branch 2, cashier 7.
INSERT INTO shift_sessions VALUES(1,'S-20260906-0900','per_account',7,'za',2,'Store','2026-09-06','2026-09-06 02:00:00',
 50,0,1,1,0,0,'2026-09-06 06:00:00',60,0,NULL,NULL,NULL);

-- Sale 6 paid a courier on the sale itself ($3 / 4,000 riel) and has no fee row.
INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,total_usd,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES
 (1,'2026-09-06 02:30:00','completed',2,7,'Cash',40,40,NULL,NULL),
 (6,'2026-09-06 04:00:00','completed',2,7,'Cash',10,10,3,4000);

-- The H-io shape: a courier paid by hand, entered as an expense typed
-- 'delivery', tied to no sale. Plus one ordinary expense.
INSERT INTO fees(id,created_at,branch_id,sale_id,fee_type,label,amount_usd,amount_khr,created_by) VALUES
 (1,'2026-09-06 03:00:00',2,NULL,'expense','Ice',4,0,7),
 (2,'2026-09-06 03:30:00',2,NULL,'delivery','Moto courier',10,0,7);
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

// The sales KERNEL is stubbed (its own suites own it): this test is about the
// fee split. The courier figure it reports matches sale 6, as the real kernel
// would, so the pre-fix message printed a real-looking $3.00 delivery cost.
const KERNEL = {
  revenue_usd: 50, cost_usd: 20, profit_usd: 30, delivery_usd: 0, pending_revenue_usd: 0, refund_usd: 0,
  delivery_actual_cost_usd: 3, delivery_actual_cost_count: 1,
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
const realAnalytics = load('lib/salesAnalytics.ts', { './db': dbModule, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
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

const NOW = Date.parse('2026-09-06T12:00:00Z')

function expensesSection(report) {
  const lines = report.split('\n')
  const header = lang.label('expenses')
  const start = lines.findIndex((line) => line.startsWith('=') && line.includes(header))
  assert.ok(start >= 0, `no Expenses section:\n${report}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('='))
  return unwrap(end < 0 ? rest : rest.slice(0, end))
}

// A row too wide for a phone continues on hanging-indented lines
// (telegramRowLines); read each row back as the one logical row it is.
function unwrap(lines) {
  const rows = []
  for (const line of lines) {
    if (line.startsWith(lang.HANGING_INDENT) && rows.length) rows[rows.length - 1] += ` ${line.trim()}`
    else rows.push(line)
  }
  return rows
}

;(async () => {
  let checks = 0
  const shift = sql.prepare('SELECT * FROM shift_sessions WHERE id = 1').get()
  const app = await reconciliation.loadShiftFigures({}, shift, NOW)
  // The in-app answer for this fixture, by value: the hand-paid courier fee
  // joins the sale-level payout as delivery cost; Ice alone is "other".
  assert.deepEqual(app.delivery_cost, { usd: 13, khr: 4000 }, 'in-app delivery cost')
  assert.deepEqual(app.other_expenses, { usd: 4, khr: 0 }, 'in-app other expenses')
  checks += 1; console.log('PASS in-app split: delivery cost $13.00 · 4,000៛ (fee + courier), other expenses $4.00')

  const report = await telegram.telegramCommandReply({}, '/shift 06/09/2026', NOW, 'both')
  const section = expensesSection(report)

  // 1. The delivery cost row carries the SAME figure the app shows.
  const deliveryRow = `${lang.ROW_BULLET}${lang.label('deliveryCost')}: $13.00 · 4,000៛`
  assert.ok(section.includes(deliveryRow),
    `Telegram delivery cost must match the app (${deliveryRow}); the section was:\n${section.join('\n')}`)
  assert.ok(deliveryRow.includes('ថ្លៃដឹកដើម') && deliveryRow.includes('Actual delivery cost'), `the row is bilingual: ${deliveryRow}`)
  checks += 1; console.log(`PASS delivery cost row matches the app: ${deliveryRow}`)

  // 2. The delivery-typed fee is NOT listed again as an "other" expense.
  assert.ok(!section.some((line) => line.includes('Moto courier')),
    `the delivery-typed fee is inside the delivery cost row and must not be listed again:\n${section.join('\n')}`)
  assert.ok(section.includes(`${lang.ROW_BULLET}Ice: $4.00`), `the ordinary expense keeps its own row:\n${section.join('\n')}`)
  checks += 1; console.log('PASS the delivery-typed fee is not double-listed; Ice keeps its row')

  // 3. The rows foot to the total, and the total is every fee plus the
  //    courier payout -- unchanged by the split.
  const totalRow = lang.labeled('total', '$17.00 · 4,000៛')
  assert.equal(section[section.length - 1], totalRow, `section total:\n${section.join('\n')}`)
  const rowUsd = section.slice(0, -1).reduce((sum, line) => sum + Number((line.match(/\$(\d+\.\d\d)/) || [0, 0])[1]), 0)
  assert.equal(Math.round(rowUsd * 100) / 100, 17, `the rows must add up to the total:\n${section.join('\n')}`)
  const app2 = app.delivery_cost.usd + app.other_expenses.usd
  assert.equal(app2, 17, 'in-app halves sum to the same total')
  checks += 1; console.log(`PASS rows foot to ${totalRow}, same total as the app's two halves`)

  // 4. The whole section, in the shop's own Khmer-only mode: the same split.
  const km = await telegram.telegramCommandReply({}, '/shift 06/09/2026', NOW, 'km')
  const kmSection = unwrap(km.split('\n'))
  assert.ok(kmSection.includes(`${lang.ROW_BULLET}ថ្លៃដឹកដើម: $13.00 · 4,000៛`), `Khmer delivery cost row:\n${km}`)
  assert.ok(!km.includes('Moto courier'), 'the Khmer message does not double-list the fee either')
  checks += 1; console.log('PASS Khmer-only message: · ថ្លៃដឹកដើម: $13.00 · 4,000៛')

  // 5. One kernel, not two: the message goes through composeShiftFigures and
  //    shiftDeliveryFeeExpenses, and the delivery predicate is defined once.
  const telegramSource = fs.readFileSync(path.join(root, 'src', 'lib', 'telegram.ts'), 'utf8')
  const kernelSource = fs.readFileSync(path.join(root, 'src', 'lib', 'shiftReconciliation.ts'), 'utf8')
  assert.match(telegramSource, /shiftDeliveryFeeExpenses\(env, shift, nowMs\)/, 'the Telegram figures read the delivery-typed fees')
  assert.match(telegramSource, /composeShiftFigures\(\{/, 'the Telegram figures split through composeShiftFigures')
  const figuresBody = telegramSource.slice(telegramSource.indexOf('async function shiftFigures('), telegramSource.indexOf('async function shopName('))
  assert.ok(figuresBody.length > 0 && !/fee_type/.test(figuresBody), 'the Telegram shift figures must not carry their own fee_type predicate')
  assert.equal((kernelSource.match(/= 'delivery'"/g) || []).length, 1, 'the delivery-fee predicate is defined once in the kernel')
  checks += 1; console.log('PASS one definition: composeShiftFigures + shiftDeliveryFeeExpenses, one delivery-fee predicate')

  console.log(`test-telegram-shift-delivery-split-pure: ${checks} checks ok`)
})().catch((error) => { console.error(error); process.exit(1) })
