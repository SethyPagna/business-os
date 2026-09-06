import { useLayoutEffect, useRef, useState } from 'react'
import InfoHint from './InfoHint.tsx'
import { todayStr } from '../../utils/dateHelpers.ts'
import {
  applyDateEntryMask,
  applyTimeEntryMask,
  dateEntryDisplayValue,
  localDateTimePairValue,
  normalizeDateEntry,
  normalizeTimeEntry,
  splitLocalDateTime,
} from '../../utils/dateEntry.ts'
import type { LocalDateTimePair } from '../../utils/dateEntry.ts'

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
//
// Sep 6 2026: the same machinery now also drives the TIME half
// (TimeEntryInput) and the date+time pair (DateTimeEntryInput), which the
// shift amend/close forms adopted from the last native
// <input type="datetime-local"> in the app. The masking, caret parking,
// Enter-commit-and-advance and error affordance live ONCE, in
// MaskedEntryField below; each of the three exports only supplies its own
// mask, its own commit and its own words.

/** What a field's commit decided: the settled display text, or a refusal. */
type CommitResult = {
  /** Text to show once the entry settled. Ignored when `settled` is false. */
  display: string
  /** False leaves what the operator typed on screen and raises the hint. */
  settled: boolean
  /** The entry read more than one way; the caller advises without blocking. */
  advisory?: boolean
}

interface MaskedEntryFieldProps {
  /** Display text derived from the stored value by the owning field. */
  display: string
  /** The stored value, so the field re-syncs only when it really changed. */
  syncKey: string
  mask: (raw: string, deleting: boolean) => string
  commit: (raw: string) => CommitResult
  errorText: string
  helpText: string
  hintLabel: string
  advisoryText: string
  id?: string
  name?: string
  className?: string
  bare?: boolean
  ariaLabel?: string
  placeholder: string
  disabled?: boolean
  autoFocus?: boolean
  onInvalidChange?: (invalid: boolean) => void
  showError?: boolean
  advanceOnCommit?: boolean
}

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

/**
 * Tolerates either storage shape on the way in.
 *
 * The rule itself lives in dateEntry.dateEntryDisplayValue, because a caller
 * deciding whether it may adopt this field at all has to be able to ask what
 * the field would do to a value BEFORE rendering it, and a second copy of the
 * rule here is exactly how that answer drifts from this one.
 */
function toDisplay(value: string): string {
  return dateEntryDisplayValue(value, businessToday())
}

function translator(t?: (key: string) => string | undefined) {
  return (key: string, fallback: string): string => {
    const translated = t?.(key)
    return translated && translated !== key ? translated : fallback
  }
}

/**
 * The typed-entry mechanics, shared by the date field and the time field.
 *
 * It owns exactly three things: the as-you-type mask (with the caret parked
 * at the digit it was on), the Enter/blur commit, and the error affordance.
 * It decides nothing about what the text MEANS -- that is the `mask` and
 * `commit` the owning field hands in, which is what keeps one reading rule
 * per kind of value instead of one per field.
 */
