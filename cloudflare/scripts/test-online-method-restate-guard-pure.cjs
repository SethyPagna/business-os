'use strict'
// KHQR round 10 (G1, G5, G6): the pure rules and the SQL of the online-method guards, run on a real SQLite.
//   * paymentMethodComponents is the ONE splitter; namesOnlineMethod judges every component with the one identity ("Cash + ABA", "Cash+ABA", "épay + Cash" for "ÉPay").
//   * methodGuardKeys feeds the in-batch guards the label and each component.
//   * addedListEntryCombiningOnlineMethod: a list save refuses a NEW combined label that contains the method; an old one is tolerated.
//   * saleMethodsUsed splits a combined detail row (the fold registers methods, not labels).
//   * ONLINE_METHOD_SALE_GUARD_SQL (create): a component match aborts as requires_order; a non-ASCII pin aborts as changed ONLY when the stored method is non-ASCII (G6).
//   * ONLINE_METHOD_RESTATE_GUARD_SQL (settle, relabel, redo, exchange onto an existing sale): fires only when the stored method changed after the read, never for a sale linked
//     from online_orders (a FULFILLED online sale restates its KHQR row), never while the method is unchanged (a legacy ordinary sale restates what it recorded).
// Run (from cloudflare/): node scripts/test-online-method-restate-guard-pure.cjs
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadTsLib } = require('./harness/load_ts_lib.cjs')

const inv = loadTsLib('onlineMethodInvariant')
const reg = loadTsLib('paymentMethodRegistry')
const U = (...codes) => String.fromCharCode(...codes)
let passed = 0
const ok = (label, fn) => { try { fn(); passed += 1; console.log('PASS ' + label) } catch (error) { console.error('FAIL ' + label + '\n' + error.message); process.exitCode = 1 } }

ok('paymentMethodComponents: the one splitter', () => {
  assert.deepEqual(reg.paymentMethodComponents('Cash + ABA'), ['Cash', 'ABA'])
  assert.deepEqual(reg.paymentMethodComponents('Cash+ABA'), ['Cash', 'ABA'])
  assert.deepEqual(reg.paymentMethodComponents('  ABA  '), ['ABA'])
  assert.deepEqual(reg.paymentMethodComponents(' + '), [])
  assert.deepEqual(reg.paymentMethodComponents(null), [])
})
ok('namesOnlineMethod judges every component with the same identity', () => {
  for (const label of ['Cash + ABA', 'ABA + Cash', 'Cash+ABA', 'cash + aba', 'Card +ABA' + U(9), 'Cash + ' + U(0xa0) + 'ABA', 'Cash + Card + aba ']) assert.equal(inv.namesOnlineMethod('ABA', label), true, JSON.stringify(label))
  assert.equal(inv.namesOnlineMethod(U(0xc9) + 'Pay', U(0xe9) + 'pay + Cash'), true, 'a non-ASCII case twin inside a combined label')
  for (const label of ['Cash + Card', 'ABA Pay + Cash', 'AB + A', 'Cash+', '+', '']) assert.equal(inv.namesOnlineMethod('ABA', label), false, JSON.stringify(label))
  assert.equal(inv.namesOnlineMethod('', 'Cash + ABA'), false, 'no method in force names nobody')
  assert.equal(inv.carriesOnlineMethod, inv.namesOnlineMethod)
})
ok('round 11 (H1): a label whose ONLY component is the method names it, whatever the number of components', () => {
  for (const label of ['ABA+', '+ABA', 'ABA +', ' + ABA', 'ABA++', '+ABA+', 'aba+', 'ABA+' + U(9)]) {
    assert.equal(inv.namesOnlineMethod('ABA', label), true, JSON.stringify(label))
    assert.equal(inv.carriesOnlineMethodInCombination('ABA', label), true, 'a list save / replace target refuses it: ' + JSON.stringify(label))
    assert.equal(reg.paymentMethodComponents(label).length, 1, 'the splitter reads one component: ' + JSON.stringify(label))
  }
  assert.equal(inv.addedListEntryCombiningOnlineMethod('ABA', ['Cash', 'ABA'], ['Cash', 'ABA', 'ABA+']), 'ABA+')
  for (const label of ['AB+', 'Bakong+', '+', 'Cash+']) assert.equal(inv.namesOnlineMethod('ABA', label), false, JSON.stringify(label))
})
ok('carriesOnlineMethodInCombination: a component only, never the method itself', () => {
  assert.equal(inv.carriesOnlineMethodInCombination('ABA', 'Card + ABA'), true)
  assert.equal(inv.carriesOnlineMethodInCombination('ABA', 'ABA'), false)
  assert.equal(inv.carriesOnlineMethodInCombination('ABA', 'Card'), false)
})
ok('methodGuardKeys: the label and each component, folded for SQL', () => {
  assert.deepEqual(inv.methodGuardKeys('Cash + ABA'), ['cash + aba', 'cash', 'aba'])
  assert.deepEqual(inv.methodGuardKeys('ABA'), ['aba'])
  assert.deepEqual(inv.methodGuardKeys('  '), [])
})
ok('addedListEntryCombiningOnlineMethod: a new combined label is refused, an old one tolerated', () => {
  const before = JSON.stringify(['Cash', 'ABA', 'Card'])
  assert.equal(inv.addedListEntryCombiningOnlineMethod('ABA', before, JSON.stringify(['Cash', 'ABA', 'Card', 'Card + ABA'])), 'Card + ABA')
  assert.equal(inv.addedListEntryCombiningOnlineMethod('ABA', before, JSON.stringify(['Cash', 'ABA', 'Card', 'Wing'])), null)
  const stale = JSON.stringify(['Cash', 'ABA', 'Card', 'Card + ABA'])
  assert.equal(inv.addedListEntryCombiningOnlineMethod('ABA', stale, JSON.stringify(['Cash', 'ABA', 'Card', 'Card + ABA', 'Wing'])), null)
  assert.equal(inv.addedListEntryCombiningOnlineMethod('', before, JSON.stringify(['Cash', 'Card + ABA'])), null, 'no method in force: nothing to protect')
})
ok('saleMethodsUsed splits a combined detail row; the fold never registers a label', () => {
  assert.deepEqual(reg.saleMethodsUsed({ payment_details: [{ method: 'Card + Wing' }, { method: 'Cash' }] }), ['Card', 'Wing', 'Cash'])
  assert.deepEqual(reg.saleMethodsUsed({ payment_method: 'Cash + Wing' }), ['Cash', 'Wing'])
  assert.equal(JSON.parse(reg.appendPaymentMethods(JSON.stringify(['Cash']), reg.saleMethodsUsed({ payment_details: [{ method: 'Card + Wing' }] })).raw).join('|'), 'Cash|Card|Wing')
})

