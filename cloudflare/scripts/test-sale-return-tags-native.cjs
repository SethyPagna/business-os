'use strict'
// Returns writers (lane 6.0.905, plan PLAN-SALE-STATUS-TAGS S2a), against the
// WHOLE Worker on workerd + D1 (harness: test-al-money-c-native.cjs).
//
// Owner, 20 Oct 2026: a sale has two statuses, Not Paid (awaiting_payment) and
// Completed. A return is a TAG (sales.return_state 'partial' | 'full') that
// never changes sale_status; a NEW full return raises return_review_state
// 'pending'. Not Paid means Not Paid: a return lowers what is owed, a
// replacement on an unpaid sale is itself unpaid, and nothing turns Not Paid
// into Completed by itself.
//
// Every check names the base behaviour (3542bb234) it is red against.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

const RETIRED = ['partial_return', 'returned']

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('RET-TAGS')
  const state = id => h.one('SELECT sale_status,return_state,return_review_state,status_before_return FROM sales WHERE id=?', id)
  const listIds = async status => (await h.call('GET', H.fresh(`/api/sales?status=${status}&limit=200`), undefined, `list ${status}`, { observe: true })).body.map(row => Number(row.id))
  const earning = async id => (await h.all('SELECT value FROM system_flags WHERE key LIKE ?', `loyalty_sale_earning:${id}:%`)).map(row => row.value)
  const sent = new Map()
  const bulk = async (key, ids, source, target, label) => {
    const items = []
    for (const id of ids) {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      items.push({ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null })
    }
    sent.set(key, { client_request_id: key, field: 'status', source, target, items })
    return h.call('POST', '/api/returns/bulk', sent.get(key), label)
  }
  const legacyReturn = (key, saleId, saleItemId, productId, quantity, price, extra = {}) => h.call('POST', '/api/returns', {
    client_request_id: key, sale_id: saleId, reason: 'RET-TAGS legacy', return_type: 'restock',
    items: [{ sale_item_id: saleItemId, product_id: productId, quantity, applied_price_usd: price, stock_action: 'restock', branch_id: 1 }], ...extra }, key)
  try {
    await H.seedProduct(h, 401, 'RT Lipstick', 2, 500)
    await H.seedProduct(h, 402, 'RT Palette', 4, 500)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('loyalty_points_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()

    // ---- Completed sale: partial -> full -> cancel -> undo/redo -> restore ------------------------------
    const paid = await H.createSale(h, { key: 'rt-paid', lines: [{ productId: 401, quantity: 5 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'create Completed $10' })
    assert.equal(paid.status, 200, JSON.stringify(paid.body).slice(0, 300))
    const paidId = Number(paid.body.id)
    const line = paid.body.sale.items[0].id
    const first = await H.customerReturn(h, { key: 'rt-paid-r1', saleId: paidId, lines: [{ saleItemId: line, productId: 401, quantity: 2 }], label: 'return 2 of 5' })
    const afterPartial = await state(paidId)
    r.check(`a partial return tags the sale and leaves Completed alone (base: sale_status partial_return) -- ${first.created && first.created.status} ${JSON.stringify(afterPartial)}`, () => {
      assert.equal(first.created.status, 200, JSON.stringify(first.created.body).slice(0, 200))
      assert.deepEqual([afterPartial.sale_status, afterPartial.return_state, afterPartial.return_review_state, afterPartial.status_before_return], ['completed', 'partial', null, null])
    })
    const second = await H.customerReturn(h, { key: 'rt-paid-r2', saleId: paidId, lines: [{ saleItemId: line, productId: 401, quantity: 3 }], label: 'return the other 3 (full)' })
    const afterFull = await state(paidId)
    r.check(`a NEW full return tags full and raises the review flag; Completed stays (base: returned, no flag) -- ${JSON.stringify(afterFull)}`, () => {
      assert.equal(second.created.status, 200, JSON.stringify(second.created.body).slice(0, 200))
      assert.deepEqual([afterFull.sale_status, afterFull.return_state, afterFull.return_review_state], ['completed', 'full', 'pending'])
    })
    const firstId = Number(first.created.body.id)
    const secondId = Number(second.created.body.id)
    const cancel = await bulk('rt-cancel-r2', [secondId], 'completed', 'cancelled', 'cancel the second return')
    const afterCancel = await state(paidId)
    r.check(`cancelling back below full re-derives partial and clears the pending flag (got ${cancel.status}; ${JSON.stringify(afterCancel)})`, () => {
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body).slice(0, 200))
      assert.deepEqual([afterCancel.sale_status, afterCancel.return_state, afterCancel.return_review_state], ['completed', 'partial', null])
    })
    const undo = await H.historyStep(h, Number(cancel.body.actionHistoryId), 'undo', 0, 'undo the cancel')
    const afterUndo = await state(paidId)
    r.check(`Undo of the cancel gives back full + pending (got ${undo.status}; ${JSON.stringify(afterUndo)})`, () => {
      assert.equal(undo.status, 200, JSON.stringify(undo.body).slice(0, 200))
      assert.deepEqual([afterUndo.sale_status, afterUndo.return_state, afterUndo.return_review_state], ['completed', 'full', 'pending'])
    })
    const redo = await H.historyStep(h, Number(cancel.body.actionHistoryId), 'redo', 1, 'redo the cancel')
    const afterRedo = await state(paidId)
    r.check(`Redo cancels again: partial, pending cleared (got ${redo.status}; ${JSON.stringify(afterRedo)})`, () => {
      assert.equal(redo.status, 200, JSON.stringify(redo.body).slice(0, 200))
      assert.deepEqual([afterRedo.return_state, afterRedo.return_review_state], ['partial', null])
    })
    // A confirmed review (slice S4 writes it) is history: leaving full keeps it, and an Undo gives it back unchanged.
    const restoreSecond = await bulk('rt-restore-r2', [secondId], 'cancelled', 'completed', 'restore the second return (full again)')
    const afterRestoreSecond = await state(paidId)
    await h.db.prepare("UPDATE sales SET return_review_state='confirmed' WHERE id=?").bind(paidId).run()
    const cancelConfirmed = await bulk('rt-cancel-r2-confirmed', [secondId], 'completed', 'cancelled', 'cancel the second return (review confirmed)')
    const afterCancelConfirmed = await state(paidId)
    const undoConfirmed = await H.historyStep(h, Number(cancelConfirmed.body.actionHistoryId), 'undo', 0, 'undo that cancel')
    const afterUndoConfirmed = await state(paidId)
    r.check(`a restore back to full raises pending again; a CONFIRMED review survives leaving full and its Undo (${restoreSecond.status} ${JSON.stringify(afterRestoreSecond)} / ${cancelConfirmed.status} ${JSON.stringify(afterCancelConfirmed)} / ${undoConfirmed.status} ${JSON.stringify(afterUndoConfirmed)})`, () => {
      for (const result of [restoreSecond, cancelConfirmed, undoConfirmed]) assert.equal(result.status, 200, JSON.stringify(result.body).slice(0, 200))
      assert.deepEqual([afterRestoreSecond.return_state, afterRestoreSecond.return_review_state], ['full', 'pending'])
      assert.deepEqual([afterCancelConfirmed.return_state, afterCancelConfirmed.return_review_state], ['partial', 'confirmed'])
      assert.deepEqual([afterUndoConfirmed.return_state, afterUndoConfirmed.return_review_state], ['full', 'confirmed'])
    })
    const cancelAll = await bulk('rt-cancel-all', [firstId, secondId], 'completed', 'cancelled', 'cancel both returns')
    const afterNone = await state(paidId)
    r.check(`no live return left: the tag clears to NULL, still Completed (got ${cancelAll.status}; ${JSON.stringify(afterNone)})`, () => {
      assert.equal(cancelAll.status, 200, JSON.stringify(cancelAll.body).slice(0, 200))
      assert.deepEqual([afterNone.sale_status, afterNone.return_state], ['completed', null])
    })
    const restore = await bulk('rt-restore-r1', [firstId], 'cancelled', 'completed', 'restore the first return')
    const afterRestore = await state(paidId)
    r.check(`restoring re-derives partial (got ${restore.status}; ${JSON.stringify(afterRestore)})`, () => {
      assert.equal(restore.status, 200, JSON.stringify(restore.body).slice(0, 200))
      assert.deepEqual([afterRestore.sale_status, afterRestore.return_state], ['completed', 'partial'])
    })
    const replayed = await h.call('POST', '/api/returns/bulk', sent.get('rt-restore-r1'), 'replay the same restore request')
    const afterReplay = await state(paidId)
    r.check('a replayed request applies nothing twice', () => {
      assert.equal(replayed.status, 200)
      assert.deepEqual(afterReplay, afterRestore)
    })

    // ---- Not Paid sale: return, full return, loyalty --------------------------------------------------
    const unpaid = await H.createSale(h, { key: 'rt-unpaid', status: 'awaiting_payment', lines: [{ productId: 401, quantity: 5 }], label: 'create Not Paid $10 (loyalty on)' })
    const unpaidId = Number(unpaid.body.id)
    const unpaidLine = unpaid.body.sale.items[0].id
    const flagsBorn = await earning(unpaidId)
    const unpaidReturn = await H.customerReturn(h, { key: 'rt-unpaid-r1', saleId: unpaidId, lines: [{ saleItemId: unpaidLine, productId: 401, quantity: 2 }], label: 'return $4 on Not Paid' })
    const unpaidPartial = await state(unpaidId)
    const flagsAfterReturn = await earning(unpaidId)
    r.check(`a return on a Not Paid sale keeps Not Paid in the column (base: partial_return) -- ${JSON.stringify(unpaidPartial)}`, () => {
      assert.equal(unpaidReturn.created.status, 200, JSON.stringify(unpaidReturn.created.body).slice(0, 200))
      assert.deepEqual([unpaidPartial.sale_status, unpaidPartial.return_state], ['awaiting_payment', 'partial'])
    })
    r.check(`loyalty 0251: the return is not a first payment (base: the relabel fired loyalty_sale_first_earning) -- flags ${JSON.stringify(flagsBorn)} -> ${JSON.stringify(flagsAfterReturn)}`, () => {
      assert.deepEqual(flagsAfterReturn, flagsBorn)
      assert.deepEqual(flagsAfterReturn, [])
    })
    const unpaidFull = await H.customerReturn(h, { key: 'rt-unpaid-r2', saleId: unpaidId, lines: [{ saleItemId: unpaidLine, productId: 401, quantity: 3 }], label: 'return the rest on Not Paid (debt to $0)' })
    const unpaidFullState = await state(unpaidId)
    const notPaidList = await listIds('awaiting_payment')
    const returnedList = await listIds('returned')
    const owed = await h.all("SELECT owed_reduction_usd FROM returns WHERE sale_id=? AND COALESCE(status,'completed')<>'cancelled' ORDER BY id", unpaidId)
    r.check(`fully returned with $0 left owing: still Not Paid, tagged full, flagged pending, no cash out (base: returned) -- ${JSON.stringify(unpaidFullState)} owed ${JSON.stringify(owed)}`, () => {
      assert.equal(unpaidFull.created.status, 200, JSON.stringify(unpaidFull.created.body).slice(0, 200))
      assert.deepEqual([unpaidFullState.sale_status, unpaidFullState.return_state, unpaidFullState.return_review_state], ['awaiting_payment', 'full', 'pending'])
      assert.deepEqual(owed.map(row => Number(row.owed_reduction_usd)), [4, 6])
      assert.ok(notPaidList.includes(unpaidId), 'listed under Not Paid')
      assert.ok(returnedList.includes(unpaidId), 'and under its full-return tag')
    })
    const flagsAfterFull = await earning(unpaidId)
    r.check(`still no first-payment flag after the full return -- ${JSON.stringify(flagsAfterFull)}`, () => assert.deepEqual(flagsAfterFull, []))

    // ---- A return taken back on a sale settled since: refused, never hidden ----------------------------
    const settleThenCancel = await H.createSale(h, { key: 'rt-settled', status: 'awaiting_payment', lines: [{ productId: 401, quantity: 5 }], label: 'create Not Paid $10 (settled later)' })
    const settledId = Number(settleThenCancel.body.id)
    const settledReturn = await H.customerReturn(h, { key: 'rt-settled-r1', saleId: settledId, lines: [{ saleItemId: settleThenCancel.body.sale.items[0].id, productId: 401, quantity: 2 }], label: 'return $4 (lowers the debt)' })
    const settle = await h.call('PATCH', `/api/sales/${settledId}/status`, { sale_status: 'completed', client_request_id: 'rt-settle', expected_exchange_rate: 4000,
      payment_details: [{ method: 'Cash', amount_usd: 6, amount_khr: 0 }] }, 'settle the $6 left')
    const settledBefore = await state(settledId)
    const reopen = await bulk('rt-settled-cancel', [Number(settledReturn.created.body.id)], 'completed', 'cancelled', 'cancel the debt-lowering return after settlement')
    const settledAfter = await state(settledId)
    const settledReturnRow = await h.one('SELECT status FROM returns WHERE id=?', Number(settledReturn.created.body.id))
    r.check(`taking back a debt-lowering return on a sale paid since is refused with a stable code (base: relabelled the paid sale Not Paid) -- ${reopen.status} ${reopen.body.code}`, () => {
      assert.equal(settle.status, 200, JSON.stringify(settle.body).slice(0, 200))
      assert.equal(reopen.status, 409)
      assert.equal(reopen.body.code, 'return_reopens_paid_sale_debt')
      assert.deepEqual(settledAfter, settledBefore)
      assert.equal(settledReturnRow.status, 'completed')
    })

    // ---- Imported (v0) Not Paid sales: NULL rate, and the replacement (finding E) -----------------------
    const noRate = await H.importSale(h, 61, 'awaiting_payment', [{ productId: 401, name: 'RT Lipstick', quantity: 5, price: 2 }], { paidUsd: 3, jobId: 'rt-job' })
    await h.db.prepare('UPDATE sales SET exchange_rate=NULL WHERE id=?').bind(noRate.sale.id).run()
    const noRateReturn = await legacyReturn('rt-no-rate', noRate.sale.id, noRate.items[0].id, 401, 2, 2)
    const noRateRow = await h.one('SELECT owed_reduction_usd,refund_currency FROM returns WHERE sale_id=?', noRate.sale.id)
    r.check(`a USD-only Not Paid sale booked without a rate takes a return; the $4 lowers the $7 debt (base: 409 customer_return_owed_unreadable) -- ${noRateReturn.status} ${noRateReturn.body.code || ''} ${JSON.stringify(noRateRow)}`, () => {
      assert.equal(noRateReturn.status, 200, JSON.stringify(noRateReturn.body).slice(0, 200))
      assert.equal(Number(noRateRow.owed_reduction_usd), 4)
    })
    const rielNoRate = await H.importSale(h, 62, 'awaiting_payment', [{ productId: 401, name: 'RT Lipstick', quantity: 5, price: 2 }], { paidUsd: 0, jobId: 'rt-job' })
    await h.db.prepare('UPDATE sales SET exchange_rate=0, amount_paid_khr=4000 WHERE id=?').bind(rielNoRate.sale.id).run()
    const rielRefused = await legacyReturn('rt-riel-no-rate', rielNoRate.sale.id, rielNoRate.items[0].id, 401, 2, 2)
    const rielRows = await h.one('SELECT COUNT(*) AS n FROM returns WHERE sale_id=?', rielNoRate.sale.id)
    r.check(`control: riel paid at no readable rate is still refused with the stable code and writes nothing -- ${rielRefused.status} ${rielRefused.body.code}`, () => {
      assert.equal(rielRefused.status, 409)
      assert.equal(rielRefused.body.code, 'customer_return_owed_unreadable')
      assert.equal(Number(rielRows.n), 0)
    })

    const exchange = await H.importSale(h, 63, 'awaiting_payment', [{ productId: 401, name: 'RT Lipstick', quantity: 5, price: 2 }], { paidUsd: 0, jobId: 'rt-job' })
    const swap = await legacyReturn('rt-exchange', exchange.sale.id, exchange.items[0].id, 401, 2, 2,
      { replacement_items: [{ product_id: 402, quantity: 1, branch_id: 1, batch_id: 5402, applied_price_usd: 4 }] })
    const original = await state(exchange.sale.id)
    const replacementId = Number(swap.body.replacementSaleId)
    const replacement = replacementId ? await h.one('SELECT sale_status,amount_paid_usd,amount_paid_khr,payment_method,payment_details,total_usd,return_state FROM sales WHERE id=?', replacementId) : null
    const swapReturn = await h.one('SELECT owed_reduction_usd,total_refund_usd FROM returns WHERE sale_id=?', exchange.sale.id)
    const listed = (await h.call('GET', H.fresh('/api/sales?limit=200'), undefined, 'sales list (owed)', { observe: true })).body
    const owes = id => { const row = listed.find(candidate => Number(candidate.id) === id); return Number((Number(row.net_total_usd) - Number(row.amount_paid_usd) - Number(row.amount_paid_khr || 0) / 4000).toFixed(4)) }
    r.check(`a replacement on a Not Paid sale is accepted (base: 409 return_replacement_on_debt) -- ${swap.status} ${swap.body.code || ''}`, () => {
      assert.equal(swap.status, 200, JSON.stringify(swap.body).slice(0, 200))
    })
    r.check(`the replacement is Not Paid with no tender invented; the original stays Not Paid -- original ${JSON.stringify(original)} replacement ${JSON.stringify(replacement)}`, () => {
      assert.deepEqual([original.sale_status, original.return_state], ['awaiting_payment', 'partial'])
      assert.equal(replacement.sale_status, 'awaiting_payment')
      assert.deepEqual([Number(replacement.amount_paid_usd), Number(replacement.amount_paid_khr), replacement.payment_method, replacement.payment_details], [0, 0, null, '[]'])
      assert.equal(Number(swapReturn.owed_reduction_usd), 4)
    })
    r.check(`an even exchange leaves the customer owing what they owed: $${owes(exchange.sale.id)} + $${owes(replacementId)} = $10`, () => {
      assert.equal(Number((owes(exchange.sale.id) + owes(replacementId)).toFixed(4)), 10)
    })
    const paidImport = await H.importSale(h, 64, 'completed', [{ productId: 401, name: 'RT Lipstick', quantity: 5, price: 2 }], { jobId: 'rt-job' })
    const paidSwap = await legacyReturn('rt-exchange-paid', paidImport.sale.id, paidImport.items[0].id, 401, 2, 2,
      { replacement_items: [{ product_id: 402, quantity: 1, branch_id: 1, batch_id: 5402, applied_price_usd: 4 }] })
    const paidReplacement = await h.one('SELECT sale_status,amount_paid_usd,payment_method FROM sales WHERE id=?', Number(paidSwap.body.replacementSaleId))
    r.check(`control: on a paid sale the replacement keeps its tender rule (Completed, Cash $4) -- ${JSON.stringify(paidReplacement)}`, () => {
      assert.equal(paidSwap.status, 200, JSON.stringify(paidSwap.body).slice(0, 200))
      assert.deepEqual([paidReplacement.sale_status, Number(paidReplacement.amount_paid_usd), paidReplacement.payment_method], ['completed', 4, 'Cash'])
    })

    // ---- A row a previous Worker labelled: its tag needs the word gone; past full rows are not flagged ---
    const legacy = await H.createSale(h, { key: 'rt-legacy', status: 'awaiting_payment', lines: [{ productId: 401, quantity: 4 }], label: 'create Not Paid $8 (relabelled below)' })
    const legacyId = Number(legacy.body.id)
    const legacyLine = legacy.body.sale.items[0].id
    await H.customerReturn(h, { key: 'rt-legacy-r1', saleId: legacyId, lines: [{ saleItemId: legacyLine, productId: 401, quantity: 1 }], label: 'return 1 of 4' })
    await h.db.prepare("UPDATE sales SET sale_status='partial_return',status_before_return='awaiting_payment',return_state=NULL WHERE id=?").bind(legacyId).run()
    await h.db.prepare('DELETE FROM system_flags WHERE key LIKE ?').bind(`loyalty_sale_earning:${legacyId}:%`).run()
    const pastFull = await H.createSale(h, { key: 'rt-past-full', lines: [{ productId: 401, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: 'create sale fully returned before 0263' })
    await H.customerReturn(h, { key: 'rt-past-full-r1', saleId: Number(pastFull.body.id), lines: [{ saleItemId: pastFull.body.sale.items[0].id, productId: 401, quantity: 1 }], label: 'return it fully' })
    await h.db.prepare("UPDATE sales SET sale_status='returned',status_before_return='completed',return_state=NULL,return_review_state=NULL WHERE id=?").bind(Number(pastFull.body.id)).run()
    const pastBefore = await state(Number(pastFull.body.id))
    const legacyFull = await H.customerReturn(h, { key: 'rt-legacy-r2', saleId: legacyId, lines: [{ saleItemId: legacyLine, productId: 401, quantity: 3 }], label: 'return the rest of the relabelled sale' })
    const legacyAfter = await state(legacyId)
    const legacyFlags = await earning(legacyId)
    r.check(`a retired label is rewritten to the payment state it stood for when the tag moves -- Not Paid stays Not Paid, no loyalty flag (got ${legacyFull.created.status}; ${JSON.stringify(legacyAfter)} flags ${JSON.stringify(legacyFlags)})`, () => {
      assert.equal(legacyFull.created.status, 200, JSON.stringify(legacyFull.created.body).slice(0, 200))
      assert.deepEqual([legacyAfter.sale_status, legacyAfter.return_state, legacyAfter.return_review_state], ['awaiting_payment', 'full', 'pending'])
      assert.deepEqual(legacyFlags, [])
    })
    const pastAfter = await state(Number(pastFull.body.id))
    r.check(`a sale fully returned before the tags is left as it was -- no backfilled flag (${JSON.stringify(pastAfter)})`, () => {
      assert.deepEqual(pastAfter, pastBefore)
      assert.equal(pastAfter.return_review_state, null)
    })

    // ---- D1 budget: bulk restore of 25 returns on 25 sales ------------------------------------------------
    const many = []
    const setupFrom = h.metrics.length
    for (let index = 0; index < 25; index++) {
      const sale = await H.createSale(h, { key: `rt-many-${index}`, lines: [{ productId: 402, quantity: 2 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 8, amount_khr: 0 }], label: `setup sale ${index}` })
      const created = await H.customerReturn(h, { key: `rt-many-r${index}`, saleId: Number(sale.body.id),
        lines: [{ saleItemId: sale.body.sale.items[0].id, productId: 402, quantity: index % 2 ? 1 : 2 }], label: `setup return ${index}` })
      many.push({ saleId: Number(sale.body.id), returnId: Number(created.created.body.id) })
    }
    for (const entry of h.metrics.slice(setupFrom)) entry.setup = true
    const cancelMany = await bulk('rt-many-cancel', many.map(entry => entry.returnId), 'completed', 'cancelled', 'bulk cancel 25 returns (25 sales)')
    const restoreMany = await bulk('rt-many-restore', many.map(entry => entry.returnId), 'cancelled', 'completed', 'bulk restore 25 returns (25 sales)')
    const undoMany = await H.historyStep(h, Number(restoreMany.body.actionHistoryId), 'undo', 0, 'undo the bulk restore of 25')
    const redoMany = await H.historyStep(h, Number(restoreMany.body.actionHistoryId), 'redo', 1, 'redo the bulk restore of 25')
    const manyStates = await h.all(`SELECT id,sale_status,return_state,return_review_state FROM sales WHERE id IN (${many.map(entry => entry.saleId).join(',')}) ORDER BY id`)
    r.check(`25-return bulk cancel / restore / undo / redo all commit and leave each tag right (${[cancelMany, restoreMany, undoMany, redoMany].map(x => x.status).join(',')})`, () => {
      for (const result of [cancelMany, restoreMany, undoMany, redoMany]) assert.equal(result.status, 200, JSON.stringify(result.body).slice(0, 200))
      manyStates.forEach((row, index) => assert.deepEqual([row.sale_status, row.return_state, row.return_review_state], ['completed', index % 2 ? 'partial' : 'full', index % 2 ? null : 'pending'], `sale ${row.id}`))
    })

    const retired = await h.all("SELECT id,sale_status FROM sales WHERE sale_status IN ('partial_return','returned') AND id<>?", Number(pastFull.body.id))
    r.check(`no returns writer left a retired status word (base: every returned sale) -- ${JSON.stringify(retired)}`, () => assert.deepEqual(retired, []))

    // Single-record requests must fit the Free per-request limit. A 25-return group moves stock for every
    // member and was over it before this lane; its counts are printed for the report and bounded by Paid.
    const groups = h.metrics.filter(entry => /25/.test(entry.label) && !entry.setup)
    for (const entry of groups) entry.observe = true
    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst single-record request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT)
    })
    r.check(`D1 budget: 25-return groups ${groups.map(entry => `${entry.label}=${entry.statements}`).join(', ')} fit Paid ${H.PAID_QUERY_LIMIT}`, () => {
      assert.ok(groups.length === 4 && groups.every(entry => entry.statements <= H.PAID_QUERY_LIMIT))
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} sale return tags: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
