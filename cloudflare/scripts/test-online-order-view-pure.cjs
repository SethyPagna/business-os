// KHQR S2: onlineOrderView and the refund-due money read (design A1.1, A1.5, A4). After a sale exists the order is READ from the sale:
// nothing is copied onto the order row, so a sale that is cancelled, returned, amended or undone changes the view and leaves the
// order row byte-identical. Each case names the plausible wrong implementation it would turn red on.
//
// Run: node scripts/test-online-order-view-pure.cjs
const assert = require('node:assert/strict')
const { loadTsLib } = require('./harness/load_ts_lib.cjs')
const O = loadTsLib('onlineOrders')

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

const order = (over = {}) => ({ id: 1, state: 'paid', goods_total_usd: 24.5, currency: 'USD', paid_at: '2026-11-09 08:00:00', created_at: '2026-11-09 07:50:00', ...over })
const orderPay = (over = {}) => ({ id: 1, state: 'paid', paid_amount: 24.5, purpose: 'order', ...over })
const topUp = (over = {}) => ({ id: 2, state: 'paid', paid_amount: 3, purpose: 'top_up', ...over })
const recorded = (paymentId, over = {}) => ({ event: 'payment_recorded_on_sale', payment_id: paymentId, sale_id: 9, ...over })
const noted = (amount, over = {}) => ({ event: 'refund_noted', amount_usd: amount, ...over })
const sale = (over = {}) => ({
  id: 9, sale_status: 'completed', total_usd: 24.5, amount_paid_usd: 24.5, amount_paid_khr: 0, change_usd: 0, change_khr: 0, exchange_rate: 4000,
  money_precision_version: 1, created_at: '2026-11-09 09:00:00', ...over,
})
const fulfilled = (over = {}) => order({ state: 'fulfilled', sale_id: 9, ...over })
const money = (o, payments, events, s, returns) => O.orderMoney(o, payments, events, s, returns)

// ---- Fulfil with other lines than the order (KHQR S6a, Q3) -------------------------------------------------------------------------
check('Fulfil with fewer lines: the sale takes only what it is worth, the rest is refundable through ABA and shrinks with each note (a build that counts the whole payment as recorded shows no refund)', () => {
  // order paid 24.5; the cashier rang 20, so the sale tender holds 20 and the event states 20
  const cheaper = sale({ total_usd: 20, amount_paid_usd: 20 })
  const m = money(fulfilled(), [orderPay()], [recorded(1, { amount_usd: 20 })], cheaper)
  assert.equal(m.recordedOnSaleUsd, 20); assert.equal(m.toRecordUsd, 4.5); assert.equal(m.refundDueUsd, 4.5)
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1, { amount_usd: 20 }), noted(4.5, { sale_id: 9 })], cheaper).refundDueUsd, 0)
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1, { amount_usd: 20 }), noted(1.5, { sale_id: 9 })], cheaper).refundDueUsd, 3)
  // an event with no stated amount (older rows) still means the whole payment was recorded
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1)], sale()).toRecordUsd, 0)
  // an event can never record more than the payment held
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1, { amount_usd: 99 })], sale()).recordedOnSaleUsd, 24.5)
})

check('Fulfil with extra lines: the extra is the normal balance due of the sale (Not Paid), nothing is refundable, and a paid top-up the sale still waits for is not refundable either', () => {
  const dearer = sale({ total_usd: 30, amount_paid_usd: 24.5, sale_status: 'awaiting_payment' })
  const m = money(fulfilled(), [orderPay()], [recorded(1, { amount_usd: 24.5 })], dearer)
  assert.equal(m.refundDueUsd, 0); assert.equal(m.balanceDueUsd, 5.5)
  // the customer paid a 3 top-up for part of the extra; until the cashier records it, the balance due still covers it
  const waiting = money(fulfilled(), [orderPay(), topUp()], [recorded(1, { amount_usd: 24.5 })], dearer)
  assert.equal(waiting.toRecordUsd, 3); assert.equal(waiting.refundDueUsd, 0)
  // a top-up larger than what the sale still owes: only the excess is refundable
  const tooMuch = money(fulfilled(), [orderPay(), topUp({ paid_amount: 8 })], [recorded(1, { amount_usd: 24.5 })], dearer)
  assert.equal(tooMuch.refundDueUsd, 2.5)
})

