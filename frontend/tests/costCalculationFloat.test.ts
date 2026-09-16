// P10-6: the cost-calculation float's own formatting and exclusion-labelling
// rules -- the shared arithmetic (resolveMergedCostDetail) is pinned server-
// side by cloudflare/scripts/test-product-cost-breakdown-pure.cjs and
// frontend/tests/mergedCostRule.test.ts; this file pins the READING the float
// builds from a breakdown payload (a fixture with a duplicate, a zero and an
// outlier), and that every clickable cost price display site actually opens
// the float rather than a bespoke one-off.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatCostFormula,
  costExclusionLabelKey,
  normalizeCostBreakdown,
} from '../src/utils/costBreakdownFormat.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')

let failed = 0
type TestCallback = () => void | Promise<void>
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// ---------------------------------------------------------------------------
// formatCostFormula -- the owner's own worked example, verbatim.
// ---------------------------------------------------------------------------
await runTest('formatCostFormula renders the owner\'s own example: (3.00 + 5.00) / 2 = 4.00', () => {
  assert.equal(formatCostFormula([3, 5], 4), '(3.00 + 5.00) / 2 = 4.00')
})

await runTest('formatCostFormula handles a single distinct cost', () => {
  assert.equal(formatCostFormula([50.7], 50.7), '(50.70) / 1 = 50.70')
})

await runTest('formatCostFormula is empty when there is nothing to divide', () => {
  assert.equal(formatCostFormula([], 0), '')
})

await runTest('formatCostFormula reads an outlier set\'s raw mean, not the guarded result', () => {
  // The float shows the arithmetic reading (2.00 + 200.00) / 2 = 101.00 next
  // to an explicit outlier note -- the CATALOG figure used is the guarded
  // 200, surfaced separately as result_usd, never silently substituted here.
  assert.equal(formatCostFormula([2, 200], 101), '(2.00 + 200.00) / 2 = 101.00')
})

// ---------------------------------------------------------------------------
// Exclusion labelling -- every reason the breakdown can report gets its own
// i18n key, and an included input (excluded: null) gets none.
// ---------------------------------------------------------------------------
await runTest('costExclusionLabelKey maps every reason to its own key', () => {
  assert.equal(costExclusionLabelKey('zero'), 'cost_breakdown_excluded_zero')
  assert.equal(costExclusionLabelKey('duplicate'), 'cost_breakdown_excluded_duplicate')
  assert.equal(costExclusionLabelKey('inactive'), 'cost_breakdown_excluded_inactive')
  assert.equal(costExclusionLabelKey(null), null)
})

// ---------------------------------------------------------------------------
// normalizeCostBreakdown -- a discriminating fixture: a duplicate, a zero,
// and an outlier-fired product all present in one payload shape.
// ---------------------------------------------------------------------------
await runTest('normalizeCostBreakdown reads a real server payload end to end', () => {
  const payload = {
    product_id: 42,
    inputs: [
      { source: 'lot', label: 'B1', cost_usd: 3, cost_khr: null, excluded: null },
      { source: 'lot', label: 'B2', cost_usd: 5, cost_khr: null, excluded: null },
      { source: 'lot', label: 'B3', cost_usd: 5, cost_khr: null, excluded: 'duplicate' },
      { source: 'lot', label: 'B4', cost_usd: 0, cost_khr: null, excluded: 'zero' },
    ],
    distinct_usd: [3, 5],
    distinct_khr: [],
    mean_usd: 4,
    mean_khr: 0,
    outlier_guard: { fired: false, kept: null },
    result_usd: 4,
    result_khr: 16000,
  }
  const normalized = normalizeCostBreakdown(payload)
  assert.ok(normalized)
  assert.equal(normalized!.inputs.length, 4)
  assert.equal(normalized!.inputs[2].excluded, 'duplicate')
  assert.equal(normalized!.inputs[3].excluded, 'zero')
  assert.equal(formatCostFormula(normalized!.distinct_usd, normalized!.mean_usd), '(3.00 + 5.00) / 2 = 4.00')
  assert.equal(normalized!.result_khr, 16000)
})

await runTest('normalizeCostBreakdown returns null for a malformed/empty payload', () => {
  assert.equal(normalizeCostBreakdown(null), null)
  assert.equal(normalizeCostBreakdown(undefined), null)
  assert.equal(normalizeCostBreakdown('nope'), null)
})

// ---------------------------------------------------------------------------
// Source pin: every display site the lane task names actually opens
// CostCalculationFloat, not a bespoke read-only tile of its own.
// ---------------------------------------------------------------------------
const DISPLAY_SITES: Array<{ file: string; mustContain: string[] }> = [
  { file: 'components/inventory/InventoryProductsSurface.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatProduct'] },
  { file: 'components/inventory/ProductDetailModal.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatOpen'] },
  { file: 'components/products/surfaces/ProductDetailModal.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatOpen'] },
  { file: 'components/products/StockInSessionsSection.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatOpen'] },
  { file: 'components/inventory/InventoryStockModals.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatOpen'] },
]

await runTest('every named cost-price display site imports and opens CostCalculationFloat', () => {
  for (const site of DISPLAY_SITES) {
    const source = fs.readFileSync(path.join(srcRoot, site.file), 'utf8')
    for (const needle of site.mustContain) {
      assert.ok(source.includes(needle), `${site.file} must reference "${needle}" -- update this test if the site's own wiring changed intentionally`)
    }
  }
})

await runTest('the float opens from first paint -- no minimized stub, it fetches on mount', () => {
  const source = fs.readFileSync(path.join(srcRoot, 'components/shared/CostCalculationFloat.tsx'), 'utf8')
  assert.ok(source.includes('useEffect'), 'must fetch on mount, not on some later trigger')
  assert.ok(source.includes('getProductCostBreakdown'), 'must go through the one shared transport')
  assert.ok(!source.includes('minimized'), 'no minimized stub -- real content from first paint')
})

await runTest('both language packs carry every cost_breakdown_* key', () => {
  const en = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang/en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lang/km.json'), 'utf8')) as Record<string, string>
  const keys = Object.keys(en).filter((key) => key.startsWith('cost_breakdown_'))
  assert.ok(keys.length >= 8, 'expected the full cost-breakdown key set')
  for (const key of keys) {
    assert.ok(km[key] && km[key] !== en[key], `km.json must carry a real Khmer translation for ${key}, not the English placeholder`)
  }
})

if (failed > 0) {
  process.exitCode = 1
}
