'use strict'
// Finding C, bulk sibling: a sale's status after a bulk return cancel/restore must count the units its sales import
// recorded as already returned (sale_items.returned_quantity), exactly as the single-return create and edit already do
// (routes/returns.ts: importedReturnLines() joins the committed lines before projectedSaleStatusForReturnCreate /
// ...ForReturnEdit).
//
// lib/returnBulkAction.ts derived the status from return_items only, in TWO places that must agree -- the pre-read that
// feeds the sale's record events and Undo snapshot (saleStatusSnapshots) and the UPDATE the batch runs
// (saleStatusStatement). With an imported 3-unit line that came back 1 unit:
//
//   returns recorded               single return path     bulk (before the fix)
//   R1 (1) + R2 (1) + imported 1   returned               restore R2 -> partial_return   (2 of 3 counted)
//   R3 (2) + imported 1            returned               cancel R3  -> completed        (the 1 imported unit lost)
//
// RET-B E1 refuses a bulk cancel/restore on a stock-skipped sale (every sales-import:% sale), so the fixtures clear
// stock_skipped to model the legacy-sale imports migration 0235 does not mark -- the shape the capacity guard's own
// comment (lib/returnBulkAction.ts, "guards sales 0235 does not mark") names -- and the lines carry returned units on a
// sale whose status is still completed, because a bulk change on a sale already in returned/partial_return with no recorded
// pre-return status is refused outright ("pre-return status was not recorded"). Harness: test-al-money-c-native.cjs.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('RB-IMP')
  try {
    for (const [id, name] of [[911, 'RB Restore Serum'], [912, 'RB Cancel Toner'], [913, 'RB Control Balm']]) await H.seedProduct(h, id, name, 5, 40)
    const legacyShape = async (fixture) => { await h.db.prepare('UPDATE sales SET stock_skipped=0 WHERE id=?').bind(fixture.sale.id).run() }
    const restoreSale = await H.importSale(h, 21, 'completed', [{ productId: 911, name: 'RB Restore Serum', quantity: 3, price: 5, returned: 1 }])
    const cancelSale = await H.importSale(h, 22, 'completed', [{ productId: 912, name: 'RB Cancel Toner', quantity: 3, price: 5, returned: 1 }])
    const controlSale = await H.importSale(h, 23, 'completed', [{ productId: 913, name: 'RB Control Balm', quantity: 2, price: 5 }])
    for (const fixture of [restoreSale, cancelSale, controlSale]) await legacyShape(fixture)

    const recordReturn = async (fixture, key, productId, quantity) => {
      const res = await h.call('POST', '/api/returns', { client_request_id: key, sale_id: fixture.sale.id, reason: 'RB bulk status probe', return_type: 'restock',
        items: [{ sale_item_id: fixture.items[0].id, product_id: productId, quantity, applied_price_usd: 5, stock_action: 'restock', branch_id: 1 }] }, `return ${quantity} of ${productId}`)
      assert.equal(res.status, 200, `fixture return refused: ${JSON.stringify(res.body).slice(0, 200)}`)
      return Number(res.body.id)
    }
    const status = async (fixture) => (await h.one('SELECT sale_status FROM sales WHERE id=?', fixture.sale.id)).sale_status
    // The status the bulk action RECORDED for the sale (its Undo snapshot and record events are built from this value).
    const recorded = async (fixture) => {
      const rows = await h.all("SELECT payload_json FROM undo_snapshots WHERE kind='return.fields.bulk' ORDER BY id DESC")
      for (const row of rows) {
        const found = (JSON.parse(row.payload_json).saleStatuses || []).find(entry => Number(entry.saleId) === Number(fixture.sale.id))
        if (found) return found
      }
      return null
    }
    const bulk = async (key, id, source, target) => {
      const res = await H.bulkReturnStatus(h, key, id, source, target, `bulk ${source}->${target} return ${id}`)
      assert.equal(res.status, 200, `bulk ${source}->${target} refused: ${JSON.stringify(res.body).slice(0, 240)}`)
      return res
    }

    const fixtureOk = [restoreSale, cancelSale].every(fixture => fixture.items[0].returned_quantity === 1 && fixture.sale.sale_status === 'completed')
    r.check('fixtures hold the imported units the cases below depend on', () => assert.equal(fixtureOk, true))

    // 1. R1 (1) + R2 (1) + imported (1) = the whole 3-unit line.
    await recordReturn(restoreSale, 'rb-restore-1', 911, 1)
    const restoreSecond = await recordReturn(restoreSale, 'rb-restore-2', 911, 1)
    const afterCreates = await status(restoreSale)
    r.check(`1a: two recorded returns on top of the imported unit make the sale returned (single path; got ${afterCreates})`, () => assert.equal(afterCreates, 'returned'))
    await bulk('rb-restore-cancel', restoreSecond, 'completed', 'cancelled')
    const afterCancel = await status(restoreSale)
    r.check(`1b: cancelling R2 leaves R1 + the imported unit, 2 of 3: partial_return (got ${afterCancel})`, () => assert.equal(afterCancel, 'partial_return'))
    await bulk('rb-restore-restore', restoreSecond, 'cancelled', 'completed')
    const afterRestore = await status(restoreSale)
    const restoreRecorded = await recorded(restoreSale)
    r.check(`1c: restoring R2 brings the line back to 3 of 3: returned, as the single path would (got ${afterRestore})`, () => assert.equal(afterRestore, 'returned'))
    r.check(`1d: the status recorded for the sale's Undo snapshot is the status written (recorded ${JSON.stringify(restoreRecorded)})`, () => {
      assert.ok(restoreRecorded, 'the bulk action recorded a sale status change')
      assert.equal(restoreRecorded.after, afterRestore)
    })

    // 2. R3 (2) + imported (1): cancelling the only recorded return must not forget the imported unit.
    const cancelOnly = await recordReturn(cancelSale, 'rb-cancel-1', 912, 2)
    const cancelCreated = await status(cancelSale)
    r.check(`2a: a return of the other two units makes the sale returned (got ${cancelCreated})`, () => assert.equal(cancelCreated, 'returned'))
    await bulk('rb-cancel-cancel', cancelOnly, 'completed', 'cancelled')
    const cancelledStatus = await status(cancelSale)
    const cancelRecorded = await recorded(cancelSale)
    r.check(`2b: with no recorded return left, the imported unit still makes it partial_return, not completed (got ${cancelledStatus})`, () => assert.equal(cancelledStatus, 'partial_return'))
    r.check(`2c: the recorded Undo status matches (recorded ${JSON.stringify(cancelRecorded)})`, () => {
      assert.ok(cancelRecorded)
      assert.equal(cancelRecorded.after, cancelledStatus)
      assert.equal(cancelRecorded.before, 'returned')
    })
    await bulk('rb-cancel-restore', cancelOnly, 'cancelled', 'completed')
    const cancelRestored = await status(cancelSale)
    r.check(`2d: restoring it returns the sale to returned (got ${cancelRestored})`, () => assert.equal(cancelRestored, 'returned'))

    // 3. Control: a sale with NO imported units keeps the existing rule (no active return -> the status before the return).
    const controlReturn = await recordReturn(controlSale, 'rb-control-1', 913, 2)
    const controlCreated = await status(controlSale)
    await bulk('rb-control-cancel', controlReturn, 'completed', 'cancelled')
    const controlCancelled = await status(controlSale)
    await bulk('rb-control-restore', controlReturn, 'cancelled', 'completed')
    const controlRestored = await status(controlSale)
    r.check(`3: control -- no imported units: returned -> completed on cancel -> returned on restore (got ${controlCreated} -> ${controlCancelled} -> ${controlRestored})`, () => {
      assert.deepEqual([controlCreated, controlCancelled, controlRestored], ['returned', 'completed', 'returned'])
    })

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} bulk return status counts imported returned units: ${r.results.length - failed.length}/${r.results.length}`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
