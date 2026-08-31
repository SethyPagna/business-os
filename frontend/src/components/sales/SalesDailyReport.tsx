import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Modal from '../shared/Modal'
import { downloadCSV } from '../../utils/csv.ts'
import DateTimeRangePicker, { EMPTY_DATE_TIME_RANGE, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getSalesDailyReport, getSalesDayReport } from '../../api/salesTransport.ts'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import { useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'

// X2 (Part 395): the Sales "by day" report -- a range-scoped list of days,
// each expanding into its full breakdown (payment methods, delivery incl.
// per-courier, discounts). Every figure comes from the shared salesAnalytics
// kernel via /daily-report and /day-report, so this page can never disagree
// with the Dashboard (single-source rule). USD-centric like the kernel.

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

type DailyReportAppContext = { settings?: { pos_payment_methods?: unknown } }
const useApp = useAppHook as unknown as () => DailyReportAppContext

interface BranchOption { id: string; name: string }

// Mirrors POS.tsx's parsing of the configured payment methods (same retired
// set + default list) so the Reports filter offers exactly the methods the
// till does.
const PAYMENT_METHOD_FALLBACK = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR']
const RETIRED_PAYMENT_METHODS = new Set(['pi pay', 'transfer'])

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
  sales?: Array<{ id: number; receipt_number: string; created_at: string; customer_name: string; payment_method: string; sale_status: string; revenue_usd: number; discount_usd: number; collected_usd: number }>
}

