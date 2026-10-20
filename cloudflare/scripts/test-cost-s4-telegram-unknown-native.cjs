// Release 3, slice S4: the three Telegram reports (/report day summary, shift
// report, shift overview) say so when profit rests on lines whose cost was
// never recorded, and a courier cost is only "not recorded" when it is NULL.
//
// Owner rule (14 Oct 2026): a recorded $0 is a real $0; an unknown cost is
// never shown as 0. Telegram stays concise: one short suffix on the existing
// Profit row, no extra lines.
//   Profit $123.45 (3 unknown cost)   some lines unknown
//   Profit unknown (3)                every line unknown (known 0, missing > 0)
//   Profit $123.45                    nothing unknown, incl. every line a real $0
// The courier row under Delivery prints a recorded $0 as $0.0000, keeps a NULL
// out of the sum and counts it.
//
// Part 1 renders the three formatters from figures (pure). Part 2 drives the
// REAL sales kernel (S3's cost_missing_snapshot_lines / cost_known_lines) over
// one in-memory database through /report, /shift and shiftOverviewFigures, so
// the wiring from kernel to message is proved too. Nothing is sent anywhere.
//
// Run (from cloudflare/): node scripts/test-cost-s4-telegram-unknown-native.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const Database = require('better-sqlite3')
const productStockGuard = require('./harness/product_stock_guard.cjs')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './productStockGuard') return productStockGuard
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE shift_sessions(id INTEGER PRIMARY KEY, shift_code TEXT, scope_mode TEXT, user_id INTEGER, user_name TEXT,
    branch_id INTEGER, branch_name TEXT, business_date TEXT, opened_at TEXT,
    opening_float_usd REAL, opening_float_khr REAL, opening_float_usd_registered INTEGER, opening_float_khr_registered INTEGER,
    additional_cash_usd REAL, additional_cash_khr REAL, closed_at TEXT, closing_counted_usd REAL, closing_counted_khr REAL,
    cancelled_at TEXT, cancelled_by_user_name TEXT, cancel_reason TEXT);
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, receipt_number TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL,
    tax_usd REAL, total_usd REAL, total_khr REAL,
    delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER,
    delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, branch_name TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT,
    cashier_id INTEGER, cashier_name TEXT, payment_method TEXT, payment_details TEXT,
    amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
    change_usd REAL, change_khr REAL, change_is_actual INTEGER, change_exchange_rate REAL, exchange_rate REAL DEFAULT 4100,
    source_return_id INTEGER
  );
  CREATE TABLE sale_amendments(id INTEGER PRIMARY KEY, sale_id INTEGER);
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    applied_price_usd REAL, applied_price_khr REAL,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL, owed_reduction_usd REAL NOT NULL DEFAULT 0, refund_currency TEXT,
    status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
    supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT);
  CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT);
  CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, created_at TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER, created_by INTEGER);
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, movement_type TEXT, quantity REAL, reference_id TEXT, created_at TEXT);
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, gender TEXT, is_anonymous INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, category TEXT, stock_quantity REAL,
    is_active INTEGER NOT NULL DEFAULT 1, low_stock_threshold REAL, out_of_stock_threshold REAL DEFAULT 0);
  CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER);
  CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL);
  CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
  INSERT INTO settings VALUES ('pos_payment_methods', '["Cash"]');
  INSERT INTO settings VALUES ('business_name', 'Cost S4 Shop');
`)

// 05:00Z = 12:00 local (UTC+7). One business day each.
const D_MIXED = '2026-08-10'
const D_ALL_UNKNOWN = '2026-08-11'
const D_ZERO_ONLY = '2026-08-12'
const at = (date) => `${date} 05:00:00`
const insSale = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, receipt_number, subtotal_usd, discount_usd, membership_discount_usd, tax_usd,
   total_usd, total_khr, delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_actual_cost_usd, delivery_contact_id, delivery_contact_name,
   branch_id, branch_name, cashier_id, cashier_name, payment_method, amount_paid_usd)
  VALUES (@id,@created_at,'completed',@receipt,@total,0,0,0,@total,0,@fee,'customer',@is_delivery,@courier,@contact,@contact_name,
   1,'shop',1,'aza','Cash',@total)`)
