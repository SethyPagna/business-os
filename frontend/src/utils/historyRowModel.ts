// N13 -- ONE row model for every history / ledger surface.
//
// Stock Change, the Inventory movement drill, Transfer History, write-offs and
// the Audit Log all answer the same three questions about a recorded action --
// WHERE it happened (branch), WHO did it (the account username) and WHY
// (reason) -- and before this module each of them answered them differently:
// the Stock Change table printed '—' for a missing value, its detail footer
// printed '--', its mobile card and the Inventory drill printed nothing at all
// (the span was conditionally dropped, so a blank branch looked like a layout
// bug rather than an absent fact), and the Audit Log printed '--'.
//
// Two rules, enforced here rather than at ~20 JSX sites:
//
//   1. An absent value renders as ONE placeholder, HISTORY_EMPTY, everywhere.
//      A row with no branch says so; it never silently loses the column.
//   2. A present value renders EXACTLY as the server stored it. There is no
//      client-side fallback to the signed-in user's own name, and no second
//      identity to fall back to -- the Worker resolves the actor snapshot to
//      the account username server-side (cloudflare/src/lib/actorSnapshot.ts),
//      so anything this layer substituted would be a different, unverifiable
//      answer to "who did this".
//
// Deliberately NOT a React component: these are the values a table cell, a
// mobile card, a detail row and a CSV column all need, and they must agree.

export const HISTORY_EMPTY = '—'

// The empty marker used inside a CSV export, where a dash would be read as
// data. Exports write a truly empty cell instead.
export const HISTORY_EMPTY_EXPORT = ''

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return typeof value === 'string' ? value.trim() : ''
}

/** A history field for display: the stored value, or the one shared placeholder. */
export function historyField(value: unknown): string {
  return text(value) || HISTORY_EMPTY
}

/**
 * The acting account for display. Same shape as historyField -- named
 * separately because it is the field with a rule attached: it is the account
 * USERNAME as stored by the server, never re-derived here.
 */
export function historyActor(value: unknown): string {
  return historyField(value)
}

/** A history field for an export: the stored value, or an empty cell. */
export function historyExportField(value: unknown): string {
  return text(value) || HISTORY_EMPTY_EXPORT
}

export type HistoryRowSource = {
  branch_name?: unknown
  user_name?: unknown
  reason?: unknown
  barcode?: unknown
}

export type HistoryRowModel = {
  branch: string
  actor: string
  reason: string
  barcode: string
  /** True when the row carries none of branch / actor / reason. */
  isBare: boolean
}

/**
 * The shared row model. One call per rendered row, on every surface, so the
 * table, the card, the detail view and the export cannot disagree.
 */
export function buildHistoryRowModel(row: HistoryRowSource | null | undefined): HistoryRowModel {
  const branch = historyField(row?.branch_name)
  const actor = historyActor(row?.user_name)
  const reason = historyField(row?.reason)
  const barcode = historyField(row?.barcode)
  return {
    branch,
    actor,
    reason,
    barcode,
    isBare: branch === HISTORY_EMPTY && actor === HISTORY_EMPTY && reason === HISTORY_EMPTY,
  }
}
