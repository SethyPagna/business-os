import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { REVEAL_ATTR, ensureTextAffordances, isClipped } from './textAffordances.ts'

export type ProductNameRailProps = {
  name: string
  className?: string
  style?: CSSProperties
}

// Two readable lines, plain word wrap, no fixed row height.
//
// This used to be a CSS multicolumn box (`columnCount:1, columnFill:'auto',
// height:'2lh'`) with horizontal scroll for whatever did not fit. On mobile
// WebKit that produced the two owner reports this replaces: the fixed `2lh`
// height reserved a blank second line for names that only needed one, and
// overflow spilled into an IMPLICIT second column laid out 1em to the right
// of the first rather than scrolling -- "EDT 100ml" from a POS card was the
// visible tail of a name whose earlier words were sitting in a column that
// had already scrolled out of view, and the large mid-name gaps were the
// column gutter landing inside a word-wrapped line.
//
// A `-webkit-line-clamp: 2` box has neither failure mode: no explicit
// height (the clamp itself caps it at two lines of whatever line-height the
// parent sets, which is also what a Khmer line needs more of), and no
// second column -- text simply wraps and the third+ line is hidden, not
// relaid-out sideways. The full name is still reachable: this component
// wires into the app's one shared truncation reveal (textAffordances.ts,
// the same controller TruncatedText mounts) so a clipped name opens on
// hover, click/tap or long-press exactly like every other truncated cell,
// and the row/card underneath keeps its own click when the name itself
// fits and is not clipped.
export default function ProductNameRail({ name, className = '', style }: ProductNameRailProps) {
  const [clipped, setClipped] = useState(false)
  const railRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => { ensureTextAffordances() }, [])

  const measure = useCallback(() => {
    const el = railRef.current
    // The same isClipped() the delegated reveal controller re-checks at
    // hover/press time -- its height branch is what makes THIS render's
    // `data-reveal-text` and the controller's own eligibility agree.
    if (el) setClipped(isClipped(el))
  }, [])

  useLayoutEffect(() => { measure() }, [measure, name])

  useEffect(() => {
    const el = railRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <span
      ref={railRef}
      className={`product-name-rail ${clipped ? 'cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500' : ''} ${className}`}
      title={clipped ? name : undefined}
      {...{ [REVEAL_ATTR]: name }}
      tabIndex={clipped ? 0 : undefined}
      role={clipped ? 'button' : undefined}
      style={{
        ...style,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        minWidth: 0,
        maxWidth: '100%',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
      } as CSSProperties}
    >
      {name}
    </span>
  )
}
