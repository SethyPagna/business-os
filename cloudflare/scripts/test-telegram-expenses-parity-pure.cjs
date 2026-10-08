const productStockGuard = require('./harness/product_stock_guard.cjs')
// One "Expenses" on three Telegram reports (R-telegram E2, 27 Sep 2026).
//
// The shift report (/shift), the day summary (/report) and the Reports
// overview sent after a close all print an Expenses section with an "Actual
// delivery cost" row and a Total. The refuter found them disagreeing at the
// same close: /shift said delivery $13.00, while the overview and /report said
// delivery $3.00 plus $14.00 of "other" expenses. The shift report was the one
// that followed the owner's rule (memory hub-sales-money ->
// shop-paid-delivery-cancels-out, 24 Sep 2026): the delivery money the business
// counts is what the courier was actually paid -- a payout on the sale, or a
// fee typed 'delivery' -- counted ONCE. The other two surfaces counted a
// courier paid by hand (a delivery-typed fee) as an "other" expense, dropped
// the riel half of the courier payout, and added the kernel's UNGUARDED
// courier dollars to the fees, so a payout that is also recorded as a linked
// delivery fee was counted twice.
//
// One fixture, the three reports, one answer:
//   Actual delivery cost  $18.00 · 4,000៛   (courier $3 / 4,000៛ on sale 6,
//                                            + Moto courier fee $10,
//                                            + sale 7's linked courier fee $5)
//   Other expenses        $4.00             (Ice)
//   Total                 $22.00 · 4,000៛
//
// Wrong implementations this fixture separates from the right one:
//   (a) the pre-fix day/overview: delivery $8.00 (kernel, unguarded), other
//       $19.00, total $27.00 -- sale 7's $5 counted twice;
//   (b) delivery-typed fees moved but the kernel's courier kept: $23.00;
//   (c) the guarded dollars but no riel half: "$18.00" with no "· 4,000៛";
//   (d) a courier sum that forgets cancelled sales: sale 8's $50 creeps in.
//
// Pure: the REAL lib/telegram.ts, lib/shiftReconciliation.ts and
// lib/telegramLang.ts over an in-memory SQLite. The sales kernel is a stub
// that answers what the real one would for this fixture (its own suites own
// it). Nothing is sent anywhere: every message is a returned string.
//
// Run (from cloudflare/): node scripts/test-telegram-expenses-parity-pure.cjs
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
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, fee_date TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY, movement_type TEXT, quantity REAL, reference_id TEXT, created_at TEXT);

INSERT INTO settings VALUES('pos_payment_methods','["Cash","ABA"]');
INSERT INTO settings VALUES('business_name','Parity Test Shop');

-- One closed shift, 02:00 -> 06:00 UTC (09:00 -> 13:00 local) on 6 Sep 2026,
-- branch 2, cashier 7: the only trading of the day, so the shift, the day and
-- the day-on-branch-2 overview all cover the same rows.
INSERT INTO shift_sessions VALUES(1,'S-20260906-0900','per_account',7,'za',2,'Store','2026-09-06','2026-09-06 02:00:00',
 50,0,1,1,0,0,'2026-09-06 06:00:00',60,0,NULL,NULL,NULL);

INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,total_usd,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES
 (1,'2026-09-06 02:30:00','completed',2,7,'Cash',40,40,NULL,NULL),
 -- a courier paid on the sale itself, in both currencies, with no fee row
 (6,'2026-09-06 04:00:00','completed',2,7,'Cash',10,10,3,4000),
 -- a courier cost ALSO recorded as a linked delivery fee (fee 3): counted once, as the fee
 (7,'2026-09-06 04:30:00','completed',2,7,'Cash',20,20,5,2000),
 -- a cancelled sale's courier is nobody's expense
 (8,'2026-09-06 05:00:00','cancelled',2,7,'Cash',0,30,50,0);

INSERT INTO fees(id,created_at,fee_date,branch_id,sale_id,fee_type,label,amount_usd,amount_khr,created_by) VALUES
 (1,'2026-09-06 03:00:00','2026-09-06',2,NULL,'expense','Ice',4,0,7),
 (2,'2026-09-06 03:30:00','2026-09-06',2,NULL,'delivery','Moto courier',10,0,7),
 (3,'2026-09-06 04:45:00','2026-09-06',2,7,'delivery','Courier for sale 7',5,0,7);
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

// What the real kernel answers for this fixture, on every one of the three
// windows (they cover the same sales). Its delivery_actual_cost_usd is the RAW
// courier column over the non-cancelled sales, 3 + 5 = 8: it is not guarded
// against a linked delivery fee, which is why no Expenses figure may use it.
const KERNEL = {
  revenue_usd: 70, cost_usd: 30, profit_usd: 40, delivery_usd: 0, pending_revenue_usd: 0, refund_usd: 0,
  delivery_actual_cost_usd: 8, delivery_actual_cost_count: 2,
  item_discount_usd: 0, discount_usd: 0, gross_sales_usd: 70, tx_count: 3, cancelled_tx_count: 1,
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
  getSalesGroupedTotals: async () => [],
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
function section(report, key) {
  const lines = unwrap(report.split('\n'))
  const header = lang.label(key)
  const start = lines.findIndex((line) => line.startsWith('=') && line.includes(header))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('='))
  return end < 0 ? rest : rest.slice(0, end)
}
function rendered(mode, fn) {
  const previous = lang.getTelegramLanguage()
  lang.setTelegramLanguage(mode)
  try { return fn() } finally { lang.setTelegramLanguage(previous) }
}
// The figure on a labelled row of a section, or null when the row is absent.
function figure(rows, key) {
  const prefix = `${lang.ROW_BULLET}${lang.label(key)}: `
  const row = (rows || []).find((line) => line.startsWith(prefix))
  return row ? row.slice(prefix.length) : null
}

