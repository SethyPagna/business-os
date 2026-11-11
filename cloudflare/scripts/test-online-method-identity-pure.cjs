'use strict'
// KHQR round 9 (F1, F2, F3): the pure rules behind "an ordinary sale may never carry the online-order method in any spelling the system treats as the same method".
//   * namesOnlineMethod / onlineTender: ONE identity (the settlement planner's own: JS trim of every Unicode white space + locale lower-casing, or the SQL fold) for create,
//     settle, correction, exchange and import. Every white-space and non-ASCII variant the verifier found passes here as the SAME method.
//   * effectiveOnlineMethod: the stored method, or the default while online ordering is ON and nothing is stored.
//   * appendPaymentMethods: the append-only twin of mergePaymentMethods (the sale fold and backfill): never rewrites or drops a stored entry.
//   * the settlement planner stores the CONFIGURED spelling for each of those variants, which is why the refusal has to use the same identity.
// Run (from cloudflare/): node scripts/test-online-method-identity-pure.cjs
const assert = require('node:assert/strict')
const { loadTsLib } = require('./harness/load_ts_lib.cjs')

const inv = loadTsLib('onlineMethodInvariant')
const reg = loadTsLib('paymentMethodRegistry')
const fulfil = loadTsLib('onlineOrderFulfil', { readSwitches: { readSwitch: async () => false, peekReadSwitch: () => false } })
const U = (...codes) => String.fromCharCode(...codes)
let passed = 0
const ok = (label, fn) => { try { fn(); passed += 1; console.log('PASS ' + label) } catch (error) { console.error('FAIL ' + label + '\n' + error.message); process.exitCode = 1 } }