interface SalesDailyReportProps {
  t: TranslateFn
  fmtUSD: MoneyFormatter
  active?: boolean
  // Reports hub embeds this with a range + branch owned by the hub. When
  // `range`/`onRangeChange` are passed the range is controlled by the parent;
  // when `embedded` is set the component hides its own range picker and branch
  // filter (the hub provides them) and scopes to `branchId`. Status/payment
  // filters stay -- they are Sales-specific.
  range?: DateTimeRange
  onRangeChange?: (range: DateTimeRange) => void
  branchId?: string
  embedded?: boolean
  /** The Reports-hub section title (icon + label). Rendered on the same row
   * as this section's status/method filters; the totals drop to a line
   * below. */
  titleNode?: ReactNode
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

// Just the 24-hour clock for a receipt inside a day drill (the day is already
// the row's context). D1 stores created_at as UTC 'YYYY-MM-DD HH:MM:SS' with no
// zone -- treat a bare stamp as UTC, then show the viewer's local time.
function clockOf(iso: string): string {
  if (!iso) return ''
  let s = String(iso).trim()
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T')
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// JS reports minutes WEST of UTC; the kernel wants minutes EAST.
function localTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

function timeParams(range: DateTimeRange): Record<string, string | number> {
  if (!range.startTime || !range.endTime) return {}
  return { startTime: range.startTime, endTime: range.endTime, tzOffsetMinutes: localTzOffsetMinutes() }
}

export default function SalesDailyReport({ t, fmtUSD, active = true, range: externalRange, onRangeChange, branchId: externalBranchId, embedded = false, titleNode }: SalesDailyReportProps) {
  const [internalRange, setInternalRange] = useState<DateTimeRange>(() => ({
    ...EMPTY_DATE_TIME_RANGE,
    startDate: monthStartIso(),
    endDate: todayIso(),
  }))
  const range = externalRange ?? internalRange
  const setRange = onRangeChange ?? setInternalRange
  const [days, setDays] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [dayReport, setDayReport] = useState<DayReport | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState('')
  const requestRef = useRef(0)

  const { settings } = useApp()
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [branches, setBranches] = useState<BranchOption[]>([])

  const paymentMethods = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(String(settings?.pos_payment_methods || '[]')) as unknown
      if (!Array.isArray(parsed)) return PAYMENT_METHOD_FALLBACK
      const methods = parsed
        .map((method) => String(method || '').trim())
        .filter((method) => method && !RETIRED_PAYMENT_METHODS.has(method.toLowerCase()))
      return methods.length ? methods : PAYMENT_METHOD_FALLBACK
    } catch {
      return PAYMENT_METHOD_FALLBACK
    }
  }, [settings?.pos_payment_methods])

  // Branch options -- the daily/day report endpoints already accept a
  // branchId; the picklist just was never surfaced on this view before. Not
  // needed when embedded: the hub owns the branch filter and passes branchId.
  useEffect(() => {
    if (embedded) return undefined
    let cancelled = false
    import('../../api/branchTransport.ts')
      .then((mod) => mod.getBranches())
      .then((res) => {
        if (cancelled) return
        const raw = Array.isArray(res) ? res : (res as { branches?: unknown[] } | null)?.branches
        const list = (Array.isArray(raw) ? raw : []).reduce<BranchOption[]>((acc, entry) => {
          const rec = entry as { id?: unknown; name?: unknown; branch_name?: unknown }
          const id = rec.id == null ? '' : String(rec.id)
          if (id) acc.push({ id, name: String(rec.name || rec.branch_name || id) })
          return acc
        }, [])
        setBranches(list)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [embedded])

  // Embedded: the hub owns the branch; standalone: our own branch dropdown.
  const effectiveBranch = embedded ? (externalBranchId || '') : branchFilter
  const filterParams = useMemo<Record<string, string>>(() => ({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(paymentFilter ? { paymentMethod: paymentFilter } : {}),
    ...(effectiveBranch ? { branchId: effectiveBranch } : {}),
  }), [statusFilter, paymentFilter, effectiveBranch])

  const statusOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('all_statuses') || 'All statuses' },
    ...ALL_STATUSES.map((status) => ({ value: status, label: getStatusLabel(status, (key) => t(key) || key) })),
  ], [t])
  const paymentOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('all_payment_methods') || 'All methods' },
    ...paymentMethods.map((method) => ({ value: method, label: method })),
  ], [paymentMethods, t])
  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: t('all_branches') || 'All Branches' },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ], [branches, t])

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
        ...filterParams,
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
  }, [range, t, filterParams])

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
      const report = await getSalesDayReport({ date, ...timeParams(range), ...filterParams }) as DayReport | null
      setDayReport(report && report.date === date ? report : null)
    } catch (err) {
      setDayError(err instanceof Error && err.message ? err.message : (t('daily_report_failed') || 'Could not load this day.'))
    } finally {
      setDayLoading(false)
    }
  }, [expandedDate, range, t, filterParams])

  const rangeTotals = useMemo(() => days.reduce((acc, day) => ({
    tx: acc.tx + (day.tx_count || 0),
    revenue: acc.revenue + (day.revenue_usd || 0),
    discounts: acc.discounts + (day.discount_usd || 0),
    delivery: acc.delivery + (day.delivery_usd || 0),
    profit: acc.profit + (day.profit_usd || 0),
  }), { tx: 0, revenue: 0, discounts: 0, delivery: 0, profit: 0 }), [days])

  // Newest first -- the day someone is looking for is almost always recent.
  const orderedDays = useMemo(() => [...days].sort((a, b) => (a.date < b.date ? 1 : -1)), [days])

  const renderDayDetail = (report: DayReport) => (
    <div className="space-y-2.5">
      {/* Text summary with "|" dividers — reports carry no stat tiles
          (user, Aug 30: "it doesn't have to have stats, just text summary
          and '|' vertical line for divisions"). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
        <span>{report.totals.tx_count} {t('sales') || 'sales'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('revenue') || 'Revenue'} <b className="text-slate-900 dark:text-white">{fmtUSD(report.totals.revenue_usd)}</b></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('discounts') || 'Discounts'} <b className="text-rose-600 dark:text-rose-400">{fmtUSD(report.totals.discount_usd)}</b></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('profit') || 'Profit'} <b className={report.totals.profit_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{fmtUSD(report.totals.profit_usd)}</b></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('collected_total') || 'Collected'} <b className="text-slate-700 dark:text-slate-200">{fmtUSD(report.totals.collected_total_usd)}</b></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('avg_order') || 'Avg order'} <b className="text-slate-700 dark:text-slate-200">{fmtUSD(report.totals.avg_order_usd)}</b></span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* Payment methods */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
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
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
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
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
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

      {/* Per-sale breakdown for the day (the "break down per sales" ask). Each
          row's revenue is kernel-computed server-side, so the column sums to
          the day's Revenue stat above -- never a raw receipt total that would
          include tax/delivery and fail to reconcile. */}
      {report.sales && report.sales.length ? (
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t('sales') || 'Sales'} <span className="font-normal text-slate-400">({report.sales.length})</span>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {report.sales.map((sale) => (
                  <tr key={sale.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-1.5 pr-2 font-mono font-medium text-blue-600 dark:text-blue-400">{sale.receipt_number}</td>
                    <td className="hidden py-1.5 pr-2 text-slate-400 sm:table-cell">{clockOf(sale.created_at)}</td>
                    <td className="max-w-[9rem] truncate py-1.5 pr-2 text-slate-700 dark:text-slate-200">{sale.customer_name || (t('walk_in') || 'Walk-in')}</td>
                    <td className="hidden py-1.5 pr-2 md:table-cell"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">{sale.payment_method}</span></td>
                    <td className="py-1.5 pr-2 text-right text-rose-500/80">{sale.discount_usd > 0 ? `−${fmtUSD(sale.discount_usd)}` : ''}</td>
                    <td className={`py-1.5 text-right font-medium ${sale.sale_status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>{fmtUSD(sale.revenue_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )

  const hasFilter = Boolean(statusFilter || paymentFilter || (!embedded && branchFilter))

  // Export the range's per-day sales series as CSV (user, Aug 31: "no
  // actions to choose export etc").
  const exportCsv = useCallback(() => {
    const rows = [...days]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((d) => ({
        date: d.date, sales: d.tx_count, revenue_usd: d.revenue_usd,
        discount_usd: d.discount_usd, profit_usd: d.profit_usd,
      }))
    if (!rows.length) return
    downloadCSV(`sales-report-${range.startDate || 'all'}_${range.endDate || 'all'}.csv`, rows)
  }, [days, range.startDate, range.endDate])

  return (
    <div className="space-y-3">
      {/* Title row (Part 552): the section title sits left and the compact
          status/method (+branch when standalone) chip-selects ride ml-auto
          on the SAME row — "the sales ... sections the card title can be
          moved to title row". The totals drop to their own line below. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {!embedded ? <DateTimeRangePicker value={range} onChange={setRange} t={t} /> : null}
        {titleNode ? <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{titleNode}</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!days.length}
            title={t('export') || 'Export'}
            aria-label={t('export') || 'Export'}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700"
          >
            <Download className="h-3 w-3" /> {t('export') || 'Export'}
          </button>
          <AppSelect
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
            ariaLabel={t('status') || 'Status'}
            buttonClassName="h-7 py-0 px-2 text-[11px]"
          />
          <AppSelect
            value={paymentFilter}
            options={paymentOptions}
            onChange={setPaymentFilter}
            ariaLabel={t('payment_method') || 'Payment method'}
            buttonClassName="h-7 py-0 px-2 text-[11px]"
          />
          {!embedded && branches.length ? (
            <AppSelect
              value={branchFilter}
              options={branchOptions}
              onChange={setBranchFilter}
              ariaLabel={t('branch') || 'Branch'}
              buttonClassName="h-7 py-0 px-2 text-[11px]"
            />
          ) : null}
          {hasFilter ? (
            <button
              type="button"
              onClick={() => { setStatusFilter(''); setPaymentFilter(''); setBranchFilter('') }}
              className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              {t('clear') || 'Clear'}
            </button>
          ) : null}
        </span>
      </div>

      {/* Totals on their own line below the title row. Profit shows on
          EVERY viewport (Part 548) — it was `hidden sm:inline`, so phones
          showed "N sales | Revenue" with no Profit. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>{rangeTotals.tx} {t('sales') || 'sales'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('revenue') || 'Revenue'} <b className="text-slate-900 dark:text-white">{fmtUSD(rangeTotals.revenue)}</b></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('profit') || 'Profit'} <b className={`${rangeTotals.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtUSD(rangeTotals.profit)}</b></span>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{t('try_again') || 'Try again'}</button>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {/* No trailing chevron column ("no need so much spacing for arrow
            it takes so much space") — the whole row is the click target and
            opens the day FLOAT below. */}
        <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <div>{t('date') || 'Date'}</div>
          <div className="text-right">{t('sales') || 'Sales'}</div>
          <div className="text-right">{t('revenue') || 'Revenue'}</div>
          <div className="hidden text-right sm:block">{t('discounts') || 'Discounts'}</div>
          <div className="text-right">{t('profit') || 'Profit'}</div>
        </div>
        {loading && !days.length ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((row) => <div key={row} className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : orderedDays.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-400">{t('no_sales_in_range') || 'No sales in this range.'}</div>
        ) : orderedDays.map((day) => (
          <button
            key={day.date}
            type="button"
            onClick={() => openDay(day.date)}
            className="grid w-full grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-xs transition last:border-0 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:bg-blue-900/10"
          >
            <span className="font-medium text-slate-900 dark:text-white">{displayDay(day.date)}</span>
            <span className="text-right text-slate-600 dark:text-slate-300">{day.tx_count}</span>
            <span className="text-right font-medium text-slate-900 dark:text-white">{fmtUSD(day.revenue_usd)}</span>
            <span className="hidden text-right text-slate-600 dark:text-slate-300 sm:block">{fmtUSD(day.discount_usd)}</span>
            <span className={`text-right font-medium ${day.profit_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{fmtUSD(day.profit_usd)}</span>
          </button>
        ))}
      </div>

      {/* Day drill as a scrollable FLOAT (user, Aug 30: "instead of expand
          and collapse do a click to open float, and scrollable"). The
          shared Modal's body scrolls; the row list stays put behind it. */}
      {expandedDate ? (
        <Modal title={displayDay(expandedDate)} onClose={() => { setExpandedDate(null); setDayReport(null) }} draggable>
          {dayLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : dayError ? (
            <div className="text-sm text-red-600 dark:text-red-400">{dayError}</div>
          ) : dayReport ? renderDayDetail(dayReport) : null}
        </Modal>
      ) : null}
    </div>
  )
}
