import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'

// X1 (Part 395): the shared date+time range picker, built to the user's two
// mockups -- a compact "Start → End" trigger pill, and a panel with manual
// date inputs, an optional HH:MM–HH:MM time row, month chips, a Mon-first
// calendar range grid, year chips and quarter quick-ranges, closed by the
// red ✕ or an outside click.
//
// Display format is MM/DD/YYYY on purpose: the stock mockup artwork shows
// DD/MM placeholders, but mm/dd/yyyy-everywhere is a settled decision
// (locale pinned en-US; re-swept Part 388/W2) -- flagged in progress.md
// rather than silently diverging from it.
//
// Dates are handled as ISO strings (YYYY-MM-DD) end to end and formatted by
// string parts -- never `new Date('YYYY-MM-DD')` for display, which shifts a
// day west of UTC.

export interface DateTimeRange {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

export const EMPTY_DATE_TIME_RANGE: DateTimeRange = { startDate: '', endDate: '', startTime: '', endTime: '' }

export function isDateTimeRangeActive(range: DateTimeRange | null | undefined): boolean {
  return Boolean(range && (range.startDate || range.endDate))
}

interface DateTimeRangePickerProps {
  value: DateTimeRange
  onChange: (range: DateTimeRange) => void
  t: (key: string) => string | undefined
  // Time row is optional per surface -- the Sales daily report wants it,
  // a plain list filter may not.
  showTime?: boolean
  align?: 'left' | 'right'
  className?: string
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoOf(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`
}

function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

// Accepts MM/DD/YYYY (and M/D/YYYY) typed by hand; returns ISO or null.
function parseManualDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || year < 1970 || year > 2999) return null
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return isoOf(year, month, day)
}

function todayIso(): string {
  const now = new Date()
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

const chipBase = 'rounded-xl border px-2.5 py-1.5 text-xs font-medium transition'
const chipIdle = 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
const chipActive = 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'

export default function DateTimeRangePicker({
  value,
  onChange,
  t,
  showTime = true,
  align = 'left',
  className = '',
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const today = todayIso()
  // Calendar view month/year -- follows the range start when one exists.
  const [viewYear, setViewYear] = useState(() => Number((value.startDate || today).slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number((value.startDate || today).slice(5, 7)))
  // Manual input text mirrors the value but is editable mid-keystroke.
  const [startText, setStartText] = useState(() => displayDate(value.startDate))
  const [endText, setEndText] = useState(() => displayDate(value.endDate))
  const [startInvalid, setStartInvalid] = useState(false)
  const [endInvalid, setEndInvalid] = useState(false)

  useEffect(() => {
    setStartText(displayDate(value.startDate))
    setEndText(displayDate(value.endDate))
    setStartInvalid(false)
    setEndInvalid(false)
    if (value.startDate) {
      setViewYear(Number(value.startDate.slice(0, 4)))
      setViewMonth(Number(value.startDate.slice(5, 7)))
    }
  }, [value.startDate, value.endDate])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const apply = (patch: Partial<DateTimeRange>) => {
    // Keep start <= end whenever both ends exist -- swapping beats erroring.
    const next = { ...value, ...patch }
    if (next.startDate && next.endDate && next.endDate < next.startDate) {
      const swapped = next.startDate
      next.startDate = next.endDate
      next.endDate = swapped
    }
    onChange(next)
  }

  const pickDay = (iso: string) => {
    if (!value.startDate || (value.startDate && value.endDate)) {
      // Fresh selection: this day starts a new range.
      apply({ startDate: iso, endDate: '' })
      return
    }
    apply({ endDate: iso })
  }

  const selectMonth = (month1: number) => {
    // One tap = view AND select that whole month of the view year -- what a
    // tap on "Aug" means; days refine it afterwards.
    setViewMonth(month1)
    apply({ startDate: isoOf(viewYear, month1, 1), endDate: isoOf(viewYear, month1, lastDayOfMonth(viewYear, month1)) })
  }

  const selectQuarter = (year: number, quarter: number) => {
    const startMonth = (quarter - 1) * 3 + 1
    const endMonth = startMonth + 2
    setViewYear(year)
    setViewMonth(startMonth)
    apply({ startDate: isoOf(year, startMonth, 1), endDate: isoOf(year, endMonth, lastDayOfMonth(year, endMonth)) })
  }

  const commitManual = (which: 'start' | 'end', raw: string) => {
    const iso = parseManualDate(raw)
    if (which === 'start') {
      if (!raw.trim()) { setStartInvalid(false); apply({ startDate: '' }); return }
      if (!iso) { setStartInvalid(true); return }
      setStartInvalid(false)
      apply({ startDate: iso })
    } else {
      if (!raw.trim()) { setEndInvalid(false); apply({ endDate: '' }); return }
      if (!iso) { setEndInvalid(true); return }
      setEndInvalid(false)
      apply({ endDate: iso })
    }
  }

  const currentYear = Number(today.slice(0, 4))
  const yearChips = useMemo(() => Array.from({ length: 6 }, (_, i) => currentYear - 5 + i), [currentYear])
  const quarterChips = useMemo(() => {
    // The last 6 quarters ending at the current one, mockup-style "Q1 25".
    const chips: Array<{ year: number; quarter: number; label: string }> = []
    let year = currentYear
    let quarter = Math.floor((new Date().getMonth()) / 3) + 1
    for (let i = 0; i < 6; i += 1) {
      chips.unshift({ year, quarter, label: `Q${quarter} ${String(year).slice(2)}` })
      quarter -= 1
      if (quarter === 0) { quarter = 4; year -= 1 }
    }
    return chips
  }, [currentYear])

  const calendarCells = useMemo(() => {
    const first = new Date(Date.UTC(viewYear, viewMonth - 1, 1))
    // Monday-first offset: JS getUTCDay() is 0=Sun.
    const lead = (first.getUTCDay() + 6) % 7
    const days = lastDayOfMonth(viewYear, viewMonth)
    const cells: Array<{ iso: string; day: number } | null> = []
    for (let i = 0; i < lead; i += 1) cells.push(null)
    for (let day = 1; day <= days; day += 1) cells.push({ iso: isoOf(viewYear, viewMonth, day), day })
    return cells
  }, [viewMonth, viewYear])

  const inRange = (iso: string) => Boolean(value.startDate && value.endDate && iso >= value.startDate && iso <= value.endDate)
  const isEdge = (iso: string) => iso === value.startDate || iso === value.endDate

  const triggerLabel = value.startDate || value.endDate
    ? `${displayDate(value.startDate) || '…'} → ${displayDate(value.endDate) || '…'}${showTime && (value.startTime || value.endTime) ? ` · ${value.startTime || '00:00'}–${value.endTime || '23:59'}` : ''}`
    : null

  const hasSelection = isDateTimeRangeActive(value) || Boolean(value.startTime || value.endTime)

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${hasSelection
          ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}
        aria-expanded={open}
        aria-label={t('date_time_range') || 'Date and time range'}
      >
        {triggerLabel || (
          <>
            <span>{t('range_start') || 'Start'}</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-60" />
            <span>{t('range_end') || 'End'}</span>
          </>
        )}
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-2 w-[21rem] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {/* Manual dates + close (mockup row 1) */}
          <div className="flex items-center gap-2">
            <div className={`flex min-w-0 flex-1 items-center gap-1 rounded-xl border px-2 py-1.5 ${startInvalid || endInvalid ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-600'}`}>
              <input
                className={`w-full min-w-0 bg-transparent text-center text-xs outline-none placeholder:text-slate-400 ${startInvalid ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}
                placeholder="MM/DD/YYYY"
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                onBlur={(event) => commitManual('start', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitManual('start', (event.target as HTMLInputElement).value) }}
                aria-label={t('range_start') || 'Start date'}
              />
              <span className="shrink-0 text-slate-400">-</span>
              <input
                className={`w-full min-w-0 bg-transparent text-center text-xs outline-none placeholder:text-slate-400 ${endInvalid ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}
                placeholder="MM/DD/YYYY"
                value={endText}
                onChange={(event) => setEndText(event.target.value)}
                onBlur={(event) => commitManual('end', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitManual('end', (event.target as HTMLInputElement).value) }}
                aria-label={t('range_end') || 'End date'}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={() => setOpen(false)}
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Time range (mockup row 2) */}
          {showTime ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-2 py-1.5 dark:border-slate-600">
                <input
                  type="time"
                  className="bg-transparent text-xs text-slate-800 outline-none dark:text-slate-100"
                  value={value.startTime}
                  onChange={(event) => apply({ startTime: event.target.value })}
                  aria-label={t('start_time') || 'Start time'}
                />
                <span className="text-slate-400">—</span>
                <input
                  type="time"
                  className="bg-transparent text-xs text-slate-800 outline-none dark:text-slate-100"
                  value={value.endTime}
                  onChange={(event) => apply({ endTime: event.target.value })}
                  aria-label={t('end_time') || 'End time'}
                />
              </div>
              {hasSelection ? (
                <button
                  type="button"
                  className="ml-auto text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                  onClick={() => onChange({ ...EMPTY_DATE_TIME_RANGE })}
                >
                  {t('clear') || 'Clear'}
                </button>
              ) : null}
            </div>
          ) : hasSelection ? (
            <div className="mt-2 text-right">
              <button
                type="button"
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => onChange({ ...EMPTY_DATE_TIME_RANGE })}
              >
                {t('clear') || 'Clear'}
              </button>
            </div>
          ) : null}

