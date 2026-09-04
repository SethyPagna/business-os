// Pins the Reports redesign (Sep 3 2026, rc/sec-10): the pure report model
// (src/components/sales/reports/reportModel.ts) and the source-shape
// contracts of the hub + its views.
//
//   - buildIncomeStatement is arithmetically closed on the canonical kernel
//     figures it is given (gross -> discounts -> net sales -> pending ->
//     refunds -> REVENUE; revenue + tax/delivery -> COLLECTED; revenue -
//     COGS - store delivery -> GROSS PROFIT; - expenses -> NET RESULT) and
//     never shows a profit line for a caller the server hid cost from.
//   - normalizeTotals / sumTotals copy the admin-only keys ONLY when the
//     server sent them (absence, not 0, is the "hidden" signal).
//   - reportQueryParams sends the clock window / status / payment only to
//     views whose endpoints honor them.
//   - every 'rpt_*' key the hub and views look up exists in BOTH packs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASIS_LABELS,
  DEFAULT_REPORT_OPTIONS,
  EMPTY_REPORT_FILTERS,
  REPORT_STORAGE_KEYS,
  REPORT_VIEWS,
  basisValue,
  buildIncomeStatement,
  defaultReportStyle,
  getReportView,
  hasProfit,
  hourRangeLabel,
  normalizeReportOptions,
  normalizeReportStyle,
  normalizeTotals,
  periodLabel,
  readStoredJson,
  reportFileName,
  reportQueryParams,
  resolveReportView,
  rowsToCsvObjects,
  sortRows,
  sumTotals,
  toggleSort,
  visibleReportViews,
  writeStoredJson,
  type ReportTotals,
} from '../src/components/sales/reports/reportModel.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

