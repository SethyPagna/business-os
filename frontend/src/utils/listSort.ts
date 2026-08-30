// One sort vocabulary for every list page.
//
// The audit behind this (Aug 30 2026): every page hid sorting inside its
// Filters menu, as a direction-only toggle (newest/oldest) — there was no
// "sort BY field" anywhere, nothing showed the active sort, and each page
// wired its own copy. The unified method: each page declares its sortable
// fields in a few lines (id, label, how to read the value, what kind it is),
// a shared chip control (SortChip.tsx) shows the ACTIVE sort and opens the
// field list, and this util does the actual ordering. Tapping the active
// field again flips direction; each kind starts with the direction people
// expect (dates/numbers: newest/biggest first; text: A→Z).

export type SortKind = 'date' | 'number' | 'text'

export type SortField<T> = {
  id: string
  label: string
  kind: SortKind
  get: (row: T) => unknown
}

export type SortSpec = {
  field: string
  direction: 'asc' | 'desc'
}

// The direction a field starts in when first selected.
export function defaultDirectionFor(kind: SortKind): 'asc' | 'desc' {
  return kind === 'text' ? 'asc' : 'desc'
}

// The next spec after tapping `fieldId`: a new field starts at its kind's
// default direction; tapping the active field flips it.
export function nextSortSpec<T>(current: SortSpec, fieldId: string, fields: ReadonlyArray<SortField<T>>): SortSpec {
  const field = fields.find((entry) => entry.id === fieldId)
  const kind: SortKind = field?.kind || 'text'
  if (current.field === fieldId) {
    return { field: fieldId, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { field: fieldId, direction: defaultDirectionFor(kind) }
}

function comparableValue(raw: unknown, kind: SortKind): number | string | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (kind === 'number') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  if (kind === 'date') {
    const value = Date.parse(String(raw))
    return Number.isFinite(value) ? value : null
  }
  return String(raw).trim().toLowerCase()
}

// Stable sort of `rows` by the spec. Rows with a missing value always sink
// to the END regardless of direction — a blank customer name should never
// float to the top of either ordering. Unknown field ids return the input
// order untouched (a persisted spec from a removed field must not throw).
export function sortRecords<T>(rows: readonly T[], spec: SortSpec, fields: ReadonlyArray<SortField<T>>): T[] {
  const field = fields.find((entry) => entry.id === spec.field)
  if (!field) return [...rows]
  const dir = spec.direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: comparableValue(field.get(row), field.kind) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      if (a.value < b.value) return -1 * dir
      if (a.value > b.value) return 1 * dir
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

// Per-page persistence, so a chosen sort survives navigation. localStorage
// can throw (private windows, blocked site data) — both directions are
// guarded, and a bad stored value falls back to the given default.
export function loadSortSpec(storageKey: string, fallback: SortSpec, fields: ReadonlyArray<SortField<unknown>>): SortSpec {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<SortSpec> | null
    const field = String(parsed?.field || '')
    const direction = parsed?.direction === 'asc' ? 'asc' : parsed?.direction === 'desc' ? 'desc' : null
    if (!direction || !fields.some((entry) => entry.id === field)) return fallback
    return { field, direction }
  } catch {
    return fallback
  }
}

export function saveSortSpec(storageKey: string, spec: SortSpec): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(spec))
  } catch {
    /* per-viewer convenience only */
  }
}
