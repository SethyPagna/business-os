// The till's half of Fulfil and the ABA refund choice (KHQR S6a/S6b, security review F3): the hand-off read, what is still to add, how much of the online money a sale covers and
// what the difference means in words, the one payment row the online money becomes, and when "Through ABA" is offered at all. Pure; the browser test mounts the real components.
import assert from 'node:assert/strict'
import test from 'node:test'
import { clearFulfilHandoff, extraLines, fulfilMoney, fulfilSaleFields, lineStatus, ONLINE_TENDER_ROW_ID, readFulfilHandoff, withOnlineTender } from '../src/components/online-orders/fulfilOrder.ts'
import { FULFIL_HANDOFF_KEY } from '../src/components/online-orders/onlineOrdersLogic.ts'
import { abaRefundOffer, DEFAULT_ONLINE_METHOD, onlineMethodName, onlineTenderUsd } from '../src/components/returns/helpers/abaRefund.ts'

const store = (value: string | null) => ({ getItem: (key: string) => (key === FULFIL_HANDOFF_KEY ? value : null), removeItem: () => {} })
const handoff = { online_order_id: 7, order_no: 'W261109K7Q2', revision: 4, branch_id: 2, customer_name: 'Sample Buyer', customer_phone: '*** 678', fulfilment: 'pickup', address: null,
  lines: [{ product_id: 1000, quantity: 2 }, { product_id: 1001, quantity: 1 }], paid_usd: 25 }

test('the hand-off is read back whole, and anything else is no hand-off', () => {
  // CATCHES: a till that opens an order from a half-written or foreign value, that throws when storage is blocked, and one that keeps a line with no quantity.
  assert.deepEqual(readFulfilHandoff(store(JSON.stringify(handoff))), handoff)
  assert.equal(readFulfilHandoff(store(null)), null)
  assert.equal(readFulfilHandoff(store('not json')), null)
  assert.equal(readFulfilHandoff(store(JSON.stringify({ ...handoff, online_order_id: 0 }))), null)
  assert.equal(readFulfilHandoff(store(JSON.stringify({ ...handoff, online_order_id: '7' }))), null, 'the id is a whole number, not text')
  assert.equal(readFulfilHandoff(store(JSON.stringify({ ...handoff, lines: [] }))), null)
  assert.deepEqual(readFulfilHandoff(store(JSON.stringify({ ...handoff, lines: [{ product_id: 1000, quantity: 2 }, { product_id: 5, quantity: 0 }, { product_id: 'x', quantity: 1 }] })))?.lines, [{ product_id: 1000, quantity: 2 }])
  assert.equal(readFulfilHandoff({ getItem: () => { throw new Error('blocked') } }), null)
  assert.doesNotThrow(() => clearFulfilHandoff({ removeItem: () => { throw new Error('blocked') } }))
})

test('each ordered line shows how many the sale holds and how many are still to add, and extras are named', () => {
  // CATCHES: counting only the first cart line of a product, a negative "to add" when the cashier sold more, and an extra product that is not shown.
  const status = lineStatus(handoff.lines, [{ productId: 1000, quantity: 1 }, { productId: 1000, quantity: 1 }, { productId: 1001, quantity: 0 }])
  assert.deepEqual(status, [{ product_id: 1000, ordered: 2, inSale: 2, missing: 0 }, { product_id: 1001, ordered: 1, inSale: 0, missing: 1 }])
  assert.deepEqual(lineStatus(handoff.lines, [{ productId: 1000, quantity: 5 }])[0], { product_id: 1000, ordered: 2, inSale: 5, missing: 0 })
  assert.deepEqual(lineStatus([{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }], []), [{ product_id: 1, ordered: 3, inSale: 0, missing: 3 }], 'a product ordered twice is one line')
  assert.deepEqual(extraLines(handoff.lines, [{ productId: 1000, quantity: 2 }, { productId: 9, quantity: 3 }, { productId: 8, quantity: 0 }]), [{ productId: 9, quantity: 3 }])
})

