// Owner rules for the cutover lot merge: lots received on the same business DATE (Cambodia, UTC+7) merge into
// one lot at LC Store, a cost difference resolves to the quantity-weighted average rounded to 4 decimals (5 Oct),
// and the 6 Oct rulings: a different expiry stays apart; a real cost merged with a $0 or unknown cost gives every
// unit the real cost; different suppliers stay apart, and a lot with no supplier merges into the lot that has one.
// planCutoverLotFolds is the pure plan the parent's fold stage executes. Every case below has a discriminating
// wrong answer next to the right one.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function modules() {
  const cache = new Map()
  function load(name) {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)(request => request.startsWith('.') ? load(path.posix.join(path.posix.dirname(name), request)) : {}, module, module.exports)
    return module.exports
  }
  return load('lib/branchCutoverParent')
}
const parent = modules()
const { planCutoverLotFolds } = parent
const lot = (id, receivedAt, cost, quantity, expiry = null, product = 1, supplierId = null, supplierName = null) => ({ id, product, receivedAt, expiry, cost, quantity, supplierId, supplierName })
const plan = (moved, lots, productId = 1) => planCutoverLotFolds([{ productId, moved, lots }])
const counts = (result) => ({ folds: result.folds.length, expirySplit: result.expirySplit, supplierSplit: result.supplierSplit, roundingSplit: result.roundingSplit,
  uncostedMerges: result.uncostedMerges, freeUnknownMerges: result.freeUnknownMerges, emptySupplierMerges: result.emptySupplierMerges })
const none = { folds: 0, expirySplit: 0, supplierSplit: 0, roundingSplit: 0, uncostedMerges: 0, freeUnknownMerges: 0, emptySupplierMerges: 0 }
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name) }