// ---- the SQL, on a real SQLite -----------------------------------------------------------------------------------------------------------------------------------
function world({ stored, switchOn = false, linked = [] }) {
  const db = new Database(':memory:')
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE system_flags(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE online_orders(id INTEGER PRIMARY KEY, sale_id INTEGER)")
  if (stored !== null) db.prepare("INSERT INTO settings(key,value) VALUES('online_order_payment_method', ?)").run(stored)
  db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches', ?)").run(JSON.stringify({ epoch: 1, switches: { online_orders: switchOn ? 'on' : 'off' } }))
  for (const id of linked) db.prepare('INSERT INTO online_orders(sale_id) VALUES(?)').run(id)
  return db
}
const run = (db, sql, params) => { try { db.prepare(sql).get(params); return 'ok' } catch (error) { const m = String(error.message); return m.includes('online_method_requires_order') ? 'requires_order' : m.includes('online_method_changed') ? 'changed' : 'other: ' + m } }
const createGuard = (db, methods, read) => { const g = inv.onlineMethodSaleGuard(methods, read); return g ? run(db, g.sql, g.params) : 'none' }
const restate = (db, methods, read, saleId = 1) => { const g = inv.onlineMethodRestateGuard(methods, read, saleId); return g ? run(db, g.sql, g.params) : 'none' }

ok('create guard: a component match aborts (requires_order), another label passes', () => {
  const db = world({ stored: 'ABA' })
  for (const label of ['ABA', 'Cash + ABA', 'Cash+aba', 'aba + Cash']) assert.equal(createGuard(db, [label], 'ABA'), 'requires_order', label)
  assert.equal(createGuard(db, ['Cash + Card'], 'ABA'), 'ok')
  assert.equal(createGuard(db, ['Cash', 'Card'], 'ABA'), 'ok')
})
ok('create guard: the default in force while ON catches a component too', () => {
  const db = world({ stored: null, switchOn: true })
  assert.equal(createGuard(db, ['Cash + ABA KHQR'], ''), 'requires_order')
  assert.equal(createGuard(world({ stored: null, switchOn: false }), ['Cash + ABA KHQR'], ''), 'ok')
})
ok('create guard (G6): the pin aborts only when the stored method has a non-ASCII character', () => {
  const KH = U(0x179c, 0x17b8, 0x1784), EC = U(0xc9) + 'Pay'
  const db = world({ stored: 'ABA' })
  assert.equal(createGuard(db, [KH], 'Bakong'), 'ok', 'a Khmer-named sale while the method moved between two ASCII names')
  const db2 = world({ stored: EC })
  assert.equal(createGuard(db2, [U(0xe9) + 'pay'], 'Bakong'), 'changed', 'the stored method is non-ASCII and moved since the read: a retryable conflict')
  assert.equal(createGuard(db2, [U(0xe9) + 'pay'], EC), 'ok', 'unchanged since the read: the read-time judgement stands')
})
ok('create guard (G6) negative control: without the non-ASCII clause the same Khmer sale WOULD conflict (the clause is what the case above pins)', () => {
  const KH = U(0x179c, 0x17b8, 0x1784)
  const clause = " AND COALESCE((SELECT value FROM settings WHERE key = 'online_order_payment_method'), '') GLOB '*[^ -~]*'"
  assert.ok(inv.ONLINE_METHOD_SALE_GUARD_SQL.includes(clause), 'the clause is in the create guard')
  assert.ok(inv.ONLINE_METHOD_RESTATE_GUARD_SQL.includes(clause.slice(5)), 'and in the restate guard')
  const g = inv.onlineMethodSaleGuard([KH], 'Bakong')
  assert.equal(run(world({ stored: 'ABA' }), inv.ONLINE_METHOD_SALE_GUARD_SQL.replace(clause, ''), g.params), 'changed', 'mutant: the over-refusal returns')
})
ok('create guard (G6): an M row that is only ASCII white space is "nothing stored" in SQL as it is in JS', () => {
  const db = world({ stored: U(9), switchOn: false })
  assert.equal(createGuard(db, ['ABA KHQR'], U(9)), 'ok')
})
ok('restate guard: unchanged method = the read-time judgement stands (a legacy ordinary sale restating a recorded row passes)', () => {
  const db = world({ stored: 'ABA' })
  assert.equal(restate(db, ['Cash + ABA'], 'ABA'), 'ok')
})
ok('restate guard: the method stored AFTER the read aborts a request whose rows name it', () => {
  const db = world({ stored: 'Bakong' })
  assert.equal(restate(db, ['Cash + Bakong'], ''), 'requires_order')
  assert.equal(restate(db, ['Cash', 'bakong'], ''), 'requires_order')
  assert.equal(restate(db, ['Cash', 'Card'], ''), 'ok', 'a request that does not carry it commits')
})
ok('restate guard: a sale linked from online_orders (a FULFILLED online sale) restates its KHQR row', () => {
  const db = world({ stored: 'ABA KHQR', linked: [7] })
  assert.equal(restate(db, ['Cash', 'ABA KHQR'], '', 7), 'ok')
  assert.equal(restate(db, ['Cash', 'ABA KHQR'], '', 8), 'requires_order', 'an ordinary sale does not')
})
ok('restate guard: a non-ASCII row while a non-ASCII method changed is a retryable conflict; ASCII methods never conflict', () => {
  const EC = U(0xc9) + 'Pay', KH = U(0x179c, 0x17b8, 0x1784)
  assert.equal(restate(world({ stored: EC }), [U(0xe9) + 'pay'], ''), 'changed')
  assert.equal(restate(world({ stored: 'Wing' }), [KH], ''), 'ok')
})
ok('restate predicate (bulk relabel) agrees with the guard', () => {
  const db = world({ stored: 'Bakong' })
  const verdict = (methods, read) => { const p = inv.onlineMethodRestateParams(methods, read); return Boolean(db.prepare('SELECT CASE WHEN ' + inv.ONLINE_METHOD_RESTATE_OK_SQL + ' THEN 1 ELSE 0 END AS v').get(p).v) }
  assert.equal(verdict(['Bakong'], ''), false)
  assert.equal(verdict(['Cash + Bakong'], ''), false)
  assert.equal(verdict(['Card'], ''), true)
  assert.equal(verdict(['Bakong'], 'Bakong'), true, 'unchanged: the read-time judgement stands')
})
console.log('online method restate guard: ' + passed + ' checks')
