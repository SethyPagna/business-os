// Owner ask N6: the Telegram day / cashier / sales reports must read the SAME
// kernel every other stat surface reads. They did not.
//
// `/report` and `/summary` answered with
//     SELECT COUNT(*), SUM(total_usd), SUM(total_khr) FROM sales WHERE <day>
// with no status filter at all. That figure:
//   * counted VOIDED receipts as takings,
//   * called the tax and the delivery fee "sales",
//   * subtracted no refund,
// so the number the owner reads on a phone at closing time disagreed with the
// Sales page, the Dashboard, the Reports hub -- and with the SHIFT report
// three hundred lines further down the very same file, which has read the
// kernel since S4-7. `/cashiers` had the identical defect, one slice down.
//
// This test renders the real messages against a real (in-memory) database
// through the real kernel, and carries a POSITIVE CONTROL: the pre-fix SQL is
// rebuilt verbatim and run over the same rows, so the fixture is proven to be
// one the old and new implementations actually disagree about.
//
// Run (from cloudflare/): node scripts/test-telegram-day-report-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const Database = require('better-sqlite3')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

// ---- the database -----------------------------------------------------------
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, receipt_number TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL,
    tax_usd REAL, total_usd REAL, total_khr REAL,
    delivery_fee_usd REAL, delivery_fee_paid_by TEXT, is_delivery INTEGER,
    delivery_actual_cost_usd REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, branch_name TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT,
    cashier_id INTEGER, cashier_name TEXT, payment_method TEXT, amount_paid_usd REAL,
    source_return_id INTEGER
  );
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    applied_price_usd REAL, applied_price_khr REAL,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL,
    status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER,
    supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT);
  CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT);
  CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER, created_by INTEGER, created_at TEXT);
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, movement_type TEXT, quantity REAL, created_at TEXT);
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT,
    phone TEXT,
    gender TEXT,
    is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1))
  );
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, category TEXT, stock_quantity REAL,
    is_active INTEGER NOT NULL DEFAULT 1, low_stock_threshold REAL, out_of_stock_threshold REAL DEFAULT 0);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
`)

// 2026-08-10 05:00Z = 12:00 local (UTC+7). The day is not the variable here.
const AT = '2026-08-10 05:00:00'
const ins = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, receipt_number, subtotal_usd, discount_usd, membership_discount_usd, tax_usd,
   total_usd, total_khr, delivery_fee_usd, delivery_fee_paid_by, is_delivery, branch_id, branch_name, cashier_id, cashier_name, payment_method)
  VALUES (@id,@created_at,@sale_status,@receipt_number,@subtotal_usd,@discount_usd,0,@tax_usd,
   @total_usd,@total_khr,@delivery_fee_usd,'customer',0,1,'shop',@cashier_id,@cashier_name,'cash')`)
const sale = (o) => ins.run({ discount_usd: 0, tax_usd: 0, total_khr: 0, delivery_fee_usd: 0, created_at: AT, ...o })

// A real sale: $100 of goods, $10 off, $8 tax, $5 delivery. Revenue is $90 --
// the tax and the delivery fee are not sales.
sale({ id: 1, sale_status: 'completed', receipt_number: '20260810-090000', subtotal_usd: 100, discount_usd: 10, tax_usd: 8, delivery_fee_usd: 5, total_usd: 103, total_khr: 412000, cashier_id: 1, cashier_name: 'aza' })
// A VOIDED receipt, for a large amount. Worth nothing, and the old query
// counted every cent of it.
sale({ id: 2, sale_status: 'cancelled', receipt_number: '20260810-100000', subtotal_usd: 500, total_usd: 500, total_khr: 2000000, cashier_id: 1, cashier_name: 'aza' })
// A sale refunded the same day: $40 rung up, $15 given back. Revenue is $25.
sale({ id: 3, sale_status: 'completed', receipt_number: '20260810-110000', subtotal_usd: 40, total_usd: 40, total_khr: 160000, cashier_id: 2, cashier_name: 'sok' })

const insItem = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name, applied_price_usd, applied_price_khr) VALUES (?,?,?,?,?,?,?,?,?,?)')
insItem.run(1, 1, 1, 30, 100, 1, 101, 'Lamp', 100, 400000)
insItem.run(2, 2, 1, 200, 500, 1, 102, 'Sofa', 500, 2000000)
insItem.run(3, 3, 1, 10, 40, 1, 103, 'Mug', 40, 160000)

