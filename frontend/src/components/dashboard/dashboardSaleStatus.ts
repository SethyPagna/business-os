export type DashboardSaleStatus =
  | 'completed'
  | 'awaiting_payment'
  | 'awaiting_delivery'
  | 'cancelled'
  | 'partial_return'
  | 'returned'

type TranslateFn = (key: string) => string

const STATUS_LABELS: Record<DashboardSaleStatus, { key: string; fallback: string }> = {
  completed: { key: 'status_completed', fallback: 'Completed' },
  awaiting_payment: { key: 'status_awaiting_payment', fallback: 'Awaiting Payment' },
  awaiting_delivery: { key: 'status_awaiting_delivery', fallback: 'Awaiting Delivery' },
  cancelled: { key: 'status_cancelled', fallback: 'Cancelled' },
  partial_return: { key: 'status_partial_return', fallback: 'Partial Return' },
  returned: { key: 'status_returned', fallback: 'Returned' },
}

const STATUS_TONES: Record<DashboardSaleStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  awaiting_payment: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  awaiting_delivery: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  partial_return: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  returned: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

export function normalizeDashboardSaleStatus(value: unknown): DashboardSaleStatus {
  const status = String(value ?? '').trim().toLowerCase()
  if (status === 'pending' || status === 'draft') return 'awaiting_payment'
  if (status === 'refunded') return 'returned'
  return status in STATUS_LABELS ? status as DashboardSaleStatus : 'completed'
}

export function getDashboardSaleStatusLabel(status: unknown, t?: TranslateFn): string {
  const normalized = normalizeDashboardSaleStatus(status)
  const entry = STATUS_LABELS[normalized]
  const translated = t?.(entry.key)
  return translated && translated !== entry.key ? translated : entry.fallback
}

export function getDashboardSaleStatusTone(status: unknown): string {
  return STATUS_TONES[normalizeDashboardSaleStatus(status)]
}
