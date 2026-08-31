// The large-screen "show extra columns" control (user, Aug 31 2026). A small
// popover of checkboxes, one per OPTIONAL column, driven by useColumnPreferences.
// Callers place it on the table's header row; wrap it in `hidden lg:…` if the
// surface only offers extra columns on large screens (the intended use).
import { useEffect, useRef, useState } from 'react'
import Columns from 'lucide-react/dist/esm/icons/columns-3.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import type { TableColumnDef } from './columnPreferences.ts'

interface ColumnChooserProps {
  columns: TableColumnDef[]
  isVisible: (key: string) => boolean
  toggle: (key: string) => void
  reset: () => void
  /** Button label; defaults to "Columns". */
  label?: string
  resetLabel?: string
  className?: string
}

export default function ColumnChooser({ columns, isVisible, toggle, reset, label = 'Columns', resetLabel = 'Reset', className = '' }: ColumnChooserProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!columns.length) return null
  const shownCount = columns.reduce((count, column) => count + (isVisible(column.key) ? 1 : 0), 0)

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        title={label}
      >
        <Columns className="h-3.5 w-3.5" />
        <span>{label}</span>
        <span className="rounded bg-gray-100 px-1 text-[10px] tabular-nums text-gray-500 dark:bg-gray-700 dark:text-gray-400">{shownCount}/{columns.length}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
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
      ) : null}
    </div>
  )
}
