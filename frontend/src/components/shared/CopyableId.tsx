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
}: CopyableIdProps) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
  }, [])

  const text = String(value ?? '').trim()
  if (!text) return null

  const handleCopy = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(text)
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
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        {copied
          ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          : <Copy className="h-3.5 w-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">{copied ? copiedLabel : ''}</span>
    </div>
  )
}
