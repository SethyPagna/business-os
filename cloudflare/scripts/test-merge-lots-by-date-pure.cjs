'use strict'
// Pure rules for the 16 Nov 2026 owner ruling: merged duplicate lots integrate with the merge by RECEIVED DATE.
//   * same business day (Cambodia UTC+7): add; no same-day kept lot: create; no date: create;
//   * several kept lots on the day: lowest batch_number, then id;
//   * the kept lot carries the QUANTITY-WEIGHTED average cost (owner 5 Oct), a $0 or unknown cost left out of the weights (6 Oct),
//     rounded to 4 places by the one money helper; the earliest non-null expiry; and its OWN supplier,
//     payment status and due date, never an added lot's (lead ruling 16 Nov: payables are counted per receipt).
// Each assertion is chosen so that the wrong implementation (batch_key match, UTC date, plain mean, $0 in the weights,
// no rounding, latest expiry, supplier taken) fails it.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = process.env.BOS_HARNESS_SRC_DIR || path.join(__dirname, '..', 'src')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel)
  const abs = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod.exports)
  new Function('require', 'module', 'exports', output)((request) => {
    if (!request.startsWith('.')) return require(request)
    return load(path.posix.join(path.posix.dirname(rel), request) + '.ts')
  }, mod, mod.exports)
  cache.set(rel, mod.exports)
  return mod.exports
}
const lots = load('lib/productMergeLots.ts')

let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const lot = (id, received_at, extra = {}) => ({ id, received_at, batch_number: id, unit_cost_usd: null, expiry_date: null, ...extra })

check('received date: a bare date is its own business day; a UTC instant is shifted to Cambodia', () => {
  assert.equal(lots.mergeLotReceivedDate('2026-11-03'), '2026-11-03')
  assert.equal(lots.mergeLotReceivedDate('2026-11-03 10:00:00'), '2026-11-03')
  // 23:30 UTC on 3 Nov is 06:30 on 4 Nov in the shop: the UTC date would say 3 Nov.
  assert.equal(lots.mergeLotReceivedDate('2026-11-03 23:30:00'), '2026-11-04')
  assert.equal(lots.mergeLotReceivedDate('2026-11-03T23:30:00.000Z'), '2026-11-04')
  assert.equal(lots.mergeLotReceivedDate('2026-11-03 16:59:59'), '2026-11-03')
  assert.equal(lots.mergeLotReceivedDate('2026-11-03 17:00:00'), '2026-11-04')
  for (const none of [null, undefined, '', '   ', 'not a date']) assert.equal(lots.mergeLotReceivedDate(none), null)
})

check('match is by date, never by batch_key', () => {
  // Same batch_key, different days: no match. Different batch_key, same day: match.
  const keeper = [lot(1, '2026-11-03', { batch_key: 'SAME' }), lot(2, '2026-11-05', { batch_key: 'OTHER' })]
  const dup = [lot(10, '2026-11-07', { batch_key: 'SAME' }), lot(11, '2026-11-05', { batch_key: 'DIFFERENT' })]
  const matches = lots.matchDuplicateLots(keeper, dup)
  assert.deepEqual([...matches], [[11, 2]])
})

check('match uses the business day: a 23:30 UTC receipt meets the next-day bare date, not the UTC day', () => {
  const keeper = [lot(1, '2026-11-03'), lot(2, '2026-11-04')]
  const dup = [lot(10, '2026-11-03 23:30:00')]
  assert.deepEqual([...lots.matchDuplicateLots(keeper, dup)], [[10, 2]])
})

check('no received date never matches, either side', () => {
  const keeper = [lot(1, null), lot(2, ''), lot(3, '2026-11-03')]
  const dup = [lot(10, null), lot(11, ''), lot(12, '2026-11-09')]
  assert.deepEqual([...lots.matchDuplicateLots(keeper, dup)], [])
  assert.deepEqual([...lots.matchDuplicateLots([lot(1, null)], [lot(10, null)])], [])
})

check('several kept lots on one day: the lowest batch_number takes it, then the lowest id', () => {
  const keeper = [lot(7, '2026-11-03', { batch_number: 4 }), lot(5, '2026-11-03', { batch_number: 9 }), lot(8, '2026-11-03', { batch_number: 2 })]
  assert.deepEqual([...lots.matchDuplicateLots(keeper, [lot(10, '2026-11-03')])], [[10, 8]])
  // Same batch_number: the lowest id. A null number sorts last.
  const tie = [lot(7, '2026-11-03', { batch_number: 2 }), lot(5, '2026-11-03', { batch_number: 2 }), lot(3, '2026-11-03', { batch_number: null })]
  assert.deepEqual([...lots.matchDuplicateLots(tie, [lot(10, '2026-11-03')])], [[10, 5]])
  // Independent of the order the rows were read in.
  assert.deepEqual([...lots.matchDuplicateLots([...tie].reverse(), [lot(10, '2026-11-03')])], [[10, 5]])
})

