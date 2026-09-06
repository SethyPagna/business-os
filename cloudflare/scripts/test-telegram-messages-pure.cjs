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
// lib/telegram.ts reads the sales kernel for the shift report (S4-7).
// The delivery-payer rule the sale summary uses comes from the module that
// WROTE total_usd, so the alert cannot foot differently from the stored row.
const saleTotals = loadReal('lib/saleTotals.ts')
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow })
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
const lines = telegram.formatSaleTelegramLines({
  status: 'paid', createdAt: '2026-09-03T03:04:05.000Z', receiptNumber: '20260903-100405', cashier: 'Za',
  customer: 'Sok Dara', phone: '012 345 678', branch: 'Shop',
  items: [
    { name: 'Coca Cola 330ml', quantity: 2, unitPriceUsd: 0.5, basePriceUsd: 0.6, lineTotalUsd: 1 },
    { name: 'Rice 5kg', quantity: 1, unitPriceUsd: 7.25, basePriceUsd: 7.25, lineTotalUsd: 7.25 },
  ],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 1.5, deliveryPaidBy: 'customer',
  driver: { name: 'Tuk Tuk Dara', phone: '099 111 222' },
  subtotalUsd: 8.25, discountUsd: 0.25, taxUsd: 0, totalUsd: 9.5, totalKhr: 38950,
  paidUsd: 10, paidKhr: 0, changeUsd: 0.5, changeKhr: 0, paymentMethod: 'Cash',
}).filter(Boolean)
assert.deepEqual(lines, [
  'Status: paid',
  'Date: 03/09/2026 10:04',
  'INV: 20260903-100405',
  'Cashier: Za',
  'Customer: Sok Dara',
  'Tel: 012 345 678',
  'Branch: Shop',
  '• Coca Cola 330ml 2 × $0.60 (−$0.20) = $1.00',
  '• Rice 5kg 1 × $7.25 = $7.25',
  'Delivery service: $1.50',
  'Total: $9.75',
  'Discount: −$0.25',
  'Net Total: $9.50 / 38,950៛',
  'Paid: $10.00 (Cash)',
  'Change: $0.50',
  'Delivery driver: Tuk Tuk Dara · 099 111 222',
])

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
assert.ok(equationLines.includes('• Gross 69 1 × $69.00 (−$4.00) = $65.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('• Quantity three 3 × $25.00 (−$12.00) = $63.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('• No discount 1 × $12.00 = $12.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('• Absent base 2 × $5.00 = $10.00'), equationLines.join('\n'))
assert.ok(equationLines.includes('• Null base 1 × $7.00 = $7.00'), equationLines.join('\n'))

// The sale subtotal is already the sum of net item totals. An order-level
// discount remains separate and must be subtracted exactly once below Total.
const orderDiscount = telegram.formatSaleTelegramLines({
  status: 'completed', receiptNumber: 'ORDER-DISCOUNT', exchangeRate: 4100,
  items: [{ name: 'Gross 69', quantity: 1, basePriceUsd: 69, unitPriceUsd: 65, lineTotalUsd: 65 }],
  subtotalUsd: 65, discountUsd: 4, totalUsd: 61,
}).filter(Boolean)
assert.ok(orderDiscount.includes('• Gross 69 1 × $69.00 (−$4.00) = $65.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Total: $65.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Discount: −$4.00'), orderDiscount.join('\n'))
assert.ok(orderDiscount.includes('Net Total: $61.00'), orderDiscount.join('\n'))

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
assert.ok(dualChange.includes('Net Total: $1.00 / 4,000៛'), dualChange.join('\n'))
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
const cancelledFigures = {
  invoices: 3, cancelled: 1, edited: 0, revenueUsd: 25, itemDiscountUsd: 0,
  invoiceDiscountUsd: 0, storeDiscountUsd: 0, membershipDiscountUsd: 0,
  grossSaleUsd: 25, taxUsd: 0, refundUsd: 0, avgOrderUsd: 8.33, costUsd: 10,
  profitUsd: 15, deliveryFeeUsd: 0, deliveryCostUsd: 0, deliveryMarginUsd: 0,
  deliveryCostRecorded: 0, creditUsd: 0, otherExpenseUsd: 0, otherExpenseKhr: 0,
  collectedUsd: 25, cash: { usd: 25, khr: 0, needsReview: false },
  paymentMethods: [], deliveryServices: [],
}
const cancelledReport = telegram.formatShiftReport('Shop', cancelledShift, cancelledFigures, Date.parse('2026-09-04T12:00:00.000Z'))
assert.ok(cancelledReport.includes('cancelled / បានបោះបង់'), cancelledReport)
assert.ok(cancelledReport.includes('Cancelled by / បោះបង់ដោយ: Manager'), cancelledReport)
assert.ok(cancelledReport.includes('Reason / មូលហេតុ: Duplicate opening'), cancelledReport)
assert.ok(cancelledReport.includes('Invoices / វិក្កយបត្រ: 3'), cancelledReport)
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
assert.ok(closedCancelledReport.includes('Counted / បានរាប់: $75.00 · 100,000៛'), closedCancelledReport)
assert.ok(closedCancelledReport.includes('Invoices / វិក្កយបត្រ: 3'), closedCancelledReport)
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
assert.ok(credit.includes('Total: $2.00'), credit.join('\n'))
assert.ok(credit.includes('Paid: unpaid'))
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
assert.ok(absorbed.includes('Total: $20.00'), absorbed.join('\n'))
assert.ok(absorbed.includes('Net Total: $20.00 / 82,000៛'), absorbed.join('\n'))

// The message FOOTS: Total - Discount + Tax must equal Net Total, which is
// the stored total_usd. A shop-absorbed fee added to Total would break this
// by exactly the fee -- which is the defect above, stated as arithmetic.
const footing = (sale) => {
  const lines = telegram.formatSaleTelegramLines(sale).filter(Boolean)
  const money = (prefix) => { const hit = lines.find((l) => l.startsWith(prefix)); return hit ? Number(hit.replace(prefix, '').split(' ')[0].replace(/[$,\u00a0]/g, '').replace('\u2212', '-')) : 0 }
  return Math.round((money('Total: ') - money('Discount: \u2212') + money('Tax: ') - money('Net Total: ')) * 100) / 100
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

// long receipts are capped, never truncated silently
const many = telegram.formatSaleTelegramLines({
  status: 'paid', receiptNumber: 'R2', exchangeRate: 4100, subtotalUsd: 25, discountUsd: 0, totalUsd: 25,
  items: Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 1, unitPriceUsd: 1, lineTotalUsd: 1 })),
}).filter(Boolean)
assert.equal(many.filter((line) => line.startsWith('• ')).length, 20)
assert.ok(many.includes('+ 5 more item(s)'))

// --- stock change with resulting on-hand ---
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'remove', quantity: -3, branch: 'Shop', reason: 'Damaged', branchOnHand: 12, totalOnHand: 40, by: 'Za',
}).filter(Boolean), ['Product: Rice 5kg', 'Stock change: −3', 'Branch: Shop', 'Reason: Damaged', 'On hand: Shop 12 · all branches 40', 'By: Za'])
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 5, branch: 'Warehouse', lot: '09032026', branchOnHand: 0, totalOnHand: null,
}).filter(Boolean), ['Product: Rice 5kg', 'Stock change: +5', 'Branch: Warehouse', 'Lot: 09032026', 'On hand: Warehouse 0'])

