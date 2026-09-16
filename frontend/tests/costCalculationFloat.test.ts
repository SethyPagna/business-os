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
  costRowPrimaryText,
  costRowMeta,
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
  assert.equal(costExclusionLabelKey('superseded'), 'cost_breakdown_excluded_superseded')
  assert.equal(costExclusionLabelKey('overridden'), 'cost_breakdown_excluded_overridden')
  assert.equal(costExclusionLabelKey(null), null)
})

// ---------------------------------------------------------------------------
// P10-11 -- row reading: lot rows show their lot code + received date +
// branch on one compact line; a payload with only the legacy `label` still
// reads as something concrete.
// ---------------------------------------------------------------------------
await runTest('costRowPrimaryText prefers the lot code over the legacy label', () => {
  const input = { source: 'lot' as const, label: '1 · Shop', lot_code: 'L-0904', batch_number: 1, received_at: '2026-09-04', branch_name: 'Shop', user_name: null, recorded_at: null, cost_usd: 3, cost_khr: null, excluded: null }
  assert.equal(costRowPrimaryText(input, '04/09/2026'), 'L-0904')
})

await runTest('costRowPrimaryText falls back to the formatted received date, then the batch number, then the legacy label', () => {
  const noLot = { source: 'lot' as const, label: '1 · Shop', lot_code: null, batch_number: 1, received_at: '2026-09-04', branch_name: 'Shop', user_name: null, recorded_at: null, cost_usd: 3, cost_khr: null, excluded: null }
  assert.equal(costRowPrimaryText(noLot, '04/09/2026'), '04/09/2026')
  const noDate = { ...noLot, received_at: null }
  assert.equal(costRowPrimaryText(noDate, null), '#1')
  const olderPayload = { source: 'lot' as const, label: '1 · Shop', lot_code: null, batch_number: null, received_at: null, branch_name: null, user_name: null, recorded_at: null, cost_usd: 3, cost_khr: null, excluded: null }
  assert.equal(costRowPrimaryText(olderPayload, null), '1 · Shop')
})

await runTest('costRowMeta shows branch for a lot row, drops the date it already used as the primary text', () => {
  const withLotCode = { source: 'lot' as const, label: '1 · Shop', lot_code: 'L-0904', batch_number: 1, received_at: '2026-09-04', branch_name: 'Shop', user_name: null, recorded_at: null, cost_usd: 3, cost_khr: null, excluded: null }
  assert.equal(costRowMeta(withLotCode, '04/09/2026'), '04/09/2026 · Shop')
  const noLotCode = { ...withLotCode, lot_code: null }
  assert.equal(costRowMeta(noLotCode, '04/09/2026'), 'Shop')
})

await runTest('costRowMeta shows date + username for a manual row', () => {
  const manual = { source: 'manual' as const, label: 'Manual', lot_code: null, batch_number: null, received_at: null, branch_name: null, user_name: 'sokha', recorded_at: '2026-09-16', cost_usd: 4.5, cost_khr: null, excluded: null }
  assert.equal(costRowMeta(manual, '16/09/2026'), '16/09/2026 · sokha')
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

// P10-11 -- the full contract: two lots (one overridden), two manual
// entries (one superseded) and an older-payload row that only carries
// `label`. A manual override REPLACES the cost going forward (owner
// correction, 2026-09-17): a lot received before the latest override stops
// counting ('overridden'), distinct from an earlier manual entry a later
// one replaced ('superseded').
await runTest('normalizeCostBreakdown reads two lots (one overridden), two manual entries and an older label-only row', () => {
  const payload = {
    product_id: 7,
    inputs: [
      { source: 'lot', label: '1 · Shop', lot_code: 'L-0904', batch_number: 1, received_at: '2026-09-04', branch_name: 'Shop', cost_usd: 3, cost_khr: null, excluded: 'overridden' },
      { source: 'lot', label: '2 · Warehouse', lot_code: 'L-0910', batch_number: 2, received_at: '2026-09-10', branch_name: 'Warehouse', cost_usd: 5, cost_khr: null, excluded: 'overridden' },
      { source: 'manual', label: 'Manual', user_name: 'dara', recorded_at: '2026-09-12', cost_usd: 3.5, cost_khr: null, excluded: 'superseded' },
      { source: 'manual', label: 'Manual', user_name: 'dara', recorded_at: '2026-09-16', cost_usd: 4.5, cost_khr: null, excluded: null },
      // Older payload shape: only the legacy sequence · branch label, no new fields.
      { source: 'lot', label: '3 · Shop', cost_usd: 6, cost_khr: null, excluded: null },
    ],
    distinct_usd: [4.5, 6],
    distinct_khr: [],
    mean_usd: 5.25,
    mean_khr: 0,
    outlier_guard: { fired: false, kept: null },
    result_usd: 5.25,
    result_khr: 0,
  }
  const normalized = normalizeCostBreakdown(payload)
  assert.ok(normalized)
  assert.equal(normalized!.inputs.length, 5)
  assert.equal(normalized!.inputs[0].lot_code, 'L-0904')
  assert.equal(normalized!.inputs[0].excluded, 'overridden')
  assert.equal(normalized!.inputs[1].excluded, 'overridden')
  assert.equal(costExclusionLabelKey(normalized!.inputs[1].excluded), 'cost_breakdown_excluded_overridden')
  assert.equal(normalized!.inputs[2].source, 'manual')
  assert.equal(normalized!.inputs[2].excluded, 'superseded')
  assert.equal(normalized!.inputs[3].excluded, null)
  assert.equal(normalized!.inputs[4].lot_code, null)
  assert.equal(costRowPrimaryText(normalized!.inputs[4], null), '3 · Shop')
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
  { file: 'components/pos/ProductDetailSheet.tsx', mustContain: ['CostCalculationFloat', 'setCostFloatTarget'] },
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
  assert.ok(keys.length >= 10, 'expected the full cost-breakdown key set')
  for (const key of keys) {
    assert.ok(km[key] && km[key] !== en[key], `km.json must carry a real Khmer translation for ${key}, not the English placeholder`)
  }
})

if (failed > 0) {
  process.exitCode = 1
}