function MaskedEntryField({
  display,
  syncKey,
  mask,
  commit,
  errorText,
  helpText,
  hintLabel,
  advisoryText,
  id,
  name,
  className = '',
  bare = false,
  ariaLabel,
  placeholder,
  disabled = false,
  autoFocus = false,
  onInvalidChange,
  showError = true,
  advanceOnCommit = true,
}: MaskedEntryFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState(() => display)
  const [invalid, setInvalid] = useState(false)
  const [ambiguous, setAmbiguous] = useState(false)
  // The digit index the caret sat at before the mask ran, applied after the
  // re-render so masking never throws the caret to the end of the field.
  const caretDigitRef = useRef<number | null>(null)
  const lastSyncedRef = useRef(syncKey)

  // Follow the stored value when it changes underneath us (a preset range, a
  // calendar click, a form reset) -- but not while the operator is mid-type.
  if (lastSyncedRef.current !== syncKey) {
    lastSyncedRef.current = syncKey
    if (display !== text) {
      setText(display)
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
    // Park after any separator the mask just inserted, so the next digit lands
    // in the next group rather than before it.
    while (position < current.length && (current[position] === '/' || current[position] === ':')) position += 1
    try { element.setSelectionRange(position, position) } catch { /* detached or unsupported */ }
  })

  const flagInvalid = (next: boolean) => {
    setInvalid(next)
    onInvalidChange?.(next)
  }

  /** Returns true when the field settled on a real value (or a real clear). */
  const runCommit = (raw: string): boolean => {
    const result = commit(raw)
    if (!result.settled) {
      // Never clear what was typed -- the operator can see and fix it.
      flagInvalid(true)
      return false
    }
    setText(result.display)
    setAmbiguous(Boolean(result.advisory))
    flagInvalid(false)
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
          setText(mask(raw, raw.length < text.length))
          if (invalid) flagInvalid(false)
          setAmbiguous(false)
        }}
        onBlur={(event) => { runCommit(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          const settled = runCommit((event.target as HTMLInputElement).value)
          // preventDefault ONLY when something normalised, so an unreadable
          // entry does not swallow the key and hide the problem.
          if (!settled) return
          event.preventDefault()
          if (advanceOnCommit) moveToNextField()
        }}
      />
      {showError && invalid ? (
        <InfoHint text={`${errorText} ${helpText}`} label={hintLabel} className="shrink-0 text-red-600 dark:text-red-400" />
      ) : null}
      {showError && ambiguous ? (
        <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400" title={advisoryText}>?</span>
      ) : null}
    </span>
  )
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
  const tr = translator(t)

  const commit = (raw: string): CommitResult => {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (value) onChange('')
      return { display: '', settled: true }
    }
    const result = normalizeDateEntry(trimmed, businessToday())
    const outOfBounds = Boolean(result.iso && ((min && result.iso < min) || (max && result.iso > max)))
    if (!result.iso || outOfBounds) return { display: trimmed, settled: false }
    if (result.iso !== value) onChange(result.iso)
    return { display: result.value as string, settled: true, advisory: Boolean(result.ambiguous) }
  }

  return (
    <MaskedEntryField
      display={toDisplay(value)}
      syncKey={value}
      mask={(raw, deleting) => applyDateEntryMask(raw, { deleting, today: businessToday() })}
      commit={commit}
      errorText={tr('date_entry_invalid', 'Enter the date as dd/mm/yyyy (day first).')}
      // Spells out "day first" because the SAME keystrokes that used to mean
      // 3 September now mean 9 March -- the digits do not reveal the change,
      // so this hint is the only warning a cashier's muscle memory gets.
      helpText={tr('date_entry_help', 'Type digits only, day first — 9032026 becomes 09/03/2026 (9 March).')}
      hintLabel={tr('date_entry_hint_label', 'Date format')}
      advisoryText={tr('date_entry_ambiguous', 'That digit run had more than one reading — check the date.')}
      id={id}
      name={name}
      className={className}
      bare={bare}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onInvalidChange={onInvalidChange}
      showError={showError}
      advanceOnCommit={advanceOnCommit}
    />
  )
}

export interface TimeEntryInputProps {
  /** Stored value, 24-hour 'HH:mm'. '' when unset. */
  value: string
  /** Receives 'HH:mm', or '' when the field was cleared. */
  onChange: (time: string) => void
  t?: (key: string) => string | undefined
  id?: string
  name?: string
  className?: string
  bare?: boolean
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onInvalidChange?: (invalid: boolean) => void
  showError?: boolean
  advanceOnCommit?: boolean
}

/**
 * The time twin of DateEntryInput: 24-hour, typed as digits, same commit and
 * error contract. '930' settles to 09:30 on Enter or blur.
 */
export function TimeEntryInput({
  value,
  onChange,
  t,
  id,
  name,
  className = '',
  bare = false,
  ariaLabel,
  placeholder = 'hh:mm',
  disabled = false,
  autoFocus = false,
  onInvalidChange,
  showError = true,
  advanceOnCommit = true,
}: TimeEntryInputProps) {
  const tr = translator(t)

  const commit = (raw: string): CommitResult => {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (value) onChange('')
      return { display: '', settled: true }
    }
    const result = normalizeTimeEntry(trimmed)
    if (!result.value) return { display: trimmed, settled: false }
    if (result.value !== value) onChange(result.value)
    return { display: result.value, settled: true }
  }

  return (
    <MaskedEntryField
      display={normalizeTimeEntry(value).value || ''}
      syncKey={value}
      mask={(raw, deleting) => applyTimeEntryMask(raw, { deleting })}
      commit={commit}
      errorText={tr('time_entry_invalid', 'Enter the time as hh:mm on the 24-hour clock.')}
      helpText={tr('time_entry_help', 'Type digits only — 930 becomes 09:30 and 1430 becomes 14:30.')}
      hintLabel={tr('time_entry_hint_label', 'Time format')}
      advisoryText=""
      id={id}
      name={name}
      className={className}
      bare={bare}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onInvalidChange={onInvalidChange}
      showError={showError}
      advanceOnCommit={advanceOnCommit}
    />
  )
}

