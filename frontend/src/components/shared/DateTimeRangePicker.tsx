import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect from './AppSelect'
import DateEntryInput from './DateEntryInput.tsx'
import { activeStatsPreset, statsPresetRange, type StatsPresetKey } from './statsStripPresets.ts'

// X1 (Part 395), redesigned Aug 30 per user direction (twice): a compact
// trigger pill, and a panel laid out as two ENDPOINT BOXES
// (Start | → | End), each holding a large editable MM/DD/YYYY date with its
// own month + year selects underneath -- replacing both the old chip strips
// AND the first redesign's separate manual-input row + label/select rows.
// The box whose date the next calendar click will set carries a blue ring
// (the day-click start→end alternation, made visible); clicking a box moves
// that focus. Below: an optional 24-hour HH:MM–HH:MM time row and a Mon-first
// calendar range grid with its own ‹ month › navigation. Closed by the red
// ✕ or an outside click.
//
// The trigger pill never spells out the words "Start Date"/"End Date"
// (user, Aug 31): it always reads MM/DD/YYYY → MM/DD/YYYY -- the literal
// display format as a placeholder when empty, the real dates once picked --
// and appends each endpoint's own 24-hour HH:MM once a time is set.
//
// Times are entered and shown in 24-hour HH:MM on purpose. The native
// <input type="time"> was dropped because it renders 12-hour AM/PM under the
// pinned en-US locale, which fights the app-wide 24-hour convention; the row
// is now a pair of plain HH:MM text fields normalized to 24-hour on commit.
//
// The month + year selects in the calendar header are AppSelects whose menu
// is portaled to <body>. The panel's own outside-click closer therefore
// explicitly ignores clicks that land inside an [data-app-select-menu] popup
// -- otherwise picking a month or year (a click outside rootRef) would slam
// the whole panel shut before the navigation could take effect.
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

/** App-wide initial range: the current local business day, in full. */
export function todayDateTimeRange(now?: Date): DateTimeRange {
  return statsPresetRange('today', now)
}

function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

// The hand-typed date parser that used to live here (strict MM/DD/YYYY only)
// moved to utils/dateEntry.ts and grew the keypad forms staff actually use --
// 9032026, 932026, 20260903 -- so the range row reads them exactly like the
// batch and stock-adjust dates. Same 1970-2999 window as before.

// Accepts 24-hour time typed loosely -- "14:30", "1430", "930", "9", "9:5" --
// and normalizes to "HH:MM" (00:00–23:59). Returns '' to clear on empty input,
// or null when the text can't be read as a valid 24-hour time (so the caller
// can snap the field back to its stored value rather than store garbage).
function normalizeTime(raw: string): string | null {
  const s = raw.trim()
  if (!s) return ''
  let hour: number
  let minute: number
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s)
  if (colon) {
    hour = Number(colon[1])
    minute = Number(colon[2])
  } else if (/^\d{3,4}$/.test(s)) {
    const p = s.padStart(4, '0')
    hour = Number(p.slice(0, 2))
    minute = Number(p.slice(2))
  } else if (/^\d{1,2}$/.test(s)) {
    hour = Number(s)
    minute = 0
  } else {
    return null
  }
  if (hour > 23 || minute > 59) return null
  return `${pad2(hour)}:${pad2(minute)}`
}

