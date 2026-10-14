// S10 of the cost-unknown lane: the Reports package shows an unknown cost as
// unknown, never $0.00. A recorded $0 stays $0.00 (and 0.0000 in a 4-place
// CSV), a total over rows with unknown lines carries the partial note, and a
// cost the caller may not see stays ABSENT (hidden is not unknown).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'
import {
  buildIncomeStatement,
  combineCostStates,
  costStateOf,
  courierCostState,
  hasProfit,
  normalizeTotals,
  statementAmount,
  sumTotals,
  unknownCostMetadata,
} from '../src/components/sales/reports/reportModel.ts'
import { nullableFinite } from '../src/components/sales/reports/reportExportCollection.ts'
import { mapExportTotals, saleExportObjects, validateExportSale } from '../src/components/sales/reports/salesReportExport.ts'
import { formatReportMoney } from '../src/utils/reportMoney.ts'
import { buildSalesImportRows } from '../src/utils/salesImportContract.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')
const nodeRequire = createRequire(import.meta.url)
const en: Record<string, string> = JSON.parse(fs.readFileSync(path.join(src, 'lang', 'en.json'), 'utf8'))
const tr = (key: string, fallback: string) => en[key] ?? fallback
const UNKNOWN = en.cost_unknown
const PARTIAL = (count: number) => en.cost_partial_count.replace('{count}', String(count))

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// ---- a tiny module loader: the real reports package, stubbed edges ----------
const Noop = () => null
const universalStub = new Proxy({ __esModule: true, default: Noop } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : Noop) })
const passThrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
const kitStub = {
  __esModule: true,
  DenseTable: ({ children }: { children?: React.ReactNode }) => React.createElement('table', null, children),
  Skeleton: Noop, EmptyState: Noop, Fold: Noop, IconButton: Noop, OverflowMenu: Noop, Chip: passThrough, Button: passThrough,
}
const realUtils = /[\\/]src[\\/]utils[\\/](costDisplay|moneyPrecision|financialPrecision|pricing|reportMoney|salesImportContract|customerIdentity)\.ts$/
const realShared = /[\\/]src[\\/]components[\\/]shared[\\/](CostValue\.tsx|ConflictIcon\.ts)$/
const realReports = /[\\/]src[\\/]components[\\/]sales[\\/]reports[\\/](reportModel|ReportTable|GroupedReport|OverviewReport|PeriodReport|SalesListReport|reportTypes|salesReportExport|reportExportCollection)\.tsx?$/

type Overrides = Record<string, unknown>
function loadModule(file: string, overrides: Overrides = {}, cache = new Map<string, unknown>()): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file) as Record<string, unknown>
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: file.endsWith('x') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const module = { exports: {} as Record<string, unknown> }
  cache.set(file, module.exports)
  const resolve = (id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return nodeRequire(id)
    if (id in overrides) return overrides[id]
    if (id.startsWith('lucide-react')) return { __esModule: true, default: () => React.createElement('svg', { 'data-icon': id }) }
    if (!id.startsWith('.')) return universalStub
    const base = path.resolve(path.dirname(file), id)
    const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!target) return universalStub
    if (id in overrides) return overrides[id]
    if (!(realUtils.test(target) || realShared.test(target) || realReports.test(target))) return universalStub
    return loadModule(target, overrides, cache)
  }
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports)
  cache.set(file, module.exports)
  return module.exports
}
const reportsDir = path.join(src, 'components', 'sales', 'reports')
const formattersStub = { __esModule: true, fmtDateOnly: String, fmtDateTime24: String }

// ---- the model: costStateOf / totals / statement -----------------------------
const totalsWire = (extra: Record<string, unknown> = {}) => ({
  tx_count: 3, gross_sales_usd: 30, revenue_usd: 30, net_sales_usd: 30, cost_usd: 12, profit_usd: 18, margin_pct: 60,
  cost_missing_snapshot_lines: 0, ...extra,
})

