import { cloneElement, isValidElement, useState, useEffect, useRef, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js'

type MenuColor = 'red' | 'blue' | 'purple' | 'green' | 'orange' | 'gray'

export type PortalMenuItem = 'divider' | {
  label: ReactNode
  onClick?: () => void
  color?: MenuColor | string
  disabled?: boolean
  // Optional leading icon (e.g. a lucide-react element sized h-4 w-4).
  // Purely additive -- every existing caller that doesn't pass one renders
  // exactly as before (no icon slot, no extra gap), since the row only
  // switches to a two-child flex layout when an icon is actually present.
  icon?: ReactNode
}

type PortalContentHelpers = {
  closeMenu: () => void
  open: boolean
}

export type PortalMenuProps = {
  trigger: ReactNode
  items?: Array<PortalMenuItem | null | undefined | false>
  // 'left'/'right' pin the menu to that edge of the trigger regardless of
  // where the trigger sits on screen. 'auto' (the default) instead reads
  // the trigger's actual position each time it opens: it prefers opening
  // rightward from the trigger's left edge (the natural reading-order
  // anchor for a button sitting anywhere left-of-center or inline in a
  // toolbar), and only flips to hugging the trigger's right edge when a
  // right-aligned trigger would otherwise force the menu to overflow the
  // viewport. This replaces every caller that used to hardcode `right`
  // regardless of where its own button actually landed on each page.
  align?: 'left' | 'right' | 'auto'
  // Also open on pointer hover (mouse only — touch keeps the tap-to-open
  // behavior). Used by info/guide popovers so an explanation appears on
  // hover with no click ("when hover on said functions it will show good
  // quality … explanation", user Aug 30).
  openOnHover?: boolean
  content?: ReactNode | ((helpers: PortalContentHelpers) => ReactNode) | null
  menuClassName?: string
  closeOnContentClick?: boolean
  defaultOpen?: boolean
  triggerWrapperClassName?: string
  onOpenChange?: ((open: boolean) => void) | null
  // Denser row padding/text size and a smaller default width -- for menus
  // that are a handful of short "quick action" lines (e.g. ExportMenu)
  // rather than a longer list of row actions, so the popover doesn't read
  // as an oversized card next to a small trigger button. Still follows the
  // app's own light/dark mode via the normal `dark:` classes below -- this
  // only ever changes spacing/size, never a fixed color palette.
  compact?: boolean
}

type ThreeDotPortalLabels = {
  details?: string
  viewDetails?: string
  edit?: string
  addVariant?: string
  delete?: string
  ariaLabel?: string
}

type ThreeDotPortalProps = {
  onDetails?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onAddVariant?: () => void
  extraItems?: Array<PortalMenuItem | null | undefined | false>
  labels?: ThreeDotPortalLabels
}

function isPortalMenuItem(item: PortalMenuItem | null | undefined | false): item is PortalMenuItem {
  return Boolean(item)
}

/**
 * 1. PortalMenu
 * 1.1 Renders action items in a body-level portal so menu layers stay visible.
 * 1.2 Computes viewport-safe positioning from the trigger coordinates.
 * 1.3 Closes on outside interactions and scroll/resize events.
 */
export default function PortalMenu({
  trigger,
  items,
  align = 'auto',
  content = null,
  menuClassName = '',
  closeOnContentClick = false,
  defaultOpen = false,
  triggerWrapperClassName = '',
  onOpenChange = null,
  compact = false,
  openOnHover = false,
}: PortalMenuProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef(0)
  // Hover-open close timer: leaving the trigger (or the menu) starts it;
  // re-entering either cancels it, so moving the pointer from trigger to
  // menu never flickers the menu shut.
  const hoverCloseTimerRef = useRef<number | null>(null)
  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }
  const scheduleHoverClose = () => {
    if (!openOnHover) return
    cancelHoverClose()
    hoverCloseTimerRef.current = window.setTimeout(() => setOpen(false), 220)
  }

  const reposition = useCallback(() => {
    if (!triggerRef.current || !document.body.contains(triggerRef.current)) {
      setOpen(false)
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const menuHeight = menuRef.current?.offsetHeight || 160
    const menuWidth = menuRef.current?.offsetWidth || 170

    // On phones the fixed bottom nav (plus its safe-area-inset-bottom on
    // notched iPhones) covers a real strip of the viewport. window.innerHeight
    // doesn't know about that, so without this a menu opened from a row near
    // the bottom of the screen would be positioned as if that space were free
    // -- placing its last item(s) directly under the nav bar, functionally
    // unreachable even though z-index draws the menu visually on top.
    const bottomNav = document.querySelector('nav.safe-area-inset-bottom')
    const bottomReserve = bottomNav && bottomNav.getBoundingClientRect().width > 0
      ? Math.max(8, viewportHeight - bottomNav.getBoundingClientRect().top + 8)
      : 8

    let top = triggerRect.bottom + 4
    if (top + menuHeight > viewportHeight - bottomReserve) {
      top = Math.max(8, triggerRect.top - menuHeight - 4)
    }
    if (top + menuHeight > viewportHeight - bottomReserve) {
      top = Math.max(8, viewportHeight - bottomReserve - menuHeight)
    }

    let left: number
    if (align === 'right') {
      left = triggerRect.right - menuWidth
    } else if (align === 'left') {
      left = triggerRect.left
    } else {
      // auto: anchor to the trigger's own left edge by default -- this is
      // what actually makes the menu feel attached to the button that
      // opened it, whether that button sits at the start of a toolbar, in
      // the middle of a row, or anywhere else. Only hug the trigger's
      // right edge instead when the trigger is far enough right that a
      // left-anchored menu would spill past the viewport -- e.g. a
      // three-dot action button at the end of a table row.
      left = triggerRect.left + menuWidth <= viewportWidth - 8
        ? triggerRect.left
        : triggerRect.right - menuWidth
    }
    if (left + menuWidth > viewportWidth - 8) left = viewportWidth - menuWidth - 8
    if (left < 8) left = 8

    setPosition({ top, left })
  }, [align])

  useEffect(() => {
    if (!defaultOpen) return
    setOpen(true)
    setTimeout(reposition, 0)
  }, [defaultOpen, reposition])

  const toggleOpen = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    setOpen((isOpen) => {
      if (!isOpen) setTimeout(reposition, 0)
      return !isOpen
    })
  }, [reposition])

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open) return undefined

    const closeIfClickedOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const insideMenu = menuRef.current?.contains(target)
      const insideTrigger = triggerRef.current?.contains(target)
      // A menu opened *inside* this menu's content (e.g. the section-level
      // filter dropdowns nested inside FilterMenu's own popover) renders its
      // own content into a separate document.body portal, so it's not a DOM
      // descendant of `menuRef` even though it's a React descendant of the
      // content this menu rendered. Without this check, interacting with
      // that nested popover (typing in its search box, ticking a checkbox)
      // looks like an "outside" click to this outer menu and closes it out
      // from under the nested one. Treat a click landing in any open
      // portal-menu content as "inside" so nested popovers can be used
      // without collapsing their parent.
      const insideNestedPortalMenu = target instanceof Element ? Boolean(target.closest('[data-portal-menu-content]')) : false
      if (!insideMenu && !insideTrigger && !insideNestedPortalMenu) setOpen(false)
    }

    const closeMenu = () => setOpen(false)
    const scheduleReposition = () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        reposition()
      })
    }
    const closeIfEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    let resizeObserver: ResizeObserver | null = null

    document.addEventListener('mousedown', closeIfClickedOutside)
    document.addEventListener('touchstart', closeIfClickedOutside)
    document.addEventListener('keydown', closeIfEscape)
    window.addEventListener('scroll', scheduleReposition, true)
    window.addEventListener('resize', scheduleReposition)
    if (typeof ResizeObserver !== 'undefined' && menuRef.current) {
      resizeObserver = new ResizeObserver(() => scheduleReposition())
      resizeObserver.observe(menuRef.current)
    }
    scheduleReposition()

    return () => {
      document.removeEventListener('mousedown', closeIfClickedOutside)
      document.removeEventListener('touchstart', closeIfClickedOutside)
      document.removeEventListener('keydown', closeIfEscape)
      window.removeEventListener('scroll', scheduleReposition, true)
      window.removeEventListener('resize', scheduleReposition)
      resizeObserver?.disconnect()
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [open, reposition])

  const colorClassByType: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
    blue: 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
    purple: 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20',
    green: 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20',
    orange: 'text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20',
    gray: 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
  }

  const closeMenu = useCallback(() => setOpen(false), [])

  const resolvedContent = open
    ? (typeof content === 'function'
        ? content({ closeMenu, open })
        : content)
    : null
  const menuItems = (items || []).filter(isPortalMenuItem)

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        'aria-expanded': open,
        'aria-haspopup': true,
      })
    : trigger

  return (
    <>
      <div
        ref={triggerRef}
        onClickCapture={toggleOpen}
        // Hover-open (mouse pointers only). Leaving toward the menu keeps
        // it open — the menu portal carries its own matching mouseleave.
        onMouseEnter={openOnHover ? () => {
          // matchMedia guards touch devices, where mouseenter fires
          // synthetically right before the tap's click and would double-
          // toggle with onClickCapture.
          cancelHoverClose()
          if (window.matchMedia('(hover: hover)').matches && !open) setOpen(true)
        } : undefined}
        onMouseLeave={openOnHover ? scheduleHoverClose : undefined}
        className={triggerWrapperClassName}
        style={{ display: 'inline-flex' }}
      >
        {triggerNode}
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          data-portal-menu-content=""
          onMouseEnter={openOnHover ? cancelHoverClose : undefined}
          onMouseLeave={openOnHover ? scheduleHoverClose : undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (closeOnContentClick) setOpen(false)
          }}
          style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
          className={`bg-white dark:bg-neutral-900 shadow-2xl border border-gray-200 dark:border-neutral-700 fade-in ${
            compact ? 'rounded-lg min-w-[150px] py-0.5' : 'rounded-xl min-w-[170px] py-1'
          } ${menuClassName}`.trim()}
        >
          {resolvedContent
            ? resolvedContent
            : menuItems.map((item, index) => (
              item === 'divider'
                ? <div key={`divider-${index}`} className={`border-t border-gray-100 dark:border-neutral-700 ${compact ? 'my-0.5' : 'my-1'}`} />
                : (
                  <button
                    key={`item-${index}`}
                    type="button"
                    onClick={() => {
                      item.onClick?.()
                      setOpen(false)
                    }}
                    disabled={item.disabled}
                    className={`w-full flex items-center text-left font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      item.icon ? 'gap-2' : ''
                    } ${
                      compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
                    } ${
                      colorClassByType[item.color || 'gray'] || colorClassByType.gray
                    }`}
                  >
                    {item.icon ? <span className="shrink-0 inline-flex">{item.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                )
            ))}
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * 2. ThreeDotPortal
 * 2.1 Provides a consistent "..." row-action trigger used across list tables.
 * 2.2 Keeps caller code small by converting optional handlers into menu items.
 */
export function ThreeDotPortal({
  onDetails,
  onEdit,
  onDelete,
  onAddVariant,
  extraItems = [],
  labels = {},
}: ThreeDotPortalProps) {
  const items: Array<PortalMenuItem | null | undefined | false> = [
    onDetails && { label: labels.details || labels.viewDetails || 'View Details', onClick: onDetails },
    onEdit && { label: labels.edit || 'Edit', onClick: onEdit, color: 'blue' },
    onAddVariant && { label: labels.addVariant || 'Add Variant', onClick: onAddVariant, color: 'purple' },
    ...(extraItems || []),
    onDelete && ('divider' as const),
    onDelete && { label: labels.delete || 'Delete', onClick: onDelete, color: 'red' },
  ].filter(Boolean)

  return (
    <PortalMenu
      trigger={(
        <button type="button" className="three-dot-btn" aria-label={labels.ariaLabel || 'Open actions menu'}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      items={items}
    />
  )
}
