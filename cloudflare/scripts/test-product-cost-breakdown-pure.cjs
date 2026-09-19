// P10-6 (owner ruling, 2026-09-16, verbatim): "when clicked on cost price it
// opens a page that tells us the calculated cost price (n_i + n_{i+1} + ... +
// n_{i+k}) / i". This pins the pure assembler behind GET
// /api/products/:id/cost-breakdown (buildCatalogCostBreakdown in
// lib/catalogCostRecompute.ts) with discriminating fixtures: duplicates and a
// zero must be excluded from the mean the same way recomputeCatalogCost's own
// formula excludes them, and a genuine outlier must still be REPORTED, not
// silently averaged.
//
// It loads the REAL lib/catalogCostRecompute.ts, lib/productDetailRule.ts and
// lib/moneyPrecision.ts (transpiled, no D1), so what is asserted is
// production's own selection and formula, not a re-statement of it.
//
// Run (from cloudflare/): node scripts/test-product-cost-breakdown-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const ts = require('typescript')

let checks = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  ok  ${label}`)
    checks++
  } catch (e) {
    console.log(`FAIL ${label} - ${e.message}`)
    process.exitCode = 1
  }
}

const moduleCache = new Map()
function loadTs(relPath) {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  moduleCache.set(relPath, mod.exports) // guard against accidental self-cycles
  const req = (id) => {
    if (id === './db') return {} // type-only import, erased at runtime
    if (id.startsWith('./')) return loadTs(`lib/${id.slice(2)}.ts`)
    return require(id)
  }
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, req)
  moduleCache.set(relPath, mod.exports)
  return mod.exports
}

const { buildCatalogCostBreakdown } = loadTs('lib/catalogCostRecompute.ts')

const lot = (id, unitCostUsd, overrides = {}) => ({
  id,
  batch_number: overrides.batch_number ?? `B${id}`,
  lot_code: overrides.lot_code ?? null,
  received_at: overrides.received_at ?? null,
  branch_name: overrides.branch_name ?? null,
  unit_cost_usd: unitCostUsd,
  is_active: overrides.is_active ?? 1,
})

// ---------------------------------------------------------------------------
// The owner's own worked example: 3.00, 5.00, 5.00, 0 -> distinct [3, 5],
// mean 4.00. The repeated 5 and the 0 must both be visibly excluded, not
// silently dropped.
// ---------------------------------------------------------------------------
check('3, 5, 5(dup), 0(zero) -> distinct [3,5], mean 4.00, result 4.00', () => {
  const lots = [lot(1, 3), lot(2, 5), lot(3, 5), lot(4, 0)]
  const result = buildCatalogCostBreakdown(101, { cost_price_usd: 0, cost_price_khr: 0 }, lots)
  assert.deepEqual(result.distinct_usd, [3, 5])
  assert.equal(result.mean_usd, 4)
  assert.equal(result.result_usd, 4)
  assert.equal(result.outlier_guard.fired, false)
  assert.equal(result.inputs.length, 4)
  assert.equal(result.inputs[0].excluded, null, 'first 3 counts')
  assert.equal(result.inputs[1].excluded, null, 'first 5 counts')
  assert.equal(result.inputs[2].excluded, 'duplicate', 'second 5 is the same distinct cost already counted')
  assert.equal(result.inputs[3].excluded, 'zero', '0 is not a recorded cost')
})

// ---------------------------------------------------------------------------
// Outlier guard: reported, not silently averaged -- same COST_OUTLIER_RATIO
// (2x) as resolveMergedCostDetail/recomputeCatalogCost.
// ---------------------------------------------------------------------------
check('widely separated real receipt costs are averaged without a merge outlier heuristic', () => {
  const lots = [lot(1, 2), lot(2, 200)]
  const result = buildCatalogCostBreakdown(102, { cost_price_usd: 0, cost_price_khr: 0 }, lots)
  assert.deepEqual(result.distinct_usd, [2, 200])
  assert.equal(result.mean_usd, 101, 'the raw mean is still surfaced for the arithmetic reading')
  assert.equal(result.outlier_guard.fired, false)
  assert.equal(result.outlier_guard.kept, null)
  assert.equal(result.result_usd, 101)
})

check('a hair over the 2x threshold still averages -- guard is > ratio, not >=', () => {
  const lots = [lot(1, 5), lot(2, 10)]
  const result = buildCatalogCostBreakdown(103, { cost_price_usd: 0, cost_price_khr: 0 }, lots)
  assert.equal(result.outlier_guard.fired, false)
  assert.equal(result.result_usd, 7.5)
})

// ---------------------------------------------------------------------------
// Inactive lots: shown for transparency (this row's own history) but never
// counted -- distinct from a live active lot's zero cost.
// ---------------------------------------------------------------------------
check('an inactive lot is excluded as inactive, never as zero/duplicate, and never enters the mean', () => {
  const lots = [lot(1, 4), lot(2, 4, { is_active: 0 }), lot(3, 4, { is_active: 0 })]
  const result = buildCatalogCostBreakdown(104, { cost_price_usd: 0, cost_price_khr: 0 }, lots)
  assert.deepEqual(result.distinct_usd, [4])
  assert.equal(result.inputs[0].excluded, null)
  assert.equal(result.inputs[1].excluded, 'inactive')
  assert.equal(result.inputs[2].excluded, 'inactive')
  assert.equal(result.result_usd, 4)
})

// ---------------------------------------------------------------------------
// No real active-lot cost yet: falls back to the product's own stored
// cost_price_usd (mirrors recomputeCatalogCost's own guard), never zeroes it.
// ---------------------------------------------------------------------------
check('every active lot uncosted -> falls back to the product row own stored cost, not 0', () => {
  const lots = [lot(1, 0), lot(2, null)]
  const result = buildCatalogCostBreakdown(105, { cost_price_usd: 12.5, cost_price_khr: 0 }, lots)
  assert.deepEqual(result.distinct_usd, [])
  assert.equal(result.mean_usd, 0)
  assert.equal(result.result_usd, 12.5, 'the existing figure survives, per recomputeCatalogCost')
  assert.equal(result.inputs[0].excluded, 'zero')
  assert.equal(result.inputs[1].excluded, 'zero')
})

check('no lots at all -> empty inputs, falls back to the stored cost', () => {
  const result = buildCatalogCostBreakdown(106, { cost_price_usd: 3.25, cost_price_khr: 13000 }, [])
  assert.deepEqual(result.inputs, [])
  assert.equal(result.result_usd, 3.25)
  assert.equal(result.result_khr, 13000, 'KHR is never derived from lots -- the stored scalar passes through untouched')
  assert.deepEqual(result.distinct_khr, [], 'no lot ever carries a per-lot KHR cost')
})

check('KHR is reported as the stored scalar, never averaged, even with several distinct USD lots', () => {
  const lots = [lot(1, 4), lot(2, 6)]
  const result = buildCatalogCostBreakdown(107, { cost_price_usd: 0, cost_price_khr: 20000 }, lots)
  assert.equal(result.result_khr, 20000)
  assert.equal(result.mean_khr, 0)
  assert.deepEqual(result.distinct_khr, [])
})

// ---------------------------------------------------------------------------
// P10-10. Owner ruling (2026-09-17): "the cost price should also add the
// changed if i manually change the cost price". Owner CORRECTION (same day,
// verbatim): "edit can override cost so before might be (n+n1+n2)/3, after
// override just becomes n. this means if future add stock have different
// price it will take from this n then add the new cost price / by that
// number of cost price". A manual entry is an OVERRIDE BASELINE, not one
// more input: the formula becomes { latest entry's cost } union { active
// lots received AFTER it, i.e. product_batches.id > baseline_batch_id }.
// Lots from before the override no longer count (excluded: 'overridden').
// ---------------------------------------------------------------------------
const manual = (id, costUsd, baselineBatchId, overrides = {}) => ({
  id,
  cost_usd: costUsd,
  cost_khr: overrides.cost_khr ?? null,
  user_name: overrides.user_name ?? 'sethy',
  created_at: overrides.created_at ?? `2026-09-1${id}T00:00:00Z`,
  baseline_batch_id: baselineBatchId,
})

check('no manual entry at all -> unchanged behaviour, every active lot counts', () => {
  const lots = [lot(1, 3), lot(2, 5)]
  const result = buildCatalogCostBreakdown(200, { cost_price_usd: 0, cost_price_khr: 0 }, lots, [])
  assert.deepEqual(result.distinct_usd, [3, 5])
  assert.equal(result.result_usd, 4)
})

// ---------------------------------------------------------------------------
// The owner's own worked sequence, run end to end against the pure assembler:
//   lots 3, 5 (ids 1, 2) -> override 10 (baseline=2) -> result 10 (not a mean)
//   -> add-stock lot 12 (id 3, after the baseline) -> (10+12)/2 = 11
//   -> second override 4 (new baseline=3, the id that existed just before it)
//      -> result 4; breakdown shows lots 3,5,12 overridden, entry 10
//      superseded, entry 4 included
//   -> add-stock lot 6 (id 4, after the new baseline) -> (4+6)/2 = 5
// ---------------------------------------------------------------------------
check("owner's override sequence: 3,5 -> override 10 -> result 10 (not the mean of 3,5,10)", () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' }), lot(2, 5, { received_at: '2026-09-02' })]
  const entries = [manual(9, 10, 2, { created_at: '2026-09-03T00:00:00Z' })]
  const result = buildCatalogCostBreakdown(201, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [10], 'the pre-override lots no longer feed the set at all')
  assert.equal(result.result_usd, 10)
  assert.equal(result.outlier_guard.fired, false, 'a single candidate cannot fire the guard')
  const [lot1, lot2, manualRow] = result.inputs
  assert.equal(lot1.excluded, 'overridden')
  assert.equal(lot2.excluded, 'overridden')
  assert.equal(manualRow.excluded, null, 'the override itself counts')
  assert.equal(manualRow.label, 'Manual · sethy')
})

check('...then add-stock lot 12 (after the override baseline) -> (10+12)/2 = 11', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' }), lot(2, 5, { received_at: '2026-09-02' }), lot(3, 12, { received_at: '2026-09-04' })]
  const entries = [manual(9, 10, 2, { created_at: '2026-09-03T00:00:00Z' })]
  const result = buildCatalogCostBreakdown(201, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [10, 12])
  assert.equal(result.mean_usd, 11)
  assert.equal(result.result_usd, 11)
  assert.equal(result.outlier_guard.fired, false, '12 vs 10 is well within 2x')
  const lot3 = result.inputs.find((row) => row.lot_code === null && row.source === 'lot' && row.cost_usd === 12)
  assert.equal(lot3.excluded, null, 'the new lot, received after the baseline, counts')
})

check('...then a SECOND override 4 -> result 4; breakdown shows 3,5,12 overridden, 10 superseded, 4 included', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' }), lot(2, 5, { received_at: '2026-09-02' }), lot(3, 12, { received_at: '2026-09-04' })]
  const entries = [
    manual(9, 10, 2, { created_at: '2026-09-03T00:00:00Z' }),
    manual(10, 4, 3, { created_at: '2026-09-05T00:00:00Z' }),
  ]
  const result = buildCatalogCostBreakdown(201, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [4])
  assert.equal(result.result_usd, 4)
  const bySourceCost = (source, cost) => result.inputs.find((row) => row.source === source && row.cost_usd === cost)
  assert.equal(bySourceCost('lot', 3).excluded, 'overridden')
  assert.equal(bySourceCost('lot', 5).excluded, 'overridden')
  assert.equal(bySourceCost('lot', 12).excluded, 'overridden', 'the lot ADDED after the first override is itself before the second override baseline')
  assert.equal(bySourceCost('manual', 10).excluded, 'superseded', 'the first override is history now')
  assert.equal(bySourceCost('manual', 4).excluded, null, 'the second (latest) override counts')
})

check('...then add-stock lot 6 (after the second override baseline) -> (4+6)/2 = 5', () => {
  const lots = [
    lot(1, 3, { received_at: '2026-09-01' }), lot(2, 5, { received_at: '2026-09-02' }), lot(3, 12, { received_at: '2026-09-04' }),
    lot(4, 6, { received_at: '2026-09-06' }),
  ]
  const entries = [
    manual(9, 10, 2, { created_at: '2026-09-03T00:00:00Z' }),
    manual(10, 4, 3, { created_at: '2026-09-05T00:00:00Z' }),
  ]
  const result = buildCatalogCostBreakdown(201, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [4, 6])
  assert.equal(result.mean_usd, 5)
  assert.equal(result.result_usd, 5)
})

check('an override and later eligible lots use the same distinct mean regardless of ratio', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' })]
  const entries = [manual(9, 9, 0, { created_at: '2026-09-02T00:00:00Z' })]
  // baseline=0 -> the lot (id 1) is still eligible (1 > 0), so it and the
  // override BOTH candidate -- the override is not automatically exclusive
  // unless the baseline is at/after that lot's id.
  const result = buildCatalogCostBreakdown(202, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [3, 9])
  assert.equal(result.outlier_guard.fired, false)
  assert.equal(result.outlier_guard.kept, null)
  assert.equal(result.result_usd, 6)
})

console.log(`${checks} checks passed`)
if (process.exitCode) process.exit(process.exitCode)
