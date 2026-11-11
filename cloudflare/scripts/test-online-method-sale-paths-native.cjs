'use strict'
// KHQR round 9: "an ordinary sale may never carry the online-order method in any spelling the system treats as the same method", on every path that puts a payment method on a sale.
//   F3  create, settle and correction refuse "ABA\t", "ABA ", "\nABA", "ABA　" and the non-ASCII case twin ("épay" for "ÉPay"): the refusal compares the identity the
//       settlement planner resolves a typed name with (lib/onlineMethodInvariant.ts namesOnlineMethod), not an untrimmed ASCII fold.
//   F1  with online ordering ON and no stored method, the default ("ABA KHQR") is the method in force: the sale refusal AND the merge into it are refused.
//   F4  the historical sales import refuses a row that carries the method (the real applyHistoricalSaleImport writer).
//   F5  a sale that commits while another request stores the method after the sale was priced still cannot carry it (in-batch guard), at ZERO extra D1 calls
//       (test-plain-sale-d1-cost-native pins the calls).
//   F6  the sale fold's compare-and-set, behaviourally: a list change between its read and its write is never written over, and the fold only appends.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-sale-paths
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const U = (...codes) => String.fromCharCode(...codes)
let n = 0
const RACE_SALE = {
  name: 'race-sale', file: 'src/routes/sales.ts',
  from: '    if (!wantsOrder) {\n      const saleOnlineGuard',
  to: '    { const __h = await db.prepare("SELECT value FROM settings WHERE key = \'race_hook_sale\'").get<{ value: string }>(); if (__h && __h.value) await db.batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }\n    if (!wantsOrder) {\n      const saleOnlineGuard',
}
const RACE_FOLD = {
  name: 'race-fold', file: 'src/routes/sales.ts',
  from: '    const written = await runOrdinaryBusinessWrite(db,',
  to: '    { const __h = await db.prepare("SELECT value FROM settings WHERE key = \'race_hook_fold\'").get<{ value: string }>(); if (__h && __h.value) await db.batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }\n    const written = await runOrdinaryBusinessWrite(db,',
}
const q = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsert = (key, value) => `INSERT INTO settings(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`

async function seed(h, { list, online, switchOn = false }) {
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind(JSON.stringify(list)).run()
  if (online === null) await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
  else await h.db.prepare(upsert('online_order_payment_method', online)).run()
  if (switchOn) await h.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: { online_orders: 'on' } })).run()
}
const helpers = (h) => {
  const notPaid = async () => { n += 1; const m = await H.createSale(h, { key: 'np-' + n, lines: [{ productId: 12, quantity: 2 }], status: 'awaiting_payment', paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }] }); assert.equal(m.status, 200, JSON.stringify(m.body)); return m.body.id }
  const settle = async (id, details, extra = {}) => {
    const row = await h.one('SELECT exchange_rate FROM sales WHERE id = ?', id); n += 1
    return h.call('PATCH', '/api/sales/' + id + '/status', { sale_status: 'completed', payment_details: details, expected_exchange_rate: Number(row.exchange_rate), client_request_id: 'set-' + id + '-' + n, ...extra }, 'settle')
  }
  const moveBack = async (id) => { const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id); n += 1; return h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'awaiting_payment', expected_updated_at: row.updated_at, client_request_id: `back-${id}-${n}` }, 'back') }
  const rec = async (id) => { const r = await h.one('SELECT sale_status, payment_method, payment_details FROM sales WHERE id = ?', id); return JSON.stringify([r.sale_status, r.payment_method, JSON.parse(r.payment_details || '[]').map((d) => d.method)]) }
  const create = (method, label) => { n += 1; return H.createSale(h, { key: 'c-' + n, lines: [{ productId: 12, quantity: 2 }], status: 'completed', paymentDetails: [{ method, amount_usd: 25, amount_khr: 0 }], label }) }
  const saleCount = async () => Number((await h.one('SELECT COUNT(*) AS c FROM sales')).c)
  const list = async () => (await h.one("SELECT value FROM settings WHERE key='pos_payment_methods'")).value
  return { notPaid, settle, moveBack, rec, create, saleCount, list }
}
const refusedBody = (r) => [r.status, r.body && r.body.code]
const REFUSED = [400, 'online_method_requires_order']