test('costStateOf: null is unknown, a recorded zero is known, an absent key is hidden (no state)', () => {
  assert.deepEqual(costStateOf({ cost_usd: null }), { coverage: 'unknown', count: 0 })
  assert.deepEqual(costStateOf({ cost_usd: 0, cost_missing_snapshot_lines: 0 }), { coverage: 'known', count: 0 })
  assert.equal(costStateOf({}), null, 'hidden by permission: the key is absent')
  assert.equal(costStateOf(null), null)
  assert.deepEqual(costStateOf({ cost_usd: 4, cost_missing_snapshot_lines: 2, cost_known_lines: 5 }), { coverage: 'partial', count: 2 })
  assert.deepEqual(costStateOf({ cost_usd: 0, cost_missing_snapshot_lines: 3, cost_known_lines: 0 }), { coverage: 'unknown', count: 3 })
  assert.deepEqual(costStateOf({ cost_usd: 0, cost_missing_snapshot_lines: 3, cost_known_lines: 2 }), { coverage: 'partial', count: 3 }, 'known lines at $0 are real zeros, not unknown')
  assert.deepEqual(costStateOf({ cost_usd: 0, cost_missing_snapshot_lines: 3 }), { coverage: 'unknown', count: 3 }, 'an older payload without the known count: nothing but unknown lines sums to 0')
})

test('normalizeTotals: null cost is unknown and its margin is blank; $0 with nothing missing is known; hidden stays absent', () => {
  const unknown = normalizeTotals(totalsWire({ cost_usd: null, profit_usd: null, margin_pct: null, cost_missing_snapshot_lines: 3 }))!
  assert.equal(unknown.cost_state?.coverage, 'unknown')
  assert.equal(unknown.margin_pct, null)
  assert.equal(hasProfit(unknown), true, 'a null profit still passes the presence gate')
  const zero = normalizeTotals(totalsWire({ cost_usd: 0, profit_usd: 30, margin_pct: 100 }))!
  assert.equal(zero.cost_state?.coverage, 'known')
  assert.equal(zero.margin_pct, 100)
  const hidden = normalizeTotals({ tx_count: 3, gross_sales_usd: 30, revenue_usd: 30 })!
  assert.equal(hidden.cost_state, undefined, 'hidden is not unknown')
  assert.equal(hasProfit(hidden), false)
  assert.equal('cost_usd' in hidden, false)
})

test('sumTotals: one unknown row makes the total partial, all unknown makes it unknown, hidden rows stay hidden', () => {
  const row = (extra: Record<string, unknown>) => normalizeTotals(totalsWire(extra))!
  const known = row({}), unknown = row({ cost_usd: null, profit_usd: null, margin_pct: null, cost_missing_snapshot_lines: 2 })
  assert.deepEqual(sumTotals([known, unknown]).cost_state, { coverage: 'partial', count: 2 })
  assert.deepEqual(sumTotals([unknown, unknown]).cost_state, { coverage: 'unknown', count: 4 })
  assert.equal(sumTotals([unknown, unknown]).margin_pct, null)
  assert.deepEqual(sumTotals([known, known]).cost_state, { coverage: 'known', count: 0 })
  const hidden = normalizeTotals({ tx_count: 1, revenue_usd: 5 })!
  assert.equal(sumTotals([hidden, hidden]).cost_state, undefined)
  assert.equal(combineCostStates([{ coverage: 'known', count: 0 }, null]), null)
})

