// Cost-unknown slice S11: dashboard, sales strip, shift, inventory and branches show an unknown cost as UNKNOWN.
//
// Owner, 14 Oct 2026: a recorded $0 shows $0.00; no recorded cost (NULL) shows unknown; a total over a mix shows the
// known part with "Partial — N unknown cost"; a figure hidden by permission stays ABSENT (hidden is not unknown).
// A payload that predates the count keys (a stale cached stats strip) is "not measured": no marker, never "unknown".
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'
import { costCoverage, costFigureText } from '../src/utils/costCoverage.ts'
import * as costDisplay from '../src/utils/costDisplay.ts'
import { buildMovementGroups } from '../src/components/inventory/movementGroups.ts'
import { shiftFigureRows, shiftUnknownCostLines, type ShiftFiguresShape } from '../src/components/shifts/shiftReportModel.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const read = (file: string) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n')
const en: Record<string, string> = JSON.parse(read('../src/lang/en.json'))
const t = (key: string) => en[key]
const fmt = (amount: number) => `$${amount.toFixed(2)}`
let passed = 0
function test(name: string, check: () => void) { check(); passed += 1; console.log(`PASS ${name}`) }

// ---- shared helper ---------------------------------------------------------------------------------------------
test('costCoverage: absent count is NOT MEASURED, a count is partial, known 0 beside a count is all unknown', () => {
  assert.deepEqual(costCoverage({ cost_usd: 5 }), { measured: false, unknown: 0, allUnknown: false }, 'stale payload: no marker')
  assert.deepEqual(costCoverage(null), { measured: false, unknown: 0, allUnknown: false })
  assert.deepEqual(costCoverage({ cost_missing_snapshot_lines: 0, cost_known_lines: 9 }), { measured: true, unknown: 0, allUnknown: false })
  assert.deepEqual(costCoverage({ cost_missing_snapshot_lines: 3, cost_known_lines: 7 }), { measured: true, unknown: 3, allUnknown: false })
  assert.deepEqual(costCoverage({ cost_missing_snapshot_lines: 3, cost_known_lines: 0 }), { measured: true, unknown: 3, allUnknown: true })
  assert.equal(costCoverage({ cost_missing_snapshot_lines: 3 }).allUnknown, false, 'no known-lines count: cannot call it all unknown')
  assert.equal(costCoverage({ cost_missing_snapshot_lines: -1 }).measured, false)
  assert.equal(costFigureText('$10.00', costCoverage({ cost_usd: 10 }), t), '$10.00', 'stale cached strip: plain figure')
  assert.equal(costFigureText('$10.00', costCoverage({ cost_missing_snapshot_lines: 3, cost_known_lines: 2 }), t), '$10.00 · Partial — 3 unknown cost')
  assert.equal(costFigureText('$0.00', costCoverage({ cost_missing_snapshot_lines: 3, cost_known_lines: 0 }), t), 'Unknown cost', 'every line unknown: never $0.00')
  assert.equal(costFigureText('$0.00', costCoverage({ cost_missing_snapshot_lines: 0, cost_known_lines: 4 }), t), '$0.00', 'a real $0 stays $0.00')
})

// ---- movement groups -------------------------------------------------------------------------------------------
const movement = (id: number, extra: Record<string, unknown>) => ({
  id, movement_type: 'remove', reference_id: 'REF', product_id: id, product_name: `P${id}`, quantity: 1, created_at: '2026-10-14T01:00:00Z', ...extra,
})
test('movement group {NULL, 4}: known sum 4, one unknown record counted, never silently $4.00', () => {
  const [group] = buildMovementGroups([movement(1, { total_cost_usd: null }), movement(2, { total_cost_usd: 4 })])
  assert.equal(group.totalCostUsd, 4)
  assert.equal(group.costUnknownLines, 1)
  assert.equal(group.costKnownLines, 1)
  assert.equal(group.costHidden, false)
})
test('a real $0 movement is a KNOWN record; all-NULL is all unknown; zero-quantity records carry no cost', () => {
  const [zero] = buildMovementGroups([movement(1, { total_cost_usd: 0 })])
  assert.deepEqual([zero.totalCostUsd, zero.costKnownLines, zero.costUnknownLines], [0, 1, 0])
  const [unknown] = buildMovementGroups([movement(1, { total_cost_usd: null }), movement(2, { total_cost_usd: null })])
  assert.deepEqual([unknown.totalCostUsd, unknown.costKnownLines, unknown.costUnknownLines], [0, 0, 2])
  const [set] = buildMovementGroups([movement(1, { quantity: 0, total_cost_usd: null })])
  assert.equal(set.costUnknownLines, 0, 'a set that moved nothing has no cost to be unknown')
})
test('control: records with no cost key at all are hidden by permission, not unknown', () => {
  const [group] = buildMovementGroups([movement(1, {}), movement(2, {})])
  assert.equal(group.costHidden, true)
  assert.equal(group.costUnknownLines, 0)
})

