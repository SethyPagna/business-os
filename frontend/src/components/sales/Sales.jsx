import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Download, Search as SearchIcon, ShoppingBag, Upload } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import Receipt from '../receipt/Receipt'
import { fmtTime } from '../../utils/formatters'
import { downloadCSV } from '../../utils/csv'
import StatusBadge, { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import SaleDetailModal from './SaleDetailModal'
import ExportModal from './ExportModal'
import SalesImportModal from './SalesImportModal'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

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

function getSaleDateParts(sale) {
  const parsed = new Date(sale?.created_at || '')
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getFullYear()
  const month = parsed.getMonth() + 1
  return {
    year,
    month,
    yearLabel: String(year),
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    monthLabel: parsed.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
  }
}

function buildGroupedSales(sales, groupMode) {
  if (groupMode === 'none') return [{ id: 'all', label: 'All sales', items: sales }]

  const groups = new Map()
  sales.forEach((sale) => {
    const parts = getSaleDateParts(sale)
    const groupId = groupMode === 'year'
      ? (parts?.yearLabel || 'Unknown year')
      : (parts?.monthKey || 'unknown-month')
    const groupLabel = groupMode === 'year'
      ? (parts?.yearLabel || 'Unknown year')
      : (parts?.monthLabel || 'Unknown month')
    const current = groups.get(groupId) || { id: groupId, label: groupLabel, items: [] }
    current.items.push(sale)
    groups.set(groupId, current)
  })
  return [...groups.values()]
}

export default function Sales() {
  const { t, settings, fmtUSD, fmtKHR, notify, user, page } = useApp()
  const { syncChannel } = useSync()
  const [sales, setSales] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [groupMode, setGroupMode] = useState('month')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [selectedSale, setSelectedSale] = useState(null)
  const [detailSale, setDetailSale] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bulkStatusSaving, setBulkStatusSaving] = useState('')
  const selectAllRef = useRef(null)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const statusActionRef = useRef(new Set())
  const membershipActionRef = useRef(new Set())

  const translateOr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return settings?.language === 'km' ? fallbackKm : fallbackEn
  }, [settings?.language, t])
  const exportLabel = translateOr('export', 'Export', 'នាំចេញ')

  const loadSales = useCallback((silent = false) => {
    const requestId = beginTrackedRequest(loadRequestRef)
    if (!silent) setLoading(true)
    return withLoaderTimeout(() => window.api.getSales(), 'Sales')
      .then((result) => {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        if (Array.isArray(result)) {
          setSales(result)
          loadedOnceRef.current = true
          return
        }
      })
      .catch((error) => {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        console.error('[Sales] load failed:', error.message)
        if (!silent) setSales([])
      })
      .finally(() => {
        if (!silent && isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (page !== 'sales') {
      invalidateTrackedRequest(loadRequestRef)
      return
    }
    loadSales(loadedOnceRef.current)
  }, [loadSales, page])

  useEffect(() => {
    if (page !== 'sales' || !syncChannel) return
    if (syncChannel.channel === 'sales' || syncChannel.channel === 'returns') loadSales(true)
  }, [page, syncChannel, loadSales])
  useEffect(() => () => invalidateTrackedRequest(loadRequestRef), [])

  const handleStatusChange = async (saleId, newStatus, notes) => {
    const numericId = Number(saleId)
    if (!Number.isFinite(numericId)) return false
    if (statusActionRef.current.has(numericId)) return false
    statusActionRef.current.add(numericId)
    try {
      await window.api.updateSaleStatus(saleId, newStatus, notes)
      notify(`${t('status_updated') || 'Status updated'}: ${getStatusLabel(newStatus, t)}`)
      loadSales()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
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
    membershipActionRef.current.add(numericId)
    try {
      const device = getClientDeviceInfo()
      await window.api.attachSaleCustomer(saleId, {
        membershipNumber,
        userId: user?.id || null,
        userName: user?.name || null,
        device_name: device.deviceName || '',
        device_tz: device.deviceTz || '',
      })
      notify(translateOr('membership_attached_to_sale', 'Membership linked to sale'))
      await loadSales()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
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

  const availableYears = useMemo(() => {
    const years = new Set()
    sales.forEach((sale) => {
      const parts = getSaleDateParts(sale)
      if (parts?.yearLabel) years.add(parts.yearLabel)
    })
    return [...years].sort((left, right) => Number(right) - Number(left))
  }, [sales])

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = useMemo(() => sales.filter((sale) => {
    if (statusFilter !== 'all' && (sale.sale_status || 'completed') !== statusFilter) return false
    const parts = getSaleDateParts(sale)
    if (yearFilter !== 'all' && parts?.yearLabel !== yearFilter) return false
    if (monthFilter !== 'all' && String(parts?.month || '') !== monthFilter) return false
    if (!searchTerms.length) return true
    const haystack = `${sale.receipt_number || ''} ${sale.cashier_name || ''} ${sale.payment_method || ''} ${sale.notes || ''} ${sale.customer_name || ''} ${sale.customer_membership_number || ''} ${getSaleBranchLabel(sale) || ''}`
    return multiMatch(haystack, searchTerms)
  }), [monthFilter, sales, searchTerms, statusFilter, yearFilter])

  const groupedSales = useMemo(() => buildGroupedSales(filtered, groupMode), [filtered, groupMode])

  useEffect(() => {
    const validIds = new Set(filtered.map((sale) => Number(sale.id)).filter((id) => Number.isFinite(id)))
    setSelectedIds((current) => new Set([...current].filter((id) => validIds.has(id))))
  }, [filtered])

  const filteredIds = useMemo(
    () => filtered.map((sale) => Number(sale.id)).filter((id) => Number.isFinite(id)),
    [filtered],
  )

  const selectedSales = useMemo(
    () => filtered.filter((sale) => selectedIds.has(Number(sale.id))),
    [filtered, selectedIds],
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
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const toggleSelectAll = (checked) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(filteredIds))
  }

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

  const handleBulkStatusUpdate = async (nextStatus) => {
    if (!selectedSales.length || bulkStatusSaving) return
    setBulkStatusSaving(nextStatus)
    let updated = 0
    let failed = 0
    try {
      for (const sale of selectedSales) {
        const ok = await handleStatusChange(sale.id, nextStatus, '')
        if (ok) updated += 1
        else failed += 1
      }
      await loadSales()
      if (!failed) setSelectedIds(new Set())
      notify(
        failed
          ? `Updated ${updated} sales, ${failed} failed.`
          : `Updated ${updated} sale${updated === 1 ? '' : 's'} to ${getStatusLabel(nextStatus, t)}.`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkStatusSaving('')
    }
  }

  if (selectedSale) return <Receipt sale={selectedSale} settings={settings} onClose={() => setSelectedSale(null)} />

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
          <button onClick={() => setShowImport(true)} className="btn-secondary inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium">
            <Upload className="h-4 w-4" />
            <span>{translateOr('import', 'Import')}</span>
          </button>
          <button onClick={() => setShowExport(true)} className="btn-primary inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium">
            <Download className="h-4 w-4" />
            <span>{exportLabel}</span>
          </button>
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
        <select
          id="sales-status-filter"
          name="sales_status_filter"
          className="input w-[11.5rem] max-w-full flex-shrink-0"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label={t('all_statuses') || 'Filter by status'}
        >
          <option value="all">{t('all_statuses') || 'All Statuses'}</option>
          {ALL_STATUSES.map((status) => (
            <option key={status} value={status}>{getStatusLabel(status, t)}</option>
          ))}
        </select>
        <select
          className="input w-[9rem] max-w-full flex-shrink-0"
          value={yearFilter}
          onChange={(event) => setYearFilter(event.target.value)}
          aria-label="Filter by year"
        >
          <option value="all">All years</option>
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <select
          className="input w-[10rem] max-w-full flex-shrink-0"
          value={monthFilter}
          onChange={(event) => setMonthFilter(event.target.value)}
          aria-label="Filter by month"
        >
          <option value="all">All months</option>
          {Array.from({ length: 12 }, (_, index) => {
            const month = index + 1
            const label = new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })
            return <option key={month} value={String(month)}>{label}</option>
          })}
        </select>
        <select
          className="input w-[9rem] max-w-full flex-shrink-0"
          value={groupMode}
          onChange={(event) => setGroupMode(event.target.value)}
          aria-label="Group sales"
        >
          <option value="month">Group by month</option>
          <option value="year">Group by year</option>
          <option value="none">No grouping</option>
        </select>
      </div>

      {selectedSales.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900/40 dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedSales.length} selected</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={handleExportSelected}>Export selected</button>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => handleBulkStatusUpdate('completed')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'completed' ? 'Saving...' : 'Mark completed'}</button>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => handleBulkStatusUpdate('awaiting_delivery')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'awaiting_delivery' ? 'Saving...' : 'Mark delivery'}</button>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => handleBulkStatusUpdate('cancelled')} disabled={!!bulkStatusSaving}>{bulkStatusSaving === 'cancelled' ? 'Saving...' : 'Mark cancelled'}</button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedIds(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-blue-50 px-4 py-2 text-sm dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{filtered.length} {t('sales') || 'sales'}</span>
          <span className="text-gray-400">·</span>
          <span className="font-semibold text-blue-700 dark:text-blue-300">{fmtUSD(revenue)} {t('revenue')}</span>
          {statusFilter === 'all' ? (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-green-600 dark:text-green-400">{filtered.filter((sale) => (sale.sale_status || 'completed') === 'completed').length} {t('summary_completed') || 'completed'}</span>
            </>
          ) : null}
          {pendingRevenue > 0 ? (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-yellow-600 dark:text-yellow-400" title={t('awaiting_payment_title') || 'Awaiting Payment not yet counted as revenue'}>
                {fmtUSD(pendingRevenue)} {t('summary_on_hold') || 'on hold'}
              </span>
            </>
          ) : null}
        </div>
      )}

      <p className="mb-2 text-xs text-gray-400">{t('click_for_details') || 'Click a row for details'}</p>

      <div className="card hidden flex-col sm:flex">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={filteredIds.length > 0 && selectedIds.size === filteredIds.length}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all sales"
                  />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('receipt_number')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 lg:table-cell">{t('cashier')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('payment_method')}</th>
                <th className="hidden px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('branch')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                <th className="hidden px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('items')}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">{t('no_data')}</td></tr>
              ) : groupedSales.map((group) => (
                <Fragment key={group.id}>
                  {groupMode !== 'none' ? (
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td colSpan={10} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {group.label} · {group.items.length} sale{group.items.length === 1 ? '' : 's'}
                      </td>
                    </tr>
                  ) : null}
                  {group.items.map((sale) => {
                    const items = Array.isArray(sale.items) ? sale.items : []
                    const totalUsd = sale.total_usd || sale.total || 0
                    const totalKhr = sale.total_khr || 0
                    const status = sale.sale_status || 'completed'
                    const branchLabel = getSaleBranchLabel(sale)
                    return (
                      <tr
                        key={sale.id}
                        className={`table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 ${status === 'cancelled' ? 'opacity-60' : ''}`}
                        onClick={() => setDetailSale(sale)}
                      >
                        <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={selectedIds.has(Number(sale.id))}
                            onChange={() => toggleSelected(sale.id)}
                            aria-label={`Select ${sale.receipt_number}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono font-medium text-blue-600 dark:text-blue-400">{sale.receipt_number}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-500">{fmtTime(sale.created_at)}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={status} t={t} /></td>
                        <td className="hidden px-4 py-2.5 text-gray-700 dark:text-gray-300 lg:table-cell">{sale.cashier_name || 'N/A'}</td>
                        <td className="px-4 py-2.5"><span className="badge-blue text-xs">{sale.payment_method || 'N/A'}</span></td>
                        <td className="hidden px-4 py-2.5 text-xs text-gray-500 md:table-cell">{branchLabel || 'N/A'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                          {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                        </td>
                        <td className="hidden px-4 py-2.5 text-center text-gray-500 md:table-cell">{items.length}</td>
                        <td className="px-4 py-2.5 text-center" onClick={(event) => event.stopPropagation()}>
                          <button
                            onClick={() => setSelectedSale(sale)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20"
                          >
                            {t('reprint')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          {filtered.length} {t('sales')} · {fmtUSD(revenue)}
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-400">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
        ) : groupedSales.map((group) => (
          <div key={group.id} className="space-y-2">
            {groupMode !== 'none' ? (
              <div className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.label}</div>
            ) : null}
            {group.items.map((sale) => {
              const items = Array.isArray(sale.items) ? sale.items : []
              const totalUsd = sale.total_usd || sale.total || 0
              const totalKhr = sale.total_khr || 0
              const status = sale.sale_status || 'completed'
              const branchLabel = getSaleBranchLabel(sale)
              return (
                <div key={sale.id} className="card cursor-pointer p-3 active:bg-blue-50 dark:active:bg-blue-900/10" onClick={() => setDetailSale(sale)}>
                  <div className="mb-2 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={selectedIds.has(Number(sale.id))}
                      onChange={() => toggleSelected(sale.id)}
                      aria-label={`Select ${sale.receipt_number}`}
                    />
                    <span className="text-xs text-gray-500">Select</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{sale.receipt_number}</span>
                        <span className="badge-blue text-xs">{sale.payment_method || 'N/A'}</span>
                        <StatusBadge status={status} t={t} />
                      </div>
                      <div className="text-xs text-gray-400">{fmtTime(sale.created_at)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        {sale.cashier_name ? <span>{sale.cashier_name}</span> : null}
                        {branchLabel ? <span>· {branchLabel}</span> : null}
                        <span>· {items.length} {t('items')}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className={`font-semibold ${status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{fmtUSD(totalUsd)}</div>
                      {totalKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(totalKhr)}</div> : null}
                      <button className="mt-1 text-xs text-blue-500 underline" onClick={(event) => { event.stopPropagation(); setSelectedSale(sale) }}>
                        {t('reprint')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {detailSale ? (
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
      ) : null}

      {showExport ? (
        <ExportModal onClose={() => setShowExport(false)} t={t} fmtUSD={fmtUSD} />
      ) : null}

      {showImport ? (
        <SalesImportModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false)
            loadSales()
          }}
        />
      ) : null}
    </div>
  )
}