;(async () => {
  let checks = 0
  const shift = sql.prepare('SELECT * FROM shift_sessions WHERE id = 1').get()

  // The app's own answer (the in-app shift report's arithmetic), by value.
  const app = await reconciliation.loadShiftFigures({}, shift, NOW)
  assert.deepEqual(app.delivery_cost, { usd: 18, khr: 4000 }, 'in-app delivery cost: courier $3 / 4,000៛ + delivery-typed fees $10 + $5')
  assert.deepEqual(app.other_expenses, { usd: 4, khr: 0 }, 'in-app other expenses: Ice')
  checks += 1; console.log('PASS in-app split: delivery cost $18.00 · 4,000៛, other $4.00')

  // The overview is the message sent one minute after this shift closes: the
  // shift's business day on the shift's branch.
  const overviewFigures = await telegram.shiftOverviewFigures({}, { business_date: '2026-09-06', branch_id: 2 })
  const reports = {
    '/shift': await telegram.telegramCommandReply({}, '/shift 06/09/2026', NOW, 'both'),
    '/report': await telegram.telegramCommandReply({}, '/report 06/09/2026', NOW, 'both'),
    overview: rendered('both', () => telegram.formatShiftOverview('Parity Test Shop', shift, overviewFigures, undefined, NOW)),
  }

  // All three read side by side, so a failure shows every surface at once.
  const wanted = { deliveryCost: '$18.00 · 4,000៛', total: '$22.00 · 4,000៛' }
  const seen = {}
  for (const [name, report] of Object.entries(reports)) {
    const rows = section(report, 'expenses')
    assert.ok(rows, `${name} has no Expenses section:\n${report}`)
    seen[name] = { deliveryCost: figure(rows, 'deliveryCost'), total: figure(rows, 'total') }
  }
  assert.deepEqual(seen, { '/shift': wanted, '/report': wanted, overview: wanted },
    `one delivery cost and one total on all three reports; the Expenses sections read:\n${
      Object.entries(reports).map(([name, report]) => `${name}\n${section(report, 'expenses').join('\n')}`).join('\n')}`)
  checks += 1; console.log(`PASS the three reports print one delivery cost (${wanted.deliveryCost}) and one total (${wanted.total})`)

  // The remainder is the same $4.00 everywhere: /shift lists it as its one
  // row (Ice), /report and the overview under "Other expenses" -- and no
  // delivery-typed fee is listed again on any of them.
  const shiftRows = section(reports['/shift'], 'expenses')
  assert.ok(shiftRows.includes(`${lang.ROW_BULLET}Ice: $4.00`), `/shift lists Ice:\n${shiftRows.join('\n')}`)
  for (const name of ['/report', 'overview']) {
    const rows = section(reports[name], 'expenses')
    assert.equal(figure(rows, 'expensesOther'), '$4.00', `${name} other expenses:\n${rows.join('\n')}`)
    assert.equal(rows.length, 3, `${name} prints delivery, other, total and nothing else:\n${rows.join('\n')}`)
  }
  for (const [name, report] of Object.entries(reports)) {
    assert.ok(!/Moto courier|Courier for sale 7/.test(report), `${name} must not list a delivery-typed fee as another expense:\n${report}`)
  }
  checks += 1; console.log('PASS the other $4.00 is the same on all three, and no delivery-typed fee is listed twice')

  // The Khmer line, in the shop's Khmer-only mode, on all three.
  const km = {
    '/shift': await telegram.telegramCommandReply({}, '/shift 06/09/2026', NOW, 'km'),
    '/report': await telegram.telegramCommandReply({}, '/report 06/09/2026', NOW, 'km'),
    overview: rendered('km', () => telegram.formatShiftOverview('Parity Test Shop', shift, overviewFigures, undefined, NOW)),
  }
  for (const [name, report] of Object.entries(km)) {
    const rows = unwrap(report.split('\n'))
    assert.ok(rows.includes(`${lang.ROW_BULLET}ថ្លៃដឹកដើម: $18.00 · 4,000៛`), `${name} Khmer delivery cost row:\n${report}`)
    assert.ok(rows.includes(`${lang.ROW_BULLET}សរុប: $22.00 · 4,000៛`), `${name} Khmer total row:\n${report}`)
  }
  checks += 1; console.log('PASS Khmer-only: · ថ្លៃដឹកដើម: $18.00 · 4,000៛ and · សរុប: $22.00 · 4,000៛ on all three')

  // Expenses switched off: the fees table's rows go with the switch, the
  // courier paid on the sales stays in the day summary's Sales section -- in
  // both currencies and guarded, never the kernel's raw $8.00.
  const feesOff = await telegram.telegramCommandReply({}, '/report 06/09/2026', NOW, 'both', { fees: false })
  assert.equal(section(feesOff, 'expenses'), null, `no Expenses section when the switch is off:\n${feesOff}`)
  assert.equal(figure(section(feesOff, 'sales'), 'deliveryCost'), '$3.00 · 4,000៛', `the courier payout moves to Sales:\n${feesOff}`)
  checks += 1; console.log('PASS Expenses off: /report carries the courier payout ($3.00 · 4,000៛) under Sales')

  console.log(`test-telegram-expenses-parity-pure: ${checks} checks ok`)
})().catch((error) => { console.error(error); process.exit(1) })
