import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Download, RotateCcw, Search, Undo2 } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { downloadCSV } from '../../utils/csv'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import PaginationControls, { paginateItems } from '../shared/PaginationControls.jsx'
import { useIsPageActive } from '../shared/pageActivity'
import ReturnDetailModal from './ReturnDetailModal'
import EditReturnModal from './EditReturnModal'
import NewReturnModal from './NewReturnModal'
import NewSupplierReturnModal from './NewSupplierReturnModal'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.mjs'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

function normalizeScope(value) {
  return value === SUPPLIER_SCOPE ? SUPPLIER_SCOPE : CUSTOMER_SCOPE
}

function getReturnTypeKey(ret) {
  const scope = normalizeScope(ret?.return_scope)
  if (scope === SUPPLIER_SCOPE) return String(ret?.supplier_settlement || 'refund').trim().toLowerCase() || 'refund'
  return String(ret?.return_type || 'manual').trim().toLowerCase() || 'manual'
}

function getReturnTypeLabel(ret, tr) {
  const scope = normalizeScope(ret?.return_scope)
  if (scope === SUPPLIER_SCOPE) {
    return ret?.supplier_settlement || tr('settlement_refund', 'refund')
  }
  return ret?.return_type || tr('manual_return', 'manual')
}

function exportReturnRows(rows = [], tr) {
  return rows.map((ret) => ({
    Return_Number: ret.return_number || '',
    Scope: normalizeScope(ret.return_scope),
    Date: ret.created_at || '',
    Receipt: ret.receipt_number || '',
    Customer: ret.customer_name || '',
    Supplier: ret.supplier_name || '',
    Reason: ret.reason || '',
    Type: getReturnTypeLabel(ret, tr),
    Settlement: ret.supplier_settlement || '',
    Refund_USD: ret.total_refund_usd || 0,
    Compensation_USD: ret.supplier_compensation_usd || 0,
    Business_Loss_USD: ret.supplier_loss_usd || 0,
    Status: ret.status || 'completed',
  }))
}

