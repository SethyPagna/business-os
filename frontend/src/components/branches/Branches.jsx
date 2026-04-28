import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Building2, Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import Modal from '../shared/Modal'
import PageHeader from '../shared/PageHeader'
import BranchForm from './BranchForm'
import TransferModal from './TransferModal'
import { getFirstLoaderError, settleLoaderMap } from '../../utils/loaders.mjs'

/**
 * 1. Branches Page
 * 1.1 Purpose
 * - Manage branch records.
 * - Transfer inventory between branches.
 * - Review transfer history.
 */

/**
 * 1.2 Shared format helper for transfer timestamps.
 */
function formatTransferDate(rawValue) {
  if (!rawValue) return 'N/A'
  const iso = rawValue.includes('T') || rawValue.endsWith('Z')
    ? rawValue
    : `${rawValue.replace(' ', 'T')}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function Branches() {
  const { t, user, notify, fmtUSD } = useApp()
  const { syncChannel } = useSync()

  /**
   * 2. Page State
   * 2.1 Branch + transfer data sources.
   * 2.2 UI selection/expansion state.
   */
  const [branches, setBranches] = useState([])
  const [tab, setTab] = useState('branches')
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [transfers, setTransfers] = useState([])
  const [branchStocks, setBranchStocks] = useState({})
  const [expandedBranch, setExpandedBranch] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())

  /**
   * 3. Data Loading
   * 3.1 Fetch branches + transfer history.
   */
  const load = async () => {
    try {
      const result = await settleLoaderMap({
        branches: () => window.api.getBranches(),
        transfers: () => window.api.getTransfers({}),
      })

      if (Array.isArray(result.values.branches)) setBranches(result.values.branches)
      if (Array.isArray(result.values.transfers)) setTransfers(result.values.transfers)

      if (!result.hasAnySuccess) {
        throw new Error(getFirstLoaderError(result.errors, t('failed_to_load_data') || 'Failed to load data'))
      }
    } catch (error) {
      notify(error?.message || (t('failed_to_load_data') || 'Failed to load data'), 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 3.2 Sync refresh hooks.
   * - Branch changes.
   * - Product changes (stock movement can affect branch views).
   */
  useEffect(() => {
    if (!syncChannel) return
    const channel = syncChannel.channel
    if (channel === 'branches' || channel === 'products') load()
  }, [syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 4. Derived State
   */
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches])
  const selectedCount = selectedIds.size

  /**
   * 5. Branch Stock Expansion
   * 5.1 Lazy-load stock per branch on first open.
   */
  const loadBranchStock = async (branchId) => {
    if (expandedBranch === branchId) {
      setExpandedBranch(null)
      return
    }
    if (!branchStocks[branchId]) {
      const stock = await window.api.getBranchStock(branchId)
      setBranchStocks((prev) => ({ ...prev, [branchId]: Array.isArray(stock) ? stock : [] }))
    }
    setExpandedBranch(branchId)
  }

  /**
   * 6. CRUD Actions
   */
  const handleSaveBranch = async (form) => {
    try {
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const res = selected
        ? await window.api.updateBranch(selected.id, payload)
        : await window.api.createBranch(payload)
      if (res?.success === false) {
        notify(res.error || 'Failed to save branch', 'error')
        return
      }
      notify(selected ? (t('branch_updated') || 'Branch updated') : (t('branch_created') || 'Branch created'))
      setModal(null)
      setSelected(null)
      load()
    } catch (error) {
      notify(error?.message || 'Failed to save branch', 'error')
    }
  }

  const handleDelete = async (branch) => {
    if (!window.confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) return
    try {
      const res = await window.api.deleteBranch(branch.id, user?.id, user?.name)
      if (!res?.success) {
        notify(res?.error || 'Cannot delete branch', 'error')
        return
      }
      notify(t('branch_deleted') || 'Branch deleted')
      load()
    } catch (error) {
      notify(error?.message || 'Failed to delete branch', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedCount) return
    const toDelete = branches.filter((branch) => selectedIds.has(branch.id) && !branch.is_default)
    if (!toDelete.length) {
      notify(t('cannot_delete_default_branch') || 'Cannot delete default branch', 'error')
      return
    }
    if (!window.confirm(`Delete ${toDelete.length} branch(es)? This cannot be undone.`)) return

    const results = await Promise.allSettled(
      toDelete.map((branch) => window.api.deleteBranch(branch.id, user?.id, user?.name)),
    )
    const failed = results.filter((result) => result.status === 'rejected' || result.value?.success === false).length
    setSelectedIds(new Set())
    await load()
    if (failed > 0) {
      notify((t('bulk_delete_partial_fail') || '{n} branch(es) could not be deleted.').replace('{n}', String(failed)), 'error')
      return
    }
    notify((t('bulk_deleted_count') || '{n} branch(es) deleted').replace('{n}', String(toDelete.length)))
  }

  /**
   * 7. Selection Utilities
   */
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedCount === branches.length && branches.length > 0) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(branches.map((branch) => branch.id)))
  }

  return (
    <div className="page-scroll flex min-h-0 flex-col p-3 sm:p-6">
      <PageHeader
        icon={Building2}
        tone="blue"
        title={t('branches') || 'Branches'}
        className="mb-4"
        actions={(
          <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {selectedCount > 0 ? (
            <button className="btn-danger flex-shrink-0 text-sm" onClick={handleBulkDelete}>
              <Trash2 className="h-4 w-4" />
              <span>{(t('delete') || 'Delete')} ({selectedCount})</span>
            </button>
          ) : null}
          <button className="btn-secondary flex-shrink-0 px-3 py-1.5 text-xs sm:text-sm" onClick={() => setModal('transfer')}>
            <ArrowRightLeft className="h-4 w-4" />
            <span>{t('transfer') || 'Transfer'}</span>
          </button>
          <button className="btn-primary flex-shrink-0 px-3 py-1.5 text-xs sm:text-sm" onClick={() => { setSelected(null); setModal('form') }}>
            <Plus className="h-4 w-4" />
            <span>{t('add_branch') || 'Add Branch'}</span>
          </button>
        </div>
        )}
      />

      <p className="mb-4 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
        {t('branch_default_hint') || 'Manage locations, transfer stock between branches, and review movement history from one place.'}
      </p>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {[
          ['branches', t('branches') || 'Branches'],
          ['transfers', t('transfer_history') || 'Transfer History'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'branches' ? (
        <div className="space-y-3">
          {branches.length > 0 ? (
            <div className="flex items-center gap-3 px-2">
              <input
                id="branches-select-all"
                name="branches_select_all"
                aria-label="Select all branches"
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={selectedCount === branches.length && branches.length > 0}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = selectedCount > 0 && selectedCount < branches.length
                  }
                }}
                onChange={toggleSelectAll}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : `${t('select_all') || 'Select all'} (${branches.length})`}
              </span>
            </div>
          ) : null}

          {branches.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p>{t('no_data') || 'No data'}</p>
            </div>
          ) : null}

          {branches.map((branch) => {
            const isExpanded = expandedBranch === branch.id
            const stock = branchStocks[branch.id] || []
            const inStock = stock.filter((product) => Number(product.branch_quantity || 0) > 0)
            const totalValue = inStock.reduce(
              (sum, product) => sum + Number(product.branch_quantity || 0) * Number(product.purchase_price_usd || 0),
              0,
            )

            return (
              <div key={branch.id} className={`card overflow-hidden transition-all ${selectedIds.has(branch.id) ? 'ring-2 ring-blue-400 dark:ring-blue-500' : ''}`}>
                <div className="p-3 sm:p-4">
                  <div className="flex items-start gap-2">
                    <input
                      id={`branch-select-${branch.id}`}
                      name={`branch_select_${branch.id}`}
                      aria-label={`Select branch ${branch.name}`}
                      type="checkbox"
                      className="mt-1 h-4 w-4 flex-shrink-0 rounded"
                      checked={selectedIds.has(branch.id)}
                      onChange={() => toggleSelect(branch.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-base font-bold text-gray-900 dark:text-white">{branch.name}</span>
                            {branch.is_default ? <span className="badge-blue text-xs">{t('default_branch') || 'Default'}</span> : null}
                            {branch.is_active
                              ? <span className="badge-green text-xs">{t('active') || 'Active'}</span>
                              : <span className="badge-red text-xs">{t('inactive') || 'Inactive'}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-gray-500 dark:text-gray-400">
                            {branch.location ? <span>{branch.location}</span> : null}
                            {branch.phone ? <span>{branch.phone}</span> : null}
                            {branch.manager ? <span>{branch.manager}</span> : null}
                          </div>
                          {branch.notes ? <p className="mt-0.5 truncate text-xs text-gray-400">{branch.notes}</p> : null}
                        </div>
                        <div className="flex max-w-full flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1">
                          <button onClick={() => loadBranchStock(branch.id)} className="btn-secondary flex-shrink-0 px-2.5 py-1 text-xs">
                            <Warehouse className="h-3.5 w-3.5" />
                            <span>{isExpanded ? (t('hide_stock') || 'Hide Stock') : (t('stock') || 'Stock')}</span>
                          </button>
                          <button onClick={() => { setSelected(branch); setModal('form') }} className="btn-secondary flex-shrink-0 px-2.5 py-1 text-xs">
                            <Pencil className="h-3.5 w-3.5" />
                            <span>{t('edit') || 'Edit'}</span>
                          </button>
                          {!branch.is_default ? (
                            <button onClick={() => handleDelete(branch)} className="btn-danger flex-shrink-0 px-2.5 py-1 text-xs">
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>{t('delete') || 'Delete'}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
                          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                              {(t('branch_stock_count') || '{n} products in stock').replace('{n}', String(inStock.length))}
                              {' · '}
                              {t('branch_stock_value') || 'Value'}: <span className="text-blue-600">{fmtUSD(totalValue)}</span>
                            </span>
                            <button onClick={() => setModal('transfer')} className="text-xs text-blue-500 hover:underline">
                              {t('transfer_stock_link') || 'Transfer stock'}
                            </button>
                          </div>

                          {inStock.length === 0 ? (
                            <p className="rounded-lg bg-gray-50 py-4 text-center text-sm text-gray-400 dark:bg-gray-700/30">
                              {t('no_branch_stock') || 'No stock in this branch. Use Transfer or Adjust Stock to add items.'}
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                              {inStock.map((product) => (
                                <div
                                  key={product.id}
                                  className={`rounded-lg border p-2.5 text-xs ${
                                    Number(product.branch_quantity || 0) <= Number(product.low_stock_threshold || 10)
                                      ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'
                                      : 'border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/30'
                                  }`}
                                >
                                  <div className="mb-0.5 truncate font-medium text-gray-800 dark:text-gray-200">{product.name}</div>
                                  <div
                                    className={`text-sm font-bold ${
                                      Number(product.branch_quantity || 0) <= Number(product.out_of_stock_threshold || 0)
                                        ? 'text-red-600'
                                        : Number(product.branch_quantity || 0) <= Number(product.low_stock_threshold || 10)
                                          ? 'text-yellow-600'
                                          : 'text-green-600'
                                    }`}
                                  >
                                    {product.branch_quantity} {product.unit}
                                  </div>
                                  {product.sku ? <div className="truncate font-mono text-gray-400">{product.sku}</div> : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {tab === 'transfers' ? (
        <>
          <div className="space-y-2 sm:hidden">
            {transfers.length === 0 ? (
              <div className="card py-10 text-center text-gray-400">{t('no_data') || 'No data'}</div>
            ) : transfers.map((transfer) => (
              <div key={transfer.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{transfer.product_name}</div>
                    <div className="mt-1 text-xs text-gray-400">{formatTransferDate(transfer.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900 dark:text-white">{transfer.quantity}</div>
                    <div className="text-[10px] text-gray-400">{t('quantity') || 'Qty'}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="badge-red text-xs">{transfer.from_name || 'N/A'}</span>
                  <span className="badge-green text-xs">{transfer.to_name || 'N/A'}</span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <div>{transfer.note || 'N/A'}</div>
                  <div>{transfer.user_name || 'N/A'}</div>
                </div>
              </div>
            ))}
          </div>

        <div className="card hidden flex-col sm:flex">
          <div className="overflow-x-auto">
            <table className="table-bordered w-full text-sm" style={{ minWidth: 640 }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date') || 'Date'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('product_name') || 'Product'}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('from_branch') || 'From'}</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('to_branch') || 'To'}</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity') || 'Qty'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('transfer_note') || 'Note'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('user') || 'User'}</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{t('no_data') || 'No data'}</td></tr>
                ) : transfers.map((transfer) => (
                  <tr key={transfer.id} className="table-row">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-400">{formatTransferDate(transfer.created_at)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200">{transfer.product_name}</td>
                    <td className="px-4 py-2.5"><span className="badge-red text-xs">{transfer.from_name || 'N/A'}</span></td>
                    <td className="px-4 py-2.5"><span className="badge-green text-xs">{transfer.to_name || 'N/A'}</span></td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-900 dark:text-white">{transfer.quantity}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{transfer.note || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{transfer.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
            {(t('transfers_count') || '{n} transfers').replace('{n}', String(transfers.length))}
          </div>
        </div>
        </>
      ) : null}

      {modal === 'form' ? (
        <Modal title={selected ? `${t('edit_branch') || 'Edit Branch'}: ${selected.name}` : `+ ${t('add_branch') || 'Add Branch'}`} onClose={() => setModal(null)}>
          <BranchForm branch={selected} onSave={handleSaveBranch} onClose={() => setModal(null)} />
        </Modal>
      ) : null}

      {modal === 'transfer' ? (
        <TransferModal
          branches={activeBranches}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null)
            load()
            setBranchStocks({})
          }}
          user={user}
          notify={notify}
        />
      ) : null}
    </div>
  )
}
