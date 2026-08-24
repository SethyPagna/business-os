// Pure regression test for lib/datedStockCountImport.ts's
// computeDatedStockCountPlan -- the correctness-critical core of the
// dated stock-count import (Part 234/235's spec, built Part 239). No DB,
// no CSV parsing -- just the plan-computation function against
// hand-built inputs, transpiled from the real source the same way this
// codebase's other *-pure.cjs tests load a lib file without a build step.
//
// Run: node scripts/test-dated-stock-count-plan-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'datedStockCountImport.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
})
const moduleObj = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { computeDatedStockCountPlan, DATED_STOCK_COUNT_REASON } = moduleObj.exports

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function entry(date, count, overrides = {}) {
  return { date, productId: 1, productName: 'Eye Shadow Palette', branchId: 1, branchName: 'Shop', count, ...overrides }
}

check('fresh import, single date: one delta movement created against live stock, final matches the count', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-01', 15)],
    [],
    [{ productId: 1, branchId: 1, quantity: 10 }],
  )
  assert.strictEqual(plan.movementsToDelete.length, 0)
  assert.strictEqual(plan.movementsToCreate.length, 1)
  assert.strictEqual(plan.movementsToCreate[0].movementType, 'add')
  assert.strictEqual(plan.movementsToCreate[0].quantity, 5)
  assert.strictEqual(plan.movementsToCreate[0].date, '2026-08-01')
  assert.strictEqual(plan.movementsToCreate[0].reason, DATED_STOCK_COUNT_REASON)
  assert.deepStrictEqual(plan.finalBranchStock, [{ productId: 1, branchId: 1, quantity: 15 }])
})

check('a delta of zero (count matches current running value) creates no movement', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-01', 10)],
    [],
    [{ productId: 1, branchId: 1, quantity: 10 }],
  )
  assert.strictEqual(plan.movementsToCreate.length, 0)
  assert.deepStrictEqual(plan.finalBranchStock, [{ productId: 1, branchId: 1, quantity: 10 }])
})

check('sequential dated series for one product+branch applies earliest-to-latest, not latest-wins (Part 234 spec)', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-03', 18), entry('2026-08-01', 20), entry('2026-08-02', 15)], // deliberately out of order in the input
    [],
    [{ productId: 1, branchId: 1, quantity: 10 }],
  )
  assert.strictEqual(plan.movementsToCreate.length, 3)
  assert.deepStrictEqual(plan.movementsToCreate.map((m) => m.date), ['2026-08-01', '2026-08-02', '2026-08-03'])
  assert.deepStrictEqual(plan.movementsToCreate.map((m) => [m.movementType, m.quantity]), [
    ['add', 10],   // 10 -> 20
    ['remove', 5], // 20 -> 15
    ['add', 3],    // 15 -> 18
  ])
  assert.deepStrictEqual(plan.finalBranchStock, [{ productId: 1, branchId: 1, quantity: 18 }])
})

check('rerunning the identical import is idempotent: deletes its own prior movements, recomputes the same result, does not double-count', () => {
  const entries = [entry('2026-08-01', 20), entry('2026-08-02', 15), entry('2026-08-03', 18)]
  const first = computeDatedStockCountPlan(entries, [], [{ productId: 1, branchId: 1, quantity: 10 }])
  assert.strictEqual(first.movementsToCreate.length, 3)

  // Simulate the DB state after the first run actually applied: live
  // stock is now 18 (the group's final value), and the movements table
  // holds the 3 movements the first plan created.
  const existingAfterFirstRun = first.movementsToCreate.map((m, i) => ({
    id: 100 + i,
    productId: m.productId,
    branchId: m.branchId,
    date: m.date,
    signedQuantity: m.movementType === 'add' ? m.quantity : -m.quantity,
  }))

  const rerun = computeDatedStockCountPlan(
    entries,
    existingAfterFirstRun,
    [{ productId: 1, branchId: 1, quantity: 18 }], // live stock reflects the first run now, NOT the original 10
  )
  assert.deepStrictEqual(rerun.movementsToDelete.sort(), [100, 101, 102])
  assert.strictEqual(rerun.movementsToCreate.length, 3)
  assert.deepStrictEqual(rerun.movementsToCreate.map((m) => [m.movementType, m.quantity]), [
    ['add', 10],
    ['remove', 5],
    ['add', 3],
  ])
  assert.deepStrictEqual(rerun.finalBranchStock, [{ productId: 1, branchId: 1, quantity: 18 }])
})

