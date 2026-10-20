'use strict'
// AL-D (Requirement gap D, brief 2026-10-12 section 5; re-admitted 20 Oct
// 2026, lane 6.0.872): a return on a Not Paid sale, then settlement, against
// the WHOLE Worker on workerd + D1.
//
// Owner rules (29 Sep, re-confirmed 5 and 6 Oct 2026): a return on a Not Paid
// sale LOWERS THE DEBT, no cash leaves the drawer, and the sale STAYS Not Paid
// until the rest is paid ($10 Not Paid, $4 returned -> owes $6, drawer pays
// out nothing). Paying the $6 then settles it, exactly once, under replay.
// The return state is a tag beside the payment state, never instead of it.
// Partial payment: $10 with $3 paid owes $7; a $4 return leaves $3 owed and
// refunds $0; a return worth more than the debt refunds only the excess.
//
// Money half (lane 6.0.884, migration 0260): total_refund_usd stays the
// return value (revenue, pinned by the 0158 money-precision trigger);
// owed_reduction_usd is the debt the return lowered and the rest is the cash
// refund, which is all the shift drawer pays out -- in riel when the till
// refunds in riel. Every check fails the run.
//
// Harness: test-al-money-c-native.cjs (real src/index.ts, every migration,
// real login, D1 counted per request). AL_MUTATION=1 runs the negative
// control: the same first sale WITHOUT the return must settle at $10.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const mutation = process.env.AL_MUTATION === '1'
  const r = H.recorder(mutation ? 'AL-D [control: no return, owes $10]' : 'AL-D')
  const money = (name, fn) => r.check(`(money half) ${name}`, fn)
  try {
    await H.seedProduct(h, 201, 'AL-D Lipstick', 2, 50)
    // A drawer to observe: the administrator is not shift-exempt here.
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 0 }, 'D open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))

    const saleRow = async (id) => (await h.call('GET', H.fresh('/api/sales?limit=50'), undefined, 'D sales list', { observe: true })).body.find(row => Number(row.id) === Number(id))
    const notPaidIds = async () => (await h.call('GET', H.fresh('/api/sales?status=awaiting_payment&limit=50'), undefined, 'D Not Paid list', { observe: true })).body.map(row => Number(row.id))
    // The open-shift window ends at the current second, EXCLUSIVE
    // (salesAnalytics.ts shiftWindowWhere), so a record written in this second
    // is not in the drawer yet. Wait past the second boundary before reading.
    const drawer = async () => {
      await new Promise(resolve => setTimeout(resolve, 1100))
      return (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'D shift drawer', { observe: true })).body.shift.reconciliation
    }
    // Balance due as the owner defines it (6 Oct): the sale's total less its
    // refunds less what was paid -- read from the list's own projected fields.
    const owed = row => Number((Number(row.net_total_usd) - Number(row.amount_paid_usd)).toFixed(4))
    // payment_details is the sale's FULL tender snapshot: what was already paid, then the new payment.
    const settle = (saleId, key, usd, label, alreadyPaidUsd = 0) => h.call('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: key,
      expected_exchange_rate: 4000, payment_details: [...(alreadyPaidUsd ? [{ method: 'Cash', amount_usd: alreadyPaidUsd, amount_khr: 0 }] : []), { method: 'Cash', amount_usd: usd, amount_khr: 0 }] }, label)
    // The cash part of the sale's latest return: its value less the debt it lowered.
    const refundStored = async (saleId) => {
      const row = await h.one('SELECT total_refund_usd,owed_reduction_usd FROM returns WHERE sale_id=? ORDER BY id DESC LIMIT 1', saleId)
      return Number((Number(row.total_refund_usd) - Number(row.owed_reduction_usd)).toFixed(4))
    }

    // Sale 1: Not Paid, 5 x $2 = $10, nothing tendered.
    const sale = await H.createSale(h, { key: 'al-d-sale', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }], label: 'D create Not Paid $10 sale' })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    const saleId = sale.body.id
    const itemId = sale.body.sale.items[0].id
    const drawerBefore = await drawer()

    if (!mutation) {
      const returned = await H.customerReturn(h, { key: 'al-d-return', saleId, lines: [{ saleItemId: itemId, productId: 201, quantity: 2 }], label: 'D return 2 of 5 ($4)' })
      r.check(`fixture: the $4 partial return is recorded (quote ${returned.quote.status}, create ${returned.created && returned.created.status})`, () => {
        assert.equal(returned.quote.status, 200)
        assert.equal(returned.quote.body.total_refund_usd, 4)
        assert.equal(returned.created.status, 200, JSON.stringify(returned.created.body))
      })
    }
    const afterReturn = await saleRow(saleId)
    const drawerAfter = await drawer()
    const stored = await h.one('SELECT sale_status,status_before_return,amount_paid_usd,amount_paid_khr,payment_details FROM sales WHERE id=?', saleId)

    r.check(`tender is untouched by the return (paid $${afterReturn.amount_paid_usd} / ${afterReturn.amount_paid_khr}៛, details ${stored.payment_details})`, () => {
      assert.equal(Number(afterReturn.amount_paid_usd), 0)
      assert.equal(Number(afterReturn.amount_paid_khr), 0)
      assert.deepEqual(JSON.parse(stored.payment_details || '[]'), [])
    })
    r.check(`the return lowers the debt: balance due $${owed(afterReturn)} (owner: $6)`, () => {
      assert.equal(owed(afterReturn), mutation ? 10 : 6)
    })
    money(`no cash leaves the drawer: refunds $${drawerAfter.refunds && drawerAfter.refunds.usd}, expected cash $${drawerAfter.expected && drawerAfter.expected.usd} (before $${drawerBefore.expected && drawerBefore.expected.usd})`, () => {
      assert.equal(Number(drawerAfter.refunds.usd), 0, 'a Not Paid return pays nothing out of the drawer')
      assert.equal(Number(drawerAfter.expected.usd), Number(drawerBefore.expected.usd), 'expected drawer cash must not move')
    })
    const notPaid = await notPaidIds()
    r.check(`the sale stays in Not Paid until the rest is paid (status ${stored.sale_status}, before-return ${stored.status_before_return}; in Not Paid list: ${notPaid.includes(saleId)})`, () => {
      assert.ok(notPaid.includes(saleId), 'GET /api/sales?status=awaiting_payment must still list the sale')
    })
    if (!mutation) {
      const returnList = (await h.call('GET', H.fresh('/api/sales?status=partial_return&limit=50'), undefined, 'D Partial return list', { observe: true })).body.map(row => Number(row.id))
      r.check(`the return ribbon stays beside the payment state (in Partial return list: ${returnList.includes(saleId)})`, () => {
        assert.ok(returnList.includes(saleId))
      })
    }

    // Short tender: $5.99 against the $6 debt must be refused as short
    // (insufficient_payment), not for being a "return-managed" sale.
    const short = await settle(saleId, 'al-d-short', mutation ? 9.99 : 5.99, 'D settle short')
    r.check(`a short tender is refused as short (got ${short.status} ${short.body.code || ''} ${String(short.body.error || '').slice(0, 90)})`, () => {
      assert.equal(short.status, 400)
      assert.equal(short.body.code, 'insufficient_payment')
    })

    // Settle the reduced debt: exactly $6 (control: $10).
    const due = mutation ? 10 : 6
    const settled = await settle(saleId, 'al-d-settle', due, `D settle $${due}`)
    const afterSettle = await saleRow(saleId)
    const settledState = await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', saleId)
    r.check(`paying the remaining $${due} settles the sale (got ${settled.status} ${String(settled.body.error || '').slice(0, 110)}; status ${settledState.sale_status}/${settledState.status_before_return})`, () => {
      assert.equal(settled.status, 200)
      assert.equal(Number(afterSettle.amount_paid_usd), due, 'the tender recorded is exactly what was paid')
      assert.equal(Number(afterSettle.change_usd || 0), 0, 'no change is handed back on an exact payment')
      assert.equal(owed(afterSettle), 0)
      assert.ok(!(readsAsNotPaid(afterSettle)), 'a settled sale is no longer Not Paid')
      if (!mutation) assert.deepEqual(settledState, { sale_status: 'partial_return', status_before_return: 'completed' }, 'the return status stays; only the payment state moves')
    })
    const replay = await settle(saleId, 'al-d-settle', due, 'D settle replay')
    const afterReplay = await saleRow(saleId)
    r.check(`replaying the same settlement is idempotent (got ${replay.status}; paid $${afterReplay.amount_paid_usd})`, () => {
      assert.equal(settled.status, 200, 'not evaluable: the first settlement never succeeded')
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.body, settled.body)
      assert.equal(Number(afterReplay.amount_paid_usd), due, 'a replay must not take the payment twice')
    })
    const drawerSettled = await drawer()
    money(`the drawer receives exactly the $${due} paid (cash sales $${drawerSettled.cash_sales && drawerSettled.cash_sales.usd}, refunds $${drawerSettled.refunds && drawerSettled.refunds.usd})`, () => {
      assert.equal(Number(drawerSettled.expected.usd), Number(drawerBefore.expected.usd) + due)
    })

    if (!mutation) {
      // Settlement Undo / Redo (SALE_SETTLEMENT_ACTION_KIND) restores and
      // re-applies the payment state beside the unchanged return status.
      const historyId = Number(settled.body.actionHistoryId)
      const undo = await H.historyStep(h, historyId, 'undo', 0, 'D undo settlement')
      const undone = await h.one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=?', saleId)
      const notPaidAfterUndo = await notPaidIds()
      r.check(`undoing the settlement puts the sale back to Not Paid with its return (got ${undo.status}; ${JSON.stringify(undone)}; in Not Paid list: ${notPaidAfterUndo.includes(saleId)})`, () => {
        assert.equal(undo.status, 200, JSON.stringify(undo.body).slice(0, 200))
        assert.deepEqual({ ...undone, amount_paid_usd: Number(undone.amount_paid_usd) }, { sale_status: 'partial_return', status_before_return: 'awaiting_payment', amount_paid_usd: 0 })
        assert.ok(notPaidAfterUndo.includes(saleId))
      })
      const redo = await H.historyStep(h, historyId, 'redo', 1, 'D redo settlement')
      const redone = await h.one('SELECT sale_status,status_before_return,amount_paid_usd FROM sales WHERE id=?', saleId)
      r.check(`redoing it settles again (got ${redo.status}; ${JSON.stringify(redone)})`, () => {
        assert.equal(redo.status, 200, JSON.stringify(redo.body).slice(0, 200))
        assert.deepEqual({ ...redone, amount_paid_usd: Number(redone.amount_paid_usd) }, { sale_status: 'partial_return', status_before_return: 'completed', amount_paid_usd: 6 })
      })

      // Sale 2: the return is cancelled, then restored, before settlement.
      const second = await H.createSale(h, { key: 'al-d-sale-2', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }], label: 'D create second Not Paid $10 sale' })
      const secondReturn = await H.customerReturn(h, { key: 'al-d-return-2', saleId: second.body.id,
        lines: [{ saleItemId: second.body.sale.items[0].id, productId: 201, quantity: 2 }], label: 'D second return ($4)' })
      const returnId = Number(secondReturn.created.body.id)
      const cancel = await H.bulkReturnStatus(h, 'al-d-cancel', returnId, 'completed', 'cancelled', 'D cancel the return')
      const afterCancel = await saleRow(second.body.id)
      const cancelledState = await h.one('SELECT sale_status FROM sales WHERE id=?', second.body.id)
      r.check(`cancelling the return restores the whole $10 debt and the Not Paid status (got ${cancel.status}; owes $${owed(afterCancel)}, status ${cancelledState.sale_status})`, () => {
        assert.equal(cancel.status, 200, JSON.stringify(cancel.body).slice(0, 200))
        assert.equal(owed(afterCancel), 10)
        assert.equal(cancelledState.sale_status, 'awaiting_payment')
      })
      const restore = await H.bulkReturnStatus(h, 'al-d-restore', returnId, 'cancelled', 'completed', 'D restore the return')
      const afterRestore = await saleRow(second.body.id)
      const notPaidAfterRestore = await notPaidIds()
      r.check(`restoring the return lowers the debt to $6 again and keeps it Not Paid (got ${restore.status}; owes $${owed(afterRestore)}; in Not Paid list: ${notPaidAfterRestore.includes(second.body.id)})`, () => {
        assert.equal(restore.status, 200, JSON.stringify(restore.body).slice(0, 200))
        assert.equal(owed(afterRestore), 6)
        assert.ok(notPaidAfterRestore.includes(second.body.id))
      })

      // Sale 3 (owner partial-payment rule): $10, $3 paid -> owes $7; a $4
      // return leaves $3 owed, refunds $0 and moves no drawer cash.
      const third = await H.createSale(h, { key: 'al-d-sale-3', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 3, amount_khr: 0 }], label: 'D create Not Paid $10 sale, $3 paid' })
      assert.equal(third.status, 200, JSON.stringify(third.body).slice(0, 300))
      const thirdId = third.body.id
      const drawerBeforeThird = await drawer()
      const thirdReturn = await H.customerReturn(h, { key: 'al-d-return-3', saleId: thirdId,
        lines: [{ saleItemId: third.body.sale.items[0].id, productId: 201, quantity: 2 }], label: 'D third return ($4 on $7 owed)' })
      const afterThirdReturn = await saleRow(thirdId)
      const drawerAfterThird = await drawer()
      r.check(`partial payment: a $4 return on $7 owed leaves $3 owed and the sale Not Paid (create ${thirdReturn.created && thirdReturn.created.status}; owes $${owed(afterThirdReturn)})`, () => {
        assert.equal(thirdReturn.created.status, 200, JSON.stringify(thirdReturn.created.body))
        assert.equal(owed(afterThirdReturn), 3)
        assert.ok(readsAsNotPaid(afterThirdReturn))
      })
      const thirdRefund = Number(await refundStored(thirdId))
      money(`partial payment: the return refunds $0 in cash (cash part ${thirdRefund})`, () => {
        assert.equal(thirdRefund, 0)
      })
      money(`partial payment: drawer unchanged by the return (expected $${drawerAfterThird.expected.usd}, before $${drawerBeforeThird.expected.usd})`, () => {
        assert.equal(Number(drawerAfterThird.expected.usd), Number(drawerBeforeThird.expected.usd))
      })
      const thirdShort = await settle(thirdId, 'al-d-settle-3-short', 2.99, 'D settle third short', 3)
      const thirdSettle = await settle(thirdId, 'al-d-settle-3', 3, 'D settle third $3', 3)
      const thirdReplay = await settle(thirdId, 'al-d-settle-3', 3, 'D settle third replay', 3)
      const afterThirdSettle = await saleRow(thirdId)
      r.check(`partial payment: $2.99 is short, $3 settles, the replay is identical (got ${thirdShort.status} ${thirdShort.body.code || ''} / ${thirdSettle.status} ${String(thirdSettle.body.error || '').slice(0, 90)} / ${thirdReplay.status}; paid $${afterThirdSettle.amount_paid_usd})`, () => {
        assert.equal(thirdShort.status, 400)
        assert.equal(thirdShort.body.code, 'insufficient_payment')
        assert.equal(thirdSettle.status, 200)
        assert.equal(thirdReplay.status, 200)
        assert.deepEqual(thirdReplay.body, thirdSettle.body)
        assert.equal(Number(afterThirdSettle.amount_paid_usd), 6)
        assert.equal(Number(afterThirdSettle.change_usd || 0), 0)
        assert.equal(owed(afterThirdSettle), 0)
        assert.ok(!readsAsNotPaid(afterThirdSettle))
      })

      // Sale 4: $10 with $7 paid owes $3; a $4 return refunds only the $1 excess.
      const fourth = await H.createSale(h, { key: 'al-d-sale-4', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 7, amount_khr: 0 }], label: 'D create Not Paid $10 sale, $7 paid' })
      assert.equal(fourth.status, 200, JSON.stringify(fourth.body).slice(0, 300))
      const fourthId = fourth.body.id
      const drawerBeforeFourth = await drawer()
      const fourthReturn = await H.customerReturn(h, { key: 'al-d-return-4', saleId: fourthId,
        lines: [{ saleItemId: fourth.body.sale.items[0].id, productId: 201, quantity: 2 }], label: 'D fourth return ($4 on $3 owed)' })
      const afterFourthReturn = await saleRow(fourthId)
      const drawerAfterFourth = await drawer()
      r.check(`over the debt: the $4 return is recorded and nothing is owed (create ${fourthReturn.created && fourthReturn.created.status}; owes $${Math.max(0, owed(afterFourthReturn))})`, () => {
        assert.equal(fourthReturn.created.status, 200, JSON.stringify(fourthReturn.created.body))
        assert.equal(Math.max(0, owed(afterFourthReturn)), 0)
      })
      const fourthRefund = Number(await refundStored(fourthId))
      money(`over the debt: only the $1 excess is refunded in cash (cash part $${fourthRefund}; drawer refunds moved $${(Number(drawerAfterFourth.refunds.usd) - Number(drawerBeforeFourth.refunds.usd)).toFixed(2)})`, () => {
        assert.equal(fourthRefund, 1)
        assert.equal(Number((Number(drawerAfterFourth.refunds.usd) - Number(drawerBeforeFourth.refunds.usd)).toFixed(2)), 1)
      })
      money(`over the debt: a sale whose debt the return cleared leaves Not Paid (status ${JSON.stringify(await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', fourthId))})`, () => {
        assert.ok(!readsAsNotPaid(afterFourthReturn))
      })

      // Cancelling that return brings the $3 debt back (and the $1 back into
      // the drawer); restoring it splits the refund again against the sale as
      // it stands; undoing the restore puts the cancel back exactly.
      const fourthReturnId = Number(fourthReturn.created.body.id)
      const fourthCancel = await H.bulkReturnStatus(h, 'al-d-cancel-4', fourthReturnId, 'completed', 'cancelled', 'D cancel the over-debt return')
      const afterFourthCancel = await saleRow(fourthId)
      const drawerAfterFourthCancel = await drawer()
      money(`cancelling the over-debt return brings the $3 debt back and the $1 back into the drawer (got ${fourthCancel.status}; owes $${owed(afterFourthCancel)}; ${afterFourthCancel.sale_status}/${afterFourthCancel.status_before_return})`, () => {
        assert.equal(fourthCancel.status, 200, JSON.stringify(fourthCancel.body).slice(0, 200))
        assert.equal(owed(afterFourthCancel), 3)
        assert.ok(readsAsNotPaid(afterFourthCancel))
        assert.equal(Number(drawerAfterFourthCancel.expected.usd), Number(drawerBeforeFourth.expected.usd))
      })
      const fourthRestore = await H.bulkReturnStatus(h, 'al-d-restore-4', fourthReturnId, 'cancelled', 'completed', 'D restore the over-debt return')
      const afterFourthRestore = await saleRow(fourthId)
      const restoredMoney = await h.one('SELECT owed_reduction_usd,refund_currency FROM returns WHERE id=?', fourthReturnId)
      money(`restoring it lowers the $3 debt and refunds $1 again, and the sale reads paid (got ${fourthRestore.status}; ${JSON.stringify(restoredMoney)}; ${afterFourthRestore.sale_status}/${afterFourthRestore.status_before_return})`, () => {
        assert.equal(fourthRestore.status, 200, JSON.stringify(fourthRestore.body).slice(0, 200))
        assert.deepEqual({ ...restoredMoney, owed_reduction_usd: Number(restoredMoney.owed_reduction_usd) }, { owed_reduction_usd: 3, refund_currency: 'USD' })
        assert.ok(!readsAsNotPaid(afterFourthRestore))
      })
      const restoreUndo = await H.historyStep(h, Number(fourthRestore.body.actionHistoryId), 'undo', 0, 'D undo the restore')
      const afterRestoreUndo = await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', fourthId)
      money(`undoing the restore cancels it again and the sale owes $3 Not Paid (got ${restoreUndo.status}; ${JSON.stringify(afterRestoreUndo)})`, () => {
        assert.equal(restoreUndo.status, 200, JSON.stringify(restoreUndo.body).slice(0, 200))
        assert.deepEqual(afterRestoreUndo, { sale_status: 'awaiting_payment', status_before_return: 'awaiting_payment' })
      })
      const restoreRedo = await H.historyStep(h, Number(fourthRestore.body.actionHistoryId), 'redo', 1, 'D redo the restore')
      const afterRestoreRedo = await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', fourthId)
      money(`redoing the restore clears the debt again (got ${restoreRedo.status}; ${JSON.stringify(afterRestoreRedo)})`, () => {
        assert.equal(restoreRedo.status, 200, JSON.stringify(restoreRedo.body).slice(0, 200))
        assert.deepEqual(afterRestoreRedo, { sale_status: 'partial_return', status_before_return: 'completed' })
      })

      // Riel tender (owner, 29 Sep 2026): $10 with $7 paid, $4 returned and
      // refunded in riel -- $3 lowers the debt, the $1 cash leaves the riel
      // drawer as its share of the return's riel figure (16,000 x 1/4).
      const sixth = await H.createSale(h, { key: 'al-d-sale-6', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 7, amount_khr: 0 }], label: 'D create Not Paid $10 sale, $7 paid (riel refund)' })
      assert.equal(sixth.status, 200, JSON.stringify(sixth.body).slice(0, 300))
      const sixthItem = sixth.body.sale.items[0].id
      const rielQuote = await h.call('POST', '/api/returns/quote', { sale_id: sixth.body.id, items: [{ sale_item_id: sixthItem, quantity: 2 }] }, 'quote D riel return')
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...rielExpected } = rielQuote.body
      const rielBody = (currency) => ({ client_request_id: 'al-d-return-6', money_precision_version: 1, sale_id: sixth.body.id, reason: 'AL money probe',
        expected_quote: rielExpected, refund_currency: currency, items: [{ sale_item_id: sixthItem, product_id: 201, quantity: 2, stock_action: 'restock', branch_id: 1 }] })
      const drawerBeforeSixth = await drawer()
      const rielReturn = await h.call('POST', '/api/returns', rielBody('KHR'), 'D riel return ($4 on $3 owed, $1 cash in riel)')
      const rielReplay = await h.call('POST', '/api/returns', rielBody('KHR'), 'D riel return replay')
      const rielChanged = await h.call('POST', '/api/returns', rielBody('USD'), 'D same request id refunded in dollars')
      const drawerAfterSixth = await drawer()
      const rielRow = await h.one('SELECT total_refund_usd,total_refund_khr,owed_reduction_usd,refund_currency FROM returns WHERE sale_id=?', sixth.body.id)
      money(`riel refund: $3 lowers the debt and the $1 cash leaves the riel drawer (create ${rielReturn.status}; row ${JSON.stringify(rielRow)}; drawer refunds $${drawerAfterSixth.refunds.usd} / ${drawerAfterSixth.refunds.khr}៛)`, () => {
        assert.equal(rielReturn.status, 200, JSON.stringify(rielReturn.body).slice(0, 200))
        assert.deepEqual({ ...rielRow, total_refund_usd: Number(rielRow.total_refund_usd), total_refund_khr: Number(rielRow.total_refund_khr), owed_reduction_usd: Number(rielRow.owed_reduction_usd) },
          { total_refund_usd: 4, total_refund_khr: 16000, owed_reduction_usd: 3, refund_currency: 'KHR' })
        assert.equal(Number(drawerAfterSixth.refunds.khr) - Number(drawerBeforeSixth.refunds.khr), 4000)
        assert.equal(Number(drawerAfterSixth.refunds.usd), Number(drawerBeforeSixth.refunds.usd), 'a riel refund takes no dollars')
        assert.equal(Number(drawerAfterSixth.expected.usd), Number(drawerBeforeSixth.expected.usd))
        assert.equal(Number(drawerAfterSixth.expected.khr), Number(drawerBeforeSixth.expected.khr) - 4000)
      })
      money(`riel refund: the currency is part of the request (replay ${rielReplay.status}, same id in dollars ${rielChanged.status} ${rielChanged.body.code || ''})`, () => {
        assert.equal(rielReplay.status, 200)
        assert.deepEqual(rielReplay.body, rielReturn.body)
        assert.equal(rielChanged.status, 409)
        assert.equal(rielChanged.body.code, 'idempotency_conflict')
      })
      const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
      const report = await h.call('GET', H.fresh(`/api/returns/report?startDate=${today}&endDate=${today}`), undefined, 'D returns report', { observe: true })
      money(`returns report carries the riel paid out (cash refunds $${report.body.totals && report.body.totals.cash_refund_usd} / ${report.body.totals && report.body.totals.cash_refund_khr}៛, return value $${report.body.totals && report.body.totals.refund_usd})`, () => {
        assert.equal(report.status, 200)
        assert.equal(report.body.totals.cash_refund_khr, 4000)
      })

      // The Sales page group action (POST /api/sales/bulk-status) reads the
      // same payment state: a sale whose returns left it still owing is
      // refused as unpaid; one whose tender covers what is left is marked
      // paid beside its return status, and its Undo puts it back to Not Paid.
      const bulk = (key, sale, label) => h.call('POST', '/api/sales/bulk-status', { client_request_id: key, source_status: 'awaiting_payment', target_status: 'completed',
        items: [{ id: Number(sale.id), expected_status: sale.sale_status, expected_updated_at: sale.updated_at ?? null }] }, label)
      const owing = await bulk('al-d-bulk-owing', afterRestore, 'D group-complete a sale still owing $6')
      r.check(`group status refuses a returned Not Paid sale that still owes (got ${owing.status} ${owing.body.code || ''})`, () => {
        assert.equal(owing.status, 400, JSON.stringify(owing.body).slice(0, 200))
        assert.equal(owing.body.code, 'insufficient_payment_for_status')
      })
      const fifth = await H.createSale(h, { key: 'al-d-sale-5', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 6, amount_khr: 0 }], label: 'D create Not Paid $10 sale, $6 paid' })
      assert.equal(fifth.status, 200, JSON.stringify(fifth.body).slice(0, 300))
      await H.customerReturn(h, { key: 'al-d-return-5', saleId: fifth.body.id,
        lines: [{ saleItemId: fifth.body.sale.items[0].id, productId: 201, quantity: 2 }], label: 'D fifth return ($4 clears the $4 owed)' })
      // A return worth exactly the debt moves no money: nothing is owed, no
      // cash leaves, and the sale stays Not Paid until it is marked paid.
      const clearedRow = await saleRow(fifth.body.id)
      const fifthCash = Number(await refundStored(fifth.body.id))
      money(`a return worth exactly the debt clears it with no cash and leaves it to be marked paid (cash part $${fifthCash}; owes $${owed(clearedRow)}; ${clearedRow.sale_status}/${clearedRow.status_before_return})`, () => {
        assert.equal(fifthCash, 0)
        assert.equal(owed(clearedRow), 0)
        assert.ok(readsAsNotPaid(clearedRow))
      })
      const covered = await bulk('al-d-bulk-covered', await saleRow(fifth.body.id), 'D group-complete a covered returned Not Paid sale')
      const coveredState = await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', fifth.body.id)
      r.check(`group status marks a covered returned Not Paid sale paid beside its return (got ${covered.status}; ${JSON.stringify(coveredState)}; receipt ${JSON.stringify(covered.body.items)})`, () => {
        assert.equal(covered.status, 200, JSON.stringify(covered.body).slice(0, 200))
        assert.equal(covered.body.changedCount, 1)
        assert.deepEqual(coveredState, { sale_status: 'partial_return', status_before_return: 'completed' })
        assert.equal(covered.body.items[0].before, 'awaiting_payment')
        assert.equal(covered.body.items[0].after, 'completed')
      })
      const bulkUndo = await H.historyStep(h, Number(covered.body.actionHistoryId), 'undo', 0, 'D undo the group status')
      const bulkUndone = await h.one('SELECT sale_status,status_before_return FROM sales WHERE id=?', fifth.body.id)
      r.check(`undoing the group status puts it back to Not Paid (got ${bulkUndo.status}; ${JSON.stringify(bulkUndone)})`, () => {
        assert.equal(bulkUndo.status, 200, JSON.stringify(bulkUndo.body).slice(0, 200))
        assert.deepEqual(bulkUndone, { sale_status: 'partial_return', status_before_return: 'awaiting_payment' })
      })
    }

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-D unpaid return then settlement: ${r.results.length - failed.length}/${r.results.length} checks hold${mutation ? ' (AL_MUTATION=1 control run, no return)' : ''}`)
  if (failed.length) process.exitCode = 1
}

// A settled sale reads as paid in the list: status completed (or a return
// status whose retained payment state is completed), never awaiting_payment.
function readsAsNotPaid(row) {
  const status = String(row.sale_status || '')
  return status === 'awaiting_payment' || (['partial_return', 'returned'].includes(status) && row.status_before_return === 'awaiting_payment')
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