function todayIso(): string {
  return statsPresetRange('today').startDate
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

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
  // The mid-keystroke text now lives inside DateEntryInput (which owns the
  // mask and the caret); the panel only tracks whether each endpoint's typed
  // text was readable, so the endpoint box can paint its own red border.
  const [startInvalid, setStartInvalid] = useState(false)
  const [endInvalid, setEndInvalid] = useState(false)
  // Time text mirrors the value but stays editable mid-keystroke (like the
  // date fields) so a half-typed "14" never commits before the ":30".
  const [startTimeText, setStartTimeText] = useState(() => value.startTime)
  const [endTimeText, setEndTimeText] = useState(() => value.endTime)

  useEffect(() => {
    setStartInvalid(false)
    setEndInvalid(false)
    if (value.startDate) {
      setViewYear(Number(value.startDate.slice(0, 4)))
      setViewMonth(Number(value.startDate.slice(5, 7)))
    }
  }, [value.startDate, value.endDate])

  useEffect(() => {
    setStartTimeText(value.startTime)
    setEndTimeText(value.endTime)
  }, [value.startTime, value.endTime])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      // A click inside a portaled AppSelect popup (the month/year menus render
      // to <body>, outside rootRef) must NOT close the panel -- otherwise
      // choosing a month or year slams the whole picker shut before the
      // navigation lands.
      if (target && typeof target.closest === 'function' && target.closest('[data-app-select-menu]')) return
      if (rootRef.current && !rootRef.current.contains(target as Node)) setOpen(false)
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

  // Day clicks alternate start -> end -> start... via an explicit phase
  // instead of inferring from an empty endDate. The old inference broke on
  // parents that never hold an empty end (the Dashboard's onChange ignores
  // blank dates), where every click could only ever move the START -- the
  // reported "pick a day then another and it couldn't change". First click
  // sets a one-day range (start=end=that day, so the parent always sees a
  // complete range); the second click extends it (apply() swaps if it lands
  // before the start); the third starts over. State (not a ref) since the
  // second redesign: the active endpoint box shows a blue ring so the
  // alternation is visible, and clicking/focusing a box retargets it.
  const [pickPhase, setPickPhase] = useState<'start' | 'end'>('start')
  const pickDay = (iso: string) => {
    if (pickPhase === 'start') {
      apply({ startDate: iso, endDate: iso })
      setPickPhase('end')
      return
    }
    apply({ endDate: iso })
    setPickPhase('start')
  }

  // DateEntryInput has already normalised whatever was typed (9032026,
  // 9/3/26, 2026-09-03, ...) into ISO 'YYYY-MM-DD', or '' for a cleared
  // field, and reports unreadable text through onInvalidChange -- so this
  // only has to decide what to apply.
  const commitManual = (which: 'start' | 'end', iso: string) => {
    if (which === 'start') {
      if (!iso) { if (value.startDate) apply({ startDate: '' }); return }
      // No-op when unchanged -- a blur re-committing the same date must never
      // fire a second apply that could race a same-tick day click.
      if (iso !== value.startDate) apply({ startDate: iso })
    } else {
      if (!iso) { if (value.endDate) apply({ endDate: '' }); return }
      if (iso !== value.endDate) apply({ endDate: iso })
    }
  }

  const commitTime = (which: 'start' | 'end', raw: string) => {
    const norm = normalizeTime(raw)
    if (norm === null) {
      // Unparseable -- snap the field back to the stored value.
      if (which === 'start') setStartTimeText(value.startTime)
      else setEndTimeText(value.endTime)
      return
    }
    if (which === 'start') {
      setStartTimeText(norm)
      if (norm !== value.startTime) apply({ startTime: norm })
    } else {
      setEndTimeText(norm)
      if (norm !== value.endTime) apply({ endTime: norm })
    }
  }

  const currentYear = Number(today.slice(0, 4))
  // A generous back-window (10y) plus next year, and ALWAYS the year actually
  // in view -- so chevron-navigating past the window still leaves the Year
  // select showing (and freely re-selectable to) the real viewed year rather
  // than silently falling back to the first option.
  const yearOptions = useMemo(() => {
    const years = new Set<number>()
    for (let year = currentYear - 10; year <= currentYear + 1; year += 1) years.add(year)
    years.add(viewYear)
    return Array.from(years).sort((a, b) => a - b).map((year) => ({ value: String(year), label: String(year) }))
  }, [currentYear, viewYear])
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

  const hasSelection = isDateTimeRangeActive(value) || Boolean(value.startTime || value.endTime)
  const activePreset = activeStatsPreset(value)
  const quickRangeLabel = (key: string, fallback: string) => {
    const label = t(key)
    return label && label !== key ? label : fallback
  }
  const quickRanges: Array<{ id: StatsPresetKey; label: string }> = [
    { id: 'all', label: quickRangeLabel('all_time', 'All time') },
    { id: 'today', label: quickRangeLabel('today', 'Today') },
    { id: '7d', label: quickRangeLabel('last_7_days', 'Last 7 days') },
    { id: 'week', label: quickRangeLabel('this_week', 'This week') },
    { id: 'month', label: quickRangeLabel('this_month', 'This month') },
    { id: 'year', label: quickRangeLabel('this_year', 'This year') },
  ]
  const applyQuickRange = (preset: StatsPresetKey) => {
    const next = statsPresetRange(preset)
    onChange(showTime ? next : { ...next, startTime: '', endTime: '' })
    const anchor = next.startDate || today
    setViewYear(Number(anchor.slice(0, 4)))
    setViewMonth(Number(anchor.slice(5, 7)))
    setPickPhase('start')
  }

  // Trigger labels: always the literal MM/DD/YYYY format -- as a placeholder
  // when a side is empty, as the real date once picked -- never the words
  // "Start Date"/"End Date" (user, Aug 31). Each side carries its own 24-hour
  // HH:MM once any time is set (the unset side defaults to the day's edges,
  // matching the panel's old suffix).
  const showTimes = showTime && Boolean(value.startTime || value.endTime)
  const startTriggerLabel = `${displayDate(value.startDate) || 'MM/DD/YYYY'}${showTimes ? ` ${value.startTime || '00:00'}` : ''}`
  const endTriggerLabel = `${displayDate(value.endDate) || 'MM/DD/YYYY'}${showTimes ? ` ${value.endTime || '23:59'}` : ''}`

  // One endpoint box: START or END label, the date itself as a LARGE editable
  // MM/DD/YYYY input (bumped from text-xs per user direction "the dates can
  // be made larger"), and that endpoint's month + year selects underneath.
  // The box for the endpoint the next calendar click will set carries a blue
  // ring; mousedown anywhere in a box retargets the click sequence to it.
  const renderEndpointBox = (which: 'start' | 'end') => {
    const iso = which === 'start' ? value.startDate : value.endDate
    const invalid = which === 'start' ? startInvalid : endInvalid
    const month1 = iso ? Number(iso.slice(5, 7)) : (which === 'start' ? viewMonth : Number((value.endDate || value.startDate || today).slice(5, 7)))
    const year = iso ? Number(iso.slice(0, 4)) : (which === 'start' ? viewYear : Number((value.endDate || value.startDate || today).slice(0, 4)))
    const label = which === 'start' ? (t('range_start') || 'Start') : (t('range_end') || 'End')
    const active = pickPhase === which
    return (
      <div
        className={`min-w-0 rounded-lg border p-1.5 transition ${invalid
          ? 'border-red-300 dark:border-red-700'
          : active
            ? 'border-blue-400 ring-1 ring-blue-300/70 dark:border-blue-500 dark:ring-blue-600/50'
            : 'border-slate-200 dark:border-slate-600'}`}
        onMouseDown={() => setPickPhase(which)}
      >
        <div className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
        {/* Kept compact on purpose -- the user's "make the dates larger"
            was about the OUTSIDE trigger pill, not this panel.
            The typed field is the shared DateEntryInput (Sep 3): a bare
            digit run like 9032026 normalises to 09/03/2026 on Enter/blur,
            exactly as on every batch and stock-adjust date. The box paints
            its own red border from onInvalidChange, so the field's own
            error affordance is suppressed (showError={false}) rather than
            doubling it, and Enter stays inside the panel
            (advanceOnCommit={false}) instead of jumping to the calendar. */}
        <DateEntryInput
          value={iso}
          onChange={(next) => commitManual(which, next)}
          onInvalidChange={(next) => (which === 'start' ? setStartInvalid(next) : setEndInvalid(next))}
          showError={false}
          advanceOnCommit={false}
          bare
          t={t}
          className={`w-full bg-transparent text-center font-semibold outline-none placeholder:font-normal placeholder:text-slate-400 ${invalid ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'}`}
          placeholder="mm/dd/yyyy"
          ariaLabel={which === 'start' ? (t('range_start') || 'Start date') : (t('range_end') || 'End date')}
        />
        {/* The month/year selects that used to sit here moved into the
            calendar's own header row (user, Aug 30: "the month and year
            can move from start to end date to the 'month year row'
            calendar"). The box stays: label + editable date + the
            which-endpoint-does-the-next-click-set targeting ring. */}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Trigger pill: text-sm font-semibold base (was text-xs font-medium)
          -- the user asked for LARGER dates on the OUTSIDE pill specifically
          (Aug 30), while the panel inside stays compact.
          min-h-10 (2.5rem) is applied on EVERY variant, ahead of any caller
          triggerClassName, so the Start -> End field is exactly as tall as the
          shared search bar (`.input`, min-height 2.5rem) and the app's other
          standard controls (buttons are also min-height 2.5rem) -- user, Aug 31:
          "on smaller screens ... start and end date fields share the same height
          as the search bar". It is a height FLOOR only, so it never shrinks a
          taller caller and never changes width or layout. Callers must therefore
          NOT set their own min-h on the trigger (it would fight this one). */}
      <button
        type="button"
        onClick={() => setOpen((current) => {
          // A fresh open always starts a fresh day-click sequence.
          if (!current) setPickPhase('start')
          return !current
        })}
        className={`min-h-10 ${triggerClassName || 'inline-flex items-center gap-2 rounded-md px-3 py-1.5 sm:gap-2.5 sm:px-4 sm:py-2.5 sm:min-w-[15rem]'} border text-sm font-semibold transition ${hasSelection
          ? 'border-blue-400 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100'
          : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-600'}`}
        aria-expanded={open}
        aria-label={t('date_time_range') || 'Date and time range'}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" />
        <span className={`truncate ${hasSelection ? '' : 'text-slate-400 dark:text-slate-500'}`}>{startTriggerLabel}</span>
        <ArrowRight className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" strokeWidth={2.5} />
        <span className={`truncate ${hasSelection ? '' : 'text-slate-400 dark:text-slate-500'}`}>{endTriggerLabel}</span>
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-2 w-[21rem] max-w-[92vw] rounded-lg border border-slate-200 bg-white p-2.5 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {/* Header: Clear (when anything is set) + the red close ✕. */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('date_time_range') || 'Date range'}</span>
            {hasSelection ? (
              <button
                type="button"
                className="ml-auto text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => onChange({ ...EMPTY_DATE_TIME_RANGE })}
              >
                {t('clear') || 'Clear'}
              </button>
            ) : null}
            <button
              type="button"
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-600 text-white hover:bg-red-700 ${hasSelection ? '' : 'ml-auto'}`}
              onClick={() => setOpen(false)}
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Start | → | End endpoint boxes (see renderEndpointBox above). */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
            {renderEndpointBox('start')}
            <ArrowRight className="h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" strokeWidth={2.5} aria-hidden="true" />
            {renderEndpointBox('end')}
          </div>

          {/* Time range (optional per surface). Plain 24-hour HH:MM text
              fields -- NOT <input type="time">, which renders 12-hour AM/PM
              under the pinned en-US locale. Normalized on blur/Enter. */}
          {showTime ? (
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-600">
              <input
                inputMode="numeric"
                maxLength={5}
                className="w-14 bg-transparent text-center text-xs tabular-nums text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                placeholder="HH:MM"
                value={startTimeText}
                onChange={(event) => setStartTimeText(event.target.value)}
                onBlur={(event) => commitTime('start', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitTime('start', (event.target as HTMLInputElement).value) }}
                aria-label={t('start_time') || 'Start time'}
              />
              <span className="text-slate-400">—</span>
              <input
                inputMode="numeric"
                maxLength={5}
                className="w-14 bg-transparent text-center text-xs tabular-nums text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                placeholder="HH:MM"
                value={endTimeText}
                onChange={(event) => setEndTimeText(event.target.value)}
                onBlur={(event) => commitTime('end', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') commitTime('end', (event.target as HTMLInputElement).value) }}
                aria-label={t('end_time') || 'End time'}
              />
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">24h</span>
            </div>
          ) : null}

          {/* Calendar range grid, Monday-first, with its own ‹ month › nav. */}
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
              {/* Month + Year are SELECTS right here in the calendar header
                  (user, Aug 30) — changing either retargets the visible
                  month; day clicks keep setting whichever endpoint box is
                  ringed. Chevron-less/compact per the earlier direction. */}
              <span className="flex items-center gap-1">
                <AppSelect
                  value={String(viewMonth)}
                  options={monthOptions}
                  onChange={(next) => setViewMonth(Number(next))}
                  ariaLabel={t('month') || 'Month'}
                  showChevron={false}
                  buttonClassName="justify-center !px-1.5 !py-0.5 text-center !text-xs font-semibold"
                />
                <AppSelect
                  value={String(viewYear)}
                  options={yearOptions}
                  onChange={(next) => setViewYear(Number(next))}
                  ariaLabel={t('year') || 'Year'}
                  showChevron={false}
                  buttonClassName="justify-center !px-1.5 !py-0.5 text-center !text-xs font-semibold"
                />
              </span>
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
            <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-slate-600 dark:text-slate-300">
              {DOW_LABELS.map((label) => <div key={label} className="py-0.5">{label}</div>)}
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
                  className={`mx-auto my-px flex h-7 w-7 items-center justify-center rounded-md transition ${isEdge(cell.iso)
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

          {/* Quick ranges live inside the opened date/time control—not as a
              second toolbar outside it. They sit below the calendar so manual
              endpoint selection remains the primary interaction. */}
          <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700/60">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{quickRangeLabel('quick_range', 'Quick range')}</div>
            <div className="flex flex-nowrap gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
              {quickRanges.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyQuickRange(preset.id)}
                  className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition ${activePreset === preset.id
                    ? 'border-blue-500 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-500 dark:text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-200'}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
