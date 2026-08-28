import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import DateTimeRangePicker, { EMPTY_DATE_TIME_RANGE, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getSalesDailyReport, getSalesDayReport } from '../../api/salesTransport.ts'

// X2 (Part 395): the Sales "by day" report -- a range-scoped list of days,
// each expanding into its full breakdown (payment methods, delivery incl.
// per-courier, discounts). Every figure comes from the shared salesAnalytics
// kernel via /daily-report and /day-report, so this page can never disagree
// with the Dashboard (single-source rule). USD-centric like the kernel.

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

interface DayRow {
  date: string
  tx_count: number
  revenue_usd: number
  discount_usd: number
  tax_usd: number
  delivery_usd: number
  cost_usd: number
  profit_usd: number
}

interface DayReport {
  date: string
  totals: {
    tx_count: number
    gross_sales_usd: number
    discount_usd: number
    tax_usd: number
    delivery_usd: number
    store_delivery_usd: number
    delivery_actual_cost_usd: number
    delivery_actual_cost_count: number
    delivery_sale_count: number
    delivery_margin_usd: number
    revenue_usd: number
    collected_total_usd: number
    profit_usd: number
    avg_order_usd: number
  }
  payment_methods: Array<{ payment_method: string; tx_count: number; collected_usd: number; total_usd: number }>
  delivery_contacts: Array<{
    delivery_contact_id: number | null
    delivery_contact_name: string
    deliveries: number
    charged_fee_usd: number
    absorbed_fee_usd: number
    actual_cost_usd: number
    actual_cost_count: number
    margin_usd: number
  }>
  discounts: { store_usd: number; membership_usd: number; store_tx_count: number; membership_tx_count: number }
}

interface SalesDailyReportProps {
  t: TranslateFn
  fmtUSD: MoneyFormatter
  active?: boolean
}

function monthStartIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function displayDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  // Weekday from UTC-noon so no timezone can shift the day.
  const weekday = new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${m[2]}/${m[3]}/${m[1]}`
}

// JS reports minutes WEST of UTC; the kernel wants minutes EAST.
function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

function timeParams(range: DateTimeRange): Record<string, string | number> {
  if (!range.startTime || !range.endTime) return {}
  return { startTime: range.startTime, endTime: range.endTime, tzOffsetMinutes: localTzOffsetMinutes() }
}

export default function SalesDailyReport({ t, fmtUSD, active = true }: SalesDailyReportProps) {
  const [range, setRange] = useState<DateTimeRange>(() => ({
    ...EMPTY_DATE_TIME_RANGE,
    startDate: monthStartIso(),
    endDate: todayIso(),
  }))
  const [days, setDays] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [dayReport, setDayReport] = useState<DayReport | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const result = await getSalesDailyReport({
        startDate: range.startDate,
        endDate: range.endDate,
        ...timeParams(range),
      }) as { days?: DayRow[] } | null
      if (requestRef.current !== requestId) return
      setDays(Array.isArray(result?.days) ? result.days : [])
    } catch (err) {
      if (requestRef.current !== requestId) return
      setDays([])
      setError(err instanceof Error && err.message ? err.message : (t('daily_report_failed') || 'Could not load the daily report.'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [range, t])

  useEffect(() => {
    if (!active) return
    // A range or time change invalidates the expanded day too.
    setExpandedDate(null)
    setDayReport(null)
    load()
  }, [active, load])

  const openDay = useCallback(async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null)
      setDayReport(null)
      return
    }
    setExpandedDate(date)
    setDayReport(null)
    setDayError('')
    setDayLoading(true)
    try {
      const report = await getSalesDayReport({ date, ...timeParams(range) }) as DayReport | null
      setDayReport(report && report.date === date ? report : null)
    } catch (err) {
      setDayError(err instanceof Error && err.message ? err.message : (t('daily_report_failed') || 'Could not load this day.'))
    } finally {
      setDayLoading(false)
    }
  }, [expandedDate, range, t])

  const rangeTotals = useMemo(() => days.reduce((acc, day) => ({
    tx: acc.tx + (day.tx_count || 0),
    revenue: acc.revenue + (day.revenue_usd || 0),
    discounts: acc.discounts + (day.discount_usd || 0),
    delivery: acc.delivery + (day.delivery_usd || 0),
    profit: acc.profit + (day.profit_usd || 0),
  }), { tx: 0, revenue: 0, discounts: 0, delivery: 0, profit: 0 }), [days])

  // Newest first -- the day someone is looking for is almost always recent.
  const orderedDays = useMemo(() => [...days].sort((a, b) => (a.date < b.date ? 1 : -1)), [days])

  const statChip = (label: string, value: string, tone = '') => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${tone || 'text-slate-900 dark:text-white'}`}>{value}</div>
    </div>
  )

  const renderDayDetail = (report: DayReport) => (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {statChip(t('collected_total') || 'Collected', fmtUSD(report.totals.collected_total_usd))}
        {statChip(t('revenue') || 'Revenue', fmtUSD(report.totals.revenue_usd))}
        {statChip(t('profit') || 'Profit', fmtUSD(report.totals.profit_usd), report.totals.profit_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}
        {statChip(t('sales') || 'Sales', String(report.totals.tx_count))}
        {statChip(t('avg_order') || 'Avg order', fmtUSD(report.totals.avg_order_usd))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Payment methods */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{t('payment_methods') || 'Payment methods'}</div>
          {report.payment_methods.length === 0 ? (
            <div className="text-xs text-slate-400">{t('no_data') || 'No data'}</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {report.payment_methods.map((method) => (
                  <tr key={method.payment_method} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{method.payment_method}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-400">×{method.tx_count}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(method.collected_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Discounts */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{t('discounts') || 'Discounts'}</div>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{t('store_discount') || 'Store discount'}</td>
                <td className="py-1.5 pr-2 text-right text-slate-400">×{report.discounts.store_tx_count}</td>
                <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(report.discounts.store_usd)}</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{t('membership_discount') || 'Membership'}</td>
                <td className="py-1.5 pr-2 text-right text-slate-400">×{report.discounts.membership_tx_count}</td>
                <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(report.discounts.membership_usd)}</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-medium text-slate-700 dark:text-slate-200">{t('total') || 'Total'}</td>
                <td />
                <td className="py-1.5 text-right font-semibold text-slate-900 dark:text-white">{fmtUSD(report.totals.discount_usd)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {t('tax') || 'Tax'}: <span className="font-medium text-slate-800 dark:text-slate-100">{fmtUSD(report.totals.tax_usd)}</span>
          </div>
        </div>

        {/* Delivery -- charged vs absorbed vs actual, then per courier */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t('pos_delivery') || 'Delivery'}
            <span className="ml-1.5 font-normal text-slate-400">×{report.totals.delivery_sale_count}</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{t('delivery_charged') || 'Charged to customers'}</td>
                <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(report.totals.delivery_usd)}</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{t('delivery_absorbed') || 'Absorbed by store'}</td>
                <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(report.totals.store_delivery_usd)}</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">
                  {t('delivery_actual_cost') || 'Actual cost paid'}
                  <span className="ml-1 text-slate-400">({report.totals.delivery_actual_cost_count}/{report.totals.delivery_sale_count} {t('recorded') || 'recorded'})</span>
                </td>
                <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(report.totals.delivery_actual_cost_usd)}</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-medium text-slate-700 dark:text-slate-200">{t('delivery_margin') || 'Delivery margin'}</td>
                <td className={`py-1.5 text-right font-semibold ${report.totals.delivery_margin_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtUSD(report.totals.delivery_margin_usd)}</td>
              </tr>
            </tbody>
          </table>
          {report.delivery_contacts.length ? (
            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('by_courier') || 'By courier'}</div>
              <table className="w-full text-xs">
                <tbody>
                  {report.delivery_contacts.map((courier) => (
                    <tr key={`${courier.delivery_contact_id ?? 'name'}:${courier.delivery_contact_name}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="max-w-[9rem] truncate py-1 pr-2 text-slate-700 dark:text-slate-200">{courier.delivery_contact_name || (t('no_contact_recorded') || 'No contact recorded')}</td>
                      <td className="py-1 pr-2 text-right text-slate-400">×{courier.deliveries}</td>
                      <td className="py-1 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(courier.actual_cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DateTimeRangePicker value={range} onChange={setRange} t={t} />
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{rangeTotals.tx} {t('sales') || 'sales'}</span>
          <span>{t('revenue') || 'Revenue'}: <span className="font-semibold text-slate-900 dark:text-white">{fmtUSD(rangeTotals.revenue)}</span></span>
          <span className="hidden sm:inline">{t('profit') || 'Profit'}: <span className={`font-semibold ${rangeTotals.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtUSD(rangeTotals.profit)}</span></span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{t('try_again') || 'Try again'}</button>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_2rem] items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div>{t('date') || 'Date'}</div>
          <div className="text-right">{t('sales') || 'Sales'}</div>
          <div className="text-right">{t('revenue') || 'Revenue'}</div>
          <div className="hidden text-right sm:block">{t('discounts') || 'Discounts'}</div>
          <div className="text-right">{t('profit') || 'Profit'}</div>
          <div />
        </div>
        {loading && !days.length ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((row) => <div key={row} className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : orderedDays.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-400">{t('no_sales_in_range') || 'No sales in this range.'}</div>
        ) : orderedDays.map((day) => {
          const expanded = expandedDate === day.date
          return (
            <div key={day.date} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <button
                type="button"
                onClick={() => openDay(day.date)}
                className={`grid w-full grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_2rem] items-center gap-2 px-3 py-2.5 text-left text-xs transition hover:bg-blue-50/60 dark:hover:bg-blue-900/10 ${expanded ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}`}
                aria-expanded={expanded}
              >
                <span className="font-medium text-slate-900 dark:text-white">{displayDay(day.date)}</span>
                <span className="text-right text-slate-600 dark:text-slate-300">{day.tx_count}</span>
                <span className="text-right font-medium text-slate-900 dark:text-white">{fmtUSD(day.revenue_usd)}</span>
                <span className="hidden text-right text-slate-600 dark:text-slate-300 sm:block">{fmtUSD(day.discount_usd)}</span>
                <span className={`text-right font-medium ${day.profit_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtUSD(day.profit_usd)}</span>
                <span className="justify-self-end text-slate-400">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
              </button>
              {expanded ? (
                dayLoading ? (
                  <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                    <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
                  </div>
                ) : dayError ? (
                  <div className="border-t border-slate-100 p-3 text-sm text-red-600 dark:border-slate-800 dark:text-red-400">{dayError}</div>
                ) : dayReport ? renderDayDetail(dayReport) : null
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
