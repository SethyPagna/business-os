'use strict'
// Security follow-up B (release review a77883c78, should-fix 7). The whole Worker on workerd + D1
// (harness/al_money_native.cjs), a real admin and real role accounts.
//
// POST /api/returns took a replacement line's applied_price_usd / applied_price_khr from the till as sent
// (routes/returns.ts: `input.applied_price_usd != null ? toNumber(...) : meta.selling_price_usd`), so a user with
// only Returns access could record a replacement sale at any price, $0 included.
//
// The rule mirrored is POST /api/sales (routes/sales.ts): the server prices a line from the catalog with the active
// promotions and the product's discount (evaluateCapturedPricingPool, source 'promotion'), and the only thing that
// lets a caller sell at another price is the grant that route itself asks for -- `pos` or `sales` (sales.ts:516; the
// till's per-sale price edit has no separate permission, roleDefaults.ts:42). So, for a caller WITHOUT pos / sales, a
// replacement line may not be priced below the lowest of: the catalog price, the promotion price, and the price the
// same product was sold at on the sale being returned (the straight swap). A price above that is not refused.
//   1. returns-only caller, price under the catalog with no promotion on the product -> 403 return_replacement_price_forbidden,
//      nothing written;
//   2. the same price once an active promotion makes it the promotion price           -> 200 (a legitimate promotion price);
//      one cent under the promotion price                                              -> 403;
//   3. the catalog price, no price at all, a price above the catalog                  -> 200;
//   4. a riel price under the catalog riel price                                       -> 403;
//   5. the straight swap at the original sale's price                                  -> 200; a cent under it -> 403;
//   6. a caller with sales, with pos, and the admin: any price, $0 included            -> 200 (what POST /api/sales allows them).
// Checks marked "base:" are red on a77883c78 (run with BASE_COMMIT=a77883c78 to bundle the modified Worker files as that
// commit had them).
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const h = await H.startWorker({ patches: process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : [] })
  const r = H.recorder('RET-REPL-PRICE')
  try {
    await H.seedProduct(h, 821, 'RP Source', 5, 60, 1)
    await H.seedProduct(h, 822, 'RP Promo', 10, 60, 1)
    await H.seedProduct(h, 823, 'RP Plain', 4, 60, 1)
    const returnsOnly = await h.addEmployee(1931, 'rp-returns-only', { returns: true })
    const withSales = await h.addEmployee(1932, 'rp-with-sales', { returns: true, sales: true })
    const withPos = await h.addEmployee(1933, 'rp-with-pos', { returns: true, pos: true })

    let seq = 0
    const counts = async () => ({
      returns: Number((await h.one('SELECT COUNT(*) AS n FROM returns')).n),
      sales: Number((await h.one('SELECT COUNT(*) AS n FROM sales')).n),
      stock822: Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=822 AND branch_id=1')).quantity),
    })
    // A return with no original sale (the refund is the posted price of 823) and one replacement line.
    const exchange = (options, replacement, label) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, reason: 'RP probe', return_type: 'restock',
      items: [{ product_id: 823, product_name: 'RP Plain', quantity: 1, applied_price_usd: 4, applied_price_khr: 16000, stock_action: 'restock', branch_id: 1 }],
      replacement_items: [{ product_id: 822, quantity: 1, branch_id: 1, ...replacement }] }, label, options)
    const forbidden = (result, productId = 822) => {
      assert.equal(result.status, 403, JSON.stringify(result.body))
      assert.equal(result.body.code, 'return_replacement_price_forbidden')
      assert.equal(result.body.product_id, productId)
    }
    const replacementTotal = async (result) => Number((await h.one('SELECT total_usd FROM sales WHERE id=?', result.body.replacementSaleId)).total_usd)

    // ---- 1. no promotion on the product: anything under the catalog is refused -------------------------------------------------
    const before = await counts()
    const free = await exchange({ cookie: returnsOnly }, { applied_price_usd: 0, applied_price_khr: 0 }, 'returns-only $0 replacement')
    const cheap = await exchange({ cookie: returnsOnly }, { applied_price_usd: 8, applied_price_khr: 32000 }, 'returns-only $8 replacement (no promotion yet)')
    const after = await counts()
    r.check(`base: a returns-only caller cannot record a $0 or $8 replacement of a $10 product -- ${free.status}/${cheap.status} ${JSON.stringify(free.body).slice(0, 120)}`, () => {
      forbidden(free)
      forbidden(cheap)
    })
    r.check(`the refusals wrote nothing: ${JSON.stringify(after)} == ${JSON.stringify(before)}`, () => assert.deepEqual(after, before))
    const refusalStatements = h.metrics.filter(entry => /returns-only \$(0|8) replacement/.test(entry.label)).map(entry => entry.statements)
    r.check(`a refusal costs ${refusalStatements.join('/')} D1 statements (Free limit ${H.FREE_QUERY_LIMIT})`, () => {
      assert.equal(refusalStatements.length, 2)
      assert.ok(refusalStatements.every(count => count <= H.FREE_QUERY_LIMIT))
    })

    // ---- 3. the ordinary prices are untouched ------------------------------------------------------------------------------------------
    const atCatalog = await exchange({ cookie: returnsOnly }, { applied_price_usd: 10, applied_price_khr: 40000 }, 'returns-only at the catalog price')
    const noPrice = await exchange({ cookie: returnsOnly }, {}, 'returns-only with no price')
    const above = await exchange({ cookie: returnsOnly }, { applied_price_usd: 12, applied_price_khr: 48000 }, 'returns-only above the catalog price')
    r.check(`control: the catalog price, no price and a price above the catalog are recorded -- ${atCatalog.status}/${noPrice.status}/${above.status}`, () => {
      for (const result of [atCatalog, noPrice, above]) assert.equal(result.status, 200, JSON.stringify(result.body))
    })
    const totals = [await replacementTotal(atCatalog), await replacementTotal(noPrice), await replacementTotal(above)]
    r.check(`control: those replacement sales carry $10, $10 (the catalog price) and $12 -- ${JSON.stringify(totals)}`, () => assert.deepEqual(totals, [10, 10, 12]))
    const noRiel = await exchange({ cookie: returnsOnly }, { applied_price_usd: 10 }, 'returns-only usd only')
    r.check(`control: a price with no riel price falls back to the catalog riel price (${noRiel.status})`, () => assert.equal(noRiel.status, 200, JSON.stringify(noRiel.body)))

    // ---- 4. the riel price is held to the same floor -----------------------------------------------------------------------------------
    const khrCheat = await exchange({ cookie: returnsOnly }, { applied_price_usd: 10, applied_price_khr: 1 }, 'returns-only riel price 1')
    r.check(`base: a catalog dollar price with a riel price of 1 is refused -- ${khrCheat.status}`, () => forbidden(khrCheat))

    // ---- 2. an active promotion makes its price legitimate -------------------------------------------------------------------------------
    await h.db.prepare(`INSERT INTO promotion_rules(title,show_title,rule_type,min_quantity,percent_off,scope_type,product_ids,is_active)
      VALUES('RP 20% off',1,'percent_off',0,20,'products','[822]',1)`).run()
    const nextSecond = () => new Promise(resolve => setTimeout(resolve, 1100))
    await nextSecond()
    const atPromo = await exchange({ cookie: returnsOnly }, { applied_price_usd: 8, applied_price_khr: 32000 }, 'returns-only at the promotion price')
    const underPromo = await exchange({ cookie: returnsOnly }, { applied_price_usd: 7.99, applied_price_khr: 31960 }, 'returns-only a cent under the promotion price')
    await nextSecond()
    const catalogWithRule = await exchange({ cookie: returnsOnly }, { applied_price_usd: 10, applied_price_khr: 40000 }, 'returns-only at the catalog price (promotion active)')
    await nextSecond()
    const betweenPromoAndCatalog = await exchange({ cookie: returnsOnly }, { applied_price_usd: 9, applied_price_khr: 36000 }, 'returns-only between promotion and catalog')
    r.check(`a legitimate promotion price keeps working: the 20% price $8 is recorded (${atPromo.status}), $9 too (${betweenPromoAndCatalog.status}), $7.99 is refused (${underPromo.status}); the catalog price with the rule active is untouched (${catalogWithRule.status})`, () => {
      assert.equal(catalogWithRule.status, 200, JSON.stringify(catalogWithRule.body))
      assert.equal(atPromo.status, 200, JSON.stringify(atPromo.body))
      assert.equal(betweenPromoAndCatalog.status, 200, JSON.stringify(betweenPromoAndCatalog.body))
      forbidden(underPromo)
    })
    const promoTotal = await replacementTotal(atPromo)
    r.check(`the promotion-priced replacement sale carries $8 -- ${promoTotal}`, () => assert.equal(promoTotal, 8))
    // The promotion evaluation is two reads (the product rows, the active rules) and runs only for a price under the
    // catalog. A receipt number minted in the same business second as an earlier one costs one probe read each for the
    // return and the sale, so each measured request above starts in a fresh second and the counts are comparable.
    const statementsOf = label => h.metrics.find(entry => entry.label === label).statements
    const evaluated = ['returns-only at the promotion price', 'returns-only between promotion and catalog'].map(statementsOf)
    r.check(`a request that evaluates the promotions stays inside the Free limit: ${evaluated.join('/')} statements (the same request at the catalog price: ${statementsOf('returns-only at the catalog price (promotion active)')}; limit ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(evaluated.every(count => count <= H.FREE_QUERY_LIMIT))
    })

    // ---- 5. the straight swap at the price the original sale charged -------------------------------------------------------------------------
    const sold = await H.importSale(h, 831, 'completed', [{ productId: 821, name: 'RP Source', quantity: 4, price: 3 }], { jobId: 'rp-job' })
    const swap = (price, label, options = { cookie: returnsOnly }) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, sale_id: sold.sale.id, reason: 'RP swap', return_type: 'restock',
      items: [{ sale_item_id: sold.items[0].id, product_id: 821, quantity: 1, applied_price_usd: 3, stock_action: 'restock', branch_id: 1 }],
      replacement_items: [{ product_id: 821, quantity: 1, branch_id: 1, applied_price_usd: price, applied_price_khr: price * 4000 }] }, label, options)
    const swapAtSold = await swap(3, 'returns-only swap at the sold price')
    const swapUnderSold = await swap(2.99, 'returns-only swap a cent under the sold price')
    r.check(`the straight swap at the original sale's $3 (catalog $5) is recorded (${swapAtSold.status}); $2.99 is refused (${swapUnderSold.status})`, () => {
      assert.equal(swapAtSold.status, 200, JSON.stringify(swapAtSold.body))
      forbidden(swapUnderSold, 821)
    })

    // ---- 6. whoever may set a price on a sale may set it here ----------------------------------------------------------------------------------
    const sales = await exchange({ cookie: withSales }, { applied_price_usd: 0, applied_price_khr: 0 }, 'sales grant $0 replacement')
    const pos = await exchange({ cookie: withPos }, { applied_price_usd: 0, applied_price_khr: 0 }, 'pos grant $0 replacement')
    const admin = await exchange({}, { applied_price_usd: 0, applied_price_khr: 0 }, 'admin $0 replacement')
    r.check(`control: a caller with sales, a caller with pos and the admin keep today's behaviour: any price, $0 included -- ${sales.status}/${pos.status}/${admin.status}`, () => {
      for (const result of [sales, pos, admin]) assert.equal(result.status, 200, JSON.stringify(result.body))
    })
    const zeroTotals = [await replacementTotal(sales), await replacementTotal(pos), await replacementTotal(admin)]
    r.check(`control: those replacement sales carry $0 -- ${JSON.stringify(zeroTotals)}`, () => assert.deepEqual(zeroTotals, [0, 0, 0]))
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} return replacement price: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
