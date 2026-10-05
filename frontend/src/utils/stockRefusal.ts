// RET-D (owner, 5 Oct 2026): "Stock changes: when Revert is not allowed, say
// concisely WHY and WHERE (destination), with an in-built link."
// TRANSITION-MATRIX-AUDIT.md section 2.4.
//
// The Worker names the record that blocked a stock Revert / Undo / line edit
// (cloudflare/src/lib/stockRefusalBlocker.ts) beside its usual error/code:
//
//   reason       'consumed' | 'superseded'
//   blocker      { kind, movement_id, label, qty, count, branch, ... }
//   destination  { kind: 'movement', movement_id }
//
// This module turns that into ONE sentence in the reader's language and a
// destination the app can open (the blocking stock record in Stock Changes,
// whose detail names its sale / return receipt). The Worker's English is
// never shown for it. Pure apart from the focus hand-off at the bottom.

export type StockBlockerKind = 'sale' | 'return' | 'transfer' | 'stock_in_edit' | 'stock_change'

export type StockRefusalInfo = {
  /** WHY, one sentence without a trailing full stop. */
  why: string
  /** WHERE: the stock record to open. */
  movementId: number
  linkLabel: string
}

type Tr = (key: string, fallback: string) => string

const KINDS = new Set<StockBlockerKind>(['sale', 'return', 'transfer', 'stock_in_edit', 'stock_change'])

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}

function quantity(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(Math.abs(n) * 10000) / 10000)
}

/** The blocker a refusal names, or null when it names none (older Worker, metadata-only change). */
export function stockRefusalInfo(error: unknown, tr: Tr): StockRefusalInfo | null {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const blocker = source.blocker && typeof source.blocker === 'object' ? source.blocker as Record<string, unknown> : null
  const destination = source.destination && typeof source.destination === 'object' ? source.destination as Record<string, unknown> : null
  if (!blocker) return null
  const movementId = Number(destination?.movement_id ?? blocker.movement_id)
  if (!Number.isSafeInteger(movementId) || movementId <= 0) return null
  const kind = KINDS.has(blocker.kind as StockBlockerKind) ? blocker.kind as StockBlockerKind : 'stock_change'
  const label = String(blocker.label ?? '').trim()
  const branch = String(blocker.branch ?? '').trim()
  const values = { label, qty: quantity(blocker.qty), branch }
  let why: string
  if (source.reason === 'superseded') {
    why = kind === 'stock_in_edit'
      ? tr('stock_refusal_later_edit', 'This line was edited again later')
      : tr('stock_refusal_later_change', 'A later stock change came after this one')
  } else if (kind === 'sale') {
    why = label
      ? fill(tr('stock_refusal_sale', 'Sale {label} used {qty} of these units'), values)
      : fill(tr('stock_refusal_sale_unlabelled', 'A sale used {qty} of these units'), values)
  } else if (kind === 'return' && label) {
    why = fill(tr('stock_refusal_return', 'Return {label} used {qty} of these units'), values)
  } else if (kind === 'transfer') {
    why = fill(branch
      ? tr('stock_refusal_transfer', 'A transfer moved {qty} of these units out of {branch}')
      : tr('stock_refusal_transfer_unnamed', 'A transfer moved {qty} of these units out'), values)
  } else {
    why = fill(tr('stock_refusal_change', 'A stock change took {qty} of these units'), values)
  }
  const count = Number(blocker.count)
  if (Number.isSafeInteger(count) && count > 1) why = `${why} ${fill(tr('stock_refusal_more', '(+{count} more)'), { count: count - 1 })}`
  return { why, movementId, linkLabel: tr('stock_refusal_open', 'Open record') }
}

// ---- WHERE: opening the blocking record from another section.
// Stock Changes consumes this on mount and on the event, then opens the row
// through its own ledger kernel (StockChangeSection openMovementById).
export const STOCK_RECORD_FOCUS_KEY = 'bos:stock-changes:focus'
export const STOCK_RECORD_FOCUS_EVENT = 'bos:stock-record-focus'
export const STOCK_CHANGES_ANCHOR = 'hub:products:stock_changes'
// ...and the stock-in line a correction row belongs to, opened in Stock-in
// Sessions (StockInSessionsSection), where the line is edited again.
export const STOCK_IN_LINE_FOCUS_KEY = 'bos:stock-in-sessions:focus'
export const STOCK_IN_LINE_FOCUS_EVENT = 'bos:stock-in-line-focus'
export const STOCK_IN_SESSIONS_ANCHOR = 'hub:products:stock_in_sessions'

function queueFocus(key: string, event: string, movementId: number): void {
  if (typeof window === 'undefined' || !(movementId > 0)) return
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ movementId }))
  } catch {
    // Storage blocked: the navigation still lands on the section.
  }
  window.dispatchEvent(new CustomEvent(event))
}

function takeFocus(key: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    window.sessionStorage.removeItem(key)
    const id = Number((JSON.parse(raw) as { movementId?: unknown })?.movementId)
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

export function queueStockRecordFocus(movementId: number): void { queueFocus(STOCK_RECORD_FOCUS_KEY, STOCK_RECORD_FOCUS_EVENT, movementId) }
/** The queued movement id, consumed once; null when none (or storage is unusable). */
export function takeStockRecordFocus(): number | null { return takeFocus(STOCK_RECORD_FOCUS_KEY) }
export function queueStockInLineFocus(movementId: number): void { queueFocus(STOCK_IN_LINE_FOCUS_KEY, STOCK_IN_LINE_FOCUS_EVENT, movementId) }
export function takeStockInLineFocus(): number | null { return takeFocus(STOCK_IN_LINE_FOCUS_KEY) }

/**
 * The stock-in line (its receipt movement id) a correction row belongs to:
 * `stock-in-edit:<line>:<operation>:<generation>`. null for any other row.
 */
export function stockInCorrectionLineId(referenceId: unknown): number | null {
  const match = /^stock-in-edit:(\d+):/.exec(String(referenceId ?? ''))
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The stock-in session key a receipt row opens, or null for a legacy (unkeyed) receipt. */
export function stockInSessionKeyForReceipt(referenceId: unknown): string | null {
  const reference = String(referenceId ?? '').trim()
  return reference && !reference.startsWith('revert:') && !reference.startsWith('stock-in-edit:') ? `session:${reference}` : null
}
