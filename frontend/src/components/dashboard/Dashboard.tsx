import { Suspense, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { useMemo } from 'react'
import { useRef } from 'react'
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import MiniStat from './MiniStat'
import { fmtTime, getBusinessTimezoneOffsetHours } from '../../utils/formatters'
import { todayStr, offsetDate, businessYear, businessMonth } from '../../utils/dateHelpers'
import Download from 'lucide-react/dist/esm/icons/download.js'
import DateTimeRangePicker, { type DateTimeRange } from '../shared/DateTimeRangePicker'
import { useIsPageActive } from '../shared/pageActivity'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.ts'
import { getAnalytics, getDashboard, getDashboardStartup } from '../../api/dashboardTransport.ts'
import { isInvalidSessionError } from '../../api/http.ts'
import { listImportJobs } from '../../api/importJobsTransport.ts'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'

const ImportReportModal = lazyRetry(() => import('../shared/ImportReportModal'), 'ImportReportModal')
const ExportChoiceDialog = lazyRetry(() => import('../shared/ExportChoiceDialog'), 'dashboard-export-choices')

const BarChart = lazyRetry(() => import('./charts/BarChart'), 'dashboard-bar-chart')
const LineChart = lazyRetry(() => import('./charts/LineChart'), 'dashboard-line-chart')
const DonutChart = lazyRetry(() => import('./charts/DonutChart'), 'dashboard-donut-chart')

type TranslateFn = (key: string) => string
type FormatMoneyFn = (value: unknown) => string
type NavigateFn = (page: string) => void
type EntityId = string | number
type DashboardRangeId = 'today' | '7d' | 'month' | 'year' | 'custom'
type DashboardGranularity = 'day' | 'week' | 'month'
type DashboardChartMode = 'revenue' | 'profit' | 'volume'
type DashboardTopMode = 'revenue' | 'qty'
type InventoryStockFocus = 'all' | 'low' | 'out'
type DashboardMetricValue = string | number | boolean | null | undefined
type DashboardMetricMap = Record<string, number | undefined>
type DashboardExportItem = 'divider' | {
  label: ReactNode
  onClick?: () => void
  color?: string
  disabled?: boolean
}

interface AppUser {
  id?: EntityId
  username?: string
  email?: string
}

interface AppContextValue {
  t: TranslateFn
  fmtUSD: FormatMoneyFn
  fmtKHR: FormatMoneyFn
  navigateTo: NavigateFn
  user?: AppUser | null
  hasPermission: (key: string) => boolean
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string
    ts?: string | number
  } | null
}

interface DashboardProduct {
  id?: EntityId
  product_id?: EntityId
  product_name?: string
  name?: string
  category?: string
  unit?: string
  stock_quantity?: number
  low_stock_threshold?: number
  out_of_stock_threshold?: number
  qty_sold?: number
  revenue_usd?: number
  expiry_date?: string
  days_until_expiry?: number
  insightType?: string
  rank?: number
  [key: string]: unknown
}

interface DashboardCustomer {
  customer_name?: string
  sale_count?: number
  gross_revenue_usd?: number
  store_discount_usd?: number
  membership_discount_usd?: number
  total_refund_usd?: number
  net_revenue_usd?: number
  rank?: number
  [key: string]: unknown
}

interface DashboardSaleItem {
  name?: string
  product_name?: string
  qty?: number
  quantity?: number
  price?: number
  total?: number
}

interface DashboardSale {
  id?: EntityId
  receipt_number?: string
  created_at?: string
  sale_status?: string
  branch_name?: string
  customer_name?: string
  total?: number
  total_usd?: number
  total_khr?: number
  items?: DashboardSaleItem[]
  [key: string]: unknown
}

interface DashboardPeriodRow {
  date?: string
  period?: string
  revenue_usd?: number
  gross_sales_usd?: number
  discount_usd?: number
  tax_usd?: number
  delivery_usd?: number
  delivery_actual_cost_usd?: number
  delivery_actual_cost_count?: number
  delivery_sale_count?: number
  delivery_margin_usd?: number
  refund_usd?: number
  profit_usd?: number
  cost_usd?: number
  tx_count?: number
  refunds_usd?: number
  count?: number
  [key: string]: unknown
}

interface DashboardPaymentRow {
  method?: string
  payment_method?: string
  revenue_usd?: number
  count?: number
  [key: string]: unknown
}

interface DashboardBranchRow {
  branch_id?: EntityId
  branch_name?: string
  revenue_usd?: number
  tx_count?: number
  count?: number
  [key: string]: unknown
}

interface DashboardHourRow {
  hour: number | string
  count?: number
  revenue_usd?: number
}

interface DashboardSummary {
  today_count: number
  today_total: number
  today_total_khr: number
  today_return_count: number
  today_return_usd: number
  all_total: number
  all_total_khr: number
  cost_in: number
  cost_out: number
  cost_in_khr: number
  cost_out_khr: number
  product_count: number
  in_stock_count: number
  low_stock_count: number
  out_of_stock_count: number
  stock_value_usd: number
  stock_value_khr: number
  low_stock: DashboardProduct[]
  out_of_stock: DashboardProduct[]
  expiring_products: DashboardProduct[]
  expiring_count: number
  recent_sales: DashboardSale[]
  low_stock_preview_limit?: number
  out_of_stock_preview_limit?: number
  low_stock_preview_truncated?: boolean
  out_of_stock_preview_truncated?: boolean
  [key: string]: unknown
}

interface DashboardAnalytics {
  totals: DashboardMetricMap
  prevTotals: DashboardMetricMap
  periodReturns: DashboardMetricMap
  periodSupplierReturns: DashboardMetricMap
  periodData: DashboardPeriodRow[]
  byPayment: DashboardPaymentRow[]
  byBranch: DashboardBranchRow[]
  topProducts: DashboardProduct[]
  topProductsQty: DashboardProduct[]
  topCustomers: DashboardCustomer[]
  hourlyDist: DashboardHourRow[]
  [key: string]: unknown
}

interface DashboardFilterPrefs {
  rangeId: DashboardRangeId
  customStart: string
  customEnd: string
}

interface DashboardRangePreset {
  id: DashboardRangeId
  label: string
  getRange: (() => { start: string; end: string; gran: DashboardGranularity }) | null
}

interface KpiDetail {
  id: string
  label: ReactNode
  value?: ReactNode
  sub?: ReactNode
  details?: Array<{ label: ReactNode; value: ReactNode }>
}

// Trimmed shape the "Recent imports" card needs from an import_jobs row --
// deliberately not the full serialized job (see serializeJob in
// importJobs.ts), just enough to list + open a report. Lists recent import
// files generally (not only ones with warnings) -- clicking a row opens
// the same report screen (ImportReportModal) either way.
interface ImportFileSummary {
  id: string
  type?: string | null
  status?: string | null
  warning_count?: number | null
  created_at?: string | null
  fileName?: string | null
}

interface DashboardApi {
  getDashboard: () => Promise<unknown>
  getAnalytics: (params: { startDate: string; endDate: string; granularity: DashboardGranularity }) => Promise<unknown>
  getDashboardStartup: (params: { startDate: string; endDate: string; granularity: DashboardGranularity }) => Promise<unknown>
}

type DashboardExportModule = typeof import('./dashboardExport.ts')

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean

function getDashboardApi(): DashboardApi {
  return { getDashboard, getAnalytics, getDashboardStartup }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const DASHBOARD_FILTER_STORAGE_PREFIX = 'bos_dashboard_filters:'
const DASHBOARD_FILTER_STORAGE_FALLBACK_KEY = `${DASHBOARD_FILTER_STORAGE_PREFIX}last`
const DASHBOARD_CHART_POINT_LIMIT = 180
const DASHBOARD_SUMMARY_TIMEOUT_MS = 30000
const DASHBOARD_ANALYTICS_TIMEOUT_MS = 30000
const DASHBOARD_STARTUP_TIMEOUT_MS = 30000
const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  today_count: 0,
  today_total: 0,
  today_total_khr: 0,
  today_return_count: 0,
  today_return_usd: 0,
  all_total: 0,
  all_total_khr: 0,
  cost_in: 0,
  cost_out: 0,
  cost_in_khr: 0,
  cost_out_khr: 0,
  product_count: 0,
  in_stock_count: 0,
  low_stock_count: 0,
  out_of_stock_count: 0,
  stock_value_usd: 0,
  stock_value_khr: 0,
  low_stock: [],
  out_of_stock: [],
  expiring_products: [],
  expiring_count: 0,
  recent_sales: [],
}
const EMPTY_DASHBOARD_ANALYTICS: DashboardAnalytics = {
  totals: {},
  prevTotals: {},
  periodReturns: {},
  periodSupplierReturns: {},
  periodData: [],
  byPayment: [],
  byBranch: [],
  topProducts: [],
  topProductsQty: [],
  topCustomers: [],
  hourlyDist: [],
}
const DASHBOARD_INVENTORY_FOCUS_KEY = 'bos:dashboard:inventory-focus'

function getDashboardFilterStorageKey(user?: AppUser | null): string {
  const userKey = user?.id || user?.username || user?.email || 'guest'
  return `${DASHBOARD_FILTER_STORAGE_PREFIX}${userKey}`
}

function readDashboardFilterPrefs(storageKeys: string | string[]): DashboardFilterPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const keys = Array.isArray(storageKeys)
      ? storageKeys.filter(Boolean)
      : [storageKeys].filter(Boolean)
    for (const key of keys) {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') continue
      return {
        rangeId: typeof parsed.rangeId === 'string' ? normalizeDashboardRangeId(parsed.rangeId) : 'month',
        customStart: typeof parsed.customStart === 'string' ? parsed.customStart : offsetDate(-29),
        customEnd: typeof parsed.customEnd === 'string' ? parsed.customEnd : todayStr(),
      }
    }
    return null
  } catch {
    return null
  }
}

function downsampleChartRows(rows: DashboardPeriodRow[] = [], limit = DASHBOARD_CHART_POINT_LIMIT): DashboardPeriodRow[] {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (list.length <= limit) return list
  const step = Math.ceil(list.length / limit)
  const sampled: DashboardPeriodRow[] = []
  for (let index = 0; index < list.length; index += 1) {
    if (index === 0 || index === list.length - 1 || index % step === 0) sampled.push(list[index])
  }
  return sampled
}

function normalizeDashboardRangeId(rangeId: unknown): DashboardRangeId {
  if (rangeId === '30d') return 'month'
  if (rangeId === '90d') return 'year'
  if (rangeId === 'today' || rangeId === '7d' || rangeId === 'month' || rangeId === 'year' || rangeId === 'custom') return rangeId
  return 'month'
}

function compactDashboardMetaParts(parts: unknown[] = []): string[] {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part && part !== '-' && part !== '--')
}

function ChartFallback({ className = 'h-52' }: { className?: string }) {
  return (
    <div className={`${className} rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/50`} />
  )
}

