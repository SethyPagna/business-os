// Pins the Telegram alert shapes the user specified (Part 581):
//   sale  -> a receipt summary: Status / Date / INV / Cashier / Customer /
//            Tel / "name qty × price (−discount) = total" per item /
//            Delivery service / Total / Discount / Net Total / Paid /
//            Delivery driver
//   stock -> the change PLUS the resulting on-hand (branch · all branches)
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
const telegram = loadReal('lib/telegram.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow })

// --- date: UTC -> business zone, mm/dd/yyyy HH:mm, both timestamp shapes ---
assert.equal(telegram.formatBusinessDateTime('2026-09-02T17:30:00.000Z'), '09/03/2026 00:30', 'ISO with Z shifts +7h across midnight')
assert.equal(telegram.formatBusinessDateTime('2026-09-02 08:05:09'), '09/02/2026 15:05', 'D1 CURRENT_TIMESTAMP (no zone) is UTC')
assert.equal(telegram.formatBusinessDateTime(null, Date.UTC(2026, 0, 1, 0, 0)), '01/01/2026 07:00', 'missing timestamp falls back to now')
assert.equal(telegram.formatBusinessDateTime('garbage', Date.UTC(2026, 0, 1, 0, 0)), '01/01/2026 07:00', 'unparseable timestamp falls back to now')

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
  'Date: 09/03/2026 10:04',
  'INV: 20260903-100405',
  'Cashier: Za',
  'Customer: Sok Dara',
  'Tel: 012 345 678',
  'Branch: Shop',
  '• Coca Cola 330ml 2 × $0.50 (−$0.20) = $1.00',
  '• Rice 5kg 1 × $7.25 = $7.25',
  'Delivery service: $1.50',
  'Total: $9.75',
  'Discount: −$0.25',
  'Net Total: $9.50 · 38,950៛',
  'Paid: $10.00 (Cash)',
  'Change: $0.50',
  'Delivery driver: Tuk Tuk Dara · 099 111 222',
])

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
}).filter(Boolean), ['Product: Rice 5kg', 'Change: −3', 'Branch: Shop', 'Reason: Damaged', 'On hand: Shop 12 · all branches 40', 'By: Za'])
assert.deepEqual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 5, branch: 'Warehouse', lot: '09032026', branchOnHand: 0, totalOnHand: null,
}).filter(Boolean), ['Product: Rice 5kg', 'Change: +5', 'Branch: Warehouse', 'Lot: 09032026', 'On hand: Warehouse 0'])

console.log('test-telegram-messages-pure: ok')
