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
// etc..."). A title line, then numbered titled sections, in the same
// vocabulary the shift report uses.
const sectionTitles = report.split('\n').filter((line) => /^\d\. /.test(line))
check(`the day summary is a title line and ${sectionTitles.length} numbered sections`,
  /^📊 Business summary \/ [^\n]+ — 10\/08\/2026$/.test(report.split('\n')[0])
  && sectionTitles.every((line) => line.includes(SEP)), report)
// REDESIGNED Sep 6 2026: one figure per line. The counts of the SAME thing
// share one compact row (Sep 21 2026), under the Invoices section.
check('and the kernel receipt count, not the count that included the void',
  /^· Total \/ [^\n]*: 2 · /m.test(report) && !/: 3 · /m.test(report) && !/: 3$/m.test(report))
check('the refund that produced the difference is printed, so the number explains itself',
  /^· Refunds \/ [^\n]*: \$15\.00$/m.test(report))
check('the voided receipt is REPORTED as voided rather than silently counted or silently dropped',
  /Cancelled \/ [^\n]*: 1/.test(report))
// The whole point of the redesign, stated as a measurement rather than a
// claim: the pre-redesign message spread the same day over prose-tagged
// lines. This one is sections of figures, each under its own title.
check(`the day summary fits one phone screen (${report.split('\n').length} lines)`,
  report.split('\n').length <= 26)
check('and its Sales section leads with revenue and profit, the two that always print',
  /^· Revenue \/ [^\n]*: \$115\.00$/m.test(report) && /^· Profit \/ /m.test(report))
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
  && reportEn.split('\n').filter((line) => /^\d\. /.test(line)).join(' | ') === sectionTitles.map((line) => line.split(SEP)[0]).join(' | '))
check("'km' drops the English half and still carries the same figures",
  reportKm.includes('$115.00') && reportKm.startsWith('📊 ')
  && reportKm.split('\n').every((line) => {
    const split = line.indexOf(': ')
    return line.startsWith('•') || split <= 0 || !/[A-Za-z]/.test(line.slice(0, split))
  }))
check('all three renderings have the same number of lines -- one report, three languages',
  report.split('\n').length === reportEn.split('\n').length
  && report.split('\n').length === reportKm.split('\n').length)
// A cashier NAME is data: it is not a label and is never translated.
check('cashier names survive every mode untouched',
  reportEn.includes('aza') && reportKm.includes('aza'))

// ---- /sales ------------------------------------------------------------------
const salesMsg = await telegram.telegramCommandReply({}, '/sales 10/08/2026')
check('the /sales total is the kernel total too', salesMsg.includes('$115.00') && !salesMsg.includes('$643.00'))
check('the receipt LIST does not show the voided receipt under a total it is not part of',
  salesMsg.includes('20260810-090000') && salesMsg.includes('20260810-110000') && !salesMsg.includes('20260810-100000'))

// ---- /stock and /inventory: numbered sections, over a REAL LIMIT (Sep 22 2026) ---
// The Sep 21 2026 sectioned-layout redesign converted five replies and left
// these two as a single un-numbered block; this closes that gap. Run against
// the real SQLite engine above (not a regex stub), so the query's
// `LIMIT 12` and `is_active = 1` are the ones actually executing.
const stockMsg = await telegram.telegramCommandReply({}, '/stock')
const inventoryMsg = await telegram.telegramCommandReply({}, '/inventory')

check('the LIMIT 12 the query has always carried still caps the bullet list (14 qualifying rows, 12 shown)',
  stockMsg.split('\n').filter((line) => line.startsWith('•')).length === 12
  && /^· Products \/ [^\n]*: 12$/m.test(stockMsg))
