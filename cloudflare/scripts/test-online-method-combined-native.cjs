'use strict'
// KHQR round 10: "an ordinary sale never carries the online-order method as ANY of its components" -- a label the system itself splits ("Cash + ABA", "Cash+ABA") names the
// method it contains -- plus the settle / relabel / exchange races and the settlement redo.
//   G1  create, settle, correction, the admin list save, replace, the bulk relabel, the exchange and the return replacement all judge every component with the one identity;
//       the sale fold registers methods, never a combined label.
//   G3  a settlement REDO cannot put the online method on an ordinary sale after an administrator stored it (settle "Truemoney", undo, store "Truemoney", redo).
//   G4  the in-use guard sees a non-ASCII case twin ("épay" for "ÉPay") and a combined label ("Cash + Bakong") carried by an ordinary sale.
//   G5  settle, bulk relabel and exchange cannot commit the method an administrator stores AFTER the request read it, at ZERO extra D1 calls (one statement in the batch).
//   G6  a Khmer-named sale does not conflict while the stored method moves between two ASCII names.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-combined
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const U = (...codes) => String.fromCharCode(...codes)
const hook = (name, file, from, key) => ({
  name, file, from,
  to: `    { const __h = await db.prepare("SELECT value FROM settings WHERE key = 'race_hook_${key}'").get<{ value: string }>(); if (__h && __h.value) await db.batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }\n${from}`,
})
const RACE_SETTLE = hook('race-settle', 'src/routes/sales.ts', '    const before = await readSaleSettlementState(db, Number(id))', 'settle')
const RACE_SALE = {
  name: 'race-sale', file: 'src/routes/sales.ts',
  from: '    if (!wantsOrder) {\n      const saleOnlineGuard',
  to: '    { const __h = await db.prepare("SELECT value FROM settings WHERE key = \'race_hook_sale\'").get<{ value: string }>(); if (__h && __h.value) await db.batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }\n    if (!wantsOrder) {\n      const saleOnlineGuard',
}
const RACE_BULK = hook('race-bulk', 'src/lib/saleBulkUpdate.ts', '  const operationId = crypto.randomUUID()', 'bulk')
const RACE_EXCHANGE = hook('race-exchange', 'src/lib/returnExchangeCreate.ts', '  // ---- admission: a plan this invocation cannot carry is refused before it writes anything', 'exchange')

