// N9 (loophole review 2026-10-06): cancelling a sale with a lost fee booked an
// expense with only the Sales status permission and no ceiling, and
// un-cancelling deleted that expense with no Expenses permission at all.
// lib/cancelFeeRules.ts now asks the Expenses questions on every writer:
// Add to record the fee, Delete at Full to remove it, and the fee may not
// exceed the sale's total. Covers PATCH /:id/status and POST /bulk-status.
//
// Discriminating: on 4ab47676e (SEC_SALES_BASELINE=1) the Sales-only role
// records the $3 expense, so the first assertion fails there. Controls: the
// same role still cancels WITHOUT a fee; a role with Expenses records an
// in-total fee (USD plus riel at the sale's rate) and un-cancels it; a
// Review-tier Expenses role cannot delete the expense through an un-cancel.
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

const salesOnly = { id: 81, username: 'sales_only', name: 'Sales Only', permissions: JSON.stringify({ sales: true }) }
const salesAndExpenses = { id: 82, username: 'sales_fees', name: 'Sales Fees', permissions: JSON.stringify({ sales: true, fees: true }) }
const expensesReview = { id: 83, username: 'sales_fees_review', name: 'Sales Fees Review', permissions: JSON.stringify({ sales: true, fees: 'review' }) }

async function recordedSale(f, id) {
  h.setUser(h.USER)
  const created = await h.postSale(f.route, h.request(id))
  assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 240))
  return Number(created.body.id)
}
const saleRow = (f, id) => f.raw.prepare(`SELECT sale_status, cancel_fee_id, updated_at FROM sales WHERE id=${Number(id)}`).get()
const feeCount = (f, id) => Number(f.raw.prepare(`SELECT COUNT(*) AS n FROM fees WHERE sale_id=${Number(id)}`).get().n)
let requestSeq = 0
function setStatus(f, user, saleId, body) {
  h.setUser(user)
  return h.call(f.route, 'PATCH', `/${saleId}/status`, { client_request_id: `n9-status-${++requestSeq}`, ...body })
}