async function main() {
  // ---- world 1: M stored. Settle, create, correction, imports and the two races. -------------------------------------------------------------------------------
  const h = await H.startWorker({ patches: [RACE_SALE, RACE_FOLD] })
  const t = helpers(h)
  try {
    await H.seedProduct(h, 12, 'Probe Serum', 12.5, 400, 2)
    const VARIANTS = [['"ABA"', 'ABA'], ['"aba"', 'aba'], ['"ABA"+TAB', 'ABA' + U(9)], ['"ABA"+NBSP', 'ABA' + U(0xa0)], ['LF+"ABA"', U(10) + 'ABA'], ['"ABA"+IDEOGRAPHIC SPACE', 'ABA' + U(0x3000)], ['NBSP+"ABA"+TAB', U(0xa0) + 'ABA' + U(9)]]

    await seed(h, { list: ['Cash', 'ABA', 'Card'], online: 'ABA' })
    for (const [label, method] of VARIANTS) {
      const id = await t.notPaid()
      const r = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method, amount_usd: 20, amount_khr: 0 }])
      assert.deepEqual(refusedBody(r), REFUSED, 'settle with ' + label + ': ' + JSON.stringify(r.body))
      assert.equal(await t.rec(id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]), 'the sale stays Not Paid with nothing added (' + label + ')')
    }
    console.log('PASS settle: every spelling of the online method is refused and nothing is recorded')

    const before = await t.saleCount()
    for (const [label, method] of VARIANTS) {
      const r = await t.create(method)
      assert.deepEqual(refusedBody(r), REFUSED, 'create with ' + label + ': ' + JSON.stringify(r.body))
    }
    assert.equal(await t.saleCount(), before, 'no refused create left a sale')
    console.log('PASS create: every spelling of the online method is refused')

    // correction: a completed sale moved back to Not Paid, then a settlement that REPLACES the recorded payment.
    for (const [label, method] of VARIANTS) {
      const made = await t.create('Cash'); assert.equal(made.status, 200, JSON.stringify(made.body))
      const back = await t.moveBack(made.body.id); assert.equal(back.status, 200, JSON.stringify(back.body))
      const r = await t.settle(made.body.id, [{ method, amount_usd: 25, amount_khr: 0 }], { replace_existing_payment: true })
      assert.deepEqual(refusedBody(r), REFUSED, 'correction with ' + label + ': ' + JSON.stringify(r.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]), 'the corrected sale is untouched (' + label + ')')
    }
    console.log('PASS correction (replace_existing_payment): every spelling is refused')

    {
      const id = await t.notPaid()
      const ok = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Card ', amount_usd: 20, amount_khr: 0 }])
      assert.equal(ok.status, 200, 'control: another method settles: ' + JSON.stringify(ok.body))
      assert.equal((await t.create('Card' + U(0xa0))).status, 200, 'control: another method with the same stray white space is created')
      console.log('PASS controls: another method settles and creates')
    }

    // non-ASCII case twin: stored "ÉPay", request "épay"
    const EC = U(0xc9) + 'Pay', E = U(0xe9) + 'pay'
    await seed(h, { list: ['Cash', EC, 'Card'], online: EC })
    for (const [label, method] of [['"épay"', E], ['"ÉPAY"', U(0xc9) + 'PAY'], ['"épay"+NBSP', E + U(0xa0)]]) {
      const id = await t.notPaid()
      const r = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method, amount_usd: 20, amount_khr: 0 }])
      assert.deepEqual(refusedBody(r), REFUSED, 'settle ' + label + ': ' + JSON.stringify(r.body))
      const c = await t.create(method)
      assert.deepEqual(refusedBody(c), REFUSED, 'create ' + label + ': ' + JSON.stringify(c.body))
    }
    console.log('PASS non-ASCII case twin: settle and create refuse "épay" for "ÉPay"')

    // ---- F5: the race. The hook stores the method between the route's read and its batch. --------------------------------------------------------------------
    await seed(h, { list: ['Cash', 'Bakong', 'Card', EC], online: null })
    const hook = async (name, sqls) => h.db.prepare(upsert('race_hook_' + name, JSON.stringify(sqls))).run()
    const unhook = async (name) => h.db.prepare("DELETE FROM settings WHERE key = ?").bind('race_hook_' + name).run()
    const setM = (value) => upsert('online_order_payment_method', value)
    {
      const rows = await t.saleCount()
      await hook('sale', [setM('Bakong')])
      const r = await t.create('Bakong')
      assert.deepEqual(refusedBody(r), REFUSED, 'a sale paid "Bakong" whose method was stored as the online one AFTER it was priced: ' + JSON.stringify(r.body))
      assert.equal(await t.saleCount(), rows, 'the batch rolled back: no sale, no payment')
      await unhook('sale')
      console.log('PASS F5: a sale racing the storing of the method (ASCII) cannot commit carrying it')
    }
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card', EC], online: null })
      const rows = await t.saleCount()
      await hook('sale', [setM('Bakong')])
      const ctl = await t.create('Card')
      assert.equal(ctl.status, 200, 'control: a sale that does not carry the new method commits through the same race: ' + JSON.stringify(ctl.body))
      assert.equal(await t.saleCount(), rows + 1)
      await unhook('sale')
      console.log('PASS F5 control: the same race does not refuse a sale that carries another method')
    }
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card', EC], online: null })
      const rows = await t.saleCount()
      await hook('sale', [setM(EC)])
      const r = await t.create(E)
      assert.equal(r.status, 409, 'a non-ASCII case twin cannot be judged by the ASCII fold in SQL: the pin aborts it as a retryable conflict: ' + JSON.stringify(r.body))
      assert.equal(r.body.code, 'write_conflict')
      assert.equal(await t.saleCount(), rows, 'nothing recorded')
      await unhook('sale')
      await seed(h, { list: ['Cash', 'Bakong', 'Card', EC], online: null })
      const retry = await t.create(E)
      assert.equal(retry.status, 200, 'control: with no method stored the same sale is an ordinary one: ' + JSON.stringify(retry.body))
      console.log('PASS F5: a non-ASCII twin racing the storing of the method is aborted by the pin (409 write_conflict)')
    }

    // ---- F6/F2: the sale fold is a compare-and-set, behaviourally, and only appends. -------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card'], online: null })
      await hook('fold', [`UPDATE settings SET value = ${q(JSON.stringify(['Cash', 'Bakong', 'Card', 'Renamed By Admin']))} WHERE key = 'pos_payment_methods'`])
      const r = await t.create('Wing New'); assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(await t.list(), JSON.stringify(['Cash', 'Bakong', 'Card', 'Renamed By Admin']), 'a list change between the fold\'s read and write is never written over; only the append is lost')
      await unhook('fold')
      console.log('PASS F6: the sale fold is a compare-and-set (behavioural, not a source pin)')
    }
    {
      const stored = ['épay', 'Cash', 'ÉPay', 'ABA KHQR' + U(0xa0), 'Card', 'aba khqr' + U(0xa0)]
      await seed(h, { list: stored, online: U(0xc9) + 'Pay' })
      const r = await t.create('Wing New'); assert.equal(r.status, 200, JSON.stringify(r.body))
      assert.equal(await t.list(), JSON.stringify([...stored, 'Wing New']), 'append-only: duplicates, case twins and stray white space already stored are kept exactly; the new name is added at the end')
      const inv = require('./harness/load_ts_lib.cjs').loadTsLib('onlineMethodInvariant')
      assert.deepEqual(inv.onlineMethodViolations({ method: U(0xc9) + 'Pay', listRaw: await t.list(), kindsRaw: '' }), [], 'M stays listed after the fold (the verifier\'s F2: it used to become not_listed)')
      console.log('PASS F2: the sale fold only appends')
    }

    // ---- F4: the historical sales import ----------------------------------------------------------------------------------------------------------------------
    await seed(h, { list: ['Cash', 'ABA KHQR', 'Card'], online: 'ABA KHQR' })
    const imported = (rowNumber, method) => h.call('POST', '/__fixture/import-sale', { jobId: 'online-import', rowNumber, nowIso: '2026-11-04T02:00:00.000Z',
      actor: { id: 901, username: 'al_admin', name: 'AL Admin' },
      data: { branch_id: 1, sale_status: 'completed', receipt_number: `ONL-${rowNumber}`, created_at: '2026-08-20T03:00:00.000Z', payment_method: method,
        payment_currency: 'USD', exchange_rate: 4000, subtotal_usd: 12.5, total_usd: 12.5, amount_paid_usd: 12.5, amount_paid_khr: 0,
        items: [{ product_id: 12, product_name: 'Probe Serum', quantity: 1, applied_price_usd: 12.5, total_usd: 12.5, returned_quantity: 0, cost_price_usd: 1, branch_id: 1 }] } }, `import ${rowNumber}`)
    let row = 0
    for (const [label, method] of [['exact', 'ABA KHQR'], ['case', 'aba khqr'], ['TAB', 'ABA KHQR' + U(9)], ['NBSP', 'ABA KHQR' + U(0xa0)], ['split tender', 'Cash + ABA KHQR']]) {
      row += 1
      const r = await imported(row, method)
      assert.equal(r.status, 409, 'import ' + label + ': ' + JSON.stringify(r.body))
      assert.match(String(r.body.error), /only for fulfilling an online order/, label)
      assert.equal(await h.one('SELECT COUNT(*) AS c FROM sales WHERE receipt_number = ?', `ONL-${row}`).then((x) => Number(x.c)), 0, 'nothing written for ' + label)
    }
    row += 1
    const okImport = await imported(row, 'Card')
    assert.equal(okImport.status, 200, 'control: another method imports: ' + JSON.stringify(okImport.body))
    console.log('PASS F4: the historical import refuses a row carrying the online method (409, nothing written) and imports another method')
  } finally { await h.mf.dispose() }

  // ---- world 2: online ordering ON, NO stored method (what a restore or a factory reset can leave): the default is the method in force. ---------------------------
  const g = await H.startWorker({})
  const u = helpers(g)
  try {
    await H.seedProduct(g, 12, 'Probe Serum', 12.5, 100, 2)
    await seed(g, { list: ['Cash', 'ABA KHQR', 'Bakong'], online: null, switchOn: true })
    const cash = await u.create('Cash'); assert.equal(cash.status, 200, JSON.stringify(cash.body))
    for (const method of ['ABA KHQR', 'ABA KHQR' + U(9), 'aba khqr' + U(0xa0)]) {
      assert.deepEqual(refusedBody(await u.create(method)), REFUSED, 'the default is reserved: ' + JSON.stringify(method))
    }
    const np = await u.notPaid()
    assert.deepEqual(refusedBody(await u.settle(np, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'ABA KHQR' + U(0xa0), amount_usd: 20, amount_khr: 0 }])), REFUSED)
    console.log('PASS F1: with the switch ON and nothing stored the default name is refused on create and settle')

    for (const scope of ['linked', 'settings_only']) {
      const stateBefore = JSON.stringify([await u.list(), await u.rec(cash.body.id)])
      const r = await g.call('POST', '/api/settings/payment-methods/replace', { from: 'Cash', to: 'ABA KHQR', scope, ...(scope === 'linked' ? { currentPassword: 'al-money-fixture' } : {}) }, 'replace ' + scope)
      assert.deepEqual([r.status, r.body && r.body.code], [409, 'online_method_merge_refused'], 'merging Cash into the default in force (' + scope + '): ' + JSON.stringify(r.body))
      assert.equal(JSON.stringify([await u.list(), await u.rec(cash.body.id)]), stateBefore, 'nothing rewritten (' + scope + ')')
    }
    const toVariant = await g.call('POST', '/api/settings/payment-methods/replace', { from: 'Cash', to: 'aba khqr', scope: 'settings_only' }, 'replace variant')
    assert.deepEqual([toVariant.status, toVariant.body && toVariant.body.code], [409, 'online_method_merge_refused'], 'a case variant of the default is the same method')
    const away = await g.call('POST', '/api/settings/payment-methods/replace', { from: 'ABA KHQR', to: 'Bakong', scope: 'settings_only' }, 'replace away')
    assert.deepEqual([away.status, away.body && away.body.code], [409, 'online_method_merge_refused'], 'merging the default in force into another method')
    const kinds = await g.call('POST', '/api/settings', { pos_payment_method_kinds: JSON.stringify({ 'ABA KHQR': 'cash' }) }, 'kinds')
    assert.deepEqual([kinds.status, kinds.body && kinds.body.code], [400, 'online_order_method_is_cash'], 'the default in force cannot be made cash-kind: ' + JSON.stringify(kinds.body))
    const unlist = await g.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify(['Cash', 'Bakong']) }, 'unlist')
    assert.deepEqual([unlist.status, unlist.body && unlist.body.code], [400, 'invalid_online_order_payment_method'], 'the default in force cannot be taken off the list: ' + JSON.stringify(unlist.body))
    const fine = await g.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify(['Cash', 'ABA KHQR', 'Bakong', 'Wing']) }, 'unrelated list edit')
    assert.equal(fine.status, 200, 'control: an unrelated list edit still saves: ' + JSON.stringify(fine.body))
    console.log('PASS F1: merges into / out of the default in force, a cash kind and an unlisting are refused; unrelated edits still work')

    // F4 with the default in force
    const dflt = await g.call('POST', '/__fixture/import-sale', { jobId: 'online-import-2', rowNumber: 1, nowIso: '2026-11-04T02:00:00.000Z', actor: { id: 901, username: 'al_admin', name: 'AL Admin' },
      data: { branch_id: 1, sale_status: 'completed', receipt_number: 'ONL-D1', created_at: '2026-08-20T03:00:00.000Z', payment_method: 'ABA KHQR', payment_currency: 'USD', exchange_rate: 4000,
        subtotal_usd: 12.5, total_usd: 12.5, amount_paid_usd: 12.5, amount_paid_khr: 0,
        items: [{ product_id: 12, product_name: 'Probe Serum', quantity: 1, applied_price_usd: 12.5, total_usd: 12.5, returned_quantity: 0, cost_price_usd: 1, branch_id: 1 }] } }, 'import default')
    assert.equal(dflt.status, 409, 'the import refuses the default name while ordering is ON: ' + JSON.stringify(dflt.body))
    console.log('PASS F4: the import refuses the default name while online ordering is ON')
  } finally { await g.mf.dispose() }
}
main().then(() => { console.log('online method sale paths: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
