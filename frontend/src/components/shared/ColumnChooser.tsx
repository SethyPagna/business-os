// The large-screen "show extra columns" control (user, Aug 31 2026). A small
// popover of checkboxes, one per OPTIONAL column, driven by useColumnPreferences.
// Callers place it on the table's header row; wrap it in `hidden lg:…` if the
// surface only offers extra columns on large screens (the intended use).
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import type { TableColumnDef } from './columnPreferences.ts'

// An always-visible column is listed but cannot be switched off.
export type ChooserColumn = TableColumnDef & { required?: boolean }

interface ColumnChooserProps {
  columns: ChooserColumn[]
  isVisible: (key: string) => boolean
  toggle: (key: string) => void
  reset: () => void
  /** Button label used as the accessible name / tooltip. */
  label?: string
  resetLabel?: string
  className?: string
}

export default function ColumnChooser({ columns, isVisible, toggle, reset, label = 'Columns', resetLabel = 'Reset', className = '' }: ColumnChooserProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [position, setPosition] = useState({ left: 0, top: 0 })

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 208
    const menuHeight = menuRef.current?.getBoundingClientRect().height || 300
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
    const top = window.innerHeight - rect.bottom >= menuHeight + 8 || rect.top < menuHeight
      ? rect.bottom + 4
      : Math.max(8, rect.top - menuHeight - 4)
    setPosition({ left, top })
  }, [])

  const closeToTrigger = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [])

  // Keyboard users land on the first item; the menu is portaled, so focus must be moved explicitly.
  useEffect(() => { if (open) itemRefs.current[0]?.focus() }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const frame = window.requestAnimationFrame(updatePosition)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.cancelAnimationFrame(frame)
    }
  }, [open, updatePosition])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => !!item)
    const index = items.findIndex((item) => item === document.activeElement)
    const focusAt = (next: number) => { event.preventDefault(); items[(next + items.length) % items.length]?.focus() }
    if (event.key === 'ArrowDown') focusAt(index + 1)
    else if (event.key === 'ArrowUp') focusAt(index < 0 ? items.length - 1 : index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(items.length - 1)
    else if (event.key === 'Escape') { event.preventDefault(); closeToTrigger() }
    else if (event.key === 'Tab') setOpen(false)
  }

  const resetAndClose = () => { reset(); closeToTrigger() }

  const onItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, activate: () => void) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    activate()
  }

  if (!columns.length) return null
  const shownCount = columns.reduce((count, column) => count + (isVisible(column.key) ? 1 : 0), 0)

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen((value) => !value); window.requestAnimationFrame(updatePosition) }}
        onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false) } }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        title={label}
      >
        <MoreVertical className="h-4 w-4" />
        <span className="sr-only">{label} ({shownCount}/{columns.length})</span>
      </button>
      {open ? createPortal((
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="fixed z-[1200] w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          style={{ left: position.left, top: position.top }}
        >
          <div className="max-h-72 overflow-y-auto">
            {columns.map((column, index) => {
              const on = column.required ? true : isVisible(column.key)
              const flip = () => { if (!column.required) toggle(column.key) }
              return (
                <button
                  key={column.key}
                  ref={(node) => { itemRefs.current[index] = node }}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  aria-disabled={column.required ? true : undefined}
                  tabIndex={-1}
                  onClick={flip}
                  onKeyDown={(event) => onItemKeyDown(event, flip)}
                  className={`flex w-full items-center [@media(pointer:coarse)]:min-h-[44px] gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700${column.required ? ' cursor-not-allowed opacity-60' : ''}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-transparent bg-[var(--ui-accent,#9c7a3c)] text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                    {on ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{column.label}</span>
                </button>
              )
            })}
          </div>
          <button
            ref={(node) => { itemRefs.current[columns.length] = node }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={resetAndClose}
            onKeyDown={(event) => onItemKeyDown(event, resetAndClose)}
            className="mt-1 w-full [@media(pointer:coarse)]:min-h-[44px] rounded-lg border-t border-gray-100 px-2 py-1.5 text-left text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {resetLabel}
          </button>
        </div>
      ), document.body) : null}
    </div>
  )
}
