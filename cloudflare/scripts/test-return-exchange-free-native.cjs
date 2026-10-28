'use strict'
// Real Worker exchanges, replay and atomicity with the Free limit enforced on physical D1 calls.
process.env.AL_PLAN_TIER = 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTANTS = {
  // The admission control forgets the statements already spent: a plan that only fits an empty invocation is let through.
  'budget-ignores-used': { file: 'src/lib/returnExchangeCreate.ts', from: 'assertReturnCreateQueryBudget(args.queryLimit, args.statementsUsed(), transactionStatementCount, 14)',
    to: 'assertReturnCreateQueryBudget(args.queryLimit, 0, 0, 0)' },
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? [{ name: `mutant:${process.env.MUTANT}`, ...MUTANTS[process.env.MUTANT] }] : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []), d1CallLimit: H.FREE_QUERY_LIMIT })
  const r = H.recorder('RET-EXCHANGE-FREE')
  const report = []
  try {
    const batched = await h.call('GET', '/__fixture/d1-call-budget?batch=1', undefined, 'budget batch')
    const singles = await h.call('GET', '/__fixture/d1-call-budget', undefined, 'budget singles')
    r.check('native budget allows sixty batched statements and refuses physical call51', () => {
      assert.equal(batched.status, 200)
      assert.equal(batched.body.calls, 1)
      assert.equal(batched.body.statements, 60)
      assert.equal(singles.status, 503)
      assert.equal(singles.body.calls, 51)
      assert.match(singles.body.error, /Too many API requests/)
    })
    // Ten products to sell and ten to swap for, two more for the heavy cases.
    for (let i = 0; i < 22; i += 1) await H.seedProduct(h, 9600 + i, `FX Item ${i}`, 10 + i, 200, 4)
    let seq = 0
    const sellLines = async (productIds) => {
      const total = productIds.reduce((sum, id) => sum + 10 + (id - 9600), 0)
      const sale = await H.createSale(h, { key: `fx-sale-${++seq}`, status: 'completed', lines: productIds.map((productId) => ({ productId, quantity: 1 })),
        paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      const items = await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
      return { id: sale.body.id, items, total }
    }
    const tables = ['returns', 'return_items', 'return_replacement_items', 'sales', 'sale_items', 'inventory_movements', 'return_create_receipts', 'sale_item_batch_allocations', 'return_item_batch_allocations', 'audit_logs']
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, Number((await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n)])))
    const stockSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock')).n)
    const lotSum = async () => Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_batch_stock')).n)

    const exchange = async (sale, back, out, label, { key, payment, stockAction = 'restock', damagedCount = 0 } = {}) => {
      const mark = h.metrics.length
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id,
        items: back.map((index) => ({ sale_item_id: sale.items[index].id, quantity: 1 })),
        replacement_items: out.map((product_id) => ({ branch_id: 1, product_id, quantity: 1 })) }, `${label}: quote`)
      if (quote.status !== 200) return { quote, created: { status: quote.status, body: quote.body }, metrics: h.metrics.slice(mark) }
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const body = { client_request_id: key || `fx-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'FX exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: payment || { details: [], change_currency: 'USD' },
        items: back.map((index, position) => ({ sale_item_id: sale.items[index].id, quantity: 1, stock_action: position < damagedCount ? 'damaged' : stockAction, branch_id: 1 })),
        replacement_items: out.map((product_id) => ({ branch_id: 1, product_id, quantity: 1 })) }
      const created = await h.call('POST', '/api/returns', body, `${label}: create`)
      return { quote, quoted, created, body, metrics: h.metrics.slice(mark) }
    }
    const callsOf = (result, suffix) => result.metrics.find((entry) => entry.label.endsWith(suffix))?.calls ?? -1
    const statementsOf = (result, suffix) => result.metrics.find((entry) => entry.label.endsWith(suffix))?.statements ?? -1

    // ---- 1a. one line back, one out (the typical till exchange) ---------------------------------------------------------------------------
    {
      const sale = await sellLines([9600])
      const result = await exchange(sale, [0], [9601], 'exchange 1+1', { payment: { details: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }], change_currency: 'USD' } })
      const quoteN = callsOf(result, 'quote')
      const createN = callsOf(result, 'create')
      report.push(['1 back + 1 out', quoteN, createN])
      r.check(`1+1 is recorded on Free (${result.created?.status}); quote ${quoteN} calls, create ${createN} (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.ok(quoteN > 0 && quoteN <= H.FREE_QUERY_LIMIT, `quote ${quoteN}`)
        assert.ok(createN > 0 && createN <= H.FREE_QUERY_LIMIT, `create ${createN}`)
      })
      // The same call replayed (a retried tap): the recorded answer, inside the budget, no second record.
      const before = await counts()
      const replay = await h.call('POST', '/api/returns', result.body, 'exchange 1+1: replay')
      const after = await counts()
      const replayN = callsOf({ metrics: h.metrics.slice(-1) }, 'replay')
      report.push(['1 back + 1 out, replayed', 0, replayN])
      r.check(`1+1 replay answers from the receipt (${replay.status}), writes nothing (${replayN} statements)`, () => {
        assert.equal(replay.status, 200)
        assert.equal(replay.body.id, result.created.body.id)
        assert.deepEqual(after, before)
        assert.ok(replayN <= H.FREE_QUERY_LIMIT)
      })
    }

    // ---- 1b. five back, five out ---------------------------------------------------------------------------------------------------------------
    {
      const sale = await sellLines([9602, 9603, 9604, 9605, 9606])
      const outIds = [9607, 9608, 9609, 9610, 9611]
      const owed = outIds.reduce((sum, id) => sum + 10 + (id - 9600), 0) - sale.total
      const result = await exchange(sale, [0, 1, 2, 3, 4], outIds, 'exchange 5+5', { payment: { details: owed > 0 ? [{ method: 'Cash', amount_usd: owed, amount_khr: 0 }] : [], change_currency: 'USD' } })
      const quoteN = callsOf(result, 'quote')
      const createN = callsOf(result, 'create')
      report.push(['5 back + 5 out', quoteN, createN])
      r.check(`5+5 is recorded on Free (${result.created?.status}); quote ${quoteN} calls, create ${createN} (limit ${H.FREE_QUERY_LIMIT})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.ok(quoteN > 0 && quoteN <= H.FREE_QUERY_LIMIT, `quote ${quoteN}`)
        assert.ok(createN > 0 && createN <= H.FREE_QUERY_LIMIT, `create ${createN}`)
      })
      const rows = await h.all('SELECT COUNT(*) AS n FROM return_items WHERE return_id=?', result.created.body.id)
      const repl = await h.all('SELECT COUNT(*) AS n FROM return_replacement_items WHERE return_id=?', result.created.body.id)
      r.check(`5+5 wrote every line (${rows[0].n} returned, ${repl[0].n} replacement)`, () => assert.deepEqual([rows[0].n, repl[0].n], [5, 5]))
    }

    // ---- 1c. one returned line is damaged (its own disposal statements) ----------------------------------------------------------------------
    {
      const sale = await sellLines([9620, 9621])
      const result = await exchange(sale, [0, 1], [9612, 9613], 'exchange 2 back (1 damaged) + 2 out', { damagedCount: 1, payment: { details: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], change_currency: 'USD' } })
      const createN = callsOf(result, 'create')
      report.push(['2 back (1 damaged) + 2 out', statementsOf(result, 'quote'), createN])
      r.check(`a damaged line still fits Free (${result.created?.status}); create ${createN} calls`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.ok(createN <= H.FREE_QUERY_LIMIT)
      })
    }

    // ---- 2. a batch is ONE call: a plan far above 50 statements still fits a Free invocation ----------------------------------------------------
    {
      const sale = await sellLines([9612, 9613, 9614, 9615, 9616, 9617, 9618, 9619, 9620, 9621])
      // Ten damaged lines: every one is its own disposal statements. (The sale was 265, the two units out cost 21; the difference is given
      // back, so the payment is empty.) It used to be refused up front (over_plan_budget) because every statement of the batch was charged
      // against the Free limit of 50; the D1 limits page counts a db.batch() as one query, so the exchange is recorded.
      const heavy = await exchange(sale, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [9600, 9601], 'exchange 10 damaged + 2', { damagedCount: 10, payment: { details: [], change_currency: 'USD' } })
      const heavyStatements = statementsOf(heavy, 'create')
      const heavyCalls = heavy.metrics.find((entry) => entry.label.endsWith('create'))?.calls ?? -1
      report.push(['10 damaged back + 2 out', statementsOf(heavy, 'quote'), heavyStatements + ' (' + heavyCalls + ' calls)'])
      r.check(`10 damaged lines + 2 out is recorded on Free (${heavy.created?.status}): ${heavyStatements} statements in ${heavyCalls} calls`, () => {
        assert.equal(heavy.created.status, 200, JSON.stringify(heavy.created?.body))
        assert.ok(heavyStatements > H.FREE_QUERY_LIMIT, 'the plan holds more statements than the Free limit, which is not the limit')
        assert.ok(heavyCalls > 0 && heavyCalls <= H.FREE_QUERY_LIMIT, 'but it makes at most 50 calls')
      })
    }
  } finally {
    console.log('FREE-PLAN STATEMENT COUNTS (limit 50 CALLS per invocation; a batch is one call):')
    for (const [label, quote, create] of report) console.log(`  ${label}: quote ${quote}, create ${create}`)
    await h.mf.dispose()
  }
  const failed = r.results.filter((result) => !result.ok)
  if (failed.length) {
    console.log(`\n${failed.length} of ${r.results.length} checks FAILED`)
    process.exitCode = 1
  } else {
    console.log(`\n${r.results.length} Free-plan exchange checks passed`)
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