check('a corrected rerun (one date\'s count value changed) recomputes deltas fresh, not a no-op', () => {
  const originalEntries = [entry('2026-08-01', 20), entry('2026-08-02', 15), entry('2026-08-03', 18)]
  const first = computeDatedStockCountPlan(originalEntries, [], [{ productId: 1, branchId: 1, quantity: 10 }])
  const existingAfterFirstRun = first.movementsToCreate.map((m, i) => ({
    id: 200 + i,
    productId: m.productId,
    branchId: m.branchId,
    date: m.date,
    signedQuantity: m.movementType === 'add' ? m.quantity : -m.quantity,
  }))

  // Corrected upload: Aug 2's count was actually 12, not 15.
  const correctedEntries = [entry('2026-08-01', 20), entry('2026-08-02', 12), entry('2026-08-03', 18)]
  const corrected = computeDatedStockCountPlan(
    correctedEntries,
    existingAfterFirstRun,
    [{ productId: 1, branchId: 1, quantity: 18 }],
  )
  assert.deepStrictEqual(corrected.movementsToDelete.sort(), [200, 201, 202])
  assert.deepStrictEqual(corrected.movementsToCreate.map((m) => [m.date, m.movementType, m.quantity]), [
    ['2026-08-01', 'add', 10],    // 10 -> 20, unchanged
    ['2026-08-02', 'remove', 8],  // 20 -> 12, corrected (was remove 5 to 15)
    ['2026-08-03', 'add', 6],     // 12 -> 18, recomputed against the corrected baseline
  ])
  assert.deepStrictEqual(corrected.finalBranchStock, [{ productId: 1, branchId: 1, quantity: 18 }])
})

check('an existing count movement on a DIFFERENT date (not in this import) is left untouched, not deleted', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-02', 15)],
    [{ id: 999, productId: 1, branchId: 1, date: '2026-07-15', signedQuantity: 4 }],
    [{ productId: 1, branchId: 1, quantity: 14 }],
  )
  assert.strictEqual(plan.movementsToDelete.length, 0)
  assert.strictEqual(plan.movementsToCreate.length, 1)
  assert.deepStrictEqual(plan.movementsToCreate[0], {
    productId: 1, productName: 'Eye Shadow Palette', branchId: 1, branchName: 'Shop',
    date: '2026-08-02', quantity: 1, movementType: 'add', reason: DATED_STOCK_COUNT_REASON,
  })
})

check('multiple product+branch groups in one import are computed fully independently', () => {
  const plan = computeDatedStockCountPlan(
    [
      entry('2026-08-01', 20, { productId: 1, branchId: 1 }),
      entry('2026-08-01', 5, { productId: 2, productName: 'Lip Gloss', branchId: 1 }),
      entry('2026-08-01', 30, { productId: 1, branchId: 2, branchName: 'Warehouse' }),
    ],
    [],
    [
      { productId: 1, branchId: 1, quantity: 10 },
      { productId: 2, branchId: 1, quantity: 5 },
      { productId: 1, branchId: 2, quantity: 25 },
    ],
  )
  assert.strictEqual(plan.movementsToCreate.length, 2) // product 2's count matched live stock exactly -- no movement
  const finalByKey = Object.fromEntries(plan.finalBranchStock.map((s) => [`${s.productId}:${s.branchId}`, s.quantity]))
  assert.strictEqual(finalByKey['1:1'], 20)
  assert.strictEqual(finalByKey['2:1'], 5)
  assert.strictEqual(finalByKey['1:2'], 30)
})

check('the same product counted at two different branches (shop + warehouse columns in one source row) produces two independent movements', () => {
  const plan = computeDatedStockCountPlan(
    [
      entry('2026-08-01', 12, { branchId: 1, branchName: 'Shop' }),
      entry('2026-08-01', 40, { branchId: 2, branchName: 'Warehouse' }),
    ],
    [],
    [
      { productId: 1, branchId: 1, quantity: 10 },
      { productId: 1, branchId: 2, quantity: 35 },
    ],
  )
  assert.strictEqual(plan.movementsToCreate.length, 2)
  assert.deepStrictEqual(plan.movementsToCreate.map((m) => [m.branchName, m.movementType, m.quantity]).sort(), [
    ['Shop', 'add', 2],
    ['Warehouse', 'add', 5],
  ])
})

