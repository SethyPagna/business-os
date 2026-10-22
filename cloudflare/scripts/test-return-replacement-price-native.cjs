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
//   5b (6.0.949, P3-1). "the price on the original sale" is the RECORDED line of that sale, never a figure the caller posted: a return
//      line matched by product (no sale_item_id) may post a lower refund price, and that refund figure used to become the floor, so a
//      product-matched return posted at 0 plus a replacement at 0 passed. Held for the dollar and the riel leg, a named and a
//      product-matched line, mixed lines, and a manual return naming some other sale's line.
// 6.0.960 section 8 (release review c2f27dce6, P1-1): a product on SEVERAL returned lines at different recorded prices pairs each covered unit with its
//      own line, highest recorded price first -- 2 x $5 + 1 x $0 back (refund $10) cannot be swapped for three units at $0 -- for the dollar and the riel leg.
// Checks marked "base:" are red on the commit before them (run with BASE_COMMIT=<sha> to bundle the modified Worker files as that
// commit had them; the 5b checks are red on 169215b95, the rest on a77883c78, the section 8 ones on c2f27dce6).
// 6.0.952 section 7 (quantity: an exchange plus an optional extra purchase). MUTANT=<name> bundles the Worker with ONE deliberate defect in the
// floor logic; a mutant the checks do not turn red is a hole in them. node test-return-replacement-price-native.cjs lists the names below.
const FLOOR = 'src/lib/returnReplacementPrice.ts'
const MUTANTS = {
  'covered-all': { file: FLOOR, from: 'return total + sum + Math.max(0, need) * base', to: 'return total + sum + Math.max(0, need) * Math.min(base, covering[covering.length - 1]?.price ?? base)' },
  'covered-none': { file: FLOOR, from: "const price = leg === 'usd' ? line.usd : line.khr", to: 'const price = null' },
  'covered-unit-reused': { file: FLOOR, from: '      left -= swapped\n', to: '' },
  'sold-price-not-applied': { file: FLOOR, from: 'sum += swapped * Math.min(base, covering[at].price)', to: 'sum += swapped * base' },
  'per-line-not-per-product': { file: FLOOR, from: 'lines.forEach((line, index) => groups.set(line.productId, [...(groups.get(line.productId) ?? []), { line, index, promo: null }]))', to: 'lines.forEach((line, index) => groups.set(index, [{ line, index, promo: null }]))' },
  'riel-leg-dropped': { file: FLOOR, from: "const LEGS: readonly Leg[] = ['usd', 'khr']", to: "const LEGS: readonly Leg[] = ['usd']" },
  'dollar-leg-dropped': { file: FLOOR, from: "const LEGS: readonly Leg[] = ['usd', 'khr']", to: "const LEGS: readonly Leg[] = ['khr']" },
  'promotion-ignored': { file: FLOOR, from: 'usePromo ? promo?.[leg] ?? null : null', to: 'null' },
  'covered-to-lowest-base-first': { file: FLOOR, from: '.sort((a, b) => b.base - a.base)', to: '.sort((a, b) => a.base - b.base)' },
  // 6.0.960: the pairing order and the per-line minimum.
  'covered-to-lowest-recorded-first': { file: FLOOR, from: '[...returned].sort(highestRecordedFirst)', to: '[...returned].sort((a, b) => highestRecordedFirst(b, a))' },
  'sold-price-pooled-lowest': { file: FLOOR, from: 'sum += swapped * Math.min(base, covering[at].price)', to: 'sum += swapped * Math.min(base, ...covering.map((unit) => unit.price))' },
  'sold-price-pooled-highest': { file: FLOOR, from: 'sum += swapped * Math.min(base, covering[at].price)', to: 'sum += swapped * Math.min(base, ...[Math.max(...covering.map((unit) => unit.price))])' },
  'line-price-not-capped-by-base': { file: FLOOR, from: 'sum += swapped * Math.min(base, covering[at].price)', to: 'sum += swapped * covering[at].price' },
  'tolerance-zero': { file: FLOOR, from: 'const TOLERANCE_PER_UNIT = 0.00005', to: 'const TOLERANCE_PER_UNIT = 0' },
  'other-products-units-cover': { file: 'src/lib/returnsStock.ts',
    from: 'if (!match || Number(match.line.product_id) !== productId) continue',
    to: 'if (!match) continue' },
}
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

