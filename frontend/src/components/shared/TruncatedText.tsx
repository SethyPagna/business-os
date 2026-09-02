import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type TruncatedTextProps = {
  /** The full text to show, truncated to one line until it is asked for. */
  text: string
  className?: string
}

// A one-line label that truncates with an ellipsis and, ONLY when the text is
// actually clipped, reveals the full value in a floating tooltip. When the
// text fits, it renders as a plain span with no cursor or interaction — the
// affordance appears exactly where "…" does.
//
// Opens on hover AND on click/tap, mirroring InfoHint (user, Aug 31: "if it is
// too long and used '...' then when click or hover it should show info"):
//   - hover alone is unusable on a touch screen, where there is no hover
//   - click/tap alone makes a desktop user work for a free tooltip
// A tap on touch fires click without hover, so both paths are needed. Escape,
// an outside tap, or a scroll/resize that moves the trigger close/reposition
// it. The tooltip is portaled to <body> so overflow-hidden rows, transformed
// cards and sticky toolbars cannot clip it.
export default function TruncatedText({ text, className }: TruncatedTextProps) {
  const [overflowing, setOverflowing] = useState(false)
  const [open, setOpen] = useState(false)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLSpanElement | null>(null)
  const panelId = useId()
  const [position, setPosition] = useState({ left: 8, top: 8, width: 256, maxHeight: 288, placement: 'below' as 'above' | 'below' })

  // Clipped when the rendered content is wider than the box that shows it.
  // The +1 tolerance ignores sub-pixel rounding that would otherwise flag a
  // text that visually fits.
  const measure = useCallback(() => {
    const el = textRef.current
    if (!el) return
    setOverflowing(el.scrollWidth > el.clientWidth + 1)
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, text])

  // Re-measure when the element's own width changes (modal opens, container
  // reflows, viewport resizes) rather than only on mount.
  useEffect(() => {
    const el = textRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // If it stops overflowing (wider container), drop any open tooltip so a
  // stale panel never lingers over text that now fits.
  useEffect(() => {
    if (!overflowing && open) setOpen(false)
  }, [overflowing, open])

  const placePanel = useCallback(() => {
    const trigger = textRef.current?.getBoundingClientRect()
    if (!trigger || typeof window === 'undefined') return
    const gutter = 8
    const gap = 6
    const cap = 288
    const width = Math.min(cap, Math.max(160, window.innerWidth - gutter * 2))
    const left = Math.min(window.innerWidth - width - gutter, Math.max(gutter, trigger.left))
    const roomBelow = window.innerHeight - trigger.bottom - gap - gutter
    const roomAbove = trigger.top - gap - gutter
    const placement = roomBelow >= 96 || roomBelow >= roomAbove ? 'below' : 'above'
    const maxHeight = Math.max(56, Math.min(cap, placement === 'below' ? roomBelow : roomAbove))
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
      if (textRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', placePanel)
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
    <>
      <span
        ref={textRef}
        className={`block truncate ${overflowing ? 'cursor-help' : ''} ${className || ''}`}
        tabIndex={overflowing ? 0 : undefined}
        role={overflowing ? 'button' : undefined}
        aria-describedby={overflowing && open ? panelId : undefined}
        onClick={overflowing ? (event) => {
          // These rows can live inside clickable surfaces; revealing the full
          // text must not also trigger the surface's own click.
          event.stopPropagation()
          setOpen((value) => !value)
        } : undefined}
        onMouseEnter={overflowing ? () => setOpen(true) : undefined}
        onMouseLeave={overflowing ? () => setOpen(false) : undefined}
        onFocus={overflowing ? () => setOpen(true) : undefined}
        onBlur={overflowing ? () => setOpen(false) : undefined}
      >
        {text}
      </span>
      {overflowing && open && typeof document !== 'undefined' ? createPortal(
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
          // Match InfoHint's topmost explanatory layer. Truncated values are
          // frequently opened from inside z-[1050] modals; z-[1000] put the
          // full text behind the surface that contained the ellipsis.
          className="fixed z-[1200] overflow-y-auto whitespace-pre-line break-words rounded-lg border border-slate-200 bg-white p-2.5 text-left text-xs font-normal leading-relaxed text-slate-600 shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {text}
        </span>,
        document.body,
      ) : null}
    </>
  )
}