check('a CANCELLED linked sale: everything paid online is refundable, a paid top-up not yet recorded on the sale included, less ABA returns and notes', () => {
  const cancelledSale = sale({ sale_status: 'cancelled' })
  const m = money(fulfilled(), [orderPay(), topUp()], [recorded(1)], cancelledSale)
  assert.equal(m.refundDueUsd, 27.5, 'the top-up (3) was never recorded on the sale and is still owed to the customer')
  assert.equal(money(fulfilled(), [orderPay(), topUp()], [recorded(1), noted(10)], cancelledSale).refundDueUsd, 17.5)
})

// ---- before a sale ------------------------------------------------------------------------------------------------------------
check('awaiting payment: nothing in, nothing due; a QR that is only awaiting is not money', () => {
  const m = money(order({ state: 'awaiting_payment' }), [{ id: 1, state: 'awaiting', amount: 24.5 }], [], null)
  assert.deepEqual(m, { onlineInUsd: 0, heldInReviewUsd: 0, recordedOnSaleUsd: 0, toRecordUsd: 0, notedUsd: 0, refundedUsd: 0, availableUsd: 0, refundDueUsd: 0, balanceDueUsd: 0 })
})

check('paid, not fulfilled: refund due only for what exceeds the goods (an order lowered after payment); notes reduce it', () => {
  assert.equal(money(order(), [orderPay()], [], null).refundDueUsd, 0)
  const lowered = order({ goods_total_usd: 20 })
  assert.equal(money(lowered, [orderPay()], [], null).refundDueUsd, 4.5)
  assert.equal(money(lowered, [orderPay()], [noted(4.5)], null).refundDueUsd, 0)
  assert.equal(money(lowered, [orderPay()], [noted(2)], null).refundDueUsd, 2.5)
  // a top-up paid for an applied increase: goods rose to 27.5, both payments in -> nothing to refund
  assert.equal(money(order({ goods_total_usd: 27.5 }), [orderPay(), topUp()], [], null).refundDueUsd, 0)
})

check('cancelled before fulfilment: everything paid minus what was already noted, never negative', () => {
  const cancelled = order({ state: 'cancelled' })
  assert.equal(money(cancelled, [orderPay()], [], null).refundDueUsd, 24.5)
  assert.equal(money(cancelled, [orderPay(), topUp()], [], null).refundDueUsd, 27.5)
  assert.equal(money(cancelled, [orderPay()], [noted(10)], null).refundDueUsd, 14.5)
  assert.equal(money(cancelled, [orderPay()], [noted(24.5)], null).refundDueUsd, 0)
  assert.equal(money(cancelled, [orderPay()], [noted(30)], null).refundDueUsd, 0, 'a stale over-note never reads negative')
  assert.equal(money(order({ state: 'cancelled' }), [{ id: 1, state: 'expired', amount: 24.5 }], [], null).refundDueUsd, 0, 'an expired QR took no money')
})

check('refundNoteAllowed: a positive whole-cent amount no larger than what is due', () => {
  assert.equal(O.refundNoteAllowed(14.5, 14.5), true)
  assert.equal(O.refundNoteAllowed(0.01, 14.5), true)
  for (const [amount, due] of [[14.51, 14.5], [0, 14.5], [-1, 14.5], [0.005, 14.5], [1, 0], [NaN, 5], [5.001, 10]]) assert.equal(O.refundNoteAllowed(amount, due), false, `${amount}/${due}`)
})

// ---- after a sale: the sale is the truth --------------------------------------------------------------------------------------
check('fulfilled and covered: Completed, nothing owed, nothing to record, no chips', () => {
  const view = O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale())
  assert.equal(view.phase, 'after_sale')
  assert.equal(view.status, 'completed')
  assert.deepEqual(view.chips, [])
  assert.deepEqual(view.money, { onlineInUsd: 24.5, heldInReviewUsd: 0, recordedOnSaleUsd: 24.5, toRecordUsd: 0, notedUsd: 0, refundedUsd: 0, availableUsd: 24.5, refundDueUsd: 0, balanceDueUsd: 0 })
})

check('a delivery fee agreed at fulfilment makes the sale Not Paid for the fee only: Balance due, and the online money stays recorded', () => {
  const s = sale({ sale_status: 'awaiting_payment', total_usd: 27.5, amount_paid_usd: 24.5 })
  const view = O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], s)
  assert.equal(view.status, 'balance_due')
  assert.equal(view.money.balanceDueUsd, 3)
  assert.equal(view.money.refundDueUsd, 0, 'owing is not overpaying')
  assert.deepEqual(view.chips, ['balance_due'])
})

