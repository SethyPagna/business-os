'use strict'
// Riel cash comes in whole hundreds (owner ruling, 27 Oct 2026, lane 6.0.1006): "there's no such thing as double digit
// riel so if we input that it is invalid for cash. other payment method is fine. make sure it is consistent."
//
// The whole Worker (src/index.ts bundled, every migration, Miniflare) is driven through each writer family that records
// a riel CASH amount. Every family runs the same three amounts against a $9.9875 line (payable $9.99, 39,960 riel at 4,000):
//   39,950 riel by Cash -> 400 riel_cash_not_hundreds, nothing written
//   39,900 riel by Cash -> accepted, and fully paid (short by 50 riel, under one note: 982)
//   39,950 riel by ABA  -> accepted (a non-cash method may hold any riel)
// DISCRIMINATING: 39,950 riel is short by 10 riel, which the coverage rule (982) accepts as fully paid, so every refusal
// below is a 200 on the base fd84af519. 39,900 (short by 60) is accepted only through that same rule. RIEL_MUTATION=rule_removed bundles the Worker with the shared rule
// answering "valid" for every amount and must turn every refusal check red; RIEL_BASE=<commit> bundles every changed src file
// from that commit (the red-on-base run) and must do the same.
//
// Run (from cloudflare/scripts): node test-riel-cash-hundreds-native.cjs
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTATIONS = {
  rule_removed: [{ name: 'rule_removed', file: 'src/lib/saleStatusResolution.ts',
    from: '  return !Number.isFinite(value) || value % RIEL_CASH_STEP_KHR === 0', to: '  return true' }],
}
const base = process.env.RIEL_BASE || ''
const mutation = process.env.RIEL_MUTATION || (base ? `base:${base}` : '')
if (mutation && !base && !MUTATIONS[mutation]) throw new Error(`unknown RIEL_MUTATION ${mutation}`)

const REFUSED = 'riel_cash_not_hundreds'

