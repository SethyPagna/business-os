// What the one status icon of an Inventory Check row says. Pure: the row draws the icon, this decides which one and what its tooltip reads.
//
// The icon is the row's whole status (the owner, 14 Nov: "just use the icon: dot circle grey, green check icon, and others"). It shows what was RECORDED by the last count
// (not checked, in check, checked OK, issue) unless the count waits for an approver (pending), and while a person has typed or ticked something that is not submitted yet it shows
// what that draft will be (matches stock, differs from stock, still needs a count). Nothing is ticked by default: a row with no draft shows its recorded status only.
import type { InventoryCheckListStatus } from '../../types/inventoryChecks.ts'
import { lotTotals, type LotDraft } from './inventoryCheckLots.ts'

export type RowStatusKind = InventoryCheckListStatus | 'pending' | 'draft_ok' | 'draft_issue' | 'draft_empty' | 'draft_counted'

/** The tooltip and aria-label of every kind, as translation keys with their English fallbacks. */
export const ROW_STATUS_WORDS: Record<RowStatusKind, { key: string; fallback: string }> = {
  not_checked: { key: 'inventory_check_status_not_checked', fallback: 'Not checked' },
  in_check: { key: 'inventory_check_status_in_check', fallback: 'In check' },
  ok: { key: 'inventory_check_status_ok', fallback: 'Checked OK' },
  issue: { key: 'inventory_check_issue', fallback: 'Issue' },
  pending: { key: 'inventory_check_approval_pending', fallback: 'Waiting for approval' },
  draft_ok: { key: 'inventory_check_status_draft_ok', fallback: 'Matches stock · not submitted yet' },
  draft_issue: { key: 'inventory_check_status_draft_issue', fallback: 'Differs from stock · not submitted yet' },
  draft_empty: { key: 'inventory_check_status_draft_empty', fallback: 'Enter the count · not submitted yet' },
  draft_counted: { key: 'inventory_check_status_draft_counted', fallback: 'Counted · not submitted yet' },
}

const RECORDED: ReadonlySet<string> = new Set(['not_checked', 'in_check', 'ok', 'issue'])
export const recordedStatus = (value: unknown): InventoryCheckListStatus | null => typeof value === 'string' && RECORDED.has(value) ? value as InventoryCheckListStatus : null

export type RowStatusInput = {
  recorded: unknown
  /** A count of this product waits for an approver (ic_fix_stock). */
  pending?: boolean
  /** The viewer's own unsubmitted entry for the row, or undefined when there is none. */
  draft?: { selected: boolean; count: string; lots?: LotDraft } | undefined
  /** The stock the draft is compared with: undefined when the viewer may not see it (nothing to compare). */
  stock?: number | null
}

const COUNT_EPSILON = 1e-9

/** The kind of icon one row wears, or null when the row has no status to show (a family header, or no branch chosen). A draft wins over the recorded status; a pending approval wins over the recorded one. */
export function rowStatusKind({ recorded, pending, draft, stock }: RowStatusInput): RowStatusKind | null {
  if (draft?.selected) {
    const dated = lotTotals(draft.lots)
    const text = draft.count.trim()
    const counted = dated.dates > 0 ? (dated.valid ? dated.counted : null) : text === '' ? null : /^\d*(?:\.\d*)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null
    if (counted === null) return 'draft_empty'
    const baseline = dated.dates > 0 ? dated.seen : stock
    if (typeof baseline !== 'number' || !Number.isFinite(baseline)) return 'draft_counted'
    return Math.abs(counted - baseline) <= COUNT_EPSILON ? 'draft_ok' : 'draft_issue'
  }
  if (pending === true) return 'pending'
  return recordedStatus(recorded)
}

/** A draft kind (not submitted yet) rather than a recorded one. */
export const isDraftKind = (kind: RowStatusKind): boolean => kind.startsWith('draft_')
