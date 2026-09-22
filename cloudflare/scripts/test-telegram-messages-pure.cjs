// Pins the Telegram alert shapes the user specified (Part 581):
//   sale  -> a receipt summary: Status / Date / INV / Cashier / Customer /
//            Tel / "name qty × price (−discount) = total" per item /
//            Delivery service / Total / Discount / Net Total / Paid /
//            Delivery driver
//   stock -> the change PLUS the resulting on-hand (branch · all branches)
//   transfer -> From / To / one line per product with the resulting on-hand at
//            both branches / Total moved (Part 582)
//   return -> RET|SRET / INV / Customer|Supplier / lines with refund, stock
//            action, lot and resulting on-hand / Refund or Supplier pays / Loss
// Loads the REAL lib/telegram.ts (transpiled) with only the D1 handle stubbed;
// the date helper is the real businessDateWindow so the UTC+7 rule is the
// same one every report uses.
//
// Run (from cloudflare/): node scripts/test-telegram-messages-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

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
// lib/telegram.ts reads the sales kernel for the shift report (S4-7).
// The delivery-payer rule the sale summary uses comes from the module that
// WROTE total_usd, so the alert cannot foot differently from the stored row.
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': { getDb: () => { throw new Error('no DB in this test') } }, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
// Sep 6 2026: the owner's low-stock alert setting reaches this module through
// lib/lowStockSettings.ts. The SQL builder is the REAL one -- the clauses
// asserted below are the ones it composes -- while the settings READ answers
// the shipped default, there being no settings row in this harness. The rule
// itself is proven in scripts/test-low-stock-settings-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

// The shift drawer arithmetic is shared with the close routes and the app.
const shiftReconciliation = loadReal('lib/shiftReconciliation.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') })
const telegram = loadReal('lib/telegram.ts', { './lowStockSettings': lowStockStub, './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang, './salesAnalytics': salesAnalytics, './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './shiftReconciliation': shiftReconciliation })

// --- date: UTC -> business zone, dd/mm/yyyy HH:mm, both timestamp shapes ---
assert.equal(telegram.formatBusinessDateTime('2026-09-02T17:30:00.000Z'), '03/09/2026 00:30', 'ISO with Z shifts +7h across midnight')
assert.equal(telegram.formatBusinessDateTime('2026-09-02 08:05:09'), '02/09/2026 15:05', 'D1 CURRENT_TIMESTAMP (no zone) is UTC')
assert.equal(telegram.formatBusinessDateTime(null, Date.UTC(2026, 0, 1, 0, 0)), '01/01/2026 07:00', 'missing timestamp falls back to now')
assert.equal(telegram.formatBusinessDateTime('garbage', Date.UTC(2026, 0, 1, 0, 0)), '01/01/2026 07:00', 'unparseable timestamp falls back to now')
// 01/01 reads the same in either order; this one cannot:
assert.equal(telegram.formatBusinessDateTime('2026-12-25T03:00:00.000Z'), '25/12/2026 10:00', 'day first -- 25 December, not month 25')

// --- sale receipt summary ---
// `status` is a LIVE value from lib/salesStatus.ts (this fixture said 'paid',
// which the database has never stored), because the money line at the foot of
// the message is now labelled with it.
const lines = telegram.formatSaleTelegramLines({
  status: 'completed', createdAt: '2026-09-03T03:04:05.000Z', receiptNumber: '20260903-100405', cashier: 'Za',
  customer: 'Sok Dara', phone: '012 345 678', branch: 'Shop',
  items: [
    { name: 'Coca Cola 330ml', quantity: 2, unitPriceUsd: 0.5, basePriceUsd: 0.6, lineTotalUsd: 1, promotionLabel: 'Summer sale' },
    { name: 'Rice 5kg', quantity: 1, unitPriceUsd: 7.25, basePriceUsd: 7.25, lineTotalUsd: 7.25, promotionLabel: 'Ignored: no cut on this line' },
  ],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 1.5, deliveryPaidBy: 'customer',
  driver: { name: 'Tuk Tuk Dara', phone: '099 111 222' },
  subtotalUsd: 8.25, discountUsd: 0.25, taxUsd: 0, totalUsd: 9.5, totalKhr: 38950,
  paidUsd: 10, paidKhr: 0, changeUsd: 0.5, changeKhr: 0, paymentMethod: 'Cash',
}).filter(Boolean)
// GROUPED Sep 22 2026 to the owner's own reference layout ("for sales we can
// do like this. so it is easier to read"): five blocks -- what happened, who
// rang it up, who it was for (the driver moved up here, beside the customer
// and their phone), what was bought, what it came to -- separated by the one
// event divider. Status now prints on EVERY sale, including a completed one.
const GROUP = telegramLang.GROUP_RULE
assert.deepEqual(lines, [
  'Status: completed',
  'Date: 03/09/2026 10:04',
  'INV: 20260903-100405',
  GROUP,
  'Cashier: Za',
  'Branch: Shop',
  GROUP,
  'Customer: Sok Dara',
  'Tel: 012 345 678',
  'Delivery driver: Tuk Tuk Dara · 099 111 222',
  GROUP,
  // P3-L3: the promotion is named inside the cut's parentheses; a label on
  // a line with no cut prints nothing (the offer did not apply).
  // P10: numbered like the printed receipt, "1. name ...", not a bare bullet.
  '1. Coca Cola 330ml 2 × $0.60 (−$0.20 Summer sale) = $1.00',
  '2. Rice 5kg 1 × $7.25 = $7.25',
  GROUP,
  'Delivery service: $1.50',
  'Total: $9.75',
  'Discount: −$0.25',
  // THE MONEY LINE IS THE SALE'S STATUS (owner, Sep 23 2026: "a paid sale
  // would usually already use a completed status"). It read `Net Total`, a
  // label naming no fact the reader did not already have: the figure is what
  // the customer owes or paid, and what the shop wants beside it is whether
  // it HAS been paid. The words come from telegramLang's status table, so
  // this line and the `Status:` row at the top of the message cannot drift.
  'Completed: $9.50 / 38,950៛',
  'Paid: $10.00 (Cash)',
  'Change: $0.50',
])
// ONE divider constant, never a hand-typed rule: two literals drift by a
// glyph or a length and the feed starts looking accidental.
assert.equal(GROUP, '─'.repeat(18))
assert.equal(lines.filter((line) => line === GROUP).length, 4, 'four groups follow the first, so four dividers')
// A walk-in with no customer, no phone and no driver drops the WHOLE group,
// divider included -- never a rule with nothing under it, never two in a row.
const walkIn = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'WALK-IN', cashier: 'Za', exchangeRate: 4100,
  items: [{ name: 'A', quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 }],
  subtotalUsd: 1, discountUsd: 0, totalUsd: 1, paidUsd: 1,
})
assert.ok(!walkIn.some((line, index) => line === GROUP && walkIn[index + 1] === GROUP), walkIn.join('\n'))
assert.notEqual(walkIn[walkIn.length - 1], GROUP, 'no trailing divider')
assert.notEqual(walkIn[0], GROUP, 'no leading divider')
assert.equal(walkIn.filter((line) => line === GROUP).length, 3, 'the customer group is gone with its divider')
assert.ok(walkIn.includes('Status: completed'), 'the status row prints on an ordinary sale too')

