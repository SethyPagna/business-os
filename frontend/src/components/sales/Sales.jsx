import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search as SearchIcon, ShoppingBag, Upload } from 'lucide-react'
import { isBrokenLocalizedString, useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { downloadCSV } from '../../utils/csv'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import PaginationControls, { clampPage, paginateItems } from '../shared/PaginationControls.jsx'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { runConcurrentTasks } from '../../utils/bulkOps.mjs'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.mjs'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'
const Receipt = lazy(() => import('../receipt/Receipt'))
const SaleDetailModal = lazy(() => import('./SaleDetailModal'))
const ExportModal = lazy(() => import('./ExportModal'))
const SalesImportModal = lazy(() => import('./SalesImportModal'))
import SalesListSurface from './SalesListSurface'

function multiMatch(text, terms) {
  return terms.every((term) => text.toLowerCase().includes(term.toLowerCase()))
}

function getSaleBranchLabel(sale) {
  if (sale?.branch_name) return sale.branch_name
  const itemBranchNames = [...new Set((Array.isArray(sale?.items) ? sale.items : []).map((item) => item?.branch_name).filter(Boolean))]
  if (itemBranchNames.length === 1) return itemBranchNames[0]
  if (itemBranchNames.length > 1) return 'Multiple branches'
  return ''
}

export default function Sales() {
  const { t, settings, fmtUSD, fmtKHR, notify, user } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('sales')
  const [sales, setSales] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState([])
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [selectedSale, setSelectedSale] = useState(null)
  const [detailSale, setDetailSale] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [bulkStatusSaving, setBulkStatusSaving] = useState('')
  const [salesGroupMode, setSalesGroupMode] = useState('time')
  const [salesSortDirection, setSalesSortDirection] = useState('desc')
  const [salesPage, setSalesPage] = useState(1)
  const [salesPageSize, setSalesPageSize] = useState(50)
  const [collapsedSalesSections, setCollapsedSalesSections] = useState(() => new Set())
  const selectAllRef = useRef(null)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadPromiseRef = useRef(null)
  const loadWatchdogRef = useRef(null)
  const statusActionRef = useRef(new Set())
  const membershipActionRef = useRef(new Set())
  const aliveRef = useRef(true)
  const actionHistory = useActionHistory({ limit: 3, notify })
  const timeGroupingMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    let permissions = user?.permissions || {}
    try {
      permissions = typeof permissions === 'string' ? JSON.parse(permissions || '{}') : permissions
    } catch {
      permissions = {}
    }
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])

  const cleanFallback = useCallback((fallbackEn, fallbackKm) => {
    const candidate = fallbackKm || fallbackEn
    return isBrokenLocalizedString(String(candidate || '')) ? fallbackEn : candidate
  }, [])
  const translateOr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return settings?.language === 'km' ? cleanFallback(fallbackEn, fallbackKm) : fallbackEn
  }, [cleanFallback, settings?.language, t])
  const exportLabel = translateOr('export', 'Export')
  const salesDateRange = useMemo(() => {
    if (yearFilter === 'all') return {}
    const year = Number(yearFilter)
    if (!Number.isFinite(year)) return {}
    const month = monthFilter !== 'all' ? Number(monthFilter) : null
    if (month && Number.isFinite(month)) {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 0))
      return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      }
    }
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    }
  }, [monthFilter, yearFilter])

  const loadSales = useCallback(async (silent = false) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (!silent && aliveRef.current) {
        setLoading(true)
        setLoadError(null)
        window.clearTimeout(loadWatchdogRef.current)
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
            setLoading(false)
            setLoadError(translateOr('sales_load_slow', 'Sales are taking longer than expected. Tap Refresh or revisit the page in a moment.'))
          }, 15000)
        }
      }
      try {
        const params = {
          ...(isAdmin && userFilter !== 'all' ? { userId: userFilter } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...salesDateRange,
        }
        const result = await withLoaderTimeout(() => window.api.getSales(params), 'Sales', 20000)
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
        if (Array.isArray(result)) {
          setSales(result)
          loadedOnceRef.current = true
          setLoadError(null)
        }
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(loadRequestRef, requestId)) return
        console.error('[Sales] load failed:', error.message)
        if (!silent && !loadedOnceRef.current) {
          setLoadError(error?.message || translateOr('sales_load_failed', 'Failed to load sales'))
        } else if (!silent) {
          setLoadError(translateOr('sales_refresh_failed', 'Sales could not refresh right now. Showing the latest loaded data.'))
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (!silent && aliveRef.current && isTrackedRequestCurrent(loadRequestRef, requestId)) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [isAdmin, salesDateRange, search, statusFilter, translateOr, userFilter])

  useEffect(() => {
    if (!isActive) {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return
    }
    aliveRef.current = true
    loadSales(loadedOnceRef.current)
  }, [isActive, loadSales])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (syncChannel.channel === 'sales' || syncChannel.channel === 'returns') loadSales(true)
  }, [isActive, loadSales, syncChannel?.channel, syncChannel?.ts])
  useEffect(() => {
    if (!isActive || !isAdmin) return
    window.api.getUsers()
      .then((rows) => setUserOptions(Array.isArray(rows) ? rows : []))
      .catch(() => setUserOptions([]))
  }, [isActive, isAdmin])
  useEffect(() => () => {
    aliveRef.current = false
    window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const handleStatusChange = async (saleId, newStatus, notes, recordHistory = true) => {
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    if (statusActionRef.current.has(numericId)) return false
    const previousSale = sales.find((entry) => Number(entry?.id || 0) === numericId)
    const previousStatus = previousSale?.sale_status || 'completed'
    if (recordHistory) {
      const warningText = ['cancelled', 'awaiting_payment', 'completed', 'awaiting_delivery'].includes(newStatus)
        ? translateOr('confirm_sale_status_change_stock', `Change sale ${previousSale?.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}? This can change stock totals.`)
        : translateOr('confirm_sale_status_change', `Change sale ${previousSale?.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}?`)
      if (!window.confirm(warningText)) return false
    }
    statusActionRef.current.add(numericId)
    try {
      await window.api.updateSaleStatus(saleId, newStatus, notes)
      notify(`${t('status_updated') || 'Status updated'}: ${getStatusLabel(newStatus, t)}`)
      await loadSales(true)
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      if (recordHistory && previousSale && previousStatus !== newStatus) {
        actionHistory.pushAction({
          label: `Update sale ${previousSale.receipt_number || numericId} to ${getStatusLabel(newStatus, t)}`,
          undo: () => handleStatusChange(saleId, previousStatus, 'Undo sale status update', false),
          redo: () => handleStatusChange(saleId, newStatus, notes || 'Redo sale status update', false),
        })
      }
      return true
    } catch (error) {
      if (error?.conflict || error?.code === 'write_conflict') {
        await loadSales()
        return false
      }
      notify(`Failed to update status: ${error.message || error}`, 'error')
      return false
    } finally {
      statusActionRef.current.delete(numericId)
    }
  }

  const handleAttachMembership = async (saleId, membershipNumber) => {
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    if (membershipActionRef.current.has(numericId)) return false
    const previousSale = sales.find((entry) => Number(entry?.id || 0) === numericId)
    const previousMembershipNumber = String(previousSale?.customer_membership_number || '').trim()
    const nextMembershipNumber = String(membershipNumber || '').trim()
    membershipActionRef.current.add(numericId)
    try {
      const device = getClientDeviceInfo()
      await window.api.attachSaleCustomer(saleId, {
        membershipNumber: nextMembershipNumber,
        userId: user?.id || null,
        userName: user?.name || null,
        device_name: device.deviceName || '',
        device_tz: device.deviceTz || '',
      })
      notify(translateOr('membership_attached_to_sale', 'Membership linked to sale'))
      await loadSales()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      if (previousSale && previousMembershipNumber.toLowerCase() !== nextMembershipNumber.toLowerCase()) {
        actionHistory.pushAction({
          label: `Link membership on sale ${previousSale.receipt_number || numericId}`,
          undo: async () => {
            const deviceInfo = getClientDeviceInfo()
            const payload = previousMembershipNumber
              ? {
                  membershipNumber: previousMembershipNumber,
                  userId: user?.id || null,
                  userName: user?.name || null,
                  device_name: deviceInfo.deviceName || '',
                  device_tz: deviceInfo.deviceTz || '',
                }
              : {
                  clearAssignment: true,
                  userId: user?.id || null,
                  userName: user?.name || null,
                  device_name: deviceInfo.deviceName || '',
                  device_tz: deviceInfo.deviceTz || '',
                }
            await window.api.attachSaleCustomer(saleId, payload)
            await loadSales(true)
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
          },
          redo: async () => {
            const deviceInfo = getClientDeviceInfo()
            await window.api.attachSaleCustomer(saleId, {
              membershipNumber: nextMembershipNumber,
              userId: user?.id || null,
              userName: user?.name || null,
              device_name: deviceInfo.deviceName || '',
              device_tz: deviceInfo.deviceTz || '',
            })
            await loadSales(true)
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
            window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
          },
        })
      }
      return true
    } catch (error) {
      if (error?.conflict || error?.code === 'write_conflict') {
        await loadSales()
        return false
      }
      notify(error?.message || translateOr('failed_to_attach_membership', 'Failed to link membership'), 'error')
      return false
    } finally {
      membershipActionRef.current.delete(numericId)
    }
  }

  const availableYears = useMemo(
    () => getAvailableYears(sales, (sale) => sale?.created_at),
    [sales],
  )

  const searchTerms = useMemo(() => search.trim().split(/\s+/).filter(Boolean), [search])
  const filtered = useMemo(() => sales.filter((sale) => {
    if (statusFilter !== 'all' && (sale.sale_status || 'completed') !== statusFilter) return false
    if (!searchTerms.length) return true
    const haystack = `${sale.receipt_number || ''} ${sale.cashier_name || ''} ${sale.payment_method || ''} ${sale.notes || ''} ${sale.customer_name || ''} ${sale.customer_membership_number || ''} ${getSaleBranchLabel(sale) || ''}`
    return multiMatch(haystack, searchTerms)
  }), [monthFilter, sales, searchTerms, statusFilter, yearFilter])

  const allSalesSections = useMemo(
    () => buildTimeActionSections(filtered, {
      getDate: (sale) => sale?.created_at,
      getItemId: (sale) => Number(sale?.id),
      getActionKey: (sale) => sale?.sale_status || 'completed',
      getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
      year: yearFilter,
      month: monthFilter,
      timeMode: timeGroupingMode,
      groupMode: salesGroupMode,
      sortDirection: salesSortDirection,
    }),
    [filtered, monthFilter, salesGroupMode, salesSortDirection, t, timeGroupingMode, yearFilter],
  )

  const allVisibleSales = useMemo(
    () => allSalesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [allSalesSections],
  )

  useEffect(() => {
    setSalesPage(1)
  }, [monthFilter, salesGroupMode, salesPageSize, salesSortDirection, search, statusFilter, userFilter, yearFilter])

  useEffect(() => {
    setSalesPage((current) => clampPage(current, allVisibleSales.length, salesPageSize))
  }, [allVisibleSales.length, salesPageSize])

  const pagedSales = useMemo(
    () => paginateItems(allVisibleSales, salesPage, salesPageSize),
    [allVisibleSales, salesPage, salesPageSize],
  )

  const salesSections = useMemo(
    () => buildTimeActionSections(pagedSales, {
      getDate: (sale) => sale?.created_at,
      getItemId: (sale) => Number(sale?.id),
      getActionKey: (sale) => sale?.sale_status || 'completed',
      getActionLabel: (sale) => getStatusLabel(sale?.sale_status || 'completed', t),
      year: yearFilter,
      month: monthFilter,
      timeMode: timeGroupingMode,
      groupMode: salesGroupMode,
      sortDirection: salesSortDirection,
    }),
    [monthFilter, pagedSales, salesGroupMode, salesSortDirection, t, timeGroupingMode, yearFilter],
  )

  const visibleSales = useMemo(
    () => salesSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [salesSections],
  )

  useEffect(() => {
    const validIds = new Set(visibleSales.map((sale) => Number(sale.id)).filter((id) => Number.isFinite(id)))
    setSelectedIds((current) => {
      const nextIds = [...current].filter((id) => validIds.has(id))
      if (nextIds.length === current.size && nextIds.every((id) => current.has(id))) return current
      return new Set(nextIds)
    })
  }, [visibleSales])

  useEffect(() => {
    setCollapsedSalesSections((current) => {
      const validIds = new Set(salesSections.map((section) => section.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [salesSections])

  const filteredIds = useMemo(
    () => visibleSales.map((sale) => Number(sale.id)).filter((id) => Number.isFinite(id)),
    [visibleSales],
  )

  const selectedSales = useMemo(
    () => visibleSales.filter((sale) => selectedIds.has(Number(sale.id))),
    [selectedIds, visibleSales],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredIds.length
  }, [filteredIds.length, selectedIds.size])

  const revenue = filtered
    .filter((sale) => !['cancelled', 'awaiting_payment'].includes(sale.sale_status || 'completed'))
    .reduce((sum, sale) => sum + (sale.net_total_usd ?? sale.total_usd ?? 0), 0)

  const pendingRevenue = filtered
    .filter((sale) => (sale.sale_status || 'completed') === 'awaiting_payment')
    .reduce((sum, sale) => sum + (sale.total_usd || 0), 0)

  const toggleSelected = (saleId) => {
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }

  const toggleSelectAll = (checked) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(filteredIds))
  }

  const toggleSelectionScope = useCallback((ids, checked) => {
    setSelectedIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const toggleSalesSection = useCallback((sectionId) => {
    setCollapsedSalesSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const isSelectionScopeFullySelected = useCallback(
    (ids = []) => ids.length > 0 && ids.every((id) => selectedIds.has(Number(id))),
    [selectedIds],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids = []) => ids.some((id) => selectedIds.has(Number(id))) && !isSelectionScopeFullySelected(ids),
    [isSelectionScopeFullySelected, selectedIds],
  )

  const handleExportSelected = () => {
    if (!selectedSales.length) return
    const rows = selectedSales.map((sale) => ({
      Receipt: sale.receipt_number || '',
      Date: sale.created_at || '',
      Status: sale.sale_status || 'completed',
      Cashier: sale.cashier_name || '',
      Payment_Method: sale.payment_method || '',
      Branch: getSaleBranchLabel(sale) || '',
      Customer: sale.customer_name || '',
      Total_USD: sale.total_usd || 0,
      Net_Total_USD: sale.net_total_usd ?? sale.total_usd ?? 0,
      Items: Array.isArray(sale.items) ? sale.items.length : 0,
      Notes: sale.notes || '',
    }))
    downloadCSV(`sales-selected-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    notify(`Exported ${selectedSales.length} selected sale${selectedSales.length === 1 ? '' : 's'}.`)
  }

  const applySaleStatusEntries = useCallback(async (entries = [], notes = '') => {
    const statusRun = await runConcurrentTasks(entries, async (entry) => {
      const saleId = Number(entry?.id || 0)
      const nextStatus = String(entry?.status || '').trim()
      if (!saleId || !nextStatus) throw new Error('Invalid sale status entry')
      await window.api.updateSaleStatus(saleId, nextStatus, notes)
      return saleId
    })
    const failedIds = statusRun.failures
      .map((entry) => Number(entry.item?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)
    const updatedIds = statusRun.successes
      .map((entry) => Number(entry.value || entry.item?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0)

    await loadSales(true)
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
    window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))

    return {
      done: updatedIds.length,
      failed: failedIds.length,
      failedIds,
      updatedIds,
    }
  }, [loadSales])

  const handleBulkStatusUpdate = async (nextStatus) => {
    if (!selectedSales.length || bulkStatusSaving) return
    const previousStatuses = selectedSales.map((sale) => ({
      id: Number(sale.id),
      status: sale.sale_status || 'completed',
    }))
    setBulkStatusSaving(nextStatus)
    try {
      const nextEntries = previousStatuses.map((entry) => ({ id: entry.id, status: nextStatus }))
      const { done, failed, failedIds, updatedIds } = await applySaleStatusEntries(nextEntries, '')
      setSelectedIds(new Set(failedIds))
      const undoEntries = previousStatuses.filter((entry) => updatedIds.includes(entry.id))
      if (done > 0 && undoEntries.length) {
        actionHistory.pushAction({
          label: `Update ${done} sale${done === 1 ? '' : 's'} to ${getStatusLabel(nextStatus, t)}`,
          undo: () => applySaleStatusEntries(undoEntries, 'Undo bulk sale status update'),
          redo: () => applySaleStatusEntries(undoEntries.map((entry) => ({ id: entry.id, status: nextStatus })), 'Redo bulk sale status update'),
        })
      }
      notify(
        failed
          ? `Updated ${done} sales, ${failed} failed.`
          : `Updated ${done} sale${done === 1 ? '' : 's'} to ${getStatusLabel(nextStatus, t)}.`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkStatusSaving('')
    }
  }

  const exportVisibleSales = useCallback((rows = filtered, filePrefix = 'sales-visible') => {
    const exportRows = rows.map((sale) => ({
      Receipt: sale.receipt_number || '',
      Date: sale.created_at || '',
      Status: sale.sale_status || 'completed',
      Cashier: sale.cashier_name || '',
      Payment_Method: sale.payment_method || '',
      Branch: getSaleBranchLabel(sale) || '',
      Customer: sale.customer_name || '',
      Total_USD: sale.total_usd || 0,
      Net_Total_USD: sale.net_total_usd ?? sale.total_usd ?? 0,
      Items: Array.isArray(sale.items) ? sale.items.length : 0,
      Notes: sale.notes || '',
    }))
    downloadCSV(`${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`, exportRows)
  }, [filtered])

  const salesExportItems = useMemo(() => ([
    { label: translateOr('export_visible_sales', 'Export visible sales', 'នាំចេញការលក់ដែលកំពុងបង្ហាញ'), onClick: () => exportVisibleSales(filtered, 'sales-visible') },
    selectedSales.length ? { label: translateOr('export_selected_sales', 'Export selected sales', 'នាំចេញការលក់ដែលបានជ្រើស'), onClick: handleExportSelected, color: 'blue' } : null,
    statusFilter !== 'all' ? { label: translateOr('export_filtered_status', `Export ${getStatusLabel(statusFilter, t)}`, `នាំចេញតាមស្ថានភាព ${getStatusLabel(statusFilter, t)}`), onClick: () => exportVisibleSales(filtered, `sales-${statusFilter}`) } : null,
    yearFilter !== 'all' || monthFilter !== 'all' ? { label: translateOr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportVisibleSales(filtered, 'sales-filtered') } : null,
    'divider',
    { label: translateOr('export_detailed_sales_report', 'Detailed sales report', 'របាយការណ៍លម្អិតការលក់'), onClick: () => setShowExport(true), color: 'green' },
  ].filter(Boolean)), [exportVisibleSales, filtered, handleExportSelected, monthFilter, selectedSales.length, statusFilter, t, translateOr, yearFilter])

  const salesFilterSections = useMemo(() => ([
    {
      id: 'status',
      label: t('status') || 'Status',
      options: [
        { id: 'all', label: t('all_statuses') || 'All statuses', active: statusFilter === 'all', onClick: () => setStatusFilter('all') },
        ...ALL_STATUSES.map((status) => ({
          id: status,
          label: getStatusLabel(status, t),
          active: statusFilter === status,
          onClick: () => setStatusFilter(statusFilter === status ? 'all' : status),
        })),
      ],
    },
    {
      id: 'year',
      label: translateOr('year', 'Year', 'ឆ្នាំ'),
      options: [
        { id: 'all', label: translateOr('all_years', 'All years', 'គ្រប់ឆ្នាំ'), active: yearFilter === 'all', onClick: () => { setYearFilter('all'); setMonthFilter('all') } },
        ...availableYears.map((year) => ({
          id: `year-${year}`,
          label: year,
          active: yearFilter === year,
          onClick: () => {
            const next = yearFilter === year ? 'all' : year
            setYearFilter(next)
            if (next === 'all') setMonthFilter('all')
          },
        })),
      ],
    },
    {
      id: 'month',
      label: translateOr('month', 'Month', 'ខែ'),
      options: [
        { id: 'all', label: translateOr('all_months', 'All months', 'គ្រប់ខែ'), active: monthFilter === 'all', onClick: () => setMonthFilter('all') },
        ...Array.from({ length: 12 }, (_, index) => {
          const month = String(index + 1)
          return {
            id: `month-${month}`,
            label: new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' }),
            active: monthFilter === month,
            onClick: () => setMonthFilter(monthFilter === month ? 'all' : month),
          }
        }),
      ],
    },
    isAdmin ? {
      id: 'user',
      label: t('user') || 'User',
      options: [
        { id: 'all', label: t('all_users') || 'All users', active: userFilter === 'all', onClick: () => setUserFilter('all') },
        ...userOptions.map((option) => {
          const id = String(option?.id || '')
          return {
            id: `user-${id}`,
            label: option?.name || option?.username || `User ${id}`,
            active: userFilter === id,
            onClick: () => setUserFilter(userFilter === id ? 'all' : id),
          }
        }).filter((option) => option.id !== 'user-'),
      ],
    } : null,
    {
      id: 'grouping',
      label: translateOr('group_by', 'Group by', 'ដាក់ជាក្រុមតាម'),
      options: [
        { id: 'time', label: translateOr('group_by_time', 'Time only', 'ពេលវេលាប៉ុណ្ណោះ'), active: salesGroupMode === 'time', onClick: () => setSalesGroupMode('time') },
        { id: 'time-action', label: translateOr('group_by_time_action', 'Time + status', 'ពេលវេលា + ស្ថានភាព'), active: salesGroupMode === 'time+action', onClick: () => setSalesGroupMode('time+action') },
      ],
    },
    {
      id: 'sort',
      label: translateOr('sort', 'Sort', 'តម្រៀប'),
      options: [
        { id: 'desc', label: translateOr('newest_first', 'Newest first', 'ថ្មីបំផុតមុន'), active: salesSortDirection === 'desc', onClick: () => setSalesSortDirection('desc') },
        { id: 'asc', label: translateOr('oldest_first', 'Oldest first', 'ចាស់បំផុតមុន'), active: salesSortDirection === 'asc', onClick: () => setSalesSortDirection('asc') },
      ],
    },
  ].filter(Boolean)), [availableYears, isAdmin, monthFilter, salesGroupMode, salesSortDirection, statusFilter, t, translateOr, userFilter, userOptions, yearFilter])

  const activeSalesFilterCount = useMemo(
    () => [statusFilter !== 'all', userFilter !== 'all', yearFilter !== 'all', monthFilter !== 'all', salesGroupMode !== 'time', salesSortDirection !== 'desc'].filter(Boolean).length,
    [monthFilter, salesGroupMode, salesSortDirection, statusFilter, userFilter, yearFilter],
  )
  const showSalesActionGroups = salesGroupMode === 'time+action'

  if (selectedSale) {
    return (
      <Suspense fallback={null}>
        <Receipt sale={selectedSale} settings={settings} onClose={() => setSelectedSale(null)} />
      </Suspense>
    )
  }
  if (loadError && !loading && !sales.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => loadSales(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2 sm:mb-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            <ShoppingBag className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('sales')}
          </h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button onClick={() => setShowImport(true)} className="btn-secondary inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-medium sm:text-sm">
            <Upload className="h-4 w-4" />
            <span>{translateOr('import', 'Import')}</span>
          </button>
          <ExportMenu label={exportLabel} items={salesExportItems} compact primary />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="sales-search" className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id="sales-search"
            name="sales_search"
            className="input min-w-0 w-full pl-9"
            placeholder={`${t('search') || 'Search'}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('search') || 'Search sales'}
          />
        </label>
        <FilterMenu
          label={t('filters') || 'Filters'}
          activeCount={activeSalesFilterCount}
          sections={salesFilterSections}
          onClear={() => {
            setStatusFilter('all')
            setUserFilter('all')
            setYearFilter('all')
            setMonthFilter('all')
            setSalesGroupMode('time')
            setSalesSortDirection('desc')
          }}
          compact
        />
      </div>

      <ActionHistoryBar history={actionHistory} className="mb-3" summaryMode="compact" />

      {selectedSales.length > 0 ? (
        <div className="sticky top-2 z-30 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/95 px-2.5 py-2 text-sm shadow-sm backdrop-blur dark:border-blue-900/40 dark:bg-blue-900/30">
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{selectedSales.length}</span>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={handleExportSelected}>Export</button>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('completed')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'completed' ? 'Saving...' : 'Done'}</button>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('awaiting_delivery')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'awaiting_delivery' ? 'Saving...' : 'Delivery'}</button>
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => handleBulkStatusUpdate('cancelled')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'cancelled' ? 'Saving...' : 'Cancel'}</button>
          <button type="button" className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700/60 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className={`mb-3 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-blue-50 px-4 py-2 text-sm dark:bg-blue-900/20 ${filtered.length > 0 ? '' : 'invisible'}`}>
          <span className="font-semibold text-blue-700 dark:text-blue-300">{filtered.length} {t('sales') || 'sales'}</span>
          <span className="text-gray-400">|</span>
          <span className="font-semibold text-blue-700 dark:text-blue-300">{fmtUSD(revenue)} {t('revenue')}</span>
          {statusFilter === 'all' ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-green-600 dark:text-green-400">{filtered.filter((sale) => (sale.sale_status || 'completed') === 'completed').length} {t('summary_completed') || 'completed'}</span>
            </>
          ) : null}
          {pendingRevenue > 0 ? (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-yellow-600 dark:text-yellow-400" title={t('awaiting_payment_title') || 'Awaiting Payment not yet counted as revenue'}>
                {fmtUSD(pendingRevenue)} {t('summary_on_hold') || 'on hold'}
              </span>
            </>
          ) : null}
      </div>

      <p className="mb-2 text-xs text-gray-400">{t('click_for_details') || 'Click a row for details'}</p>

      <PaginationControls
        className="mb-3"
        page={salesPage}
        pageSize={salesPageSize}
        totalItems={allVisibleSales.length}
        label={t('sales') || 'sales'}
        t={t}
        onPageChange={setSalesPage}
        onPageSizeChange={(size) => {
          setSalesPageSize(size)
          setSalesPage(1)
        }}
      />

      <SalesListSurface
        collapsedSalesSections={collapsedSalesSections}
        filtered={filtered}
        filteredIds={filteredIds}
        fmtKHR={fmtKHR}
        fmtTime={fmtTime}
        fmtUSD={fmtUSD}
        getSaleBranchLabel={getSaleBranchLabel}
        isSelectionScopeFullySelected={isSelectionScopeFullySelected}
        isSelectionScopePartiallySelected={isSelectionScopePartiallySelected}
        loading={loading}
        revenue={revenue}
        salesSections={salesSections}
        selectAllRef={selectAllRef}
        selectedIds={selectedIds}
        setDetailSale={setDetailSale}
        setSelectedSale={setSelectedSale}
        showSalesActionGroups={showSalesActionGroups}
        t={t}
        toggleSalesSection={toggleSalesSection}
        toggleSelected={toggleSelected}
        toggleSelectAll={toggleSelectAll}
        toggleSelectionScope={toggleSelectionScope}
      />

      {detailSale ? (
        <Suspense fallback={null}>
          <SaleDetailModal
            sale={detailSale}
            settings={settings}
            onClose={() => setDetailSale(null)}
            onStatusChange={handleStatusChange}
            onAttachMembership={handleAttachMembership}
            onPrint={(sale) => setSelectedSale(sale)}
            t={t}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
          />
        </Suspense>
      ) : null}

      {showExport ? (
        <Suspense fallback={null}>
          <ExportModal onClose={() => setShowExport(false)} t={t} fmtUSD={fmtUSD} />
        </Suspense>
      ) : null}

      {showImport ? (
        <Suspense fallback={null}>
          <SalesImportModal
            onClose={() => setShowImport(false)}
            onDone={() => {
              setShowImport(false)
              loadSales()
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
