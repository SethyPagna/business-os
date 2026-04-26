import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { downloadCSV } from '../../utils/csv'
import ReturnDetailModal from './ReturnDetailModal'
import EditReturnModal from './EditReturnModal'
import NewReturnModal from './NewReturnModal'
import NewSupplierReturnModal from './NewSupplierReturnModal'

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

function normalizeScope(value) {
  return value === SUPPLIER_SCOPE ? SUPPLIER_SCOPE : CUSTOMER_SCOPE
}

export default function Returns() {
  const { t, fmtUSD, fmtKHR, notify } = useApp()
  const { syncChannel } = useSync()
  const [scope, setScope] = useState(CUSTOMER_SCOPE)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [detailRet, setDetailRet] = useState(null)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editRet, setEditRet] = useState(null)
  const [loading, setLoading] = useState(true)

  const tr = (key, fallback) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const loadReturns = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = { scope }
      const result = await window.api.getReturns(params)
      setRows(Array.isArray(result) ? result : [])
    } catch (error) {
      console.error('[Returns] load failed:', error?.message)
      setRows([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [scope])

  useEffect(() => { loadReturns() }, [loadReturns])

  useEffect(() => {
    if (!syncChannel) return
    if (['returns', 'sales', 'inventory', 'products'].includes(syncChannel.channel)) {
      loadReturns(true)
    }
  }, [syncChannel, loadReturns])

  const handleOpenEdit = async (ret) => {
    const retScope = normalizeScope(ret?.return_scope)
    if (retScope !== CUSTOMER_SCOPE) {
      notify(tr('supplier_return_edit_not_supported', 'Supplier returns cannot be edited from this form yet.'), 'info')
      return
    }
    setDetailRet(null)
    try {
      const fresh = await window.api.getReturn(ret.id)
      setEditRet(fresh || ret)
    } catch {
      setEditRet(ret)
    }
  }

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = useMemo(() => rows.filter((ret) => {
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
  }), [rows, searchTerms])

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

  const exportRows = filtered.map((ret) => ({
    Return_Number: ret.return_number || '',
    Scope: normalizeScope(ret.return_scope),
    Date: ret.created_at || '',
    Receipt: ret.receipt_number || '',
    Customer: ret.customer_name || '',
    Supplier: ret.supplier_name || '',
    Reason: ret.reason || '',
    Type: ret.return_type || '',
    Settlement: ret.supplier_settlement || '',
    Refund_USD: ret.total_refund_usd || 0,
    Compensation_USD: ret.supplier_compensation_usd || 0,
    Business_Loss_USD: ret.supplier_loss_usd || 0,
    Status: ret.status || 'completed',
  }))

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

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">{tr('returns', 'Returns')}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{tr('returns_scope_hint', 'Customer refunds and supplier returns are tracked separately.')}</p>
        </div>
        <div className="flex w-full flex-row flex-nowrap gap-2 sm:w-auto sm:items-center">
          <button
            onClick={() => downloadCSV(`returns-${new Date().toISOString().slice(0, 10)}.csv`, exportRows)}
            className="btn-secondary min-w-0 flex-1 whitespace-nowrap px-3 text-xs sm:w-auto sm:flex-none sm:text-sm"
          >
            {tr('export_csv', 'Export')}
          </button>
          {scope === SUPPLIER_SCOPE ? (
            <button onClick={() => setShowSupplierForm(true)} className="btn-primary min-w-0 flex-1 whitespace-nowrap px-3 text-xs sm:w-auto sm:flex-none sm:text-sm">+ {tr('return_to_supplier', 'Return to Supplier')}</button>
          ) : (
            <button onClick={() => setShowCustomerForm(true)} className="btn-primary min-w-0 flex-1 whitespace-nowrap px-3 text-xs sm:w-auto sm:flex-none sm:text-sm">+ {tr('new_return', 'New Return')}</button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-zinc-800 sm:w-auto">
          <button
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium sm:flex-none ${scope === CUSTOMER_SCOPE ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            onClick={() => setScope(CUSTOMER_SCOPE)}
          >
            {tr('customer_returns', 'Customer Returns')}
          </button>
          <button
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium sm:flex-none ${scope === SUPPLIER_SCOPE ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            onClick={() => setScope(SUPPLIER_SCOPE)}
          >
            {tr('supplier_returns', 'Supplier Returns')}
          </button>
        </div>
        <input
          className="input min-w-0 w-full flex-1"
          placeholder={tr('search_returns_placeholder', 'Search by return number, receipt, customer, supplier, reason')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

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

      <p className="mb-2 text-xs text-gray-400">{tr('tap_to_view_details', 'Tap a record to view details.')}</p>

      <div className="card hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
              <tr>
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
                <tr><td colSpan={7} className="py-10 text-center text-gray-400">{tr('loading', 'Loading')}...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</td></tr>
              ) : filtered.map((ret) => {
                const retScope = normalizeScope(ret.return_scope)
                const typeLabel = retScope === SUPPLIER_SCOPE
                  ? (ret.supplier_settlement || tr('settlement_refund', 'refund'))
                  : (ret.return_type || tr('manual_return', 'manual'))
                return (
                  <tr key={ret.id} className="table-row cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/10" onClick={() => setDetailRet(ret)}>
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
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 sm:hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-400">{tr('loading', 'Loading')}...</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400">{tr('no_returns_found', 'No returns found.')}</div>
        ) : filtered.map((ret) => {
          const retScope = normalizeScope(ret.return_scope)
          return (
            <div key={ret.id} className="card cursor-pointer p-3" onClick={() => setDetailRet(ret)}>
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
