import { useState, useEffect, useCallback } from 'react'
import { Download, Search as SearchIcon, ShoppingBag } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import Receipt from '../receipt/Receipt'
import { fmtTime } from '../../utils/formatters'
import StatusBadge, { ALL_STATUSES, getStatusLabel } from './StatusBadge'
import SaleDetailModal from './SaleDetailModal'
import ExportModal from './ExportModal'
import { getClientDeviceInfo } from '../../utils/deviceInfo'

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
  const [sales, setSales] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedSale, setSelectedSale] = useState(null)
  const [detailSale, setDetailSale] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [loading, setLoading] = useState(true)

  const translateOr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return settings?.language === 'km' ? fallbackKm : fallbackEn
  }, [settings?.language, t])

  const loadSales = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    return window.api.getSales()
      .then((result) => {
        if (Array.isArray(result) && result.length > 0) {
          setSales(result)
          return
        }
        if (!silent) setSales(Array.isArray(result) ? result : [])
      })
      .catch((error) => {
        console.error('[Sales] load failed:', error.message)
        if (!silent) setSales([])
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadSales()
  }, [loadSales])

  useEffect(() => {
    if (!syncChannel) return
    if (syncChannel.channel === 'sales' || syncChannel.channel === 'returns') loadSales(true)
  }, [syncChannel, loadSales])

  const handleStatusChange = async (saleId, newStatus, notes) => {
    try {
      await window.api.updateSaleStatus(saleId, newStatus, notes)
      notify(`${t('status_updated') || 'Status updated'}: ${getStatusLabel(newStatus, t)}`)
      loadSales()
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
    } catch (error) {
      notify(`Failed to update status: ${error.message || error}`, 'error')
    }
  }

  const handleAttachMembership = async (saleId, membershipNumber) => {
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
      notify(error?.message || translateOr('failed_to_attach_membership', 'Failed to link membership'), 'error')
      return false
    }
  }

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = sales.filter((sale) => {
    if (statusFilter !== 'all' && (sale.sale_status || 'completed') !== statusFilter) return false
    if (!searchTerms.length) return true
    const haystack = `${sale.receipt_number || ''} ${sale.cashier_name || ''} ${sale.payment_method || ''} ${sale.notes || ''} ${sale.customer_name || ''} ${sale.customer_membership_number || ''} ${getSaleBranchLabel(sale) || ''}`
    return multiMatch(haystack, searchTerms)
  })

  const revenue = filtered
    .filter((sale) => !['cancelled', 'awaiting_payment'].includes(sale.sale_status || 'completed'))
    .reduce((sum, sale) => sum + (sale.net_total_usd ?? sale.total_usd ?? 0), 0)

  const pendingRevenue = filtered
    .filter((sale) => (sale.sale_status || 'completed') === 'awaiting_payment')
    .reduce((sum, sale) => sum + (sale.total_usd || 0), 0)

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
          <button onClick={() => setShowExport(true)} className="btn-primary flex-shrink-0 px-3 py-1.5 text-xs">
            <Download className="h-4 w-4" />
            <span>Export</span>
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
      </div>

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
          {statusFilter === 'all' && filtered.filter((sale) => (sale.sale_status || 'completed') === 'awaiting_delivery').length > 0 ? (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-blue-600 dark:text-blue-400">{filtered.filter((sale) => (sale.sale_status || 'completed') === 'awaiting_delivery').length} {t('summary_in_delivery') || 'in delivery'}</span>
            </>
          ) : null}
        </div>
      )}

      <p className="mb-2 text-xs text-gray-400">{t('click_for_details') || 'Click a row for details'}</p>

      <div className="card hidden flex-col sm:flex">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50">
              <tr>
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
                <tr><td colSpan={9} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400">{t('no_data')}</td></tr>
              ) : filtered.map((sale) => {
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
        ) : filtered.map((sale) => {
          const items = Array.isArray(sale.items) ? sale.items : []
          const totalUsd = sale.total_usd || sale.total || 0
          const totalKhr = sale.total_khr || 0
          const status = sale.sale_status || 'completed'
          const branchLabel = getSaleBranchLabel(sale)
          return (
            <div key={sale.id} className="card cursor-pointer p-3 active:bg-blue-50 dark:active:bg-blue-900/10" onClick={() => setDetailSale(sale)}>
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
    </div>
  )
}
