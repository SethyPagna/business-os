'use strict'
// 6.0.952 (owner, 22 Oct 2026): "replacement actually isn't replacing but changing or adding both. means that they can replace and also add
// items. just make sure logic matches." The whole Worker on workerd + D1 (harness/al_money_native.cjs).
//
// A customer-return replacement is an exchange plus an optional extra purchase with NO cap on its quantity. A return is only a return (the
// refund at the price the original sale charged) and the replacement is only a sale (priced, tendered and recorded like any other): they
// never net, so any quantity, of any product, leaves money, stock and records consistent. This test traces 1 unit back / 10 units out
// (the same product over two lines, and a different product) through every record, plus the cases the quantity makes interesting:
//   1. same product, 1 back at the sold $3 + 10 out as 1 at $3 and 9 at the catalog $5 (a caller with only Returns):
//      refund $3; ONE replacement sale of $48 (192000 riel) paid in full in cash, source_return_id = the return; two sale lines and two
//      return_replacement_items rows (10 units); stock -9 net on branch_stock and products.stock_quantity, the lot ledger sums to the same
//      figure, 'return' +1 and 'replacement_out' -1/-9 movements on the return id, sale_item_batch_allocations for all ten units; the
//      cash in ($48) less the cash refund ($3) is the +$45 the till keeps;
//   2. the same request replayed with its client_request_id: the recorded answer, nothing written twice (no double deduction);
//   3. a different product, 1 back / 10 out at its catalog $4: refund $3, sale $40, each product's stock moves by its own units;
//   4. more units than are on the shelf is refused with nothing written -- stock binds, the returned quantity does not;
//   5. Not Paid: the return lowers the debt ($3, no cash out), the replacement is its own Not Paid sale of $48 (nothing tendered), and the
//      cash refund total does not move;
//   6. PATCH /returns/:id by a caller without the POS price grant may not be what takes a recorded replacement under its floor by taking
//      returned units away (403, nothing changed), but an unrelated edit, more units, a notes-only edit, a grant holder, and a replacement
//      that was already under its floor are not refused;
//   7. (6.0.960, release review c2f27dce6) the same guard on a sale that carries the product on two lines at different prices: the floor pairs
//      each covered unit with its own recorded line, highest price first, so taking the dearer line's units out of the return is refused and an
//      unrelated edit of the very same units is not;
//   8. (6.0.958, P3-B) a legacy replacement line posted with NO price is the Worker's to price: today's catalog price, dollars and riel, whatever the
//      original sale recorded -- the Returns screen posts none for a price it could not read (a catalog that rose or fell since the sale).
// Checks marked "base:" are red on the commit before this change (BASE_COMMIT=95dd89f15). MUTANT=<name> bundles ONE deliberate defect.
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTANTS = {
  'edit-guard-off': { file: 'src/routes/returns.ts', from: 'if (Array.isArray(body.items) && !canSetSalePrice(user)) {', to: 'if (false) {' },
  'edit-refuses-already-under': { file: 'src/routes/returns.ts', from: 'if (await firstDisallowedReplacementPrice(db, linesFor(input.before), input.exchangeRate)) return null', to: '' },
  // 6.0.958 (P3-B): an unposted legacy line takes the catalog price read now; a mutant that takes a remembered figure is the stale-snapshot defect.
  'v0-unposted-stale': { file: 'src/routes/returns.ts', from: 'const priceUsd = input.applied_price_usd != null ? toNumber(input.applied_price_usd) : toNumber(meta.selling_price_usd)', to: 'const priceUsd = input.applied_price_usd != null ? toNumber(input.applied_price_usd) : 3' },
  'edit-uses-price-code': { file: 'src/routes/returns.ts', from: '...RETURN_EDIT_REPLACEMENT_FLOOR_REFUSAL, product_id: offending', to: '...RETURN_REPLACEMENT_PRICE_REFUSAL, product_id: offending' },
  'edit-guard-ignores-after': { file: 'src/routes/returns.ts', from: 'return (await firstDisallowedReplacementPrice(db, linesFor(input.after), input.exchangeRate))?.productId ?? null', to: 'return null' },
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? [{ name: `mutant:${process.env.MUTANT}`, ...MUTANTS[process.env.MUTANT] }] : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  const r = H.recorder('RET-EXCHANGE')
  try {
    await H.seedProduct(h, 9301, 'EX Lipstick', 5, 100, 1)
    await H.seedProduct(h, 9302, 'EX Gloss', 4, 100, 1)
    await H.seedProduct(h, 9311, 'EX TwoPrice', 5, 400, 1)
    await H.seedProduct(h, 9321, 'EX Moved', 5, 100, 1)
    const returnsOnly = await h.addEmployee(1941, 'ex-returns-only', { returns: true })
    const sold = await H.importSale(h, 901, 'completed', [{ productId: 9301, name: 'EX Lipstick', quantity: 20, price: 3 }], { jobId: 'ex-job' })
    const line = sold.items[0]
    // The import writes no riel price on a line; record the $3 line's riel price (12000) so the riel refund and the riel leg of the floor read a recorded figure.
    await h.db.prepare('UPDATE sale_items SET applied_price_khr=12000 WHERE id=?').bind(line.id).run()

    let seq = 0
    const bodies = new Map()
    const post = (key, saleLine, replacements, label, options = { cookie: returnsOnly }, quantity = 1) => {
      const body = { client_request_id: `ex-${key}`, sale_id: saleLine.sale.id, reason: 'EX exchange', return_type: 'restock',
        items: [{ sale_item_id: saleLine.items[0].id, product_id: 9301, quantity, stock_action: 'restock', branch_id: 1 }],
        replacement_items: replacements.map(item => ({ branch_id: 1, ...item })) }
      bodies.set(key, body)
      return h.call('POST', '/api/returns', body, label, options)
    }
    const out = (productId, quantity, usd) => ({ product_id: productId, quantity, applied_price_usd: usd, applied_price_khr: usd * 4000 })
    const stock = async productId => ({
      branch: Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', productId)).quantity),
      product: Number((await h.one('SELECT stock_quantity AS n FROM products WHERE id=?', productId)).n),
      lots: Number((await h.one(`SELECT COALESCE(SUM(bbs.quantity),0) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
        WHERE pb.variant_product_id=? AND bbs.branch_id=1`, productId)).n),
    })
    const counts = async () => Object.fromEntries(await Promise.all(['returns', 'return_items', 'return_replacement_items', 'sales', 'sale_items', 'inventory_movements']
      .map(async table => [table, Number((await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n)])))
    const cashRefund = async () => Number((await h.call('GET', '/api/returns/report?startDate=2020-01-01&endDate=2099-12-31', undefined, 'returns report', { cookie: returnsOnly })).body.totals.cash_refund_usd)
    const rowsOf = async returnId => {
      const ret = await h.one('SELECT * FROM returns WHERE id=?', returnId)
      const sale = ret.replacement_sale_id ? await h.one('SELECT * FROM sales WHERE id=?', ret.replacement_sale_id) : null
      return {
        ret, sale,
        saleItems: sale ? await h.all('SELECT product_id,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr FROM sale_items WHERE sale_id=? ORDER BY id', sale.id) : [],
        replacements: await h.all('SELECT product_id,quantity,applied_price_usd,total_usd,sale_item_id FROM return_replacement_items WHERE return_id=? ORDER BY id', returnId),
        moves: await h.all('SELECT movement_type,product_id,quantity FROM inventory_movements WHERE reference_id=? ORDER BY id', returnId),
        allocated: sale ? Number((await h.one(`SELECT COALESCE(SUM(sia.quantity),0) AS n FROM sale_item_batch_allocations sia
          JOIN sale_items si ON si.id=sia.sale_item_id WHERE si.sale_id=?`, sale.id)).n) : 0,
      }
    }

    // ---- 1. same product: 1 back, 10 out (1 at the sold $3, 9 at the catalog $5) --------------------------------------------------------------
    const before1 = await stock(9301)
    const cashBefore1 = await cashRefund()
    const same = await post('same', sold, [out(9301, 1, 3), out(9301, 9, 5)], 'exchange: 1 back, 10 out, same product')
    r.check(`a returns-only caller records 1 unit back and 10 out of the same product (1 at the sold $3 + 9 at $5) -- ${same.status}`, () => assert.equal(same.status, 200, JSON.stringify(same.body)))
    const a = await rowsOf(same.body.id)
    const after1 = await stock(9301)
    r.check(`money: refund $3 (12000 riel) on the return; ONE replacement sale of $48 / 192000 riel, paid in cash in full, linked by source_return_id -- ${JSON.stringify([a.ret.total_refund_usd, a.ret.total_refund_khr, a.sale?.total_usd, a.sale?.total_khr, a.sale?.amount_paid_usd, a.sale?.payment_method, a.sale?.sale_status])}`, () => {
      assert.deepEqual([a.ret.total_refund_usd, a.ret.total_refund_khr, a.ret.owed_reduction_usd], [3, 12000, 0])
      assert.equal(a.ret.replacement_sale_id, same.body.replacementSaleId)
      assert.deepEqual([a.sale.total_usd, a.sale.subtotal_usd, a.sale.total_khr, a.sale.amount_paid_usd, a.sale.payment_method, a.sale.sale_status], [48, 48, 192000, 48, 'Cash', 'completed'])
      assert.equal(a.sale.source_return_id, same.body.id)
    })
    r.check(`records: two sale lines (1 x $3, 9 x $5) and two return_replacement_items rows carry all ten units -- ${JSON.stringify(a.saleItems.map(row => [row.quantity, row.applied_price_usd, row.total_usd]))}`, () => {
      assert.deepEqual(a.saleItems.map(row => [row.quantity, row.applied_price_usd, row.total_usd, row.total_khr]), [[1, 3, 3, 12000], [9, 5, 45, 180000]])
      assert.deepEqual(a.replacements.map(row => [row.quantity, row.applied_price_usd, row.total_usd]), [[1, 3, 3], [9, 5, 45]])
      assert.ok(a.replacements.every(row => row.sale_item_id != null), 'each replacement row names its sale line')
    })
    r.check(`stock: -9 net (+1 returned, -10 out) on branch_stock and products.stock_quantity, and the lot ledger agrees -- before ${JSON.stringify(before1)}, after ${JSON.stringify(after1)}`, () => {
      assert.deepEqual([after1.branch - before1.branch, after1.product - before1.product, after1.lots - before1.lots], [-9, -9, -9])
      assert.deepEqual([after1.branch, after1.lots], [after1.product, after1.product], 'the branch count, the lot ledger and the product total are one number')
    })
    r.check(`movements on the return id: one 'return' +1 and 'replacement_out' -1 and -9; every replaced unit is drawn from a lot (${a.allocated}) -- ${JSON.stringify(a.moves)}`, () => {
      assert.deepEqual(a.moves.map(move => [move.movement_type, move.quantity]).sort(), [['replacement_out', -1], ['replacement_out', -9], ['return', 1]])
      assert.equal(a.allocated, 10)
    })
    const cashIn = Number(a.sale.amount_paid_usd)
    const cashOut = (await cashRefund()) - cashBefore1
    r.check(`the till: cash in $${cashIn} for the new sale, cash out $${cashOut} for the refund -- the customer pays the +$${cashIn - cashOut} difference`, () => {
      assert.equal(cashOut, 3)
      assert.equal(cashIn - cashOut, 45)
    })
    const audit = await h.one("SELECT details FROM audit_logs WHERE entity='return_create' ORDER BY id LIMIT 1")
    r.check(`the audit row counts the ten-unit exchange as 1 return line and 2 replacement lines -- ${audit?.details}`, () => {
      assert.deepEqual([JSON.parse(audit.details).return_items, JSON.parse(audit.details).replacement_items], [1, 2])
    })

    // ---- 2. the same request again: no double deduction --------------------------------------------------------------------------------------
    const countsBeforeReplay = await counts()
    const stockBeforeReplay = await stock(9301)
    const replay = await h.call('POST', '/api/returns', bodies.get('same'), 'exchange replay', { cookie: returnsOnly })
    const countsAfterReplay = await counts()
    const stockAfterReplay = await stock(9301)
    r.check(`replay: ${replay.status}, same return ${replay.body.id}, same sale ${replay.body.replacementSaleId}; rows ${JSON.stringify(countsAfterReplay)} == ${JSON.stringify(countsBeforeReplay)}; stock ${stockAfterReplay.branch} == ${stockBeforeReplay.branch}`, () => {
      assert.equal(replay.status, 200)
      assert.deepEqual([replay.body.id, replay.body.replacementSaleId], [same.body.id, same.body.replacementSaleId])
      assert.deepEqual(countsAfterReplay, countsBeforeReplay)
      assert.deepEqual(stockAfterReplay, stockBeforeReplay)
    })

    // ---- 3. a different product: 1 of 9301 back, 10 of 9302 out at its catalog $4 --------------------------------------------------------
    const before3 = [await stock(9301), await stock(9302)]
    const different = await post('different', sold, [out(9302, 10, 4)], 'exchange: 1 back, 10 out, different product')
    const b = different.status === 200 ? await rowsOf(different.body.id) : null
    const after3 = [await stock(9301), await stock(9302)]
    r.check(`a different product: refund $3, a $40 replacement sale of ten, 9301 +1 and 9302 -10 each on its own ledgers -- ${different.status} ${JSON.stringify(after3.map((row, index) => row.branch - before3[index].branch))}`, () => {
      assert.equal(different.status, 200, JSON.stringify(different.body))
      assert.deepEqual([b.ret.total_refund_usd, b.sale.total_usd, b.sale.amount_paid_usd, b.saleItems.length, b.allocated], [3, 40, 40, 1, 10])
      assert.deepEqual(after3.map((row, index) => [row.branch - before3[index].branch, row.product - before3[index].product, row.lots - before3[index].lots]), [[1, 1, 1], [-10, -10, -10]])
      assert.deepEqual(b.moves.map(move => [move.movement_type, move.product_id, move.quantity]).sort(), [['replacement_out', 9302, -10], ['return', 9301, 1]])
    })

    // What an exchange costs in D1 statements per invocation (informational: a Free plan allows 50, Paid 1000; the budget guard refuses cleanly, writing nothing).
    for (const entry of h.metrics.filter(entry => /^exchange: /.test(entry.label))) console.log(`D1 info: ${entry.label}: ${entry.statements} statements (Free ${H.FREE_QUERY_LIMIT}, Paid ${H.PAID_QUERY_LIMIT})`)

    // ---- 4. stock binds; the returned quantity does not ---------------------------------------------------------------------------------------
    const beforeShort = [await counts(), await stock(9302)]
    const tooMany = await post('too-many', sold, [out(9302, 500, 4)], 'exchange: 1 back, 500 out (more than on the shelf)')
    const afterShort = [await counts(), await stock(9302)]
    r.check(`500 units out of a shelf holding ${beforeShort[1].branch} are refused (${tooMany.status} ${tooMany.body.code}) and nothing is written`, () => {
      assert.equal(tooMany.status, 409, JSON.stringify(tooMany.body))
      assert.deepEqual(afterShort, beforeShort)
    })

    // ---- 5. Not Paid: the debt falls by the refund, the replacement is its own Not Paid sale -----------------------------------------------
    const unpaid = await H.importSale(h, 902, 'awaiting_payment', [{ productId: 9301, name: 'EX Lipstick', quantity: 20, price: 3 }], { paidUsd: 0, jobId: 'ex-job' })
    await h.db.prepare('UPDATE sale_items SET applied_price_khr=12000 WHERE id=?').bind(unpaid.items[0].id).run()
    const cashBefore5 = await cashRefund()
    const notPaid = await post('unpaid', unpaid, [out(9301, 1, 3), out(9301, 9, 5)], 'exchange: Not Paid sale, 1 back, 10 out')
    const c = notPaid.status === 200 ? await rowsOf(notPaid.body.id) : null
    const originalAfter = await h.one('SELECT sale_status,amount_paid_usd,return_state FROM sales WHERE id=?', unpaid.sale.id)
    r.check(`Not Paid detail: refund $${c?.ret.total_refund_usd}, owed reduction $${c?.ret.owed_reduction_usd}, cash refund moved by ${(await cashRefund()) - cashBefore5}; original sale ${JSON.stringify(originalAfter)}`, () => {
      assert.equal(notPaid.status, 200, JSON.stringify(notPaid.body))
      assert.deepEqual([c.ret.total_refund_usd, c.ret.owed_reduction_usd], [3, 3])
      assert.deepEqual([c.sale.sale_status, c.sale.amount_paid_usd, c.sale.total_usd, c.sale.payment_method], ['awaiting_payment', 0, 48, null])
      assert.equal(c.saleItems.reduce((sum, row) => sum + row.quantity, 0), 10)
      assert.equal(originalAfter.sale_status, 'awaiting_payment')
      assert.equal(originalAfter.amount_paid_usd, 0)
    })
    const cashAfter5 = await cashRefund()
    r.check(`Not Paid: no cash left the drawer for that return (cash refund total ${cashBefore5} -> ${cashAfter5})`, () => assert.equal(cashAfter5, cashBefore5))

    // ---- 6. PATCH /returns/:id by a caller without the POS price grant -----------------------------------------------------------------------
    // R1: 2 units back, 2 out at the sold $3 -- both replacement units are covered, so a caller without the grant may record it.
    const edit = async (returnId, fields, label, options = { cookie: returnsOnly }) => {
      const row = await h.one('SELECT updated_at FROM returns WHERE id=?', returnId)
      return h.call('PATCH', `/api/returns/${returnId}`, { client_request_id: `ex-edit-${++seq}`, expected_updated_at: row.updated_at, ...fields }, label, options)
    }
    const lines = quantity => ({ items: [{ sale_item_id: line.id, product_id: 9301, quantity, stock_action: 'restock', branch_id: 1 }] })
    const r1 = await post('r1', sold, [out(9301, 2, 3)], 'edit fixture: 2 back, 2 out at the sold price', { cookie: returnsOnly }, 2)
    r.check(`fixture: 2 back / 2 out at $3 is recorded for a caller without the grant -- ${r1.status}`, () => assert.equal(r1.status, 200, JSON.stringify(r1.body)))
    const quantityOf = async returnId => Number((await h.one('SELECT SUM(quantity) AS n FROM return_items WHERE return_id=?', returnId)).n)
    const stockBeforeEdit = await stock(9301)
    const lower = await edit(r1.body.id, { ...lines(1), reason: 'EX edit' }, 'edit: lower the returned units 2 -> 1 (the replacement stays 2 at $3)')
    const quantityAfterLower = await quantityOf(r1.body.id)
    const stockAfterLower = await stock(9301)
    r.check(`base: a caller without the grant cannot take returned units away from a recorded replacement: ${lower.status} ${lower.body.code}; the return still has ${quantityAfterLower} units and stock is untouched`, () => {
      assert.equal(lower.status, 403, JSON.stringify(lower.body))
      assert.equal(lower.body.code, 'return_edit_replacement_floor')
      assert.match(lower.body.error, /separate return/)
      assert.equal(lower.body.product_id, 9301)
      assert.equal(quantityAfterLower, 2)
      assert.deepEqual(stockAfterLower, stockBeforeEdit)
    })
    const sameUnits = await edit(r1.body.id, { ...lines(2), reason: 'EX edit reason' }, 'edit: same units, new reason')
    const moreUnits = await edit(r1.body.id, { ...lines(3), reason: 'EX edit more' }, 'edit: more returned units 2 -> 3')
    const notesOnly = await edit(r1.body.id, { notes: 'EX notes only' }, 'edit: notes only, no items')
    r.check(`control: the same units (${sameUnits.status}), more returned units (${moreUnits.status}) and a notes-only edit (${notesOnly.status}) are not refused`, () => {
      for (const result of [sameUnits, moreUnits, notesOnly]) assert.equal(result.status, 200, JSON.stringify(result.body))
    })
    const granted = await edit(r1.body.id, { ...lines(1), reason: 'EX edit by admin' }, 'edit: admin lowers 3 -> 1', {})
    const grantedQuantity = await quantityOf(r1.body.id)
    const replacementAfterGrant = await h.one('SELECT SUM(quantity) AS n, SUM(total_usd) AS t FROM return_replacement_items WHERE return_id=?', r1.body.id)
    r.check(`admin edit: ${granted.status}, return now ${grantedQuantity} unit, replacement still ${replacementAfterGrant.n} units / $${replacementAfterGrant.t}`, () => {
      assert.equal(granted.status, 200, JSON.stringify(granted.body))
      assert.equal(grantedQuantity, 1)
      assert.deepEqual([replacementAfterGrant.n, replacementAfterGrant.t], [2, 6])
    })
    // That replacement is now under its floor (2 units out, 1 covered) through no fault of a later editor: an unrelated edit still goes through.
    const alreadyUnder = await edit(r1.body.id, { ...lines(1), reason: 'EX unrelated edit' }, 'edit: replacement already under its floor, same units')
    const alreadyUnderNotes = await edit(r1.body.id, { notes: 'EX later note' }, 'edit: replacement already under its floor, notes only')
    r.check(`a replacement that was already under its floor never turns an unrelated edit into a refusal -- ${alreadyUnder.status}/${alreadyUnderNotes.status}`, () => {
      assert.equal(alreadyUnder.status, 200, JSON.stringify(alreadyUnder.body))
      assert.equal(alreadyUnderNotes.status, 200, JSON.stringify(alreadyUnderNotes.body))
    })
    // A grant holder's own deep discount (10 units at a cent after 1 back) is not made a reason to refuse a later editor's note.
    const granted10 = await post('granted10', sold, [out(9301, 10, 0.01)], 'exchange: admin, 1 back, 10 out at a cent', {})
    const lateEdit = granted10.status === 200 ? await edit(granted10.body.id, { ...lines(1), reason: 'EX late edit' }, 'edit: returns-only edits an admin\'s deep-discount exchange') : null
    r.check(`an exchange a grant holder priced at a cent can still be edited by a returns-only caller (${lateEdit?.status})`, () => {
      assert.equal(granted10.status, 200, JSON.stringify(granted10.body))
      assert.equal(lateEdit.status, 200, JSON.stringify(lateEdit.body))
    })

    // ---- 7. the same guard on a sale with one product on two lines at different prices ------------------------------------------------------
    // 40 units each at $5 and at $0 (a buy-2-get-1 shape); 2 x $5 + 1 x $0 come back and the same three go out at 2 x $5 + 1 x $0: the floor ($10).
    const twoPrice = await H.importSale(h, 903, 'completed', [{ productId: 9311, name: 'EX TwoPrice', quantity: 40, price: 5 }, { productId: 9311, name: 'EX TwoPrice', quantity: 40, price: 0 }], { jobId: 'ex-job' })
    const dear = twoPrice.items[0]
    const free = twoPrice.items[1]
    const back = lines => ({ items: lines.map(([row, quantity]) => ({ sale_item_id: row.id, product_id: 9311, quantity, stock_action: 'restock', branch_id: 1 })) })
    const created = await h.call('POST', '/api/returns', { client_request_id: `ex-${++seq}`, sale_id: twoPrice.sale.id, reason: 'EX two prices', return_type: 'restock',
      ...back([[dear, 2], [free, 1]]), replacement_items: [out(9311, 2, 5), out(9311, 1, 0)].map(line => ({ branch_id: 1, ...line })) }, 'two prices: 2 x $5 + 1 x $0 back, the same out', { cookie: returnsOnly })
    r.check(`fixture: 2 x $5 + 1 x $0 back and 2 x $5 + 1 x $0 out is recorded for a caller without the grant -- ${created.status}`, () => assert.equal(created.status, 200, JSON.stringify(created.body)))
    const sameTwoPrice = await edit(created.body.id, { ...back([[dear, 2], [free, 1]]), reason: 'EX two prices, same units' }, 'two prices edit: the same units, new reason')
    const dearOnly = await edit(created.body.id, { ...back([[dear, 2]]), reason: 'EX two prices, dear line only' }, 'two prices edit: only the two $5 units stay returned')
    const unitsAfter = Number((await h.one('SELECT SUM(quantity) AS n FROM return_items WHERE return_id=?', created.body.id)).n)
    r.check(`the same units are not refused (${sameTwoPrice.status}); keeping only the two $5 units returned leaves three out against two covered -- $15, not the $10 posted -- and is refused (${dearOnly.status} ${dearOnly.body.code}), the return still has ${unitsAfter} units`, () => {
      assert.equal(sameTwoPrice.status, 200, JSON.stringify(sameTwoPrice.body))
      assert.equal(dearOnly.status, 403, JSON.stringify(dearOnly.body))
      assert.equal(dearOnly.body.code, 'return_edit_replacement_floor')
      assert.equal(dearOnly.body.product_id, 9311)
      assert.equal(unitsAfter, 3)
    })
    // Raising the returned quantity of the dearer line is the same refusal with the same advice: three $5 units back against three out leaves a $15 floor, the
    // recorded $10 stays, and the cashier is told to record the extra unit as a separate return (its own code, not the "cannot set a price" one a POST gets).
    const stockBeforeMore = await stock(9311)
    const moreDear = await edit(created.body.id, { ...back([[dear, 3], [free, 1]]), reason: 'EX two prices, one more dear unit' }, 'two prices edit: one more $5 unit returned, 3 x $5 + 1 x $0')
    const moreDearAgain = await edit(created.body.id, { ...back([[dear, 3], [free, 1]]), reason: 'EX two prices, one more dear unit' }, 'two prices edit: the same refused edit sent again')
    const stockAfterMore = await stock(9311)
    const unitsAfterMore = Number((await h.one('SELECT SUM(quantity) AS n FROM return_items WHERE return_id=?', created.body.id)).n)
    r.check(`raising the returned quantity of the dearer line is refused with its own code and advice (${moreDear.status} ${moreDear.body.code}), again on a repeat (${moreDearAgain.status}); nothing was written -- the return still has ${unitsAfterMore} units, stock untouched`, () => {
      for (const result of [moreDear, moreDearAgain]) {
        assert.equal(result.status, 403, JSON.stringify(result.body))
        assert.equal(result.body.code, 'return_edit_replacement_floor')
        assert.equal(result.body.product_id, 9311)
        assert.match(result.body.error, /Record the extra unit as a separate return/)
      }
      assert.equal(unitsAfterMore, 3)
      assert.deepEqual(stockAfterMore, stockBeforeMore)
    })
    const extraBack = await h.call('POST', '/api/returns', { client_request_id: `ex-${++seq}`, sale_id: twoPrice.sale.id, reason: 'EX two prices, the extra unit on its own', return_type: 'restock',
      ...back([[dear, 1]]) }, 'two prices: the extra $5 unit recorded as a separate return', { cookie: returnsOnly })
    r.check(`the advice works: the extra unit recorded as a return of its own is accepted (${extraBack.status})`, () => assert.equal(extraBack.status, 200, JSON.stringify(extraBack.body)))
    const adminDearOnly = await edit(created.body.id, { ...back([[dear, 2]]), reason: 'EX two prices, admin' }, 'two prices edit: admin keeps only the two $5 units', {})
    r.check(`control: a grant holder makes the same edit (${adminDearOnly.status})`, () => assert.equal(adminDearOnly.status, 200, JSON.stringify(adminDearOnly.body)))

    // ---- 8. a line posted with no price is priced by the Worker at today's catalog price (6.0.958, P3-B) -------------------------------------------------------
    // The Returns screen's "Same item" shortcut posts the unit a returned unit covers at the price the sale recorded and every other unit with no price at all
    // when it could not read the catalog. The catalog may have moved since the sale: the extras are charged what the catalog says now, dollars and riel.
    {
      const movedSale = await H.importSale(h, 904, 'completed', [{ productId: 9321, name: 'EX Moved', quantity: 10, price: 3 }], { jobId: 'ex-job' })
      await h.db.prepare('UPDATE sale_items SET applied_price_khr=12000 WHERE id=?').bind(movedSale.items[0].id).run()
      const setCatalog = usd => h.db.prepare('UPDATE products SET selling_price_usd=?, selling_price_khr=? WHERE id=?').bind(usd, usd * 4000, 9321).run()
      const screen = [{ product_id: 9321, quantity: 1, applied_price_usd: 3, applied_price_khr: 12000 }, { product_id: 9321, quantity: 2 }]
      const swap = (key, label) => h.call('POST', '/api/returns', { client_request_id: `ex-${key}`, sale_id: movedSale.sale.id, reason: 'EX moved catalog', return_type: 'restock',
        items: [{ sale_item_id: movedSale.items[0].id, product_id: 9321, quantity: 1, stock_action: 'restock', branch_id: 1 }],
        replacement_items: screen.map(item => ({ branch_id: 1, ...item })) }, label, { cookie: returnsOnly })
      await setCatalog(6)
      const rose = await swap('moved-rose', 'catalog rose to $6: one unit at the sold $3, two with no price')
      const roseRows = rose.status === 200 ? await rowsOf(rose.body.id) : null
      r.check(`catalog rose to $6: the covered unit is the sold $3, the two unposted units are $6 and 24000 riel each -- sale ${roseRows && JSON.stringify([roseRows.sale.total_usd, roseRows.sale.total_khr])}`, () => {
        assert.equal(rose.status, 200, JSON.stringify(rose.body))
        assert.deepEqual(roseRows.saleItems.map(row => [row.quantity, row.applied_price_usd, row.applied_price_khr]), [[1, 3, 12000], [2, 6, 24000]])
        assert.equal(Number(roseRows.sale.total_usd), 15)
        assert.equal(Number(roseRows.sale.total_khr), 60000)
      })
      await setCatalog(4)
      const fell = await swap('moved-fell', 'catalog fell to $4: one unit at the sold $3, two with no price')
      const fellRows = fell.status === 200 ? await rowsOf(fell.body.id) : null
      r.check(`catalog fell to $4: the two unposted units are $4 and 16000 riel each, not the sale's $3 or the old $6 -- sale ${fellRows && JSON.stringify([fellRows.sale.total_usd, fellRows.sale.total_khr])}`, () => {
        assert.equal(fell.status, 200, JSON.stringify(fell.body))
        assert.deepEqual(fellRows.saleItems.map(row => [row.quantity, row.applied_price_usd, row.applied_price_khr]), [[1, 3, 12000], [2, 4, 16000]])
        assert.equal(Number(fellRows.sale.total_usd), 11)
        assert.equal(Number(fellRows.sale.total_khr), 44000)
      })
    }
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} return replacement exchange: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exitCode = 1 })
