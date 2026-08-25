import { useEffect, useId, useRef, useState } from 'react'
import Info from 'lucide-react/dist/esm/icons/info.js'

type InfoHintProps = {
  /** The detail text to reveal. */
  text: string
  /** Names what the hint is about, for screen readers: "About Replace mode". */
  label: string
  className?: string
}

// A small info affordance that keeps an option's explanation OUT of the
// layout until it is asked for.
//
// Screens that list several choices (import modes, sub-options, row-linking
// modes) were printing a full sentence or two under every single card. That
// is a wall of text at a glance, and the reader has to scan all of it to
// find the one option they care about. The label stays visible; the
// explanation moves behind this.
//
// Opens on hover AND on click/tap, deliberately:
//   - hover alone is unusable on a touch screen, where there is no hover
//   - click alone makes a desktop user work for something a tooltip gives
//     for free
// A tap on touch fires click without hover, so both paths are needed for
// the same affordance to work everywhere. Escape and an outside click close
// it, and it is a real <button> so it is reachable and toggleable by
// keyboard.
export default function InfoHint({ text, label, className }: InfoHintProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={wrapperRef} className={`relative inline-flex ${className || ''}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        // Deliberately NO `title` attribute. It was here as a belt-and-braces
        // fallback, but the browser renders its own tooltip from it on hover
        // -- so hovering produced TWO overlapping panels saying the same
        // thing. The custom panel is the one that works on touch and can be
        // styled, so it wins; aria-describedby carries the same text to
        // screen readers without drawing anything.
        onClick={(event) => {
          // These sit inside clickable option cards; opening the hint must
          // not also select the option.
          event.stopPropagation()
          event.preventDefault()
          setOpen((value) => !value)
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span
          id={panelId}
          role="tooltip"
          // right-0 so it never runs off the right edge of a narrow card,
          // and pointer-events-none so it cannot swallow the click that is
          // heading for the option underneath it.
          className="pointer-events-none absolute right-0 top-6 z-50 w-64 rounded-lg border border-slate-200 bg-white p-2.5 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
