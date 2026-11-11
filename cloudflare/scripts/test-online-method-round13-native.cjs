'use strict'
// KHQR round 13 (K1/K2/K3): the bulk-relabel replay judges the online method M by AMOUNT per member, in both directions, through replayAddsOnlineTender (the rule the settlement replay uses).
//   K1  KHQR 5 + Cash 20, relabel Cash -> KHQR, undo, store M, REDO: refused (it would turn 20 of Cash into online money).
//   J1  Cash 5 + KHQR 20, store M, relabel Cash -> Card, undo: still allowed (the undo restates M money the sale carries).
//   K2  legacy KHQR 20 + "Card + KHQR" 5, store M, relabel KHQR -> Cash, undo: refused (as the settlement replay does, J4).
//   a sale with no M at all is unaffected.
// Run (from cloudflare/): node scripts/run-native-suite.cjs online-method-round13
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const q = (text) => "'" + String(text).replace(/'/g, "''") + "'"
const upsert = (key, value) => `INSERT INTO settings(key,value) VALUES(${q(key)},${q(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
let n = 0

async function main() {
  const h = await H.startWorker({})
  try {
    await H.seedProduct(h, 12, 'Probe Serum', 12.5, 600, 2)
    const setList = (list) => h.db.prepare("UPDATE settings SET value = ? WHERE key = 'pos_payment_methods'").bind(JSON.stringify(list)).run()
    const setM = (m) => m === null ? h.db.prepare("DELETE FROM settings WHERE key = 'online_order_payment_method'").run() : h.db.prepare(upsert('online_order_payment_method', m)).run()
    const create = (details) => { n += 1; return H.createSale(h, { key: 'r13-' + n, lines: [{ productId: 12, quantity: 2 }], status: 'completed', paymentDetails: details.map(([method, usd]) => ({ method, amount_usd: usd, amount_khr: 0 })) }) }
    const rec = async (id) => { const r = await h.one('SELECT payment_method, payment_details FROM sales WHERE id = ?', id); return JSON.stringify([r.payment_method, JSON.parse(r.payment_details).map((d) => [d.method, d.amount_usd])]) }
    const relabel = async (id, source, target) => { const row = await h.one('SELECT updated_at FROM sales WHERE id = ?', id); n += 1; return h.call('POST', '/api/sales/bulk-update', { client_request_id: 'r13-relabel-' + n, items: [{ id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source, target } }, 'relabel') }
    const ok = (r, label) => { assert.equal(r.status, 200, label + ': ' + JSON.stringify(r.body)); return r }

    // ---- K1 ---------------------------------------------------------------------------------------------------------------------------------------------------
    await setList(['Cash', 'Card', 'KHQR']); await setM(null)
    const a = ok(await create([['KHQR', 5], ['Cash', 20]]), 'K1 create')
    const orig = await rec(a.body.id)
    const rl = ok(await relabel(a.body.id, 'Cash', 'KHQR'), 'K1 relabel (no M stored yet)')
    const hid = Number(rl.body.actionHistoryId)
    ok(await H.historyStep(h, hid, 'undo', 0, 'K1 undo'), 'K1 undo')
    assert.equal(await rec(a.body.id), orig)
    await setM('KHQR')
    const redo = await H.historyStep(h, hid, 'redo', 1, 'K1 redo')
    assert.equal(redo.status, 409, 'K1 redo adds M money to a sale that already carried some: ' + JSON.stringify(redo.body))
    assert.equal(await rec(a.body.id), orig, 'K1 sale untouched')
    console.log('PASS K1: a redo that turns ordinary money into online money on a sale already carrying some is refused')

    // ---- J1 (kept) --------------------------------------------------------------------------------------------------------------------------------------------
    await setM(null)
    const b = ok(await create([['Cash', 5], ['KHQR', 20]]), 'J1 create')
    const bOrig = await rec(b.body.id)
    const rb = ok(await relabel(b.body.id, 'Cash', 'Card'), 'J1 relabel')
    const bRel = await rec(b.body.id)
    await setM('KHQR')
    ok(await H.historyStep(h, Number(rb.body.actionHistoryId), 'undo', 0, 'J1 undo'), 'J1 undo')
    assert.equal(await rec(b.body.id), bOrig)
    ok(await H.historyStep(h, Number(rb.body.actionHistoryId), 'redo', 1, 'J1 redo'), 'J1 redo')
    assert.equal(await rec(b.body.id), bRel)
    console.log('PASS J1: undo and redo of a relabel that never changes the M amount stay allowed')

    // ---- K2 ---------------------------------------------------------------------------------------------------------------------------------------------------
    await setM(null); await setList(['Cash', 'Card', 'KHQR', 'Card + KHQR'])
    const c = ok(await create([['KHQR', 20], ['Card + KHQR', 5]]), 'K2 create')
    const cOrig = await rec(c.body.id)
    await setM('KHQR')
    const rc = ok(await relabel(c.body.id, 'KHQR', 'Cash'), 'K2 relabel')
    const cRel = await rec(c.body.id)
    const undoC = await H.historyStep(h, Number(rc.body.actionHistoryId), 'undo', 0, 'K2 undo')
    assert.equal(undoC.status, 409, 'K2 undo restores M money (matches the settlement replay): ' + JSON.stringify(undoC.body))
    assert.equal(await rec(c.body.id), cRel)
    assert.notEqual(cRel, cOrig)
    console.log('PASS K2: an undo that restores online money on a legacy combined-label sale is refused')

    // ---- no M at all ------------------------------------------------------------------------------------------------------------------------------------------
    await setM(null); await setList(['Cash', 'Card', 'KHQR'])
    const d = ok(await create([['Cash', 5], ['Card', 20]]), 'plain create')
    const dOrig = await rec(d.body.id)
    const rd = ok(await relabel(d.body.id, 'Cash', 'Card'), 'plain relabel')
    ok(await H.historyStep(h, Number(rd.body.actionHistoryId), 'undo', 0, 'plain undo'), 'plain undo')
    assert.equal(await rec(d.body.id), dOrig)
    ok(await H.historyStep(h, Number(rd.body.actionHistoryId), 'redo', 1, 'plain redo'), 'plain redo')
    console.log('PASS: a sale with no online method anywhere is unaffected')
  } finally { await h.mf.dispose() }
}
main().then(() => { console.log('online method round 13: ok'); process.exit(0) }).catch((e) => { console.error(e); process.exit(1) })