const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name, applied_price_usd, applied_price_khr) VALUES (?,?,?,?,?,?,?,?,?,?)')
let itemId = 0
const sale = (id, date, total, items, delivery = null) => {
  insSale.run({
    id, created_at: at(date), receipt: `${date.replace(/-/g, '')}-${String(id).padStart(6, '0')}`, total,
    fee: delivery ? 2 : 0, is_delivery: delivery ? 1 : 0,
    courier: delivery ? delivery.cost : null, contact: delivery ? delivery.contact : null, contact_name: delivery ? delivery.name : null,
  })
  for (const [name, price, cost] of items) { itemId += 1; insItem.run(itemId, id, 1, cost, price, 1, 500 + itemId, name, price, price * 4000) }
}
db.prepare('INSERT INTO delivery_contacts VALUES (1, ?), (2, ?), (3, ?)').run('Moto A', 'Moto B', 'Moto C')

// D_MIXED: five lines. Lamp cost $30 known, Mug cost $0 (a real zero: free
// goods), Sofa and Rug have NO recorded cost (NULL), Vase $5 known.
//   known 3, unknown 2 -> "Profit $X (2 unknown cost)".
sale(1, D_MIXED, 100, [['Lamp', 100, 30]], { cost: 0, contact: 1, name: 'Moto A' })           // courier recorded $0
sale(2, D_MIXED, 20, [['Mug', 20, 0]], { cost: 2.5, contact: 2, name: 'Moto B' })              // courier recorded $2.50
sale(3, D_MIXED, 300, [['Sofa', 300, null], ['Rug', 80, null]], { cost: null, contact: 2, name: 'Moto B' }) // courier NOT recorded
sale(4, D_MIXED, 40, [['Vase', 40, 5]], { cost: null, contact: 3, name: 'Moto C' })            // courier NOT recorded, sole delivery
// D_ALL_UNKNOWN: two lines, neither has a cost.
sale(5, D_ALL_UNKNOWN, 90, [['Chair', 60, null], ['Stool', 30, null]])
// D_ZERO_ONLY: one line whose recorded cost IS $0. Nothing is unknown.
sale(6, D_ZERO_ONLY, 25, [['Gift', 25, 0]])

const dbShim = { getDb: () => db }
const lang = loadReal('lib/telegramLang.ts')
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
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const analytics = loadReal('lib/salesAnalytics.ts', {
  './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': dbShim, './removalLosses': loadReal('lib/removalLosses.ts'),
  './businessDateWindow': businessDateWindow, ...analyticsPrecision,
})
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': dbShim })
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': dbShim, './salesAnalytics': analytics, './nativeSaleChange': nativeSaleChange,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', {
  './db': dbShim,
  './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './businessDateWindow': businessDateWindow, './telegramLang': lang, './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange, './salesAnalytics': analytics, './shiftReconciliation': shiftReconciliation,
})

let passed = 0
const failures = []
const record = (label, run) => {
  try { run(); passed += 1; console.log('PASS ' + label) } catch (error) { failures.push(label); console.log('FAIL ' + label + '\n' + String(error.message).split('\n').slice(1).join('\n')) }
}
const check = (label, condition, detail) => record(label, () => assert.ok(condition, label + '\n' + (detail || '')))
const eq = (label, actual, expected) => record(label, () => assert.strictEqual(actual, expected, label + '\n  actual:   ' + JSON.stringify(actual) + '\n  expected: ' + JSON.stringify(expected)))
const norm = (text) => String(text).replace(/\r\n/g, '\n')
const inLang = (mode, compose) => { const previous = lang.getTelegramLanguage(); lang.setTelegramLanguage(mode); try { return norm(compose()) } finally { lang.setTelegramLanguage(previous) } }
const rowOf = (report, key, mode) => norm(report).split('\n').filter((line) => line.startsWith(`${lang.ROW_BULLET}${inLang(mode, () => lang.label(key))}:`))
const unwrap = (report) => {
  const rows = []
  for (const line of norm(report).split('\n')) {
    if (line.startsWith(lang.HANGING_INDENT) && rows.length) rows[rows.length - 1] += ` ${line.trim()}`
    else rows.push(line)
  }
  return rows
}

