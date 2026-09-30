const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')
const route = loadStockSession('routes/actionHistory.ts').default
const stock = loadStockSession()
const analytics = loadStockSession('lib/salesAnalytics.ts')
const shifts = loadStockSession('lib/shiftReconciliation.ts')
const sets = loadStockSession('lib/stockLotAdjustment.ts')
const getDb = loadStockSession('lib/db.ts').getDb

async function call(f, method, path, body) {
  const response = await route.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, f.env, { waitUntil: p => p.catch(() => {}), passThroughOnException() {} })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}
const newest = f => f.sql.prepare('SELECT id FROM inventory_movements ORDER BY id DESC LIMIT 1').get().id
async function ledgerReplay(f, movementId) {
  const { revert } = await call(f, 'GET', `/movements/${movementId}/revert-preview`)
  const result = await call(f, 'POST', `/${revert.historyId}/${revert.direction}`, { require_applied: true, expected_generation: revert.expectedGeneration })
  assert.equal(result.applied, true)
}
async function historyReplay(f, id, direction) {
  const row = f.sql.prepare('SELECT undo_payload,redo_payload FROM action_history WHERE id=?').get(id)
  const payload = JSON.parse(row[`${direction}_payload`])
  const result = await call(f, 'POST', `/${id}/${direction}`, { require_applied: true, expected_generation: payload.generation })
  assert.equal(result.applied, true)
}
async function expectMoney(f, { quantity, purchase, loss, held = 0 }) {
  assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, quantity)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(quantity),0) n FROM branch_stock WHERE product_id=1').get().n, quantity)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(quantity),0) n FROM branch_batch_stock').get().n, quantity)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(received_cost_usd),0) n FROM product_batches').get().n, purchase)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0) n FROM damaged_stock_lots').get().n, held)
  const readLoss = await analytics.removalLossesFor(f.env, { branchId: 1 })
  assert.notEqual(readLoss, null, 'a failed ledger read must not masquerade as zero loss')
  assert.equal(readLoss.removal_loss_usd, loss)
  assert.equal(readLoss.removal_loss_unvalued_rows, 0)
  const totals = await analytics.getSalesTotals(f.env, { branchId: 1 })
  assert.equal(totals.revenue_usd, 0)
  assert.equal(totals.cost_usd, 0)
  assert.equal(totals.profit_usd, 0)
  assert.equal(totals.removal_loss_usd, loss)
  assert.equal(totals.revenue_after_losses_usd, 0 - loss)
  assert.equal(totals.profit_after_losses_usd, 0 - loss)
  const figures = shifts.composeShiftFigures({ totals, opening: { usd: 0, khr: 0 }, counted: { usd: 0, khr: 0 }, expenses: {}, deliveryFees: {}, courier: {} })
  assert.equal(figures.removal_loss_usd, loss)
  assert.equal(figures.profit_after_losses_usd, 0 - loss)
  assert.equal(figures.cogs_usd, 0)
}
async function receive27(f, id) {
  const request = receiveRequest(id, 27)
  Object.assign(request.items[0], { unit_cost_usd: 2.5, payment_status: 'paid' })
  return stock.commitStockSession(f.env, user, request)
}

async function main() {
  const f = fixture()
  try {
    const receipt = await receive27(f, 'financial-add-27')
    const applied = { quantity: 27, purchase: 67.5, loss: 0 }
    const undone = { quantity: 0, purchase: 0, loss: 0 }
    await expectMoney(f, applied)
    await ledgerReplay(f, receipt.items[0].movementId)
    await expectMoney(f, undone)
    await historyReplay(f, receipt.actionHistoryId, 'redo')
    await expectMoney(f, applied)
    await historyReplay(f, receipt.actionHistoryId, 'undo')
    await expectMoney(f, undone)
    await ledgerReplay(f, newest(f))
    await expectMoney(f, applied)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 5, 'audit movements stay after four alternating reversals')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('stock_session_undo','stock_session_redo')").get().n, 4)
    console.log('PASS add27 reversal and redo via both surfaces restore stock/purchase money, create no loss and retain audit')
  } finally { f.sql.close() }

  for (const [target, tag] of [[7, null], [47, null], [7, 'damaged']]) {
    const f = fixture()
    try {
      const receipt = await receive27(f, `financial-set-${target}-${tag || 'plain'}`)
      const baseline = { quantity: 27, purchase: 67.5, loss: 0 }
      const result = await sets.applyStockLotSet(getDb(f.env), user, `financial-set-${target}-${tag || 'plain'}`, {
        productId: 1, branchId: 1, batchId: receipt.items[0].batchId, quantity: target, setScope: 'lot', reason: 'Fixture correction', conditionTag: tag,
      })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const history = f.sql.prepare('SELECT history_id FROM stock_lot_adjustment_operations WHERE id=?').get(result.body.operation_id).history_id
      const applied = { quantity: target, purchase: 67.5, loss: target < 27 && !tag ? 50 : 0, held: tag ? 20 : 0 }
      await expectMoney(f, applied)
      await ledgerReplay(f, newest(f))
      await expectMoney(f, baseline)
      await historyReplay(f, history, 'redo')
      await expectMoney(f, applied)
      await historyReplay(f, history, 'undo')
      await expectMoney(f, baseline)
      await ledgerReplay(f, newest(f))
      await expectMoney(f, applied)
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 6)
      assert.equal(f.sql.prepare('SELECT generation FROM stock_lot_adjustment_operations WHERE id=?').get(result.body.operation_id).generation, 4)
      console.log(`PASS Set ${target < 27 ? 'down' : 'up'}${tag ? ' tagged' : ''}: both surfaces cancel/restore only the intended loss; purchase and dashboard/shift money reconcile`)
    } finally { f.sql.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