check('delivery pending reads from the sale tag, in every status spelling the sale can carry', () => {
  assert.equal(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale({ delivery_pending: 1 })).status, 'delivery_pending')
  assert.equal(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale({ sale_status: 'awaiting_delivery' })).status, 'delivery_pending', 'the retired label')
  assert.equal(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale({ delivery_pending: 0 })).status, 'completed')
})

check('a top-up paid on the order but not yet recorded by a cashier is TO RECORD, never refundable', () => {
  const s = sale({ sale_status: 'awaiting_payment', total_usd: 27.5, amount_paid_usd: 24.5 })
  const view = O.onlineOrderView(fulfilled(), [orderPay(), topUp()], [recorded(1)], s)
  assert.equal(view.money.toRecordUsd, 3)
  assert.equal(view.money.refundDueUsd, 0, 'counting the unrecorded top-up as an overpayment would offer a refund of money the sale still owes')
  assert.ok(view.chips.includes('to_record') && view.chips.includes('balance_due'))
  // once the cashier records it through the settlement writer, the sale is covered and nothing is left to record
  const settled = sale({ total_usd: 27.5, amount_paid_usd: 27.5 })
  const after = O.onlineOrderView(fulfilled(), [orderPay(), topUp()], [recorded(1), recorded(2)], settled)
  assert.deepEqual([after.status, after.money.toRecordUsd, after.money.balanceDueUsd, after.money.refundDueUsd, after.chips], ['completed', 0, 0, 0, []])
})

check('a sale amended DOWN after payment is an overpayment: Refund due, reduced by notes made after the sale', () => {
  const s = sale({ total_usd: 20 })
  const view = O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], s)
  assert.equal(view.money.refundDueUsd, 4.5)
  assert.deepEqual(view.chips, ['refund_due'])
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1), noted(4.5, { sale_id: 9 })], s).refundDueUsd, 0)
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1), noted(1.5, { sale_id: 9 })], s).refundDueUsd, 3)
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1), noted(4.5)], s).refundDueUsd, 0, 'a note made BEFORE the sale is money already sent back: it is subtracted, so the same dollars are never refunded twice (round 2, D1)')
})

check('change handed back is not an overpayment', () => {
  const s = sale({ amount_paid_usd: 30, change_usd: 5.5 })
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1)], s).refundDueUsd, 0)
  assert.equal(money(fulfilled(), [orderPay()], [recorded(1)], sale({ amount_paid_usd: 30 })).refundDueUsd, 5.5, 'without the change it would read as 5.50 over')
})

check('a cancelled sale: refund due is the online money, less returns already paid back (ABA, or cash out of the drawer past the cash tendered) and notes; cancelled returns do not count', () => {
  const cancelled = sale({ sale_status: 'cancelled' })
  const events = [recorded(1)]
  const view = O.onlineOrderView(fulfilled(), [orderPay()], events, cancelled)
  assert.equal(view.status, 'sale_cancelled')
  assert.equal(view.money.refundDueUsd, 24.5)
  assert.ok(view.chips.includes('refund_due'))
  const aba = { id: 1, status: 'completed', total_refund_usd: 5, owed_reduction_usd: 0, refund_channel: 'aba' }
  assert.equal(money(fulfilled(), [orderPay()], events, cancelled, [aba]).refundDueUsd, 19.5)
  assert.equal(money(fulfilled(), [orderPay()], events, cancelled, [{ ...aba, refund_channel: 'drawer' }]).refundDueUsd, 19.5, 'cash already handed over in the shop is not refunded again through ABA')
  assert.equal(money(fulfilled(), [orderPay()], events, cancelled, [{ ...aba, refund_channel: null }]).refundDueUsd, 19.5, 'NULL is the old drawer reading')
  const mixedSale = sale({ sale_status: 'cancelled', total_usd: 24.5, amount_paid_usd: 34.5 })
  const mixedEvents = [recorded(1, { amount_usd: 24.5 })]
  assert.equal(money(fulfilled(), [orderPay()], mixedEvents, mixedSale, [{ ...aba, refund_channel: null, total_refund_usd: 10 }]).refundDueUsd, 24.5, 'a cash return that fits in the cash tendered leaves the online money whole')
  assert.equal(money(fulfilled(), [orderPay()], mixedEvents, mixedSale, [{ ...aba, refund_channel: null, total_refund_usd: 12 }]).refundDueUsd, 22.5, 'only the part past the cash tendered came out of the online money')
  assert.equal(money(fulfilled(), [orderPay()], events, cancelled, [{ ...aba, status: 'cancelled' }]).refundDueUsd, 24.5, 'a cancelled return refunded nothing')
  assert.equal(money(fulfilled(), [orderPay()], [...events, noted(4)], cancelled, [aba]).refundDueUsd, 15.5)
  assert.equal(money(fulfilled(), [orderPay()], [...events, noted(24.5)], cancelled, []).refundDueUsd, 0)
})

