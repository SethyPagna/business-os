'use strict'
// Security follow-up B (release review a77883c78, should-fix 2 and 5). The whole Worker on workerd + D1
// (harness/al_money_native.cjs), a real admin and a real second employee.
//
// POST /api/returns/supplier looked its duplicate up by the bare client_request_id across every user:
//   - another account that sent the same id was handed that account's return id and number;
//   - a resend under the same id with a DIFFERENT body was answered duplicate:true and the new return was dropped
//     silently (the stock it asked to send back never left).
// The customer return keys (actor_id, request_id) + a digest of the request in return_create_receipts. The supplier
// return now writes the same receipt in the same atomic batch as the return:
//   1. same actor + same id + same request          -> the original result (duplicate:true), nothing written again;
//      device / clock fields and the return-number label are not part of the request;
//   2. same actor + same id + a different request   -> 409 idempotency_conflict, nothing written;
//   3. another actor + the same id (any body)       -> 409 idempotency_conflict naming nothing of the other return;
//   4. two identical requests at once               -> one return, one stock movement;
//   5. a request with no id (older callers)         -> still records, writes no receipt;
//   6. an id or return number the receipt cannot hold -> refused 400 before any write.
// And the raw database text that leaked into two 500 answers is gone:
//   7. a supplier return whose batch fails          -> fixed text + code supplier_return_failed, detail in the log only;
//   8. a return edit whose batch fails              -> fixed text + code return_edit_failed.
// Checks marked "base:" are the ones that are red on a77883c78. Run with BASE_COMMIT=a77883c78 to bundle the Worker's
// modified files as that commit had them (harness basePatches) and watch them go red.
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const h = await H.startWorker({ patches: process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : [] })
  const r = H.recorder('SUPPLIER-ID')
  try {
    await H.seedProduct(h, 801, 'Supplier idempotency A', 10, 40, 2)
    await H.seedProduct(h, 802, 'Supplier idempotency B', 10, 40, 2)
    const stock = async (id = 801) => Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', id)).quantity)
    const supplierReturns = async () => Number((await h.one("SELECT COUNT(*) AS n FROM returns WHERE return_scope='supplier'")).n)
    const receipts = () => h.all("SELECT actor_id,request_id,return_id,sale_id,json_extract(response_json,'$.returnNumber') AS number FROM return_create_receipts ORDER BY occurred_at")
    const supplier = (over = {}, options = {}) => h.call('POST', '/api/returns/supplier', {
      client_request_id: 'sup-idem-1', branch_id: 1, supplier_name: 'Synthetic supplier', reason: 'Synthetic', settlement: 'refund',
      items: [{ product_id: 801, quantity: 1, cost_price_usd: 2, cost_price_khr: 8000 }], ...over }, over.client_request_id || 'supplier return (no id)', options)
    const employee = await h.addEmployee(1921, 'sup-idem-employee', { returns: true, product_cost_view: true, product_cost_edit: true })

    // ---- 1. the first request, then the same request again ----------------------------------------------------------
    const first = await supplier()
    const afterFirst = { stock: await stock(), count: await supplierReturns(), receipts: await receipts() }
    r.check(`base: the first request records one supplier return and its receipt (${first.status}); 801: 40 -> 39`, () => {
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.deepEqual([afterFirst.stock, afterFirst.count], [39, 1])
      assert.equal(afterFirst.receipts.length, 1, 'one receipt')
      const [row] = afterFirst.receipts
      assert.deepEqual([row.actor_id, row.request_id, row.return_id, row.sale_id, row.number], [901, 'sup-idem-1', first.body.id, null, first.body.returnNumber])
    })

    const replay = await supplier({ clientTime: '2026-10-21T01:00:00Z', deviceName: 'Another till', deviceTz: 'Asia/Phnom_Penh', return_number: 'SRET-RETRY-LABEL', cashier_id: 5 })
    const afterReplay = { stock: await stock(), count: await supplierReturns(), receipts: (await receipts()).length }
    r.check(`the same request resent (other device fields and return-number label) replays the original and writes nothing -- ${replay.status} ${JSON.stringify(replay.body)} ${JSON.stringify(afterReplay)}`, () => {
      assert.equal(replay.status, 200, JSON.stringify(replay.body))
      assert.deepEqual([replay.body.id, replay.body.returnNumber, replay.body.duplicate], [first.body.id, first.body.returnNumber, true])
      assert.deepEqual(afterReplay, { stock: 39, count: 1, receipts: 1 })
    })

    // ---- 2. same id, different request ---------------------------------------------------------------------------------
    const changed = await supplier({ items: [{ product_id: 801, quantity: 3, cost_price_usd: 2, cost_price_khr: 8000 }] })
    const settlementChanged = await supplier({ settlement: 'writeoff' })
    const compensationUnknown = await supplier({ supplier_compensation_usd: null })
    const afterChanged = { stock: await stock(), count: await supplierReturns() }
    r.check(`base: the same id with a changed body is refused 409 idempotency_conflict, never duplicate:true -- ${changed.status} ${JSON.stringify(changed.body)}`, () => {
      assert.equal(changed.status, 409)
      assert.equal(changed.body.code, 'idempotency_conflict')
      assert.notEqual(changed.body.duplicate, true)
      assert.equal(changed.body.id, undefined)
    })
    r.check(`base: a changed settlement and an explicit null compensation are different requests too -- ${settlementChanged.status}/${compensationUnknown.status}`, () => {
      assert.equal(settlementChanged.status, 409, JSON.stringify(settlementChanged.body))
      assert.equal(compensationUnknown.status, 409, JSON.stringify(compensationUnknown.body))
    })
    r.check(`the refused changes wrote nothing: ${JSON.stringify(afterChanged)}`, () => assert.deepEqual(afterChanged, { stock: 39, count: 1 }))

    // ---- 3. another account, the same id ------------------------------------------------------------------------------------
    const ownId = await supplier({ client_request_id: 'sup-idem-employee-own' }, { cookie: employee })
    const stolenSameBody = await supplier({}, { cookie: employee })
    const stolenOtherBody = await supplier({ items: [{ product_id: 802, quantity: 2, cost_price_usd: 2, cost_price_khr: 8000 }] }, { cookie: employee })
    const leaked = JSON.stringify([stolenSameBody.body, stolenOtherBody.body])
    const afterThief = { stock801: await stock(801), stock802: await stock(802), count: await supplierReturns() }
    const ownReplay = await supplier({ client_request_id: 'sup-idem-employee-own' }, { cookie: employee })
    r.check(`control: the employee's own fresh id is recorded (${ownId.status}), so a refusal below is the id and not a permission`, () => {
      assert.equal(ownId.status, 200, JSON.stringify(ownId.body))
    })
    r.check(`base: another account's id is refused 409 and leaks neither the return id nor its number -- ${stolenSameBody.status}/${stolenOtherBody.status} ${leaked.slice(0, 160)}`, () => {
      assert.equal(stolenSameBody.status, 409, JSON.stringify(stolenSameBody.body))
      assert.equal(stolenOtherBody.status, 409, JSON.stringify(stolenOtherBody.body))
      for (const body of [stolenSameBody.body, stolenOtherBody.body]) {
        assert.equal(body.code, 'idempotency_conflict')
        assert.equal(body.duplicate, undefined)
        assert.equal(body.id, undefined)
        assert.equal(body.returnNumber, undefined)
      }
      assert.ok(!leaked.includes(first.body.returnNumber), 'the other return number is not echoed')
    })
    r.check(`the refused requests wrote nothing: ${JSON.stringify(afterThief)} (801: 39 - the employee's own 1)`, () => assert.deepEqual(afterThief, { stock801: 38, stock802: 40, count: 2 }))
    r.check(`the owner of an id still replays it (${ownReplay.status} duplicate ${ownReplay.body.duplicate})`, () => {
      assert.deepEqual([ownReplay.status, ownReplay.body.id, ownReplay.body.duplicate], [200, ownId.body.id, true])
    })

    // ---- 4. two identical requests at once ------------------------------------------------------------------------------------
    const [raceA, raceB] = await Promise.all([supplier({ client_request_id: 'sup-idem-race' }), supplier({ client_request_id: 'sup-idem-race' })])
    const raceRows = await h.all("SELECT id FROM returns WHERE client_request_id='sup-idem-race'")
    const afterRace = await stock()
    r.check(`two identical requests at once record one return, replay the other and move the shelf once -- ${raceA.status}/${raceB.status}, ${raceRows.length} row(s), 801 at ${afterRace}`, () => {
      assert.deepEqual([raceA.status, raceB.status], [200, 200], JSON.stringify([raceA.body, raceB.body]))
      assert.equal(raceRows.length, 1)
      assert.equal(raceA.body.id, raceB.body.id)
      assert.equal([raceA.body, raceB.body].filter(body => body.duplicate === true).length, 1, 'exactly one is the replay')
      assert.equal(afterRace, 37)
    })

    // ---- 5. no id: older callers keep working, with no receipt ---------------------------------------------------------------------
    const noIdA = await supplier({ client_request_id: undefined })
    const noIdB = await supplier({ client_request_id: undefined })
    const receiptCount = (await receipts()).length
    r.check(`a request without an id records every time and writes no receipt -- ${noIdA.status}/${noIdB.status}, returns ${noIdA.body.id}/${noIdB.body.id}, receipts ${receiptCount}`, () => {
      assert.deepEqual([noIdA.status, noIdB.status], [200, 200], JSON.stringify([noIdA.body, noIdB.body]))
      assert.notEqual(noIdA.body.id, noIdB.body.id)
      assert.equal(receiptCount, 3, 'admin first + employee own + race; none for the no-id requests')
    })

    // ---- 6. ids the receipt table cannot hold are refused before any write ----------------------------------------------------------
    const countBefore = await supplierReturns()
    const longNumber = await supplier({ client_request_id: 'sup-idem-long-number', return_number: 'X'.repeat(121) })
    const longId = await supplier({ client_request_id: 'é'.repeat(61) })
    const countAfter = await supplierReturns()
    r.check(`a 121-byte return number and a 122-byte id are refused 400 invalid_client_request_id and write nothing -- ${longNumber.status}/${longId.status}, ${countBefore} -> ${countAfter}`, () => {
      assert.deepEqual([longNumber.status, longId.status], [400, 400], JSON.stringify([longNumber.body, longId.body]))
      assert.equal(longNumber.body.code, 'invalid_client_request_id')
      assert.equal(countAfter, countBefore)
    })

    // ---- 7. raw database text no longer reaches the answer ------------------------------------------------------------------------------
    await h.db.prepare(`CREATE TRIGGER sup_boom BEFORE INSERT ON return_items WHEN NEW.product_name='Boom Product'
      BEGIN SELECT RAISE(ABORT,'SECRET-INTERNAL-DETAIL'); END`).run()
    const boom = await supplier({ client_request_id: 'sup-idem-boom', items: [{ product_id: 802, product_name: 'Boom Product', quantity: 1, cost_price_usd: 2, cost_price_khr: 8000 }] })
    const boomText = JSON.stringify(boom.body)
    const boomState = await h.one("SELECT (SELECT COUNT(*) FROM returns WHERE client_request_id='sup-idem-boom') AS returns, (SELECT COUNT(*) FROM return_create_receipts WHERE request_id='sup-idem-boom') AS receipts")
    const boomStock = await stock(802)
    await h.db.prepare('DROP TRIGGER sup_boom').run()
    r.check(`base: a failing supplier return answers fixed text + code, not the database message -- ${boom.status} ${boomText.slice(0, 200)}`, () => {
      assert.equal(boom.status, 500)
      assert.equal(boom.body.code, 'supplier_return_failed')
      assert.ok(!/SECRET-INTERNAL-DETAIL|D1_ERROR|SQLITE|constraint/i.test(boomText), 'no database text in the answer')
      assert.equal(typeof boom.body.error, 'string')
    })
    r.check(`the failed batch left no return, no receipt and the same shelf: ${JSON.stringify(boomState)}, 802 at ${boomStock}`, () => {
      assert.deepEqual([Number(boomState.returns), Number(boomState.receipts), boomStock], [0, 0, 40])
    })

    // ---- 8. the return edit's 500 ------------------------------------------------------------------------------------------------------------
    await H.seedProduct(h, 803, 'Edit target', 5, 20, 1)
    const imported = await H.importSale(h, 811, 'completed', [{ productId: 803, name: 'Edit target', quantity: 4, price: 5 }], { jobId: 'sup-idem-job' })
    const made = await h.call('POST', '/api/returns', { client_request_id: 'sup-idem-edit-create', sale_id: imported.sale.id, reason: 'Edit probe', return_type: 'restock',
      items: [{ sale_item_id: imported.items[0].id, product_id: 803, quantity: 1, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }] }, 'create a return to edit')
    r.check(`setup: the legacy return to edit is recorded (${made.status})`, () => assert.equal(made.status, 200, JSON.stringify(made.body)))
    await h.db.prepare(`CREATE TRIGGER edit_boom BEFORE INSERT ON return_items WHEN NEW.quantity=2
      BEGIN SELECT RAISE(ABORT,'SECRET-EDIT-DETAIL'); END`).run()
    const updatedAt = (await h.one('SELECT updated_at FROM returns WHERE id=?', made.body.id)).updated_at
    const edit = await h.call('PATCH', `/api/returns/${made.body.id}`, { client_request_id: 'sup-idem-edit-1', expected_updated_at: updatedAt, reason: 'Edit probe',
      items: [{ sale_item_id: imported.items[0].id, product_id: 803, quantity: 2, applied_price_usd: 5, return_to_stock: true, stock_action: 'restock', branch_id: 1 }] }, 'failing edit')
    await h.db.prepare('DROP TRIGGER edit_boom').run()
    const editText = JSON.stringify(edit.body)
    r.check(`base: a failing return edit answers fixed text + code, not the database message -- ${edit.status} ${editText.slice(0, 200)}`, () => {
      assert.equal(edit.status, 500)
      assert.equal(edit.body.code, 'return_edit_failed')
      assert.ok(!/SECRET-EDIT-DETAIL|D1_ERROR|SQLITE|constraint/i.test(editText), 'no database text in the answer')
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} supplier return idempotency: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
