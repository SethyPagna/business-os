// Pure range-preset math for the app-wide StatsStrip (kept in a .ts module
// with NO .tsx imports so the node test runner can import it directly).
// 'today' is the strip's app-wide DEFAULT range (user: "default per day").
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

export type StatsPresetKey = 'today' | '7d' | 'month' | 'year'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Full-day range for a legacy preset/default. The UI no longer renders
 * preset chips, but existing callers use `today` as their initial range. */
export function statsPresetRange(preset: StatsPresetKey, now = new Date()): DateTimeRange {
  const end = isoDay(now)
  if (preset === 'today') return { ...FULL_DAY_TIMES, startDate: end, endDate: end }
  if (preset === '7d') {
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    return { ...FULL_DAY_TIMES, startDate: isoDay(start), endDate: end }
  }
  if (preset === 'month') {
    return { ...FULL_DAY_TIMES, startDate: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, endDate: end }
  }
  return { ...FULL_DAY_TIMES, startDate: `${now.getFullYear()}-01-01`, endDate: end }
}

/** Which legacy preset (if any) the current range equals. */
export function activeStatsPreset(range: DateTimeRange, now = new Date()): StatsPresetKey | null {
  const presets: StatsPresetKey[] = ['today', '7d', 'month', 'year']
  for (const preset of presets) {
    const candidate = statsPresetRange(preset, now)
    if (candidate.startDate === range.startDate && candidate.endDate === range.endDate) return preset
  }
  return null
}
