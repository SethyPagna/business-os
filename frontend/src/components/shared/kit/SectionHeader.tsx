import type { ReactNode } from 'react'

export type SectionHeaderProps = {
  /** Rendered in the kit display font, >=17px (h2). Pass a string for the
   *  common case; a node is accepted for callers that need inline markup. */
  title: ReactNode
  /** Optional trailing count chip (e.g. "Products (128)") -- pass a
   *  pre-formatted node/number, this component only sizes/positions it. */
  count?: ReactNode
  /** Slot for an `<InfoHint .../>` element; SectionHeader does not own
   *  tooltip logic, it only places the slot next to the title. */
  infoHint?: ReactNode
  /** Optional control rendered beside the semantic heading. */
  titleControl?: ReactNode
  /** Right-aligned actions (buttons, an OverflowMenu, etc.). */
  actions?: ReactNode
  className?: string
}

// SectionHeader -- the one section-title row: title + optional count +
// optional InfoHint on the left, actions on the right, always a single row
// (a long title scrolls sideways rather than wrapping or ellipsising --
// see the h2 below). Never nests a second title row --
// a page with sub-sections uses this once per SectionCard-equivalent, not
// once per mini-section (mini-sections stay visually quieter, per the
// existing SectionCard `nested` convention this component does not
// duplicate).
export default function SectionHeader({ title, count, infoHint, titleControl, actions, className = '' }: SectionHeaderProps) {
  return (
    <div className={['flex min-w-0 items-center gap-2', className].join(' ').trim()}>
      <div className="flex min-w-0 items-center gap-1.5">
        {/* The section title is a NAME (the active report, a page section),
            and names are never cut with an ellipsis on this project (owner,
            Sep 22: "we don't do that. we do scroll left and right"). It takes
            the app-wide `.detail-scroll-text` scroller, the same one
            shared/Modal.tsx's title and the kit's own Fold header use.

            The `title` attribute stays for the string case as a courtesy, but
            it is no longer load-bearing -- and it never covered the element
            case at all: ReportFrame passes a `titleControl` ELEMENT as the
            title, so the report's own heading was an ellipsis with no reveal
            behind it. */}
        <h2
          className="detail-scroll-text font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h2)] font-semibold leading-[var(--ui-lh-heading)] text-[var(--ui-ink)]"
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </h2>
        {titleControl ? <span className="min-w-0 shrink-0">{titleControl}</span> : null}
        {count != null ? (
          <span className="shrink-0 rounded-full bg-[var(--ui-surface-2)] px-1.5 text-[11px] leading-[18px] text-[var(--ui-ink-3)]">{count}</span>
        ) : null}
        {infoHint ? <span className="shrink-0">{infoHint}</span> : null}
      </div>
      {actions ? (
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  )
}
