'use strict'
// Lane 6.0.884 (money half of finding D): lib/returnRefundSplit.ts splits a
// customer return into the debt it lowers and the cash it refunds, and the
// shift drawer SQL (lib/shiftReconciliation.ts refundDrawerUsdSql /
// refundDrawerKhrSql) pays out only the cash, in the currency it was paid in.
// Owner rulings 29 Sep and 5-6 Oct 2026:
//   $10 Not Paid, $3 paid, $4 back -> owes $3, cash $0
//   $10 Not Paid, $7 paid, $4 back -> owes $0, cash $1
// A row recorded before migration 0260 (refund_currency NULL) keeps 6.0.872's
// reading: its whole refund lowered the debt and was dollar cash.
//
// Run (from cloudflare/): node scripts/test-return-refund-split-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { DatabaseSync } = require('node:sqlite')

function load(file) {
  const out = buildSync({ entryPoints: [path.join(__dirname, '..', 'src', file)], bundle: true, write: false, format: 'cjs',
    platform: 'node', target: 'es2022', external: ['cloudflare:*'], logLevel: 'silent' })
  const m = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require)
  return m.exports
}
const split = load('lib/returnRefundSplit.ts')
const shift = load('lib/shiftReconciliation.ts')

let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }

const sale = (over = {}) => ({ id: 1, sale_status: 'awaiting_payment', status_before_return: null, total_usd: 10,
  amount_paid_usd: 0, amount_paid_khr: 0, exchange_rate: 4000, money_precision_version: 1, calculated_total_usd: 10, ...over })
const fresh = (refundUsd, extra = {}) => ({ id: 0, active: true, refundUsd, owedReductionUsd: 0, currency: 'USD', ...extra })
const plan = (s, returns, recompute = [0]) => {
  const result = split.planReturnMoney({ sale: s, returns, recompute })
  return { owed: Object.fromEntries(result.owedReductionUsd), payment: result.paymentState }
}

check('Not Paid $10, nothing paid, $4 back: all $4 lowers the debt, still Not Paid', () => {
  assert.deepEqual(plan(sale(), [fresh(4)]), { owed: { 0: 4 }, payment: 'awaiting_payment' })
})
check('owner example: $10, $3 paid, $4 back -> $4 lowers the $7 debt, $3 still owed, no cash', () => {
  assert.deepEqual(plan(sale({ amount_paid_usd: 3 }), [fresh(4)]), { owed: { 0: 4 }, payment: 'awaiting_payment' })
})
// Owner, 20 Oct 2026: nothing turns Not Paid into paid except tender; a cash refund of the excess does not.
check('over the debt: $10, $7 paid, $4 back -> $3 lowers the debt, $1 cash, the sale stays Not Paid ($0 owed)', () => {
  assert.deepEqual(plan(sale({ amount_paid_usd: 7 }), [fresh(4)]), { owed: { 0: 3 }, payment: 'awaiting_payment' })
  assert.equal(split.refundCashUsd(4, 3), 1)
})
check('exactly the debt: $10, $6 paid, $4 back -> all of it lowers the debt, no money moves, so the sale stays Not Paid ($0 owed) until marked paid', () => {
  assert.deepEqual(plan(sale({ amount_paid_usd: 6 }), [fresh(4)]), { owed: { 0: 4 }, payment: 'awaiting_payment' })
  // a later return on that $0 debt is all cash and leaves it Not Paid
  const cleared = sale({ sale_status: 'partial_return', status_before_return: 'awaiting_payment', amount_paid_usd: 6 })
  assert.deepEqual(plan(cleared, [{ id: 1, active: true, refundUsd: 4, owedReductionUsd: 4, currency: 'USD' }, fresh(2)]), { owed: { 0: 0 }, payment: 'awaiting_payment' })
})
check('a sale paid at the counter never carries a debt: the refund is all cash, the status untouched', () => {
  assert.deepEqual(plan(sale({ sale_status: 'completed', amount_paid_usd: 10 }), [fresh(4)]), { owed: { 0: 0 }, payment: 'completed' })
})
check('an imported Completed sale with no tender recorded is paid, not owing: its return is cash (control for a naive balance)', () => {
  assert.deepEqual(plan(sale({ sale_status: 'completed', amount_paid_usd: 0 }), [fresh(4)]), { owed: { 0: 0 }, payment: 'completed' })
  assert.deepEqual(plan(sale({ sale_status: 'partial_return', status_before_return: 'completed' }), [fresh(4)]), { owed: { 0: 0 }, payment: 'completed' })
})
check('a pre-0260 return on a Not Paid sale reads as lowering its whole value (6.0.872), so the next return sees $6 owed', () => {
  const legacy = { id: 7, active: true, refundUsd: 4, owedReductionUsd: 0, currency: null }
  assert.deepEqual(plan(sale({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }), [legacy, fresh(4)]), { owed: { 0: 4 }, payment: 'awaiting_payment' })
  assert.deepEqual(plan(sale({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }), [legacy, fresh(8)]), { owed: { 0: 6 }, payment: 'awaiting_payment' })
})
check('cancelling an earlier return brings its debt back beside a later cash refund ($10, $7 paid, A $2 lowered, B $2 = $1 lowered + $1 cash)', () => {
  const rows = [{ id: 1, active: false, refundUsd: 2, owedReductionUsd: 2, currency: 'USD' }, { id: 2, active: true, refundUsd: 2, owedReductionUsd: 1, currency: 'USD' }]
  // goods kept $8, paid $7 less $1 back = $6 -> owes $2
  assert.deepEqual(plan(sale({ sale_status: 'partial_return', status_before_return: 'completed', amount_paid_usd: 7 }), rows, []), { owed: {}, payment: 'awaiting_payment' })
})
check('a return restored after the sale was settled is all cash', () => {
  const rows = [{ id: 1, active: true, refundUsd: 4, owedReductionUsd: 4, currency: 'USD' }]
  assert.deepEqual(plan(sale({ sale_status: 'completed', amount_paid_usd: 10 }), rows, [1]), { owed: { 1: 0 }, payment: 'completed' })
})
check('riel tender counts at the sale rate and the debt lowered is whole cents ($10, 12,345 riel at 4,000 paid, $8 back)', () => {
  const result = plan(sale({ amount_paid_khr: 12345 }), [fresh(8)])
  assert.deepEqual(result, { owed: { 0: 6.91 }, payment: 'awaiting_payment' })
})
check('unreadable sale money refuses rather than guessing the debt', () => {
  assert.throws(() => split.planReturnMoney({ sale: sale({ exchange_rate: null }), returns: [fresh(4)], recompute: [0] }), error => error.code === 'customer_return_owed_unreadable')
})
check('payment state reads the return ribbon apart: a return status keeps status_before_return', () => {
  assert.equal(split.salePaymentState({ sale_status: 'partial_return', status_before_return: 'awaiting_payment' }), 'awaiting_payment')
  assert.equal(split.salePaymentState({ sale_status: 'returned', status_before_return: null }), 'completed')
  assert.equal(split.salePaymentState({ sale_status: 'awaiting_delivery' }), 'awaiting_delivery')
})

