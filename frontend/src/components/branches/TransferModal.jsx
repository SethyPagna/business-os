import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

/**
 * 1. Transfer Modal Component
 * 1.1 Purpose
 * - Move product quantity from one branch to another.
 * - Validate source/destination/quantity before write.
 * - Surface transfer results through notifications.
 */
export default function TransferModal({ branches, onClose, onDone, user, notify }) {
  const { t, settings } = useApp()

  /**
   * 2. UI State
   * 2.1 Form inputs and branch-scoped product cache.
   */
  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const stockRequestRef = useRef(0)

  const invalidQuantityText = settings?.language === 'km'
    ? 'ចំនួនផ្ទេរត្រូវតែធំជាងសូន្យ។'
    : 'Transfer quantity must be greater than zero'

  /**
   * 3. Source Branch Sync
   * 3.1 Refresh product list each time source branch changes.
   */
  useEffect(() => {
    if (!fromBranch) {
      invalidateTrackedRequest(stockRequestRef)
      setLoadingProducts(false)
      setProducts([])
      setSelectedProduct(null)
      setQuantity('')
      return undefined
    }

    const requestId = beginTrackedRequest(stockRequestRef)
    setLoadingProducts(true)
    Promise.resolve(
      withLoaderTimeout(
        () => window.api.getBranchStock(Number.parseInt(fromBranch, 10)),
        'Branch stock for transfer',
      ),
    )
      .then((stock) => {
        if (!isTrackedRequestCurrent(stockRequestRef, requestId)) return
        setProducts(Array.isArray(stock) ? stock : [])
        setSelectedProduct(null)
        setQuantity('')
      })
      .catch((error) => {
        if (!isTrackedRequestCurrent(stockRequestRef, requestId)) return
        setProducts([])
        setSelectedProduct(null)
        setQuantity('')
        notify(error?.message || (t('failed_to_load_data') || 'Failed to load data'), 'error')
      })
      .finally(() => {
        if (!isTrackedRequestCurrent(stockRequestRef, requestId)) return
        setLoadingProducts(false)
      })

    return () => {
      invalidateTrackedRequest(stockRequestRef)
    }
  }, [fromBranch])

  /**
   * 4. Search Filter
   * 4.1 Keeps in-stock list visible when search is empty.
   */
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return products.filter((product) => Number(product.branch_quantity || 0) > 0)
    return products.filter((product) => {
      const name = String(product.name || '').toLowerCase()
      const sku = String(product.sku || '').toLowerCase()
      return name.includes(query) || sku.includes(query)
    })
  }, [products, search])

  /**
   * 5. Transfer Action
   * 5.1 Validate all inputs.
   * 5.2 Write transfer row via API.
   */
  const handleTransfer = async () => {
    if (!fromBranch || !toBranch || !selectedProduct || !quantity) return

    if (Number.parseInt(fromBranch, 10) === Number.parseInt(toBranch, 10)) {
      notify(t('transfer_same_branch_error') || 'Source and destination cannot be the same', 'error')
      return
    }

    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      notify(invalidQuantityText, 'error')
      return
    }

    if (qty > Number(selectedProduct.branch_quantity || 0)) {
      const message = (t('transfer_only_available') || 'Only {n} available').replace('{n}', String(selectedProduct.branch_quantity))
      notify(`${message} ${selectedProduct.unit || ''}`.trim(), 'error')
      return
    }

    setSaving(true)
    try {
      const res = await window.api.transferStock({
        fromBranchId: Number.parseInt(fromBranch, 10),
        toBranchId: Number.parseInt(toBranch, 10),
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity: qty,
        note,
        userId: user?.id,
        userName: user?.name,
      })

      if (res?.success) {
        const message = (t('transfer_success') || 'Transferred {n} {unit} of "{name}"')
          .replace('{n}', String(qty))
          .replace('{unit}', selectedProduct.unit || '')
          .replace('{name}', selectedProduct.name || '')
        notify(message)
        onDone()
        return
      }

      notify(res?.error || (t('transfer_failed') || 'Transfer failed'), 'error')
    } catch (error) {
      notify(error?.message || (t('transfer_failed') || 'Transfer failed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="fade-in flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('stock_transfer') || 'Stock Transfer'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            aria-label={t('close') || 'Close'}
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="transfer-from-branch" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('from_branch') || 'From Branch'}
              </label>
              <select id="transfer-from-branch" name="from_branch" className="input" value={fromBranch} onChange={(event) => setFromBranch(event.target.value)}>
                <option value="">{t('select_source') || 'Select source branch'}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="transfer-to-branch" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('to_branch') || 'To Branch'}
              </label>
              <select id="transfer-to-branch" name="to_branch" className="input" value={toBranch} onChange={(event) => setToBranch(event.target.value)}>
                <option value="">{t('select_destination') || 'Select destination branch'}</option>
                {branches
                  .filter((branch) => String(branch.id) !== String(fromBranch))
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {fromBranch ? (
            <div>
              <label htmlFor="transfer-product-search" className="mb-1 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('select_product') || 'Select Product'}
              </label>
              <input
                id="transfer-product-search"
                name="transfer_product_search"
                className="input mb-2"
                placeholder={t('search_products_placeholder') || 'Search products'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="max-h-48 overflow-auto divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-600">
                {loadingProducts ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
                ) : filtered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">{t('no_data') || 'No data'}</p>
                ) : null}

                {filtered.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => {
                      setSelectedProduct(product)
                      setQuantity('')
                    }}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
                      selectedProduct?.id === product.id
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</span>
                      {product.sku ? <span className="ml-2 font-mono text-xs text-gray-400">{product.sku}</span> : null}
                    </div>
                    <span className={`text-sm font-bold ${Number(product.branch_quantity || 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {product.branch_quantity} {product.unit}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {selectedProduct ? (
            <div className="space-y-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-900/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{selectedProduct.name}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t('available') || 'Available'}: <strong>{selectedProduct.branch_quantity} {selectedProduct.unit}</strong>
                </span>
              </div>

              <div>
                <label htmlFor="transfer-quantity" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('quantity') || 'Quantity'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="transfer-quantity"
                    name="transfer_quantity"
                    className="input w-40"
                    type="number"
                    min="0.01"
                    max={selectedProduct.branch_quantity}
                    step="any"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="0"
                    autoFocus
                    aria-invalid={quantity !== '' && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) ? 'true' : 'false'}
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">{selectedProduct.unit}</span>
                  <button
                    className="btn-secondary px-2 py-1.5 text-xs"
                    type="button"
                    onClick={() => setQuantity(String(selectedProduct.branch_quantity))}
                  >
                    {t('all') || 'All'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="transfer-note" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('transfer_note') || 'Transfer note'} ({t('optional') || 'Optional'})
                </label>
                <input
                  id="transfer-note"
                  name="transfer_note"
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('transfer_stock_note_placeholder') || 'e.g. Restocking branch 2'}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-gray-200 p-5 dark:border-gray-700">
          <button
            className="btn-primary flex-1"
            type="button"
            onClick={handleTransfer}
            disabled={saving || loadingProducts || !fromBranch || !toBranch || !selectedProduct || !quantity}
          >
            {saving ? (t('saving') || 'Saving...') : (t('stock_transfer') || 'Transfer')}
          </button>
          <button className="btn-secondary" type="button" onClick={onClose} disabled={saving}>
            {t('cancel') || 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
