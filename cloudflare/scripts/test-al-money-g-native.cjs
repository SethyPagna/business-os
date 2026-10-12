'use strict'
// AL-G (Requirement gap G, brief 2026-10-12 section 5): restore after the
// same sale line was repriced, against the WHOLE Worker on workerd + D1.
//
// Sale (3 x $10, paid) -> return 1 unit ($10) -> cancel that return ->
// reprice the SAME sale_item_id to $8 -> restore the cancelled return. The
// $10 already refunded is historical money and must never change; after that
// the system must be consistent: EITHER the restore is refused with an
// explicit code and nothing changes, OR it is accepted and the sale stays
// coherent -- the remaining units can still be quoted and returned. A restore
// that succeeds and leaves the sale unreturnable is the defect.
//
// Control (same file, no reprice): sale -> return -> cancel -> restore ->
// quote must work on bf7408b49, so a red here is caused by the reprice.
//
// Side finding M, pinned first with return ids NOT offset from sale ids:
// cancelling sale N writes inventory_movements(movement_type 'return',
// reference_id N); the return-create postcondition counts movements by
// reference_id alone, so return id N can never be created -- and because a
// refused insert does not consume the id, no customer return can be created
// at all from then on. Control: move the return sequence past N and the very
// same return succeeds.
//
// Harness: test-al-money-c-native.cjs.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker({ returnIdFloor: 0 })
  const r = H.recorder('AL-G')
  try {
    for (const [id, name] of [[601, 'AL-G Cancelled Mascara'], [602, 'AL-G Returned Gel'], [603, 'AL-G Repriced Serum'], [604, 'AL-G Control Serum']]) {
      await H.seedProduct(h, id, name, 10, 100)
    }
    const paid = amount => [{ method: 'Cash', amount_usd: amount, amount_khr: 0 }]

    // ---- Side finding M ---------------------------------------------------
    const cancelledSale = await H.createSale(h, { key: 'al-g-m-cancelled', status: 'completed', lines: [{ productId: 601, quantity: 1 }], paymentDetails: paid(10), label: 'M sale 1' })
    const cancel = await h.call('PATCH', `/api/sales/${cancelledSale.body.id}/status`, { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: 'al-g-m-cancel' }, 'M cancel sale 1')
    const otherSale = await H.createSale(h, { key: 'al-g-m-other', status: 'completed', lines: [{ productId: 602, quantity: 2 }], paymentDetails: paid(20), label: 'M sale 2' })
    const nextReturnId = Number((await h.one("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='returns'),0)+1 AS id")).id)
    const collidingMovements = await h.one("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=? AND movement_type='return'", nextReturnId)
    const blocked = await H.customerReturn(h, { key: 'al-g-m-return', saleId: otherSale.body.id,
      lines: [{ saleItemId: otherSale.body.sale.items[0].id, productId: 602, quantity: 1 }], label: 'M return on sale 2 (next return id = cancelled sale id)' })
    const blockedErrors = (await h.call('GET', '/__fixture/d1-errors')).body
    const blockedAgain = await H.customerReturn(h, { key: 'al-g-m-return-again', saleId: otherSale.body.id,
      lines: [{ saleItemId: otherSale.body.sale.items[0].id, productId: 602, quantity: 1 }], label: 'M retry' })
    r.check(`M: a cancelled sale never blocks an unrelated return (sale ${cancelledSale.body.id} cancelled ${cancel.status}; next return id ${nextReturnId} has ${collidingMovements.n} 'return' movement(s) on that reference; create ${blocked.created && blocked.created.status}${blocked.created && blocked.created.body.code ? ' ' + blocked.created.body.code : ''}, retry ${blockedAgain.created && blockedAgain.created.status}; D1: ${blockedErrors[0] || 'none'})`, () => {
      assert.equal(cancel.status, 200)
      assert.equal(blocked.created.status, 200)
    })
    // Control: the same request with the return sequence moved past every sale id.
    await H.setReturnIdFloor(h.db, 100000)
    const unblocked = await H.customerReturn(h, { key: 'al-g-m-return-control', saleId: otherSale.body.id,
      lines: [{ saleItemId: otherSale.body.sale.items[0].id, productId: 602, quantity: 1 }], label: 'M control (return id 100001)' })
    r.check(`M control: with the return id moved off the sale ids the same return succeeds (got ${unblocked.created && unblocked.created.status})`, () => {
      assert.equal(unblocked.created.status, 200)
    })

    // ---- G: sale -> return -> cancel -> reprice same line -> restore -------
    const sale = await H.createSale(h, { key: 'al-g-sale', status: 'completed', lines: [{ productId: 603, quantity: 3 }], paymentDetails: paid(30), label: 'G sale 3 x $10' })
    const itemId = sale.body.sale.items[0].id
    const first = await H.customerReturn(h, { key: 'al-g-r1', saleId: sale.body.id, lines: [{ saleItemId: itemId, productId: 603, quantity: 1 }], label: 'G return 1 unit ($10)' })
    const returnId = Number(first.created && first.created.body.id)
    const money = async () => h.one('SELECT status,total_refund_usd,calculated_refund_usd,rounding_adjustment_usd,total_refund_khr FROM returns WHERE id=?', returnId)
    const snapshot = async () => (await h.one('SELECT refund_snapshot_json FROM return_items WHERE return_id=?', returnId)).refund_snapshot_json
    const moneyBefore = await money()
    const snapshotBefore = await snapshot()
    const cancelReturn = await H.bulkReturnStatus(h, 'al-g-cancel', returnId, 'completed', 'cancelled', 'G cancel the return')
    const reprice = await H.amendSale(h, sale.body.id, { kind: 'line_updated', sale_item_id: itemId, quantity: 3, selling_price_input_usd: 8,
      client_request_id: 'al-g-reprice', client_line_key: 'al-g-sale-line-1' }, 'G reprice the same line to $8')
    const line = await h.one('SELECT applied_price_usd,total_usd FROM sale_items WHERE id=?', itemId)
    r.check(`fixture: return ${first.created && first.created.status}, cancel ${cancelReturn.status}, reprice ${reprice.status} (line now $${line.applied_price_usd} x 3 = $${line.total_usd})`, () => {
      assert.equal(first.created.status, 200)
      assert.equal(cancelReturn.status, 200)
      assert.equal(reprice.status, 200, JSON.stringify(reprice.body).slice(0, 200))
      assert.equal(line.applied_price_usd, 8)
    })
    const restore = await H.bulkReturnStatus(h, 'al-g-restore', returnId, 'cancelled', 'completed', 'G restore the cancelled return')
    const moneyAfter = await money()
    const snapshotAfter = await snapshot()
    const nextQuote = await h.call('POST', '/api/returns/quote', { sale_id: sale.body.id, items: [{ sale_item_id: itemId, quantity: 1 }] }, 'G quote 1 more unit')
    const restQuote = await h.call('POST', '/api/returns/quote', { sale_id: sale.body.id, items: [{ sale_item_id: itemId, quantity: 2 }] }, 'G quote the 2 remaining units')
    r.check(`the historical refund money never changes ($${moneyBefore.total_refund_usd} / calc $${moneyBefore.calculated_refund_usd} -> $${moneyAfter.total_refund_usd} / calc $${moneyAfter.calculated_refund_usd}; snapshot ${snapshotAfter === snapshotBefore ? 'unchanged' : 'REWRITTEN'})`, () => {
      assert.deepEqual({ usd: moneyAfter.total_refund_usd, calc: moneyAfter.calculated_refund_usd, adj: moneyAfter.rounding_adjustment_usd, khr: moneyAfter.total_refund_khr },
        { usd: moneyBefore.total_refund_usd, calc: moneyBefore.calculated_refund_usd, adj: moneyBefore.rounding_adjustment_usd, khr: moneyBefore.total_refund_khr })
      assert.equal(snapshotAfter, snapshotBefore)
    })
    const accepted = restore.status === 200
    r.check(`restore is either refused explicitly or leaves the sale coherent (restore ${restore.status}${restore.body.code ? ' ' + restore.body.code : ''}, return now ${moneyAfter.status}; next 1-unit quote ${nextQuote.status} ${nextQuote.body.code || ''})`, () => {
      if (accepted) {
        assert.equal(nextQuote.status, 200, 'an accepted restore must leave the remaining units returnable')
      } else {
        assert.ok([400, 409].includes(restore.status), 'a refusal is an explicit 400/409')
        assert.equal(typeof restore.body.code, 'string', 'a refusal carries a code the till can explain')
        assert.equal(moneyAfter.status, 'cancelled', 'a refused restore changes nothing')
        assert.equal(nextQuote.status, 200, 'after a refused restore the line is still returnable at its current price')
      }
    })
    r.check(`the units not yet returned stay returnable (quote for 2 more units: ${restQuote.status} ${restQuote.body.code || ''})`, () => {
      assert.equal(restQuote.status, 200)
    })
    if (nextQuote.status === 200) {
      console.log(`INFO AL-G next unit quotes $${nextQuote.body.total_refund_usd} after restore (current line price $${line.applied_price_usd})`)
    }

    // ---- Control: the same sequence without the reprice -------------------
    const control = await H.createSale(h, { key: 'al-g-control', status: 'completed', lines: [{ productId: 604, quantity: 3 }], paymentDetails: paid(30), label: 'G control sale' })
    const controlItem = control.body.sale.items[0].id
    const controlReturn = await H.customerReturn(h, { key: 'al-g-control-r1', saleId: control.body.id, lines: [{ saleItemId: controlItem, productId: 604, quantity: 1 }], label: 'G control return' })
    const controlId = Number(controlReturn.created.body.id)
    const controlCancel = await H.bulkReturnStatus(h, 'al-g-control-cancel', controlId, 'completed', 'cancelled', 'G control cancel')
    const controlRestore = await H.bulkReturnStatus(h, 'al-g-control-restore', controlId, 'cancelled', 'completed', 'G control restore')
    const controlQuote = await h.call('POST', '/api/returns/quote', { sale_id: control.body.id, items: [{ sale_item_id: controlItem, quantity: 2 }] }, 'G control quote')
    r.check(`control without the reprice: cancel ${controlCancel.status}, restore ${controlRestore.status}, remaining quote ${controlQuote.status}`, () => {
      assert.deepEqual([controlCancel.status, controlRestore.status, controlQuote.status], [200, 200, 200])
    })

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-G restore after same-line reprice (+ side finding M): ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
