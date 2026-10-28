'use strict'
// 6.0.958 -- cancelling an exchange return, and undoing that, on the Cloudflare FREE plan (PLAN_TIER "free": 50 D1 statements per invocation).
// The whole Worker on workerd + D1 (harness/al_money_native.cjs), counting the statements each request really runs.
//
// 6.0.966: a grouped return action is one atomic batch whose size no longer grows with the stock lines it moves or the take-backs it links (set-based
// writes: about eight statements for all the stock, one for the guards, one for the returns rows). What is still sized BEFORE it is sent is what grows with
// the number of exchanges in one request. So on this plan:
//   1. a typical exchange (1 line back, 1 out) is cancelled with its replacement taken back, undone and redone, each inside the budget;
//   2. a 5 / 5 exchange is too: its replacement is taken back one line per return (a longer return is refused by its own admission on this plan), each step a
//      complete return that fits and replays by its request id, then ONE cancel links all five; undo and redo fit and reverse it exactly;
//   3. what the budget cannot admit (eight exchanges in one request) is refused whole with return_bulk_over_plan_budget and NOTHING changes;
//   4. the dry run speaks for the whole selection before anything is made: it passes what fits, tells the screen to take back one line at a time, and refuses
//      what any one exchange of the selection would refuse (the change it handed back) -- the screen then writes nothing;
//   5. a unit that left the shelf again since cannot be taken off it twice: the cancel is refused whole.
//   The same sizes on the Paid plan are made as one take-back (measured in test-return-exchange-cancel-native.cjs).
// MUTANT=<name> bundles ONE deliberate defect.
process.env.AL_PLAN_TIER = 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const FILE = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  // The admission control never refuses: a selection that cannot fit is sent and fails inside the invocation.
  'budget-never-refuses': [{ file: FILE, from: 'if (used + planned + reserve > getPlanLimits(env).d1QueriesPerInvocation) {', to: 'if (false) {' }],
  // The route's own statements are forgotten: the batch is sized as if the invocation were empty.
  // 6.0.964: the dry run that guards the screen's two-step flow (take the units back, THEN cancel) stops asking about a take-back too long for the plan.
  'dry-run-take-back-size-ignored': [{ file: FILE, from: 'if (request.dry_run) assertTakeBackFitsPlan(env, request)', to: '' }],
  // 6.0.966: the dry run no longer tells the till to make the take-backs one line at a time on a small plan.
  'per-line-flag-off': [{ file: FILE, from: 'return getPlanLimits(env).d1QueriesPerInvocation < SMALL_PLAN_QUERY_LIMIT', to: 'return false' }],
  'used-forgotten': [{ file: FILE, from: 'assertReturnBulkBudget(env, queryBudget.statementsUsed(), members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) :', to: 'assertReturnBulkBudget(env, 0, members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) :' }],
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []), d1CallLimit: H.FREE_QUERY_LIMIT })
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
    // A take-back is marked the way the dialog marks it: 'rtb-<exchange return id>_...' (the Worker finds an exchange's take-backs by it). { ordinary: true }
    // makes the same return WITHOUT the mark -- an independent return of a replacement line at the till.
    const takeBack = async (s2, from, to, key, options = {}) => {
      const exchangeId = Number((await h.one('SELECT id FROM returns WHERE replacement_sale_id=?', s2.id)).id)
      const lines = (await h.all('SELECT id,product_id FROM sale_items WHERE sale_id=? ORDER BY id', s2.id)).slice(from, to)
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: s2.id, items: lines.map(line => ({ sale_item_id: line.id, quantity: 1 })) }, `quote ${key}`)
      if (quote.status !== 200) return { status: quote.status, body: quote.body }
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      const request = { client_request_id: options.ordinary ? key : `rtb-${exchangeId}_${key}`, money_precision_version: 1, sale_id: s2.id, reason: options.reason || 'CF take back', expected_quote: expected,
        items: lines.map(line => ({ sale_item_id: line.id, product_id: line.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 })) }
      const created = await h.call('POST', '/api/returns', request, `take back ${key}`)
      return { status: created.status, body: created.body, id: created.body.id, request }
    }
    const cancel = async (id, key, returnIds) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          ...(returnIds === undefined ? {} : { replacement: { return_ids: returnIds } }) }] }, `cancel ${id}`)
    }
    const generationOf = async historyId => JSON.parse((await h.one('SELECT undo_payload FROM action_history WHERE id=?', historyId)).undo_payload).generation
    const stockSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock')).n)
    const lotSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_batch_stock')).n)
    const statusOf = async id => (await h.one('SELECT status FROM returns WHERE id=?', id)).status
    const historyRows = async () => Number((await h.one("SELECT COUNT(*) AS n FROM action_history WHERE scope='returns'")).n)
    const statementsOf = (label) => h.metrics.find(entry => entry.label === label)?.statements ?? -1
    const callsOf = (label) => h.metrics.find(entry => entry.label === label)?.calls ?? -1

    // ---- 1. the typical exchange: cancel, undo and redo fit ----------------------------------------------------------------------------------------------------
    {
      const x = await exchange(await makeSale([9810]), 1)
      const taken = await takeBack(x.s2, 0, 1, 'cf-take-1')
      assert.equal(taken.status, 200, JSON.stringify(taken.body))
      const done = await cancel(x.ret.id, 'cf-cancel-1', [taken.id])
      const cancelN = callsOf(`cancel ${x.ret.id}`)
      r.check(`1 back / 1 out: cancel with the replacement taken back is recorded on Free (${done.status}); ${cancelN} statements (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.ok(cancelN > 0 && cancelN <= H.FREE_QUERY_LIMIT, `cancel ${cancelN}`)
      })
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo 1')
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf redo 1')
      r.check(`1 back / 1 out: undo (${undone.status}, ${statementsOf('cf undo 1')} statements) and redo (${redone.status}, ${statementsOf('cf redo 1')}) fit too`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.ok(callsOf('cf undo 1') <= H.FREE_QUERY_LIMIT && callsOf('cf redo 1') <= H.FREE_QUERY_LIMIT)
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
      const cancelN = callsOf(`cancel ${x.ret.id}`)
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
        assert.ok(callsOf('cf undo keep') <= H.FREE_QUERY_LIMIT && callsOf('cf redo keep') <= H.FREE_QUERY_LIMIT)
        assert.deepEqual(afterUndo, exchanged)
        assert.deepEqual(afterRedo, reversed)
      })
    }

    // ---- 2. a 5 / 5 exchange, the typical large one: take-backs one line at a time, then ONE cancel (6.0.966) ------------------------------------------------------
    // On Free a return of 2+ lines is refused by its own admission, so the till makes one single-line return per ticked line -- each a complete return of the
    // replacement sale with its own request id -- and the cancel then links all five. The cancel's batch no longer grows with its stock lines or its linked
    // returns (set-based writes), so it fits a Free invocation, and so do its undo and redo. Every step's statement count is printed.
    {
      const backs = [9810, 9811, 9812, 9813, 9814]
      const outs = [9830, 9831, 9832, 9833, 9834]
      const x = await exchange(await makeSale(backs), 5)
      const taken = []
      const stepCounts = []
      let firstRequest
      for (let i = 0; i < 5; i += 1) {
        const one = await takeBack(x.s2, i, i + 1, `cf-take-5-${i}`)
        assert.equal(one.status, 200, JSON.stringify(one.body))
        if (i === 0) firstRequest = one.request
        taken.push(one.id)
        stepCounts.push(`${statementsOf(`quote cf-take-5-${i}`)}+${statementsOf(`take back cf-take-5-${i}`)}`)
      }
      console.log(`5 / 5 take-back steps (quote + create statements): ${stepCounts.join(', ')}`)
      r.check(`5 take-back steps, one line each (quote+create statements ${stepCounts.join(', ')}): every step fits a Free invocation`, () => {
        for (let i = 0; i < 5; i += 1) {
          assert.ok(callsOf(`quote cf-take-5-${i}`) <= H.FREE_QUERY_LIMIT && callsOf(`take back cf-take-5-${i}`) <= H.FREE_QUERY_LIMIT, stepCounts[i])
        }
      })
      // The retry of a step whose outcome was not seen: the same request id answers the recorded return and writes nothing.
      const returnsBefore = await h.one('SELECT COUNT(*) AS n FROM returns')
      const replay = await h.call('POST', '/api/returns', firstRequest, 'take back replay')
      const returnsAfter = await h.one('SELECT COUNT(*) AS n FROM returns')
      r.check(`a take-back step sent again with its request id answers the same return (${replay.status}, ${replay.body.id}) in ${statementsOf('take back replay')} statements and writes no second return`, () => {
        assert.equal(replay.status, 200, JSON.stringify(replay.body))
        assert.equal(replay.body.id, taken[0])
        assert.equal(returnsAfter.n, returnsBefore.n)
      })
      const stockOf = async (ids) => Promise.all(ids.map(async id => Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', id)).quantity)))
      const lotsOf = async (ids) => Promise.all(ids.map(async id => Number((await h.one('SELECT COALESCE(SUM(bbs.quantity),0) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=?', id)).n)))
      const movementsOf = async (reason) => h.all(`SELECT movement_type,quantity,reference_id,product_id FROM inventory_movements WHERE reason=? AND reference_id IN (${[x.ret.id, ...taken].join(',')}) ORDER BY id`, reason)
      const shelf = async () => ({ back: await stockOf(backs), out: await stockOf(outs), lots: await lotsOf([...backs, ...outs]) })
      const returnStatuses = async () => ({ ret: await statusOf(x.ret.id), taken: await Promise.all(taken.map(statusOf)) })
      const withTakeBacks = await shelf()
      const done = await cancel(x.ret.id, 'cf-cancel-5', taken)
      const cancelN = callsOf(`cancel ${x.ret.id}`)
      const afterCancel = await shelf()
      const appliedMoves = await movementsOf('Apply grouped return status')
      const statusAfterCancel = await returnStatuses()
      r.check(`5 back / 5 out, all 5 take-backs linked: the cancel is recorded on Free (${done.status}); ${cancelN} statements (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.ok(cancelN > 0 && cancelN <= H.FREE_QUERY_LIMIT, `cancel ${cancelN}`)
      })
      r.check('...and it did exactly what the cancel does: the five returned units leave the shelf (one movement each, a reversal of that return), the take-backs stay completed', () => {
        assert.deepEqual(afterCancel.back, withTakeBacks.back.map(n => n - 1))
        assert.deepEqual(afterCancel.out, withTakeBacks.out)
        assert.deepEqual(afterCancel.lots, withTakeBacks.lots.map((n, i) => i < 5 ? n - 1 : n), 'the lot ledger moved with the branch ledger')
        assert.deepEqual(appliedMoves.map(m => [m.movement_type, Number(m.quantity), Number(m.reference_id)]), backs.map(() => ['return_reversal', -1, x.ret.id]))
        assert.deepEqual(statusAfterCancel, { ret: 'cancelled', taken: taken.map(() => 'completed') })
      })
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo 5')
      const afterUndo = await shelf()
      const undoMoves = await movementsOf('Undo grouped return status')
      const statusAfterUndo = await returnStatuses()
      r.check(`...undo (${undone.status}, ${statementsOf('cf undo 5')} statements) fits and reverses it: the return is completed again, the five take-backs are cancelled, the shelf is the exchange's`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.ok(callsOf('cf undo 5') <= H.FREE_QUERY_LIMIT)
        assert.deepEqual(statusAfterUndo, { ret: 'completed', taken: taken.map(() => 'cancelled') })
        assert.deepEqual(afterUndo.back, afterCancel.back.map(n => n + 1), 'the returned units are back on the shelf')
        assert.deepEqual(afterUndo.out, afterCancel.out.map(n => n - 1), 'the replacement units are with the customer again')
        assert.equal(undoMoves.length, 10)
        assert.deepEqual(undoMoves.filter(m => m.movement_type === 'return').map(m => [Number(m.quantity), Number(m.reference_id)]), backs.map(() => [1, x.ret.id]))
        assert.deepEqual(undoMoves.filter(m => m.movement_type === 'return_reversal').map(m => [Number(m.quantity), Number(m.reference_id)]), taken.map(id => [-1, id]))
      })
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf redo 5')
      const afterRedo = await shelf()
      const statusAfterRedo = await returnStatuses()
      r.check(`...and redo (${redone.status}, ${statementsOf('cf redo 5')} statements) puts the cancel back exactly`, () => {
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.ok(callsOf('cf redo 5') <= H.FREE_QUERY_LIMIT)
        assert.deepEqual(afterRedo, afterCancel)
        assert.deepEqual(statusAfterRedo, { ret: 'cancelled', taken: taken.map(() => 'completed') })
      })
      console.log(`5 / 5 cancel ${cancelN}, undo ${statementsOf('cf undo 5')}, redo ${statementsOf('cf redo 5')} statements (Free limit ${H.FREE_QUERY_LIMIT})`)
    }

    // 5 back cancelled with the whole replacement KEPT: the credit moves to Not Paid in the same single batch.
    {
      const x = await exchange(await makeSale([9815, 9816, 9817, 9818, 9819]), 5)
      const kept = await cancel(x.ret.id, 'cf-cancel-5-keep', [])
      const keptN = callsOf(`cancel ${x.ret.id}`)
      const keptState = { ret: await statusOf(x.ret.id), sale: (await h.one('SELECT sale_status FROM sales WHERE id=?', x.s2.id)).sale_status }
      r.check(`5 back cancelled with the replacement kept: ${kept.status}, ${keptN} statements (limit ${H.FREE_QUERY_LIMIT}); the sale owes the credit as Not Paid`, () => {
        assert.equal(kept.status, 200, JSON.stringify(kept.body))
        assert.ok(keptN > 0 && keptN <= H.FREE_QUERY_LIMIT, `cancel ${keptN}`)
        assert.deepEqual(keptState, { ret: 'cancelled', sale: 'awaiting_payment' })
      })
    }

    // ---- 3. several exchanges cancelled together: what fits is one action, what does not is refused whole -----------------------------------------------------
    // Each exchange return adds its own sale tag to the one batch. Six together fit a Free invocation; eight do not and are refused up front, before anything is
    // written.
    {
      const together = async (n, tag) => {
        const made = []
        for (let i = 0; i < n; i += 1) made.push(await exchange(await makeSale([9810 + (i % 10)]), 1))
        const items = []
        for (const x of made) {
          const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', x.ret.id)
          items.push({ id: x.ret.id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null, replacement: { return_ids: [] } })
        }
        const before = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
        const res = await h.call('POST', '/api/returns/bulk', { client_request_id: `cf-multi-${tag}`, field: 'status', source: 'completed', target: 'cancelled', items }, `multi ${tag}`)
        const after = { stock: await stockSum(), lots: await lotSum(), history: await historyRows() }
        const statuses = await Promise.all(made.map(x => statusOf(x.ret.id)))
        return { made, res, before, after, statuses, statements: statementsOf(`multi ${tag}`), calls: callsOf(`multi ${tag}`) }
      }
      const six = await together(6, 'six')
      r.check(`6 exchanges cancelled in one request: ${six.res.status}, ${six.statements} statements (limit ${H.FREE_QUERY_LIMIT}); every one is cancelled`, () => {
        assert.equal(six.res.status, 200, JSON.stringify(six.res.body))
        assert.ok(six.calls > 0 && six.calls <= H.FREE_QUERY_LIMIT)
        assert.deepEqual(six.statuses, six.made.map(() => 'cancelled'))
      })
      const eight = await together(8, 'eight')
      // The cancel is ONE db.batch(): one call. Eight used to be refused up front (return_bulk_over_plan_budget) while every statement
      // of the batch was charged against the Free limit of 50; the D1 limits page counts a batch as a single query.
      r.check(`8 exchanges in one request: ${eight.res.status}, ${eight.statements} statements in ${eight.calls} calls; every one is cancelled`, () => {
        assert.equal(eight.res.status, 200, JSON.stringify(eight.res.body))
        assert.ok(eight.statements > six.statements, 'more statements than six')
        assert.ok(eight.calls > 0 && eight.calls <= H.FREE_QUERY_LIMIT, 'at most 50 calls')
        assert.deepEqual(eight.statuses, eight.made.map(() => 'cancelled'))
      })
    }

    // ---- 4. the screen's steps are checked BEFORE anything is written (release review P2-1, P3; 6.0.966 for the steps) -----------------------------------------------
    // The screen asks the dry run first, then each take-back's own admission, then makes the take-backs and sends the cancel. A dry run of the cancel (the
    // take-backs announced, not made) refuses what the real cancel would refuse -- for EVERY selected exchange -- and tells the screen to make the take-backs one
    // line at a time on this plan.
    {
      const returnsCount = async () => Number((await h.one('SELECT COUNT(*) AS n FROM returns')).n)
      const itemOf = async (x, replacement) => {
        const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', x.ret.id)
        return { id: x.ret.id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null, replacement }
      }
      const dryItems = (items, key) => h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled', dry_run: true, items }, key)
      const plannedOf = async (x, from, to) => (await h.all('SELECT id FROM sale_items WHERE sale_id=? ORDER BY id', x.s2.id)).slice(from, to).map(line => ({ sale_item_id: line.id, quantity: 1 }))
      // 2 back / 2 out: both lines announced fit, and the answer says to make them one line at a time on this plan.
      const two = await exchange(await makeSale([9817, 9818]), 2)
      const returnsBefore = await returnsCount()
      const both = await dryItems([await itemOf(two, { return_ids: [], planned: await plannedOf(two, 0, 2) })], 'cf-dry-two-both')
      const returnsAfter = await returnsCount()
      r.check(`2 back / 2 out, both lines announced: the dry run passes (${both.status}, ${both.body.statements} statements) and says one line at a time (takeBackPerLine ${both.body.takeBackPerLine}); no return was written`, () => {
        assert.equal(both.status, 200, JSON.stringify(both.body))
        assert.equal(both.body.dryRun, true)
        assert.equal(both.body.takeBackPerLine, true)
        assert.equal(returnsAfter, returnsBefore)
      })
      // More returns than one action may link are refused before any is made.
      const tooMany = await dryItems([await itemOf(two, { return_ids: [], planned: Array.from({ length: 11 }, (_, i) => ({ sale_item_id: 880000 + i, quantity: 1 })) })], 'cf-dry-eleven')
      r.check(`11 announced lines on this plan would be 11 linked returns: refused first (${tooMany.status} ${tooMany.body.code})`, () => {
        assert.equal(tooMany.status, 400)
        assert.equal(tooMany.body.code, 'customer_return_over_plan_budget')
      })
      // A retry after part of the take-backs exist: the ones made are named, the rest announced.
      const wide = await exchange(await makeSale([9819]), 1, 3, 'none')
      const firstOnly = await takeBack(wide.s2, 0, 1, 'cf-take-wide-0')
      const resumed = await dryItems([await itemOf(wide, { return_ids: [firstOnly.id], planned: await plannedOf(wide, 1, 3) })], 'cf-dry-wide-resume')
      r.check(`1 back / 3 out, one take-back made and two announced (a retry): the dry run passes (${resumed.status})`, () => {
        assert.equal(firstOnly.status, 200, JSON.stringify(firstOnly.body))
        assert.equal(resumed.status, 200, JSON.stringify(resumed.body))
      })
      const second = await takeBack(wide.s2, 1, 2, 'cf-take-wide-1')
      const third = await takeBack(wide.s2, 2, 3, 'cf-take-wide-2')
      const real = await cancel(wide.ret.id, 'cf-cancel-wide', [firstOnly.id, second.id, third.id])
      r.check(`...the missing steps are made one line at a time (${second.status}, ${third.status}) and the cancel links all three (${real.status})`, () => {
        assert.equal(second.status, 200, JSON.stringify(second.body))
        assert.equal(third.status, 200, JSON.stringify(third.body))
        assert.equal(real.status, 200, JSON.stringify(real.body))
      })
      // Several exchanges together: ONE refused item (an exchange that handed change back cannot be cancelled) refuses the whole selection and writes nothing.
      const fine = await exchange(await makeSale([9812]), 1)
      const withChange = await exchange(await makeSale([9813, 9814]), 2, 1)
      const returnsBeforeMix = await returnsCount()
      const historyBefore = await historyRows()
      const stockBefore = await stockSum()
      const mixed = await dryItems([await itemOf(fine, { return_ids: [], planned: await plannedOf(fine, 0, 1) }), await itemOf(withChange, { return_ids: [] })], 'cf-dry-mixed')
      const mixedReversed = await dryItems([await itemOf(withChange, { return_ids: [] }), await itemOf(fine, { return_ids: [], planned: await plannedOf(fine, 0, 1) })], 'cf-dry-mixed-reversed')
      const mixedAfter = [await returnsCount(), await historyRows(), await stockSum()]
      const mixedStatuses = [await statusOf(fine.ret.id), await statusOf(withChange.ret.id)]
      r.check(`two exchanges selected together, the second handed change back: the dry run refuses the selection (${mixed.status} ${mixed.body.code}; reversed order ${mixedReversed.status} ${mixedReversed.body.code}) and nothing is written`, () => {
        assert.equal(mixed.status, 409)
        assert.equal(mixed.body.code, 'return_cancel_exchange_change')
        assert.equal(mixedReversed.status, 409)
        assert.equal(mixedReversed.body.code, 'return_cancel_exchange_change')
        assert.deepEqual(mixedAfter, [returnsBeforeMix, historyBefore, stockBefore])
        assert.deepEqual(mixedStatuses, ['completed', 'completed'])
      })
    }

    // ---- 5. the units a cancel takes off the shelf must still be there ------------------------------------------------------------------------------------------
    // A returned unit that has been sold on since cannot leave the shelf again: the grouped write checks the END state of every product, branch and lot it
    // touches and refuses the whole cancel, writing nothing, in the one set-based statement that replaced the per-line guards.
    {
      const x = await exchange(await makeSale([9811]), 1)
      // The fixture sells the unit on: a stock write needs the same permit the Worker takes.
      await h.db.batch([
        h.db.prepare("INSERT INTO system_flags(key,value,updated_at) VALUES('stock_transaction_permit','legacy-separate-pool-v1',CURRENT_TIMESTAMP)"),
        h.db.prepare('UPDATE products SET stock_quantity=0 WHERE id=9811'),
        h.db.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=9811 AND branch_id=1'),
        h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
      ])
      const before = { history: await historyRows(), lots: await lotSum() }
      const refused = await cancel(x.ret.id, 'cf-cancel-sold-on', [])
      const after = { history: await historyRows(), lots: await lotSum() }
      const soldOnStatus = await statusOf(x.ret.id)
      r.check(`the returned unit is no longer on the shelf: the cancel is refused whole (${refused.status}) and writes nothing`, () => {
        assert.ok(refused.status === 409 || refused.status === 400, JSON.stringify(refused.body))
        assert.equal(soldOnStatus, 'completed')
        assert.deepEqual(after, before)
      })
    }

    // ---- 6. an action recorded by an older build still undoes and redoes (the replay is the new set-based one) -------------------------------------------------------
    // A snapshot written before the exchange fields existed has no linked / credit / money member fields, no tagged flag and no sale statuses. The undo and
    // redo of it read only what is there, and put the shelf and the return back exactly.
    {
      const x = await exchange(await makeSale([9812]), 1)
      const plain = await takeBack(x.s2, 0, 1, 'cf-old-snapshot-take')
      assert.equal(plain.status, 200, JSON.stringify(plain.body))
      const shelf = async () => Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=9830 AND branch_id=1')).quantity)
      const completedShelf = await shelf()
      const done = await cancel(plain.id, 'cf-old-snapshot-cancel', undefined)
      const cancelledShelf = await shelf()
      await h.db.prepare("UPDATE undo_snapshots SET payload_json=json_remove(payload_json,'$.tagged','$.saleStatuses','$.members[0].money','$.members[0].credit','$.members[0].linked') WHERE id=(SELECT snapshot_id FROM return_bulk_operations WHERE history_id=?)").bind(done.body.actionHistoryId).run()
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf old undo')
      const undoneStatus = await statusOf(plain.id)
      const undoneShelf = await shelf()
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf old redo')
      const redoneStatus = await statusOf(plain.id)
      r.check(`a snapshot without the newer member fields: cancel (${done.status}), undo (${undone.status}) and redo (${redone.status}) put the return and the shelf back exactly`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.equal(cancelledShelf, completedShelf - 1, 'cancelling takes the take-back off the shelf again')
        assert.deepEqual([undoneStatus, undoneShelf, redoneStatus], ['completed', completedShelf, 'cancelled'])
      })
    }

    // ---- 7. the order the dialog really uses: a quote is bound to the replacement sale's revision (6.0.966 review P1-1) ----------------------------------------
    // The dialog asks every admission first (a quote per step, writing nothing), then makes the steps. A quote read BEFORE step 1 is stale for step 2: step 1
    // moves the replacement sale's revision and the Worker refuses the stale one. So each step reads its own quote right before its create.
    {
      const x = await exchange(await makeSale([9810, 9812, 9813]), 3)
      const lines = await h.all('SELECT id,product_id FROM sale_items WHERE sale_id=? ORDER BY id', x.s2.id)
      const quoteLine = async (i, label) => {
        const q = await h.call('POST', '/api/returns/quote', { sale_id: x.s2.id, items: [{ sale_item_id: lines[i].id, quantity: 1 }] }, label)
        assert.equal(q.status, 200, JSON.stringify(q.body))
        const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = q.body
        return expected
      }
      const createLine = (i, key, expected) => h.call('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: x.s2.id, reason: 'CF take back', expected_quote: expected,
        items: [{ sale_item_id: lines[i].id, product_id: lines[i].product_id, quantity: 1, stock_action: 'restock', branch_id: 1 }] }, `create ${key}`)
      const validation0 = await quoteLine(0, 'validate 0')
      const validation1 = await quoteLine(1, 'validate 1')
      const step0 = await createLine(0, 'cf-order-0', validation0)
      const staleStep1 = await createLine(1, 'cf-order-1', validation1)
      const staleReturns = Number((await h.one('SELECT COUNT(*) AS n FROM returns WHERE sale_id=?', x.s2.id)).n)
      const freshStep1 = await createLine(1, 'cf-order-1b', await quoteLine(1, 'fresh 1'))
      const freshStep2 = await createLine(2, 'cf-order-2', await quoteLine(2, 'fresh 2'))
      r.check(`a quote read before step 1 is refused for step 2 (${staleStep1.status} ${staleStep1.body.code}, nothing written); a quote read right before each create lands all three (${step0.status}, ${freshStep1.status}, ${freshStep2.status})`, () => {
        assert.equal(step0.status, 200, JSON.stringify(step0.body))
        assert.equal(staleStep1.status, 409)
        assert.equal(staleStep1.body.code, 'customer_return_quote_stale')
        assert.equal(staleReturns, 1)
        assert.equal(freshStep1.status, 200, JSON.stringify(freshStep1.body))
        assert.equal(freshStep2.status, 200, JSON.stringify(freshStep2.body))
      })
      const linked = [step0.body.id, freshStep1.body.id, freshStep2.body.id]
      const done = await cancel(x.ret.id, 'cf-order-cancel', linked)
      r.check(`...and the cancel links the three steps (${done.status}, ${statementsOf(`cancel ${x.ret.id}`)} statements)`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.ok(callsOf(`cancel ${x.ret.id}`) <= H.FREE_QUERY_LIMIT)
      })
    }

    // ---- 8. the Worker, not the dialog, knows which take-backs belong to the exchange (6.0.966 review P2-1) -------------------------------------------------------
    // Cancelling an exchange links EVERY active return of its replacement sale, whether or not the request names it, and splits each one again, debt first.
    // A dialog that was closed and reopened (it names none) must leave exactly the money a dialog that named them would.
    {
      const figures = async (x, takeBacks) => ({
        takeBacks: await Promise.all(takeBacks.map(async id => { const row = await h.one('SELECT status,owed_reduction_usd,refund_currency,total_refund_usd FROM returns WHERE id=?', id); return [row.status, row.owed_reduction_usd, row.refund_currency, row.total_refund_usd] })),
        exchange: (await h.one('SELECT status FROM returns WHERE id=?', x.ret.id)).status,
        sale: await h.one('SELECT sale_status,payment_method,payment_details,amount_paid_usd,amount_paid_khr FROM sales WHERE id=?', x.s2.id),
      })
      const pair = async (skus, tag) => {
        const x = await exchange(await makeSale(skus), skus.length)
        const taken = []
        for (let i = 0; i < skus.length - 1; i += 1) { const one = await takeBack(x.s2, i, i + 1, `cf-${tag}-take-${i}`); assert.equal(one.status, 200, JSON.stringify(one.body)); taken.push(one.id) }
        return { x, taken }
      }
      const named = await pair([9813, 9814, 9815], 'named')
      const omitted = await pair([9816, 9817, 9818], 'omitted')
      const partial = await pair([9819, 9810, 9812], 'partial')
      const namedDone = await cancel(named.x.ret.id, 'cf-named', named.taken)
      const omittedDone = await cancel(omitted.x.ret.id, 'cf-omitted', [])
      const partialDone = await cancel(partial.x.ret.id, 'cf-partial', partial.taken.slice(0, 1))
      const fNamed = await figures(named.x, named.taken)
      const fOmitted = await figures(omitted.x, omitted.taken)
      const fPartial = await figures(partial.x, partial.taken)
      r.check(`an exchange cancelled naming its two take-backs, naming none, and naming one of two: all ${namedDone.status}/${omittedDone.status}/${partialDone.status}`, () => {
        for (const done of [namedDone, omittedDone, partialDone]) assert.equal(done.status, 200, JSON.stringify(done.body))
      })
      r.check('...the omitted take-backs are split again exactly like the named ones: owed (debt) and cash figures, currency, the exchange and the replacement sale all match', () => {
        assert.deepEqual(fOmitted, fNamed)
        assert.deepEqual(fPartial, fNamed)
        assert.ok(fNamed.takeBacks.every(([status, owed]) => status === 'completed' && Number(owed) > 0), 'the refund became debt reduction (Not Paid), not cash: ' + JSON.stringify(fNamed.takeBacks))
        assert.equal(fNamed.sale.sale_status, 'awaiting_payment')
      })
      // Undo of the cancel that named none moves the found take-backs with it.
      const undone = await H.historyStep(h, omittedDone.body.actionHistoryId, 'undo', await generationOf(omittedDone.body.actionHistoryId), 'cf undo omitted')
      const afterUndo = await Promise.all(omitted.taken.map(statusOf))
      r.check(`...and undoing the cancel that named none (${undone.status}) cancels the take-backs it found: ${afterUndo.join(', ')}`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.deepEqual(afterUndo, omitted.taken.map(() => 'cancelled'))
      })
      // A request that gives NO answer is still asked about the units that remain: the found take-backs do not stand in for the choice.
      const asked = await pair([9812, 9813, 9814], 'asked')
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', asked.x.ret.id)
      const refused = await h.call('POST', '/api/returns/bulk', { client_request_id: 'cf-asked', field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id: asked.x.ret.id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null }] }, 'cancel unanswered')
      r.check(`a cancel with no answer, take-backs present: still ${refused.status} ${refused.body.code} for the units left; the exchange stays completed`, () => {
        assert.equal(refused.status, 409)
        assert.equal(refused.body.code, 'return_cancel_replacement_choice_required')
      })
      assert.equal(await statusOf(asked.x.ret.id), 'completed')
    }

    // ---- 9. only TAKE-BACKS follow the cancel (6.0.966 delta review N1, N2) ------------------------------------------------------------------------------------------
    // An ordinary return of a replacement line (a "Defective" cash refund made at the till days later) is not a take-back the cancel flow made: the cancel does
    // not re-split it and the undo of the cancel does not cancel it. Take-backs are marked by the server-checked request id 'rtb-<exchange>_...'.
    {
      const x = await exchange(await makeSale([9814, 9815]), 2)
      const ordinary = await takeBack(x.s2, 0, 1, 'cf-defective', { ordinary: true, reason: 'Defective' })
      assert.equal(ordinary.status, 200, JSON.stringify(ordinary.body))
      const shelfOf = async id => Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', id)).quantity)
      const ordinaryRow = async () => { const row = await h.one('SELECT status,reason,owed_reduction_usd,refund_currency,total_refund_usd FROM returns WHERE id=?', ordinary.id); return [row.status, row.reason, Number(row.owed_reduction_usd), row.refund_currency, Number(row.total_refund_usd)] }
      const moneyOf = async () => ({ shelf: await shelfOf(9830), ordinary: await ordinaryRow() })
      const before = await moneyOf()
      const done = await cancel(x.ret.id, 'cf-defective-cancel', [])
      const afterCancel = await moneyOf()
      const label = (await h.one('SELECT label FROM action_history WHERE id=?', done.body.actionHistoryId)).label
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), 'cf undo defective')
      const afterUndo = await moneyOf()
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), 'cf redo defective')
      const afterRedo = await moneyOf()
      r.check(`an ordinary return of a replacement line: the cancel (${done.status}), its undo (${undone.status}) and redo (${redone.status}) leave it completed with its stock, cash refund and owed untouched`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.deepEqual([before.ordinary[0], before.ordinary[1], before.ordinary[2], before.ordinary[4]], ['completed', 'Defective', 0, 10], 'it starts as a plain cash refund')
        assert.deepEqual(afterCancel, before)
        assert.deepEqual(afterUndo, before)
        assert.deepEqual(afterRedo, before)
        assert.doesNotMatch(label, /taken back with it/, 'the action does not claim the ordinary return: ' + label)
      })
      // The mark is the server's to give: a marked request for anything that is not a return of that exchange's replacement sale is refused.
      const other = await makeSale([9816])
      const otherLine = (await h.all('SELECT id,product_id FROM sale_items WHERE sale_id=?', other.id))[0]
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: other.id, items: [{ sale_item_id: otherLine.id, quantity: 1 }] }, 'quote other')
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      const forged = await h.call('POST', '/api/returns', { client_request_id: `rtb-${x.ret.id}_forged`, money_precision_version: 1, sale_id: other.id, reason: 'forged', expected_quote: expected,
        items: [{ sale_item_id: otherLine.id, product_id: otherLine.product_id, quantity: 1, stock_action: 'restock', branch_id: 1 }] }, 'forged mark')
      const forgedGone = await h.one('SELECT COUNT(*) AS n FROM returns WHERE client_request_id=?', `rtb-${x.ret.id}_forged`)
      r.check(`a return of another sale that claims to be a take-back is refused (${forged.status} ${forged.body.code}) and nothing is written`, () => {
        assert.equal(forged.status, 400)
        assert.equal(forged.body.code, 'take_back_marker_invalid')
        assert.equal(forgedGone.n, 0)
      })

      // N2: a selection that holds an exchange that is already cancelled is not refused whole: the cancelled one is unchanged, the rest is cancelled.
      const y = await exchange(await makeSale([9817, 9818]), 2)
      const mark = await takeBack(y.s2, 0, 1, 'cf-mixed-take')
      assert.equal(mark.status, 200, JSON.stringify(mark.body))
      const first = await cancel(y.ret.id, 'cf-mixed-first', [mark.id])
      const plain = await exchange(await makeSale([9819]), 1)
      const itemFor = async (id, replacement) => { const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id); return { id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null, ...(replacement ? { replacement } : {}) } }
      const mixed = await h.call('POST', '/api/returns/bulk', { client_request_id: 'cf-mixed', field: 'status', source: 'completed', target: 'cancelled', items: [await itemFor(y.ret.id), await itemFor(plain.ret.id, { return_ids: [] })] }, 'mixed')
      const mixedStatus = [await statusOf(y.ret.id), await statusOf(plain.ret.id), await statusOf(mark.id)]
      r.check(`a selection holding an already-cancelled exchange (with its take-back) and a live one: ${mixed.status}; the live one is cancelled, the cancelled one is unchanged`, () => {
        assert.equal(first.status, 200, JSON.stringify(first.body))
        assert.equal(mixed.status, 200, JSON.stringify(mixed.body))
        assert.deepEqual(mixed.body.unchangedIds, [y.ret.id])
        assert.deepEqual(mixed.body.changedIds, [plain.ret.id])
        assert.deepEqual(mixedStatus, ['cancelled', 'cancelled', 'completed'])
      })
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