check('drawer SQL and its JS twin agree: legacy dollars, split dollars, split riel', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE returns(id INTEGER PRIMARY KEY, total_refund_usd REAL, total_refund_khr REAL, owed_reduction_usd REAL NOT NULL DEFAULT 0, refund_currency TEXT)')
  const rows = [
    [1, 4, 16000, 0, null], [2, 4, 16000, 3, 'USD'], [3, 4, 16000, 3, 'KHR'], [4, 1.2, 4700, 0.99, 'KHR'],
    [5, 4, 16000, 4, 'KHR'], [6, 4, 16000, 0, 'KHR'], [7, 0, 0, 0, 'KHR'], [8, 2.5, 10250, 0, 'USD'],
  ]
  const insert = db.prepare('INSERT INTO returns VALUES (?,?,?,?,?)')
  for (const row of rows) insert.run(...row)
  const read = db.prepare(`SELECT id, total_refund_usd, total_refund_khr, owed_reduction_usd, refund_currency,
      ${shift.refundDrawerUsdSql('returns')} AS usd, ${shift.refundDrawerKhrSql('returns')} AS khr,
      ${split.returnDebtLoweredSql('returns')} AS lowered FROM returns ORDER BY id`).all()
  const expected = { 1: [4, 0, 4], 2: [1, 0, 3], 3: [0, 4000, 3], 4: [0, 822, 0.99], 5: [0, 0, 4], 6: [0, 16000, 0], 7: [0, 0, 0], 8: [2.5, 0, 0] }
  for (const row of read) {
    assert.deepEqual([Number(Number(row.usd).toFixed(4)), row.khr, row.lowered], expected[row.id], `row ${row.id}`)
    const twin = split.refundCashOut(row)
    assert.deepEqual([twin.usd, twin.khr], [Number(Number(row.usd).toFixed(4)), row.khr], `JS twin of row ${row.id}`)
  }
  db.close()
})

console.log(`GREEN return refund split: ${passed} checks`)
