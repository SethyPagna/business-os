'use strict'
// 6.0.958 (owner, 22 Oct 2026): "if cancel, ask if replacement also cancel, if so, choose some or all." The whole Worker on workerd + D1
// (harness/al_money_native.cjs).
//
// Cancelling a return that opened a replacement sale (a one-step exchange) must say what happens to the replacement units still with the
// customer. A replacement line is taken back the way any sold line is: by a normal return of that sale line (stock back into the lots it came
// from, the refund in the same ledgers); the cancel then LINKS those returns so that undo and redo move them together with the cancelled return.
//   1. no answer      -> refused with the lines to choose from (409 return_cancel_replacement_choice_required); nothing changes;
//   2. keep           -> replacement.return_ids = [] : only the return is cancelled; the replacement sale is untouched;
//   3. some           -> one replacement line taken back, the other stays;   4. all -> every line taken back (the replacement sale reads fully returned);
//   5. undo / redo    -> the cancelled return, the linked returns and every stock ledger move together, exactly; a replayed request writes nothing twice;
//   6. refusals leave nothing behind: a linked return of another sale, a cancelled one, one that is itself selected, a return with no replacement;
//   7. price floor    -> a caller without the POS price grant may not cancel the return out from under a replacement that was only discounted
//                        because of it (release review P3-3) -- unless the discounted lines are taken back in the same action;
//   8. permission     -> whoever may cancel returns in bulk may say what happens to the replacement; whoever may not, may not.
// MUTANT=<name> bundles ONE deliberate defect; BASE_COMMIT=<sha> runs the same checks against an older source.
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

