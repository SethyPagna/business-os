import type { MouseEvent, ReactNode } from 'react'
import { getAdminPathForPage } from '../../app/pathRouting.ts'
import { queueEntitySearch } from './entityLinkFocus.ts'

export type EntityNavigate = (page: string, anchor?: string) => void

type EntityLinkProps = {
  page: string
  children: ReactNode
  /** Existing hub anchor, for example `hub:contacts:customers`. */
  anchor?: string
  /** Search text handed to the destination page after navigation. */
  search?: string
  /** Additional destination filter, such as the exact Products unit filter. */
  focus?: Record<string, unknown>
  navigate?: EntityNavigate
  ariaLabel?: string
  title?: string
  className?: string
}

/**
 * A guarded in-app link that keeps a normal href for keyboard/context-menu
 * users while using AppContext navigation for SPA transitions. Search focus is
 * queued before navigation so a product, customer, supplier, or driver opens
 * at the matching record instead of merely landing on an unrelated list.
 */
export { queueEntitySearch }

/**
 * Link-like styling is deliberately shared. Internal navigation stays behind
 * AppContext's permission and dirty-work guards; a raw anchor would bypass
 * those safeguards and can strand an unsaved modal.
 */
export default function EntityLink({
  page,
  children,
  anchor,
  search,
  focus,
  navigate,
  ariaLabel,
  title,
  className = '',
}: EntityLinkProps) {
  const route = getAdminPathForPage(page)
  const href = `${route}${anchor ? `#${anchor.replace(/^#/, '')}` : ''}`
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!navigate) return
    // Preserve browser defaults for modifier/middle clicks: those should open
    // the explicit href in a new tab rather than mutating the current SPA.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    queueEntitySearch(page, search, anchor, focus)
    navigate(page, anchor)
  }
  return (
    <a
      href={href}
      onClick={onClick}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      aria-label={ariaLabel}
      title={title}
      className={`text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:decoration-blue-700 dark:hover:text-blue-100 ${className}`}
    >
      {children}
    </a>
  )
}