check('is_active = 0 still excludes a product from /stock entirely', !stockMsg.includes('Inactive item'))
check('a product above both thresholds is not listed', !stockMsg.includes('Healthy item'))
check('/inventory counts only the active catalogue (14 qualifying + 1 healthy = 15), never the inactive row',
  /Active products \/ [^\n]*: 15$/m.test(inventoryMsg) && /Units on hand \/ [^\n]*: 124$/m.test(inventoryMsg)
  && /Low stock \/ [^\n]*: 8$/m.test(inventoryMsg) && /Out of stock \/ [^\n]*: 6$/m.test(inventoryMsg))

// The numbered-section shape itself: a title line, then "N. <title>" headers,
// each immediately preceded by the shared RULE and never left bare.
for (const [name, msg, sectionKeys] of [['/stock', stockMsg, ['stock']], ['/inventory', inventoryMsg, ['products', 'stock']]]) {
  const rows = msg.split('\n')
  check(`${name} opens with its title, not a section`, !/^\d+\.\s/.test(rows[0]))
  rows.forEach((row, index) => {
    if (row === lang.RULE) check(`${name}: the divider at line ${index} is followed by a numbered header, never left bare`, /^\d+\.\s/.test(rows[index + 1] || ''))
  })
  // Strict-after loop (scripts/test-shift-report-pure.cjs's ORDER pattern):
  // each section header must be found AFTER the previous one, not merely
  // present anywhere in the message.
  let cursor = -1
  sectionKeys.forEach((key, position) => {
    const expected = `${position + 1}. ${lang.label(key)}`
    const at = rows.findIndex((row, index) => index > cursor && row === expected)
    check(`${name}: section "${key}" appears in order at position ${position + 1}`, at > cursor)
    cursor = at
  })
  // POSITIVE CONTROL: renumbering the FIRST header to look like the LAST
  // one (a swap that only makes sense when there are two or more sections)
  // must make the same strict-after loop reject the text -- proving the
  // check discriminates order, not just membership. With one section this
  // duplicates the header outright, which the loop must also reject: two
  // "1. <title>" rows can never satisfy "found strictly after the previous
  // hit" for a second, distinct key.
  if (sectionKeys.length > 1) {
    const first = `1. ${lang.label(sectionKeys[0])}`
    const last = `${sectionKeys.length}. ${lang.label(sectionKeys[sectionKeys.length - 1])}`
    const brokenRows = rows.map((row) => (row === first ? last : row === last ? first : row))
    let brokenCursor = -1
    let rejected = false
    for (const [position, key] of sectionKeys.entries()) {
      const expected = `${position + 1}. ${lang.label(key)}`
      const at = brokenRows.findIndex((row, index) => index > brokenCursor && row === expected)
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
  khmerText(stockKm) && stockKm.includes(': 12') && !/^\d+\.\s[A-Za-z]/m.test(stockKm))
check("'/inventory' en mode keeps every figure (15, 124, 8, 6)",
  !khmerText(inventoryEn) && ['15', '124', '8', '6'].every((n) => inventoryEn.includes(n)))
check("'/inventory' km mode keeps every figure too", ['15', '124', '8', '6'].every((n) => inventoryKm.includes(n)))
check('all three /inventory renderings carry the same number of sections',
  [inventoryMsg, inventoryEn, inventoryKm].every((text) => text.split('\n').filter((row) => /^\d+\.\s/.test(row)).length === 2))

// RETIRED: the "bare divider" shape (a RULE with no numbered header right
// after it) is already disproven by the divider loop above for every RULE in
// both replies; these pin the two sentences an earlier redesign (Sep 7 2026)
// already retired from this pair of replies, so a later change cannot bring
// them back.
for (const [name, msg] of [['/stock', stockMsg], ['/inventory', inventoryMsg]]) {
  check(`${name}: the retired pointer sentence stays out`, !msg.includes('▸'))
  check(`${name}: the retired combined health line stays out`, !/Low stock:.*Out of stock:/.test(msg))
}
console.log('PASS /stock and /inventory: numbered sections, a real LIMIT 12, strict order with a positive control, all three language modes')

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
