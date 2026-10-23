import assert from 'node:assert/strict'
import {
  changeRielRoundedDown, exchangeDue, exchangeOutstandingUsd, exchangeOverpaymentUsd, exchangePaymentBody, exchangePaymentIssue,
  exchangeReplacementItems, initialExchangePayRows,
} from '../src/components/returns/helpers/returnExchange.ts'
import { planReplacementParts } from '../src/components/returns/helpers/replacementPricing.ts'

// 6.0.958: the Returns screen's figures for a one-step exchange. The Worker recomputes every one of them
// (cloudflare/scripts/test-return-exchange-v1-native.cjs) and refuses a payment that does not cover the amount due; these are the same
// numbers on the till's side, so the screen never offers a payment the server would call short and never rounds a give-back up.

const methods = ['Cash', 'ABA']
const exchange = (net_usd: number, extra: Record<string, unknown> = {}) => ({ net_usd, exchange_rate: 4000, not_paid: false, ...extra })

// ---- what the customer owes / is owed ---------------------------------------------------------------------------------------------------
assert.deepEqual(exchangeDue(exchange(6)), { kind: 'pay', usd: 6 })
assert.deepEqual(exchangeDue(exchange(-3.52)), { kind: 'give', usd: 3.52 })
assert.deepEqual(exchangeDue(exchange(0)), { kind: 'even', usd: 0 })

// ---- the payment rows the screen opens with ------------------------------------------------------------------------------------------------
assert.deepEqual(initialExchangePayRows(exchange(6), methods), [{ id: 'settlement-new', method: 'Cash', usd: '6.00', khr: '' }], 'the whole amount due, in the first method')
assert.deepEqual(initialExchangePayRows(exchange(-3.52), methods), [], 'a give-back asks for no payment')
assert.deepEqual(initialExchangePayRows(exchange(0), methods), [], 'an even exchange asks for no payment')
assert.deepEqual(initialExchangePayRows(exchange(16, { not_paid: true }), methods), [], 'a Not Paid original leaves the replacement Not Paid: nothing is netted across a debt')

// ---- short / covered -------------------------------------------------------------------------------------------------------------------------
const row = (method: string, usd: string, khr = '') => ({ id: `r-${method}-${usd}-${khr}`, method, usd, khr })
assert.equal(exchangePaymentIssue([row('Cash', '6.00')], exchange(6), methods), null, 'exactly covered')
assert.equal(exchangePaymentIssue([row('Cash', '5.99')], exchange(6), methods), 'short', 'a cent short is short')
assert.equal(exchangePaymentIssue([row('Cash', '', '24400')], exchange(6.1), methods), null, '24,400 riel at 4,000 covers $6.10 exactly')
assert.equal(exchangePaymentIssue([row('Cash', '', '24000')], exchange(6.1), methods), 'short', '24,000 riel is $6.00: short of $6.10')
assert.equal(exchangePaymentIssue([row('Cash', '4'), row('ABA', '2')], exchange(6), methods), null, 'two methods add up')
assert.equal(exchangePaymentIssue([row('Venmo', '6')], exchange(6), methods), 'method', 'a method the shop does not take')
assert.equal(exchangePaymentIssue([], exchange(6), methods), 'amount', 'no rows at all when money is due')
assert.equal(exchangePaymentIssue([], exchange(-3.52), methods), null, 'a give-back needs no payment')
assert.equal(exchangePaymentIssue([], exchange(0), methods), null)
assert.equal(exchangePaymentIssue([], exchange(16, { not_paid: true }), methods), null, 'Not Paid: may be left unpaid')
assert.equal(exchangeOutstandingUsd([row('Cash', '4')], exchange(6)), 2)

// ---- change: dollars exact, riel rounded DOWN to 100 -------------------------------------------------------------------------------------------
assert.equal(exchangeOverpaymentUsd([], exchange(-3.52)), 3.52, 'a give-back is handed back whole')
assert.equal(exchangeOverpaymentUsd([row('Cash', '10')], exchange(6)), 4, 'an overpayment is the change')
assert.equal(exchangeOverpaymentUsd([row('Cash', '6')], exchange(6)), 0)
assert.equal(changeRielRoundedDown(3.52, 4000), 14000, '14,080 riel is handed out as 14,000, never 14,100')
assert.equal(changeRielRoundedDown(0.0249, 4000), 0, 'under 100 riel stays with the till')
assert.equal(changeRielRoundedDown(1, 4000), 4000)
assert.equal(changeRielRoundedDown(0.05, 4000), 200, 'exactly 200 riel is not lost to float noise')

