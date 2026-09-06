import { useRef, useState } from 'react'
import InfoHint from './InfoHint.tsx'
import DateEntryInput from './DateEntryInput.tsx'
import { joinLocalDateTime, normalizeTimeEntry, splitLocalDateTime } from '../../utils/dateEntry.ts'

// The app's ONE typed date+time field.
//
// Owner, Sep 6 2026: "i asked to change already dd/mm/yyyy. this is the rule
// moving forward." A native <input type="datetime-local"> cannot keep that
// rule: it takes both its field ORDER and its clock from the viewer's browser
// locale, so the same shift row reads "09/03/2026 3:30 PM" on an en-US laptop
// and "03/09/2026 15:30" on a Khmer one. Nothing on screen says which you are
// looking at, and for every day of the month <= 12 both readings are real
// dates -- the same trap DateEntryInput was built for on the date-only side,
// and the same reason DateTimeRangePicker dropped <input type="time">.
//
// So this composes the two fields the app already owns its reading of:
//   - the date half IS DateEntryInput -- day-first dd/mm/yyyy, the keypad
//     mask ('9032026' -> '09/03/2026'), the same Enter/blur parser;
//   - the time half is a plain 24-hour HH:MM text field read by
//     dateEntry.normalizeTimeEntry, which is the range picker's own reader
//     rather than a second copy of it.
//
// Contract: `value` is 'YYYY-MM-DDTHH:mm' -- byte-for-byte what the native
// field it replaces produced, so the callers' plumbing
// (api/shiftTransport.ts's shiftLocalDateTimeToIso) is untouched. '' means
// unset, and a half-filled field reports '' rather than inventing the missing
// half: defaulting a blank time to midnight would write a shift boundary the
// operator never chose, into the row that decides a day's cash reconciliation.

export interface DateTimeEntryInputProps {
  /** Stored value, 'YYYY-MM-DDTHH:mm'. '' when unset. */
  value: string
  /** Receives 'YYYY-MM-DDTHH:mm', or '' while either half is missing. */
  onChange: (value: string) => void
  t?: (key: string) => string | undefined
  id?: string
  /** Names the field for assistive tech; the time box appends its own suffix. */
  ariaLabel?: string
  disabled?: boolean
  /** Announces both halves as required. The submit guard is the caller's. */
  required?: boolean
  className?: string
}

export default function DateTimeEntryInput({
  value,
  onChange,
  t,
  id,
  ariaLabel,
  disabled = false,
  required = false,
  className = '',
}: DateTimeEntryInputProps) {
  const tr = (key: string, fallback: string): string => {
    const translated = t?.(key)
    return translated && translated !== key ? translated : fallback
  }

  const initial = splitLocalDateTime(value)
  const [date, setDate] = useState(initial.date)
  const [timeText, setTimeText] = useState(initial.time)
  const [timeInvalid, setTimeInvalid] = useState(false)
  const lastSyncedRef = useRef(value)

  // Follow the stored value when it changes underneath us (opening the amend
  // form on another shift, a reset) -- the same rule DateEntryInput uses.
  if (lastSyncedRef.current !== value) {
    lastSyncedRef.current = value
    const next = splitLocalDateTime(value)
    if (next.date !== date || next.time !== timeText) {
      setDate(next.date)
      setTimeText(next.time)
      setTimeInvalid(false)
    }
  }

  const emit = (nextDate: string, nextTime: string) => {
    const composed = joinLocalDateTime(nextDate, nextTime)
    lastSyncedRef.current = composed
    if (composed !== value) onChange(composed)
  }

  /** Normalize the typed time and publish. Never clears what was typed. */
  const commitTime = (raw: string) => {
    const normalized = normalizeTimeEntry(raw)
    if (normalized === null) {
      setTimeInvalid(true)
      return
    }
    setTimeInvalid(false)
    setTimeText(normalized)
    emit(date, normalized)
  }

  const timeLabel = tr('time_entry_aria', 'Time (24-hour)')

  // `aria-required`, not the HTML `required` attribute: these fields do not sit
  // in a <form> -- the callers gate their own submit button on the composed
  // value (ShiftHistoryModal's closeReason), which is the stronger guard and
  // the one that actually fires. This is what is left for a screen reader.
  return (
    <span className={`flex w-full min-w-0 items-center gap-1.5 ${className}`.trim()} aria-required={required || undefined}>
      <DateEntryInput
        id={id}
        value={date}
        disabled={disabled}
        ariaLabel={ariaLabel}
        className="flex-1"
        onChange={(iso) => { setDate(iso); emit(iso, timeText) }}
      />
      <span className="relative inline-flex shrink-0 items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          // Same sizing class as the date half: 13px desktop / 16px under
          // 768px, the iOS floor below which focusing zooms the page.
          className={`date-entry-input input w-[4.5rem] text-center tabular-nums ${timeInvalid ? 'date-entry-input--invalid' : ''}`.replace(/\s+/g, ' ').trim()}
          placeholder="HH:MM"
          aria-label={ariaLabel ? `${ariaLabel} — ${timeLabel}` : timeLabel}
          aria-invalid={timeInvalid ? 'true' : 'false'}
          aria-required={required || undefined}
          disabled={disabled}
          value={timeText}
          onChange={(event) => { setTimeText(event.target.value); if (timeInvalid) setTimeInvalid(false) }}
          onBlur={(event) => commitTime(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitTime((event.target as HTMLInputElement).value) } }}
        />
        {timeInvalid ? (
          <InfoHint
            text={tr('time_entry_invalid', 'Enter the time as HH:MM on a 24-hour clock (00:00–23:59). 1430, 930 and 9 also work.')}
            label={timeLabel}
            className="shrink-0 text-red-600 dark:text-red-400"
          />
        ) : null}
      </span>
    </span>
  )
}