// The row is unconditional now, so a caller that supplies no status at all must
// not produce `Status:` with an empty value -- the reader would see a field
// that failed to render. It reads the same way the app's own normalizer reads a
// missing sale_status.
const noStatus = telegram.formatSaleTelegramLines({
  receiptNumber: 'NO-STATUS', cashier: 'Za', exchangeRate: 4100,
  items: [{ name: 'A', quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 }],
  subtotalUsd: 1, discountUsd: 0, totalUsd: 1, paidUsd: 1,
})
assert.equal(noStatus[0], 'Status: completed', `a missing status still names one: ${noStatus[0]}`)
assert.ok(!noStatus.some((line) => /^[A-Za-z ]+:\s*$/.test(line)), `no row may ship an empty value:\n${noStatus.join('\n')}`)

// A discounted item line is a real equation: gross unit price × quantity,
// minus the line discount, equals the authoritative net line total. The
// applied unit price is already net, so printing it before the discount would
// visually subtract the same discount twice.
const equationLines = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'EQUATIONS', exchangeRate: 4100,
  items: [
    { name: 'Gross 69', quantity: 1, basePriceUsd: 69, unitPriceUsd: 65, lineTotalUsd: 65 },
    { name: 'Quantity three', quantity: 3, basePriceUsd: 25, unitPriceUsd: 21, lineTotalUsd: 63 },
    { name: 'No discount', quantity: 1, basePriceUsd: 12, unitPriceUsd: 12, lineTotalUsd: 12 },
    { name: 'Absent base', quantity: 2, unitPriceUsd: 5, lineTotalUsd: 10 },
    { name: 'Null base', quantity: 1, basePriceUsd: null, unitPriceUsd: 7, lineTotalUsd: 7 },
  ],
  subtotalUsd: 157, discountUsd: 0, totalUsd: 157,
}).filter(Boolean)
assert.ok(equationLines.includes('1. Gross 69 1 × $69.00 (−$4.00) = $65.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('2. Quantity three 3 × $25.00 (−$12.00) = $63.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('3. No discount 1 × $12.00 = $12.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('4. Absent base 2 × $5.00 = $10.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('5. Null base 1 × $7.00 = $7.00'), equationLines.join('\n'))

// The sale subtotal is already the sum of net item totals. An order-level
// discount remains separate and must be subtracted exactly once below Total.
const orderDiscount = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'ORDER-DISCOUNT', exchangeRate: 4100,
  items: [{ name: 'Gross 69', quantity: 1, basePriceUsd: 69, unitPriceUsd: 65, lineTotalUsd: 65 }],
  subtotalUsd: 65, discountUsd: 4, totalUsd: 61,
}).filter(Boolean)
assert.ok(orderDiscount.includes('1. Gross 69 1 × $69.00 (−$4.00) = $65.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Total: $65.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Discount: −$4.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Completed: $61.00'), orderDiscount.join('\n'))

