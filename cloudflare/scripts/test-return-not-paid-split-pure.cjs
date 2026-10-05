// Owner rule 29 Sep 2026 (SCAN2 U11): a return on a Not Paid sale lowers what
// the customer owes and takes no cash out of the drawer; only the part of the
// return worth more than the debt is refunded in cash, and never more than the
// customer actually paid. Completed and imported sales keep refunding in cash.
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.join(__dirname, '..')
function load(entry) {
  const output = buildSync({ stdin: { contents: `export * from './${entry}'`, resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}
const split = load('returnRefundSplit')
const tender = load('refundTender')
const resolution = load('saleStatusResolution')

let failed = 0
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const notPaid = { sale_status: 'awaiting_payment', status_before_return: null, total_usd: 100, amount_paid_usd: 30,
  amount_paid_khr: 0, exchange_rate: 4000, money_precision_version: 1, calculated_total_usd: 100 }
const none = { refundUsd: 0, owedReductionUsd: 0, loweredDebt: false }

test('a return worth less than the debt only lowers it: no cash leaves the drawer', () => {
  assert.deepEqual(split.splitReturnRefund({ sale: notPaid, prior: none, refundUsd: 40 }), { owedReductionUsd: 40, cashUsd: 0 })
})

test('the part worth more than the debt is refunded in cash, the rest lowers the debt', () => {
  const prior = { refundUsd: 40, owedReductionUsd: 40, loweredDebt: true }
  assert.deepEqual(split.splitReturnRefund({ sale: notPaid, prior, refundUsd: 50 }), { owedReductionUsd: 30, cashUsd: 20 })
})

test('cash refunds stop at what the customer actually paid', () => {
  const prior = { refundUsd: 90, owedReductionUsd: 70, loweredDebt: true }
  assert.deepEqual(split.splitReturnRefund({ sale: notPaid, prior, refundUsd: 10 }), { owedReductionUsd: 0, cashUsd: 10 })
  assert.throws(() => split.splitReturnRefund({ sale: notPaid, prior, refundUsd: 11 }),
    (error) => error.code === 'customer_return_refund_exceeds_paid')
})

test('a Completed sale refunds the whole return in cash', () => {
  const paid = { ...notPaid, sale_status: 'completed', amount_paid_usd: 100 }
  assert.deepEqual(split.splitReturnRefund({ sale: paid, prior: none, refundUsd: 40 }), { owedReductionUsd: 0, cashUsd: 40 })
})

test('an imported Completed sale with no recorded tender is paid, not owed', () => {
  const imported = { ...notPaid, sale_status: 'completed', amount_paid_usd: 0, money_precision_version: 0, calculated_total_usd: null }
  assert.deepEqual(split.splitReturnRefund({ sale: imported, prior: none, refundUsd: 40 }), { owedReductionUsd: 0, cashUsd: 40 })
})

test('a riel payment counts at the sale own rate and the debt lowers in whole cents', () => {
  const riel = { ...notPaid, total_usd: 10, calculated_total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 20510, exchange_rate: 4100 }
  assert.deepEqual(split.splitReturnRefund({ sale: riel, prior: none, refundUsd: 8 }), { owedReductionUsd: 5, cashUsd: 3 })
})

test('a sale that returned while Not Paid still carries its debt', () => {
  const returned = { ...notPaid, sale_status: 'partial_return', status_before_return: 'awaiting_payment' }
  assert.equal(split.saleCarriesDebt(returned, false), true)
  assert.equal(split.saleCarriesDebt({ ...notPaid, sale_status: 'completed' }, true), true)
  assert.equal(split.saleCarriesDebt({ ...notPaid, sale_status: 'completed' }, false), false)
  assert.equal(split.saleCarriesDebt({ ...notPaid, sale_status: 'partial_return', status_before_return: 'completed' }, false), false)
})

test('the sale stays Not Paid while it owes, otherwise takes its return outcome', () => {
  assert.equal(split.saleStatusWithReturns({ sale: notPaid, activeOwedReductionUsd: 40, loweredDebt: true, quantityStatus: 'partial_return' }), 'awaiting_payment')
  assert.equal(split.saleStatusWithReturns({ sale: notPaid, activeOwedReductionUsd: 70, loweredDebt: true, quantityStatus: 'partial_return' }), 'partial_return')
  assert.equal(split.saleStatusWithReturns({ sale: { ...notPaid, sale_status: 'completed', amount_paid_usd: 0 }, activeOwedReductionUsd: 0, loweredDebt: false, quantityStatus: 'partial_return' }), 'partial_return')
  const delivery = { ...notPaid, total_usd: 105, calculated_total_usd: 105, amount_paid_usd: 0 }
  assert.equal(split.saleStatusWithReturns({ sale: delivery, activeOwedReductionUsd: 100, loweredDebt: true, quantityStatus: 'returned' }), 'awaiting_payment',
    'a delivery fee still owed keeps a fully returned sale Not Paid')
})

test('what a stored sale owes subtracts the debt its returns already lowered', () => {
  assert.equal(resolution.recordedSaleOutstandingUsd({ ...notPaid, return_owed_reduction_usd: 40 }), 30)
  assert.equal(resolution.recordedSaleOutstandingUsd({ ...notPaid, return_owed_reduction_usd: 70 }), 0)
  assert.equal(resolution.statusChangeNeedsPayment('awaiting_payment', 'completed', { ...notPaid, amount_paid_usd: 60, return_owed_reduction_usd: 40 }), false)
  assert.equal(resolution.statusChangeNeedsPayment('awaiting_payment', 'completed', { ...notPaid, amount_paid_usd: 60 }), true)
})

test('refund currency is dollars unless riel is chosen', () => {
  assert.equal(tender.parseRefundCurrency(undefined), 'USD')
  assert.equal(tender.parseRefundCurrency('khr'), 'KHR')
  assert.throws(() => tender.parseRefundCurrency('EUR'))
})

test('a riel refund hands back its cash share of the return riel figure; the debt part leaves no drawer', () => {
  assert.deepEqual(tender.refundTender({ total_refund_usd: 10, total_refund_khr: 40000, owed_reduction_usd: 5, refund_currency: 'KHR' }),
    { currency: 'KHR', owedReductionUsd: 5, cashUsd: 5, rielRefunded: 20000 })
  assert.deepEqual(tender.refundTender({ total_refund_usd: 10, total_refund_khr: 40000, owed_reduction_usd: 0, refund_currency: 'USD' }),
    { currency: 'USD', owedReductionUsd: 0, cashUsd: 10, rielRefunded: 0 })
  assert.equal(tender.refundTender({ total_refund_usd: 10, total_refund_khr: 41000 }).currency, null, 'recorded before the currency was asked')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
