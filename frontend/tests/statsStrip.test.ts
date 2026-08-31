// The app-wide foldable stats strip (user, Aug 30: "for each of data full
// pages ... mini stats cards folded in them, to explain and show more
// stats ... based on date range. default per day ... do so for all
// pages"). Tests the pure range-preset helpers, then pins the rollout:
// every data page renders the SAME shared component (never a bespoke tile
// grid again), defaulting to the per-day (today) range.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statsPresetRange, activeStatsPreset } from '../src/components/shared/statsStripPresets.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('statsPresetRange: today is a single-day range (the app-wide default)', () => {
  const now = new Date(2026, 7, 30) // Aug 30 2026 local
  const range = statsPresetRange('today', now)
  assert.equal(range.startDate, '2026-08-30')
  assert.equal(range.endDate, '2026-08-30')
  assert.equal(range.startTime, '')
})

test('statsPresetRange: 7d spans exactly seven calendar days ending today', () => {
  const now = new Date(2026, 7, 30)
  const range = statsPresetRange('7d', now)
  assert.equal(range.startDate, '2026-08-24')
  assert.equal(range.endDate, '2026-08-30')
})

test('statsPresetRange: month/year anchor to the 1st, and survive month rollovers', () => {
  const now = new Date(2026, 0, 3) // Jan 3 -- 7d crosses a year boundary
  assert.equal(statsPresetRange('month', now).startDate, '2026-01-01')
  assert.equal(statsPresetRange('year', now).startDate, '2026-01-01')
  assert.equal(statsPresetRange('7d', now).startDate, '2025-12-28')
})

test('activeStatsPreset round-trips every preset and rejects a custom range', () => {
  const now = new Date(2026, 7, 30)
  for (const preset of ['today', '7d', 'month', 'year'] as const) {
    assert.equal(activeStatsPreset(statsPresetRange(preset, now), now), preset)
  }
  assert.equal(activeStatsPreset({ startDate: '2026-08-01', endDate: '2026-08-15', startTime: '', endTime: '' }, now), null)
})

// ---- rollout pins (cross-file) --------------------------------------------
test('every data page renders the ONE shared StatsStrip, defaulting to today', () => {
  const pages: Array<[string, string]> = [
    ['Sales', 'src/components/sales/Sales.tsx'],
    ['Returns', 'src/components/returns/Returns.tsx'],
    ['Fees', 'src/components/fees/FeesPage.tsx'],
    ['Inventory (also embedded by Branches)', 'src/components/inventory/Inventory.tsx'],
  ]
  for (const [label, rel] of pages) {
    const src = read(rel)
    assert.ok(src.includes('<StatsStrip'), `${label} must render the shared strip`)
    assert.ok(src.includes("statsPresetRange('today')"), `${label} must default its strip range to per-day (today)`)
  }
  // Dashboard keeps its own range card, so it passes cards only -- but it
  // must still be the SAME component, not the old MiniStat grid or the
  // KPI portal sheet for period cards.
  const dashboard = read('src/components/dashboard/Dashboard.tsx')
  assert.ok(dashboard.includes('<StatsStrip'), 'Dashboard renders the shared strip')
  assert.ok(!dashboard.includes("from './MiniStat'"), 'the bespoke MiniStat grid is gone')
  assert.ok(dashboard.includes('periodKpis.map((kpi): StatCardDef'), 'the KPI set feeds the strip cards')
})

test('the strip folds inline: one open card, chevron affordance, breakdown grid', () => {
  const strip = read('src/components/shared/StatsStrip.tsx')
  assert.ok(/setOpenKey\(\(current\) => \(current === card\.key \? null : card\.key\)\)/.test(strip), 'tapping toggles ONE open fold at a time')
  assert.ok(strip.includes('aria-expanded'), 'folding cards announce their state')
  assert.ok(strip.includes('<InfoHint'), 'the fold carries the explanation affordance')
})

