'use strict'
// KHQR round 12:
//   J1  a bulk relabel UNDO/REDO refuses a member only when the state being written names the online method M and the member's CURRENT state does not ("never add"), so a sale that
//       already carried M can still be relabelled back; the H2/H4 cases (a replay that ADDS M) stay refused.
//   J2  the list-save '+' tolerance compares against the stored RAW entries read leniently, so a list the strict reader refuses (case twins) can still be saved de-duplicated while it
//       keeps a legacy "Cash + Wing"; a newly typed '+' entry stays refused.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-round12
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const q = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsert = (key, value) => `INSERT INTO settings(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
let n = 0

async function main() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 12, 'Probe Serum', 12.5, 600, 2)
    const setList = (raw) => h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind(raw).run()
    const setM = (m) => m === null ? h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run() : h.db.prepare(upsert('online_order_payment_method', m)).run()
    const create = (details) => { n += 1; return H.createSale(h, { key: 'r12-' + n, lines: [{ productId: 12, quantity: 2 }], status: 'completed', paymentDetails: details.map(([method, usd]) => ({ method, amount_usd: usd, amount_khr: 0 })) }) }
    const rec = async (id) => { const r = await h.one('SELECT payment_method, payment_details FROM sales WHERE id = ?', id); return JSON.stringify([r.payment_method, JSON.parse(r.payment_details).map((d) => d.method)]) }
    const relabel = async (id, source, target) => { const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id); n += 1; return h.call('POST', '/api/sales/bulk-update', { client_request_id: 'r12-relabel-' + n, items: [{ id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source, target } }, 'relabel') }

    // ---- J1 ---------------------------------------------------------------------------------------------------------------------------------------------------
    await setList(JSON.stringify(['Cash', 'KHQR', 'Card'])); await setM(null)
    const made = await create([['Cash', 5], ['KHQR', 20]]); assert.equal(made.status, 200, JSON.stringify(made.body))
    const before = await rec(made.body.id)
    const rl = await relabel(made.body.id, 'Cash', 'Card'); assert.equal(rl.status, 200, JSON.stringify(rl.body))
    const hid = Number(rl.body.actionHistoryId)
    const relabelled = await rec(made.body.id)
    assert.notEqual(relabelled, before)
    await setM('KHQR') // stored directly: the in-use guard would refuse the administrator's own save
    const undo = await H.historyStep(h, hid, 'undo', 0, 'undo relabel of a sale that already carries M')
    assert.equal(undo.status, 200, 'J1 undo restates M the sale already carries: ' + JSON.stringify(undo.body))
    assert.equal(await rec(made.body.id), before)
    const redo = await H.historyStep(h, hid, 'redo', 1, 'redo of the same relabel')
    assert.equal(redo.status, 200, 'J1 redo likewise: ' + JSON.stringify(redo.body))
    assert.equal(await rec(made.body.id), relabelled)
    console.log('PASS J1: a relabel of a sale that already carried the online method can be undone and redone')

    // controls: a replay that ADDS M is still refused (H2 undo, redo into M)
    await setList(JSON.stringify(['Cash', 'Truemoney', 'Card'])); await setM(null)
    const t1 = await create([['Truemoney', 25]]); assert.equal(t1.status, 200, JSON.stringify(t1.body))
    const r1 = await relabel(t1.body.id, 'Truemoney', 'Cash'); assert.equal(r1.status, 200, JSON.stringify(r1.body))
    await setM('Truemoney')
    const u1 = await H.historyStep(h, Number(r1.body.actionHistoryId), 'undo', 0, 'undo adds M')
    assert.equal(u1.status, 409, 'control H2: ' + JSON.stringify(u1.body))
    assert.equal(await rec(t1.body.id), JSON.stringify(['Cash', ['Cash']]))
    await setM(null)
    const t2 = await create([['Cash', 25]]); assert.equal(t2.status, 200, JSON.stringify(t2.body))
    const r2 = await relabel(t2.body.id, 'Cash', 'Truemoney'); assert.equal(r2.status, 200, JSON.stringify(r2.body))
    const hid2 = Number(r2.body.actionHistoryId)
    assert.equal((await H.historyStep(h, hid2, 'undo', 0, 'undo')).status, 200)
    await setM('Truemoney')
    const rd = await H.historyStep(h, hid2, 'redo', 1, 'redo into M')
    assert.equal(rd.status, 409, 'control H4: ' + JSON.stringify(rd.body))
    assert.equal(await rec(t2.body.id), JSON.stringify(['Cash', ['Cash']]))
    console.log('PASS J1 controls: a replay that adds the online method stays refused')

    // ---- J2 ---------------------------------------------------------------------------------------------------------------------------------------------------
    await setM(null)
    await setList(JSON.stringify(['Cash', 'cash', 'ABA', 'Card', 'Cash + Wing']))
    const dedup = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify(['Cash', 'ABA', 'Card', 'Cash + Wing']) }, 'de-duplicate beside a stored legacy plus entry')
    assert.equal(dedup.status, 200, 'J2: ' + JSON.stringify(dedup.body))
    await setList(JSON.stringify(['Cash', 'cash', 'ABA', 'Card', 'Cash + Wing']))
    const typed = await h.call('POST', '/api/settings', { pos_payment_methods: JSON.stringify(['Cash', 'ABA', 'Card', 'Cash + Wing', 'Wing+']) }, 'a newly typed plus entry')
    assert.equal(typed.status, 400, 'J2 control: ' + JSON.stringify(typed.body))
    assert.equal((await h.one("SELECT value FROM settings WHERE key='pos_payment_methods'")).value, JSON.stringify(['Cash', 'cash', 'ABA', 'Card', 'Cash + Wing']), 'untouched')
    console.log('PASS J2: a list the strict reader refuses can be de-duplicated beside a stored legacy plus entry; a typed plus stays refused')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method round 12: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
