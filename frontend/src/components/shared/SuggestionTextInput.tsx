import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  buildSuggestionMatches,
  nextSuggestionIndex,
  shouldPickOnClick,
  type SuggestionFilterMode,
  type SuggestionOption,
} from '../../utils/suggestionMatching.ts'

// THE "type or select" field. One implementation, shared by every catalog
// text field that has existing values worth offering: ProductForm's Category,
// Brand, Unit, Supplier and create-mode Name, the create-products session
// header's Brand, and SupplierPickerField (which wraps this to add its
// contact-id semantics).
//
// It replaces two things that both failed the operator (owner, 2026-09-06:
// "categories still does not show the available options when i write"):
//
//  1. A private copy of this control inside ProductForm.tsx. Being private,
//     the supplier field beside it never got the same treatment and only
//     matched once something was typed, and the create-products header could
//     not use it at all.
//  2. A native <datalist> on the create-products header's Brand. Native
//     datalists render at the browser's discretion -- Android/iOS webviews
//     routinely show nothing at all -- so 203 brands existed and the operator
//     saw an ordinary empty text box. A datalist is also unstyleable, has no
//     touch-sized rows, and cannot show a second line.
//
// Interaction contract (identical on every host):
//  - free text is always allowed; suggestions never constrain what may be typed
//  - the list opens on FOCUS as well as on typing, and an empty query lists
//    everything -- discovering what exists is the whole point
//  - matching is case-insensitive substring over the value and the meta line
//  - options are de-duplicated case-insensitively
//  - the list FLOATS above the content (absolute + z-40); it never pushes the
//    form down
//  - picks land on MOUSEDOWN with preventDefault, so the input's blur cannot
//    swallow them -- on touch too, since a tap's synthetic mousedown is
//    dispatched before the focus change (click is the fallback path; see
//    shouldPickOnClick in utils/suggestionMatching.ts)
//  - keyboard: ArrowDown/ArrowUp move, Enter takes the highlighted row,
//    Escape closes without changing the value
//  - roles: combobox + listbox + option, aria-expanded/aria-activedescendant
//  - rows wrap rather than truncate, so no value is hidden behind an ellipsis
//  - max-height is capped against the viewport so the list stays on screen at
//    375px wide, where the field can sit near the bottom of a modal

export type { SuggestionOption } from '../../utils/suggestionMatching.ts'

export type SuggestionTextInputProps = {
  id: string
  value: string
  /** Plain strings, or rows with a meta line / selected mark / payload. */
  options: ReadonlyArray<string | SuggestionOption | null | undefined>
  /** `option` is present only when the change came from picking a row. */
  onChange: (value: string, option?: SuggestionOption) => void
  ariaLabel: string
  name?: string
  placeholder?: string
  className?: string
  inputClassName?: string
  disabled?: boolean
  /** 'none' for lists the server already narrowed (see suggestionMatching). */
  filter?: SuggestionFilterMode
  /** Rows shown before scrolling matters; defaults to 50. */
  limit?: number
  /** Show a loading row while options are still being fetched. */
  loading?: boolean
  /** Called on first focus/typing so hosts can fetch options lazily. */
  onRequestOptions?: () => void
  /** Shown INSIDE the open list when there is nothing to offer. */
  emptyHint?: string
  loadingLabel?: string
  autoFocus?: boolean
  onBlurCapture?: () => void
  inputRef?: React.Ref<HTMLInputElement>
}