export interface DateTimeEntryInputProps {
  /** Stored value, the local wall clock 'YYYY-MM-DDTHH:mm'. '' when unset. */
  value: string
  /** Receives 'YYYY-MM-DDTHH:mm', or '' while either half is missing. */
  onChange: (localDateTime: string) => void
  t?: (key: string) => string | undefined
  id?: string
  /** Extra classes for the row that holds the two fields. */
  className?: string
  disabled?: boolean
  dateAriaLabel?: string
  timeAriaLabel?: string
}

/**
 * A date and a 24-hour time, typed on a keypad, stored as the local
 * 'YYYY-MM-DDTHH:mm' string the native datetime-local control used to hand
 * back -- so a call site swaps the control and changes nothing downstream.
 *
 * The two halves are separate fields on one row rather than one combined
 * box: Enter on the date advances into the time (the shared
 * moveToNextField), each half reports its own unreadable entry, and neither
 * mask has to guess where the other begins.
 *
 * A half-filled pair reports '' upward and KEEPS both halves on screen. That
 * matters on the shift close form, where the value is required: clearing the
 * time must leave the typed date alone and let the submit row say what is
 * still missing, rather than wiping the field or inventing a midnight.
 *
 * An UNREADABLE half withdraws the pair the same way -- see
 * dateEntry.localDateTimePairValue for why banking the last good timestamp
 * while unreadable text is on screen is the one outcome a shift close cannot
 * have. The half's own text is never touched; only what the pair publishes.
 *
 * The half un-flags itself on the next keystroke (that is how the red box
 * clears as the operator retypes), which does briefly restore the last good
 * pair while the new text is still in flight. Nothing can be saved out of
 * that window: reaching any submit control blurs the half first, and the
 * blur commit either settles the new text or withdraws the pair again.
 */
export function DateTimeEntryInput({
  value,
  onChange,
  t,
  id,
  className = '',
  disabled = false,
  dateAriaLabel,
  timeAriaLabel,
}: DateTimeEntryInputProps) {
  const tr = translator(t)
  const [pair, setPair] = useState<LocalDateTimePair>(() => ({
    ...splitLocalDateTime(value), dateUnreadable: false, timeUnreadable: false,
  }))
  // Both halves and both readable-flags move through ONE ref, because a
  // single commit fires onChange and then onInvalidChange in the same event:
  // two handlers reading `pair` out of the render closure would each see the
  // pre-event value and the second would undo the first.
  const pairRef = useRef(pair)
  // Set on the way OUT as well as in, so a '' we published ourselves (one
  // half cleared or unreadable) never reads as an external reset and wipes
  // the other half.
  const lastSyncedRef = useRef(value)

  if (lastSyncedRef.current !== value) {
    lastSyncedRef.current = value
    const next = splitLocalDateTime(value)
    if (next.date !== pair.date || next.time !== pair.time) {
      const reset: LocalDateTimePair = { ...next, dateUnreadable: false, timeUnreadable: false }
      pairRef.current = reset
      setPair(reset)
    }
  }

  const apply = (patch: Partial<LocalDateTimePair>) => {
    const next = { ...pairRef.current, ...patch }
    pairRef.current = next
    setPair(next)
    const combined = localDateTimePairValue(next)
    if (combined === value) return
    lastSyncedRef.current = combined
    onChange(combined)
  }

  return (
    <span className={`flex min-w-0 items-start gap-2 ${className}`.replace(/\s+/g, ' ').trim()}>
      <span className="min-w-0 flex-1">
        <DateEntryInput
          id={id}
          value={pair.date}
          onChange={(iso) => apply({ date: iso })}
          onInvalidChange={(unreadable) => apply({ dateUnreadable: unreadable })}
          t={t}
          disabled={disabled}
          ariaLabel={dateAriaLabel || tr('date', 'Date')}
        />
      </span>
      <span className="w-24 shrink-0">
        <TimeEntryInput
          value={pair.time}
          onChange={(next) => apply({ time: next })}
          onInvalidChange={(unreadable) => apply({ timeUnreadable: unreadable })}
          t={t}
          disabled={disabled}
          ariaLabel={timeAriaLabel || tr('time', 'Time')}
          className="text-center"
        />
      </span>
    </span>
  )
}
