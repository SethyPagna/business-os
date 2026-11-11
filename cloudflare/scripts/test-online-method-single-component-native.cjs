'use strict'
// KHQR round 11: a label whose ONLY component is the online method ("ABA+", "+ABA", "ABA +") is the method (the system's one splitter reads it as ["ABA"]), and a '+' never belongs in a stored method NAME.
//   H1  settle, correction, bulk relabel, linked replace, return replacement, the admin list save and the in-use read all refuse it; create judges it in JS too.
//   H5  the online method itself is never a combined label.
//   H2  a bulk relabel UNDO cannot put back a source label that became the online method meanwhile.
//   H3  a settlement UNDO cannot put the online method back on an imported sale (payment_details NULL).
//   H4  the bulk relabel replay (redo and undo) pins the method it read inside its batch.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-single-component
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const hook = (name, file, from, key) => ({
  name, file, from,
  to: `    { const __h = await db.prepare("SELECT value FROM settings WHERE key = 'race_hook_${key}'").get<{ value: string }>(); if (__h && __h.value) await db.batch((JSON.parse(__h.value) as string[]).map((sql) => ({ sql, params: {} }))) }\n${from}`,
})
const RACE_REPLAY = hook('race-replay', 'src/lib/saleBulkUpdate.ts', "  const sign: 1 | -1 = direction === 'undo' ? -1 : 1", 'replay')

