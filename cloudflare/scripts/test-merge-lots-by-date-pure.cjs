'use strict'
// Pure rules for the 16 Nov 2026 owner ruling: merged duplicate lots integrate with the merge by RECEIVED DATE.
//   * same business day (Cambodia UTC+7): add; no same-day kept lot: create; no date: create;
//   * several kept lots on the day: lowest batch_number, then id;
//   * the kept lot carries the mean of the DISTINCT NON-ZERO costs and the earliest non-null expiry.
// Each assertion is chosen so that the wrong implementation (batch_key match, UTC date, zero-inclusive or weighted mean,
// latest expiry) fails it.
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

check('cost: mean of the distinct non-zero costs, zero and unknown excluded', () => {
  assert.equal(lots.foldedLotCost(2, [2.4]), 2.2)
  // Equal cost: unchanged, and not re-rounded.
  assert.equal(lots.foldedLotCost(2, [2]), 2)
  assert.equal(lots.foldedLotCost(1.23456, [1.23456]), 1.23456)
  // A zero (or unknown) cost on either side is not part of the mean: a plain mean would give 1 and 2.
  assert.equal(lots.foldedLotCost(2, [0]), 2)
  assert.equal(lots.foldedLotCost(0, [2]), 2)
  assert.equal(lots.foldedLotCost(null, [2]), 2)
  assert.equal(lots.foldedLotCost(2, [null]), 2)
  // Distinct, not per lot: 4, 4, 5 -> 4.5 (a per-lot mean is 4.3333).
  assert.equal(lots.foldedLotCost(4, [4, 5]), 4.5)
  // 4, 5, 6 -> 5 (a pairwise fold gives 5.25).
  assert.equal(lots.foldedLotCost(4, [5, 6]), 5)
  // Nothing positive: the kept lot's own value stands (0 stays 0, unknown stays unknown).
  assert.equal(lots.foldedLotCost(0, [0]), 0)
  assert.equal(lots.foldedLotCost(null, [null]), null)
})

check('expiry: the earliest non-empty one, the kept lot\'s own when none has any', () => {
  assert.equal(lots.foldedLotExpiry('2027-01-31', ['2027-03-31']), '2027-01-31')
  assert.equal(lots.foldedLotExpiry('2027-03-31', ['2027-01-31']), '2027-01-31')
  assert.equal(lots.foldedLotExpiry(null, ['2027-03-31']), '2027-03-31')
  assert.equal(lots.foldedLotExpiry('2027-03-31', [null, '']), '2027-03-31')
  assert.equal(lots.foldedLotExpiry(null, [null]), null)
  assert.equal(lots.foldedLotExpiry('2027-03-31', ['2027-01-31', '2027-02-28']), '2027-01-31')
})

check('plan: same date with different cost and expiry (the owner example)', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 2, expiry_date: '2027-01-31' })]
  const dup = [lot(10, '2026-11-03', { unit_cost_usd: 2.4, expiry_date: '2027-03-31' })]
  const [plan] = lots.planFoldedLotMetadata(keeper, dup)
  assert.deepEqual({ ...plan }, {
    keeperLotId: 1, duplicateLotIds: [10], receivedDate: '2026-11-03',
    unit_cost_usd: 2.2, expiry_date: '2027-01-31', costChanged: true, expiryChanged: false,
  })
})

check('plan: equal cost and a later duplicate expiry changes nothing; an earlier one changes only the expiry', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-06-30' })]
  const [same] = lots.planFoldedLotMetadata(keeper, [lot(10, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-09-30' })])
  assert.equal(same.costChanged, false)
  assert.equal(same.expiryChanged, false)
  const [earlier] = lots.planFoldedLotMetadata(keeper, [lot(10, '2026-11-03', { unit_cost_usd: 3, expiry_date: '2027-02-28' })])
  assert.equal(earlier.costChanged, false)
  assert.equal(earlier.expiryChanged, true)
  assert.equal(earlier.expiry_date, '2027-02-28')
})

check('plan: two discarded lots into one kept lot are one group (one write, cluster-wide mean)', () => {
  const keeper = [lot(1, '2026-11-03', { unit_cost_usd: 4 })]
  const dup = [lot(10, '2026-11-03', { unit_cost_usd: 5 }), lot(11, '2026-11-03', { unit_cost_usd: 6 })]
  const plan = lots.planFoldedLotMetadata(keeper, dup)
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].duplicateLotIds, [10, 11])
  assert.equal(plan[0].unit_cost_usd, 5)
})

check('plan: nothing is planned for a lot with no same-date kept lot', () => {
  assert.deepEqual(lots.planFoldedLotMetadata([lot(1, '2026-11-03')], [lot(10, '2026-11-09'), lot(11, null)]), [])
})

console.log(`${passed} passed, 0 failed`)
