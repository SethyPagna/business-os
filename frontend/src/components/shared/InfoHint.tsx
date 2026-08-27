import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLSpanElement | null>(null)
  const panelId = useId()
  const [position, setPosition] = useState({ left: 8, top: 8, width: 256, maxHeight: 288, placement: 'below' as 'above' | 'below' })

  const placePanel = useCallback(() => {
    const trigger = buttonRef.current?.getBoundingClientRect()
    if (!trigger || typeof window === 'undefined') return
    const gutter = 8
    const gap = 6
    const cap = 288
    const width = Math.min(cap, Math.max(200, window.innerWidth - gutter * 2))
    const left = Math.min(window.innerWidth - width - gutter, Math.max(gutter, trigger.right - width))
    // The panel's height budget is the ACTUAL space on the chosen side of the
    // trigger, not the whole viewport -- a viewport-height cap still let the
    // panel run off-screen when the trigger sat near an edge. Prefer below;
    // go above only when below cannot fit the cap AND above has more room.
    const roomBelow = window.innerHeight - trigger.bottom - gap - gutter
    const roomAbove = trigger.top - gap - gutter
    const placement = roomBelow >= cap || roomBelow >= roomAbove ? 'below' : 'above'
    const maxHeight = Math.max(72, Math.min(cap, placement === 'below' ? roomBelow : roomAbove))
    const top = placement === 'below'
      ? Math.min(window.innerHeight - gutter, trigger.bottom + gap)
      : Math.max(gutter, trigger.top - gap)
    setPosition({ left, top, width, maxHeight, placement })
  }, [])

  useLayoutEffect(() => {
    if (open) placePanel()
  }, [open, placePanel])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      // The panel is portaled to <body>, so it is NOT inside wrapperRef --
      // without the second check, touching the panel to scroll it would
      // count as an outside tap and close it.
      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', placePanel)
    // Capture scroll events from nested page containers too. A fixed panel
    // must follow its trigger even when `.page-scroll` moves but window does not.
    window.addEventListener('scroll', placePanel, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', placePanel)
      window.removeEventListener('scroll', placePanel, true)
    }
  }, [open, placePanel])

  return (
    <span ref={wrapperRef} className={`inline-flex ${className || ''}`}>
      <button
        ref={buttonRef}
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
      {open && typeof document !== 'undefined' ? createPortal(
        <span
          id={panelId}
          ref={panelRef}
          role="tooltip"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.placement === 'above' ? 'translateY(-100%)' : undefined,
          }}
          // Portaled to body so overflow-x stat rows, transformed cards and
          // sticky toolbars cannot clip it or create a higher stacking context.
          // Fixed viewport coordinates are clamped on every resize/nested scroll.
          // Pointer events stay ON (unlike the old in-flow panel) so a long
          // hint capped by maxHeight can be scrolled on touch; it closes on
          // Escape or any tap outside the trigger and the panel itself.
          className="fixed z-[1000] overflow-y-auto whitespace-pre-line rounded-lg border border-slate-200 bg-white p-2.5 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {text}
        </span>,
        document.body,
      ) : null}
    </span>
  )
}
