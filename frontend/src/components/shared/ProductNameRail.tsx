import type { CSSProperties } from 'react'

export type ProductNameRailProps = {
  name: string
  className?: string
  style?: CSSProperties
}

/** Two readable lines per horizontal column; overflow remains selectable text.
 * Keep this in a width-constrained/min-width:0 parent. Typography is inherited.
 * Unlike line-clamp, later text remains in the DOM and in the scrollable area.
 */
export default function ProductNameRail({ name, className = '', style }: ProductNameRailProps) {
  return (
    <>
    <style>{'.product-name-rail::-webkit-scrollbar{display:none}.product-name-rail:focus-visible{outline:2px solid currentColor;outline-offset:2px}'}</style>
    <span
      className={`product-name-rail ${className}`}
      tabIndex={0}
      title={name}
      style={{
        ...style,
        display: 'block',
        minWidth: 0,
        maxWidth: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const rail = event.currentTarget
        if (rail.scrollWidth <= rail.clientWidth) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          event.stopPropagation()
          rail.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * rail.clientWidth
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          event.stopPropagation()
          rail.scrollLeft = event.key === 'Home' ? 0 : rail.scrollWidth
        }
      }}
    >
      <span style={{ display: 'block', columnCount: 1, columnGap: '1em', columnFill: 'auto', height: '2lh', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{name}</span>
    </span>
    </>
  )
}