// ---- rendering through the real components -----------------------------------------------------------------------
function compile(file: string, mocks: Record<string, unknown>): Record<string, any> {
  const code = transformSync(read(file), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)((id: string) => {
    for (const [needle, value] of Object.entries(mocks)) if (id.includes(needle)) return value
    if (id === 'react' || id === 'react/jsx-runtime') return nodeRequire(id)
    return { default: () => null, __esModule: true }
  }, module, module.exports)
  return module.exports
}
const costValueModule = compile('../src/components/shared/CostValue.tsx', {
  ConflictIcon: { ConflictIcon: (p: Record<string, unknown>) => React.createElement('svg', { 'data-conflict-icon': 'true', className: p.className }), CONFLICT_ICON_CLASS: 'text-amber-600' },
  costDisplay,
})
const CostValue = costValueModule.default
const mocksWithCost = { 'shared/CostValue': { default: CostValue, __esModule: true }, productGrouping: nodeRequire('../src/utils/productGrouping.ts') }

test('movement surface: {NULL, 4} renders $4.00 with the partial note; $0 renders $0.00; all-unknown renders Unknown cost; hidden renders nothing', () => {
  const surface = compile('../src/components/inventory/InventoryMovementsSurface.tsx', mocksWithCost)
  const render = (group: unknown) => renderToStaticMarkup(React.createElement(surface.MovementGroupCost, { group, fmtUSD: fmt, t }))
  const [mixed] = buildMovementGroups([movement(1, { total_cost_usd: null }), movement(2, { total_cost_usd: 4 })])
  assert.match(render(mixed), />\$4\.00</)
  assert.match(render(mixed), /Partial — 1 unknown cost/)
  const [zero] = buildMovementGroups([movement(1, { total_cost_usd: 0 })])
  assert.match(render(zero), />\$0\.00</, 'a recorded $0 movement was blank before')
  assert.doesNotMatch(render(zero), /Partial|Unknown/)
  const [allNull] = buildMovementGroups([movement(1, { total_cost_usd: null })])
  assert.match(render(allNull), />Unknown cost</)
  assert.doesNotMatch(render(allNull), /\$0\.00/)
  const [hidden] = buildMovementGroups([movement(1, {})])
  assert.equal(render(hidden), '')
  const item = (record: Record<string, unknown>) => renderToStaticMarkup(React.createElement(surface.MovementItemCost, { movement: record, fmtUSD: fmt, t }))
  assert.match(item({ total_cost_usd: 0 }), />\$0\.00</)
  assert.match(item({ total_cost_usd: null }), />Unknown cost</)
  assert.equal(item({}), '', 'absent key: hidden, not unknown')
})