test('the statement shows an all-unknown COGS and profit as unknown, a partial one with the note, a known zero as $0.00', () => {
  const fmt = (usd: number) => `$${usd.toFixed(2)}`
  const build = (extra: Record<string, unknown>) => buildIncomeStatement({ sales: normalizeTotals(totalsWire(extra)), profitMode: 'gross', khrToUsd: (k) => k / 4000 })
  const unknown = build({ cost_usd: null, profit_usd: null, margin_pct: null, cost_missing_snapshot_lines: 3 })
  for (const key of ['cogs', 'gross_profit']) {
    const line = unknown.find((l) => l.key === key)!
    assert.equal(statementAmount(line, fmt, tr), UNKNOWN, key)
  }
  assert.equal(unknown.some((l) => l.key === 'profit_rounding'), false, 'no Rounding term over an unknown cost')
  assert.equal(unknown.find((l) => l.key === 'revenue')!.unknownCost, undefined, 'revenue is not a cost figure')
  const partial = build({ cost_usd: 4, profit_usd: 26, cost_missing_snapshot_lines: 2, cost_known_lines: 5 })
  assert.equal(partial.find((l) => l.key === 'cogs')!.note?.key, 'cost_partial_count')
  assert.equal(partial.find((l) => l.key === 'cogs')!.note?.count, 2)
  assert.equal(statementAmount(partial.find((l) => l.key === 'cogs')!, fmt, tr), '$4.00')
  const zero = build({ cost_usd: 0, profit_usd: 30, margin_pct: 100 })
  assert.equal(statementAmount(zero.find((l) => l.key === 'cogs')!, fmt, tr), '$0.00', 'a recorded $0 cost stays $0.00')
  assert.equal(zero.find((l) => l.key === 'cogs')!.note, undefined)
  const hidden = buildIncomeStatement({ sales: normalizeTotals({ tx_count: 1, revenue_usd: 5, gross_sales_usd: 5 }), profitMode: 'gross', khrToUsd: (k) => k })
  assert.equal(hidden.some((l) => l.key === 'cogs' || l.key === 'gross_profit'), false, 'hidden cost has no COGS or profit line at all')
})

test('the delivery cost lines are unknown when no delivery recorded a cost, $0.00 when each recorded one, absent when hidden', () => {
  const fmt = (usd: number) => `$${usd.toFixed(2)}`
  const build = (extra: Record<string, unknown>) => buildIncomeStatement({ sales: normalizeTotals(totalsWire({ delivery_usd: 8, recognized_delivery_usd: 8, delivery_sale_count: 4, ...extra })), profitMode: 'gross', khrToUsd: (k) => k })
  const none = build({ delivery_actual_cost_usd: 0, delivery_actual_cost_count: 0 })
  assert.equal(statementAmount(none.find((l) => l.key === 'delivery_actual_cost')!, fmt, tr), UNKNOWN)
  assert.equal(statementAmount(none.find((l) => l.key === 'delivery_paid')!, fmt, tr), UNKNOWN)
  assert.equal(statementAmount(none.find((l) => l.key === 'delivery_collected')!, fmt, tr), '$8.00', 'the fee charged is not a cost')
  const recordedZero = build({ delivery_actual_cost_usd: 0, delivery_actual_cost_count: 4 })
  assert.equal(statementAmount(recordedZero.find((l) => l.key === 'delivery_actual_cost')!, fmt, tr), '$0.00')
  const hidden = build({ delivery_actual_cost_usd: undefined })
  assert.equal(hidden.some((l) => l.key === 'delivery_actual_cost'), false)
})

test('courierCostState: null or nobody-recorded is unknown, a recorded $0 is known, an absent key is hidden', () => {
  assert.deepEqual(courierCostState({ actual_cost_usd: null, actual_cost_count: 0, deliveries: 4 }), { coverage: 'unknown', count: 4 })
  assert.deepEqual(courierCostState({ actual_cost_usd: 0, actual_cost_count: 0, deliveries: 4 }), { coverage: 'unknown', count: 4 }, 'a $0 sum of zero recorded costs is not a recorded $0')
  assert.deepEqual(courierCostState({ actual_cost_usd: 0, actual_cost_count: 4, deliveries: 4 }), { coverage: 'known', count: 0 })
  assert.deepEqual(courierCostState({ actual_cost_usd: 6, actual_cost_count: 3, deliveries: 4 }), { coverage: 'partial', count: 1 })
  assert.equal(courierCostState({ deliveries: 4 }), null)
})

