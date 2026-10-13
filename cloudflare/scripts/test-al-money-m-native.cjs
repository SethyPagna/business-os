'use strict'
// AL-M (side finding M, Records/Lanes/2026-10-12/AL-MONEY-REPRO.md): a sale
// cancellation must never block a customer return, against the WHOLE Worker
// on workerd + D1.
//
// inventory_movements.reference_id carries no reference kind. Cancelling sale
// N writes movement_type 'return' with reference_id N (saleTransitions.ts),
// and the return-create postcondition counted movements by reference_id
// alone, so return id N was refused with write_conflict -- and because a
// refused insert does not consume the AUTOINCREMENT id, every later customer
// return got the same id and the same refusal. This file was the first block
// of test-al-money-g-native.cjs (0a78962f0); it lives on its own so the M fix
// is not tied to finding G's by-design RED, and it adds the case a
// product-membership filter cannot pass.
//
// Transition table pinned here (product P, one unit per line):
//
//   sale A (P) cancelled             -> +1 P, movement 'return' ref A
//   return R on sale B, R == A, P    -> +1 P exactly once, own movement ref R
//   same return request replayed     -> 0 (idempotent receipt, same id)
//   cancel R (bulk)                  -> -1 P
//   restore R (bulk)                 -> +1 P
//
// Cases:
//   1. the original repro: the cancelled sale and the return share only the
//      id (different products);
//   2. discriminating: the cancelled sale and the return share the id AND the
//      product, so "does return R contain this product?" (the membership rule
//      movementReference.ts uses for ledger labels) still claims the sale's
//      row -- only a filter on the movement's own batch passes;
//   3. control: with the return sequence moved past every sale id the same
//      kind of return succeeds (it did on bf7408b49 too).
//
// Harness: test-al-money-c-native.cjs.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker({ returnIdFloor: 0 })
  const r = H.recorder('AL-M')
  try {
    for (const [id, name] of [[701, 'AL-M Cancelled Mascara'], [702, 'AL-M Returned Gel'], [703, 'AL-M Shared Serum'], [704, 'AL-M Control Toner']]) {
      await H.seedProduct(h, id, name, 10, 100)
    }
    const paid = amount => [{ method: 'Cash', amount_usd: amount, amount_khr: 0 }]
    const nextReturnId = async () => Number((await h.one("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='returns'),0)+1 AS id")).id)
    const stock = async productId => {
      const row = await h.one(`SELECT p.stock_quantity AS product, (SELECT quantity FROM branch_stock WHERE product_id=p.id AND branch_id=1) AS branch,
        (SELECT quantity FROM branch_batch_stock WHERE batch_id=p.id+5000 AND branch_id=1) AS lot FROM products p WHERE p.id=?`, productId)
      return { product: Number(row.product), branch: Number(row.branch), lot: Number(row.lot) }
    }
    const cancelSale = (sale, key, label) => h.call('PATCH', `/api/sales/${sale.body.id}/status`,
      { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: key }, label)

    // ---- 1. Original repro: same id, different products ---------------------
    const cancelledSale = await H.createSale(h, { key: 'al-m-cancelled', status: 'completed', lines: [{ productId: 701, quantity: 1 }], paymentDetails: paid(10), label: 'M sale A' })
    const cancel = await cancelSale(cancelledSale, 'al-m-cancel', 'M cancel sale A')
    const otherSale = await H.createSale(h, { key: 'al-m-other', status: 'completed', lines: [{ productId: 702, quantity: 2 }], paymentDetails: paid(20), label: 'M sale B' })
    const firstId = await nextReturnId()
    const colliding = await h.one("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id=? AND movement_type='return'", firstId)
    const blocked = await H.customerReturn(h, { key: 'al-m-return', saleId: otherSale.body.id,
      lines: [{ saleItemId: otherSale.body.sale.items[0].id, productId: 702, quantity: 1 }], label: 'M return on sale B (next return id = cancelled sale id)' })
    const blockedErrors = (await h.call('GET', '/__fixture/d1-errors')).body
    r.check(`1: a cancelled sale never blocks an unrelated return (sale ${cancelledSale.body.id} cancelled ${cancel.status}; next return id ${firstId} has ${colliding.n} 'return' movement(s) on that reference; create ${blocked.created && blocked.created.status}${blocked.created && blocked.created.body.code ? ' ' + blocked.created.body.code : ''}; D1: ${blockedErrors[0] || 'none'})`, () => {
      assert.equal(cancel.status, 200)
      assert.equal(firstId, Number(cancelledSale.body.id), 'fixture: the next return id must equal the cancelled sale id')
      assert.equal(Number(colliding.n), 1, 'fixture: the cancellation wrote one sale-keyed return movement on that id')
      assert.equal(blocked.created && blocked.created.status, 200)
      assert.equal(Number(blocked.created.body.id), firstId)
    })

    // ---- 2. Same id AND same product ----------------------------------------
    // Sale C (P) is cancelled, sale D (P) is returned with return id == C.
    const saleC = await H.createSale(h, { key: 'al-m-shared-cancelled', status: 'completed', lines: [{ productId: 703, quantity: 1 }], paymentDetails: paid(10), label: 'M sale C (shared product)' })
    const cancelC = await cancelSale(saleC, 'al-m-shared-cancel', 'M cancel sale C')
    const saleD = await H.createSale(h, { key: 'al-m-shared-returned', status: 'completed', lines: [{ productId: 703, quantity: 2 }], paymentDetails: paid(20), label: 'M sale D (shared product)' })
    await H.setReturnIdFloor(h.db, Number(saleC.body.id) - 1)
    const sharedId = await nextReturnId()
    const stockBefore = await stock(703)
    const sharedLines = [{ saleItemId: saleD.body.sale.items[0].id, productId: 703, quantity: 1 }]
    const shared = await H.customerReturn(h, { key: 'al-m-shared-return', saleId: saleD.body.id, lines: sharedLines, label: 'M return on sale D (same id and product as cancelled sale C)' })
    const sharedErrors = (await h.call('GET', '/__fixture/d1-errors')).body
    const stockAfter = await stock(703)
    const ownMovements = await h.all(`SELECT id,movement_type,quantity FROM inventory_movements WHERE reference_id=? AND movement_type='return' AND reason LIKE 'Return:%' ORDER BY id`, sharedId)
    const saleMovements = await h.all(`SELECT id,quantity,reason FROM inventory_movements WHERE reference_id=? AND movement_type='return' AND COALESCE(reason,'') NOT LIKE 'Return:%' ORDER BY id`, sharedId)
    r.check(`2: same id and same product -- the return is created and restocks once (cancel C ${cancelC.status}; return id ${sharedId} vs sale C ${saleC.body.id}; create ${shared.created && shared.created.status}${shared.created && shared.created.body.code ? ' ' + shared.created.body.code : ''}; stock ${JSON.stringify(stockBefore)} -> ${JSON.stringify(stockAfter)}; D1: ${sharedErrors[0] || 'none'})`, () => {
      assert.equal(cancelC.status, 200)
      assert.equal(sharedId, Number(saleC.body.id), 'fixture: the next return id must equal cancelled sale C')
      assert.equal(saleMovements.length, 1, 'fixture: sale C left exactly one sale-keyed return movement on that id')
      assert.equal(shared.created && shared.created.status, 200)
      assert.equal(Number(shared.created.body.id), sharedId)
      assert.deepEqual(stockAfter, { product: stockBefore.product + 1, branch: stockBefore.branch + 1, lot: stockBefore.lot + 1 })
      assert.deepEqual(ownMovements.map(row => [row.movement_type, Number(row.quantity)]), [['return', 1]], 'exactly one movement of its own')
    })

    // Double apply: the same request again is the recorded answer, not a second restock.
    const replay = await h.call('POST', '/api/returns', { client_request_id: 'al-m-shared-return', money_precision_version: 1, sale_id: saleD.body.id,
      reason: 'AL money probe', expected_quote: (({ customer_return_create_version: _c, customer_return_edit_version: _e, ...rest }) => rest)(shared.quote.body),
      items: sharedLines.map(line => ({ sale_item_id: line.saleItemId, product_id: line.productId, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })) }, 'M replay the same return request')
    const stockReplay = await stock(703)
    const returnsOnD = await h.one("SELECT COUNT(*) n FROM returns WHERE sale_id=?", saleD.body.id)
    r.check(`2: replaying the same request is idempotent (replay ${replay.status} id ${replay.body.id}; ${returnsOnD.n} return(s) on sale D; stock ${JSON.stringify(stockReplay)})`, () => {
      assert.equal(replay.status, 200)
      assert.equal(Number(replay.body.id), sharedId)
      assert.equal(Number(returnsOnD.n), 1)
      assert.deepEqual(stockReplay, stockAfter)
    })

    // Reversal: cancel and restore the return; each moves the unit exactly once.
    // (Not evaluable when the create was refused: there is nothing to reverse.)
    const created = !!(shared.created && shared.created.status === 200)
    const notCreated = { status: 'not evaluable (no return was created)', body: {} }
    const cancelReturn = created ? await H.bulkReturnStatus(h, 'al-m-shared-cancel-return', sharedId, 'completed', 'cancelled', 'M cancel the return') : notCreated
    const stockCancelled = await stock(703)
    const restoreReturn = created ? await H.bulkReturnStatus(h, 'al-m-shared-restore-return', sharedId, 'cancelled', 'completed', 'M restore the return') : notCreated
    const stockRestored = await stock(703)
    const saleMovementsAfter = await h.all(`SELECT id,quantity,reason FROM inventory_movements WHERE reference_id=? AND movement_type='return' AND COALESCE(reason,'') NOT LIKE 'Return:%' AND COALESCE(reason,'') NOT LIKE '%grouped return status' ORDER BY id`, sharedId)
    r.check(`2: the return reverses and re-applies once each (cancel ${cancelReturn.status} -> ${JSON.stringify(stockCancelled)}; restore ${restoreReturn.status} -> ${JSON.stringify(stockRestored)})`, () => {
      assert.equal(cancelReturn.status, 200, JSON.stringify(cancelReturn.body).slice(0, 200))
      assert.deepEqual(stockCancelled, stockBefore)
      assert.equal(restoreReturn.status, 200, JSON.stringify(restoreReturn.body).slice(0, 200))
      assert.deepEqual(stockRestored, stockAfter)
      assert.deepEqual(saleMovementsAfter, saleMovements, "sale C's own movement is never rewritten")
    })

    // ---- 3. Control: return sequence moved past every sale id ---------------
    await H.setReturnIdFloor(h.db, 100000)
    const controlSale = await H.createSale(h, { key: 'al-m-control', status: 'completed', lines: [{ productId: 704, quantity: 2 }], paymentDetails: paid(20), label: 'M control sale' })
    const control = await H.customerReturn(h, { key: 'al-m-return-control', saleId: controlSale.body.id,
      lines: [{ saleItemId: controlSale.body.sale.items[0].id, productId: 704, quantity: 1 }], label: 'M control (return id 100001)' })
    r.check(`3: control -- with the return id moved off the sale ids the same kind of return succeeds (got ${control.created && control.created.status})`, () => {
      assert.equal(control.created && control.created.status, 200)
    })

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-M a cancelled sale never blocks a customer return: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
