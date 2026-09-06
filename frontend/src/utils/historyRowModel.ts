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
  // N13: the record the row belongs to, resolved server-side
  // (cloudflare/src/lib/movementReference.ts). The Worker decides WHICH
  // record a reference_id names -- the same id can be a sales.id or a
  // returns.id depending on the movement type -- so this layer only
  // formats what it is given and never re-derives it.
  reference_kind?: unknown
  reference_label?: unknown
}

/** Which record a movement row names, and how that record is called. */
export type HistoryReference = {
  kind: 'sale' | 'return' | null
  /** The receipt as the app names it, or '' when the row names no record. */
  label: string
}

export type HistoryRowModel = {
  branch: string
  actor: string
  reason: string
  barcode: string
  reference: HistoryReference
  /** True when the row carries none of branch / actor / reason. */
  isBare: boolean
}

/**
 * The record a movement row belongs to. A kind with no label is not a
 * reference: the receipt is what identifies the record to a person, and a
 * bare "Sale" says nothing the Type column has not already said.
 */
export function historyReference(row: HistoryRowSource | null | undefined): HistoryReference {
  const label = text(row?.reference_label)
  if (!label) return { kind: null, label: '' }
  const kind = text(row?.reference_kind)
  return { kind: kind === 'sale' || kind === 'return' ? kind : null, label }
}

/**
 * The ONE composition of a reference for display -- "Sale 20260901-193100",
 * "Return RET-20260902-0007", or the bare receipt when the kind is unknown.
 * Callers pass their own translated words so the table, the card, the detail
 * modal and the CSV cannot word it three different ways.
 */
export function formatHistoryReference(reference: HistoryReference, words: { sale: string; return: string }): string {
  if (!reference.label) return ''
  if (reference.kind === 'sale') return `${words.sale} ${reference.label}`
  if (reference.kind === 'return') return `${words.return} ${reference.label}`
  return reference.label
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
  const reference = historyReference(row)
  return {
    branch,
    actor,
    reason,
    barcode,
    reference,
    // A row that names its receipt is never bare, whatever else is missing:
    // the receipt is the fact that makes a sale row identifiable.
    isBare: branch === HISTORY_EMPTY && actor === HISTORY_EMPTY && reason === HISTORY_EMPTY && !reference.label,
  }
}

/**
 * The record a GROUP of movement rows names.
 *
 * The Inventory drill collapses one action into a single row and the CSV
 * exports that same group, so both must answer "which record is this" the same
 * way, and both must read across the WHOLE group rather than its visible page:
 * an ambiguous movement type is resolved per product server-side
 * (cloudflare/src/lib/movementReference.ts), so a group whose first row is a
 * product the receipt does not contain still belongs to that receipt, and the
 * row that names it can be on page 2.
 *
 * Defined here rather than inline at each reader because two copies of "which
 * row of the group names the record" are two rules: the drill header and the
 * export column would be free to pick different rows of the same group.
 */
export function historyGroupReference(
  items: ReadonlyArray<HistoryRowSource | null | undefined> | null | undefined,
): HistoryReference {
  if (!Array.isArray(items)) return { kind: null, label: '' }
  return items.map(historyReference).find((entry) => entry.label) || { kind: null, label: '' }
}
