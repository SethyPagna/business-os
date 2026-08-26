// Tests for lib/stockActionResolver.ts -- the action/delta kernel of the
// unified Add/Sale/Reconciliation import (progress.md 2.1). Every rule the
// user stated has a case here:
//
//   - DIRECT: the numbers are the change, the action column gives direction.
//   - RECONCILE: the numbers are target totals, the delta gives direction,
//     and an action column that disagrees with the delta is flagged.
//   - sale grouping: 'sale' = one daily receipt; 'saleN' = a specific POS
//     sale that day.
//   - selling/VIP price differences are NOT a conflict; multiple batches at
//     multiple cost prices ARE (flagged with a reason, held for review).
//   - a new product cannot be sold; a sale that goes negative is flagged.
//   - every input row produces exactly one plan (nothing dropped).
//
// Run: node scripts/test-stock-action-resolver-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function loadTs(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

const {
  parseStockAction,
  saleGroupKeyFor,
  resolveRowStockAction,
  detectCostBatchConflicts,
  resolveStockActions,
} = loadTs('src/lib/stockActionResolver.ts')

const SHOP = 1
const WAREHOUSE = 2

let passed = 0
let failed = 0
function check(name, fn) {
  try { fn(); console.log('PASS', name); passed++ }
  catch (err) { console.log('FAIL', name, '--', err.message); failed++ }
}

// ---- parseStockAction ------------------------------------------------------
check('parseStockAction reads blank as auto, add/sale/create, and numbered sales', () => {
  assert.deepStrictEqual(parseStockAction(''), { kind: 'auto', saleOrdinal: null })
  assert.deepStrictEqual(parseStockAction('   '), { kind: 'auto', saleOrdinal: null })
  assert.deepStrictEqual(parseStockAction('add'), { kind: 'add', saleOrdinal: null })
  assert.deepStrictEqual(parseStockAction('Create'), { kind: 'create', saleOrdinal: null })
  assert.deepStrictEqual(parseStockAction('sale'), { kind: 'sale', saleOrdinal: null })
  assert.deepStrictEqual(parseStockAction('Sale 2'), { kind: 'sale', saleOrdinal: 2 })
  assert.deepStrictEqual(parseStockAction('sale3'), { kind: 'sale', saleOrdinal: 3 })
  // An unrecognised action is auto, never dropped -- a typo can't hide a row.
  assert.deepStrictEqual(parseStockAction('slae'), { kind: 'auto', saleOrdinal: null })
})

check('saleGroupKeyFor gives a daily key for a plain sale and a per-sale key when numbered', () => {
  assert.strictEqual(saleGroupKeyFor('2026-08-26', null), '2026-08-26')
  assert.strictEqual(saleGroupKeyFor('2026-08-26', 2), '2026-08-26#2')
})

// ---- DIRECT mode -----------------------------------------------------------
check('DIRECT add: shop +2, warehouse untouched (the user\'s own example)', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 1, date: '2026-08-26', action: 'add', branchValues: [{ branchId: SHOP, value: 2 }, { branchId: WAREHOUSE, value: 0 }] },
    new Map([[SHOP, 5], [WAREHOUSE, 9]]),
    'direct',
  )
  assert.strictEqual(plan.kind, 'add')
  assert.strictEqual(plan.saleGroupKey, null)
  assert.deepStrictEqual(plan.branchActions, [
    { branchId: SHOP, direction: 'add', quantity: 2 },
    { branchId: WAREHOUSE, direction: 'none', quantity: 0 },
  ])
  assert.deepStrictEqual(plan.conflicts, [])
})

check('DIRECT sale: sell 2 from warehouse (the user\'s own example)', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 2, date: '2026-08-26', action: 'sale', branchValues: [{ branchId: SHOP, value: 0 }, { branchId: WAREHOUSE, value: 2 }] },
    new Map([[SHOP, 5], [WAREHOUSE, 9]]),
    'direct',
  )
  assert.strictEqual(plan.kind, 'sale')
  assert.strictEqual(plan.saleGroupKey, '2026-08-26', 'a plain sale groups by day')
  assert.deepStrictEqual(plan.branchActions.find((b) => b.branchId === WAREHOUSE), { branchId: WAREHOUSE, direction: 'sale', quantity: 2 })
})

check('DIRECT sale beyond available stock is flagged, not silently applied', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 3, date: '2026-08-26', action: 'sale', branchValues: [{ branchId: SHOP, value: 10 }] },
    new Map([[SHOP, 4]]),
    'direct',
  )
  assert.strictEqual(plan.kind, 'sale')
  assert.ok(plan.conflicts.some((c) => /exceeds current stock/.test(c)), `expected an over-sell conflict, got ${JSON.stringify(plan.conflicts)}`)
})

check('DIRECT numbered sale carries the per-POS-sale group key', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 4, date: '2026-08-26', action: 'sale2', branchValues: [{ branchId: SHOP, value: 1 }] },
    new Map([[SHOP, 3]]),
    'direct',
  )
  assert.strictEqual(plan.saleGroupKey, '2026-08-26#2')
})

// ---- RECONCILE mode --------------------------------------------------------
check('RECONCILE infers ADD when the target total is above current', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 5, date: '2026-08-26', action: '', branchValues: [{ branchId: SHOP, value: 12 }] },
    new Map([[SHOP, 8]]),
    'reconcile',
  )
  assert.strictEqual(plan.kind, 'add')
  assert.deepStrictEqual(plan.branchActions[0], { branchId: SHOP, direction: 'add', quantity: 4 })
})