check('two discarded lots on one day both land in the one kept lot', () => {
  const keeper = [lot(1, '2026-11-03')]
  const dup = [lot(10, '2026-11-03'), lot(11, '2026-11-03 05:00:00')]
  assert.deepEqual([...lots.matchDuplicateLots(keeper, dup)].sort(), [[10, 1], [11, 1]])
})

const L = (cost, quantity) => ({ cost, quantity })
check('cost: quantity-weighted average of the lots combined', () => {
  // 4 at 4.00 and 6 at 5.00 -> 4.60 (a plain mean is 4.50). The owner example: 2.00 and 2.40 at equal stock is 2.20.
  assert.equal(lots.foldedLotCost(L(4, 4), [L(5, 6)]), 4.6)
  assert.equal(lots.foldedLotCost(L(2, 5), [L(2.4, 5)]), 2.2)
  // The weights are the stock, not the lot count: 1 at 2 and 9 at 3 is 2.9 (a plain mean is 2.5); order does not matter.
  assert.equal(lots.foldedLotCost(L(2, 1), [L(3, 9)]), 2.9)
  assert.equal(lots.foldedLotCost(L(3, 9), [L(2, 1)]), 2.9)
  // Equal costs stay put.
  assert.equal(lots.foldedLotCost(L(3, 4), [L(3, 6)]), 3)
  // Not a distinct-values mean: 4, 4, 5 at stock 3, 3, 4 -> (12 + 12 + 20) / 10 = 4.4 (distinct mean 4.5, per-lot mean 4.3333).
  assert.equal(lots.foldedLotCost(L(4, 3), [L(4, 3), L(5, 4)]), 4.4)
  // Three lots at unequal stock: (2*6 + 3*1 + 4*1) / 8 = 2.375 (a pairwise fold or a plain mean says otherwise).
  assert.equal(lots.foldedLotCost(L(2, 6), [L(3, 1), L(4, 1)]), 2.375)
})

check('cost: $0 or unknown is not weighted; both $0 or unknown stays; zero stock falls back to the kept lot', () => {
  // One real cost among them: it stands exactly, whatever the stock of the $0 lot (a $0 in the weights would give 1).
  assert.equal(lots.foldedLotCost(L(2, 10), [L(0, 10)]), 2)
  assert.equal(lots.foldedLotCost(L(0, 10), [L(2, 10)]), 2)
  assert.equal(lots.foldedLotCost(L(null, 10), [L(2, 3)]), 2)
  assert.equal(lots.foldedLotCost(L(2, 10), [L(null, 3)]), 2)
  assert.equal(lots.foldedLotCost(L(2, 10), [L('', 3), L(0, 4), L(3, 10)]), 2.5, 'the $0 and unknown lots drop out, the two real costs weigh 10 and 10')
  // Both $0 or unknown: the kept lot's own value stays (0 stays 0, unknown stays unknown).
  assert.equal(lots.foldedLotCost(L(0, 3), [L(0, 4)]), 0)
  assert.equal(lots.foldedLotCost(L(null, 3), [L(null, 4)]), null)
  assert.equal(lots.foldedLotCost(L(0, 3), [L(null, 4)]), 0)
  // Both quantities 0: the average is undefined, the kept lot's cost stands.
  assert.equal(lots.foldedLotCost(L(2, 0), [L(3, 0)]), 2)
  assert.equal(lots.foldedLotCost(L(2, 5), [L(3, 0)]), 2, 'a lot with no stock carries no weight')
  assert.equal(lots.foldedLotCost(L(2, 0), [L(3, 5)]), 3)
})

check('cost: stored to 4 places by the one money rounding (a repeating weighted mean is rounded, never raw)', () => {
  // 1 at 1, 1 at 2, 1 at 2.5 -> 5.5 / 3 = 1.8333...; 1 at 1, 2 at 2 -> 5 / 3 = 1.6666... -> 1.6667 (half away from zero)
  assert.equal(lots.foldedLotCost(L(1, 1), [L(2, 1), L(2.5, 1)]), 1.8333)
  assert.equal(lots.foldedLotCost(L(1, 1), [L(2, 2)]), 1.6667)
  // The coordinator example, (2 + 2.4 + 2.35) / 3 at equal stock, is exact at 4 places.
  assert.equal(lots.foldedLotCost(L(2, 5), [L(2.4, 5), L(2.35, 5)]), 2.25)
  // A single real cost arriving with more than 4 places is stored at 4 as well.
  assert.equal(lots.foldedLotCost(L(null, 0), [L(1.23456, 4)]), 1.2346)
  for (const [keeper, added] of [[L(1, 7), [L(2, 3), L(2.5, 11)]], [L(3.1, 2), [L(3.17, 5), L(3.333, 9)]], [L(2, 1), [L(2.4, 3), L(2.2, 7)]]]) {
    const cost = lots.foldedLotCost(keeper, added)
    assert.equal(cost, Math.round(cost * 10000) / 10000, 'never more than 4 decimals: ' + cost)
  }
})