const rootPath = fileURLToPath(new URL('../', import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> => JSON.parse(read(rel)) as Record<string, unknown>

// A canonical totals block as the server sends it to an ADMIN. Figures chosen
// so every derived line is a distinct number: item discount 45 -> list price
// 345; gross 300, store discount 20, membership 10 -> net sales 270 and a
// total discount of 75; pending 40; refunds 15 -> revenue 215; collected 233
// (= revenue + tax 8 + customer delivery 10); cost 90; store delivery 5 ->
// profit 120.
const adminTotals = {
  tx_count: 6,
  gross_sales_usd: 300,
  store_discount_usd: 20,
  membership_discount_usd: 10,
  discount_usd: 30,
  item_discount_usd: 45,
  total_discount_usd: 75,
  tax_usd: 8,
  delivery_usd: 10,
  store_delivery_usd: 5,
  delivery_actual_cost_usd: 0,
  delivery_actual_cost_count: 0,
  delivery_sale_count: 1,
  delivery_margin_usd: 0,
  refund_usd: 15,
  revenue_usd: 215,
  pending_revenue_usd: 40,
  collected_total_usd: 233,
  avg_order_usd: 35.83,
  cost_usd: 90,
  profit_usd: 120,
  margin_pct: 55.81,
  cost_missing_snapshot_lines: 2,
}
const { cost_usd: _c, profit_usd: _p, margin_pct: _m, cost_missing_snapshot_lines: _l, ...staffTotals } = adminTotals
const khrToUsd = (khr: number) => khr / 4000
const lineMap = (lines: ReturnType<typeof buildIncomeStatement>) => Object.fromEntries(lines.map((l) => [l.key, l]))

test('normalizeTotals copies the admin keys only when the server sent them', () => {
  const admin = normalizeTotals(adminTotals)
  const staff = normalizeTotals(staffTotals)
  assert.ok(admin && hasProfit(admin), 'admin totals carry profit')
  assert.equal(admin.cost_missing_snapshot_lines, 2)
  assert.ok(staff && !hasProfit(staff), 'staff totals do not')
  assert.ok(!('cost_usd' in staff) && !('profit_usd' in staff) && !('margin_pct' in staff), 'the keys are ABSENT, not 0')
  assert.equal(staff.revenue_usd, 215)
  assert.equal(normalizeTotals(null), null)
  assert.equal(normalizeTotals('x'), null)
  // margin is derived when the server omitted it
  const derived = normalizeTotals({ ...adminTotals, margin_pct: undefined })
  assert.equal(derived?.margin_pct, 55.8, "client-derived margin uses the model pct (1 decimal, the display precision)")
})

test('buildIncomeStatement: revenue and collected groups close arithmetically on kernel figures', () => {
  const lines = buildIncomeStatement({ sales: normalizeTotals(staffTotals), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 0 } })
  const m = lineMap(lines)
  // The statement opens at what the goods were LISTED at and takes the
  // per-line discount off in the open. gross_sales_usd is SUM(subtotal_usd)
  // and a subtotal is already net of its lines’ own discounts, so opening at
  // it (as this statement used to) hid the figure entirely -- $2,338.85 of it
  // in production in August 2026 alone.
  assert.equal(m.list_price.usd, 345, 'list price = gross sales + the per-line discount')
  assert.equal(m.item_discounts.usd, 45)
  assert.equal(m.list_price.usd - m.item_discounts.usd, m.gross_sales.usd, 'the opening pair closes onto gross sales')
  assert.equal(m.gross_sales.usd, 300)
  assert.equal(m.gross_sales.kind, 'total', 'gross sales is now the subtotal of the two lines above it')
  assert.equal(m.net_sales.usd, 270, 'net sales = gross - store - membership discounts')
  assert.equal(m.net_sales.kind, 'total')
  assert.equal(m.pending_credit.usd, 40)
  assert.equal(m.refunds.usd, 15)
  assert.equal(m.revenue.usd, 215, 'REVENUE is the kernel figure, shown after net sales - pending - refunds')
  assert.equal(m.net_sales.usd - m.pending_credit.usd - m.refunds.usd, m.revenue.usd, 'the revenue group is closed')
  assert.equal(m.tax_delivery_collected.usd, 18, 'tax + customer-paid delivery = collected - revenue')
  assert.equal(m.revenue.usd + m.tax_delivery_collected.usd, m.collected_total.usd, 'the collected group is closed')
  // No cost on the server side -> no profit group at all, regardless of the profit mode / expenses given.
  assert.ok(!('cogs' in m) && !('gross_profit' in m) && !('expenses' in m) && !('net_result' in m), 'no profit lines for a caller without cost')
  assert.ok(lines.every((l) => l.group !== 'profit'))
  assert.equal(lines.length, 11)
})

test('buildIncomeStatement: the profit group closes (gross) and subtracts expenses (net) with KHR converted', () => {
  const gross = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'gross', khrToUsd, expenses: { usd: 10, khr: 40000 } }))
  assert.equal(gross.cogs.usd, 90)
  assert.equal(gross.store_delivery.usd, 5, 'store-paid delivery = revenue - cost - profit')
  assert.equal(gross.gross_profit.usd, 120)
  assert.equal(gross.revenue.usd - gross.cogs.usd - gross.store_delivery.usd, gross.gross_profit.usd, 'the profit group is closed')
  assert.ok(!('expenses' in gross) && !('net_result' in gross), 'gross mode stops at gross profit')

  const net = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 40000 } }))
  assert.equal(net.expenses.usd, 20, '$10 + 40,000៛ at 4000 = $20')
  assert.equal(net.expenses.khr, 40000, 'the raw KHR is kept for display')
  assert.equal(net.expenses.hintKey, 'rpt_hint_expenses_line')
  assert.equal(net.net_result.usd, 100, 'net result = gross profit - expenses')
  assert.equal(net.net_result.kind, 'total')
  // net mode without an expenses block (caller cannot read expenses) shows no net lines
  const netNoExp = lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'net', khrToUsd }))
  assert.ok(!('expenses' in netNoExp) && !('net_result' in netNoExp))
})

