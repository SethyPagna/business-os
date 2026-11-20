'use strict'
// payp0 -- an exchange's refund credit keeps the method it was booked under. The whole Worker on workerd + D1 (harness/al_money_native.cjs).
//
// A one-step exchange pays its replacement sale partly with the refund it books: that tender row is flagged refund_credit. The drawer reads every
// tender row by its method, so the credit row's method is what keeps the sale side and the refund side of the drawer equal. Before this slice a bulk
// payment relabel (POST /api/sales/bulk-update) and a Settings payment-method rename (POST /api/settings/payment-methods/replace, scope linked)
// rewrote that row like any customer row, so the drawer lost the credit's cash while the refund's cash-out stayed.
//   1. relabel          -> the customer's row moves, the credit row keeps its method, the drawer moves by the customer's money only;
//   2. rename           -> the same; and a sale whose only matching row is the credit is neither counted nor written;
//   3. cancel exchange  -> the credit leaves the tender and the refund is cancelled: the drawer does not move, relabelled and renamed or not;
//   4. old data         -> a credit relabelled before this fix (method ABA) is still found by its flag and reversed, whatever its method.
// MUTANT=<name> bundles ONE deliberate defect; BASE_COMMIT=<sha> runs the same checks against an older source (red on main b652a501c).
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const BULK = 'src/lib/saleBulkUpdate.ts'
const SETTINGS = 'src/routes/settings.ts'
const RETURN_BULK = 'src/lib/returnBulkAction.ts'
const MUTANTS = {
  // The relabel rewrites the credit row like any customer row.
  relabel_credit: [{ file: BULK, from: 'normalized(detail.method) === source && !isRefundCreditRow(detail) ? { ...detail, method: targetMethod } : detail)', to: 'normalized(detail.method) === source ? { ...detail, method: targetMethod } : detail)' }],
  // The linked rename rewrites the credit row (its row test is dropped everywhere it is used).
  rename_credit: [{ file: SETTINGS, from: "const REFUND_CREDIT_UNTOUCHED_SQL = `AND json_extract(detail.value,'$.refund_credit') IS NOT 1`", to: 'const REFUND_CREDIT_UNTOUCHED_SQL = ``' }],
  // The cancel finds the credit row by reading the CURRENT row's method (only a cash row is taken for the credit), not by its flag alone.
  reverse_by_current_row: [{ file: RETURN_BULK, from: 'return rows.findIndex((row) => row && row.refund_credit === true)', to: "return rows.findIndex((row) => row && row.refund_credit === true && String(row.method) === 'Cash')" }],
}

