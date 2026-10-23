'use strict'
// 6.0.964 -- the release review of 29688f233 (NOT CERTIFIED): every finding as a discriminating check, on the whole Worker on workerd + D1
// (harness/al_money_native.cjs). The probes of the review (probe-a..e) are the red-before; this file is the green-after and stays.
//   P1-1  cancelling an exchange that GAVE CHANGE BACK is refused whole (409 return_cancel_exchange_change): the cash handed out would be unaccounted for;
//   P1-2  only the refund_credit flag identifies the credit row: a customer's own cash payment of the same size is never removed, the restore guard holds;
//   P2-1  a dry run of the cancel (the take-back announced, not made) refuses what the real cancel would refuse -- budget and price floor -- writing nothing;
//   P2-2  the price floor holds the kept units to the catalog price they were sold against, not today's;
//   P2-3  a same-item exchange of the last unit hands out the unit it just took back: branch stock and lots move together;
//   P2-4  the quote states the riel rate a give-back is figured at, and it is the rate the Worker records;
//   P3    a link to another exchange's take-back is refused with return_cancel_replacement_invalid.
// MUTANT=<name> bundles ONE deliberate defect.
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const BULK = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  'change-not-refused': [{ file: BULK, from: 'if (sale.change_usd > 0 || sale.change_khr > 0) {', to: 'if (false) {' }],
  'credit-found-by-amount': [{ file: BULK, from: 'return rows.findIndex((row) => row && row.refund_credit === true)', to: 'return rows.findIndex((row, position) => position === 0 && (row.refund_credit === true || Number(row.amount_khr) === 0))' }],
  'floor-todays-catalog': [{ file: BULK, from: 'catalog_usd: recordedCatalog(row.sale_items_json, info.lines.length) ??', to: 'catalog_usd:' }],
  'dry-run-ignores-planned': [{ file: BULK, from: 'line.quantity = Math.max(0, Number(subtractDecimalSum(line.quantity, [planned.quantity])))', to: 'void 0' }],
  'fifo-before-restock': [{ file: 'src/lib/returnExchangePlan.ts', from: 'fifoLotsFor(ctx, line.productId, line.branchId, ownRestocks)', to: 'fifoLotsFor(ctx, line.productId, line.branchId)' }],
  'quote-sale-rate': [{ file: 'src/lib/returnExchange.ts', from: 'change_exchange_rate: resolveChangeExchangeRate(input.changeRateSetting, input.exchangeRate),', to: 'change_exchange_rate: input.exchangeRate,' }],
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || [] })
  const r = H.recorder('RET-EXCHANGE-REVIEW964')
  try {
    await H.seedProduct(h, 9801, 'RV A', 10, 200, 4)
    await H.seedProduct(h, 9802, 'RV B', 6.48, 200, 2)
    await H.seedProduct(h, 9803, 'RV C', 20, 200, 6)
    await H.seedProduct(h, 9804, 'RV D', 10, 200, 3)
    await H.seedProduct(h, 9809, 'RV K', 10, 200, 2)
    await H.seedProduct(h, 9810, 'RV L', 5, 1, 1)
    const returnsOnly = await h.addEmployee(1991, 'rv-returns-only', { returns: true })

    let seq = 0
    const makeSale = async (lines) => {
      const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)
      const sale = await H.createSale(h, { key: `rv-sale-${++seq}`, status: 'completed', lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity })),
        paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      return { id: sale.body.id, items: await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id) }
    }
    const exchange = async (sale, back, out, { payment, cookie, allowRefusal } = {}) => {
      const opts = cookie ? { cookie } : {}
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id, items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }, 'exchange quote', opts)
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `rv-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'RV exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: payment || { details: [], change_currency: 'USD' },
        items: back.map(line => ({ sale_item_id: sale.items[line.item].id, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })),
        replacement_items: out.map(line => ({ branch_id: 1, ...line })) }, 'exchange create', opts)
      if (allowRefusal && created.status !== 200) return { refused: created }
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const ret = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      const s2 = await h.one('SELECT * FROM sales WHERE id=?', ret.replacement_sale_id)
      return { quote: quote.body, ret, s2 }
    }
    const cancelBody = async (id, key, replacement, extra = {}) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled', ...extra,
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          ...(replacement ? { replacement } : {}) }] }
    }
    const cancelNow = async (id, key, replacement, cookie) => h.call('POST', '/api/returns/bulk', await cancelBody(id, key, replacement), `cancel ${id}`, cookie ? { cookie } : {})
    const dryRun = async (id, key, replacement, cookie) => h.call('POST', '/api/returns/bulk', await cancelBody(id, key, replacement, { dry_run: true }), `dry run ${id}`, cookie ? { cookie } : {})
    const restoreNow = async (id, key) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'cancelled', target: 'completed',
        items: [{ id, expected_status: 'cancelled', expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null }] }, `restore ${id}`)
    }
    const takeBack = async (s2, idx, key) => {
      const lines = (await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', s2.id)).filter((_, i) => idx.includes(i))
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: s2.id, items: lines.map(line => ({ sale_item_id: line.id, quantity: line.quantity })) }, `quote ${key}`)
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: key, money_precision_version: 1, sale_id: s2.id, reason: 'RV take back', expected_quote: expected,
        items: lines.map(line => ({ sale_item_id: line.id, product_id: line.product_id, quantity: line.quantity, stock_action: 'restock', branch_id: 1 })) }, `take back ${key}`)
      assert.equal(created.status, 200, JSON.stringify(created.body))
      return created.body.id
    }
    const cols = id => h.one('SELECT payment_method,payment_details,amount_paid_usd,amount_paid_khr,change_usd,change_khr,change_is_actual,total_usd,sale_status,return_state FROM sales WHERE id=?', id)
    const statusOf = async id => (await h.one('SELECT status FROM returns WHERE id=?', id)).status
    const count = async table => Number((await h.one(`SELECT COUNT(*) AS n FROM ${table}`)).n)
    const writes = async () => ({ returns: await count('returns'), ops: await count('return_bulk_operations'), history: await count('action_history'), sales: await count('sales') })
    const r4 = v => Math.round(Number(v) * 10000) / 10000
    const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
    const drawer = async () => {
      await new Promise(res => setTimeout(res, 1100))
      const cur = await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'drawer', { observe: true })
      const ov = await h.call('GET', H.fresh(`/api/reports/overview?startDate=${today()}&endDate=${today()}`), undefined, 'overview', { observe: true })
      const expected = cur.body.shift.reconciliation.expected
      return { usd: r4(expected.usd), khr: r4(expected.khr), notPaid: r4(ov.body.sales.totals.not_paid_owed_usd) }
    }
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 100000 }, 'open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))

    // ---- P1-1: an exchange that gave change back cannot be cancelled -----------------------------------------------------------------------------------
    for (const [currency, label] of [['USD', 'dollar change $3.52'], ['KHR', 'riel change 14,000']]) {
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9802, quantity: 1 }], { payment: { details: [], change_currency: currency } })
      const handed = await cols(x.s2.id)
      const drawerBefore = await drawer()
      const writesBefore = await writes()
      const keep = await cancelNow(x.ret.id, `rv-p11-keep-${currency}`, { return_ids: [] })
      const stateAfterKeep = await cols(x.s2.id)
      const returnAfterKeep = await statusOf(x.ret.id)
      const drawerAfterKeep = await drawer()
      const writesAfterKeep = await writes()
      r.check(`P1-1 (${label}): cancel + keep is refused whole (${keep.status} ${keep.body.code}) and nothing moved: the return, the replacement sale and the drawer ${JSON.stringify(drawerAfterKeep)} are as they were`, () => {
        assert.equal(handed[currency === 'USD' ? 'change_usd' : 'change_khr'] > 0, true, 'the exchange did hand change out')
        assert.equal(keep.status, 409)
        assert.equal(keep.body.code, 'return_cancel_exchange_change')
        assert.equal(returnAfterKeep, 'completed')
        assert.deepEqual(stateAfterKeep, handed)
        assert.deepEqual(drawerAfterKeep, drawerBefore)
        assert.deepEqual(writesAfterKeep, writesBefore)
      })
      // The take-back is an ordinary return of the replacement sale; cancelling WITH it linked is refused for the same reason and changes nothing further.
      const taken = await takeBack(x.s2, [0], `rv-p11-tb-${currency}`)
      const stateWithTakeBack = await cols(x.s2.id)
      const drawerWithTakeBack = await drawer()
      const writesWithTakeBack = await writes()
      const all = await cancelNow(x.ret.id, `rv-p11-all-${currency}`, { return_ids: [taken] })
      const stateAfterAll = await cols(x.s2.id)
      const drawerAfterAll = await drawer()
      const writesAfterAll = await writes()
      r.check(`P1-1 (${label}): cancel + take-back is refused as well (${all.status} ${all.body.code}) and writes nothing`, () => {
        assert.equal(all.status, 409)
        assert.equal(all.body.code, 'return_cancel_exchange_change')
        assert.deepEqual(stateAfterAll, stateWithTakeBack)
        assert.deepEqual(drawerAfterAll, drawerWithTakeBack)
        assert.deepEqual(writesAfterAll, writesWithTakeBack)
      })
      // The dry run refuses it too, BEFORE any take-back is made.
      const sale2 = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const y = await exchange(sale2, [{ item: 0, quantity: 1 }], [{ product_id: 9802, quantity: 1 }], { payment: { details: [], change_currency: currency } })
      const line = (await h.all('SELECT id,quantity FROM sale_items WHERE sale_id=?', y.s2.id))[0]
      const before2 = await writes()
      const checked = await dryRun(y.ret.id, `rv-p11-dry-${currency}`, { return_ids: [], planned: [{ sale_item_id: line.id, quantity: 1 }] })
      const after2 = await writes()
      r.check(`P1-1 (${label}): the dry run refuses with the same code and writes nothing (${checked.status} ${checked.body.code})`, () => {
        assert.equal(checked.status, 409)
        assert.equal(checked.body.code, 'return_cancel_exchange_change')
        assert.deepEqual(after2, before2)
      })
    }
    // A customer-pays exchange (no change handed out) still cancels: the refusal is exactly the change.
    {
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' } })
      const done = await cancelNow(x.ret.id, 'rv-p11-control', { return_ids: [] })
      r.check(`P1-1 control: an exchange where the customer paid cancels (${done.status})`, () => assert.equal(done.status, 200, JSON.stringify(done.body)))
    }

    // ---- P1-2: the credit row is found by its flag only; the customer's own payment of the same size is never taken --------------------------------------
    {
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const z = await drawer()
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' } })
      const created = await cols(x.s2.id)
      const done = await cancelNow(x.ret.id, 'rv-p12-cancel', { return_ids: [] })
      const afterCancel = await cols(x.s2.id)
      r.check(`P1-2: cancel + keep takes ONLY the flagged credit row; the customer's own $10 cash stays (${done.status})`, () => {
        assert.equal(JSON.parse(created.payment_details).length, 2)
        assert.equal(JSON.parse(created.payment_details)[0].refund_credit, true)
        assert.equal(done.status, 200, JSON.stringify(done.body))
        assert.deepEqual(JSON.parse(afterCancel.payment_details), [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }])
        assert.equal(afterCancel.amount_paid_usd, 10)
        assert.equal(afterCancel.sale_status, 'awaiting_payment')
      })
      const restore = await restoreNow(x.ret.id, 'rv-p12-restore')
      const afterRestore = await cols(x.s2.id)
      r.check(`P1-2: restoring from the list is refused (${restore.status} ${restore.body.code}) although the customer's $10 equals the credit`, () => {
        assert.equal(restore.status, 409)
        assert.equal(restore.body.code, 'return_restore_exchange_credit')
        assert.deepEqual(afterRestore, afterCancel)
      })
      const cancelledStatus = await statusOf(x.ret.id)
      r.check('P1-2: the return stays cancelled after the refused restore', () => assert.equal(cancelledStatus, 'cancelled'))
      const after = await drawer()
      r.check(`P1-2: the drawer counts the $10 the customer really paid (+${r4(after.usd - z.usd)}) and the customer owes $10 more (+${r4(after.notPaid - z.notPaid)})`, () => {
        assert.equal(r4(after.usd - z.usd), 10)
        assert.equal(r4(after.notPaid - z.notPaid), 10)
      })
      // An exchange row WITHOUT the flag is no credit at all: nothing is taken, nothing guessed.
      const sale2 = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const y = await exchange(sale2, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' } })
      const stripped = JSON.parse((await cols(y.s2.id)).payment_details).map(({ refund_credit: _flag, ...row }) => row)
      await h.db.prepare('UPDATE sales SET payment_details=? WHERE id=?').bind(JSON.stringify(stripped), y.s2.id).run()
      const unflagged = await cancelNow(y.ret.id, 'rv-p12-unflagged', { return_ids: [] })
      const untouched = await cols(y.s2.id)
      r.check(`P1-2: with no flagged row nothing is removed by a guess (${unflagged.status}); the sale keeps both rows`, () => {
        assert.equal(unflagged.status, 200, JSON.stringify(unflagged.body))
        assert.deepEqual(JSON.parse(untouched.payment_details), stripped)
        assert.equal(untouched.amount_paid_usd, 20)
        assert.equal(untouched.sale_status, 'completed')
      })
    }

    // ---- P2-1: the dry run -----------------------------------------------------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }, { product_id: 9804, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }], change_currency: 'USD' } })
      const lines = await h.all('SELECT id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', x.s2.id)
      const before = await writes()
      const stateBefore = await cols(x.s2.id)
      const ok = await dryRun(x.ret.id, 'rv-p21-dry-ok', { return_ids: [], planned: [{ sale_item_id: lines[0].id, quantity: 1 }] })
      const keepAll = await dryRun(x.ret.id, 'rv-p21-dry-keep', { return_ids: [] })
      const tooMany = await dryRun(x.ret.id, 'rv-p21-dry-many', { return_ids: [], planned: [{ sale_item_id: lines[0].id, quantity: 5 }] })
      const foreign = await dryRun(x.ret.id, 'rv-p21-dry-foreign', { return_ids: [], planned: [{ sale_item_id: 999999, quantity: 1 }] })
      const undecided = await h.call('POST', '/api/returns/bulk', await cancelBody(x.ret.id, 'rv-p21-dry-undecided', undefined, { dry_run: true }), 'dry run undecided')
      const notTrue = await h.call('POST', '/api/returns/bulk', await cancelBody(x.ret.id, 'rv-p21-dry-false', { return_ids: [] }, { dry_run: false }), 'dry run false')
      const plannedOnReal = await h.call('POST', '/api/returns/bulk', await cancelBody(x.ret.id, 'rv-p21-real-planned', { return_ids: [], planned: [{ sale_item_id: lines[0].id, quantity: 1 }] }), 'real with planned')
      const writtenAfter = await writes()
      const stateAfterDry = await cols(x.s2.id)
      const returnAfterDry = await statusOf(x.ret.id)
      r.check(`P2-1: a dry run answers ok (${ok.status}, keep-all ${keepAll.status}) and writes nothing: ${JSON.stringify(writtenAfter)}`, () => {
        assert.equal(ok.status, 200, JSON.stringify(ok.body))
        assert.equal(ok.body.dryRun, true)
        assert.equal(keepAll.status, 200, JSON.stringify(keepAll.body))
        assert.deepEqual(writtenAfter, before)
        assert.deepEqual(stateAfterDry, stateBefore)
        assert.equal(returnAfterDry, 'completed')
      })
      r.check(`P2-1: a planned take-back larger than what stays (${tooMany.status} ${tooMany.body.code}) or of a line that is not this exchange's (${foreign.status} ${foreign.body.code}) is refused`, () => {
        assert.equal(tooMany.status, 400)
        assert.equal(tooMany.body.code, 'return_cancel_replacement_invalid')
        assert.equal(foreign.status, 400)
        assert.equal(foreign.body.code, 'return_cancel_replacement_invalid')
      })
      r.check(`P2-1: a dry run without an answer is the question (${undecided.status} ${undecided.body.code}); dry_run must be exactly true (${notTrue.status}); planned only on a dry run (${plannedOnReal.status})`, () => {
        assert.equal(undecided.status, 409)
        assert.equal(undecided.body.code, 'return_cancel_replacement_choice_required')
        assert.equal(notTrue.status, 400)
        assert.equal(plannedOnReal.status, 400)
      })
    }
    // The price floor is judged on the dry run with the planned units gone, and by the real cancel the same way.
    {
      await h.db.prepare('UPDATE products SET selling_price_usd=8, selling_price_khr=32000 WHERE id=9804').run()
      const sale = await makeSale([{ productId: 9804, quantity: 1, price: 8 }])
      await h.db.prepare('UPDATE products SET selling_price_usd=12, selling_price_khr=48000 WHERE id=9804').run()
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9804, quantity: 1, applied_price_usd: 8 }, { product_id: 9803, quantity: 1 }], { cookie: returnsOnly,
        payment: { details: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }], change_currency: 'USD' } })
      const lines = await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', x.s2.id)
      const discounted = lines.find(line => line.product_id === 9804)
      const before = await writes()
      const kept = await dryRun(x.ret.id, 'rv-p21-floor-keep', { return_ids: [], planned: [] }, returnsOnly)
      const taken = await dryRun(x.ret.id, 'rv-p21-floor-taken', { return_ids: [], planned: [{ sale_item_id: discounted.id, quantity: 1 }] }, returnsOnly)
      const floorWrites = await writes()
      r.check(`P2-1: returns-only keeping the swap that was only discounted because of the return is refused by the dry run (${kept.status} ${kept.body.code}); taking that line back passes (${taken.status}); nothing written`, () => {
        assert.equal(kept.status, 403)
        assert.equal(kept.body.code, 'return_replacement_price_forbidden')
        assert.equal(taken.status, 200, JSON.stringify(taken.body))
        assert.deepEqual(floorWrites, before)
      })
    }

    // ---- P2-2: the floor uses the catalog price the line was sold against ---------------------------------------------------------------------------------
    {
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9809, quantity: 1 }], { cookie: returnsOnly, payment: { details: [], change_currency: 'USD' } })
      const recorded = JSON.parse((await h.one('SELECT items FROM sales WHERE id=?', x.s2.id)).items)[0].catalog_usd
      await h.db.prepare('UPDATE products SET selling_price_usd=12, selling_price_khr=48000 WHERE id=9809').run()
      const done = await cancelNow(x.ret.id, 'rv-p22-cancel', { return_ids: [] }, returnsOnly)
      r.check(`P2-2: the catalog rose from $${recorded} to $12 after the exchange; a returns-only cancel + keep of the line sold at the catalog price of its day is allowed (${done.status})`, () => {
        assert.equal(recorded, 10)
        assert.equal(done.status, 200, JSON.stringify(done.body))
      })
      await h.db.prepare('UPDATE products SET selling_price_usd=10, selling_price_khr=40000 WHERE id=9809').run()
    }

    // ---- P2-3: the last unit exchanged for the same item ----------------------------------------------------------------------------------------------
    {
      const ledger = async () => ({
        branch: Number((await h.one('SELECT quantity FROM branch_stock WHERE product_id=9810 AND branch_id=1')).quantity),
        lots: Number((await h.one('SELECT COALESCE(SUM(bbs.quantity),0) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=9810 AND bbs.branch_id=1')).n),
      })
      const sale = await makeSale([{ productId: 9810, quantity: 1, price: 5 }])
      const before = await ledger()
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9810, quantity: 1 }], { allowRefusal: true })
      const after = await ledger()
      r.check(`P2-3: product with one unit, sold, then exchanged 1 back / 1 out of itself: the exchange is accepted and branch stock and the lot ledger move together (${JSON.stringify(before)} -> ${JSON.stringify(after)})`, () => {
        assert.ok(!x.refused, JSON.stringify(x.refused && x.refused.body))
        assert.equal(after.branch - before.branch, after.lots - before.lots)
        assert.equal(after.branch, after.lots)
        assert.equal(after.branch, 0)
      })
      const allocations = x.s2 ? await h.all('SELECT batch_id,quantity FROM sale_item_batch_allocations WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=?)', x.s2.id).catch(() => []) : []
      r.check(`P2-3: one unit was handed out from the lots (allocations: ${JSON.stringify(allocations)})`, () => {
        if (allocations.length) assert.equal(allocations.reduce((sum, row) => sum + Number(row.quantity), 0), 1)
      })
    }

    // ---- P2-4: the riel give-back on screen is what the Worker records ---------------------------------------------------------------------------------------
    {
      await h.db.prepare("INSERT INTO settings(key,value) VALUES('change_exchange_rate','4100') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
      const sale = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(sale, [{ item: 0, quantity: 1 }], [{ product_id: 9802, quantity: 1 }], { payment: { details: [], change_currency: 'KHR' } })
      const quoted = x.quote.exchange
      const screen = Math.floor((-quoted.net_usd) * quoted.change_exchange_rate / 100 + 1e-9) * 100
      const recordedKhr = (await cols(x.s2.id)).change_khr
      r.check(`P2-4: the quote states the change rate (${quoted.change_exchange_rate}, the sale's is ${quoted.exchange_rate}) and the screen figure ${screen} is what the Worker records (${recordedKhr})`, () => {
        assert.equal(quoted.change_exchange_rate, 4100)
        assert.notEqual(quoted.exchange_rate, 4100, 'the setting differs from the sale rate, so the two rates would give different riel')
        assert.equal(screen, recordedKhr)
      })
      await h.db.prepare("DELETE FROM settings WHERE key='change_exchange_rate'").run()
      const sale2 = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const y = await exchange(sale2, [{ item: 0, quantity: 1 }], [{ product_id: 9802, quantity: 1 }], { payment: { details: [], change_currency: 'KHR' } })
      r.check(`P2-4: with no setting the change rate is the sale's (${y.quote.exchange.change_exchange_rate} = ${y.quote.exchange.exchange_rate})`, () => assert.equal(y.quote.exchange.change_exchange_rate, y.quote.exchange.exchange_rate))
    }

    // ---- P3: a link to another exchange's take-back -----------------------------------------------------------------------------------------------------
    {
      const s1 = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const s1b = await makeSale([{ productId: 9801, quantity: 1, price: 10 }])
      const x = await exchange(s1, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' } })
      const y = await exchange(s1b, [{ item: 0, quantity: 1 }], [{ product_id: 9803, quantity: 1 }], { payment: { details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' } })
      const tbY = await takeBack(y.s2, [0], 'rv-p3-tby-0001')
      const cross = await cancelNow(x.ret.id, 'rv-p3-cross-link', { return_ids: [tbY] })
      r.check(`P3: linking another exchange's take-back is refused with return_cancel_replacement_invalid (${cross.status} ${cross.body.code})`, () => {
        assert.equal(cross.status, 409)
        assert.equal(cross.body.code, 'return_cancel_replacement_invalid')
      })
      const xs = await statusOf(x.ret.id)
      const ts = await statusOf(tbY)
      r.check('P3: and nothing changed (the exchange return and the other exchange take-back stay completed)', () => {
        assert.equal(xs, 'completed')
        assert.equal(ts, 'completed')
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
    console.log(`\n${r.results.length} exchange review-964 checks passed`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