// Each mutant is a list of source rewrites (one deliberate defect). The foreign-return one needs two: either check alone already refuses a return of another
// exchange, so only removing both lets it through.
const FILE = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  'choice-not-required': [{ file: FILE, from: 'return kept.length && !item.replacement ?', to: 'return false ?' }],
  'floor-guard-off': [{ file: FILE, from: 'if (user && !canSetSalePrice(user)) {', to: 'if (false) {' }],
  'linked-not-undone': [{ file: FILE, from: 'if (applying && member.linked) {', to: 'if (member.linked) {' }],
  // 6.0.963: the refund credit of a cancelled exchange goes back to Not Paid.
  'credit-not-reversed': [{ file: FILE, from: 'member.credit = { saleId: info.sale_id, usd: credit, before, after }', to: 'void 0' }],
  'takeback-not-resplit': [{ file: FILE, from: 'if (takeBacks.length) {', to: 'if (false) {' }],
  'undo-leaves-credit': [{ file: FILE, from: 'const to = direction > 0 ? credit.after : credit.before', to: 'const to = credit.after' }],
  // 6.0.982: the reversal's Not Paid decision back on a private half-cent band instead of the shared coverage rule.
  'credit-half-cent-only': [{ file: FILE, from: "before.sale_status === 'completed' && !covered ?", to: "before.sale_status === 'completed' && Math.abs(sale.total_usd - paidUsd - sale.amount_paid_khr / 4000) > 0.005 ?" }],
  'restore-allowed': [{ file: FILE, from: 'if (Array.isArray(rows) && creditRowIndex(rows) >= 0) continue', to: 'continue' }],
  'foreign-return-linkable': [
    { file: FILE, from: '|| Number(row.sale_id) !== linkedTo.sale_id', to: '' },
    { file: FILE, from: '|| own.some((item) => !lineIds.has(Number(item.sale_item_id)))', to: '' },
  ],
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  const r = H.recorder('RET-EXCHANGE-CANCEL')
  try {
    await H.seedProduct(h, 9701, 'XC Lipstick', 10, 200, 4)
    await H.seedProduct(h, 9702, 'XC Palette', 16, 200, 6)
    await H.seedProduct(h, 9703, 'XC Gloss', 6.48, 200, 2)
    await H.seedProduct(h, 9704, 'XC Serum', 8, 200, 3)
    const returnsOnly = await h.addEmployee(1961, 'xc-returns-only', { returns: true })
    const withPrice = await h.addEmployee(1962, 'xc-returns-pos', { returns: true, pos: true })
    const noBulk = await h.addEmployee(1963, 'xc-no-bulk', { returns: true, 'returns:bulk': false })
    const bulkNoAdd = await h.addEmployee(1964, 'xc-bulk-no-add', { returns: true, 'returns:add': false })

    let seq = 0
    const makeSale = async (lines) => {
      const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)
      const sale = await H.createSale(h, { key: `xc-sale-${++seq}`, status: 'completed', lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity })),
        paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      return { id: sale.body.id, items: await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id) }
    }
    // The Returns screen's two steps for an exchange, then the create carrying exactly what was reviewed.
    const exchange = async (sale, back, out, { payment, cookie } = {}) => {
      const opts = cookie ? { cookie } : {}
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id, items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }, 'exchange quote', opts)
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `xc-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'XC exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: payment || { details: [], change_currency: 'USD' },
        items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }, 'exchange create', opts)
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const ret = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      const s2 = await h.one('SELECT * FROM sales WHERE id=?', ret.replacement_sale_id)
      return { ret, s2 }
    }
    // Lipstick $10 back, Palette $16 + Gloss $6.48 out: the customer pays the $12.48 difference.
    const standardSale = () => makeSale([{ productId: 9701, quantity: 1, price: 10 }])
    const standardExchange = async (existing) => {
      const sale = existing || await standardSale()
      return exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9702, quantity: 1 }, { product_id: 9703, quantity: 1 }],
        { payment: { details: [{ method: 'Cash', amount_usd: 12.48, amount_khr: 0 }], change_currency: 'USD' } })
    }
    const stockOf = async productId => ({
      branch: Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', productId)).quantity),
      product: Number((await h.one('SELECT stock_quantity AS n FROM products WHERE id=?', productId)).n),
      lots: Number((await h.one(`SELECT COALESCE(SUM(bbs.quantity),0) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
        WHERE pb.variant_product_id=? AND bbs.branch_id=1`, productId)).n),
    })
    const ledger = async (...ids) => Object.fromEntries(await Promise.all(ids.map(async id => [id, await stockOf(id)])))
    const delta = (before, after) => Object.fromEntries(Object.keys(after).map(id => [id, ['branch', 'product', 'lots'].map(k => after[id][k] - before[id][k])]))
    const statusOf = async id => (await h.one('SELECT status FROM returns WHERE id=?', id)).status
    const tagOf = async id => (await h.one('SELECT return_state FROM sales WHERE id=?', id)).return_state
    const activeRefunds = async () => Number((await h.one("SELECT COALESCE(SUM(total_refund_usd),0) AS n FROM returns WHERE COALESCE(status,'completed')<>'cancelled'")).n)
    const cancelBody = async (id, key, replacement) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          ...(replacement ? { replacement } : {}) }] }
    }
    const cancelNow = async (id, key, replacement, cookie) => h.call('POST', '/api/returns/bulk', await cancelBody(id, key, replacement), `cancel ${id}`, cookie ? { cookie } : {})
    // The Returns screen takes replacement units back with an ordinary return of the replacement sale's lines.
    const takeBack = async (s2, lineIndexes, key, cookie) => {
      const lines = (await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', s2.id)).filter((_, i) => lineIndexes.includes(i))
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: s2.id, items: lines.map(line => ({ sale_item_id: line.id, quantity: line.quantity })) }, `quote ${key}`, cookie ? { cookie } : {})
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: s2.id, reason: 'XC replacement taken back',
        expected_quote: expected, items: lines.map(line => ({ sale_item_id: line.id, product_id: line.product_id, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })) },
      `take back ${key}`, cookie ? { cookie } : {})
      assert.equal(created.status, 200, JSON.stringify(created.body))
      return created.body.id
    }
    const generationOf = async historyId => JSON.parse((await h.one('SELECT undo_payload FROM action_history WHERE id=?', historyId)).undo_payload).generation

    // ---- 1. an answer is required; 2. keep ----------------------------------------------------------------------------------------------------------
    {
      const x = await standardExchange()
      const before = await ledger(9701, 9702, 9703)
      const refused = await cancelNow(x.ret.id, 'xc-cancel-nochoice')
      const afterRefusal = await ledger(9701, 9702, 9703)
      r.check(`no answer: the cancel is refused with the replacement lines to choose from (${refused.status} ${refused.body.code})`, () => {
        assert.equal(refused.status, 409)
        assert.equal(refused.body.code, 'return_cancel_replacement_choice_required')
        assert.equal(refused.body.replacements.length, 1)
        assert.equal(refused.body.replacements[0].return_id, x.ret.id)
        assert.equal(refused.body.replacements[0].sale_id, x.s2.id)
        assert.deepEqual(refused.body.replacements[0].lines.map(line => [line.product_id, line.quantity]), [[9702, 1], [9703, 1]])
      })
      r.check('no answer: nothing changed (the return is still completed, no stock moved)', () => {
        assert.deepEqual(afterRefusal, before)
      })
      assert.equal(await statusOf(x.ret.id), 'completed')

      const kept = await cancelNow(x.ret.id, 'xc-cancel-keep', { return_ids: [] })
      const afterKeep = await ledger(9701, 9702, 9703)
      const s2After = await h.one('SELECT sale_status,return_state,total_usd FROM sales WHERE id=?', x.s2.id)
      r.check(`keep: only the return is cancelled (${kept.status}); its returned unit leaves the shelf again, the replacement sale and its units stay (${s2After.sale_status}, $${s2After.total_usd})`, () => {
        assert.equal(kept.status, 200, JSON.stringify(kept.body))
        assert.deepEqual(kept.body.changedIds, [x.ret.id])
        assert.deepEqual(delta(before, afterKeep), { 9701: [-1, -1, -1], 9702: [0, 0, 0], 9703: [0, 0, 0] })
        assert.deepEqual([s2After.sale_status, s2After.total_usd, s2After.return_state], ['awaiting_payment', 22.48, null])
      })
    }

    // ---- 3. some: one replacement line is taken back, the other stays ------------------------------------------------------------------------------
    let some
    {
      const x = await standardExchange()
      const before = await ledger(9701, 9702, 9703)
      const refundsBefore = await activeRefunds()
      const second = await takeBack(x.s2, [0], 'xc-take-palette') // the Palette line only
      const mid = await ledger(9701, 9702, 9703)
      const body = await cancelBody(x.ret.id, 'xc-cancel-some', { return_ids: [second] })
      const done = await h.call('POST', '/api/returns/bulk', body, 'cancel some')
      const after = await ledger(9701, 9702, 9703)
      const refundsAfter = await activeRefunds()
      r.check(`some: the Palette line is taken back (return ${second}) and the exchange return is cancelled in one action (${done.status})`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.deepEqual(done.body.changedIds, [x.ret.id], 'the receipt speaks of what the operator selected')
        assert.equal(done.body.changedCount, 1)
        assert.equal(done.body.items.length, 1)
      })
      const label = (await h.one('SELECT label FROM action_history WHERE id=?', done.body.actionHistoryId)).label
      r.check(`some: the history entry says a replacement return was taken back with the cancel -- ${label}`, () => assert.equal(label, '1 returns: status completed → cancelled; 0 unchanged; 1 replacement return(s) taken back with it; refund credit of 1 replacement sale(s) moved to Not Paid'))
      r.check('some: stock exactly -- Palette +1 (its own lot), Lipstick -1 (the cancelled return), Gloss unchanged (it stays with the customer)', () => {
        assert.deepEqual(delta(before, after), { 9701: [-1, -1, -1], 9702: [1, 1, 1], 9703: [0, 0, 0] })
        assert.deepEqual(delta(mid, after), { 9701: [-1, -1, -1], 9702: [0, 0, 0], 9703: [0, 0, 0] })
      })
      r.check(`some: refunds on the books -- the cancelled return's $10 is gone, the Palette line's $16 is in (${refundsBefore} -> ${refundsAfter})`, () => {
        assert.equal(Math.round((refundsAfter - refundsBefore) * 100) / 100, 6)
      })
      assert.equal(await statusOf(second), 'completed')
      assert.equal(await tagOf(x.s2.id), 'partial')
      // A replay of the very same request: the stored receipt, nothing applied twice.
      const replay = await h.call('POST', '/api/returns/bulk', body, 'cancel some (replay)')
      const afterReplay = await ledger(9701, 9702, 9703)
      r.check(`replay: the same request answers from its receipt (${replay.status}) and moves nothing`, () => {
        assert.equal(replay.status, 200)
        assert.equal(replay.body.operationId, done.body.operationId)
        assert.deepEqual(afterReplay, after)
      })
      some = { x, second, before, after, historyId: done.body.actionHistoryId }
    }

    // ---- 5. undo / redo move the cancelled return and the linked return together ----------------------------------------------------------------------
    {
      const { x, second, before, after, historyId } = some
      const undone = await H.historyStep(h, historyId, 'undo', await generationOf(historyId))
      const afterUndo = await ledger(9701, 9702, 9703)
      r.check(`undo: the exchange return is restored AND the linked return is cancelled again (${undone.status})`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
      })
      r.check(`undo: stock -- the Lipstick is back on the shelf (+1), the Palette taken back is out again (-1), the Gloss never moved: ${JSON.stringify(delta(after, afterUndo))}`, () => {
        assert.deepEqual(delta(after, afterUndo), { 9701: [1, 1, 1], 9702: [-1, -1, -1], 9703: [0, 0, 0] })
        assert.deepEqual(afterUndo, before, 'every ledger is exactly where it was before the cancel')
      })
      assert.equal(await statusOf(x.ret.id), 'completed')
      assert.equal(await statusOf(second), 'cancelled')
      assert.equal(await tagOf(x.s2.id), null, 'the replacement sale reads untouched again')
      const redone = await H.historyStep(h, historyId, 'redo', await generationOf(historyId))
      const afterRedo = await ledger(9701, 9702, 9703)
      r.check(`redo: the same cancel applied again, exactly (${redone.status})`, () => {
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.deepEqual(afterRedo, after)
      })
      assert.equal(await statusOf(x.ret.id), 'cancelled')
      assert.equal(await statusOf(second), 'completed')
      assert.equal(await tagOf(x.s2.id), 'partial')
    }

    // ---- 4. all: every replacement line is taken back ---------------------------------------------------------------------------------------------------
    {
      const x = await standardExchange()
      const before = await ledger(9701, 9702, 9703)
      const both = await takeBack(x.s2, [0, 1], 'xc-take-both')
      const done = await cancelNow(x.ret.id, 'xc-cancel-all', { return_ids: [both] })
      const after = await ledger(9701, 9702, 9703)
      const tag = await tagOf(x.s2.id)
      r.check(`all: both replacement lines taken back and the exchange return cancelled (${done.status}); the replacement sale reads ${tag}; stock Palette +1, Gloss +1, Lipstick -1`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.deepEqual(delta(before, after), { 9701: [-1, -1, -1], 9702: [1, 1, 1], 9703: [1, 1, 1] })
        assert.equal(tag, 'full')
      })
      // With every unit taken back there is nothing left to ask about: a later request may leave the answer out.
      const again = await standardExchange()
      const taken = await takeBack(again.s2, [0, 1], 'xc-take-both-2')
      const noAnswerNeeded = await cancelNow(again.ret.id, 'xc-cancel-all-implicit')
      r.check(`all: when every replacement unit is already back, no answer is needed (${noAnswerNeeded.status}); the return ${taken} stays`, () => {
        assert.equal(noAnswerNeeded.status, 200, JSON.stringify(noAnswerNeeded.body))
      })
    }

    // ---- 6. refusals leave nothing behind ------------------------------------------------------------------------------------------------------------------
    {
      const x = await standardExchange()
      const other = await standardExchange()
      const foreign = await takeBack(other.s2, [0], 'xc-take-foreign') // a return of ANOTHER exchange's replacement sale
      const own = await takeBack(x.s2, [0], 'xc-take-own')
      const before = await ledger(9701, 9702, 9703)
      const cancelledReturn = await takeBack(x.s2, [1], 'xc-take-then-cancel')
      assert.equal((await cancelNow(cancelledReturn, 'xc-cancel-linked-first', undefined)).status, 200)
      const refused = []
      for (const [name, replacement, code] of [
        ['a return of another exchange', { return_ids: [foreign] }, 'return_cancel_replacement_invalid'],
        ['a return that is itself cancelled', { return_ids: [cancelledReturn] }, 'return_cancel_replacement_invalid'],
        ['the cancelled return itself', { return_ids: [x.ret.id] }, 'return_cancel_replacement_invalid'],
        ['a return that does not exist', { return_ids: [987654] }, null],
      ]) {
        const before2 = await ledger(9701, 9702, 9703)
        const result = await cancelNow(x.ret.id, `xc-cancel-bad-${refused.length}`, replacement)
        refused.push([name, result.status, result.body.code, code])
        assert.equal(await statusOf(x.ret.id), 'completed', name)
        assert.deepEqual(await ledger(9701, 9702, 9703), before2, name)
      }
      r.check(`refused with nothing written: ${refused.map(([name, status, code]) => `${name} (${status} ${code})`).join('; ')}`, () => {
        for (const [name, status, code, wanted] of refused) {
          assert.ok(status === 409 || status === 400, `${name}: ${status}`)
          if (wanted) assert.equal(code, wanted, name)
        }
      })
      // A return with no replacement at all has nothing to link.
      const plainSale = await makeSale([{ productId: 9701, quantity: 1, price: 10 }])
      const plainMade = await H.customerReturn(h, { key: 'xc-plain', saleId: plainSale.id, lines: [{ saleItemId: plainSale.items[0].id, productId: 9701, quantity: 1 }] })
      const plainWithAnswer = await cancelNow(plainMade.created.body.id, 'xc-cancel-plain-with-answer', { return_ids: [own] })
      r.check(`a return with no replacement has nothing to link (${plainWithAnswer.status} ${plainWithAnswer.body.code})`, () => {
        assert.ok(plainWithAnswer.status === 400 || plainWithAnswer.status === 409)
      })
      assert.equal(await statusOf(plainMade.created.body.id), 'completed')
      // A replacement choice means nothing on a restore.
      const restoreWithAnswer = await h.call('POST', '/api/returns/bulk', { client_request_id: 'xc-restore-answer', field: 'status', source: 'cancelled', target: 'completed',
        items: [{ id: cancelledReturn, expected_status: 'cancelled', expected_method: 'restock', expected_updated_at: null, replacement: { return_ids: [] } }] }, 'restore with an answer')
      r.check(`a replacement choice on a restore is a bad request (${restoreWithAnswer.status})`, () => assert.equal(restoreWithAnswer.status, 400))
      assert.deepEqual(await ledger(9701, 9702, 9703), before)
    }

    // ---- 7. the price floor (release review P3-3) ----------------------------------------------------------------------------------------------------------
    // The Serum sold at $8; its catalog price is $12 today. The straight swap is allowed at the sold $8 for a caller with only Returns. Cancelling
    // the return would leave that swap standing with no return behind it: only a caller who may set prices may leave it.
    {
      const discountedExchange = async () => {
        await h.db.prepare('UPDATE products SET selling_price_usd=8, selling_price_khr=32000 WHERE id=9704').run()
        const sale = await makeSale([{ productId: 9704, quantity: 1, price: 8 }])
        await h.db.prepare('UPDATE products SET selling_price_usd=12, selling_price_khr=48000 WHERE id=9704').run()
        return exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9704, quantity: 1, applied_price_usd: 8 }], { cookie: returnsOnly })
      }
      const x = await discountedExchange()
      const lineBefore = await h.one('SELECT applied_price_usd FROM sale_items WHERE sale_id=?', x.s2.id)
      const before = await ledger(9704)
      const refused = await cancelNow(x.ret.id, 'xc-floor-refused', { return_ids: [] }, returnsOnly)
      r.check(`floor: a caller without the POS price grant may not leave a swap that was only discounted because of the return (${refused.status} ${refused.body.code}); the swap was sold at $${lineBefore.applied_price_usd}`, () => {
        assert.equal(refused.status, 403)
        assert.equal(refused.body.code, 'return_replacement_price_forbidden')
      })
      assert.equal(await statusOf(x.ret.id), 'completed')
      assert.deepEqual(await ledger(9704), before)
      const allowed = await cancelNow(x.ret.id, 'xc-floor-grant', { return_ids: [] }, withPrice)
      r.check(`floor: a caller with the grant may (${allowed.status})`, () => {
        assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
      })
      // The same caller without the grant CAN cancel when the discounted line is taken back in the same action.
      const y = await discountedExchange()
      const taken = await takeBack(y.s2, [0], 'xc-floor-take', returnsOnly)
      const together = await cancelNow(y.ret.id, 'xc-floor-together', { return_ids: [taken] }, returnsOnly)
      r.check(`floor: ...and without the grant when the discounted line is taken back in the same action (${together.status})`, () => {
        assert.equal(together.status, 200, JSON.stringify(together.body))
      })
    }

    // ---- 8. permission -------------------------------------------------------------------------------------------------------------------------------------------
    {
      const x = await standardExchange()
      const refused = await cancelNow(x.ret.id, 'xc-no-bulk', { return_ids: [] }, noBulk)
      r.check(`permission: a caller without Bulk Returns cannot say anything about the replacement (${refused.status})`, () => {
        assert.equal(refused.status, 403)
      })
      assert.equal(await statusOf(x.ret.id), 'completed')
      const second = await takeBack(x.s2, [0], 'xc-perm-take', returnsOnly)
      const allowed = await cancelNow(x.ret.id, 'xc-perm-ok', { return_ids: [second] }, returnsOnly)
      r.check(`permission: a caller with Returns (bulk included) cancels the return and takes the replacement line back (${allowed.status})`, () => {
        assert.equal(allowed.status, 200, JSON.stringify(allowed.body))
      })
      // Taking a unit back records a return, which is the Add grant's: bulk without add can cancel the return and say the replacement stays, but cannot take it back.
      const y = await standardExchange()
      const refusedTake = await h.call('POST', '/api/returns', { client_request_id: 'xc-noadd-take', money_precision_version: 1, sale_id: y.s2.id, reason: 'x', items: [] }, 'take back without add', { cookie: bulkNoAdd })
      const keptByBulk = await cancelNow(y.ret.id, 'xc-noadd-keep', { return_ids: [] }, bulkNoAdd)
      r.check(`permission: bulk without add cannot take replacement units back (${refusedTake.status}) but can cancel the return and keep them (${keptByBulk.status})`, () => {
        assert.equal(refusedTake.status, 403)
        assert.equal(keptByBulk.status, 200, JSON.stringify(keptByBulk.body))
      })
    }

    // ---- 9. the money: the shift drawer and the reports move exactly, and undo / redo put them back --------------------------------------------------
    // Each case is read through the open shift's drawer (GET /api/shifts/current) and the report totals (GET /api/reports/overview) as the change it makes.
    // The exchange: the customer pays $12.48 cash on top of the $10 credit. Gross model: S2 takes $22.48 (credit + cash) and R pays $10 out.
    //   keep  -> R's $10 refund is gone and the $10 credit no longer pays S2 (6.0.963, "Mark it Not Paid"): the drawer keeps the $12.48 that really came in and
    //            the $10 is Not Paid on S2;
    //   some  -> the Palette line ($16) comes back, R's refund gone: the take-back lowers the $10 debt first, so $6 of it is cash; the drawer says +$6.48 --
    //            exactly the Gloss the customer kept -- and nothing is owed;
    //   all   -> every S2 line ($22.48) comes back: $10 lowers the debt, $12.48 is cash, the drawer is exactly where it was before the exchange;
    //   undo  -> the exchange as it stood; redo -> the cancel again, to the cent.
    {
      await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 0 }, 'XC open shift')
      assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))
      const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const round4 = value => Math.round(value * 10000) / 10000
      const read = async () => {
        await new Promise(resolve => setTimeout(resolve, 1100)) // the open-shift window ends at the current second, exclusive
        const drawer = (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'XC drawer', { observe: true })).body.shift.reconciliation
        const overview = await h.call('GET', H.fresh(`/api/reports/overview?startDate=${today}&endDate=${today}`), undefined, 'XC overview', { observe: true })
        assert.equal(overview.status, 200, JSON.stringify(overview.body).slice(0, 200))
        return { drawer, totals: overview.body.sales.totals }
      }
      const change = (before, after) => ({
        expectedUsd: round4(Number(after.drawer.expected.usd) - Number(before.drawer.expected.usd)),
        cashSalesUsd: round4(Number(after.drawer.cash_sales.usd) - Number(before.drawer.cash_sales.usd)),
        refundsUsd: round4(Number(after.drawer.refunds.usd) - Number(before.drawer.refunds.usd)),
        revenue: round4(after.totals.revenue_usd - before.totals.revenue_usd),
        refunds: round4(after.totals.refund_usd - before.totals.refund_usd),
        collected: round4(after.totals.collected_total_usd - before.totals.collected_total_usd),
        notPaid: round4(after.totals.not_paid_owed_usd - before.totals.not_paid_owed_usd),
      })
      const expectChange = (title, got, want) => r.check(`${title}: ${JSON.stringify(got)}`, () => assert.deepEqual(got, want))
      const exchanged = { expectedUsd: 12.48, cashSalesUsd: 22.48, refundsUsd: 10, revenue: 12.48, refunds: 10, collected: 12.48, notPaid: 0 }

      {
        const sale = await standardSale()
        const zero = await read()
        const x = await standardExchange(sale)
        const one = await read()
        expectChange('money: the exchange itself', change(zero, one), exchanged)
        const both = await takeBack(x.s2, [0, 1], 'xc-money-all-take')
        const done = await cancelNow(x.ret.id, 'xc-money-all', { return_ids: [both] })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        const two = await read()
        expectChange('money, all: every replacement line back and the return cancelled -- the drawer and the reports are where they were before the exchange', change(zero, two),
          { expectedUsd: 0, cashSalesUsd: 12.48, refundsUsd: 12.48, revenue: 0, refunds: 22.48, collected: 0, notPaid: 0 })
      }
      {
        const sale = await standardSale()
        const zero = await read()
        const x = await standardExchange(sale)
        const done = await cancelNow(x.ret.id, 'xc-money-keep', { return_ids: [] })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        const two = await read()
        expectChange('money, keep: only the return is cancelled -- its $10 refund is gone, the replacement sale stands whole', change(zero, two),
          { expectedUsd: 12.48, cashSalesUsd: 12.48, refundsUsd: 0, revenue: 22.48, refunds: 0, collected: 12.48, notPaid: 10 })
        const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId))
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        expectChange('money, keep, undone: the exchange as it stood', change(zero, await read()), exchanged)
      }
      {
        const sale = await standardSale()
        const zero = await read()
        const x = await standardExchange(sale)
        const palette = await takeBack(x.s2, [0], 'xc-money-some-take')
        const done = await cancelNow(x.ret.id, 'xc-money-some', { return_ids: [palette] })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        const two = await read()
        expectChange('money, some: the Palette line back ($16 out), the return cancelled ($10 refund gone)', change(zero, two),
          { expectedUsd: 6.48, cashSalesUsd: 12.48, refundsUsd: 6, revenue: 6.48, refunds: 16, collected: 6.48, notPaid: 0 })
        const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId))
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        const three = await read()
        // The Palette's own take-back return is cancelled again by the undo: the drawer holds the exchange as it stood.
        expectChange('money, some, undone: the exchange as it stood (the taken-back line is out again)', change(zero, three), exchanged)
        const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId))
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        expectChange('money, some, redone: the same cancel again, to the cent', change(zero, await read()), change(zero, two))
      }
      {
        // The Gloss ($6.48) comes back, the Palette ($16) stays: the take-back lowers the $10 debt by $6.48 and no cash leaves; $3.52 is still owed.
        // The customer paid $12.48 and keeps the $16 Palette -- exactly what the sale says they owe.
        const sale = await standardSale()
        const zero = await read()
        const x = await standardExchange(sale)
        const gloss = await takeBack(x.s2, [1], 'xc-money-partial-take')
        const done = await cancelNow(x.ret.id, 'xc-money-partial', { return_ids: [gloss] })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        const two = await read()
        expectChange('money, keep the Palette (the Gloss back): no cash out, $3.52 still owed', change(zero, two),
          { expectedUsd: 12.48, cashSalesUsd: 12.48, refundsUsd: 0, revenue: 16, refunds: 6.48, collected: 12.48, notPaid: 3.52 })
        const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId))
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        expectChange('money, keep the Palette, undone: the exchange as it stood', change(zero, await read()), exchanged)
      }
    }

    // ---- 13. the refund credit is Not Paid again (6.0.963, owner: "Mark it Not Paid") -------------------------------------------------------------------
    // Cancelling an exchange return cancels its refund, so the credit that paid the replacement sale for it is reversed: the credit tender row leaves the sale's
    // payments, the sale reads Not Paid for that share, a take-back return splits its refund again (debt first), and undo / redo put back the exact columns.
    {
      const columns = id => h.one('SELECT payment_method,payment_details,amount_paid_usd,amount_paid_khr,sale_status FROM sales WHERE id=?', id)
      const rowsOf = column => JSON.parse(column.payment_details || '[]')
      const x = await standardExchange()
      const exchanged = await columns(x.s2.id)
      r.check('credit: the exchange pays the replacement with a flagged credit row ahead of the customer\'s own cash, $22.48 in all', () => {
        assert.deepEqual(rowsOf(exchanged), [{ method: 'Cash', amount_usd: 10, amount_khr: 0, refund_credit: true }, { method: 'Cash', amount_usd: 12.48, amount_khr: 0 }])
        assert.deepEqual([exchanged.amount_paid_usd, exchanged.sale_status], [22.48, 'completed'])
      })
      const kept = await cancelNow(x.ret.id, 'xc-np-keep', { return_ids: [] })
      const reversed = await columns(x.s2.id)
      const events = await h.all("SELECT kind FROM sale_record_events WHERE sale_id=? AND source_kind='return_bulk'", x.s2.id)
      r.check(`credit, keep: the credit row leaves the payments and the sale owes it as Not Paid -- ${JSON.stringify([reversed.payment_details, reversed.amount_paid_usd, reversed.sale_status])}`, () => {
        assert.equal(kept.status, 200, JSON.stringify(kept.body))
        assert.deepEqual(rowsOf(reversed), [{ method: 'Cash', amount_usd: 12.48, amount_khr: 0 }])
        assert.deepEqual([reversed.payment_method, reversed.amount_paid_usd, reversed.amount_paid_khr, reversed.sale_status], ['Cash', 12.48, 0, 'awaiting_payment'])
        assert.equal(events.length, 1, 'the sale\'s Records show its payment state moving: ' + JSON.stringify(events))
      })
      const undone = await H.historyStep(h, kept.body.actionHistoryId, 'undo', await generationOf(kept.body.actionHistoryId))
      const restored = await columns(x.s2.id)
      r.check(`credit, keep, undo: the replacement sale is exactly as the exchange left it, byte for byte (${undone.status})`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.deepEqual(restored, exchanged)
      })
      const redone = await H.historyStep(h, kept.body.actionHistoryId, 'redo', await generationOf(kept.body.actionHistoryId))
      const keepRedone = await columns(x.s2.id)
      r.check(`credit, keep, redo: the credit is reversed again, exactly (${redone.status})`, () => {
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.deepEqual(keepRedone, reversed)
      })
      const restoreBody = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', x.ret.id)
      const restore = await h.call('POST', '/api/returns/bulk', { client_request_id: 'xc-np-restore', field: 'status', source: 'cancelled', target: 'completed',
        items: [{ id: x.ret.id, expected_status: 'cancelled', expected_method: String(restoreBody.return_type || 'restock'), expected_updated_at: restoreBody.updated_at ?? null }] }, 'restore the cancelled exchange return')
      r.check(`credit, restore: restoring the cancelled exchange return from the list is refused whole (${restore.status} ${restore.body.code}) -- the way back is the Undo`, () => {
        assert.equal(restore.status, 409, JSON.stringify(restore.body))
        assert.equal(restore.body.code, 'return_restore_exchange_credit')
      })
      assert.equal(await statusOf(x.ret.id), 'cancelled')
      assert.deepEqual(await columns(x.s2.id), reversed)

      // Partial keep: the Palette ($16) stays, the Gloss ($6.48) comes back. The take-back lowers the $10 debt first ($6.48), so no cash goes out and $3.52 is still owed:
      // the customer paid $12.48 and keeps the $16 Palette -- exactly what they owe.
      const y = await standardExchange()
      const gloss = await takeBack(y.s2, [1], 'xc-np-gloss')
      const glossBefore = await h.one('SELECT owed_reduction_usd,total_refund_usd,status FROM returns WHERE id=?', gloss)
      const partial = await cancelNow(y.ret.id, 'xc-np-partial', { return_ids: [gloss] })
      const glossAfter = await h.one('SELECT owed_reduction_usd,total_refund_usd,status FROM returns WHERE id=?', gloss)
      const partialSale = await columns(y.s2.id)
      r.check(`credit, partial keep (Palette stays, Gloss back): the Gloss refund ${glossBefore.owed_reduction_usd} -> ${glossAfter.owed_reduction_usd} of debt, none of it cash; the sale still owes the rest`, () => {
        assert.equal(partial.status, 200, JSON.stringify(partial.body))
        assert.deepEqual([glossBefore.owed_reduction_usd, glossBefore.total_refund_usd], [0, 6.48])
        assert.deepEqual([glossAfter.owed_reduction_usd, glossAfter.total_refund_usd, glossAfter.status], [6.48, 6.48, 'completed'])
        assert.deepEqual([partialSale.amount_paid_usd, partialSale.sale_status], [12.48, 'awaiting_payment'])
      })
      const partialUndone = await H.historyStep(h, partial.body.actionHistoryId, 'undo', await generationOf(partial.body.actionHistoryId))
      const glossUndone = await h.one('SELECT owed_reduction_usd,status FROM returns WHERE id=?', gloss)
      const saleUndone = await columns(y.s2.id)
      r.check(`credit, partial keep, undo: the Gloss return is cancelled again with its debt split as before, the sale as the exchange left it (${partialUndone.status})`, () => {
        assert.equal(partialUndone.status, 200, JSON.stringify(partialUndone.body))
        assert.deepEqual([glossUndone.owed_reduction_usd, glossUndone.status], [0, 'cancelled'])
        assert.deepEqual(saleUndone, exchanged)
      })
      const partialRedone = await H.historyStep(h, partial.body.actionHistoryId, 'redo', await generationOf(partial.body.actionHistoryId))
      const glossRedone = await h.one('SELECT owed_reduction_usd,status FROM returns WHERE id=?', gloss)
      const saleRedone = await columns(y.s2.id)
      r.check(`credit, partial keep, redo: the same split again (${partialRedone.status})`, () => {
        assert.equal(partialRedone.status, 200, JSON.stringify(partialRedone.body))
        assert.deepEqual([glossRedone.owed_reduction_usd, glossRedone.status], [6.48, 'completed'])
        assert.deepEqual(saleRedone, partialSale)
      })
    }

    // ---- 13b. the reversal reads coverage through the one shared rule (6.0.982, owner 27 Oct 2026) -----------------------------------------------------------
    // "A riel tender short by under 100 riel is fully paid; 100 riel short still owes." A tiny credit reversed off a sale the customer paid in riel leaves a
    // shortfall the coverage rule calls paid: the sale stays Completed. One 100-riel note short is a real debt: Not Paid.
    {
      await H.seedProduct(h, 9761, 'XC Pin', 0.02, 50, 0.01)
      await H.seedProduct(h, 9762, 'XC Clip', 0.03, 50, 0.01)
      await H.seedProduct(h, 9763, 'XC Mirror', 10, 50, 4)
      const columns = id => h.one('SELECT payment_details,amount_paid_usd,amount_paid_khr,sale_status FROM sales WHERE id=?', id)
      const rielExchange = async (productId, price, khr) => {
        const sale = await makeSale([{ productId, quantity: 1, price }])
        return exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9763, quantity: 1 }],
          { payment: { details: [{ method: 'Cash', amount_usd: 0, amount_khr: khr }], change_currency: 'USD' } })
      }
      // $0.02 credit, $9.98 = 39,920 riel paid: cancelling leaves $10 against 39,920 riel, 80 riel short.
      const under = await rielExchange(9761, 0.02, 39920)
      const underKept = await cancelNow(under.ret.id, 'xc-riel-under', { return_ids: [] })
      const underSale = await columns(under.s2.id)
      r.check(`riel rule: 80 riel short after the credit leaves reads paid, the sale stays Completed -- ${JSON.stringify(underSale)}`, () => {
        assert.equal(underKept.status, 200, JSON.stringify(underKept.body))
        assert.deepEqual(JSON.parse(underSale.payment_details), [{ method: 'Cash', amount_usd: 0, amount_khr: 39920 }])
        assert.deepEqual([underSale.amount_paid_usd, underSale.amount_paid_khr, underSale.sale_status], [0, 39920, 'completed'])
      })
      // $0.03 credit, $9.97 = 39,880 riel paid: 120 riel short -- more than one 100-riel note, a debt.
      const over = await rielExchange(9762, 0.03, 39880)
      const overKept = await cancelNow(over.ret.id, 'xc-riel-over', { return_ids: [] })
      const overSale = await columns(over.s2.id)
      r.check(`riel rule: 120 riel short is owed, the sale reads Not Paid -- ${JSON.stringify(overSale)}`, () => {
        assert.equal(overKept.status, 200, JSON.stringify(overKept.body))
        assert.deepEqual([overSale.amount_paid_usd, overSale.amount_paid_khr, overSale.sale_status], [0, 39880, 'awaiting_payment'])
      })
    }

    // ---- 10. what a cancel costs the database (the Paid plan here; test-return-exchange-cancel-free-native.cjs runs the Free plan) -------------------------------
    // 1 line back / 1 line out, and 5 / 5, each cancelled with every replacement line taken back (here as ONE take-back return, which this plan allows), then
    // undone and redone. The counts are printed. Since 6.0.966 a grouped action is one atomic batch whose size does not grow with its stock lines or the returns it
    // links (set-based writes), so both sizes fit a Free invocation as well; the Free test runs the same 5 / 5 with its take-backs one line at a time.
    {
      const FREE = H.FREE_QUERY_LIMIT
      const countsOf = async (n) => {
        const ids = Array.from({ length: n }, (_, i) => 9710 + i)
        const swaps = Array.from({ length: n }, (_, i) => 9730 + i)
        const sale = await makeSale(ids.map(productId => ({ productId, quantity: 1, price: 10 })))
        const mark = h.metrics.length
        const out = await exchange(sale, ids.map((_, item) => ({ item, quantity: 1 })), swaps.map(product_id => ({ product_id, quantity: 1 })))
        const made = h.metrics.slice(mark)
        const taken = await takeBack(out.s2, swaps.map((_, i) => i), `xc-count-take-${n}`)
        const m2 = h.metrics.length
        const done = await cancelNow(out.ret.id, `xc-count-cancel-${n}`, { return_ids: [taken] })
        assert.equal(done.status, 200, JSON.stringify(done.body))
        const cancelN = h.metrics.slice(m2).find(entry => entry.label === `cancel ${out.ret.id}`).statements
        const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId), `undo ${n}`)
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        const undoN = h.metrics.find(entry => entry.label === `undo ${n}`).statements
        const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId), `redo ${n}`)
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        const redoN = h.metrics.find(entry => entry.label === `redo ${n}`).statements
        return { cancelN, undoN, redoN, createN: made.find(entry => entry.label.startsWith('exchange create'))?.statements }
      }
      for (let i = 0; i < 5; i += 1) { await H.seedProduct(h, 9710 + i, `XC Back ${i}`, 10, 200, 4); await H.seedProduct(h, 9730 + i, `XC Out ${i}`, 10, 200, 4) }
      for (const n of [1, 5]) {
        const got = await countsOf(n)
        console.log(`D1 statements, ${n} back / ${n} out: create ${got.createN}, cancel+take-back ${got.cancelN}, undo ${got.undoN}, redo ${got.redoN} (Free limit ${FREE})`)
        r.check(`statements, ${n} back / ${n} out: cancel ${got.cancelN}, undo ${got.undoN}, redo ${got.redoN} (Free limit ${FREE}, Paid limit ${H.PAID_QUERY_LIMIT})`, () => {
          for (const [name, count] of [['cancel', got.cancelN], ['undo', got.undoN], ['redo', got.redoN]]) assert.ok(count > 0 && count <= FREE, `${name} ${count} > ${FREE}`)
        })
      }
    }

    // The dry run tells the screen how to make the take-backs it announced: one return for all the lines on this plan (the Free test says one line at a time).
    {
      const sale = await makeSale([{ productId: 9710, quantity: 1, price: 10 }])
      const out = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9730, quantity: 1 }])
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', out.ret.id)
      const line = await h.one('SELECT id FROM sale_items WHERE sale_id=? ORDER BY id', out.s2.id)
      const dry = await h.call('POST', '/api/returns/bulk', { client_request_id: 'xc-dry-paid', field: 'status', source: 'completed', target: 'cancelled', dry_run: true,
        items: [{ id: out.ret.id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          replacement: { return_ids: [], planned: [{ sale_item_id: line.id, quantity: 1 }] } }] }, 'paid dry run')
      r.check(`the dry run on the Paid plan passes (${dry.status}) and does not ask for one-line take-backs (takeBackPerLine ${dry.body.takeBackPerLine})`, () => {
        assert.equal(dry.status, 200, JSON.stringify(dry.body))
        assert.equal(dry.body.takeBackPerLine, false)
      })
    }

    // ---- 11. a legacy (money v0) exchange asks the same question -------------------------------------------------------------------------------------------
    // The replacement sale of a v0 exchange is itself a legacy sale, so taking its units back is a legacy return (the New Return screen's v0 body). The question
    // is the same: without an answer the cancel is refused with the lines; with one, the take-back is linked and undo / redo move it with the cancel. On a702ea0e7
    // the same cancel went through silently and left the replacement behind.
    {
      await H.seedProduct(h, 9705, 'XC Legacy A', 5, 100, 1)
      await H.seedProduct(h, 9706, 'XC Legacy B', 4, 100, 1)
      const sold = await H.importSale(h, 951, 'completed', [{ productId: 9705, name: 'XC Legacy A', quantity: 3, price: 3 }], { jobId: 'xc-legacy-job' })
      // The import marks its sales stock-skipped (a cancel is refused on those for everyone); a POS-era v0 sale moved stock, which is the case worth asking about.
      await h.db.prepare('UPDATE sales SET stock_skipped=0 WHERE id=?').bind(sold.sale.id).run()
      const made = await h.call('POST', '/api/returns', { client_request_id: 'xc-legacy-ex', sale_id: sold.sale.id, reason: 'XC legacy exchange', return_type: 'restock',
        items: [{ sale_item_id: sold.items[0].id, product_id: 9705, quantity: 1, stock_action: 'restock', branch_id: 1 }],
        replacement_items: [{ product_id: 9706, branch_id: 1, quantity: 2, applied_price_usd: 4, applied_price_khr: 16000 }] }, 'legacy exchange')
      assert.equal(made.status, 200, JSON.stringify(made.body))
      const legacy = await h.one('SELECT * FROM returns WHERE id=?', made.body.id)
      const s2 = await h.one('SELECT * FROM sales WHERE id=?', legacy.replacement_sale_id)
      const line = await h.one('SELECT id,product_id,quantity,applied_price_usd,applied_price_khr FROM sale_items WHERE sale_id=?', s2.id)
      assert.equal(Number(s2.money_precision_version) || 0, 0, 'the replacement sale of a legacy exchange is a legacy sale')
      const before = await ledger(9705, 9706)
      const refused = await cancelNow(legacy.id, 'xc-legacy-nochoice')
      r.check(`legacy exchange, no answer: refused with the replacement line to choose from (${refused.status} ${refused.body.code})`, () => {
        assert.equal(refused.status, 409)
        assert.equal(refused.body.code, 'return_cancel_replacement_choice_required')
        assert.deepEqual(refused.body.replacements[0].lines.map(l => [l.product_id, l.quantity, l.sale_item_id]), [[9706, 2, line.id]])
        assert.equal(refused.body.replacements[0].money_precision_version, 0)
      })
      assert.equal(await statusOf(legacy.id), 'completed')
      assert.deepEqual(await ledger(9705, 9706), before, 'nothing moved')
      // The legacy take-back: an ordinary legacy return of the replacement sale's line at the price it sold at.
      const takenBack = await h.call('POST', '/api/returns', { client_request_id: 'xc-legacy-take', sale_id: s2.id, reason: 'XC legacy take back', return_type: 'restock',
        total_refund_usd: 8, total_refund_khr: 32000, exchange_rate: 4000,
        items: [{ sale_item_id: line.id, product_id: 9706, quantity: 2, applied_price_usd: 4, applied_price_khr: 16000, return_to_stock: true, stock_action: 'restock', branch_id: 1 }] }, 'legacy take back')
      assert.equal(takenBack.status, 200, JSON.stringify(takenBack.body))
      const mid = await ledger(9705, 9706)
      const done = await cancelNow(legacy.id, 'xc-legacy-all', { return_ids: [takenBack.body.id] })
      const after = await ledger(9705, 9706)
      r.check(`legacy exchange, all: the replacement taken back and the return cancelled (${done.status}); 9706 +2 back on the shelf, 9705 -1 (the returned unit leaves again)`, () => {
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.deepEqual(delta(before, after), { 9705: [-1, -1, -1], 9706: [2, 2, 2] })
        assert.deepEqual(delta(mid, after), { 9705: [-1, -1, -1], 9706: [0, 0, 0] })
      })
      assert.equal(await statusOf(takenBack.body.id), 'completed')
      assert.equal(await tagOf(s2.id), 'full')
      const undone = await H.historyStep(h, done.body.actionHistoryId, 'undo', await generationOf(done.body.actionHistoryId))
      const afterUndo = await ledger(9705, 9706)
      r.check(`legacy exchange, undo: the return is back and the legacy take-back is cancelled with it (${undone.status}); the exchange stands as it was before the take-back`, () => {
        assert.equal(undone.status, 200, JSON.stringify(undone.body))
        assert.deepEqual(afterUndo, before)
      })
      assert.equal(await statusOf(takenBack.body.id), 'cancelled')
      assert.equal(await tagOf(s2.id), null)
      const redone = await H.historyStep(h, done.body.actionHistoryId, 'redo', await generationOf(done.body.actionHistoryId))
      const afterRedo = await ledger(9705, 9706)
      r.check(`legacy exchange, redo: the same cancel again, exactly (${redone.status})`, () => {
        assert.equal(redone.status, 200, JSON.stringify(redone.body))
        assert.deepEqual(afterRedo, after)
      })
    }

    // ---- 12. the question the screen asks before it sends anything: GET /api/returns/:id ---------------------------------------------------------------------
    // replacement_outstanding is what is still with the customer, the same lines the refusal lists; it shrinks as units are taken back and is null when there is nothing to ask.
    {
      const x = await standardExchange()
      const detail = async (id, cookie) => (await h.call('GET', H.fresh(`/api/returns/${id}`), undefined, 'return detail', { observe: true, ...(cookie ? { cookie } : {}) }))
      const first = await detail(x.ret.id)
      const refused = await cancelNow(x.ret.id, 'xc-detail-nochoice')
      r.check(`detail: a fresh exchange lists both replacement lines, the very lines the refusal names -- ${JSON.stringify(first.body.replacement_outstanding?.lines.map(l => [l.product_id, l.quantity]))}`, () => {
        assert.equal(first.status, 200)
        assert.equal(first.body.replacement_outstanding.sale_id, x.s2.id)
        assert.equal(first.body.replacement_outstanding.money_precision_version, 1)
        assert.equal(first.body.replacement_outstanding.exchange_rate, 4000)
        assert.deepEqual(first.body.replacement_outstanding.lines.map(l => [l.product_id, l.quantity, l.applied_price_usd]), [[9702, 1, 16], [9703, 1, 6.48]])
        assert.deepEqual(first.body.replacement_outstanding.lines, refused.body.replacements[0].lines)
        assert.ok(first.body.replacement_outstanding.lines.every(l => l.sale_item_id > 0 && l.branch_id === 1))
      })
      const palette = await takeBack(x.s2, [0], 'xc-detail-take')
      const partial = await detail(x.ret.id)
      r.check(`detail: after the Palette is taken back only the Gloss is left -- ${JSON.stringify(partial.body.replacement_outstanding?.lines.map(l => [l.product_id, l.quantity]))}`, () => {
        assert.deepEqual(partial.body.replacement_outstanding.lines.map(l => [l.product_id, l.quantity]), [[9703, 1]])
      })
      const gloss = await takeBack(x.s2, [1], 'xc-detail-take-2')
      const none = await detail(x.ret.id)
      r.check('detail: with every unit back there is nothing to ask (null), and the cancel needs no answer', () => assert.equal(none.body.replacement_outstanding, null))
      assert.ok(palette > 0 && gloss > 0)
      const plain = await standardSale()
      const plainReturn = await H.customerReturn(h, { key: 'xc-detail-plain', saleId: plain.id, lines: [{ saleItemId: plain.items[0].id, productId: 9701, quantity: 1 }] })
      const plainDetail = await detail(plainReturn.created.body.id)
      r.check('detail: a return with no replacement sale has none outstanding (null)', () => assert.equal(plainDetail.body.replacement_outstanding, null))
      const y = await standardExchange()
      assert.equal((await cancelNow(y.ret.id, 'xc-detail-cancel', { return_ids: [] })).status, 200)
      const cancelled = await detail(y.ret.id)
      r.check('detail: a cancelled return asks nothing (null)', () => assert.equal(cancelled.body.replacement_outstanding, null))
      // The look-up is the return's own detail read: whoever may open the return may read it, nobody else.
      const noView = await h.addEmployee(1965, 'xc-no-view', { pos: true })
      const refusedRead = await detail(first.body.id, noView)
      r.check(`detail: a caller without Returns view cannot read it (${refusedRead.status})`, () => assert.equal(refusedRead.status, 403))
    }
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  if (failed.length) {
    console.log(`\n${failed.length} of ${r.results.length} checks FAILED`)
    process.exitCode = 1
  } else {
    console.log(`\n${r.results.length} exchange-cancel checks passed`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