// --- Batch-level FIFO layer (item 3's spec, added Part 278) ---

check('a fresh import with no existing batches: each add date creates its own new batch, dated to that date', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-01', 10), entry('2026-08-03', 16)],
    [],
    [{ productId: 1, branchId: 1, quantity: 0 }],
    [],
  )
  assert.strictEqual(plan.batchCreates.length, 2)
  assert.deepStrictEqual(plan.batchCreates.map((c) => [c.date, c.quantity]).sort(), [
    ['2026-08-01', 10],
    ['2026-08-03', 6],
  ])
  assert.strictEqual(plan.batchTopUps.length, 0)
  assert.strictEqual(plan.batchDrains.length, 0)
})

check('a same-day add on an existing batch date tops up that real batch instead of creating a new one', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-01', 25)],
    [],
    [{ productId: 1, branchId: 1, quantity: 10 }],
    [{ batchId: 501, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }],
  )
  assert.strictEqual(plan.batchCreates.length, 0)
  assert.deepStrictEqual(plan.batchTopUps, [{ productId: 1, branchId: 1, batchId: 501, date: '2026-08-01', quantity: 15 }])
})

check('a later decrease FIFO-drains the earliest still-open batch first, across two real existing batches', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-05', 12)], // 30 -> 12, a decrease of 18
    [],
    [{ productId: 1, branchId: 1, quantity: 30 }],
    [
      { batchId: 601, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }, // oldest, drained first
      { batchId: 602, productId: 1, branchId: 1, date: '2026-08-03', quantity: 20 },
    ],
  )
  assert.deepStrictEqual(plan.batchDrains.sort((a, b) => a.batchId - b.batchId), [
    { productId: 1, branchId: 1, batchId: 601, quantity: 10 }, // fully drained
    { productId: 1, branchId: 1, batchId: 602, quantity: 8 },  // partial
  ])
  assert.deepStrictEqual(plan.batchDeactivations, [{ productId: 1, branchId: 1, batchId: 601 }])
})

check('an earlier-date add followed by a same-run later-date decrease drains the batch this run just created (not a real batchId, folded into a smaller create)', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-01', 10), entry('2026-08-02', 4)], // add 10 on day 1, remove 6 on day 2
    [],
    [{ productId: 1, branchId: 1, quantity: 0 }],
    [],
  )
  assert.deepStrictEqual(plan.batchCreates, [{ productId: 1, branchId: 1, date: '2026-08-01', quantity: 4 }])
  assert.strictEqual(plan.batchDrains.length, 0) // nothing real to drain, it was this run's own pending batch
})

check('a decrease bigger than tracked batches can cover leaves the shortfall untracked at the batch level (mirrors removeStockAcrossBatches\'s remainder convention)', () => {
  const plan = computeDatedStockCountPlan(
    [entry('2026-08-05', 2)], // 30 -> 2, a decrease of 28, but only 10 is batch-tracked
    [],
    [{ productId: 1, branchId: 1, quantity: 30 }],
    [{ batchId: 701, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }],
  )
  assert.deepStrictEqual(plan.batchDrains, [{ productId: 1, branchId: 1, batchId: 701, quantity: 10 }])
  assert.deepStrictEqual(plan.batchDeactivations, [{ productId: 1, branchId: 1, batchId: 701 }])
  // The aggregate movement still reflects the full delta regardless.
  assert.strictEqual(plan.movementsToCreate[0].quantity, 28)
})