// ---- the payment the create call carries --------------------------------------------------------------------------------------------------
assert.deepEqual(exchangePaymentBody([row('Cash', '6')], exchange(6), methods, 'USD'), { details: [{ method: 'Cash', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' })
assert.deepEqual(exchangePaymentBody([row('Cash', '', '24400')], exchange(6.1), methods, 'KHR'), { details: [{ method: 'Cash', amount_usd: 0, amount_khr: 24400 }], change_currency: 'KHR' })
assert.deepEqual(exchangePaymentBody([row('Cash', '6')], exchange(-3.52), methods, 'KHR'), { details: [], change_currency: 'KHR' }, 'a give-back carries no customer rows, only the currency')
assert.deepEqual(exchangePaymentBody([row('Cash', '6')], exchange(16, { not_paid: true }), methods, 'USD'), { details: [], change_currency: 'USD' }, 'Not Paid sends no rows')

// ---- the replacement lines asked for ---------------------------------------------------------------------------------------------------------
{
  // 1 of a product sold at $3 comes back; 10 go out. The one covered unit goes out at the sold price, the other 9 at the catalog $5.
  const rows = [{ key: 'a', product_id: 9301, branch_id: 1, batch_id: null, quantity: 10, catalog_usd: 5, catalog_khr: null }]
  const plan = planReplacementParts(rows.map((r) => ({ key: r.key, productId: r.product_id, quantity: r.quantity, catalogUsd: r.catalog_usd, catalogKhr: r.catalog_khr })),
    [{ productId: 9301, quantity: 1, soldUsd: 3, soldKhr: 12000 }], 4000)
  const lines = exchangeReplacementItems(rows, (r) => plan.get(r.key) ?? [])
  assert.deepEqual(lines, [
    { product_id: 9301, branch_id: 1, batch_id: null, quantity: 1, applied_price_usd: 3 },
    { product_id: 9301, branch_id: 1, batch_id: null, quantity: 9 },
  ], 'the covered unit posts its sold price; the units at the catalog price post no price of their own')
}
{
  const rows = [{ key: 'b', product_id: 9302, branch_id: 1, batch_id: 14500, quantity: 2, catalog_usd: 4, catalog_khr: null }]
  const plan = planReplacementParts(rows.map((r) => ({ key: r.key, productId: r.product_id, quantity: r.quantity, catalogUsd: r.catalog_usd, catalogKhr: r.catalog_khr })),
    [{ productId: 9301, quantity: 1, soldUsd: 3, soldKhr: 12000 }], 4000)
  assert.deepEqual(exchangeReplacementItems(rows, (r) => plan.get(r.key) ?? []), [{ product_id: 9302, branch_id: 1, batch_id: 14500, quantity: 2 }], 'another product is a new purchase: catalog price, the lot the operator picked')
}
{
  // 6.0.958 (coordinator P3-B): a "Same item" shortcut whose catalog read was refused has no catalog price (null). 1 of the product sold at $5 comes back,
  // 3 go out: the covered unit posts the sold price it was paid at -- even though it equals what a stale guess would have been -- and the two extras post
  // NO price at all, so the Worker prices them at today's catalog price.
  const rows = [{ key: 'u', product_id: 7, branch_id: 1, batch_id: null, quantity: 3, catalog_usd: null, catalog_khr: null }]
  const plan = planReplacementParts(rows.map((r) => ({ key: r.key, productId: r.product_id, quantity: r.quantity, catalogUsd: r.catalog_usd, catalogKhr: r.catalog_khr })),
    [{ productId: 7, quantity: 1, soldUsd: 5, soldKhr: 20000 }], 4000)
  const lines = exchangeReplacementItems(rows, (r) => plan.get(r.key) ?? [])
  assert.deepEqual(lines, [
    { product_id: 7, branch_id: 1, batch_id: null, quantity: 1, applied_price_usd: 5 },
    { product_id: 7, branch_id: 1, batch_id: null, quantity: 2 },
  ], 'the covered unit posts its sold price; the extras of an unreadable catalog post none')
  assert.ok(lines.every((line) => !('applied_price_khr' in line)), 'no riel price is posted either')
  // Nothing returned of it: the whole row is the Worker's to price.
  const bare = [{ key: 'v', product_id: 8, branch_id: 1, batch_id: 9, quantity: 4, catalog_usd: null, catalog_khr: null }]
  const barePlan = planReplacementParts(bare.map((r) => ({ key: r.key, productId: r.product_id, quantity: r.quantity, catalogUsd: r.catalog_usd, catalogKhr: r.catalog_khr })), [], 4000)
  assert.deepEqual(exchangeReplacementItems(bare, (r) => barePlan.get(r.key) ?? []), [{ product_id: 8, branch_id: 1, batch_id: 9, quantity: 4 }])
  // A readable catalog is unchanged: sold $5 against a catalog of $5 posts nothing for the covered unit either (the Worker's catalog price is the same).
  const known = [{ key: 'k', product_id: 7, branch_id: 1, batch_id: null, quantity: 3, catalog_usd: 5, catalog_khr: 20000 }]
  const knownPlan = planReplacementParts(known.map((r) => ({ key: r.key, productId: r.product_id, quantity: r.quantity, catalogUsd: r.catalog_usd, catalogKhr: r.catalog_khr })),
    [{ productId: 7, quantity: 1, soldUsd: 5, soldKhr: 20000 }], 4000)
  assert.deepEqual(exchangeReplacementItems(known, (r) => knownPlan.get(r.key) ?? []).map((line) => 'applied_price_usd' in line), [false, false])
}
assert.deepEqual(exchangeReplacementItems([{ product_id: 'x', branch_id: 1, batch_id: null, catalog_usd: 1 }], () => [{ quantity: 1, priceUsd: 1, priceKhr: null, swapped: false }]), [], 'a line without a real product id is never sent')
console.log('PASS return exchange helpers: amount due, payment rows, short/covered, riel change rounds down, frozen payment body, replacement lines')