export default function Returns() {
  const { t, fmtUSD, fmtKHR, notify } = useApp()
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('returns')
  const [scope, setScope] = useState(CUSTOMER_SCOPE)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [detailRet, setDetailRet] = useState(null)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editRet, setEditRet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [returnGroupMode, setReturnGroupMode] = useState('time')
  const [returnSortDirection, setReturnSortDirection] = useState('desc')
  const [returnPage, setReturnPage] = useState(1)
  const [returnPageSize, setReturnPageSize] = useState(50)
  const [collapsedReturnSections, setCollapsedReturnSections] = useState(() => new Set())
  const loadedOnceRef = useRef(false)
  const returnsRequestRef = useRef(0)
  const editRequestRef = useRef(0)
  const loadPromiseRef = useRef(null)
  const loadWatchdogRef = useRef(null)
  const selectAllRef = useRef(null)
  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])

  const loadReturns = useCallback(async (silent = false) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(returnsRequestRef)
    const promise = (async () => {
      if (!silent) {
        setLoading(true)
        setLoadError(null)
        window.clearTimeout(loadWatchdogRef.current)
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
            setLoading(false)
            setLoadError(tr('returns_load_slow', 'Returns are taking longer than expected. Tap Refresh or revisit in a moment.', 'ការបង្វិលត្រឡប់កំពុងចំណាយពេលយូរជាងដែលរំពឹងទុក។ សូមចុចស្រស់ថ្មី ឬត្រឡប់មកវិញបន្តិចទៀត។'))
          }, 10000)
        }
      }
      try {
        const params = { scope }
        const result = await withLoaderTimeout(() => window.api.getReturns(params), 'Returns')
        if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
        setRows(Array.isArray(result) ? result : [])
        loadedOnceRef.current = true
        setLoadError(null)
      } catch (error) {
        if (!isTrackedRequestCurrent(returnsRequestRef, requestId)) return
        console.error('[Returns] load failed:', error?.message)
        if (!silent && !loadedOnceRef.current) {
          setRows([])
          setLoadError(error?.message || tr('returns_load_failed', 'Failed to load returns', 'មិនអាចផ្ទុកការបង្វិលត្រឡប់បានទេ'))
          loadedOnceRef.current = true
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (isTrackedRequestCurrent(returnsRequestRef, requestId) && !silent) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [scope])

  useEffect(() => {
    if (!isActive) {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(returnsRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return undefined
    }
    loadReturns(loadedOnceRef.current)
    return () => {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(returnsRequestRef)
      loadPromiseRef.current = null
    }
  }, [isActive, loadReturns])

  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    if (['returns', 'sales', 'inventory', 'products'].includes(syncChannel.channel)) {
      loadReturns(true)
    }
  }, [isActive, loadReturns, syncChannel?.channel, syncChannel?.ts])

  const handleOpenEdit = async (ret) => {
    const requestId = beginTrackedRequest(editRequestRef)
    const retScope = normalizeScope(ret?.return_scope)
    if (retScope !== CUSTOMER_SCOPE) {
      notify(tr('supplier_return_edit_not_supported', 'Supplier returns cannot be edited from this form yet.'), 'info')
      return
    }
    setDetailRet(null)
    try {
      const fresh = await withLoaderTimeout(() => window.api.getReturn(ret.id), 'Return details')
      if (!isTrackedRequestCurrent(editRequestRef, requestId)) return
      setEditRet(fresh || ret)
    } catch {
      if (!isTrackedRequestCurrent(editRequestRef, requestId)) return
      setEditRet(ret)
    }
  }

  const availableYears = useMemo(
    () => getAvailableYears(rows, (ret) => ret?.created_at),
    [rows],
  )

  const typeOptions = useMemo(() => {
    const options = new Map()
    rows.forEach((ret) => {
      const key = getReturnTypeKey(ret)
      if (!key) return
      options.set(key, getReturnTypeLabel(ret, tr))
    })
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [rows, tr])

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = useMemo(() => rows.filter((ret) => {
    if (yearFilter !== 'all' || monthFilter !== 'all') {
      const createdDate = new Date(ret?.created_at || '')
      if (yearFilter !== 'all' && String(createdDate.getFullYear()) !== String(yearFilter)) return false
      if (monthFilter !== 'all' && String(createdDate.getMonth() + 1) !== String(monthFilter)) return false
    }
    if (typeFilter !== 'all' && getReturnTypeKey(ret) !== typeFilter) return false
    if (!searchTerms.length) return true
    const hay = [
      ret.return_number,
      ret.receipt_number,
      ret.cashier_name,
      ret.customer_name,
      ret.supplier_name,
      ret.reason,
      ret.return_type,
      ret.supplier_settlement,
    ].join(' ').toLowerCase()
    return searchTerms.every((term) => hay.includes(term.toLowerCase()))
  }), [monthFilter, rows, searchTerms, typeFilter, yearFilter])

  const allReturnSections = useMemo(() => buildTimeActionSections(filtered, {
    getDate: (ret) => ret?.created_at,
    getItemId: (ret) => Number(ret?.id),
    getActionKey: (ret) => getReturnTypeKey(ret),
    getActionLabel: (ret) => getReturnTypeLabel(ret, tr),
    year: yearFilter,
    month: monthFilter,
    timeMode,
    groupMode: returnGroupMode,
    sortDirection: returnSortDirection,
  }), [filtered, monthFilter, returnGroupMode, returnSortDirection, timeMode, tr, yearFilter])

  const allVisibleReturns = useMemo(
    () => allReturnSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [allReturnSections],
  )

  useEffect(() => {
    setReturnPage(1)
  }, [monthFilter, returnGroupMode, returnSortDirection, scope, search, typeFilter, yearFilter])

  const pagedReturns = useMemo(
    () => paginateItems(allVisibleReturns, returnPage, returnPageSize),
    [allVisibleReturns, returnPage, returnPageSize],
  )

  const returnSections = useMemo(() => buildTimeActionSections(pagedReturns, {
    getDate: (ret) => ret?.created_at,
    getItemId: (ret) => Number(ret?.id),
    getActionKey: (ret) => getReturnTypeKey(ret),
    getActionLabel: (ret) => getReturnTypeLabel(ret, tr),
    year: yearFilter,
    month: monthFilter,
    timeMode,
    groupMode: returnGroupMode,
    sortDirection: returnSortDirection,
  }), [monthFilter, pagedReturns, returnGroupMode, returnSortDirection, timeMode, tr, yearFilter])

  const visibleReturns = useMemo(
    () => returnSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [returnSections],
  )

  useEffect(() => {
    const validIds = new Set(visibleReturns.map((ret) => Number(ret.id)).filter((id) => Number.isFinite(id)))
    setSelectedIds((current) => new Set([...current].filter((id) => validIds.has(id))))
  }, [visibleReturns])

  useEffect(() => {
    setCollapsedReturnSections((current) => {
      const validIds = new Set(returnSections.map((section) => section.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [returnSections])

  const visibleIds = useMemo(
    () => visibleReturns.map((ret) => Number(ret.id)).filter((id) => Number.isFinite(id)),
    [visibleReturns],
  )

  const selectedReturns = useMemo(
    () => visibleReturns.filter((ret) => selectedIds.has(Number(ret.id))),
    [selectedIds, visibleReturns],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleIds.length
  }, [selectedIds.size, visibleIds.length])

  const toggleSelected = useCallback((returnId) => {
    const numericId = Number(returnId)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }, [])

  const toggleSelectAll = useCallback((checked) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(visibleIds))
  }, [visibleIds])

  const toggleSelectionScope = useCallback((ids, checked) => {
    setSelectedIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const toggleReturnSection = useCallback((sectionId) => {
    setCollapsedReturnSections((current) => {
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

  const customerRows = filtered.filter((ret) => normalizeScope(ret.return_scope) === CUSTOMER_SCOPE)
  const supplierRows = filtered.filter((ret) => normalizeScope(ret.return_scope) === SUPPLIER_SCOPE)

  const customerStats = {
    refundedUsd: customerRows.reduce((sum, ret) => sum + (ret.total_refund_usd || 0), 0),
    restockCount: customerRows.filter((ret) => ret.return_type === 'restock').length,
    writeoffCount: customerRows.filter((ret) => ret.return_type === 'writeoff').length,
    refundOnlyCount: customerRows.filter((ret) => ret.return_type === 'refund').length,
  }

  const supplierStats = {
    count: supplierRows.length,
    compensationUsd: supplierRows.reduce((sum, ret) => sum + (ret.supplier_compensation_usd || 0), 0),
    lossUsd: supplierRows.reduce((sum, ret) => sum + (ret.supplier_loss_usd || 0), 0),
  }

  const exportVisible = useCallback((rowsToExport = visibleReturns, prefix = 'returns-visible') => {
    downloadCSV(`${prefix}-${new Date().toISOString().slice(0, 10)}.csv`, exportReturnRows(rowsToExport, tr))
  }, [tr, visibleReturns])

  const exportSelected = useCallback(() => {
    if (!selectedReturns.length) return
    exportVisible(selectedReturns, 'returns-selected')
    notify(`Exported ${selectedReturns.length} selected return${selectedReturns.length === 1 ? '' : 's'}.`)
  }, [exportVisible, notify, selectedReturns])

  const exportItems = useMemo(() => ([
    { label: tr('export_visible_returns', 'Export visible returns', 'នាំចេញការត្រឡប់ដែលកំពុងបង្ហាញ'), onClick: () => exportVisible(visibleReturns, `returns-${scope}`) },
    selectedReturns.length ? { label: tr('export_selected_returns', 'Export selected returns', 'នាំចេញការត្រឡប់ដែលបានជ្រើស'), onClick: exportSelected, color: 'blue' } : null,
    typeFilter !== 'all' ? { label: tr('export_filtered_type', `Export ${typeOptions.find(([id]) => id === typeFilter)?.[1] || typeFilter}`, `នាំចេញតាមប្រភេទ ${typeOptions.find(([id]) => id === typeFilter)?.[1] || typeFilter}`), onClick: () => exportVisible(filtered, `returns-${typeFilter}`) } : null,
    yearFilter !== 'all' || monthFilter !== 'all' ? { label: tr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportVisible(filtered, 'returns-filtered') } : null,
    scope !== CUSTOMER_SCOPE
      ? { label: tr('export_supplier_returns', 'Export supplier returns', 'នាំចេញការត្រឡប់ទៅអ្នកផ្គត់ផ្គង់'), onClick: () => exportVisible(supplierRows, 'returns-supplier') }
      : { label: tr('export_customer_returns', 'Export customer returns', 'នាំចេញការត្រឡប់ពីអតិថិជន'), onClick: () => exportVisible(customerRows, 'returns-customer') },
  ].filter(Boolean)), [customerRows, exportSelected, exportVisible, filtered, monthFilter, scope, selectedReturns.length, supplierRows, tr, typeFilter, typeOptions, visibleReturns, yearFilter])

  const filterSections = useMemo(() => ([
    {
      id: 'scope',
      label: tr('scope', 'Scope'),
      options: [
        { id: CUSTOMER_SCOPE, label: tr('customer_returns', 'Customer Returns'), active: scope === CUSTOMER_SCOPE, onClick: () => setScope(CUSTOMER_SCOPE) },
        { id: SUPPLIER_SCOPE, label: tr('supplier_returns', 'Supplier Returns'), active: scope === SUPPLIER_SCOPE, onClick: () => setScope(SUPPLIER_SCOPE) },
      ],
    },
    {
      id: 'year',
      label: tr('year', 'Year'),
      options: [
        { id: 'all', label: tr('all_years', 'All years'), active: yearFilter === 'all', onClick: () => { setYearFilter('all'); setMonthFilter('all') } },
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
      label: tr('month', 'Month'),
      options: [
        { id: 'all', label: tr('all_months', 'All months'), active: monthFilter === 'all', onClick: () => setMonthFilter('all') },
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
    {
      id: 'type',
      label: tr('type', 'Type'),
      options: [
        { id: 'all', label: tr('all_types', 'All types'), active: typeFilter === 'all', onClick: () => setTypeFilter('all') },
        ...typeOptions.map(([id, label]) => ({
          id,
          label,
          active: typeFilter === id,
          onClick: () => setTypeFilter(typeFilter === id ? 'all' : id),
        })),
      ],
    },
    {
      id: 'grouping',
      label: tr('group_by', 'Group by'),
      options: [
        { id: 'time', label: tr('group_by_time', 'Time only'), active: returnGroupMode === 'time', onClick: () => setReturnGroupMode('time') },
        { id: 'time-action', label: tr('group_by_time_action', 'Time + type'), active: returnGroupMode === 'time+action', onClick: () => setReturnGroupMode('time+action') },
      ],
    },
    {
      id: 'sort',
      label: tr('sort', 'Sort'),
      options: [
        { id: 'desc', label: tr('newest_first', 'Newest first'), active: returnSortDirection === 'desc', onClick: () => setReturnSortDirection('desc') },
        { id: 'asc', label: tr('oldest_first', 'Oldest first'), active: returnSortDirection === 'asc', onClick: () => setReturnSortDirection('asc') },
      ],
    },
  ]), [availableYears, monthFilter, returnGroupMode, returnSortDirection, scope, tr, typeFilter, typeOptions, yearFilter])

  const activeFilterCount = useMemo(
    () => [yearFilter !== 'all', monthFilter !== 'all', typeFilter !== 'all', scope !== CUSTOMER_SCOPE, returnGroupMode !== 'time', returnSortDirection !== 'desc'].filter(Boolean).length,
    [monthFilter, returnGroupMode, returnSortDirection, scope, typeFilter, yearFilter],
  )
  const showReturnActionGroups = returnGroupMode === 'time+action'

  const renderAmount = (ret) => {
    const retScope = normalizeScope(ret.return_scope)
    if (retScope === SUPPLIER_SCOPE) {
      return (
        <div className="text-right">
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUSD(ret.supplier_compensation_usd || 0)}</div>
          <div className="text-xs text-rose-500">{tr('business_loss', 'Business loss')}: {fmtUSD(ret.supplier_loss_usd || 0)}</div>
        </div>
      )
    }
    return <span className="font-semibold text-gray-900 dark:text-white">{fmtUSD(ret.total_refund_usd || 0)}</span>
  }

  if (loadError && !loading && !rows.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => loadReturns(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">
            <RotateCcw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {tr('returns', 'Returns')}
          </h1>
        </div>
        <div className="flex flex-shrink-0 flex-row flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:items-center sm:pb-0">
          <ExportMenu label={tr('export', 'Export')} items={exportItems} compact />
          {scope === SUPPLIER_SCOPE ? (
            <button onClick={() => setShowSupplierForm(true)} className="btn-primary inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs sm:w-auto sm:flex-none sm:text-sm" aria-label={tr('return_to_supplier', 'Return to Supplier')}>
              <Undo2 className="h-4 w-4" />
              <span>{tr('return_to_supplier', 'Return to Supplier')}</span>
            </button>
          ) : (
            <button onClick={() => setShowCustomerForm(true)} className="btn-primary inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs sm:w-auto sm:flex-none sm:text-sm" aria-label={tr('new_return', 'New Return')}>
              <Undo2 className="h-4 w-4" />
              <span>{tr('new_return', 'New Return')}</span>
            </button>
          )}
        </div>
      </div>

      {selectedReturns.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900/40 dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedReturns.length} selected</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={exportSelected}>Export selected</button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set())}>
            {tr('clear', 'Clear')}
          </button>
        </div>
      ) : null}

      {scope === CUSTOMER_SCOPE ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('total_refunded', 'Total Refunded')}</div>
            <div className="text-sm font-bold text-orange-700 dark:text-orange-400">{fmtUSD(customerStats.refundedUsd)}</div>
          </div>
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('restocked', 'Restocked')}</div>
            <div className="text-sm font-bold text-green-700 dark:text-green-400">{customerStats.restockCount}</div>
          </div>
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('written_off', 'Written Off')}</div>
            <div className="text-sm font-bold text-red-600 dark:text-red-400">{customerStats.writeoffCount}</div>
          </div>
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('refund_only', 'Refund Only')}</div>
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">{customerStats.refundOnlyCount}</div>
          </div>
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('supplier_returns', 'Supplier Returns')}</div>
            <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{supplierStats.count}</div>
          </div>
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('supplier_compensation', 'Compensation')}</div>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{fmtUSD(supplierStats.compensationUsd)}</div>
          </div>
          <div className="card px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{tr('business_loss', 'Business loss')}</div>
            <div className="text-sm font-bold text-rose-600 dark:text-rose-400">{fmtUSD(supplierStats.lossUsd)}</div>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="returns-search" className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            id="returns-search"
            name="returns_search"
            className="input min-w-0 w-full pl-9"
            placeholder={tr('search_returns_placeholder', 'Search by return number, receipt, customer, supplier, reason')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <FilterMenu
          label={tr('filters', 'Filters')}
          activeCount={activeFilterCount}
          sections={filterSections}
          onClear={() => {
            setScope(CUSTOMER_SCOPE)
            setYearFilter('all')
            setMonthFilter('all')
            setTypeFilter('all')
            setReturnGroupMode('time')
            setReturnSortDirection('desc')
          }}
          compact
        />
      </div>

      <p className="mb-2 text-xs text-gray-400">{tr('tap_to_view_details', 'Tap a record to view details.')}</p>

      <PaginationControls
        className="mb-3"
        page={returnPage}
        pageSize={returnPageSize}
        totalItems={allVisibleReturns.length}
        label={tr('returns_count', 'returns')}
        t={t}
        onPageChange={setReturnPage}
        onPageSizeChange={(size) => {
          setReturnPageSize(size)
          setReturnPage(1)
        }}
      />

      <div className="card hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={visibleIds.length > 0 && selectedIds.size === visibleIds.length}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all returns"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('return_number', 'Return #')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('date', 'Date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reference', 'Reference')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{scope === SUPPLIER_SCOPE ? tr('supplier', 'Supplier') : tr('customer', 'Customer')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('reason', 'Reason')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('type', 'Type')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{tr('amount', 'Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{tr('loading', 'Loading')}...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</td></tr>
              ) : returnSections.map((section) => {
                const isCollapsed = collapsedReturnSections.has(section.id)
                return (
                <Fragment key={section.id}>
                  <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <label className="inline-flex items-center gap-2 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isSelectionScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                            aria-label={`Select ${section.label}`}
                          />
                          <span>{section.label}</span>
                        </label>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400">{section.ids.length}</span>
                          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleReturnSection(section.id)}>
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed ? section.groups.map((group) => (
                    <Fragment key={group.id}>
                      {showReturnActionGroups ? (
                        <tr className="bg-slate-50/80 dark:bg-slate-900/30">
                          <td colSpan={8} className="px-6 py-2">
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <label className="inline-flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isSelectionScopeFullySelected(group.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                  }}
                                  onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                  aria-label={`Select ${group.label}`}
                                />
                                <span>{group.label}</span>
                              </label>
                              <span className="text-slate-400">{group.items.length}</span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {group.items.map((ret) => {
                        const retScope = normalizeScope(ret.return_scope)
                        const typeLabel = getReturnTypeLabel(ret, tr)
                        return (
                          <tr key={ret.id} className="table-row cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/10" onClick={() => setDetailRet(ret)}>
                            <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={selectedIds.has(Number(ret.id))}
                                onChange={() => toggleSelected(ret.id)}
                                aria-label={`Select ${ret.return_number}`}
                              />
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium text-orange-600 dark:text-orange-400">{ret.return_number}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">{fmtTime(ret.created_at)}</td>
                            <td className="px-4 py-2.5">
                              {ret.receipt_number
                                ? <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{ret.receipt_number}</span>
                                : <span className="text-xs text-gray-400">{tr('manual_return', 'Manual')}</span>}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</td>
                            <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{ret.reason || '-'}</td>
                            <td className="px-4 py-2.5">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-700 dark:text-gray-200">{typeLabel}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right">{renderAmount(ret)}</td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )) : null}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-400">{tr('loading', 'Loading')}...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</div>
        ) : returnSections.map((section) => {
          const isCollapsed = collapsedReturnSections.has(section.id)
          return (
          <div key={section.id} className="space-y-2">
            <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSelectionScopeFullySelected(section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                    }}
                    onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                    aria-label={`Select ${section.label}`}
                  />
                  <span>{section.label}</span>
                  <span className="normal-case tracking-normal text-slate-400">{section.ids.length}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleReturnSection(section.id)}>
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            {!isCollapsed ? section.groups.map((group) => (
              <div key={group.id} className="space-y-2">
                {showReturnActionGroups ? (
                  <div className="px-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={isSelectionScopeFullySelected(group.ids)}
                        ref={(node) => {
                          if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                        }}
                        onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                        aria-label={`Select ${group.label}`}
                      />
                      <span>{group.label}</span>
                      <span className="text-slate-400">{group.items.length}</span>
                    </label>
                  </div>
                ) : null}
                {group.items.map((ret) => {
                  const retScope = normalizeScope(ret.return_scope)
                  return (
                    <div key={ret.id} className="card cursor-pointer p-3" onClick={() => setDetailRet(ret)}>
                      <div className="mb-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={selectedIds.has(Number(ret.id))}
                          onChange={() => toggleSelected(ret.id)}
                          aria-label={`Select ${ret.return_number}`}
                        />
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">{ret.return_number}</div>
                          <div className="text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
                          <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">{ret.reason}</div>
                          <div className="mt-0.5 text-xs text-gray-400">{retScope === SUPPLIER_SCOPE ? (ret.supplier_name || '-') : (ret.customer_name || '-')}</div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {renderAmount(ret)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )) : null}
          </div>
        )})}
      </div>

      {detailRet ? (
        <ReturnDetailModal
          ret={detailRet}
          onClose={() => setDetailRet(null)}
          onEdit={normalizeScope(detailRet.return_scope) === CUSTOMER_SCOPE ? () => handleOpenEdit(detailRet) : null}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
        />
      ) : null}

      {editRet ? (
        <EditReturnModal
          ret={editRet}
          onClose={() => setEditRet(null)}
          onSuccess={loadReturns}
          fmtUSD={fmtUSD}
          notify={notify}
        />
      ) : null}

      {showCustomerForm ? (
        <NewReturnModal
          onClose={() => setShowCustomerForm(false)}
          onSuccess={loadReturns}
          fmtUSD={fmtUSD}
          notify={notify}
        />
      ) : null}

      {showSupplierForm ? (
        <NewSupplierReturnModal
          onClose={() => setShowSupplierForm(false)}
          onSuccess={loadReturns}
          notify={notify}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
        />
      ) : null}
    </div>
  )
}
