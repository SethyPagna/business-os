import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Building2, Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import Modal from '../shared/Modal'
import PageHeader from '../shared/PageHeader'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { useIsPageActive } from '../shared/pageActivity'
import BranchForm from './BranchForm'
import TransferModal from './TransferModal'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.mjs'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
} from '../../utils/loaders.mjs'

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
  const isActive = useIsPageActive('branches')

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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const actionHistory = useActionHistory({ limit: 3, notify })

  /**
   * 3. Data Loading
   * 3.1 Fetch branches + transfer history.
   */
  const load = useCallback(async (silent = loadedOnceRef.current) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      window.clearTimeout(loadWatchdogRef.current)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError(null)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoading(false)
          setLoadError(t('branches_load_slow') || 'Branches are taking longer than expected. Tap Retry or revisit in a moment.')
        }, 10_000)
      }

      try {
        const result = await settleLoaderMap({
          branches: () => window.api.getBranches(),
          transfers: () => window.api.getTransfers({}),
        })

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
        if (Array.isArray(result.values.branches)) setBranches(result.values.branches)
        if (Array.isArray(result.values.transfers)) setTransfers(result.values.transfers)

        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, t('failed_to_load_data') || 'Failed to load data'))
        }

        loadedOnceRef.current = true
        setLoadError(null)
        return result
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
        const message = error?.message || (t('failed_to_load_data') || 'Failed to load data')
        if (!silent && !loadedOnceRef.current) {
          setLoadError(message)
          loadedOnceRef.current = true
        } else if (!silent) {
          notify(message, 'warning')
        }
        return null
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (isTrackedRequestCurrent(loadRequestRef, requestId)) {
          setLoading(false)
        }
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [notify, t])

  useEffect(() => {
    if (!isActive) {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return
    }
    void load(loadedOnceRef.current)
  }, [isActive, load])

  /**
   * 3.2 Sync refresh hooks.
   * - Branch changes.
   * - Product changes (stock movement can affect branch views).
   */
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const channel = syncChannel.channel
    if (channel === 'branches' || channel === 'products') void load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  useEffect(() => () => {
    window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  /**
   * 4. Derived State
   */
  const activeBranches = useMemo(() => branches.filter((branch) => branch.is_active), [branches])
  const selectedCount = selectedIds.size

  const buildBranchPayload = useCallback((branch = {}) => ({
    name: branch.name || '',
    location: branch.location || '',
    phone: branch.phone || '',
    manager: branch.manager || '',
    notes: branch.notes || '',
    is_default: branch.is_default ? 1 : 0,
    is_active: branch.is_active ?? 1,
    userId: user?.id,
    userName: user?.name,
  }), [user?.id, user?.name])

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
      const stock = await window.api.getBranchStock(branchId, { page: 1, pageSize: 20, stockState: 'positive' })
      setBranchStocks((prev) => ({ ...prev, [branchId]: stock }))
    }
    setExpandedBranch(branchId)
  }

  const loadMoreBranchStock = async (branchId) => {
    const current = branchStocks[branchId]
    if (!current || Array.isArray(current)) return
    const nextPage = Number(current.page || 1) + 1
    if (nextPage > Number(current.totalPages || 1)) return
    const stock = await window.api.getBranchStock(branchId, { page: nextPage, pageSize: current.pageSize || 20, stockState: current.stockState || 'positive' })
    setBranchStocks((prev) => ({
      ...prev,
      [branchId]: {
        ...stock,
        items: [...(current.items || []), ...(stock.items || [])],
      },
    }))
  }

  /**
   * 6. CRUD Actions
   */
  const handleSaveBranch = async (form) => {
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload = { ...form, userId: user?.id, userName: user?.name }
      const res = selected
        ? await window.api.updateBranch(selected.id, payload)
        : await window.api.createBranch(payload)
      if (res?.success === false) {
        notify(res.error || 'Failed to save branch', 'error')
        return
      }
      let createdBranchId = extractHistoryResultId(res)
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit branch ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const result = await window.api.updateBranch(existingSnapshot.id, buildBranchPayload(existingSnapshot))
            if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
            await load()
          },
          redo: async () => {
            const result = await window.api.updateBranch(nextSnapshot.id, buildBranchPayload(nextSnapshot))
            if (result?.success === false) throw new Error(result.error || 'Failed to reapply branch changes')
            await load()
          },
        })
      } else if (createdBranchId > 0) {
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdBranchId })
        actionHistory.pushAction({
          label: `Add branch ${createdSnapshot.name || ''}`.trim(),
          undo: async () => {
            const result = await window.api.deleteBranch(createdBranchId, user?.id, user?.name)
            if (!result?.success) throw new Error(result?.error || 'Failed to undo branch creation')
            await load()
          },
          redo: async () => {
            const result = await window.api.createBranch(buildBranchPayload(createdSnapshot))
            if (result?.success === false) throw new Error(result.error || 'Failed to recreate branch')
            createdBranchId = extractHistoryResultId(result)
            await load()
          },
        })
      }
      notify(selected ? (t('branch_updated') || 'Branch updated') : (t('branch_created') || 'Branch created'))
      setModal(null)
      setSelected(null)
      await load()
    } catch (error) {
      notify(error?.message || 'Failed to save branch', 'error')
    }
  }

  const handleDelete = async (branch) => {
    if (!window.confirm(`Delete branch "${branch.name}"? This cannot be undone.`)) return
    try {
      const snapshot = cloneHistorySnapshot(branch)
      const res = await window.api.deleteBranch(branch.id, user?.id, user?.name)
      if (!res?.success) {
        notify(res?.error || 'Cannot delete branch', 'error')
        return
      }
      let restoredBranchId = 0
      actionHistory.pushAction({
        label: `Delete branch ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const result = await window.api.createBranch(buildBranchPayload(snapshot))
          if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
          restoredBranchId = extractHistoryResultId(result)
          await load()
        },
        redo: async () => {
          const targetId = restoredBranchId || Number(snapshot.id || 0)
          if (!targetId) return
          const result = await window.api.deleteBranch(targetId, user?.id, user?.name)
          if (!result?.success) throw new Error(result?.error || 'Failed to delete branch again')
          await load()
        },
      })
      notify(t('branch_deleted') || 'Branch deleted')
      await load()
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

    const deletedSnapshots = toDelete.map((branch) => ({ ...branch }))

    const results = await Promise.allSettled(
      toDelete.map((branch) => window.api.deleteBranch(branch.id, user?.id, user?.name)),
    )
    const failedIds = results.flatMap((result, index) => (
      result.status === 'rejected' || result.value?.success === false
        ? [Number(toDelete[index]?.id || 0)]
        : []
    )).filter((id) => Number.isFinite(id) && id > 0)
    const failed = failedIds.length
    setSelectedIds(new Set(failedIds))
    await load()
    const restoredSnapshots = deletedSnapshots.filter((branch) => !failedIds.includes(Number(branch?.id || 0)))
    if (restoredSnapshots.length) {
      let restoredEntries = []
      actionHistory.pushAction({
        label: `Delete ${restoredSnapshots.length} branch${restoredSnapshots.length === 1 ? '' : 'es'}`,
        undo: async () => {
          restoredEntries = []
          for (const snapshot of restoredSnapshots) {
            const result = await window.api.createBranch({
              name: snapshot.name || '',
              location: snapshot.location || '',
              phone: snapshot.phone || '',
              manager: snapshot.manager || '',
              notes: snapshot.notes || '',
              is_default: snapshot.is_default ? 1 : 0,
              is_active: snapshot.is_active ?? 1,
              userId: user?.id,
              userName: user?.name,
            })
            if (result?.success === false) throw new Error(result.error || 'Failed to restore branch')
            restoredEntries.push({ originalId: snapshot.id, restoredId: Number(result?.id || result?.data?.id || 0) })
          }
          await load()
        },
        redo: async () => {
          const idsToDelete = restoredEntries.length
            ? restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            : restoredSnapshots.map((snapshot) => Number(snapshot.id || 0)).filter((id) => id > 0)
          for (const branchId of idsToDelete) {
            const result = await window.api.deleteBranch(branchId, user?.id, user?.name)
            if (!result?.success) throw new Error(result?.error || 'Failed to re-delete branch')
          }
          await load()
        },
      })
    }
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
        stackOnMobile={false}
        actionsClassName="self-start pl-2 sm:pl-0"
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

      <ActionHistoryBar history={actionHistory} className="mb-4" />

      {loadError && !loading && !branches.length && !transfers.length ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold">{t('page_load_warning') || 'Page could not finish loading'}</div>
          <div className="mt-1">{loadError}</div>
          <button
            type="button"
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            onClick={() => load(false)}
          >
            {t('retry') || 'Retry'}
          </button>
        </div>
      ) : null}

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
          {loading && !branches.length ? (
            <div className="py-12 text-center text-gray-400">
              <p>{t('loading') || 'Loading...'}</p>
            </div>
          ) : null}

          {!loading && branches.length > 0 ? (
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

          {!loading && branches.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p>{t('no_data') || 'No data'}</p>
            </div>
          ) : null}

          {branches.map((branch) => {
            const isExpanded = expandedBranch === branch.id
            const stockState = branchStocks[branch.id] || null
            const stockRows = Array.isArray(stockState) ? stockState : (Array.isArray(stockState?.items) ? stockState.items : [])
            const inStock = stockRows.filter((product) => Number(product.branch_quantity || 0) > 0)
            const stockSummary = !Array.isArray(stockState) ? stockState?.summary || {} : {}
            const totalProducts = Number(stockSummary.total_products ?? stockSummary.total_product ?? stockRows.length)
            const stockCount = Number(stockSummary.in_stock_products ?? stockSummary.positive_products ?? inStock.length)
            const lowStockCount = Number(stockSummary.low_stock_products ?? 0)
            const outStockCount = Number(stockSummary.out_of_stock_products ?? 0)
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
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-gray-700 dark:text-gray-300">
                              <span>{t('total_product') || 'Total product'}: <span className="text-gray-900 dark:text-white">{totalProducts}</span></span>
                              <span>{t('in_stock') || 'In stock'}: <span className="text-green-600">{stockCount}</span></span>
                              <span>{t('low_stock') || 'Low stock'}: <span className="text-amber-600">{lowStockCount}</span></span>
                              <span>{t('out_of_stock') || 'Out of stock'}: <span className="text-red-600">{outStockCount}</span></span>
                              <span>{t('branch_stock_value') || 'Value'}: <span className="text-blue-600">{fmtUSD(Number(stockSummary.positive_value_usd ?? stockSummary.total_value_usd ?? totalValue))}</span></span>
                            </div>
                            <span className="hidden text-sm font-semibold text-gray-700 dark:text-gray-300">
                              {(t('branch_stock_count') || '{n} products in stock').replace('{n}', String(stockCount))}
                              {' · '}
                              {t('branch_stock_value') || 'Value'}: <span className="text-blue-600">{fmtUSD(Number(stockSummary.positive_value_usd ?? totalValue))}</span>
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
                            <>
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
                              {!Array.isArray(stockState) && Number(stockState.page || 1) < Number(stockState.totalPages || 1) ? (
                                <div className="mt-3 flex justify-center">
                                  <button type="button" onClick={() => loadMoreBranchStock(branch.id)} className="btn-secondary px-3 py-1.5 text-xs">
                                    Show more stock
                                  </button>
                                </div>
                              ) : null}
                            </>
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
            {loading && !transfers.length ? (
              <div className="card py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</div>
            ) : transfers.length === 0 ? (
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
                {loading && !transfers.length ? (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">{t('loading') || 'Loading...'}</td></tr>
                ) : transfers.length === 0 ? (
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
