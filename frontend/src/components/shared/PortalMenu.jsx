import { cloneElement, isValidElement, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

/**
 * 1. PortalMenu
 * 1.1 Renders action items in a body-level portal so menu layers stay visible.
 * 1.2 Computes viewport-safe positioning from the trigger coordinates.
 * 1.3 Closes on outside interactions and scroll/resize events.
 */
export default function PortalMenu({
  trigger,
  items,
  align = 'right',
  content = null,
  menuClassName = '',
  closeOnContentClick = false,
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const frameRef = useRef(0)

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

    let top = triggerRect.bottom + 4
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, triggerRect.top - menuHeight - 4)
    }
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, viewportHeight - menuHeight - 8)
    }

    let left = align === 'right' ? triggerRect.right - menuWidth : triggerRect.left
    if (left + menuWidth > viewportWidth - 8) left = viewportWidth - menuWidth - 8
    if (left < 8) left = 8

    setPosition({ top, left })
  }, [align])

  const toggleOpen = useCallback((event) => {
    event.stopPropagation()
    setOpen((isOpen) => {
      if (!isOpen) setTimeout(reposition, 0)
      return !isOpen
    })
  }, [reposition])

  useEffect(() => {
    if (!open) return undefined

    const closeIfClickedOutside = (event) => {
      const target = event.target
      const insideMenu = menuRef.current?.contains(target)
      const insideTrigger = triggerRef.current?.contains(target)
      if (!insideMenu && !insideTrigger) setOpen(false)
    }

    const closeMenu = () => setOpen(false)
    const scheduleReposition = () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        reposition()
      })
    }
    const closeIfEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    let resizeObserver = null

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

  const colorClassByType = {
    red: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
    blue: 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
    purple: 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20',
    green: 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20',
    orange: 'text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20',
    gray: 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
  }

  const closeMenu = useCallback(() => setOpen(false), [])

  const resolvedContent = typeof content === 'function'
    ? content({ closeMenu, open })
    : content

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger, {
        'aria-expanded': open,
        'aria-haspopup': true,
      })
    : trigger

  return (
    <>
      <div ref={triggerRef} onClickCapture={toggleOpen} style={{ display: 'inline-flex' }}>
        {triggerNode}
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          onClick={(event) => {
            event.stopPropagation()
            if (closeOnContentClick) setOpen(false)
          }}
          style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
          className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 min-w-[170px] py-1 fade-in ${menuClassName}`.trim()}
        >
          {resolvedContent
            ? resolvedContent
            : items.filter(Boolean).map((item, index) => (
              item === 'divider'
                ? <div key={`divider-${index}`} className="border-t border-gray-100 dark:border-gray-700 my-1" />
                : (
                  <button
                    key={`item-${index}`}
                    type="button"
                    onClick={() => {
                      item.onClick?.()
                      setOpen(false)
                    }}
                    disabled={item.disabled}
                    className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      colorClassByType[item.color] || colorClassByType.gray
                    }`}
                  >
                    {item.label}
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
export function ThreeDotPortal({ onDetails, onEdit, onDelete, onAddVariant, extraItems = [] }) {
  const items = [
    onDetails && { label: 'View Details', onClick: onDetails },
    onEdit && { label: 'Edit', onClick: onEdit, color: 'blue' },
    onAddVariant && { label: 'Add Variant', onClick: onAddVariant, color: 'purple' },
    ...(extraItems || []),
    onDelete && 'divider',
    onDelete && { label: 'Delete', onClick: onDelete, color: 'red' },
  ].filter(Boolean)

  return (
    <PortalMenu
      trigger={(
        <button type="button" className="three-dot-btn" aria-label="Open actions menu">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      items={items}
    />
  )
}
