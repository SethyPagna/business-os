import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { REVEAL_ATTR, ensureTextAffordances, isClipped } from './textAffordances.ts'

type TruncatedTextProps = {
  /** The full text to show, truncated to one line until it is asked for. */
  text: string
  className?: string
}

// A one-line label that truncates with an ellipsis and reveals the full
// value when it is asked for -- hover, click/tap, or Enter/Space when it is
// focused (user, Aug 31: "if it is too long and used '...' then when click
// or hover it should show info"; hover alone is unusable on a touch screen,
// click alone makes a desktop user work for a free tooltip).
//
// This component used to own that reveal: its own overflow measurement, its
// own portalled tooltip, its own placement/dismiss/reposition listeners.
// That made it the ONLY cell in the app with a usable reveal -- it had one
// real consumer (StatsStrip.tsx), while the `.dense-cell-truncate` cells in
// Stock Changes, Stock-in Sessions, Returns and Fees fell back to the
// native `title` attribute, which is a hover tooltip and therefore nothing
// at all on touch: the ellipsis was a dead end on exactly the screens where
// truncation bites hardest.
//
// So the reveal moved to ONE delegated controller (textAffordances.ts),
// which serves every `.dense-cell-truncate[title]` cell in the app --
// including surfaces this lane never edited -- and this component became
// the thin wrapper that mounts it. There is one float, one placement
// calculation, one dismiss contract, and one clipping rule (`isClipped`),
// shared with the copy float. What is left here is the markup plus the one
// thing a delegated handler cannot do at render time: make the cell
// focusable only when it is actually clipped, so a label that fits never
// becomes a tab stop.
export default function TruncatedText({ text, className }: TruncatedTextProps) {
  const [clipped, setClipped] = useState(false)
  const textRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => { ensureTextAffordances() }, [])

  const measure = useCallback(() => {
    const el = textRef.current
    if (el) setClipped(isClipped(el))
  }, [])

  useLayoutEffect(() => { measure() }, [measure, text])

  // Re-measure when the element's own width changes (modal opens, container
  // reflows, viewport resizes) rather than only on mount.
  useEffect(() => {
    const el = textRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <span
      ref={textRef}
      className={`dense-cell-truncate ${clipped ? 'cursor-help' : ''} ${className || ''}`}
      // Only a clipped label carries a `title`: on text that already fits, a
      // native tooltip would just repeat what is on screen. The delegated
      // reveal does not depend on it -- `data-reveal-text` opts the span in
      // either way, and the controller re-checks the clip at event time.
      title={clipped ? text : undefined}
      {...{ [REVEAL_ATTR]: text }}
      tabIndex={clipped ? 0 : undefined}
      role={clipped ? 'button' : undefined}
    >
      {text}
    </span>
  )
}
