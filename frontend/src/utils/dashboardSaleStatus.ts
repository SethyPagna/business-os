// The Dashboard's Recent Sales chip, its View-more list and its recent-sale
// detail row all print a sale status. They used to run through a private
// three-arm mapping inside Dashboard.tsx:
//
//     refunded | returned -> "Refunded"   (amber)
//     pending  | draft    -> "Pending"    (slate)
//     everything else     -> "Completed"  (emerald)
//
// `awaiting_payment` is not in the first two arms, so a credit sale fell into
// "everything else" and the Dashboard announced it as a green "Completed" --
// the one status the owner asked to be visible as Credit. compat.ts spreads
// the raw sale row into the dashboard payload, so `sale_status` really is on
// the wire and really was 'awaiting_payment'.
//
// Root cause: two implementations of one rule. Known statuses now go through
// the shared vocabulary (utils/saleStatus.ts, which StatusBadge renders too),
// so the Dashboard chip and the Sales-list badge cannot disagree again. The
// three legacy arms survive ONLY for values the vocabulary does not know
// ('refunded' and 'draft' are legacy row values with no SaleStatus member).
import { getStatusLabel, isSaleStatus, STATUS_COLORS, type TranslateFn } from './saleStatus.ts'

const LEGACY_TONES = {
  refunded: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
} as const

function translateOr(t: TranslateFn | undefined, key: string, fallback: string): string {
  const value = t ? t(key) : ''
  return value && value !== key ? value : fallback
}

/**
 * Label for a dashboard status chip. Known SaleStatus values resolve through
 * the shared vocabulary, so 'awaiting_payment' reads the pack's
 * `status_awaiting_payment` ("Credit" / "ឥណទាន") and never "Completed".
 */
export function dashboardSaleStatusLabel(status: unknown, t?: TranslateFn): string {
  if (isSaleStatus(status)) return getStatusLabel(status, t)
  const key = String(status || '').toLowerCase()
  if (key === 'refunded') return translateOr(t, 'refunded', 'Refunded')
  if (key === 'pending' || key === 'draft') return translateOr(t, 'pending', 'Pending')
  return translateOr(t, 'completed', 'Completed')
}

/** Tone for the same chip, from the same vocabulary: credit is yellow. */
export function dashboardSaleStatusTone(status: unknown): string {
  if (isSaleStatus(status)) return STATUS_COLORS[status]
  const key = String(status || '').toLowerCase()
  if (key === 'refunded') return LEGACY_TONES.refunded
  if (key === 'pending' || key === 'draft') return LEGACY_TONES.pending
  return LEGACY_TONES.completed
}