async function main() {
  if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
  const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT].map((patch, index) => ({ name: `mutant:${process.env.MUTANT}:${index}`, ...patch })) : null
  const h = await H.startWorker({ patches: mutant || (process.env.BASE_COMMIT ? H.basePatches(process.env.BASE_COMMIT) : []) })
  const r = H.recorder('REFUND-CREDIT')
  try {
    await H.seedProduct(h, 9901, 'RC Lipstick', 10, 200, 4)
    await H.seedProduct(h, 9902, 'RC Palette', 20, 200, 6)

    let seq = 0
    const makeSale = async () => {
      const sale = await H.createSale(h, { key: `rc-sale-${++seq}`, status: 'completed', lines: [{ productId: 9901, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body))
      return { id: sale.body.id, items: await h.all('SELECT id,product_id,quantity FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id) }
    }
    // $10 back, $20 out: $10 of the replacement is paid by the refund credit and $10 by the customer in `method`.
    const exchange = async (method) => {
      const sale = await makeSale()
      const back = [{ sale_item_id: sale.items[0].id, quantity: 1 }]
      const out = [{ branch_id: 1, product_id: 9902, quantity: 1 }]
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.id, items: back, replacement_items: out }, 'exchange quote')
      assert.equal(quote.status, 200, JSON.stringify(quote.body))
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `rc-ret-${++seq}`, money_precision_version: 1, sale_id: sale.id, reason: 'RC exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: { details: [{ method, amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' },
        items: back.map(line => ({ ...line, stock_action: 'restock', branch_id: 1 })), replacement_items: out }, 'exchange create')
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const ret = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      return { ret, saleId: ret.replacement_sale_id }
    }
    const cols = id => h.one('SELECT payment_method,payment_details,amount_paid_usd,amount_paid_khr,sale_status,updated_at FROM sales WHERE id=?', id)
    const rowsOf = async id => JSON.parse((await cols(id)).payment_details)
    const credit = async id => (await rowsOf(id)).find(row => row.refund_credit === true)
    const customerRow = async id => (await rowsOf(id)).find(row => row.refund_credit !== true)
    const r4 = v => Math.round(Number(v) * 10000) / 10000
    const drawer = async () => {
      await new Promise(res => setTimeout(res, 1100))
      const cur = await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'drawer', { observe: true })
      const expected = cur.body.shift.reconciliation.expected
      return { usd: r4(expected.usd), khr: r4(expected.khr) }
    }
    const cancelNow = async (id, key) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', id)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null,
          replacement: { return_ids: [] } }] }, `cancel ${id}`)
    }
    const relabel = async (saleIds, source, target, key) => h.call('POST', '/api/sales/bulk-update', { client_request_id: key,
      items: await Promise.all(saleIds.map(async id => ({ id, expected_updated_at: (await cols(id)).updated_at ?? null }))),
      action: { kind: 'payment_method', source, target } }, `relabel ${source} to ${target}`)
    const rename = async (from, to) => h.call('POST', '/api/settings/payment-methods/replace', { from, to, scope: 'linked', currentPassword: 'al-money-fixture' }, `rename ${from} to ${to}`)

    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 100000 }, 'open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))

    const A = await exchange('Cash')
    const B = await exchange('Cash')
    const C = await exchange('ABA')
    const D = await exchange('Cash')
    // D models data relabelled before this fix: its credit row already reads ABA.
    const dRows = (await rowsOf(D.saleId)).map(row => row.refund_credit === true ? { ...row, method: 'ABA' } : row)
    await h.db.prepare('UPDATE sales SET payment_details=?,payment_method=? WHERE id=?').bind(JSON.stringify(dRows), 'ABA + Cash', D.saleId).run()

    const created = await Promise.all([A, B, C].map(async x => ({ credit: await credit(x.saleId), customer: await customerRow(x.saleId) })))
    r.check('setup: each exchange carries a flagged $10 Cash credit row (A, B) and C pays its own $10 in ABA', () => {
      assert.deepEqual([created[0].credit.method, created[1].credit.method, created[2].credit.method], ['Cash', 'Cash', 'Cash'])
      assert.deepEqual([created[0].customer.method, created[1].customer.method, created[2].customer.method], ['Cash', 'Cash', 'ABA'])
      assert.equal(created[0].credit.amount_usd, 10)
    })

    const d0 = await drawer()
    const metricsBefore = h.metrics.length

    // ---- 1. the bulk relabel ----------------------------------------------------------------------------------------------------------------------
    const relabelled = await relabel([B.saleId], 'Cash', 'ABA', 'rc-relabel-b-0001')
    const bAfterRelabel = await cols(B.saleId)
    const dRelabel = await drawer()
    r.check(`relabel (${relabelled.status}): B's customer Cash row moves to ABA and its credit row stays Cash`, () => {
      assert.equal(relabelled.status, 200, JSON.stringify(relabelled.body))
      const rows = JSON.parse(bAfterRelabel.payment_details)
      assert.equal(rows.find(row => row.refund_credit === true).method, 'Cash')
      assert.equal(rows.find(row => row.refund_credit !== true).method, 'ABA')
    })
    r.check(`relabel: the drawer moved by the customer's $10 only (${JSON.stringify(d0)} -> ${JSON.stringify(dRelabel)}), not by the credit`, () => {
      assert.equal(r4(d0.usd - dRelabel.usd), 10)
      assert.equal(dRelabel.khr, d0.khr)
    })
    // A sale whose only Cash row is the credit has nothing to relabel.
    const cBefore = await cols(C.saleId)
    const relabelC = await relabel([C.saleId], 'Cash', 'ABA', 'rc-relabel-c-0001')
    const cAfterRelabel = await cols(C.saleId)
    r.check(`relabel: C's only Cash row is the credit, so it is left alone (${relabelC.status}) and the sale is not rewritten`, () => {
      assert.deepEqual(cAfterRelabel, cBefore)
    })

    // ---- 2. the linked rename ---------------------------------------------------------------------------------------------------------------------
    // The independent count: sales holding a Cash row that is not a credit, and those rows.
    const expectedCounts = (await h.all('SELECT payment_details FROM sales')).reduce((sum, row) => {
      const own = JSON.parse(row.payment_details || '[]').filter(detail => detail.method === 'Cash' && detail.refund_credit !== true).length
      return { sales: sum.sales + (own ? 1 : 0), details: sum.details + own }
    }, { sales: 0, details: 0 })
    const auditBefore = Number((await h.one("SELECT COUNT(*) AS n FROM audit_logs WHERE action='replace' AND entity='payment_method'")).n)
    const aBefore = await cols(A.saleId)
    const renamed = await rename('Cash', 'Cash USD')
    const aAfter = await cols(A.saleId)
    const cAfterRename = await cols(C.saleId)
    const audit = await h.all("SELECT details FROM audit_logs WHERE action='replace' AND entity='payment_method' ORDER BY id")
    const dRename = await drawer()
    r.check(`rename (${renamed.status}): A's customer row becomes Cash USD and its credit row stays Cash`, () => {
      assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 300))
      assert.equal(aBefore.payment_details === aAfter.payment_details, false)
      const rows = JSON.parse(aAfter.payment_details)
      assert.equal(rows.find(row => row.refund_credit === true).method, 'Cash')
      assert.equal(rows.find(row => row.refund_credit !== true).method, 'Cash USD')
      assert.equal(aAfter.payment_method, 'Cash + Cash USD')
    })
    r.check("rename: C's only Cash row is the credit, so the sale is neither counted nor written (row, summary and updated_at unchanged)", () => {
      assert.deepEqual(cAfterRename, cAfterRelabel)
      const details = JSON.parse(audit[audit.length - 1].details)
      assert.equal(audit.length, auditBefore + 1)
      assert.equal(details.linkedSales, expectedCounts.sales, JSON.stringify(details))
      assert.equal(details.linkedDetails, expectedCounts.details, JSON.stringify(details))
      assert.ok(expectedCounts.sales >= 2 && expectedCounts.sales < 8, JSON.stringify(expectedCounts))
    })
    r.check(`rename: the drawer is unchanged by it (${JSON.stringify(dRelabel)} -> ${JSON.stringify(dRename)})`, () => assert.deepEqual(dRename, dRelabel))
    const writesBetween = h.metrics.slice(metricsBefore).filter(entry => !entry.observe)

    // ---- 3. cancelling the exchanges ---------------------------------------------------------------------------------------------------------------
    const cancelB = await cancelNow(B.ret.id, 'rc-cancel-b-0001')
    const bAfterCancel = await cols(B.saleId)
    const dCancelB = await drawer()
    r.check(`cancel B (${cancelB.status}): the credit row leaves its tender, the customer's $10 ABA stays, the sale reads Not Paid`, () => {
      assert.equal(cancelB.status, 200, JSON.stringify(cancelB.body))
      assert.deepEqual(JSON.parse(bAfterCancel.payment_details), [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }])
      assert.equal(bAfterCancel.amount_paid_usd, 10)
      assert.equal(bAfterCancel.sale_status, 'awaiting_payment')
    })
    r.check(`cancel B: the drawer is unchanged across relabel + rename + cancel (${JSON.stringify(dRename)} -> ${JSON.stringify(dCancelB)}) and still short of the start by the customer's $10`, () => {
      assert.deepEqual(dCancelB, dRename)
      assert.equal(r4(d0.usd - dCancelB.usd), 10)
    })
    const cancelA = await cancelNow(A.ret.id, 'rc-cancel-a-0001')
    const aAfterCancel = await cols(A.saleId)
    const dCancelA = await drawer()
    r.check(`cancel A (renamed, never relabelled): the same shape, and the drawer does not move either (${cancelA.status})`, () => {
      assert.equal(cancelA.status, 200, JSON.stringify(cancelA.body))
      assert.deepEqual(JSON.parse(aAfterCancel.payment_details), [{ method: 'Cash USD', amount_usd: 10, amount_khr: 0 }])
      assert.deepEqual(dCancelA, dCancelB)
    })
    const cancelC = await cancelNow(C.ret.id, 'rc-cancel-c-0001')
    const cAfterCancel = await cols(C.saleId)
    r.check(`cancel C (credit-only Cash, customer paid ABA): the credit row alone leaves (${cancelC.status})`, () => {
      assert.equal(cancelC.status, 200, JSON.stringify(cancelC.body))
      assert.deepEqual(JSON.parse(cAfterCancel.payment_details), [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }])
    })

    // ---- 4. data relabelled before this fix ------------------------------------------------------------------------------------------------------
    const cancelD = await cancelNow(D.ret.id, 'rc-cancel-d-0001')
    const dAfterCancel = await cols(D.saleId)
    r.check(`cancel D (credit already relabelled ABA by the old relabel): the flagged row is still the one removed, whatever its method (${cancelD.status})`, () => {
      assert.equal(cancelD.status, 200, JSON.stringify(cancelD.body))
      assert.deepEqual(JSON.parse(dAfterCancel.payment_details), [{ method: 'Cash USD', amount_usd: 10, amount_khr: 0 }])
      assert.equal(dAfterCancel.amount_paid_usd, 10)
      assert.equal(dAfterCancel.sale_status, 'awaiting_payment')
    })

    console.log(`MEASURE relabel+rename+observe-free requests: ${JSON.stringify(writesBetween.map(entry => ({ label: entry.label, calls: entry.calls, statements: entry.statements })))}`)
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  if (failed.length) {
    console.log(`\n${failed.length} of ${r.results.length} checks FAILED`)
    process.exitCode = 1
  } else {
    console.log(`\n${r.results.length} refund-credit checks passed`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
