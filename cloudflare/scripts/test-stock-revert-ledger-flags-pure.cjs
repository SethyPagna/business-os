// REVERT-FIX F4: a Revert is its own record. The ledger row says which row it
// reverts (a link, from the immutable reference_id, not the editable reason),
// the original says by which row it was reverted and whether it is reverted
// NOW (a Revert that was itself reverted puts it back), and a reverted receipt
// stays in Stock-in Sessions as history, out of the session's totals (owner,
// 1 Oct 2026) -- the Revert itself is never listed there as a new receipt.
// Real SQL on the real migration chain, rows written by the real
// applyMovementRevert.
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const { getDb } = loadStockSession('lib/db.ts')
const ledger = loadStockSession('lib/stockLedgerQuery.ts')
const sessions = loadStockSession('lib/stockInSessionsQuery.ts')

const actor = { userId: user.id, userName: user.name }

async function main() {
  const f = fixture()
  try {
    f.sql.exec(`UPDATE products SET stock_quantity=10 WHERE id=1; UPDATE branch_stock SET quantity=10 WHERE product_id=1 AND branch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,payment_status,received_quantity,received_branch_id,received_cost_usd,supplier_name)
        VALUES(9001,1,'20260915-p','09152026','2026-09-15',1,1,2,'paid',10,1,20,'Probe Supplier');
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9001,1,10);`)
    const receipt = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,batch_id,created_at)
      VALUES(1,1,'add',10,2,20,'Probe receipt','777',9001,'2026-09-15 03:00:00')`).run().lastInsertRowid)
    const db = getDb(f.env)
    const byId = (id) => f.sql.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id)
    const sessionList = () => {
      const list = sessions.buildStockInSessionListQuery('')
      return f.sql.prepare(list.groupedSql).all(list.params).map((g) => [g.session_key, g.line_count, g.reverted_line_count, g.quantity, g.movement_cost_usd])
    }
    const sessionLines = () => f.sql.prepare(sessions.stockInSessionLinesSql({ kind: 'reference', referenceId: '777' })).all({ referenceId: '777' })
      .map((line) => [line.id, line.reverted, line.has_revert])
    assert.deepEqual(sessionList(), [['session:777', 1, 0, 10, 20]])
    assert.equal((await applyMovementRevert(db, byId(receipt), actor)).ok, true)
    assert.deepEqual(sessionList(), [['session:777', 1, 1, 0, 0]], 'reverted: listed as history, out of the session units and cost')
    assert.deepEqual(sessionLines(), [[receipt, 1, 1]])
    const first = f.sql.prepare("SELECT id FROM inventory_movements WHERE reference_id = ?").get(`revert:${receipt}`).id
    assert.equal((await applyMovementRevert(db, byId(first), actor)).ok, true)
    const second = f.sql.prepare("SELECT id FROM inventory_movements WHERE reference_id = ?").get(`revert:${first}`).id
    // Someone rewrites the Revert's reason: the link must not depend on it.
    f.sql.prepare("UPDATE inventory_movements SET reason = 'typo fixed' WHERE id = ?").run(first)

    const q = ledger.buildStockLedgerQuery({ productId: 1 })
    const rows = f.sql.prepare(q.rowsSql).all({ ...q.params, limit: 50, offset: 0 })
    const flags = Object.fromEntries(rows.map((row) => [row.id, [row.reverts_movement_id, row.reverted_by_movement_id, row.reverted_now]]))
    assert.deepEqual(flags, { [receipt]: [null, first, 0], [first]: [receipt, second, 1], [second]: [first, null, 0] },
      'the receipt is live again once its Revert is reverted; that Revert is the one reverted now')
    console.log('PASS the ledger links each Revert to the row it reverts and flags every reverted row, independent of the reason text')

    // The #N link opens that one row through the same kernel.
    const one = ledger.buildStockLedgerQuery({ movementId: receipt })
    const opened = f.sql.prepare(one.rowsSql).all({ ...one.params, limit: 1, offset: 0 })
    assert.deepEqual(opened.map((row) => [row.id, row.reverted_by_movement_id]), [[receipt, first]])
    assert.equal(f.sql.prepare(one.countSql).get(one.params).total, 1)
    console.log('PASS a Revert link reads exactly its row by id')

    // REVERT-SET (owner, 6 Oct 2026, main Stock Changes page): reverts are
    // discoverable from any day. A "Reverts" view lists the Revert rows and
    // every row that was reverted, whenever the Revert was written; its count
    // rides the summary, and a reverted row carries when its Revert happened.
    const unrelated = Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,created_at)
      VALUES(1,1,'remove',1,'Unrelated count','2026-09-15 04:00:00')`).run().lastInsertRowid)
    const day = ledger.buildStockLedgerQuery({ productId: 1, startDate: '2026-09-15', endDate: '2026-09-15', view: 'reverts' })
    const dayRows = f.sql.prepare(day.rowsSql).all({ ...day.params, limit: 50, offset: 0 })
    assert.deepEqual(dayRows.map((row) => row.id), [receipt], 'the day of the receipt: the receipt reverted on another day, not the unrelated row')
    assert.equal(dayRows[0].reverted_by_at, byId(first).created_at, 'the row says when its Revert was written')
    assert.notEqual(String(dayRows[0].reverted_by_at).slice(0, 10), '2026-09-15', 'and that is another day')
    const daySummary = f.sql.prepare(day.summarySql).get(day.params)
    assert.deepEqual([daySummary.revert_count, daySummary.total], [1, 2], 'the count covers the day without the view chip: 1 of 2 rows')
    const all = ledger.buildStockLedgerQuery({ productId: 1, view: 'reverts' })
    assert.deepEqual(f.sql.prepare(all.rowsSql).all({ ...all.params, limit: 50, offset: 0 }).map((row) => row.id).sort((a, b) => a - b), [receipt, first, second])
    assert.equal(f.sql.prepare(all.countSql).get(all.params).total, 3)
    const plain = ledger.buildStockLedgerQuery({ productId: 1, view: 'all' })
    assert.equal(f.sql.prepare(plain.countSql).get(plain.params).total, 4, 'All still lists every row')
    assert.equal(f.sql.prepare(plain.rowsSql).all({ ...plain.params, limit: 50, offset: 0 }).find((row) => row.id === unrelated).reverted_by_at, null)
    console.log('PASS the Reverts view finds a row reverted on another day and the Reverts made of rows outside the range')

    const list = sessions.buildStockInSessionListQuery('')
    const groups = f.sql.prepare(list.groupedSql).all(list.params)
    assert.deepEqual(groups.map((g) => [g.session_key, g.line_count, g.reverted_line_count, g.quantity]), [['session:777', 1, 0, 10]],
      'the Revert of the Revert puts the receipt back in the session totals and is not a new receipt')
    assert.deepEqual(sessionLines(), [[receipt, 0, 1]], 'live again, but its own Revert exists: only the latest Revert in the chain can be reverted')
    console.log('PASS Stock-in Sessions keeps a reverted receipt, marked reverted, and never lists a Revert as a receipt')
  } finally { f.sql.close() }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
