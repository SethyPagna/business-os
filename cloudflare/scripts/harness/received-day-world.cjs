// The synthetic shop and the real modules behind test-telegram-received-day-pure.cjs and test-telegram-d1-calls-pure.cjs
// (lane 6.0.1007): three business days on two branches, payments dated by when they were received, and the REAL
// lib/telegram.ts, dayPaymentsReceived.ts, shiftReconciliation.ts and salesAnalytics.ts over node:sqlite with the real
// migration chain. buildModules(dbModule) loads them over the db module you pass: the hand-made compat object
// (compatDb) or the real lib/db.ts over a D1-shaped stand-in.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./load_migrations.cjs')
const { seedStockFixture } = require('./seed-stock-fixture.cjs')
const productStockGuard = require('./product_stock_guard.cjs')

const root = path.join(__dirname, '..', '..')

function loadReal(relPath, overrides = {}, mutate = (text) => text) {
  const sourcePath = path.join(root, 'src', relPath)
  const { outputText } = ts.transpileModule(mutate(fs.readFileSync(sourcePath, 'utf8')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const original = Module._load
  Module._load = function (request, parent, main) { if (request === './productStockGuard') return productStockGuard; return request in overrides ? overrides[request] : original.call(this, request, parent, main) }
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
  return {
    raw, bind, names,
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
}
const insert = (db, table, row) => {
  const columns = Object.keys(row)
  seedStockFixture(db.raw, () => db.raw.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map((column) => row[column])))
}
const setting = (db, key, value) => db.raw.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)


// ---- the world: three business days, two branches -------------------------------------------------------------
const D1 = '2026-10-20'
const D2 = '2026-10-21'
const D3 = '2026-10-22'
const DAYS = [D1, D2, D3]
const CHAT = '-1009990011'
const NOW_MS = Date.parse('2026-10-23T05:00:00.000Z')

function seedShop(db) {
  for (const [key, value] of Object.entries({
    business_name: 'Synthetic Received-Day Shop', telegram_chat_id: CHAT, telegram_language: 'en', pos_payment_methods: '["Cash","ABA Pay"]',
  })) setting(db, key, value)
  insert(db, 'branches', { id: 1, name: 'Toul Kork' })
  insert(db, 'branches', { id: 2, name: 'Riverside' })
  // Local 10:00 = 03:00Z. A sale is described by when it was RUNG (created_at) and by its payment events (received_at).
  const sale = (id, extra) => insert(db, 'sales', {
    id, receipt_number: `R-${id}`, branch_id: 1, sale_status: 'completed', exchange_rate: 4100, payments_version: 1, created_at: '2026-10-20 03:00:00',
    amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0, change_is_actual: 0, total_usd: 0, ...extra,
  })
  let eventNo = 0
  const event = (saleId, extra) => insert(db, 'sale_payment_events', {
    event_id: `evt-${++eventNo}`, sale_id: saleId, direction: 'in', origin: 'checkout', payment_method: 'Cash', payment_details: '[]',
    amount_paid_usd: 0, amount_paid_khr: 0, change_usd: 0, change_khr: 0, change_is_actual: 0, exchange_rate: 4100, drawer_effect: 1, branch_id: 1,
    received_at: '2026-10-20 03:00:00', ...extra,
  })
  const cash = (usd, khr = 0) => JSON.stringify([{ method: 'Cash', amount_usd: usd, amount_khr: khr }])
  const aba = (usd) => JSON.stringify([{ method: 'ABA Pay', amount_usd: usd, amount_khr: 0 }])

  // S1: rung on D1, nothing paid; the customer pays $30 cash on D2 (a later collect).
  sale(1, { sale_status: 'completed', total_usd: 30, payment_method: 'Cash', payment_details: cash(30), amount_paid_usd: 30 })
  event(1, { origin: 'collect', payment_method: 'Cash', payment_details: cash(30), amount_paid_usd: 30, received_at: '2026-10-21 05:00:00' })
  // S2: rung on D2, unpaid until D3 (ABA $20).
  sale(2, { created_at: '2026-10-21 04:00:00', total_usd: 20, payment_method: 'ABA Pay', payment_details: aba(20), amount_paid_usd: 20 })
  event(2, { origin: 'collect', payment_method: 'ABA Pay', payment_details: aba(20), amount_paid_usd: 20, received_at: '2026-10-22 03:00:00' })
  // S3: rung and paid in cash $10 on D1; on D2 the payment is corrected to ABA (out of cash, in to ABA, both dated D2).
  sale(3, { created_at: '2026-10-20 05:00:00', total_usd: 10, payment_method: 'ABA Pay', payment_details: aba(10), amount_paid_usd: 10 })
  event(3, { origin: 'checkout', payment_method: 'Cash', payment_details: cash(10), amount_paid_usd: 10, received_at: '2026-10-20 05:00:00' })
  event(3, { origin: 'correction', direction: 'out', payment_method: 'Cash', payment_details: cash(10), amount_paid_usd: 10, received_at: '2026-10-21 06:00:00' })
  event(3, { origin: 'correction', direction: 'in', payment_method: 'ABA Pay', payment_details: aba(10), amount_paid_usd: 10, received_at: '2026-10-21 06:00:00' })
  // S4: rung and paid on D2: $20 + 41,000 riel in cash, $2 change handed back (net $18 + 41,000 riel).
  sale(4, { created_at: '2026-10-21 08:00:00', total_usd: 28, payment_method: 'Cash', payment_details: cash(20, 41000), amount_paid_usd: 20, amount_paid_khr: 41000, change_usd: 2, change_is_actual: 1, change_exchange_rate: 4100 })
  event(4, { origin: 'checkout', payment_details: cash(20, 41000), amount_paid_usd: 20, amount_paid_khr: 41000, change_usd: 2, change_is_actual: 1, change_exchange_rate: 4100, received_at: '2026-10-21 08:00:00' })
  // S5-S7: old sales (payments_version 0): their tender belongs to the day they were rung. S6 is the last second of D2, S7 the first of D3, in the ISO shape production stores.
  sale(5, { payments_version: 0, created_at: '2026-10-21 09:00:00', total_usd: 7, payment_method: 'Cash', payment_details: cash(7), amount_paid_usd: 7 })
  sale(6, { payments_version: 0, created_at: '2026-10-21T16:59:59.999Z', total_usd: 3, payment_method: 'Cash', payment_details: cash(3), amount_paid_usd: 3 })
  sale(7, { payments_version: 0, created_at: '2026-10-21T17:00:00.000Z', total_usd: 4, payment_method: 'Cash', payment_details: cash(4), amount_paid_usd: 4 })
  // S8: cancelled -- its events count for nobody. S9: the other branch. S10: a payment recorded late, outside the drawer.
  sale(8, { created_at: '2026-10-21 04:30:00', sale_status: 'cancelled', total_usd: 99, payment_details: cash(99), amount_paid_usd: 99 })
  event(8, { payment_details: cash(99), amount_paid_usd: 99, received_at: '2026-10-21 04:30:00' })
  sale(9, { created_at: '2026-10-21 04:40:00', branch_id: 2, total_usd: 11, payment_details: cash(11), amount_paid_usd: 11 })
  event(9, { branch_id: 2, payment_details: cash(11), amount_paid_usd: 11, received_at: '2026-10-21 04:40:00' })
  sale(10, { created_at: '2026-10-20 06:00:00', total_usd: 13, payment_details: cash(13), amount_paid_usd: 13 })
  event(10, { origin: 'late_record', drawer_effect: 0, payment_details: cash(13), amount_paid_usd: 13, received_at: '2026-10-21 06:30:00' })
  // Old sales that sit on days nobody asks about, and a v1 event far away: they must never be read.
  sale(11, { payments_version: 0, created_at: '2026-09-01 03:00:00', total_usd: 500, payment_details: cash(500), amount_paid_usd: 500 })
  sale(12, { created_at: '2026-09-01 03:00:00', total_usd: 600, payment_details: cash(600), amount_paid_usd: 600 })
  event(12, { payment_details: cash(600), amount_paid_usd: 600, received_at: '2026-09-01 03:00:00' })

  // Refunds are dated when handed back (returns.created_at), whatever the original sale's day.
  const ret = (id, extra) => insert(db, 'returns', { id, branch_id: 1, status: 'completed', return_scope: 'customer', created_at: '2026-10-21 07:00:00', total_refund_usd: 0, total_refund_khr: 0, ...extra })
  ret(1, { sale_id: 1, total_refund_usd: 5, total_refund_khr: 20500 })                                    // D2, dollars (sale rung D1)
  ret(2, { sale_id: 2, total_refund_usd: 2.5, total_refund_khr: 10250, refund_currency: 'KHR' })           // D2, paid in riel
  ret(3, { sale_id: 3, total_refund_usd: 1, total_refund_khr: 4100, created_at: '2026-10-20 08:00:00' })   // D1
  ret(4, { sale_id: 4, total_refund_usd: 40, total_refund_khr: 164000, status: 'cancelled' })              // cancelled: no money left
  ret(5, { sale_id: 5, total_refund_usd: 9, total_refund_khr: 36900, return_scope: 'supplier' })           // to a supplier, not a customer
  ret(6, { sale_id: 9, total_refund_usd: 60, total_refund_khr: 246000, branch_id: 2 })                     // D2, other branch
  ret(7, { sale_id: 5, total_refund_usd: 6, total_refund_khr: 24600, owed_reduction_usd: 6 })              // D2: lowered a debt, nothing left the drawer
}


const compatDb = { getDb: (env) => env.DB }

/** The real modules over .  replaces the sales kernel's totals, groupings and ranking with fixed answers. */
function buildModules(dbModule, { kernel = 'stub' } = {}) {
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
  const salesAnalyticsReal = loadReal('lib/salesAnalytics.ts', {
    './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': dbModule, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow,
    './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision,
  })
  // Revenue is not under test: the kernel's totals are fixed numbers, so any difference below is the Received section's.
  const salesAnalytics = kernel === 'real' ? salesAnalyticsReal : {
    ...salesAnalyticsReal,
    getSalesTotals: async () => ({ ...salesAnalyticsReal.emptySalesTotals(), revenue_usd: 100, tx_count: 4, pending_tx_count: 1, not_paid_owed_usd: 20 }),
    getSalesGroupedTotals: async () => [],
    getProductSalesRanking: async () => [],
  }
  const paymentMethodRegistry = loadReal('lib/paymentMethodRegistry.ts')
  const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', {
    './db': dbModule, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': paymentMethodRegistry,
  })
  const lowStockSettings = loadReal('lib/lowStockSettings.ts', { './db': dbModule })
  const dayModule = (mutate) => loadReal('lib/dayPaymentsReceived.ts', {
    './db': dbModule, './businessDateWindow': businessDateWindow, './salesAnalytics': salesAnalyticsReal, './paymentMethodRegistry': paymentMethodRegistry, './shiftReconciliation': shiftReconciliation,
  }, mutate)
  const loadTelegram = (day, overrides = {}, mutate) => loadReal('lib/telegram.ts', {
    './lowStockSettings': lowStockSettings, './db': dbModule, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
    './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation, './dayPaymentsReceived': day, './d1ReadCoalescer': loadReal('lib/d1ReadCoalescer.ts'), ...overrides,
  }, mutate)
  return { businessDateWindow, telegramLang, saleTotals, nativeSaleChange, salesAnalyticsReal, salesAnalytics, paymentMethodRegistry, shiftReconciliation, lowStockSettings, dayModule, loadTelegram }
}

module.exports = {
  fs, path, assert, loadReal, seedStockFixture, openShop, insert, setting, seedShop, preparedSql, buildModules, compatDb, root,
  D1, D2, D3, DAYS, CHAT, NOW_MS,
}
