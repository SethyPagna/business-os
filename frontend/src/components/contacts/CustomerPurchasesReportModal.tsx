import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import DateTimeRangePicker, { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getCustomerSalesReport } from '../../api/salesTransport.ts'

// X4 (Part 395): the customer leg of the per-contact drills -- purchase
// totals for one customer over a range (suppliers: D5 Purchases; couriers:
// X3 Deliveries). Backed by /api/sales/customer-report from the shared
// salesAnalytics kernel. Defaults to a wide range so the first open reads
// as "lifetime with this shop" (sales data starts 2024).

type TranslateFn = (key: string) => string | undefined

interface CustomerSalesTotals {
  tx_count: number
  collected_usd: number
  discount_usd: number
  membership_discount_usd: number
  points_redeemed: number
  first_sale_at: string | null
  last_sale_at: string | null
}

interface CustomerPurchasesReportModalProps {
  customerId: number | string
  customerName: string
  t: TranslateFn
  onClose: () => void
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
}

function money(value: unknown): string {
  return `$${(Number(value) || 0).toFixed(2)}`
}

export default function CustomerPurchasesReportModal({ customerId, customerName, t, onClose }: CustomerPurchasesReportModalProps) {
  const [range, setRange] = useState<DateTimeRange>(() => todayDateTimeRange())
  const [totals, setTotals] = useState<CustomerSalesTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string | number> = {
        customerId: String(customerId),
        startDate: range.startDate,
        endDate: range.endDate,
      }
      if (range.startTime && range.endTime) {
        params.startTime = range.startTime
        params.endTime = range.endTime
        params.tzOffsetMinutes = -new Date().getTimezoneOffset()
      }
      const result = await getCustomerSalesReport(params) as { totals?: CustomerSalesTotals } | null
      if (requestRef.current !== requestId) return
      setTotals(result?.totals || null)
    } catch (err) {
      if (requestRef.current !== requestId) return
      setTotals(null)
      setError(err instanceof Error && err.message ? err.message : tr(t, 'daily_report_failed', 'Could not load this report.'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [customerId, range, t])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: string, hint?: string) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div> : null}
    </div>
  )

  return (
    <Modal title={`${tr(t, 'customer_purchases', 'Purchases')} -- ${customerName}`} onClose={onClose}>
      <div className="space-y-3">
        <DateTimeRangePicker
          value={range}
          onChange={setRange}
          t={t}
          triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2"
        />

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {error}
            <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{tr(t, 'try_again', 'Try again')}</button>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((cell) => <div key={cell} className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : !totals || totals.tx_count === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            {tr(t, 'no_purchases_in_range', 'No purchases in the selected range.')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {stat(
              tr(t, 'customer_purchases', 'Purchases'),
              String(totals.tx_count),
              totals.first_sale_at && totals.last_sale_at
                ? `${String(totals.first_sale_at).slice(0, 10)} → ${String(totals.last_sale_at).slice(0, 10)}`
                : undefined,
            )}
            {stat(tr(t, 'collected_total', 'Collected total'), money(totals.collected_usd), tr(t, 'incl_delivery_paid', 'incl. delivery they paid'))}
            {stat(tr(t, 'store_discount', 'Store discounts'), money(totals.discount_usd))}
            {stat(
              tr(t, 'membership_discount', 'Membership'),
              money(totals.membership_discount_usd),
              totals.points_redeemed > 0 ? `${totals.points_redeemed} ${tr(t, 'points_redeemed', 'points redeemed')}` : undefined,
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
