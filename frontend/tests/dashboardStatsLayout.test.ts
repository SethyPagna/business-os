import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withDashboardRangeScope } from '../src/api/dashboardTransport.ts'

const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const statsRangeRow = readFileSync(new URL('../src/components/shared/StatsRangeRow.tsx', import.meta.url), 'utf8')
const datePicker = readFileSync(new URL('../src/components/shared/DateTimeRangePicker.tsx', import.meta.url), 'utf8')
const mainCss = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const transport = readFileSync(new URL('../src/api/dashboardTransport.ts', import.meta.url), 'utf8')
const compat = readFileSync(new URL('../../cloudflare/src/routes/compat.ts', import.meta.url), 'utf8')

assert.match(
  dashboard,
  /<StatsStrip[\s\S]{0,240}range=\{dashboardRange\}[\s\S]{0,120}onRangeChange=\{handleDashboardRangeChange\}/,
  'Dashboard delegates its Stats/date toolbar and preset rail to the shared StatsStrip API',
)
assert.doesNotMatch(
  dashboard,
  /<DateTimeRangePicker/,
  'Dashboard does not render a second page-owned date picker outside the shared Stats row',
)
assert.match(
  dashboard,
  /const dashboardRange = useMemo\(\(\) => resolveDashboardFilterRange\(filterPrefs\)[\s\S]{0,140}const customStart = dashboardRange.startDate[\s\S]{0,80}const customEnd = dashboardRange.endDate/,
  'the visible shared date range is derived from the canonical dashboard dates',
)
assert.match(
  dashboard,
  /const getCurrentDashboardRange = useCallback[\s\S]{0,180}start: customStart, end: customEnd/,
  'Dashboard requests use the same canonical dates shown by the shared range control',
)
assert.match(
  dashboard,
  /const rangeLabel = !customStart && !customEnd[\s\S]{0,180}customStart[\s\S]{0,80}customEnd/,
  'Dashboard export labels are derived from the same canonical dates, including All time',
)
assert.match(
  dashboard,
  /rangeActions=\{hasPermission\('dashboard_export'\)[\s\S]{0,300}className=\{toolbarIconButtonClassName\}[\s\S]{0,120}<Download className="h-5 w-5"/,
  'Export is a permission-gated icon-only shared toolbar action',
)
assert.doesNotMatch(
  dashboard,
  /<Download className="h-5 w-5"[^>]*\/>\s*\{exportLabel\}/,
  'Export has no duplicate visible text beside its icon',
)

assert.match(statsRangeRow, /data-stats-range-controls/, 'the shared control row exposes one stable toolbar surface')
assert.match(statsRangeRow, /flex-nowrap/, 'the shared Stats/date/action row does not wrap')
assert.match(statsRangeRow, /data-date-presets/, 'date presets render immediately below the control row')
assert.match(statsRangeRow, /overflow-x-auto/, 'date presets remain one horizontally scrollable rail')
assert.match(statsRangeRow, /stats-date-presets/, 'the preset rail has a dedicated touch-scroll hook')
assert.match(mainCss, /\.page-scroll[\s\S]{0,520}touch-action: pan-x pan-y/, 'the page scroll surface permits nested horizontal touch gestures')
assert.match(mainCss, /\.stats-date-presets[\s\S]{0,200}touch-action: pan-x/, 'the preset rail explicitly owns horizontal touch panning')
assert.match(
  datePicker,
  /left-1\/2[\s\S]{0,180}max-w-\[calc\(100vw-1rem\)\][\s\S]{0,80}-translate-x-1\/2[\s\S]{0,180}sm:translate-x-0/,
  'the picker popover is centered and viewport-bounded on narrow screens before restoring desktop alignment',
)
assert.match(transport, /withDashboardRangeScope[\s\S]{0,420}rangeScope: 'all'/, 'dashboard transport marks explicit empty bounds as all-time')
assert.deepEqual(
  withDashboardRangeScope({ startDate: '', endDate: '', granularity: 'day' }),
  { startDate: '', endDate: '', granularity: 'day', rangeScope: 'all' },
  'explicit empty bounds carry an all-time scope marker through query serialization',
)
assert.deepEqual(withDashboardRangeScope({}), {}, 'legacy requests with missing dates do not opt into all-time')
assert.deepEqual(
  withDashboardRangeScope({ startDate: '2026-09-01', endDate: '' }),
  { startDate: '2026-09-01', endDate: '' },
  'partially specified legacy bounds are not broadened to all-time',
)
assert.match(compat, /const allTime = String\(query\.rangeScope \|\| ''\)[\s\S]*?query\.startDate === ''[\s\S]*?if \(allTime\)/, 'Worker range parsing keeps explicit all-time distinct from its Today fallback')
assert.match(compat, /range\.allTime \? '1 = 1' : localDateRangeClause\('created_at'\)/, 'all-time dashboard summary queries omit the date predicate')
assert.match(compat, /range\.allTime \? Promise\.resolve\(\{\}\) : getSalesTotals\(env, previousPeriodFilters\(filters\)\)/, 'all-time analytics does not invent a previous comparison period')
assert.match(dashboard, /if \(prefs\.rangeId === 'custom'\)[\s\S]{0,220}prefs\.customStart[\s\S]{0,220}statsPresetRange\(prefs\.rangeId\)/, 'saved named presets are recomputed while only custom ranges reuse stored dates')
assert.match(dashboard, /const rangeLabel = !customStart && !customEnd[\s\S]{0,100}translateOr\('all_time', 'All time'\)/, 'all-time exports use the same explicit All time label as the dashboard range')
assert.match(dashboard, /const buildDashboardExportContext = useCallback[\s\S]{0,900}rangeLabel/, 'dashboard export context receives the canonical range label')

console.log('PASS dashboard shared stats and range layout')
