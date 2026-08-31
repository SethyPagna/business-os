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
  assert.ok(strip.includes('grid-cols-2'), 'cards wrap in a grid, 2-up on small screens')
})

test('Part 548: dedicated full-width date row + rangeActions placement rule', () => {
  // User, Aug 31: "start and end date can do one row fully plus history
  // icon/button, make use of full row... if stats are not many like only
  // two, no need merge the history/export buttons in date — just merge
  // with the stats". The range picker moves OUT of the chip row into its
  // own row when open (presets visible on phones too — no hidden sm:),
  // and rangeActions ride the date row on many-card pages / the stats
  // row on few-card (≤3) pages.
  const strip = read('src/components/shared/StatsStrip.tsx')
  assert.ok(strip.includes('rangeActions'), 'the secondary-controls slot exists')
  assert.ok(/const fewCards = cards\.length <= 3/.test(strip), 'few-card threshold is 3 (keeps Returns stable across its 2/3-card scopes)')
  assert.ok(/statsOpen && !fewCards \? rangeActions : null/.test(strip), 'many cards -> secondary controls ride the date row')
  assert.ok(/statsOpen && fewCards \? rangeActions : null/.test(strip), 'few cards -> secondary controls merge into the stats row')
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

test('old bespoke stat surfaces are really gone (no zombie tile grids)', () => {
  assert.ok(!read('src/components/returns/Returns.tsx').includes('ReturnStatTile'), 'Returns tile grid removed')
  const inventory = read('src/components/inventory/Inventory.tsx')
  assert.ok(!inventory.includes('InventoryStatDetailModal'), 'Inventory stat drill modal removed')
  assert.ok(!inventory.includes("getReturns({ scope: 'all' })"), 'the all-rows client-side returns sum is gone (range endpoints instead)')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll statsStrip tests passed')