test('the online money covers the sale up to its total, and the difference is said as money the customer owes or is owed', () => {
  // CATCHES: a cover above the sale total (the Worker refuses online_tender_mismatch), a refund sentence for a balance, and float dust like 0.30000000000000004.
  assert.deepEqual(fulfilMoney(25, 25), { coverUsd: 25, balanceUsd: 0, backUsd: 0, kind: 'same' })
  assert.deepEqual(fulfilMoney(25, 30), { coverUsd: 25, balanceUsd: 5, backUsd: 0, kind: 'owe_more' })
  assert.deepEqual(fulfilMoney(25, 20), { coverUsd: 20, balanceUsd: 0, backUsd: 5, kind: 'refund_back' })
  assert.deepEqual(fulfilMoney(0.1 + 0.2, 0.3), { coverUsd: 0.3, balanceUsd: 0, backUsd: 0, kind: 'same' })
  assert.deepEqual(fulfilMoney(25, 0), { coverUsd: 0, balanceUsd: 0, backUsd: 25, kind: 'refund_back' }, 'an emptied basket covers nothing and the whole payment is owed back')
})

test('the online payment is exactly one row for the covered part: added, corrected, removed, and the cashier\'s own rows untouched', () => {
  // CATCHES: a second online row after every change, a row left behind when the basket empties, the cashier's balance row overwritten, and a new array every time (an effect loop).
  const cash = { id: 'payment-1', method: 'Cash', usd: '5.00', khr: '' }
  const first = withOnlineTender([cash], 'ABA KHQR', 25)
  assert.deepEqual(first, [{ id: ONLINE_TENDER_ROW_ID, method: 'ABA KHQR', usd: '25.00', khr: '' }, cash])
  assert.equal(withOnlineTender(first, 'ABA KHQR', 25), first, 'nothing to change returns the same array')
  assert.deepEqual(withOnlineTender(first, 'ABA KHQR', 20).map((row) => row.usd), ['20.00', '5.00'])
  assert.deepEqual(withOnlineTender(first, 'ABA KHQR', 0), [cash])
  assert.equal(withOnlineTender([cash], 'ABA KHQR', 0).length, 1)
  assert.equal(withOnlineTender(first, 'ABA KHQR', 0.1 + 0.2)[0].usd, '0.30')
  assert.equal(withOnlineTender(first, 'KHQR Pay', 25)[0].method, 'KHQR Pay', 'a renamed method is followed')
  assert.equal(withOnlineTender([{ ...first[0], khr: '4000' }, cash], 'ABA KHQR', 25)[0].khr, '', 'the online row is dollars only')
})

test('the sale carries the order id only when an order is being fulfilled', () => {
  assert.deepEqual(fulfilSaleFields(handoff), { online_order_id: 7 })
  assert.deepEqual(fulfilSaleFields(null), {})
  assert.deepEqual(fulfilSaleFields(undefined), {})
})

test('Through ABA is offered only where it can work: online money on the sale, the refund grant, a plain refund, and the cap is what was paid online', () => {
  // CATCHES: the option on every return (the Worker refuses with refund_channel_requires_online_order), on an exchange or a write-off, for someone without the grant, and a cap that includes cash rows.
  const rows = [{ method: 'Cash', amount_usd: 5 }, { method: 'aba khqr ', amount_usd: 20 }, { method: 'ABA KHQR', amount_usd: 0, refund_credit: true }]
  const base = { paymentDetails: rows, method: 'ABA KHQR', canRefund: true, creditUsd: 12.5, exchangeActive: false, returnType: 'refund' }
  assert.deepEqual(abaRefundOffer(base), { offered: true, capUsd: 20, amountUsd: 12.5, overCap: false })
  assert.equal(abaRefundOffer({ ...base, canRefund: false }).offered, false)
  assert.equal(abaRefundOffer({ ...base, paymentDetails: [{ method: 'Cash', amount_usd: 25 }] }).offered, false, 'a cash-only sale is never offered')
  assert.equal(abaRefundOffer({ ...base, exchangeActive: true }).offered, false)
  assert.equal(abaRefundOffer({ ...base, returnType: 'writeoff' }).offered, false)
  assert.equal(abaRefundOffer({ ...base, creditUsd: 0 }).offered, false)
  assert.deepEqual(abaRefundOffer({ ...base, creditUsd: 20.01 }), { offered: true, capUsd: 20, amountUsd: 20.01, overCap: true })
  assert.equal(abaRefundOffer({ ...base, creditUsd: 20 }).overCap, false, 'exactly the cap is allowed')
  assert.equal(abaRefundOffer({ ...base, paymentDetails: JSON.stringify(rows) }).capUsd, 20, 'rows may arrive as JSON text')
  assert.equal(onlineTenderUsd('not json', 'ABA KHQR'), 0)
  assert.equal(onlineTenderUsd(null, 'ABA KHQR'), 0)
  assert.equal(onlineMethodName({}), DEFAULT_ONLINE_METHOD)
  assert.equal(onlineMethodName({ online_order_payment_method: ' KHQR Pay ' }), 'KHQR Pay')
})
