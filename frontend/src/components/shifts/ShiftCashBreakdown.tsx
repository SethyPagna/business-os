import { useApp } from '../../AppContext.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import type { ShiftReconciliation } from '../../api/shiftTransport.ts'

// The eight drawer rows, in the owner's reading order:
//
//   Opening · Cash sales · Refunds · Expenses · Courier · Expected · Counted · Difference
//
// Every figure comes from the server's single reconciliation
// (cloudflare/src/lib/shiftReconciliation.ts). Nothing is recomputed here --
// the Telegram shift report prints these same eight labels for these same
// eight numbers, and a cashier holds one against the other.
//
// Two currencies, side by side and never added together: the shop counts
// dollars and riel as two separate piles, and an exchange rate applied to a
// drawer count would invent money that is not in it.

type Props = {
  reconciliation: ShiftReconciliation | null | undefined
  className?: string
}

const REVIEW_KEYS: Record<string, string> = {
  tender_incomplete: 'shift_review_tender',
  change_ambiguous: 'shift_review_change',
  sale_limit_reached: 'shift_review_limit',
  cash_method_unresolved: 'shift_review_cash_method',
}

export default function ShiftCashBreakdown({ reconciliation, className = '' }: Props) {
  const { t, fmtUSD, fmtKHR } = useApp() as {
    t: (key: string) => string
    fmtUSD: (value: unknown) => string
    fmtKHR: (value: unknown) => string
  }
  if (!reconciliation) return null

  const pair = (usd: number | null, khr: number | null) => usd == null || khr == null
    ? '—'
    : `${fmtUSD(usd)} · ${fmtKHR(khr)}`
  // A shortage and a surplus must be distinguishable at a glance, so the sign
  // is explicit on both currencies rather than implied by a minus that a
  // formatter may drop.
  const signed = (value: number | null, format: (input: unknown) => string) =>
    value == null ? '—' : `${value > 0 ? '+' : ''}${format(value)}`

  const rows: { key: string; label: string; value: string }[] = [
    { key: 'shift_recon_opening', label: t('shift_recon_opening'), value: pair(reconciliation.opening.usd, reconciliation.opening.khr) },
    { key: 'shift_recon_cash_sales', label: t('shift_recon_cash_sales'), value: pair(reconciliation.cash_sales.usd, reconciliation.cash_sales.khr) },
    { key: 'refunds', label: t('refunds'), value: `− ${pair(reconciliation.refunds.usd, reconciliation.refunds.khr)}` },
    { key: 'fees', label: t('fees'), value: `− ${pair(reconciliation.expenses.usd, reconciliation.expenses.khr)}` },
    { key: 'courier', label: t('courier'), value: `− ${pair(reconciliation.courier.usd, reconciliation.courier.khr)}` },
  ]

  return (
    <div className={`min-w-0 ${className}`}>
      <dl className="min-w-0 divide-y divide-gray-100 text-xs dark:divide-zinc-800">
        {rows.map((row) => (
          <div key={row.key} className="flex min-w-0 items-baseline justify-between gap-3 py-1">
            <dt className="shrink-0 text-gray-500 dark:text-gray-400">{row.label}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">{row.value}</dd>
          </div>
        ))}
        <div className="flex min-w-0 items-baseline justify-between gap-3 border-t border-gray-200 py-1 dark:border-zinc-700">
          <dt className="flex shrink-0 items-center gap-1 font-semibold text-gray-700 dark:text-gray-200">
            {t('shift_recon_expected')}
            <InfoHint text={t('shift_difference_hint')} label={t('shift_recon_expected')} />
          </dt>
          <dd className="min-w-0 break-words text-right font-semibold text-gray-900 dark:text-white">
            {pair(reconciliation.expected.usd, reconciliation.expected.khr)}
          </dd>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
          <dt className="shrink-0 text-gray-500 dark:text-gray-400">{t('shift_recon_counted')}</dt>
          <dd className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">
            {pair(reconciliation.counted.usd, reconciliation.counted.khr)}
          </dd>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
          <dt className="shrink-0 font-semibold text-gray-700 dark:text-gray-200">{t('shift_difference')}</dt>
          <dd className={`min-w-0 break-words text-right font-semibold ${
            reconciliation.difference.usd == null || reconciliation.difference.khr == null
              ? 'text-gray-800 dark:text-gray-100'
              : reconciliation.difference.usd < 0 || reconciliation.difference.khr < 0
                ? 'text-red-600 dark:text-red-400'
                : reconciliation.difference.usd > 0 || reconciliation.difference.khr > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-green-700 dark:text-green-400'
          }`}
          >
            {reconciliation.difference.usd == null || reconciliation.difference.khr == null
              ? '—'
              : `${signed(reconciliation.difference.usd, fmtUSD)} · ${signed(reconciliation.difference.khr, fmtKHR)}`}
          </dd>
        </div>
      </dl>
      {reconciliation.needs_review && (
        <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {t('shift_recon_review')}
          {reconciliation.review_codes.length > 0 && (
            <> · {reconciliation.review_codes.map((code) => t(REVIEW_KEYS[code] || 'shift_recon_review')).join(' · ')}</>
          )}
        </p>
      )}
    </div>
  )
}
