import type { ComponentType, ReactNode, SVGProps } from 'react'
import ButtonGuidePopover from './ButtonGuidePopover'

const TONE_CLASS = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

type Tone = keyof typeof TONE_CLASS
type HeaderIcon = ComponentType<SVGProps<SVGSVGElement>>

type PageHeaderProps = {
  icon?: HeaderIcon
  title: ReactNode
  subtitle?: ReactNode
  // Rendered immediately after the page-guide "?" icon, on the same
  // left-hand side, before any other actions -- e.g. a page's
  // ActionHistoryBar. Mirrors the order HeaderActions.tsx already uses
  // for its own per-row button-guide icon (guide icon, then History,
  // then the rest of the row's buttons): the icon that explains what
  // this page does comes first, History comes right after it, per
  // explicit user direction, rather than History and the guide icon
  // living in separate rows or on opposite sides of the row.
  historySlot?: ReactNode
  actions?: ReactNode
  tone?: Tone
  className?: string
  iconClassName?: string
  actionsClassName?: string
  stackOnMobile?: boolean
}

export default function PageHeader({
  // Page-level title/icon are intentionally not rendered: the sidebar/nav
  // already identifies the current page, so this header now only hosts the
  // actions row. Kept in the props for callers that still pass them (title
  // remains available as a tooltip/aria-label on the actions row) so this
  // stays a drop-in change with no per-page rewrites required.
  icon: Icon,
  title,
  subtitle = '',
  historySlot = null,
  actions = null,
  tone = 'blue',
  className = '',
  iconClassName = '',
  actionsClassName = '',
  stackOnMobile = true,
}: PageHeaderProps) {
  void Icon
  void tone
  void iconClassName
  const titleText = typeof title === 'string' ? title : ''
  const subtitleText = typeof subtitle === 'string' ? subtitle.trim() : ''
  const layoutClass = stackOnMobile ? 'flex min-w-0 items-center justify-end gap-2 sm:gap-3' : 'flex min-w-0 items-center justify-end gap-2 sm:gap-3'
  const wrapperClass = [layoutClass, className].filter(Boolean).join(' ')
  const resolvedActionsClass = ['flex min-w-0 max-w-full flex-1 items-center justify-end gap-2 overflow-x-auto overscroll-x-contain [touch-action:pan-x] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', actionsClassName].filter(Boolean).join(' ')

  if (!actions && !subtitleText && !historySlot) return null

  return (
    <div className={wrapperClass}>
      {/* PageHeader intentionally keeps the page title out of the dense
          action row. Its callers still provide a concise subtitle, however;
          surface that as a consistent left-side information control rather
          than hiding useful guidance in an inaccessible hover title.
          historySlot (when passed) sits directly next to it, still on the
          left, ahead of the rest of the row's actions -- see the prop
          comment above for why. */}
      {(subtitleText || historySlot) ? (
        <div className="mr-auto flex min-w-0 shrink-0 items-center gap-2">
          {subtitleText ? (
            <ButtonGuidePopover
              title={titleText || 'About this page'}
              triggerLabel={titleText ? `About ${titleText}` : 'About this page'}
              entries={[{ label: titleText || 'About this page', description: subtitleText }]}
            />
          ) : null}
          {historySlot}
        </div>
      ) : null}
      {actions ? <div className={resolvedActionsClass}>{actions}</div> : null}
    </div>
  )
}