test('buildIncomeStatement: previous-period figures ride the same lines; none without a previous block', () => {
  const prev = { ...adminTotals, gross_sales_usd: 200, revenue_usd: 150, collected_total_usd: 160, profit_usd: 80, cost_usd: 60 }
  const lines = buildIncomeStatement({ sales: normalizeTotals(adminTotals), prevSales: normalizeTotals(prev), profitMode: 'net', khrToUsd, expenses: { usd: 10, khr: 0 }, prevExpenses: { usd: 5, khr: 0 } })
  const m = lineMap(lines)
  assert.equal(m.gross_sales.prevUsd, 200)
  assert.equal(m.revenue.prevUsd, 150)
  assert.equal(m.gross_profit.prevUsd, 80)
  assert.equal(m.net_result.prevUsd, 75)
  assert.ok(lineMap(buildIncomeStatement({ sales: normalizeTotals(adminTotals), profitMode: 'gross', khrToUsd })).revenue.prevUsd === null)
  assert.deepEqual(buildIncomeStatement({ sales: null, profitMode: 'gross', khrToUsd }), [])
})

test('sumTotals sums additive figures, recomputes the average, and keeps profit only when EVERY row has it', () => {
  const a = normalizeTotals(adminTotals) as ReportTotals
  const b = normalizeTotals({ ...adminTotals, tx_count: 4, revenue_usd: 100.005, profit_usd: 30, cost_usd: 70, cost_missing_snapshot_lines: 1 }) as ReportTotals
  const both = sumTotals([a, b])
  assert.equal(both.tx_count, 10)
  assert.equal(both.revenue_usd, 315.01, 'money re-rounded to cents')
  assert.equal(both.avg_order_usd, 31.5, 'average = revenue / tx, never summed')
  assert.equal(both.profit_usd, 150)
  assert.equal(both.cost_usd, 160)
  assert.equal(both.cost_missing_snapshot_lines, 3)
  assert.equal(both.margin_pct, 47.6)
  const mixed = sumTotals([a, normalizeTotals(staffTotals) as ReportTotals])
  assert.ok(!hasProfit(mixed), 'one row without cost -> no profit on the total (never a misleading partial sum)')
  assert.ok(!('cost_usd' in mixed))
  const empty = sumTotals([])
  assert.equal(empty.tx_count, 0)
  assert.equal(empty.avg_order_usd, 0)
  assert.ok(!hasProfit(empty))
})

test('basisValue / BASIS_LABELS: the three calculation bases read distinct kernel figures', () => {
  const t = normalizeTotals(adminTotals)
  assert.equal(basisValue(t, 'revenue'), 215)
  assert.equal(basisValue(t, 'gross'), 300)
  assert.equal(basisValue(t, 'collected'), 233)
  assert.equal(basisValue(null, 'revenue'), 0)
  assert.deepEqual(Object.keys(BASIS_LABELS).sort(), ['collected', 'gross', 'revenue'])
})

test('reportQueryParams: clock window only for timestamp-backed views; status/payment only where understood; all-day window dropped', () => {
  const f = { ...EMPTY_REPORT_FILTERS, startDate: '2026-08-01', endDate: '2026-08-31', startTime: '09:00', endTime: '17:00', branchId: '1', status: 'completed', paymentMethod: 'Cash' }
  const sales = reportQueryParams(f, getReportView('sales'))
  assert.deepEqual(sales, { startDate: '2026-08-01', endDate: '2026-08-31', branchId: '1', startTime: '09:00', endTime: '17:00', status: 'completed', paymentMethod: 'Cash' })
  const returns = reportQueryParams(f, getReportView('returns'))
  assert.deepEqual(returns, { startDate: '2026-08-01', endDate: '2026-08-31', branchId: '1' }, 'a date-only ledger gets neither the clock nor the sale filters')
  const expenses = reportQueryParams(f, getReportView('expenses'))
  assert.deepEqual(expenses, returns)
  const allDay = reportQueryParams({ ...f, startTime: '00:00', endTime: '23:59' }, getReportView('periods'))
  assert.ok(!('startTime' in allDay), 'the whole-day window is the default and is not sent')
  const half = reportQueryParams({ ...f, endTime: '' }, getReportView('periods'))
  assert.ok(!('startTime' in half) && !('endTime' in half), 'a half-set window is not sent')
  assert.deepEqual(reportQueryParams(EMPTY_REPORT_FILTERS, getReportView('overview')), {})
})

