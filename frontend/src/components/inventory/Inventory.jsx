// ?? Inventory ????????????????????????????????????????????????????????????????
// Main Inventory page ??sub-components imported from sibling files.

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Boxes, ChevronDown, ChevronRight, ClipboardList, Package, Upload, X } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { downloadCSV } from '../../utils/csv'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import DualMoney from './DualMoney'
import ProductDetailModal from './ProductDetailModal'
import InventoryImportModal from './InventoryImportModal'
import { buildMovementGroups, movementGroupHaystack } from './movementGroups'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.mjs'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
} from '../../utils/loaders.mjs'

export default function Inventory() {
  const { t, user, notify, fmtUSD, fmtKHR, usdSymbol, page } = useApp()
  const { syncChannel } = useSync()
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const [summary,       setSummary]       = useState([])
  const [movements,     setMovements]     = useState([])
  const [branches,      setBranches]      = useState([])
  const [returnStats,   setReturnStats]   = useState(null)
  const [taxDelivery,   setTaxDelivery]   = useState({ tax: 0, delivery: 0, deliveryCount: 0 })
  const [branchFilter,  setBranchFilter]  = useState('all')
  const [adjustModal,   setAdjustModal]   = useState(null)
  const [adjustForm,    setAdjustForm]    = useState({ type:'add', quantity:1, unit_cost_usd:0, unit_cost_khr:0, reason:'', branch_id:'' })
  const [search,        setSearch]        = useState('')
  const [brandFilter,   setBrandFilter]   = useState('all')
  const [stockFilter,   setStockFilter]   = useState('all')
  const [tab,           setTab]           = useState('products')
  const [movFilter,     setMovFilter]     = useState('all')
  const [movementYearFilter, setMovementYearFilter] = useState('all')
  const [movementMonthFilter, setMovementMonthFilter] = useState('all')
  const [selectedMovementIds, setSelectedMovementIds] = useState(() => new Set())
  const [detailProduct, setDetailProduct] = useState(null)
  const [expandedMovementGroups, setExpandedMovementGroups] = useState(() => new Set())
  const [loading,       setLoading]       = useState(true)
  const [adjustSaving,  setAdjustSaving]  = useState(false)
  const [statDetail,    setStatDetail]    = useState(null)
  const [showImport, setShowImport] = useState(false)
  const movementSelectAllRef = useRef(null)
  const loadRequestRef = useRef(0)
  const movementTimeMode = useMemo(
    () => getTimeGroupingMode(movementYearFilter, movementMonthFilter),
    [movementMonthFilter, movementYearFilter],
  )

  const load = useCallback(async (silent = false) => {
    const requestId = beginTrackedRequest(loadRequestRef)
    if (!silent) setLoading(true)
    // branchId must be a number or omitted ??NOT wrapped in a plain object at the call site
    const branchOpts = branchFilter !== 'all' ? { branchId: parseInt(branchFilter) } : {}
    try {
      const result = await settleLoaderMap({
        summary: () => window.api.getInventorySummary(branchOpts),
        movements: () => window.api.getInventoryMovements(branchOpts),
        branches: () => window.api.getBranches(),
        returns: () => window.api.getReturns({ scope: 'all' }).catch(() => []),
        dashboard: () => window.api.getDashboard().catch(() => ({})),
      })
      const sum = result.values.summary
      const movs = result.values.movements
      const brs = result.values.branches
      const rets = result.values.returns
      const dash = result.values.dashboard

      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      if (Array.isArray(sum)) setSummary(sum || [])
      if (Array.isArray(movs)) setMovements(movs || [])
      if (Array.isArray(brs)) setBranches(brs.filter(b => b.is_active))
      if (dash && typeof dash === 'object') {
        setTaxDelivery({
          tax:           dash.all_tax_usd      || 0,
          delivery:      dash.all_delivery_usd  || 0,
          deliveryCount: dash.all_delivery_count || 0,
        })
      }
      if (Array.isArray(rets)) {
        // Compute return stats from the returns list
        const active = rets.filter(r => (r.status || 'completed') !== 'cancelled')
        const customerReturns = active.filter(r => (r.return_scope || 'customer') !== 'supplier')
        const supplierReturns = active.filter(r => (r.return_scope || 'customer') === 'supplier')
        const totalItems = customerReturns.reduce((s, r) => s + (r.items?.reduce((a, i) => a + (i.quantity||0), 0) || 0), 0)
        setReturnStats({
          count:      customerReturns.length,
          refund_usd: customerReturns.reduce((s, r) => s + (r.total_refund_usd || 0), 0),
          refund_khr: customerReturns.reduce((s, r) => s + (r.total_refund_khr || 0), 0),
          items:      totalItems,
          restock:    customerReturns.filter(r => (r.return_type || 'restock') === 'restock').length,
          supplier_count: supplierReturns.length,
          supplier_compensation_usd: supplierReturns.reduce((s, r) => s + (r.supplier_compensation_usd || 0), 0),
          supplier_loss_usd: supplierReturns.reduce((s, r) => s + (r.supplier_loss_usd || 0), 0),
        })
      }
      if (!result.hasAnySuccess) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to load inventory'))
      }
    } catch (e) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      console.warn('[Inventory] load failed:', e.message)
    } finally {
      if (!silent && isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [branchFilter])

  useEffect(() => {
    if (page !== 'inventory') {
      invalidateTrackedRequest(loadRequestRef)
      return
    }
    load()
  }, [load, page])
  useEffect(() => {
    if (page !== 'inventory' || !syncChannel) return
    const ch = syncChannel.channel
    if (ch === 'inventory' || ch === 'products' || ch === 'sales' || ch === 'returns') load(true)
  }, [page, syncChannel, load]) // eslint-disable-line
  useEffect(() => () => invalidateTrackedRequest(loadRequestRef), [])

  const getStockQty = useCallback((product) => {
    if (!product) return 0
    if (branchFilter !== 'all') return product.display_quantity ?? product.stock_quantity ?? 0
    return product.stock_quantity ?? 0
  }, [branchFilter])

  const handleAdjust = async () => {
    if (adjustSaving) return
    const qty = parseFloat(adjustForm.quantity)
    if (!qty || qty <= 0) return notify('Invalid quantity', 'error')
    if (adjustForm.type === 'remove') {
      const branchId = adjustForm.branch_id ? parseInt(adjustForm.branch_id) : null
      if (branchId) {
        const bs = (adjustModal.branch_stock || []).find(s => s.branch_id === branchId)
        const available = bs?.quantity || 0
        if (available <= 0) { notify(t('error')||'No stock in this branch to remove', 'error'); return }
        if (qty > available) { notify(`Cannot remove ${qty} - only ${available} available`, 'error'); return }
      } else {
        const totalQty = getStockQty(adjustModal)
        if (totalQty <= 0) { notify('No stock available to remove', 'error'); return }
        if (qty > totalQty) { notify(`Cannot remove ${qty} - only ${totalQty} available`, 'error'); return }
      }
    }
    setAdjustSaving(true)
    try {
      const res = await window.api.adjustStock({
        productId: adjustModal.id, productName: adjustModal.name,
        type: adjustForm.type, quantity: qty,
        unitCostUsd: parseFloat(adjustForm.unit_cost_usd) || 0,
        unitCostKhr: parseFloat(adjustForm.unit_cost_khr) || 0,
        reason: adjustForm.reason || '',
        branchId: adjustForm.branch_id ? parseInt(adjustForm.branch_id) : null,
        userId: user?.id, userName: user?.name || user?.username,
      })
      if (res?.success) { notify('Stock adjusted'); setAdjustModal(null); load() }
      else notify(res?.error || 'Adjustment failed', 'error')
    } catch (e) { notify(e?.message || 'Error', 'error') }
    finally { setAdjustSaving(false) }
  }

  const openAdjust = (p) => {
    setAdjustModal(p)
    const defaultBranchId = branches.find(branch => branch.is_default)?.id?.toString() || branches[0]?.id?.toString() || ''
    setAdjustForm({ type:'add', quantity:1, unit_cost_usd: p.purchase_price_usd || p.cost_price_usd || 0, unit_cost_khr: p.purchase_price_khr || 0, reason:'', branch_id: defaultBranchId })
  }

  const [searchMode, setSearchMode] = useState('AND') // 'AND' | 'OR'

  // Search: comma-separated terms, AND/OR mode matching Products page behaviour
  const searchTerms = search.trim()
    ? search.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : []

  const matchesSearch = (hay) => {
    if (!searchTerms.length) return true
    return searchMode === 'AND'
      ? searchTerms.every(term => hay.includes(term))
      : searchTerms.some(term => hay.includes(term))
  }

  const productHay = (p) =>
    `${p.name} ${p.category||''} ${p.brand||''} ${p.supplier||''} ${p.sku||''} ${p.barcode||''} ${p.description||''} ${p.unit||''}`.toLowerCase()

  const movHay = (m) =>
    `${m.product_name||''} ${m.branch_name||''} ${m.reason||''} ${m.user_name||''} ${m.movement_type||''}`.toLowerCase()

  const filteredSummary = summary.filter(p => {
    if (!matchesSearch(productHay(p))) return false
    if (brandFilter !== 'all' && String(p.brand || '').toLowerCase() !== brandFilter.toLowerCase()) return false
    const qty = getStockQty(p)
    if (stockFilter === 'low')      return qty > 0 && qty <= p.low_stock_threshold
    if (stockFilter === 'out')      return qty <= (p.out_of_stock_threshold || 0)
    if (stockFilter === 'in_stock') return qty > (p.low_stock_threshold || 0)
    return true
  })

  const filteredMovements = movements.filter(m => {
    if (movFilter !== 'all' && m.movement_type !== movFilter) return false
    return matchesSearch(movHay(m))
  })

  const groupedMovements = useMemo(() => (
    buildMovementGroups(filteredMovements).filter((group) => matchesSearch(movementGroupHaystack(group)))
  ), [filteredMovements, searchTerms, searchMode])

  const movementYears = useMemo(
    () => getAvailableYears(groupedMovements, (group) => group?.latest_at || group?.created_at),
    [groupedMovements],
  )

  const movementSections = useMemo(() => (
    buildTimeActionSections(groupedMovements, {
      getDate: (group) => group?.latest_at || group?.created_at,
      getItemId: (group) => group?.id,
      getActionKey: (group) => group?.movement_type || 'other',
      getActionLabel: (group) => group?.movementLabel || group?.movement_type || 'Other',
      year: movementYearFilter,
      month: movementMonthFilter,
      timeMode: movementTimeMode,
    })
  ), [groupedMovements, movementMonthFilter, movementTimeMode, movementYearFilter])

  const visibleMovementGroups = useMemo(
    () => movementSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [movementSections],
  )

  useEffect(() => {
    setExpandedMovementGroups((current) => {
      const validIds = new Set(visibleMovementGroups.map((group) => group.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleMovementGroups])

  useEffect(() => {
    const validIds = new Set(visibleMovementGroups.map((group) => group.id))
    setSelectedMovementIds((current) => new Set([...current].filter((id) => validIds.has(id))))
  }, [visibleMovementGroups])

  useEffect(() => {
    if (!movementSelectAllRef.current) return
    movementSelectAllRef.current.indeterminate = selectedMovementIds.size > 0 && selectedMovementIds.size < visibleMovementGroups.length
  }, [selectedMovementIds.size, visibleMovementGroups.length])

  const toggleMovementGroup = useCallback((groupId) => {
    setExpandedMovementGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const toggleMovementSelection = useCallback((groupId) => {
    setSelectedMovementIds((current) => toggleIdSet(current, [groupId], !current.has(groupId)))
  }, [])

  const toggleMovementScopeSelection = useCallback((ids, checked) => {
    setSelectedMovementIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const toggleAllMovementSelection = useCallback((checked) => {
    if (!checked) {
      setSelectedMovementIds(new Set())
      return
    }
    setSelectedMovementIds(new Set(visibleMovementGroups.map((group) => group.id)))
  }, [visibleMovementGroups])

  const MOV_COLORS = {
    add:             'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    remove:          'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
    sale:            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    purchase:        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    return:          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    supplier_return: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
    return_reversal: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    adjust:          'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    adjustment:      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    set:             'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    writeoff:        'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
    transfer:        'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  }

  // Stats ??backend SQL already nets out returned quantities and revenue
  const totalValue    = filteredSummary.reduce((s, p) => s + (p.stock_value_usd || 0), 0)
  const lowStockCount = filteredSummary.filter(p => {
    const qty = getStockQty(p)
    return qty > 0 && qty <= p.low_stock_threshold
  }).length
  const outStockCount = filteredSummary.filter(p => getStockQty(p) <= (p.out_of_stock_threshold || 0)).length
  const totalProducts = summary.length
  const totalQtySold  = filteredSummary.reduce((s, p) => s + Math.max(0, p.qty_sold || 0), 0)
  const totalRevenue  = filteredSummary.reduce((s, p) => s + Math.max(0, p.revenue_usd || 0), 0)
  const totalCOGS     = filteredSummary.reduce((s, p) => s + Math.max(0, p.cogs_usd || 0), 0)
  const totalStoreDiscounts = filteredSummary.reduce((s, p) => s + Math.max(0, p.store_discount_usd || 0), 0)
  const totalMembershipDiscounts = filteredSummary.reduce((s, p) => s + Math.max(0, p.membership_discount_usd || 0), 0)
  const totalProfit   = totalRevenue - totalCOGS
  const primaryStats = [
    {
      id: 'products',
      label: t('products'),
      value: totalProducts,
      cls: 'text-gray-800 dark:text-gray-200',
      sub: `${lowStockCount} ${t('low_stock') || 'low'} - ${outStockCount} ${t('out_of_stock') || 'out'}`,
      details: [
        { label: t('products') || 'Products', value: totalProducts },
        { label: t('low_stock') || 'Low stock', value: lowStockCount },
        { label: t('out_of_stock') || 'Out of stock', value: outStockCount },
        { label: t('formula') || 'Formula', value: 'Low/Out counts are derived from stock thresholds' },
      ],
    },
    {
      id: 'stock-value',
      label: t('stock_value'),
      value: fmtUSD(totalValue),
      cls: 'text-blue-700 dark:text-blue-300',
      details: [
        { label: t('stock_value') || 'Stock value', value: fmtUSD(totalValue) },
        { label: t('products') || 'Products', value: totalProducts },
        { label: t('formula') || 'Formula', value: 'Stock value = quantity ? purchase cost per product' },
      ],
    },
    {
      id: 'net-sold',
      label: t('net_sold'),
      value: totalQtySold,
      cls: 'text-purple-700 dark:text-purple-300',
      sub: t('after_returns'),
      details: [
        { label: t('net_sold') || 'Net sold', value: totalQtySold },
        { label: t('returns_count') || 'Returns', value: returnStats?.count ?? 0 },
        { label: t('items') || 'Returned items', value: returnStats?.items ?? 0 },
        { label: t('formula') || 'Formula', value: 'Net sold = sold quantity - returned quantity' },
      ],
    },
    {
      id: 'revenue',
      label: t('revenue'),
      value: fmtUSD(totalRevenue),
      cls: 'text-green-700 dark:text-green-300',
      sub: t('after_refunds'),
      details: [
        { label: t('revenue') || 'Revenue', value: fmtUSD(totalRevenue) },
        { label: t('total_refunded') || 'Refunded', value: fmtUSD(returnStats?.refund_usd || 0) },
        { label: t('tax_collected') || 'Tax', value: fmtUSD(taxDelivery.tax || 0) },
        { label: t('formula') || 'Formula', value: 'Revenue shown is net after discounts and refunds' },
      ],
    },
    {
      id: 'cogs',
      label: t('cogs'),
      value: fmtUSD(totalCOGS),
      cls: 'text-orange-600 dark:text-orange-400',
      sub: t('cost_of_goods_sold'),
      details: [
        { label: t('cogs') || 'COGS', value: fmtUSD(totalCOGS) },
        { label: t('store_discounts') || 'Store discounts', value: fmtUSD(totalStoreDiscounts) },
        { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(totalMembershipDiscounts) },
        { label: t('formula') || 'Formula', value: 'COGS excludes quantities restored by restocked returns' },
      ],
    },
    {
      id: 'profit',
      label: t('gross_profit'),
      value: fmtUSD(totalProfit),
      cls: totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      details: [
        { label: t('gross_profit') || 'Gross profit', value: fmtUSD(totalProfit) },
        { label: t('revenue') || 'Revenue', value: fmtUSD(totalRevenue) },
        { label: t('cogs') || 'COGS', value: fmtUSD(totalCOGS) },
        { label: t('formula') || 'Formula', value: 'Profit = Revenue - COGS' },
      ],
    },
  ]
  const financeStats = [
    {
      id: 'store-discounts',
      label: t('store_discounts') || 'Store discounts',
      value: fmtUSD(totalStoreDiscounts),
      cls: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-400',
      sub: t('allocated_to_products') || 'Allocated to sold products',
      details: [
        { label: t('store_discounts') || 'Store discounts', value: fmtUSD(totalStoreDiscounts) },
        { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(totalMembershipDiscounts) },
      ],
    },
    {
      id: 'membership-discounts',
      label: t('membership_discounts') || 'Membership discounts',
      value: fmtUSD(totalMembershipDiscounts),
      cls: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-400',
      sub: t('allocated_to_products') || 'Allocated to sold products',
      details: [
        { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(totalMembershipDiscounts) },
        { label: t('store_discounts') || 'Store discounts', value: fmtUSD(totalStoreDiscounts) },
      ],
    },
    {
      id: 'refund',
      label: t('total_refunded') || 'Refunded',
      value: fmtUSD(returnStats?.refund_usd || 0),
      cls: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-400',
      sub: `${returnStats?.items || 0} ${t('items') || 'items'}`,
      details: [
        { label: t('total_refunded') || 'Refunded', value: fmtUSD(returnStats?.refund_usd || 0) },
        { label: t('returns_count') || 'Returns', value: returnStats?.count ?? 0 },
        { label: t('restocked_to_inventory') || 'Restocked', value: returnStats?.restock ?? 0 },
      ],
    },
    {
      id: 'tax',
      label: t('tax_collected') || 'Tax collected',
      value: fmtUSD(taxDelivery.tax || 0),
      cls: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-400',
      sub: t('completed_sales_only') || 'Completed sales only',
      details: [
        { label: t('tax_collected') || 'Tax collected', value: fmtUSD(taxDelivery.tax || 0) },
        { label: t('revenue') || 'Revenue', value: fmtUSD(totalRevenue) },
      ],
    },
    {
      id: 'delivery',
      label: t('delivery_fees') || 'Delivery fees',
      value: fmtUSD(taxDelivery.delivery || 0),
      cls: 'text-sky-600 dark:text-sky-400',
      border: 'border-sky-400',
      sub: `${taxDelivery.deliveryCount || 0} ${t('transactions') || 'transactions'}`,
      details: [
        { label: t('delivery_fees') || 'Delivery fees', value: fmtUSD(taxDelivery.delivery || 0) },
        { label: t('transactions') || 'Transactions', value: taxDelivery.deliveryCount || 0 },
      ],
    },
    {
      id: 'returns',
      label: t('returns_count') || 'Returns',
      value: returnStats?.count ?? 0,
      cls: 'text-orange-600 dark:text-orange-400',
      border: 'border-orange-400',
      sub: `${returnStats?.restock ?? 0} ${t('restocked_to_inventory') || 'restocked'}`,
      details: [
        { label: t('returns_count') || 'Returns', value: returnStats?.count ?? 0 },
        { label: t('total_refunded') || 'Refunded', value: fmtUSD(returnStats?.refund_usd || 0) },
        { label: t('items') || 'Items', value: returnStats?.items ?? 0 },
      ],
    },
    {
      id: 'supplier-returns',
      label: t('supplier_returns') || 'Supplier returns',
      value: returnStats?.supplier_count ?? 0,
      cls: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-400',
      sub: `${t('supplier_compensation') || 'Compensation'} ${fmtUSD(returnStats?.supplier_compensation_usd || 0)}`,
      details: [
        { label: t('supplier_returns') || 'Supplier returns', value: returnStats?.supplier_count ?? 0 },
        { label: t('supplier_compensation') || 'Compensation', value: fmtUSD(returnStats?.supplier_compensation_usd || 0) },
        { label: t('business_loss') || 'Business loss', value: fmtUSD(returnStats?.supplier_loss_usd || 0) },
      ],
    },
  ]
  const inventoryBrands = [...new Set(summary.map((p) => String(p.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const selectedMovementGroups = visibleMovementGroups.filter((group) => selectedMovementIds.has(group.id))

  const exportMovementGroups = useCallback((groups, filePrefix = 'inventory-movements') => {
    const rows = groups.map(group => ({
      Date: group.latest_at || '',
      Activity: group.movementLabel || '',
      Products: group.productSummary || '',
      Records: group.items?.length || 0,
      Qty: group.totalQuantity || 0,
      Branch: group.branchSummary || '',
      Reason: group.reasonSummary || '',
      User: group.userSummary || '',
    }))
    downloadCSV(`${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }, [])

  const exportInventorySummary = useCallback((productsToExport = filteredSummary, filePrefix = 'inventory') => {
    const rows = productsToExport.map((p) => ({
      Name: p.name || '',
      SKU: p.sku || '',
      Category: p.category || '',
      Brand: p.brand || '',
      Stock_Qty: getStockQty(p),
      Sold_Qty: p.qty_sold || 0,
      Revenue_USD: p.revenue_usd || 0,
      COGS_USD: p.cogs_usd || 0,
      Profit_USD: (p.revenue_usd || 0) - (p.cogs_usd || 0),
      Stock_Value_USD: getStockQty(p) * (p.purchase_price_usd || p.cost_price_usd || 0),
      Unit: p.unit || '',
      Supplier: p.supplier || '',
    }))
    downloadCSV(`${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }, [filteredSummary])

  const inventoryExportItems = useMemo(() => {
    if (tab === 'movements') {
      return [
        { label: `Export ${t('movements') || 'Movements'}`, onClick: () => exportMovementGroups(visibleMovementGroups) },
        selectedMovementGroups.length ? { label: 'Export selected movements', onClick: () => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected'), color: 'blue' } : null,
        movementYearFilter !== 'all' || movementMonthFilter !== 'all'
          ? { label: 'Export current time filter', onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-filtered') }
          : null,
        branchFilter !== 'all'
          ? { label: 'Export current branch movements', onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-branch') }
          : null,
        movFilter !== 'all'
          ? { label: 'Export current activity type', onClick: () => exportMovementGroups(visibleMovementGroups, `inventory-movements-${movFilter}`) }
          : null,
        'divider',
        { label: 'Export inventory summary', onClick: () => exportInventorySummary(summary, 'inventory-summary') },
      ].filter(Boolean)
    }

    return [
      { label: 'Export visible products', onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-visible') },
      branchFilter !== 'all'
        ? { label: 'Export current branch products', onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-branch') }
        : null,
      stockFilter !== 'all'
        ? { label: 'Export current stock filter', onClick: () => exportInventorySummary(filteredSummary, `inventory-products-${stockFilter}`) }
        : null,
      brandFilter !== 'all'
        ? { label: 'Export current brand filter', onClick: () => exportInventorySummary(filteredSummary, `inventory-products-brand`) }
        : null,
      { label: 'Export full inventory summary', onClick: () => exportInventorySummary(summary, 'inventory-summary') },
    ].filter(Boolean)
  }, [
    branchFilter,
    brandFilter,
    exportInventorySummary,
    exportMovementGroups,
    filteredSummary,
    movFilter,
    movementMonthFilter,
    movementYearFilter,
    selectedMovementGroups,
    summary,
    tab,
    t,
    visibleMovementGroups,
  ])

  const inventoryFilterSections = useMemo(() => {
    if (tab === 'movements') {
      return [
        branches.length > 1 ? {
          id: 'branch',
          label: t('branch') || 'Branch',
          options: [
            { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
            ...branches.map((branch) => ({
              id: `branch-${branch.id}`,
              label: branch.name,
              active: branchFilter === String(branch.id),
              onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
            })),
          ],
        } : null,
        {
          id: 'movement-type',
          label: t('activity') || 'Activity',
          options: [
            { id: 'all', label: t('all_types') || 'All types', active: movFilter === 'all', onClick: () => setMovFilter('all') },
            ['sale', t('sale') || 'Sale'],
            ['purchase', t('purchase') || 'Purchase'],
            ['return', t('returns') || 'Return'],
            ['return_reversal', t('return_type_writeoff') || 'Return reversal'],
            ['adjustment', t('adjustment') || 'Adjustment'],
            ['transfer', t('stock_transfer') || 'Transfer'],
          ].slice(1).map(([value, label]) => ({
            id: value,
            label,
            active: movFilter === value,
            onClick: () => setMovFilter(movFilter === value ? 'all' : value),
          })),
        },
        {
          id: 'movement-year',
          label: 'Year',
          options: [
            { id: 'all', label: 'All years', active: movementYearFilter === 'all', onClick: () => { setMovementYearFilter('all'); setMovementMonthFilter('all') } },
            ...movementYears.map((year) => ({
              id: `year-${year}`,
              label: year,
              active: movementYearFilter === year,
              onClick: () => {
                const next = movementYearFilter === year ? 'all' : year
                setMovementYearFilter(next)
                if (next === 'all') setMovementMonthFilter('all')
              },
            })),
          ],
        },
        {
          id: 'movement-month',
          label: 'Month',
          options: [
            { id: 'all', label: 'All months', active: movementMonthFilter === 'all', onClick: () => setMovementMonthFilter('all') },
            ...Array.from({ length: 12 }, (_, index) => {
              const month = String(index + 1)
              const label = new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })
              return {
                id: `month-${month}`,
                label,
                active: movementMonthFilter === month,
                onClick: () => setMovementMonthFilter(movementMonthFilter === month ? 'all' : month),
              }
            }),
          ],
        },
      ].filter(Boolean)
    }

    return [
      branches.length > 1 ? {
        id: 'branch',
        label: t('branch') || 'Branch',
        options: [
          { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
          ...branches.map((branch) => ({
            id: `branch-${branch.id}`,
            label: branch.name,
            active: branchFilter === String(branch.id),
            onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
          })),
        ],
      } : null,
      inventoryBrands.length ? {
        id: 'brand',
        label: t('brand') || 'Brand',
        options: [
          { id: 'all', label: t('all_brands') || 'All brands', active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
          ...inventoryBrands.map((brand) => ({
            id: `brand-${brand}`,
            label: brand,
            active: brandFilter === brand,
            onClick: () => setBrandFilter(brandFilter === brand ? 'all' : brand),
          })),
        ],
      } : null,
      {
        id: 'stock',
        label: t('stock_status') || 'Stock status',
        options: [
          { id: 'all', label: t('all_stock') || 'All stock', active: stockFilter === 'all', onClick: () => setStockFilter('all') },
          { id: 'in-stock', label: t('in_stock') || 'In stock', active: stockFilter === 'in_stock', onClick: () => setStockFilter(stockFilter === 'in_stock' ? 'all' : 'in_stock') },
          { id: 'low', label: t('low_stock') || 'Low stock', active: stockFilter === 'low', onClick: () => setStockFilter(stockFilter === 'low' ? 'all' : 'low') },
          { id: 'out', label: t('out_of_stock') || 'Out of stock', active: stockFilter === 'out', onClick: () => setStockFilter(stockFilter === 'out' ? 'all' : 'out') },
        ],
      },
    ].filter(Boolean)
  }, [
    branchFilter,
    branches,
    brandFilter,
    inventoryBrands,
    movFilter,
    movementMonthFilter,
    movementYearFilter,
    movementYears,
    stockFilter,
    t,
    tab,
  ])

  const activeInventoryFilterCount = useMemo(() => {
    if (tab === 'movements') {
      return [
        branchFilter !== 'all',
        movFilter !== 'all',
        movementYearFilter !== 'all',
        movementMonthFilter !== 'all',
      ].filter(Boolean).length
    }

    return [
      branchFilter !== 'all',
      brandFilter !== 'all',
      stockFilter !== 'all',
    ].filter(Boolean).length
  }, [branchFilter, brandFilter, movFilter, movementMonthFilter, movementYearFilter, stockFilter, tab])

  const clearInventoryFilters = useCallback(() => {
    setBranchFilter('all')
    setBrandFilter('all')
    setStockFilter('all')
    setMovFilter('all')
    setMovementYearFilter('all')
    setMovementMonthFilter('all')
  }, [])

  const isMovementScopeFullySelected = useCallback(
    (ids = []) => ids.length > 0 && ids.every((id) => selectedMovementIds.has(id)),
    [selectedMovementIds],
  )

  const isMovementScopePartiallySelected = useCallback(
    (ids = []) => ids.some((id) => selectedMovementIds.has(id)) && !isMovementScopeFullySelected(ids),
    [isMovementScopeFullySelected, selectedMovementIds],
  )

  return (
    <div className="page-scroll p-3 sm:p-6">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('inventory')}
          </h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setShowImport(true)}
            className="btn-secondary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm"
            title={tr('import', 'Import', 'នាំចូល')}
          >
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {tr('import', 'Import', 'នាំចូល')}
            </span>
          </button>
          {tab === 'products' ? (
            <ExportMenu
              label={tr('export', 'Export', 'នាំចេញ')}
              items={inventoryExportItems}
              compact
            />
          ) : null}
        </div>
      </div>

      {selectedMovementGroups.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900/40 dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedMovementGroups.length} movement group{selectedMovementGroups.length === 1 ? '' : 's'} selected</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected')}>
            Export selected
          </button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedMovementIds(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {/* ?? Primary Stats bar ?? */}
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('tap_any_stat_for_details') || 'Tap any stat card for details.'}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
        {primaryStats.map((stat) => (
          <button
            key={stat.id}
            type="button"
            className="card px-3 py-2 text-left transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/50"
            onClick={() => setStatDetail(stat)}
          >
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub && <div className="text-[10px] text-gray-400">{stat.sub}</div>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4">
        {financeStats.map((stat) => (
          <button
            key={stat.id}
            type="button"
            className={`card px-3 py-2 border-l-2 text-left transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/50 ${stat.border}`}
            onClick={() => setStatDetail(stat)}
          >
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub ? <div className="text-[10px] text-gray-400 mt-0.5">{stat.sub}</div> : null}
          </button>
        ))}
      </div>

      {false && (<>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-2">
        {[
          { label:t('products'),    value: totalProducts,            cls:'text-gray-800 dark:text-gray-200' },
          { label:t('stock_value'), value: fmtUSD(totalValue),       cls:'text-blue-700 dark:text-blue-300' },
          { label:t('net_sold'),    value: totalQtySold,             cls:'text-purple-700 dark:text-purple-300', sub:t('after_returns') },
          { label:t('revenue'),     value: fmtUSD(totalRevenue),     cls:'text-green-700 dark:text-green-300', sub:t('after_refunds') },
          { label:t('cogs'),        value: fmtUSD(totalCOGS),        cls:'text-orange-600 dark:text-orange-400', sub:t('cost_of_goods_sold') },
          { label:t('gross_profit'),value: fmtUSD(totalProfit),      cls: totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' },
          { label:t('low_stock'),   value: lowStockCount,            cls: lowStockCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400', sub:t('need_restock') },
          { label:t('out_of_stock'),value: outStockCount,            cls: outStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400', sub:t('unavailable') },
        ].map(stat => (
          <div key={stat.label} className="card px-3 py-2">
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub && <div className="text-[10px] text-gray-400">{stat.sub}</div>}
          </div>
        ))}
      </div>

      {/* ?? Secondary Stats: Returns (compact) 繚 Tax 繚 Delivery ?? */}
      <div className="hidden grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {/* Returns ??compact with inline note */}
        <div className="card px-3 py-2 border-l-2 border-orange-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('returns_count')}</div>
          <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
            {returnStats?.count ?? 0}
            <span className="text-[10px] font-normal text-gray-400 ml-1">{t('transactions')}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats && returnStats.count > 0
              ? `${returnStats.items} items 繚 refunded ${fmtUSD(returnStats.refund_usd)}`
              : t('no_returns')}
          </div>
        </div>

        {/* Refunded amount */}
        <div className="card px-3 py-2 border-l-2 border-red-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('total_refunded')}</div>
          <div className="text-sm font-bold text-red-600 dark:text-red-400">{fmtUSD(returnStats?.refund_usd ?? 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats?.restock ?? 0} {t('restocked_to_inventory')}
          </div>
        </div>

        {/* Tax collected */}
        <div className="card px-3 py-2 border-l-2 border-indigo-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('tax_collected')}</div>
          <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{fmtUSD(taxDelivery.tax)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('all_time_sales')}</div>
        </div>

        {/* Delivery fees */}
        <div className="card px-3 py-2 border-l-2 border-teal-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('delivery_fees')}</div>
          <div className="text-sm font-bold text-teal-600 dark:text-teal-400">{fmtUSD(taxDelivery.delivery)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {taxDelivery.deliveryCount} {t('deliveries_made')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <div className="card px-3 py-2 border-l-2 border-amber-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('store_discounts') || 'Store discounts'}</div>
          <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{fmtUSD(totalStoreDiscounts)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('allocated_to_products') || 'Allocated to sold products'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-emerald-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('membership_discounts') || 'Membership discounts'}</div>
          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtUSD(totalMembershipDiscounts)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('allocated_to_products') || 'Allocated to sold products'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-rose-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('total_refunded') || 'Refunded'}</div>
          <div className="text-sm font-bold text-rose-600 dark:text-rose-400">{fmtUSD(returnStats?.refund_usd || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{returnStats?.items || 0} {t('items') || 'items'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-indigo-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('tax_collected') || 'Tax collected'}</div>
          <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{fmtUSD(taxDelivery.tax || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('completed_sales_only') || 'Completed sales only'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-sky-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('delivery_fees') || 'Delivery fees'}</div>
          <div className="text-sm font-bold text-sky-600 dark:text-sky-400">{fmtUSD(taxDelivery.delivery || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{taxDelivery.deliveryCount || 0} {t('transactions') || 'transactions'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-orange-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('returns_count') || 'Returns'}</div>
          <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
            {returnStats?.count ?? 0}
            <span className="ml-1 text-[10px] font-normal text-gray-400">{t('transactions') || 'transactions'}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats?.restock ?? 0} {t('restocked_to_inventory') || 'restocked'}
          </div>
        </div>
      </div>

      {/* ?? Tabs ?? */}
      </>
      )}
      <div className="mb-4 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {[['products', t('products')], ['movements', t('movements')]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab===id ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ?? Filters ?? */}
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="flex min-w-0 flex-1 gap-0">
          <input
            id="inventory-search"
            name="inventory_search"
            aria-label="Inventory search"
            className="input flex-1 text-sm rounded-r-none"
            placeholder={tab === 'products'
              ? `${t('search') || 'Search'} - separate terms with commas, then choose match mode`
              : `${t('search') || 'Search'} ${t('movements') || 'Movements'}`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === 'products' && (
            <div className="flex border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg overflow-hidden">
              {['AND','OR'].map(m => (
                <button key={m}
                  onClick={() => setSearchMode(m)}
                  className={`px-2.5 py-1.5 text-xs font-bold transition-colors ${searchMode===m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50'}`}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <FilterMenu
          label={t('filters') || 'Filters'}
          activeCount={activeInventoryFilterCount}
          sections={inventoryFilterSections}
          onClear={clearInventoryFilters}
          compact
        />
      </div>

      {search.trim() && tab === 'products' && (
        <p className="text-[10px] text-gray-400 mb-1">
          {t('inventory_and_or_tip')||'Comma separates terms. AND requires all terms, OR requires any term.'} -{' '}
          <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">cola, water</span>
          {' '}{t('search_example_finds')||'Example: AND finds items matching both terms, OR finds either term.'}
        </p>
      )}

      <p className="text-xs text-gray-400 mb-2">
        {tab === 'products'
          ? `${filteredSummary.length} of ${totalProducts} ${t('products')||'products'} - ${t('tap_for_details')||'click a row for details'}`
          : `${visibleMovementGroups.length} grouped ${t('movements')||'movements'} - ${t('tap_for_details')||'click a row for details'}`}
      </p>

      {/* ????????????????????????????????????????
          PRODUCTS TAB
      ???????????????????????????????????????? */}
      {tab === 'products' && (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {loading ? (
              <div className="text-center py-10 text-gray-400">{t('loading')}</div>
            ) : filteredSummary.length === 0 ? (
              <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
            ) : filteredSummary.map(p => {
              const qty   = getStockQty(p)
              const isLow = qty > 0 && qty <= p.low_stock_threshold
              const isOut = qty <= (p.out_of_stock_threshold || 0)
              const scls  = isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isLow ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700' : 'bg-green-100 dark:bg-green-900/30 text-green-700'
              const slbl  = isOut ? 'Out' : isLow ? 'Low' : 'OK'
              return (
                <div key={p.id} className="card p-3 cursor-pointer" onClick={() => setDetailProduct(p)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{p.name}</div>
                      {p.category && <div className="text-xs text-gray-400">{p.category}</div>}
                      <div className="flex gap-3 mt-1 text-xs text-gray-500">
                        <span>Cost {fmtUSD(p.purchase_price_usd || 0)}</span>
                        <span>Price {fmtUSD(p.selling_price_usd || 0)}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className={`text-xl font-bold ${isOut ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-green-600'}`}>{qty}</div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${scls}`}>{slbl}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="text-xs text-gray-500 truncate">
                      {Math.max(0, p.qty_sold || 0) > 0 && (
                        <span>Sold {Math.max(0, p.qty_sold)} - Rev {fmtUSD(Math.max(0, p.revenue_usd || 0))}</span>
                      )}
                    </div>
                    <button onClick={e => { e.stopPropagation(); openAdjust(p) }}
                      className="text-xs text-blue-600 dark:text-blue-400 font-medium px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex-shrink-0">
                      {t('adjust')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="card overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 min-w-[140px]">{t('product_name')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('current_stock')}</th>
                    {branches.length > 1 && (
                      <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">{t('branches')}</th>
                    )}
                    <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{t('cost')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{t('price')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden lg:table-cell">{t('stock_val')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden xl:table-cell">{t('net_sold_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-green-700 dark:text-green-400 whitespace-nowrap hidden xl:table-cell">{t('revenue_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-orange-600 dark:text-orange-400 whitespace-nowrap hidden xl:table-cell">{t('cogs_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap hidden xl:table-cell">{t('profit_header')}</th>
                    <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('adjust_stock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={12} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
                  ) : filteredSummary.length === 0 ? (
                    <tr><td colSpan={12} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
                  ) : filteredSummary.map(p => {
                    const qty    = getStockQty(p)
                    const isLow  = qty > 0 && qty <= p.low_stock_threshold
                    const isOut  = qty <= (p.out_of_stock_threshold || 0)
                    const status = isOut ? { label:'Out', cls:'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs px-1.5 py-0.5 rounded-full' }
                                 : isLow ? { label:'Low', cls:'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs px-1.5 py-0.5 rounded-full' }
                                 :         { label:'OK',  cls:'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs px-1.5 py-0.5 rounded-full' }
                    const netRev  = Math.max(0, p.revenue_usd || 0)
                    const netCogs = Math.max(0, p.cogs_usd || 0)
                    const profit  = netRev - netCogs
                    return (
                      <tr key={p.id} className="table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10" onClick={() => setDetailProduct(p)}>
                        <td className="px-3 py-1">
                          <div className="font-medium text-gray-900 dark:text-white leading-tight">{p.name}</div>
                          {p.category && <div className="text-gray-400 text-[10px]">{p.category}</div>}
                        </td>
                        <td className="px-3 py-1 text-right font-bold text-gray-900 dark:text-white whitespace-nowrap">
                          {qty} <span className="text-gray-400 font-normal text-[10px]">{p.unit}</span>
                        </td>
                        {branches.length > 1 && (
                          <td className="px-3 py-1 hidden md:table-cell">
                            <div className="flex flex-wrap gap-0.5">
                              {(p.branch_stock || []).slice(0,3).map(bs => (
                                <span key={bs.branch_id} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1 py-0.5 rounded">
                                  {bs.branch_name?.split(' ')[0]}: {bs?.quantity ?? 0}
                                </span>
                              ))}
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-1 text-center"><span className={status.cls}>{status.label}</span></td>
                        <td className="px-3 py-1"><DualMoney usd={p.purchase_price_usd||p.cost_price_usd||0} khr={p.purchase_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1"><DualMoney usd={p.selling_price_usd||0} khr={p.selling_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1 hidden lg:table-cell"><DualMoney usd={p.stock_value_usd||0} khr={p.stock_value_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1 text-right text-gray-500 hidden xl:table-cell">{Math.max(0,p.qty_sold||0)}</td>
                        <td className="px-3 py-1 hidden xl:table-cell"><DualMoney usd={netRev} khr={0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1 hidden xl:table-cell text-right">
                          <span className="text-xs font-medium text-orange-600 dark:text-orange-400">{fmtUSD(netCogs)}</span>
                        </td>
                        <td className="px-3 py-1 hidden xl:table-cell">
                          <div className={`text-right text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(profit)}</div>
                        </td>
                        <td className="px-3 py-1 text-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openAdjust(p)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-2 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            {t('adjust')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ????????????????????????????????????????
          MOVEMENTS TAB
      ???????????????????????????????????????? */}
      {tab === 'movements' && (
        <>
          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">Grouped movement history</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Related stock changes are bundled into a single activity so sales, returns, imports, and transfers are easier to review.</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">{visibleMovementGroups.length} groups</div>
                <ExportMenu
                  label={tr('export', 'Export', 'នាំចេញ')}
                  items={inventoryExportItems}
                  compact
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 sm:hidden">
            {loading ? (
              <div className="py-10 text-center text-gray-400">{t('loading')}</div>
            ) : visibleMovementGroups.length === 0 ? (
              <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
            ) : movementSections.map((section) => (
              <div key={section.id} className="space-y-2">
                <div className="flex items-center gap-2 px-1 pt-1">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isMovementScopeFullySelected(section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                    }}
                    onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                  />
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {section.label} · {section.ids.length} groups
                  </div>
                </div>
                {section.groups.map((actionGroup) => (
                  <div key={actionGroup.id} className="space-y-2">
                    <div className="flex items-center gap-2 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isMovementScopeFullySelected(actionGroup.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                        }}
                        onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                      />
                      <span>{actionGroup.label} · {actionGroup.items.length}</span>
                    </div>
                    {actionGroup.items.map((group) => {
                      const isExpanded = expandedMovementGroups.has(group.id)
                      return (
                        <div key={group.id} className="card overflow-hidden">
                          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
                            <label className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={selectedMovementIds.has(group.id)}
                                onChange={() => toggleMovementSelection(group.id)}
                              />
                              Select
                            </label>
                          </div>
                          <button
                            type="button"
                            className="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            onClick={() => toggleMovementGroup(group.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                    {group.movementLabel}
                                  </span>
                                  <span className="text-[10px] text-gray-400">{fmtTime(group.latest_at)}</span>
                                </div>
                                <div className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{group.productSummary || 'Movement'}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400">
                                  <span>{group.items.length} records</span>
                                  {group.branchSummary ? <span>{group.branchSummary}</span> : null}
                                  {group.userSummary ? <span>{group.userSummary}</span> : null}
                                </div>
                                {group.reasonSummary ? <div className="mt-1 truncate text-xs text-gray-500">{group.reasonSummary}</div> : null}
                              </div>
                              <div className="flex items-start gap-2 text-right">
                                <div>
                                  <div className="text-sm font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</div>
                                </div>
                                <ChevronDown className={`mt-0.5 h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </button>
                          {isExpanded ? (
                            <div className="border-t border-gray-200 p-3 dark:border-gray-700">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Records</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{group.items.length}</div>
                                </div>
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('quantity')}</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                </div>
                              </div>
                              {group.reasonSummary ? (
                                <div className="mt-3">
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reason')}</div>
                                  <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800 dark:bg-gray-700/50 dark:text-gray-200">{group.reasonSummary}</div>
                                </div>
                              ) : null}
                              <div className="mt-3 space-y-2">
                                {group.items.map((movement) => (
                                  <div key={movement.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <Package className="h-4 w-4 text-gray-400" />
                                          <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{movement.product_name || 'Product'}</div>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                          <span>{fmtTime(movement.created_at)}</span>
                                          {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                          {movement.user_name ? <span>{movement.user_name}</span> : null}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                        {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="card hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        ref={movementSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={visibleMovementGroups.length > 0 && selectedMovementIds.size === visibleMovementGroups.length}
                        onChange={(event) => toggleAllMovementSelection(event.target.checked)}
                        aria-label="Select all movement groups"
                      />
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Activity</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Products</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">{t('branch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden xl:table-cell">{t('user')}</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400">View</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
                  ) : visibleMovementGroups.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-gray-400">{t('no_data')}</td></tr>
                  ) : movementSections.map((section) => (
                    <Fragment key={section.id}>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isMovementScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                          />
                        </td>
                        <td colSpan={8} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {section.label} · {section.ids.length} groups
                        </td>
                      </tr>
                      {section.groups.map((actionGroup) => (
                        <Fragment key={actionGroup.id}>
                          <tr className="bg-white dark:bg-gray-800/70">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={isMovementScopeFullySelected(actionGroup.ids)}
                                ref={(node) => {
                                  if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                                }}
                                onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                              />
                            </td>
                            <td colSpan={8} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {actionGroup.label} · {actionGroup.items.length} groups
                            </td>
                          </tr>
                          {actionGroup.items.map((group) => {
                            const isExpanded = expandedMovementGroups.has(group.id)
                            return (
                              <Fragment key={group.id}>
                                <tr className="table-row hover:bg-blue-50 dark:hover:bg-blue-900/10">
                                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded"
                                      checked={selectedMovementIds.has(group.id)}
                                      onChange={() => toggleMovementSelection(group.id)}
                                      aria-label={`Select movement group ${group.id}`}
                                    />
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-[10px] text-gray-400">{fmtTime(group.latest_at)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                        {group.movementLabel}
                                      </span>
                                      <span className="text-[10px] text-gray-400">{group.items.length} records</span>
                                    </div>
                                    {group.reasonSummary ? <div className="mt-1 max-w-[220px] truncate text-[11px] text-gray-500">{group.reasonSummary}</div> : null}
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{group.productSummary || 'Movement'}</td>
                                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{group.totalQuantity}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden lg:table-cell">{group.branchSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden xl:table-cell">{group.userSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-center">
                                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700" onClick={() => toggleMovementGroup(group.id)}>
                                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                      {isExpanded ? 'Collapse' : 'Expand'}
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded ? (
                                  <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                                    <td colSpan={9} className="px-4 py-3">
                                      <div className="grid gap-3 lg:grid-cols-[220px,1fr]">
                                        <div className="space-y-3">
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reference')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{group.reference_id || 'N/A'}</div>
                                          </div>
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('recorded_at')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{new Date(group.created_at).toLocaleString()}</div>
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          {group.items.map((movement) => (
                                            <div key={movement.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-gray-400" />
                                                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{movement.product_name || 'Product'}</div>
                                                  </div>
                                                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                                    <span>{fmtTime(movement.created_at)}</span>
                                                    {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                                    {movement.user_name ? <span>{movement.user_name}</span> : null}
                                                    {movement.reason ? <span>{movement.reason}</span> : null}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                                  {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            )
                          })}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ?? Adjust stock modal ?? */}
      {statDetail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setStatDetail(null)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{statDetail.label}</h2>
                <p className="text-xs text-gray-400 mt-1">{t('inventory') || 'Inventory'}</p>
              </div>
              <button onClick={() => setStatDetail(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-2">
              {Array.isArray(statDetail.details) && statDetail.details.length ? statDetail.details.map((row, index) => (
                <div key={`${statDetail.id}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                </div>
              )) : null}
            </div>
          </div>
        </div>
      )}

      {adjustModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAdjustModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('adjust_stock')}</h2>
                <div className="text-xs text-gray-400 mt-0.5">{adjustModal.name} - Current: {getStockQty(adjustModal)} {adjustModal.unit}</div>
              </div>
              <button onClick={() => setAdjustModal(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[[`add`, t('adjust_add')], [`remove`, t('adjust_remove')], [`set`, t('adjust_set')]].map(([v,lbl]) => (
                  <button key={v} onClick={() => setAdjustForm(f=>({...f, type:v}))}
                    className={`py-2 rounded-xl border-2 text-xs font-medium ${adjustForm.type===v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('quantity')} *</label>
                <input
                  id="inventory-adjust-quantity"
                  name="inventory_adjust_quantity"
                  className="input text-sm"
                  type="number"
                  step="any"
                  min="0"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f=>({...f, quantity:e.target.value}))} />
              </div>
              {adjustForm.type === 'add' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost ({usdSymbol})</label>
                    <input
                      id="inventory-adjust-cost-usd"
                      name="inventory_adjust_cost_usd"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_usd}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_usd:e.target.value}))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost (KHR)</label>
                    <input
                      id="inventory-adjust-cost-khr"
                      name="inventory_adjust_cost_khr"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_khr}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_khr:e.target.value}))} />
                  </div>
                </div>
              )}
              {branches.length > 1 && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('branch')}</label>
                  <select
                    id="inventory-adjust-branch"
                    name="inventory_adjust_branch"
                    className="input text-sm"
                    value={adjustForm.branch_id}
                    onChange={e => setAdjustForm(f=>({...f, branch_id:e.target.value}))}
                  >
                    <option value="">{t('no_specific_branch')}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('reason')}</label>
                <input
                  id="inventory-adjust-reason"
                  name="inventory_adjust_reason"
                  className="input text-sm"
                  placeholder={t('reason_placeholder')}
                  value={adjustForm.reason} onChange={e => setAdjustForm(f=>({...f, reason:e.target.value}))} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAdjust} className="btn-primary flex-1 text-sm" disabled={adjustSaving}>{adjustSaving ? (t('saving') || 'Saving...') : t('save')}</button>
                <button onClick={() => setAdjustModal(null)} className="btn-secondary text-sm" disabled={adjustSaving}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImport ? (
        <InventoryImportModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false)
            load()
          }}
        />
      ) : null}

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onAdjust={openAdjust}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
          usdSymbol={usdSymbol}
          t={t}
        />
      )}
    </div>
  )
}