test('unknownCostMetadata adds the "Unknown-cost lines" line only when something is unknown', () => {
  assert.deepEqual(unknownCostMetadata({ coverage: 'partial', count: 3 }, tr), [`${en.rpt_unknown_cost_lines}: 3`])
  assert.deepEqual(unknownCostMetadata({ coverage: 'known', count: 0 }, tr), [])
  assert.deepEqual(unknownCostMetadata(null, tr), [])
})

test('formatReportMoney prints the unknown label for null and keeps rounding for numbers', () => {
  const deps = { displayCurrency: 'usd', fmtUSD: (v: number | string) => `$${Number(v).toFixed(2)}`, fmtKHR: String, khrToUsd: (v: unknown) => Number(v), usdToKhr: (v: unknown) => Number(v) }
  assert.equal(formatReportMoney(null, undefined, deps), 'Unknown cost')
  assert.equal(formatReportMoney(null, undefined, { ...deps, unknownLabel: UNKNOWN }, 4), UNKNOWN)
  assert.equal(formatReportMoney(0, undefined, deps), '$0.00')
  assert.equal(formatReportMoney(0, undefined, deps, 4), '$0.0000')
})

// ---- the table: cells, CSV, sort ------------------------------------------------
const table = loadModule(path.join(reportsDir, 'ReportTable.tsx'), { '../../../utils/formatters.ts': formattersStub }) as unknown as {
  formatCell: (column: unknown, row: unknown, fmt: (usd: number) => string, t?: (key: string) => string | undefined) => React.ReactNode
  csvColumnsFor: (columns: unknown[], fmt: (usd: number) => string) => Array<{ value: (row: unknown) => unknown }>
}
const fmt4 = (usd: number) => `$${usd.toFixed(4)}`
const t = (key: string) => en[key]
const costColumn = (state: (row: any) => unknown) => ({ key: 'cost_usd', label: 'Cost', kind: 'money', value: (row: any) => row.cost_usd ?? null, cost: state })

test('a cost cell renders Unknown cost for an unknown state, the amount for a known $0, and the amount plus the partial note for partial', () => {
  const column = costColumn((row) => row.state)
  const cell = (row: unknown) => renderToStaticMarkup(React.createElement(React.Fragment, null, table.formatCell(column, row, fmt4, t)))
  assert.match(cell({ cost_usd: 0, state: { coverage: 'unknown', count: 4 } }), new RegExp(UNKNOWN))
  assert.doesNotMatch(cell({ cost_usd: 0, state: { coverage: 'unknown', count: 4 } }), /\$0\.0000/, 'never $0.0000 for an unknown cost')
  assert.match(cell({ cost_usd: 0, state: { coverage: 'known', count: 0 } }), /\$0\.0000/)
  assert.doesNotMatch(cell({ cost_usd: 0, state: { coverage: 'known', count: 0 } }), new RegExp(UNKNOWN))
  const partial = cell({ cost_usd: 7.5, state: { coverage: 'partial', count: 2 } })
  assert.match(partial, /\$7\.5000/)
  assert.match(partial, new RegExp(PARTIAL(2)))
  assert.match(cell({ cost_usd: 3, state: null }), /\$3\.0000/, 'a column whose row has no cost state (hidden) renders as plain money')
  assert.doesNotMatch(cell({ cost_usd: 3, state: null }), new RegExp(UNKNOWN))
  const inline = cell({ cost_usd: 1, state: { coverage: 'unknown', count: 0 } })
  assert.match(inline, /data-icon="lucide-react\/dist\/esm\/icons\/alert-triangle\.js"/, 'the unknown cell carries the amber triangle')
})