check('RECONCILE infers SALE when the target total is below current', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 6, date: '2026-08-26', action: '', branchValues: [{ branchId: WAREHOUSE, value: 3 }] },
    new Map([[WAREHOUSE, 10]]),
    'reconcile',
  )
  assert.strictEqual(plan.kind, 'sale')
  assert.deepStrictEqual(plan.branchActions[0], { branchId: WAREHOUSE, direction: 'sale', quantity: 7 })
})

check('RECONCILE with no change is a noop', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 7, date: '2026-08-26', action: '', branchValues: [{ branchId: SHOP, value: 8 }] },
    new Map([[SHOP, 8]]),
    'reconcile',
  )
  assert.strictEqual(plan.kind, 'noop')
})

check('RECONCILE flags an action column that disagrees with the computed direction', () => {
  // Count rose but the human wrote "sale" -- the same-day add-then-sale case
  // the action column is meant to disambiguate, flagged for review.
  const plan = resolveRowStockAction(
    { rowNumber: 8, date: '2026-08-26', action: 'sale', branchValues: [{ branchId: SHOP, value: 12 }] },
    new Map([[SHOP, 8]]),
    'reconcile',
  )
  assert.ok(plan.conflicts.some((c) => /count rose/.test(c)), `expected a direction-mismatch conflict, got ${JSON.stringify(plan.conflicts)}`)
})

// ---- new product rules -----------------------------------------------------
check('a new product (unmatched name/barcode) becomes a create, not an add', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 9, date: '2026-08-26', action: '', isNewProduct: true, branchValues: [{ branchId: SHOP, value: 5 }] },
    new Map(),
    'direct',
  )
  assert.strictEqual(plan.kind, 'create')
})

check('a sale against a product that does not exist yet is flagged', () => {
  const plan = resolveRowStockAction(
    { rowNumber: 10, date: '2026-08-26', action: 'sale', isNewProduct: true, branchValues: [{ branchId: SHOP, value: 2 }] },
    new Map(),
    'direct',
  )
  assert.ok(plan.conflicts.some((c) => /nothing to sell/.test(c)), `expected a nothing-to-sell conflict, got ${JSON.stringify(plan.conflicts)}`)
})

// ---- cost/batch conflict (the one that gates the import) -------------------
check('selling / VIP price differences alone are NOT a conflict', () => {
  const reasons = detectCostBatchConflicts([
    { rowNumber: 1, identityKey: 'a|b', costPriceUsd: 5, batchLabel: 'L1' },
    { rowNumber: 2, identityKey: 'a|b', costPriceUsd: 5, batchLabel: 'L1' },
  ])
  assert.strictEqual(reasons.size, 0, 'same cost + same batch is never a conflict')
})

check('multiple batches at multiple cost prices IS a conflict, flagged on every affected row', () => {
  const reasons = detectCostBatchConflicts([
    { rowNumber: 1, identityKey: 'a|b', costPriceUsd: 5, batchLabel: 'AUG2026' },
    { rowNumber: 2, identityKey: 'a|b', costPriceUsd: 6, batchLabel: 'SEP2026' },
  ])
  assert.strictEqual(reasons.size, 2, 'both rows of the conflicting group are flagged')
  assert.ok(/different cost prices/.test(reasons.get(1)))
  assert.ok(/different cost prices/.test(reasons.get(2)))
})

check('multiple cost prices but only ONE batch is not flagged (nothing to choose between)', () => {
  const reasons = detectCostBatchConflicts([
    { rowNumber: 1, identityKey: 'a|b', costPriceUsd: 5, batchLabel: 'AUG2026' },
    { rowNumber: 2, identityKey: 'a|b', costPriceUsd: 6, batchLabel: 'AUG2026' },
  ])
  assert.strictEqual(reasons.size, 0)
})

// ---- whole-sheet resolution ------------------------------------------------
check('resolveStockActions produces exactly one plan per row and sets needsReview on any conflict', () => {
  const rows = [
    { rowNumber: 1, date: '2026-08-26', action: 'add', branchValues: [{ branchId: SHOP, value: 2 }], costPriceUsd: 5, batchLabel: 'AUG2026' },
    { rowNumber: 2, date: '2026-08-26', action: 'add', branchValues: [{ branchId: SHOP, value: 3 }], costPriceUsd: 6, batchLabel: 'SEP2026' },
    { rowNumber: 3, date: '2026-08-26', action: 'sale', branchValues: [{ branchId: SHOP, value: 1 }] },
  ]
  // rows 1 & 2 are the SAME product (same identity key) with different cost+batch.
  const identityKeyOf = (row) => (row.rowNumber === 3 ? 'other' : 'a|b')
  const current = [
    { branchId: SHOP, productKey: 'a|b', quantity: 4 },
    { branchId: SHOP, productKey: 'other', quantity: 4 },
  ]
  const { plans, needsReview } = resolveStockActions(rows, current, 'direct', identityKeyOf)
  assert.strictEqual(plans.length, 3, 'every row gets a plan -- none dropped')
  assert.strictEqual(needsReview, true, 'the cost/batch conflict must gate the import')
  assert.ok(plans[0].conflicts.length > 0 && plans[1].conflicts.length > 0, 'both conflicting rows are flagged')
  assert.strictEqual(plans[2].conflicts.length, 0, 'the unrelated sale row is clean')
})

console.log(failed ? `\n${failed} FAILED, ${passed} passed.` : `\nAll ${passed} stock-action-resolver checks passed.`)
process.exit(failed ? 1 : 0)