check('same date at the warehouse: the arrival folds into the pre-existing lot at the weighted average (not the mean)', () => {
  const { folds } = plan([[2, 1]], [lot(1, '2026-09-10', 2, 3), lot(2, '2026-09-10 08:00:00', 6, 1)])
  assert.equal(folds.length, 1)
  assert.deepEqual({ survivor: folds[0].survivor, folded: folds[0].folded, after: folds[0].after, costAfter: folds[0].costAfter }, { survivor: 1, folded: [2], after: [[1, 4], [2, 0]], costAfter: 3 })
  assert.notEqual(folds[0].costAfter, (2 + 6) / 2)
})
check('E5 the blended cost is rounded once to the house 4 decimals (verifier P3), deterministically', () => {
  const fold = plan([[2, 2]], [lot(1, '2026-09-24', 1.0001, 1), lot(2, '2026-09-24', 1.0002, 2)]).folds[0]
  assert.equal(fold.costAfter, 1.0002); assert.notEqual(fold.costAfter, (1.0001 + 2 * 1.0002) / 3)
  const thirds = plan([[2, 2]], [lot(1, '2026-09-24', 1, 1), lot(2, '2026-09-24', 3, 2)]).folds[0]
  assert.equal(thirds.costAfter, 2.3333); assert.notEqual(thirds.costAfter, 7 / 3)
  // value moves by at most half a unit in the 4th place per unit; quantities stay exact
  assert.ok(Math.abs(thirds.costAfter * 3 - 7) <= 0.00005 * 3); assert.deepEqual(thirds.after, [[1, 3], [2, 0]])
  for (let i = 0; i < 3; i++) assert.equal(plan([[2, 2]], [lot(1, '2026-09-24', 1, 1), lot(2, '2026-09-24', 3, 2)]).folds[0].costAfter, 2.3333)
  // equal recorded costs keep more than 4 decimals byte-identical (nothing blends)
  const same = plan([[2, 1]], [lot(1, '2026-01-01', 1.234567, 3), lot(2, '2026-01-01', 1.234567, 1)]).folds[0]
  assert.ok(Object.is(same.costAfter, 1.234567))
})
check('E4 the merge key is the Cambodia business day: verifier P2a merges, P2b stays apart', () => {
  // P2a: 18:00 UTC on 12 Sep is 01:00 on 13 Sep in Cambodia
  const p2a = plan([[2, 1]], [lot(1, '2026-09-13', 2, 1), lot(2, '2026-09-12T18:00:00Z', 2, 1)])
  assert.deepEqual(p2a.folds.map(f => [f.survivor, f.folded, f.dateKey]), [[1, [2], '2026-09-13']])
  // P2b: 20:00 UTC on 12 Sep is 03:00 on 13 Sep in Cambodia, not 12 Sep
  const p2b = plan([[2, 1]], [lot(1, '2026-09-12', 3, 1), lot(2, '2026-09-12T20:00:00Z', 3, 1)])
  assert.deepEqual(counts(p2b), none)
  // naive timestamps are UTC (house convention); explicit zones are honoured; 16:59 UTC is still the same day
  assert.equal(plan([[2, 1]], [lot(1, '2026-09-12', 1, 1), lot(2, '2026-09-12 16:59:59', 1, 1)]).folds.length, 1)
  assert.equal(plan([[2, 1]], [lot(1, '2026-09-13', 1, 1), lot(2, '2026-09-12 17:00:00', 1, 1)]).folds.length, 1)
  assert.equal(plan([[2, 1]], [lot(1, '2026-09-12', 1, 1), lot(2, '2026-09-12T23:30:00+07:00', 1, 1)]).folds.length, 1)
  assert.deepEqual(['2026-09-12', ' 2026-09-12 ', '2026-09-12T18:00:00Z', '2026-09-12 10:00:00', 'not a date', '', null].map(parent.cutoverLotBusinessDay),
    ['2026-09-12', '2026-09-12', '2026-09-13', '2026-09-12', null, null, null])
  const moved = plan([[1, 1], [2, 3]], [lot(1, '2026-09-12', 1, 1), lot(2, '2026-09-12T10:30:00Z', 4, 3)]).folds
  assert.deepEqual([moved[0].survivor, moved[0].folded, moved[0].costAfter], [1, [2], 3.25])
})
check('owner 6 Oct: the DATE decides, whatever text stored it; slash dates are month-first (the Aug-28 batch(mm/dd/yyyy) column, 0077)', () => {
  // an ISO and a slash date on the same day merge
  const same = plan([[2, 1]], [lot(1, '2026-08-24', 2, 1), lot(2, '08/24/2026', 4, 1)])
  assert.deepEqual(same.folds.map(f => [f.survivor, f.folded, f.dateKey, f.costAfter]), [[1, [2], '2026-08-24', 3]])
  // the control: keyed as its own text ('08/24/2026' <> '2026-08-24') they would stay apart
  assert.notEqual(parent.cutoverLotBusinessDay('08/24/2026'), '08/24/2026')
  // an ambiguous value (both parts <= 12) follows the proven order: 4/8 is 8 April, never 4 August
  const ambiguous = plan([[3, 1]], [lot(1, '2026-08-04', 5, 1), lot(2, '2026-04-08', 1, 1), lot(3, '4/8/2026', 3, 1)])
  assert.deepEqual(ambiguous.folds.map(f => [f.survivor, f.folded, f.dateKey]), [[2, [3], '2026-04-08']])
  // a value with no month-first reading is no date: it never merges, even where day-first would match
  assert.deepEqual(counts(plan([[2, 1]], [lot(1, '2026-08-24', 1, 1), lot(2, '24/08/2026', 1, 1)])), none)
  // the business day of a timestamp and of a slash date are one key; padding and outer spaces do not matter
  assert.equal(plan([[2, 1]], [lot(1, '2026-09-12T18:00:00Z', 2, 1), lot(2, ' 9/13/2026 ', 2, 1)]).folds.length, 1)
  assert.deepEqual(['08/24/2026', '8/24/2026', '08/4/2026', '8/4/2026', '02/29/2028', '02/29/2026', '13/01/2026', '00/10/2026', '08/24/26', '08/24/2026 10:00', '08-24-2026']
    .map(parent.cutoverLotBusinessDay), ['2026-08-24', '2026-08-24', '2026-08-04', '2026-08-04', '2028-02-29', null, null, null, null, null, null])
})
check('survivor is the lowest-id pre-existing lot; a shared batch is pre-existing; other pre-existing same-date lots stay', () => {
  const { folds } = plan([[1, 1], [3, 2]], [lot(1, '2026-09-03', 2, 2), lot(2, '2026-09-03', 2, 2), lot(3, '2026-09-03', 4, 2)])
  assert.deepEqual([folds[0].survivor, folds[0].folded, folds[0].after, folds[0].costAfter], [1, [3], [[1, 4], [3, 0]], 3])
  const noPrior = plan([[5, 1], [4, 2]], [lot(4, '2026-09-03', 1, 2), lot(5, '2026-09-03', 1, 1)]).folds[0]
  assert.equal(noPrior.survivor, 4); assert.deepEqual(noPrior.folded, [5]); assert.equal(noPrior.costAfter, 1)
})
check('different expiry stays apart and is counted', () => {
  const expiry = plan([[2, 2]], [lot(1, '2026-09-15', 2, 2, '2027-01-01'), lot(2, '2026-09-15', 3, 2, '2027-06-01')])
  assert.deepEqual(counts(expiry), { ...none, expirySplit: 1 })
})
check('owner 6 Oct: a real cost with a $0 or unknown cost MERGES and every unit takes the real cost (never weighted with $0)', () => {
  for (const [a, b] of [[null, 5], [0, 5], [5, null], [5, 0]]) {
    const result = plan([[2, 2]], [lot(1, '2026-09-20', a, 2), lot(2, '2026-09-20', b, 2)])
    assert.deepEqual(counts(result), { ...none, folds: 1, uncostedMerges: 1 }, JSON.stringify([a, b]))
    const fold = result.folds[0]
    assert.deepEqual([fold.survivor, fold.after, fold.costAfter, fold.costClass], [1, [[1, 4], [2, 0]], 5, 'recorded'], JSON.stringify([a, b]))
    assert.deepEqual(fold.uncosted, [a === 5 ? 2 : 1])
    assert.notEqual(fold.costAfter, 2.5, 'weighting with $0 would halve the cost')
  }
  // two real costs and one unknown: the average is over the real costs only
  const mixed = plan([[2, 1], [3, 4]], [lot(1, '2026-09-20', 2, 1), lot(2, '2026-09-20', 4, 1), lot(3, '2026-09-20', null, 4)]).folds[0]
  assert.deepEqual([mixed.survivor, mixed.folded, mixed.costAfter, mixed.uncosted], [1, [2, 3], 3, [3]])
  const unknown = plan([[2, 3]], [lot(1, '2026-09-20', null, 2), lot(2, '2026-09-20', null, 3)]).folds[0]
  assert.deepEqual([unknown.costClass, unknown.costAfter, unknown.after, unknown.uncosted, unknown.freeToUnknown], ['unknown', null, [[1, 5], [2, 0]], [], []])
  const free = plan([[2, 3]], [lot(1, '2026-09-20', 0, 2), lot(2, '2026-09-20', 0, 3)]).folds[0]
  assert.deepEqual([free.costClass, free.costAfter], ['zero', 0])
})
check('owner 6 Oct (final): $0 + unknown with no real cost MERGE and the merged cost is UNKNOWN (NULL), never $0', () => {
  for (const [a, b] of [[0, null], [null, 0]]) {
    const result = plan([[2, 3]], [lot(1, '2026-09-21', a, 2), lot(2, '2026-09-21', b, 3)])
    assert.deepEqual(counts(result), { ...none, folds: 1, freeUnknownMerges: 1 }, JSON.stringify([a, b]))
    const fold = result.folds[0]
    assert.deepEqual([fold.survivor, fold.folded, fold.after, fold.costClass, fold.uncosted, fold.freeToUnknown], [1, [2], [[1, 5], [2, 0]], 'unknown', [], [a === 0 ? 1 : 2]])
    assert.ok(Object.is(fold.costAfter, null), 'never $0: ' + JSON.stringify([a, b]))
    assert.equal(fold.costBefore, a)
  }
  // several free and unknown lots: one lot, unknown cost; with a real cost present the real cost still wins
  const many = plan([[2, 1], [3, 1], [4, 1]], [lot(1, '2026-09-21', 0, 1), lot(2, '2026-09-21', null, 1), lot(3, '2026-09-21', 0, 1), lot(4, '2026-09-21', null, 1)]).folds[0]
  assert.deepEqual([many.folded, many.costAfter, many.freeToUnknown], [[2, 3, 4], null, [1, 3]])
  const real = plan([[2, 1], [3, 1]], [lot(1, '2026-09-21', 0, 1), lot(2, '2026-09-21', null, 1), lot(3, '2026-09-21', 4, 1)])
  assert.deepEqual([counts(real), real.folds[0].costAfter], [{ ...none, folds: 1, uncostedMerges: 1 }, 4])
  // the earlier rulings stand: a different expiry or two suppliers still keep a $0/unknown pair apart
  assert.deepEqual(counts(plan([[2, 2]], [lot(1, '2026-09-21', 0, 2, '2027-01-01'), lot(2, '2026-09-21', null, 2, '2027-02-01')])), { ...none, expirySplit: 1 })
  assert.deepEqual(counts(plan([[2, 2]], [lot(1, '2026-09-21', 0, 2, null, 1, 11), lot(2, '2026-09-21', null, 2, null, 1, 12)])), { ...none, supplierSplit: 1 })
})
check('owner 6 Oct: different suppliers stay apart; a lot with no supplier merges into the lot that has one', () => {
  // verifier P4: Supplier A at the warehouse, Supplier B arriving
  const p4 = plan([[2, 2]], [lot(1, '2026-09-22', 1, 1, null, 1, 11), lot(2, '2026-09-22', 3, 2, null, 1, 12)])
  assert.deepEqual(counts(p4), { ...none, supplierSplit: 1 })
  // the warehouse lot has no supplier, the arriving lot has one: the arriving lot survives and the warehouse lot folds in
  const empty = plan([[2, 1]], [lot(1, '2026-09-23', 2, 1), lot(2, '2026-09-23', 2, 1, null, 1, 11)])
  assert.deepEqual(counts(empty), { ...none, folds: 1, emptySupplierMerges: 1 })
  assert.deepEqual([empty.folds[0].survivor, empty.folds[0].folded, empty.folds[0].after, empty.folds[0].supplierKey, empty.folds[0].emptySupplier], [2, [1], [[2, 2], [1, 0]], 'id:11', [1]])
  // the arriving lot has no supplier, the warehouse lot has one: the warehouse lot survives
  const arriving = plan([[2, 1]], [lot(1, '2026-09-23', 2, 1, null, 1, 11), lot(2, '2026-09-23', 2, 1)]).folds[0]
  assert.deepEqual([arriving.survivor, arriving.folded, arriving.emptySupplier], [1, [2], [2]])
  // a supplier recorded by name only is the same supplier on both lots (case and spaces ignored)
  const named = plan([[2, 1]], [lot(1, '2026-09-23', 2, 1, null, 1, null, 'Acme Co'), lot(2, '2026-09-23', 2, 1, null, 1, null, ' acme co ')])
  assert.deepEqual(counts(named), { ...none, folds: 1 })
  // two suppliers on one day: a lot with no supplier cannot pick one and stays apart
  const ambiguous = plan([[3, 1]], [lot(1, '2026-09-23', 2, 1, null, 1, 11), lot(2, '2026-09-23', 2, 1, null, 1, 12), lot(3, '2026-09-23', 2, 1)])
  assert.deepEqual(counts(ambiguous), { ...none, supplierSplit: 1 })
  assert.deepEqual(['id:7', 'name:acme', '', ''], [{ supplierId: 7, supplierName: 'X' }, { supplierId: null, supplierName: ' ACME ' }, { supplierId: null, supplierName: '  ' }, {}].map(parent.cutoverSupplierKey))
})
check('no received date never merges; value is conserved exactly when no rounding applies', () => {
  assert.equal(plan([[2, 1]], [lot(1, null, 1, 2), lot(2, null, 1, 1)]).folds.length, 0)
  assert.equal(plan([[2, 1]], [lot(1, 'not a date', 1, 2), lot(2, 'not a date', 1, 1)]).folds.length, 0)
  const same = plan([[2, 1]], [lot(1, '2026-01-01', 0.1, 3), lot(2, '2026-01-01', 0.1, 1)]).folds[0]
  assert.equal(same.costAfter, same.costBefore); assert.ok(Object.is(same.costAfter, 0.1))
  const fractional = plan([[1, 2.5]], [lot(1, '2026-09-01', 1.1, 2.5), lot(2, '2026-09-01', 3.3, 1.25)]).folds[0]
  assert.equal(fractional.survivor, 2); assert.deepEqual(fractional.after, [[2, 3.75], [1, 0]])
  assert.equal(fractional.costAfter, 1.8333); assert.ok(Math.abs(fractional.costAfter * 3.75 - (1.25 * 3.3 + 2.5 * 1.1)) <= 0.00005 * 3.75)
})
check('three arrivals and two dates in one product produce one fold per date', () => {
  const { folds } = plan([[2, 1], [3, 1], [5, 2]], [lot(1, '2026-02-01', 1, 1), lot(2, '2026-02-01', 3, 1), lot(3, '2026-02-01', 5, 1), lot(4, '2026-03-01', 1, 1), lot(5, '2026-03-01', 4, 2)])
  assert.deepEqual(folds.map(f => [f.survivor, f.folded, f.costAfter]), [[1, [2, 3], 3], [4, [5], 3]])
})
check('inconsistent inputs refuse: moved more than the target holds, moved lot missing, inexact quantity', () => {
  assert.throws(() => plan([[1, 5]], [lot(1, '2026-01-01', 1, 2)]), /fold_moved_exceeds_target/)
  assert.throws(() => plan([[9, 1]], [lot(1, '2026-01-01', 1, 2)]), /fold_moved_lot_missing/)
  assert.throws(() => plan([[1, 0.1 + 0.2]], [lot(1, '2026-01-01', 1, 1)]), /quantity_requires_exact/)
  assert.throws(() => plan([[9, 1]], [lot(1, '2026-01-01', 1, 2), lot(9, '2026-01-01', 1, 1, null, 2)]), /fold_moved_lot_missing/, 'a lot of another product is never folded in')
  // a blend that would round to free never stops the run: the lots stay apart and are counted
  assert.deepEqual(counts(plan([[2, 1]], [lot(1, '2026-01-01', 0.00001, 1), lot(2, '2026-01-01', 0.00002, 1)])), { ...none, roundingSplit: 1 })
})
check('SQL twins: the business day and supplier key computed in SQLite equal the JS rule (fold preview, rehearsal queries)', () => {
  const raw = new DatabaseSync(':memory:')
  const days = ['2026-09-12', ' 2026-09-12 ', '2026-09-12T18:00:00Z', '2026-09-12T16:59:59Z', '2026-09-12 17:00:00', '2026-09-12T23:30:00+07:00',
    '2026-09-12T10:00:00.123Z', '2026-12-31 20:00:00', 'not a date', '', '2026-09-12garbage', null]
  const day = raw.prepare(`SELECT ${parent.cutoverLotDaySql('?1')} AS d`)
  for (const value of days) assert.equal(day.get(value).d, parent.cutoverLotBusinessDay(value), String(value))
  // every month 0..13 x day 0..32 in four years (leap, common, century, 400-year), as M/D/YYYY, MM/DD/YYYY and ISO
  let swept = 0
  for (const year of ['2024', '2026', '2100', '2000']) for (let m = 0; m <= 13; m++) for (let d = 0; d <= 32; d++) {
    const [mm, dd] = [String(m).padStart(2, '0'), String(d).padStart(2, '0')]
    for (const value of [`${m}/${d}/${year}`, `${mm}/${dd}/${year}`, `${year}-${mm}-${dd}`]) { assert.equal(day.get(value).d, parent.cutoverLotBusinessDay(value), value); swept++ }
  }
  // what SQLite's trim() and date() tolerate and V8 does not (and back): both twins must refuse the same text
  for (const value of ['\t2026-09-12', '2026-09-12\n', '\u00a008/24/2026', '08/24/2026\t', '2026-09-12 10:00:00\n', '2026-09-1210:00:00', '2026-09-12TT10:00',
    '2026-09-12T23:30:00+0700', '2026-09-12T23:30:00 Z', '2026-09-12T23:30:00 +07:00', '2026-09-12  10:00', '2026-09-12T1:00Z', '１２/01/2026']) {
    assert.equal(day.get(value).d, parent.cutoverLotBusinessDay(value), JSON.stringify(value))
  }
  // timestamp tails built from tokens: no text where the two twins disagree
  const tokens = ['', '0', '1', '00', '9', '23', ':', '.', 'Z', 'z', 'T', ' ', '+', '-', '07', '0700', '07:00', '\n', '\t', 'x', '59', '60', '123']
  let state = 1; const next = (n) => (state = (state * 1103515245 + 12345) % 2147483648) % n
  for (let i = 0; i < 20000; i++) {
    let value = '2026-09-12' + [' ', 'T', '', 'TT'][next(4)]
    for (let k = 1 + next(7); k > 0; k--) value += tokens[next(tokens.length)]
    assert.equal(day.get(value).d, parent.cutoverLotBusinessDay(value), JSON.stringify(value))
  }
  assert.equal(swept, 4 * 14 * 33 * 3)
  for (const [id, name] of [[7, 'X'], [null, ' ACME '], [null, '  '], [null, null], [7, null], [null, 'ÉLAN'], [null, ' Élan '], [null, '\tAcme'], [null, 'Acme\n']]) {
    assert.equal(raw.prepare(`SELECT ${parent.cutoverSupplierKeySql('?1', '?2')} AS k`).get(id, name).k, parent.cutoverSupplierKey({ supplierId: id, supplierName: name }), JSON.stringify([id, name]))
  }
  raw.close()
})
console.log(`${checks} branch cutover fold pure checks passed`)