// Equivalent currencies use /; actual tender currencies use +. Change values
// from saleTotals are equivalents unless the caller explicitly knows both
// currencies were physically returned.
const changeLines = (changeUsd, changeKhr) => telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'CHANGE', exchangeRate: 4000,
  items: [{ name: 'A', quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 }],
  subtotalUsd: 1, discountUsd: 0, totalUsd: 1, totalKhr: 4000,
  paidUsd: 1, paidKhr: 4000, changeUsd, changeKhr,
}).filter(Boolean)
assert.ok(changeLines(1, 0).includes('Change: $1.00'))
assert.ok(changeLines(0, 4000).includes('Change: 4,000៛'))
const dualChange = changeLines(1, 4000)
assert.ok(dualChange.includes('Change: $1.00 / 4,000៛'), dualChange.join('\n'))
assert.ok(dualChange.includes('Completed: $1.00 / 4,000៛'), dualChange.join('\n'))
assert.ok(dualChange.includes('Paid: $1.00 + 4,000៛'), dualChange.join('\n'))
const actualDualChange = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'ACTUAL-CHANGE', exchangeRate: 4000,
  items: [{ name: 'A', quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 }],
  subtotalUsd: 1, discountUsd: 0, totalUsd: 1, totalKhr: 4000,
  paidUsd: 2, paidKhr: 4000, changeUsd: 1, changeKhr: 4000,
  changeIsActualDual: true,
}).filter(Boolean)
assert.ok(actualDualChange.includes('Change: $1.00 + 4,000៛'), actualDualChange.join('\n'))

// A cancelled shift is terminal at cancelled_at, not open and not falsely
// closed. Preserve its native report figures and cancellation provenance.
const cancelledShift = {
  shift_code: 'S-CANCELLED', scope_mode: 'per_account', user_id: 7, user_name: 'Za',
  branch_id: 2, branch_name: 'Shop', business_date: '2026-09-04',
  opened_at: '2026-09-04T01:15:00.000Z', opening_float_usd: 50, opening_float_khr: 100000,
  closed_at: null, closing_counted_usd: null, closing_counted_khr: null,
  cancelled_at: '2026-09-04T02:30:00.000Z', cancelled_by_user_name: 'Manager', cancel_reason: 'Duplicate opening',
}
// The figure set the redesigned report actually consumes (Sep 6 2026). The
// discount/tax/average/cost/margin fields and the payment-method and
// delivery-service breakdown arrays are gone from ShiftReportFigures, not
// merely unprinted -- shiftFigures no longer queries for them.
const cancelledFigures = {
  invoices: 3, cancelled: 1, edited: 0, revenueUsd: 25, profitUsd: 15,
  deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  refundUsd: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  cash: { usd: 25, khr: 0, needsReview: false },
}
const cancelledReport = telegram.formatShiftReport('Shop', cancelledShift, cancelledFigures, Date.parse('2026-09-04T12:00:00.000Z'))
// SECTIONED Sep 21 2026: the state moved from a tag on the To line into the
// report TITLE, the way the owner's reference layout states it.
assert.ok(cancelledReport.startsWith('🧑‍💼 Shift report / របាយការណ៍វេន — Cancelled / បានបោះបង់'), cancelledReport)
// BULLETED Sep 22 2026 ("we can do bullet points"): every LABEL row opens
// with `· `, including the two ad-hoc cancellation rows, which are composed
// from bi() rather than the label table and so are exactly the rows a
// bullet rule can miss.
assert.ok(cancelledReport.includes('· Cancelled by / បោះបង់ដោយ: Manager'), cancelledReport)
assert.ok(cancelledReport.includes('· Reason / មូលហេតុ: Duplicate opening'), cancelledReport)
assert.ok(cancelledReport.includes('1. Invoices / វិក្កយបត្រ\n· Total / សរុប: 3'), cancelledReport)
for (const line of cancelledReport.split('\n')) {
  if (!/: /.test(line) || line.startsWith('•') || /^\d+\. /.test(line)) continue
  assert.ok(line.startsWith('· '), `every label row carries the bullet; this one does not: ${line}`)
}
assert.ok(cancelledReport.includes('04/09/2026 09:30'), cancelledReport)
assert.ok(!cancelledReport.includes('still open'), cancelledReport)
assert.ok(!cancelledReport.includes('Counted /'), cancelledReport)
assert.equal(telegram.shiftFilters(cancelledShift, Date.parse('2026-09-04T12:00:00.000Z')).createdTo, cancelledShift.cancelled_at)

// Soft-cancelling an already closed shift must not reopen or extend its money
// window. Keep the original close/counts and show later cancellation metadata
// separately.
const closedThenCancelled = {
  ...cancelledShift,
  closed_at: '2026-09-04T10:02:00.000Z',
  closing_counted_usd: 75,
  closing_counted_khr: 100000,
  cancelled_at: '2026-09-05T02:30:00.000Z',
}
const closedCancelledReport = telegram.formatShiftReport('Shop', closedThenCancelled, cancelledFigures, Date.parse('2026-09-05T12:00:00.000Z'))
assert.equal(telegram.shiftFilters(closedThenCancelled, Date.parse('2026-09-05T12:00:00.000Z')).createdTo, closedThenCancelled.closed_at)
assert.ok(closedCancelledReport.includes('To / ទៅ: 04/09/2026 17:02'), closedCancelledReport)
assert.ok(closedCancelledReport.includes('Cancelled at / បោះបង់នៅ: 05/09/2026 09:30'), closedCancelledReport)
assert.ok(closedCancelledReport.includes('Closing cash / សាច់ប្រាក់បិទវេន: $75.00 · 100,000៛'), closedCancelledReport)
assert.ok(!closedCancelledReport.includes('Counted cash / សាច់ប្រាក់បានរាប់:'), closedCancelledReport)
// ... beside the OPENING count, which is the half the owner said was missing.
assert.ok(closedCancelledReport.includes('Opening cash / សាច់ប្រាក់ដើមវេន: $50.00 · 100,000៛'), closedCancelledReport)
assert.ok(closedCancelledReport.includes('1. Invoices / វិក្កយបត្រ\n· Total / សរុប: 3'), closedCancelledReport)
const telegramSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')
assert.match(telegramSource, /WHERE business_date = @date\s+ORDER BY/, 'dated /shift history must retain cancelled shifts')

