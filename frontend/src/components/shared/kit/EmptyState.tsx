import type { ReactNode } from 'react'

export type EmptyStateProps = {
  icon: ReactNode
  /** Display font, 15px (--ui-size-h3). */
  title: ReactNode
  /** One line of supporting text -- keep it to a single sentence. */
  text?: ReactNode
  action?: ReactNode
  className?: string
}

// EmptyState -- compact "nothing here" placeholder (max 160px tall, per
// the design spec) for an empty list/table/search result. Icon, one-line
// title, one optional line of text, one optional action -- never a long
// explanation (this app puts explanations in InfoHint tooltips, not
// inline prose, per the standing density convention).
export default function EmptyState({ icon, title, text, action, className = '' }: EmptyStateProps) {
  return (
    <div className={['flex max-h-40 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center', className].join(' ').trim()}>
      <span className="flex h-8 w-8 items-center justify-center text-[var(--ui-ink-3)] [&>svg]:h-8 [&>svg]:w-8" aria-hidden="true">
        {icon}
      </span>
      <p className="font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h3)] font-semibold leading-[var(--ui-lh-heading)] text-[var(--ui-ink)]">
        {title}
      </p>
      {text ? <p className="max-w-xs text-[length:var(--ui-size-meta)] leading-[var(--ui-lh-body)] text-[var(--ui-ink-2)]">{text}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