function formatDashboardHourLabel(hourValue: unknown): string {
  const hour = ((Number(hourValue) % 24) + 24) % 24
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

function getSaleStatusTone(status: unknown): string {
  const key = String(status || '').toLowerCase()
  if (key === 'refunded' || key === 'returned') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (key === 'pending' || key === 'draft') return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
}

function PaymentMethodCard({ analytics, analyticsPending, analyticsUnavailable, analyticsError, translateOr }: {
  analytics: DashboardAnalytics | null
  analyticsPending: boolean
  analyticsUnavailable: boolean
  analyticsError: string
  translateOr: (key: string, fallback: string, khmerFallback?: string) => string
}) {
  const payments = analytics?.byPayment || []
  const total = payments.reduce((sum, row) => sum + (row.revenue_usd || 0), 0)
  const colors = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#0891b2']
  return (
    <div className="card p-3 sm:p-4">
      <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">{translateOr('payment_method', 'Payment Method', 'វិធីទូទាត់')}</h2>
      {analyticsPending ? <div className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700" /> : analyticsUnavailable ? (
        <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
      ) : (
        <>
          <Suspense fallback={<ChartFallback className="h-28" />}>
            <DonutChart data={payments} valueKey="revenue_usd" />
          </Suspense>
          <div className="mt-2 max-h-32 space-y-1 overflow-auto">
            {payments.map((payment, index) => {
              const percent = total > 0 ? ((payment.revenue_usd || 0) / total * 100).toFixed(1) : 0
              return (
                <div key={`${payment.payment_method || payment.method || 'payment'}-${index}`} className="flex items-center justify-between text-xs">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[index % colors.length] }} />
                    <span className="max-w-20 truncate text-gray-600 dark:text-gray-400">{payment.payment_method || payment.method}</span>
                  </div>
                  <div className="shrink-0 text-right"><span className="font-medium text-gray-900 dark:text-white">{percent}%</span><span className="ml-1 text-gray-400">({payment.count})</span></div>
                </div>
              )
            })}
            {!payments.length ? <p className="py-2 text-center text-xs text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}

function RecentSalesCard({ summary, t, translateOr, fmtUSD, fmtKHR, formatStatus, onOpenSale, onViewMore }: {
  summary: DashboardSummary | null
  t: TranslateFn
  translateOr: (key: string, fallback: string, khmerFallback?: string) => string
  fmtUSD: FormatMoneyFn
  fmtKHR: FormatMoneyFn
  formatStatus: (status: unknown) => string
  onOpenSale: (sale: DashboardSale) => void
  onViewMore: () => void
}) {
  const sales = summary?.recent_sales || []
  return (
    <div className="card">
      <div className="border-b border-gray-100 p-3 sm:p-4 dark:border-gray-700"><h2 className="font-semibold text-gray-900 dark:text-white">{t('sales') || 'Sales'}</h2></div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {!sales.length ? <p className="p-4 text-center text-sm text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p> : sales.slice(0, 5).map((sale) => (
          <button key={sale.id} type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-4" onClick={() => onOpenSale(sale)}>
            <div className="min-w-0"><p className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">{sale.receipt_number}</p><p className="truncate text-xs text-gray-400">{compactDashboardMetaParts([fmtTime(sale.created_at), sale.branch_name, sale.customer_name]).join(' | ')}</p></div>
            <div className="shrink-0 text-right"><span className="font-semibold text-green-600">{fmtUSD(sale.total_usd || sale.total || 0)}</span>{(sale.total_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(sale.total_khr || 0)}</div> : null}<div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getSaleStatusTone(sale.sale_status)}`}>{formatStatus(sale.sale_status)}</div></div>
          </button>
        ))}
      </div>
      {sales.length > 5 ? <div className="relative z-10 border-t border-gray-100 px-4 py-2 dark:border-gray-700"><button type="button" onClick={onViewMore} className="relative z-10 w-full py-0.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">{translateOr('view_more', 'View more')}</button></div> : null}
    </div>
  )
}

function BranchPerformanceCard({ analytics, analyticsPending, analyticsUnavailable, analyticsError, showAll, setShowAll, t, translateOr, fmtUSD }: {
  analytics: DashboardAnalytics | null
  analyticsPending: boolean
  analyticsUnavailable: boolean
  analyticsError: string
  showAll: boolean
  setShowAll: (next: boolean | ((current: boolean) => boolean)) => void
  t: TranslateFn
  translateOr: (key: string, fallback: string, khmerFallback?: string) => string
  fmtUSD: FormatMoneyFn
}) {
  const all = analytics?.byBranch || []
  const visible = showAll ? all : all.slice(0, 4)
  const colors = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2']
  const maxRevenue = Math.max(...all.map((branch) => branch.revenue_usd || 0), 0.01)
  return <div className="card p-3 sm:p-4">
    <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">{t('branch_performance')}</h2>
    {analyticsPending ? <div className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700" /> : analyticsUnavailable ? <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div> : <>
      <div className="space-y-2">
        {!all.length ? <p className="py-4 text-center text-xs text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p> : visible.map((branch, index) => {
          const percent = ((branch.revenue_usd || 0) / maxRevenue * 100).toFixed(0)
          return <div key={`${branch.branch_id || branch.branch_name || 'branch'}-${index}`}><div className="mb-0.5 flex justify-between text-xs"><span className="max-w-28 truncate text-gray-600 dark:text-gray-400">{branch.branch_name}</span><span className="font-medium text-gray-900 dark:text-white">{fmtUSD(branch.revenue_usd || 0)}</span></div><div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"><div className="h-full rounded-full" style={{ width: `${percent}%`, background: colors[index % colors.length] }} /></div><div className="mt-0.5 text-right text-xs text-gray-400">{branch.count} {t('sale')}</div></div>
        })}
      </div>
      {all.length > 4 ? <button onClick={() => setShowAll((current) => !current)} className="mt-2 w-full py-1 text-xs text-blue-600 hover:underline dark:text-blue-400">{showAll ? t('show_less') : `${t('view_all')} ${all.length} ${t('branches')}`}</button> : null}
    </>}
  </div>
}

function ExpiryAlertsCard({ summary, showAll, setShowAll, translateOr }: {
  summary: DashboardSummary | null
  showAll: boolean
  setShowAll: (next: boolean | ((current: boolean) => boolean)) => void
  translateOr: (key: string, fallback: string, khmerFallback?: string) => string
}) {
  const items = summary?.expiring_products || []
  const visible = showAll ? items : items.slice(0, 5)
  return <div className="card">
    <div className="flex items-center justify-between border-b border-gray-100 p-3 sm:p-4 dark:border-gray-700"><h2 className="font-semibold text-gray-900 dark:text-white">{translateOr('product_expiry_alerts', 'Expiry alerts', 'ការជូនដំណឹងផុតកំណត់')}</h2>{items.length ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{items.length}</span> : null}</div>
    <div className="divide-y divide-gray-100 dark:divide-gray-700">{!items.length ? <p className="p-4 text-center text-sm text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p> : visible.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4"><div className="min-w-0"><p className="truncate text-sm text-gray-700 dark:text-gray-300">{item.name}</p>{item.category ? <p className="text-xs text-gray-400">{item.category}</p> : null}</div><span className={Number(item.days_until_expiry || 0) < 0 ? 'badge-red' : 'badge-yellow'}>{item.expiry_date}</span></div>)}</div>
    {items.length > 5 ? <div className="border-t border-gray-100 px-4 py-2 dark:border-gray-700"><button onClick={() => setShowAll((current) => !current)} className="w-full py-0.5 text-xs text-blue-600 hover:underline dark:text-blue-400">{showAll ? 'Show less' : `View all ${items.length} items`}</button></div> : null}
  </div>
}

function BestHourCard({ analytics, analyticsPending, analyticsUnavailable, analyticsError, showAll, setShowAll, t, translateOr, fmtUSD, onOpenHour }: {
  analytics: DashboardAnalytics | null
  analyticsPending: boolean
  analyticsUnavailable: boolean
  analyticsError: string
  showAll: boolean
  setShowAll: (next: boolean | ((current: boolean) => boolean)) => void
  t: TranslateFn
  translateOr: (key: string, fallback: string, khmerFallback?: string) => string
  fmtUSD: FormatMoneyFn
  onOpenHour: (hour: DashboardHourRow, rank?: number | null) => void
}) {
  const hourly = analytics?.hourlyDist || []
  // Business-timezone offset, not the device's own -- backend hour buckets
  // are UTC, and this chart must read the same "9am" for every user
  // regardless of what timezone their device is set to.
  const timezoneOffset = getBusinessTimezoneOffsetHours()
  const merged: Record<number, DashboardHourRow> = {}
  hourly.forEach((hour) => {
    const localHour = ((Math.round(Number.parseInt(String(hour.hour), 10) + timezoneOffset)) % 24 + 24) % 24
    if (!merged[localHour]) merged[localHour] = { hour: localHour, count: 0, revenue_usd: 0 }
    merged[localHour].count = (merged[localHour].count || 0) + (Number(hour.count) || 0)
    merged[localHour].revenue_usd = (merged[localHour].revenue_usd || 0) + (Number.parseFloat(String(hour.revenue_usd || 0)) || 0)
  })
  const maxCount = Math.max(...Object.values(merged).map((hour) => hour.count || 0), 1)
  const allHours = Array.from({ length: 24 }, (_, hour) => merged[hour] || { hour, count: 0, revenue_usd: 0 })
  const busyHours = Object.values(merged).filter((hour) => (hour.count || 0) > 0).sort((left, right) => (right.count || 0) - (left.count || 0))
  const visible = showAll ? busyHours : busyHours.slice(0, 3)
  return <div className="card p-3 sm:p-4">
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('best_hour')}</h2><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{translateOr('tap_to_view', 'Tap to view')}</span></div>
    {analyticsPending ? <div className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700" /> : analyticsUnavailable ? <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div> : <>
      <div className="relative mb-3"><div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>{allHours.map((hour) => { const opacity = (hour.count || 0) === 0 ? 0.06 : 0.12 + (hour.count || 0) / maxCount * 0.88; return <button key={hour.hour} type="button" title={`${String(hour.hour).padStart(2, '0')}:00 - ${hour.count} ${t('sale')}(s), ${fmtUSD(hour.revenue_usd)}`} aria-label={`${translateOr('best_hour', 'Best hour')} ${formatDashboardHourLabel(hour.hour)}`} className="rounded-sm transition hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700" style={{ height: 40, background: `rgba(37,99,235,${opacity.toFixed(2)})` }} onClick={() => onOpenHour(hour, busyHours.findIndex((item) => item.hour === hour.hour) + 1 || null)} /> })}</div><div className="relative mt-1 flex h-[18px] text-[11px] font-medium text-gray-400">{[0, 6, 12, 18, 23].map((hour) => <span key={hour} className="absolute" style={{ left: `${hour / 23 * 100}%`, transform: 'translateX(-50%)' }}>{formatDashboardHourLabel(hour).replace(' ', '')}</span>)}</div></div>
      <div className="space-y-1">{!visible.length ? <p className="text-center text-xs text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p> : visible.map((hour, index) => <button key={hour.hour} type="button" className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/60 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/20" onClick={() => onOpenHour(hour, index + 1)}><div><div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{`#${index + 1} ${formatDashboardHourLabel(hour.hour)}`}</div><div className="text-[11px] text-gray-500 dark:text-gray-400">{String(hour.hour).padStart(2, '0')}:00 - {String((Number(hour.hour) + 1) % 24).padStart(2, '0')}:00</div></div><div className="text-right"><div className="text-sm font-semibold text-gray-900 dark:text-white">{hour.count} {t('sale')}{hour.count !== 1 ? 's' : ''}</div><div className="text-[11px] text-green-600 dark:text-green-400">{fmtUSD(hour.revenue_usd)}</div></div></button>)}</div>
      {busyHours.length > 3 ? <button onClick={() => setShowAll((current) => !current)} className="mt-2 w-full py-1 text-xs text-blue-600 hover:underline dark:text-blue-400">{showAll ? t('show_less') : `${t('view_all')} ${busyHours.length} ${t('hours') || 'hours'}`}</button> : null}
    </>}
  </div>
}

function isDashboardSummaryPayload(value: unknown): value is DashboardSummary {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<DashboardSummary>
  return (
    Number.isFinite(Number(payload.product_count))
    || Number.isFinite(Number(payload.stock_value_usd))
    || Array.isArray(payload.recent_sales)
    || Array.isArray(payload.low_stock)
    || Array.isArray(payload.out_of_stock)
  )
}

function isDashboardAnalyticsPayload(value: unknown): value is DashboardAnalytics {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<DashboardAnalytics>
  return (
    Array.isArray(payload.periodData)
    || Array.isArray(payload.byPayment)
    || Array.isArray(payload.byBranch)
    || Array.isArray(payload.topProducts)
    || Array.isArray(payload.topCustomers)
    || Boolean(payload.totals && typeof payload.totals === 'object')
  )
}

function normalizeDashboardSummaryPayload(value: unknown): DashboardSummary | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<DashboardSummary>
  return {
    ...EMPTY_DASHBOARD_SUMMARY,
    ...payload,
    low_stock: Array.isArray(payload.low_stock) ? payload.low_stock : [],
    out_of_stock: Array.isArray(payload.out_of_stock) ? payload.out_of_stock : [],
    expiring_products: Array.isArray(payload.expiring_products) ? payload.expiring_products : [],
    recent_sales: Array.isArray(payload.recent_sales) ? payload.recent_sales : [],
  }
}

function normalizeDashboardAnalyticsPayload(value: unknown): DashboardAnalytics | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<DashboardAnalytics>
  return {
    ...EMPTY_DASHBOARD_ANALYTICS,
    ...payload,
    totals: payload.totals && typeof payload.totals === 'object' ? payload.totals : {},
    prevTotals: payload.prevTotals && typeof payload.prevTotals === 'object' ? payload.prevTotals : {},
    periodReturns: payload.periodReturns && typeof payload.periodReturns === 'object' ? payload.periodReturns : {},
    periodSupplierReturns: payload.periodSupplierReturns && typeof payload.periodSupplierReturns === 'object' ? payload.periodSupplierReturns : {},
    periodData: Array.isArray(payload.periodData) ? payload.periodData : [],
    byPayment: Array.isArray(payload.byPayment) ? payload.byPayment : [],
    byBranch: Array.isArray(payload.byBranch) ? payload.byBranch : [],
    topProducts: Array.isArray(payload.topProducts) ? payload.topProducts : [],
    topProductsQty: Array.isArray(payload.topProductsQty) ? payload.topProductsQty : [],
    topCustomers: Array.isArray(payload.topCustomers) ? payload.topCustomers : [],
    hourlyDist: Array.isArray(payload.hourlyDist) ? payload.hourlyDist : [],
  }
}

export default function Dashboard() {
  const { t, fmtUSD, fmtKHR, navigateTo, user, hasPermission } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('dashboard')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    const safeKm = fallbackKm && !isBrokenLocalizedString(fallbackKm) ? fallbackKm : fallbackEn
    return isKhmer ? safeKm : fallbackEn
  }, [isKhmer, t])
  const exportLabel = translateOr('export', 'Export')
  const refreshLabel = translateOr('refresh', 'Refresh')
  // The 5 detail-drawer close buttons below (recent sales, sale detail,
  // product detail, customer detail, KPI detail) were hardcoded "Close" in
  // English, bypassing i18n entirely -- same bug class as the icon-only
  // close buttons fixed app-wide in Part 124 (see progress.md), just a
  // text-button variant that grep missed there. One shared label, same
  // `close` key already used everywhere else in the app.
  const closeLabel = translateOr('close', 'Close')
  const dashboardFilterStorageKey = useMemo(() => getDashboardFilterStorageKey(user), [user?.email, user?.id, user?.username])
  const dashboardFilterStorageKeys = useMemo(
    () => [dashboardFilterStorageKey, DASHBOARD_FILTER_STORAGE_FALLBACK_KEY],
    [dashboardFilterStorageKey],
  )
  const initialFilterPrefs = useMemo(
    () => readDashboardFilterPrefs(dashboardFilterStorageKeys),
    [dashboardFilterStorageKeys],
  )

  // Range presets use guarded translations so loading or missing language packs never show raw keys.
  const RANGE_PRESETS: DashboardRangePreset[] = [
    { id: 'today',  label: translateOr('range_today', 'Today', 'ថ្ងៃនេះ'),      getRange: () => ({ start: todayStr(), end: todayStr(), gran: 'day' }) },
    { id: '7d',     label: translateOr('range_7d', '7 Days', '៧ ថ្ងៃ'),          getRange: () => ({ start: offsetDate(-6), end: todayStr(), gran: 'day' }) },
    { id: 'month',  label: translateOr('range_this_month', 'This Month', 'ខែនេះ'),  getRange: () => ({ start: `${businessYear()}-${String(businessMonth()).padStart(2,'0')}-01`, end: todayStr(), gran: 'day' }) },
    { id: 'year',   label: translateOr('range_this_year', 'This Year', 'ឆ្នាំនេះ'),   getRange: () => ({ start: `${businessYear()}-01-01`, end: todayStr(), gran: 'month' }) },
    // Y19: the separate "Custom" chip is gone -- the Start → End pill below IS
    // the custom editor. 'custom' stays a valid rangeId (set when the pill is
    // edited); it just no longer renders as a preset button.
  ]

  const [summary, setSummary]     = useState<DashboardSummary | null>(null)
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null)
  const [loading, setLoading]     = useState(true)
  const [aLoading, setALoading]   = useState(true)
  const [silentRefresh, setSilentRefresh] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [analyticsError, setAnalyticsError] = useState('')
  const [rangeId, setRangeId]     = useState<DashboardRangeId>(() => normalizeDashboardRangeId(initialFilterPrefs?.rangeId || 'month'))
  const [customStart, setCustomStart] = useState(() => initialFilterPrefs?.customStart || offsetDate(-29))
  const [customEnd, setCustomEnd]     = useState(() => initialFilterPrefs?.customEnd || todayStr())
  const [activeChart, setActiveChart] = useState<DashboardChartMode>('revenue')
  const [topMode, setTopMode]         = useState<DashboardTopMode>('revenue')
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [showAllProducts, setShowAllProducts]   = useState(false)
  const [customerDetail, setCustomerDetail]     = useState<DashboardCustomer | null>(null)
  const [productDetail, setProductDetail]       = useState<DashboardProduct | null>(null)
  const [showAllBranches, setShowAllBranches]   = useState(false)
  const [showAllHours, setShowAllHours]         = useState(false)
  const [showAllLowStock, setShowAllLowStock]   = useState(false)
  const [showAllOutStock, setShowAllOutStock]   = useState(false)
  const [showAllExpiring, setShowAllExpiring]   = useState(false)
  const [recentSalesOpen, setRecentSalesOpen]   = useState(false)
  const [recentSaleDetail, setRecentSaleDetail] = useState<DashboardSale | null>(null)
  const [kpiDetail, setKpiDetail]               = useState<KpiDetail | null>(null)
  const [recentImportFiles, setRecentImportFiles] = useState<ImportFileSummary[]>([])
  const [recentImportFilesLoading, setRecentImportFilesLoading] = useState(true)
  const [importReportJobId, setImportReportJobId] = useState<string | null>(null)
  const [exportChoicesOpen, setExportChoicesOpen] = useState(false)
  const summaryRequestRef = useRef(0)
  const analyticsRequestRef = useRef(0)
  const startupRequestRef = useRef(0)
  const refreshRequestRef = useRef(0)
  const analyticsLoadingRef = useRef(true)
  const startupLoadingRef = useRef(false)
  const startupAttemptedRef = useRef(false)
  const filterStorageKeyRef = useRef(dashboardFilterStorageKey)
  const dashboardExportModulePromiseRef = useRef<Promise<DashboardExportModule> | null>(null)

  const loadDashboardExportModule = useCallback(() => {
    if (!dashboardExportModulePromiseRef.current) {
      dashboardExportModulePromiseRef.current = import('./dashboardExport.ts')
    }
    return dashboardExportModulePromiseRef.current
  }, [])

  const setAnalyticsLoading = useCallback((value: boolean) => {
    analyticsLoadingRef.current = value
    setALoading(value)
  }, [])

  const openInventoryOverview = useCallback((stockState: InventoryStockFocus = 'all') => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DASHBOARD_INVENTORY_FOCUS_KEY, JSON.stringify({
        section: 'products',
        tab: 'products',
        stockFilter: stockState,
      }))
    }
    setProductDetail(null)
    // E1: the inventory page id retired into the Branches hub -- the focus
    // payload written above still targets Inventory (the hub peeks it to
    // open the Products chip; Inventory consumes it exactly as before).
    navigateTo('branches')
  }, [navigateTo])

  const getCurrentDashboardRange = useCallback(() => {
    const preset = RANGE_PRESETS.find(r => r.id === rangeId)
    if (preset?.getRange) {
      const range = preset.getRange()
      return { start: range.start, end: range.end, granularity: range.gran }
    }
    return { start: customStart, end: customEnd, granularity: 'day' as DashboardGranularity }
  }, [customEnd, customStart, rangeId]) // eslint-disable-line

  const loadDashboardStartup = useCallback(async () => {
    const requestId = beginTrackedRequest(startupRequestRef)
    startupLoadingRef.current = true
    startupAttemptedRef.current = true
    setLoading(true)
    setAnalyticsLoading(true)
    const { start, end, granularity: gran } = getCurrentDashboardRange()
    try {
      const data = await withLoaderTimeout(
        () => getDashboardApi().getDashboardStartup({ startDate: start, endDate: end, granularity: gran }),
        'Dashboard startup',
        DASHBOARD_STARTUP_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(startupRequestRef, requestId)) return null
      const payload = data && typeof data === 'object' ? data as { summary?: unknown; analytics?: unknown } : {}
      const normalizedSummary = normalizeDashboardSummaryPayload(payload.summary)
      const normalizedAnalytics = normalizeDashboardAnalyticsPayload(payload.analytics)
      if (!normalizedSummary || !isDashboardSummaryPayload(normalizedSummary)) {
        throw new Error('Dashboard startup returned incomplete summary data.')
      }
      if (!normalizedAnalytics || !isDashboardAnalyticsPayload(normalizedAnalytics)) {
        throw new Error('Dashboard startup returned incomplete analytics data.')
      }
      setSummary(normalizedSummary)
      setAnalytics(normalizedAnalytics)
      setSummaryError('')
      setAnalyticsError('')
      return data
    } catch (error) {
      if (!isTrackedRequestCurrent(startupRequestRef, requestId)) return null
      const message = isInvalidSessionError(error)
        ? 'Please sign in again to continue.'
        : getErrorMessage(error, 'Dashboard startup failed to load.')
      if (!isInvalidSessionError(error)) {
        console.error('[Dashboard] startup failed:', message)
      }
      setSummaryError(message)
      setAnalyticsError(message)
      return null
    } finally {
      startupLoadingRef.current = false
      if (isTrackedRequestCurrent(startupRequestRef, requestId)) {
        setLoading(false)
        setAnalyticsLoading(false)
      }
    }
  }, [getCurrentDashboardRange, setAnalyticsLoading])

  const loadSummary = useCallback(async ({
    label = 'Dashboard summary',
    markLoading = false,
  }: { label?: string; markLoading?: boolean } = {}) => {
    const requestId = beginTrackedRequest(summaryRequestRef)
    if (markLoading) setLoading(true)
    try {
      const data = await withLoaderTimeout(() => getDashboardApi().getDashboard(), label, DASHBOARD_SUMMARY_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(summaryRequestRef, requestId)) return null
      const normalized = normalizeDashboardSummaryPayload(data)
      if (!normalized || !isDashboardSummaryPayload(normalized)) {
        throw new Error('Dashboard summary returned incomplete data.')
      }
      setSummary(normalized)
      setSummaryError('')
      return data
    } catch (error) {
      if (!isTrackedRequestCurrent(summaryRequestRef, requestId)) return null
      if (isInvalidSessionError(error)) {
        setSummaryError('Please sign in again to continue.')
        return null
      }
      console.error('[Dashboard] getDashboard failed:', getErrorMessage(error, 'Dashboard summary failed to load.'))
      setSummaryError(getErrorMessage(error, 'Dashboard summary failed to load.'))
      return null
    } finally {
      if (markLoading && isTrackedRequestCurrent(summaryRequestRef, requestId)) {
        setLoading(false)
      }
    }
  }, [])

  const loadAnalytics = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = beginTrackedRequest(analyticsRequestRef)
    const shouldClearLoading = !silent || analyticsLoadingRef.current
    if (!silent) setAnalyticsLoading(true)
    const { start, end, granularity: gran } = getCurrentDashboardRange()
    try {
      const data = await withLoaderTimeout(
        () => getDashboardApi().getAnalytics({ startDate: start, endDate: end, granularity: gran }),
        'Dashboard analytics',
        DASHBOARD_ANALYTICS_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(analyticsRequestRef, requestId)) return null
      const normalized = normalizeDashboardAnalyticsPayload(data)
      if (!normalized || !isDashboardAnalyticsPayload(normalized)) {
        throw new Error('Dashboard analytics returned incomplete data.')
      }
      setAnalytics(normalized)
      setAnalyticsError('')
      return data
    } catch (error) {
      if (!isTrackedRequestCurrent(analyticsRequestRef, requestId)) return null
      if (isInvalidSessionError(error)) {
        setAnalyticsError('Please sign in again to continue.')
        return null
      }
      console.error('[Dashboard] getAnalytics failed:', getErrorMessage(error, 'Dashboard analytics failed to load.'))
      setAnalyticsError(getErrorMessage(error, 'Dashboard analytics failed to load.'))
      return null
    } finally {
      if (shouldClearLoading && isTrackedRequestCurrent(analyticsRequestRef, requestId)) {
        setAnalyticsLoading(false)
      }
    }
  }, [getCurrentDashboardRange, setAnalyticsLoading])

  useEffect(() => {
    if (filterStorageKeyRef.current === dashboardFilterStorageKey) return
    filterStorageKeyRef.current = dashboardFilterStorageKey
    const nextPrefs = readDashboardFilterPrefs([dashboardFilterStorageKey, DASHBOARD_FILTER_STORAGE_FALLBACK_KEY])
    setRangeId(normalizeDashboardRangeId(nextPrefs?.rangeId || 'month'))
    setCustomStart(nextPrefs?.customStart || offsetDate(-29))
    setCustomEnd(nextPrefs?.customEnd || todayStr())
  }, [dashboardFilterStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !dashboardFilterStorageKey) return
    try {
      const serialized = JSON.stringify({
        rangeId,
        customStart,
        customEnd,
      })
      window.localStorage.setItem(dashboardFilterStorageKey, serialized)
      window.localStorage.setItem(DASHBOARD_FILTER_STORAGE_FALLBACK_KEY, serialized)
    } catch {
      // Ignore persistence failures and keep the dashboard usable.
    }
  }, [customEnd, customStart, dashboardFilterStorageKey, rangeId])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(startupRequestRef)
      invalidateTrackedRequest(summaryRequestRef)
      invalidateTrackedRequest(refreshRequestRef)
      startupLoadingRef.current = false
      setLoading(false)
      setSilentRefresh(false)
      return
    }

    if (summary == null && analytics == null && !startupAttemptedRef.current) {
      void loadDashboardStartup()
      return
    }
    if (startupLoadingRef.current) return

    void loadSummary({
      markLoading: summary == null,
    })
  }, [isActive, loadSummary]) // eslint-disable-line

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(analyticsRequestRef)
      setAnalyticsLoading(false)
      return
    }

    if (startupLoadingRef.current) return
    if (summary == null && analytics == null && !startupAttemptedRef.current) return

    void loadAnalytics({
      silent: summary != null,
    })
  }, [isActive, loadAnalytics, setAnalyticsLoading])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const ch = syncChannel.channel
    // 'dashboard' itself is one of the channels a completed background
    // import broadcasts (see importJobRefresh.ts's
    // getImportCompletionRefreshChannels) -- it was missing from this list,
    // so on the (common) case where 'dashboard' happened to be the last of
    // several same-tick channel events to settle, the Dashboard would end
    // up NOT refreshing even though earlier channels in the same batch
    // (products/inventory/sales) usually did trigger a refresh moments
    // before. Listing it explicitly closes that gap instead of relying on
    // a sibling channel happening to still be "in flight".
    if (ch === 'sales' || ch === 'products' || ch === 'returns' || ch === 'inventory' || ch === 'dashboard') {
      const refreshId = beginTrackedRequest(refreshRequestRef)
      setSilentRefresh(true)
      Promise.allSettled([
        loadSummary({ label: 'Dashboard summary refresh' }),
        loadAnalytics({ silent: true }),
      ]).finally(() => {
        if (isTrackedRequestCurrent(refreshRequestRef, refreshId)) {
          setSilentRefresh(false)
        }
      })
    }
  }, [isActive, loadAnalytics, loadSummary, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    invalidateTrackedRequest(summaryRequestRef)
    invalidateTrackedRequest(analyticsRequestRef)
    invalidateTrackedRequest(refreshRequestRef)
  }, [])

  // "Recent imports" card -- a lightweight, independent fetch of the last
  // few import files/jobs (any type), regardless of whether they had any
  // warnings. This used to only surface jobs with warning_count > 0 under
  // an "Import warnings" heading -- narrower than useful (a routine,
  // warning-free import had no trace here at all) and framed around
  // warnings specifically rather than "here are your recent import
  // files, open one to see its report". Deliberately not folded into
  // loadSummary/loadAnalytics above -- this doesn't depend on the
  // date-range filter those use, and a failure here shouldn't block the
  // rest of the dashboard from rendering.
  const mapRecentImportJobs = (result: unknown): ImportFileSummary[] => {
    const jobs = Array.isArray((result as { jobs?: unknown })?.jobs) ? (result as { jobs: Record<string, unknown>[] }).jobs : []
    return jobs.map((j) => ({
      id: String(j.id),
      type: (j.type as string) ?? null,
      status: (j.status as string) ?? null,
      warning_count: Number(j.warning_count) || 0,
      created_at: (j.created_at as string) ?? null,
      fileName: (j.file_name as string) ?? null,
    })) as ImportFileSummary[]
  }

  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    const loadRecentImportFiles = () => {
      listImportJobs({ limit: 5 })
        .then((result) => {
          if (cancelled) return
          setRecentImportFiles(mapRecentImportJobs(result))
        })
        .catch(() => { /* non-critical widget -- silently leave the list as-is on failure, the card itself still renders with a no-data/error-tolerant state below */ })
        .finally(() => { if (!cancelled) setRecentImportFilesLoading(false) })
    }
    loadRecentImportFiles()
    const onActivity = () => loadRecentImportFiles()
    window.addEventListener('import-job:activity', onActivity)
    // A job that finishes purely from background polling (nobody in this
    // tab triggered it -- 'import-job:activity' only fires for actions the
    // current tab itself initiated, see notifyImportJobActivity in
    // importJobsTransport.ts) never fires that event, so this card could
    // sit stale even after a real import completed elsewhere. Piggyback on
    // the same sync-channel signal the rest of the Dashboard reacts to
    // above (see the effect right below this one).
    return () => {
      cancelled = true
      window.removeEventListener('import-job:activity', onActivity)
    }
  }, [isActive])

  // Real bug found here: this used to gate on
  // `syncChannel?.channel !== 'dashboard'` -- but 'dashboard' was never a
  // real channel name to begin with (see durable-objects/broadcastHub.ts's
  // own `BroadcastChannel` union: it isn't in the list), and nothing on
  // the backend ever broadcasts one (lib/importEngine.ts's own import-
  // completion broadcast sends 'sales', 'inventory', or 'products' --
  // never 'dashboard'). So this effect was dead code: it could never
  // fire from a real completion, only from this tab's own
  // 'import-job:activity' event above -- meaning an import finished by
  // another tab, another device, or purely via background polling never
  // refreshed this card at all, and it could sit empty or stale for the
  // rest of the session. Listening for the channels that are actually
  // broadcast fixes that. Also guarded with the same `cancelled` pattern
  // as the effect above -- this one had none, so a slower-to-resolve
  // request from an earlier sync tick could land after (and stomp on) a
  // newer one.
  const IMPORT_RELATED_SYNC_CHANNELS = new Set(['products', 'inventory', 'sales', 'customers', 'suppliers', 'deliveryContacts'])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel || !IMPORT_RELATED_SYNC_CHANNELS.has(syncChannel.channel)) return
    let cancelled = false
    listImportJobs({ limit: 5 })
      .then((result) => {
        if (cancelled) return
        setRecentImportFiles(mapRecentImportJobs(result))
      })
      .catch(() => { /* non-critical widget -- silently leave it as-is on failure */ })
    return () => { cancelled = true }
  }, [isActive, syncChannel?.channel, syncChannel?.ts])

  const profit    = (summary?.cost_out || 0) - (summary?.cost_in || 0)
  const summaryReady = isDashboardSummaryPayload(summary)
  const analyticsReady = isDashboardAnalyticsPayload(analytics)
  const summaryUnavailable = !loading && !summaryReady
  const analyticsPending = !analyticsReady && aLoading
  const analyticsUnavailable = !analyticsReady && !aLoading
  const staleSummaryNotice = summaryReady && summaryError
  const staleAnalyticsNotice = analyticsReady && analyticsError
  const calcTrend = (curr: number, prev: number) => (!prev || prev === 0) ? undefined : ((curr - prev) / prev) * 100
  const aRevenue  = analytics?.totals?.revenue_usd || 0
  const aGrossSales = analytics?.totals?.gross_sales_usd || 0
  const aDiscounts = analytics?.totals?.discount_usd || 0
  const aStoreDiscounts = analytics?.totals?.store_discount_usd || 0
  const aMemberDiscounts = analytics?.totals?.membership_discount_usd || Math.max(0, aDiscounts - aStoreDiscounts)
  const aTax = analytics?.totals?.tax_usd || 0
  const aDelivery = analytics?.totals?.delivery_usd || 0
  const aStockValue = summary?.stock_value_usd || 0
  const lowStockCount = summary?.low_stock_count ?? summary?.low_stock?.length ?? 0
  const outOfStockCount = summary?.out_of_stock_count ?? summary?.out_of_stock?.length ?? 0
  const lowStockPreviewLimit = Number(summary?.low_stock_preview_limit || summary?.low_stock?.length || 0)
  const outOfStockPreviewLimit = Number(summary?.out_of_stock_preview_limit || summary?.out_of_stock?.length || 0)
  const lowStockPreviewTruncated = !!summary?.low_stock_preview_truncated
  const outOfStockPreviewTruncated = !!summary?.out_of_stock_preview_truncated
  const aStoreDelivery = analytics?.totals?.store_delivery_usd || 0
  // P6: actual courier money out vs what customers were charged --
  // staff-only figures (this whole page is permission-gated), never on
  // receipts. Count vs sale-count makes a partial record visible.
  const aDeliveryActual = analytics?.totals?.delivery_actual_cost_usd || 0
  const aDeliveryActualCount = analytics?.totals?.delivery_actual_cost_count || 0
  const aDeliverySales = analytics?.totals?.delivery_sale_count || 0
  const aDeliveryMargin = analytics?.totals?.delivery_margin_usd ?? (aDelivery - aDeliveryActual)
  const aPrevRevenue = analytics?.prevTotals?.revenue_usd || 0
  const aTxCount  = analytics?.totals?.tx_count || 0
  const aPrevTxCount = analytics?.prevTotals?.tx_count || 0
  const aProfit   = analytics?.totals?.profit_usd || 0
  const aCost     = analytics?.totals?.cost_usd   || 0
  const aAvgOrder = analytics?.totals?.avg_order_usd || 0
  // "What actually changed hands" = net revenue + tax + customer-paid
  // delivery (the kernel exposes it; fall back to the sum for an older
  // payload). Used as the Transactions card's collected-total drill line.
  const aCollected = analytics?.totals?.collected_total_usd ?? (aRevenue + aTax + aDelivery)
  const aProductCount = summary?.product_count || 0
  const aDiscountRate = aGrossSales > 0 ? (aDiscounts / aGrossSales) * 100 : 0
  const aAvgStockValue = aProductCount > 0 ? aStockValue / aProductCount : 0
  const aReturns   = analytics?.periodReturns?.return_count  || 0
  const aRefundUsd = analytics?.periodReturns?.refund_usd    || 0
  const aItemsRet  = analytics?.periodReturns?.items_returned || 0
  const aSupplierReturns = analytics?.periodSupplierReturns?.return_count || 0
  const aSupplierLossUsd = analytics?.periodSupplierReturns?.loss_usd || 0
  const chartData = analytics?.periodData || []
  const chartRenderData = useMemo(() => downsampleChartRows(chartData), [chartData])
  const topList   = topMode === 'qty' ? (analytics?.topProductsQty || []) : (analytics?.topProducts || [])
  const revenueFlowLabel = translateOr('revenue_flow', 'Revenue Flow')
  const grossSalesLabel = translateOr('gross_sales', 'Gross Sales')
  const netRevenueLabel = translateOr('net_revenue', 'Net Revenue')
  const refundsLabel = translateOr('refunds', 'Refunds')
  const salesCountLabel = translateOr('sales_count', 'Sales Count')
  const stockValueFormulaText = translateOr('dashboard_formula_stock_value', 'Stock value = quantity on hand x unit cost')
  const revenueFormulaText = translateOr('dashboard_formula_revenue', 'Net revenue = Gross sales - Discounts - Refunds')
  const collectedFormulaText = translateOr('dashboard_formula_collected_total', 'Collected total = Net revenue + Tax + Delivery')
  const storeDiscountFormulaText = translateOr('dashboard_formula_store_discounts', 'Store discounts are the cashier-entered sale discounts and product promotions.')
  const profitFormulaText = translateOr('dashboard_formula_profit', 'Profit = Net revenue - COGS - Store-paid delivery')
  const avgOrderFormulaText = translateOr('dashboard_formula_avg_order', 'Average order = Net revenue / transaction count')
  const returnsFormulaText = translateOr('dashboard_formula_returns', 'Returns decrease net revenue and loyalty points')
  const revenueExampleText = `${fmtUSD(aRevenue)} = ${fmtUSD(aGrossSales)} - ${fmtUSD(aDiscounts)} - ${fmtUSD(aRefundUsd)}`
  const collectedExampleText = `${fmtUSD(aRevenue + aTax + aDelivery)} = ${fmtUSD(aRevenue)} + ${fmtUSD(aTax)} + ${fmtUSD(aDelivery)}`
  const rangeLabel = (() => {
    const p = RANGE_PRESETS.find(r => r.id === rangeId)
    if (p?.getRange) { const r = p.getRange(); return `${r.start} - ${r.end}` }
    return `${customStart} - ${customEnd}`
  })()

  const periodShort = (() => {
    const map = {
      today: translateOr('range_today', 'Today'),
      '7d': translateOr('range_7d', 'Last 7 days'),
      month: translateOr('range_this_month', 'This month'),
      year: translateOr('range_this_year', 'This year'),
      custom: translateOr('range_custom', 'Custom'),
    }
    return map[rangeId] || `${customStart} - ${customEnd}`
  })()
  const lowShortLabel = translateOr('low_stock_short', 'Low')
  const outShortLabel = translateOr('out_of_stock_short', 'Out')
  const matchStockShortLabel = translateOr('matching_stock_short', 'Matching')
  const storeShortLabel = translateOr('store_discounts_short', 'Store')
  const memberShortLabel = translateOr('membership_short', 'Mem')
  const refundShortLabel = translateOr('refunded_short', 'Refund')
  const itemsShortLabel = translateOr('items_short', 'itm')
  const grossShortLabel = translateOr('gross_short', 'Gross')
  const saleShortLabel = translateOr('sale_short', 'sale')
  const marginShortLabel = translateOr('profit_margin_short', 'margin')
  const completedStatusLabel = translateOr('completed', 'Completed')
  const pendingStatusLabel = translateOr('pending', 'Pending')
  const refundedStatusLabel = translateOr('refunded', 'Refunded')

  const formatSaleStatus = useCallback((status: unknown) => {
    const key = String(status || '').toLowerCase()
    if (key === 'refunded' || key === 'returned') return refundedStatusLabel
    if (key === 'pending' || key === 'draft') return pendingStatusLabel
    return completedStatusLabel
  }, [completedStatusLabel, pendingStatusLabel, refundedStatusLabel])

  const openHourDetail = useCallback((hourStat: DashboardHourRow | null | undefined, rank: number | null = null) => {
    if (!hourStat) return
    setKpiDetail({
      id: `hour-${hourStat.hour}`,
      label: `${translateOr('best_hour', 'Best hour')} - ${formatDashboardHourLabel(hourStat.hour)}`,
      details: [
        { label: translateOr('time_window', 'Time window'), value: `${String(hourStat.hour).padStart(2, '0')}:00 - ${String((Number(hourStat.hour) + 1) % 24).padStart(2, '0')}:00` },
        { label: translateOr('local_time', 'Local time'), value: formatDashboardHourLabel(hourStat.hour) },
        { label: translateOr('transactions', 'Transactions'), value: Number(hourStat.count || 0) },
        { label: translateOr('revenue', 'Revenue'), value: fmtUSD(hourStat.revenue_usd || 0) },
        rank ? { label: translateOr('rank', 'Rank'), value: `#${rank}` } : null,
      ].filter(Boolean) as Array<{ label: ReactNode; value: ReactNode }>,
    })
  }, [fmtUSD, translateOr])

  const periodKpis = useMemo(() => ([
      {
        id: 'products',
        info: translateOr('dash_info_products', "How many products you carry. A group of same-name items counts as ONE product, matching how the Products list pages them."),
        label: translateOr('products', 'Products'),
        value: summary?.product_count || 0,
        sub: `${lowStockCount} ${lowShortLabel} | ${outOfStockCount} ${outShortLabel}`,
      details: [
        { label: translateOr('products_total', 'Products'), value: summary?.product_count || 0 },
        { label: translateOr('in_stock', 'In stock'), value: summary?.in_stock_count || 0 },
        { label: translateOr('low_stock', 'Low stock'), value: lowStockCount },
        { label: translateOr('out_of_stock', 'Out of stock'), value: outOfStockCount },
        { label: translateOr('product_expiry_alerts', 'Expiry alerts'), value: summary?.expiring_count ?? summary?.expiring_products?.length ?? 0 },
      ],
    },
    {
      id: 'stock-value',
      info: translateOr('dash_info_stock_value', "What the stock you are holding right now cost you to buy. Not what it will sell for."),
      label: translateOr('stock_value', 'Stock value'),
      value: fmtUSD(aStockValue),
      color: 'text-cyan-600',
      sub: matchStockShortLabel,
      // Evened out (user, Aug 29): the money on the shelf plus what's behind
      // it -- average value per product and the risk counts (low/out) -- so
      // this card carries a real drill instead of two lines.
      details: [
        { label: translateOr('stock_value', 'Stock value'), value: fmtUSD(aStockValue) },
        { label: translateOr('avg_value_per_product', 'Avg value / product'), value: fmtUSD(aAvgStockValue) },
        { label: translateOr('low_stock', 'Low stock'), value: lowStockCount },
        { label: translateOr('out_of_stock', 'Out of stock'), value: outOfStockCount },
      ],
    },
    {
      id: 'revenue',
      // Part 388: expressive/expression-based info -- the FORMULA with this
      // period's real numbers substituted, not prose alone. COGS is merged
      // into this card (its standalone card showed a single row).
      info: `${translateOr('dash_info_revenue', "Money actually kept from sales in this period: gross sales, minus discounts and refunds.")}

${translateOr('revenue_short', 'Revenue')} ${fmtUSD(aRevenue)} = ${translateOr('gross_revenue', 'Gross')} ${fmtUSD(aGrossSales)} − ${translateOr('discounts', 'Discounts')} ${fmtUSD(aDiscounts)}`,
      label: translateOr('revenue', 'Revenue'),
      value: fmtUSD(aRevenue),
      sub: `${grossShortLabel} ${fmtUSD(aGrossSales)}`,
      color: 'text-green-600',
      trend: calcTrend(aRevenue, aPrevRevenue),
      // Slimmed (user, Aug 29 -- "too many folded stats inside, i want it
      // less"): the core money-in story only. COGS + Gross profit live in
      // the Profit card; the delivery lines moved to their own outer
      // Delivery card below (which also makes the outer count EVEN at 8).
      details: [
        { label: translateOr('revenue', 'Net revenue'), value: fmtUSD(aRevenue) },
        { label: translateOr('gross_revenue', 'Gross revenue'), value: fmtUSD(aGrossSales) },
        { label: translateOr('discounts', 'Discounts'), value: fmtUSD(aDiscounts) },
        { label: translateOr('total_refunded', 'Refunds'), value: fmtUSD(aRefundUsd) },
        { label: translateOr('tax_collected', 'Tax'), value: fmtUSD(aTax) },
      ],
    },
    {
      id: 'discounts',
      info: translateOr('dash_info_discounts', "Money given away in this period: shop discounts plus member points redeemed."),
      label: translateOr('discounts_combined', 'Discounts'),
      value: fmtUSD(aDiscounts),
      sub: `${storeShortLabel} ${fmtUSD(aStoreDiscounts)} | ${memberShortLabel} ${fmtUSD(aMemberDiscounts)}`,
      color: aStoreDiscounts > 0 ? 'text-amber-600' : 'text-gray-500',
      details: [
        { label: translateOr('discounts', 'Discounts'), value: fmtUSD(aDiscounts) },
        { label: translateOr('store_discounts', 'Store discounts'), value: fmtUSD(aStoreDiscounts) },
        { label: translateOr('membership_discounts', 'Membership discounts'), value: fmtUSD(aMemberDiscounts) },
        { label: translateOr('discount_rate', 'Discount rate'), value: `${aDiscountRate.toFixed(1)}%` },
      ],
    },
    // The standalone COGS card is gone (Part 388: it held a single row --
    // "cogs only shows one stat inside"); COGS now lives inside Revenue
    // above and in Profit's own formula below.
    {
      id: 'profit',
      info: `${translateOr('dash_info_profit', "What is left after subtracting what the goods cost you from what you kept.")}

${translateOr('gross_profit', 'Gross profit')} ${fmtUSD(aProfit)} = ${translateOr('revenue_short', 'Revenue')} ${fmtUSD(aRevenue)} − ${translateOr('cogs', 'COGS')} ${fmtUSD(aCost)} − ${translateOr('store_paid_delivery', 'Store-paid delivery')} ${fmtUSD(aStoreDelivery)}
${translateOr('profit_margin', 'Margin')} = ${translateOr('gross_profit', 'Profit')} ÷ ${translateOr('revenue_short', 'Revenue')} = ${aRevenue > 0 ? ((aProfit / aRevenue) * 100).toFixed(2) : '0.00'}%`,
      label: translateOr('gross_profit', 'Gross Profit'),
      value: fmtUSD(aProfit),
      color: aProfit >= 0 ? 'text-blue-600' : 'text-red-600',
      sub: aRevenue > 0 ? `${((aProfit / aRevenue) * 100).toFixed(1)}% ${marginShortLabel}` : '',
      // Evened out (user, Aug 29): dropped the duplicate "Revenue" line (it
      // headlines its own card) -- the profit formula's own parts remain.
      details: [
        { label: translateOr('est_profit', 'Est. profit'), value: fmtUSD(aProfit) },
        { label: translateOr('cogs', 'COGS'), value: fmtUSD(aCost) },
        { label: translateOr('store_paid_delivery', 'Store-paid delivery'), value: fmtUSD(aStoreDelivery) },
        { label: translateOr('profit_margin', 'Profit margin'), value: aRevenue > 0 ? `${((aProfit / aRevenue) * 100).toFixed(2)}%` : '0.00%' },
      ],
    },
    {
      id: 'transactions',
      info: translateOr('dash_info_transactions', "How many completed sales happened in this period."),
      label: translateOr('transactions', 'Transactions'),
      value: aTxCount,
      sub: `${translateOr('avg_short', 'Avg')} ${fmtUSD(aAvgOrder)}/${saleShortLabel}`,
      trend: calcTrend(aTxCount, aPrevTxCount),
      // Evened out (user, Aug 29): the activity card now carries how many of
      // those sales were deliveries and the collected total (what actually
      // changed hands = net revenue + tax + delivery), not just count + avg.
      details: [
        { label: translateOr('transactions', 'Transactions'), value: aTxCount },
        { label: translateOr('avg_order_value', 'Avg order'), value: fmtUSD(aAvgOrder) },
        { label: translateOr('deliveries', 'Deliveries'), value: aDeliverySales },
        { label: translateOr('collected_total', 'Collected total'), value: fmtUSD(aCollected) },
      ],
    },
    {
      id: 'returns',
      // Part 388: the net-sold story merges into Returns -- what left the
      // shop, minus what came back, expressed as the formula with this
      // period's numbers.
      info: `${translateOr('dash_info_returns', "Items customers brought back in this period, and what you refunded for them.")}

${translateOr('net_revenue_after_refunds', 'Net after refunds')} ${fmtUSD(aRevenue - aRefundUsd)} = ${translateOr('revenue_short', 'Revenue')} ${fmtUSD(aRevenue)} − ${translateOr('total_refunded', 'Refunded')} ${fmtUSD(aRefundUsd)}`,
      label: translateOr('returns_count', 'Returns'),
      value: aReturns,
      color: aReturns > 0 ? 'text-orange-600' : 'text-gray-500',
      sub: aReturns > 0 ? `${refundShortLabel} ${fmtUSD(aRefundUsd)} | ${aItemsRet} ${itemsShortLabel}` : translateOr('no_returns', 'No returns'),
      // Evened out (user, Aug 29): customer + supplier returns in one balanced
      // drill. Supplier count + its money loss fold into one line; the
      // derivable "net after refunds" (shown in the chart + the info formula)
      // drops from the drill.
      details: [
        { label: translateOr('customer_returns', 'Customer returns'), value: aReturns },
        { label: translateOr('items', 'Items'), value: aItemsRet },
        { label: translateOr('total_refunded', 'Refunded'), value: fmtUSD(aRefundUsd) },
        { label: `${translateOr('supplier_returns', 'Supplier returns')} (${aSupplierReturns})`, value: fmtUSD(aSupplierLossUsd) },
      ],
    },
    // Promoted to its own outer card (user, Aug 29): pulled out of Revenue's
    // folded list so Revenue reads less AND the outer count is even (8). The
    // customer-charged fee is the headline; actual courier cost + margin +
    // store-absorbed delivery are the drill (P6 -- staff-only, never on
    // receipts, and cost never touches Profit).
    {
      id: 'delivery',
      info: `${translateOr('dash_info_delivery', "Delivery in this period: what customers were charged, what the couriers actually cost, and the margin between them.")}

${translateOr('delivery_margin', 'Delivery margin')} ${fmtUSD(aDeliveryMargin)} = ${translateOr('delivery_fees', 'Delivery fees')} ${fmtUSD(aDelivery)} − ${translateOr('delivery_actual_cost', 'Actual delivery cost')} ${fmtUSD(aDeliveryActual)}`,
      label: translateOr('delivery', 'Delivery'),
      value: fmtUSD(aDelivery),
      color: 'text-violet-600',
      sub: `${translateOr('margin_short', 'Margin')} ${fmtUSD(aDeliveryMargin)}`,
      details: [
        { label: translateOr('delivery_fees', 'Delivery fees'), value: fmtUSD(aDelivery) },
        {
          label: translateOr('delivery_actual_cost', 'Actual delivery cost'),
          value: `${fmtUSD(aDeliveryActual)}${aDeliverySales > 0 && aDeliveryActualCount < aDeliverySales ? ` (${aDeliveryActualCount}/${aDeliverySales} ${translateOr('recorded_short', 'recorded')})` : ''}`,
        },
        { label: translateOr('delivery_margin', 'Delivery margin'), value: fmtUSD(aDeliveryMargin) },
        { label: translateOr('store_paid_delivery', 'Store-paid delivery'), value: fmtUSD(aStoreDelivery) },
      ],
    },
  ]), [
    aStoreDelivery,
    aDelivery,
    aDeliveryActual,
    aDeliveryActualCount,
    aDeliveryMargin,
    aDeliverySales,
    aCollected,
    aDiscountRate,
    aAvgStockValue,
    aCost,
    aDelivery,
    aDiscounts,
    aGrossSales,
    aItemsRet,
    aMemberDiscounts,
    aPrevRevenue,
    aPrevTxCount,
    aProfit,
    aRefundUsd,
    aReturns,
    aRevenue,
    aStockValue,
    aStoreDiscounts,
    aSupplierLossUsd,
    aSupplierReturns,
    aTax,
    aTxCount,
    avgOrderFormulaText,
    collectedExampleText,
    collectedFormulaText,
    fmtUSD,
    grossShortLabel,
    itemsShortLabel,
    lowShortLabel,
    lowStockCount,
    marginShortLabel,
    matchStockShortLabel,
    memberShortLabel,
    outOfStockCount,
    outShortLabel,
    profitFormulaText,
    refundShortLabel,
    returnsFormulaText,
    revenueExampleText,
    revenueFormulaText,
    saleShortLabel,
    stockValueFormulaText,
    storeDiscountFormulaText,
    summary?.expiring_count,
    summary?.expiring_products?.length,
    summary?.in_stock_count,
    summary?.product_count,
    translateOr,
  ])

  const exportStamp = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const buildDashboardExportContext = useCallback(() => ({
    activeChart,
    analytics,
    chartData,
    collectedExampleText,
    collectedFormulaText,
    exportStamp,
    fmtUSD,
    grossSalesLabel,
    lowStockCount,
    netRevenueLabel,
    outOfStockCount,
    periodKpis,
    periodShort,
    profitLabel: t('profit') || 'Profit',
    rangeLabel,
    refundsLabel,
    revenueExampleText,
    revenueFormulaText,
    summary,
    topList,
    topMode,
    translateOr,
  }), [
    activeChart,
    analytics,
    chartData,
    collectedExampleText,
    collectedFormulaText,
    exportStamp,
    fmtUSD,
    grossSalesLabel,
    lowStockCount,
    netRevenueLabel,
    outOfStockCount,
    periodKpis,
    periodShort,
    rangeLabel,
    refundsLabel,
    revenueExampleText,
    revenueFormulaText,
    summary,
    t,
    topList,
    topMode,
    translateOr,
  ])

  const lowStockPreviewLabel = lowStockPreviewTruncated
    ? `${lowStockPreviewLimit} / ${lowStockCount} ${t('items') || 'items'}`
    : `${lowStockCount} ${t('items') || 'items'}`
  const outOfStockPreviewLabel = outOfStockPreviewTruncated
    ? `${outOfStockPreviewLimit} / ${outOfStockCount} ${t('items') || 'items'}`
    : `${outOfStockCount} ${t('items') || 'items'}`

  const buildExportAll = useCallback(async () => {
    const { exportDashboardFull } = await loadDashboardExportModule()
    exportDashboardFull(buildDashboardExportContext())
  }, [buildDashboardExportContext, loadDashboardExportModule])

  const exportDashboardStats = useCallback(async () => {
    const { exportDashboardStats: exportStats } = await loadDashboardExportModule()
    exportStats(buildDashboardExportContext())
  }, [buildDashboardExportContext, loadDashboardExportModule])

  const exportDashboardPackage = useCallback(async () => {
    const { exportDashboardPackage: exportPackage } = await loadDashboardExportModule()
    await exportPackage(buildDashboardExportContext())
  }, [buildDashboardExportContext, loadDashboardExportModule])

  // Grouped for ExportChoiceDialog (the float "which export?" page every
  // export button opens now): whole-dashboard bundles first, then the
  // per-section breakdowns.
  const dashboardExportGroups = useMemo(() => [
    {
      id: 'whole',
      label: translateOr('export_group_whole', 'Whole dashboard'),
      choices: [
        { id: 'package', label: t('export_dashboard_package') || 'Export dashboard package', hint: 'ZIP', onClick: exportDashboardPackage },
        { id: 'all', label: t('export_all_report'), hint: 'Excel', onClick: buildExportAll },
        { id: 'kpis', label: t('export_kpi_summary'), hint: 'Excel', onClick: async () => {
          const { exportDashboardKpis } = await loadDashboardExportModule()
          exportDashboardKpis(buildDashboardExportContext())
        } },
        { id: 'stats', label: t('export_dashboard_calculations') || 'Export dashboard stats and calculations', hint: 'Excel', onClick: exportDashboardStats },
      ],
    },
    {
      id: 'sections',
      label: translateOr('export_group_sections', 'By section'),
      choices: [
        { id: 'sales-chart', label: t('export_sales_chart'), hint: 'Excel', onClick: async () => {
          const { exportDashboardSalesChart } = await loadDashboardExportModule()
          exportDashboardSalesChart(buildDashboardExportContext())
        } },
        { id: 'top-products', label: t('export_top_products'), hint: 'Excel', onClick: async () => {
          const { exportDashboardTopProducts } = await loadDashboardExportModule()
          exportDashboardTopProducts(buildDashboardExportContext())
        } },
        { id: 'top-customers', label: t('export_top_customers'), hint: 'Excel', onClick: async () => {
          const { exportDashboardTopCustomers } = await loadDashboardExportModule()
          exportDashboardTopCustomers(buildDashboardExportContext())
        } },
        { id: 'payment-methods', label: t('export_payment_methods'), hint: 'Excel', onClick: async () => {
          const { exportDashboardPaymentMethods } = await loadDashboardExportModule()
          exportDashboardPaymentMethods(buildDashboardExportContext())
        } },
        { id: 'branches', label: t('export_branch_performance'), hint: 'Excel', onClick: async () => {
          const { exportDashboardBranches } = await loadDashboardExportModule()
          exportDashboardBranches(buildDashboardExportContext())
        } },
      ],
    },
  ], [
    buildDashboardExportContext,
    buildExportAll,
    exportDashboardPackage,
    exportDashboardStats,
    loadDashboardExportModule,
    t,
    translateOr,
  ])

  if (summaryUnavailable) {
    return (
      <div className="page-scroll p-3 sm:p-5">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">Dashboard summary unavailable</div>
          <div className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
            {summaryError || 'The dashboard summary did not finish loading. Retry to fetch fresh totals and activity.'}
          </div>
          <button
            type="button"
            className="btn-secondary mt-3 px-3 py-1.5 text-xs"
            onClick={() => {
              void Promise.allSettled([
                loadSummary({ label: 'Dashboard summary retry', markLoading: true }),
                loadAnalytics(),
              ])
            }}
          >
            {refreshLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-scroll p-3 sm:p-5 space-y-4 sm:space-y-5">
      {/* Header */}
      {/* Page title removed: sidebar/nav already identify this page. */}
      {/* Refresh button removed: data already refreshes automatically (see
          silentRefresh indicator below), so a manual control was redundant. */}
      {silentRefresh ? (
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="text-xs text-blue-500 animate-pulse">{t('loading')}</span>
        </div>
      ) : null}

      {(staleSummaryNotice || staleAnalyticsNotice) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-semibold">
            {staleSummaryNotice && staleAnalyticsNotice
              ? 'Showing saved dashboard totals and analytics while refresh finishes.'
              : staleSummaryNotice
                ? 'Showing saved dashboard totals while the latest summary refresh failed.'
                : 'Showing saved dashboard analytics while the latest analytics refresh failed.'}
          </div>
          <div className="mt-0.5 text-[11px] text-amber-800/90 dark:text-amber-200/80">
            {summaryError || analyticsError}
          </div>
        </div>
      ) : null}

      {/* Range selector -- no card wrapper: the range pill and preset chips
          carry their own borders, so boxing them again was a double card. */}
      <div className="px-0.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-2">
          {/* Label + range value + export all share one row -- the range
              value pill previously grew (flex-1) to fill the row on its own
              with nothing but blank pill background to its right; export
              now sits in that same slack space instead of getting its own
              near-empty row below the preset pills. */}
          <div className="flex min-w-0 items-center gap-2 lg:max-w-[22rem]">
            {/* Y19: the Start → End box both SHOWS the effective range (preset
                or custom) and IS the custom editor -- editing it switches to
                the 'custom' rangeId. No "Range:" label: the rectangular,
                full-width box reads as the range on its own. */}
            <div className="min-w-0 flex-1">
              <DateTimeRangePicker
                value={{ startDate: getCurrentDashboardRange().start, endDate: getCurrentDashboardRange().end, startTime: '', endTime: '' } as DateTimeRange}
                onChange={(r) => {
                  setRangeId('custom')
                  if (r.startDate) setCustomStart(r.startDate)
                  if (r.endDate) setCustomEnd(r.endDate)
                }}
                t={t}
                showTime={false}
                triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg px-3.5 py-2"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {RANGE_PRESETS.map(p => (
                <button key={p.id} onClick={() => setRangeId(p.id)}
                className={`min-h-7 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors sm:min-h-8 sm:px-3 sm:text-xs ${rangeId===p.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {p.label}
              </button>
            ))}
            {/* Export rides the preset row (moved from beside the range pill)
                and opens the float export-choices dialog -- no direct
                downloads off a toolbar menu. */}
            {hasPermission('dashboard_export') && (
              <button
                type="button"
                onClick={() => setExportChoicesOpen(true)}
                className="inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-400 sm:min-h-8 sm:px-3 sm:text-xs"
                aria-label={exportLabel}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {exportLabel}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Period KPI cards */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-2 dark:border-blue-900/40 dark:bg-blue-950/20 sm:p-2.5">
          {/* No "PERIOD STATS + preset pill + range text" header any more
              (user, Aug 30 2026): the KPIs always cover exactly the selected
              date range, so the header only restated the range box above it.
              periodShort/rangeLabel still exist -- exports and the KPI drill
              panel use them. */}
          {analyticsPending ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4 sm:gap-2.5">
              {[...Array(8)].map((_, i) => <div key={i} className="card h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-700" />)}
            </div>
          ) : analyticsUnavailable ? (
            <div className="rounded-xl border border-amber-200 bg-white px-3 py-4 text-center text-sm text-amber-900 dark:border-amber-800/70 dark:bg-slate-900 dark:text-amber-100">
              <div className="font-semibold">Analytics unavailable</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {analyticsError || 'The dashboard analytics could not be loaded for this range.'}
              </div>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4 sm:gap-2.5">
              {periodKpis.map((kpi, index) => {
                const isLastOddCard = periodKpis.length % 2 === 1 && index === periodKpis.length - 1
                return (
                <MiniStat
                  key={kpi.id}
                  label={kpi.label}
                  value={kpi.value}
                  sub={kpi.sub}
                  color={kpi.color}
                  trend={kpi.trend}
                  info={(kpi as { info?: string }).info}
                  infoLabel={`${String(kpi.label)} - ${translateOr('what_this_means', 'what this means')}`}
                  onClick={() => setKpiDetail(kpi)}
                  className={isLastOddCard ? 'col-span-2 sm:col-span-1' : ''}
                />
                )
              })}
          </div>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="lg:col-span-2 card p-3 sm:p-3.5">
          <div className="mb-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">{t('analytics')}</h2>
            <div className="inline-flex w-full max-w-full rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/90 sm:w-auto">
              <div className="flex min-w-0 gap-1 overflow-x-auto">
              {([
                ['revenue', revenueFlowLabel],
                ['profit', t('profit_vs_cogs')],
                ['volume', salesCountLabel],
              ] satisfies Array<[DashboardChartMode, string]>).map(([id,lbl]) => (
                <button key={id} onClick={() => setActiveChart(id)}
                  className={`min-h-7 shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors sm:min-h-8 sm:px-3 sm:text-xs ${activeChart===id ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-700 dark:text-white dark:ring-slate-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}>
                  {lbl}
                </button>
              ))}
              </div>
            </div>
          </div>
          {analyticsPending ? <div className="h-52 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-700" />
          : analyticsUnavailable ? <div className="flex h-52 flex-col items-center justify-center rounded-2xl border border-amber-200 bg-amber-50/60 px-4 text-center text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
          : chartRenderData.length === 0 ? <div className="flex h-52 items-center justify-center text-sm text-gray-400">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</div>
          : activeChart === 'revenue' ? (
            <>
              <Suspense fallback={<ChartFallback />}>
                <LineChart data={chartRenderData} lines={[
                  { key:'gross_sales_usd', color:'#0891b2', label: grossSalesLabel },
                  { key:'refund_usd', color:'#f97316', label: refundsLabel },
                  { key:'revenue_usd', color:'#2563eb', label: netRevenueLabel },
                ]} />
              </Suspense>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-cyan-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{grossSalesLabel}</span></div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-orange-500"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{refundsLabel}</span></div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-blue-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{netRevenueLabel}</span></div>
              </div>
            </>
          ) : activeChart === 'profit' ? (
            <>
              <Suspense fallback={<ChartFallback />}>
                <LineChart data={chartRenderData} lines={[{ key:'revenue_usd', color:'#2563eb' },{ key:'cost_usd', color:'#dc2626' },{ key:'profit_usd', color:'#16a34a' }]} />
              </Suspense>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-blue-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{t('revenue')}</span></div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-red-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{t('cogs')}</span></div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-2 w-4 rounded-full bg-green-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{t('profit')}</span></div>
              </div>
            </>
          ) : (
            <>
              <Suspense fallback={<ChartFallback className="h-48" />}>
                <BarChart data={chartRenderData} valueKey="count" labelKey="period" color="#7c3aed" isCount />
              </Suspense>
              <div className="mt-1.5 flex items-center gap-1.5"><div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-2.5 py-1 dark:bg-slate-800/70"><div className="h-3.5 w-3.5 rounded bg-purple-600"/><span className="text-sm font-semibold text-slate-600 dark:text-slate-200">{salesCountLabel}</span></div></div>
            </>
          )}
        </div>

        <RecentSalesCard
          summary={summary}
          t={t}
          translateOr={translateOr}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
          formatStatus={formatSaleStatus}
          onOpenSale={setRecentSaleDetail}
          onViewMore={() => setRecentSalesOpen(true)}
        />
      </div>

      {/* Branches, products, and customers. Deliberately 3 columns on large
          screens, not 4 -- this row only ever renders 3 real cards
          (BestHourCard, Top Products, Top Customers); the two `hidden`
          legacy blocks below are dead markup kept for reference, not a
          4th/5th visible card. A 4-column grid for 3 real cards was
          leaving a full empty column's worth of width unused on large
          screens instead of giving the 3 real cards room to breathe
          (user-reported: "the row of top product, best hour, top customer
          can take more space in large screens"). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Branch */}
        <BestHourCard
          analytics={analytics}
          analyticsPending={analyticsPending}
          analyticsUnavailable={analyticsUnavailable}
          analyticsError={analyticsError}
          showAll={showAllHours}
          setShowAll={setShowAllHours}
          t={t}
          translateOr={translateOr}
          fmtUSD={fmtUSD}
          onOpenHour={openHourDetail}
        />
        <div className="hidden">
          <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-white">{t('branch_performance')}</h2>
          {analyticsPending ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : analyticsUnavailable ? (
            <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
          ) : (() => {
            const all = analytics?.byBranch || []
            const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#0891b2']
            const maxRev = Math.max(...all.map(b=>b.revenue_usd||0), 0.01)
            const vis = showAllBranches ? all : all.slice(0,4)
            return (
              <>
                <div className="space-y-2">
                  {all.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p>
                  : vis.map((b,i) => {
                    const pct = ((b.revenue_usd||0)/maxRev*100).toFixed(0)
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-28">{b.branch_name}</span>
                          <span className="font-medium text-gray-900 dark:text-white">{fmtUSD(b.revenue_usd||0)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width:`${pct}%`, background:COLORS[i%COLORS.length] }} />
                        </div>
                        <div className="text-right text-xs text-gray-400 mt-0.5">{b.count} {t('sale')}</div>
                      </div>
                    )
                  })}
                </div>
                {all.length > 4 && (
                  <button onClick={() => setShowAllBranches(v=>!v)} className="mt-2 w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-1">
                    {showAllBranches ? t('show_less') : `${t('view_all')} ${all.length} ${t('branches')}`}
                  </button>
                )}
              </>
            )
          })()}
        </div>

        {/* Top Products */}
        <div className="card p-3 sm:p-4">
          <div className="flex min-w-0 flex-col items-start gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-base font-semibold text-gray-900 dark:text-white">{t('top_products')}</h2>
            <div className="max-w-full overflow-x-auto pb-0.5">
            {/* Segmented-control style aligned with the Analytics tabs
                above (revenue/profit/volume) instead of this row's own
                separate, cruder bg-gray-100/bg-blue-600 combo -- same
                pill container, same white-chip-on-active look, so the two
                toggles on this page read as one consistent control
                pattern rather than two different ones. The revenue option
                also used to splice a literal "$" character into the
                translated label string (`$ ${t('revenue')}`) -- fragile
                for translation and looked like a stray typo next to the
                text (user-reported: "bad color and button design and the
                icon $"). Replaced with a real DollarSign icon rendered
                next to the label instead of baked into the string. */}
            <div className="inline-flex min-w-max rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/90">
              {([
                ['revenue', t('revenue')],
                ['qty', t('quantity')],
              ] satisfies Array<[DashboardTopMode, string]>).map(([m,lbl]) => (
                <button key={m} onClick={() => setTopMode(m)}
                  className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold leading-tight transition-colors sm:px-3 sm:text-sm ${topMode===m ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-700 dark:text-white dark:ring-slate-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}>
                  {m === 'revenue' ? <DollarSign className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  {lbl}
                </button>
              ))}
            </div>
            </div>
          </div>
          {analyticsPending ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : analyticsUnavailable ? (
            <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
          ) : (
            <>
              <div className="space-y-1.5">
                {topList.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p>
                : (showAllProducts ? topList : topList.slice(0,4)).map((p,i) => {
                  const maxVal = topMode==='qty' ? topList[0]?.qty_sold||1 : topList[0]?.revenue_usd||1
                  const val    = topMode==='qty' ? p.qty_sold || 0 : p.revenue_usd || 0
                  const pct    = (val/maxVal*100).toFixed(0)
                  return (
                    <button
                      key={i}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      onClick={() => setProductDetail({ ...p, insightType: 'top_product', rank: i + 1 })}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400 w-4 text-right">{i+1}.</span>
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-32 sm:max-w-48 lg:max-w-72 xl:max-w-96">{p.product_name}</span>
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {topMode==='qty' ? `${p.qty_sold} ${t('qty_sold')}` : fmtUSD(p.revenue_usd)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width:`${pct}%` }} />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              {topList.length > 4 && (
                <button onClick={() => setShowAllProducts(v=>!v)} className="mt-2 w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-1">
                  {showAllProducts ? t('show_less') : `${t('view_all')} ${topList.length} ${t('products')}`}
                </button>
              )}
            </>
          )}
        </div>

        {/* Top Customers */}
        {(() => {
          const customers = analytics?.topCustomers || []
          const visible   = showAllCustomers ? customers : customers.slice(0,4)
          return (
            <div className="card p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('top_customers')}</h2>
                <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{t('net_of_returns')}</span>
              </div>
              {analyticsPending ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : analyticsUnavailable ? (
                <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
              ) : (
                <>
                  {customers.length === 0
                    ? <p className="text-xs text-gray-400 text-center py-4">{t('no_named_customers')}</p>
                    : (
                      <>
                        <div className="space-y-1.5">
                          {visible.map((c,i) => {
                            const maxRev = customers[0]?.net_revenue_usd || 1
                            const pct = Math.max(2,((c.net_revenue_usd || 0)/maxRev*100)).toFixed(0)
                            return (
                              <button
                                key={i}
                                type="button"
                                className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                onClick={() => setCustomerDetail({ ...c, rank: i + 1 })}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-gray-400 w-4 text-right">{i+1}.</span>
                                      <span className="text-gray-700 dark:text-gray-300 truncate max-w-36">{c.customer_name}</span>
                                    </div>
                                    <span className="font-medium text-green-700 dark:text-green-400">{fmtUSD(c.net_revenue_usd || 0)}</span>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                                    <div className="h-full bg-green-500 rounded-full" style={{ width:`${pct}%` }} />
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                        {customers.length > 4 && (
                          <button onClick={() => setShowAllCustomers(v=>!v)} className="mt-2 w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-1">
                            {showAllCustomers ? t('show_less') : `${t('view_all')} ${customers.length} ${t('customers')}`}
                          </button>
                        )}
                      </>
                    )}
                </>
              )}
            </div>
          )
        })()}
      </div>

      {/* Hours, low stock, and recent activity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Best Hour */}
        <ExpiryAlertsCard summary={summary} showAll={showAllExpiring} setShowAll={setShowAllExpiring} translateOr={translateOr} />
        <div className="hidden">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('best_hour')}</h2>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {translateOr('tap_to_view', 'Tap to view')}
            </span>
          </div>
          {analyticsPending ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : analyticsUnavailable ? (
            <div className="flex h-28 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-center text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100">{analyticsError || 'Analytics unavailable for this range.'}</div>
          ) : (() => {
            const hourly: DashboardHourRow[] = analytics?.hourlyDist || []
            const tzOff  = getBusinessTimezoneOffsetHours()
            const merged: Record<number, DashboardHourRow> = {}
            hourly.forEach(h => {
              const lh = ((Math.round(Number.parseInt(String(h.hour),10)+tzOff))%24+24)%24
              if (!merged[lh]) merged[lh] = { hour:lh, count:0, revenue_usd:0 }
              const bucket = merged[lh]
              bucket.count = (bucket.count || 0) + (Number(h.count)||0)
              bucket.revenue_usd = (bucket.revenue_usd || 0) + (Number.parseFloat(String(h.revenue_usd || 0))||0)
            })
            const maxCount   = Math.max(...Object.values(merged).map(h=>h.count || 0), 1)
            const allHours   = Array.from({length:24},(_,i) => merged[i]||{hour:i,count:0,revenue_usd:0})
            const sortedBusy = Object.values(merged).filter(h=>(h.count || 0)>0).sort((a,b)=>(b.count || 0)-(a.count || 0))
            const visH = showAllHours ? sortedBusy : sortedBusy.slice(0,3)
            return (
              <>
                <div className="relative mb-3">
                  <div className="grid gap-px" style={{ gridTemplateColumns:'repeat(24,1fr)' }}>
                    {allHours.map(h => {
                      const op = (h.count || 0)===0 ? 0.06 : 0.12+(h.count || 0)/maxCount*0.88
                      return (
                        <button
                          key={h.hour}
                          type="button"
                          title={`${String(h.hour).padStart(2,'0')}:00 - ${h.count} ${t('sale')}(s), ${fmtUSD(h.revenue_usd)}`}
                          aria-label={`${translateOr('best_hour', 'Best hour')} ${formatDashboardHourLabel(h.hour)}`}
                          className="rounded-sm transition hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700"
                          style={{ height:40, background:`rgba(37,99,235,${op.toFixed(2)})` }}
                          onClick={() => openHourDetail(h, sortedBusy.findIndex((item) => item.hour === h.hour) + 1 || null)}
                        />
                      )
                    })}
                  </div>
                  <div className="mt-1 flex text-[11px] font-medium text-gray-400" style={{ position:'relative', height:18 }}>
                    {[0,6,12,18,23].map(h => (
                      <span key={h} style={{ position:'absolute', left:`${(h/23)*100}%`, transform:'translateX(-50%)' }}>{formatDashboardHourLabel(h).replace(' ', '')}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  {visH.length===0 && <p className="text-xs text-gray-400 text-center">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p>}
                  {visH.map((h,i) => (
                    <button
                      key={h.hour}
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50/60 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                      onClick={() => openHourDetail(h, i + 1)}
                    >
                      <div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{`#${i + 1} ${formatDashboardHourLabel(h.hour)}`}</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{String(h.hour).padStart(2,'0')}:00 - {String((Number(h.hour) + 1) % 24).padStart(2,'0')}:00</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{h.count} {t('sale')}{h.count!==1?'s':''}</div>
                        <div className="text-[11px] text-green-600 dark:text-green-400">{fmtUSD(h.revenue_usd)}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {sortedBusy.length > 3 && (
                  <button onClick={() => setShowAllHours(v=>!v)} className="mt-2 w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-1">
                    {showAllHours ? t('show_less') : `${t('view_all')} ${sortedBusy.length} ${t('hours')||'hours'}`}
                  </button>
                )}
              </>
            )
          })()}
        </div>

        {/* Low Stock */}
        <div className="card">
          <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-white">{t('low_stock_items')}</h2>
            {lowStockCount > 0 && (
              <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded-full font-medium">{lowStockCount}</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {!summary?.low_stock?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('in_stock')}</p>
              : (showAllLowStock ? summary.low_stock : summary.low_stock.slice(0,5)).map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-4"
                  onClick={() => setProductDetail({ ...p, insightType: 'low_stock' })}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-300">{p.name}</p>
                    {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                  </div>
                  <span className="badge-yellow">{p.stock_quantity} {p.unit}</span>
                </button>
              ))}
          </div>
          {(summary?.low_stock?.length||0) > 5 && !lowStockPreviewTruncated && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setShowAllLowStock(v=>!v)} className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-0.5">
                {showAllLowStock ? t('show_less') : `${t('view_all')} ${summary!.low_stock.length} ${t('items')}`}
              </button>
            </div>
          )}
          {lowStockPreviewTruncated ? (
            <div className="border-t border-gray-100 px-4 py-2 dark:border-gray-700">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span>{translateOr('showing_preview', 'Showing preview')} {lowStockPreviewLabel}</span>
                <button type="button" className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700" onClick={() => openInventoryOverview('low')}>
                  {translateOr('review_in_inventory', 'Review in inventory')}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Out Of Stock */}
        <div className="card">
          <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-white">{t('out_of_stock') || 'Out of stock'}</h2>
            {outOfStockCount > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">{outOfStockCount}</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {!summary?.out_of_stock?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('in_stock')}</p>
              : (showAllOutStock ? summary.out_of_stock : summary.out_of_stock.slice(0,5)).map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-4"
                  onClick={() => setProductDetail({ ...p, insightType: 'out_of_stock' })}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-700 dark:text-gray-300">{p.name}</p>
                    {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                  </div>
                  <span className="badge-red">{p.stock_quantity} {p.unit}</span>
                </button>
              ))}
          </div>
          {(summary?.out_of_stock?.length||0) > 5 && !outOfStockPreviewTruncated && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setShowAllOutStock(v=>!v)} className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-0.5">
                {showAllOutStock ? t('show_less') : `${t('view_all')} ${summary!.out_of_stock.length} ${t('items')}`}
              </button>
            </div>
          )}
          {outOfStockPreviewTruncated ? (
            <div className="border-t border-gray-100 px-4 py-2 dark:border-gray-700">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span>{translateOr('showing_preview', 'Showing preview')} {outOfStockPreviewLabel}</span>
                <button type="button" className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700" onClick={() => openInventoryOverview('out')}>
                  {translateOr('review_in_inventory', 'Review in inventory')}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Expiring Products */}
        <BranchPerformanceCard
          analytics={analytics}
          analyticsPending={analyticsPending}
          analyticsUnavailable={analyticsUnavailable}
          analyticsError={analyticsError}
          showAll={showAllBranches}
          setShowAll={setShowAllBranches}
          t={t}
          translateOr={translateOr}
          fmtUSD={fmtUSD}
        />
        <div className="hidden">
          <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-white">{translateOr('product_expiry_alerts', 'Expiry alerts', 'ការជូនដំណឹងផុតកំណត់')}</h2>
            {(summary?.expiring_products?.length||0) > 0 && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">{summary!.expiring_products.length}</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {!summary?.expiring_products?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p>
              : (showAllExpiring ? summary.expiring_products : summary.expiring_products.slice(0,5)).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-700 dark:text-gray-300">{p.name}</p>
                    {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                  </div>
                  <span className={Number(p.days_until_expiry || 0) < 0 ? 'badge-red' : 'badge-yellow'}>
                    {p.expiry_date}
                  </span>
                </div>
              ))}
          </div>
          {(summary?.expiring_products?.length||0) > 5 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setShowAllExpiring(v=>!v)} className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-0.5">
                {showAllExpiring ? t('show_less') : `${t('view_all')} ${summary!.expiring_products.length} ${t('items')}`}
              </button>
            </div>
          )}
        </div>

        {/* Recent imports -- a general list of the last few imported files
            (any type, any outcome), so it's discoverable and clickable the
            same way Sales/Inventory activity below is. Click a row to open
            that file's full report (ImportReportModal) -- counts, any
            warnings, and errors all live there rather than being summarized
            with a "warnings"-first framing up here. A small amber badge
            still calls out a job that did have warnings worth a look, but
            it's a detail on the row, not the reason the card exists.
            Deliberately always renders its container (previously gated
            the whole card, header included, on `recentImportFiles.length
            > 0` -- the only card on this dashboard that did that, unlike
            every sibling card above/below it which always renders and
            shows a "No data found" placeholder when empty. That made this
            specific card blink out of existence on first load before its
            fetch resolved, and stay gone for the rest of the session if
            that fetch ever failed silently -- reported as "the card
            sometimes disappears". Matches the same
            loading/empty/populated three-way the rest of the file uses. */}
        <div className="card">
          <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-400" />
              {translateOr('recent_imports', 'Recent imports')}
            </h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {recentImportFilesLoading
              ? <p className="p-4 text-sm text-gray-400 text-center">{translateOr('loading', 'Loading...', 'កំពុងផ្ទុក...')}</p>
              : recentImportFiles.length === 0
                ? <p className="p-4 text-sm text-gray-400 text-center">{translateOr('no_data', 'No data found', 'រកមិនឃើញទិន្នន័យ')}</p>
                : recentImportFiles.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-4"
                    onClick={() => setImportReportJobId(job.id)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-700 dark:text-gray-300">
                        {job.fileName || `${job.type || 'products'} import`}
                      </p>
                      <p className="truncate text-xs text-gray-400 capitalize">
                        {[job.created_at ? fmtTime(job.created_at) : job.status, job.fileName ? `${job.type || 'products'} import` : null].filter(Boolean).join(' \u00b7 ')}
                      </p>
                    </div>
                    {(job.warning_count || 0) > 0 && (
                      <span className="badge-yellow flex-shrink-0 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {job.warning_count} {translateOr('warnings_short', 'warnings')}
                      </span>
                    )}
                  </button>
                ))}
          </div>
        </div>

        <PaymentMethodCard
          analytics={analytics}
          analyticsPending={analyticsPending}
          analyticsUnavailable={analyticsUnavailable}
          analyticsError={analyticsError}
          translateOr={translateOr}
        />
      </div>

      {recentSalesOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setRecentSalesOpen(false)}>
          <div className="flex max-h-modal-88 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('sales') || 'Sales'}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{summary?.recent_sales?.length || 0} {t('entries') || 'entries'}</div>
              </div>
              <button onClick={() => setRecentSalesOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">{closeLabel}</button>
            </div>
            <div className="modal-scroll divide-y divide-gray-100 dark:divide-gray-700">
              {(summary?.recent_sales || []).map((sale) => (
                <button
                  key={`recent-sale-${sale.id}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => setRecentSaleDetail(sale)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{sale.receipt_number || `#${sale.id}`}</div>
                    <div className="truncate text-xs text-gray-400">
                      {compactDashboardMetaParts([fmtTime(sale.created_at), sale.branch_name, sale.customer_name]).join(' | ')}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold text-green-600">{fmtUSD(sale.total_usd || sale.total || 0)}</div>
                    <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getSaleStatusTone(sale.sale_status)}`}>
                      {formatSaleStatus(sale.sale_status)}
                    </div>
                    {(sale.total_khr || 0) > 0 ? <div className="text-xs text-gray-400">{fmtKHR(sale.total_khr || 0)}</div> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {recentSaleDetail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setRecentSaleDetail(null)}>
          <div className="flex max-h-modal-85 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('sale') || 'Sale'}</h2>
                <div className="mt-0.5 max-w-56 truncate text-xs text-gray-400">{recentSaleDetail.receipt_number || `#${recentSaleDetail.id}`}</div>
              </div>
              <button onClick={() => setRecentSaleDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">{closeLabel}</button>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto">
              {([
                { label: t('date') || 'Date', value: fmtTime(recentSaleDetail.created_at) },
                { label: t('status') || 'Status', value: formatSaleStatus(recentSaleDetail.sale_status) },
                { label: t('branch') || 'Branch', value: recentSaleDetail.branch_name || '--' },
                { label: t('customer') || 'Customer', value: recentSaleDetail.customer_name || '--' },
                { label: t('total') || 'Total', value: fmtUSD(recentSaleDetail.total_usd || recentSaleDetail.total || 0) },
                (recentSaleDetail.total_khr || 0) > 0 ? { label: 'KHR', value: fmtKHR(recentSaleDetail.total_khr || 0) } : null,
              ] as Array<{ label: ReactNode; value: ReactNode } | null>).filter((item): item is { label: ReactNode; value: ReactNode } => Boolean(item)).map((item, index) => (
                <div key={String(item.label || index)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{item.value}</div>
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  setRecentSaleDetail(null)
                  setRecentSalesOpen(false)
                  navigateTo('sales')
                }}
              >
                {translateOr('open_sales_page', 'Open sales page')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Product detail modal. This and the two overlays below render
          through a portal to document.body (5.3): position:fixed anchors to
          the nearest transformed/contained ancestor, not the viewport, so an
          overlay rendered inline deep in the page tree can end up partially
          covering the screen the moment any wrapper gains a transform. The
          shared Modal and InfoHint already portal for exactly this reason. */}
      {productDetail && createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setProductDetail(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col max-h-modal-85 pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">
                  {productDetail.insightType === 'low_stock' || productDetail.insightType === 'out_of_stock'
                    ? translateOr('inventory_item_details', 'Inventory item details')
                    : t('product_details')}
                </h2>
                <div className="text-xs text-gray-400 mt-0.5 truncate max-w-56">{productDetail.product_name || productDetail.name}</div>
              </div>
              <button onClick={() => setProductDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">{closeLabel}</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {(
                  productDetail.insightType === 'low_stock' || productDetail.insightType === 'out_of_stock'
                    ? [
                        { label: translateOr('current_stock', 'Current stock'), value: `${productDetail.stock_quantity || 0} ${productDetail.unit || ''}`.trim(), cls:'text-blue-600', bg:'bg-blue-50 dark:bg-blue-900/20' },
                        { label: translateOr('stock_status', 'Stock status'), value: productDetail.insightType === 'low_stock' ? translateOr('low_stock', 'Low stock') : translateOr('out_of_stock', 'Out of stock'), cls: productDetail.insightType === 'low_stock' ? 'text-amber-600' : 'text-red-600', bg: productDetail.insightType === 'low_stock' ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-red-50 dark:bg-red-900/20' },
                        { label: translateOr('low_stock_threshold', 'Low threshold'), value: productDetail.low_stock_threshold ?? 0, cls:'text-slate-700 dark:text-slate-200', bg:'bg-slate-100 dark:bg-slate-800' },
                        { label: translateOr('out_of_stock_threshold', 'Out threshold'), value: productDetail.out_of_stock_threshold ?? 0, cls:'text-slate-700 dark:text-slate-200', bg:'bg-slate-100 dark:bg-slate-800' },
                      ]
                    : [
                        { label: t('qty_sold'),  value: productDetail.qty_sold||0, cls:'text-blue-600', bg:'bg-blue-50 dark:bg-blue-900/20' },
                        { label: translateOr('revenue', 'Revenue'), value: fmtUSD(productDetail.revenue_usd||0), cls:'text-green-600', bg:'bg-green-50 dark:bg-green-900/20' },
                      ]
                ).map(item => (
                  <div key={item.label} className={`${item.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-lg font-bold ${item.cls}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              {productDetail.insightType === 'low_stock' || productDetail.insightType === 'out_of_stock' ? (
                <>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{t('category') || 'Category'}</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{productDetail.category || '--'}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    onClick={() => {
                      openInventoryOverview(productDetail.insightType === 'out_of_stock' ? 'out' : productDetail.insightType === 'low_stock' ? 'low' : 'all')
                    }}
                  >
                    {translateOr('open_inventory_page', 'Open inventory')}
                  </button>
                </>
              ) : (
                <>
                  {productDetail.rank ? (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-center text-sm font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                      #{productDetail.rank} {translateOr('top_product', 'Top product')}
                    </div>
                  ) : null}
                  <div className="text-xs text-gray-400 text-center pt-1">{t('revenue_net_returns')}</div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Customer detail modal -- portaled, see the product detail note. */}
      {customerDetail && createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setCustomerDetail(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col max-h-modal-85 pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('customer_details')}</h2>
                <div className="text-xs text-gray-400 mt-0.5">{customerDetail.customer_name}</div>
              </div>
              <button onClick={() => setCustomerDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">{closeLabel}</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: t('total_sales'),   value: customerDetail.sale_count,                     cls:'text-blue-600',   bg:'bg-blue-50 dark:bg-blue-900/20' },
                  { label: t('gross_revenue'), value: fmtUSD(customerDetail.gross_revenue_usd||0),   cls:'text-purple-600', bg:'bg-purple-50 dark:bg-purple-900/20' },
                  { label: t('store_discounts') || 'Store discounts', value: fmtUSD(customerDetail.store_discount_usd||0), cls:'text-amber-600', bg:'bg-amber-50 dark:bg-amber-900/20' },
                  { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(customerDetail.membership_discount_usd||0), cls:'text-emerald-600', bg:'bg-emerald-50 dark:bg-emerald-900/20' },
                  { label: t('refunded') || 'Refunded', value: fmtUSD(customerDetail.total_refund_usd||0), cls:'text-red-600', bg:'bg-red-50 dark:bg-red-900/20' },
                  { label: t('net_revenue'),   value: fmtUSD(customerDetail.net_revenue_usd||0),     cls:'text-green-600',  bg:'bg-green-50 dark:bg-green-900/20' },
                ].map(item => (
                  <div key={item.label} className={`${item.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-base font-bold ${item.cls}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 flex justify-between items-center">
                <span className="text-xs text-gray-500">{t('avg_order_value')}</span>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {fmtUSD((customerDetail.sale_count || 0) > 0 ? (customerDetail.net_revenue_usd || 0)/(customerDetail.sale_count || 1) : 0)}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 text-center">{t('net_revenue_desc')}</p>
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  setCustomerDetail(null)
                  navigateTo('contacts')
                }}
              >
                {translateOr('open_contacts_page', 'Open contacts page')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* KPI drill panel -- portaled, see the product detail note. */}
      {kpiDetail && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setKpiDetail(null)}>
          <div className="flex max-h-modal-85 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{kpiDetail.label}</h2>
                <p className="text-xs text-gray-400 mt-1">{periodShort}</p>
              </div>
              <button onClick={() => setKpiDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">{closeLabel}</button>
            </div>
            <div className="modal-scroll p-4 space-y-2">
              {Array.isArray(kpiDetail.details) && kpiDetail.details.length ? kpiDetail.details.map((row, index) => (
                <div key={`${kpiDetail.id}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                </div>
              )) : null}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {exportChoicesOpen && (
        <Suspense fallback={null}>
          <ExportChoiceDialog
            title={exportLabel}
            groups={dashboardExportGroups}
            onClose={() => setExportChoicesOpen(false)}
          />
        </Suspense>
      )}
      {importReportJobId && (
        <Suspense fallback={null}>
          <ImportReportModal jobId={importReportJobId} onClose={() => setImportReportJobId(null)} />
        </Suspense>
      )}
    </div>
  )
}
