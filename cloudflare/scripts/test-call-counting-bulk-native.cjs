// P1.1: a 25-return bulk action (RETURN_BULK_LIMIT) on the Free plan, counted in D1 calls.
// The whole Worker on workerd + D1 (harness/al_money_native.cjs), PLAN_TIER=free. The grouped action is ONE atomic batch, so with
// call_counting ON it is one call plus the reads around it; counted as statements (OFF, the old behaviour) it is refused whole.
//
//   ON : 25 returns are cancelled in one request inside 50 calls, the restocked units leave both ledgers, undo and redo fit and reverse it exactly.
//   OFF: the same request is refused with return_bulk_over_plan_budget and NOTHING changes (statuses, both stock ledgers, action history).
//   MUTANT=statements : the bulk admission charges the batch as N statements again; the ON expectations must go red.
process.env.AL_PLAN_TIER = 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const FILE = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  statements: [{ file: FILE, from: 'queryBudget.callCounting ? 1 : members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) :', to: 'members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) :' }],
}
const COUNT = 25

async function world(mode, patches = []) {
  const h = await H.startWorker({ patches })
  await h.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: { call_counting: mode } })).run()
  return h
}

async function seedReturns(h, tag) {
  const ids = []
  for (let i = 0; i < COUNT; i += 1) {
    const productId = 9900 + i
    await H.seedProduct(h, productId, `CC Bulk ${i}`, 10, 10, 4)
    const sale = await H.createSale(h, { key: `cc-${tag}-sale-${i}`, status: 'completed', lines: [{ productId, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }] })
    assert.equal(sale.status, 200, JSON.stringify(sale.body))
    const item = await h.one('SELECT id,product_id FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
    const { created } = await H.customerReturn(h, { key: `cc-${tag}-ret-${i}`, saleId: sale.body.id, lines: [{ saleItemId: item.id, productId, quantity: 1 }], label: `return ${i}` })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    ids.push(created.body.id)
  }
  return ids
}

const sums = async (h) => ({
  stock: Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock')).n),
  lots: Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_batch_stock')).n),
  history: Number((await h.one("SELECT COUNT(*) AS n FROM action_history WHERE scope='returns'")).n),
  cancelled: Number((await h.one("SELECT COUNT(*) AS n FROM returns WHERE status='cancelled'")).n),
})

async function bulkCancel(h, ids, key) {
  const items = []
  for (const id of ids) {
    const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
    items.push({ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null })
  }
  return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled', items }, key)
}
const metricOf = (h, label) => h.metrics.find((entry) => entry.label === label)

async function main() {
  const mutantName = process.env.MUTANT
  if (mutantName && !MUTANTS[mutantName]) throw new Error(`unknown MUTANT ${mutantName}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const patches = mutantName ? MUTANTS[mutantName].map((patch, index) => ({ name: `mutant:${mutantName}:${index}`, ...patch })) : []
  const r = H.recorder('CALL-COUNTING-BULK')

  // ---- ON ---------------------------------------------------------------------------------------------------------------------------------
  const on = await world('on', patches)
  try {
    const ids = await seedReturns(on, 'on')
    const before = await sums(on)
    const done = await bulkCancel(on, ids, 'cc-bulk-on-0001')
    const cancelCalls = metricOf(on, 'cc-bulk-on-0001')
    r.check(`ON: ${COUNT} returns cancelled in one request on Free (${done.status}); ${cancelCalls.calls} calls, ${cancelCalls.statements} statements`, () => {
      assert.equal(done.status, 200, JSON.stringify(done.body))
      assert.ok(cancelCalls.calls <= H.FREE_QUERY_LIMIT, `${cancelCalls.calls} calls`)
      assert.ok(cancelCalls.statements > H.FREE_QUERY_LIMIT, `${cancelCalls.statements} statements: the request is only legal when a batch counts as one call`)
    })
    if (done.status === 200) {
      const after = await sums(on)
      r.check('ON: every return is cancelled and the restocked units left both ledgers', () => {
        assert.equal(after.cancelled, COUNT)
        assert.equal(before.stock - after.stock, COUNT)
        assert.equal(before.lots - after.lots, COUNT)
        assert.equal(after.history - before.history, 1)
      })
      const generation = JSON.parse((await on.one('SELECT undo_payload FROM action_history WHERE id=?', done.body.actionHistoryId)).undo_payload).generation
      const undone = await H.historyStep(on, done.body.actionHistoryId, 'undo', generation, 'cc undo')
      const afterUndo = await sums(on)
      const undoCalls = metricOf(on, 'cc undo')
      r.check(`ON: undo fits (${undone.status}, ${undoCalls.calls} calls) and restores the first state exactly`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.ok(undoCalls.calls <= H.FREE_QUERY_LIMIT)
        assert.equal(afterUndo.cancelled, 0)
        assert.equal(afterUndo.stock, before.stock)
        assert.equal(afterUndo.lots, before.lots)
      })
      const generation2 = JSON.parse((await on.one('SELECT undo_payload FROM action_history WHERE id=?', done.body.actionHistoryId)).undo_payload).generation
      const redone = await H.historyStep(on, done.body.actionHistoryId, 'redo', generation2, 'cc redo')
      const afterRedo = await sums(on)
      const redoCalls = metricOf(on, 'cc redo')
      r.check(`ON: redo fits (${redone.status}, ${redoCalls.calls} calls) and repeats the cancel`, () => {
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.ok(redoCalls.calls <= H.FREE_QUERY_LIMIT)
        assert.equal(afterRedo.cancelled, COUNT)
        assert.equal(afterRedo.stock, after.stock)
        assert.equal(afterRedo.lots, after.lots)
      })
    }
  } finally { await on.mf.dispose() }

  // ---- OFF ---------------------------------------------------------------------------------------------------------------------------------
  if (!mutantName) {
    const off = await world('off')
    try {
      const ids = await seedReturns(off, 'off')
      const before = await sums(off)
      const refused = await bulkCancel(off, ids, 'cc-bulk-off-0001')
      const after = await sums(off)
      r.check(`OFF: the same request is refused whole with the old code (${refused.status} ${refused.body.code}) and nothing changes`, () => {
        assert.equal(refused.status, 400, JSON.stringify(refused.body))
        assert.equal(refused.body.code, 'return_bulk_over_plan_budget')
        assert.deepEqual(after, before)
      })
    } finally { await off.mf.dispose() }
  }

  const failed = r.results.filter((result) => !result.ok)
  console.log(`call-counting bulk native${mutantName ? ` (MUTANT=${mutantName})` : ''}: ${r.results.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