test('the whole strip hides behind a click-to-open Stats chip; cards wrap, never scroll sideways', () => {
  // User, Aug 31: "should not do scroll in one row, can do 2 stats per
  // row for smaller screens ... stats should be folded into stats click
  // to open". This SUPERSEDES the earlier one-horizontal-line pin.
  const strip = read('src/components/shared/StatsStrip.tsx')
  assert.ok(/const \[statsOpen, setStatsOpen\] = useState\(false\)/.test(strip), 'the stats block defaults FOLDED — click the chip to open')
  assert.ok(strip.includes("tr('stats', 'Stats')"), "the chip label rides the shared 'stats' pack key (translated in both packs)")
  assert.ok(!strip.includes('overflow-x-auto'), 'stats never ride a sideways-scrolling row')
  // Cards are content-sized and wrap (2-up on phones via a half-width basis,
  // ~10rem from sm up) rather than stretching across a fixed grid — user,
  // Aug 31: "just enough for its own space of stats", don't stretch.
  assert.ok(strip.includes('w-[calc(50%-0.375rem)]') && strip.includes('sm:w-40'), 'cards are content-sized, 2-up on phones, ~10rem from sm')
  assert.ok(!/grid-cols-\d.*grid-cols-6|xl:grid-cols-6/.test(strip), 'no fixed 6-track grid that strands empty tracks on few-card pages')
})