async function main() {
  const h = await H.startWorker({ patches: base ? H.basePatches(base) : mutation ? MUTATIONS[mutation] : [] })
  const r = H.recorder(mutation ? `RIEL [mutation ${mutation}]` : 'RIEL')
  const count = async (table, where = '1=1', ...values) => Number((await h.one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...values)).n)
  const refused = (res) => { assert.equal(res.status, 400, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`); assert.equal(res.body.code, REFUSED) }
  const ok = (res) => assert.ok(res.status === 200 || res.status === 201, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
  let seq = 0
  const key = (prefix) => `${prefix}-${++seq}-riel`

  try {
    for (let id = 601; id <= 640; id++) await H.seedProduct(h, id, `RIEL item ${id}`, 9.9875, 50)
    let product = 600
    const nextProduct = () => ++product
    const sale = (details, status = 'completed', extra = {}) => H.createSale(h, { key: key('sale'), status, lines: [{ productId: nextProduct(), quantity: 1 }],
      ...(details ? { paymentDetails: details } : {}), extra, label: `checkout ${JSON.stringify(details)}` })
    const cash = (khr) => [{ method: 'Cash', amount_usd: 0, amount_khr: khr }]
    const aba = (khr) => [{ method: 'ABA', amount_usd: 0, amount_khr: khr }]

    // ---- A. POS checkout (POST /api/sales) ----------------------------------------------------------------------------
    const salesBefore = await count('sales')
    const a1 = await sale(cash(39950))
    const salesAfterRefusal = await count('sales')
    const a2 = await sale(cash(39900))
    const a3 = await sale(aba(39950))
    r.check('A1 checkout: 39,950 riel cash is refused and no sale is written', () => { refused(a1); assert.equal(salesAfterRefusal, salesBefore) })
    const a2Row = a2.body.id ? await h.one('SELECT sale_status, total_usd FROM sales WHERE id=?', a2.body.id) : {}
    r.check(`A2 checkout: 39,900 riel cash is accepted, Completed (total ${a2Row.total_usd})`, () => { ok(a2); assert.equal(a2Row.sale_status, 'completed') })
    r.check('A3 checkout: 39,950 riel by ABA is accepted', () => ok(a3))
    const a4 = await sale([{ method: 'Cash', amount_usd: 5, amount_khr: 20050 }])
    r.check('A4 checkout: a mixed $5 + 20,050 riel cash row is refused on its riel', () => refused(a4))
    // Change handed back in riel is cash too: $10 + 1,300 riel overpays the $9.99 payable total by 1,340 riel.
    const changeSale = (khr) => H.createSale(h, { key: key('change'), lines: [{ productId: nextProduct(), quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 1300 }], extra: { change_is_actual: true, change_usd: 0, change_khr: khr }, label: `change ${khr}` })
    const a5 = await changeSale(1250)
    const a6 = await changeSale(1300)
    r.check('A5 checkout: actual riel change of 1,250 is refused', () => refused(a5))
    r.check('A6 checkout: actual riel change of 1,300 is accepted (the till keeps under 100)', () => ok(a6))

    // ---- B. settle a Not Paid sale (PATCH /:id/status) ----------------------------------------------------------------
    const settle = (id, details, extra = {}) => h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: key('settle'),
      expected_exchange_rate: 4000, payment_details: details, ...extra }, `settle ${id} ${JSON.stringify(details)}`)
    const unpaidId = async () => { const res = await sale(null, 'awaiting_payment'); ok(res); return Number(res.body.id) }
    const b = [await unpaidId(), await unpaidId(), await unpaidId()]
    const b1 = await settle(b[0], cash(39950))
    const b1Row = await h.one('SELECT sale_status, amount_paid_khr FROM sales WHERE id=?', b[0])
    const b2 = await settle(b[1], cash(39900))
    const b3 = await settle(b[2], aba(39950))
    r.check('B1 settle: 39,950 riel cash is refused and the sale stays Not Paid with nothing paid', () => {
      refused(b1); assert.deepEqual([b1Row.sale_status, b1Row.amount_paid_khr], ['awaiting_payment', 0])
    })
    r.check('B2 settle: 39,900 riel cash is accepted', () => ok(b2))
    r.check('B3 settle: 39,950 riel by ABA is accepted', () => ok(b3))

    // ---- C. later payment (POST /:id/payments) ------------------------------------------------------------------------
    const pay = (id, details) => h.call('POST', `/api/sales/${id}/payments`, { client_request_id: key('pay'), expected_exchange_rate: 4000, payment_details: details },
      `instalment ${id} ${JSON.stringify(details)}`)
    const cIds = [await unpaidId(), await unpaidId(), await unpaidId()]
    const c1 = await pay(cIds[0], cash(39950))
    const c1Events = await count('sale_payment_events', 'sale_id=?', cIds[0])
    const c2 = await pay(cIds[1], cash(39900))
    const c3 = await pay(cIds[2], aba(39950))
    r.check('C1 payment: 39,950 riel cash is refused and no payment event is written', () => { refused(c1); assert.equal(c1Events, 0) })
    r.check('C2 payment: 39,900 riel cash is accepted and covers the sale', () => { ok(c2); assert.equal(c2.body.covered, true) })
    r.check('C3 payment: 39,950 riel by ABA is accepted', () => ok(c3))
    const changedPay = async (khr) => h.call('POST', `/api/sales/${await unpaidId()}/payments`, { client_request_id: key('pay'), expected_exchange_rate: 4000,
      payment_details: [{ method: 'Cash', amount_usd: 10, amount_khr: 1300 }], change_is_actual: true, change_usd: 0, change_khr: khr }, `instalment with change ${khr}`)
    const c4 = await changedPay(1250)
    const c5 = await changedPay(1300)
    r.check('C4 payment: a stated riel change of 1,250 is refused', () => refused(c4))
    r.check('C5 payment: a stated riel change of 1,300 is accepted', () => ok(c5))

    // ---- D. payment correction (reopen, then replace the tender) ------------------------------------------------------
    const corrected = async (details) => {
      const paid = await sale([{ method: 'ABA', amount_usd: 10, amount_khr: 0 }])
      ok(paid)
      const id = Number(paid.body.id)
      ok(await h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'awaiting_payment', client_request_id: key('reopen') }, `reopen ${id}`))
      return { id, res: await settle(id, details, { replace_existing_payment: true }) }
    }
    const d1 = await corrected(cash(39950))
    const d1Row = await h.one('SELECT payment_details FROM sales WHERE id=?', d1.id)
    const d2 = await corrected(cash(39900))
    const d3 = await corrected(aba(39950))
    r.check('D1 correction: 39,950 riel cash is refused and the stored tender is untouched', () => {
      refused(d1.res); assert.match(String(d1Row.payment_details), /"ABA"/); assert.doesNotMatch(String(d1Row.payment_details), /39950/)
    })
    r.check('D2 correction: 39,900 riel cash is accepted', () => ok(d2.res))
    r.check('D3 correction: 39,950 riel by ABA is accepted', () => ok(d3.res))

    // ---- E. exchange: the customer pays the difference ($10) ----------------------------------------------------------
    const exchange = async (details) => {
      const original = await sale([{ method: 'Cash', amount_usd: 10, amount_khr: 0 }])
      ok(original)
      const item = await h.one('SELECT id FROM sale_items WHERE sale_id=?', original.body.id)
      const back = [{ sale_item_id: item.id, quantity: 1 }]
      const out = [{ branch_id: 1, product_id: nextProduct(), quantity: 2 }]
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: original.body.id, items: back, replacement_items: out }, 'exchange quote')
      ok(quote)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const returnsBefore = await count('returns')
      const res = await h.call('POST', '/api/returns', { client_request_id: key('exchange'), money_precision_version: 1, sale_id: original.body.id, reason: 'RIEL exchange',
        expected_quote: expected, expected_exchange: quoted, exchange_payment: { details, change_currency: 'USD' },
        items: back.map((line) => ({ ...line, stock_action: 'restock', branch_id: 1 })), replacement_items: out }, `exchange ${JSON.stringify(details)}`)
      return { res, written: (await count('returns')) - returnsBefore }
    }
    const e1 = await exchange(cash(39950))
    const e2 = await exchange(cash(39900))
    const e3 = await exchange(aba(39950))
    r.check('E1 exchange: 39,950 riel cash is refused and no return is written', () => { refused(e1.res); assert.equal(e1.written, 0) })
    r.check('E2 exchange: 39,900 riel cash is accepted', () => ok(e2.res))
    r.check('E3 exchange: 39,950 riel by ABA is accepted', () => ok(e3.res))

    // ---- F. expenses paid out of the drawer (POST and PUT /api/fees) --------------------------------------------------
    const fee = (khr) => h.call('POST', '/api/fees', { client_request_id: key('fee'), fee_type: 'expense', label: 'RIEL fee', amount_usd: 0, amount_khr: khr,
      fee_date: '2026-10-27', branch_id: 1 }, `expense ${khr}`)
    const feesBefore = await count('fees')
    const f1 = await fee(39950)
    const feesAfterRefusal = await count('fees')
    const f2 = await fee(39900)
    r.check('F1 expense: 39,950 riel is refused and no expense is written', () => { refused(f1); assert.equal(feesAfterRefusal, feesBefore) })
    r.check('F2 expense: 39,900 riel is accepted', () => ok(f2))
    // A legacy expense stored before the rule keeps its riel through an edit of another field, and only a changed riel is asked.
    const legacyFee = Number(f2.body.id ?? f2.body.fee?.id)
    await h.db.prepare('UPDATE fees SET amount_khr=39950 WHERE id=?').bind(legacyFee).run()
    const feeRow = async () => h.one('SELECT label, amount_khr, updated_at FROM fees WHERE id=?', legacyFee)
    const before = await feeRow()
    const f3 = await h.call('PUT', `/api/fees/${legacyFee}`, { label: 'RIEL fee renamed', expected_updated_at: before.updated_at }, 'edit legacy expense label')
    const afterLabel = await feeRow()
    const f4 = await h.call('PUT', `/api/fees/${legacyFee}`, { amount_khr: 12350, expected_updated_at: afterLabel.updated_at }, 'edit legacy expense riel')
    r.check('F3 expense: a legacy 39,950 riel expense can still be renamed and keeps its riel', () => { ok(f3); assert.deepEqual([afterLabel.label, afterLabel.amount_khr], ['RIEL fee renamed', 39950]) })
    r.check('F4 expense: changing its riel to 12,350 is refused', () => refused(f4))

    // ---- G. cancel with a lost fee (PATCH /:id/status cancelled) ------------------------------------------------------
    const cancelled = async (khr) => {
      const res = await sale([{ method: 'Cash', amount_usd: 10, amount_khr: 0 }]); ok(res)
      return h.call('PATCH', `/api/sales/${res.body.id}/status`, { sale_status: 'cancelled', cancel_reason: 'mistake', cancel_fee_usd: 0, cancel_fee_khr: khr,
        client_request_id: key('cancel') }, `cancel with lost fee ${khr}`)
    }
    const g1 = await cancelled(39950)
    const g2 = await cancelled(39900)
    r.check('G1 cancel: a 39,950 riel lost fee is refused', () => refused(g1))
    r.check('G2 cancel: a 39,900 riel lost fee is accepted', () => ok(g2))

    // ---- H. group relabel of the payment method (POST /api/sales/bulk-update) -----------------------------------------
    const relabel = async (khr) => {
      const res = await sale(aba(khr)); ok(res)
      const row = await h.one('SELECT id, updated_at FROM sales WHERE id=?', res.body.id)
      const out = await h.call('POST', '/api/sales/bulk-update', { client_request_id: key('relabel'), items: [{ id: row.id, expected_updated_at: row.updated_at }],
        action: { kind: 'payment_method', source: 'ABA', target: 'Cash' } }, `relabel ABA ${khr} as Cash`)
      return { out, method: (await h.one('SELECT payment_method FROM sales WHERE id=?', row.id)).payment_method }
    }
    const h1 = await relabel(39950)
    const h2 = await relabel(40000)
    r.check('H1 relabel: ABA 39,950 riel cannot become Cash, and the method is unchanged', () => { refused(h1.out); assert.equal(h1.method, 'ABA') })
    r.check('H2 relabel: ABA 40,000 riel can become Cash', () => { ok(h2.out); assert.equal(h2.method, 'Cash') })

    // ---- I. shift float and counts (POST /open, POST /:id/close, PATCH /:id) ------------------------------------------
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const shiftsBefore = await count('shift_sessions')
    const i1 = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 39950 }, 'open with 39,950 riel float')
    const shiftsAfterRefusal = await count('shift_sessions')
    const i2 = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 39900 }, 'open with 39,900 riel float')
    r.check('I1 shift open: a 39,950 riel float is refused and no shift is opened', () => { refused(i1); assert.equal(shiftsAfterRefusal, shiftsBefore) })
    r.check('I2 shift open: a 39,900 riel float is accepted', () => ok(i2))
    const shiftId = Number(i2.body.shift?.id)
    const revision = async () => Number((await h.one('SELECT revision FROM shift_sessions WHERE id=?', shiftId)).revision)
    const close = async (khr) => h.call('POST', `/api/shifts/${shiftId}/close`, { expected_revision: await revision(), closing_counted_usd: 0, closing_counted_khr: khr },
      `close counting ${khr} riel`)
    const i3 = await close(39950)
    const i4 = await close(39900)
    r.check('I3 shift close: a 39,950 riel count is refused', () => refused(i3))
    r.check('I4 shift close: a 39,900 riel count is accepted', () => ok(i4))
    // A count stored before the rule: an amend of the note keeps it; changing it to 12,350 riel is refused.
    await h.db.prepare('UPDATE shift_sessions SET closing_counted_khr=39950 WHERE id=?').bind(shiftId).run()
    const i5 = await h.call('PATCH', `/api/shifts/${shiftId}`, { expected_revision: await revision(), reason: 'RIEL note', closing_note: 'counted again',
      closing_counted_khr: 39950 }, 'amend note of a legacy count')
    const i6 = await h.call('PATCH', `/api/shifts/${shiftId}`, { expected_revision: await revision(), reason: 'RIEL count', closing_counted_khr: 12350 }, 'amend count to 12,350')
    const counted = (await h.one('SELECT closing_counted_khr FROM shift_sessions WHERE id=?', shiftId)).closing_counted_khr
    r.check('I5 shift amend: a legacy 39,950 riel count survives an amend of the note', () => ok(i5))
    r.check('I6 shift amend: changing the count to 12,350 riel is refused and the count is unchanged', () => { refused(i6); assert.equal(counted, 39950) })

    // ---- J. historical sales import (the real applyHistoricalSaleImport writer) ---------------------------------------
    const imported = (rowNumber, method, khr) => h.call('POST', '/__fixture/import-sale', { jobId: 'riel-import', rowNumber, nowIso: '2026-10-27T02:00:00.000Z',
      actor: { id: 901, username: 'al_admin', name: 'AL Admin' },
      data: { branch_id: 1, sale_status: 'completed', receipt_number: `RIEL-${rowNumber}`, created_at: '2026-08-20T03:00:00.000Z', payment_method: method,
        payment_currency: 'KHR', exchange_rate: 4000, subtotal_usd: 9.9875, total_usd: 9.9875, amount_paid_usd: 0, amount_paid_khr: khr,
        items: [{ product_id: 640, product_name: 'RIEL item 640', quantity: 1, applied_price_usd: 9.9875, total_usd: 9.9875, returned_quantity: 0, cost_price_usd: 1, branch_id: 1 }] } },
      `import ${method} ${khr}`)
    const j1 = await imported(1, 'Cash', 39950)
    const j2 = await imported(2, 'Cash', 39900)
    const j3 = await imported(3, 'ABA', 39950)
    r.check('J1 import: a Cash sale paid 39,950 riel is refused', () => { assert.equal(j1.status, 409); assert.match(String(j1.body.error), /whole 100 riel/) })
    r.check('J2 import: a Cash sale paid 39,900 riel is accepted', () => ok(j2))
    r.check('J3 import: an ABA sale paid 39,950 riel is accepted', () => ok(j3))

    // ---- K. a legacy cash row is kept: a later payment adds to it and the sale reads as before ------------------------
    const legacy = await sale(null, 'awaiting_payment'); ok(legacy)
    const legacyId = Number(legacy.body.id)
    await h.db.prepare("UPDATE sales SET payment_method='Cash', payment_details='[{\"method\":\"Cash\",\"amount_usd\":0,\"amount_khr\":19950}]', amount_paid_khr=19950, payments_version=0 WHERE id=?")
      .bind(legacyId).run()
    const k1 = await pay(legacyId, aba(20000))
    const k2 = await h.call('GET', H.fresh(`/api/sales?id=${legacyId}`), undefined, 'read the legacy sale', { observe: true })
    r.check('K1 legacy: a sale holding 19,950 riel cash from before the rule takes a later ABA payment', () => { ok(k1); assert.equal(k1.body.covered, true) })
    r.check('K2 legacy: the sale still reads, with its stored riel', () => { ok(k2); const row = (Array.isArray(k2.body) ? k2.body : []).find((s) => Number(s.id) === legacyId); assert.equal(Number(row?.amount_paid_khr), 39950) })

    // ---- L. the shop's own kind map is honoured: a method pinned as cash is cash ---------------------------------------
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const l1 = await sale(aba(39950))
    await h.db.prepare("DELETE FROM settings WHERE key='pos_payment_method_kinds'").run()
    r.check('L1 kinds: with ABA pinned as cash in pos_payment_method_kinds, 39,950 riel by ABA is refused', () => refused(l1))
  } finally {
    await h.mf.dispose()
  }

  const failures = r.results.filter((result) => !result.ok)
  if (mutation) {
    const mustFail = r.results.filter((result) => /refused/.test(result.name) && !/accepted|survives|still/.test(result.name))
    const survived = mustFail.filter((result) => result.ok)
    console.log(`MUTANT ${mutation}: ${mustFail.length - survived.length}/${mustFail.length} refusal checks red`)
    if (survived.length) { console.log(`MUTANT SURVIVED on: ${survived.map((s) => s.name).join(' | ')}`); process.exit(1) }
    process.exit(0)
  }
  if (failures.length) { console.log(`RED riel cash hundreds: ${failures.length} of ${r.results.length} checks failed`); process.exit(1) }
  console.log(`GREEN riel cash hundreds: ${r.results.length}/${r.results.length} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
