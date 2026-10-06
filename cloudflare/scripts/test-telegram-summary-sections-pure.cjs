// Owner, 29 Sep 2026: the overview in the Summary topic stays short by default,
// and each extra section is a Settings switch that is off until turned on.
//
// Pure: the REAL lib/telegram.ts, telegramLang.ts, shiftReconciliation.ts and
// lowStockSettings.ts over node:sqlite carrying the REAL migration chain. The
// sales kernel's totals, grouped totals and product ranking are recording
// stubs, so each figure is proven to be the kernel's for exactly the filters
// asked. The switches' write rule is driven through the REAL routes/settings.ts
// POST /. The Telegram API is a local function; every id is synthetic.
//
// Run (from cloudflare/): node scripts/test-telegram-summary-sections-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

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

const MIGRATIONS = loadAll()
const preparedSql = []
function openShop() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of MIGRATIONS) raw.exec(sql)
  const names = (sql) => [...new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))]
  const bind = (sql, params) => (Array.isArray(params) ? params : [Object.fromEntries(names(sql).map((name) => [name, params?.[name] ?? null]))])
  const db = {
    raw,
    prepare(sql) {
      preparedSql.push(sql)
      const statement = raw.prepare(sql)
      return {
        async get(params) { return statement.get(...bind(sql, params)) },
        async all(params) { return statement.all(...bind(sql, params)) },
        async run(params) { const info = statement.run(...bind(sql, params)); return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) } },
      }
    },
  }
  return db
}
const insert = (db, table, row) => {
  const columns = Object.keys(row)
  db.raw.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map((column) => row[column]))
}
const setting = (db, key, value) => db.raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
const clearSetting = (db, key) => db.raw.prepare('DELETE FROM settings WHERE key = ?').run(key)

const DAY = '2026-09-23'
const YESTERDAY = '2026-09-22'
const LAST_WEEK = '2026-09-16'
const CHAT_A = '-1009990001'
const CHAT_B = '-1009990002'
const SUMMARY_TOPIC_A = 9007
const SUMMARY_TOPIC_B = 9107
const SHIFT_TOPIC_A = 9001

