// The large-screen "show extra columns" control (user, Aug 31 2026). A small
// popover of checkboxes, one per OPTIONAL column, driven by useColumnPreferences.
// Callers place it on the table's header row; wrap it in `hidden lg:…` if the
// surface only offers extra columns on large screens (the intended use).
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import type { TableColumnDef } from './columnPreferences.ts'

interface ColumnChooserProps {
  columns: TableColumnDef[]
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

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const frame = window.requestAnimationFrame(updatePosition)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.cancelAnimationFrame(frame)
    }
  }, [open, updatePosition])

  if (!columns.length) return null
  const shownCount = columns.reduce((count, column) => count + (isVisible(column.key) ? 1 : 0), 0)

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen((value) => !value); window.requestAnimationFrame(updatePosition) }}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        title={label}
      >
        <MoreVertical className="h-4 w-4" />
        <span className="sr-only">{label} ({shownCount}/{columns.length})</span>
      </button>
      {open ? createPortal((
        <div
          ref={menuRef}
          className="fixed z-[1200] w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          style={{ left: position.left, top: position.top }}
        >
          <div className="max-h-72 overflow-y-auto">
            {columns.map((column) => {
              const on = isVisible(column.key)
              return (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => toggle(column.key)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
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
            type="button"
            onClick={() => { reset(); setOpen(false) }}
            className="mt-1 w-full rounded-lg border-t border-gray-100 px-2 py-1.5 text-left text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {resetLabel}
          </button>
        </div>
      ), document.body) : null}
    </div>
  )
}
