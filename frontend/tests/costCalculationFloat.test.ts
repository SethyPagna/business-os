// P10-6: the cost-calculation float's own formatting and exclusion-labelling
// rules -- catalog arithmetic is pinned server-side by
// cloudflare/scripts/test-product-cost-breakdown-pure.cjs, independently of
// product-merge policy. This file pins the READING the float builds from a
// server payload (including duplicate, zero and widely separated costs),
// and that every clickable cost price display site actually opens
// the float rather than a bespoke one-off.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
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

await runTest('formatCostFormula reads the catalog mean even for widely separated costs', () => {
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
// and positive costs all present in one payload shape.
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

// Render the actual float with loaded server state. Neither the component nor
// its formatting helpers may calculate a merge-policy replacement locally.
const require = createRequire(import.meta.url)
function renderBreakdown(payload: unknown): string {
  const source = fs.readFileSync(path.join(srcRoot, 'components/shared/CostCalculationFloat.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as any }
  const states = [normalizeCostBreakdown(payload), '', false]
  let stateIndex = 0
  const mockedRequire = (id: string): any => {
    if (id === 'react') return { ...React, useState: () => [states[stateIndex++], () => {}], useEffect: () => {}, useRef: () => ({ current: true }) }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('AppContext')) return { useApp: () => ({ user: { role: 'admin' } }) }
    if (id.includes('acquisitionCostAccess')) return { canViewAcquisitionCosts: () => true }
    if (id.includes('costBreakdownFormat')) return { formatCostFormula, costExclusionLabelKey, costRowPrimaryText, costRowMeta, normalizeCostBreakdown }
    if (id.includes('formatters')) return { fmtDate: (value: string) => value }
    if (id.includes('productReadTransport')) return { getProductCostBreakdown: () => { throw new Error('render must not fetch') } }
    if (id.includes('TruncatedText')) return { default: ({ text }: { text: string }) => React.createElement('span', null, text) }
    if (id.includes('Modal')) return { default: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }
    throw new Error(`Unexpected dependency: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(mockedRequire, module, module.exports)
  return renderToStaticMarkup(React.createElement(module.exports.default, {
    productId: 42, onClose: () => {}, t: (_key: string, fallback: string) => fallback,
    fmtUSD: (value: number) => `$${value.toFixed(2)}`, fmtKHR: (value: number) => `${value} KHR`,
  }))
}

await runTest('catalog float renders distinct-positive means and never the legacy highest-cost warning', () => {
  for (const fixture of [
    { costs: [3, 5, 7, 5, 0], distinct: [3, 5, 7], mean: 5, formula: '(3.00 + 5.00 + 7.00) / 3 = 5.00' },
    { costs: [2, 200], distinct: [2, 200], mean: 101, formula: '(2.00 + 200.00) / 2 = 101.00' },
  ]) {
    const payload = {
      product_id: 42,
      inputs: fixture.costs.map((cost, index) => ({ source: 'lot', label: `Lot ${index}`, cost_usd: cost, excluded: cost === 0 ? 'zero' : fixture.costs.indexOf(cost) < index ? 'duplicate' : null })),
      distinct_usd: fixture.distinct, mean_usd: fixture.mean, result_usd: fixture.mean,
      // Older metadata remains parseable but cannot restore the old policy UI.
      outlier_guard: { fired: true, kept: 999 }, result_khr: 16000,
    }
    const normalized = normalizeCostBreakdown(payload)!
    assert.deepEqual(normalized.outlier_guard, payload.outlier_guard)
    const html = renderBreakdown(payload)
    assert.ok(html.includes(fixture.formula))
    assert.ok(html.includes(`>$${fixture.mean.toFixed(2)}<`))
    assert.ok(html.includes('16000 KHR'))
    assert.doesNotMatch(html, /highest recorded cost|more than double|999/)
    if (fixture.costs.includes(0)) {
      assert.ok(html.includes('cost_breakdown_excluded_zero'))
      assert.ok(html.includes('cost_breakdown_excluded_duplicate'))
    }
    assert.ok(renderBreakdown({ ...payload, result_usd: 17 }).includes('>$17.00<'), 'result remains server-authoritative, not locally recomputed')
  }
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
