'use strict'
// P1.1: an in-return exchange create on the Free plan, counted in D1 calls. The whole Worker on workerd + D1 (harness/al_money_native.cjs),
// PLAN_TIER=free. The exchange is ONE atomic batch, so with call_counting ON it costs one call plus the reads around it; counted as statements
// (OFF, the old behaviour) a plan with ten damaged lines is refused whole.
//
//   ON : ten damaged lines + two out are recorded inside 50 calls although the request holds more than 50 statements; the same request
//        replayed answers from the receipt and writes nothing.
//   OFF: the same request is refused up front (customer_return_over_plan_budget) and NOTHING changes (row counts and both stock ledgers).
//   MUTANT: the batch charged as N statements again turns the ON world into the OFF answer, so the ON expectations would be red.
process.env.AL_PLAN_TIER = 'free'
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTANT = [{ name: 'mutant:exchange-charges-statements', file: 'src/lib/returnExchangeCreate.ts',
  from: 'const transactionStatementCount = args.callCounting ? 1 : stockTransactionStatementCount(statements.length)',
  to: 'const transactionStatementCount = stockTransactionStatementCount(statements.length)' }]
const TABLES = ['returns', 'return_items', 'return_replacement_items', 'sales', 'sale_items', 'inventory_movements', 'return_create_receipts', 'audit_logs']

async function world(mode, patches = []) {
  const h = await H.startWorker({ patches })
  await h.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: { call_counting: mode } })).run()
  for (let i = 0; i < 12; i += 1) await H.seedProduct(h, 9600 + i, `CX Item ${i}`, 10 + i, 200, 4)
  return h
}

const counts = async (h) => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, Number((await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n)])))
const stocks = async (h) => [Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock')).n), Number((await h.one('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_batch_stock')).n)]

// Ten lines sold, all ten returned damaged, two other products taken out: the exchange the statement count cannot carry.
async function heavyExchange(h, tag) {
  const productIds = [9602, 9603, 9604, 9605, 9606, 9607, 9608, 9609, 9610, 9611]
  const total = productIds.reduce((sum, id) => sum + 10 + (id - 9600), 0)
  const sale = await H.createSale(h, { key: `cx-sale-${tag}`, status: 'completed', lines: productIds.map((productId) => ({ productId, quantity: 1 })),
    paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] })
  assert.equal(sale.status, 200, JSON.stringify(sale.body))
  const items = await h.all('SELECT id,product_id FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
  const out = [{ branch_id: 1, product_id: 9600, quantity: 1 }, { branch_id: 1, product_id: 9601, quantity: 1 }]
  const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.body.id, items: items.map((item) => ({ sale_item_id: item.id, quantity: 1 })), replacement_items: out }, `cx ${tag}: quote`)
  assert.equal(quote.status, 200, JSON.stringify(quote.body))
  const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
  const body = { client_request_id: `cx-ret-${tag}`, money_precision_version: 1, sale_id: sale.body.id, reason: 'CX exchange', expected_quote: expected, expected_exchange: quoted,
    exchange_payment: { details: [], change_currency: 'USD' },
    items: items.map((item) => ({ sale_item_id: item.id, quantity: 1, stock_action: 'damaged', branch_id: 1 })), replacement_items: out }
  const before = { counts: await counts(h), stock: await stocks(h) }
  const created = await h.call('POST', '/api/returns', body, `cx ${tag}: create`)
  return { body, created, before, after: { counts: await counts(h), stock: await stocks(h) }, metric: h.metrics.find((entry) => entry.label === `cx ${tag}: create`) }
}

async function main() {
  const r = H.recorder('CALL-COUNTING-EXCHANGE')

  const on = await world('on')
  try {
    const run = await heavyExchange(on, 'on')
    r.check(`ON: ten damaged lines + two out are recorded (${run.created.status}) in ${run.metric.calls} calls (${run.metric.statements} statements)`, () => {
      assert.equal(run.created.status, 200, JSON.stringify(run.created.body))
      assert.ok(run.metric.calls <= H.FREE_QUERY_LIMIT, `${run.metric.calls} calls`)
      assert.ok(run.metric.statements > H.FREE_QUERY_LIMIT, `${run.metric.statements} statements: only legal when a batch counts as one call`)
    })
    if (run.created.status === 200) {
      const delta = (table) => run.after.counts[table] - run.before.counts[table]
      r.check('ON: every line was written exactly once (one return, ten returned lines, two replacement lines, one replacement sale)', () => {
        assert.equal(delta('returns'), 1)
        assert.equal(delta('return_items'), 10)
        assert.equal(delta('return_replacement_items'), 2)
        assert.equal(delta('sales'), 1)
        assert.equal(delta('return_create_receipts'), 1)
      })
      r.check('ON: the two units taken out left both stock ledgers by the same amount; damaged units did not restock', () => {
        assert.equal(run.before.stock[0] - run.after.stock[0], 2)
        assert.equal(run.before.stock[1] - run.after.stock[1], 2)
      })
      const before = await counts(on)
      const again = await on.call('POST', '/api/returns', run.body, 'cx on: replay')
      const afterReplay = await counts(on)
      r.check(`ON: the same request replayed answers from the receipt (${again.status}) and writes nothing`, () => {
        assert.equal(again.status, 200)
        assert.equal(again.body.id, run.created.body.id)
        assert.deepEqual(afterReplay, before)
      })
    }
  } finally { await on.mf.dispose() }

  const off = await world('off')
  try {
    const run = await heavyExchange(off, 'off')
    r.check(`OFF: the same exchange is refused up front with the old code (${run.created.status} ${run.created.body?.code}) and nothing changes`, () => {
      assert.ok([400, 409, 413, 422].includes(run.created.status), String(run.created.status))
      assert.match(String(run.created.body?.code), /over_plan_budget|return_too_large|plan_budget/)
      assert.deepEqual(run.after.counts, run.before.counts)
      assert.deepEqual(run.after.stock, run.before.stock)
    })
  } finally { await off.mf.dispose() }

  const mutated = await world('on', MUTANT)
  try {
    const run = await heavyExchange(mutated, 'mut')
    r.check(`MUTANT (batch charged as N statements): the ON exchange is refused (${run.created.status} ${run.created.body?.code}), so the ON expectations go red`, () => {
      assert.notEqual(run.created.status, 200)
      assert.match(String(run.created.body?.code), /over_plan_budget|return_too_large|plan_budget/)
      assert.deepEqual(run.after.counts, run.before.counts)
    })
  } finally { await mutated.mf.dispose() }

  const failed = r.results.filter((result) => !result.ok)
  console.log(`call-counting exchange native: ${r.results.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