check('returns: a partial return refunded through ABA leaves the sale covered; a Not Paid sale is lowered by the debt part first', () => {
  const completed = sale({ return_state: 'partial' })
  const aba = { id: 1, status: 'completed', total_refund_usd: 5, owed_reduction_usd: 0, refund_currency: 'USD', refund_channel: 'aba' }
  const view = O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], completed, [aba])
  assert.equal(view.status, 'completed')
  assert.equal(view.money.refundDueUsd, 0, 'the return itself carried the refund; the order must not offer it a second time')
  assert.deepEqual(view.chips, ['partly_returned'])
  // Not Paid for the $3 fee; a $5 return lowers that debt by 3 and refunds 2 in cash
  const owing = sale({ sale_status: 'awaiting_payment', total_usd: 27.5, amount_paid_usd: 24.5, return_state: 'partial' })
  const split = { ...aba, owed_reduction_usd: 3 }
  const v2 = O.orderMoney(fulfilled(), [orderPay()], [recorded(1)], owing, [split])
  assert.equal(v2.balanceDueUsd, 0, 'the debt part of the return paid off the fee')
  assert.equal(v2.refundDueUsd, 0)
  assert.equal(O.orderMoney(fulfilled(), [orderPay()], [recorded(1)], owing, []).balanceDueUsd, 3)
  assert.ok(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale({ return_state: 'full' }), [aba]).chips.includes('returned'))
  assert.ok(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale({ sale_status: 'returned', status_before_return: 'completed' }), [aba]).chips.includes('returned'), 'the retired returned label reads the same')
})

check('a return cancelled while its ABA refund stands raises the Check refund chip (read, never blocked); a drawer return does not', () => {
  const cancelledAba = { id: 1, status: 'cancelled', total_refund_usd: 5, owed_reduction_usd: 0, refund_channel: 'aba' }
  assert.ok(O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale(), [cancelledAba]).chips.includes('check_refund'))
  assert.ok(!O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale(), [{ ...cancelledAba, refund_channel: 'drawer' }]).chips.includes('check_refund'))
  assert.ok(!O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], sale(), [{ ...cancelledAba, status: 'completed' }]).chips.includes('check_refund'))
})

// Money PayWay took that did not match is still money: it is held on the payment, the money read counts it, and cancelling the order makes it refundable.
check('review money: $20 taken on a $25 order is held, counted, and refundable on cancel (a build that counts only paid rows reads 0)', () => {
  const review = { id: 1, state: 'review', amount: 25, paid_amount: 20 }
  const held = money(order({ state: 'review', goods_total_usd: 25 }), [review], [], null)
  assert.equal(held.heldInReviewUsd, 20); assert.equal(held.onlineInUsd, 0); assert.equal(held.refundDueUsd, 0, 'short of the goods: nothing is due while the order is open')
  assert.equal(money(order({ state: 'cancelled', goods_total_usd: 25 }), [review], [], null).refundDueUsd, 20)
  assert.equal(money(order({ state: 'cancelled', goods_total_usd: 25 }), [review], [noted(5)], null).refundDueUsd, 15)
  assert.equal(money(order({ state: 'review', goods_total_usd: 25 }), [{ id: 1, state: 'review', amount: 25, paid_amount: 30 }], [], null).refundDueUsd, 5, 'an over-payment is refundable before anything else happens')
  assert.equal(money(order({ state: 'cancelled', goods_total_usd: 25 }), [{ id: 1, state: 'review', amount: 25 }], [], null).refundDueUsd, 0, 'a review row that never stored an amount holds nothing we can name')
  assert.equal(money(order({ state: 'cancelled', goods_total_usd: 25 }), [review, { id: 2, state: 'paid', amount: 25, paid_amount: 25 }], [], null).refundDueUsd, 45, 'held money adds to paid money')
})

