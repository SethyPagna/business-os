import type { ReactNode } from 'react'

export type HubTileProps = {
  label: string
  /** A 40px lucide icon element, e.g. `<Package />` -- HubTile sizes it via
   *  a wrapper rather than cloning props, so any icon component works. */
  icon: ReactNode
  onSelect: () => void
  /** Unread/count badge shown as a small chip in the tile's top-right
   *  corner. Omit for no badge. */
  badge?: number
  /** True when the current user lacks permission for this destination.
   *  Uses the native `hidden` attribute (never a disabled/greyed-out
   *  state) -- per the standing rule that a permission gate hides, while
   *  "disable a feature" is the separate case of keeping a feature visible
   *  but inert. */
  hidden?: boolean
  className?: string
}

// HubTile -- one large tap target for the mobile layer-1 home (decision 19,
// plan §4.5): icon centred above a short label, the whole ~110px tile is
// the target. Style only -- no route/navigation knowledge, `onSelect` is
// the caller's own handler. Colours come from tokens.css only (never the
// user's old system's palette -- structure only, per the decision).
export default function HubTile({ label, icon, onSelect, badge, hidden = false, className = '' }: HubTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      hidden={hidden}
      aria-label={badge ? `${label} (${badge} unread)` : label}
      className={[
        'relative flex min-h-[110px] w-full flex-col items-center justify-center gap-2 rounded-[var(--ui-radius-lg)]',
        'border border-[var(--ui-line)] bg-[var(--ui-surface)] shadow-[var(--ui-shadow-1)]',
        'transition-[filter,background-color] duration-150',
        'hover:bg-[var(--ui-surface-2)] active:brightness-[.96]',
        'focus-visible:outline-none focus-visible:shadow-[var(--ui-focus)]',
        className,
      ].join(' ').trim()}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--ui-ink)] [&>svg]:h-10 [&>svg]:w-10" aria-hidden="true">
        {icon}
      </span>
      <span className="max-w-full truncate px-2 text-[13px] font-medium leading-none text-[var(--ui-ink)]">{label}</span>
      {typeof badge === 'number' && badge > 0 ? (
        <span
          className="absolute right-2 top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--ui-danger)] px-1 text-[10px] font-medium leading-none text-[var(--ui-ground)]"
          aria-hidden="true"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  )
}