async function main() {
  const mutant = process.env.MUTANT ? { name: `mutant:${process.env.MUTANT}`, ...MUTANTS[process.env.MUTANT] } : null
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const h = await H.startWorker({ patches: mutant ? [mutant] : process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : [] })
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

    // ---- 5b. the price a replacement may rest on is the RECORDED sale line, never a figure the caller posted (6.0.949, P3-1) ------------------------
    // A return line with no sale_item_id is matched to the sale's line by product, and its posted price may only LOWER the refund (goodwill).
    // The floor used to take that refund figure as the sold price, so a caller posting the return line at 0 and the replacement at 0 passed.
    const floorSales = {
      plain: await H.importSale(h, 832, 'completed', [{ productId: 821, name: 'RP Source', quantity: 30, price: 3 }], { jobId: 'rp-job' }),
      mixed: await H.importSale(h, 833, 'completed', [{ productId: 821, name: 'RP Source', quantity: 5, price: 3 }, { productId: 823, name: 'RP Plain', quantity: 5, price: 1 }], { jobId: 'rp-job' }),
      twoPrices: await H.importSale(h, 834, 'completed', [{ productId: 821, name: 'RP Source', quantity: 2, price: 3 }, { productId: 821, name: 'RP Source', quantity: 2, price: 2 }], { jobId: 'rp-job' }),
      riel: await H.importSale(h, 835, 'completed', [{ productId: 821, name: 'RP Source', quantity: 5, price: 3 }], { jobId: 'rp-job' }),
    }
    // The import writes no riel price; give one sale line a recorded riel price below dollars x rate to prove the riel floor reads the row.
    await h.db.prepare('UPDATE sale_items SET applied_price_khr=11000 WHERE id=?').bind(floorSales.riel.items[0].id).run()
    const floorCounts = async () => ({
      returns: Number((await h.one('SELECT COUNT(*) AS n FROM returns')).n),
      sales: Number((await h.one('SELECT COUNT(*) AS n FROM sales')).n),
    })
    const onSale = (sale, items, replacement, label, options = { cookie: returnsOnly }) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, sale_id: sale.sale.id, reason: 'RP floor', return_type: 'restock',
      items: items.map(item => ({ quantity: 1, stock_action: 'restock', branch_id: 1, ...item })),
      replacement_items: [{ quantity: 1, branch_id: 1, ...replacement }] }, label, options)
    const productMatched = (productId, name, extra = {}) => ({ product_id: productId, product_name: name, ...extra })
    const refundOf = async result => Number((await h.one('SELECT total_refund_usd FROM returns WHERE id=?', result.body.id)).total_refund_usd)
    const floorBefore = await floorCounts()

    // The exploit: the return line posted at 0 (product-matched) and the replacement at 0 -- and at a dollar, still under the $3 the line charged.
    const zeroPm = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: product-matched return posted 0, replacement $0')
    const onePm = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 1, applied_price_khr: 4000 }, 'floor: product-matched return posted 0, replacement $1')
    const cheapPm = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0.01, applied_price_khr: 40 })],
      { product_id: 821, applied_price_usd: 2.99, applied_price_khr: 11960 }, 'floor: product-matched return posted a cent, replacement $2.99')
    r.check(`base: a product-matched return line posted at 0 does not floor the replacement at 0 -- ${zeroPm.status}/${onePm.status}/${cheapPm.status}`, () => {
      forbidden(zeroPm, 821)
      forbidden(onePm, 821)
      forbidden(cheapPm, 821)
    })
    const floorAfter = await floorCounts()
    r.check(`the refusals wrote nothing: ${JSON.stringify(floorAfter)} == ${JSON.stringify(floorBefore)}`, () => assert.deepEqual(floorAfter, floorBefore))

    // The sale_item_id path never read the posted price (the recorded line is the refund): still refused, still the same floor.
    const zeroSi = await onSale(floorSales.plain, [{ sale_item_id: floorSales.plain.items[0].id, product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }],
      { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: sale_item_id return posted 0, replacement $0')
    r.check(`control: a return line naming its sale_item_id and posting 0 still cannot floor the replacement at 0 -- ${zeroSi.status}`, () => forbidden(zeroSi, 821))
    const mixedLinesZero = await onSale(floorSales.plain, [
      { sale_item_id: floorSales.plain.items[0].id, product_id: 821, applied_price_usd: 0, applied_price_khr: 0 },
      productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 }),
    ], { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: a sale_item_id line and a product-matched line, replacement $0')
    r.check(`base: two return lines of the product (one named, one product-matched, both posted 0) still floor the replacement at the sold price -- ${mixedLinesZero.status}`, () => forbidden(mixedLinesZero, 821))

    // The straight swap and the ordinary legitimate replacements are untouched.
    const goodwillSwap = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 12000 }, 'floor: goodwill (0) refund, replacement at the sold price')
    r.check(`a product-matched return posted at 0 (a goodwill refund) swapped for the same product at the sold $3 is recorded (${goodwillSwap.status})`, () => assert.equal(goodwillSwap.status, 200, JSON.stringify(goodwillSwap.body)))
    const goodwillTotals = goodwillSwap.status === 200 ? [await refundOf(goodwillSwap), await replacementTotal(goodwillSwap)] : null
    r.check(`the goodwill refund stays 0 and the replacement sale carries $3 -- ${JSON.stringify(goodwillTotals)}`, () => assert.deepEqual(goodwillTotals, [0, 3]))
    const omitted = await onSale(floorSales.plain, [productMatched(821, 'RP Source')],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 12000 }, 'floor: product-matched return with no posted price, replacement at the sold price')
    const higher = await onSale(floorSales.plain, [productMatched(821, 'RP Source')],
      { product_id: 821, applied_price_usd: 4, applied_price_khr: 16000 }, 'floor: replacement between the sold price and the catalog price')
    const atCatalogPm = await onSale(floorSales.plain, [productMatched(821, 'RP Source')],
      { product_id: 821, applied_price_usd: 5, applied_price_khr: 20000 }, 'floor: replacement at the catalog price')
    const aboveCatalogPm = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 99, applied_price_khr: 396000 })],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 12000 }, 'floor: product-matched return posted above the sold price')
    r.check(`control: a product-matched return with no posted price, a replacement between the sold and the catalog price, one at the catalog price and a high posted refund price are all recorded -- ${[omitted, higher, atCatalogPm, aboveCatalogPm].map(result => result.status)}`, () => {
      for (const result of [omitted, higher, atCatalogPm, aboveCatalogPm]) assert.equal(result.status, 200, JSON.stringify(result.body))
    })
    const aboveRefund = aboveCatalogPm.status === 200 ? await refundOf(aboveCatalogPm) : null
    r.check(`control: the refund of a high posted price is still capped at the recorded $3 -- ${aboveRefund}`, () => assert.equal(aboveRefund, 3))

    // The riel leg is held to the same recorded price. The import left no riel price on the line, so it is the dollars at the sale's rate (4000).
    const riel1Si = await onSale(floorSales.plain, [{ sale_item_id: floorSales.plain.items[0].id, product_id: 821 }],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 1 }, 'floor: sale_item_id return, replacement $3 and 1 riel')
    const riel1Pm = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 1 }, 'floor: product-matched return posted 0, replacement $3 and 1 riel')
    const rielExact = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: 11999 }, 'floor: replacement $3 and 11999 riel')
    r.check(`base: the riel price of a replacement cannot go under the sold price either: 1 riel / 11999 riel under a $3 line (no riel price recorded) -- ${riel1Si.status}/${riel1Pm.status}/${rielExact.status}`, () => {
      forbidden(riel1Si, 821)
      forbidden(riel1Pm, 821)
      forbidden(rielExact, 821)
    })
    const recordedRiel = (price) => onSale(floorSales.riel, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 3, applied_price_khr: price }, `floor: recorded riel price 11000, replacement riel ${price}`)
    const recordedRielUnder = await recordedRiel(10999)
    const recordedRielAt = await recordedRiel(11000)
    r.check(`base: a recorded riel price (11000, under $3 x 4000) is the riel floor, whatever the return line posted -- 10999: ${recordedRielUnder.status}, 11000: ${recordedRielAt.status}`, () => {
      forbidden(recordedRielUnder, 821)
      assert.equal(recordedRielAt.status, 200, JSON.stringify(recordedRielAt.body))
    })

    // Lines of other products and sales do not move the floor.
    const otherProduct = await onSale(floorSales.mixed, [productMatched(823, 'RP Plain', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 1, applied_price_khr: 4000 }, 'floor: return of 823 (sold $1), replacement of 821 at $1')
    r.check(`a replacement of a product is not floored at the price ANOTHER product was returned at ($1 line of 823, 821 at $1) -- ${otherProduct.status}`, () => forbidden(otherProduct, 821))
    const bothZero = await onSale(floorSales.mixed, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 }), productMatched(823, 'RP Plain', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 823, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: partial mixed return posted 0, replacement of 823 at $0')
    const bothAtSold = await onSale(floorSales.mixed, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 }), productMatched(823, 'RP Plain', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 823, applied_price_usd: 1, applied_price_khr: 4000 }, 'floor: partial mixed return posted 0, replacement of 823 at its sold $1')
    r.check(`base: a mixed return posted at 0 floors each replaced product at its own sold price: 823 at $0 refused (${bothZero.status}), at its sold $1 recorded (${bothAtSold.status})`, () => {
      forbidden(bothZero, 823)
      assert.equal(bothAtSold.status, 200, JSON.stringify(bothAtSold.body))
    })
    const beforeAmbiguous = await floorCounts()
    const ambiguous = await onSale(floorSales.twoPrices, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: product sold on two lines at different prices, no pick')
    const afterAmbiguous = await floorCounts()
    r.check(`control: a product sold at two prices on the sale and not picked is refused before the floor (400 return_refund_price_ambiguous), nothing written -- ${ambiguous.status}`, () => {
      assert.equal(ambiguous.status, 400, JSON.stringify(ambiguous.body))
      assert.equal(ambiguous.body.code, 'return_refund_price_ambiguous')
      assert.deepEqual(afterAmbiguous, beforeAmbiguous)
    })
    const cheaperLine = floorSales.twoPrices.items[1]
    const pickedAt = await onSale(floorSales.twoPrices, [{ sale_item_id: cheaperLine.id, product_id: 821 }], { product_id: 821, applied_price_usd: 2, applied_price_khr: 8000 }, 'floor: picked the $2 line, replacement $2')
    const pickedUnder = await onSale(floorSales.twoPrices, [{ sale_item_id: cheaperLine.id, product_id: 821 }], { product_id: 821, applied_price_usd: 1.99, applied_price_khr: 7960 }, 'floor: picked the $2 line, replacement $1.99')
    r.check(`a pick of the $2 line floors the replacement at $2: recorded at $2 (${pickedAt.status}), refused at $1.99 (${pickedUnder.status})`, () => {
      assert.equal(pickedAt.status, 200, JSON.stringify(pickedAt.body))
      forbidden(pickedUnder, 821)
    })

    // A manual return (no sale) has no "sale being returned": a sale_item_id that names a line of some OTHER sale is not an authority for the price.
    const foreignLine = await h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, reason: 'RP foreign sale line', return_type: 'restock',
      items: [{ sale_item_id: floorSales.plain.items[0].id, product_id: 822, product_name: 'RP Promo', quantity: 1, applied_price_usd: 10, applied_price_khr: 40000, stock_action: 'restock', branch_id: 1 }],
      replacement_items: [{ product_id: 822, quantity: 1, branch_id: 1, applied_price_usd: 3, applied_price_khr: 12000 }] }, 'floor: manual return naming a foreign sale line (sold $3), replacement of a $10 product at $3', { cookie: returnsOnly })
    r.check(`base: a manual return that names another sale's $3 line does not floor a $10 product's replacement at $3 -- ${foreignLine.status}`, () => forbidden(foreignLine, 822))

    // Whoever may set a price on a sale may still post the product-matched zero.
    const salesGrantZero = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: sales grant, product-matched zero', { cookie: withSales })
    const adminZero = await onSale(floorSales.plain, [productMatched(821, 'RP Source', { applied_price_usd: 0, applied_price_khr: 0 })],
      { product_id: 821, applied_price_usd: 0, applied_price_khr: 0 }, 'floor: admin, product-matched zero', {})
    r.check(`control: a caller with sales and the admin keep any price on a product-matched line -- ${salesGrantZero.status}/${adminZero.status}`, () => {
      for (const result of [salesGrantZero, adminZero]) assert.equal(result.status, 200, JSON.stringify(result.body))
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

    // ---- 7. quantity: a replacement is an exchange plus an optional extra purchase, with no cap (6.0.952, owner 22 Oct 2026) -------------------------
    // "replacement actually isn't replacing but changing or adding both ... they can replace and also add items." So the customer may take more
    // units than they returned, of the same product or another; nothing caps the quantity. What the units are SOLD at is the only thing held,
    // for a caller without the POS price grant: the units a returned unit of the same product covers may go down to the price the original sale
    // recorded, every other unit (a further unit of that product, or any unit of another product) is a new purchase at the catalog / promotion price.
    // The floor is per product across its lines, so the order of the lines and splitting one line in two do not move it. Riel follows the same rule.
    await H.seedProduct(h, 9241, 'RP Exchange', 5, 600, 1)
    await H.seedProduct(h, 9251, 'RP Other', 4, 600, 1)
    await H.seedProduct(h, 9261, 'RP Elsewhere', 6, 600, 1)
    // Section 8's products are seeded here, before any exchange: the harness gives a lot the id product + 5000, which later auto-numbered lots would otherwise take.
    await H.seedProduct(h, 9271, 'RP TwoPrice', 5, 900, 1)
    await H.seedProduct(h, 9281, 'RP Pricey', 4, 600, 1)
    const exchSale = await H.importSale(h, 836, 'completed', [{ productId: 9241, name: 'RP Exchange', quantity: 60, price: 3 }, { productId: 9251, name: 'RP Other', quantity: 5, price: 1 }], { jobId: 'rp-job' })
    const exchLine = exchSale.items[0]
    const other = exchSale.items[1]
    // `returned` units of 9241 come back (sold $3 / 12000 riel; catalog $5 / 20000 riel); `replacements` go out in one request.
    const exchangeOf = (returned, replacements, label, options = { cookie: returnsOnly }, extraReturns = []) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, sale_id: exchSale.sale.id, reason: 'RP exchange', return_type: 'restock',
      items: [{ sale_item_id: exchLine.id, product_id: 9241, quantity: returned, stock_action: 'restock', branch_id: 1 }, ...extraReturns],
      replacement_items: replacements.map(line => ({ branch_id: 1, ...line })) }, label, options)
    const out = (productId, quantity, usd, khr = Math.round(usd * 4000)) => ({ product_id: productId, quantity, applied_price_usd: usd, applied_price_khr: khr })
    const exchBefore = await floorCounts()
    const stock824 = async () => Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=9241 AND branch_id=1')).quantity)
    const stockBefore = await stock824()

    // The headline: 1 unit back at the sold $3 (catalog $5), 10 out. They are not all swapped units.
    const tenAtSold = await exchangeOf(1, [out(9241, 10, 3)], 'exchange: 1 returned, 10 replaced, all at the sold price')
    const tenOverTwoLines = await exchangeOf(1, [out(9241, 2, 3), out(9241, 8, 3)], 'exchange: 1 returned, 10 replaced over two lines, all at the sold price')
    r.check(`base: one unit back does not let ten go at its sold $3: refused (${tenAtSold.status}); nor over two lines (${tenOverTwoLines.status})`, () => {
      forbidden(tenAtSold, 9241)
      forbidden(tenOverTwoLines, 9241)
    })
    const exchAfterRefusals = await floorCounts()
    const stockAfterRefusals = await stock824()
    r.check(`the refusals wrote nothing: ${JSON.stringify(exchAfterRefusals)} == ${JSON.stringify(exchBefore)}; stock ${stockAfterRefusals} == ${stockBefore}`, () => {
      assert.deepEqual(exchAfterRefusals, exchBefore)
      assert.equal(stockAfterRefusals, stockBefore)
    })

    // The same extras at the catalog price: no cap, so ten, forty or a hundred units are all fine.
    const tenAtCatalog = await exchangeOf(1, [out(9241, 10, 5)], 'exchange: 1 returned, 10 replaced at the catalog price')
    const aboveCatalog = await exchangeOf(1, [out(9241, 10, 6)], 'exchange: 1 returned, 10 replaced above the catalog price')
    const hundredAtCatalog = await exchangeOf(1, [out(9241, 100, 5)], 'exchange: 1 returned, 100 replaced at the catalog price')
    r.check(`control: the same extras at the catalog price (or above) are recorded, whatever the quantity -- ${tenAtCatalog.status}/${aboveCatalog.status}/${hundredAtCatalog.status}`, () => {
      for (const result of [tenAtCatalog, aboveCatalog, hundredAtCatalog]) assert.equal(result.status, 200, JSON.stringify(result.body))
    })

    // One line is blended: 1 unit at $3 and 9 at $5 is $48 whichever way the till writes it.
    const blended = await exchangeOf(1, [out(9241, 10, 4.8, 19200)], 'exchange: 1 returned, 10 replaced in one line at the blended price')
    const blendedUnder = await exchangeOf(1, [out(9241, 10, 4.79, 19160)], 'exchange: 1 returned, 10 replaced in one line a cent under the blend')
    r.check(`a single line is held to the blend of the covered unit at $3 and nine at $5: 4.80 each is recorded (${blended.status}), 4.79 is refused (${blendedUnder.status})`, () => {
      assert.equal(blended.status, 200, JSON.stringify(blended.body))
      forbidden(blendedUnder, 9241)
    })
    // Money is kept to four places: the blend of 1 at $3 and 2 at $5 is $13 / 3 = 4.33333..., and 4.3333 each (a hair under, $12.9999) is that blend.
    const fourPlaces = await exchangeOf(1, [out(9241, 3, 4.3333, 20000)], 'exchange: 1 returned, 3 replaced at the blend rounded to four places')
    const fourPlacesUnder = await exchangeOf(1, [out(9241, 3, 4.3332, 20000)], 'exchange: 1 returned, 3 replaced one place under the rounded blend')
    r.check(`a blended unit price rounded to four places is the blend: 4.3333 x3 is recorded (${fourPlaces.status}), 4.3332 is refused (${fourPlacesUnder.status})`, () => {
      assert.equal(fourPlaces.status, 200, JSON.stringify(fourPlaces.body))
      forbidden(fourPlacesUnder, 9241)
    })
    const blendedTotal = blended.status === 200 ? await replacementTotal(blended) : null
    r.check(`the blended replacement sale carries $48 -- ${blendedTotal}`, () => assert.equal(blendedTotal, 48))

    // Split lines: the covered unit and the extras, in either order; the covered unit cannot be used twice.
    const splitInOrder = await exchangeOf(1, [out(9241, 1, 3), out(9241, 9, 5)], 'exchange: 1 returned; lines 1 at the sold price then 9 at catalog')
    const splitReversed = await exchangeOf(1, [out(9241, 9, 5), out(9241, 1, 3)], 'exchange: 1 returned; lines 9 at catalog then 1 at the sold price')
    const splitHalf = await exchangeOf(1, [out(9241, 5, 3), out(9241, 5, 5)], 'exchange: 1 returned; 5 at the sold price and 5 at catalog')
    const coveredTwice = await exchangeOf(1, [out(9241, 1, 3), out(9241, 1, 3)], 'exchange: 1 returned; two lines of 1 at the sold price')
    const extrasUnder = await exchangeOf(1, [out(9241, 1, 3), out(9241, 9, 4.99, 19960)], 'exchange: 1 returned; 1 at the sold price, 9 a cent under catalog')
    r.check(`split lines: 1 at $3 + 9 at $5 is recorded in either order (${splitInOrder.status}/${splitReversed.status}); 5 at $3 + 5 at $5 (${splitHalf.status}), the covered unit used on two lines (${coveredTwice.status}) and extras a cent under catalog (${extrasUnder.status}) are refused`, () => {
      assert.equal(splitInOrder.status, 200, JSON.stringify(splitInOrder.body))
      assert.equal(splitReversed.status, 200, JSON.stringify(splitReversed.body))
      for (const result of [splitHalf, coveredTwice, extrasUnder]) forbidden(result, 9241)
    })

    // Riel twins of the above: the riel leg is held to the same per-unit-count floor.
    const rielAtSold = await exchangeOf(1, [out(9241, 10, 5, 12000)], 'exchange: 1 returned, 10 replaced at catalog dollars but the sold riel price')
    const rielUnderBlend = await exchangeOf(1, [out(9241, 10, 4.8, 19199)], 'exchange: 1 returned, 10 replaced, blended dollars and a riel under the blend')
    const rielSplit = await exchangeOf(1, [out(9241, 1, 3, 12000), out(9241, 9, 5, 20000)], 'exchange: 1 returned; riel 12000 for one and 20000 for nine')
    const rielSplitUnder = await exchangeOf(1, [out(9241, 1, 3, 12000), out(9241, 9, 5, 19999)], 'exchange: 1 returned; riel 12000 for one and 19999 for nine')
    r.check(`riel twins: the sold riel price on all ten (${rielAtSold.status}) and a riel under the blend (${rielUnderBlend.status}) are refused; 12000 + 20000 is recorded (${rielSplit.status}), 12000 + 19999 refused (${rielSplitUnder.status})`, () => {
      forbidden(rielAtSold, 9241)
      forbidden(rielUnderBlend, 9241)
      assert.equal(rielSplit.status, 200, JSON.stringify(rielSplit.body))
      forbidden(rielSplitUnder, 9241)
    })

    // ... and the dollar twins: the riel price is right (the catalog riel, or a blend) and the dollars are not.
    const dollarsAtSold = await exchangeOf(1, [out(9241, 10, 3, 20000)], 'exchange: 1 returned, 10 replaced at the sold dollars but the catalog riel price')
    const dollarsUnderBlend = await exchangeOf(1, [out(9241, 10, 4.79, 19200)], 'exchange: 1 returned, 10 replaced, a dollar price under the blend and the blended riel price')
    const dollarSplitUnder = await exchangeOf(1, [out(9241, 1, 3, 12000), out(9241, 9, 4.99, 20000)], 'exchange: 1 returned; dollars 3 and 4.99, riel 12000 and 20000')
    r.check(`dollar twins: the sold dollars on all ten (${dollarsAtSold.status}), dollars under the blend (${dollarsUnderBlend.status}) and 4.99 on the extras (${dollarSplitUnder.status}) are refused whatever the riel price`, () => {
      for (const result of [dollarsAtSold, dollarsUnderBlend, dollarSplitUnder]) forbidden(result, 9241)
    })

    // Fewer replaced than returned, and the units a different product's return does not cover.
    const threeBackTwoOut = await exchangeOf(3, [out(9241, 2, 3)], 'exchange: 3 returned, 2 replaced at the sold price')
    const threeBackThreeOut = await exchangeOf(3, [out(9241, 3, 3)], 'exchange: 3 returned, 3 replaced at the sold price')
    const threeBackFourOut = await exchangeOf(3, [out(9241, 4, 3)], 'exchange: 3 returned, 4 replaced at the sold price')
    r.check(`the covered units are the returned ones: 3 back / 2 out (${threeBackTwoOut.status}) and 3 / 3 (${threeBackThreeOut.status}) at $3 are recorded, 3 / 4 is refused (${threeBackFourOut.status})`, () => {
      assert.equal(threeBackTwoOut.status, 200, JSON.stringify(threeBackTwoOut.body))
      assert.equal(threeBackThreeOut.status, 200, JSON.stringify(threeBackThreeOut.body))
      forbidden(threeBackFourOut, 9241)
    })
    const otherReturned = await exchangeOf(1, [out(9241, 2, 3)], 'exchange: 9241 x1 and 9251 x1 returned, 9241 x2 replaced at the sold price',
      { cookie: returnsOnly }, [{ sale_item_id: other.id, product_id: 9251, quantity: 1, stock_action: 'restock', branch_id: 1 }])
    r.check(`units returned of ANOTHER product do not cover this product's units: 9241 x1 + 9251 x1 back, 9241 x2 out at $3 -- ${otherReturned.status}`, () => forbidden(otherReturned, 9241))

    // A different product is a new purchase: no sold price of its own, whatever was returned.
    const otherAtItsSold = await exchangeOf(1, [out(9251, 1, 1)], 'exchange: 9241 returned, 9251 replaced at the $1 it was sold at on the same sale')
    const elsewhereAtSold = await exchangeOf(1, [out(9261, 1, 3)], 'exchange: 9241 returned, 9261 replaced at 9241\'s sold $3')
    const otherAtCatalog = await exchangeOf(1, [out(9251, 10, 4)], 'exchange: 9241 returned, 9251 x10 replaced at its catalog price')
    r.check(`a different product floors at its own catalog price: 9251 at the $1 it sold at on this sale (${otherAtItsSold.status}) and 9261 at 9241's $3 (${elsewhereAtSold.status}) are refused; 9251 x10 at catalog is recorded (${otherAtCatalog.status})`, () => {
      forbidden(otherAtItsSold, 9251)
      forbidden(elsewhereAtSold, 9261)
      assert.equal(otherAtCatalog.status, 200, JSON.stringify(otherAtCatalog.body))
    })
    const mixedOk = await exchangeOf(1, [out(9241, 1, 3), out(9251, 10, 4)], 'exchange: 9241 x1 at sold + 9251 x10 at catalog')
    const mixedUnder = await exchangeOf(1, [out(9241, 1, 3), out(9251, 10, 1)], 'exchange: 9241 x1 at sold + 9251 x10 at $1')
    r.check(`the swap and the extra product in one request: 9241 x1 at $3 + 9251 x10 at $4 is recorded (${mixedOk.status}); 9251 at $1 is refused and named (${mixedUnder.status})`, () => {
      assert.equal(mixedOk.status, 200, JSON.stringify(mixedOk.body))
      forbidden(mixedUnder, 9251)
    })

    // Whoever may set a price on a sale keeps any price, whatever the quantity.
    const grantedTen = [
      await exchangeOf(1, [out(9241, 10, 0.01, 40)], 'exchange: sales grant, 1 returned, 10 replaced at a cent', { cookie: withSales }),
      await exchangeOf(1, [out(9241, 10, 0.01, 40)], 'exchange: pos grant, 1 returned, 10 replaced at a cent', { cookie: withPos }),
      await exchangeOf(1, [out(9241, 10, 0.01, 40)], 'exchange: admin, 1 returned, 10 replaced at a cent', {}),
    ]
    r.check(`control: a caller with sales, a caller with pos and the admin keep any price on ten units -- ${grantedTen.map(result => result.status)}`, () => {
      for (const result of grantedTen) assert.equal(result.status, 200, JSON.stringify(result.body))
    })

    // An active promotion lowers the base of the extra units, and only theirs: 1 at $3 + 9 at the 20%-off $4 is $39.
    await h.db.prepare(`INSERT INTO promotion_rules(title,show_title,rule_type,min_quantity,percent_off,scope_type,product_ids,is_active)
      VALUES('RP 9241 20% off',1,'percent_off',0,20,'products','[9241]',1)`).run()
    await nextSecond()
    const promoBlend = await exchangeOf(1, [out(9241, 10, 3.9, 15600)], 'exchange: promotion, 1 returned, 10 replaced at the blend of $3 and the promotion $4')
    const promoUnder = await exchangeOf(1, [out(9241, 10, 3.89, 15560)], 'exchange: promotion, 1 returned, 10 replaced a cent under that blend')
    const promoAtSoldOnly = await exchangeOf(1, [out(9241, 10, 3, 12000)], 'exchange: promotion, 1 returned, 10 replaced at the sold price')
    r.check(`with a 20% promotion the extras floor at $4: 10 at 3.90 is recorded (${promoBlend.status}), 3.89 (${promoUnder.status}) and 10 at the sold $3 (${promoAtSoldOnly.status}) are refused`, () => {
      assert.equal(promoBlend.status, 200, JSON.stringify(promoBlend.body))
      forbidden(promoUnder, 9241)
      forbidden(promoAtSoldOnly, 9241)
    })

    // A promotion is evaluated per LINE (buy 5 or more takes 20% off): two lines of one product can have different promotion prices, and the swapped
    // unit belongs to whichever line helps the customer -- here the 1-unit line (no promotion, base $6), leaving the nine at the promotion $4.80.
    const tierSale = await H.importSale(h, 837, 'completed', [{ productId: 9261, name: 'RP Elsewhere', quantity: 30, price: 4 }], { jobId: 'rp-job' })
    await h.db.prepare(`INSERT INTO promotion_rules(title,show_title,rule_type,min_quantity,percent_off,scope_type,product_ids,is_active)
      VALUES('RP buy 5 20% off',1,'quantity_percent',5,20,'products','[9261]',1)`).run()
    await nextSecond()
    const tiered = (replacements, label) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, sale_id: tierSale.sale.id, reason: 'RP tiers', return_type: 'restock',
      items: [{ sale_item_id: tierSale.items[0].id, product_id: 9261, quantity: 1, stock_action: 'restock', branch_id: 1 }],
      replacement_items: replacements.map(line => ({ branch_id: 1, ...line })) }, label, { cookie: returnsOnly })
    const tierOk = await tiered([out(9261, 1, 4, 16000), out(9261, 9, 4.8, 19200)], 'tiers: 1 at the sold $4, 9 at the buy-5 promotion $4.80')
    const tierOkReversed = await tiered([out(9261, 9, 4.8, 19200), out(9261, 1, 4, 16000)], 'tiers: 9 at the buy-5 promotion, then 1 at the sold $4')
    const tierUnder = await tiered([out(9261, 1, 4, 16000), out(9261, 9, 4.79, 19160)], 'tiers: 1 at the sold $4, 9 a cent under the promotion price')
    const tierAllSold = await tiered([out(9261, 10, 4, 16000)], 'tiers: all ten at the sold $4')
    r.check(`per-line promotions: 1 at $4 + 9 at the promotion $4.80 is recorded in either order (${tierOk.status}/${tierOkReversed.status}); 4.79 (${tierUnder.status}) and ten at $4 (${tierAllSold.status}) are refused`, () => {
      assert.equal(tierOk.status, 200, JSON.stringify(tierOk.body))
      assert.equal(tierOkReversed.status, 200, JSON.stringify(tierOkReversed.body))
      forbidden(tierUnder, 9261)
      forbidden(tierAllSold, 9261)
    })

    // ---- 8. one product on SEVERAL returned lines at DIFFERENT recorded prices (6.0.960, release review c2f27dce6, P1-1) ---------------------------------
    // A legacy sale can carry a product on two lines at different prices (a buy-2-get-1 line at $0 beside two at $5). Each returned unit was paid at ITS
    // line's price, so the covered units pair with their own recorded lines, highest recorded price first -- the floor is the sum over the returned lines
    // of min(units left, units returned from the line) x min(base, the line's price), and every unit past the returned ones is floored at the base price.
    // The 6.0.952 rule pooled every returned line at the LOWEST price, so a returns-only caller could swap 2 x $5 + 1 x $0 (refund $10) for three units
    // priced $0. The sales import writes these lines with no riel price: the riel floor is each line's dollars x the sale rate. (The lines hold 40
    // units each so the return-quantity cap never matters: only the returned units named in each request do.)
    const b2g1Sale = await H.importSale(h, 838, 'completed', [{ productId: 9271, name: 'RP TwoPrice', quantity: 40, price: 5 }, { productId: 9271, name: 'RP TwoPrice', quantity: 40, price: 0 }], { jobId: 'rp-job' })
    const halfSale = await H.importSale(h, 839, 'completed', [{ productId: 9271, name: 'RP TwoPrice', quantity: 40, price: 5 }, { productId: 9271, name: 'RP TwoPrice', quantity: 40, price: 4.5 }], { jobId: 'rp-job' })
    const priceySale = await H.importSale(h, 840, 'completed', [{ productId: 9281, name: 'RP Pricey', quantity: 30, price: 6 }], { jobId: 'rp-job' })
    // `lines` = [[index of the sale line, units returned from it], ...]; `replacements` go out in the same request.
    const swapLines = (sale, productId, lines, replacements, label, options = { cookie: returnsOnly }) => h.call('POST', '/api/returns', {
      client_request_id: `rp-${++seq}`, sale_id: sale.sale.id, reason: 'RP two prices', return_type: 'restock',
      items: lines.map(([index, quantity]) => ({ sale_item_id: sale.items[index].id, product_id: productId, quantity, stock_action: 'restock', branch_id: 1 })),
      replacement_items: replacements.map(line => ({ branch_id: 1, ...line })) }, label, options)
    const twoBefore = await floorCounts()

    // The review's PROBE-1 through the real route: 2 x $5 + 1 x $0 back (refund $10), three units out for nothing.
    const allFree = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 0, 0)], 'two prices: 2 x $5 + 1 x $0 back, 3 out at $0')
    const allFreeSplit = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 1, 0, 0), out(9271, 2, 0, 0)], 'two prices: 2 x $5 + 1 x $0 back, 1 + 2 out at $0')
    const justUnder = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 3.33)], 'two prices: 2 x $5 + 1 x $0 back, 3 out at $9.99 in all')
    r.check(`base: 2 x $5 + 1 x $0 back (refund $10), three units out at $0 -- as one line (${allFree.status}), split in two (${allFreeSplit.status}) or for $9.99 in all (${justUnder.status}) -- is refused: each returned unit was paid its own line's price`, () => {
      forbidden(allFree, 9271)
      forbidden(allFreeSplit, 9271)
      forbidden(justUnder, 9271)
    })
    const twoAfterRefusals = await floorCounts()
    r.check(`the refusals wrote nothing: ${JSON.stringify(twoAfterRefusals)} == ${JSON.stringify(twoBefore)}`, () => assert.deepEqual(twoAfterRefusals, twoBefore))

    const trueSwap = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 2, 5), out(9271, 1, 0, 0)], 'two prices: 2 x $5 + 1 x $0 back, 2 x $5 + 1 x $0 out')
    const blend = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 3.3334)], 'two prices: 2 x $5 + 1 x $0 back, 3 out at the $10 blend')
    r.check(`at the floor the exchange is recorded: 2 x $5 + 1 x $0 out (${trueSwap.status}) and three units at the $10 blend (${blend.status})`, () => {
      assert.equal(trueSwap.status, 200, JSON.stringify(trueSwap.body))
      assert.equal(blend.status, 200, JSON.stringify(blend.body))
    })
    const trueSwapMoney = trueSwap.status === 200 ? [await refundOf(trueSwap), await replacementTotal(trueSwap)] : null
    r.check(`the swap nets to nothing, as it should: refund $10 and a replacement sale of $10 -- ${JSON.stringify(trueSwapMoney)}`, () => assert.deepEqual(trueSwapMoney, [10, 10]))

    // Fewer units out than back: the highest-paid returned units cover them first, so two units out cost the $5 they were paid (not the $0 unit's price).
    const twoOutCheap = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 2, 2.5)], 'two prices: 3 back, 2 out at $2.50')
    const twoOutAtPaid = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 2, 5)], 'two prices: 3 back, 2 out at $5')
    r.check(`3 back (2 x $5 + 1 x $0), 2 out: $5 for the two is refused (${twoOutCheap.status}), $5 each is recorded (${twoOutAtPaid.status})`, () => {
      forbidden(twoOutCheap, 9271)
      assert.equal(twoOutAtPaid.status, 200, JSON.stringify(twoOutAtPaid.body))
    })
    // More units out than back: the three returned units are covered at $5, $5 and $0, the fourth is a purchase at the catalog $5 -- $15 in all.
    const fourAtFloor = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 4, 3.75)], 'two prices: 3 back, 4 out at $15 in all')
    const fourUnder = await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 4, 3.7475)], 'two prices: 3 back, 4 out at $14.99 in all')
    r.check(`3 back, 4 out: $15 in all ($5 + $5 + $0 + the catalog $5) is recorded (${fourAtFloor.status}), $14.99 is refused (${fourUnder.status})`, () => {
      assert.equal(fourAtFloor.status, 200, JSON.stringify(fourAtFloor.body))
      forbidden(fourUnder, 9271)
    })
    // 2 x $5 + 2 x $4.50 back (refund $19): the pooled rule priced every swapped unit at $4.50 ($18).
    const halfAtLowest = await swapLines(halfSale, 9271, [[0, 2], [1, 2]], [out(9271, 4, 4.5)], 'two prices: 2 x $5 + 2 x $4.50 back, 4 out at $4.50')
    const halfAtBlend = await swapLines(halfSale, 9271, [[0, 2], [1, 2]], [out(9271, 4, 4.75)], 'two prices: 2 x $5 + 2 x $4.50 back, 4 out at the $19 blend')
    const halfSplit = await swapLines(halfSale, 9271, [[0, 2], [1, 2]], [out(9271, 2, 4.5), out(9271, 2, 5)], 'two prices: 2 x $5 + 2 x $4.50 back, 2 x $4.50 + 2 x $5 out (lines in the other order)')
    r.check(`2 x $5 + 2 x $4.50 back (refund $19): four out at $4.50 ($18) is refused (${halfAtLowest.status}); the $19 blend (${halfAtBlend.status}) and 2 x $4.50 + 2 x $5 in the other order (${halfSplit.status}) are recorded`, () => {
      forbidden(halfAtLowest, 9271)
      assert.equal(halfAtBlend.status, 200, JSON.stringify(halfAtBlend.body))
      assert.equal(halfSplit.status, 200, JSON.stringify(halfSplit.body))
    })
    // The riel leg pairs per line too: the lines carry no riel price (the import wrote none), so it is each line's dollars x 4000 -- 20000 and 18000.
    const halfRielUnder = await swapLines(halfSale, 9271, [[0, 2], [1, 2]], [out(9271, 4, 4.75, 18999)], 'two prices: 2 x $5 + 2 x $4.50 back, 4 out, dollars at the blend but riel 18999')
    const halfRielAt = await swapLines(halfSale, 9271, [[0, 2], [1, 2]], [out(9271, 4, 4.75, 19000)], 'two prices: 2 x $5 + 2 x $4.50 back, 4 out, riel 19000 (the blend)')
    r.check(`riel: 4 out at the dollar blend with 18999 riel each (${halfRielUnder.status}) is refused, 19000 (${halfRielAt.status}) is recorded -- the riel floor is 20000 x 2 + 18000 x 2`, () => {
      forbidden(halfRielUnder, 9271)
      assert.equal(halfRielAt.status, 200, JSON.stringify(halfRielAt.body))
    })
    // Returning only the free unit: it was paid $0, so it swaps for $0; a second free unit is a purchase.
    const freeOnly = await swapLines(b2g1Sale, 9271, [[1, 1]], [out(9271, 1, 0, 0)], 'two prices: the $0 unit back, 1 out at $0')
    const freeTwice = await swapLines(b2g1Sale, 9271, [[1, 1]], [out(9271, 2, 0, 0)], 'two prices: the $0 unit back, 2 out at $0')
    r.check(`only the $0 unit back: one out at $0 is recorded (${freeOnly.status}); two out at $0 is refused (${freeTwice.status}), the second is a purchase at $5`, () => {
      assert.equal(freeOnly.status, 200, JSON.stringify(freeOnly.body))
      forbidden(freeTwice, 9271)
    })
    // A line sold ABOVE today's catalog price floors at the catalog price: min(base, line price), per line.
    const priceyAtCatalog = await swapLines(priceySale, 9281, [[0, 1]], [out(9281, 1, 4)], 'two prices: sold $6 against catalog $4, 1 back, 1 out at the catalog $4')
    const priceyUnder = await swapLines(priceySale, 9281, [[0, 1]], [out(9281, 1, 3.99, 15960)], 'two prices: sold $6 against catalog $4, 1 back, 1 out at $3.99')
    r.check(`a line sold above today's catalog price floors at the catalog price: $4 is recorded (${priceyAtCatalog.status}), $3.99 is refused (${priceyUnder.status})`, () => {
      assert.equal(priceyAtCatalog.status, 200, JSON.stringify(priceyAtCatalog.body))
      forbidden(priceyUnder, 9281)
    })
    // Whoever may set a price on a sale keeps any price on the very same exchange.
    const grantedFree = [
      await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 0, 0)], 'two prices: sales grant, 3 out at $0', { cookie: withSales }),
      await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 0, 0)], 'two prices: pos grant, 3 out at $0', { cookie: withPos }),
      await swapLines(b2g1Sale, 9271, [[0, 2], [1, 1]], [out(9271, 3, 0, 0)], 'two prices: admin, 3 out at $0', {}),
    ]
    r.check(`control: a caller with sales, a caller with pos and the admin keep any price on the same exchange -- ${grantedFree.map(result => result.status)}`, () => {
      for (const result of grantedFree) assert.equal(result.status, 200, JSON.stringify(result.body))
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} return replacement price: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