function seedShopA(db) {
  for (const [key, value] of Object.entries({
    business_name: 'Synthetic Shop A', telegram_chat_id: CHAT_A, telegram_language: 'en',
    telegram_topic_reports: String(SUMMARY_TOPIC_A), telegram_topic_shift: String(SHIFT_TOPIC_A),
    pos_payment_methods: '["Cash","ABA Pay"]',
  })) setting(db, key, value)
  insert(db, 'branches', { id: 1, name: 'Toul Kork' })
  insert(db, 'branches', { id: 2, name: 'Riverside' })
  const sale = (id, extra) => insert(db, 'sales', {
    id, receipt_number: `R-${id}`, branch_id: 1, sale_status: 'completed', created_at: '2026-09-23 03:00:00', exchange_rate: 4100,
    amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0, change_is_actual: 0, ...extra,
  })
  // Dollars 20 - 2 change + 5; riel 40,000 + 41,000; bank 15 + 10 + 5 (the last one 00:30 local).
  sale(1, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":20,"amount_khr":40000}]', amount_paid_usd: 20, amount_paid_khr: 40000, change_usd: 2, change_is_actual: 1, change_exchange_rate: 4100, total_usd: 27.76 })
  sale(2, { payment_method: 'ABA Pay', payment_details: '[{"method":"ABA Pay","amount_usd":15}]', amount_paid_usd: 15, total_usd: 15 })
  sale(3, { payment_method: 'Cash + ABA Pay', payment_details: '[{"method":"Cash","amount_usd":5},{"method":"ABA Pay","amount_usd":10}]', amount_paid_usd: 15, total_usd: 15 })
  sale(4, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_khr":41000}]', amount_paid_khr: 41000, total_usd: 10 })
  sale(5, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":100}]', amount_paid_usd: 100, total_usd: 100, sale_status: 'cancelled' })
  sale(6, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":50}]', amount_paid_usd: 50, total_usd: 50, branch_id: 2 })
  sale(7, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":30}]', amount_paid_usd: 30, total_usd: 30, created_at: '2026-09-22 03:00:00' })
  sale(8, { payment_method: '', sale_status: 'awaiting_payment', total_usd: 40 })
  sale(9, { payment_method: 'ABA Pay', payment_details: '[{"method":"ABA Pay","amount_usd":5}]', amount_paid_usd: 5, total_usd: 5, created_at: '2026-09-22 17:30:00' })
  sale(10, { payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":25}]', amount_paid_usd: 25, total_usd: 25, created_at: '2026-09-22 12:00:00' })
  const product = (id, name, stock, extra = {}) => insert(db, 'products', { id, name, stock_quantity: stock, low_stock_threshold: 5, out_of_stock_threshold: 0, is_active: 1, ...extra })
  product(1, 'Rose Serum', 0)
  product(2, 'Lip Tint', 3)
  product(3, 'Face Wash', 2)
  product(4, 'Toner', 50)
  product(5, 'Clay Mask', 1)
  product(6, 'Night Cream', 4)
  product(7, 'Old Lotion', 0, { is_active: 0 })
  product(8, 'Sunscreen', 2)
  product(9, 'Soap Bar', 1)
  let line = 0
  const item = (saleId, productId, name) => insert(db, 'sale_items', { id: ++line, sale_id: saleId, product_id: productId, product_name: name, quantity: 1, total_usd: 1 })
  item(1, 1, 'Rose Serum')
  item(2, 2, 'Lip Tint')
  item(7, 3, 'Face Wash')
  item(3, 4, 'Toner')
  item(5, 5, 'Clay Mask')
  item(6, 6, 'Night Cream')
  item(4, 7, 'Old Lotion')
  item(9, 9, 'Soap Bar')
  insert(db, 'inventory_movements', { id: 1, product_id: 8, product_name: 'Sunscreen', branch_id: 1, movement_type: 'remove', quantity: 3, created_at: '2026-09-23 04:00:00' })
  insert(db, 'inventory_movements', { id: 2, product_id: 3, product_name: 'Face Wash', branch_id: 1, movement_type: 'remove', quantity: 1, created_at: '2026-09-22 04:00:00' })
  insert(db, 'inventory_movements', { id: 3, product_id: 5, product_name: 'Clay Mask', branch_id: 2, movement_type: 'transfer_out', quantity: 1, created_at: '2026-09-23 06:00:00' })
  const ret = (id, extra, items) => {
    insert(db, 'returns', { id, branch_id: 1, created_at: '2026-09-23 09:00:00', status: 'completed', return_scope: 'customer', ...extra })
    for (const quantity of items) insert(db, 'return_items', { return_id: id, quantity })
  }
  ret(1, { created_at: '2026-09-22 17:30:00', total_refund_usd: 7.5, total_refund_khr: 30750 }, [2])
  ret(2, { return_scope: null, total_refund_usd: 2.5, total_refund_khr: 10250 }, [1])
  ret(3, { status: 'cancelled', total_refund_usd: 40, total_refund_khr: 164000 }, [5])
  ret(4, { branch_id: 2, total_refund_usd: 60, total_refund_khr: 246000 }, [4])
  ret(5, { return_scope: 'supplier', total_refund_usd: 9, total_refund_khr: 36900 }, [7])
  ret(6, { created_at: '2026-09-22 09:00:00', total_refund_usd: 1, total_refund_khr: 4100 }, [6])
  const fee = (extra) => insert(db, 'fees', { branch_id: 1, fee_date: DAY, fee_type: 'expense', amount_usd: 0, amount_khr: 0, created_at: '2026-09-23 05:00:00', ...extra })
  fee({ label: 'Ice', amount_usd: 4 })
  fee({ label: 'Moto', amount_khr: 20000 })
  fee({ fee_type: 'delivery', label: 'Courier', amount_usd: 3 })
  fee({ branch_id: 2, label: 'Rent', amount_usd: 99 })
  fee({ branch_id: null, label: 'Water', amount_usd: 2 })
  fee({ fee_date: YESTERDAY, label: 'Ice', amount_usd: 77 })
}

function seedShopB(db) {
  for (const [key, value] of Object.entries({
    business_name: 'Synthetic Shop B', telegram_chat_id: CHAT_B, telegram_language: 'en', telegram_topic_reports: String(SUMMARY_TOPIC_B),
  })) setting(db, key, value)
  insert(db, 'sales', { id: 1, receipt_number: 'B-1', branch_id: null, sale_status: 'completed', created_at: '2026-09-23 03:00:00', payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":9}]', amount_paid_usd: 9, total_usd: 9, exchange_rate: 4100 })
  // Change handed back with no currency marker: the drawer figure needs review.
  insert(db, 'sales', { id: 2, receipt_number: 'B-2', branch_id: null, sale_status: 'completed', created_at: '2026-09-23 04:00:00', payment_method: 'Cash', payment_details: '[{"method":"Cash","amount_usd":10}]', amount_paid_usd: 10, change_usd: 1, change_is_actual: 0, total_usd: 9, exchange_rate: 4100 })
  for (let n = 1; n <= 10; n += 1) {
    const name = `Shop B Balm ${String(n).padStart(2, '0')}`
    insert(db, 'products', { id: n, name, stock_quantity: n <= 5 ? n - 1 : 4, low_stock_threshold: 5, out_of_stock_threshold: 0, is_active: 1 })
    insert(db, 'sale_items', { id: n, sale_id: 1, product_id: n, product_name: name, quantity: 1, total_usd: 0.9 })
    insert(db, 'fees', { branch_id: null, fee_date: DAY, fee_type: 'expense', label: `Fee ${String(n).padStart(2, '0')}`, amount_usd: 11 - n, amount_khr: 0, created_at: '2026-09-23 05:00:00' })
  }
}

const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const telegramLang = loadReal('lib/telegramLang.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const dbModule = { getDb: (env) => env.DB }
const salesAnalyticsReal = loadReal('lib/salesAnalytics.ts', {
  './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': dbModule, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow,
  './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision,
})

const kernelCalls = []
const totalsFor = (kernel, filters) => ({
  ...salesAnalyticsReal.emptySalesTotals(),
  revenue_usd: kernel.revenueByDay[filters.startDate] ?? 0, profit_usd: 150.25, gross_sales_usd: 450, item_discount_usd: 12.5, discount_usd: 25, total_discount_usd: 37.5,
  delivery_usd: 6, pending_revenue_usd: 40, pending_tx_count: 3, refund_usd: 10, tx_count: 18, cancelled_tx_count: 1,
})
const KERNEL_A = {
  revenueByDay: { [DAY]: 412.5, [YESTERDAY]: 375, [LAST_WEEK]: 450 },
  grouped: {
  payment_method: [{ key: 'cash', label: 'Cash', tx_count: 12, revenue_usd: 300 }, { key: 'aba', label: 'ABA Pay', tx_count: 6, revenue_usd: 112.5 }],
  cashier: [{ key: 'id:7', label: 'Za', tx_count: 12, revenue_usd: 300 }, { key: 'id:8', label: 'Sok', tx_count: 6, revenue_usd: 112.5 }],
  branch: [{ key: 'id:1', label: 'Toul Kork', tx_count: 15, revenue_usd: 362.5 }, { key: 'id:2', label: 'Riverside', tx_count: 3, revenue_usd: 50 }],
  },
  ranking: [
  { product_name: 'Rose Serum', qty: 9, line_sales_usd: 180 }, { product_name: 'Lip Tint', qty: 7, line_sales_usd: 84 },
  { product_name: 'Toner', qty: 5, line_sales_usd: 60 }, { product_name: 'Soap Bar', qty: 4, line_sales_usd: 12 }, { product_name: 'Sunscreen', qty: 2, line_sales_usd: 30 },
  ],
}
const KERNEL_B = {
  revenueByDay: { [DAY]: 9 },
  grouped: { payment_method: [{ key: 'cash', label: 'Cash', tx_count: 1, revenue_usd: 9 }], cashier: [{ key: 'id:1', label: 'Dara', tx_count: 1, revenue_usd: 9 }], branch: [] },
  ranking: [{ product_name: 'Shop B Balm', qty: 1, line_sales_usd: 9 }],
}
const salesAnalytics = {
  ...salesAnalyticsReal,
  getSalesTotals: async (env, filters) => { kernelCalls.push(['totals', filters]); return totalsFor(env.KERNEL, filters) },
  getSalesGroupedTotals: async (env, filters, groupBy, limit) => { kernelCalls.push(['grouped', filters, groupBy, limit]); return (env.KERNEL.grouped[groupBy] || []).map((row) => ({ ...row })) },
  getProductSalesRanking: async (env, filters, limit) => { kernelCalls.push(['ranking', filters, limit]); return env.KERNEL.ranking.slice(0, limit).map((row) => ({ ...row })) },
}
const lowStockSettings = loadReal('lib/lowStockSettings.ts', { './db': dbModule })
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
  './db': dbModule, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockSettings, './db': dbModule, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
  './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation,
})

const posts = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botSYNTHETIC-TOKEN/sendMessage'), `unexpected fetch ${url}`)
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}

let passed = 0
const check = (name, cond, detail) => { assert.ok(cond, detail ? `${name}\n${detail}` : name); passed += 1; console.log(`PASS ${name}`) }

const CLOSED_AT = '2026-09-23T11:30:00.000Z'
const T0 = Date.parse(CLOSED_AT)
let nextShiftId = 40
function closeShift(db, extra = {}) {
  nextShiftId += 1
  insert(db, 'shift_sessions', {
    id: nextShiftId, revision: 3, shift_code: `S-20260923-${nextShiftId}-Za`, scope_mode: 'per_account', user_id: nextShiftId, user_name: 'Za',
    branch_id: 1, branch_name: 'Toul Kork', business_date: DAY, opened_at: '2026-09-23T01:07:00.000Z', closed_at: CLOSED_AT,
    opening_float_usd: 10, opening_float_khr: 10000, closing_counted_usd: 120, closing_counted_khr: 50000, ...extra,
  })
  return nextShiftId
}
async function overview(env, extra) {
  const shiftId = closeShift(env.DB, extra)
  const shift = env.DB.raw.prepare('SELECT id, revision FROM shift_sessions WHERE id = ?').get(shiftId)
  assert.equal(await telegram.scheduleTelegramShiftOverview(env, shiftId, T0), 'fallback')
  const before = posts.length
  assert.equal(await telegram.deliverTelegramShiftOverview(env, telegram.shiftOverviewKey(shift.id, shift.revision), T0 + 60_000), 'sent')
  assert.equal(posts.length, before + 1)
  return posts[posts.length - 1]
}
const headersOf = (text) => text.split('\n').filter((line) => /^=+[^=].*[^=]=+$/.test(line))
const rowsUnder = (text, header) => {
  const lines = text.split('\n')
  const start = lines.indexOf(header)
  if (start < 0) return null
  const rows = []
  for (const line of lines.slice(start + 1)) { if (/^=+[^=].*[^=]=+$/.test(line)) break; rows.push(line) }
  return rows
}
const SWITCH = {
  sales: 'telegram_summary_sales_enabled', cashiers: 'telegram_summary_cashiers_enabled', products: 'telegram_summary_products_enabled',
  returns: 'telegram_summary_returns_enabled', expenses: 'telegram_summary_expenses_enabled', compare: 'telegram_summary_compare_enabled',
}
const DEFAULT_HEADERS = ['=====Sales=====', '=====Invoices=====', '=====Payment methods=====', '=====Expenses=====', '=====Returns=====']

async function main() {
  const shopA = openShop()
  seedShopA(shopA)
  const envA = { DB: shopA, KERNEL: KERNEL_A, TELEGRAM_BOT_TOKEN: 'SYNTHETIC-TOKEN' }

  kernelCalls.length = 0
  const quiet = await overview(envA)
  check('switches unset: the overview is the short default, five sections', JSON.stringify(headersOf(quiet.text)) === JSON.stringify(DEFAULT_HEADERS), quiet.text)
  check('switches unset: the kernel is asked only what the default needs', kernelCalls.length === 2 && kernelCalls[1][2] === 'payment_method', JSON.stringify(kernelCalls))
  check('switches unset: no extra query runs', !preparedSql.some((sql) => /return_items|inventory_movements|payment_details/.test(sql)), preparedSql.filter((sql) => /return_items|inventory_movements|payment_details/.test(sql)).join('\n---\n'))
  check('the overview carries the Summary topic and the shop\'s own chat', quiet.chat_id === CHAT_A && quiet.message_thread_id === SUMMARY_TOPIC_A, JSON.stringify(quiet))

  for (const value of ['false', '', 'TRUE', 'yes', '1']) {
    setting(shopA, SWITCH.sales, value)
    const stillQuiet = await overview(envA)
    check(`a switch stored as ${JSON.stringify(value)} stays off (only 'true' turns a section on)`, JSON.stringify(headersOf(stillQuiet.text)) === JSON.stringify(DEFAULT_HEADERS), stillQuiet.text)
  }
  clearSetting(shopA, SWITCH.sales)

  const alone = {
    sales: ['=====Received====='], cashiers: ['=====Cashiers====='], products: ['=====Top products====='],
    returns: [], expenses: ['=====Each expense====='], compare: ['=====Compare====='],
  }
  const reads = {
    sales: (sql) => sql.some((text) => /payment_details/.test(text)),
    cashiers: (sql, calls) => calls.some(([kind, , by]) => kind === 'grouped' && by !== 'payment_method'),
    products: (sql, calls) => sql.some((text) => /inventory_movements/.test(text)) || calls.some(([kind]) => kind === 'ranking'),
    returns: (sql) => sql.some((text) => /return_items/.test(text)),
    expenses: (sql) => sql.some((text) => /GROUP BY 1 ORDER BY usd DESC/.test(text)),
    compare: (sql, calls) => calls.some(([kind, filters]) => kind === 'totals' && filters.startDate !== DAY),
  }
  const single = {}
  for (const [section, key] of Object.entries(SWITCH)) {
    setting(shopA, key, 'true')
    const sqlFrom = preparedSql.length
    kernelCalls.length = 0
    single[section] = (await overview(envA)).text
    clearSetting(shopA, key)
    const added = headersOf(single[section]).filter((header) => !DEFAULT_HEADERS.includes(header))
    check(`${section} alone adds exactly its own section(s)`, JSON.stringify(added) === JSON.stringify(alone[section]), single[section])
    const read = Object.keys(reads).filter((name) => reads[name](preparedSql.slice(sqlFrom), kernelCalls))
    check(`${section} alone reads only its own figures`, JSON.stringify(read) === JSON.stringify([section]), read.join(', '))
    // NOTIF-V2 (owner, 6 Oct 2026): the standing low / out-of-stock list is retired from every pushed message; crossings
    // are announced one by one from stock_alert_events (test-telegram-stock-alert-pure.cjs). The Products switch is top products only.
    if (section === 'products') check('products alone runs no low / out-of-stock query', !preparedSql.slice(sqlFrom).some((text) => /out_of_stock_threshold/.test(text)), preparedSql.slice(sqlFrom).join('\n'))
  }

  check('Received: dollars net of change, riel, bank; cancelled, other-branch and other-day sales out; the 00:30 local sale in',
    JSON.stringify(rowsUnder(single.sales, '=====Received=====')) === JSON.stringify(['· Dollars: $23.00', '· Riel: 81,000៛', '· Bank: $30.00']),
    rowsUnder(single.sales, '=====Received=====').join('\n'))
  const salesRows = rowsUnder(single.sales, '=====Sales=====')
  check('sales & payments: Not Paid carries its receipt count, and the total discount sits under its two parts',
    salesRows.includes('· Not Paid: 3 · $40.00') && salesRows.indexOf('· Total discount: $37.50') === salesRows.indexOf('· Discount on invoices: $25.00') + 1,
    salesRows.join('\n'))
  check('without the switch Not Paid is the amount alone and there is no total discount row',
    rowsUnder(quiet.text, '=====Sales=====').includes('· Not Paid: $40.00') && !quiet.text.includes('Total discount'))
  telegramLang.setTelegramLanguage('en')
  const oneCut = telegram.formatShiftOverview('Synthetic Shop A', {
    business_date: DAY, branch_id: null, branch_name: null, user_name: 'Za', shift_code: 'S-20260923-0807-Za', opened_at: '2026-09-23T01:07:00.000Z', closed_at: CLOSED_AT,
  }, {
    revenueUsd: 90, profitUsd: 30, grossSalesUsd: 100, itemDiscountUsd: 10, invoiceDiscountUsd: 0, deliveryFeeUsd: 0, creditUsd: 0, refundUsd: 0,
    invoices: 4, cancelled: 0, paymentMethods: [], expenses: { fees: { usd: 0, khr: 0 }, deliveryFees: { usd: 0, khr: 0 }, courier: { usd: 0, khr: 0 } },
    unbranchedFees: null, returns: { count: 0, refundUsd: 0 },
    sections: { sales: { received: { usd: 0, khr: 0, digital: { usd: 0, khr: 0 }, needsReview: false, reviewCodes: [] }, notPaidCount: 0, totalDiscountUsd: 10 } },
  }, undefined, T0)
  telegramLang.setTelegramLanguage('both')
  check('with only one kind of discount the total would repeat it, so it is not printed', oneCut.includes('· Discount on items: $10.00') && !oneCut.includes('Total discount'), oneCut)

  check('Cashiers: the kernel\'s rows by cashier, receipts and revenue', JSON.stringify(rowsUnder(single.cashiers, '=====Cashiers=====')) === JSON.stringify(['· Za: 12 · $300.00', '· Sok: 6 · $112.50']), single.cashiers)
  check('a branch overview has no Branches section (its header already names the branch)', !single.cashiers.includes('=====Branches====='))

  check('Top products: the kernel ranking, five rows, quantity and sales',
    JSON.stringify(rowsUnder(single.products, '=====Top products=====')) === JSON.stringify(['· Rose Serum: 9 · $180.00', '· Lip Tint: 7 · $84.00', '· Toner: 5 · $60.00', '· Soap Bar: 4 · $12.00', '· Sunscreen: 2 · $30.00']),
    single.products)
  check('Low stock: the standing list is not part of the Products section any more', !single.products.includes('=====Low stock=====') && !/\b(OUT|LOW): /.test(single.products), single.products)

  check('Returns: the refunds\' riel equivalent (not riel paid out) and the items returned, from the same returns as the count',
    JSON.stringify(rowsUnder(single.returns, '=====Returns=====')) === JSON.stringify(['· Total: 2 · $10.00', '· Riel equivalent: 41,000៛', '· Items returned: 3']),
    rowsUnder(single.returns, '=====Returns=====').join('\n'))
  check('without the switch Returns is the one total row', JSON.stringify(rowsUnder(quiet.text, '=====Returns=====')) === JSON.stringify(['· Total: 2 · $10.00']))

  const eachExpense = rowsUnder(single.expenses, '=====Each expense=====')
  check('Each expense: this branch\'s non-delivery fees of the day, by label', JSON.stringify(eachExpense) === JSON.stringify(['· Ice: $4.00', '· Moto: 20,000៛']), eachExpense.join('\n'))
  check('the listed expenses add up to the Other expenses row above them', rowsUnder(single.expenses, '=====Expenses=====').includes('· Other expenses: $4.00 · 20,000៛'), single.expenses)

  check('Compare: the day is still running, so it says so; revenue yesterday and the same weekday last week up to the same time, and today\'s change against each',
    JSON.stringify(rowsUnder(single.compare, '=====Compare=====')) === JSON.stringify(['· Each day up to: 18:31', '· Yesterday: $375.00 · +10%', '· Same day last week: $450.00 · −8%']),
    rowsUnder(single.compare, '=====Compare=====').join('\n'))
  const compareCalls = kernelCalls.filter(([kind]) => kind === 'totals').map(([, filters]) => `${filters.startDate}..${filters.endDate}@${filters.branchId}<${filters.createdTo}`)
  check('the comparison days are asked of the kernel on the same branch, each cut at the same moment as today (the overview is sent at 18:31)',
    [`${YESTERDAY}..${YESTERDAY}@1<2026-09-22T11:31:00.000Z`, `${LAST_WEEK}..${LAST_WEEK}@1<2026-09-16T11:31:00.000Z`].every((call) => compareCalls.includes(call)), compareCalls.join(' '))
  const kernelTxCount = async (createdTo) => (await salesAnalyticsReal.getSalesTotals(envA, { startDate: YESTERDAY, endDate: YESTERDAY, branchId: 1, ...(createdTo && { createdTo }) })).tx_count
  check('the real kernel cuts an earlier day at that moment: yesterday up to 18:31 leaves its 19:00 sale out',
    await kernelTxCount(null) === 2 && await kernelTxCount('2026-09-22T11:31:00.000Z') === 1)

  for (const key of Object.values(SWITCH)) setting(shopA, key, 'true')
  kernelCalls.length = 0
  const full = await overview(envA)
  assert.deepStrictEqual(full.text.split('\n').slice(5), [
    '· Open: 23/09/2026 08:07', '· Close: 23/09/2026 18:30',
    '=====Sales=====', '· Revenue: $412.50', '· Discount on items: $12.50', '· Discount on invoices: $25.00', '· Total discount: $37.50', '· Gross sales: $450.00',
    '· Profit: $150.25', '· Delivery fee: $6.00', '· Not Paid: 3 · $40.00', '· Refunds: $10.00',
    '=====Invoices=====', '· Total: 18 · Cancelled: 1',
    '=====Payment methods=====', '· Cash: 12 · $300.00', '· ABA Pay: 6 · $112.50',
    '=====Received=====', '· Dollars: $23.00', '· Riel: 81,000៛', '· Bank: $30.00',
    '=====Cashiers=====', '· Za: 12 · $300.00', '· Sok: 6 · $112.50',
    '=====Top products=====', '· Rose Serum: 9 · $180.00', '· Lip Tint: 7 · $84.00', '· Toner: 5 · $60.00', '· Soap Bar: 4 · $12.00', '· Sunscreen: 2 · $30.00',
    '=====Expenses=====', '· Actual delivery cost: $3.00', '· Other expenses: $4.00 · 20,000៛', '· Total: $7.00 · 20,000៛', '· No branch (not in total): $2.00',
    '=====Each expense=====', '· Ice: $4.00', '· Moto: 20,000៛',
    '=====Returns=====', '· Total: 2 · $10.00', '· Riel equivalent: 41,000៛', '· Items returned: 3',
    '=====Compare=====', '· Each day up to: 18:31', '· Yesterday: $375.00 · +10%', '· Same day last week: $450.00 · −8%',
  ])
  check('every switch on: the whole message, line for line', true)
  check('every switch on: the sections in their fixed order', JSON.stringify(headersOf(full.text)) === JSON.stringify([
    '=====Sales=====', '=====Invoices=====', '=====Payment methods=====', '=====Received=====', '=====Cashiers=====',
    '=====Top products=====', '=====Expenses=====', '=====Each expense=====', '=====Returns=====', '=====Compare=====',
  ]), full.text)
  check('every switch on: still one message into the Summary topic', full.message_thread_id === SUMMARY_TOPIC_A && full.text.length < 3900, `${full.text.length}`)
  const ranking = kernelCalls.find(([kind]) => kind === 'ranking')
  check('top products are asked of the kernel for the overview filters, five of them',
    ranking && JSON.stringify(ranking[1]) === JSON.stringify({ startDate: DAY, endDate: DAY, branchId: 1 }) && ranking[2] === 5, JSON.stringify(ranking))

  setting(shopA, 'telegram_sales_enabled', 'false')
  const salesOff = await overview(envA)
  check('the Sales category off takes every sales-built section out, switched on or not',
    ['Received', 'Cashiers', 'Top products', 'Low stock', 'Compare'].every((name) => !salesOff.text.includes(`=====${name}=====`)), salesOff.text)
  clearSetting(shopA, 'telegram_sales_enabled')
  setting(shopA, 'telegram_fees_enabled', 'false')
  const feesOff = await overview(envA)
  check('the Fees category off takes Each expense out with Expenses', !feesOff.text.includes('=====Each expense=====') && !feesOff.text.includes('=====Expenses====='), feesOff.text)
  clearSetting(shopA, 'telegram_fees_enabled')

  setting(shopA, 'telegram_language', 'km')
  const khmer = await overview(envA)
  check('Khmer: the new section titles and labels come out in Khmer',
    ['=====បានទទួល=====', '=====ទំនិញលក់ដាច់=====', '=====ប្រៀបធៀប=====', '· ដុល្លារ: $23.00', '· រៀល: 81,000៛', '· ធនាគារ: $30.00', '· ម្សិលមិញ: $375.00 · +10%',
      '· ចំនួនស្មើជារៀល: 41,000៛', '· ថ្ងៃនីមួយៗរហូតដល់: 18:31'].every((line) => khmer.text.split('\n').includes(line)) && !khmer.text.split('\n').includes('· រៀល: 41,000៛'),
    khmer.text)
  const packs = Object.fromEntries(['en', 'km'].map((pack) => [pack, JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', `${pack}.json`), 'utf8'))]))
  check('the Returns switch\'s Settings tooltip names the riel equivalent in the chat\'s own words, in both languages',
    packs.en.telegram_summary_returns_desc.toLowerCase().includes(telegramLang.TELEGRAM_LABELS.rielEquivalent.en.toLowerCase())
      && packs.km.telegram_summary_returns_desc.includes(telegramLang.TELEGRAM_LABELS.rielEquivalent.km),
    `${packs.en.telegram_summary_returns_desc} | ${packs.km.telegram_summary_returns_desc}`)
  check('the switches\' Settings hint names every message they extend, in both languages',
    ['/report', 'Send today'].every((name) => packs.en.telegram_summary_sections_hint.includes(name)) && packs.km.telegram_summary_sections_hint.includes('/report'),
    `${packs.en.telegram_summary_sections_hint} | ${packs.km.telegram_summary_sections_hint}`)
  setting(shopA, 'telegram_language', 'both')
  const both = await overview(envA)
  const previousMode = telegramLang.getTelegramLanguage()
  telegramLang.setTelegramLanguage('both')
  const drawn = ['sales', 'invoices', 'paymentMethods', 'received', 'cashiers', 'topProducts', 'expenses', 'eachExpense', 'returns', 'compare']
    .map((key) => telegram.sectionHeader(key, telegramLang.REPORT_SECTION_EDGE))
  telegramLang.setTelegramLanguage(previousMode)
  check('both: every section header is the shared one-row sectionHeader', JSON.stringify(headersOf(both.text)) === JSON.stringify(drawn) && drawn.includes('=====Received/បានទទួល====='), headersOf(both.text).join('\n'))
  setting(shopA, 'telegram_language', 'en')

  const allOn = Object.fromEntries(Object.keys(SWITCH).map((section) => [section, true]))
  for (const key of Object.values(SWITCH)) clearSetting(shopA, key)
  const plainBefore = posts.length
  await telegram.sendTelegramTodaySummary(envA, T0)
  const plain = posts[plainBefore]
  const plainReport = await telegram.telegramCommandReply(envA, '/report', T0, 'en')
  const DAY_SUMMARY_HEADERS = ['=====Sales=====', '=====Invoices=====', '=====Expenses=====', '=====Stock=====', '=====Cashiers=====']
  check('Send today\'s summary, switches off: today\'s /report, word for word, into the Summary topic',
    plain.text === plainReport && plain.chat_id === CHAT_A && plain.message_thread_id === SUMMARY_TOPIC_A && plain.text.startsWith('📊 Business summary: 23/09/2026\n'),
    `${plain.text}\n---\n${plainReport}`)
  check('Send today\'s summary, switches off: it keeps the cashier list and the stock in/out counts',
    JSON.stringify(headersOf(plain.text)) === JSON.stringify(DAY_SUMMARY_HEADERS)
      && JSON.stringify(rowsUnder(plain.text, '=====Cashiers=====')) === JSON.stringify(['· Za: 12 · $300.00', '· Sok: 6 · $112.50'])
      && rowsUnder(plain.text, '=====Stock=====').some((row) => row.startsWith('· Stock out: 2 movement(s)')),
    plain.text)
  for (const key of Object.values(SWITCH)) setting(shopA, key, 'true')

  const todayPostsBefore = posts.length
  kernelCalls.length = 0
  await telegram.sendTelegramTodaySummary(envA, T0)
  const buttonCalls = kernelCalls.slice()
  const today = posts[todayPostsBefore]
  check('Send today\'s summary: one message, into the Summary topic', posts.length === todayPostsBefore + 1 && today.message_thread_id === SUMMARY_TOPIC_A && today.chat_id === CHAT_A, JSON.stringify(today))
  check('Send today\'s summary and /report: one builder, the same message with every switch on',
    today.text === await telegram.telegramCommandReply(envA, '/report', T0, 'en', undefined, allOn), today.text)
  check('Send today\'s summary: the switched-on sections come on top of the day summary, nothing of it disappears',
    JSON.stringify(headersOf(today.text)) === JSON.stringify(['=====Sales=====', '=====Invoices=====', '=====Received=====', '=====Expenses=====', '=====Each expense=====',
      '=====Stock=====', '=====Cashiers=====', '=====Branches=====', '=====Top products=====', '=====Returns=====', '=====Compare====='])
      && ['=====Invoices=====', '=====Expenses=====', '=====Stock=====', '=====Cashiers====='].every((header) => JSON.stringify(rowsUnder(today.text, header)) === JSON.stringify(rowsUnder(plain.text, header)))
      && JSON.stringify(rowsUnder(today.text, '=====Branches=====')) === JSON.stringify(['· Toul Kork: 15 · $362.50', '· Riverside: 3 · $50.00'])
      && rowsUnder(today.text, '=====Sales=====').includes('· Not Paid: 3 · $40.00') && rowsUnder(today.text, '=====Sales=====').includes('· Total discount: $37.50'),
    today.text)
  check('Send today\'s summary: the cashier list is read once, the day summary\'s own', JSON.stringify(buttonCalls.filter(([kind, , by]) => kind === 'grouped' && by === 'cashier').map(([, , , limit]) => limit)) === '[12]', JSON.stringify(buttonCalls))
  check('Send today\'s summary: returns and the same-time comparison for the whole shop',
    JSON.stringify(rowsUnder(today.text, '=====Returns=====')) === JSON.stringify(['· Total: 3 · $70.00', '· Riel equivalent: 287,000៛', '· Items returned: 7'])
      && rowsUnder(today.text, '=====Compare=====')[0] === '· Each day up to: 18:30',
    today.text)
  const pastDay = await telegram.telegramCommandReply(envA, `/report 23/09/2026`, Date.parse('2026-09-25T05:00:00.000Z'), 'en', undefined, allOn)
  check('a /report for a finished day compares whole days and does not claim a time',
    JSON.stringify(rowsUnder(pastDay, '=====Compare=====')) === JSON.stringify(['· Yesterday: $375.00 · +10%', '· Same day last week: $450.00 · −8%'])
      && kernelCalls.filter(([kind, filters]) => kind === 'totals' && filters.startDate !== DAY).slice(-2).every(([, filters]) => filters.createdTo === undefined),
    pastDay)
  const webhookBefore = posts.length
  await telegram.handleTelegramWebhook(envA, { message: { text: '/report 23/09/2026', chat: { id: CHAT_A } } })
  check('a typed /report carries the shop\'s switched-on sections', posts.length === webhookBefore + 1 && headersOf(posts[webhookBefore].text).includes('=====Branches=====') && posts[webhookBefore].chat_id === CHAT_A,
    posts[webhookBefore] && posts[webhookBefore].text)
  check('Send today\'s summary: the kernel is asked for the whole shop', buttonCalls.length > 0 && buttonCalls.every(([, filters]) => filters.branchId == null), JSON.stringify(buttonCalls))
  check('Send today\'s summary: the whole shop\'s dollars include the other branch', rowsUnder(today.text, '=====Received=====')[0] === '· Dollars: $73.00', today.text)
  check('Send today\'s summary: no low / out-of-stock list either', !today.text.includes('=====Low stock====='), today.text)

  const shopB = openShop()
  seedShopB(shopB)
  for (const key of Object.values(SWITCH)) setting(shopB, key, 'true')
  const envB = { DB: shopB, KERNEL: KERNEL_B, TELEGRAM_BOT_TOKEN: 'SYNTHETIC-TOKEN' }
  const fromB = await overview(envB, { branch_id: null, branch_name: null, user_name: 'Dara', shift_code: 'S-20260923-0807-Dara' })
  const fromA = await overview(envA)
  check('two organizations, one module: each message goes to its own chat and topic',
    fromB.chat_id === CHAT_B && fromB.message_thread_id === SUMMARY_TOPIC_B && fromA.chat_id === CHAT_A && fromA.message_thread_id === SUMMARY_TOPIC_A, JSON.stringify([fromA, fromB]))
  check('two organizations: neither message carries the other\'s shop or products',
    fromB.text.includes('Synthetic Shop B') && !/Synthetic Shop A|Rose Serum|Lip Tint|Soap Bar|Sunscreen|Toul Kork|Za\b/.test(fromB.text) && !/Shop B|Dara/.test(fromA.text),
    fromB.text)
  check('two organizations: shop B\'s message has no low / out-of-stock list to leak', !fromB.text.includes('=====Low stock=====') && !fromA.text.includes('=====Low stock====='), fromB.text)
  check('each expense: eight rows, the rest folded into one Other row that keeps the total',
    JSON.stringify(rowsUnder(fromB.text, '=====Each expense=====')) === JSON.stringify([
      '· Fee 01: $10.00', '· Fee 02: $9.00', '· Fee 03: $8.00', '· Fee 04: $7.00', '· Fee 05: $6.00', '· Fee 06: $5.00', '· Fee 07: $4.00', '· Fee 08: $3.00', '· Other: $3.00',
    ]), rowsUnder(fromB.text, '=====Each expense=====').join('\n'))
  check('a drawer figure that cannot be trusted says why, in the chat\'s words',
    rowsUnder(fromB.text, '=====Received=====').includes('· Cash review needed: Change given is ambiguous · Incomplete tender record'), rowsUnder(fromB.text, '=====Received=====').join('\n'))

  const telegramSource = fs.readFileSync(path.join(root, 'src', 'lib', 'telegram.ts'), 'utf8')
  check('the Worker names exactly these six switches', JSON.stringify(telegram.TELEGRAM_SUMMARY_SWITCHES) === JSON.stringify(SWITCH), JSON.stringify(telegram.TELEGRAM_SUMMARY_SWITCHES))
  check('the switches are read with the other Telegram settings', Object.values(SWITCH).every((key) => telegramSource.includes(`'${key}'`)))
  for (const good of ['', 'true', 'false']) assert.equal(telegram.isTelegramSwitchValue(good), true, `${JSON.stringify(good)} is a valid switch value`)
  for (const bad of ['TRUE', 'yes', '1', 'on', ' true']) assert.equal(telegram.isTelegramSwitchValue(bad), false, `${JSON.stringify(bad)} must be rejected`)
  check('the write rule: a switch is \'true\', \'false\' or empty', true)
  const settingsSource = fs.readFileSync(path.join(root, 'src', 'routes', 'settings.ts'), 'utf8')
  check('routes/settings.ts validates every summary switch with the shared rule',
    /for \(const key of Object\.values\(TELEGRAM_SUMMARY_SWITCHES\)\)/.test(settingsSource) && /isTelegramSwitchValue\(raw\)/.test(settingsSource) && /code: 'invalid_telegram_switch'/.test(settingsSource))
  await settingsRouteEnforcesTheSwitchRule()
  const bucketSets = ['BUSINESS_IDENTITY_KEYS', 'SALES_POLICY_KEYS', 'RECEIPT_SETTINGS_KEYS', 'PORTAL_POSTS_KEYS', 'PORTAL_FAQ_KEYS', 'PORTAL_ABOUT_KEYS']
    .map((name) => (settingsSource.match(new RegExp(`const ${name} = new Set\\(\\[[\\s\\S]*?\\]\\)`)) || [''])[0])
  check('the switches take the full Settings grant, like telegram_sales_enabled (no narrower bucket)', Object.values(SWITCH).every((key) => bucketSets.every((block) => !block.includes(key))))
  const adminKeys = loadReal('lib/settingsAdminKeys.ts')
  check('the switches are not administrator-only rows (the Telegram panel itself is admin-only)', Object.values(SWITCH).every((key) => adminKeys.isAdminOnlySettingKey(key) === adminKeys.isAdminOnlySettingKey('telegram_sales_enabled')))
  const opsQuery = fs.readFileSync(path.join(root, '..', 'ops', 'queries', 'telegram-settings.sql'), 'utf8')
  check('the ops telegram-settings read lists every switch', Object.values(SWITCH).every((key) => opsQuery.includes(`'${key}'`)))
  check('no chat or topic id is written into the Worker modules', !/(message_thread_id|messageThreadId|chat_id)\s*[:=]\s*-?\d{3,}/.test(telegramSource))

  console.log(`\n${passed} checks passed; ${posts.length} messages composed for the local Telegram stand-in (none sent anywhere).`)
}

// The REAL routes/settings.ts POST / (the frontend toggles' backend), with its
// relative imports transpiled from source and only I/O stubbed.
async function settingsRouteEnforcesTheSwitchRule() {
  const { openDb } = require('./harness/d1compat.cjs')
  const db = openDb(MIGRATIONS)
  let sessionUser = null
  const stubs = {
    '../lib/db': { getDb: (env) => env.DB },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
    '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': { bumpVersion: async () => {} },
  }
  const loaded = new Map()
  const load = (rel) => {
    if (loaded.has(rel)) return loaded.get(rel).exports
    const sourcePath = path.join(root, 'src', rel)
    const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
    })
    const mod = { exports: {} }
    loaded.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', outputText)(localRequire, mod, mod.exports)
    return mod.exports
  }
  const app = load('routes/settings.ts').default
  const manager = { id: 21, username: 'synthetic-manager', permissions: JSON.stringify({ settings: true }), role_code: null, role_permissions: null }
  const save = async (body) => {
    sessionUser = manager
    const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
  const switches = Object.values(SWITCH)

  const on = await save(Object.fromEntries(switches.map((key) => [key, 'true'])))
  check('the Settings route saves every switch as \'true\' for a Settings account', on.status === 200 && switches.every((key) => stored(key) === 'true'), JSON.stringify(on))
  const off = await save({ [SWITCH.sales]: 'false', [SWITCH.compare]: ' ' })
  check('the Settings route saves \'false\' and a blank switch as empty', off.status === 200 && stored(SWITCH.sales) === 'false' && stored(SWITCH.compare) === '', JSON.stringify(off))
  for (const bad of ['TRUE', 'yes', '1', 'on']) {
    for (const key of switches) {
      const refused = await save({ business_name: `Renamed ${bad}`, [key]: bad })
      assert.equal(refused.status, 400, `${key}=${JSON.stringify(bad)} must be refused`)
      assert.equal(refused.body.code, 'invalid_telegram_switch')
      assert.notEqual(stored('business_name'), `Renamed ${bad}`, 'a refused save writes nothing')
    }
  }
  check('the Settings route refuses any other switch value, and the whole save with it', true)
}

main().catch((error) => { console.error(error); process.exit(1) })
