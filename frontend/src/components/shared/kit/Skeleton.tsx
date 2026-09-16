export type SkeletonVariant = 'table' | 'cards' | 'text'

export type SkeletonProps = {
  rows?: number
  variant?: SkeletonVariant
  className?: string
}

const PULSE = 'animate-pulse motion-reduce:animate-none bg-[var(--ui-surface-2)]'

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-[var(--ui-radius)] border border-[var(--ui-line)]" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[var(--ui-row-h)] items-center gap-3 bg-[var(--ui-surface)] px-3">
          <div className={`h-3 w-1/4 rounded-[var(--ui-radius-sm)] ${PULSE}`} />
          <div className={`h-3 w-1/3 rounded-[var(--ui-radius-sm)] ${PULSE}`} />
          <div className={`h-3 w-1/6 rounded-[var(--ui-radius-sm)] ${PULSE}`} />
        </div>
      ))}
    </div>
  )
}

function CardsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`h-16 rounded-[var(--ui-radius)] border border-[var(--ui-line)] ${PULSE}`} />
      ))}
    </div>
  )
}

function TextSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`h-3 rounded-[var(--ui-radius-sm)] ${PULSE}`} style={{ width: i === rows - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}

// Skeleton -- loading placeholder for table rows, stat/tile cards, or plain
// text lines. Uses Tailwind's built-in `motion-reduce:` variant so the
// pulse animation is dropped for users with `prefers-reduced-motion`
// without the kit needing its own media-query plumbing.
export default function Skeleton({ rows = 3, variant = 'table', className = '' }: SkeletonProps) {
  const content =
    variant === 'cards' ? <CardsSkeleton rows={rows} /> :
    variant === 'text' ? <TextSkeleton rows={rows} /> :
    <TableSkeleton rows={rows} />
  return <div className={className}>{content}</div>
}
