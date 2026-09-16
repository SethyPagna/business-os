import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ControlRowProps = {
  search: ReactNode
  range: ReactNode
  /** The existing `FilterMenu` element -- ControlRow renders it as an
   *  opaque slot and never inspects its contents. */
  filters: ReactNode
  sort?: ReactNode
  actions?: ReactNode
  /** Rendered in place of `filters`/`sort`/`actions` once the row is too
   *  narrow to hold them inline (<1024px) -- typically the kit's own
   *  `OverflowMenu` built from the same items the caller would otherwise
   *  render inline. When omitted, ControlRow keeps those slots inline
   *  regardless of width: it degrades LAYOUT, never drops a control. */
  overflow?: ReactNode
  /** Pins the row(s) under the hub's own sticky chip row, per the app's
   *  standing "search + date rows stay pinned while scrolling" convention.
   *  Reads `--ui-sticky-offset` (set by the page/hub; defaults to 0) as the
   *  sticky `top`. */
  sticky?: boolean
  className?: string
}

const TIER_WIDE = 1024
const TIER_MEDIUM = 768

type Tier = 'wide' | 'medium' | 'narrow'

function tierForWidth(width: number): Tier {
  if (width >= TIER_WIDE) return 'wide'
  if (width >= TIER_MEDIUM) return 'medium'
  return 'narrow'
}

function initialTier(): Tier {
  if (typeof window === 'undefined') return 'wide'
  return tierForWidth(window.innerWidth)
}

// ControlRow -- the ONE control row a kit-adopting page uses instead of
// hand-rolling its own `flex flex-wrap` toolbar (Gate 2A audit: 27 such
// rows found). Measures its OWN width via ResizeObserver -- a container
// query, not a window/media-query breakpoint -- so it degrades correctly
// even nested inside a narrower panel (e.g. a Fold) on a wide viewport:
//  - >=1024px ("wide"): everything on one row -- search, range, filters,
//    sort, actions.
//  - 768-1023px ("medium"): search + range stay on the row; filters/sort/
//    actions move into `overflow`.
//  - <768px ("narrow"): two PINNED rows -- row 1 search, row 2 range --
//    with `overflow` (or, lacking one, filters/sort/actions) appended to
//    row 2.
// Never uses `flex-wrap` for the tier-driven layout (kitPrimitives.test.ts
// pins this) -- width changes move controls between explicit slots
// instead of letting the browser wrap them unpredictably.
export default function ControlRow({ search, range, filters, sort, actions, overflow, sticky = false, className = '' }: ControlRowProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [tier, setTier] = useState<Tier>(initialTier)

  useEffect(() => {
    const node = wrapperRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number') setTier(tierForWidth(width))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const collapsedTail = overflow ?? (
    <>
      {filters}
      {sort}
      {actions}
    </>
  )

  const stickyClass = sticky ? 'sticky z-[var(--z-sticky)] bg-[var(--ui-ground)]' : ''
  const stickyStyle = sticky ? { top: 'var(--ui-sticky-offset, 0px)' } : undefined

  if (tier === 'wide') {
    return (
      <div ref={wrapperRef} className={[stickyClass, 'flex min-w-0 items-center gap-2 py-1.5', className].join(' ').trim()} style={stickyStyle}>
        <div className="min-w-0 flex-1">{search}</div>
        {range}
        {filters}
        {sort}
        {actions}
      </div>
    )
  }

  if (tier === 'medium') {
    return (
      <div ref={wrapperRef} className={[stickyClass, 'flex min-w-0 items-center gap-2 py-1.5', className].join(' ').trim()} style={stickyStyle}>
        <div className="min-w-0 flex-1">{search}</div>
        {range}
        {collapsedTail}
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={[stickyClass, 'flex flex-col gap-1.5 py-1.5', className].join(' ').trim()} style={stickyStyle}>
      <div className="min-w-0">{search}</div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">{range}</div>
        {collapsedTail}
      </div>
    </div>
  )
}