// unpaid credit sale, shop-paid delivery, no customer: optional lines drop out,
// the shop-paid fee is shown but NOT added to Total
const credit = telegram.formatSaleTelegramLines({
  status: 'awaiting_payment', receiptNumber: 'R1', items: [{ name: 'A', quantity: 1, unitPriceUsd: 2, lineTotalUsd: 2 }],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 1, deliveryPaidBy: 'shop', subtotalUsd: 2, discountUsd: 0, totalUsd: 2,
}).filter(Boolean)
assert.equal(credit[0], 'Status: awaiting payment')
assert.ok(credit.includes('Delivery service: $1.00 (shop paid)'))
// REDESIGNED Sep 6 2026. An unsettled sale states the amount ONCE, under the
// owner's word for it -- not as a Total, a Net Total and a "Paid: unpaid"
// spelling out the same $2.00 three times over.
assert.ok(credit.includes('Not Paid: $2.00'), credit.join('\n'))
assert.ok(!credit.some((line) => /^(Total|Net Total|Paid):/.test(line)), credit.join('\n'))
assert.ok(!credit.join('\n').includes('Credit'), 'the superseded Credit label is gone; the line says Not Paid')
assert.ok(!credit.some((line) => /^(Customer|Tel|Discount|Change|Delivery driver):/.test(line)))

// The payer as it is ACTUALLY stored. `delivery_fee_paid_by` defaults to
// 'customer' and POS.tsx's DELIVERY_FEE_PAYER writes 'customer' | 'store';
// nothing anywhere writes 'shop'. This builder used to compare against
// 'shop', so every shop-absorbed delivery was billed into Total while Net
// Total (total_usd) excluded it, and "(shop paid)" never printed on a real
// sale. The rule now comes from lib/saleTotals.ts, which is what wrote the
// stored total, so the two cannot disagree again.
const absorbed = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'R3', items: [{ name: 'A', quantity: 1, unitPriceUsd: 20, lineTotalUsd: 20 }],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 2, deliveryPaidBy: 'store',
  subtotalUsd: 20, discountUsd: 0, totalUsd: 20, totalKhr: 82000, paidUsd: 20,
}).filter(Boolean)
assert.ok(absorbed.includes('Delivery service: $2.00 (shop paid)'), absorbed.join('\n'))
assert.ok(absorbed.includes('Completed: $20.00 / 82,000៛'), absorbed.join('\n'))
// REDESIGNED Sep 6 2026: with no discount and no tax the pre-discount Total
// IS the Net Total, so it does not print. It printing here would mean either
// the repeated figure the owner asked us to drop or -- the older defect --
// the shop-absorbed $2.00 billed into it.
assert.ok(!absorbed.some((line) => line.startsWith('Total: ')), absorbed.join('\n'))

// The message FOOTS: Total - Discount + Tax must equal Net Total, which is
// the stored total_usd. A shop-absorbed fee added to Total would break this
// by exactly the fee -- which is the defect above, stated as arithmetic.
// Since Sep 6 2026 a Total equal to the Net Total is not printed at all, so
// an absent Total line MEANS "equal to Net Total" -- which is what the
// fallback below encodes. The check stays discriminating either way: bill the
// shop-absorbed fee into Total and the line reappears, two dollars too big.
const footing = (sale) => {
  const lines = telegram.formatSaleTelegramLines(sale).filter(Boolean)
  const money = (prefix) => { const hit = lines.find((l) => l.startsWith(prefix)); return hit ? Number(hit.replace(prefix, '').split(' ')[0].replace(/[$,\u00a0]/g, '').replace('\u2212', '-')) : 0 }
  // The net figure sits on the line labelled with the sale's STATUS now, so
  // the footing reads it through the same helper the builder labels it with
  // -- never a second copy of the word, which would keep passing while the
  // message itself said something else.
  const net = `${telegramLang.saleStatusMoneyLabel(sale.status)}: `
  const total = lines.some((l) => l.startsWith('Total: ')) ? money('Total: ') : money(net)
  return Math.round((total - money('Discount: \u2212') + money('Tax: ') - money(net)) * 100) / 100
}
assert.equal(footing({
  status: 'completed', receiptNumber: 'R4', items: [{ name: 'A', quantity: 2, unitPriceUsd: 21, basePriceUsd: 28, lineTotalUsd: 42 }, { name: 'B', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 }],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 1.5, deliveryPaidBy: 'customer',
  subtotalUsd: 52, discountUsd: 5, taxUsd: 1, totalUsd: 49.5, totalKhr: 202950, paidUsd: 50,
}), 0, 'customer-paid delivery: Total - Discount + Tax must equal Net Total')
assert.equal(footing({
  status: 'completed', receiptNumber: 'R5', items: [{ name: 'A', quantity: 1, unitPriceUsd: 20, lineTotalUsd: 20 }],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 2, deliveryPaidBy: 'store',
  subtotalUsd: 20, discountUsd: 0, totalUsd: 20, totalKhr: 82000, paidUsd: 20,
}), 0, 'shop-absorbed delivery must not be billed into Total')

