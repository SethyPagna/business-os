'use strict'
// Sale status core (lane 6.0.890), against the WHOLE Worker on workerd + D1.
//
// Owner, 20 Oct 2026: sale_status is the payment state only -- Not Paid
// (awaiting_payment) or Completed, Cancelled kept. Returns and delivery are
// TAGS beside it (return_state, delivery_pending; migration 0263) and never
// change it. Every writer this lane owns writes the two-status model and
// translates a retired word (partial_return, returned, awaiting_delivery) it
// finds on a row or in a saved Undo snapshot; readers still read the retired
// words until the held normalization rewrites history.
//
// Each check names the base behaviour it is red against. Harness:
// test-al-money-c-native.cjs (real src/index.ts, every migration, real login,
// D1 statements counted per request).
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

const RETIRED = ['partial_return', 'returned', 'awaiting_delivery']

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('TAGS')
  const state = id => h.one('SELECT sale_status,return_state,delivery_pending,status_before_return FROM sales WHERE id=?', id)
  const listIds = async (status) => (await h.call('GET', H.fresh(`/api/sales?status=${status}&limit=100`), undefined, `list ${status}`, { observe: true })).body.map(row => Number(row.id))
  let requestCounter = 0
  const setStatus = (id, status, extra = {}) => h.call('PATCH', `/api/sales/${id}/status`, { sale_status: status, client_request_id: `tags-status-${++requestCounter}`, ...extra }, `PATCH ${id} -> ${status}`)
  const bulk = async (key, id, target, label) => {
    const row = await h.one('SELECT sale_status,updated_at FROM sales WHERE id=?', id)
    return h.call('POST', '/api/sales/bulk-status', { client_request_id: key, target_status: target,
      items: [{ id, expected_status: row.sale_status || 'completed', expected_updated_at: row.updated_at ?? null }] }, label)
  }
  try {
    await H.seedProduct(h, 301, 'TAGS Lipstick', 2, 80)
    await H.seedProduct(h, 302, 'TAGS Serum', 5, 40)

    // ---- Delivery: a tag, not a status --------------------------------------
    const delivery = await H.createSale(h, { key: 'tags-delivery', status: 'awaiting_delivery', lines: [{ productId: 301, quantity: 5 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'create paid delivery order' })
    assert.equal(delivery.status, 200, JSON.stringify(delivery.body).slice(0, 300))
    const deliveryId = Number(delivery.body.id)
    const counter = await H.createSale(h, { key: 'tags-counter', lines: [{ productId: 301, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: 'create counter sale (control)' })
    const counterId = Number(counter.body.id)
    const born = await state(deliveryId)
    const queue = await listIds('awaiting_delivery')
    r.check(`a paid delivery order is born Completed with the delivery tag (base: sale_status awaiting_delivery) -- ${JSON.stringify(born)}`, () => {
      assert.equal(born.sale_status, 'completed')
      assert.equal(born.delivery_pending, 1)
    })
    r.check(`the delivery list keeps working off the tag; the counter sale is not in it (queue ${JSON.stringify(queue)})`, () => {
      assert.ok(queue.includes(deliveryId))
      assert.ok(!queue.includes(counterId), 'control: an undelivered list that held every sale would pass the first assertion')
    })
    const completedList = await listIds('completed')
    r.check('Completed lists the delivery order too: it is paid', () => assert.ok(completedList.includes(deliveryId) && completedList.includes(counterId)))
    const delivered = await setStatus(deliveryId, 'completed')
    const afterDelivered = await state(deliveryId)
    const queueAfter = await listIds('awaiting_delivery')
    r.check(`marking it delivered clears the tag and keeps Completed (got ${delivered.status}; ${JSON.stringify(afterDelivered)})`, () => {
      assert.equal(delivered.status, 200, JSON.stringify(delivered.body).slice(0, 200))
      assert.deepEqual({ ...afterDelivered, status_before_return: undefined }, { sale_status: 'completed', return_state: null, delivery_pending: 0, status_before_return: undefined })
      assert.ok(!queueAfter.includes(deliveryId))
    })

    // A row written before the tags (retired word on the row): read as the tag,
    // and the group action writes the two-status model and undoes to it.
    const legacy = await H.createSale(h, { key: 'tags-legacy-delivery', lines: [{ productId: 301, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: 'create sale later relabelled awaiting_delivery' })
    const legacyId = Number(legacy.body.id)
    await h.db.prepare("UPDATE sales SET sale_status='awaiting_delivery' WHERE id=?").bind(legacyId).run()
    const legacyQueue = await listIds('awaiting_delivery')
    r.check('a legacy awaiting_delivery row reads as delivery pending', () => assert.ok(legacyQueue.includes(legacyId)))
    const grouped = await bulk('tags-bulk-delivered', legacyId, 'completed', 'group: mark the legacy delivery delivered')
    const groupedState = await state(legacyId)
    r.check(`the group action writes Completed without the tag (got ${grouped.status}; ${JSON.stringify(groupedState)}; receipt ${JSON.stringify(grouped.body.items)})`, () => {
      assert.equal(grouped.status, 200, JSON.stringify(grouped.body).slice(0, 200))
      assert.equal(groupedState.sale_status, 'completed')
      assert.equal(groupedState.delivery_pending, 0)
      assert.deepEqual([grouped.body.items[0].before, grouped.body.items[0].after], ['awaiting_delivery', 'completed'])
    })
    // A snapshot saved before the tags existed has no delivery_pending key; its
    // before-state is the retired word itself.
    const snapshot = await h.one('SELECT s.id,s.payload_json FROM sale_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.request_id=?', 'tags-bulk-delivered')
    const payload = JSON.parse(snapshot.payload_json)
    for (const member of payload.members) for (const side of ['before', 'after']) { delete member[side].delivery_pending; delete member[side].return_state }
    await h.db.prepare('UPDATE undo_snapshots SET payload_json=? WHERE id=?').bind(JSON.stringify(payload), snapshot.id).run()
    const groupUndo = await H.historyStep(h, Number(grouped.body.actionHistoryId), 'undo', 0, 'undo the group (pre-tag snapshot)')
    const undoneState = await state(legacyId)
    r.check(`undoing a pre-tag snapshot restores the tag, never the retired word (got ${groupUndo.status}; ${JSON.stringify(undoneState)})`, () => {
      assert.equal(groupUndo.status, 200, JSON.stringify(groupUndo.body).slice(0, 200))
      assert.equal(undoneState.sale_status, 'completed')
      assert.equal(undoneState.delivery_pending, 1)
    })
    const groupRedo = await H.historyStep(h, Number(grouped.body.actionHistoryId), 'redo', 1, 'redo the group')
    const redoneState = await state(legacyId)
    r.check('redo leaves Completed without the tag', () => {
      assert.equal(groupRedo.status, 200, JSON.stringify(groupRedo.body).slice(0, 200))
      assert.deepEqual([redoneState.sale_status, redoneState.delivery_pending], ['completed', 0])
    })
    const cancelledDelivery = await H.createSale(h, { key: 'tags-cancelled-delivery', status: 'awaiting_delivery', lines: [{ productId: 301, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: 'create delivery order to cancel' })
    const cancelledId = Number(cancelledDelivery.body.id)
    const cancel = await setStatus(cancelledId, 'cancelled', { cancel_reason: 'mistake' })
    const cancelledState = await h.one('SELECT sale_status,status_before_cancel,delivery_pending FROM sales WHERE id=?', cancelledId)
    const queueCancelled = await listIds('awaiting_delivery')
    r.check(`a cancelled delivery order leaves the queue and keeps the payment state to go back to (got ${cancel.status}; ${JSON.stringify(cancelledState)})`, () => {
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body).slice(0, 200))
      assert.deepEqual(cancelledState, { sale_status: 'cancelled', status_before_cancel: 'completed', delivery_pending: 1 })
      assert.ok(!queueCancelled.includes(cancelledId))
    })
    const uncancel = await setStatus(cancelledId, 'completed')
    const uncancelled = await state(cancelledId)
    r.check('un-cancel restores the payment state and the tag', () => {
      assert.equal(uncancel.status, 200, JSON.stringify(uncancel.body).slice(0, 200))
      assert.deepEqual([uncancelled.sale_status, uncancelled.delivery_pending], ['completed', 1])
    })

    // ---- Settlement on a Not Paid sale the returns writer relabelled --------
    const notPaid = await H.createSale(h, { key: 'tags-not-paid', status: 'awaiting_payment', lines: [{ productId: 301, quantity: 5 }], label: 'create Not Paid $10' })
    const notPaidId = Number(notPaid.body.id)
    await H.customerReturn(h, { key: 'tags-return', saleId: notPaidId, lines: [{ saleItemId: notPaid.body.sale.items[0].id, productId: 301, quantity: 2 }], label: 'return $4' })
    const relabelled = await state(notPaidId)
    const settle = await h.call('PATCH', `/api/sales/${notPaidId}/status`, { sale_status: 'completed', client_request_id: 'tags-settle', expected_exchange_rate: 4000,
      payment_details: [{ method: 'Cash', amount_usd: 6, amount_khr: 0 }] }, 'settle the $6 left')
    const settled = await state(notPaidId)
    r.check(`settling writes Completed and the return tag, never a return word (base: partial_return / completed) -- was ${JSON.stringify(relabelled)}, got ${settle.status} ${JSON.stringify(settled)}`, () => {
      assert.equal(settle.status, 200, JSON.stringify(settle.body).slice(0, 200))
      assert.equal(settled.sale_status, 'completed')
      assert.equal(settled.return_state, 'partial')
      assert.equal(settle.body.sale_status, 'completed')
      assert.equal(settle.body.return_state, 'partial')
    })
    // The Undo snapshot the previous Worker saved for this settlement: no tag
    // keys, the return word kept on both sides and only the payment state moved.
    const receipt = await h.one("SELECT id,before_json,after_json FROM sale_mutation_receipts WHERE mutation_kind='settlement' AND request_id='tags-settle'")
    const legacySnapshot = (json, payment) => { const value = JSON.parse(json); delete value.return_state; delete value.delivery_pending
      return JSON.stringify({ ...value, sale_status: 'partial_return', status_before_return: payment }) }
    await h.db.prepare('UPDATE sale_mutation_receipts SET before_json=?,after_json=? WHERE id=?')
      .bind(legacySnapshot(receipt.before_json, 'awaiting_payment'), legacySnapshot(receipt.after_json, 'completed'), receipt.id).run()
    const settleUndo = await H.historyStep(h, Number(settle.body.actionHistoryId), 'undo', 0, 'undo settlement (pre-tag snapshot)')
    const settleUndone = await state(notPaidId)
    const notPaidList = await listIds('awaiting_payment')
    const partialList = await listIds('partial_return')
    r.check(`undoing a pre-tag snapshot puts it back to Not Paid with its return tag (got ${settleUndo.status}; ${JSON.stringify(settleUndone)})`, () => {
      assert.equal(settleUndo.status, 200, JSON.stringify(settleUndo.body).slice(0, 200))
      assert.deepEqual([settleUndone.sale_status, settleUndone.return_state], ['awaiting_payment', 'partial'])
      assert.ok(notPaidList.includes(notPaidId), 'listed under Not Paid')
      assert.ok(partialList.includes(notPaidId), 'and under its return tag')
    })
    const settleRedo = await H.historyStep(h, Number(settle.body.actionHistoryId), 'redo', 1, 'redo settlement')
    const settleRedone = await state(notPaidId)
    r.check(`redo settles it again (got ${settleRedo.status}; ${JSON.stringify(settleRedone)})`, () => {
      assert.equal(settleRedo.status, 200, JSON.stringify(settleRedo.body).slice(0, 200))
      assert.deepEqual([settleRedone.sale_status, settleRedone.return_state], ['completed', 'partial'])
    })

    // ---- Imports map the CSV word to payment state + tags --------------------
    const importedReturned = await H.importSale(h, 21, 'returned', [{ productId: 302, name: 'TAGS Serum', quantity: 2, price: 5, returned: 2 }])
    const importedPartial = await H.importSale(h, 22, 'partial_return', [{ productId: 302, name: 'TAGS Serum', quantity: 3, price: 5, returned: 1 }])
    const importedDelivery = await H.importSale(h, 23, 'awaiting_delivery', [{ productId: 302, name: 'TAGS Serum', quantity: 1, price: 5 }])
    const importedNotPaid = await H.importSale(h, 24, 'awaiting_payment', [{ productId: 302, name: 'TAGS Serum', quantity: 2, price: 5 }], { paidUsd: 0 })
    const importedPlain = await H.importSale(h, 25, 'completed', [{ productId: 302, name: 'TAGS Serum', quantity: 1, price: 5 }])
    const imported = {}
    for (const [name, row] of Object.entries({ importedReturned, importedPartial, importedDelivery, importedNotPaid, importedPlain })) imported[name] = await state(row.sale.id)
    r.check(`imports store the payment state and the tags, never a retired word (base: returned / partial_return / awaiting_delivery) -- ${JSON.stringify(imported)}`, () => {
      assert.deepEqual([imported.importedReturned.sale_status, imported.importedReturned.return_state], ['completed', 'full'])
      assert.deepEqual([imported.importedPartial.sale_status, imported.importedPartial.return_state], ['completed', 'partial'])
      assert.deepEqual([imported.importedDelivery.sale_status, imported.importedDelivery.delivery_pending], ['completed', 1])
      assert.equal(imported.importedNotPaid.sale_status, 'awaiting_payment')
      for (const row of Object.values(imported)) assert.ok(!RETIRED.includes(row.sale_status))
    })
    const returnedStock = await h.one('SELECT quantity FROM branch_stock WHERE product_id=302 AND branch_id=1')
    r.check(`the imported return still restocks the units that came back (3 of 40 + 0 sold -> ${returnedStock.quantity})`, () => assert.equal(Number(returnedStock.quantity), 43))
    // The held normalization leaves an imported returned sale labelled Completed
    // with no returns rows; only evidence keeps its lines frozen.
    await h.db.prepare("UPDATE sales SET sale_status='completed' WHERE id IN (?,?)").bind(importedReturned.sale.id, importedPartial.sale.id).run()
    const amend = (row, key) => H.amendSale(h, row.sale.id, { kind: 'line_quantity_decreased', client_request_id: key,
      sale_item_id: row.items[0].id, quantity: 1 }, `amend imported ${key}`)
    const refusedFull = await amend(importedReturned, 'tags-amend-full')
    const refusedPartial = await amend(importedPartial, 'tags-amend-partial')
    const plainAmend = await amend(importedPlain, 'tags-amend-plain')
    r.check(`an imported returned sale with no returns rows refuses an amendment (base: accepted once the label reads Completed) -- ${refusedFull.status} ${refusedFull.body.code} / ${refusedPartial.status} ${refusedPartial.body.code}`, () => {
      assert.deepEqual([refusedFull.status, refusedFull.body.code], [400, 'returns'])
      assert.deepEqual([refusedPartial.status, refusedPartial.body.code], [400, 'returns'])
    })
    r.check(`control: the same amendment on an imported sale without returns passes the returns guard (got ${plainAmend.status} ${plainAmend.body.code || ''})`, () => {
      assert.notEqual(plainAmend.body.code, 'returns')
    })
    const added = await H.addSaleItems(h, importedReturned.sale.id, 'tags-add-items', [{ productId: 301, quantity: 1 }], 'add items to imported returned sale')
    r.check(`adding lines to it is refused for the same reason (got ${added.status} ${String(added.body.error || '').slice(0, 60)})`, () => {
      assert.equal(added.status, 400)
      assert.match(String(added.body.error), /recorded returns/)
    })

    // ---- Sales vs receivables: one control set, both ledgers ---------------
    // Legacy receivables join their sale on the composite key, never invoice_no alone.
    const ledgerRows = [[importedNotPaid, 10, 10], [importedReturned, 10, 0], [importedPartial, 15, 0], [importedPlain, 5, 0]]
    for (const [index, [row, total, outstanding]] of ledgerRows.entries()) {
      const key = `9${String(index).padStart(5, '0')}`
      await h.db.prepare('UPDATE sales SET legacy_receipt_number=? WHERE id=?').bind(`${key}@2026-08-20`, row.sale.id).run()
      await h.db.prepare(`INSERT INTO customer_receivables(legacy_id,customer_name,invoice_no,invoice_date,taxable_amount_usd,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row)
        VALUES(?,?,?,?,?,?,?,?,?,'tags-fixture',?)`).bind(index + 1, 'Dara', key, '2026-08-20 00:00:00', total, total, total - outstanding, outstanding, outstanding > 0 ? 'unpaid' : 'paid', index + 1).run()
    }
    const joined = await h.all(`SELECT s.id, cr.outstanding_balance_usd AS outstanding FROM customer_receivables cr
      JOIN sales s ON s.legacy_receipt_number = cr.invoice_no || '@' || substr(cr.invoice_date,1,10) WHERE cr.source_file='tags-fixture'`)
    const broken = await h.all(`SELECT s.id FROM customer_receivables cr JOIN sales s ON s.legacy_receipt_number = cr.invoice_no WHERE cr.source_file='tags-fixture'`)
    r.check(`control set: the composite key joins all ${ledgerRows.length} receivables to their sales; invoice_no alone joins none (${joined.length} / ${broken.length})`, () => {
      assert.equal(joined.length, ledgerRows.length)
      assert.equal(broken.length, 0)
    })
    const notPaidNow = await listIds('awaiting_payment')
    const paidNow = await listIds('completed')
    const split = joined.filter(row => (Number(row.outstanding) > 0.004) !== notPaidNow.includes(Number(row.id)) || (Number(row.outstanding) <= 0.004) !== paidNow.includes(Number(row.id)))
    r.check(`every owed receivable is a Not Paid sale and every settled one a Completed sale, tagged or not (base: a returned sale is in neither list) -- split ${JSON.stringify(split)}`, () => {
      assert.deepEqual(split, [])
    })

    // ---- Integrity repair: tags only, never sale_status ---------------------
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('loyalty_points_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const loyal = await H.createSale(h, { key: 'tags-integrity', status: 'awaiting_payment', lines: [{ productId: 301, quantity: 5 }], label: 'create Not Paid $10 (loyalty on)' })
    const loyalId = Number(loyal.body.id)
    await H.customerReturn(h, { key: 'tags-integrity-return', saleId: loyalId, lines: [{ saleItemId: loyal.body.sale.items[0].id, productId: 301, quantity: 1 }], label: 'return $2' })
    // The two-status shape with its tag lost (what the integrity check exists to find).
    await h.db.prepare("UPDATE sales SET sale_status='awaiting_payment', return_state=NULL WHERE id=?").bind(loyalId).run()
    const earning = async () => (await h.all('SELECT value FROM system_flags WHERE key LIKE ?', `loyalty_sale_earning:${loyalId}:%`)).map(row => row.value)
    // The returns writer (lane S2a) still relabels sale_status, which the 0251
    // trigger reads as a first payment; record that, then start this probe clean.
    const flagsFromReturn = await earning()
    await h.db.prepare('DELETE FROM system_flags WHERE key LIKE ?').bind(`loyalty_sale_earning:${loyalId}:%`).run()
    const flagsBefore = await earning()
    console.log(`NOTE the retired return relabel fired loyalty_sale_first_earning on a Not Paid sale: ${JSON.stringify(flagsFromReturn)} (lane S2a removes the relabel)`)
    const verify = await h.call('GET', '/api/system/verify-integrity', undefined, 'verify integrity', { observe: true })
    const repair = await h.call('POST', '/api/system/repair-integrity', { currentPassword: 'al-money-fixture' }, 'repair integrity')
    const repaired = await h.one('SELECT sale_status,return_state,status_before_return,loyalty_accrual FROM sales WHERE id=?', loyalId)
    const flagsAfter = await earning()
    r.check(`the check reports the missing tag (got ${verify.status}: ${JSON.stringify(verify.body.details && verify.body.details.saleStatus && verify.body.details.saleStatus.errors)})`, () => {
      assert.equal(verify.status, 200)
      assert.ok(verify.body.details.saleStatus.errors.some(line => line.startsWith(`Sale ${loyalId}: return tag`)))
    })
    r.check(`repair restores the tag and leaves the Not Paid state alone (base: rewrote sale_status to partial_return, reading paid) -- got ${repair.status}; ${JSON.stringify(repaired)}`, () => {
      assert.equal(repair.status, 200, JSON.stringify(repair.body).slice(0, 200))
      assert.equal(repaired.sale_status, 'awaiting_payment')
      assert.equal(repaired.return_state, 'partial')
    })
    r.check(`loyalty 0251: the repair is not a first payment (earning flags ${JSON.stringify(flagsBefore)} -> ${JSON.stringify(flagsAfter)}; accrual ${repaired.loyalty_accrual})`, () => {
      assert.deepEqual(flagsAfter, flagsBefore)
      assert.equal(Number(repaired.loyalty_accrual), 1)
    })
    const loyalSettle = await h.call('PATCH', `/api/sales/${loyalId}/status`, { sale_status: 'completed', client_request_id: 'tags-integrity-settle', expected_exchange_rate: 4000,
      payment_details: [{ method: 'Cash', amount_usd: 8, amount_khr: 0 }] }, 'settle the $8 left (loyalty control)')
    const flagsPaid = await earning()
    r.check(`control: paying it IS the first payment and fires the trigger (got ${loyalSettle.status}; flags ${JSON.stringify(flagsPaid)})`, () => {
      assert.equal(loyalSettle.status, 200, JSON.stringify(loyalSettle.body).slice(0, 200))
      assert.deepEqual(flagsPaid, ['earned'])
    })

    const retired = await h.all(`SELECT id,sale_status FROM sales WHERE sale_status IN ('partial_return','returned','awaiting_delivery')
      AND id NOT IN (?, ?)`, notPaidId, loyalId)
    r.check(`no writer of this lane left a retired word (only the returns writer's rows may carry one until lane S2a) -- ${JSON.stringify(retired)}`, () => assert.deepEqual(retired, []))

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} sale status tags: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