          {/* Month chips -- one tap selects that whole month of the view year */}
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {MONTH_LABELS.map((label, index) => {
              const month1 = index + 1
              const active = viewMonth === month1
              return (
                <button key={label} type="button" className={`${chipBase} ${active ? chipActive : chipIdle}`} onClick={() => selectMonth(month1)}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Calendar range grid, Monday-first */}
          <div className="mt-3 rounded-2xl border border-slate-100 p-2 dark:border-slate-700/60">
            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {DOW_LABELS.map((label) => <div key={label} className="py-1">{label}</div>)}
            </div>
            <div className="grid grid-cols-7 text-center text-xs">
              {calendarCells.map((cell, index) => cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => pickDay(cell.iso)}
                  className={`mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-full transition ${isEdge(cell.iso)
                    ? 'bg-slate-800 font-semibold text-white dark:bg-slate-200 dark:text-slate-900'
                    : inRange(cell.iso)
                      ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
                      : cell.iso === today
                        ? 'text-slate-900 ring-1 ring-slate-400 dark:text-white dark:ring-slate-500'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                  aria-label={cell.iso}
                >
                  {cell.day}
                </button>
              ) : <div key={`lead-${index}`} />)}
            </div>
          </div>

          {/* Year chips -- switch the view year (selection stays put) */}
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {yearChips.map((year) => (
              <button key={year} type="button" className={`${chipBase} ${viewYear === year ? chipActive : chipIdle}`} onClick={() => setViewYear(year)}>
                {year}
              </button>
            ))}
          </div>

          {/* Quarter quick-ranges */}
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {quarterChips.map((chip) => {
              const startMonth = (chip.quarter - 1) * 3 + 1
              const active = value.startDate === isoOf(chip.year, startMonth, 1)
                && value.endDate === isoOf(chip.year, startMonth + 2, lastDayOfMonth(chip.year, startMonth + 2))
              return (
                <button
                  key={chip.label}
                  type="button"
                  className={`${chipBase} ${active ? chipActive : chipIdle}`}
                  onClick={() => selectQuarter(chip.year, chip.quarter)}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
