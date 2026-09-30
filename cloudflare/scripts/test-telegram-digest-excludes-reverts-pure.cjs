// REVERT-FIX F6 (owner, 30 Sep 2026): a Revert is a correction, not business
// activity. The daily digest's "Stock in / Stock out" counts and the "low
// stock moved today" list must not report a Revert as today's receipt or
// removal. Owner, 1 Oct 2026 (RF6): a Revert works like cancelling a sale, so
// the row it reverted leaves the count on ITS OWN day too (/report takes any
// past day), and a row whose Revert was reverted counts again. Real
// telegram.ts fragments on the real migration chain.
const assert = require('node:assert/strict')
const { fixture, loadStockSession } = require('./test-stock-session-atomic.cjs')
const telegram = loadStockSession('lib/telegram.ts')
const { revertChainOpenSql } = loadStockSession('lib/stockInSessionsQuery.ts')

// telegram.ts spells the chain rule out (it cannot import it: many tests load it with hand-written
// module maps), so the two must stay the same query.
const squash = (sql) => sql.replace(/s+/g, ' ').trim()
assert.equal(squash(telegram.REVERTED_NOW_SQL), squash(revertChainOpenSql('inventory_movements')), 'the digest uses the shared chain rule')

const f = fixture()
try {
  const insert = f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,reference_id,created_at)
    VALUES(1,1,?,?,?,?,?)`)
  const older = Number(insert.run('add', 4, 'Receipt last week', null, '2026-09-20 03:00:00').lastInsertRowid)
  const removal = Number(insert.run('remove', 2, 'Damaged last week', null, '2026-09-21 03:00:00').lastInsertRowid)
  insert.run('add', 5, 'Receipt today', null, '2026-09-30 03:00:00')
  insert.run('remove', 1, 'Damaged today', null, '2026-09-30 03:30:00')
  insert.run('remove', 3, `Revert of #${older}`, `revert:${older}`, '2026-09-30 04:00:00')
  insert.run('add', 2, `Revert of #${removal}`, `revert:${removal}`, '2026-09-30 04:30:00')

  const count = (where, day = '2026-09-30') => f.sql.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements
    WHERE ${where} AND substr(created_at, 1, 10) = '${day}'`).get()
  assert.deepEqual({ ...count(telegram.stockDigestInWhere()) }, { count: 1, quantity: 5 }, 'stock in today: the receipt only, not the Revert of a removal')
  assert.deepEqual({ ...count(telegram.stockDigestOutWhere()) }, { count: 1, quantity: 1 }, 'stock out today: the removal only, not the Revert of a receipt')
  console.log('PASS the daily digest counts today\'s stock in/out without Reverts')

  // Past days: 20 Sep's receipt and 21 Sep's removal were reverted on 30 Sep.
  assert.deepEqual({ ...count(telegram.stockDigestInWhere(), '2026-09-20') }, { count: 0, quantity: 0 }, '/report 20 Sep: the reverted receipt is not stock in')
  assert.deepEqual({ ...count(telegram.stockDigestOutWhere(), '2026-09-21') }, { count: 0, quantity: 0 }, '/report 21 Sep: the reverted removal is not stock out')
  // Revert of the Revert: 22 Sep's receipt is live again; 23 Sep's was reverted once.
  const receipt = Number(insert.run('add', 6, 'Receipt 22 Sep', null, '2026-09-22 03:00:00').lastInsertRowid)
  const back = Number(insert.run('remove', 6, `Revert of #${receipt}`, `revert:${receipt}`, '2026-09-30 05:00:00').lastInsertRowid)
  insert.run('add', 6, `Revert of #${back}`, `revert:${back}`, '2026-09-30 05:30:00')
  const gone = Number(insert.run('add', 7, 'Receipt 23 Sep', null, '2026-09-23 03:00:00').lastInsertRowid)
  insert.run('remove', 7, `Revert of #${gone}`, `revert:${gone}`, '2026-09-30 06:00:00')
  assert.deepEqual({ ...count(telegram.stockDigestInWhere(), '2026-09-22') }, { count: 1, quantity: 6 }, 'a receipt whose Revert was reverted counts again')
  assert.deepEqual({ ...count(telegram.stockDigestInWhere(), '2026-09-23') }, { count: 0, quantity: 0 }, 'a receipt reverted once does not')
  // The low-stock list reads the same fragment through a qualified, unaliased subselect.
  const moved = f.sql.prepare(`SELECT inventory_movements.product_id FROM inventory_movements WHERE ${telegram.stockDigestOutWhere()} AND substr(inventory_movements.created_at, 1, 10) = '2026-09-21'`).all()
  assert.equal(moved.length, 0, 'a reverted removal does not put its product on the low-stock-moved list')
  console.log('PASS past days drop reverted originals and keep restored ones')
} finally { f.sql.close() }