// The Khmer for "unknown cost": km.json cost_unknown / tg_unknown_cost_suffix,
// copied (a DRAFT for a native read). "Unknown" is km.json `unknown`.
const KM_UNKNOWN_COST = 'មិនស្គាល់ថ្លៃដើម'
const KM_UNKNOWN = 'មិនស្គាល់'

const shiftRow = (over = {}) => ({
  id: 1, shift_code: 'S-20260810-0800', scope_mode: 'per_account', user_id: 1, user_name: 'aza', branch_id: 1, branch_name: 'shop',
  business_date: D_MIXED, opened_at: '2026-08-10 01:00:00', opening_float_usd: 50, opening_float_khr: 0,
  additional_cash_usd: 0, additional_cash_khr: 0, closed_at: '2026-08-10 10:00:00', closing_counted_usd: 60, closing_counted_khr: 0,
  cancelled_at: null, cancelled_by_user_name: null, cancel_reason: null, ...over,
})
db.prepare(`INSERT INTO shift_sessions VALUES (1,'S-20260810-0800','per_account',1,'aza',1,'shop','${D_MIXED}','2026-08-10 01:00:00',50,0,1,1,0,0,'2026-08-10 10:00:00',60,0,NULL,NULL,NULL)`).run()

const NOW = Date.parse('2026-08-13T12:00:00Z')

