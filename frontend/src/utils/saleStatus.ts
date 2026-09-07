// The sale-status vocabulary: ONE list of the statuses a sale can hold, ONE
// label per status, ONE tone per status.
//
// This used to live inside components/sales/StatusBadge.tsx. It moved here
// because two consumers cannot both be right otherwise: StatusBadge renders
// JSX, so a plain `node tests/*.test.ts` run cannot import it (node strips
// types from .ts but refuses .tsx), and the Dashboard's own status chip
// therefore grew a SECOND, divergent mapping -- one that had no
// `awaiting_payment` arm at all and printed a credit sale as a green
// "Completed". A pure module is importable by both the .tsx component and the
// test, so the divergence cannot come back.
//
// StatusBadge.tsx re-exports every name below, so existing importers are
// unaffected.

export type SaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery' | 'cancelled' | 'partial_return' | 'returned'
export type TranslateFn = (key: string) => string

export const STATUS_COLORS: Record<SaleStatus, string> = {
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  awaiting_payment: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  awaiting_delivery: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  partial_return: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  returned: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
}

// English fallbacks, used only when the pack has no value for the key below.
// `awaiting_payment` is "Credit" -- the owner's one word for the cohort.
export const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'Completed',
  awaiting_payment: 'Credit',
  awaiting_delivery: 'Awaiting Delivery',
  cancelled: 'Cancelled',
  partial_return: 'Partial Return',
  returned: 'Returned',
}

export const STATUS_LABEL_KEYS: Record<SaleStatus, string> = {
  completed: 'status_completed',
  awaiting_payment: 'status_awaiting_payment',
  awaiting_delivery: 'status_awaiting_delivery',
  cancelled: 'status_cancelled',
  partial_return: 'status_partial_return',
  returned: 'status_returned',
}

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as SaleStatus[]

export function isSaleStatus(value: unknown): value is SaleStatus {
  return typeof value === 'string' && value in STATUS_LABELS
}

export function getStatusLabel(status: unknown, t?: TranslateFn) {
  if (isSaleStatus(status) && t) {
    const key = STATUS_LABEL_KEYS[status]
    const translated = t(key)
    if (translated && translated !== key) return translated
  }
  return isSaleStatus(status) ? STATUS_LABELS[status] : String(status || STATUS_LABELS.completed)
}
