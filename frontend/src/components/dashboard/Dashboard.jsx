import { useState, useEffect, useCallback } from 'react'
import { useApp, useSync } from '../../AppContext'
import { useMemo } from 'react'
import { useRef } from 'react'
import { LayoutDashboard, RefreshCw, Upload } from 'lucide-react'
import { BarChart, LineChart, DonutChart } from './charts'
import MiniStat from './MiniStat'
import { buildCSV, downloadCSV, downloadZipFiles } from '../../utils/csv'
import { buildStandaloneReportHtml } from '../../utils/exportReports'
import { buildReportManifestRows, buildReportPackageFiles } from '../../utils/exportPackage'
import { fmtTime } from '../../utils/formatters'
import { formatPriceNumber } from '../../utils/pricing.js'
import { todayStr, offsetDate } from '../../utils/dateHelpers'
import ExportMenu from '../shared/ExportMenu'
import PortalMenu from '../shared/PortalMenu'
import { useIsPageActive } from '../shared/pageActivity'
import { withLoaderTimeout } from '../../utils/loaders.mjs'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.mjs'

const DASHBOARD_FILTER_STORAGE_PREFIX = 'bos_dashboard_filters:'
const DASHBOARD_FILTER_STORAGE_FALLBACK_KEY = `${DASHBOARD_FILTER_STORAGE_PREFIX}last`

function getDashboardFilterStorageKey(user) {
  const userKey = user?.id || user?.username || user?.email || 'guest'
  return `${DASHBOARD_FILTER_STORAGE_PREFIX}${userKey}`
}

function readDashboardFilterPrefs(storageKeys) {
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
        rangeId: typeof parsed.rangeId === 'string' ? parsed.rangeId : '30d',
        customStart: typeof parsed.customStart === 'string' ? parsed.customStart : offsetDate(-29),
        customEnd: typeof parsed.customEnd === 'string' ? parsed.customEnd : todayStr(),
        granularity: ['day', 'week', 'month'].includes(parsed.granularity) ? parsed.granularity : 'day',
      }
    }
    return null
  } catch {
    return null
  }
}

