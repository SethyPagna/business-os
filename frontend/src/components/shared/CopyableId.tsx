import { useEffect, useRef, useState } from 'react'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Check from 'lucide-react/dist/esm/icons/check.js'

type CopyableIdProps = {
  /** The identifier itself -- a receipt number, a return id, a sale id. */
  value: string
  /** Translated "Copy <thing>" used for the button's title and aria-label. */
  copyLabel: string
  /** Translated "Copied" confirmation. */
  copiedLabel: string
  className?: string
  /** Typography for the id text (size/weight/colour). Layout is owned here. */
  valueClassName?: string
  /**
   * What reaches the clipboard, when that is not the same string that is
   * shown. The Stock Change ledger displays the record ('Sale 20260901-142200')
   * because the row must say WHICH record it belongs to, but a receipt id in
   * this business is bare YYYYMMDD-HHMMSS -- pasting the word 'Sale' in front
   * of it into a search box finds nothing. Defaults to `value`.
   */
  copyValue?: string
  /**
   * Dense variant for a table row rather than a detail panel: the copy button
   * shrinks from 24px to 16px so a ledger row keeps its height. Everything
   * else -- wrap, select-all, the copied state, and the size of the region
   * that is actually pressable -- is identical, because those are the rules,
   * not the sizing.
   */
  compact?: boolean
}

// An identifier that is always readable in full.
//
// Receipt numbers and return ids used to render either with `truncate` (an
// ellipsis eats the tail -- and the tail is the part that distinguishes two
// receipts made the same day) or with `.detail-scroll-text`, which keeps the
// id on one line behind a horizontal touch-scroll. Both fail the same ask
// (user, Sep 3 2026): "for smaller screens the receipt id must be shown
// clearly fully, no scroll; can push to second row and copy easily."
//
// So: `whitespace-normal break-all` (wraps onto as many rows as it needs,
// inside the width it is given, never clipped and never a scroll container),
// `select-all` so one tap/click selects the whole id, and a copy button that
// flips to a green check plus a visible "Copied" tag for ~1.6s. Deliberately
// NOT TruncatedText -- truncation is never legitimate for an id.
export default function CopyableId({
  value,
  copyLabel,
  copiedLabel,
  className = '',
  valueClassName = '',
  copyValue,
  compact = false,
}: CopyableIdProps) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
  }, [])

  const text = String(value ?? '').trim()
  if (!text) return null

  const copyText = String(copyValue ?? value ?? '').trim() || text

  // These ids live inside CLICKABLE surfaces too -- a Stock Change ledger row
  // opens its movement detail on click -- so copying or selecting an id must
  // not also be the gesture that leaves the list. Same rule TruncatedText
  // states for revealing a clipped value.
  const handleCopy = (event: { stopPropagation: () => void }): void => {
    event.stopPropagation()
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(copyText)
      .then(() => {
        setCopied(true)
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        resetTimerRef.current = setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => { /* a blocked clipboard still leaves the id selectable */ })
  }

  return (
    <div className={`flex w-full min-w-0 items-start gap-1.5 ${className}`}>
      <span
        data-copyable-id="true"
        onClick={(event) => event.stopPropagation()}
        className={`min-w-0 flex-1 select-all whitespace-normal break-all leading-snug ${valueClassName}`}
      >
        {text}
      </span>
      {copied ? (
        <span className="shrink-0 self-start rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {copiedLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
        className={`flex ${compact ? 'h-4 w-4' : 'h-6 w-6'} shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
      >
        {/*
          Visual size and TOUCH size are two different rules, and compact only
          buys the first. The 16px button keeps a dense ledger row at its
          height on a wide screen -- but the same component renders on the
          mobile Stock Change card at 375px, where 16px is under every
          published minimum for a target a finger has to hit (24px in WCAG 2.2
          AA 2.5.8, 44px in the iOS guidelines). So the icon carries a padding
          ring cancelled by an equal negative margin: the pressable region --
          the ring is inside the button, so a press on it is the button's --
          becomes 12px icon + 2 * 6px = 24px, while the button box, the hover
          background and every row that contains it stay exactly as they were.
          Put here rather than at the two ledger call sites so "dense visual,
          touch-sized target" has ONE implementation for every compact caller.
        */}
        <span aria-hidden="true" className={compact ? 'flex -m-1.5 p-1.5' : 'flex'}>
          {copied
            ? <Check className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-emerald-600 dark:text-emerald-400`} />
            : <Copy className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
        </span>
      </button>
      <span aria-live="polite" className="sr-only">{copied ? copiedLabel : ''}</span>
    </div>
  )
}
