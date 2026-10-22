'use strict'
// 6.0.958 (owner, 22 Oct 2026): "replacement actually isn't replacing but changing or adding both ... One step in Returns ... the customer pays,
// or gets back, the difference." A return against a MONEY-V1 sale records its replacement lines in the same call and settles the difference
// at the counter. The whole Worker on workerd + D1 (harness/al_money_native.cjs).
//
// The money model (lib/returnExchange.ts): the return books the refund R in dollars; the replacement is an ordinary money-v1 sale S2 of total T;
// the refund's cash share is S2's first tender row, the customer's own rows follow, and any overpayment is S2's ACTUAL change (riel rounded
// DOWN to 100). Cases, each traced through every record:
//   1. net zero:        1 back / 1 out of the same product -- no money moves, stock and lots net out, the lot is credited with the return;
//   2. customer pays:   1 back ($10) / 1 out ($16) -- pays $6 by card on top of the credit; and in riel ($16.10: 24,400 riel);
//   3. customer gets back: 1 back ($10) / 1 out ($6.48) -- $3.52 as dollar change, or as riel change rounded DOWN (14,080 -> 14,000);
//   4. more units than returned: 1 back / 3 out;
//   5. a Not Paid original: the refund lowers the debt, nothing is netted, the replacement is Not Paid;
//   6. the same request replayed: the recorded answer, nothing written twice;
//   4c. one product on two sale lines at different prices: each returned unit is floored at the line it came from, never at the pooled lowest (6.0.960);
//   7. refusals leave nothing behind: a short payment, a stale replacement quote, a price under the floor, more units than the shelf holds.
// MUTANT=<name> bundles ONE deliberate defect; BASE_COMMIT=<sha> bundles the Worker as that commit had it (red on a702ea0e7).
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTANTS = {
  // The validator behind it (planNativeSaleChange) refuses an amount above the overpayment, so rounding to nearest is a mutant only once the
  // fallback candidate is gone with it.
  'riel-rounds-nearest': { file: 'src/lib/returnExchange.ts', from: '[{ usd: 0, khr: floor100(surplus.changeKhr) }, { usd: 0, khr: Math.max(0, floor100(surplus.changeKhr) - 100) }]', to: '[{ usd: 0, khr: Math.round(surplus.changeKhr / 100) * 100 }]' },
  'riel-rounds-too-far': { file: 'src/lib/returnExchange.ts', from: '[{ usd: 0, khr: floor100(surplus.changeKhr) }, {', to: '[{ usd: 0, khr: Math.max(0, floor100(surplus.changeKhr) - 100) }, {' },
  'no-credit-row': { file: 'src/lib/returnExchange.ts', from: 'const credit = input.creditUsd > 0 ?', to: 'const credit = false ?' },
  'collected-reads-amount-paid': { file: 'src/lib/salesAnalytics.ts', from: "Number(sale.source_return_id || 0) !== 0 && version === 0", to: "Number(sale.source_return_id || 0) !== 0" },
  'lossy-context': { file: 'src/lib/returnExchangeContext.ts', from: "CASE WHEN typeof(${expression})='real' THEN json_object('${REAL_MARKER}',quote(${expression})) ELSE ${expression} END", to: '${expression}' },
  // 6.0.960 (release review P1-1): covered units pair with their own recorded lines; pooling them at the lowest price lets 11 dollars of units go out for 3.
  'pooled-floor': { file: 'src/lib/returnExchangeQuote.ts', from: 'returned: recordedSoldLinesForReplacement(soldLines as never, input.returnedLines, line.product_id, rate),',
    to: 'returned: (() => { const own = recordedSoldLinesForReplacement(soldLines as never, input.returnedLines, line.product_id, rate); return own.length ? [{ quantity: own.reduce((s, l) => s + l.quantity, 0), usd: Math.min(...own.map(l => l.usd ?? Infinity)), khr: Math.min(...own.map(l => l.khr ?? Infinity)) }] : [] })(),' },
  'credit-is-whole-refund': { file: 'src/lib/returnExchange.ts', from: 'credit_usd: credit,', to: 'credit_usd: input.refundUsd,' },
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? [{ name: `mutant:${process.env.MUTANT}`, ...MUTANTS[process.env.MUTANT] }] : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  const r = H.recorder('RET-EXCHANGE-V1')
  try {
    await H.seedProduct(h, 9501, 'EX1 Lipstick', 10, 200, 4)
    await H.seedProduct(h, 9502, 'EX1 Palette', 16, 200, 6)
    await H.seedProduct(h, 9503, 'EX1 Gloss', 6.48, 200, 2)
    // 9504's riel price is 16.1 * 4000 = 64400.00000000001: no 15-digit rendering carries it, and the commit's guard compares exact stored
    // values, so a context read that goes through json_object alone refuses this current row as a write conflict.
    await H.seedProduct(h, 9504, 'EX1 Powder', 16.1, 200, 6)
    await H.seedProduct(h, 9505, 'EX1 Serum', 8, 200, 3)
    await H.seedProduct(h, 9506, 'EX1 Primer', 10, 200, 4)
    const returnsOnly = await h.addEmployee(1951, 'ex1-returns-only', { returns: true })
    const withPrice = await h.addEmployee(1952, 'ex1-returns-pos', { returns: true, pos: true })

    let seq = 0
    const makeSale = async (lines, status = 'completed') => {
      const key = `ex1-sale-${++seq}`
      const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)
      const sale = await H.createSale(h, { key, status, lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity })),
        ...(status === 'completed' ? { paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] } : {}) })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      const items = await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
      return { id: sale.body.id, items }
    }
    // The Returns screen's two steps: the server quote (refund + replacement), then the create carrying exactly that quote.
    const quoteOf = (sale, back, out, extra = {}) => h.call('POST', '/api/returns/quote', { sale_id: sale.id,
      items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity })),
      replacement_items: out.map(line => ({ branch_id: 1, ...line })), ...extra }, 'exchange quote', { cookie: extra.cookie })
    const exchange = async (sale, back, out, { key, payment, cookie, tamper } = {}) => {
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id,
        items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }, 'exchange quote', cookie ? { cookie } : {})
      if (quote.status !== 200) return { quote, created: { status: quote.status, body: quote.body } } // a refused quote is the answer: nothing was created
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const body = { client_request_id: key || `ex1-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'EX1 exchange',
        expected_quote: expected, expected_exchange: tamper ? tamper(quoted) : quoted, exchange_payment: payment || { details: [], change_currency: 'USD' },
        items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }
      const created = await h.call('POST', '/api/returns', body, `exchange ${body.client_request_id}`, cookie ? { cookie } : {})
      if (created.status >= 500 || created.body?.code === 'write_conflict') console.log('D1 refused:', JSON.stringify((await h.call('GET', '/__fixture/d1-errors')).body))
      return { quote, quoted, created, body }
    }
    const stockOf = async productId => ({
      branch: Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', productId)).quantity),
      product: Number((await h.one('SELECT stock_quantity AS n FROM products WHERE id=?', productId)).n),
      lots: Number((await h.one(`SELECT COALESCE(SUM(bbs.quantity),0) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
        WHERE pb.variant_product_id=? AND bbs.branch_id=1`, productId)).n),
    })
    const rowsOf = async returnId => {
      if (returnId == null) return { ret: {}, sale: {}, pay: [], items: [], replacements: [], moves: [], allocated: 0 }
      const ret = await h.one('SELECT * FROM returns WHERE id=?', returnId)
      const sale = ret.replacement_sale_id ? await h.one('SELECT * FROM sales WHERE id=?', ret.replacement_sale_id) : null
      return {
        ret, sale,
        pay: sale ? JSON.parse(sale.payment_details || '[]') : [],
        items: sale ? await h.all('SELECT product_id,quantity,applied_price_usd,total_usd,total_khr,batch_id FROM sale_items WHERE sale_id=? ORDER BY id', sale.id) : [],
        replacements: await h.all('SELECT product_id,quantity,applied_price_usd,total_usd,sale_item_id FROM return_replacement_items WHERE return_id=? ORDER BY id', returnId),
        moves: await h.all('SELECT movement_type,product_id,quantity,batch_id FROM inventory_movements WHERE reference_id=? ORDER BY id', returnId),
        allocated: sale ? Number((await h.one(`SELECT COALESCE(SUM(sia.quantity),0) AS n FROM sale_item_batch_allocations sia
          JOIN sale_items si ON si.id=sia.sale_item_id WHERE si.sale_id=?`, sale.id)).n) : 0,
      }
    }
    const tables = ['returns', 'return_items', 'return_replacement_items', 'sales', 'sale_items', 'inventory_movements', 'return_create_receipts', 'sale_item_batch_allocations', 'return_item_batch_allocations']
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, Number((await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n)])))
    const ok = (result) => result.created && result.created.status === 200

    // ---- 1. net zero: the same product, one back one out ---------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 2, price: 10 }])
      const before = await stockOf(9501)
      const lotBefore = await h.one('SELECT received_quantity,is_active FROM product_batches WHERE id=?', 9501 + 5000)
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9501, quantity: 1 }])
      r.check(`net zero: the exchange is recorded (${result.created?.status}) and the quote said refund 10, replacement 10, net 0 -- ${JSON.stringify(result.quoted && [result.quoted.refund_usd, result.quoted.total_usd, result.quoted.credit_usd, result.quoted.net_usd])}`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.deepEqual([result.quoted.refund_usd, result.quoted.total_usd, result.quoted.credit_usd, result.quoted.net_usd], [10, 10, 10, 0])
      })
      const a = await rowsOf(result.created.body.id)
      const after = await stockOf(9501)
      r.check('net zero money: refund $10 USD cash; the replacement sale is v1, $10, paid by the refund credit alone, no change, linked both ways', () => {
        assert.deepEqual([a.ret.total_refund_usd, a.ret.refund_currency, a.ret.owed_reduction_usd, a.ret.money_precision_version], [10, 'USD', 0, 1])
        assert.deepEqual([a.sale.money_precision_version, a.sale.total_usd, a.sale.calculated_total_usd, a.sale.amount_paid_usd, a.sale.amount_paid_khr, a.sale.change_usd, a.sale.change_khr, a.sale.sale_status],
          [1, 10, 10, 10, 0, 0, 0, 'completed'])
        assert.deepEqual(a.pay, [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }])
        assert.equal(a.sale.source_return_id, a.ret.id)
        assert.equal(a.ret.replacement_sale_id, a.sale.id)
      })
      r.check(`net zero stock: nothing moves on the shelf (before ${JSON.stringify(before)}, after ${JSON.stringify(after)}); the lot is credited the returned unit; both movements are on the return`, () => {
        assert.equal(result.created.status, 200, 'the exchange happened (an unchanged shelf proves nothing otherwise)')
        assert.equal(a.moves.length, 2, 'and both its movements are on the return')
        assert.deepEqual(after, before)
      })
      const lotAfter = await h.one('SELECT received_quantity,is_active FROM product_batches WHERE id=?', 9501 + 5000)
      r.check(`the returned unit goes back into the lot the sale drew it from (received ${lotBefore.received_quantity} -> ${lotAfter.received_quantity}); movements ${JSON.stringify(a.moves)}`, () => {
        assert.equal(Number(lotAfter.received_quantity) - Number(lotBefore.received_quantity), 1)
        assert.deepEqual(a.moves.map(move => [move.movement_type, move.quantity]).sort(), [['replacement_out', -1], ['return', 1]])
        assert.equal(a.allocated, 1)
        assert.deepEqual(a.items.map(row => [row.quantity, row.applied_price_usd, row.total_usd, row.total_khr]), [[1, 10, 10, 40000]])
        assert.equal(a.replacements.length, 1)
        assert.ok(a.replacements[0].sale_item_id != null)
      })
    }

    // ---- 2. the customer pays the difference -----------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const before = await stockOf(9502)
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1 }], { payment: { details: [{ method: 'ABA', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' } })
      r.check(`customer pays: 1 x $10 back, 1 x $16 out, pays $6 by ABA (${result.created?.status})`, () => assert.equal(result.created.status, 200, JSON.stringify(result.created?.body)))
      const a = await rowsOf(result.created.body.id)
      r.check(`customer pays money: S2 $16 = credit Cash $10 + ABA $6, no change; refund $10 -- ${JSON.stringify(a.pay)}`, () => {
        assert.deepEqual(a.pay, [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }, { method: 'ABA', amount_usd: 6, amount_khr: 0 }])
        assert.deepEqual([a.sale.total_usd, a.sale.amount_paid_usd, a.sale.change_usd, a.sale.sale_status, a.sale.payment_method], [16, 16, 0, 'completed', 'Cash + ABA'])
        assert.equal(a.ret.total_refund_usd, 10)
      })
      const after = await stockOf(9502)
      r.check('different product: that product leaves the shelf by one (branch, product and lot ledger agree)', () => {
        assert.deepEqual([after.branch - before.branch, after.product - before.product, after.lots - before.lots], [-1, -1, -1])
      })
    }
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9504, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 0, amount_khr: 24400 }], change_currency: 'USD' } })
      r.check(`in riel: $16.10 out for $10 back is $6.10 = 24,400 riel at 4,000 -- covered exactly, no change (${result.created?.status})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
      })
      const a = await rowsOf(result.created.body.id)
      r.check(`riel tender: S2 paid $10 + 24,400 riel, total 16.10, no change -- ${JSON.stringify([a.sale.amount_paid_usd, a.sale.amount_paid_khr, a.sale.total_usd, a.sale.change_usd, a.sale.change_khr])}`, () => {
        assert.deepEqual([a.sale.amount_paid_usd, a.sale.amount_paid_khr, a.sale.total_usd, a.sale.change_usd, a.sale.change_khr], [10, 24400, 16.1, 0, 0])
      })
    }

    // ---- 3. the customer gets the difference back -----------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9503, quantity: 1 }], { payment: { details: [], change_currency: 'USD' } })
      r.check(`give back in dollars: $10 back, $6.48 out -> $3.52 change (${result.created?.status}; net ${result.quoted?.net_usd})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.equal(result.quoted.net_usd, -3.52)
      })
      const a = await rowsOf(result.created.body.id)
      r.check(`dollar change is actual: S2 $6.48 paid $10 (credit), change_usd 3.52, change_is_actual 1 -- ${JSON.stringify([a.sale.total_usd, a.sale.amount_paid_usd, a.sale.change_usd, a.sale.change_khr, a.sale.change_is_actual])}`, () => {
        assert.deepEqual([a.sale.total_usd, a.sale.amount_paid_usd, a.sale.change_usd, a.sale.change_khr, a.sale.change_is_actual], [6.48, 10, 3.52, 0, 1])
      })
    }
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9503, quantity: 1 }], { payment: { details: [], change_currency: 'KHR' } })
      r.check(`give back in riel: $3.52 at 4,000 is 14,080; the drawer hands out 14,000 (rounded DOWN to 100, never up) (${result.created?.status})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
      })
      const a = await rowsOf(result.created.body.id)
      r.check(`riel change: change_khr 14000, change_usd 0 -- ${JSON.stringify([a.sale.change_usd, a.sale.change_khr, a.sale.change_is_actual])}`, () => {
        assert.deepEqual([a.sale.change_usd, a.sale.change_khr, a.sale.change_is_actual], [0, 14000, 1])
      })
    }

    // ---- 4. more units than were returned ------------------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const before = await stockOf(9501)
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9501, quantity: 3 }], { payment: { details: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }], change_currency: 'USD' } })
      r.check(`extra units: 1 back / 3 out of the same product, the customer pays the extra $20 (${result.created?.status})`, () => assert.equal(result.created.status, 200, JSON.stringify(result.created?.body)))
      const a = await rowsOf(result.created.body.id)
      const after = await stockOf(9501)
      r.check(`extra units: S2 $30, paid credit $10 + cash $20; the shelf is down by the 2 extra units -- ${JSON.stringify([a.sale.total_usd, a.sale.amount_paid_usd, after.branch - before.branch])}`, () => {
        assert.deepEqual([a.sale.total_usd, a.sale.amount_paid_usd, after.branch - before.branch, after.lots - before.lots], [30, 30, -2, -2])
        assert.equal(a.allocated, 3)
      })
    }

    // ---- 4b. covered units at the sold price, the rest at the catalog price: two lines of one product -------------------------------------------------
    // The Serum sold at $8; its catalog price is $12 today. 1 comes back; 3 go out as 1 at the sold $8 (the straight swap) and 2 at the catalog $12
    // (a new purchase). A caller with only Returns may post the covered unit under the catalog price, never the extra ones.
    {
      const sale = await makeSale([{ productId: 9505, quantity: 1, price: 8 }])
      await h.db.prepare('UPDATE products SET selling_price_usd=12, selling_price_khr=48000 WHERE id=9505').run()
      const before = await stockOf(9505)
      const parts = [{ product_id: 9505, quantity: 1, applied_price_usd: 8 }, { product_id: 9505, quantity: 2 }]
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], parts, { cookie: returnsOnly, payment: { details: [{ method: 'Cash', amount_usd: 24, amount_khr: 0 }], change_currency: 'USD' } })
      r.check(`two parts: the straight swap at the sold $8, two more at the catalog $12 -- quote refund ${result.quoted?.refund_usd}, new sale ${result.quoted?.total_usd}, net ${result.quoted?.net_usd} (${result.created?.status})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.deepEqual([result.quoted.refund_usd, result.quoted.total_usd, result.quoted.credit_usd, result.quoted.net_usd], [8, 32, 8, 24])
      })
      const a = await rowsOf(result.created.body.id)
      const after = await stockOf(9505)
      r.check('two parts: two sale lines (1 x 8, 2 x 12), paid credit $8 + cash $24, shelf down by the 2 extra units', () => {
        assert.deepEqual(a.items.map(row => [row.quantity, row.applied_price_usd, row.total_usd]), [[1, 8, 8], [2, 12, 24]])
        assert.deepEqual(a.pay, [{ method: 'Cash', amount_usd: 8, amount_khr: 0 }, { method: 'Cash', amount_usd: 24, amount_khr: 0 }])
        assert.deepEqual([a.sale.total_usd, a.sale.amount_paid_usd, a.ret.total_refund_usd], [32, 32, 8])
        assert.deepEqual([after.branch - before.branch, after.product - before.product, after.lots - before.lots], [-2, -2, -2])
      })
      const second = await makeSale([{ productId: 9505, quantity: 1, price: 12 }]) // the first sale's line is spent: a fresh one, sold at today's $12
      const tooCheap = await exchange(second, [{ item: 0, quantity: 1 }], [{ product_id: 9505, quantity: 1, applied_price_usd: 12 }, { product_id: 9505, quantity: 2, applied_price_usd: 8 }], { cookie: returnsOnly })
      r.check(`two parts: the extra units cannot go out under the catalog price either (${tooCheap.quote?.status} ${tooCheap.quote?.body?.code})`, () => {
        assert.equal(tooCheap.quote.status, 403)
        assert.equal(tooCheap.quote.body.code, 'return_replacement_price_forbidden')
      })
    }

    // ---- 4c. one product on two lines at different prices -------------------------------------------------------------------------------------------
    // A Primer (catalog $10) was sold as 2 x $5 and 1 x $1 (a buy-more offer worked by hand). All 3 come back. The replacement of 3 Primers by a caller
    // with only Returns may go out no lower than 2 x 5 + 1 x 1 = $11 together: each unit is held to the line it was returned from. Pooled at the lowest
    // recorded price ($1) the same caller could take 3 Primers for $3.
    {
      const sold = await H.createSale(h, { key: 'ex1-two-prices', status: 'completed', lines: [{ productId: 9506, quantity: 2, manualPrice: 5 }, { productId: 9506, quantity: 1, manualPrice: 1 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 11, amount_khr: 0 }] })
      assert.equal(sold.status, 200, JSON.stringify(sold.body))
      const sale = { id: sold.body.id, items: await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sold.body.id) }
      const back = [{ item: 0, quantity: 2 }, { item: 1, quantity: 1 }]
      const cheap = await exchange(sale, back, [{ product_id: 9506, quantity: 3, applied_price_usd: 3 }], { cookie: returnsOnly })
      r.check(`two-price sale: 3 Primers for $9 (3 x $3) is under the $11 the returned lines were paid -- refused (${cheap.quote?.status} ${cheap.quote?.body?.code})`, () => {
        assert.equal(cheap.quote.status, 403)
        assert.equal(cheap.quote.body.code, 'return_replacement_price_forbidden')
      })
      const counted = await counts()
      const fair = await exchange(sale, back, [{ product_id: 9506, quantity: 2, applied_price_usd: 5 }, { product_id: 9506, quantity: 1, applied_price_usd: 1 }], { cookie: returnsOnly })
      const afterFair = await counts()
      r.check(`two-price sale: 2 x $5 + 1 x $1 (the same $11 the lines were paid) is allowed (${fair.created?.status}); refund ${fair.quoted?.refund_usd}, new sale ${fair.quoted?.total_usd}, net ${fair.quoted?.net_usd}`, () => {
        assert.equal(fair.created.status, 200, JSON.stringify(fair.created?.body))
        assert.deepEqual([fair.quoted.refund_usd, fair.quoted.total_usd, fair.quoted.net_usd], [11, 11, 0])
        assert.equal(afterFair.returns, counted.returns + 1)
      })
    }

    // ---- 5. a Not Paid original --------------------------------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }], 'awaiting_payment')
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1 }])
      r.check(`Not Paid original: the refund lowers the debt, the replacement is its own Not Paid sale, nothing is netted (${result.created?.status}; credit ${result.quoted?.credit_usd})`, () => {
        assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
        assert.deepEqual([result.quoted.not_paid, result.quoted.credit_usd, result.quoted.owed_reduction_usd], [true, 0, 10])
      })
      const a = await rowsOf(result.created.body.id)
      r.check(`Not Paid records: return owed_reduction 10 (no cash out), S2 $16 awaiting_payment with nothing tendered -- ${JSON.stringify([a.ret.owed_reduction_usd, a.sale.sale_status, a.sale.amount_paid_usd, a.pay])}`, () => {
        assert.equal(a.ret.owed_reduction_usd, 10)
        assert.deepEqual([a.sale.sale_status, a.sale.amount_paid_usd, a.sale.amount_paid_khr, a.sale.total_usd], ['awaiting_payment', 0, 0, 16])
        assert.deepEqual(a.pay, [])
      })
    }

    // ---- 6. the same request again -------------------------------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1 }], { key: 'ex1-replay', payment: { details: [{ method: 'ABA', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' } })
      assert.equal(result.created.status, 200, JSON.stringify(result.created?.body))
      const countsBefore = await counts()
      const stockBefore = await stockOf(9502)
      const replay = await h.call('POST', '/api/returns', result.body, 'exchange replay')
      const countsAfter = await counts()
      const stockAfter = await stockOf(9502)
      r.check(`replay: the recorded answer, no second return, sale, line, movement or deduction -- ${replay.status}`, () => {
        assert.equal(replay.status, 200)
        assert.deepEqual(replay.body, result.created.body)
        assert.deepEqual(countsAfter, countsBefore)
        assert.deepEqual(stockAfter, stockBefore)
      })
      const different = await h.call('POST', '/api/returns', { ...result.body, reason: 'a different reason' }, 'exchange replay, changed body')
      r.check(`replay with a changed body is an idempotency conflict (${different.status} ${different.body.code})`, () => {
        assert.equal(different.status, 409)
        assert.equal(different.body.code, 'idempotency_conflict')
      })
    }

    // ---- 7. refusals leave nothing behind --------------------------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9501, quantity: 1, price: 10 }])
      const countsBefore = await counts()
      const stockBefore = await stockOf(9502)
      const short = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1 }])
      r.check(`short payment: $6 is owed and nothing was tendered -> refused (${short.created?.status} ${short.created?.body?.code}) with no record`, () => {
        assert.equal(short.created.status, 409)
        assert.equal(short.created.body.code, 'return_exchange_payment_short')
      })
      const stale = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1 }], { payment: { details: [{ method: 'ABA', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' },
        tamper: quote => ({ ...quote, total_usd: quote.total_usd - 1 }) })
      r.check(`stale replacement quote: a figure the till did not review -> refused (${stale.created?.status} ${stale.created?.body?.code})`, () => {
        assert.equal(stale.created.status, 409)
        assert.equal(stale.created.body.code, 'customer_return_quote_stale')
      })
      const underFloor = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1, applied_price_usd: 1 }], { cookie: returnsOnly,
        payment: { details: [], change_currency: 'USD' } })
      r.check(`price floor: a returns-only caller may not sell under the catalog price (${underFloor.quote?.status} ${underFloor.quote?.body?.code})`, () => {
        assert.equal(underFloor.quote.status, 403)
        assert.equal(underFloor.quote.body.code, 'return_replacement_price_forbidden')
      })
      const tooMany = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 5000 }], { payment: { details: [{ method: 'Cash', amount_usd: 79990, amount_khr: 0 }], change_currency: 'USD' } })
      r.check(`more units than the shelf holds: refused with nothing written (${tooMany.created?.status})`, () => {
        assert.ok(tooMany.created.status >= 400, JSON.stringify(tooMany.created?.body))
      })
      const countsAfter = await counts()
      const stockAfter = await stockOf(9502)
      r.check(`counts unchanged after the four refusals -- ${JSON.stringify(countsAfter)}`, () => {
        assert.deepEqual(countsAfter, countsBefore)
        assert.deepEqual(stockAfter, stockBefore)
      })
      const priced = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9502, quantity: 1, applied_price_usd: 14 }], { cookie: withPrice, payment: { details: [{ method: 'ABA', amount_usd: 4, amount_khr: 0 }], change_currency: 'USD' } })
      r.check(`a caller with the POS price grant may sell at a price of their own ($14 for a $16 item; ${priced.created?.status})`, () => {
        assert.equal(priced.created.status, 200, JSON.stringify(priced.created?.body))
        assert.equal(priced.quoted.total_usd, 14)
      })
    }

    // ---- 6. the shift drawer, the reports and the ledgers agree --------------------------------------------------------------------------------
    // Each exchange is traced through the open shift's drawer (GET /api/shifts/current) and the report totals (GET /api/reports/overview) as the
    // change they make: what the customer really handed over or took away is what the drawer moves by, and a give-back exchange reports the
    // replacement at its total, not at the credit that paid for it.
    {
      await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 0 }, 'EX1 open shift')
      assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))
      const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const round4 = value => Math.round(value * 10000) / 10000
      const read = async () => {
        await new Promise(resolve => setTimeout(resolve, 1100)) // the open-shift window ends at the current second, exclusive
        const drawer = (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'EX1 drawer', { observe: true })).body.shift.reconciliation
        const overview = await h.call('GET', H.fresh(`/api/reports/overview?startDate=${today}&endDate=${today}`), undefined, 'EX1 overview', { observe: true })
        assert.equal(overview.status, 200, JSON.stringify(overview.body).slice(0, 200))
        return { drawer, totals: overview.body.sales.totals }
      }
      const change = (before, after) => ({
        expectedUsd: round4(Number(after.drawer.expected.usd) - Number(before.drawer.expected.usd)),
        expectedKhr: round4(Number(after.drawer.expected.khr) - Number(before.drawer.expected.khr)),
        cashSalesUsd: round4(Number(after.drawer.cash_sales.usd) - Number(before.drawer.cash_sales.usd)),
        refundsUsd: round4(Number(after.drawer.refunds.usd) - Number(before.drawer.refunds.usd)),
        revenue: round4(after.totals.revenue_usd - before.totals.revenue_usd),
        refunds: round4(after.totals.refund_usd - before.totals.refund_usd),
        collected: round4(after.totals.collected_total_usd - before.totals.collected_total_usd),
        notPaid: round4(after.totals.not_paid_owed_usd - before.totals.not_paid_owed_usd),
      })
      const trace = async (title, back, out, payment, { notPaidSale = false, outProduct = out } = {}) => {
        const sale = await makeSale([{ productId: back, quantity: 1, price: PRICES[back] }], notPaidSale ? 'awaiting_payment' : 'completed')
        const before = await read()
        const result = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: outProduct, quantity: 1 }], { payment })
        assert.equal(result.created?.status, 200, `${title}: ${JSON.stringify(result.created?.body)}`)
        const after = await read()
        return change(before, after)
      }
      const PRICES = { 9501: 10, 9502: 16, 9503: 6.48, 9504: 16.1 }
      const expectChange = (title, got, want) => r.check(`${title}: ${JSON.stringify(got)}`, () => assert.deepEqual(got, want))

      // The customer pays $6 in cash: the drawer gains $6 (the credit comes in as cash sale and goes out as refund), revenue and collected +6.
      expectChange('drawer + reports, pays $6 cash', await trace('pay cash', 9501, 9502, { details: [{ method: 'Cash', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' }),
        { expectedUsd: 6, expectedKhr: 0, cashSalesUsd: 16, refundsUsd: 10, revenue: 6, refunds: 10, collected: 6, notPaid: 0 })
      // Net zero: nothing moves.
      expectChange('drawer + reports, net zero', await trace('net zero', 9501, 9501, { details: [], change_currency: 'USD' }),
        { expectedUsd: 0, expectedKhr: 0, cashSalesUsd: 10, refundsUsd: 10, revenue: 0, refunds: 10, collected: 0, notPaid: 0 })
      // The customer gets $3.52 back in dollars: the drawer is down 3.52 and so is what was collected (an amount_paid reading would say 0).
      expectChange('drawer + reports, gives back $3.52 in dollars', await trace('give back usd', 9501, 9503, { details: [], change_currency: 'USD' }),
        { expectedUsd: -3.52, expectedKhr: 0, cashSalesUsd: 6.48, refundsUsd: 10, revenue: -3.52, refunds: 10, collected: -3.52, notPaid: 0 })
      // The customer gets it back in riel: 14,000 riel leaves the riel drawer, the dollar drawer nets to zero (10 in as credit, 10 out as refund).
      expectChange('drawer + reports, gives back in riel (14,080 rounds down to 14,000)', await trace('give back khr', 9501, 9503, { details: [], change_currency: 'KHR' }),
        { expectedUsd: 0, expectedKhr: -14000, cashSalesUsd: 10, refundsUsd: 10, revenue: -3.52, refunds: 10, collected: -3.52, notPaid: 0 })
      // Paying by card: no cash moves in the drawer, the sale is collected.
      expectChange('drawer + reports, pays $6 by ABA', await trace('pay aba', 9501, 9502, { details: [{ method: 'ABA', amount_usd: 6, amount_khr: 0 }], change_currency: 'USD' }),
        { expectedUsd: 0, expectedKhr: 0, cashSalesUsd: 10, refundsUsd: 10, revenue: 6, refunds: 10, collected: 6, notPaid: 0 })
      // Riel tender: 24,400 riel enter the riel drawer.
      expectChange('drawer + reports, pays $6.10 in riel', await trace('pay khr', 9501, 9504, { details: [{ method: 'Cash', amount_usd: 0, amount_khr: 24400 }], change_currency: 'USD' }),
        { expectedUsd: 0, expectedKhr: 24400, cashSalesUsd: 10, refundsUsd: 10, revenue: 6.1, refunds: 10, collected: 6.1, notPaid: 0 })
      // A Not Paid original: the return lowers the debt by $10 (no cash out); the replacement is its own $16 debt. No drawer movement.
      expectChange('drawer + reports, Not Paid original', await trace('not paid', 9501, 9502, { details: [], change_currency: 'USD' }, { notPaidSale: true }),
        { expectedUsd: 0, expectedKhr: 0, cashSalesUsd: 0, refundsUsd: 0, revenue: 6, refunds: 10, collected: 0, notPaid: 6 })
      // The sales export (CSV/Excel summary), the report overview and the dashboard totals read the same exchange rows to the same figures.
      const end = await read()
      const exported = await h.call('GET', H.fresh(`/api/sales/export?startDate=${today}&endDate=${today}`), undefined, 'EX1 export', { observe: true })
      r.check(`export summary agrees with the report overview -- ${JSON.stringify([exported.body.summary?.net_revenue_usd, exported.body.summary?.total_refunds_usd, exported.body.summary?.not_paid_owed_usd])}`, () => {
        assert.equal(exported.status, 200, JSON.stringify(exported.body).slice(0, 200))
        assert.deepEqual([exported.body.summary.net_revenue_usd, exported.body.summary.total_refunds_usd, exported.body.summary.not_paid_owed_usd],
          [end.totals.revenue_usd, end.totals.refund_usd, end.totals.not_paid_owed_usd])
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
    console.log(`\n${r.results.length} exchange checks passed`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