check('expiry: the earliest non-empty one, the kept lot\'s own when none has any', () => {
  assert.equal(lots.foldedLotExpiry('2027-01-31', ['2027-03-31']), '2027-01-31')
  assert.equal(lots.foldedLotExpiry('2027-03-31', ['2027-01-31']), '2027-01-31')
  assert.equal(lots.foldedLotExpiry(null, ['2027-03-31']), '2027-03-31')
  assert.equal(lots.foldedLotExpiry('2027-03-31', [null, '']), '2027-03-31')
  assert.equal(lots.foldedLotExpiry(null, [null]), null)
  assert.equal(lots.foldedLotExpiry('2027-03-31', ['2027-01-31', '2027-02-28']), '2027-01-31')
})

const supplied = { supplier_id: 5, supplier_name: 'Sup', payment_status: 'credit', credit_due_date: '2026-12-01' }
const noSupplier = { supplier_id: null, supplier_name: null, payment_status: 'paid', credit_due_date: null }
check('plan: same date with different cost and expiry (the owner example), weighted by the stock combined', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 2, expiry_date: '2027-01-31', lot_quantity: 5, ...supplied })]
  const dup = [lot(10, '2026-11-03', { unit_cost_usd: 2.4, expiry_date: '2027-03-31', lot_quantity: 5 })]
  const [plan] = lots.planFoldedLotMetadata(keeper, dup)
  assert.deepEqual({ ...plan }, {
    keeperLotId: 1, duplicateLotIds: [10], receivedDate: '2026-11-03',
    unit_cost_usd: 2.2, expiry_date: '2027-01-31', costChanged: true, expiryChanged: false,
  })
  // The same lots with unequal stock: 2 x 2 + 8 x 2.4 = 23.2 / 10 = 2.32 (a plain mean would still say 2.2).
  const [unequal] = lots.planFoldedLotMetadata(keeper, dup, undefined, new Map([[1, 2], [10, 8]]))
  assert.equal(unequal.unit_cost_usd, 2.32, 'the supplied quantities, not the row fields, are the weights')
})

check('plan: equal cost and a later duplicate expiry changes nothing; an earlier one changes only the expiry', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-06-30', lot_quantity: 4 })]
  const [same] = lots.planFoldedLotMetadata(keeper, [lot(10, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-09-30', lot_quantity: 2 })])
  assert.equal(same.costChanged, false)
  assert.equal(same.expiryChanged, false)
  const [earlier] = lots.planFoldedLotMetadata(keeper, [lot(10, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-02-28', lot_quantity: 2 })])
  assert.equal(earlier.costChanged, false)
  assert.equal(earlier.expiryChanged, true)
  assert.equal(earlier.expiry_date, '2027-02-28')
})

check('plan: two discarded lots into one kept lot are one group (one write, cluster-wide weighted mean)', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 4, lot_quantity: 2 })]
  const dup = [lot(10, '2026-11-03', { unit_cost_usd: 5, lot_quantity: 3 }), lot(11, '2026-11-03', { unit_cost_usd: 6, lot_quantity: 5 })]
  const plan = lots.planFoldedLotMetadata(keeper, dup)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].duplicateLotIds, [10, 11])
  assert.equal(plan[0].unit_cost_usd, 5.3, '(2*4 + 3*5 + 5*6) / 10')
})

check('supplier: the plan never carries a supplier, whatever the kept lot has or the added lots owe', () => {
  const dup = lot(10, '2026-11-03', { unit_cost_usd: 2, lot_quantity: 1, ...supplied })
  for (const keeper of [noSupplier, { supplier_id: 9, supplier_name: 'Own', payment_status: 'paid', credit_due_date: null }, { supplier_id: null, supplier_name: 'Only name' }]) {
    const [plan] = lots.planFoldedLotMetadata([lot(1, '2026-11-03', { unit_cost_usd: 2, lot_quantity: 1, ...keeper })], [dup])
    assert.equal('supplier' in plan, false, 'the plan has no supplier to write')
    assert.equal(Object.keys(plan).some((key) => /supplier|payment|credit/i.test(key)), false)
  }
  assert.equal(typeof lots.lotHasSupplier, 'undefined', 'no supplier-take helper remains')
})

check('plan: nothing is planned for a lot with no same-date kept lot', () => {
  assert.deepEqual(lots.planFoldedLotMetadata([lot(1, '2026-11-03')], [lot(10, '2026-11-09'), lot(11, null)]), [])
})

console.log(`${passed} passed, 0 failed`)
