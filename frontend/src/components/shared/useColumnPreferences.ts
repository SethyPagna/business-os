// Excel-style column visibility for large-screen data tables (user, Aug 31
// 2026: "excel style columns are good for larger screens, with ability to show
// extra columns ... saves the need to go back and forth multiple pages"). The
// chosen set is remembered PER SURFACE in localStorage, mirroring the export
// column-chooser (utils/exportOptions.ts) -- a separate `bos_table_columns_`
// namespace so an on-screen choice never collides with an export choice. Only
// OPTIONAL columns are modeled; a table's always-present columns stay hardcoded.
import { useCallback, useState } from 'react'
import {
  COLUMN_STORAGE_PREFIX,
  countVisible,
  defaultVisibleColumns,
  parseStoredColumns,
  toggleColumn,
  type TableColumnDef,
} from './columnPreferences.ts'

export type { TableColumnDef } from './columnPreferences.ts'

function readInitial(surfaceKey: string, columns: TableColumnDef[]): Set<string> {
  let stored: Set<string> | null = null
  try {
    stored = parseStoredColumns(localStorage.getItem(COLUMN_STORAGE_PREFIX + surfaceKey), columns)
  } catch {
    stored = null
  }
  return stored ?? defaultVisibleColumns(columns)
}

function persist(surfaceKey: string, visible: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLUMN_STORAGE_PREFIX + surfaceKey, JSON.stringify([...visible]))
  } catch { /* storage blocked/full -- the table still renders with in-memory state */ }
}

/**
 * `columns` must be stable across renders (a module-level const or a useMemo)
 * so the initial read and callbacks don't churn. Returns the visible-key set
 * plus toggling/reset helpers that also persist per surface.
 */
export function useColumnPreferences(surfaceKey: string, columns: TableColumnDef[]) {
  const [visible, setVisible] = useState<Set<string>>(() => readInitial(surfaceKey, columns))

  const toggle = useCallback((key: string) => {
    setVisible((prev) => {
      const next = toggleColumn(prev, key)
      persist(surfaceKey, next)
      return next
    })
  }, [surfaceKey])

  const reset = useCallback(() => {
    const next = defaultVisibleColumns(columns)
    persist(surfaceKey, next)
    setVisible(next)
    return next
  }, [surfaceKey, columns])

  const isVisible = useCallback((key: string) => visible.has(key), [visible])

  return { visible, isVisible, toggle, reset, visibleCount: countVisible(columns, visible) }
}