test('CSV: the cell is empty for unknown, 0.0000 for a known $0, and 4 places for a known amount', () => {
  const [csv] = table.csvColumnsFor([costColumn((row) => row.state)], fmt4)
  assert.equal(csv.value({ cost_usd: 0, state: { coverage: 'unknown', count: 2 } }), '')
  assert.equal(csv.value({ cost_usd: 0, state: { coverage: 'known', count: 0 } }), '0.0000')
  assert.equal(csv.value({ cost_usd: 1.5, state: { coverage: 'partial', count: 1 } }), '1.5000')
  const [plain] = table.csvColumnsFor([{ key: 'x', label: 'X', kind: 'money', value: (row: any) => row.x }], fmt4)
  assert.equal(plain.value({ x: 2 }), 2, 'a money column that is not a cost column keeps its plain number')
})

// ---- the views, rendered ---------------------------------------------------------
type Fmt = (usd: number, khr?: number) => string
const fmtMoney: Fmt = (usd) => `$${(Number(usd) || 0).toFixed(2)}`
function renderGrouped(by: string, response: unknown, options: Record<string, unknown> = {}): string {
  const overrides = {
    '../../../utils/formatters.ts': formattersStub,
    './ReportFrame.tsx': { __esModule: true, default: ({ summary, children }: { summary?: string; children?: React.ReactNode }) => React.createElement('section', null, React.createElement('p', { 'data-summary': '' }, summary), children), useReportData: () => ({ data: response, loading: false, error: null, reload: () => undefined }) },
    '../../shared/kit': kitStub,
    '../../shared/ColumnChooser.tsx': universalStub,
    '../../shared/useColumnPreferences.ts': { useColumnPreferences: () => ({ isVisible: () => true, toggle: () => undefined, reset: () => undefined }) },
  }
  const grouped = loadModule(path.join(reportsDir, 'GroupedReport.tsx'), overrides).default as React.ComponentType<Record<string, unknown>>
  return renderToStaticMarkup(React.createElement(grouped, {
    tr, t: (key: string) => key, fmtMoney, khrToUsd: (k: number) => k / 4000, style: 'excel', search: '', canExport: () => false,
    filters: { startDate: '2026-09-01', endDate: '2026-09-30' }, options: { basis: 'revenue', ...options },
    view: { id: by, labelKey: by, fallback: by, groupedBy: by }, onDrill: () => undefined,
  }))
}
const courierRow = (extra: Record<string, unknown>) => ({ delivery_contact_id: 1, delivery_contact_name: 'Sok', deliveries: 4, charged_fee_usd: 8, absorbed_fee_usd: 0, actual_cost_usd: 5, actual_cost_count: 4, margin_usd: 3, last_delivery_at: null, ...extra })

