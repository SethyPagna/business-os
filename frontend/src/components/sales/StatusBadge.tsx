type SaleStatus = 'completed' | 'awaiting_payment' | 'awaiting_delivery' | 'cancelled' | 'partial_return' | 'returned'
type TranslateFn = (key: string) => string

export const STATUS_COLORS: Record<SaleStatus, string> = {
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  awaiting_payment: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  awaiting_delivery: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  partial_return: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  returned: 'bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100',
}

export const STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'Completed',
  awaiting_payment: 'Not Paid',
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

// Translation strings retain their existing symbols for non-badge contexts.
// The compact badge carries the status in text and color, so it omits those
// decorative prefixes without changing status values or translation keys.
const STATUS_DECORATION_PREFIX = /^[⏳🚚↩️\s]+/u

export function getStatusBadgeLabel(status: unknown, t?: TranslateFn) {
  return getStatusLabel(status, t).replace(STATUS_DECORATION_PREFIX, '').trim()
}

type StatusBadgeProps = {
  status?: unknown
  t?: TranslateFn
}

type DebtLoweredTagProps = {
  /** GET /api/sales `return_owed_reduction_usd`: what returns took off a Not Paid debt. */
  amountUsd?: unknown
  fmtUSD: (value: number) => string
  t?: TranslateFn
}

/**
 * Owner rule 29 Sep 2026, confirmed 5 Oct: a return on a Not Paid sale lowers
 * the debt instead of paying cash out, and the sale says so beside its status.
 */
export function DebtLoweredTag({ amountUsd, fmtUSD, t }: DebtLoweredTagProps) {
  const amount = Number(amountUsd)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const key = 'sale_tag_debt_lowered'
  const translated = t?.(key)
  const template = translated && translated !== key ? translated : 'Returned · debt lowered {amount}'
  return (
    <span data-sale-debt-lowered-tag="" className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
      {template.replace('{amount}', fmtUSD(amount))}
    </span>
  )
}

export default function StatusBadge({ status, t }: StatusBadgeProps) {
  const s = isSaleStatus(status) ? status : 'completed'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {getStatusBadgeLabel(s, t)}
    </span>
  )
}
