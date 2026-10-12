'use strict'
// AL-D (Requirement gap D, brief 2026-10-12 section 5): a partial return on a
// Not Paid sale, then settlement, against the WHOLE Worker on workerd + D1.
//
// Owner rules (29 Sep, re-confirmed 5 and 6 Oct 2026): a return on a Not Paid
// sale LOWERS THE DEBT, no cash leaves the drawer, and the sale STAYS Not Paid
// until the rest is paid ($10 Not Paid, $4 returned -> owes $6, drawer pays
// out nothing). Paying the $6 then settles it, exactly once, under replay.
// The return state is a tag beside the payment state, never instead of it.
//
// Harness: test-al-money-c-native.cjs (real src/index.ts, every migration,
// real login, D1 counted per request). Asserts the owner-correct outcome; a
// red check is the reproduction. AL_MUTATION=1 runs the negative control:
// the same sale WITHOUT the return must settle at $10 on bf7408b49, proving
// the settlement request shape is valid and that the refusal below is caused
// by the return.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const mutation = process.env.AL_MUTATION === '1'
  const r = H.recorder(mutation ? 'AL-D [control: no return, owes $10]' : 'AL-D')
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

    // Sale 1: Not Paid, 5 x $2 = $10, nothing tendered.
    const sale = await H.createSale(h, { key: 'al-d-sale', status: 'awaiting_payment', lines: [{ productId: 201, quantity: 5 }], label: 'D create Not Paid $10 sale' })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    const saleId = sale.body.id
    const itemId = sale.body.sale.items[0].id
    const drawerBefore = await drawer()

    let returned = null
    if (!mutation) {
      returned = await H.customerReturn(h, { key: 'al-d-return', saleId, lines: [{ saleItemId: itemId, productId: 201, quantity: 2 }], label: 'D return 2 of 5 ($4)' })
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
    r.check(`no cash leaves the drawer: refunds $${drawerAfter.refunds && drawerAfter.refunds.usd}, expected cash $${drawerAfter.expected && drawerAfter.expected.usd} (before $${drawerBefore.expected && drawerBefore.expected.usd})`, () => {
      assert.equal(Number(drawerAfter.refunds.usd), 0, 'a Not Paid return pays nothing out of the drawer')
      assert.equal(Number(drawerAfter.expected.usd), Number(drawerBefore.expected.usd), 'expected drawer cash must not move')
    })
    const notPaid = await notPaidIds()
    r.check(`the sale stays in Not Paid until the rest is paid (status ${stored.sale_status}, before-return ${stored.status_before_return}; in Not Paid list: ${notPaid.includes(saleId)})`, () => {
      assert.ok(notPaid.includes(saleId), 'GET /api/sales?status=awaiting_payment must still list the sale')
    })

    // Short tender: $5.99 against the $6 debt must be refused as short
    // (insufficient_payment), not for being a "return-managed" sale.
    const short = await h.call('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed', client_request_id: 'al-d-short',
      expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: mutation ? 9.99 : 5.99, amount_khr: 0 }] }, 'D settle short')
    r.check(`a short tender is refused as short (got ${short.status} ${short.body.code || ''} ${String(short.body.error || '').slice(0, 90)})`, () => {
      assert.equal(short.status, 400)
      assert.equal(short.body.code, 'insufficient_payment')
    })

    // Settle the reduced debt: exactly $6 (control: $10).
    const due = mutation ? 10 : 6
    const settleBody = { sale_status: 'completed', client_request_id: 'al-d-settle', expected_exchange_rate: 4000,
      payment_details: [{ method: 'Cash', amount_usd: due, amount_khr: 0 }] }
    const settle = await h.call('PATCH', `/api/sales/${saleId}/status`, settleBody, `D settle $${due}`)
    const afterSettle = await saleRow(saleId)
    r.check(`paying the remaining $${due} settles the sale (got ${settle.status} ${String(settle.body.error || '').slice(0, 110)})`, () => {
      assert.equal(settle.status, 200)
      assert.equal(Number(afterSettle.amount_paid_usd), due, 'the tender recorded is exactly what was paid')
      assert.equal(owed(afterSettle), 0)
      assert.ok(!(readsAsNotPaid(afterSettle)), 'a settled sale is no longer Not Paid')
    })
    const replay = await h.call('PATCH', `/api/sales/${saleId}/status`, settleBody, 'D settle replay')
    const afterReplay = await saleRow(saleId)
    r.check(`replaying the same settlement is idempotent (got ${replay.status}; paid $${afterReplay.amount_paid_usd})`, () => {
      assert.equal(settle.status, 200, 'not evaluable: the first settlement never succeeded')
      assert.equal(replay.status, 200)
      assert.deepEqual(replay.body, settle.body)
      assert.equal(Number(afterReplay.amount_paid_usd), due, 'a replay must not take the payment twice')
    })
    const drawerSettled = await drawer()
    r.check(`the drawer receives exactly the $${due} paid (cash sales $${drawerSettled.cash_sales && drawerSettled.cash_sales.usd}, refunds $${drawerSettled.refunds && drawerSettled.refunds.usd})`, () => {
      assert.equal(Number(drawerSettled.expected.usd), Number(drawerBefore.expected.usd) + due)
    })

    if (!mutation) {
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
    }

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-D unpaid return then settlement: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold${mutation ? ' (AL_MUTATION=1 control run, no return)' : ''}`)
  if (failed.length) process.exitCode = 1
}

// A settled sale reads as paid in the list: status completed (or a return
// status whose retained payment state is completed), never awaiting_payment.
function readsAsNotPaid(row) {
  const status = String(row.sale_status || '')
  return status === 'awaiting_payment' || (['partial_return', 'returned'].includes(status) && row.status_before_return === 'awaiting_payment')
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