export default function Dashboard() {
  const { t, fmtUSD, fmtKHR, user } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('dashboard')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const exportLabel = translateOr('export', 'Export', 'នាំចេញ')
  const refreshLabel = translateOr('refresh', 'Refresh', 'ស្រស់ថ្មី')
  const dayLabel = translateOr('day', 'Day', 'ថ្ងៃ')
  const priceCsv = useCallback((value) => formatPriceNumber(value || 0), [])
  const dashboardFilterStorageKey = useMemo(() => getDashboardFilterStorageKey(user), [user?.email, user?.id, user?.username])
  const dashboardFilterStorageKeys = useMemo(
    () => [dashboardFilterStorageKey, DASHBOARD_FILTER_STORAGE_FALLBACK_KEY],
    [dashboardFilterStorageKey],
  )
  const initialFilterPrefs = useMemo(
    () => readDashboardFilterPrefs(dashboardFilterStorageKeys),
    [dashboardFilterStorageKeys],
  )

  // Range presets use t() for labels inside the component so t() is in scope.
  const RANGE_PRESETS = [
    { id: 'today',  label: t('range_today'),      getRange: () => ({ start: todayStr(), end: todayStr(), gran: 'day' }) },
    { id: '7d',     label: t('range_7d'),          getRange: () => ({ start: offsetDate(-6), end: todayStr(), gran: 'day' }) },
    { id: '30d',    label: t('range_30d'),          getRange: () => ({ start: offsetDate(-29), end: todayStr(), gran: 'day' }) },
    { id: '90d',    label: t('range_90d'),          getRange: () => ({ start: offsetDate(-89), end: todayStr(), gran: 'week' }) },
    { id: 'month',  label: t('range_this_month'),  getRange: () => { const n = new Date(); return { start: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`, end: todayStr(), gran: 'day' } } },
    { id: 'year',   label: t('range_this_year'),   getRange: () => ({ start: `${new Date().getFullYear()}-01-01`, end: todayStr(), gran: 'month' }) },
    { id: 'custom', label: t('range_custom'),      getRange: null },
  ]

  const [summary, setSummary]     = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [aLoading, setALoading]   = useState(true)
  const [silentRefresh, setSilentRefresh] = useState(false)
  const [rangeId, setRangeId]     = useState(() => initialFilterPrefs?.rangeId || '30d')
  const [customStart, setCustomStart] = useState(() => initialFilterPrefs?.customStart || offsetDate(-29))
  const [customEnd, setCustomEnd]     = useState(() => initialFilterPrefs?.customEnd || todayStr())
  const [granularity, setGranularity] = useState(() => initialFilterPrefs?.granularity || 'day')
  const [activeChart, setActiveChart] = useState('revenue')
  const [topMode, setTopMode]         = useState('revenue')
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [showAllProducts, setShowAllProducts]   = useState(false)
  const [customerDetail, setCustomerDetail]     = useState(null)
  const [productDetail, setProductDetail]       = useState(null)
  const [showAllBranches, setShowAllBranches]   = useState(false)
  const [showAllHours, setShowAllHours]         = useState(false)
  const [showAllLowStock, setShowAllLowStock]   = useState(false)
  const [showAllRecent, setShowAllRecent]       = useState(false)
  const [kpiDetail, setKpiDetail]               = useState(null)
  const summaryRequestRef = useRef(0)
  const analyticsRequestRef = useRef(0)
  const refreshRequestRef = useRef(0)
  const analyticsLoadingRef = useRef(true)
  const filterStorageKeyRef = useRef(dashboardFilterStorageKey)

  const setAnalyticsLoading = useCallback((value) => {
    analyticsLoadingRef.current = value
    setALoading(value)
  }, [])

  const loadSummary = useCallback(async ({
    clearOnError = false,
    label = 'Dashboard summary',
    markLoading = false,
  } = {}) => {
    const requestId = beginTrackedRequest(summaryRequestRef)
    if (markLoading) setLoading(true)
    try {
      const data = await withLoaderTimeout(() => window.api.getDashboard(), label)
      if (!isTrackedRequestCurrent(summaryRequestRef, requestId)) return null
      setSummary(data)
      return data
    } catch (error) {
      if (!isTrackedRequestCurrent(summaryRequestRef, requestId)) return null
      console.error('[Dashboard] getDashboard failed:', error.message)
      if (clearOnError) {
        setSummary({})
      }
      return null
    } finally {
      if (markLoading && isTrackedRequestCurrent(summaryRequestRef, requestId)) {
        setLoading(false)
      }
    }
  }, [])

  const loadAnalytics = useCallback(async ({ silent = false } = {}) => {
    const requestId = beginTrackedRequest(analyticsRequestRef)
    const shouldClearLoading = !silent || analyticsLoadingRef.current
    if (!silent) setAnalyticsLoading(true)
    let start, end, gran
    const preset = RANGE_PRESETS.find(r => r.id === rangeId)
    if (preset?.getRange) { const r = preset.getRange(); start = r.start; end = r.end; gran = r.gran }
    else { start = customStart; end = customEnd; gran = granularity }
    try {
      const data = await withLoaderTimeout(
        () => window.api.getAnalytics({ startDate: start, endDate: end, granularity: gran }),
        'Dashboard analytics',
      )
      if (!isTrackedRequestCurrent(analyticsRequestRef, requestId)) return null
      setAnalytics(data)
      return data
    } catch (error) {
      if (!isTrackedRequestCurrent(analyticsRequestRef, requestId)) return null
      console.error('[Dashboard] getAnalytics failed:', error.message)
      return null
    } finally {
      if (shouldClearLoading && isTrackedRequestCurrent(analyticsRequestRef, requestId)) {
        setAnalyticsLoading(false)
      }
    }
  }, [customEnd, customStart, granularity, rangeId, setAnalyticsLoading]) // eslint-disable-line

  useEffect(() => {
    if (filterStorageKeyRef.current === dashboardFilterStorageKey) return
    filterStorageKeyRef.current = dashboardFilterStorageKey
    const nextPrefs = readDashboardFilterPrefs([dashboardFilterStorageKey, DASHBOARD_FILTER_STORAGE_FALLBACK_KEY])
    setRangeId(nextPrefs?.rangeId || '30d')
    setCustomStart(nextPrefs?.customStart || offsetDate(-29))
    setCustomEnd(nextPrefs?.customEnd || todayStr())
    setGranularity(nextPrefs?.granularity || 'day')
  }, [dashboardFilterStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !dashboardFilterStorageKey) return
    try {
      const serialized = JSON.stringify({
        rangeId,
        customStart,
        customEnd,
        granularity,
      })
      window.localStorage.setItem(dashboardFilterStorageKey, serialized)
      window.localStorage.setItem(DASHBOARD_FILTER_STORAGE_FALLBACK_KEY, serialized)
    } catch {
      // Ignore persistence failures and keep the dashboard usable.
    }
  }, [customEnd, customStart, dashboardFilterStorageKey, granularity, rangeId])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(summaryRequestRef)
      invalidateTrackedRequest(refreshRequestRef)
      setLoading(false)
      setSilentRefresh(false)
      return
    }

    void loadSummary({
      clearOnError: true,
      markLoading: summary == null,
    })
  }, [isActive, loadSummary])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(analyticsRequestRef)
      setAnalyticsLoading(false)
      return
    }

    void loadAnalytics({
      silent: summary != null,
    })
  }, [isActive, loadAnalytics, setAnalyticsLoading])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const ch = syncChannel.channel
    if (ch === 'sales' || ch === 'products' || ch === 'returns' || ch === 'inventory') {
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

  const profit    = (summary?.cost_out || 0) - (summary?.cost_in || 0)
  const calcTrend = (curr, prev) => (!prev || prev === 0) ? undefined : ((curr - prev) / prev) * 100
  const aRevenue  = analytics?.totals?.revenue_usd || 0
  const aGrossSales = analytics?.totals?.gross_sales_usd || 0
  const aDiscounts = analytics?.totals?.discount_usd || 0
  const aStoreDiscounts = analytics?.totals?.store_discount_usd || 0
  const aTax = analytics?.totals?.tax_usd || 0
  const aDelivery = analytics?.totals?.delivery_usd || 0
  const aStockValue = summary?.stock_value_usd || 0
  const aPrevRevenue = analytics?.prevTotals?.revenue_usd || 0
  const aTxCount  = analytics?.totals?.tx_count || 0
  const aPrevTxCount = analytics?.prevTotals?.tx_count || 0
  const aProfit   = analytics?.totals?.profit_usd || 0
  const aCost     = analytics?.totals?.cost_usd   || 0
  const aAvgOrder = analytics?.totals?.avg_order_usd || 0
  const aReturns   = analytics?.periodReturns?.return_count  || 0
  const aRefundUsd = analytics?.periodReturns?.refund_usd    || 0
  const aItemsRet  = analytics?.periodReturns?.items_returned || 0
  const aSupplierReturns = analytics?.periodSupplierReturns?.return_count || 0
  const aSupplierLossUsd = analytics?.periodSupplierReturns?.loss_usd || 0
  const chartData = analytics?.periodData || []
  const topList   = topMode === 'qty' ? (analytics?.topProductsQty || []) : (analytics?.topProducts || [])
  const revenueFormulaText = 'Net revenue = Gross sales - Discounts - Refunds'
  const collectedFormulaText = 'Collected total = Net revenue + Tax + Delivery'
  const revenueExampleText = `${fmtUSD(aRevenue)} = ${fmtUSD(aGrossSales)} - ${fmtUSD(aDiscounts)} - ${fmtUSD(aRefundUsd)}`
  const collectedExampleText = `${fmtUSD(aRevenue + aTax + aDelivery)} = ${fmtUSD(aRevenue)} + ${fmtUSD(aTax)} + ${fmtUSD(aDelivery)}`
  const rangeLabel = (() => {
    const p = RANGE_PRESETS.find(r => r.id === rangeId)
    if (p?.getRange) { const r = p.getRange(); return `${r.start} - ${r.end}` }
    return `${customStart} - ${customEnd}`
  })()

  const periodShort = (() => {
    const map = { today: t('range_today'), '7d': t('range_7d'), '30d': t('range_30d'), '90d': t('range_90d'), month: t('range_this_month'), year: t('range_this_year') }
    return map[rangeId] || `${customStart} - ${customEnd}`
  })()

  const periodKpis = [
    {
      id: 'products',
      label: t('products_total'),
      value: summary?.product_count || 0,
      sub: `${summary?.low_stock?.length || 0} ${t('low_stock')}`,
      details: [
        { label: t('products_total') || 'Products', value: summary?.product_count || 0 },
        { label: t('low_stock') || 'Low stock', value: summary?.low_stock?.length || 0 },
        { label: t('out_of_stock') || 'Out of stock', value: summary?.out_of_stock_count || 0 },
      ],
    },
    {
      id: 'stock-value',
      label: t('stock_value') || 'Stock value',
      value: fmtUSD(aStockValue),
      color: 'text-cyan-600',
      details: [
        { label: t('stock_value') || 'Stock value', value: fmtUSD(aStockValue) },
        { label: t('products_total') || 'Products', value: summary?.product_count || 0 },
        { label: t('formula') || 'Formula', value: 'Stock value = quantity on hand x unit cost' },
      ],
    },
    {
      id: 'revenue',
      label: t('revenue'),
      value: fmtUSD(aRevenue),
      sub: `${t('gross_revenue') || 'Gross revenue'} - ${fmtUSD(aGrossSales)}`,
      color: 'text-green-600',
      trend: calcTrend(aRevenue, aPrevRevenue),
      details: [
        { label: t('revenue') || 'Net revenue', value: fmtUSD(aRevenue) },
        { label: t('gross_revenue') || 'Gross revenue', value: fmtUSD(aGrossSales) },
        { label: t('discounts') || 'Discounts', value: fmtUSD(aDiscounts) },
        { label: t('total_refunded') || 'Refunds', value: fmtUSD(aRefundUsd) },
        { label: t('tax_collected') || 'Tax', value: fmtUSD(aTax) },
        { label: t('delivery_fees') || 'Delivery fees', value: fmtUSD(aDelivery) },
        { label: t('formula') || 'Formula', value: revenueFormulaText },
        { label: t('example') || 'Example', value: revenueExampleText },
        { label: t('collected_total') || 'Collected total', value: collectedFormulaText },
        { label: t('collected_example') || 'Collected example', value: collectedExampleText },
      ],
    },
    {
      id: 'discounts',
      label: t('store_discounts') || 'Store discounts',
      value: fmtUSD(aStoreDiscounts),
      sub: aStoreDiscounts > 0 ? (t('promotion') || 'Promotion') : '',
      color: aStoreDiscounts > 0 ? 'text-amber-600' : 'text-gray-500',
      details: [
        { label: t('store_discounts') || 'Store discounts', value: fmtUSD(aStoreDiscounts) },
        { label: t('formula') || 'Formula', value: 'Store discounts are the cashier-entered sale discounts and product promotions.' },
      ],
    },
    {
      id: 'cogs',
      label: t('cogs'),
      value: fmtUSD(aCost),
      color: 'text-red-600',
      details: [
        { label: t('cogs') || 'COGS', value: fmtUSD(aCost) },
        { label: t('formula') || 'Formula', value: 'COGS excludes quantities restored by restocked returns' },
      ],
    },
    {
      id: 'profit',
      label: t('est_profit'),
      value: fmtUSD(aProfit),
      color: aProfit >= 0 ? 'text-blue-600' : 'text-red-600',
      sub: aRevenue > 0 ? `${((aProfit / aRevenue) * 100).toFixed(1)}% ${t('profit_margin')}` : '',
      details: [
        { label: t('est_profit') || 'Est. profit', value: fmtUSD(aProfit) },
        { label: t('revenue') || 'Revenue', value: fmtUSD(aRevenue) },
        { label: t('cogs') || 'COGS', value: fmtUSD(aCost) },
        { label: t('profit_margin') || 'Profit margin', value: aRevenue > 0 ? `${((aProfit / aRevenue) * 100).toFixed(2)}%` : '0.00%' },
        { label: t('formula') || 'Formula', value: 'Profit = Net revenue - COGS' },
      ],
    },
    {
      id: 'transactions',
      label: t('transactions'),
      value: aTxCount,
      sub: `avg ${fmtUSD(aAvgOrder)} / ${t('sale')}`,
      trend: calcTrend(aTxCount, aPrevTxCount),
      details: [
        { label: t('transactions') || 'Transactions', value: aTxCount },
        { label: t('avg_order_value') || 'Avg order', value: fmtUSD(aAvgOrder) },
        { label: t('formula') || 'Formula', value: 'Average order = Net revenue / transaction count' },
      ],
    },
    {
      id: 'returns',
      label: t('returns_count'),
      value: aReturns,
      color: aReturns > 0 ? 'text-orange-600' : 'text-gray-500',
      sub: aReturns > 0 ? `${fmtUSD(aRefundUsd)} ${t('refunded')} - ${aItemsRet} ${t('items')}` : (t('no_returns') || 'No returns'),
      details: [
        { label: t('returns_count') || 'Returns', value: aReturns },
        { label: t('total_refunded') || 'Refunded', value: fmtUSD(aRefundUsd) },
        { label: t('items') || 'Items', value: aItemsRet },
        { label: t('supplier_returns') || 'Supplier returns', value: aSupplierReturns },
        { label: t('business_loss') || 'Business loss', value: fmtUSD(aSupplierLossUsd) },
        { label: t('formula') || 'Formula', value: 'Returns decrease net revenue and loyalty points' },
      ],
    },
  ]

  const exportStamp = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const buildDashboardKpiRows = useCallback(() => ([
    { Section:'KPI', Metric:'Period', Value: periodShort, Period: rangeLabel },
    { Section:'KPI', Metric:'Gross Sales (USD)', Value: priceCsv(aGrossSales), Period: rangeLabel },
    { Section:'KPI', Metric:'Revenue (USD)', Value: priceCsv(aRevenue), Period: rangeLabel },
    { Section:'KPI', Metric:'Discounts (USD)', Value: priceCsv(aDiscounts), Period: rangeLabel },
    { Section:'KPI', Metric:'Store Discounts (USD)', Value: priceCsv(aStoreDiscounts), Period: rangeLabel },
    { Section:'KPI', Metric:'Tax (USD)', Value: priceCsv(aTax), Period: rangeLabel },
    { Section:'KPI', Metric:'Delivery (USD)', Value: priceCsv(aDelivery), Period: rangeLabel },
    { Section:'KPI', Metric:'Products', Value: summary?.product_count || 0, Period:'current inventory' },
    { Section:'KPI', Metric:'Stock Value (USD)', Value: priceCsv(aStockValue), Period:'current inventory' },
    { Section:'KPI', Metric:'COGS (USD)', Value: priceCsv(aCost), Period: rangeLabel },
    { Section:'KPI', Metric:'Est. Profit (USD)', Value: priceCsv(aProfit), Period: rangeLabel },
    { Section:'KPI', Metric:'Transactions', Value: aTxCount, Period: rangeLabel },
    { Section:'KPI', Metric:'Avg Order (USD)', Value: priceCsv(aAvgOrder), Period: rangeLabel },
    { Section:'KPI', Metric:'Returns', Value: aReturns, Period: rangeLabel },
    { Section:'KPI', Metric:'Refunded (USD)', Value: priceCsv(aRefundUsd), Period: rangeLabel },
    { Section:'KPI', Metric:'Supplier Returns', Value: aSupplierReturns, Period: rangeLabel },
    { Section:'KPI', Metric:'Business Loss (USD)', Value: priceCsv(aSupplierLossUsd), Period: rangeLabel },
    { Section:'KPI', Metric:'Low Stock', Value: summary?.low_stock?.length || 0, Period:'all-time' },
  ]), [
    aAvgOrder,
    aCost,
    aDelivery,
    aDiscounts,
    aGrossSales,
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
    periodShort,
    priceCsv,
    rangeLabel,
    summary?.product_count,
    summary?.low_stock?.length,
  ])

  const buildDashboardFormulaRows = useCallback(() => ([
    { Section: 'Calculation', Metric: 'Selected Range', Formula: rangeLabel, Example: periodShort },
    { Section: 'Calculation', Metric: 'Net revenue', Formula: revenueFormulaText, Example: revenueExampleText },
    { Section: 'Calculation', Metric: 'Collected total', Formula: collectedFormulaText, Example: collectedExampleText },
    { Section: 'Calculation', Metric: 'Estimated profit', Formula: 'Profit = Net revenue - COGS', Example: `${fmtUSD(aProfit)} = ${fmtUSD(aRevenue)} - ${fmtUSD(aCost)}` },
    { Section: 'Calculation', Metric: 'Average order', Formula: 'Average order = Net revenue / transaction count', Example: `${fmtUSD(aAvgOrder)} from ${aTxCount} transactions` },
    { Section: 'Calculation', Metric: 'Returns effect', Formula: 'Returns decrease net revenue and loyalty points', Example: `${aReturns} returns, ${fmtUSD(aRefundUsd)} refunded` },
  ]), [
    aAvgOrder,
    aCost,
    aProfit,
    aRefundUsd,
    aReturns,
    aRevenue,
    aTxCount,
    collectedExampleText,
    collectedFormulaText,
    fmtUSD,
    periodShort,
    rangeLabel,
    revenueExampleText,
    revenueFormulaText,
  ])

  const buildDashboardManifestRows = useCallback(() => (
    buildReportManifestRows([
      { metric: 'Range Preset', value: periodShort },
      { metric: 'Date Range', value: rangeLabel },
      { metric: 'Active Chart Mode', value: activeChart },
      { metric: 'Top Ranking Mode', value: topMode },
      { metric: 'Visible Sales Periods', value: chartData.length },
      { metric: 'Payment Methods', value: analytics?.byPayment?.length || 0 },
      { metric: 'Visible Branches', value: analytics?.byBranch?.length || 0 },
      { metric: 'Low Stock Items', value: summary?.low_stock?.length || 0 },
      { metric: 'Generated At', value: new Date().toISOString() },
    ])
  ), [
    activeChart,
    analytics?.byBranch?.length,
    analytics?.byPayment?.length,
    chartData.length,
    periodShort,
    rangeLabel,
    summary?.low_stock?.length,
    topMode,
  ])

  const buildDashboardSalesRows = useCallback(() => (
    (analytics?.periodData || []).map((d) => ({
      Period: d.date || d.period || '',
      Gross_Sales_USD: priceCsv(d.gross_sales_usd || 0),
      Discounts_USD: priceCsv(d.discount_usd || 0),
      Tax_USD: priceCsv(d.tax_usd || 0),
      Delivery_USD: priceCsv(d.delivery_usd || 0),
      Refund_USD: priceCsv(d.refund_usd || 0),
      Revenue_USD: priceCsv(d.revenue_usd || 0),
      COGS_USD: priceCsv(d.cost_usd || 0),
      Profit_USD: priceCsv(d.profit_usd || 0),
      Tx: d.count || 0,
    }))
  ), [analytics?.periodData, priceCsv])

  const buildDashboardTopProductRows = useCallback(() => (
    (analytics?.topProducts || []).map((p, i) => ({
      Rank: i + 1,
      Product: p.product_name || '',
      Revenue_USD: priceCsv(p.revenue_usd || 0),
      Qty: p.qty_sold || 0,
    }))
  ), [analytics?.topProducts, priceCsv])

  const buildDashboardTopCustomerRows = useCallback(() => (
    (analytics?.topCustomers || []).map((c, i) => ({
      Rank: i + 1,
      Customer: c.customer_name || '',
      Sales: c.sale_count || 0,
      Gross: priceCsv(c.gross_revenue_usd || 0),
      Store_Discounts: priceCsv(c.store_discount_usd || 0),
      Membership_Discounts: priceCsv(c.membership_discount_usd || 0),
      Returns: priceCsv(c.total_refund_usd || 0),
      Net: priceCsv(c.net_revenue_usd || 0),
    }))
  ), [analytics?.topCustomers, priceCsv])

  const buildDashboardPaymentRows = useCallback(() => (
    (analytics?.byPayment || []).map((p) => ({
      Method: p.payment_method || '',
      Count: p.count || 0,
      Revenue: priceCsv(p.revenue_usd || 0),
    }))
  ), [analytics?.byPayment, priceCsv])

  const buildDashboardBranchRows = useCallback(() => (
    (analytics?.byBranch || []).map((b) => ({
      Branch: b.branch_name || '',
      Tx: b.count || 0,
      Revenue: priceCsv(b.revenue_usd || 0),
    }))
  ), [analytics?.byBranch, priceCsv])

  const buildDashboardLowStockRows = useCallback(() => (
    (summary?.low_stock || []).map((p) => ({
      Product: p.name || '',
      Stock: p.stock_quantity || 0,
      Threshold: p.low_stock_threshold || 0,
    }))
  ), [summary?.low_stock])

  const buildDashboardRecentRows = useCallback(() => (
    (summary?.recent_sales || []).map((sale) => ({
      Receipt: sale.receipt_number || '',
      Created_At: sale.created_at || '',
      Branch: sale.branch_name || '',
      Customer: sale.customer_name || '',
      Total_USD: priceCsv(sale.total_usd || sale.total || 0),
      Total_KHR: priceCsv(sale.total_khr || 0),
    }))
  ), [priceCsv, summary?.recent_sales])

  const buildExportAll = () => {
    if (!analytics || !summary) return
    const manifestRows = buildDashboardManifestRows().map((row) => ({
      Section: row.Section,
      Metric: row.Metric,
      Value: row.Value,
      Period: rangeLabel,
    }))
    const kpiRows = buildDashboardKpiRows()
    const salesRows    = buildDashboardSalesRows().map((row) => ({ Section: 'Period Sales', ...row }))
    const topRevRows   = buildDashboardTopProductRows().map((row) => ({ Section: 'Top Products (Rev)', ...row }))
    const topCustRows  = buildDashboardTopCustomerRows().map((row) => ({ Section: 'Top Customers', ...row }))
    const pmRows       = buildDashboardPaymentRows().map((row) => ({ Section: 'Payments', ...row }))
    const branchRows   = buildDashboardBranchRows().map((row) => ({ Section: 'Branches', ...row }))
    const lowRows      = buildDashboardLowStockRows().map((row) => ({ Section: 'Low Stock', ...row }))
    const all = [...manifestRows, ...kpiRows, ...buildDashboardFormulaRows(), ...salesRows, ...topRevRows, ...topCustRows, ...pmRows, ...branchRows, ...lowRows]
    const keys = [...new Set(all.flatMap(r=>Object.keys(r)))]
    downloadCSV(`dashboard-full-${exportStamp}.csv`, all.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]??'']))))
  }

  const exportDashboardStats = useCallback(() => {
    if (!summary || !analytics) return
    const rows = [
      ...buildDashboardManifestRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: row.Value,
        Formula: '',
        Example: '',
      })),
      ...buildDashboardKpiRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: row.Value,
        Formula: '',
        Example: row.Period || '',
      })),
      ...buildDashboardFormulaRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: '',
        Formula: row.Formula,
        Example: row.Example,
      })),
    ]
    downloadCSV(`dashboard-stats-${exportStamp}.csv`, rows)
  }, [
    analytics,
    buildDashboardFormulaRows,
    buildDashboardKpiRows,
    buildDashboardManifestRows,
    exportStamp,
    summary,
  ])

  const exportDashboardPackage = useCallback(() => {
    if (!analytics || !summary) return
    const salesRows = buildDashboardSalesRows()
    const topProductRows = buildDashboardTopProductRows()
    const topCustomerRows = buildDashboardTopCustomerRows()
    const paymentRows = buildDashboardPaymentRows()
    const branchRows = buildDashboardBranchRows()
    const lowRows = buildDashboardLowStockRows()
    const recentRows = buildDashboardRecentRows()
    const manifestRows = buildDashboardManifestRows()
    const reportContent = buildStandaloneReportHtml({
      title: 'Dashboard Analytics Report',
      subtitle: `${periodShort} • ${rangeLabel}`,
      exportedAt: new Date().toISOString(),
      summaryCards: periodKpis.slice(0, 6).map((kpi) => ({
        label: kpi.label,
        value: kpi.value,
        sub: kpi.sub,
      })),
      metadataGroups: [
        {
          title: 'Active Range',
          subtitle: 'Filters and export context for this package',
          rows: [
            { label: 'Range preset', value: periodShort },
            { label: 'Date range', value: rangeLabel },
            { label: 'Chart mode', value: activeChart },
            { label: 'Top ranking mode', value: topMode },
          ],
        },
        {
          title: 'Visible Data',
          subtitle: 'Counts for the exported data slices',
          rows: [
            { label: 'Sales periods', value: chartData.length },
            { label: 'Payment methods', value: paymentRows.length },
            { label: 'Branches', value: branchRows.length },
            { label: 'Low-stock items', value: lowRows.length },
          ],
        },
      ],
      charts: [
        {
          type: 'line',
          title: 'Revenue over time',
          subtitle: periodShort,
          props: { data: chartData, lines: [{ key: 'revenue_usd', color: '#2563eb', label: t('revenue') || 'Revenue' }] },
        },
        {
          type: 'line',
          title: 'Revenue vs COGS vs Profit',
          subtitle: 'Visible period comparison',
          props: {
            data: chartData,
            lines: [
              { key: 'revenue_usd', color: '#2563eb', label: t('revenue') || 'Revenue' },
              { key: 'cost_usd', color: '#dc2626', label: t('cogs') || 'COGS' },
              { key: 'profit_usd', color: '#16a34a', label: t('profit') || 'Profit' },
            ],
          },
        },
        {
          type: 'bar',
          title: 'Transactions over time',
          subtitle: 'Sales activity volume',
          props: { data: chartData, valueKey: 'count', labelKey: 'period', color: '#7c3aed', isCount: true },
        },
        {
          type: 'donut',
          title: 'Payment distribution',
          subtitle: 'Revenue share by payment method',
          props: { data: analytics?.byPayment || [], valueKey: 'revenue_usd' },
        },
        {
          type: 'bar',
          title: 'Branch performance',
          subtitle: 'Revenue by branch',
          props: { data: analytics?.byBranch || [], valueKey: 'revenue_usd', labelKey: 'branch_name', color: '#0891b2' },
        },
        {
          type: 'bar',
          title: 'Top products by revenue',
          subtitle: 'Current visible ranking',
          props: { data: analytics?.topProducts || [], valueKey: 'revenue_usd', labelKey: 'product_name', color: '#ea580c' },
        },
      ],
      tables: [
        { title: 'Top products', subtitle: 'Revenue leaders in the selected range', rows: topProductRows, limit: 10 },
        { title: 'Top customers', subtitle: 'Highest-value customers in the selected range', rows: topCustomerRows, limit: 10 },
        { title: 'Payment methods', subtitle: 'Count and revenue by payment type', rows: paymentRows },
        { title: 'Branch performance', subtitle: 'Transaction and revenue totals', rows: branchRows },
        { title: 'Low-stock summary', subtitle: 'Current low-stock items from all-time inventory state', rows: lowRows, limit: 12 },
        { title: 'Recent sales', subtitle: 'Latest receipts included in the dashboard summary', rows: recentRows, limit: 12 },
      ],
      notes: [
        revenueFormulaText,
        collectedFormulaText,
        'Package includes raw CSV exports, formulas, and this self-contained HTML report.',
      ],
    })
    const files = buildReportPackageFiles({
      baseName: 'dashboard',
      exportStamp,
      manifestRows,
      csvFiles: [
        { name: `dashboard-export-context-${exportStamp}.csv`, content: buildCSV(manifestRows) },
        { name: `dashboard-kpis-${exportStamp}.csv`, content: buildCSV(buildDashboardKpiRows()) },
        { name: `dashboard-calculations-${exportStamp}.csv`, content: buildCSV(buildDashboardFormulaRows()) },
        { name: `dashboard-sales-${exportStamp}.csv`, content: buildCSV(salesRows) },
        { name: `dashboard-top-products-${exportStamp}.csv`, content: buildCSV(topProductRows) },
        { name: `dashboard-top-customers-${exportStamp}.csv`, content: buildCSV(topCustomerRows) },
        { name: `dashboard-payments-${exportStamp}.csv`, content: buildCSV(paymentRows) },
        { name: `dashboard-branches-${exportStamp}.csv`, content: buildCSV(branchRows) },
        { name: `dashboard-low-stock-${exportStamp}.csv`, content: buildCSV(lowRows) },
        { name: `dashboard-recent-sales-${exportStamp}.csv`, content: buildCSV(recentRows) },
      ],
      reportFileName: 'dashboard-report.html',
      reportContent,
    })
    downloadZipFiles(`dashboard-report-${exportStamp}.zip`, files)
  }, [
    activeChart,
    analytics,
    buildDashboardBranchRows,
    buildDashboardFormulaRows,
    buildDashboardKpiRows,
    buildDashboardManifestRows,
    buildDashboardLowStockRows,
    buildDashboardPaymentRows,
    buildDashboardRecentRows,
    buildDashboardSalesRows,
    buildDashboardTopCustomerRows,
    buildDashboardTopProductRows,
    chartData,
    collectedFormulaText,
    exportStamp,
    periodKpis,
    periodShort,
    rangeLabel,
    revenueFormulaText,
    summary,
    t,
    topMode,
  ])

  const dashboardExportItems = [
    { label: t('export_dashboard_package') || 'Export dashboard package', onClick: exportDashboardPackage, color: 'green' },
    { label: t('export_all_report'), onClick: buildExportAll, color: 'green' },
    { label: t('export_kpi_summary'), onClick: () => {
      if (!summary || !analytics) return
      downloadCSV(`dashboard-kpi-${exportStamp}.csv`, buildDashboardKpiRows())
    } },
    { label: t('export_dashboard_calculations') || 'Export dashboard stats and calculations', onClick: exportDashboardStats },
    'divider',
    { label: t('export_sales_chart'), onClick: () => {
      const rows = chartData.map(d => ({
        Period: d.date || d.period || '',
        Gross_Sales_USD: d.gross_sales_usd || 0,
        Discounts_USD: d.discount_usd || 0,
        Tax_USD: d.tax_usd || 0,
        Delivery_USD: d.delivery_usd || 0,
        Refund_USD: d.refund_usd || 0,
        Revenue_USD: d.revenue_usd || 0,
        COGS_USD: d.cost_usd || 0,
        Profit_USD: d.profit_usd || 0,
        Tx: d.count || 0,
      }))
      downloadCSV(`dashboard-sales-${exportStamp}.csv`, rows)
    } },
    { label: t('export_top_products'), onClick: () => {
      const rows = topList.map((p, i) => ({ Rank: i + 1, Product: p.product_name || '', Revenue_USD: p.revenue_usd || 0, Qty: p.qty_sold || 0 }))
      downloadCSV(`dashboard-top-products-${exportStamp}.csv`, rows)
    } },
    { label: t('export_top_customers'), onClick: () => {
      const rows = (analytics?.topCustomers || []).map((c, i) => ({
        Rank: i + 1,
        Customer: c.customer_name || '',
        Sales: c.sale_count || 0,
        Gross: c.gross_revenue_usd || 0,
        Store_Discounts: c.store_discount_usd || 0,
        Membership_Discounts: c.membership_discount_usd || 0,
        Returns: c.total_refund_usd || 0,
        Net: c.net_revenue_usd || 0,
      }))
      downloadCSV(`dashboard-top-customers-${exportStamp}.csv`, rows)
    } },
    { label: t('export_payment_methods'), onClick: () => {
      const rows = (analytics?.byPayment || []).map(p => ({ Method: p.payment_method, Count: p.count || 0, Revenue: p.revenue_usd || 0 }))
      downloadCSV(`dashboard-payments-${exportStamp}.csv`, rows)
    } },
    { label: t('export_branch_performance'), onClick: () => {
      const rows = (analytics?.byBranch || []).map(b => ({ Branch: b.branch_name, Tx: b.count || 0, Revenue: b.revenue_usd || 0 }))
      downloadCSV(`dashboard-branches-${exportStamp}.csv`, rows)
    } },
  ]

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400">{t('loading')}</div>

  return (
    <div className="page-scroll p-3 sm:p-5 space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          <LayoutDashboard className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{t('dashboard')}</span>
        </h1>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {silentRefresh && <span className="text-xs text-blue-500 animate-pulse">{t('loading')}</span>}
          <button
            onClick={() => {
              void Promise.allSettled([
                loadSummary({ label: 'Dashboard summary manual refresh' }),
                loadAnalytics(),
              ])
            }}
            className="btn-secondary inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${silentRefresh ? 'animate-spin' : ''}`} />
            {refreshLabel}
          </button>
          <ExportMenu label={exportLabel} items={dashboardExportItems} compact />
        </div>
      </div>

      {/* Range selector */}
      <div className="card p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('period_label')||'Range'}:</span>
          <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            {RANGE_PRESETS.map(p => (
              <button key={p.id} onClick={() => setRangeId(p.id)}
                className={`whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${rangeId===p.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {rangeId === 'custom' && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5">
              <input
                id="dashboard-custom-start-date"
                name="dashboard_custom_start_date"
                aria-label="Dashboard custom start date"
                type="date"
                className="input w-full text-xs py-1.5 sm:w-36"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
              />
              <span className="text-gray-400 text-xs">to</span>
              <input
                id="dashboard-custom-end-date"
                name="dashboard_custom_end_date"
                aria-label="Dashboard custom end date"
                type="date"
                className="input w-full text-xs py-1.5 sm:w-36"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
              />
              <select
                id="dashboard-granularity"
                name="dashboard_granularity"
                aria-label="Dashboard period granularity"
                className="input w-full text-xs py-1.5 sm:w-28"
                value={granularity}
                onChange={e => setGranularity(e.target.value)}
              >
                <option value="day">{dayLabel}</option>
                <option value="week">{t('this_week')}</option>
                <option value="month">{t('this_month')}</option>
              </select>
            </div>
          )}
          <span className="text-xs text-gray-400 sm:ml-auto">{rangeLabel}</span>
        </div>
      </div>

      {/* Period KPI cards */}
      <div className="rounded-xl border-2 border-blue-100 dark:border-blue-900/40 p-2 sm:p-3 bg-blue-50/40 dark:bg-blue-950/20">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">{t('period_stats')}</span>
          <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">{periodShort}</span>
          <span className="text-xs text-gray-400 ml-auto hidden sm:inline">{rangeLabel}</span>
        </div>
        {!aLoading ? (
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('tap_any_stat_for_details') || 'Tap any stat card for details.'}</p>
        ) : null}
        {aLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
            {[...Array(7)].map((_, i) => <div key={i} className="card p-4 h-20 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />)}
          </div>
        ) : (
          <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
            {periodKpis.map((kpi) => (
              <MiniStat
                key={kpi.id}
                label={kpi.label}
                value={kpi.value}
                sub={kpi.sub}
                color={kpi.color}
                trend={kpi.trend}
                onClick={() => setKpiDetail(kpi)}
              />
            ))}
          </div>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
        <div className="lg:col-span-2 card p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">{t('analytics')}</h2>
            <div className="flex gap-1 flex-wrap">
              {[['revenue', t('revenue')],['profit', t('profit_vs_cogs')],['volume', t('transactions')]].map(([id,lbl]) => (
                <button key={id} onClick={() => setActiveChart(id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${activeChart===id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {aLoading ? <div className="h-36 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" />
          : chartData.length === 0 ? <div className="h-36 flex items-center justify-center text-gray-400 text-sm">{t('no_data')}</div>
          : activeChart === 'revenue' ? (
            <>
              <LineChart data={chartData} lines={[{ key:'revenue_usd', color:'#2563eb', label: t('revenue') }]} />
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-blue-600"/><span className="text-xs text-gray-500">{t('revenue')} (USD)</span></div>
              </div>
            </>
          ) : activeChart === 'profit' ? (
            <>
              <LineChart data={chartData} lines={[{ key:'revenue_usd', color:'#2563eb' },{ key:'cost_usd', color:'#dc2626' },{ key:'profit_usd', color:'#16a34a' }]} />
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-blue-600"/><span className="text-xs text-gray-500">{t('revenue')}</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-red-600"/><span className="text-xs text-gray-500">{t('cogs')}</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-1 rounded bg-green-600"/><span className="text-xs text-gray-500">{t('profit')}</span></div>
              </div>
            </>
          ) : (
            <>
              <BarChart data={chartData} valueKey="count" labelKey="period" color="#7c3aed" isCount />
              <div className="flex items-center gap-1.5 mt-2"><div className="w-3 h-3 rounded bg-purple-600"/><span className="text-xs text-gray-500">{t('transactions')}</span></div>
            </>
          )}
        </div>

        <div className="card p-3 sm:p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">{t('payment_method')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <>
              <DonutChart data={analytics?.byPayment||[]} valueKey="revenue_usd" />
              <div className="mt-2 space-y-1 max-h-32 overflow-auto">
                {(analytics?.byPayment||[]).map((p, i) => {
                  const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#dc2626','#0891b2']
                  const total = (analytics?.byPayment||[]).reduce((s,x) => s+(x.revenue_usd||0), 0)
                  const pct   = total > 0 ? ((p.revenue_usd||0)/total*100).toFixed(1) : 0
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background: COLORS[i%COLORS.length]}} />
                        <span className="text-gray-600 dark:text-gray-400 truncate max-w-20">{p.payment_method}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-gray-900 dark:text-white">{pct}%</span>
                        <span className="text-gray-400 ml-1">({p.count})</span>
                      </div>
                    </div>
                  )
                })}
                {!(analytics?.byPayment?.length) && <p className="text-xs text-gray-400 text-center py-2">{t('no_data')}</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Branches, products, and customers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {/* Branch */}
        <div className="card p-3 sm:p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">{t('branch_performance')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (() => {
            const all = analytics?.byBranch || []
            const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#0891b2']
            const maxRev = Math.max(...all.map(b=>b.revenue_usd||0), 0.01)
            const vis = showAllBranches ? all : all.slice(0,4)
            return (
              <>
                <div className="space-y-2">
                  {all.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">{t('no_data')}</p>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">{t('top_products')}</h2>
            <div className="flex gap-1">
              {[['revenue',`$ ${t('revenue')}`],['qty',t('quantity')]].map(([m,lbl]) => (
                <button key={m} onClick={() => setTopMode(m)}
                  className={`px-2 py-0.5 text-xs rounded font-medium ${topMode===m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
            <>
              <div className="space-y-1.5">
                {topList.length === 0 ? <p className="text-xs text-gray-400 text-center py-4">{t('no_data')}</p>
                : (showAllProducts ? topList : topList.slice(0,4)).map((p,i) => {
                  const maxVal = topMode==='qty' ? topList[0]?.qty_sold||1 : topList[0]?.revenue_usd||1
                  const val    = topMode==='qty' ? p.qty_sold : p.revenue_usd
                  const pct    = (val/maxVal*100).toFixed(0)
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-xs mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400 w-4 text-right">{i+1}.</span>
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-32">{p.product_name}</span>
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {topMode==='qty' ? `${p.qty_sold} ${t('qty_sold')}` : fmtUSD(p.revenue_usd)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width:`${pct}%` }} />
                        </div>
                      </div>
                      <PortalMenu trigger={<button className="text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded text-xs flex-shrink-0">Open</button>}
                        items={[{ label:t('product_details'), onClick:()=>setProductDetail(p) }]} align="right" />
                    </div>
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
                <h2 className="font-semibold text-gray-900 dark:text-white text-sm">{t('top_customers')}</h2>
                <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{t('net_of_returns')}</span>
              </div>
              {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (
                <>
                  {customers.length === 0
                    ? <p className="text-xs text-gray-400 text-center py-4">{t('no_named_customers')}</p>
                    : (
                      <>
                        <div className="space-y-1.5">
                          {visible.map((c,i) => {
                            const maxRev = customers[0]?.net_revenue_usd || 1
                            const pct = Math.max(2,(c.net_revenue_usd/maxRev*100)).toFixed(0)
                            return (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between text-xs mb-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-gray-400 w-4 text-right">{i+1}.</span>
                                      <span className="text-gray-700 dark:text-gray-300 truncate max-w-36">{c.customer_name}</span>
                                    </div>
                                    <span className="font-medium text-green-700 dark:text-green-400">{fmtUSD(c.net_revenue_usd)}</span>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden ml-5">
                                    <div className="h-full bg-green-500 rounded-full" style={{ width:`${pct}%` }} />
                                  </div>
                                </div>
                                <PortalMenu trigger={<button className="text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded text-xs flex-shrink-0">Open</button>}
                                  items={[{ label:t('customer_details'), onClick:()=>setCustomerDetail(c) }]} align="right" />
                              </div>
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
        <div className="card p-3 sm:p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">{t('best_hour')}</h2>
          {aLoading ? <div className="h-28 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-xl" /> : (() => {
            const hourly = analytics?.hourlyDist || []
            const tzOff  = -(new Date().getTimezoneOffset())/60
            const merged = {}
            hourly.forEach(h => {
              const lh = ((Math.round(parseInt(h.hour,10)+tzOff))%24+24)%24
              if (!merged[lh]) merged[lh] = { hour:lh, count:0, revenue_usd:0 }
              merged[lh].count       += Number(h.count)||0
              merged[lh].revenue_usd += parseFloat(h.revenue_usd)||0
            })
            const maxCount   = Math.max(...Object.values(merged).map(h=>h.count), 1)
            const allHours   = Array.from({length:24},(_,i) => merged[i]||{hour:i,count:0,revenue_usd:0})
            const sortedBusy = Object.values(merged).filter(h=>h.count>0).sort((a,b)=>b.count-a.count)
            const fmtH = h => { const hh=((h%24)+24)%24; if(hh===0)return'12am'; if(hh===12)return'12pm'; return hh<12?`${hh}am`:`${hh-12}pm` }
            const visH = showAllHours ? sortedBusy : sortedBusy.slice(0,3)
            return (
              <>
                <div className="relative mb-3">
                  <div className="grid gap-px" style={{ gridTemplateColumns:'repeat(24,1fr)' }}>
                    {allHours.map(h => {
                      const op = h.count===0 ? 0.06 : 0.12+h.count/maxCount*0.88
                      return <div key={h.hour} title={`${String(h.hour).padStart(2,'0')}:00 - ${h.count} ${t('sale')}(s), ${fmtUSD(h.revenue_usd)}`}
                        className="rounded-sm cursor-default" style={{ height:32, background:`rgba(37,99,235,${op.toFixed(2)})` }} />
                    })}
                  </div>
                  <div className="flex text-[9px] text-gray-400 mt-1" style={{ position:'relative', height:16 }}>
                    {[0,6,12,18,23].map(h => (
                      <span key={h} style={{ position:'absolute', left:`${(h/23)*100}%`, transform:'translateX(-50%)' }}>{fmtH(h)}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  {visH.length===0 && <p className="text-xs text-gray-400 text-center">{t('no_data')}</p>}
                  {visH.map((h,i) => (
                    <div key={h.hour} className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{`#${i + 1}`} {String(h.hour).padStart(2,'0')}:00 ({fmtH(h.hour)})</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{h.count} {t('sale')}{h.count!==1?'s':''} - {fmtUSD(h.revenue_usd)}</span>
                    </div>
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
            {(summary?.low_stock?.length||0) > 0 && (
              <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded-full font-medium">{summary.low_stock.length}</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {!summary?.low_stock?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('in_stock')}</p>
              : (showAllLowStock ? summary.low_stock : summary.low_stock.slice(0,5)).map(p => (
                <div key={p.id} className="flex items-center justify-between px-3 sm:px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{p.name}</p>
                    {p.category && <p className="text-xs text-gray-400">{p.category}</p>}
                  </div>
                  <span className="badge-yellow">{p.stock_quantity} {p.unit}</span>
                </div>
              ))}
          </div>
          {(summary?.low_stock?.length||0) > 5 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setShowAllLowStock(v=>!v)} className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-0.5">
                {showAllLowStock ? t('show_less') : `${t('view_all')} ${summary.low_stock.length} ${t('items')}`}
              </button>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">{t('recent_activity')}</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {!summary?.recent_sales?.length
              ? <p className="p-4 text-sm text-gray-400 text-center">{t('no_data')}</p>
              : (showAllRecent ? summary.recent_sales : summary.recent_sales.slice(0,5)).map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 sm:px-4 py-2.5 gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{s.receipt_number}</p>
                    <p className="text-xs text-gray-400 truncate">{fmtTime(s.created_at)}{s.branch_name ? ` - ${s.branch_name}` : ''}{s.customer_name ? ` - ${s.customer_name}` : ''}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="font-semibold text-green-600">{fmtUSD(s.total_usd||s.total||0)}</span>
                    {s.total_khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(s.total_khr)}</div>}
                  </div>
                </div>
              ))}
          </div>
          {(summary?.recent_sales?.length||0) > 5 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => setShowAllRecent(v=>!v)} className="w-full text-xs text-blue-600 dark:text-blue-400 hover:underline py-0.5">
                {showAllRecent ? t('show_less') : t('view_more')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Product detail modal */}
      {productDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setProductDetail(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col max-h-[85vh]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('product_details')}</h2>
                <div className="text-xs text-gray-400 mt-0.5 truncate max-w-56">{productDetail.product_name}</div>
              </div>
              <button onClick={() => setProductDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">Close</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: t('qty_sold'),  value: productDetail.qty_sold||0,           cls:'text-blue-600',  bg:'bg-blue-50 dark:bg-blue-900/20' },
                  { label: t('revenue'),   value: fmtUSD(productDetail.revenue_usd||0), cls:'text-green-600', bg:'bg-green-50 dark:bg-green-900/20' },
                ].map(item => (
                  <div key={item.label} className={`${item.bg} rounded-xl p-3 text-center`}>
                    <div className={`text-lg font-bold ${item.cls}`}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 text-center pt-1">{t('revenue_net_returns')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Customer detail modal */}
      {customerDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setCustomerDetail(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm flex flex-col max-h-[85vh]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('customer_details')}</h2>
                <div className="text-xs text-gray-400 mt-0.5">{customerDetail.customer_name}</div>
              </div>
              <button onClick={() => setCustomerDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">Close</button>
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
                  {fmtUSD(customerDetail.sale_count > 0 ? customerDetail.net_revenue_usd/customerDetail.sale_count : 0)}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 text-center">{t('net_revenue_desc')}</p>
            </div>
          </div>
        </div>
      )}
      {kpiDetail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setKpiDetail(null)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{kpiDetail.label}</h2>
                <p className="text-xs text-gray-400 mt-1">{periodShort}</p>
              </div>
              <button onClick={() => setKpiDetail(null)} className="text-gray-400 hover:text-gray-600 text-sm w-8 h-8 flex items-center justify-center">Close</button>
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
        </div>
      )}
    </div>
  )
}