test('dedicated date row + secondary controls always merge onto the cards row', () => {
  // User, Aug 31 (refining the earlier ≤3 split): the range picker gets its
  // own row when open (presets visible on phones too — no hidden sm:), and
  // the secondary controls (History/Export/Manage) MERGE onto the stat-cards
  // row's trailing spare width for EVERY card count — "just enough for its
  // own space of stats ... and merge the various buttons in same row". The
  // count-based fork is gone (a 4-card page had the same dead space a 2-card
  // page did), and the buttons no longer sit on an otherwise-empty date row.
  const strip = read('src/components/shared/StatsStrip.tsx')
  assert.ok(strip.includes('rangeActions'), 'the secondary-controls slot exists')
  assert.ok(!/const fewCards = /.test(strip), 'the count-based few-card fork is gone')
  assert.ok(/const statsRowActions = statsOpen \? rangeActions : null/.test(strip), 'secondary controls ride the cards row whenever the strip is open')
  assert.ok(!strip.includes('rangeRowActions'), 'the date row no longer hosts the secondary buttons')
  assert.ok(!/hidden rounded-md.*sm:inline-flex/.test(strip), 'presets no longer hide on phones — the dedicated row has the width')
  // Sales feeds History+Manage through the new slot; Returns feeds
  // Export+History there while its Add button stays a PRIMARY action with
  // an always-visible label.
  assert.ok(read('src/components/sales/Sales.tsx').includes('rangeActions={('), 'Sales wires History/Manage as rangeActions')
  const returns = read('src/components/returns/Returns.tsx')
  assert.ok(returns.includes('rangeActions={('), 'Returns wires Export/History as rangeActions')
  assert.ok(returns.includes("tr('add_return', 'Add Return')"), 'Returns add button says Add Return')
  assert.ok(returns.includes("tr('add_supplier_return', 'Add Supplier Return')"), 'supplier scope says Add Supplier Return')
  assert.ok(!/hidden sm:inline">\{tr\('add_return'/.test(returns), 'the add label never hides on phones')
})

test('Part 548: the Reports range totals show Profit on every viewport', () => {
  const report = read('src/components/sales/SalesDailyReport.tsx')
  const totalsRow = report.slice(report.indexOf('rangeTotals.tx'), report.indexOf('rangeTotals.profit') + 200)
  assert.ok(totalsRow.includes('rangeTotals.profit'), 'Profit renders beside N sales | Revenue')
  assert.ok(!/hidden sm:inline[^>]*>\{t\('profit'\)/.test(report), 'Profit is not hidden below the sm breakpoint')
})

test('Part 549/552: the Sales report status/method filters are compact chip-selects', () => {
  const report = read('src/components/sales/SalesDailyReport.tsx')
  // Compact h-7 chip-selects (not the old full-height dropdowns), matching
  // the Returns/Fees report density.
  assert.ok(report.includes("buttonClassName=\"h-7 py-0 px-2 text-[11px]\""), 'status/method use the compact chip-select size')
  assert.ok(report.includes('options={statusOptions}') && report.includes('options={paymentOptions}'), 'both selects render')
})

test('Part 549: the Sales section shows an always-visible summary + a leaner toolbar', () => {
  const sales = read('src/components/sales/Sales.tsx')
  const strip = read('src/components/shared/StatsStrip.tsx')
  // "stats can show outside button stats" -> a summary line beside the chip.
  assert.ok(strip.includes('summary'), 'StatsStrip exposes a summary slot')
  assert.ok(sales.includes('summary={'), 'Sales feeds the strip a summary (count · revenue)')
  // Sort folded INTO the Filters menu; the standalone SortChip is gone.
  assert.ok(!sales.includes('SortChip'), 'the toolbar SortChip is removed (sort lives in the Filters menu)')
  assert.ok(/id: 'sort'/.test(sales), 'the Filters menu carries a Sort section')
  // Group-by dropped; Period is a start/end date range, not year/month.
  assert.ok(!/id: 'grouping'/.test(sales), 'the Group-by filter section is gone')
  assert.ok(!sales.includes('buildPeriodFilterOptions'), 'the year/month Period options are gone')
  assert.ok(/id: 'period'[\s\S]{0,200}DateTimeRangePicker/.test(sales), 'Period is a start/end date-range picker')
})

test('Part 552: report section controls ride the title row; hub tabs fit; branch merges', () => {
  // Each report section places its controls on the hub-provided title row
  // (user: "the sales, returns and fees, sections the card title can be
  // moved to title row"): the section owns a `titleNode` prop and ReportsHub
  // stops rendering a standalone title.
  for (const rel of [
    'src/components/sales/SalesDailyReport.tsx',
    'src/components/sales/ReturnsReportSection.tsx',
    'src/components/sales/FeesReportSection.tsx',
  ]) {
    const src = read(rel)
    assert.ok(/titleNode\??: ReactNode/.test(src), `${rel} accepts a titleNode`)
    assert.ok(src.includes('{titleNode}'), `${rel} renders the titleNode on its control row`)
  }
  const hub = read('src/components/sales/ReportsHub.tsx')
  assert.ok(hub.includes('titleNode={titleNode}'), 'ReportsHub passes the title into each section')
  assert.ok(!/<Icon className="h-4 w-4" \/> \{label\}/.test(hub), 'ReportsHub no longer renders its own standalone section title row')
  // The branch select rides the type-chips row, not its own line.
  assert.ok(/typeChips\.map[\s\S]{0,900}branches\.length \? \(\s*<AppSelect/.test(hub), 'the branch select sits inside the type-chips row')

  // The hub tab row fits one row on phones: full-width equal (flex-1) tabs
  // with truncating labels, not a content-sized inline-flex pill that
  // overflowed the viewport ("not fit in one row ... touching edge").
  const shell = read('src/components/sales/SalesHubPage.tsx')
  assert.ok(shell.includes('flex w-full rounded-xl'), 'the tab strip is full-width')
  assert.ok(/flex-1 min-w-0 justify-center/.test(shell), 'each tab is an equal flex-1 cell')
  assert.ok(shell.includes('<span className="truncate">{tab.label}</span>'), 'tab labels truncate rather than widen the row')
})

test('Part 553/554: report sections render display-currency money + a CSV export', () => {
  // Money now flows through the display-currency-aware fmtMoney (Part 554,
  // utils/reportMoney.ts) so a KHR fee never reads as "$0.00" and the
  // display_currency setting is honored. Each section also offers an Export
  // action (user: "no actions to choose export etc"). Deeper reportMoney
  // behavior is pinned in tests/reportMoney.test.ts.
  for (const rel of [
    'src/components/sales/FeesReportSection.tsx',
    'src/components/sales/ReturnsReportSection.tsx',
  ]) {
    const src = read(rel)
    assert.ok(src.includes('fmtMoney('), `${rel} renders money via fmtMoney`)
    assert.ok(src.includes('downloadCSV('), `${rel} exports CSV`)
    assert.ok(/onClick=\{exportCsv\}/.test(src), `${rel} wires an Export button`)
  }
  const sales = read('src/components/sales/SalesDailyReport.tsx')
  assert.ok(sales.includes('downloadCSV(') && /onClick=\{exportCsv\}/.test(sales), 'Sales report exports CSV')
  // The hub threads the display-currency fmtMoney into every section.
  const hub = read('src/components/sales/ReportsHub.tsx')
  assert.ok(hub.includes('fmtMoney={fmtMoney}'), 'ReportsHub passes fmtMoney to the sections')
})

test('old bespoke stat surfaces are really gone (no zombie tile grids)', () => {
  assert.ok(!read('src/components/returns/Returns.tsx').includes('ReturnStatTile'), 'Returns tile grid removed')
  const inventory = read('src/components/inventory/Inventory.tsx')
  assert.ok(!inventory.includes('InventoryStatDetailModal'), 'Inventory stat drill modal removed')
  assert.ok(!inventory.includes("getReturns({ scope: 'all' })"), 'the all-rows client-side returns sum is gone (range endpoints instead)')
})

test('Part 560: the Start→End date row is lifted OUT of the stats fold into a StatsRangeRow above the search bar', () => {
  // User, Aug 31: "fish out the start date and end date from the stats
  // button ... this should be right above the search bar row ... make sure
  // this applies to all section, mini sections, and pages ... stats can be
  // placed at the top ... but of course the start and end date will also
  // apply to it." The picker + presets moved into the shared StatsRangeRow,
  // which each list page renders directly above its search bar (inside the
  // pinned wrapper, per the sticky search+date rule); the page stops passing
  // range/onRangeChange to StatsStrip and keeps feeding the strip's cards
  // from the SAME stripRange state. StatsStrip is left backward-compatible on
  // purpose (its internal date row still renders for a caller that passes the
  // props) so pages migrate one at a time across parallel sessions —
  // Inventory's stats live on their own section chip and migrate in the lane
  // that owns that file.
  const rangeRow = read('src/components/shared/StatsRangeRow.tsx')
  assert.ok(rangeRow.includes('<DateTimeRangePicker'), 'StatsRangeRow carries the shared Start→End picker')
  assert.ok(rangeRow.includes('range_today') && rangeRow.includes('range_this_year'), 'StatsRangeRow carries the presets')
  // Sales/Returns/Fees place it above the search bar; Inventory's stats sit on
  // their own section chip so its row leads the stats section instead — but all
  // four render the shared row wired to stripRange and drop the props from the
  // strip.
  for (const rel of [
    'src/components/sales/Sales.tsx',
    'src/components/returns/Returns.tsx',
    'src/components/fees/FeesPage.tsx',
    'src/components/inventory/Inventory.tsx',
  ]) {
    const src = read(rel)
    // Rendered above the search bar and wired to the strip's range state
    // (single-line StatsRangeRow form).
    assert.ok(/<StatsRangeRow[^>]*range=\{stripRange\}[^>]*onRangeChange=\{setStripRange\}/.test(src), `${rel} renders StatsRangeRow wired to stripRange`)
    // The strip on these pages no longer owns the range: the old multi-line
    // `range={stripRange}` / `onRangeChange={setStripRange}` prop pair passed
    // into <StatsStrip> (each on its own line) is gone. The new StatsRangeRow
    // form keeps both on ONE line, so this only catches the removed strip props.
    assert.ok(!/range=\{stripRange\}\s*\n\s*onRangeChange=\{setStripRange\}/.test(src), `${rel} no longer passes the range into StatsStrip`)
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll statsStrip tests passed')
