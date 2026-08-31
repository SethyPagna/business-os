// Pure, React-free column-visibility helpers behind useColumnPreferences /
// ColumnChooser. Kept separate so they are unit-testable in plain node
// (tests/columnPreferences.test.ts), the same split exportOptions.ts uses.

export interface TableColumnDef {
  key: string
  label: string
  /** false = hidden until the user turns it on. Defaults to true (shown). */
  defaultVisible?: boolean
}

export const COLUMN_STORAGE_PREFIX = 'bos_table_columns_'

export function defaultVisibleColumns(columns: TableColumnDef[]): Set<string> {
  return new Set(columns.filter((column) => column.defaultVisible !== false).map((column) => column.key))
}

// A remembered set naming columns that no longer exist is silently intersected
// away; an empty remembered array is a legitimate "hide every optional column"
// and is honored (so `null` means "nothing stored", not "stored empty").
export function parseStoredColumns(raw: string | null, columns: TableColumnDef[]): Set<string> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = new Set(columns.map((column) => column.key))
    return new Set(parsed.filter((key): key is string => typeof key === 'string' && valid.has(key)))
  } catch {
    return null
  }
}

export function toggleColumn(visible: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(visible)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function countVisible(columns: TableColumnDef[], visible: ReadonlySet<string>): number {
  return columns.reduce((count, column) => count + (visible.has(column.key) ? 1 : 0), 0)
}
