type SaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery' | 'cancelled' | 'partial_return' | 'returned'
type TranslateFn = (key: string) => string

export const STATUS_COLORS: Record<SaleStatus, string> = {
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  awaiting_payment: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  awaiting_delivery: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  partial_return: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  returned: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
}

export const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'Completed',
  awaiting_payment: 'Awaiting Payment',
  awaiting_delivery: 'Awaiting Delivery',
  cancelled: 'Cancelled',
  partial_return: 'Partial Return',
  returned: 'Returned',
}

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as SaleStatus[]

function isSaleStatus(value: unknown): value is SaleStatus {
  return typeof value === 'string' && value in STATUS_LABELS
}

export function getStatusLabel(status: unknown, t?: TranslateFn) {
  const keys: Record<SaleStatus, string> = {
    completed: 'status_completed',
    awaiting_payment: 'status_awaiting_payment',
    awaiting_delivery: 'status_awaiting_delivery',
    cancelled: 'status_cancelled',
    partial_return: 'status_partial_return',
    returned: 'status_returned',
  }
  if (isSaleStatus(status) && t) {
    const key = keys[status]
    const translated = t(key)
    if (translated && translated !== key) return translated
  }
  return isSaleStatus(status) ? STATUS_LABELS[status] : String(status || STATUS_LABELS.completed)
}

type StatusBadgeProps = {
  status?: unknown
  t?: TranslateFn
}

export default function StatusBadge({ status, t }: StatusBadgeProps) {
  const s = isSaleStatus(status) ? status : 'completed'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {getStatusLabel(s, t)}
    </span>
  )
}