const q = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsert = (key, value) => `INSERT INTO settings(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
const REFUSED = [400, 'online_method_requires_order']
const refusedBody = (r) => [r.status, r.body && r.body.code]
let n = 0

async function seed(h, { list, online }) {
  await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind(JSON.stringify(list)).run()
  if (online === null) await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
  else await h.db.prepare(upsert('online_order_payment_method', online)).run()
}
const helpers = (h) => {
  const notPaid = async () => { n += 1; const m = await H.createSale(h, { key: 'np-' + n, lines: [{ productId: 12, quantity: 2 }], status: 'awaiting_payment', paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }] }); assert.equal(m.status, 200, JSON.stringify(m.body)); return m.body.id }
  const settle = async (id, details, extra = {}) => {
    const row = await h.one('SELECT exchange_rate FROM sales WHERE id = ?', id); n += 1
    return h.call('PATCH', '/api/sales/' + id + '/status', { sale_status: 'completed', payment_details: details, expected_exchange_rate: Number(row.exchange_rate), client_request_id: 'set-' + id + '-' + n, ...extra }, 'settle')
  }
  const moveBack = async (id) => { const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id); n += 1; return h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'awaiting_payment', expected_updated_at: row.updated_at, client_request_id: `back-${id}-${n}` }, 'back') }
  const rec = async (id) => { const r = await h.one('SELECT sale_status, payment_method, payment_details FROM sales WHERE id = ?', id); return JSON.stringify([r.sale_status, r.payment_method, JSON.parse(r.payment_details || '[]').map((d) => d.method)]) }
  const create = (details, status = 'completed') => { n += 1; return H.createSale(h, { key: 'c-' + n, lines: [{ productId: 12, quantity: 2 }], status, paymentDetails: details.map(([method, usd]) => ({ method, amount_usd: usd, amount_khr: 0 })) }) }
  const saleCount = async () => Number((await h.one('SELECT COUNT(*) AS c FROM sales')).c)
  const list = async () => (await h.one("SELECT value FROM settings WHERE key='pos_payment_methods'")).value
  const stored = async () => (await h.one("SELECT value FROM settings WHERE key='online_order_payment_method'"))?.value ?? null
  const hookOn = (key, sqls) => h.db.prepare(upsert('race_hook_' + key, JSON.stringify(sqls))).run()
  const hookOff = (key) => h.db.prepare('DELETE FROM settings WHERE key = ?').bind('race_hook_' + key).run()
  const setM = (value) => upsert('online_order_payment_method', value)
  const exchange = async (payment, extra = {}) => {
    n += 1
    const sale = await H.createSale(h, { key: `ex-sale-${n}`, status: 'completed', lines: [{ productId: 12, quantity: 2 }], paymentDetails: [{ method: 'Cash', amount_usd: 25, amount_khr: 0 }] })
    assert.equal(sale.status, 200, JSON.stringify(sale.body))
    const items = await h.all('SELECT id FROM sale_items WHERE sale_id=? ORDER BY id', sale.body.id)
    const out = [{ branch_id: 1, product_id: 13, quantity: 2 }]
    const lines = [{ sale_item_id: items[0].id, quantity: 1 }]
    const quote = await h.call('POST', '/api/returns/quote', { sale_id: sale.body.id, items: lines, replacement_items: out }, `ex ${n}: quote`)
    assert.equal(quote.status, 200, JSON.stringify(quote.body))
    const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
    return h.call('POST', '/api/returns', { client_request_id: `ex-ret-${n}`, money_precision_version: 1, sale_id: sale.body.id, reason: 'exchange', expected_quote: expected, expected_exchange: quoted,
      exchange_payment: payment, items: lines.map((line) => ({ ...line, stock_action: 'restock', branch_id: 1 })), replacement_items: out, ...extra }, `ex ${n}: create`)
  }
  const returns = async () => Number((await h.one('SELECT COUNT(*) AS c FROM returns')).c)
  return { notPaid, settle, moveBack, rec, create, saleCount, list, stored, hookOn, hookOff, setM, exchange, returns }
}

async function main() {
  const h = await H.startWorker({ patches: [RACE_SETTLE, RACE_SALE, RACE_BULK, RACE_EXCHANGE] })
  const t = helpers(h)
  try {
    await H.seedProduct(h, 12, 'Probe Serum', 12.5, 600, 2)
    await H.seedProduct(h, 13, 'Probe Cream', 10, 600, 2)

    // ---- G1: a combined label names the method it contains ------------------------------------------------------------------------------------------------------
    const LIST = ['Cash', 'ABA', 'Card']
    await seed(h, { list: LIST, online: 'ABA' })
    const COMBINED = ['Cash + ABA', 'ABA + Cash', 'Cash+ABA', 'cash + aba', 'Card +ABA' + U(9), 'Cash + ' + U(0xa0) + 'ABA']
    {
      const before = await t.saleCount(), listBefore = await t.list()
      for (const label of COMBINED) {
        const one = await t.create([[label, 25]])
        assert.deepEqual(refusedBody(one), REFUSED, 'single-row create with ' + JSON.stringify(label) + ': ' + JSON.stringify(one.body))
        const two = await t.create([['Cash', 10], [label, 15]])
        assert.deepEqual(refusedBody(two), REFUSED, 'two-row create with ' + JSON.stringify(label) + ': ' + JSON.stringify(two.body))
      }
      assert.equal(await t.saleCount(), before, 'no refused create left a sale')
      assert.equal(await t.list(), listBefore, 'and no combined label reached the payment-method list (the verifier\'s "Cash + ABA" phantom)')
      const ok = await t.create([['Cash', 10], ['Card', 15]]); assert.equal(ok.status, 200, 'control: two plain methods: ' + JSON.stringify(ok.body))
      const okCombined = await t.create([['Cash + Card', 25]]); assert.equal(okCombined.status, 200, 'control: a combined label that does not contain the online method is not this rule\'s business: ' + JSON.stringify(okCombined.body))
      console.log('PASS G1 create: a combined label that contains the online method is refused (one and two rows), nothing recorded, nothing registered')
    }
    {
      // the legacy list holds the combined labels already (an old save); settle and correction still refuse them
      await seed(h, { list: [...LIST, 'Card + ABA', 'Cash+ABA'], online: 'ABA' })
      for (const label of ['Card + ABA', 'Cash+ABA']) {
        const id = await t.notPaid()
        const r = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: label, amount_usd: 20, amount_khr: 0 }])
        assert.deepEqual(refusedBody(r), REFUSED, 'settle with ' + label + ': ' + JSON.stringify(r.body))
        assert.equal(await t.rec(id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]), 'the sale stays Not Paid')
        const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
        assert.equal((await t.moveBack(made.body.id)).status, 200)
        const fix = await t.settle(made.body.id, [{ method: label, amount_usd: 25, amount_khr: 0 }], { replace_existing_payment: true })
        assert.deepEqual(refusedBody(fix), REFUSED, 'correction with ' + label + ': ' + JSON.stringify(fix.body))
        assert.equal(await t.rec(made.body.id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]))
      }
      const id = await t.notPaid()
      const ctl = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Card', amount_usd: 20, amount_khr: 0 }])
      assert.equal(ctl.status, 200, 'control: another method settles: ' + JSON.stringify(ctl.body))
      console.log('PASS G1 settle and correction: a combined label from the list is refused; another method settles')
    }
    {
      // the admin list save cannot ADD a combined label that contains the method; an old one already stored never traps an unrelated edit
      await seed(h, { list: LIST, online: 'ABA' })
      const refuse = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Card + ABA']) }, 'list adds a combined label')
      assert.deepEqual([refuse.status, refuse.body && refuse.body.code], [400, 'invalid_payment_methods_setting'], JSON.stringify(refuse.body)) // round 11: a '+' never enters a name (the merge refusal behind it stays as defence)
      assert.equal(await t.list(), JSON.stringify(LIST), 'the list is untouched')
      const fine = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Wing']) }, 'list adds Wing')
      assert.equal(fine.status, 200, 'control: another method is added: ' + JSON.stringify(fine.body))
      await seed(h, { list: [...LIST, 'Card + ABA'], online: 'ABA' })
      const stale = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Card + ABA', 'Wing2']) }, 'unrelated edit beside a stale label')
      assert.equal(stale.status, 200, 'control: a combined label the list already held is tolerated: ' + JSON.stringify(stale.body))
      console.log('PASS G1 list save: a new combined label is refused; an old one never traps an unrelated edit')
    }
    {
      await seed(h, { list: LIST, online: 'ABA' })
      for (const scope of ['settings_only', 'linked']) {
        const r = await h.call('POST', '/api/settings/payment-methods/replace', { from: 'Card', to: 'Card + ABA', scope, ...(scope === 'linked' ? { currentPassword: 'al-money-fixture' } : {}) }, 'replace into a combined label ' + scope)
        assert.deepEqual([r.status, r.body && r.body.code], [400, 'invalid_payment_methods_setting'], scope + ': ' + JSON.stringify(r.body)) // round 11: a '+' never enters a name
      }
      assert.equal(await t.list(), JSON.stringify(LIST), 'nothing rewritten')
      console.log('PASS G1 replace: a method cannot be merged into a combined label that contains the online method')
    }
    {
      await seed(h, { list: [...LIST, 'Card + ABA'], online: 'ABA' })
      const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', made.body.id)
      const r = await h.call('POST', '/api/sales/bulk-update', { client_request_id: 'relabel-comb-1', items: [{ id: made.body.id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source: 'Cash', target: 'Card + ABA' } }, 'relabel')
      assert.deepEqual(refusedBody(r), REFUSED, 'bulk relabel to a combined label: ' + JSON.stringify(r.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the sale is untouched')
      console.log('PASS G1 bulk relabel: a combined label that contains the online method is refused')
    }
    {
      await seed(h, { list: [...LIST, 'Cash + ABA'], online: 'ABA' })
      const before = await t.returns()
      for (const label of ['Cash + ABA', 'Cash+ABA']) {
        const r = await t.exchange({ details: [{ method: label, amount_usd: 5, amount_khr: 0 }], change_currency: 'USD' })
        assert.deepEqual([r.status, r.body && r.body.code], [400, 'return_exchange_payment_invalid'], 'exchange paid ' + JSON.stringify(label) + ' (a tender row names ONE method): ' + JSON.stringify(r.body))
        assert.equal(await t.returns(), before, 'nothing recorded')
      }
      const manual = await h.call('POST', '/api/returns', { client_request_id: 'ex-manual-comb', reason: 'manual exchange',
        items: [{ product_id: 12, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
        replacement_items: [{ product_id: 13, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: 'Cash+ABA' }, 'replacement composite')
      assert.deepEqual(refusedBody(manual), REFUSED, 'return replacement paid "Cash+ABA": ' + JSON.stringify(manual.body))
      assert.equal(await t.returns(), before, 'nothing recorded')
      console.log('PASS G1 exchange and return replacement: a combined label is refused (exchange tender rows name one method; the replacement is judged by its components)')
    }
    {
      // the fold registers methods, never a combined label (no phantom): M not stored here, so the sale is allowed
      await seed(h, { list: ['Cash', 'Card'], online: null })
      const r = await t.create([['Card + Wing9', 25]]); assert.equal(r.status, 200, JSON.stringify(r.body))
      await new Promise((resolve) => setTimeout(resolve, 600))
      assert.equal(await t.list(), JSON.stringify(['Cash', 'Card', 'Wing9']), 'the fold added the method "Wing9", not the label "Card + Wing9"')
      console.log('PASS G1 fold: a combined label registers its methods, not itself')
    }

    // ---- G3: the settlement redo --------------------------------------------------------------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Truemoney', 'Card'], online: null })
      const id = await t.notPaid()
      const s = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Truemoney', amount_usd: 20, amount_khr: 0 }])
      assert.equal(s.status, 200, JSON.stringify(s.body))
      const hid = Number(s.body.actionHistoryId)
      const undo = await H.historyStep(h, hid, 'undo', 0, 'undo settle'); assert.equal(undo.status, 200, JSON.stringify(undo.body))
      const afterUndo = await t.rec(id)
      const set = await h.call('POST', '/api/settings', { online_order_payment_method: 'Truemoney' }, 'store Truemoney'); assert.equal(set.status, 200, JSON.stringify(set.body))
      const redo = await H.historyStep(h, hid, 'redo', 1, 'redo settle')
      assert.equal(redo.status, 409, 'the redo would put the online method on an ordinary sale: ' + JSON.stringify(redo.body))
      assert.equal(await t.rec(id), afterUndo, 'the sale is untouched by the refused redo')
      await seed(h, { list: ['Cash', 'Truemoney', 'Card'], online: null })
      const retry = await H.historyStep(h, hid, 'redo', 1, 'redo settle, no method stored')
      assert.equal(retry.status, 200, 'control: with no method stored the same redo is an ordinary one: ' + JSON.stringify(retry.body))
      console.log('PASS G3: a settlement redo cannot put a method stored after the settlement onto an ordinary sale; the same redo works when nothing is reserved')
    }

    {
      // a relabel REDO writes the recorded target again: refused once the target has become the online method
      await seed(h, { list: ['Cash', 'Bakong', 'Card'], online: null })
      const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', made.body.id)
      const relabel = await h.call('POST', '/api/sales/bulk-update', { client_request_id: 'relabel-redo-1', items: [{ id: made.body.id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source: 'Cash', target: 'Bakong' } }, 'relabel')
      assert.equal(relabel.status, 200, JSON.stringify(relabel.body))
      const hid = Number(relabel.body.actionHistoryId)
      const undo = await H.historyStep(h, hid, 'undo', 0, 'undo relabel'); assert.equal(undo.status, 200, JSON.stringify(undo.body))
      const set = await h.call('POST', '/api/settings', { online_order_payment_method: 'Bakong' }, 'store Bakong'); assert.equal(set.status, 200, JSON.stringify(set.body))
      const redo = await H.historyStep(h, hid, 'redo', 1, 'redo relabel')
      assert.equal(redo.status, 409, 'the redo would relabel an ordinary sale onto the online method: ' + JSON.stringify(redo.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the sale is untouched')
      console.log('PASS G3 relabel redo: refused once its target is the online method')
    }

    // ---- G4: the in-use guard ----------------------------------------------------------------------------------------------------------------------------------
    {
      const EC = U(0xc9) + 'Pay', E = U(0xe9) + 'pay'
      await seed(h, { list: ['Cash', EC, 'Card', 'Bakong', 'Wing'], online: null })
      const e = await t.create([[E, 25]]); assert.equal(e.status, 200, JSON.stringify(e.body))
      const r = await h.call('POST', '/api/settings', { online_order_payment_method: EC }, 'store ÉPay over an épay sale')
      assert.deepEqual([r.status, r.body && r.body.code], [409, 'online_method_in_use_by_sales'], JSON.stringify(r.body))
      assert.equal(await t.stored(), null, 'the method was not stored')
      const c = await t.create([['Cash + Bakong', 25]]); assert.equal(c.status, 200, JSON.stringify(c.body))
      const r2 = await h.call('POST', '/api/settings', { online_order_payment_method: 'Bakong' }, 'store Bakong over a Cash + Bakong sale')
      assert.deepEqual([r2.status, r2.body && r2.body.code], [409, 'online_method_in_use_by_sales'], JSON.stringify(r2.body))
      const ctl = await h.call('POST', '/api/settings', { online_order_payment_method: 'Wing' }, 'store Wing')
      assert.equal(ctl.status, 200, 'control: a method no ordinary sale carries is stored: ' + JSON.stringify(ctl.body))
      console.log('PASS G4: the in-use guard sees a non-ASCII case twin and a combined label')
    }

    // ---- G5: the races ------------------------------------------------------------------------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card', 'Wing'], online: null })
      const id = await t.notPaid()
      await t.hookOn('settle', [t.setM('Bakong')])
      const r = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Bakong', amount_usd: 20, amount_khr: 0 }])
      assert.deepEqual(refusedBody(r), REFUSED, 'a settle racing the storing of its method: ' + JSON.stringify(r.body))
      assert.equal(await t.rec(id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]), 'the batch rolled back')
      await t.hookOff('settle')
      await seed(h, { list: ['Cash', 'Bakong', 'Card', 'Wing'], online: null })
      const id2 = await t.notPaid()
      await t.hookOn('settle', [t.setM('Wing')])
      const ctl = await t.settle(id2, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: 'Card', amount_usd: 20, amount_khr: 0 }])
      assert.equal(ctl.status, 200, 'control: the same race with another method does not refuse a settle that does not carry it: ' + JSON.stringify(ctl.body))
      await t.hookOff('settle')
      console.log('PASS G5 settle: the batch pins the method it read (refuses a settle that carries a method stored meanwhile; any other settle commits)')
    }
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card'], online: null })
      const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', made.body.id)
      await t.hookOn('bulk', [t.setM('Bakong')])
      const r = await h.call('POST', '/api/sales/bulk-update', { client_request_id: 'relabel-race-1', items: [{ id: made.body.id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source: 'Cash', target: 'Bakong' } }, 'relabel race')
      assert.equal(r.status, 409, 'a relabel racing the storing of its target: ' + JSON.stringify(r.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the sale is untouched')
      await t.hookOff('bulk')
      console.log('PASS G5 bulk relabel: the batch refuses a target stored as the online method meanwhile')
    }
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card'], online: null })
      const before = await t.returns()
      await t.hookOn('exchange', [t.setM('Bakong')])
      const r = await t.exchange({ details: [{ method: 'Bakong', amount_usd: 10, amount_khr: 0 }], change_currency: 'USD' })
      assert.deepEqual(refusedBody(r), REFUSED, 'an exchange racing the storing of its method: ' + JSON.stringify(r.body))
      assert.equal(await t.returns(), before, 'nothing recorded')
      await t.hookOff('exchange')
      console.log('PASS G5 exchange: the batch refuses a tender stored as the online method meanwhile')
    }

    // ---- G6: no conflict for a Khmer-named sale while the method moves between two ASCII names ---------------------------------------------------------------
    {
      const KH = U(0x179c, 0x17b8, 0x1784)
      await seed(h, { list: ['Cash', 'Bakong', 'ABA', KH, 'Card'], online: 'Bakong' })
      await t.hookOn('sale', [t.setM('ABA')])
      const r = await t.create([[KH, 25]])
      assert.equal(r.status, 200, 'a Khmer-named sale while the method moves between two ASCII names: ' + JSON.stringify(r.body))
      await t.hookOff('sale')
      console.log('PASS G6: the pin only fires for a non-ASCII stored method')
    }
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method combined: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
