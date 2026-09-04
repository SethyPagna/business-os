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
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow })
const telegram = loadReal('lib/telegram.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang, './salesAnalytics': salesAnalytics })

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