test('inventory products: purchase mirror 0 defers to the catalog cost; NULL cost is unknown, never $0.00; a recorded $0 stays $0', () => {
  const surface = compile('../src/components/inventory/InventoryProductsSurface.tsx', mocksWithCost)
  assert.equal(surface.inventoryCost({ purchase_price_usd: 3, cost_price_usd: 5 }, 'usd'), 3)
  assert.equal(surface.inventoryCost({ purchase_price_usd: 0, cost_price_usd: 5 }, 'usd'), 5, 'unfilled mirror defers to the catalog cost, as the Worker does')
  assert.equal(surface.inventoryCost({ purchase_price_usd: 0, cost_price_usd: 0 }, 'usd'), 0, 'a recorded $0 is a real $0')
  assert.equal(surface.inventoryCost({ purchase_price_usd: 0, cost_price_usd: null }, 'usd'), null, 'old code returned the mirror 0: unknown printed as $0.00')
  assert.equal(surface.inventoryCost({ cost_price_usd: null }, 'usd'), null)
  assert.equal(surface.inventoryCost({}, 'usd'), null, 'hidden cost: nothing to show')
  const rows = [
    { id: 1, stock_value_usd: null, cogs_usd: 0, cogs_unknown_lines: 2, profit_usd: 5 },
    { id: 2, stock_value_usd: 4, cogs_usd: 3, cogs_unknown_lines: 0, profit_usd: 2 },
  ]
  const both = { __mergedProductIds: [1, 2] }
  assert.deepEqual(surface.mergedInventoryCostMetric(both, rows, 'stock_value_usd'), { total: 4, unknown: 1, hidden: false }, 'known part + the unknown row counted')
  assert.deepEqual(surface.mergedInventoryCostMetric(both, rows, 'cogs_usd', true), { total: 3, unknown: 2, hidden: false }, 'COGS carries the rows own unknown sold lines')
  assert.deepEqual(surface.mergedInventoryCostMetric({ id: 1 }, [rows[0]], 'stock_value_usd'), { total: null, unknown: 1, hidden: false }, 'every row unknown')
  assert.deepEqual(surface.mergedInventoryCostMetric({ id: 9 }, [{ id: 9 }], 'stock_value_usd'), { total: null, unknown: 0, hidden: true }, 'absent key is hidden, not unknown')
  assert.deepEqual(surface.mergedInventoryCostMetric({ id: 9 }, [], 'stock_value_usd'), { total: null, unknown: 0, hidden: true }, 'a member missing from the page is not a partial total')
  assert.deepEqual(surface.mergedInventoryCostMetric({ id: 1 }, [{ id: 1, cogs_usd: 0, cogs_unknown_lines: 0 }], 'cogs_usd', true), { total: 0, unknown: 0, hidden: false }, 'a recorded $0 COGS is a known zero')
})

// ---- shift -------------------------------------------------------------------------------------------------------
const figures: ShiftFiguresShape = {
  opening: { usd: 10, khr: 0 }, closing: { usd: 12, khr: 0 }, sales_usd: 100, cogs_usd: 60, profit_usd: 40, delivery_fee_usd: 0, credit_usd: 0,
  refunds_usd: 0, delivery_cost: { usd: 0, khr: 0 }, other_expenses: { usd: 0, khr: 0 },
}
test('shift: profit with cost_missing_snapshot_lines: 3 carries the count on COGS and profit; the figures themselves do not move', () => {
  const plain = shiftFigureRows(figures)
  const partial = shiftFigureRows({ ...figures, cost_missing_snapshot_lines: 3 })
  assert.equal(partial.find((row) => row.key === 'cogs')?.unknownCostCount, 3)
  assert.equal(partial.find((row) => row.key === 'profit')?.unknownCostCount, 3)
  assert.equal(partial.find((row) => row.key === 'sales')?.unknownCostCount, undefined, 'revenue is not a cost figure')
  assert.deepEqual(partial.map(({ unknownCostCount: _count, ...row }) => row), plain, 'a closed shift keeps every number (formula version rule)')
  assert.equal(plain.some((row) => row.unknownCostCount !== undefined), false, 'absent count = not measured: no marker')
  assert.equal(shiftFigureRows({ ...figures, cost_missing_snapshot_lines: 0 }).some((row) => row.unknownCostCount !== undefined), false)
  const afterLosses = shiftFigureRows({ ...figures, cost_missing_snapshot_lines: 2, removal_loss_usd: 5, revenue_after_losses_usd: 95, profit_after_losses_usd: 35 })
  assert.equal(afterLosses.find((row) => row.key === 'rpt_profit_after_losses')?.unknownCostCount, 2, 'profit incl. losses inherits the marker')
  assert.equal(shiftUnknownCostLines({ ...figures, cost_missing_snapshot_lines: 4 }), 4)
  assert.equal(shiftUnknownCostLines(figures), 0)
  assert.equal(shiftUnknownCostLines(null), 0)
})