;(async () => {
  const f = h.fixture()
  h.openShift(f.raw, h.USER)

  // --- recording a fee needs Expenses -> Add -------------------------------
  const a = await recordedSale(f, 'n9-a')
  const refused = await setStatus(f, salesOnly, a, { sale_status: 'cancelled', cancel_reason: 'mistake', cancel_fee_usd: 3 })
  assert.equal(refused.status, 403, `a Sales-only role must not book an expense; got ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}`)
  assert.equal(refused.body.code, 'cancel_fee_requires_expense_add')
  assert.equal(saleRow(f, a).sale_status, 'completed')
  assert.equal(feeCount(f, a), 0)
  console.log('PASS a Sales-only role cannot record a lost fee; nothing changed')

  const noFee = await setStatus(f, salesOnly, a, { sale_status: 'cancelled', cancel_reason: 'mistake' })
  assert.equal(noFee.status, 200, `control: cancelling without a fee needs no Expenses permission: ${JSON.stringify(noFee.body).slice(0, 200)}`)
  assert.equal(feeCount(f, a), 0)
  console.log('PASS control: the same role still cancels without a fee')

  // --- the fee cannot exceed the sale total --------------------------------
  const b = await recordedSale(f, 'n9-b')
  const tooBig = await setStatus(f, salesAndExpenses, b, { sale_status: 'cancelled', cancel_reason: 'buyer_refused', cancel_fee_usd: 9, cancel_fee_khr: 4000 })
  assert.equal(tooBig.status, 400, `$9 + 4,000 riel at 4,000 is $10 against a $9.50 sale: ${JSON.stringify(tooBig.body).slice(0, 200)}`)
  assert.equal(tooBig.body.code, 'cancel_fee_exceeds_sale_total')
  assert.equal(feeCount(f, b), 0)
  const inTotal = await setStatus(f, salesAndExpenses, b, { sale_status: 'cancelled', cancel_reason: 'buyer_refused', cancel_fee_usd: 8.5, cancel_fee_khr: 4000 })
  assert.equal(inTotal.status, 200, `control: $8.50 + 4,000 riel is exactly the $9.50 total: ${JSON.stringify(inTotal.body).slice(0, 200)}`)
  assert.equal(feeCount(f, b), 1)
  console.log('PASS the fee is capped at the sale total, riel counted at the sale rate')

  // --- removing the fee needs Expenses -> Delete at Full -------------------
  const revertReview = await setStatus(f, expensesReview, b, { sale_status: 'completed' })
  assert.equal(revertReview.status, 403, `a Review-tier Expenses role cannot delete the expense by un-cancelling: ${JSON.stringify(revertReview.body).slice(0, 200)}`)
  assert.equal(revertReview.body.code, 'uncancel_requires_expense_delete')
  assert.equal(saleRow(f, b).sale_status, 'cancelled')
  assert.equal(feeCount(f, b), 1)
  const revertSalesOnly = await setStatus(f, salesOnly, b, { sale_status: 'completed' })
  assert.equal(revertSalesOnly.status, 403)
  assert.equal(feeCount(f, b), 1)
  const revertFull = await setStatus(f, salesAndExpenses, b, { sale_status: 'completed' })
  assert.equal(revertFull.status, 200, `control: Expenses Full un-cancels and removes the fee: ${JSON.stringify(revertFull.body).slice(0, 200)}`)
  assert.equal(feeCount(f, b), 0)
  const revertNoFee = await setStatus(f, salesOnly, a, { sale_status: 'completed' })
  assert.equal(revertNoFee.status, 200, `control: un-cancelling a sale with no fee needs no Expenses permission: ${JSON.stringify(revertNoFee.body).slice(0, 200)}`)
  console.log('PASS un-cancelling removes the fee only for Expenses Delete at Full')

  // --- the grouped status change asks the same questions -------------------
  const c = await recordedSale(f, 'n9-c')
  const bulkBody = (user, cancel) => {
    h.setUser(user)
    const row = saleRow(f, c)
    return h.call(f.route, 'POST', '/bulk-status', {
      client_request_id: `n9bulk${++requestSeq}xx`,
      items: [{ id: c, expected_status: row.sale_status, expected_updated_at: row.updated_at, cancel }],
      target_status: 'cancelled',
    })
  }
  const bulkRefused = await bulkBody(salesOnly, { reason: 'mistake', fee_usd: 3 })
  assert.equal(bulkRefused.status, 403, `bulk: a Sales-only role must not book an expense: ${JSON.stringify(bulkRefused.body).slice(0, 200)}`)
  assert.equal(bulkRefused.body.code, 'cancel_fee_requires_expense_add')
  assert.equal(feeCount(f, c), 0)
  const bulkTooBig = await bulkBody(salesAndExpenses, { reason: 'mistake', fee_usd: 20 })
  assert.equal(bulkTooBig.status, 400, JSON.stringify(bulkTooBig.body).slice(0, 200))
  assert.equal(bulkTooBig.body.code, 'cancel_fee_exceeds_sale_total')
  const bulkOk = await bulkBody(salesAndExpenses, { reason: 'mistake', fee_usd: 3 })
  assert.equal(bulkOk.status, 200, `control: bulk cancel with an in-total fee: ${JSON.stringify(bulkOk.body).slice(0, 200)}`)
  assert.equal(feeCount(f, c), 1)
  h.setUser(expensesReview)
  const bulkRevert = await h.call(f.route, 'POST', '/bulk-status', {
    client_request_id: `n9bulk${++requestSeq}xx`,
    items: [{ id: c, expected_status: 'cancelled', expected_updated_at: saleRow(f, c).updated_at }],
    target_status: 'completed',
  })
  assert.equal(bulkRevert.status, 403, `bulk un-cancel needs Expenses Delete at Full: ${JSON.stringify(bulkRevert.body).slice(0, 200)}`)
  assert.equal(bulkRevert.body.code, 'uncancel_requires_expense_delete')
  assert.equal(feeCount(f, c), 1)
  console.log('PASS the grouped status change enforces the same Expenses rule and cap')

  // --- undo/redo of that group re-asks the questions --------------------------
  // Undoing the grouped cancel deletes its fee; redoing it records the fee again.
  const bulk = h.load('lib/saleBulkStatus.ts')
  const history = f.raw.prepare(`SELECT h.id, h.undo_payload FROM action_history h
    JOIN sale_bulk_operations o ON o.history_id = h.id WHERE h.status = 'undoable' ORDER BY h.id DESC LIMIT 1`).get()
  const payload = JSON.parse(history.undo_payload)
  const replay = async (user, direction, generation) => {
    try { await bulk.replaySaleBulkStatus({ DB: f.route }, user, direction, Number(history.id), generation, payload); return null }
    catch (error) { return error }
  }
  const undoDenied = await replay(expensesReview, 'undo', 0)
  assert.ok(undoDenied && undoDenied.details?.code === 'uncancel_requires_expense_delete', `undo deletes the fee, so it needs Expenses Delete at Full: ${undoDenied?.message}`)
  assert.equal(feeCount(f, c), 1)
  assert.equal(await replay(salesAndExpenses, 'undo', 0), null, 'control: Expenses Full undoes the group')
  assert.equal(feeCount(f, c), 0)
  const redoDenied = await replay(salesOnly, 'redo', 1)
  assert.ok(redoDenied && redoDenied.details?.code === 'cancel_fee_requires_expense_add', `redo records the fee again, so it needs Expenses Add: ${redoDenied?.message}`)
  assert.equal(feeCount(f, c), 0)
  console.log('PASS undo and redo of a grouped cancel ask the same Expenses questions')
  h.setUser(h.USER)
})().catch((error) => { console.error(error); process.exit(1) })