const VARIANTS = [
  ['exact', 'ABA'], ['ASCII case', 'aba'], ['trailing TAB', 'ABA' + U(9)], ['trailing NBSP', 'ABA' + U(0xa0)], ['leading LF', U(10) + 'ABA'],
  ['trailing ideographic space', 'ABA' + U(0x3000)], ['leading NBSP and trailing TAB', U(0xa0) + 'ABA' + U(9)], ['zero-width no-break space edge', U(0xfeff) + 'ABA'],
  ['line separator edge', 'ABA' + U(0x2028)], ['vertical tab and form feed edges', U(11) + 'ABA' + U(12)],
]
for (const [label, name] of VARIANTS) {
  ok('namesOnlineMethod: "ABA" is named by ' + label, () => assert.equal(inv.namesOnlineMethod('ABA', name), true))
  ok('onlineTender finds the row spelled ' + label, () => assert.equal(fulfil.onlineTender([{ method: name, amount_usd: 20, amount_khr: 0 }], 'ABA').present, true))
}
ok('non-ASCII case twin: stored "ÉPay" is named by "épay" and "ÉPAY" (the settlement resolves it the same way)', () => {
  const stored = U(0xc9) + 'Pay'
  assert.equal(inv.namesOnlineMethod(stored, U(0xe9) + 'pay'), true)
  assert.equal(inv.namesOnlineMethod(stored, U(0xc9) + 'PAY'), true)
  assert.equal(inv.namesOnlineMethod(U(0xe9) + 'pay', stored), true, 'symmetric')
  assert.equal(fulfil.onlineTender([{ method: U(0xe9) + 'pay' + U(0xa0), amount_usd: 1, amount_khr: 0 }], stored).present, true)
})
ok('controls: other names are not the online method', () => {
  for (const other of ['ABA Pay', 'AB', 'Cash', 'A BA', '', ' ']) assert.equal(inv.namesOnlineMethod('ABA', other), false, JSON.stringify(other))
  assert.equal(inv.namesOnlineMethod('', 'ABA'), false, 'no method in force names nobody')
  assert.equal(fulfil.onlineTender([{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], 'ABA').present, false)
})
ok('onlineTender adds every variant row of the method (the refusal compares the SUM a settlement would add)', () => {
  const t = fulfil.onlineTender([{ method: 'ABA' + U(9), amount_usd: 10, amount_khr: 0 }, { method: 'aba', amount_usd: 2.5, amount_khr: 4000 }, { method: 'Cash', amount_usd: 1, amount_khr: 0 }], 'ABA')
  assert.deepEqual([t.usd, t.khr, t.present], [12.5, 4000, true])
})

ok('the settlement planner resolves every variant to the configured spelling (the identity the refusal must share)', () => {
  const key = reg.paymentMethodKey
  for (const [label, name] of VARIANTS) assert.equal(key(name), key('ABA'), label)
  assert.equal(key(U(0xe9) + 'pay'), key(U(0xc9) + 'Pay'))
})

ok('effectiveOnlineMethod: stored wins, the default only while ON with nothing stored, else none', () => {
  assert.equal(inv.effectiveOnlineMethod('Bakong', true), 'Bakong')
  assert.equal(inv.effectiveOnlineMethod('Bakong', false), 'Bakong')
  assert.equal(inv.effectiveOnlineMethod('', true), 'ABA KHQR')
  assert.equal(inv.effectiveOnlineMethod(null, true), 'ABA KHQR')
  assert.equal(inv.effectiveOnlineMethod(undefined, false), '')
  assert.equal(inv.effectiveOnlineMethod('  ', false), '')
  assert.equal(inv.effectiveOnlineMethod('  ', true), 'ABA KHQR')
  assert.equal(fulfil.ONLINE_PAYMENT_METHOD_DEFAULT, inv.ONLINE_METHOD_DEFAULT, 'one default')
  assert.equal(fulfil.configuredOnlineMethod(''), inv.effectiveOnlineMethod('', true), 'Fulfil rings the effective method')
})

// ---- F2: append-only ----------------------------------------------------------------------------------------------------------------------------------------
const stateAfter = (method, raw) => inv.onlineMethodViolations({ method, listRaw: raw, kindsRaw: '' })
const GRID = [
  ['non-ASCII case twin listed first', U(0xc9) + 'Pay', [U(0xe9) + 'pay', U(0xc9) + 'Pay', 'Cash']],
  ['NBSP on both', 'ABA KHQR' + U(0xa0), ['Cash', 'ABA KHQR' + U(0xa0)]],
  ['ideographic space on both', 'ABA KHQR' + U(0x3000), ['Cash', 'ABA KHQR' + U(0x3000)]],
  ['plain', 'ABA KHQR', ['Cash', 'ABA KHQR']],
  ['a stale unlisted method', 'Ghost', ['Cash', 'Card']],
  ['a doubled entry already stored', 'ABA KHQR', ['Cash', 'ABA KHQR', 'aba khqr']],
  ['a non-string entry already stored', 'ABA KHQR', ['Cash', 7, 'ABA KHQR', null]],
]
for (const [label, method, list] of GRID) {
  ok('append-only keeps every stored entry byte for byte and adds at the end: ' + label, () => {
    const raw = JSON.stringify(list)
    const before = stateAfter(method, raw)
    const merged = reg.appendPaymentMethods(raw, ['Wing Pay', 'cash', ' WING PAY ', 'Pi Pay'])
    assert.deepEqual(JSON.parse(merged.raw).slice(0, list.length), list, 'stored entries untouched, in place')
    assert.deepEqual(merged.added, ['Wing Pay'], 'only the new, non-retired name')
    assert.deepEqual(stateAfter(method, merged.raw), before, 'the invariant verdict is exactly what it was before the append')
  })
}
ok('append-only: nothing new writes nothing (changed false, raw identical to the input shape)', () => {
  const merged = reg.appendPaymentMethods('["Cash","Card"]', ['cash', ' CARD '])
  assert.equal(merged.changed, false)
  assert.deepEqual(merged.added, [])
})
ok('append-only: absent or unreadable stored list reads as empty (nothing to keep), as the old merge did', () => {
  assert.deepEqual(JSON.parse(reg.appendPaymentMethods(undefined, ['Cash']).raw), ['Cash'])
  assert.deepEqual(JSON.parse(reg.appendPaymentMethods('not json', ['Cash']).raw), ['Cash'])
  assert.deepEqual(JSON.parse(reg.appendPaymentMethods('{"a":1}', ['Cash']).raw), ['Cash'])
})
ok('append-only: the cap and the length limit hold, a retired name is never resurrected', () => {
  const full = Array.from({ length: 60 }, (_, i) => 'M' + i)
  assert.equal(reg.appendPaymentMethods(JSON.stringify(full), ['One More']).changed, false)
  assert.equal(reg.appendPaymentMethods('["Cash"]', ['x'.repeat(200)]).added[0].length, 80)
  assert.deepEqual(reg.appendPaymentMethods('["Cash"]', ['Pi Pay', 'Transfer']).added, [])
})
ok('control: the OLD whole-list merge DID rewrite these lists (the defect this replaces)', () => {
  const merged = reg.mergePaymentMethods(reg.parseConfiguredMethods(JSON.stringify(['épay', 'ÉPay', 'Cash'])), ['Wing Pay'])
  assert.deepEqual(merged.methods, ['épay', 'Cash', 'Wing Pay'], 'the stored entry "ÉPay" was dropped by the merge')
})

// ---- the sale guard statement's parameters -----------------------------------------------------------------------------------------------------------------
ok('onlineMethodSaleGuard: keys are the ASCII fold of each trimmed name; the pin is armed only for a non-ASCII name and only with a read to pin', () => {
  const g = fulfil.onlineMethodSaleGuard(['Cash', ' ABA\t'], 'ABA')
  assert.deepEqual(JSON.parse(g.params.saleMethodKeys), ['cash', 'aba'])
  assert.equal(g.params.pinMethod, 0)
  const twin = fulfil.onlineMethodSaleGuard([U(0xe9) + 'pay'], 'x')
  assert.equal(twin.params.pinMethod, 1)
  assert.equal(fulfil.onlineMethodSaleGuard([U(0xe9) + 'pay'], null).params.pinMethod, 0, 'an import commit has nothing to pin')
  assert.equal(fulfil.onlineMethodSaleGuard([], 'x'), null)
  assert.equal(fulfil.onlineMethodSaleGuard(['  '], 'x'), null)
})
ok('onlineMethodSaleGuardOutcome maps the two aborts and nothing else', () => {
  assert.equal(fulfil.onlineMethodSaleGuardOutcome(new Error("D1_ERROR: JSON path error near 'online_method_requires_order'")), 'requires_order')
  assert.equal(fulfil.onlineMethodSaleGuardOutcome(new Error('x online_method_changed y')), 'changed')
  assert.equal(fulfil.onlineMethodSaleGuardOutcome(new Error('CHECK constraint failed')), null)
})

console.log(`test-online-method-identity-pure: ${passed} checks ok`)