// ---- source shape: the surfaces use the helpers and keep hidden != unknown -------------------------------------------
const dashboard = read('../src/components/dashboard/Dashboard.tsx')
const sales = read('../src/components/sales/Sales.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
const branches = read('../src/components/branches/Branches.tsx')
const figuresComponent = read('../src/components/shifts/ShiftReportFigures.tsx')

test('dashboard: stock value card is drawn only when the key is present; null is unknown; the unknown products are counted', () => {
  assert.match(dashboard, /const aStockValueShown = summary == null \|\| summary\.stock_value_usd !== undefined/)
  assert.match(dashboard, /\.\.\.\(aStockValueShown \? \[\{\s*\n\s*id: 'stock-value'/, 'hidden-by-permission removes the card (it used to print $0.00)')
  assert.match(dashboard, /const aStockValueKnown = knownCost\(summary\?\.stock_value_usd\)/)
  assert.match(dashboard, /partialCostNote\(aStockUnknownProducts, t\)/)
  assert.match(dashboard, /\(payload\.stock_value_usd == null \|\| Number\.isFinite\(Number\(payload\.stock_value_usd\)\)\)/, 'a hidden or null value must not fail the payload gate')
  assert.doesNotMatch(dashboard, /stock_value_usd: 0,/, 'the empty summary no longer invents a $0.00 stock value')
})
test('dashboard: profit and COGS inherit the partial marker; all-unknown prints Unknown cost and no margin', () => {
  assert.match(dashboard, /const aCostCoverage = costCoverage\(analytics\?\.totals\)/)
  assert.match(dashboard, /value: aCostCoverage\.allUnknown \? unknownCostLabel\(t\) : fmtUSD\(aProfit\)/)
  assert.match(dashboard, /costFigureText\(fmtUSD\(aCost\), aCostCoverage, t\)/)
  assert.match(dashboard, /costFigureText\(fmtUSD\(aProfitInclLosses\), aCostCoverage, t\)/)
  assert.match(dashboard, /aCostCoverage\.allUnknown \? '—'/)
})
test('sales strip: COGS and profit cards carry the partial marker from the strip totals', () => {
  assert.match(sales, /const coverage = costCoverage\(totals\)/)
  assert.match(sales, /value: coverage\.allUnknown \? unknownCostLabel\(t\) : fmtUSD\(cogsUsd\)/)
  assert.match(sales, /value: coverage\.allUnknown \? unknownCostLabel\(t\) : fmtUSD\(profitUsd\)/)
  assert.match(sales, /costFigureText\(fmtUSD\(profitInclLosses\), coverage, t\)/)
})
test('inventory: stock value tile and strip cost rows use the unknown rules; the movement detail does not invent a $0 cost', () => {
  assert.match(inventory, /const totalValueKnown = knownCost\(stockStats\?\.stock_value_usd\)/)
  assert.match(inventory, /value: statsValue\(totalValueKnown === null \? unknownCostLabel\(t\) : fmtUSD\(totalValue\)\)/)
  assert.match(inventory, /costFigureText\(fmtUSD\(stripCogs\), stripCoverage, t\)/)
  assert.doesNotMatch(inventory, /purchase_price_usd: Number\(movement\?\.unit_cost_usd \|\| 0\)/)
  assert.match(inventory, /value: exportCoverage\.allUnknown \? '' : Number\(totals\.cost_usd\) \|\| 0/, 'CSV: unknown is an empty cell')
})
test('branches: stock value is drawn only for product_cost_view and reads unknown rather than $0.00', () => {
  assert.match(branches, /\{canViewCosts \? <BranchStatTile label=\{tr\('stock_value', 'Stock Value'\)\} value=\{orgStockValueText\} \/> : null\}/)
  assert.match(branches, /\.\.\.\(canViewCosts \? \[\{ key: 'value'/, 'the per-branch value tile is gated too')
  assert.doesNotMatch(branches, /fmtUSD\(branchSummary\.stock_value_usd \?\? 0\)/)
  assert.match(branches, /unknownCostLabel\(t\)/)
})
test('shift figures render the partial note under COGS and profit', () => {
  assert.match(figuresComponent, /row\.unknownCostCount \?/)
  assert.match(figuresComponent, /partialCostNote\(row\.unknownCostCount, t\)/)
})

console.log(`${passed} cost-unknown S11 tests passed`)