test('views: permissions gate the picker, the stored view survives only while allowed', () => {
  const all = { sales: true, returns: true, fees: true }
  assert.equal(visibleReportViews(all).length, REPORT_VIEWS.length)
  const feesOnly = visibleReportViews({ sales: false, returns: false, fees: true }).map((v) => v.id)
  assert.deepEqual(feesOnly, ['overview', 'expenses'], 'the Overview is visible with any one area; sales views are not')
  assert.equal(resolveReportView('products', all), 'products')
  assert.equal(resolveReportView('products', { sales: false, returns: true, fees: false }), 'overview', 'a no-longer-allowed stored view falls back to the first allowed one')
  assert.equal(resolveReportView('bogus', all), 'overview')
  assert.equal(resolveReportView('sales', { sales: false, returns: false, fees: false }), null, 'nothing readable -> null (the hub shows its EmptyState)')
  for (const v of REPORT_VIEWS) {
    if (v.id === 'returns' || v.id === 'expenses') assert.equal(v.supportsTime, false, `${v.id} is date-only`)
    else assert.equal(v.supportsTime, true, `${v.id} honors the clock window`)
    if (v.groupedBy) assert.ok(v.area === 'sales', `${v.id} grouped views are sales-gated`)
  }
  const ids = REPORT_VIEWS.map((v) => v.id)
  assert.equal(new Set(ids).size, ids.length, 'view ids are unique')
})

test('options / style persistence is tolerant of garbage and round-trips through storage', () => {
  assert.deepEqual(normalizeReportOptions(undefined), DEFAULT_REPORT_OPTIONS)
  assert.deepEqual(normalizeReportOptions({ basis: 'collected', profitMode: 'nope', granularity: 'week', compare: 'yes', currency: 'khr' }), { basis: 'collected', profitMode: 'gross', granularity: 'week', compare: false, currency: 'khr' })
  assert.equal(normalizeReportStyle('receipt'), 'receipt')
  assert.equal(normalizeReportStyle('grid'), null)
  assert.equal(defaultReportStyle(true), 'receipt')
  assert.equal(defaultReportStyle(false), 'excel')
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  writeStoredJson(storage, REPORT_STORAGE_KEYS.options, { ...DEFAULT_REPORT_OPTIONS, basis: 'gross' })
  assert.equal(readStoredJson(storage, REPORT_STORAGE_KEYS.options, normalizeReportOptions).basis, 'gross')
  store.set(REPORT_STORAGE_KEYS.options, '{not json')
  assert.deepEqual(readStoredJson(storage, REPORT_STORAGE_KEYS.options, normalizeReportOptions), DEFAULT_REPORT_OPTIONS, 'corrupt storage falls back, never throws')
  const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(readStoredJson(throwing, 'k', normalizeReportOptions), DEFAULT_REPORT_OPTIONS)
  assert.doesNotThrow(() => writeStoredJson(throwing, 'k', 1))
  assert.deepEqual(readStoredJson(null, 'k', normalizeReportOptions), DEFAULT_REPORT_OPTIONS)
})