// long receipts are capped, never truncated silently.
// `status: 'paid'` is kept here ON PURPOSE as the unknown-status control: it
// is not one of lib/salesStatus.ts's six, so the money line prints the status
// AS STORED and in lower case, which no label in the table can be mistaken
// for. Asserted below.
const many = telegram.formatSaleTelegramLines({
  status: 'paid', receiptNumber: 'R2', exchangeRate: 4100, subtotalUsd: 25, discountUsd: 0, totalUsd: 25,
  items: Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 })),
}).filter(Boolean)
const manyItemLines = many.filter((line) => /^\d+\. /.test(line))
assert.equal(manyItemLines.length, 20, many.join('\n'))
assert.equal(manyItemLines[0], '1. Item 1 1 × $1.00 = $1.00', many.join('\n'))
assert.equal(manyItemLines[19], '20. Item 20 1 × $1.00 = $1.00', many.join('\n'))
assert.ok(many.includes('+ 5 more item(s)'))
assert.ok(many.includes('paid: $25.00'), `a status the table has no words for prints AS STORED, never a neutral label:\n${many.join('\n')}`)
assert.ok(!many.some((line) => line.includes('Net Total')), 'the neutral label is retired entirely')
// ...and lower case is what keeps that safe: capitalised, `Paid:` is the
// TENDER line's label, and the money line would have been localized as one.
assert.equal(telegramLang.localizeTelegramLine('paid: $25.00'), 'paid: $25.00')
assert.equal(telegramLang.localizeTelegramLine('Paid: $25.00'), '· Paid / បានបង់: $25.00')

