'use strict'
// 6.0.958 -- cancelling an exchange return, and undoing that, on the Cloudflare FREE plan (PLAN_TIER "free": 50 D1 statements per invocation).
// The whole Worker on workerd + D1 (harness/al_money_native.cjs), counting the statements each request really runs.
//
// A grouped return action is one atomic batch whose size grows with the stock lines it moves (about 6-7 statements a line), and every take-back
// return it links adds guards and revision rows. So the cancel is sized BEFORE it is sent:
//   1. a typical exchange (1 line back, 1 out) is cancelled with its replacement taken back, undone and redone, each inside the budget;
//   2. a selection too large for the plan is refused whole with return_bulk_over_plan_budget and NOTHING changes: the return stays completed, no stock
//      moves, no action is recorded -- the same sentence the Returns screen restates;
//   3. at the edge: two linked take-backs fit (the cancel is 45 statements and its undo 48), three do not, and linking two of the three is allowed;
//   4. the same sizes on the Paid plan are allowed (the refusal is the plan's, not the feature's): measured at the end of test-return-exchange-cancel-native.cjs.
// MUTANT=<name> bundles ONE deliberate defect.
process.env.AL_PLAN_TIER = 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const FILE = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  // The admission control never refuses: a selection that cannot fit is sent and fails inside the invocation.
  'budget-never-refuses': [{ file: FILE, from: 'if (used + planned + reserve > getPlanLimits(env).d1QueriesPerInvocation) {', to: 'if (false) {' }],
  // The route's own statements are forgotten: the batch is sized as if the invocation were empty.
  'used-forgotten': [{ file: FILE, from: 'assertReturnBulkBudget(env, queryBudget.statementsUsed(), members.some(', to: 'assertReturnBulkBudget(env, 0, members.some(' }],
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  const r = H.recorder('RET-EXCHANGE-CANCEL-FREE')
  try {
    for (let i = 0; i < 10; i += 1) { await H.seedProduct(h, 9810 + i, `CF Back ${i}`, 10, 200, 4); await H.seedProduct(h, 9830 + i, `CF Out ${i}`, 10, 200, 4) }
    let seq = 0
    const makeSale = async (productIds) => {
      const total = productIds.length * 10
      const sale = await H.createSale(h, { key: `cf-sale-${++seq}`, status: 'completed', lines: productIds.map(productId => ({ productId, quantity: 1 })),
        paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      return { id: sale.body.id, items: await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id) }
    }
    const exchange = async (sale, n, outN = n, stockAction = 'restock') => {
      const back = sale.items.slice(0, n).map(item => ({ sale_item_id: item.id, quantity: 1 }))
      const out = Array.from({ length: outN }, (_, i) => ({ branch_id: 1, product_id: 9830 + i, quantity: 1 }))
      // Each line is $10: the customer pays the difference when more comes out than goes back.
      const pays = Math.max(0, outN - n) * 10
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id, items: back, replacement_items: out }, 'exchange quote')
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `cf-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'CF exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: { details: pays ? [{ method: 'Cash', amount_usd: pays, amount_khr: 0 }] : [], change_currency: 'USD' },
        items: back.map(line => ({ ...line, stock_action: stockAction, branch_id: 1 })), replacement_items: out }, 'exchange create')
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const ret = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      return { ret, s2: await h.one('SELECT * FROM sales WHERE id=?', ret.replacement_sale_id) }
    }
    // The replacement lines taken back, [from, to) of them, as one ordinary return of the replacement sale.
    const takeBack = async (s2, from, to, key) => {
      const lines = (await h.all('SELECT id,product_id FROM sale_items WHERE sale_id=? ORDER BY id', s2.id)).slice(from, to)
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: s2.id, items: lines.map(line => ({ sale_item_id: line.id, quantity: 1 })) }, `quote ${key}`)
      if (quote.status !== 200) return { status: quote.status, body: quote.body }
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: s2.id, reason: 'CF take back', expected_quote: expected,
        items: lines.map(line => ({ sale_item_id: line.id, product_id: line.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 })) }, `take back ${key}`)
      return { status: created.status, body: created.body, id: created.body.id }
    }
    const cancel = async (id, key, returnIds) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          replacement: { return_ids: returnIds } }] }, `cancel ${id}`)
    }
    const generationOf = async historyId => JSON.parse((await h.one('SELECT undo_payload FROM action_history WHERE id=?', historyId)).undo_payload).generation
    const stockSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock')).n)
    const lotSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_batch_stock')).n)
    const statusOf = async id => (await h.one('SELECT status FROM returns WHERE id=?', id)).status
    const historyRows = async () => Number((await h.one("SELECT COUNT(*) AS n FROM action_history WHERE scope='returns'")).n)
    const statementsOf = (label) => h.metrics.find(entry => entry.label === label)?.statements ?? -1

    // ---- 1. the typical exchange: cancel, undo and redo fit ----------------------------------------------------------------------------------------------------
    {
      const x = await exchange(await makeSale([9810]), 1)
      const taken = await takeBack(x.s2, 0, 1, 'cf-take-1')
      assert.equal(taken.status, 200, JSON.stringify(taken.body))
      const done = await cancel(x.ret.id, 'cf-cancel-1', [taken.id])
      const cancelN = statementsOf(`cancel ${x.ret.id}`)
      r.check(`1 back / 1 out: cancel with the replacement taken back is recorded on Free (${done.status}); ${cancelN} statements (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.ok(cancelN > 0 && cancelN <= H.FREE_QUERY_LIMIT, `cancel ${cancelN}`)
      })
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo 1')
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf redo 1')
      r.check(`1 back / 1 out: undo (${undone.status}, ${statementsOf('cf undo 1')} statements) and redo (${redone.status}, ${statementsOf('cf redo 1')}) fit too`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.ok(statementsOf('cf undo 1') <= H.FREE_QUERY_LIMIT && statementsOf('cf redo 1') <= H.FREE_QUERY_LIMIT)
      })
    }

    // ---- 1b. the refund credit goes back to Not Paid (6.0.963) inside the same budget ----------------------------------------------------------------------------------
    // Cancelling and KEEPING the replacement reverses the credit on the replacement sale (one write, its check inside the return's own guard): it fits, the sale owes
    // the $10 as Not Paid, and the undo and redo fit too and put the exact columns back.
    {
      const x = await exchange(await makeSale([9815]), 1)
      const columns = () => h.one('SELECT payment_method,payment_details,amount_paid_usd,amount_paid_khr,sale_status FROM sales WHERE id=?', x.s2.id)
      const exchanged = await columns()
      const done = await cancel(x.ret.id, 'cf-cancel-keep', [])
      const reversed = await columns()
      const cancelN = statementsOf(`cancel ${x.ret.id}`)
      r.check(`1 back / 1 out, replacement kept: the credit moves to Not Paid on Free (${done.status}); ${cancelN} statements (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.ok(cancelN > 0 && cancelN <= H.FREE_QUERY_LIMIT, `cancel ${cancelN}`)
        assert.deepEqual([reversed.payment_details, reversed.amount_paid_usd, reversed.sale_status], ['[]', 0, 'awaiting_payment'])
        assert.equal(exchanged.sale_status, 'completed')
      })
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo keep')
      const afterUndo = await columns()
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf redo keep')
      const afterRedo = await columns()
      r.check(`...undo (${undone.status}, ${statementsOf('cf undo keep')} statements) and redo (${redone.status}, ${statementsOf('cf redo keep')}) fit and restore the exact columns`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.ok(statementsOf('cf undo keep') <= H.FREE_QUERY_LIMIT && statementsOf('cf redo keep') <= H.FREE_QUERY_LIMIT)
        assert.deepEqual(afterUndo, exchanged)
        assert.deepEqual(afterRedo, reversed)
      })
    }

    // ---- 2. a selection too large for the plan is refused whole ----------------------------------------------------------------------------------------------
    // 5 lines back, 5 out. The replacement taken back in single-line returns (a 5-line take-back is itself over a Free invocation), then ONE cancel that links
    // all five.
    {
      const x = await exchange(await makeSale([9810, 9811, 9812, 9813, 9814]), 5)
      const taken = []
      for (let i = 0; i < 5; i += 1) {
        const one = await takeBack(x.s2, i, i + 1, `cf-take-5-${i}`)
        assert.equal(one.status, 200, JSON.stringify(one.body))
        taken.push(one.id)
      }
      const before = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
      const refused = await cancel(x.ret.id, 'cf-cancel-5', taken)
      const after = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
      r.check(`5 back / 5 out with all 5 lines linked: refused whole (${refused.status} ${refused.body.code}); the return stays completed, no stock moved, no action recorded`, () => {
        assert.equal(refused.status, 400)
        assert.equal(refused.body.code, 'return_bulk_over_plan_budget')
        assert.deepEqual(after, before)
      })
      assert.equal(await statusOf(x.ret.id), 'completed')
      // Keeping the replacement is the same size as any plain 5-line cancel; on Free that is over the budget too, and says so.
      const kept = await cancel(x.ret.id, 'cf-cancel-5-keep', [])
      const keptStatus = await statusOf(x.ret.id)
      r.check(`5 back cancelled with the replacement kept: ${kept.status} ${kept.body.code ?? ''} -- a plain 5-line cancel is over a Free invocation too, so it is refused up front`, () => {
        assert.ok(kept.status === 400 ? kept.body.code === 'return_bulk_over_plan_budget' : kept.status === 200, JSON.stringify(kept.body))
        if (kept.status === 400) assert.equal(keptStatus, 'completed')
      })
    }

    // ---- 3. the edge: two linked take-backs fit, three do not --------------------------------------------------------------------------------------------
    // The returned line stays off the shelf (stock_action none), so the cancel itself moves no stock; every take-back it links adds guards and revision rows
    // to the apply and a stock line to the undo. With 2 linked the cancel is 45 statements and its undo 48 (both fit); with 3 the cancel is refused up front.
    {
      const linked = async (outN, sku, key) => {
        const x = await exchange(await makeSale([sku]), 1, outN, 'none')
        // A Free invocation carries a one-line return (a 2-line return is refused by its own admission), so each line comes back on its own.
        const taken = []
        for (let i = 0; i < outN; i += 1) {
          const one = await takeBack(x.s2, i, i + 1, `${key}-take-${i}`)
          assert.equal(one.status, 200, JSON.stringify(one.body))
          taken.push(one.id)
        }
        return { x, taken }
      }
      const small = await linked(2, 9815, 'cf-two')
      const done = await cancel(small.x.ret.id, 'cf-cancel-two', small.taken)
      r.check(`1 back (none) / 2 out, both linked: ${done.status} -- the cancel (${statementsOf(`cancel ${small.x.ret.id}`)} statements) and its undo fit`, () => assert.equal(done.status, 200, JSON.stringify(done.body)))
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo two')
      const undoN = statementsOf('cf undo two')
      r.check(`...and the undo of it really runs inside a Free invocation (${undone.status}, ${undoN} statements)`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.ok(undoN > 0 && undoN <= H.FREE_QUERY_LIMIT, `undo ${undoN}`)
      })

      const large = await linked(3, 9816, 'cf-three')
      const before = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
      const refused = await cancel(large.x.ret.id, 'cf-cancel-three', large.taken)
      const after = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
      r.check(`1 back (none) / 3 out, all 3 linked: ${refused.status} ${refused.body.code ?? ''} -- refused up front, over a Free invocation; nothing is written`, () => {
        assert.equal(refused.status, 400)
        assert.equal(refused.body.code, 'return_bulk_over_plan_budget')
        assert.deepEqual(after, before)
      })
      assert.equal(await statusOf(large.x.ret.id), 'completed')
      // Linking two of the three keeps the undo inside the budget: the third line simply stays with the customer.
      const partial = await cancel(large.x.ret.id, 'cf-cancel-three-partial', large.taken.slice(0, 2))
      r.check(`...linking 2 of the 3 is allowed (${partial.status}); the third stays with the customer`, () => assert.equal(partial.status, 200, JSON.stringify(partial.body)))
    }
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  if (failed.length) {
    console.log(`\n${failed.length} of ${r.results.length} checks FAILED`)
    process.exitCode = 1
  } else {
    console.log(`\n${r.results.length} exchange-cancel Free checks passed`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