const q = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsert = (key, value) => `INSERT INTO settings(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
const REFUSED = [400, 'online_method_requires_order']
const refusedBody = (r) => [r.status, r.body && r.body.code]
const SHAPES = ['ABA+', '+ABA', 'ABA +', ' + ABA', 'aba+']
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
  const rec = async (id) => { const r = await h.one('SELECT sale_status, payment_method, payment_details FROM sales WHERE id = ?', id); return JSON.stringify([r.sale_status, r.payment_method, r.payment_details === null ? null : JSON.parse(r.payment_details).map((d) => d.method)]) }
  const create = (details, status = 'completed') => { n += 1; return H.createSale(h, { key: 'c-' + n, lines: [{ productId: 12, quantity: 2 }], status, paymentDetails: details.map(([method, usd]) => ({ method, amount_usd: usd, amount_khr: 0 })) }) }
  const list = async () => (await h.one("SELECT value FROM settings WHERE key='pos_payment_methods'")).value
  const stored = async () => (await h.one("SELECT value FROM settings WHERE key='online_order_payment_method'"))?.value ?? null
  const hookOn = (key, sqls) => h.db.prepare(upsert('race_hook_' + key, JSON.stringify(sqls))).run()
  const hookOff = (key) => h.db.prepare('DELETE FROM settings WHERE key = ?').bind('race_hook_' + key).run()
  const setM = (value) => upsert('online_order_payment_method', value)
  const returns = async () => Number((await h.one('SELECT COUNT(*) AS c FROM returns')).c)
  const relabel = async (id, source, target) => { const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id); n += 1; return h.call('POST', '/api/sales/bulk-update', { client_request_id: 'relabel-sc-' + n, items: [{ id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source, target } }, 'relabel') }
  return { notPaid, settle, moveBack, rec, create, list, stored, hookOn, hookOff, setM, returns, relabel }
}

async function main() {
  const h = await H.startWorker({ patches: [RACE_REPLAY] })
  const t = helpers(h)
  try {
    await H.seedProduct(h, 12, 'Probe Serum', 12.5, 600, 2)
    await H.seedProduct(h, 13, 'Probe Cream', 10, 600, 2)
    const LIST = ['Cash', 'ABA', 'Card']

    // ---- H1: every writer judges every component -----------------------------------------------------------------------------------------------------------------
    for (const label of SHAPES) {
      await seed(h, { list: [...LIST, label], online: 'ABA' })
      const one = await t.create([[label, 25]])
      assert.deepEqual(refusedBody(one), REFUSED, 'create ' + JSON.stringify(label) + ': ' + JSON.stringify(one.body))
      const id = await t.notPaid()
      const s = await t.settle(id, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }, { method: label, amount_usd: 20, amount_khr: 0 }])
      assert.deepEqual(refusedBody(s), REFUSED, 'settle ' + JSON.stringify(label) + ': ' + JSON.stringify(s.body))
      assert.equal(await t.rec(id), JSON.stringify(['awaiting_payment', 'Cash', ['Cash']]), 'the sale stays Not Paid')
      const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      assert.equal((await t.moveBack(made.body.id)).status, 200)
      const fix = await t.settle(made.body.id, [{ method: label, amount_usd: 25, amount_khr: 0 }], { replace_existing_payment: true })
      assert.deepEqual(refusedBody(fix), REFUSED, 'correction ' + JSON.stringify(label) + ': ' + JSON.stringify(fix.body))
      const done = await t.create([['Cash', 25]]); assert.equal(done.status, 200, JSON.stringify(done.body))
      const rl = await t.relabel(done.body.id, 'Cash', label)
      assert.deepEqual(refusedBody(rl), REFUSED, 'relabel ' + JSON.stringify(label) + ': ' + JSON.stringify(rl.body))
      assert.equal(await t.rec(done.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the relabelled sale is untouched')
      const before = await t.returns()
      n += 1
      const rep = await h.call('POST', '/api/returns', { client_request_id: 'rep-sc-' + n, reason: 'manual exchange',
        items: [{ product_id: 12, quantity: 1, stock_action: 'none', branch_id: 1, applied_price_usd: 10 }],
        replacement_items: [{ product_id: 13, quantity: 1, branch_id: 1, applied_price_usd: 25 }], replacement_payment_method: label }, 'replacement')
      assert.deepEqual(refusedBody(rep), REFUSED, 'return replacement ' + JSON.stringify(label) + ': ' + JSON.stringify(rep.body))
      assert.equal(await t.returns(), before, 'nothing recorded')
    }
    console.log('PASS H1 settle / correction / relabel / return replacement / create refuse a label whose only component is the online method (5 spellings)')

    for (const label of SHAPES) {
      await seed(h, { list: LIST, online: 'ABA' })
      const save = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, label]) }, 'list adds ' + label)
      assert.equal(save.status, 400, 'list save adds ' + JSON.stringify(label) + ': ' + JSON.stringify(save.body))
      assert.equal(await t.list(), JSON.stringify(LIST), 'the list is untouched')
      for (const scope of ['settings_only', 'linked']) {
        const r = await h.call('POST', '/api/settings/payment-methods/replace', { from: 'Card', to: label, scope, ...(scope === 'linked' ? { currentPassword: 'al-money-fixture' } : {}) }, 'replace into ' + label)
        assert.equal(r.status, 400, 'replace Card -> ' + JSON.stringify(label) + ' (' + scope + '): ' + JSON.stringify(r.body))
      }
      assert.equal(await t.list(), JSON.stringify(LIST), 'nothing rewritten')
    }
    // the same refusal with NO online method in force: a '+' never enters a name
    await seed(h, { list: LIST, online: null })
    const plain = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Visa+']) }, 'list adds Visa+ (no method)')
    assert.equal(plain.status, 400, JSON.stringify(plain.body))
    const ok = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Visa']) }, 'list adds Visa')
    assert.equal(ok.status, 200, 'control: a plain name is added: ' + JSON.stringify(ok.body))
    await seed(h, { list: [...LIST, 'Old + Style'], online: null })
    const stale = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify([...LIST, 'Old + Style', 'Wing3']) }, 'unrelated edit beside a stale label')
    assert.equal(stale.status, 200, 'control: a label the list already held never traps an unrelated edit: ' + JSON.stringify(stale.body))
    console.log('PASS H1 list save and linked replace refuse a "+" in a new method name; a stale label is tolerated')

    // in-use: an ordinary sale paid "Bakong+" blocks storing Bakong
    await seed(h, { list: ['Cash', 'Bakong', 'Card'], online: null })
    const inUse = await t.create([['Bakong+', 25]]); assert.equal(inUse.status, 200, JSON.stringify(inUse.body))
    const store = await h.call('POST', '/api/settings', { online_order_payment_method: 'Bakong' }, 'store Bakong over a Bakong+ sale')
    assert.deepEqual([store.status, store.body && store.body.code], [409, 'online_method_in_use_by_sales'], JSON.stringify(store.body))
    assert.equal(await t.stored(), null, 'not stored')
    console.log('PASS H1 in-use: "Bakong+" on an ordinary sale blocks storing Bakong')

    // ---- H5: the online method is never a combined label ---------------------------------------------------------------------------------------------------------
    for (const label of ['Card + ABA', 'ABA+', '+ABA']) {
      await h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind(JSON.stringify(['Cash', 'ABA', label])).run()
      await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
      const r = await h.call('POST', '/api/settings', { online_order_payment_method: label }, 'store M = ' + label)
      assert.deepEqual([r.status, r.body && r.body.code], [400, 'invalid_online_order_payment_method'], 'M = ' + JSON.stringify(label) + ': ' + JSON.stringify(r.body))
      assert.equal(await t.stored(), null, 'not stored')
    }
    console.log('PASS H5: a combined label is refused as the online method')

    // ---- H2: bulk relabel UNDO ------------------------------------------------------------------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Truemoney', 'Card'], online: null })
      const made = await t.create([['Truemoney', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      const rl = await t.relabel(made.body.id, 'Truemoney', 'Cash'); assert.equal(rl.status, 200, JSON.stringify(rl.body))
      const hid = Number(rl.body.actionHistoryId)
      const set = await h.call('POST', '/api/settings', { online_order_payment_method: 'Truemoney' }, 'store Truemoney'); assert.equal(set.status, 200, JSON.stringify(set.body))
      const undo = await H.historyStep(h, hid, 'undo', 0, 'undo relabel')
      assert.equal(undo.status, 409, 'the undo would put the online method back on an ordinary sale: ' + JSON.stringify(undo.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the sale stays Cash')
      await seed(h, { list: ['Cash', 'Truemoney', 'Card'], online: null })
      const ok2 = await H.historyStep(h, hid, 'undo', 0, 'undo relabel, nothing stored')
      assert.equal(ok2.status, 200, 'control: with nothing reserved the same undo works: ' + JSON.stringify(ok2.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Truemoney', ['Truemoney']]))
      console.log('PASS H2: a relabel undo is judged like the relabel')
    }

    // ---- H4: the relabel replay pins the method it read ------------------------------------------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Bakong', 'Card', 'Wing'], online: null })
      const made = await t.create([['Cash', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      const rl = await t.relabel(made.body.id, 'Cash', 'Bakong'); assert.equal(rl.status, 200, JSON.stringify(rl.body))
      const hid = Number(rl.body.actionHistoryId)
      assert.equal((await H.historyStep(h, hid, 'undo', 0, 'undo')).status, 200)
      await t.hookOn('replay', [t.setM('Bakong')])
      const redo = await H.historyStep(h, hid, 'redo', 1, 'redo racing the storing of its target')
      assert.equal(redo.status, 409, 'a redo racing the storing of its target: ' + JSON.stringify(redo.body))
      assert.equal(await t.rec(made.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]), 'the sale stays Cash')
      await t.hookOff('replay')
      await seed(h, { list: ['Cash', 'Bakong', 'Card', 'Wing'], online: null })
      await t.hookOn('replay', [t.setM('Wing')])
      const ctl = await H.historyStep(h, hid, 'redo', 1, 'redo while another method is stored')
      assert.equal(ctl.status, 200, 'control: the same race with another method does not refuse: ' + JSON.stringify(ctl.body))
      await t.hookOff('replay')
      // undo race
      await seed(h, { list: ['Cash', 'Truemoney', 'Card'], online: null })
      const t2 = await t.create([['Truemoney', 25]]); assert.equal(t2.status, 200, JSON.stringify(t2.body))
      const r2 = await t.relabel(t2.body.id, 'Truemoney', 'Cash'); assert.equal(r2.status, 200, JSON.stringify(r2.body))
      await t.hookOn('replay', [t.setM('Truemoney')])
      const undo = await H.historyStep(h, Number(r2.body.actionHistoryId), 'undo', 0, 'undo racing')
      assert.equal(undo.status, 409, 'an undo racing the storing of its source label: ' + JSON.stringify(undo.body))
      assert.equal(await t.rec(t2.body.id), JSON.stringify(['completed', 'Cash', ['Cash']]))
      await t.hookOff('replay')
      console.log('PASS H4: the relabel replay (redo and undo) pins the method it read inside its batch')
    }

    // ---- H3: settlement undo of an imported sale (payment_details NULL) --------------------------------------------------------------------------------------------
    {
      await seed(h, { list: ['Cash', 'Wing', 'Card'], online: null })
      const made = await t.create([['Wing', 25]]); assert.equal(made.status, 200, JSON.stringify(made.body))
      await h.db.prepare('UPDATE sales SET payment_details = NULL WHERE id = ?').bind(made.body.id).run()
      assert.equal((await t.moveBack(made.body.id)).status, 200)
      const fix = await t.settle(made.body.id, [{ method: 'Cash', amount_usd: 25, amount_khr: 0 }], { replace_existing_payment: true })
      assert.equal(fix.status, 200, JSON.stringify(fix.body))
      const hid = Number(fix.body.actionHistoryId)
      const set = await h.call('POST', '/api/settings', { online_order_payment_method: 'Wing' }, 'store Wing'); assert.equal(set.status, 200, JSON.stringify(set.body))
      const afterFix = await t.rec(made.body.id)
      const undo = await H.historyStep(h, hid, 'undo', 0, 'undo correction of an imported sale')
      assert.equal(undo.status, 409, 'the undo would put the online method back on an imported sale: ' + JSON.stringify(undo.body))
      assert.equal(await t.rec(made.body.id), afterFix, 'the sale is untouched')
      await h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run()
      const ok3 = await H.historyStep(h, hid, 'undo', 0, 'undo, nothing stored')
      assert.equal(ok3.status, 200, 'control: with nothing reserved the same undo works: ' + JSON.stringify(ok3.body))
      console.log('PASS H3: a settlement undo cannot put the online method back on a sale with no payment_details')
    }
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method single component: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