test('labels: hours read as a clock range, weeks as a Monday–Sunday span, months as mm/yyyy', () => {
  assert.equal(hourRangeLabel('9'), '09:00–09:59')
  assert.equal(hourRangeLabel('13'), '13:00–13:59')
  assert.equal(hourRangeLabel('zz'), 'zz')
  const fmt = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}` }
  assert.equal(periodLabel({ period: '2026-08-17', date_from: '2026-08-17', date_to: '2026-08-23' }, 'week', fmt), '08/17/2026 – 08/23/2026')
  assert.equal(periodLabel({ period: '2026-08', date_from: '2026-08-01', date_to: '2026-08-31' }, 'month', fmt), '08/2026')
  assert.equal(periodLabel({ period: '2026-08-20', date_from: '2026-08-20', date_to: '2026-08-20' }, 'day', fmt), '08/20/2026')
})

test('sorting is stable, numeric-aware, and keeps empties last in both directions', () => {
  const rows = [{ n: 'b', v: 10 }, { n: 'a', v: null }, { n: 'c', v: 2 }, { n: 'd', v: 10 }]
  assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n), ['b', 'd', 'c', 'a'])
  assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n), ['c', 'b', 'd', 'a'])
  assert.deepEqual(sortRows([{ n: 'x10' }, { n: 'x9' }, { n: 'X1' }], (r) => r.n, 'asc').map((r) => r.n), ['X1', 'x9', 'x10'])
  assert.deepEqual(toggleSort(null, 'revenue'), { key: 'revenue', dir: 'desc' })
  assert.deepEqual(toggleSort({ key: 'revenue', dir: 'desc' }, 'revenue'), { key: 'revenue', dir: 'asc' })
  assert.deepEqual(toggleSort({ key: 'revenue', dir: 'asc' }, 'date', 'asc'), { key: 'date', dir: 'asc' })
})

test('CSV rows use the column headers as keys and never emit undefined; file names carry view + range', () => {
  const out = rowsToCsvObjects([{ header: 'Date', value: (r: { d: string; v?: number }) => r.d }, { header: 'Revenue', value: (r) => r.v }], [{ d: '2026-08-20', v: 5 }, { d: '2026-08-21' }])
  assert.deepEqual(out, [{ Date: '2026-08-20', Revenue: 5 }, { Date: '2026-08-21', Revenue: '' }])
  assert.equal(reportFileName('sales', { startDate: '2026-08-01', endDate: '2026-08-31' }, 'csv'), 'sales-report-2026-08-01_2026-08-31.csv')
  assert.equal(reportFileName('overview', { startDate: '', endDate: '' }, 'csv'), 'overview-report-all_all.csv')
})

// ---- source-shape contracts ----------------------------------------------

const HUB = 'src/components/sales/ReportsHub.tsx'
const VIEW_FILES = [
  'src/components/sales/reports/OverviewReport.tsx',
  'src/components/sales/reports/PeriodReport.tsx',
  'src/components/sales/reports/SalesListReport.tsx',
  'src/components/sales/reports/GroupedReport.tsx',
  'src/components/sales/reports/ReturnsReport.tsx',
  'src/components/sales/reports/ExpensesReport.tsx',
]
const SHARED_FILES = [
  'src/components/sales/reports/reportModel.ts',
  'src/components/sales/reports/reportTypes.ts',
  'src/components/sales/reports/ReportFrame.tsx',
  'src/components/sales/reports/ReportTable.tsx',
  'src/components/sales/reports/ReceiptSheet.tsx',
  'src/components/sales/reports/ReportOptionsFold.tsx',
]

test('every rpt_* key the hub, views and model reference exists in BOTH language packs', () => {
  const en = readJson('src/lang/en.json')
  const km = readJson('src/lang/km.json')
  const missing: string[] = []
  for (const rel of [HUB, ...VIEW_FILES, ...SHARED_FILES]) {
    const src = read(rel)
    for (const m of src.matchAll(/'(rpt_[a-z0-9_]+)'/g)) {
      const key = m[1]
      if (!(key in en)) missing.push(`${rel}: ${key} (en)`)
      if (!(key in km)) missing.push(`${rel}: ${key} (km)`)
      else if (!String(km[key]).trim()) missing.push(`${rel}: ${key} (km empty)`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the hub persists view / style / options under the model\'s storage keys and derives the style from the viewport', () => {
  const hub = read(HUB)
  assert.ok(hub.includes('REPORT_STORAGE_KEYS.view') && hub.includes('REPORT_STORAGE_KEYS.style') && hub.includes('REPORT_STORAGE_KEYS.options'))
  assert.ok(hub.includes('styleChoice ?? defaultReportStyle(compact)'), 'unset style follows the viewport (receipt on phones, excel wider)')
  assert.ok(hub.includes('<ControlRow') && hub.includes('sticky'), 'one shared sticky control row')
  assert.ok(hub.includes('<ReportOptionsFold'), 'the filter menu is wired')
  // The business-summary workbook belongs to the business-workbook lane and
  // its endpoints are not on this line, so the hub deliberately ships without
  // it here. Pinned as an absence so it cannot creep back in half-wired.
  assert.ok(!hub.includes('exportBusinessWorkbook('), 'the hub does not reach for the workbook export that is not on this line')
  assert.ok(!hub.includes('SalesDailyReport') && !hub.includes('ReturnsReportSection') && !hub.includes('FeesReportSection'), 'the old three sections are gone (no zombie imports)')
  for (const old of ['src/components/sales/SalesDailyReport.tsx', 'src/components/sales/ReturnsReportSection.tsx', 'src/components/sales/FeesReportSection.tsx']) {
    assert.ok(!fs.existsSync(path.join(rootPath, old)), `${old} was deleted`)
  }
})

test('the control row keeps every control at each width: nothing is dropped, nothing is doubled', () => {
  const hub = read(HUB)
  // ControlRow renders `overflow` INSTEAD of filters/sort/actions from 1023px
  // down. Passing a tail that held only the export menu silently deleted the
  // view picker and the filter selects between 768 and 1023 -- the tail has to
  // be unconditional.
  assert.ok(/overflow=\{collapsedTail\}/.test(hub), 'the collapsed tail is passed at every width, not only when compact')
  assert.ok(/actions=\{collapsedTail\}/.test(hub), 'the wide tier renders the SAME tail, so no control exists at only one width')
  const tail = hub.slice(hub.indexOf('const collapsedTail'), hub.indexOf('const body'))
  assert.ok(tail.includes('{filtersButton}'), 'the tail carries the filter menu')

  // Part 586: the view picker moved OUT of the tail and into the search slot,
  // which ControlRow renders at all three tiers. That makes "never dropped"
  // structural rather than a per-tier conditional -- but it must then appear
  // exactly once, or a wide screen shows two pickers.
  assert.ok(!tail.includes('viewPicker'), 'the picker is not in the tail any more (it would double up with the search slot)')
  assert.ok(/const searchSlot = \([\s\S]*?\{viewPicker\}/.test(hub), 'the search slot carries the view picker at every tier')
  assert.equal((hub.match(/\{viewPicker\}/g) || []).length, 1, 'the view picker is rendered in exactly one place')

  // The four controls Part 586 folded into the one menu must not come back as
  // separate control-row citizens -- that crowding is what hid the search box.
  assert.ok(!hub.includes('<OverflowMenu'), 'no separate overflow menu beside the filter menu')
  assert.ok(!hub.includes('const styleToggle'), 'the Excel/Receipt toggle lives in the menu, not on the row')
  assert.ok(!hub.includes('const optionsButton'), 'the calculation options open from the same menu button')
  assert.equal((hub.match(/<Fold\b/g) || []).length, 0, 'the hub opens ONE fold, and it is ReportOptionsFold')

  // The search box is the control the user reported missing. It must render,
  // carry a visible affordance, and hold a width floor so the range picker
  // cannot squeeze it to nothing at the 768-1023 tier.
  assert.ok(hub.includes('type="search"'), 'the search input is present')
  assert.ok(hub.includes('<SearchIcon'), 'the search box reads as a search box')
  assert.ok(/min-w-\[9rem\] flex-1/.test(hub), 'the search box keeps a width floor and takes the free space')

  // The menu owns the filters AND the options, so its badge must count both,
  // and its Reset must clear both -- a Reset that silently left a non-default
  // basis in force would be worse than no Reset.
  assert.ok(/filterControls=\{/.test(hub), 'the filter selects are passed into the menu')
  assert.ok(/onStyleChange=\{/.test(hub), 'the style choice is made in the menu')
  assert.ok(hub.includes('activeFilterCount + (optionsAreDefault ? 0 : 1)'), 'the badge counts filters and non-default options')
  assert.ok(/onReset=\{\(\) => \{ clearFilters\(\); setOptions\(/.test(hub), 'one Reset clears the filters and the options together')

  // The date range is the widest control on a phone row; it only fits because
  // the trigger becomes a full-width field whose labels can truncate.
  assert.ok(hub.includes("triggerClassName={compact ? 'flex w-full min-w-0"), 'the range trigger goes full-width and shrinkable on phones')
  const picker = read('src/components/shared/DateTimeRangePicker.tsx')
  const spans = picker.match(/className=\{`min-w-0 truncate /g) || []
  assert.equal(spans.length, 2, 'both endpoint labels can actually truncate (min-w-0, not truncate alone)')
})