export default function SuggestionTextInput({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  name,
  placeholder,
  className,
  inputClassName,
  disabled,
  filter = 'substring',
  limit,
  loading = false,
  onRequestOptions,
  emptyHint,
  loadingLabel,
  autoFocus,
  onBlurCapture,
  inputRef,
}: SuggestionTextInputProps) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const listId = `${id}-suggestions`
  const reactId = useId()

  const matches = useMemo(
    () => buildSuggestionMatches(options, value, { filter, limit }),
    [options, value, filter, limit],
  )

  // A cursor left pointing past the end of a shrinking list would make Enter
  // do nothing (or, worse, take a row the operator is no longer looking at).
  useEffect(() => {
    setCursor((current) => (current >= matches.length ? -1 : current))
  }, [matches.length])

  // Called on EVERY focus/keystroke, not once per mount: hosts that cache
  // (SupplierPickerField) already no-op when they hold rows, and a host that
  // DROPS its rows on a sync event must be able to re-fetch on the next
  // focus. A once-per-mount guard here would leave that field permanently
  // empty until it was unmounted.
  const requestOptions = () => { onRequestOptions?.() }

  // When the last pick happened, so the click that closes a tap's own
  // mousedown->mouseup->click sequence does not pick the row a second time.
  const lastPickAtRef = useRef(0)

  const pick = (option: SuggestionOption) => {
    lastPickAtRef.current = Date.now()
    onChange(option.value, option)
    setOpen(false)
    setCursor(-1)
  }

  const showEmptyHint = Boolean(emptyHint) && !loading && matches.length === 0
  const listOpen = open && !disabled && (loading || matches.length > 0 || showEmptyHint)

  return (
    <div className={`relative ${className || ''}`.trim()}>
      <input
        id={id}
        name={name}
        ref={inputRef}
        className={inputClassName || 'input min-h-11 w-full min-w-0'}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && cursor >= 0 ? `${listId}-${reactId}-${cursor}` : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { setOpen(true); requestOptions() }}
        // Delayed so a pick that arrives through click (rather than the
        // mousedown fast path) still lands before the list unmounts.
        onBlur={() => window.setTimeout(() => { setOpen(false); setCursor(-1); onBlurCapture?.() }, 120)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setCursor(-1); requestOptions() }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (open) { event.stopPropagation() }
            setOpen(false)
            setCursor(-1)
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!open) { setOpen(true); requestOptions() }
            if (!matches.length) return
            event.preventDefault()
            setCursor((current) => nextSuggestionIndex(current, matches.length, event.key === 'ArrowDown' ? 1 : -1))
            return
          }
          if (event.key === 'Enter' && open && cursor >= 0 && matches[cursor]) {
            // Only swallow Enter when it is actually taking a suggestion --
            // otherwise Enter must keep reaching the form (submit/next line).
            event.preventDefault()
            pick(matches[cursor])
          }
        }}
      />
      {listOpen ? (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[min(14rem,45vh)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-800"
        >
          {loading && !matches.length ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">{loadingLabel || 'Loading...'}</div>
          ) : null}
          {showEmptyHint ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">{emptyHint}</div>
          ) : null}
          {matches.map((option, index) => (
            <button
              key={option.key || option.value.toLowerCase()}
              id={`${listId}-${reactId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === cursor}
              className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${index === cursor ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
              // Mouse AND touch both arrive here: a tap's synthetic mousedown
              // is dispatched BEFORE the focus change that blurs the input, so
              // preventDefault + pick beats the blur on either. There is
              // deliberately no touchstart handler -- preventDefault there
              // cancels the gesture before the browser has decided tap-or-
              // scroll, which made dragging the list select a row.
              onMouseDown={(event) => { event.preventDefault(); pick(option) }}
              // Fallback for a browser that skips the synthetic mousedown; the
              // 120ms deferred blur above keeps this row mounted for it.
              onClick={(event) => {
                event.preventDefault()
                if (shouldPickOnClick(lastPickAtRef.current, Date.now())) pick(option)
              }}
            >
              <span className="min-w-0 flex-1">
                {/* Wraps instead of truncating: a suggestion hidden behind an
                    ellipsis is the ambiguity this control exists to remove. */}
                <span className="block break-words font-medium text-gray-800 dark:text-gray-200">{option.value}</span>
                {option.meta ? <span className="block break-words text-[11px] text-gray-400">{option.meta}</span> : null}
              </span>
              {option.selected ? <span className="shrink-0 text-xs text-blue-500">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