;(async () => {
  // ===================== Part 1: the formatters, from figures ================
  const dayStats = (sales) => ({
    date: D_MIXED,
    sales: { count: 4, usd: 460, cancelled: 0, refundUsd: 0, profitUsd: 123.45, deliveryFeeUsd: 0, creditUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0, ...sales },
    fees: { count: 0, usd: 0, khr: 0 }, stockIn: { count: 0, quantity: 0 }, stockOut: { count: 0, quantity: 0 },
  })
  const day = (mode, sales) => inLang(mode, () => telegram.formatDaySummary(dayStats(sales), []))
  const profitLine = (report, mode) => rowOf(report, 'profit', mode)

  eq('day summary, 2 unknown lines (en): Profit $123.45 (2 unknown cost)',
    profitLine(day('en', { costMissingLines: 2, costKnownLines: 3 }), 'en').join('|'), '· Profit: $123.45 (2 unknown cost)')
  eq('day summary, 2 unknown lines (both): the suffix carries both languages',
    profitLine(day('both', { costMissingLines: 2, costKnownLines: 3 }), 'both').join('|'),
    `· Profit/ចំណេញ: $123.45 (2 unknown cost/${KM_UNKNOWN_COST})`)
  eq('day summary, 2 unknown lines (km): the Khmer suffix only',
    profitLine(day('km', { costMissingLines: 2, costKnownLines: 3 }), 'km').join('|'), `· ចំណេញ: $123.45 (2 ${KM_UNKNOWN_COST})`)
  eq('day summary, every line unknown (en): Profit: Unknown (3), no dollar figure',
    profitLine(day('en', { costMissingLines: 3, costKnownLines: 0, profitUsd: 460 }), 'en').join('|'), '· Profit: Unknown (3)')
  eq('day summary, every line unknown (km)', profitLine(day('km', { costMissingLines: 3, costKnownLines: 0, profitUsd: 460 }), 'km').join('|'), `· ចំណេញ: ${KM_UNKNOWN} (3)`)
  eq('CONTROL: nothing unknown prints the figure alone',
    profitLine(day('en', { costMissingLines: 0, costKnownLines: 4 }), 'en').join('|'), '· Profit: $123.45')
  eq('CONTROL: figures from a caller that carries no count print as before',
    profitLine(day('en', {}), 'en').join('|'), '· Profit: $123.45')
  eq('CONTROL: a day of real $0 costs (known lines, none missing) is not flagged',
    profitLine(day('en', { costMissingLines: 0, costKnownLines: 1, profitUsd: 25 }), 'en').join('|'), '· Profit: $25.00')
  eq('CONTROL: no sales at all (known 0, missing 0) stays $0.00, not Unknown',
    profitLine(day('en', { costMissingLines: 0, costKnownLines: 0, profitUsd: 0 }), 'en').join('|'), '· Profit: $0.00')
  check('the suffix is not a new line: the Sales section has the same number of rows',
    day('en', { costMissingLines: 2, costKnownLines: 3 }).split('\n').length === day('en', {}).split('\n').length)

  const shiftFiguresBase = {
    invoices: 4, cancelled: 0, edited: 0, revenueUsd: 460, profitUsd: 123.45, deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
    refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0, paymentMethods: [], deliveries: [], expenseDetails: [],
  }
  const shiftMsg = (mode, figures) => inLang(mode, () => telegram.formatShiftReport('Cost S4 Shop', shiftRow(), { ...shiftFiguresBase, ...figures }, NOW))
  eq('shift report, 2 unknown lines (en)', rowOf(shiftMsg('en', { costMissingLines: 2, costKnownLines: 3 }), 'profit', 'en').join('|'), '· Profit: $123.45 (2 unknown cost)')
  eq('shift report, 2 unknown lines (km)', rowOf(shiftMsg('km', { costMissingLines: 2, costKnownLines: 3 }), 'profit', 'km').join('|'), `· ចំណេញ: $123.45 (2 ${KM_UNKNOWN_COST})`)
  eq('shift report, every line unknown (both)', rowOf(shiftMsg('both', { costMissingLines: 4, costKnownLines: 0 }), 'profit', 'both').join('|'), `· Profit/ចំណេញ: Unknown/${KM_UNKNOWN} (4)`)
  eq('CONTROL: shift report with nothing unknown', rowOf(shiftMsg('en', { costMissingLines: 0, costKnownLines: 4 }), 'profit', 'en').join('|'), '· Profit: $123.45')
  eq('CONTROL: shift report without a count', rowOf(shiftMsg('en', {}), 'profit', 'en').join('|'), '· Profit: $123.45')

  const overviewBase = {
    revenueUsd: 460, profitUsd: 123.45, grossSalesUsd: 460, itemDiscountUsd: 0, invoiceDiscountUsd: 0,
    deliveryFeeUsd: 0, creditUsd: 0, refundUsd: 0, invoices: 4, cancelled: 0, paymentMethods: [],
    expenses: { fees: { usd: 0, khr: 0 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 } },
    unbranchedFees: null, returns: { count: 0, refundUsd: 0 },
  }
  const overview = (mode, figures) => inLang(mode, () => telegram.formatShiftOverview('Cost S4 Shop', shiftRow(), { ...overviewBase, ...figures }, undefined, NOW))
  eq('overview, 2 unknown lines (en)', rowOf(overview('en', { costMissingLines: 2, costKnownLines: 3 }), 'profit', 'en').join('|'), '· Profit: $123.45 (2 unknown cost)')
  eq('overview, 2 unknown lines (km)', rowOf(overview('km', { costMissingLines: 2, costKnownLines: 3 }), 'profit', 'km').join('|'), `· ចំណេញ: $123.45 (2 ${KM_UNKNOWN_COST})`)
  eq('overview, every line unknown (en)', rowOf(overview('en', { costMissingLines: 2, costKnownLines: 0 }), 'profit', 'en').join('|'), '· Profit: Unknown (2)')
  eq('CONTROL: overview with nothing unknown', rowOf(overview('en', { costMissingLines: 0, costKnownLines: 4 }), 'profit', 'en').join('|'), '· Profit: $123.45')

  // The courier cost under Delivery. cost: null = no delivery recorded one.
  const courierRows = (deliveries, mode = 'en') => {
    const rows = unwrap(shiftMsg(mode, { deliveries })).filter((line) => line.startsWith(`${lang.ROW_BULLET}Moto`) || line.startsWith(`${lang.ROW_BULLET}ម៉ូតូ`))
    return rows
  }
  eq('courier recorded $0 prints $0.0000 cost',
    courierRows([{ name: 'Moto A', count: 1, feeUsd: 2, costUsd: 0, unrecordedCostCount: 0 }]).join('|'), '· Moto A: 1 · $2.0000 fee · $0.0000 cost')
  eq('courier recorded $2.50 and one NULL: the sum of the known, the unknown counted',
    courierRows([{ name: 'Moto B', count: 2, feeUsd: 4, costUsd: 2.5, unrecordedCostCount: 1 }]).join('|'), '· Moto B: 2 · $4.0000 fee · $2.5000 cost (1 unknown cost)')
  eq('courier with no recorded cost at all: unknown (N), never $0.0000',
    courierRows([{ name: 'Moto C', count: 1, feeUsd: 2, costUsd: null, unrecordedCostCount: 1 }]).join('|'), '· Moto C: 1 · $2.0000 fee · unknown cost (1)')
  eq('courier row in Khmer', courierRows([{ name: 'Moto C', count: 1, feeUsd: 2, costUsd: null, unrecordedCostCount: 1 }], 'km').join('|'),
    `· Moto C: 1 · $2.0000 ថ្លៃដឹក · ${KM_UNKNOWN_COST} (1)`)
  eq('CONTROL: a row with a positive recorded cost and none missing is unchanged',
    courierRows([{ name: 'Moto D', count: 3, feeUsd: 6, costUsd: 7.5, unrecordedCostCount: 0 }]).join('|'), '· Moto D: 3 · $6.0000 fee · $7.5000 cost')
  eq('CONTROL: a caller that sends no count and a positive cost prints as before',
    courierRows([{ name: 'Moto E', count: 3, feeUsd: 6, costUsd: 7.5 }]).join('|'), '· Moto E: 3 · $6.0000 fee · $7.5000 cost')

  // ===================== Part 2: the real kernel, end to end =================
  const dayOf = (date) => analytics.getSalesTotals({}, { startDate: date, endDate: date, branchId: null })
  const mixed = await dayOf(D_MIXED)
  check('FIXTURE: the kernel counts 2 unknown and 3 known lines on the mixed day (so the suffix is earned, not invented)',
    mixed.cost_missing_snapshot_lines === 2 && mixed.cost_known_lines === 3, JSON.stringify(mixed))
  const allUnknown = await dayOf(D_ALL_UNKNOWN)
  check('FIXTURE: the all-unknown day is known 0, missing 2',
    allUnknown.cost_known_lines === 0 && allUnknown.cost_missing_snapshot_lines === 2, JSON.stringify(allUnknown))
  const zeroOnly = await dayOf(D_ZERO_ONLY)
  check('FIXTURE: the real-$0 day is known 1, missing 0, profit = revenue',
    zeroOnly.cost_known_lines === 1 && zeroOnly.cost_missing_snapshot_lines === 0 && zeroOnly.profit_usd === zeroOnly.revenue_usd, JSON.stringify(zeroOnly))

  const report = async (date, mode) => norm(await telegram.telegramCommandReply({}, `/report ${date.split('-').reverse().join('/')}`, NOW, mode))
  const profitUsd = mixed.profit_usd.toFixed(2)
  eq('/report, mixed day: the kernel profit with (2 unknown cost)',
    rowOf(await report(D_MIXED, 'en'), 'profit', 'en').join('|'), `· Profit: $${profitUsd} (2 unknown cost)`)
  eq('/report, mixed day, Khmer-only',
    rowOf(await report(D_MIXED, 'km'), 'profit', 'km').join('|'), `· ចំណេញ: $${profitUsd} (2 ${KM_UNKNOWN_COST})`)
  eq('/report, all-unknown day: Unknown (2)', rowOf(await report(D_ALL_UNKNOWN, 'en'), 'profit', 'en').join('|'), '· Profit: Unknown (2)')
  eq('/report, real-$0 day: no flag', rowOf(await report(D_ZERO_ONLY, 'en'), 'profit', 'en').join('|'), `· Profit: $${zeroOnly.profit_usd.toFixed(2)}`)

  const shiftReply = async (mode) => norm(await telegram.telegramCommandReply({}, '/shift 10/08/2026', NOW, mode))
  const shiftEn = await shiftReply('en')
  eq('/shift, mixed day: Profit carries (2 unknown cost)', rowOf(shiftEn, 'profit', 'en').join('|'), `· Profit: $${profitUsd} (2 unknown cost)`)
  const moto = unwrap(shiftEn).filter((line) => line.startsWith(`${lang.ROW_BULLET}Moto`))
  eq('/shift courier A (recorded $0): $0.0000 cost, not hidden', moto.find((line) => line.startsWith('· Moto A')), '· Moto A: 1 · $2.0000 fee · $0.0000 cost')
  eq('/shift courier B (one recorded, one NULL): the sum of the known and the NULL counted',
    moto.find((line) => line.startsWith('· Moto B')), '· Moto B: 2 · $4.0000 fee · $2.5000 cost (1 unknown cost)')
  eq('/shift courier C (NULL only): unknown, never $0.0000', moto.find((line) => line.startsWith('· Moto C')), '· Moto C: 1 · $2.0000 fee · unknown cost (1)')
  check('/shift: no courier row asserts a cost it does not have (only A prints $0.0000)',
    moto.filter((line) => line.includes('$0.0000 cost')).length === 1, moto.join('\n'))

  const shift = shiftRow()
  const figures = await telegram.shiftOverviewFigures({}, shift, 'Other', undefined, NOW)
  check('overview figures carry the kernel counts', figures.costMissingLines === 2 && figures.costKnownLines === 3, JSON.stringify(figures))
  const overviewEn = inLang('en', () => telegram.formatShiftOverview('Cost S4 Shop', shift, figures, undefined, NOW))
  eq('overview, mixed day (from the database)', rowOf(overviewEn, 'profit', 'en').join('|'), `· Profit: $${profitUsd} (2 unknown cost)`)
  const figuresAll = await telegram.shiftOverviewFigures({}, shiftRow({ business_date: D_ALL_UNKNOWN }), 'Other', undefined, NOW)
  eq('overview, all-unknown day (from the database)',
    rowOf(inLang('en', () => telegram.formatShiftOverview('Cost S4 Shop', shiftRow({ business_date: D_ALL_UNKNOWN }), figuresAll, undefined, NOW)), 'profit', 'en').join('|'), '· Profit: Unknown (2)')

  // Audience: this slice changes wording only. It must not touch who is told.
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
  check('the unknown-cost wording is built from one helper, not pasted per message',
    (source.match(/unknown cost/g) || []).length >= 1 && (source.match(/function profitValue\(/g) || []).length === 1)

  if (failures.length) { console.log(`test-cost-s4-telegram-unknown-native: ${failures.length} FAILED, ${passed} passed`); process.exit(1) }
  console.log(`test-cost-s4-telegram-unknown-native: ${passed} checks ok`)
})().catch((error) => { console.error(error); process.exit(1) })