// A receipt with more items than /sales lists, on the NEXT day (Sep 23 2026).
// It is a day of its own so that every figure asserted for 10/08/2026 above
// and below is untouched by it: this sale exists only to make the receipt
// list overflow and print its `+ N more` continuation.
sale({ id: 4, sale_status: 'completed', receipt_number: '20260811-090000', subtotal_usd: 60, total_usd: 60, total_khr: 240000, cashier_id: 1, cashier_name: 'aza', created_at: '2026-08-11 05:00:00' })
for (let i = 0; i < 6; i += 1) insItem.run(10 + i, 4, 1, 4, 10, 1, 110 + i, `Basket ${i + 1}`, 10, 40000)

db.prepare('INSERT INTO returns (id, sale_id, total_refund_usd, total_refund_khr, status, return_scope, created_at, branch_id, reason) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(1, 3, 15, 0, 'completed', 'customer', AT, 1, 'damaged')
db.prepare('INSERT INTO return_items (id, return_id, quantity, cost_price_usd, return_to_stock, stock_action) VALUES (?,?,?,?,?,?)')
  .run(1, 1, 1, 4, 1, 'restock')

// ---- fixture for /stock and /inventory (Sep 22 2026 sectioned redesign) ----
// 14 active products qualify as low/out of stock (past the LIMIT 12 cap the
// query has always applied), one healthy product does not qualify, and one
// INACTIVE product carries 0 stock so is_active = 1 is proven to still
// exclude it. All against a REAL SQLite engine, so the LIMIT and the
// is_active filter are the ones the Worker actually runs, not a stub's idea
// of them.
const insProduct = db.prepare('INSERT INTO products (id, name, stock_quantity, is_active, low_stock_threshold, out_of_stock_threshold) VALUES (?,?,?,?,?,?)')
for (let i = 0; i < 6; i += 1) insProduct.run(300 + i, `Out item ${String(i).padStart(2, '0')}`, 0, 1, 5, 0) // OUT (qty <= out threshold 0)
for (let i = 0; i < 8; i += 1) insProduct.run(310 + i, `Low item ${String(i).padStart(2, '0')}`, 3, 1, 5, 0) // LOW (qty <= low threshold 5, > out threshold)
insProduct.run(399, 'Healthy item', 100, 1, 5, 0) // above both thresholds -- never listed
insProduct.run(398, 'Inactive item', 0, 0, 5, 0)  // is_active = 0 -- must not appear anywhere

// ---- the real modules -------------------------------------------------------
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
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const analytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': dbShim, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
// Merged Sep 6 2026: telegram.ts now reads the owner's low-stock setting
// through lib/lowStockSettings.ts and shares the drawer arithmetic through
// lib/shiftReconciliation.ts (lowstock and shifts lanes). Both are the REAL
// modules; the settings READ answers the shipped default since this harness
// has no settings table. Same injection as test-telegram-messages-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': dbShim })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', { './db': dbShim, './salesAnalytics': analytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') })
const telegram = loadReal('lib/telegram.ts', {
  './db': dbShim,
  './lowStockSettings': lowStockStub,
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': analytics,
  './shiftReconciliation': shiftReconciliation,
})

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const SEP = lang.BILINGUAL_SEPARATOR
// The riel SIGN is Khmer script but it is a currency symbol, not a word.
const khmerText = (value) => /[ក-៿]/.test(String(value).replace(/៛/g, ''))
// Sep 23 2026: a report section opens with its name between two `=====`
// edges (owner: "for telegram reports, instead of plain line ------we can do
// =====section name===== instead."), five a side, or fewer when five would
// push the line onto a second row (owner, the same day: "for the header
// marks, make sure the line stays in one line/row. this means you can use
// less header marks if it pushes to next row for the telegram message").
// Literals here, not the exported constant, so the checks below read the
// TEXT the chat receives.
const EDGE = '====='
const SECTION = /^(={1,5})([^=](?:.*[^=])?)(={1,5})$/
const sectionParts = (line) => {
  const match = String(line).match(SECTION)
  return match && match[1] === match[3] ? [match[1].length, match[2]] : null
}
const isSection = (line) => sectionParts(line) !== null
const sectionName = (line) => sectionParts(line)[1]
const DAY_SECTIONS = ['sales', 'invoices', 'expenses', 'stock', 'cashiers']
// The header of a section whose name has room for all five marks -- every
// section this file names except /sales's Latest receipts in both languages.
const headerOf = (key) => `${EDGE}${lang.label(key)}${EDGE}`

;(async () => {
// ---- POSITIVE CONTROL: what the reports used to say --------------------------
const oldDay = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd, COALESCE(SUM(total_khr), 0) AS khr
  FROM sales WHERE ${businessDateWindow.localDateRangeClause('created_at', '@date', '@date')}`).get({ date: '2026-08-10' })
check(`POSITIVE CONTROL: the pre-fix day query really did report ${oldDay.count} receipts and $${oldDay.usd}`,
  oldDay.count === 3 && oldDay.usd === 643)
const oldCashiers = db.prepare(`SELECT COALESCE(NULLIF(TRIM(cashier_name), ''), 'Unknown') AS cashier,
    COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS usd
  FROM sales WHERE ${businessDateWindow.localDateRangeClause('created_at', '@date', '@date')}
  GROUP BY 1 ORDER BY usd DESC`).all({ date: '2026-08-10' })
check(`POSITIVE CONTROL: and credited the voided receipt to its cashier ($${oldCashiers[0].usd} for ${oldCashiers[0].cashier})`,
  oldCashiers[0].cashier === 'aza' && oldCashiers[0].usd === 603)

// ---- what the kernel says ----------------------------------------------------
const totals = await analytics.getSalesTotals({}, { startDate: '2026-08-10', endDate: '2026-08-10', branchId: null })
check(`the kernel's revenue for the day is $${totals.revenue_usd} (net sales $130 less the $15 refund)`,
  totals.revenue_usd === 115 && totals.tx_count === 2 && totals.cancelled_tx_count === 1 && totals.refund_usd === 15)

// ---- the rendered message ----------------------------------------------------
const report = await telegram.telegramCommandReply({}, '/report 10/08/2026')
check('the day report renders', report.includes('10/08/2026') && report.length > 40)
check(`the Revenue line carries the KERNEL revenue, not the old gross ($115.00 present, $643.00 absent)`,
  report.includes('$115.00') && !report.includes('$643.00'))
// SECTIONED Sep 21 2026 (owner: "same for other telegram report enough
// spacing and separations ... using dividers, numbered list, etc... title
// etc..."). A title line, then titled sections, in the same vocabulary the
// shift report uses -- since Sep 23 2026 each opening with `=====Name=====`.
const sectionTitles = report.split('\n').filter(isSection)
check(`the day summary is a title line and ${sectionTitles.length} titled sections`,
  /^📊 Business summary\/[^\n]+: 10\/08\/2026$/.test(report.split('\n')[0])
  && sectionTitles.join(' | ') === DAY_SECTIONS.map(headerOf).join(' | ')
  && sectionTitles.every((line) => line.includes(SEP)), report)
check('each section opens with `=====Name/ឈ្មោះ=====`: no rule above it, no number in front',
  report.split('\n').includes('=====Sales/ការលក់=====') && lang.REPORT_SECTION_EDGE === '='
  && !report.includes(lang.RULE) && !/^\d+\.\s/m.test(report), report)
check('and every row inside a section is a `·` row, the cashier list included',
  report.split('\n').slice(1).every((line) => isSection(line) || line.startsWith(lang.ROW_BULLET) || line.startsWith(lang.HANGING_INDENT))
  && report.split('\n').includes('· aza: 1 · $90.00') && !report.includes('•'), report)
// REDESIGNED Sep 6 2026: one figure per line. The counts of the SAME thing
// share one compact row (Sep 21 2026), under the Invoices section.
check('and the kernel receipt count, not the count that included the void',
  /^· Total\/[^\n]*: 2 · /m.test(report) && !/: 3 · /m.test(report) && !/: 3$/m.test(report))
check('the refund that produced the difference is printed, so the number explains itself',
  /^· Refunds\/[^\n]*: \$15\.00$/m.test(report))
check('the voided receipt is REPORTED as voided rather than silently counted or silently dropped',
  /Cancelled\/[^\n]*: 1/.test(report))
// The whole point of the redesign, stated as a measurement rather than a
// claim: the pre-redesign message spread the same day over prose-tagged
// lines. This one is sections of figures, each under its own title. The cap
// keeps the six lines of slack it had over this fixture before Sep 23 2026,
// when each section's rule and numbered title (two lines) became one header.
check(`the day summary fits one phone screen (${report.split('\n').length} lines)`,
  report.split('\n').length <= 21)
check('and its Sales section leads with revenue and profit, the two that always print',
  /^· Revenue\/[^\n]*: \$115\.00$/m.test(report) && /^· Profit\//m.test(report))
check('the tax and the delivery fee are not inside the sales figure',
  !report.includes('$103.00') && !report.includes('$128.00'))

check(`each cashier's line is the same kernel sliced, so aza shows $90.00 not $603.00`,
  report.includes('aza') && report.includes('$90.00') && !report.includes('$603.00'))
check('and sok shows the refunded sale net, $25.00', report.includes('sok') && report.includes('$25.00'))
// The strongest statement available on a rendered message: the two cashier
// figures add up to the headline. They could not before -- one of them
// included a void.
check('the per-cashier revenues sum to the day revenue (90 + 25 = 115)', 90 + 25 === totals.revenue_usd)

// ---- the shop's language choice, end to end ---------------------------------
// Settings → Telegram → language ('both' by default). The mode is applied
// while the message is COMPOSED, so the same query path produces one report in
// three renderings and no figure moves between them.
const reportEn = await telegram.telegramCommandReply({}, '/report 10/08/2026', Date.now(), 'en')
const reportKm = await telegram.telegramCommandReply({}, '/report 10/08/2026', Date.now(), 'km')
check("'en' drops the Khmer half of every label and keeps every figure",
  !khmerText(reportEn) && reportEn.includes('$115.00')
  && reportEn.split('\n').includes('· Revenue: $115.00')
  && reportEn.split('\n').includes('=====Sales=====')
  && reportEn.split('\n').filter(isSection).map(sectionName).join(' | ') === sectionTitles.map((line) => sectionName(line).split(SEP)[0]).join(' | '))
// Cashier NAMES (`aza`, `sok`) are DATA, glued to a colon exactly like every
// other list row since the 25 Sep 2026 em-dash removal -- they are excluded
// here the same way a payment method or courier name is in the shift report
// test, not because the label check is wrong.
const KM_DATA_ROW_NAMES = new Set(['aza', 'sok'])
check("'km' drops the English half and still carries the same figures",
  reportKm.includes('$115.00') && reportKm.startsWith('📊 ')
  && reportKm.split('\n').includes('=====ការលក់=====')
  && reportKm.split('\n').filter(isSection).length === sectionTitles.length
  && reportKm.split('\n').filter(isSection).every((line) => !/[A-Za-z]/.test(line))
  && reportKm.split('\n').every((line) => {
    const split = line.indexOf(': ')
    if (split <= 0) return true
    const labelPart = line.slice(0, split).replace(/^· /, '')
    return KM_DATA_ROW_NAMES.has(labelPart) || !/[A-Za-z]/.test(labelPart)
  }), reportKm)
check('all three renderings have the same number of lines -- one report, three languages',
  report.split('\n').length === reportEn.split('\n').length
  && report.split('\n').length === reportKm.split('\n').length)
// A cashier NAME is data: it is not a label and is never translated.
check('cashier names survive every mode untouched',
  reportEn.includes('aza') && reportKm.includes('aza'))

// ---- the owner's per-category switches reach the TYPED command --------------
//
// Sep 23 2026. They reached the pushed evening summary
// (sendTelegramTodaySummary passes config.categories) and stopped at the
// typed one: dayReport called formatDaySummary with no categories at all, so
// the same report, from the same builder, answered differently depending on
// whether the shop waited for it or asked for it. A shop that had switched
// Expenses off saw it every time anybody typed /report.
const reportFeesOff = await telegram.telegramCommandReply({}, '/report 10/08/2026', Date.now(), 'both', { fees: false })
const titlesOf = (text) => text.split('\n').filter(isSection).map((line) => sectionName(line).split(SEP)[0].trim())
check(`/report honours fees:false -- the Expenses section is gone (${titlesOf(reportFeesOff).join(' | ')})`,
  !titlesOf(reportFeesOff).includes('Expenses') && !reportFeesOff.includes('Expenses'), reportFeesOff)
check('and the sections behind it keep their order, with nothing left in its place',
  titlesOf(reportFeesOff).join(' | ') === 'Sales | Invoices | Stock | Cashiers', reportFeesOff)
check('a sales:false /report drops Sales and Invoices and leaves no gap',
  titlesOf(await telegram.telegramCommandReply({}, '/report 10/08/2026', Date.now(), 'both', { sales: false }))
    .join(' | ') === 'Expenses | Stock | Cashiers')
// POSITIVE CONTROL: the same command with no switches still prints them, so
// the two checks above are about the SWITCH and not about this fixture.
check('POSITIVE CONTROL: /report with no categories still prints every section',
  titlesOf(report).join(' | ') === 'Sales | Invoices | Expenses | Stock | Cashiers', report)
// And the webhook has to HAND them over: the parameter existing proves
// nothing if the one live caller still leaves it out.
check('handleTelegramWebhook passes the shop\'s switches into the command reply',
  /telegramCommandReply\(env, text, Date\.now\(\), config\.language, config\.categories\)/.test(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')))

// ---- /sales ------------------------------------------------------------------
const salesMsg = await telegram.telegramCommandReply({}, '/sales 10/08/2026')
check('the /sales total is the kernel total too', salesMsg.includes('$115.00') && !salesMsg.includes('$643.00'))
check('the receipt LIST does not show the voided receipt under a total it is not part of',
  salesMsg.includes('20260810-090000') && salesMsg.includes('20260810-110000') && !salesMsg.includes('20260810-100000'))
// Sep 23 2026: the items under each receipt used to read `   1 × Lamp — $100.00`
// -- quantity first, an em dash where every other message puts an equals sign,
// and NO line total, so the one figure the reader wanted was the one they had
// to multiply out. They now print the sale alert's own numbered equation.
// An item too wide for a phone continues nested under its receipt on the
// hanging indent (Sep 23 2026); read back as one line each, it is unchanged.
const salesLines = salesMsg.split('\n')
const itemContinuation = `   ${lang.HANGING_INDENT}`
const saleItemLines = salesLines
  .reduce((rows, line) => (line.startsWith(itemContinuation) ? [...rows.slice(0, -1), `${rows[rows.length - 1]} ${line.trim()}`] : [...rows, line]), [])
  .filter((line) => /^ {3}\d+\. /.test(line))
check(`each receipt lists its items as a numbered equation (${saleItemLines.length} item lines)`,
  saleItemLines.length === 2
  && saleItemLines[0] === '   1. Lamp 1 × $100.00 · 400,000៛ = $100.00 · 400,000៛'
  && saleItemLines[1] === '   1. Mug 1 × $40.00 · 160,000៛ = $40.00 · 160,000៛')
check('and an item too wide for a phone continues under its own number, never at the receipt\'s edge',
  salesLines.includes('   1. Lamp 1 × $100.00 · 400,000៛')
  && salesLines.includes(`${itemContinuation}= $100.00 · 400,000៛`), salesMsg)
check('and the retired quantity-first em-dash form is gone from the item lines',
  !/\d+ × [A-Za-z]/.test(salesMsg) && !saleItemLines.some((line) => line.includes('—')))
// Sep 23 2026: /sales takes the `=====` headers too, and each receipt is a
// `·` row; only the items under a receipt stay numbered. Latest receipts, in
// both languages, is 36 characters before its marks -- a phone row on its
// own -- so it keeps one `=` a side instead of five ("you can use less header
// marks if it pushes to next row"), while Sales and Invoices keep all five.
check('/sales opens its three sections with `=====` headers and lists each receipt as a `·` row',
  salesLines.filter(isSection).join(' | ') === [headerOf('sales'), headerOf('invoices'), '=Latest receipts/វិក្កយបត្រចុងក្រោយ='].join(' | ')
  && salesLines.includes('· 20260810-090000') && salesLines.includes('· 20260810-110000')
  && !salesMsg.includes('•') && !salesLines.includes(lang.RULE), salesMsg)
check('a section name too long for five marks within one row gets fewer: Latest receipts keeps one a side',
  salesLines.includes('=Latest receipts/វិក្កយបត្រចុងក្រោយ=') && !salesMsg.includes('==Latest receipts'), salesMsg)
check('POSITIVE CONTROL: a name with room keeps all five, in the same message',
  salesLines.includes('=====Sales/ការលក់=====') && salesLines.includes('=====Invoices/វិក្កយបត្រ====='), salesMsg)
// The single-language renderings have room for all five on every title.
const [salesEn, salesKm] = await Promise.all([
  telegram.telegramCommandReply({}, '/sales 10/08/2026', Date.now(), 'en'),
  telegram.telegramCommandReply({}, '/sales 10/08/2026', Date.now(), 'km'),
])
check('in one language Latest receipts is short enough for all five',
  salesEn.split('\n').includes('=====Latest receipts=====') && salesKm.split('\n').includes('=====វិក្កយបត្រចុងក្រោយ====='), `${salesEn}\n${salesKm}`)

// ---- the `+ N more` continuation, in all three languages --------------------
//
// Sep 23 2026. This line is composed INSIDE salesReport, which builds its own
// message text and never goes through localizeTelegramLine -- so it localized
// the noun by hand and left the English word "more" standing in a Khmer-only
// shop's message: `+ 2 more មុខទំនិញ`. Both it and the alert builders' own
// continuation now come from one function, telegramLang's moreItems().
const overflow = (mode) => telegram.telegramCommandReply({}, '/sales 11/08/2026', Date.now(), mode)
const [overflowBoth, overflowEn, overflowKm] = await Promise.all([overflow('both'), overflow('en'), overflow('km')])
const continuationOf = (text) => text.split('\n').find((line) => line.trim().startsWith('+ '))
check(`the receipt lists 4 of its 6 items and closes with a continuation (${continuationOf(overflowBoth)})`,
  overflowBoth.split('\n').filter((line) => /^ {3}\d+\. /.test(line)).length === 4
  && continuationOf(overflowBoth) === '   + 2 more item(s)/មុខទំនិញបន្ថែម', overflowBoth)
check('an English-only shop gets no Khmer on it',
  continuationOf(overflowEn) === '   + 2 more item(s)', overflowEn)
check('and a Khmer-only shop gets no English word "more" on it',
  continuationOf(overflowKm) === '   + 2 មុខទំនិញបន្ថែម' && !/more/.test(continuationOf(overflowKm)), overflowKm)
// THE SALE ALERT takes the same wording through localizeTelegramLine, with
// the row bullet its message shape gives every row. One phrase, two prefixes.
check('the sale alert\'s continuation is the same phrase, bulleted',
  lang.localizeTelegramLine('+ 2 more item(s)') === `${lang.ROW_BULLET}+ 2 more item(s)${SEP}មុខទំនិញបន្ថែម`,
  lang.localizeTelegramLine('+ 2 more item(s)'))
check('and salesReport does not localize the noun by hand any more',
  /moreItems\(saleItems\.length - 4\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8'))
  && !/more \$\{localizeTelegramValue/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')))

// ---- /fees: the same `=====` headers and `·` rows (Sep 23 2026) -------------
// Two expenses on 12/08/2026, a day of their own, so no figure asserted for
// any other day moves. /fees was the one sectioned reply no test rendered.
const insFee = db.prepare('INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date) VALUES (?,?,?,?,?,?)')
insFee.run(1, 'Rent', 'August', 120, 0, '2026-08-12')
insFee.run(2, 'Transport', null, 0, 20000, '2026-08-12')
const feesMsg = await telegram.telegramCommandReply({}, '/fees 12/08/2026')
check('/fees is its title, two `=====` sections and one `·` row per expense, newest first',
  JSON.stringify(feesMsg.split('\n')) === JSON.stringify([
    '💸 Expenses/ចំណាយ: 12/08/2026',
    '=====Expenses/ចំណាយ=====',
    '· Total/សរុប: $120.00 · 20,000៛',
    '=====Each expense/ចំណាយនីមួយៗ=====',
    '· Transport: 20,000៛',
    '· Rent (August): $120.00',
  ]), feesMsg)
const feesKm = await telegram.telegramCommandReply({}, '/fees 12/08/2026', Date.now(), 'km')
check('and a Khmer-only shop gets the same six lines under Khmer headers',
  feesKm.split('\n').length === 6
  && feesKm.split('\n').filter(isSection).join(' | ') === '=====ចំណាយ===== | =====ចំណាយនីមួយៗ=====', feesKm)

// ---- /stock and /inventory: titled sections, over a REAL LIMIT (Sep 22 2026) ---
// The Sep 21 2026 sectioned-layout redesign converted five replies and left
// these two as a single un-sectioned block; this closes that gap. Run against
// the real SQLite engine above (not a regex stub), so the query's
// `LIMIT 12` and `is_active = 1` are the ones actually executing.
const stockMsg = await telegram.telegramCommandReply({}, '/stock')
const inventoryMsg = await telegram.telegramCommandReply({}, '/inventory')

// The product list is `·` rows since Sep 23 2026, like every row in a section.
check('the LIMIT 12 the query has always carried still caps the product list (14 qualifying rows, 12 shown)',
  stockMsg.split('\n').filter((line) => /^· (?:OUT|LOW)\//.test(line)).length === 12
  && /^· Products\/[^\n]*: 12$/m.test(stockMsg), stockMsg)
check('is_active = 0 still excludes a product from /stock entirely', !stockMsg.includes('Inactive item'))
check('a product above both thresholds is not listed', !stockMsg.includes('Healthy item'))
check('/inventory counts only the active catalogue (14 qualifying + 1 healthy = 15), never the inactive row',
  /Active products\/[^\n]*: 15$/m.test(inventoryMsg) && /Units on hand\/[^\n]*: 124$/m.test(inventoryMsg)
  && /Low stock\/[^\n]*: 8$/m.test(inventoryMsg) && /Out of stock\/[^\n]*: 6$/m.test(inventoryMsg))

// The section shape itself (Sep 23 2026): a title line, then
// `=====<title>=====` headers -- no drawn rule, no number and no `•` row
// anywhere -- each followed by a `·` row, never left bare.
for (const [name, msg, sectionKeys] of [['/stock', stockMsg, ['stock']], ['/inventory', inventoryMsg, ['products', 'stock']]]) {
  const rows = msg.split('\n')
  check(`${name} opens with its title, not a section`, !isSection(rows[0]) && !/^\d+\.\s/.test(rows[0]))
  check(`${name}: no drawn rule, no numbered header and no \`•\` row`,
    !rows.includes(lang.RULE) && !rows.some((row) => /^\d+\.\s/.test(row)) && !msg.includes('•'), msg)
  rows.forEach((row, index) => {
    if (isSection(row)) check(`${name}: the header at line ${index} is followed by a \`·\` row, never left bare`, (rows[index + 1] || '').startsWith(lang.ROW_BULLET))
  })
  // Strict-after loop (scripts/test-shift-report-pure.cjs's ORDER pattern):
  // each section header must be found AFTER the previous one, not merely
  // present anywhere in the message.
  let cursor = -1
  sectionKeys.forEach((key, position) => {
    const at = rows.findIndex((row, index) => index > cursor && row === headerOf(key))
    check(`${name}: section "${key}" appears in order at position ${position + 1}`, at > cursor)
    cursor = at
  })
  // POSITIVE CONTROL: swapping the FIRST header with the LAST one (a swap
  // that only makes sense when there are two or more sections) must make the
  // same strict-after loop reject the text -- proving the check discriminates
  // order, not just membership.
  if (sectionKeys.length > 1) {
    const first = headerOf(sectionKeys[0])
    const last = headerOf(sectionKeys[sectionKeys.length - 1])
    const brokenRows = rows.map((row) => (row === first ? last : row === last ? first : row))
    let brokenCursor = -1
    let rejected = false
    for (const key of sectionKeys) {
      const at = brokenRows.findIndex((row, index) => index > brokenCursor && row === headerOf(key))
      if (!(at > brokenCursor)) { rejected = true; break }
      brokenCursor = at
    }
    check(`${name}: POSITIVE CONTROL -- swapping the section headers makes the order check fail`, rejected)
  }
}

// All three language modes, over the SAME real query path -- the figures
// (12, 15, 124, 8, 6) must not move between them.
const stockEn = await telegram.telegramCommandReply({}, '/stock', Date.now(), 'en')
const stockKm = await telegram.telegramCommandReply({}, '/stock', Date.now(), 'km')
const inventoryEn = await telegram.telegramCommandReply({}, '/inventory', Date.now(), 'en')
const inventoryKm = await telegram.telegramCommandReply({}, '/inventory', Date.now(), 'km')
check("'/stock' en mode keeps the figures and drops the Khmer", !khmerText(stockEn) && /Products: 12$/m.test(stockEn))
check("'/stock' km mode keeps the figures and drops the English section header letters",
  khmerText(stockKm) && stockKm.includes(': 12') && stockKm.split('\n').includes('=====ស្តុក=====')
  && !stockKm.split('\n').filter(isSection).some((row) => /[A-Za-z]/.test(row)), stockKm)
check("'/inventory' en mode keeps every figure (15, 124, 8, 6)",
  !khmerText(inventoryEn) && ['15', '124', '8', '6'].every((n) => inventoryEn.includes(n)))
check("'/inventory' km mode keeps every figure too", ['15', '124', '8', '6'].every((n) => inventoryKm.includes(n)))
check('all three /inventory renderings carry the same number of sections',
  [inventoryMsg, inventoryEn, inventoryKm].every((text) => text.split('\n').filter(isSection).length === 2))

// RETIRED: the "bare divider" shape (a RULE with nothing but a header after
// it) cannot come back: no RULE is drawn in either reply at all (checked
// above). These pin the two sentences an earlier redesign (Sep 7 2026)
// already retired from this pair of replies, so a later change cannot bring
// them back.
for (const [name, msg] of [['/stock', stockMsg], ['/inventory', inventoryMsg]]) {
  check(`${name}: the retired pointer sentence stays out`, !msg.includes('▸'))
  check(`${name}: the retired combined health line stays out`, !/Low stock:.*Out of stock:/.test(msg))
}
console.log('PASS /stock and /inventory: `=====` sections, a real LIMIT 12, strict order with a positive control, all three language modes')

// ---- a quiet day still prints every section ---------------------------------
//
// Owner's rule for these reports: an empty section shows N/A, it is never
// omitted. formatDaySummary used to `return` when a section had no rows, so a
// day with no expenses, no stock movement and no cashier activity produced a
// /report that stopped after its second section -- indistinguishable, on a
// phone, from a message that had been truncated.
const quiet = telegram.formatDaySummary(
  { date: '2026-09-23', sales: { count: 0, cancelled: 0, usd: 0, profitUsd: 0, creditUsd: 0 }, fees: { usd: 0, khr: 0 }, stockIn: { count: 0, quantity: 0 } },
  [],
)
const quietLines = quiet.split('\n')
const quietTitles = quietLines.filter(isSection)
check(`a quiet day prints all five sections, not the two it used to (${quietTitles.length})`,
  quietTitles.length === 5)
check('in the report\'s own order, with no gap',
  quietTitles.join(' | ') === DAY_SECTIONS.map(headerOf).join(' | '), quiet)
check('every section with nothing in it says N/A',
  quietLines.filter((line) => line === `${lang.ROW_BULLET}N/A`).length === 3)
check('and none of them is left as the retired bare em dash',
  !quietLines.includes('—'))
// POSITIVE CONTROL: a section that HAS rows must not be given an N/A as well.
// It runs from its header to the next one: nothing is drawn between them.
const salesBlock = quietLines.slice(quietLines.indexOf(quietTitles[0]) + 1, quietLines.indexOf(quietTitles[1]))
check(`POSITIVE CONTROL: the Sales section still prints its own two rows (${salesBlock.length})`,
  salesBlock.length === 2 && salesBlock.every((line) => line.startsWith(lang.ROW_BULLET) && !line.endsWith('N/A')))

// ---- every section title keeps to one row (Sep 23 2026) ----------------------
// Owner: "for the header marks, make sure the line stays in one line/row.
// this means you can use less header marks if it pushes to next row for the
// telegram message." A title takes the most marks, up to five, that keep it
// within one phone row -- 36, counted with `.length`, the width
// telegramRowLines breaks a list row at -- and never fewer than one: a name
// that fills the row on its own keeps one a side, because the marks are what
// make it a title. Judged over every reply this file renders, in every mode.
const ROW_WIDTH = 36
/** Why `title` breaks that rule, or '' when it keeps it. */
const titleFault = (title) => {
  const parts = sectionParts(title)
  if (!parts) return 'not a run of one to five `=`, the name, and the same run again'
  const [marks, name] = parts
  if (title.length > ROW_WIDTH && marks > 1) return `${title.length} characters with ${marks} marks a side: it wraps, and fewer marks would not`
  if (marks < 5 && name.length + 2 * (marks + 1) <= ROW_WIDTH) return `${marks} marks a side where ${marks + 1} still fit one row`
  return ''
}
check('POSITIVE CONTROL: the title judge rejects the fixed five that wraps, a needless cut and uneven sides',
  titleFault('=====Latest receipts/វិក្កយបត្រចុងក្រោយ=====') !== ''
  && titleFault('====Sales/ការលក់====') !== ''
  && titleFault('====Sales/ការលក់=====') !== ''
  && titleFault('=Latest receipts/វិក្កយបត្រចុងក្រោយ=') === ''
  && titleFault('=====Sales/ការលក់=====') === '')
const feesEn = await telegram.telegramCommandReply({}, '/fees 12/08/2026', Date.now(), 'en')
const composedTitleFaults = []
let composedTitles = 0
for (const [what, text] of [
  ['/report, both', report], ['/report, en', reportEn], ['/report, km', reportKm], ['quiet day', quiet],
  ['/sales, both', salesMsg], ['/sales, en', salesEn], ['/sales, km', salesKm],
  ['/sales overflow, both', overflowBoth], ['/sales overflow, en', overflowEn], ['/sales overflow, km', overflowKm],
  ['/fees, both', feesMsg], ['/fees, en', feesEn], ['/fees, km', feesKm],
  ['/stock, both', stockMsg], ['/stock, en', stockEn], ['/stock, km', stockKm],
  ['/inventory, both', inventoryMsg], ['/inventory, en', inventoryEn], ['/inventory, km', inventoryKm],
]) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('=')) continue
    composedTitles += 1
    const fault = titleFault(line)
    if (fault) composedTitleFaults.push(`${what}: ${line} -- ${fault}`)
  }
}
check(`every section title the report commands print keeps to one row with the most marks that fit (${composedTitles} titles)`,
  composedTitles === 53 && composedTitleFaults.length === 0, composedTitleFaults.join('\n'))
// ---- one implementation, not a lookalike ------------------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
check('telegram.ts no longer sums sale totals for the day or cashier reports at all',
  !/SUM\(total_usd\), 0\) AS usd/.test(src))
check('the day and cashier figures come from the kernel entry points',
  /getSalesTotals\(env, dayFilters\(date\)\)/.test(src)
  && /getSalesGroupedTotals\(env, dayFilters\(date\), 'cashier'/.test(src))
check('the shift report, which already read the kernel, is untouched by this change',
  /getSalesTotals\(env, filters\)/.test(src) && /shiftInvoiceCounts\(env, shift, nowMs\)/.test(src))

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })
