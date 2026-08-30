import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect from './AppSelect'

// X1 (Part 395), redesigned Aug 30 per user direction: a compact
// "Start → End" trigger pill, and a panel with manual date inputs, an
// optional HH:MM–HH:MM time row, TWO month/year select rows (one for the
// start, one for the end -- replacing the old month/year/quarter chip
// strips), and a Mon-first calendar range grid with its own ‹ month ›
// navigation. Closed by the red ✕ or an outside click.
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
  // Layout/shape utilities for the trigger button. Omitted => the default
  // compact "Start → End" pill (rounded-md). Surfaces that want the trigger
  // to read as a prominent rectangular field (e.g. the dashboard range box)
  // pass their own e.g. 'flex w-full ... rounded-lg'; border, colors and
  // transition are always layered on top regardless.
  triggerClassName?: string
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

const chipBase = 'rounded-md border px-2.5 py-1.5 text-xs font-medium transition'
const chipIdle = 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
const chipActive = 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'

export default function DateTimeRangePicker({
  value,
  onChange,
  t,
  showTime = true,
  align = 'left',
  className = '',
  triggerClassName,
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

  // Day clicks alternate start -> end -> start... via an explicit phase ref
  // instead of inferring from an empty endDate. The old inference broke on
  // parents that never hold an empty end (the Dashboard's onChange ignores
  // blank dates), where every click could only ever move the START -- the
  // reported "pick a day then another and it couldn't change". First click
  // sets a one-day range (start=end=that day, so the parent always sees a
  // complete range); the second click extends it (apply() swaps if it lands
  // before the start); the third starts over.
  const pickPhaseRef = useRef<'start' | 'end'>('start')
  const pickDay = (iso: string) => {
    if (pickPhaseRef.current === 'start') {
      apply({ startDate: iso, endDate: iso })
      pickPhaseRef.current = 'end'
      return
    }
    apply({ endDate: iso })
    pickPhaseRef.current = 'start'
  }

  // Start/End month+year select rows (the redesign's replacement for the old
  // month/year/quarter chip strips). Picking a month or year moves THAT
  // endpoint into the chosen month, keeping its day when it fits (clamped to
  // the month's length -- choosing Feb with the 31st selected lands on the
  // 28th/29th, never an invalid date). An empty endpoint starts at the 1st
  // (start) / last day (end) of the chosen month. The calendar view follows
  // the start endpoint so the grid always shows what was just chosen.
  const setEndpointMonthYear = (which: 'start' | 'end', month1: number, year: number) => {
    const current = which === 'start' ? value.startDate : value.endDate
    const fallbackDay = which === 'start' ? 1 : lastDayOfMonth(year, month1)
    const day = current ? Math.min(Number(current.slice(8, 10)), lastDayOfMonth(year, month1)) : fallbackDay
    if (which === 'start') {
      setViewYear(year)
      setViewMonth(month1)
      apply({ startDate: isoOf(year, month1, day) })
    } else {
      apply({ endDate: isoOf(year, month1, day) })
    }
  }

  const commitManual = (which: 'start' | 'end', raw: string) => {
    const iso = parseManualDate(raw)
    if (which === 'start') {
      if (!raw.trim()) { setStartInvalid(false); if (value.startDate) apply({ startDate: '' }); return }
      if (!iso) { setStartInvalid(true); return }
      setStartInvalid(false)
      // No-op when unchanged -- a blur re-committing the same text must never
      // fire a second apply that could race a same-tick day click.
      if (iso !== value.startDate) apply({ startDate: iso })
    } else {
      if (!raw.trim()) { setEndInvalid(false); if (value.endDate) apply({ endDate: '' }); return }
      if (!iso) { setEndInvalid(true); return }
      setEndInvalid(false)
      if (iso !== value.endDate) apply({ endDate: iso })
    }
  }

  const currentYear = Number(today.slice(0, 4))
  const yearOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const year = currentYear - 6 + i
    return { value: String(year), label: String(year) }
  }), [currentYear])
  const monthOptions = useMemo(() => MONTH_LABELS.map((label, index) => ({ value: String(index + 1), label })), [])

  const stepViewMonth = (delta: number) => {
    let month = viewMonth + delta
    let year = viewYear
    if (month < 1) { month = 12; year -= 1 }
    if (month > 12) { month = 1; year += 1 }
    setViewMonth(month)
    setViewYear(year)
  }

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

  const hasDates = Boolean(value.startDate || value.endDate)
  const timeSuffix = showTime && (value.startTime || value.endTime)
    ? ` · ${value.startTime || '00:00'}–${value.endTime || '23:59'}`
    : ''

  const hasSelection = isDateTimeRangeActive(value) || Boolean(value.startTime || value.endTime)

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => {
          // A fresh open always starts a fresh day-click sequence.
          if (!current) pickPhaseRef.current = 'start'
          return !current
        })}
        className={`${triggerClassName || 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 sm:gap-2.5 sm:px-4 sm:py-2.5 sm:text-sm sm:min-w-[15rem]'} border text-xs font-medium transition ${hasSelection
          ? 'border-blue-400 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100'
          : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-600'}`}
        aria-expanded={open}
        aria-label={t('date_time_range') || 'Date and time range'}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" />
        {hasDates ? (
          <>
            <span className="truncate">{displayDate(value.startDate) || '…'}</span>
            <ArrowRight className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" strokeWidth={2.5} />
            <span className="truncate">{displayDate(value.endDate) || '…'}{timeSuffix}</span>
          </>
        ) : (
          <>
            <span>{t('range_start') || 'Start Date'}</span>
            <ArrowRight className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" strokeWidth={2.5} />
            <span>{t('range_end') || 'End Date'}</span>
          </>
        )}
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-2 w-[21rem] max-w-[92vw] rounded-lg border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {/* Manual dates + close (mockup row 1) */}
          <div className="flex items-center gap-2">
            <div className={`flex min-w-0 flex-1 items-center gap-1 rounded-md border px-2 py-1.5 ${startInvalid || endInvalid ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-600'}`}>
              <input
                className={`w-full min-w-0 bg-transparent text-center text-xs outline-none placeholder:text-slate-400 ${startInvalid ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}
                placeholder="MM/DD/YYYY"
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                onBlur={(event) => commitManual('start', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitManual('start', (event.target as HTMLInputElement).value) }}
                aria-label={t('range_start') || 'Start date'}
              />
              <ArrowRight className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" strokeWidth={2.5} aria-hidden="true" />
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
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700"
              onClick={() => setOpen(false)}
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Time range (mockup row 2) */}
          {showTime ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-600">
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

          {/* Start / End rows -- month + year selects per endpoint (the
              redesign's replacement for the old month/year/quarter chips). */}
          <div className="mt-3 space-y-1.5">
            {(['start', 'end'] as const).map((which) => {
              const iso = which === 'start' ? value.startDate : value.endDate
              const month1 = iso ? Number(iso.slice(5, 7)) : (which === 'start' ? viewMonth : Number((value.endDate || value.startDate || today).slice(5, 7)))
              const year = iso ? Number(iso.slice(0, 4)) : (which === 'start' ? viewYear : Number((value.endDate || value.startDate || today).slice(0, 4)))
              const rowLabel = which === 'start' ? (t('range_start') || 'Start') : (t('range_end') || 'End')
              return (
                <div key={which} className="grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-1.5">
                  <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{rowLabel}</span>
                  <AppSelect
                    value={String(month1)}
                    options={monthOptions}
                    onChange={(next) => setEndpointMonthYear(which, Number(next), year)}
                    ariaLabel={`${rowLabel} month`}
                    buttonClassName="w-full px-2.5 py-1.5 text-xs"
                  />
                  <AppSelect
                    value={String(year)}
                    options={yearOptions}
                    onChange={(next) => setEndpointMonthYear(which, month1, Number(next))}
                    ariaLabel={`${rowLabel} year`}
                    buttonClassName="w-full px-2.5 py-1.5 text-xs"
                  />
                </div>
              )
            })}
          </div>

          {/* Calendar range grid, Monday-first, with its own ‹ month › nav
              (the chips that used to change the view are gone). */}
          <div className="mt-3 rounded-lg border border-slate-100 p-2 dark:border-slate-700/60">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => stepViewMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{MONTH_LABELS[viewMonth - 1]} {viewYear}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => stepViewMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {DOW_LABELS.map((label) => <div key={label} className="py-1">{label}</div>)}
            </div>
            <div className="grid grid-cols-7 text-center text-xs">
              {calendarCells.map((cell, index) => cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  // preventDefault on mousedown: a day click must never first
                  // blur the manual input (its blur re-commit raced this very
                  // click and swallowed the selection -- the reported
                  // "pick a day, pick another, nothing changes" bug).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickDay(cell.iso)}
                  className={`mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-md transition ${isEdge(cell.iso)
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
        </div>
      ) : null}
    </div>
  )
}
