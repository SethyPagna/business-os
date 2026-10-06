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

/**
 * Column keys that were RENAMED, old -> new. A remembered choice naming the old
 * key carries over to the new one on a surface that has the new key and not
 * the old, so a rename never silently hides a column the user turned on.
 *   pending_revenue_usd -> pending_owed_usd: the reports' "Not Paid" column
 *   became the balance due (owner ruling 6 Oct 2026, RET-A; verify R3).
 */
export const RENAMED_COLUMN_KEYS: Readonly<Record<string, string>> = Object.freeze({
  pending_revenue_usd: 'pending_owed_usd',
})

// A remembered set naming columns that no longer exist is silently intersected
// away (after RENAMED_COLUMN_KEYS); an empty remembered array is a legitimate
// "hide every optional column" and is honored (so `null` means "nothing
// stored", not "stored empty").
export function parseStoredColumns(raw: string | null, columns: TableColumnDef[], renames: Readonly<Record<string, string>> = RENAMED_COLUMN_KEYS): Set<string> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = new Set(columns.map((column) => column.key))
    const out = new Set<string>()
    for (const key of parsed) {
      if (typeof key !== 'string') continue
      if (valid.has(key)) out.add(key)
      else if (Object.hasOwn(renames, key) && valid.has(renames[key])) out.add(renames[key])
    }
    return out
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
