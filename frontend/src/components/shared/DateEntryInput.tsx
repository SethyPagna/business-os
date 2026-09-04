import { useLayoutEffect, useRef, useState } from 'react'
import InfoHint from './InfoHint.tsx'
import { todayStr } from '../../utils/dateHelpers.ts'
import { applyDateEntryMask, isoToDisplayDate, normalizeDateEntry } from '../../utils/dateEntry.ts'

// The app's ONE typed date field.
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". Staff type bare digit runs on a keypad; the native
// <input type="date"> forces a picker (and, on desktop Chrome, a segmented
// keyboard entry that rejects '9032026' outright), so every staff-typed date
// in the admin app renders THIS instead.
//
// Contract: `value` is the stored ISO 'YYYY-MM-DD' (a legacy slash-form
// string is tolerated on the way in), `onChange` hands back ISO -- the same
// shape the native fields it replaced already used, so adopting it is a
// one-line change per call site. '' means cleared.
//
// Behaviour:
//   - inputMode="numeric" so phones open the keypad
//   - an as-you-type mask (dateEntry.applyDateEntryMask) that only inserts a
//     slash where it cannot be wrong, with the caret parked at the same digit
//     it was before the mask ran -- it never fights the typist
//   - Enter or blur normalises through dateEntry.normalizeDateEntry and
//     commits ISO. Enter preventDefaults ONLY when something normalised (so a
//     half-typed field never silently submits the surrounding form) and then
//     moves focus to the next control -- the "must be automatic move" half of
//     the direction
//   - unreadable text turns the field red and raises an InfoHint saying what
//     the field accepts. It NEVER clears what was typed and never guesses.
//
// Sizing: the shared `.date-entry-input` class (styles/main.css) pins 13px on
// desktop and 16px under 768px -- 16px is the iOS "don't zoom the page on
// focus" floor, which a 13px field would trip on a phone.

export interface DateEntryInputProps {
  /** Stored value, ISO 'YYYY-MM-DD'. '' when unset. */
  value: string
  /** Receives ISO 'YYYY-MM-DD', or '' when the field was cleared. */
  onChange: (iso: string) => void
  t?: (key: string) => string | undefined
  id?: string
  name?: string
  /** Extra classes for the <input> itself. `.input` is applied unless `bare`. */
  className?: string
  /** Drops the `.input` chrome -- for fields drawn inside their own box (the range picker). */
  bare?: boolean
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Inclusive ISO bounds. A date outside them is treated as invalid. */
  min?: string
  max?: string
  /** Told whenever the readable/unreadable state flips (the range picker paints its own box). */
  onInvalidChange?: (invalid: boolean) => void
  /** Set false to let the caller render the error affordance instead. */
  showError?: boolean
  /** Set false where Enter should stay put (single-field rows). */
  advanceOnCommit?: boolean
}

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * A Date whose LOCAL fields are the business-timezone wall clock, so the
 * year-defaulting forms ('903') default to the business year rather than the
 * device's. Built by string surgery from dateHelpers.todayStr() -- never
 * `new Date('YYYY-MM-DD')`, which is parsed as UTC midnight.
 */