check('an identical rerun (batch provenance recorded on the prior movement) recomputes the SAME batch top-up, not zero and not doubled (migration 0035)', () => {
  const first = computeDatedStockCountPlan(
    [entry('2026-08-01', 10)],
    [],
    [{ productId: 1, branchId: 1, quantity: 0 }],
    [],
  )
  assert.strictEqual(first.batchCreates.length, 1)

  // Batch 801 is the real batch the first run's receiveBatchStock would
  // have created/topped-up, now sitting at quantity 10 live -- and the
  // prior movement carries that same effect as its own recorded
  // provenance (batchActions), exactly what datedStockCountRoute.ts's DB
  // lookup would hand back.
  const existingAfterFirstRun = [{
    id: 900, productId: 1, branchId: 1, date: '2026-08-01', signedQuantity: 10,
    batchActions: [{ batchId: 801, quantity: 10 }],
  }]
  const rerun = computeDatedStockCountPlan(
    [entry('2026-08-01', 10)],
    existingAfterFirstRun,
    [{ productId: 1, branchId: 1, quantity: 10 }],
    [{ batchId: 801, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }],
  )
  // Reconstructed baseline undoes the prior +10 on batch 801 (back to 0),
  // then replays the same +10 -- lands back on the existing dated batch
  // as a top-up (not a fresh create, since a batch already exists dated
  // 2026-08-01), same real batch row both times.
  assert.deepStrictEqual(rerun.batchTopUps, [{ productId: 1, branchId: 1, batchId: 801, date: '2026-08-01', quantity: 10 }])
  assert.strictEqual(rerun.batchCreates.length, 0)
  assert.strictEqual(rerun.batchDrains.length, 0)
})

check('a CORRECTED rerun (count value changed) recomputes real batch actions fresh against the reconstructed baseline, not skipped', () => {
  const existingAfterFirstRun = [{
    id: 900, productId: 1, branchId: 1, date: '2026-08-01', signedQuantity: 10,
    batchActions: [{ batchId: 801, quantity: 10 }],
  }]
  // Count corrected from 10 to 15 on rerun; live batch 801 still shows
  // the first run's 10 (nothing else has touched it since).
  const rerun = computeDatedStockCountPlan(
    [entry('2026-08-01', 15)],
    existingAfterFirstRun,
    [{ productId: 1, branchId: 1, quantity: 10 }],
    [{ batchId: 801, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }],
  )
  assert.strictEqual(rerun.movementsToCreate[0].quantity, 15) // baseline reconstructs to 0, so full 15 is the fresh delta
  assert.deepStrictEqual(rerun.batchTopUps, [{ productId: 1, branchId: 1, batchId: 801, date: '2026-08-01', quantity: 15 }])
})

check('a prior movement with NO batchActions (predates migration 0035, or never touched a tracked batch) leaves the live batch baseline untouched on rerun', () => {
  const existingAfterFirstRun = [{ id: 900, productId: 1, branchId: 1, date: '2026-08-01', signedQuantity: 10 }] // no batchActions field at all
  const rerun = computeDatedStockCountPlan(
    [entry('2026-08-01', 10)],
    existingAfterFirstRun,
    [{ productId: 1, branchId: 1, quantity: 10 }],
    [{ batchId: 801, productId: 1, branchId: 1, date: '2026-08-01', quantity: 10 }],
  )
  // No provenance to undo -> reconstructed baseline is the live 10 as-is
  // -> delta of 10 (count) - running(10, the aggregate baseline is
  // separately reconstructed via signedQuantity and lands at 0, so the
  // aggregate delta is still +10) replayed against a lot that already
  // holds 10 tops it up by another 10, to 20 -- this is the accepted
  // "can't safely reverse what was never recorded" gap, not a crash.
  assert.deepStrictEqual(rerun.batchTopUps, [{ productId: 1, branchId: 1, batchId: 801, date: '2026-08-01', quantity: 10 }])
})

check('batch actions for multiple product+branch groups stay independent, same as the aggregate movement plan', () => {
  const plan = computeDatedStockCountPlan(
    [
      entry('2026-08-01', 10, { productId: 1, branchId: 1 }),
      entry('2026-08-01', 6, { productId: 2, productName: 'Lip Gloss', branchId: 1 }),
    ],
    [],
    [
      { productId: 1, branchId: 1, quantity: 0 },
      { productId: 2, branchId: 1, quantity: 0 },
    ],
    [],
  )
  assert.strictEqual(plan.batchCreates.length, 2)
  const byProduct = Object.fromEntries(plan.batchCreates.map((c) => [c.productId, c.quantity]))
  assert.strictEqual(byProduct[1], 10)
  assert.strictEqual(byProduct[2], 6)
})

console.log(`\n${passed} PASS, 0 FAIL`)
