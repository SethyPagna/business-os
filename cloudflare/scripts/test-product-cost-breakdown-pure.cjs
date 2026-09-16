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
check('2 and 200 (>2x apart) -> outlier fires, highest kept as result, mean still shown for the reading', () => {
  const lots = [lot(1, 2), lot(2, 200)]
  const result = buildCatalogCostBreakdown(102, { cost_price_usd: 0, cost_price_khr: 0 }, lots)
  assert.deepEqual(result.distinct_usd, [2, 200])
  assert.equal(result.mean_usd, 101, 'the raw mean is still surfaced for the arithmetic reading')
  assert.equal(result.outlier_guard.fired, true)
  assert.equal(result.outlier_guard.kept, 200)
  assert.equal(result.result_usd, 200, 'the actual catalog figure is the guarded result, not the raw mean')
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
// P10-10 (owner ruling, 2026-09-17): a manual cost-price edit is a recorded
// input, not a silent overwrite -- it joins the formula as one more distinct
// cost, and the row it produces carries the lot fields the owner asked for
// (compact, one row each) plus who/when for the manual edit.
// ---------------------------------------------------------------------------
const manual = (id, costUsd, overrides = {}) => ({
  id,
  cost_usd: costUsd,
  cost_khr: overrides.cost_khr ?? null,
  user_name: overrides.user_name ?? 'sethy',
  created_at: overrides.created_at ?? `2026-09-1${id}T00:00:00Z`,
})

check('a manual entry joins the lots as one more distinct cost in the mean', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' }), lot(2, 5, { received_at: '2026-09-02' })]
  const entries = [manual(9, 4, { created_at: '2026-09-03T00:00:00Z' })]
  const result = buildCatalogCostBreakdown(201, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [3, 4, 5])
  assert.equal(result.mean_usd, 4)
  assert.equal(result.result_usd, 4)
  assert.equal(result.outlier_guard.fired, false)
  const manualRow = result.inputs.find((row) => row.source === 'manual')
  assert.ok(manualRow, 'the manual entry is a row in the breakdown')
  assert.equal(manualRow.excluded, null, 'the latest (only) manual entry counts, same as a lot')
  assert.equal(manualRow.user_name, 'sethy')
  assert.equal(manualRow.recorded_at, '2026-09-03T00:00:00Z')
  assert.equal(manualRow.lot_code, null, 'a manual row never carries lot fields')
  assert.equal(manualRow.label, 'Manual · sethy')
})

check('a manual entry more than 2x the cheapest lot is an outlier -- reported, kept as the highest, same guard as a lot', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' })]
  const entries = [manual(9, 9, { created_at: '2026-09-05T00:00:00Z' })]
  const result = buildCatalogCostBreakdown(202, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  assert.deepEqual(result.distinct_usd, [3, 9])
  assert.equal(result.outlier_guard.fired, true)
  assert.equal(result.outlier_guard.kept, 9)
  assert.equal(result.result_usd, 9)
})

check('only the LATEST manual entry counts -- older manual entries are excluded: superseded, history only', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01' })]
  const entries = [
    manual(9, 3, { created_at: '2026-09-02T00:00:00Z', user_name: 'dara' }),
    manual(10, 5, { created_at: '2026-09-04T00:00:00Z', user_name: 'sethy' }),
  ]
  const result = buildCatalogCostBreakdown(203, { cost_price_usd: 0, cost_price_khr: 0 }, lots, entries)
  const manualRows = result.inputs.filter((row) => row.source === 'manual')
  assert.equal(manualRows.length, 2, 'every manual entry is reported, not just the latest')
  assert.equal(manualRows[0].excluded, 'superseded', 'the older entry is history only')
  assert.equal(manualRows[0].user_name, 'dara')
  assert.equal(manualRows[1].excluded, null, 'the latest entry counts')
  assert.equal(manualRows[1].user_name, 'sethy')
  assert.deepEqual(result.distinct_usd, [3, 5], 'only the latest manual cost (5), not the superseded one (3, already distinct from the lot anyway)')
  assert.equal(result.mean_usd, 4)
  assert.equal(result.result_usd, 4)
})

check('lots and manual entries are interleaved chronologically in the record', () => {
  const lots = [lot(1, 3, { received_at: '2026-09-01', batch_number: 'B1' })]
  const entries = [manual(9, 4, { created_at: '2026-09-03T00:00:00Z' })]
  const later = [lot(2, 6, { received_at: '2026-09-05', batch_number: 'B2' })]
  const result = buildCatalogCostBreakdown(204, { cost_price_usd: 0, cost_price_khr: 0 }, [...lots, ...later], entries)
  assert.deepEqual(result.inputs.map((row) => row.source), ['lot', 'manual', 'lot'], 'ordered by date, not grouped by kind')
})

console.log(`${checks} checks passed`)
if (process.exitCode) process.exit(process.exitCode)