function businessToday(): Date {
  const [year, month, day] = todayStr().split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

/** Tolerates either storage shape on the way in. */
function toDisplay(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const iso = isoToDisplayDate(raw)
  if (iso) return iso
  const parsed = normalizeDateEntry(raw, businessToday())
  return parsed.value || raw
}

export default function DateEntryInput({
  value,
  onChange,
  t,
  id,
  name,
  className = '',
  bare = false,
  ariaLabel,
  placeholder = 'dd/mm/yyyy',
  disabled = false,
  autoFocus = false,
  min,
  max,
  onInvalidChange,
  showError = true,
  advanceOnCommit = true,
}: DateEntryInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState(() => toDisplay(value))
  const [invalid, setInvalid] = useState(false)
  const [ambiguous, setAmbiguous] = useState(false)
  // The digit index the caret sat at before the mask ran, applied after the
  // re-render so masking never throws the caret to the end of the field.
  const caretDigitRef = useRef<number | null>(null)
  const lastSyncedRef = useRef(value)

  const tr = (key: string, fallback: string): string => {
    const translated = t?.(key)
    return translated && translated !== key ? translated : fallback
  }

  // Follow the stored value when it changes underneath us (a preset range, a
  // calendar click, a form reset) -- but not while the operator is mid-type.
  if (lastSyncedRef.current !== value) {
    lastSyncedRef.current = value
    const next = toDisplay(value)
    if (next !== text) {
      setText(next)
      setInvalid(false)
      setAmbiguous(false)
    }
  }

  useLayoutEffect(() => {
    const element = inputRef.current
    const target = caretDigitRef.current
    if (!element || target == null) return
    caretDigitRef.current = null
    const current = element.value
    let position = 0
    let seen = 0
    while (position < current.length && seen < target) {
      if (current[position] >= '0' && current[position] <= '9') seen += 1
      position += 1
    }
    // Park after any slash the mask just inserted, so the next digit lands in
    // the next group rather than before the separator.
    while (position < current.length && current[position] === '/') position += 1
    try { element.setSelectionRange(position, position) } catch { /* detached or unsupported */ }
  })

  const flagInvalid = (next: boolean) => {
    setInvalid(next)
    onInvalidChange?.(next)
  }

  /** Returns true when the field settled on a real value (or a real clear). */
  const commit = (raw: string): boolean => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setText('')
      setAmbiguous(false)
      flagInvalid(false)
      if (value) onChange('')
      return true
    }
    const result = normalizeDateEntry(trimmed, businessToday())
    const outOfBounds = Boolean(result.iso && ((min && result.iso < min) || (max && result.iso > max)))
    if (!result.iso || outOfBounds) {
      // Never clear what was typed -- the operator can see and fix it.
      flagInvalid(true)
      return false
    }
    setText(result.value as string)
    setAmbiguous(Boolean(result.ambiguous))
    flagInvalid(false)
    if (result.iso !== value) onChange(result.iso)
    return true
  }

  const moveToNextField = () => {
    const element = inputRef.current
    if (!element) return
    const scope = element.closest('form') || element.ownerDocument?.body
    if (!scope) return
    const fields = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((node) => node.offsetParent !== null || node === element)
    const index = fields.indexOf(element)
    if (index >= 0 && index + 1 < fields.length) fields[index + 1].focus()
    else element.blur()
  }

  const errorText = tr('date_entry_invalid', 'Enter the date as dd/mm/yyyy (day first).')
  // Spells out "day first" because the SAME keystrokes that used to mean
  // 3 September now mean 9 March -- the digits do not reveal the change, so
  // this hint is the only warning a cashier's muscle memory gets.
  const helpText = tr('date_entry_help', 'Type digits only, day first — 9032026 becomes 09/03/2026 (9 March).')

  return (
    <span className="relative inline-flex w-full min-w-0 items-center gap-1">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // 'date-entry-input' carries the 13px desktop / 16px phone sizing.
        className={`date-entry-input ${bare ? '' : 'input'} min-w-0 flex-1 ${invalid ? 'date-entry-input--invalid' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid ? 'true' : 'false'}
        disabled={disabled}
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          const element = event.target
          const raw = element.value
          const caret = element.selectionStart ?? raw.length
          caretDigitRef.current = raw.slice(0, caret).replace(/\D/g, '').length
          setText(applyDateEntryMask(raw, { deleting: raw.length < text.length, today: businessToday() }))
          if (invalid) flagInvalid(false)
          setAmbiguous(false)
        }}
        onBlur={(event) => { commit(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          const settled = commit((event.target as HTMLInputElement).value)
          // preventDefault ONLY when something normalised, so an unreadable
          // entry does not swallow the key and hide the problem.
          if (!settled) return
          event.preventDefault()
          if (advanceOnCommit) moveToNextField()
        }}
      />
      {showError && invalid ? (
        <InfoHint text={`${errorText} ${helpText}`} label={tr('date_entry_hint_label', 'Date format')} className="shrink-0 text-red-600 dark:text-red-400" />
      ) : null}
      {showError && ambiguous ? (
        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400" title={tr('date_entry_ambiguous', 'That digit run had more than one reading — check the date.')}>?</span>
      ) : null}
    </span>
  )
}