// ---- the money line, per status, in all three languages -------------------
//
// Owner, Sep 23 2026: "a paid sale would usually already use a completed
// status" -- so this line is labelled with the sale's own status instead of a
// neutral "Net Total", and the words come from the SAME table that renders
// `Status: Not Paid -> Completed`, so renaming a status renames this too.
const moneyLineFor = (status, mode) => {
  const built = telegram.formatSaleTelegramLines({
    status, receiptNumber: 'STATUS-LABEL', exchangeRate: 4100,
    items: [{ name: 'A', quantity: 1, unitPriceUsd: 8, lineTotalUsd: 8 }],
    subtotalUsd: 8, discountUsd: 0, totalUsd: 8, totalKhr: 32800,
  }).filter(Boolean)
  const previous = telegramLang.getTelegramLanguage()
  telegramLang.setTelegramLanguage(mode)
  // The money line is the one carrying the KHR equivalent: the item line
  // above it repeats the same dollars, so matching on "$8.00" alone would
  // assert against the wrong row.
  try { return built.map(telegramLang.localizeTelegramLine).find((line) => line.includes('32,800')) }
  finally { telegramLang.setTelegramLanguage(previous) }
}
for (const [status, both, en, km] of [
  ['completed', '· Completed / បានបញ្ចប់: $8.00 / 32,800៛', '· Completed: $8.00 / 32,800៛', '· បានបញ្ចប់: $8.00 / 32,800៛'],
  ['awaiting_payment', '· Not Paid / ប្រាក់ជំពាក់: $8.00 / 32,800៛', '· Not Paid: $8.00 / 32,800៛', '· ប្រាក់ជំពាក់: $8.00 / 32,800៛'],
  ['awaiting_delivery', '· Awaiting Delivery / រង់ចាំការដឹកជញ្ជូន: $8.00 / 32,800៛', '· Awaiting Delivery: $8.00 / 32,800៛', '· រង់ចាំការដឹកជញ្ជូន: $8.00 / 32,800៛'],
  ['partial_return', '· Partial Return / ប្រគល់ខ្លះ: $8.00 / 32,800៛', '· Partial Return: $8.00 / 32,800៛', '· ប្រគល់ខ្លះ: $8.00 / 32,800៛'],
  ['cancelled', '· Cancelled / បានបោះបង់: $8.00 / 32,800៛', '· Cancelled: $8.00 / 32,800៛', '· បានបោះបង់: $8.00 / 32,800៛'],
  ['returned', '· Returned / បានប្រគល់: $8.00 / 32,800៛', '· Returned: $8.00 / 32,800៛', '· បានប្រគល់: $8.00 / 32,800៛'],
]) {
  assert.equal(moneyLineFor(status, 'both'), both, `${status} money line (both)`)
  assert.equal(moneyLineFor(status, 'en'), en, `${status} money line (en)`)
  assert.equal(moneyLineFor(status, 'km'), km, `${status} money line (km)`)
}
// Every live status is covered: a seventh added to lib/salesStatus.ts with no
// words in the table would print its raw enum on that sale's alert.
const liveStatuses = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesStatus.ts'), 'utf8')
  .match(/export const VALID_SALE_STATUSES: string\[\] = \[([^\]]+)\]/)[1]
  .split(',').map((entry) => entry.trim().replace(/'/g, ''))
assert.equal(liveStatuses.length, 6, liveStatuses.join(' | '))
assert.deepEqual(
  liveStatuses.filter((status) => telegramLang.saleStatusMoneyLabel(status) === status.replace(/_/g, ' ')),
  [], 'every live sale status must have a money-line label of its own')
// And the retired neutral label is gone from a live sale's message.
assert.ok(!lines.some((line) => line.startsWith('Net Total: ')), lines.join('\n'))

// The money line's label is resolved against the STATUS table before the
// label table, so which one is consulted first cannot change what the line
// says. Two words live in both; this pins that they agree, which is what
// makes that precedence safe for every OTHER line in every message.
for (const [english, status] of Object.entries(telegramLang.TELEGRAM_VALUE_PHRASES)) {
  if (typeof status === 'string') continue
  const label = telegramLang.TELEGRAM_LABELS[Object.keys(telegramLang.TELEGRAM_LABELS).find((key) => telegramLang.TELEGRAM_LABELS[key].en === status.en)]
  if (!label) continue
  assert.equal(label.km, status.km, `"${status.en}" is spelled two ways: the label table says ${label.km}, the status table says ${status.km} (${english})`)
}
// POSITIVE CONTROL for the loop above: it must actually have compared
// something -- "Not Paid" (the credit label) and "Cancelled" are the two.
assert.deepEqual(
  Object.values(telegramLang.TELEGRAM_VALUE_PHRASES)
    .filter((phrase) => typeof phrase !== 'string')
    .map((phrase) => phrase.en)
    .filter((english) => Object.values(telegramLang.TELEGRAM_LABELS).some((label) => label.en === english))
    .sort(),
  ['Cancelled', 'Not Paid'])

// --- stock change with resulting on-hand ---
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'remove', quantity: -3, branch: 'Shop', reason: 'Damaged', branchOnHand: 12, totalOnHand: 40, by: 'Za',
}).filter(Boolean), ['Product: Rice 5kg', 'Stock change: −3', 'Branch: Shop', 'Reason: Damaged', 'On hand: Shop 12 · all branches 40', 'By: Za'])
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 5, branch: 'Warehouse', lot: '09032026', branchOnHand: 0, totalOnHand: null,
}).filter(Boolean), ['Product: Rice 5kg', 'Stock change: +5', 'Branch: Warehouse', 'Received date: 03/09/2026', 'On hand: Warehouse 0'])
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 5, branch: 'Warehouse', receivedDate: '2026-09-04', branchOnHand: 5, totalOnHand: 5,
}).filter(Boolean), ['Product: Rice 5kg', 'Stock change: +5', 'Branch: Warehouse', 'Received date: 04/09/2026', 'On hand: Warehouse 5 · all branches 5'])

// --- transfers: one builder for the single, bulk and inventory-page routes ---
assert.deepEqual(telegram.formatTransferTelegramLines({
  createdAt: '2026-09-03 03:04:05', fromBranch: 'Warehouse', toBranch: 'Shop', note: 'Restock front shelf', by: 'Za',
  items: [
    { product: 'Rice 5kg', quantity: 10, lot: '09032026', fromOnHand: 90, toOnHand: 25, totalOnHand: 115 },
    { product: 'Soap', quantity: 2, receivedDate: '2026-09-04', fromOnHand: 8, toOnHand: 2, totalOnHand: 10 },
    { product: 'Coca Cola 330ml', quantity: 24, mergedInto: 'Coca-Cola 330ml', fromOnHand: 0, toOnHand: 48, totalOnHand: null },
  ],
}).filter(Boolean), [
  'Date: 03/09/2026 10:04',
  'From: Warehouse',
  'To: Shop',
  '• Rice 5kg 10 (received date 03/09/2026) — Warehouse 90 · Shop 25 · all branches 115',
  '• Soap 2 (received date 04/09/2026) — Warehouse 8 · Shop 2 · all branches 10',
  '• Coca Cola 330ml 24 → Coca-Cola 330ml — Warehouse 0 · Shop 48',
  // ONE figure. The product count that used to ride on this line ("· 2
  // product(s)") counted the bullets directly above it -- the same repeated
  // figure the Sep 2026 redesign took out of the expense report, where the
  // records under the total ARE the count.
  'Total moved: 36 unit(s)',
  'Note: Restock front shelf',
  'By: Za',
])
// Every labelled line of an event message states exactly one figure, the rule
// the reports follow. (Bullets are a list, the Date is a timestamp, and a
// money pair like "$5.00 + 2,000៛" is one amount in the two currencies the
// drawer holds.)
for (const line of telegram.formatTransferTelegramLines({
  createdAt: '2026-09-03 03:04:05', fromBranch: 'Warehouse', toBranch: 'Shop',
  items: [{ product: 'Rice 5kg', quantity: 10 }],
}).filter(Boolean)) {
  if (line.startsWith('•') || line.startsWith('+') || !line.includes(': ') || line.startsWith('Date: ')) continue
  const figures = line.slice(line.indexOf(': ') + 2).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []
  assert.ok(figures.length <= 1, `the transfer message puts ${figures.length} figures on one line: "${line}"`)
}
// unknown on-hand (read-back failed) and missing branch names never produce a
// dangling "On hand:" fragment; the cap states the remainder.
// A transfer whose branches are unknown prints NO From/To line rather than the
// placeholder words "Source" and "Destination" -- the same zero-value rule
// that took "Branch: Unassigned" out of the stock-change message.
const bulk = telegram.formatTransferTelegramLines({
  items: Array.from({ length: 23 }, (_, i) => ({ product: `Item ${i + 1}`, quantity: 2 })),
}).filter(Boolean)
assert.ok(!bulk.some((line) => /^(From|To): /.test(line)), bulk.join('\n'))
assert.equal(bulk[1], '• Item 1 2')
assert.equal(bulk.filter((line) => line.startsWith('• ')).length, 20)
assert.ok(bulk.includes('+ 3 more item(s)'))
assert.ok(bulk.includes('Total moved: 46 unit(s)'))
assert.ok(!bulk.some((line) => line.includes('product(s)')), bulk.join('\n'))

