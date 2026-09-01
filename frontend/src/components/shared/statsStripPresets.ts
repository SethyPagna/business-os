// Pure range-preset math for the app-wide StatsStrip (kept in a .ts module
// with NO .tsx imports so the node test runner can import it directly).
// Presets are shared by the date/time picker. Individual pages choose their
// own initial range; Sales/Returns/Fees/Reports can start all-time while
// inventory-style operational pages may still start on today.
// DateTimeRange is declared structurally here (identical to
// DateTimeRangePicker's) rather than imported, since importing the .tsx
// would drag the picker component into plain-node test runs.

export interface DateTimeRange {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

const FULL_DAY_TIMES = { startTime: '00:00', endTime: '23:59' }

export type StatsPresetKey = 'all' | 'today' | '7d' | 'week' | 'month' | 'year'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function presetNow(now?: Date): Date {
  // Explicit dates are test/preview inputs and are already wall-clock values.
  // Real app calls omit `now`, so resolve the wall clock in Cambodia rather
  // than inheriting whatever timezone the user's device happens to use.
  if (now) return new Date(now.getTime())
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Phnom_Penh' }))
}

/** Full-day range for the quick-range controls inside DateTimeRangePicker. */
export function statsPresetRange(preset: StatsPresetKey, now?: Date): DateTimeRange {
  if (preset === 'all') return { startDate: '', endDate: '', startTime: '', endTime: '' }
  const current = presetNow(now)
  const end = isoDay(current)
  if (preset === 'today') return { ...FULL_DAY_TIMES, startDate: end, endDate: end }
  if (preset === '7d') {
    const start = new Date(current)
    start.setDate(start.getDate() - 6)
    return { ...FULL_DAY_TIMES, startDate: isoDay(start), endDate: end }
  }
  if (preset === 'week') {
    const start = new Date(current)
    // The picker calendar is Monday-first, so "This week" uses that same
    // convention and includes the current day through the end of today.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return { ...FULL_DAY_TIMES, startDate: isoDay(start), endDate: end }
  }
  if (preset === 'month') {
    return { ...FULL_DAY_TIMES, startDate: `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-01`, endDate: end }
  }
  return { ...FULL_DAY_TIMES, startDate: `${current.getFullYear()}-01-01`, endDate: end }
}

/** Which legacy preset (if any) the current range equals. */
export function activeStatsPreset(range: DateTimeRange, now?: Date): StatsPresetKey | null {
  const presets: StatsPresetKey[] = ['all', 'today', '7d', 'week', 'month', 'year']
  for (const preset of presets) {
    const candidate = statsPresetRange(preset, now)
    if (candidate.startDate === range.startDate && candidate.endDate === range.endDate) return preset
  }
  return null
}