test('Couriers: a null actual cost renders Unknown cost (and an unknown profit), never $0.00', () => {
  const html = renderGrouped('courier', { rows: [courierRow({ actual_cost_usd: null, actual_cost_count: 0, margin_usd: null })] })
  assert.match(html, new RegExp(UNKNOWN))
  const cells = [...(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
  assert.deepEqual(cells.slice(0, 5), ['Sok', '4', '$8.00', '$0.00', UNKNOWN], 'name, deliveries, charged, store-paid (a real $0.00), then the cost cell is unknown')
  assert.equal((html.match(new RegExp(UNKNOWN, 'g')) || []).length >= 2, true, 'cost and delivery profit are both unknown')
})

test('Couriers: a recorded $0 cost renders $0.00 and no unknown label', () => {
  const html = renderGrouped('courier', { rows: [courierRow({ actual_cost_usd: 0, actual_cost_count: 4, margin_usd: 8 })] })
  assert.match(html, /\$0\.00/)
  assert.doesNotMatch(html, new RegExp(UNKNOWN))
})

test('Couriers: the total over a recorded row and an unknown row carries the partial note', () => {
  const html = renderGrouped('courier', { rows: [courierRow({}), courierRow({ delivery_contact_id: 2, delivery_contact_name: 'Dara', actual_cost_usd: null, actual_cost_count: 0, margin_usd: null })] })
  assert.match(html, new RegExp(PARTIAL(4)), 'the totals row and the summary say 4 deliveries have no cost')
  assert.match(html, /\$5\.00/, 'the known cost still sums')
})

test('Couriers: a response without the cost keys (no permission) shows no cost or profit column at all', () => {
  const hiddenRow = courierRow({})
  delete (hiddenRow as Record<string, unknown>).actual_cost_usd
  const html = renderGrouped('courier', { rows: [hiddenRow] })
  assert.doesNotMatch(html, /Actual delivery cost/)
  assert.doesNotMatch(html, new RegExp(UNKNOWN), 'hidden is not unknown')
  assert.match(html, /Delivery fee charged/)
})

const groupRow = (extra: Record<string, unknown>) => ({ key: 'sok', label: 'Sok', entity_id: 1, ...totalsWire({}), ...extra })
test('Grouped totals: one unknown row shows the partial note on the totals row and in the summary', () => {
  const html = renderGrouped('customer', {
    rows: [groupRow({}), groupRow({ key: 'dara', label: 'Dara', cost_usd: 2, profit_usd: 28, cost_missing_snapshot_lines: 1, cost_known_lines: 2 })],
    totals: totalsWire({ cost_usd: 14, profit_usd: 46, cost_missing_snapshot_lines: 1, cost_known_lines: 6, tx_count: 6, revenue_usd: 60, gross_sales_usd: 60, net_sales_usd: 60 }),
  })
  assert.match(html, new RegExp(PARTIAL(1)))
  assert.doesNotMatch(html, new RegExp(UNKNOWN), 'a partial total is not an unknown one')
})

test('Grouped rows: an all-unknown row is Unknown cost with a blank margin; a $0 row stays $0.00; hidden cost has no cost columns', () => {
  const unknownRow = groupRow({ key: 'dara', label: 'Dara', cost_usd: 0, profit_usd: 30, margin_pct: 100, cost_missing_snapshot_lines: 3, cost_known_lines: 0 })
  const zeroRow = groupRow({ cost_usd: 0, profit_usd: 30, margin_pct: 100, cost_missing_snapshot_lines: 0, cost_known_lines: 4 })
  const html = renderGrouped('customer', { rows: [zeroRow, unknownRow] })
  assert.match(html, new RegExp(UNKNOWN))
  assert.match(html, /\$0\.00/)
  assert.match(html, /100\.0*%?/, 'the known-$0 row keeps its 100% margin')
  const hiddenRow = { key: 'sok', label: 'Sok', entity_id: 1, tx_count: 3, gross_sales_usd: 30, revenue_usd: 30 }
  const hiddenHtml = renderGrouped('customer', { rows: [hiddenRow] })
  assert.doesNotMatch(hiddenHtml, new RegExp(UNKNOWN))
  assert.doesNotMatch(hiddenHtml, />Margin</)
})

test('Products: an unknown COGS row shows Unknown cost, the total is partial, a $0 row is $0.00', () => {
  const product = (extra: Record<string, unknown>) => ({ product_id: 1, product_name: 'Soap', sale_count: 2, qty: 3, line_sales_usd: 30, cost_usd: 12, profit_usd: 18, margin_pct: 60, cost_missing_snapshot_lines: 0, ...extra })
  const html = renderGrouped('product', { rows: [product({ product_id: 2, product_name: 'Lotion', cost_usd: 0, profit_usd: 30, margin_pct: 100, cost_missing_snapshot_lines: 2 }), product({ cost_usd: 0, profit_usd: 30, margin_pct: 100, cost_missing_snapshot_lines: 0 })] })
  assert.match(html, new RegExp(UNKNOWN))
  assert.match(html, /\$0\.00/)
  assert.match(html, new RegExp(PARTIAL(2)))
})

// ---- the receipt list and its export ---------------------------------------------
const salesList = loadModule(path.join(reportsDir, 'SalesListReport.tsx'), { '../../../utils/formatters.ts': formattersStub }) as unknown as {
  mapSaleRow: (raw: unknown, index: number) => any
  sumSaleRows: (rows: any[]) => any
}
const saleWire = (extra: Record<string, unknown>) => ({
  id: 1, receipt_number: 'R1', date: '2026-09-01 10:00:00', business_date: '2026-09-01', branch: 'B', cashier: 'C', customer: 'X', customer_phone: '', payment_method: 'Cash', status: 'completed',
  gross_sales_usd: 10, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, net_revenue_usd: 10, pending_revenue_usd: 0, collected_total_usd: 10,
  cost_usd: 4, cost_before_floor_usd: 4, gross_profit_usd: 6, cost_missing_snapshot_lines: 0, ...extra,
})

test('mapSaleRow: presence gates accept null, hidden stays absent, a known $0 is known', () => {
  const unknown = salesList.mapSaleRow(saleWire({ cost_usd: null, cost_before_floor_usd: null, gross_profit_usd: null, cost_missing_snapshot_lines: 2 }), 0)
  assert.equal(unknown.cost_state.coverage, 'unknown')
  assert.equal(typeof unknown.gross_profit_usd, 'number', 'the profit presence gate still sees the key')
  const zero = salesList.mapSaleRow(saleWire({ cost_usd: 0, cost_before_floor_usd: 0, gross_profit_usd: 10 }), 0)
  assert.equal(zero.cost_state.coverage, 'known')
  const hidden = salesList.mapSaleRow({ ...saleWire({}), cost_usd: undefined, cost_before_floor_usd: undefined, gross_profit_usd: undefined, cost_missing_snapshot_lines: undefined }, 0)
  assert.equal(hidden.cost_state, undefined)
  assert.equal(hidden.cost_usd, undefined)
})

test('sumSaleRows: an unknown receipt adds no profit and no cost, and turns the total partial', () => {
  const known = salesList.mapSaleRow(saleWire({}), 0)
  const unknown = salesList.mapSaleRow(saleWire({ id: 2, cost_usd: null, cost_before_floor_usd: null, gross_profit_usd: null, cost_missing_snapshot_lines: 2 }), 1)
  const sum = salesList.sumSaleRows([known, unknown])
  assert.deepEqual(sum.cost_state, { coverage: 'partial', count: 2 })
  assert.equal(sum.cost_usd, 4)
  assert.equal(sum.gross_profit_usd, 6)
  assert.equal(salesList.sumSaleRows([unknown, unknown]).cost_state.coverage, 'unknown')
})

const exportRow = (extra: Record<string, unknown>) => ({ ...saleWire({}), cursor_at: '2026-09-01 10:00:00', ...extra })
test('salesReportExport no longer throws on a null cost and keeps it unknown', () => {
  const row = validateExportSale(exportRow({ cost_usd: null, cost_before_floor_usd: null, gross_profit_usd: null, cost_missing_snapshot_lines: 1 }))
  assert.equal(row.cost_state?.coverage, 'unknown')
  assert.throws(() => validateExportSale(exportRow({ cost_usd: 'x' })), 'a string cost is still invalid')
  assert.throws(() => validateExportSale(exportRow({ cost_usd: undefined })), 'a half-present cost set is still invalid')
  assert.equal(nullableFinite(null), null)
  assert.equal(nullableFinite(0), 0)
  assert.throws(() => nullableFinite(Number.NaN))
  const totals = mapExportTotals({ gross_sales_usd: 10, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, revenue_usd: 10, pending_revenue_usd: 0, collected_total_usd: 10, cost_usd: null, profit_usd: null, cost_missing_snapshot_lines: 3, cost_known_lines: 0 })
  assert.equal(totals.cost_state?.coverage, 'unknown')
  assert.equal(totals.cost_missing_snapshot_lines, 3)
  const partial = mapExportTotals({ gross_sales_usd: 10, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0, revenue_usd: 10, pending_revenue_usd: 0, collected_total_usd: 10, cost_usd: 4, profit_usd: 6, cost_missing_snapshot_lines: 1, cost_known_lines: 2 })
  assert.deepEqual(partial.cost_state, { coverage: 'partial', count: 1 })
})

test('the receipt export writes a blank cell for an unknown cost, a number for $0, and the label on the print sheet', () => {
  const known = salesList.mapSaleRow(saleWire({ cost_usd: 0, cost_before_floor_usd: 0, gross_profit_usd: 10 }), 0)
  const unknown = salesList.mapSaleRow(saleWire({ id: 2, cost_usd: null, cost_before_floor_usd: null, gross_profit_usd: null, cost_missing_snapshot_lines: 2 }), 1)
  const columns = [
    { key: 'receipt_number', label: 'Receipt', value: (r: any) => r.receipt_number },
    { key: 'cost_usd', label: 'Cost', kind: 'money', value: (r: any) => r.cost_usd ?? null, cost: (r: any) => r.cost_state ?? null },
  ]
  const document = { rows: [known, unknown], totals: salesList.sumSaleRows([known, unknown]), columns, fmtMoney: fmt4, unknownLabel: UNKNOWN } as any
  const csv = saleExportObjects(document, true)
  assert.equal(csv[0].Cost, '$0.0000', 'a known $0 prints 0.0000')
  assert.equal(csv[1].Cost, '', 'an unknown cost is an empty cell')
  const excel = saleExportObjects(document)
  assert.equal(excel[0].cost_usd, 0)
  assert.equal(excel[1].cost_usd, null)
  assert.equal(saleExportObjects(document, true, 'label')[1].Cost, UNKNOWN)
})

// ---- the sales line-item export ---------------------------------------------------
test('the sales line-item export writes blank for a NULL item cost and keeps a recorded 0', () => {
  const [row] = buildSalesImportRows([{ receipt_number: 'R1', items: [{ product_name: 'A', quantity: 1, cost_price_usd: null, cost_price_khr: null }] }])
  assert.equal(row.cost_price_usd, '')
  assert.equal(row.cost_price_khr, '')
  const [zero] = buildSalesImportRows([{ receipt_number: 'R2', items: [{ product_name: 'B', quantity: 1, cost_price_usd: 0, cost_price_khr: 0 }] }])
  assert.equal(zero.cost_price_usd, 0, 'a recorded $0 cost is not blanked')
  const [missing] = buildSalesImportRows([{ receipt_number: 'R3', items: [{ product_name: 'C', quantity: 1 }] }])
  assert.equal(missing.cost_price_usd, '', 'an item with no cost key at all is blank too')
})

// ---- source-shape pins for the views that need a router/app to render --------------
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
test('Overview, Period and ExportModal route cost through the unknown-aware helpers', () => {
  const overview = read(path.join(reportsDir, 'OverviewReport.tsx'))
  assert.match(overview, /statementAmount\(l, fmtMoney, tr\)/)
  assert.doesNotMatch(overview, /fmtMoney\(l\.usd, l\.khr\)/, 'the old direct formatting is gone')
  assert.match(overview, /Amount_USD: l\.unknownCost \? '' : l\.usd/, 'the statement CSV leaves an unknown amount blank')
  assert.match(overview, /courierCostState\(row\)/)
  const period = read(path.join(reportsDir, 'PeriodReport.tsx'))
  assert.match(period, /statementAmount\(l, fmtMoney, tr\)/)
  assert.match(period, /unknownCostMetadata\(totals\.cost_state, tr\)/)
  const modal = read(path.join(src, 'components', 'sales', 'ExportModal.tsx'))
  assert.match(modal, /costText\(state, fmtUSD\(preview\.summary\?\.cogs_usd \|\| 0\), tr\)/)
  assert.doesNotMatch(modal, /typeof preview\.summary\?\.gross_profit_usd === 'number'/, 'the presence gate accepts null')
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll reports unknown-cost tests passed')
