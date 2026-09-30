// REVERT-FIX F6 (owner, 30 Sep 2026): a Revert is a correction, not business
// activity. The daily digest's "Stock in / Stock out" counts and the "low
// stock moved today" list must not report a Revert as today's receipt or
// removal. Real telegram.ts fragments on the real migration chain.
const assert = require('node:assert/strict')
const { fixture, loadStockSession } = require('./test-stock-session-atomic.cjs')
const telegram = loadStockSession('lib/telegram.ts')

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

  const count = (where) => f.sql.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements
    WHERE ${where} AND substr(created_at, 1, 10) = '2026-09-30'`).get()
  assert.deepEqual({ ...count(telegram.STOCK_DIGEST_IN_WHERE) }, { count: 1, quantity: 5 }, 'stock in today: the receipt only, not the Revert of a removal')
  assert.deepEqual({ ...count(telegram.STOCK_DIGEST_OUT_WHERE) }, { count: 1, quantity: 1 }, 'stock out today: the removal only, not the Revert of a receipt')
  console.log('PASS the daily digest counts today\'s stock in/out without Reverts')
} finally { f.sql.close() }
