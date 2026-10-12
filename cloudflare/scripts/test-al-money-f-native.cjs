'use strict'
// AL-F (Requirement gap F, brief 2026-10-12 section 5): a paid sale whose
// basket grows after the tender was captured, against the WHOLE Worker on
// workerd + D1.
//
// A Completed $10 sale paid with $10 cash; the customer then takes $20 more
// goods. Owner rules: a sale has three statuses and "paid means Completed"
// (23-24 Sep), the balance due is total - paid (6 Oct), and Total collected is
// money actually received. So after growth: the frozen $10 tender is kept,
// $20 is owed, the sale is Not Paid until the $20 arrives, collected stays
// $10, and Undo/Redo move total, status and debt together. Paying the $20
// then completes it.
//
// Two writers grow a basket on bf7408b49 and both are exercised:
//   - POST /api/sales/:id/items (Add items), which records server Undo/Redo;
//   - POST /api/sales/:id/amendments line_quantity_increased, which records
//     no history row at all (so there is no Undo to check there).
//
// Discrimination (reasoned, per check): keeping Completed (bf7408b49) fails
// the status, collected and settlement checks; flipping to Not Paid but
// zeroing or re-deriving the tender fails "tender frozen" and "owes $20";
// flipping on the write but not in the Undo/Redo replay fails the two replay
// checks; flipping status while reports still count $30 collected fails the
// collected check. Positive controls: every write itself returns 200.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('AL-F')
  try {
    await H.seedProduct(h, 401, 'AL-F Foundation', 10, 100)
    await H.seedProduct(h, 402, 'AL-F Primer', 10, 100)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 0 }, 'F open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))

    const row = async id => (await h.call('GET', H.fresh('/api/sales?limit=50'), undefined, 'F sales list', { observe: true })).body.find(candidate => Number(candidate.id) === Number(id))
    const notPaid = async () => (await h.call('GET', H.fresh('/api/sales?status=awaiting_payment&limit=50'), undefined, 'F Not Paid list', { observe: true })).body.map(candidate => Number(candidate.id))
    const collected = async () => (await h.call('GET', H.fresh('/api/reports/overview'), undefined, 'F reports overview', { observe: true })).body.sales.totals.collected_total_usd
    const drawerCash = async () => {
      await new Promise(resolve => setTimeout(resolve, 1100)) // open-shift window ends at this second, exclusive
      return (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'F shift drawer', { observe: true })).body.shift.reconciliation.cash_sales.usd
    }
    const owed = sale => Number((Number(sale.net_total_usd) - Number(sale.amount_paid_usd)).toFixed(4))
    // The owner's payment state, whichever column carries it.
    const isNotPaid = (sale, list) => list.includes(Number(sale.id))

    // ---- Path A: Add items, with server Undo/Redo -------------------------
    const sale = await H.createSale(h, { key: 'al-f-sale', status: 'completed', lines: [{ productId: 401, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'F create Completed $10 paid $10' })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    const saleId = sale.body.id
    const collectedBefore = await collected()
    const drawerBefore = await drawerCash()

    const added = await H.addSaleItems(h, saleId, 'al-f-add', [{ productId: 402, quantity: 2 }], 'F add $20 of items')
    const grown = await row(saleId)
    const grownNotPaid = await notPaid()
    r.check(`fixture: Add items grows the basket to $30 (got ${added.status}, total $${grown.total_usd}, response outstanding $${added.body.outstandingUsd})`, () => {
      assert.equal(added.status, 200, JSON.stringify(added.body).slice(0, 200))
      assert.equal(Number(grown.total_usd), 30)
    })
    r.check(`the captured $10 tender is frozen (paid $${grown.amount_paid_usd}, ${grown.payment_method})`, () => {
      assert.equal(Number(grown.amount_paid_usd), 10)
    })
    r.check(`the customer owes $20 (balance due $${owed(grown)})`, () => {
      assert.equal(owed(grown), 20)
    })
    r.check(`a $30 sale with $10 paid is Not Paid, not Completed (status ${grown.sale_status}; in Not Paid list: ${isNotPaid(grown, grownNotPaid)})`, () => {
      assert.ok(isNotPaid(grown, grownNotPaid))
    })
    const collectedGrown = await collected()
    r.check(`collected stays $10 for this sale (reports collected moved by $${Number((collectedGrown - collectedBefore).toFixed(2))} on growth)`, () => {
      assert.equal(Number((collectedGrown - collectedBefore).toFixed(2)), 0)
    })
    const drawerGrown = await drawerCash()
    r.check(`the drawer still holds only the $10 tendered (cash sales $${drawerBefore} -> $${drawerGrown})`, () => {
      assert.equal(drawerGrown, drawerBefore)
    })

    // What the till's Sales list shows (same URL it polls) just before Undo.
    const tillList = async () => (await h.call('GET', '/api/sales?limit=50', undefined, 'F till sales list', { observe: true })).body.find(candidate => Number(candidate.id) === Number(saleId))
    await tillList()
    const undo = await H.historyStep(h, added.body.actionHistoryId, 'undo', 0, 'F undo add items')
    const tillAfterUndo = await tillList()
    const undone = await row(saleId)
    const undoneNotPaid = await notPaid()
    r.check(`Undo: back to $10, paid $10, owes $0, Completed (got ${undo.status}; total $${undone.total_usd}, owes $${owed(undone)}, status ${undone.sale_status}, Not Paid: ${isNotPaid(undone, undoneNotPaid)})`, () => {
      assert.equal(undo.status, 200, JSON.stringify(undo.body).slice(0, 200))
      assert.equal(Number(undone.total_usd), 10)
      assert.equal(owed(undone), 0)
      assert.ok(!isNotPaid(undone, undoneNotPaid))
      assert.equal(undone.sale_status, 'completed')
    })
    r.check(`Undo is visible at once in the Sales list the till polls (list total $${tillAfterUndo.total_usd}, server total $${undone.total_usd})`, () => {
      assert.equal(Number(tillAfterUndo.total_usd), Number(undone.total_usd))
    })
    const redo = await H.historyStep(h, added.body.actionHistoryId, 'redo', 1, 'F redo add items')
    const redone = await row(saleId)
    const redoneNotPaid = await notPaid()
    r.check(`Redo: $30, paid $10, owes $20, Not Paid again (got ${redo.status}; total $${redone.total_usd}, owes $${owed(redone)}, status ${redone.sale_status}, Not Paid: ${isNotPaid(redone, redoneNotPaid)})`, () => {
      assert.equal(redo.status, 200, JSON.stringify(redo.body).slice(0, 200))
      assert.equal(Number(redone.total_usd), 30)
      assert.equal(owed(redone), 20)
      assert.ok(isNotPaid(redone, redoneNotPaid))
    })

    const settle = await h.call('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'al-f-settle',
      expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }] }, 'F settle the $20')
    const settled = await row(saleId)
    r.check(`paying the $20 completes the sale with $30 tendered (got ${settle.status} ${String(settle.body.error || '').slice(0, 90)}; paid $${settled.amount_paid_usd})`, () => {
      assert.equal(settle.status, 200)
      assert.equal(Number(settled.amount_paid_usd), 30)
      assert.equal(owed(settled), 0)
    })

    // ---- Path B: line quantity amendment (no history row) -----------------
    const second = await H.createSale(h, { key: 'al-f-sale-2', status: 'completed', lines: [{ productId: 401, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'F create second Completed $10 paid $10' })
    const collectedBeforeAmend = await collected()
    const amended = await H.amendSale(h, second.body.id, { kind: 'line_quantity_increased', sale_item_id: second.body.sale.items[0].id,
      quantity: 2, client_request_id: 'al-f-amend', client_line_key: 'al-f-sale-2-line-1' }, 'F amend quantity 1 -> 3')
    const amendedRow = await row(second.body.id)
    const amendedNotPaid = await notPaid()
    const collectedAfterAmend = await collected()
    r.check(`amendment: $30 total, $10 frozen, owes $20 (got ${amended.status}; total $${amendedRow.total_usd}, paid $${amendedRow.amount_paid_usd}, response outstanding $${amended.body.outstandingUsd})`, () => {
      assert.equal(amended.status, 200, JSON.stringify(amended.body).slice(0, 200))
      assert.equal(Number(amendedRow.total_usd), 30)
      assert.equal(Number(amendedRow.amount_paid_usd), 10)
      assert.equal(owed(amendedRow), 20)
      assert.equal(amended.body.outstandingUsd, 20)
    })
    r.check(`amendment: the sale is Not Paid and collected does not move (status ${amendedRow.sale_status}; Not Paid: ${isNotPaid(amendedRow, amendedNotPaid)}; collected moved $${Number((collectedAfterAmend - collectedBeforeAmend).toFixed(2))})`, () => {
      assert.ok(isNotPaid(amendedRow, amendedNotPaid))
      assert.equal(Number((collectedAfterAmend - collectedBeforeAmend).toFixed(2)), 0)
    })
    const amendHistory = await h.one("SELECT COUNT(*) n FROM action_history WHERE entity='sale' AND entity_id=?", String(second.body.id))
    console.log(`INFO AL-F amendment Undo/Redo: ${amendHistory.n} action_history row(s) for the amended sale (POST /amendments records none on bf7408b49)`)

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-F paid basket growth: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
