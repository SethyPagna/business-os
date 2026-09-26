// U-cost (supervisor decision 2026-09-25): an undo must never write back a
// stale catalog cost snapshot. After an undo/redo changes lots, the figure
// derived from the lots on hand (CATALOG_COST_DERIVE_SQL) wins.
//
// Drives the REAL stock-session writer and replayStockSession on the real
// migration chain (the test-stock-session-atomic.cjs fixture). The fixture's
// stored figure predates the on-hand rule (12.25 = old every-lot mean of a
// sold-out $12.00 lot and an on-hand $12.50 lot), so a replay that restores
// the snapshot yields 12.25 and one that re-derives yields 12.50: the two
// implementations cannot both pass.
//
// Run (from cloudflare/): node scripts/test-catalog-cost-undo-derived-pure.cjs
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

async function main() {
  const { commitStockSession, replayStockSession } = loadStockSession()

  await check('stock-session undo/redo: the derived on-hand cost wins over the snapshot; repeats are no-ops', async () => {
    const f = fixture()
    f.sql.exec(`
      INSERT INTO product_batches(id, variant_product_id, batch_key, is_active, unit_cost_usd, received_at)
        VALUES (101, 1, 'sold-out-lot', 1, 12, '2026-09-01'), (102, 1, 'on-hand-lot', 1, 12.5, '2026-09-02');
      INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (101, 1, 0), (102, 1, 15);
      UPDATE branch_stock SET quantity = 15 WHERE product_id = 1 AND branch_id = 1;
      UPDATE products SET stock_quantity = 15, cost_price_usd = 12.25, purchase_price_usd = 12.25 WHERE id = 1;
    `)
    const cost = () => f.sql.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id = 1').get()
    assert.deepEqual(cost(), { c: 12.25, p: 12.25 }, 'fixture: a figure stored under the old every-lot rule')

    const request = receiveRequest('u-cost-undo-001', 1)
    request.items[0].unit_cost_usd = 13
    const receipt = await commitStockSession(f.env, user, request)
    assert.deepEqual(cost(), { c: 12.5313, p: 12.5313 }, 'receipt, quantity-weighted: (15 x 12.50 + 1 x 13.00) / 16 = 12.53125 -> 12.5313 (half-up), the sold-out $12.00 lot excluded')

    const history = () => f.sql.prepare('SELECT undo_payload, redo_payload FROM action_history WHERE id = ?').get(receipt.actionHistoryId)
    const undo = (generation) => replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, generation, { ...JSON.parse(history().undo_payload), generation })
    const redo = (generation) => replayStockSession(f.env, user, 'redo', receipt.actionHistoryId, generation, { ...JSON.parse(history().redo_payload), generation })

    await undo(0)
    assert.deepEqual(cost(), { c: 12.5, p: 12.5 }, 'undo re-derives from the lots on hand (the snapshot held a stale 12.25)')
    await undo(0)
    assert.deepEqual(cost(), { c: 12.5, p: 12.5 }, 'double-apply of the same undo: nothing moves')
    await redo(1)
    assert.deepEqual(cost(), { c: 12.5313, p: 12.5313 }, 'redo: the receipt counts again')
    await undo(2)
    assert.deepEqual(cost(), { c: 12.5, p: 12.5 }, 'a second undo still lands on the derived figure (replay state recorded it)')
    assert.equal(f.sql.prepare('SELECT SUM(quantity) q FROM branch_batch_stock').get().q, 15, 'stock back to the pre-receipt 15')
  })

  console.log(`${checks} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
