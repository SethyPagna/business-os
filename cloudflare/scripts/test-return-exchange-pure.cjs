// 6.0.958 -- the pure money of a one-step exchange on a money-v1 sale: how the replacement lines are priced, what the quote
// the till reviews says, and how the refund's cash share is settled as a tender towards the replacement sale (credit row +
// the customer's rows, overpayment = actual change, riel change rounded DOWN to 100).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.join(__dirname, '..')
const output = buildSync({
  stdin: { contents: fs.readFileSync(path.join(root, 'src/lib/returnExchange.ts'), 'utf8'), resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
}).outputFiles[0].text
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
const X = moduleObj.exports

const RATE = 4100
const product = (id, usd, extra = {}) => ({ id, name: `Product ${id}`, selling_price_usd: usd, selling_price_khr: Math.round(usd * RATE), cost_price_usd: 1, cost_price_khr: 4100, ...extra })
const priced = (lines) => X.priceExchangeLines({
  lines: lines.map(([id, usd, quantity, posted = null]) => ({
    intent: { product_id: id, branch_id: 1, batch_id: null, quantity, applied_price_usd: posted },
    product: product(id, usd), branchId: 1, unitCostUsd: 1, unitCostKhr: 4100,
  })),
  exchangeRate: RATE, evaluatedAt: '2026-10-22T03:00:00.000Z', poolKey: 'pool-958',
})
const settle = (over) => X.settleExchange({
  totalUsd: 0, creditUsd: 0, cashMethod: 'Cash', payment: { details: [], change_currency: 'USD' },
  exchangeRate: RATE, changeRateSetting: undefined, notPaid: false, ...over,
})

// ---- pricing -----------------------------------------------------------------------------------------------------------
{
  const swap = priced([[10, 10, 1]])
  assert.equal(swap.total_usd, 10)
  assert.equal(swap.total_khr, 41000)
  assert.equal(swap.rounding_adjustment_usd, 0)
  assert.equal(swap.lines[0].unit_price_usd, 10)
  assert.equal(swap.lines[0].key, 'r0')
  assert.ok(JSON.parse(swap.lines[0].pricing_snapshot_json).pool.rules.length === 0, 'a replacement carries no promotion rules')

  // The catalog price is ceilinged to the cent, a posted price likewise; the line total is exact at four places.
  const ceil = priced([[10, 3.001, 2], [11, 9, 1, 4.501]])
  assert.equal(ceil.lines[0].unit_price_usd, 3.01)
  assert.equal(ceil.lines[1].unit_price_usd, 4.51, 'a posted price is ceilinged to the cent like every v1 selling price')
  assert.equal(ceil.calculated_total_usd, 10.53)
  assert.equal(ceil.total_usd, 10.53)

  // Half a cent: the sale total is the cent-rounded sum and the signed residue is recorded.
  const half = priced([[10, 3.01, 0.5]])
  assert.equal(half.calculated_total_usd, 1.505)
  assert.equal(half.total_usd, 1.51)
  assert.equal(half.rounding_adjustment_usd, 0.005)

  assert.throws(() => priced([[10, 5, 0]]), /positive quantity/)
  assert.throws(() => priced([[10, 5, 1, -1]]), (error) => error.code === 'return_exchange_price_invalid')
}

// ---- the quote ----------------------------------------------------------------------------------------------------------
const quote = (pricing, refund, owed = 0, notPaid = false) => X.buildExchangeQuoteV1({
  saleId: 7, exchangeRate: RATE, pricing, refundUsd: refund, owedReductionUsd: owed, notPaid,
})
{
  const pay = quote(priced([[11, 16, 1]]), 10)
  assert.deepEqual({ t: pay.total_usd, r: pay.refund_usd, c: pay.credit_usd, n: pay.net_usd }, { t: 16, r: 10, c: 10, n: 6 })
  const back = quote(priced([[11, 6.5, 1]]), 10)
  assert.equal(back.net_usd, -3.5)
  const even = quote(priced([[11, 10, 1]]), 10)
  assert.equal(even.net_usd, 0)
  const debt = quote(priced([[11, 10, 1]]), 10, 10, true)
  assert.deepEqual({ c: debt.credit_usd, n: debt.net_usd, np: debt.not_paid }, { c: 0, n: 10, np: true }, 'a debt-lowering refund is never cash, so nothing is netted')

  // The expected quote round-trips and any drift is a different object (the stale check is plain equality).
  const echoed = X.canonicalExchangeExpected(JSON.parse(JSON.stringify(pay)))
  assert.equal(JSON.stringify(echoed), JSON.stringify(pay))
  assert.throws(() => X.canonicalExchangeExpected({ ...pay, extra: 1 }), (error) => error.code === 'return_exchange_quote_invalid')
  assert.throws(() => X.canonicalExchangeExpected({ ...pay, lines: [] }), (error) => error.code === 'return_exchange_quote_invalid')
  const { net_usd, ...missing } = pay
  assert.throws(() => X.canonicalExchangeExpected(missing), (error) => error.code === 'return_exchange_quote_invalid')
}

// ---- the customer's rows ------------------------------------------------------------------------------------------------
{
  assert.deepEqual(X.canonicalExchangePayment(undefined), { details: [], change_currency: 'USD' })
  assert.deepEqual(X.canonicalExchangePayment({ details: [{ method: ' ABA ', amount_usd: '6', amount_khr: 0 }], change_currency: 'khr' }),
    { details: [{ method: 'ABA', amount_usd: 6, amount_khr: 0 }], change_currency: 'KHR' })
  for (const bad of [
    { details: [{ method: '', amount_usd: 1 }] }, { details: [{ method: 'Cash', amount_usd: 0, amount_khr: 0 }] },
    { details: [{ method: 'Cash', amount_usd: 1.005 }] }, { details: [{ method: 'Cash', amount_khr: 10.5 }] },
    { details: [{ method: 'Cash', amount_usd: -1 }] }, { details: [{ method: 'A + B', amount_usd: 1 }] },
    { change_currency: 'EUR' }, { details: 'x' }, { surprise: 1 },
    { details: Array.from({ length: 12 }, () => ({ method: 'Cash', amount_usd: 1 })) },
  ]) assert.throws(() => X.canonicalExchangePayment(bad), (error) => error.code === 'return_exchange_payment_invalid', JSON.stringify(bad))
}

// ---- settling the tender: the worked examples ---------------------------------------------------------------------------
const row = (method, amount_usd, amount_khr = 0) => ({ method, amount_usd, amount_khr })
{
  // 1. Same product, net zero: the credit alone covers the sale, nothing changes hands.
  const even = settle({ totalUsd: 10, creditUsd: 10 })
  assert.deepEqual(even.paymentDetails, [row('Cash', 10)])
  assert.deepEqual({ usd: even.amountPaidUsd, khr: even.amountPaidKhr, st: even.saleStatus }, { usd: 10, khr: 0, st: 'completed' })
  assert.deepEqual({ ...even.change }, { changeUsd: 0, changeKhr: 0, changeIsActual: 0, changeExchangeRate: null })

  // 2. Different, dearer product: the customer pays the difference on top of the credit.
  const pay = settle({ totalUsd: 16, creditUsd: 10, payment: { details: [row('ABA', 6)], change_currency: 'USD' } })
  assert.deepEqual(pay.paymentDetails, [row('Cash', 10), row('ABA', 6)])
  assert.equal(pay.paymentMethod, 'Cash + ABA')
  assert.equal(pay.amountPaidUsd, 16)
  assert.equal(pay.change.changeIsActual, 0)

  // 3. Cheaper product, the difference handed back in dollars.
  const backUsd = settle({ totalUsd: 6.5, creditUsd: 10 })
  assert.deepEqual({ ...backUsd.change }, { changeUsd: 3.5, changeKhr: 0, changeIsActual: 1, changeExchangeRate: RATE })

  // 4. The same difference handed back in riel: 3.50 x 4100 = 14,350, rounded DOWN to 14,300 (50 riel stays with the till).
  const backKhr = settle({ totalUsd: 6.5, creditUsd: 10, payment: { details: [], change_currency: 'KHR' } })
  assert.deepEqual({ ...backKhr.change }, { changeUsd: 0, changeKhr: 14300, changeIsActual: 1, changeExchangeRate: RATE })

  // 5. A dedicated change rate converts the riel change (Part 534): 3.50 x 4000 = 14,000.
  const ownRate = settle({ totalUsd: 6.5, creditUsd: 10, changeRateSetting: '4000', payment: { details: [], change_currency: 'KHR' } })
  assert.equal(ownRate.change.changeKhr, 14000)
  assert.equal(ownRate.change.changeExchangeRate, 4000)

  // 6. More units than were returned: the whole extra is the customer's to pay.
  const extra = settle({ totalUsd: 30, creditUsd: 10, payment: { details: [row('Cash', 20)], change_currency: 'USD' } })
  assert.equal(extra.amountPaidUsd, 30)
  assert.equal(extra.saleStatus, 'completed')

  // 7. The customer pays the difference in riel: exact riel covers, and so does a shortfall under half a cent.
  const exactRiel = settle({ totalUsd: 16.1, creditUsd: 10, payment: { details: [row('Cash', 0, 25010)], change_currency: 'USD' } })
  assert.deepEqual({ st: exactRiel.saleStatus, ...exactRiel.change }, { st: 'completed', changeUsd: 0, changeKhr: 0, changeIsActual: 0, changeExchangeRate: null })
  const nearRiel = settle({ totalUsd: 16.1, creditUsd: 10, payment: { details: [row('Cash', 0, 25000)], change_currency: 'USD' } })
  assert.equal(nearRiel.saleStatus, 'completed', 'short by 0.0024 is inside the half-cent band')
  assert.throws(() => settle({ totalUsd: 16.1, creditUsd: 10, payment: { details: [row('Cash', 0, 24900)], change_currency: 'USD' } }),
    (error) => error.code === 'return_exchange_payment_short')

  // 8. Overpaying in riel: change is the exact overpayment, in the chosen currency (riel rounded down to 100).
  const overUsd = settle({ totalUsd: 16.1, creditUsd: 10, payment: { details: [row('Cash', 0, 30000)], change_currency: 'USD' } })
  assert.equal(overUsd.change.changeUsd, 1.22)
  const overKhr = settle({ totalUsd: 16.1, creditUsd: 10, payment: { details: [row('Cash', 0, 30000)], change_currency: 'KHR' } })
  assert.equal(overKhr.change.changeKhr, 4900)
  assert.equal(overKhr.change.changeUsd, 0)

  // 9. A paid original sale cannot leave the replacement short.
  assert.throws(() => settle({ totalUsd: 16, creditUsd: 10 }), (error) => error.code === 'return_exchange_payment_short' && error.statusCode === 409)

  // 10. A Not Paid original: a debt-lowering refund is no tender, so the replacement stays Not Paid; a cash share above the debt is credit.
  const owed = settle({ totalUsd: 10, creditUsd: 0, notPaid: true })
  assert.deepEqual(owed.paymentDetails, [])
  assert.deepEqual({ usd: owed.amountPaidUsd, khr: owed.amountPaidKhr, st: owed.saleStatus, method: owed.paymentMethod }, { usd: 0, khr: 0, st: 'awaiting_payment', method: '' })
  const partial = settle({ totalUsd: 10, creditUsd: 6, notPaid: true })
  assert.deepEqual({ usd: partial.amountPaidUsd, st: partial.saleStatus }, { usd: 6, st: 'awaiting_payment' })
  const settledNow = settle({ totalUsd: 10, creditUsd: 6, notPaid: true, payment: { details: [row('Cash', 4)], change_currency: 'USD' } })
  assert.equal(settledNow.saleStatus, 'completed', 'a Not Paid original may be settled at the counter if the customer pays')

  // 11. The configured cash method names the credit row (the shift reads cash by method kind).
  assert.equal(settle({ totalUsd: 10, creditUsd: 10, cashMethod: 'Cash USD' }).paymentDetails[0].method, 'Cash USD')

  // 12. Too many rows are refused.
  assert.throws(() => settle({ totalUsd: 16, creditUsd: 10, payment: { details: Array.from({ length: 12 }, () => row('Cash', 1)), change_currency: 'USD' } }),
    (error) => error.code === 'return_exchange_payment_invalid')
}

console.log('PASS return exchange pricing, quote, tender and change')
