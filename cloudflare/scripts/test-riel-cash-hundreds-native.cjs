'use strict'
// Riel cash comes in whole hundreds (owner ruling, 27 Oct 2026: "there's no such thing as double digit riel so if we input
// that it is invalid for cash. other payment method is fine. make sure it is consistent."). Lane MONEY-1, 4 Nov 2026.
//
// The whole Worker (src/index.ts bundled, every migration, Miniflare) is driven through each writer family that records a
// riel CASH amount. Every sale family runs the same three tenders against a $4.75 line (19,000 riel at 4,000):
//   Cash $4.71 + 150 riel -> 400 riel_cash_not_hundreds, nothing written
//   Cash $4.50 + 1,000 riel -> accepted (exactly $4.75)
//   ABA  $4.71 + 150 riel -> accepted (a non-cash method may hold any riel)
// DISCRIMINATING: $4.71 + 150 riel is $4.7475, short of $4.75 by $0.0025 -- inside the half-cent paid band -- so on the base
// 6af0d3b49 the tender is a full payment and every refusal below is a 200 there (the E2E case pos-checkout "a 150 riel cash row"
// shows the same row). RIEL_MUTATION=rule_removed bundles the Worker with the shared rule answering "valid" for every amount and
// must turn every refusal check red; RIEL_BASE=<commit> bundles every changed src file from that commit and must do the same.
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
    for (let id = 601; id <= 660; id++) await H.seedProduct(h, id, `RIEL item ${id}`, 4.75, 50)
    let product = 600
    const nextProduct = () => ++product
    const sale = (details, status = 'completed', extra = {}) => H.createSale(h, { key: key('sale'), status, lines: [{ productId: nextProduct(), quantity: 1 }],
      ...(details ? { paymentDetails: details } : {}), extra, label: `checkout ${JSON.stringify(details)}` })
    const bad = (method) => [{ method, amount_usd: 4.71, amount_khr: 150 }]
    const good = (method) => [{ method, amount_usd: 4.5, amount_khr: 1000 }]

    // ---- A. POS checkout (POST /api/sales) ----------------------------------------------------------------------------
    const salesBefore = await count('sales')
    const a1 = await sale(bad('Cash'))
    const salesAfterRefusal = await count('sales')
    const a2 = await sale(good('Cash'))
    const a3 = await sale(bad('ABA'))
    r.check('A1 checkout: a 150 riel cash row is refused and no sale is written', () => { refused(a1); assert.equal(salesAfterRefusal, salesBefore) })
    const a2Row = a2.body.id ? await h.one('SELECT sale_status, total_usd, amount_paid_khr FROM sales WHERE id=?', a2.body.id) : {}
    r.check('A2 checkout: a $4.50 + 1,000 riel cash row is accepted and Completed', () => { ok(a2); assert.deepEqual([a2Row.sale_status, a2Row.total_usd, a2Row.amount_paid_khr], ['completed', 4.75, 1000]) })
    const a3Row = a3.body.id ? await h.one('SELECT sale_status, amount_paid_khr FROM sales WHERE id=?', a3.body.id) : {}
    r.check('A3 checkout: a 150 riel row on the ABA method is accepted and keeps its 150 riel', () => { ok(a3); assert.deepEqual([a3Row.sale_status, a3Row.amount_paid_khr], ['completed', 150]) })
    const a4 = await sale([{ method: 'Cash', amount_usd: 0, amount_khr: 18950 }, { method: 'ABA', amount_usd: 0.01, amount_khr: 0 }])
    r.check('A4 checkout: a cash row of 18,950 riel beside a bank row is refused on the cash row', () => { refused(a4); assert.equal(a4.body.row, 0) })
    const a5 = await sale(null, 'completed', { payment_method: 'Cash', payment_currency: 'MIXED', amount_paid_usd: 4.71, amount_paid_khr: 150 })
    r.check('A5 checkout: the single-row form (no payment_details, Cash method, 150 riel) is refused too', () => refused(a5))
    // Riel change is handed back in notes: $5 + 1,300 riel overpays $4.75 by 2,300 riel; the till keeps under 100.
    const changeSale = (khr) => H.createSale(h, { key: key('change'), lines: [{ productId: nextProduct(), quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 1300 }], extra: { change_is_actual: true, change_usd: 0, change_khr: khr }, label: `change ${khr}` })
    const a6 = await changeSale(2250)
    const a7 = await changeSale(2300)
    r.check('A6 checkout: an actual riel change of 2,250 is refused', () => refused(a6))
    r.check('A7 checkout: an actual riel change of 2,300 is accepted', () => ok(a7))

    // ---- B. settle a Not Paid sale (PATCH /:id/status) ----------------------------------------------------------------
    const settle = (id, details, extra = {}) => h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: key('settle'),
      expected_exchange_rate: 4000, payment_details: details, ...extra }, `settle ${id} ${JSON.stringify(details)}`)
    const unpaidId = async () => { const res = await sale(null, 'awaiting_payment'); ok(res); return Number(res.body.id) }
    const b = [await unpaidId(), await unpaidId(), await unpaidId()]
    const b1 = await settle(b[0], bad('Cash'))
    const b1Row = await h.one('SELECT sale_status, amount_paid_khr FROM sales WHERE id=?', b[0])
    const b2 = await settle(b[1], good('Cash'))
    const b3 = await settle(b[2], bad('ABA'))
    r.check('B1 settle: a 150 riel cash row is refused and the sale stays Not Paid with nothing paid', () => {
      refused(b1); assert.deepEqual([b1Row.sale_status, b1Row.amount_paid_khr], ['awaiting_payment', 0])
    })
    r.check('B2 settle: a $4.50 + 1,000 riel cash row is accepted', () => ok(b2))
    r.check('B3 settle: a 150 riel row on ABA is accepted', () => ok(b3))

    // ---- C. payment correction (reopen, then replace the tender) ------------------------------------------------------
    const corrected = async (details) => {
      const paid = await sale([{ method: 'ABA', amount_usd: 4.75, amount_khr: 0 }])
      ok(paid)
      const id = Number(paid.body.id)
      ok(await h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'awaiting_payment', client_request_id: key('reopen') }, `reopen ${id}`))
      return { id, res: await settle(id, details, { replace_existing_payment: true }) }
    }
    const c1 = await corrected(bad('Cash'))
    const c1Row = await h.one('SELECT payment_details FROM sales WHERE id=?', c1.id)
    const c2 = await corrected(good('Cash'))
    const c3 = await corrected(bad('ABA'))
    r.check('C1 correction: a 150 riel cash row is refused and the stored tender is untouched', () => {
      refused(c1.res); assert.match(String(c1Row.payment_details), /"ABA"/); assert.doesNotMatch(String(c1Row.payment_details), /"Cash"/)
    })
    r.check('C2 correction: a $4.50 + 1,000 riel cash row is accepted', () => ok(c2.res))
    r.check('C3 correction: a 150 riel row on ABA is accepted', () => ok(c3.res))

    // ---- D. exchange: the customer pays the difference ($4.75) --------------------------------------------------------
    const exchange = async (details) => {
      const original = await sale([{ method: 'Cash', amount_usd: 4.75, amount_khr: 0 }])
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
    const d1 = await exchange(bad('Cash'))
    const d2 = await exchange(good('Cash'))
    const d3 = await exchange(bad('ABA'))
    r.check('D1 exchange: a 150 riel cash top-up row is refused and no return is written', () => { refused(d1.res); assert.equal(d1.written, 0) })
    r.check('D2 exchange: a $4.50 + 1,000 riel cash top-up is accepted', () => ok(d2.res))
    r.check('D3 exchange: a 150 riel top-up on ABA is accepted', () => ok(d3.res))

    // ---- E. expenses paid out of the drawer (POST and PUT /api/fees) --------------------------------------------------
    const fee = (khr) => h.call('POST', '/api/fees', { client_request_id: key('fee'), fee_type: 'expense', label: 'RIEL fee', amount_usd: 0, amount_khr: khr,
      fee_date: '2026-11-04', branch_id: 1 }, `expense ${khr}`)
    const feesBefore = await count('fees')
    const e1 = await fee(150)
    const feesAfterRefusal = await count('fees')
    const e2 = await fee(100)
    r.check('E1 expense: 150 riel is refused and no expense is written', () => { refused(e1); assert.equal(feesAfterRefusal, feesBefore) })
    r.check('E2 expense: 100 riel is accepted', () => ok(e2))
    // A legacy expense stored before the rule keeps its riel through an edit of another field, and only a changed riel is asked.
    const legacyFee = Number(e2.body.id ?? e2.body.fee?.id)
    await h.db.prepare('UPDATE fees SET amount_khr=19950 WHERE id=?').bind(legacyFee).run()
    const feeRow = async () => h.one('SELECT label, amount_khr, updated_at FROM fees WHERE id=?', legacyFee)
    const feeBefore = await feeRow()
    const e3 = await h.call('PUT', `/api/fees/${legacyFee}`, { label: 'RIEL fee renamed', expected_updated_at: feeBefore.updated_at }, 'edit legacy expense label')
    const afterLabel = await feeRow()
    const e4 = await h.call('PUT', `/api/fees/${legacyFee}`, { amount_khr: 12350, expected_updated_at: afterLabel.updated_at }, 'edit legacy expense riel')
    r.check('E3 expense: a legacy 19,950 riel expense can still be renamed and keeps its riel', () => { ok(e3); assert.deepEqual([afterLabel.label, afterLabel.amount_khr], ['RIEL fee renamed', 19950]) })
    r.check('E4 expense: changing its riel to 12,350 is refused', () => refused(e4))

    // ---- F. cancel with a lost fee (PATCH /:id/status cancelled, and the group action) --------------------------------
    const cancelled = async (khr) => {
      const res = await sale(good('Cash')); ok(res)
      return h.call('PATCH', `/api/sales/${res.body.id}/status`, { sale_status: 'cancelled', cancel_reason: 'mistake', cancel_fee_usd: 0, cancel_fee_khr: khr,
        client_request_id: key('cancel') }, `cancel with lost fee ${khr}`)
    }
    const f1 = await cancelled(150)
    const f2 = await cancelled(100)
    r.check('F1 cancel: a 150 riel lost fee is refused', () => refused(f1))
    r.check('F2 cancel: a 100 riel lost fee is accepted', () => ok(f2))
    const groupCancel = async (khr) => {
      const res = await sale(good('Cash')); ok(res)
      const row = await h.one('SELECT id, sale_status, updated_at FROM sales WHERE id=?', res.body.id)
      const out = await h.call('POST', '/api/sales/bulk-status', { client_request_id: key('group-cancel'), target_status: 'cancelled',
        items: [{ id: row.id, expected_status: row.sale_status, expected_updated_at: row.updated_at, cancel: { reason: 'mistake', fee_khr: khr } }] }, `group cancel lost fee ${khr}`)
      return { out, status: (await h.one('SELECT sale_status FROM sales WHERE id=?', row.id)).sale_status }
    }
    const f3 = await groupCancel(150)
    const f4 = await groupCancel(100)
    r.check('F3 group cancel: a 150 riel lost fee is refused and the sale is not cancelled', () => { refused(f3.out); assert.notEqual(f3.status, 'cancelled') })
    r.check('F4 group cancel: a 100 riel lost fee is accepted', () => { ok(f4.out); assert.equal(f4.status, 'cancelled') })

    // ---- G. group relabel of the payment method (POST /api/sales/bulk-update) -----------------------------------------
    const relabel = async (details) => {
      const res = await sale(details); ok(res)
      const row = await h.one('SELECT id, updated_at FROM sales WHERE id=?', res.body.id)
      const out = await h.call('POST', '/api/sales/bulk-update', { client_request_id: key('relabel'), items: [{ id: row.id, expected_updated_at: row.updated_at }],
        action: { kind: 'payment_method', source: 'ABA', target: 'Cash' } }, `relabel ABA ${JSON.stringify(details)} as Cash`)
      return { out, method: (await h.one('SELECT payment_method FROM sales WHERE id=?', row.id)).payment_method }
    }
    const g1 = await relabel(bad('ABA'))
    const g2 = await relabel(good('ABA'))
    r.check('G1 relabel: ABA 150 riel cannot become Cash, and the method is unchanged', () => { refused(g1.out); assert.equal(g1.method, 'ABA') })
    r.check('G2 relabel: ABA 1,000 riel can become Cash', () => { ok(g2.out); assert.equal(g2.method, 'Cash') })

    // ---- H. shift float and counts (POST /open, POST /:id/close, PATCH /:id) ------------------------------------------
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const shiftsBefore = await count('shift_sessions')
    const h1 = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 150 }, 'open with a 150 riel float')
    const shiftsAfterRefusal = await count('shift_sessions')
    const h2 = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 100 }, 'open with a 100 riel float')
    r.check('H1 shift open: a 150 riel float is refused and no shift is opened', () => { refused(h1); assert.equal(shiftsAfterRefusal, shiftsBefore) })
    r.check('H2 shift open: a 100 riel float is accepted', () => ok(h2))
    const shiftId = Number(h2.body.shift?.id)
    const revision = async () => Number((await h.one('SELECT revision FROM shift_sessions WHERE id=?', shiftId)).revision)
    const close = async (khr, extra = {}) => h.call('POST', `/api/shifts/${shiftId}/close`, { expected_revision: await revision(), closing_counted_usd: 0, closing_counted_khr: khr, ...extra },
      `close counting ${khr} riel`)
    const h3 = await close(150)
    const h4 = await close(100, { additional_cash_khr: 50 })
    r.check('H3 shift close: a 150 riel count is refused', () => refused(h3))
    r.check('H4 shift close: additional cash of 50 riel is refused as well', () => refused(h4))
    const h5 = await close(100)
    r.check('H5 shift close: a 100 riel count is accepted', () => ok(h5))
    // A count stored before the rule: an amend of the note keeps it; changing it to 12,350 riel is refused.
    await h.db.prepare('UPDATE shift_sessions SET closing_counted_khr=19950 WHERE id=?').bind(shiftId).run()
    const h6 = await h.call('PATCH', `/api/shifts/${shiftId}`, { expected_revision: await revision(), reason: 'RIEL note', closing_note: 'counted again',
      closing_counted_khr: 19950 }, 'amend note of a legacy count')
    const h7 = await h.call('PATCH', `/api/shifts/${shiftId}`, { expected_revision: await revision(), reason: 'RIEL count', closing_counted_khr: 12350 }, 'amend count to 12,350')
    const counted = (await h.one('SELECT closing_counted_khr FROM shift_sessions WHERE id=?', shiftId)).closing_counted_khr
    r.check('H6 shift amend: a legacy 19,950 riel count survives an amend of the note', () => ok(h6))
    r.check('H7 shift amend: changing the count to 12,350 riel is refused and the count is unchanged', () => { refused(h7); assert.equal(counted, 19950) })

    // ---- I. historical sales import (the real applyHistoricalSaleImport writer) ---------------------------------------
    const imported = (rowNumber, method, khr) => h.call('POST', '/__fixture/import-sale', { jobId: 'riel-import', rowNumber, nowIso: '2026-11-04T02:00:00.000Z',
      actor: { id: 901, username: 'al_admin', name: 'AL Admin' },
      data: { branch_id: 1, sale_status: 'completed', receipt_number: `RIEL-${rowNumber}`, created_at: '2026-08-20T03:00:00.000Z', payment_method: method,
        payment_currency: 'KHR', exchange_rate: 4000, subtotal_usd: 4.75, total_usd: 4.75, amount_paid_usd: 0, amount_paid_khr: khr,
        items: [{ product_id: 660, product_name: 'RIEL item 660', quantity: 1, applied_price_usd: 4.75, total_usd: 4.75, returned_quantity: 0, cost_price_usd: 1, branch_id: 1 }] } },
      `import ${method} ${khr}`)
    const i1 = await imported(1, 'Cash', 19050)
    const i2 = await imported(2, 'Cash', 19000)
    const i3 = await imported(3, 'ABA', 19050)
    r.check('I1 import: a Cash sale paid 19,050 riel is refused', () => { assert.equal(i1.status, 409); assert.match(String(i1.body.error), /whole 100 riel/) })
    r.check('I2 import: a Cash sale paid 19,000 riel is accepted', () => ok(i2))
    r.check('I3 import: an ABA sale paid 19,050 riel is accepted', () => ok(i3))

    // ---- J. a legacy cash row is kept: a settle that repeats it and adds a bank row is not asked about it --------------
    const legacy = await sale(null, 'awaiting_payment'); ok(legacy)
    const legacyId = Number(legacy.body.id)
    await h.db.prepare("UPDATE sales SET payment_method='Cash', payment_details='[{\"method\":\"Cash\",\"amount_usd\":0,\"amount_khr\":9950}]', amount_paid_khr=9950 WHERE id=?")
      .bind(legacyId).run()
    const legacyRow = { method: 'Cash', amount_usd: 0, amount_khr: 9950 }
    const j1 = await settle(legacyId, [legacyRow, { method: 'Cash', amount_usd: 0, amount_khr: 9150 }])
    const j2 = await settle(legacyId, [legacyRow, { method: 'ABA', amount_usd: 2.27, amount_khr: 0 }])
    r.check('J1 legacy: a settle that repeats the stored 9,950 riel cash row but adds a new 9,150 riel CASH row is refused on the new row', () => refused(j1))
    r.check('J2 legacy: the same stored 9,950 riel cash row, repeated beside a new ABA row, is kept and the sale is Completed', () => {
      ok(j2); assert.match(String(j2.body.payment_details), /9950/)
    })

    // ---- K. the shop's own kind map is honoured: a method pinned as cash is cash ---------------------------------------
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_method_kinds','{\"ABA\":\"cash\"}') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const k1 = await sale(bad('ABA'))
    await h.db.prepare("DELETE FROM settings WHERE key='pos_payment_method_kinds'").run()
    r.check('K1 kinds: with ABA pinned as cash in pos_payment_method_kinds, 150 riel by ABA is refused', () => refused(k1))
  } finally {
    await h.mf.dispose()
  }

  const failures = r.results.filter((result) => !result.ok)
  if (mutation) {
    const mustFail = r.results.filter((result) => /refused/.test(result.name) && !/accepted|survives|still|is kept/.test(result.name))
    const survived = mustFail.filter((result) => result.ok)
    console.log(`MUTANT ${mutation}: ${mustFail.length - survived.length}/${mustFail.length} refusal checks red`)
    if (survived.length) { console.log(`MUTANT SURVIVED on: ${survived.map((s) => s.name).join(' | ')}`); process.exit(1) }
    process.exit(0)
  }
  if (failures.length) { console.log(`RED riel cash hundreds: ${failures.length} of ${r.results.length} checks failed`); process.exit(1) }
  console.log(`GREEN riel cash hundreds: ${r.results.length}/${r.results.length} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
