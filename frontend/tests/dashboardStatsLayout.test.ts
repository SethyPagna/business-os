import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const statsRangeRow = readFileSync(new URL('../src/components/shared/StatsRangeRow.tsx', import.meta.url), 'utf8')

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
  /const dashboardRange = useMemo<DateTimeRange>[\s\S]{0,180}startDate: customStart[\s\S]{0,80}endDate: customEnd/,
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

console.log('PASS dashboard shared stats and range layout')