// --- transfers: one builder for the single, bulk and inventory-page routes ---
assert.deepEqual(telegram.formatTransferTelegramLines({
  createdAt: '2026-09-03 03:04:05', fromBranch: 'Warehouse', toBranch: 'Shop', note: 'Restock front shelf', by: 'Za',
  items: [
    { product: 'Rice 5kg', quantity: 10, lot: '09032026', fromOnHand: 90, toOnHand: 25, totalOnHand: 115 },
    { product: 'Coca Cola 330ml', quantity: 24, mergedInto: 'Coca-Cola 330ml', fromOnHand: 0, toOnHand: 48, totalOnHand: null },
  ],
}).filter(Boolean), [
  'Date: 03/09/2026 10:04',
  'From: Warehouse',
  'To: Shop',
  '• Rice 5kg 10 (lot 09032026) — Warehouse 90 · Shop 25 · all branches 115',
  '• Coca Cola 330ml 24 → Coca-Cola 330ml — Warehouse 0 · Shop 48',
  'Total moved: 34 unit(s) · 2 product(s)',
  'Note: Restock front shelf',
  'By: Za',
])
// unknown on-hand (read-back failed) and missing branch names never produce a
// dangling "On hand:" fragment; the cap states the remainder
const bulk = telegram.formatTransferTelegramLines({
  items: Array.from({ length: 23 }, (_, i) => ({ product: `Item ${i + 1}`, quantity: 2 })),
}).filter(Boolean)
assert.equal(bulk[1], 'From: Source')
assert.equal(bulk[3], '• Item 1 2')
assert.equal(bulk.filter((line) => line.startsWith('• ')).length, 20)
assert.ok(bulk.includes('+ 3 more item(s)'))
assert.ok(bulk.includes('Total moved: 46 unit(s) · 23 product(s)'))

// --- customer return: receipt-style, refund per line, resulting on-hand ---
assert.deepEqual(telegram.formatReturnTelegramLines({
  kind: 'customer', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'RET-20260903-100405', receiptNumber: '20260901-153000',
  party: 'Sok Dara', branch: 'Shop', reason: 'Wrong size', returnType: 'restock',
  items: [
    { product: 'Rice 5kg', quantity: 1, refundUsd: 7.25, stockAction: 'restock', lot: '09012026', branchOnHand: 13, totalOnHand: 41 },
    { product: 'Broken jar', quantity: 2, refundUsd: 3, stockAction: 'damaged', branchOnHand: 5, totalOnHand: 5 },
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
  '• Rice 5kg 1 = $7.25 (restock) (lot 09012026) — Shop 13 · all branches 41',
  '• Broken jar 2 = $3.00 (damaged) — Shop 5 · all branches 5',
  '↔ Rice 5kg 1',
  'Refund: $10.25',
  'By: Za',
])
// a replacement-only return has no money: say so instead of "$0.00"
const swap = telegram.formatReturnTelegramLines({ kind: 'customer', returnNumber: 'RET-1', items: [{ product: 'A', quantity: 1 }], refundUsd: 0, refundKhr: 0 }).filter(Boolean)
assert.ok(swap.includes('Refund: none'), swap.join('\n'))
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

// --- the event heading is the route's, the enable switch stays the category ---
assert.ok(/heading: string/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')) === false, 'heading is optional on TelegramEvent')
assert.ok(/event\.heading \|\| heading\[event\.type\]/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'), 'utf8')))

console.log('test-telegram-messages-pure: ok')