// --- Part 586: density, and the Khmer line box ----------------------------
//
// The reports surface reads ~18 `--ui-*` custom properties through the kit.
// styles/tokens.css, which DECLARES them, is on the rc/p2-1-kit line and did
// not come across with the kit port -- so every one of them was undefined and
// `var(--ui-row-h)` etc. was invalid at computed-value time (no row rhythm,
// no hairlines, no zebra, inherited 14px text). reports-surface.css declares
// them on this line. If it ever goes missing again, the surface degrades
// silently -- nothing throws -- so pin it here.
const SURFACE_CSS = 'src/components/sales/reports/reports-surface.css'

test('every --ui-* token the reports surface reads is declared, and the density numbers are the tight ones', () => {
  const css = read(SURFACE_CSS)
  assert.ok(read(HUB).includes("import './reports/reports-surface.css'"), 'the hub imports the token layer')

  const sources = [HUB, ...VIEW_FILES, ...SHARED_FILES, 'src/components/shared/kit/DenseTable.tsx']
    .map(read).join('\n')
  const used = new Set([...sources.matchAll(/var\((--ui-[a-z0-9-]+)/g)].map((m) => m[1]))
  // main.css owns these two already; everything else must come from our file.
  const declaredElsewhere = new Set(['--ui-accent', '--ui-radius'])
  const undeclared = [...used].filter((v) => !declaredElsewhere.has(v) && !new RegExp(`\\${v}\\s*:`).test(css))
  assert.deepEqual(undeclared, [], `these tokens are read but declared nowhere:\n  ${undeclared.join('\n  ')}`)

  // The density the user asked for ("much closer"), against P2-1's originals:
  // row 32px -> 24px, body 13px -> 12px, meta 12px -> 11px, cell pad 12px -> 6px.
  assert.match(css, /--ui-row-h:\s*24px/, 'rows are 24px (was 32px in tokens.css)')
  assert.match(css, /--ui-size-body:\s*12px/, 'body text is 12px (was 13px)')
  assert.match(css, /--ui-size-meta:\s*11px/, 'meta text is 11px (was 12px)')
  assert.match(css, /--ui-cell-px:\s*6px/, 'cell padding is 6px a side (was 12px)')
})

test('the excel table hugs its columns and pays for density with padding, never with the line box', () => {
  const dense = read('src/components/shared/kit/DenseTable.tsx')
  // `w-full` stretched a 4-column table across a 1400px screen, which is what
  // put a label at one edge and its number at the other.
  assert.ok(dense.includes("fit ? 'w-auto min-w-max' : 'w-full min-w-max'"), 'DenseTable can hug its content')
  assert.match(read('src/components/sales/reports/ReportTable.tsx'), /<DenseTable\s+fit\b/, 'the reports table asks for it')
  // Padding is tokenised so a surface tunes density without forking the kit,
  // and the 12px fallback keeps any other caller looking the way it did.
  assert.ok(dense.includes('px-[var(--ui-cell-px,12px)]'), 'cell padding is a token with a back-compatible fallback')
  assert.ok(!/\[&_tbody_td\]:px-3|\[&_thead_th\]:px-3/.test(dense), 'no hard-coded 12px cell padding is left')
  // Compaction must never come out of line-height: that is what shears Khmer.
  assert.ok(!/leading-\[1[0-4]px\]/.test(read('src/components/sales/reports/ReceiptSheet.tsx')), 'the receipt line box is not squeezed below 15px')
})

test('Khmer keeps a line box tall enough that truncating cells cannot shear it', () => {
  const css = read(SURFACE_CSS)
  // A Khmer cluster stacks a superscript sign above and a coeng subscript
  // below the base, ~1.55-1.65em of ink. main.css's Aug-31 compaction pass
  // pulled the km line-heights down to 1.38-1.52; a short line box inside an
  // `overflow:hidden` box (Tailwind `.truncate`) clips the tops and tails.
  // overflow-x cannot be clipped independently of overflow-y, so the only
  // real fix is to give the line box its height back.
  const kmBlocks = css.split('body.lang-km').slice(1).join('\n')
  const heights = [...kmBlocks.matchAll(/line-height:\s*([0-9.]+)/g)].map((m) => Number(m[1]))
  assert.ok(heights.length >= 3, 'the Khmer block sets line-height in more than one place')
  for (const h of heights) assert.ok(h >= 1.6, `Khmer line-height ${h} is below the 1.6 clip threshold`)
  // main.css's km `.text-xs` / `.text-sm` rules carry !important, so the
  // surface override has to as well or it never lands.
  assert.ok(/\.text-xs[\s\S]{0,80}line-height:[^;]+!important/.test(kmBlocks), 'the .text-xs override can actually win')
  // A taller line box needs a taller row, or the row clips instead of the cell.
  assert.match(kmBlocks, /--ui-row-h:\s*28px/, 'Khmer rows grow to fit the taller line box')
  // The fold is portalled to document.body, i.e. OUTSIDE [data-reports-hub],
  // so it needs its own hook or the menu keeps clipping.
  assert.ok(css.includes('[data-reports-fold]'), 'the portalled fold is covered too')
  assert.ok(read('src/components/sales/reports/ReportOptionsFold.tsx').includes('data-reports-fold'), 'the fold carries that hook')
  // Scoped, not global: the app-wide fix is a separate board item.
  assert.ok(!/^body\.lang-km\s*[,{]/m.test(kmBlocks.replace(/\[data-reports-(hub|fold)\]/g, 'X')), 'the Khmer fix stays scoped to this surface')
})

test('the receipt style puts the label and its value on a bounded line, and keeps Khmer out of the mono stack', () => {
  const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
  // A full-bleed tape flung the label to the far left and the number to the
  // far right; the cap is what makes them "much closer" on a wide phone.
  assert.ok(sheet.includes('max-w-[26rem]'), 'the one-tape layout is width-capped')
  assert.ok(sheet.includes('md:max-w-none'), 'the cap is lifted where the grid already bounds each card')
  // `font-mono` on the container put Khmer labels into a stack with no Khmer
  // coverage, so they fell back per glyph at a different metric inside a
  // truncate box. Mono belongs on the numbers only.
  assert.ok(!/'font-mono text-/.test(sheet), 'font-mono is off the container')
  assert.ok(sheet.includes('shrink-0 text-right font-mono'), 'font-mono rides the value span')
})

test('no view assigns a cost/profit key itself -- profit is shown only when the server sent it', () => {
  for (const rel of VIEW_FILES) {
    const src = read(rel)
    assert.ok(!/(cost_usd|profit_usd|margin_pct)\s*:\s*0\b/.test(src), `${rel} never fabricates a 0 cost/profit`)
    assert.ok(src.includes('<ReportFrame'), `${rel} renders inside a ReportFrame`)
    assert.ok(src.includes('<ReceiptSheet') && src.includes('<ReportTable'), `${rel} offers both the excel and the receipt style`)
  }
  for (const rel of ['src/components/sales/reports/PeriodReport.tsx', 'src/components/sales/reports/GroupedReport.tsx']) {
    assert.ok(read(rel).includes('rows.every((r) => hasProfit(r))') || read(rel).includes('groupRows.every((r) => hasProfit(r))'), `${rel} shows profit columns only when EVERY row carries profit`)
  }
  // The per-receipt list keys on the server-typed presence of gross_profit_usd in the totals block.
  assert.ok(read('src/components/sales/reports/SalesListReport.tsx').includes("typeof totals.gross_profit_usd === 'number'"), 'the Sales list gates profit on the server having sent it')
  // The Overview reads its profit figure from the statement, which buildIncomeStatement only emits when the server sent cost.
  const overview = read('src/components/sales/reports/OverviewReport.tsx')
  assert.ok(overview.includes("lines.find((l) => l.key === 'gross_profit')"), 'the Overview takes gross profit from the statement lines')
  assert.ok(overview.includes('buildIncomeStatement('), 'the Overview builds its statement through the model')
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nreportsHub: all tests passed')