// --- customer return: receipt-style, refund per line, resulting on-hand ---
assert.deepEqual(telegram.formatReturnTelegramLines({
  kind: 'customer', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'RET-20260903-100405', receiptNumber: '20260901-153000',
  party: 'Sok Dara', branch: 'Shop', reason: 'Wrong size', returnType: 'restock',
  items: [
    { product: 'Rice 5kg', quantity: 1, refundUsd: 7.25, stockAction: 'restock', lot: '09012026', branchOnHand: 13, totalOnHand: 41 },
    { product: 'Broken jar', quantity: 2, refundUsd: 3, stockAction: 'damaged', receivedDate: '2026-09-05', branchOnHand: 5, totalOnHand: 5 },
  ],
  refundUsd: 10.25, refundKhr: 0, replacements: [{ product: 'Rice 5kg', quantity: 1 }], by: 'Za',
}).filter(Boolean), [
  'Date: 03/09/2026 10:04',
  'RET: RET-20260903-100405',
  'INV: 20260901-153000',
  'Customer: Sok Dara',
  'Branch: Shop',
  'Reason: Wrong size',
  'Type: restock',
  '• Rice 5kg 1 = $7.25 (restock) (received date 01/09/2026) — Shop 13 · all branches 41',
  '• Broken jar 2 = $3.00 (damaged) (received date 05/09/2026) — Shop 5 · all branches 5',
  '↔ Rice 5kg 1',
  'Refund: $10.25',
  'By: Za',
])
// A replacement-only return has no money. It used to say "Refund: none";
// since Sep 6 2026 a line with nothing in it is not sent at all -- the same
// zero-value rule the reports follow.
const swap = telegram.formatReturnTelegramLines({ kind: 'customer', returnNumber: 'RET-1', items: [{ product: 'A', quantity: 1 }], refundUsd: 0, refundKhr: 0 }).filter(Boolean)
assert.ok(!swap.some((line) => line.startsWith('Refund:')), swap.join('\n'))
assert.ok(!swap.some((line) => /^(INV|Customer|Branch|Reason|Type|Settlement|Loss|By):/.test(line)))

// --- supplier return: stock out + settlement money, loss only when there is one ---
assert.deepEqual(telegram.formatReturnTelegramLines({
  kind: 'supplier', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'SRET-20260903-100405', party: 'ABC Trading', branch: 'Warehouse',
  reason: 'Expired on arrival', settlement: 'credit', items: [{ product: 'Milk 1L', quantity: 12, branchOnHand: 88, totalOnHand: 100 }],
  compensationUsd: 9.6, compensationKhr: 0, lossUsd: 2.4, lossKhr: 0, by: 'Rath',
}).filter(Boolean), [
  'Date: 03/09/2026 10:04',
  'SRET: SRET-20260903-100405',
  'Supplier: ABC Trading',
  'Branch: Warehouse',
  'Reason: Expired on arrival',
  'Settlement: credit',
  '• Milk 1L 12 — Warehouse 88 · all branches 100',
  'Supplier pays: $9.60',
  'Loss: $2.40',
  'By: Rath',
])
const writeoff = telegram.formatReturnTelegramLines({ kind: 'supplier', returnNumber: 'SRET-2', settlement: 'writeoff', items: [{ product: 'A', quantity: 1 }], compensationUsd: 0, compensationKhr: 0, lossUsd: 0, lossKhr: 0 }).filter(Boolean)
assert.ok(writeoff.includes('Supplier pays: $0.00'))
assert.ok(!writeoff.some((line) => line.startsWith('Loss:') || line.startsWith('Refund:')))

