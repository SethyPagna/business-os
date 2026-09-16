import X from 'lucide-react/dist/esm/icons/x.js'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

export type ChipProps = {
  children: ReactNode
  /** Toggled/active state -- e.g. the current hub tab, an applied filter. */
  selected?: boolean
  /** Small trailing count badge (e.g. a filter's match count). */
  count?: number
  onClick?: () => void
  /** Shows a trailing X; calling it removes the chip without triggering
   *  onClick (used for filter-summary chips, never for hub tabs). */
  onRemove?: () => void
  disabled?: boolean
  className?: string
}

// Chip -- 24px tall, sans 12px, one hairline. Used for hub-section tabs
// (decision: top-level SECTION chips, one shown at a time) and for
// filter-summary chips (selected filters surface only inside the shared
// FilterMenu's own chip row, per the standing filter-menu-selected-state
// rule -- this primitive is the chip shape that rule renders with, not a
// second place filters get echoed into).
export default function Chip({ children, selected = false, count, onClick, onRemove, disabled = false, className = '' }: ChipProps) {
  const interactive = typeof onClick === 'function' && !disabled
  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!interactive) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.()
    }
  }
  const handleRemove = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    onRemove?.()
  }

  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-disabled={disabled || undefined}
      className={[
        'inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2.5 text-[12px] leading-none',
        'transition-colors duration-150',
        selected
          ? 'border-transparent bg-[var(--ui-accent)] text-[var(--ui-ground)]'
          : 'border-[var(--ui-line-2)] bg-[var(--ui-surface)] text-[var(--ui-ink-2)]',
        interactive ? 'cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--ui-focus)]' : '',
        disabled ? 'opacity-50 pointer-events-none' : '',
        interactive && !selected ? 'hover:bg-[var(--ui-surface-2)]' : '',
        className,
      ].join(' ').trim()}
    >
      <span className="truncate">{children}</span>
      {typeof count === 'number' ? (
        <span className={[
          'shrink-0 rounded-full px-1 text-[11px] leading-[16px]',
          selected ? 'bg-[color-mix(in_srgb,var(--ui-ground)_25%,transparent)]' : 'bg-[var(--ui-surface-2)] text-[var(--ui-ink-3)]',
        ].join(' ')}>{count}</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remove"
          className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,currentColor_18%,transparent)]"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}
