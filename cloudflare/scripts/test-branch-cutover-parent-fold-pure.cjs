// Owner rule (5 Oct 2026): at the cutover, lots received on the same DATE merge into one lot at LC Store,
// and a cost difference resolves to the quantity-weighted average. planCutoverLotFolds is the pure plan the
// parent's fold stage executes. Every case below has a discriminating wrong answer next to the right one.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
const { planCutoverLotFolds } = modules()
const lot = (id, receivedAt, cost, quantity, expiry = null, product = 1, supplierId = null) => ({ id, product, receivedAt, expiry, cost, quantity, supplierId })
const plan = (moved, lots, productId = 1) => planCutoverLotFolds([{ productId, moved, lots }])
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name) }

check('same date at the warehouse: the arrival folds into the pre-existing lot at the weighted average (not the mean)', () => {
  const { folds } = plan([[2, 1]], [lot(1, '2026-09-10', 2, 3), lot(2, '2026-09-10 08:00:00', 6, 1)])
  assert.equal(folds.length, 1)
  assert.deepEqual({ survivor: folds[0].survivor, folded: folds[0].folded, after: folds[0].after, costAfter: folds[0].costAfter }, { survivor: 1, folded: [2], after: [[1, 4], [2, 0]], costAfter: 3 })
  assert.notEqual(folds[0].costAfter, (2 + 6) / 2)
})
check('date only: time of day and ISO form do not split a date; different dates never merge', () => {
  assert.deepEqual(plan([[2, 3]], [lot(1, '2026-09-12', 1, 1), lot(2, '2026-09-12T23:30:00Z', 4, 3)]).folds.map(f => [f.survivor, f.folded]), [[1, [2]]])
  const moved = plan([[1, 1], [2, 3]], [lot(1, '2026-09-12', 1, 1), lot(2, '2026-09-12T23:30:00Z', 4, 3)]).folds
  assert.deepEqual([moved[0].survivor, moved[0].folded, moved[0].costAfter], [1, [2], 3.25])
  assert.equal(plan([[2, 1]], [lot(1, '2026-09-10', 2, 3), lot(2, '2026-09-11', 6, 1)]).folds.length, 0)
})
check('survivor is the lowest-id pre-existing lot; a shared batch is pre-existing; other pre-existing same-date lots stay', () => {
  const { folds } = plan([[1, 1], [3, 2]], [lot(1, '2026-09-03', 2, 2), lot(2, '2026-09-03', 2, 2), lot(3, '2026-09-03', 4, 2)])
  assert.deepEqual([folds[0].survivor, folds[0].folded, folds[0].after, folds[0].costAfter], [1, [3], [[1, 4], [3, 0]], 3])
  const noPrior = plan([[5, 1], [4, 2]], [lot(4, '2026-09-03', 1, 2), lot(5, '2026-09-03', 1, 1)]).folds[0]
  assert.equal(noPrior.survivor, 4); assert.deepEqual(noPrior.folded, [5]); assert.equal(noPrior.costAfter, 1)
})
check('kept apart and counted: different expiry, and a different cost class (recorded / free / unknown)', () => {
  const expiry = plan([[2, 2]], [lot(1, '2026-09-15', 2, 2, '2027-01-01'), lot(2, '2026-09-15', 3, 2, '2027-06-01')])
  assert.deepEqual([expiry.folds.length, expiry.expirySplit, expiry.costSplit], [0, 1, 0])
  for (const [a, b] of [[null, 5], [0, 5], [null, 0]]) {
    const result = plan([[2, 2]], [lot(1, '2026-09-20', a, 2), lot(2, '2026-09-20', b, 2)])
    assert.deepEqual([result.folds.length, result.expirySplit, result.costSplit], [0, 0, 1], JSON.stringify([a, b]))
  }
  const unknown = plan([[2, 3]], [lot(1, '2026-09-20', null, 2), lot(2, '2026-09-20', null, 3)]).folds[0]
  assert.deepEqual([unknown.costClass, unknown.costAfter, unknown.after], ['unknown', null, [[1, 5], [2, 0]]])
  const free = plan([[2, 3]], [lot(1, '2026-09-20', 0, 2), lot(2, '2026-09-20', 0, 3)]).folds[0]
  assert.deepEqual([free.costClass, free.costAfter], ['zero', 0])
})
check('no received date never merges; equal costs stay byte-identical; value is conserved', () => {
  assert.equal(plan([[2, 1]], [lot(1, null, 1, 2), lot(2, null, 1, 1)]).folds.length, 0)
  assert.equal(plan([[2, 1]], [lot(1, 'not a date', 1, 2), lot(2, 'not a date', 1, 1)]).folds.length, 0)
  const same = plan([[2, 1]], [lot(1, '2026-01-01', 0.1, 3), lot(2, '2026-01-01', 0.1, 1)]).folds[0]
  assert.equal(same.costAfter, same.costBefore); assert.ok(Object.is(same.costAfter, 0.1))
  const fractional = plan([[1, 2.5]], [lot(1, '2026-09-01', 1.1, 2.5), lot(2, '2026-09-01', 3.3, 1.25)]).folds[0]
  assert.equal(fractional.survivor, 2); assert.deepEqual(fractional.after, [[2, 3.75], [1, 0]])
  assert.ok(Math.abs(fractional.costAfter * 3.75 - (1.25 * 3.3 + 2.5 * 1.1)) < 1e-12)
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
})
console.log(`${checks} branch cutover fold pure checks passed`)
