import type { ReactNode } from 'react'

/**
 * A pager that stays on the exact horizontal centreline even when only one
 * side action is permitted. Both side slots keep the same 40px width; callers
 * should render their compact Shift/action buttons inside those slots.
 */
export default function PagerActionRow({
  leading,
  children,
  trailing,
  className = '',
}: {
  leading?: ReactNode
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div className={`grid w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center ${className}`}>
      <div className="flex w-10 min-w-0 items-center justify-start">{leading}</div>
      <div className="flex min-w-0 items-center justify-center">{children}</div>
      <div className="flex w-10 min-w-0 items-center justify-end">{trailing}</div>
    </div>
  )
}
