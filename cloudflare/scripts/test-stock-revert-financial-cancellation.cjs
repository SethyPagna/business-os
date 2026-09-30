const assert = require('node:assert/strict')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')
const losses = loadStockSession('lib/removalLosses.ts')
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const { getDb } = loadStockSession('lib/db.ts')

function financials(f, day) {
  const rows = f.sql.prepare(`SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM}
    WHERE ${losses.removalLossMovementWhere('m')} ${day ? 'AND date(m.created_at)=?' : ''}`).all(...(day ? [day] : []))
  return losses.removalLossTotals(200, 80, losses.summarizeRemovalLosses(rows))
}

async function main() {
  for (const type of ['remove', 'add', 'adjustment', 'out']) {
    const f = fixture()
    try {
      const removes = type === 'remove' || type === 'out'
      const originalStock = removes ? 73 : 127
      f.sql.prepare('UPDATE products SET stock_quantity=? WHERE id=1').run(originalStock)
      f.sql.prepare('UPDATE branch_stock SET quantity=? WHERE product_id=1').run(originalStock)
      f.sql.prepare(`INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,created_at)
        VALUES(1,1,?,27,2,54,'Synthetic stock action','2026-09-29 01:00:00')`).run(type)
      for (let generation = 0; generation <= 6; generation++) {
        const expectedLoss = type === 'remove' && generation % 2 === 0 ? 54 : 0
        const current = financials(f)
        assert.equal(current.removal_loss_usd, expectedLoss, `${type} generation ${generation}: mistake corrections must cancel the original loss, not create a new one`)
        assert.equal(current.removal_loss_qty, expectedLoss ? 27 : 0)
        assert.equal(current.revenue_after_losses_usd, 200 - expectedLoss)
        assert.equal(current.profit_after_losses_usd, 80 - expectedLoss)
        assert.equal(financials(f, '2026-09-29').removal_loss_usd, expectedLoss, 're-applying restores the original reporting-period loss')
        assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, generation % 2 ? 100 : originalStock)
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, generation % 2 ? 100 : originalStock)
        assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, generation + 1, 'audit movements are retained')
        if (generation === 6) break
        const movement = f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id DESC LIMIT 1').get()
        const result = await applyMovementRevert(getDb(f.env), movement, { userId: user.id, userName: user.name })
        assert.equal(result.ok, true, JSON.stringify(result))
        const after = JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all())
        const repeated = await applyMovementRevert(getDb(f.env), movement, { userId: user.id, userName: user.name })
        assert.equal(repeated.code, 'already_reverted')
        assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all()), after)
      }
      console.log(`PASS real ${type} 27-unit revert chain: stock, original-period loss, revenue/profit views, audit and retries`)
    } finally { f.sql.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