check('the needs-review chip follows the money, not only the order state: a mismatched top-up on a paid order, and a payment on a cancelled QR, both raise it', () => {
  const topUpReview = { id: 2, state: 'review', amount: 3, paid_amount: 2, purpose: 'top_up' }
  assert.ok(O.onlineOrderView(order({ state: 'paid' }), [orderPay(), topUpReview], [], null).chips.includes('needs_review'))
  assert.ok(O.onlineOrderView(order({ state: 'cancelled' }), [{ id: 1, state: 'review', amount: 24.5, paid_amount: 24.5 }], [], null).chips.includes('needs_review'))
  assert.ok(!O.onlineOrderView(order({ state: 'paid' }), [orderPay()], [], null).chips.includes('needs_review'))
  assert.ok(O.onlineOrderView(fulfilled(), [orderPay(), topUpReview], [], sale()).chips.includes('needs_review'), 'after the sale too')
})

check('chips before a sale: review, late payment, pending and accepted-not-applied requests', () => {
  assert.deepEqual(O.onlineOrderView(order({ state: 'review' }), [{ id: 1, state: 'review', amount: 24.5 }], [], null).chips, ['needs_review'])
  assert.ok(O.onlineOrderView(order(), [orderPay()], [{ event: 'late_paid' }], null).chips.includes('late'))
  const requests = [{ id: 1, kind: 'address', stage: 'paid' }, { id: 2, kind: 'note', stage: 'paid' }]
  const view = O.onlineOrderView(order(), [orderPay()], [{ event: 'request_accepted', request_id: 2 }], null, [], { requests })
  assert.ok(view.chips.includes('request_pending') && view.chips.includes('accepted_not_applied'))
  const quiet = O.onlineOrderView(order(), [orderPay()], [{ event: 'request_rejected', request_id: 1 }, { event: 'request_rejected', request_id: 2 }], null, [], { requests })
  assert.ok(!quiet.chips.includes('request_pending'))
})

check('requestsOpen follows the window setting and the stage', () => {
  const now = new Date(Date.UTC(2026, 10, 12, 8, 0, 0))
  assert.equal(O.onlineOrderView(order(), [orderPay()], [], null, [], { now, requestWindowDays: 7 }).requestsOpen, true)
  assert.equal(O.onlineOrderView(order(), [orderPay()], [], null, [], { now, requestWindowDays: 2 }).requestsOpen, false)
  assert.equal(O.onlineOrderView(order({ state: 'awaiting_payment' }), [], [], null, [], { now }).requestsOpen, false)
  assert.equal(O.onlineOrderView(order(), [orderPay()], [], null, [], {}).requestsOpen, false, 'no clock, no claim')
})

// ---- the central design claim -------------------------------------------------------------------------------------------------
check('the order row is never written to follow the sale: one frozen order, five sale states, five views', () => {
  const row = Object.freeze(order({ state: 'fulfilled', sale_id: 9 }))
  const before = JSON.stringify(row)
  const states = {
    completed: sale(), balance_due: sale({ sale_status: 'awaiting_payment', total_usd: 27.5 }), sale_cancelled: sale({ sale_status: 'cancelled' }),
    delivery_pending: sale({ delivery_pending: 1 }), returned: sale({ return_state: 'full' }),
  }
  const seen = Object.fromEntries(Object.entries(states).map(([name, s]) => [name, O.onlineOrderView(row, [orderPay()], [recorded(1)], s).status]))
  assert.deepEqual(seen, { completed: 'completed', balance_due: 'balance_due', sale_cancelled: 'sale_cancelled', delivery_pending: 'delivery_pending', returned: 'completed' })
  assert.equal(JSON.stringify(row), before, 'the order object is untouched')
  // undo of the cancel: the same inputs as before the cancel give the same view again
  assert.deepEqual(O.onlineOrderView(row, [orderPay()], [recorded(1)], sale()), O.onlineOrderView(row, [orderPay()], [recorded(1)], sale()))
  assert.notDeepEqual(O.onlineOrderView(row, [orderPay()], [recorded(1)], sale({ sale_status: 'cancelled' })), O.onlineOrderView(row, [orderPay()], [recorded(1)], sale()))
})

check('an unreadable sale never throws the view: the debt reads as 0 and the rest still answers', () => {
  const broken = sale({ sale_status: 'awaiting_payment', total_usd: null })
  const view = O.onlineOrderView(fulfilled(), [orderPay()], [recorded(1)], broken)
  assert.equal(view.status, 'balance_due')
  assert.equal(view.money.balanceDueUsd, 0)
})

console.log(`\n${passed} checks passed`)