// --- stock removed entirely is ONE "Loss" row directly below Not Paid ---
// Owner, Sep 14 2026: "also add one row below unpaid in reports as well" and
// "if remove directly it also counts toward losses. as cost price no selling
// price means loss". It is a POSITIVE memo: Sales and Profit above stay the
// canonical kernel figures and are never reduced by it, exactly like Credit.
const lossFigures = { ...cancelledFigures, creditUsd: 12, removalLossUsd: 30 }
const lossReport = telegram.formatShiftReport('Shop', closedThenCancelled, lossFigures, Date.parse('2026-09-05T12:00:00.000Z'))
const lossLines = lossReport.split('\n')
const unpaidAt = lossLines.findIndex((line) => line.startsWith('· Not Paid / ប្រាក់ជំពាក់:'))
const lossAt = lossLines.findIndex((line) => line.startsWith('· Loss / ខាតបង់:'))
assert.ok(unpaidAt > 0, lossReport)
assert.equal(lossAt, unpaidAt + 1, 'the Loss row sits DIRECTLY below Not Paid')
assert.equal(lossLines[lossAt], '· Loss / ខាតបង់: $30.00', lossReport)
// Numbers only -- no sentence explaining what a loss is (the owner's standing
// "no explanation just arrange all reports more concise").
assert.equal(lossLines[lossAt].split(':').length, 2, lossLines[lossAt])
// The canonical totals above are untouched by it. (The money line is labelled
// `Revenue` since Sep 21 2026 -- `Sales` names the SECTION it sits in.)
assert.ok(lossLines.includes('2. Sales / ការលក់'), lossReport)
assert.ok(lossLines.includes('· Revenue / ចំណូល: $25.00'), lossReport)
assert.ok(lossLines.includes('· Profit / ចំណេញ: $15.00'), lossReport)
// A shift that took nothing prints $0.00 and NOTHING in riel. The owner's
// Sep 22 2026 paste showed `Revenue: $0.00 · 000៛` on an open shift -- a
// riel figure with no value and a padding that belongs to no formatter in
// this file. These two rows are USD-only by construction; this pins that,
// so a future "add the riel equivalent" edit has to face the zero case.
const zeroShift = telegram.formatShiftReport('Shop', closedThenCancelled, { ...cancelledFigures, revenueUsd: 0, profitUsd: 0 }, Date.parse('2026-09-05T12:00:00.000Z')).split('\n')
assert.equal(zeroShift.find((line) => line.startsWith('· Revenue')), '· Revenue / ចំណូល: $0.00')
assert.equal(zeroShift.find((line) => line.startsWith('· Profit')), '· Profit / ចំណេញ: $0.00')
assert.ok(!zeroShift.some((line) => /^· (Revenue|Profit)/.test(line) && line.includes('៛')), 'no empty riel figure rides along on a zero row')

// Zero, and ABSENT, both print nothing: a $0.00 Loss row would assert that
// nothing was destroyed, and the kernel omits the key entirely when it could
// not scope the window (older Worker, or a filtered/non-admin totals reply).
for (const variant of [{ ...lossFigures, removalLossUsd: 0 }, cancelledFigures]) {
  const quiet = telegram.formatShiftReport('Shop', closedThenCancelled, variant, Date.parse('2026-09-05T12:00:00.000Z'))
  assert.ok(!quiet.includes('· Loss / ខាតបង់:'), quiet)
}

// The day summary carries the same row in the same place, through the same
// glossary key -- one label for one figure across both reports.
const daySales = {
  count: 4, usd: 100, cancelled: 0, refundUsd: 0, profitUsd: 40,
  deliveryFeeUsd: 0, creditUsd: 12, deliveryCostUsd: 0, deliveryCostRecorded: 0,
  removalLossUsd: 30,
}
const zeroBucket = { count: 0, usd: 0, khr: 0, quantity: 0 }
const dayWithLoss = telegram.formatDaySummary({ date: '2026-09-14', sales: daySales, fees: zeroBucket, stockIn: zeroBucket, stockOut: zeroBucket }, [])
const dayLines = dayWithLoss.split('\n')
const dayUnpaid = dayLines.findIndex((line) => line.startsWith('· Not Paid / ប្រាក់ជំពាក់:'))
assert.ok(dayUnpaid > 0, dayWithLoss)
assert.equal(dayLines[dayUnpaid + 1], '· Loss / ខាតបង់: $30.00', dayWithLoss)
// Turning the sales category off takes the Loss row with it, like every other
// sales-derived line -- it is not a second switch.
const dayNoSales = telegram.formatDaySummary({ date: '2026-09-14', sales: daySales, fees: zeroBucket, stockIn: zeroBucket, stockOut: zeroBucket }, [], { sales: false })
assert.ok(!dayNoSales.includes('· Loss / ខាតបង់:'), dayNoSales)
// And the "Stock out" line is NOT this figure: it counts quantity across
// remove + transfer_out + move_out, and a transfer between branches is not a
// loss. Pinned so the two can never be conflated into one number.
assert.match(telegramSource, /movement_type IN \('remove', 'transfer_out', 'move_out'\)/, 'stockOut stays a movement count, separate from the costed loss')
assert.ok(/removalLossUsd: totals\.removal_loss_usd/.test(telegramSource), 'both reports read the ONE kernel field, never a second definition')

// --- the event heading is the route's, the enable switch stays the category ---
assert.ok(/heading: string/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')) === false, 'heading is optional on TelegramEvent')
assert.ok(/event\.heading \|\| heading\[event\.type\]/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')))

console.log('test-telegram-messages-pure: ok')
