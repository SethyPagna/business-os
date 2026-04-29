import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

export default function NewSupplierReturnModal({ onClose, onSuccess, notify, fmtUSD, fmtKHR }) {
  const { user, t } = useApp()
  const tr = (key, fallback) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [branches, setBranches] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [branchId, setBranchId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [settlement, setSettlement] = useState('refund')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState({})
  const [compensationUsd, setCompensationUsd] = useState('')
  const [compensationKhr, setCompensationKhr] = useState('')
  const bootstrapRequestRef = useRef(0)
  const inventoryRequestRef = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(bootstrapRequestRef)
    invalidateTrackedRequest(inventoryRequestRef)
  }, [])

  useEffect(() => {
    const requestId = beginTrackedRequest(bootstrapRequestRef)
    setLoading(true)
    async function loadSetup() {
      try {
        const [branchRows, supplierRows] = await withLoaderTimeout(
          () => Promise.all([
            window.api.getBranches(),
            window.api.getSuppliers(),
          ]),
          'Supplier return setup',
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        const activeBranches = (branchRows || []).filter((branch) => branch.is_active)
        setBranches(activeBranches)
        setSuppliers(supplierRows || [])
        setBranchId((current) => {
          if (current && activeBranches.some((branch) => String(branch.id) === String(current))) return current
          const defaultBranchId = activeBranches.find((branch) => branch.is_default)?.id || activeBranches[0]?.id || ''
          return defaultBranchId ? String(defaultBranchId) : ''
        })
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        notify(error?.message || tr('failed_to_load_data', 'Failed to load data'), 'error')
        setBranches([])
        setSuppliers([])
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        setLoading(false)
      }
    }
    loadSetup()
    return () => invalidateTrackedRequest(bootstrapRequestRef)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!branchId) {
      invalidateTrackedRequest(inventoryRequestRef)
      setLoadingProducts(false)
      setProducts([])
      return undefined
    }
    const requestId = beginTrackedRequest(inventoryRequestRef)
    setLoadingProducts(true)
    async function loadInventory() {
      try {
        const rows = await withLoaderTimeout(
          () => window.api.getInventorySummary({ branchId: Number(branchId) }),
          'Supplier return inventory',
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        const next = (rows || []).filter((product) => (product.display_quantity || 0) > 0)
        setProducts(next)
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        notify(error?.message || tr('failed_to_load_data', 'Failed to load data'), 'error')
        setProducts([])
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        setLoadingProducts(false)
      }
    }
    loadInventory()
    return () => invalidateTrackedRequest(inventoryRequestRef)
  }, [branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return products
    return products.filter((product) => {
      const hay = `${product.name || ''} ${product.sku || ''} ${product.category || ''} ${product.brand || ''}`.toLowerCase()
      return hay.includes(term)
    })
  }, [products, search])

  const selectedItems = useMemo(() => {
    return products
      .map((product) => {
        const rawQty = quantities[product.id]
        const qty = Math.max(0, Math.min(Number(rawQty || 0), Number(product.display_quantity || 0)))
        if (!qty) return null
        const unitCostUsd = Number(product.purchase_price_usd || product.cost_price_usd || 0)
        const unitCostKhr = Number(product.purchase_price_khr || product.cost_price_khr || 0)
        return {
          product_id: product.id,
          product_name: product.name || null,
          quantity: qty,
          cost_price_usd: unitCostUsd,
          cost_price_khr: unitCostKhr,
        }
      })
      .filter(Boolean)
  }, [products, quantities])

  const totals = useMemo(() => {
    const totalUsd = selectedItems.reduce((sum, item) => sum + (item.quantity * item.cost_price_usd), 0)
    const totalKhr = selectedItems.reduce((sum, item) => sum + (item.quantity * item.cost_price_khr), 0)
    return { totalUsd, totalKhr }
  }, [selectedItems])

  const supplier = suppliers.find((row) => String(row.id) === String(supplierId))
  const branch = branches.find((row) => String(row.id) === String(branchId))
  const defaultCompensationEnabled = settlement === 'refund' || settlement === 'credit'
  const effectiveCompensationUsd = compensationUsd === '' ? (defaultCompensationEnabled ? totals.totalUsd : 0) : Number(compensationUsd || 0)
  const effectiveCompensationKhr = compensationKhr === '' ? (defaultCompensationEnabled ? totals.totalKhr : 0) : Number(compensationKhr || 0)
  const lossUsd = Math.max(0, totals.totalUsd - effectiveCompensationUsd)
  const lossKhr = Math.max(0, totals.totalKhr - effectiveCompensationKhr)

  const updateQty = (productId, nextValue, max) => {
    const parsed = Number(nextValue || 0)
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, max)) : 0
    setQuantities((prev) => ({ ...prev, [productId]: normalized }))
  }

  const submit = async () => {
    if (!branchId) return notify(tr('branch_required', 'Branch is required'), 'error')
    if (!supplierId) return notify(tr('supplier_required', 'Supplier is required'), 'error')
    if (!reason.trim()) return notify(tr('return_reason_required', 'Reason is required'), 'error')
    if (!selectedItems.length) return notify(tr('select_items_to_return', 'Select at least one item to return.'), 'error')

    setSubmitting(true)
    try {
      await window.api.createSupplierReturn({
        cashier_id: user?.id || null,
        cashier_name: user?.name || user?.username || null,
        branch_id: Number(branchId),
        supplier_id: Number(supplierId),
        supplier_name: supplier?.name || null,
        reason: reason.trim(),
        notes: notes.trim() || null,
        settlement,
        supplier_compensation_usd: effectiveCompensationUsd,
        supplier_compensation_khr: effectiveCompensationKhr,
        items: selectedItems,
      })
      notify(tr('supplier_return_success', 'Supplier return processed successfully'), 'success')
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      onSuccess?.()
      onClose?.()
    } catch (error) {
      notify(error?.message || tr('error', 'Error'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-4xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{tr('return_to_supplier', 'Return to Supplier')}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{tr('supplier_return_hint', 'Send stock back to supplier and record compensation/loss.')}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">x</button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{tr('loading', 'Loading')}...</div>
        ) : (
          <div className="modal-scroll space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="supplier-return-branch" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('branch', 'Branch')}</label>
                <select id="supplier-return-branch" className="input text-sm" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">{tr('select_branch', 'Select branch')}</option>
                  {branches.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="supplier-return-supplier" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('supplier', 'Supplier')}</label>
                <select id="supplier-return-supplier" className="input text-sm" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">{tr('select_supplier', 'Select supplier')}</option>
                  {suppliers.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="supplier-return-settlement" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('settlement_method', 'Settlement')}</label>
                <select id="supplier-return-settlement" className="input text-sm" value={settlement} onChange={(event) => setSettlement(event.target.value)}>
                  <option value="refund">{tr('settlement_refund', 'Refund')}</option>
                  <option value="credit">{tr('settlement_credit', 'Store credit')}</option>
                  <option value="replacement">{tr('settlement_replacement', 'Replacement')}</option>
                  <option value="writeoff">{tr('settlement_writeoff', 'No compensation')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="supplier-return-reason" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('reason', 'Reason')}</label>
                <input id="supplier-return-reason" className="input text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={tr('return_reason_placeholder', 'Defective batch / expired stock / wrong shipment')} />
              </div>
            </div>

            <div>
              <label htmlFor="supplier-return-notes" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('notes', 'Notes')}</label>
              <textarea id="supplier-return-notes" className="input min-h-[72px] text-sm" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={tr('optional', 'Optional')} />
            </div>

            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{tr('products', 'Products')}</h3>
                <span className="text-xs text-gray-400">{branch?.name || tr('branch_not_selected', 'Choose a branch')}</span>
                <input
                  className="input ml-auto w-full text-sm sm:w-72"
                  placeholder={tr('search_products_placeholder', 'Search products by name, SKU, category')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{tr('supplier_return_stock_hint', 'Only products with stock in the selected branch are shown. Returned quantity cannot exceed available stock.')}</p>
              <div className="max-h-[320px] overflow-auto rounded-lg border border-gray-100 dark:border-gray-700">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left dark:bg-gray-700/50">
                    <tr>
                      <th className="px-3 py-2">{tr('product', 'Product')}</th>
                      <th className="px-3 py-2">{tr('available', 'Available')}</th>
                      <th className="px-3 py-2">{tr('unit_cost', 'Unit Cost')}</th>
                      <th className="px-3 py-2">{tr('quantity', 'Quantity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingProducts ? (
                      <tr>
                        <td className="px-3 py-5 text-center text-xs text-gray-400" colSpan={4}>{tr('loading', 'Loading')}...</td>
                      </tr>
                    ) : filteredProducts.length === 0 ? (
                      <tr>
                        <td className="px-3 py-5 text-center text-xs text-gray-400" colSpan={4}>{tr('no_data', 'No data')}</td>
                      </tr>
                    ) : filteredProducts.map((product) => {
                      const maxQty = Number(product.display_quantity || 0)
                      const qty = Number(quantities[product.id] || 0)
                      const unitCostUsd = Number(product.purchase_price_usd || product.cost_price_usd || 0)
                      const unitCostKhr = Number(product.purchase_price_khr || product.cost_price_khr || 0)
                      return (
                        <tr key={product.id} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-800 dark:text-gray-200">{product.name}</div>
                            <div className="text-xs text-gray-400">{product.sku || '-'} / {product.category || '-'}</div>
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{maxQty}</td>
                          <td className="px-3 py-2">
                            <div>{fmtUSD(unitCostUsd)}</div>
                            {unitCostKhr > 0 ? <div className="text-xs text-gray-400">{fmtKHR(unitCostKhr)}</div> : null}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="input w-24 text-sm"
                              type="number"
                              min="0"
                              step="1"
                              max={maxQty}
                              value={qty || ''}
                              onChange={(event) => updateQty(product.id, event.target.value, maxQty)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="supplier-return-compensation-usd" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('supplier_compensation_usd', 'Supplier compensation (USD)')}</label>
                <input
                  id="supplier-return-compensation-usd"
                  className="input text-sm"
                  type="number"
                  min="0"
                  step="0.01"
                  value={compensationUsd}
                  onChange={(event) => setCompensationUsd(event.target.value)}
                  placeholder={String(defaultCompensationEnabled ? totals.totalUsd.toFixed(2) : '0')}
                />
              </div>
              <div>
                <label htmlFor="supplier-return-compensation-khr" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('supplier_compensation_khr', 'Supplier compensation (KHR)')}</label>
                <input
                  id="supplier-return-compensation-khr"
                  className="input text-sm"
                  type="number"
                  min="0"
                  step="1"
                  value={compensationKhr}
                  onChange={(event) => setCompensationKhr(event.target.value)}
                  placeholder={String(defaultCompensationEnabled ? Math.round(totals.totalKhr) : 0)}
                />
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-700/40">
              <div className="flex justify-between gap-3">
                <span className="text-gray-600 dark:text-gray-300">{tr('supplier_return_items', 'Selected items')}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedItems.length}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-gray-600 dark:text-gray-300">{tr('total_cost', 'Total cost')}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtUSD(totals.totalUsd)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-gray-600 dark:text-gray-300">{tr('supplier_compensation', 'Compensation')}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">{fmtUSD(effectiveCompensationUsd)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-gray-600 dark:text-gray-300">{tr('business_loss', 'Business loss')}</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtUSD(lossUsd)}</span>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {tr('supplier_return_summary_hint', 'Loss = total cost - supplier compensation. This affects inventory valuation and return accounting.')}
              </p>
              <p className="text-xs text-gray-400">
                {fmtKHR(totals.totalKhr)} / {fmtKHR(effectiveCompensationKhr)} / {fmtKHR(lossKhr)}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={submitting}>{tr('cancel', 'Cancel')}</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading || loadingProducts || submitting}>
            {submitting ? `${tr('saving_label', 'Saving')}...` : tr('save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
