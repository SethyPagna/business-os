import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  beginTrackedRequest,
  getLoaderErrorMessage,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import ContactPicker from '../contacts/ContactPicker.tsx'
import { useReturnReasonPresets } from './helpers/useReturnReasonPresets.ts'
import { normalizeBarcodeKey, searchTermBarcodeKey, sortBySearchRelevance } from '../../utils/searchMatch.ts'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'

const SUPPLIER_RETURN_SETUP_TIMEOUT_MS = 12000
const SUPPLIER_RETURN_SETUP_WATCHDOG_MS = SUPPLIER_RETURN_SETUP_TIMEOUT_MS + 1500
const SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS = 12000
const SUPPLIER_RETURN_CREATE_TIMEOUT_MS = 15000

type NoticeKind = 'success' | 'error' | 'info' | 'warning' | string
type MoneyFormatter = (value: number | string) => string
type SettlementMethod = 'refund' | 'credit' | 'replacement' | 'writeoff'

const SUPPLIER_RETURN_SETTLEMENT_VALUES: SettlementMethod[] = ['refund', 'credit', 'replacement', 'writeoff']

interface AppUser {
  id?: number | string
  name?: string | null
  username?: string | null
}

interface BranchRow {
  id: number | string
  name?: string
  is_active?: boolean
  is_default?: boolean
}

interface SupplierRow {
  id: number | string
  name?: string
  phone?: string | null
}

interface InventoryProductRow {
  id: number | string
  name?: string
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  display_quantity?: number | string
  purchase_price_usd?: number | string
  cost_price_usd?: number | string
  purchase_price_khr?: number | string
  cost_price_khr?: number | string
}

interface SupplierReturnItem {
  product_id: number | string
  product_name: string | null
  quantity: number
  cost_price_usd: number
  cost_price_khr: number
}

interface SupplierReturnPayload extends Record<string, unknown> {
  cashier_id: number | string | null
  cashier_name: string | null
  branch_id: number
  supplier_id: number
  supplier_name: string | null
  reason: string
  notes: string | null
  settlement: SettlementMethod
  supplier_compensation_usd: number
  supplier_compensation_khr: number
  items: SupplierReturnItem[]
}

interface NewSupplierReturnModalProps {
  onClose: () => void
  onSuccess?: (result: unknown) => void | Promise<void>
  notify: (message: string, kind?: NoticeKind) => void
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
}

function isSupplierReturnItem(item: SupplierReturnItem | null): item is SupplierReturnItem {
  return item != null
}

const useApp = useAppHook as () => {
  user?: AppUser | null
  t?: (key: string) => string
}

type BranchTransportModule = typeof import('../../api/branchTransport.ts')
type ContactReadTransportModule = typeof import('../../api/contactReadTransport.ts')
type InventoryTransportModule = typeof import('../../api/inventoryTransport.ts')
type ReturnsTransportModule = typeof import('../../api/returnsTransport.ts')

let branchTransportPromise: Promise<BranchTransportModule> | null = null
let contactReadTransportPromise: Promise<ContactReadTransportModule> | null = null
let inventoryTransportPromise: Promise<InventoryTransportModule> | null = null
let returnsTransportPromise: Promise<ReturnsTransportModule> | null = null

function loadBranchTransport(): Promise<BranchTransportModule> {
  if (!branchTransportPromise) branchTransportPromise = import('../../api/branchTransport.ts')
  return branchTransportPromise
}

function loadContactReadTransport(): Promise<ContactReadTransportModule> {
  if (!contactReadTransportPromise) contactReadTransportPromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportPromise
}

function loadInventoryTransport(): Promise<InventoryTransportModule> {
  if (!inventoryTransportPromise) inventoryTransportPromise = import('../../api/inventoryTransport.ts')
  return inventoryTransportPromise
}

function loadReturnsTransport(): Promise<ReturnsTransportModule> {
  if (!returnsTransportPromise) returnsTransportPromise = import('../../api/returnsTransport.ts')
  return returnsTransportPromise
}

async function loadSupplierReturnSetup(): Promise<[BranchRow[], SupplierRow[]]> {
  const [branchModule, contactReadModule] = await Promise.all([
    loadBranchTransport(),
    loadContactReadTransport(),
  ])
  const [branchRows, supplierRows] = await Promise.all([
    branchModule.getBranches(),
    // fields=names: picking WHO the return goes to only needs the name
    // (and id), and this is the suppliers read every role may call --
    // the full contact list needs contacts_suppliers (Part 383 R2).
    contactReadModule.getSuppliers({ fields: 'names' }),
  ])
  return [
    (branchRows || []) as BranchRow[],
    (supplierRows || []) as SupplierRow[],
  ]
}

async function loadSupplierReturnInventory(branchId: string): Promise<InventoryProductRow[]> {
  const { getInventorySummary } = await loadInventoryTransport()
  const rows = await getInventorySummary({ branchId: Number(branchId) })
  return (rows || []) as InventoryProductRow[]
}

async function createSupplierReturnRequest(payload: SupplierReturnPayload): Promise<unknown> {
  const { createSupplierReturn } = await loadReturnsTransport()
  return createSupplierReturn(payload)
}

export default function NewSupplierReturnModal({ onClose, onSuccess, notify, fmtUSD, fmtKHR }: NewSupplierReturnModalProps) {
  const { user, t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const returnReasonPresets = useReturnReasonPresets(t)

  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [products, setProducts] = useState<InventoryProductRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [settlement, setSettlement] = useState<SettlementMethod>('refund')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [compensationUsd, setCompensationUsd] = useState('')
  const [compensationKhr, setCompensationKhr] = useState('')
  const bootstrapRequestRef = useRef(0)
  const inventoryRequestRef = useRef(0)
  const productsBranchRef = useRef('')
  const aliveRef = useRef(true)
  const submitInFlightRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      invalidateTrackedRequest(bootstrapRequestRef)
      invalidateTrackedRequest(inventoryRequestRef)
    }
  }, [])

  useEffect(() => {
    const requestId = beginTrackedRequest(bootstrapRequestRef)
    let setupWatchdogFired = false
    setLoading(true)
    const setupWatchdog = window.setTimeout(() => {
      if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
      setupWatchdogFired = true
      notify(
        tr('supplier_return_setup_slow', 'Supplier return setup is taking too long. You can retry or close and reopen the form.'),
        'warning',
      )
      setLoading(false)
    }, SUPPLIER_RETURN_SETUP_WATCHDOG_MS)
    const clearSetupWatchdog = () => {
      window.clearTimeout(setupWatchdog)
    }
    async function loadSetup() {
      try {
        const [branchRows, supplierRows] = await withLoaderTimeout(
          () => loadSupplierReturnSetup(),
          'Supplier return setup',
          SUPPLIER_RETURN_SETUP_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        const activeBranches = ((branchRows || []) as BranchRow[]).filter((branch) => branch.is_active)
        setBranches(activeBranches)
        setSuppliers((supplierRows || []) as SupplierRow[])
        setBranchId((current) => {
          if (current && activeBranches.some((branch) => String(branch.id) === String(current))) return current
          const defaultBranchId = activeBranches.find((branch) => branch.is_default)?.id || activeBranches[0]?.id || ''
          return defaultBranchId ? String(defaultBranchId) : ''
        })
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        notify(
          getLoaderErrorMessage(
            error,
            setupWatchdogFired
              ? tr('supplier_return_setup_slow', 'Supplier return setup is taking too long. You can retry or close and reopen the form.')
              : tr('failed_to_load_data', 'Failed to load data'),
          ),
          setupWatchdogFired ? 'warning' : 'error',
        )
      } finally {
        clearSetupWatchdog()
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        setLoading(false)
      }
    }
    loadSetup()
    return () => {
      clearSetupWatchdog()
      invalidateTrackedRequest(bootstrapRequestRef)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!branchId) {
      invalidateTrackedRequest(inventoryRequestRef)
      productsBranchRef.current = ''
      setLoadingProducts(false)
      setProducts([])
      return undefined
    }
    const requestId = beginTrackedRequest(inventoryRequestRef)
    if (productsBranchRef.current !== String(branchId)) {
      setProducts([])
      setQuantities({})
    }
    setLoadingProducts(true)
    async function loadInventory() {
      try {
        const rows = await withLoaderTimeout(
          () => loadSupplierReturnInventory(branchId),
          'Supplier return inventory',
          SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        const next = ((rows || []) as InventoryProductRow[]).filter((product) => Number(product.display_quantity || 0) > 0)
        productsBranchRef.current = String(branchId)
        setProducts(next)
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        notify(getLoaderErrorMessage(error, tr('failed_to_load_data', 'Failed to load data')), 'error')
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        setLoadingProducts(false)
      }
    }
    loadInventory()
    return () => {
      invalidateTrackedRequest(inventoryRequestRef)
    }
  }, [branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // This picker reads the whole branch inventory in one unpaged, unsearched
  // call (loadSupplierReturnInventory -> GET /api/inventory/summary, which
  // takes no search parameter and answers ORDER BY lower(p.name) ASC), so
  // nothing upstream ever ranked these rows: the operator got the catalogue
  // in alphabetical order with the non-matches removed, which is the
  // reported "not really matched, top to bottom" on the Returns side.
  //
  // Two things were also out of SCOPE rather than merely mis-ordered:
  // barcode was missing from the haystack entirely, so a scan into this box
  // matched nothing at all, and the plain substring test could not see
  // through this catalogue's GTIN-14/EAN-13 leading-zero twins. The
  // barcode-key probe below is the same fold the server applies
  // (normalizeBarcodeKey), and the sort is the shared client mirror of the
  // server ordering contract (utils/searchMatch.ts). A scan still only
  // narrows the list -- the operator picks the row.
  const filteredProducts = useMemo(() => {
    const raw = search.trim()
    const term = raw.toLowerCase()
    if (!term) return products
    const barcodeKey = searchTermBarcodeKey(raw)
    const matches = products.filter((product) => {
      if (barcodeKey && normalizeBarcodeKey(product.barcode) === barcodeKey) return true
      const hay = `${product.name || ''} ${product.sku || ''} ${product.barcode || ''} ${product.category || ''} ${product.brand || ''}`.toLowerCase()
      return hay.includes(term)
    })
    return sortBySearchRelevance(matches, raw)
  }, [products, search])

  const selectedItems = useMemo<SupplierReturnItem[]>(() => {
    return products
      .map((product) => {
        const rawQty = quantities[String(product.id)]
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
      .filter(isSupplierReturnItem)
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
  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: tr('select_branch', 'Select branch') },
    ...branches.map((item) => ({ value: item.id, label: item.name || String(item.id) })),
  ], [branches, t])
  const settlementOptions = useMemo<AppSelectOption[]>(() => SUPPLIER_RETURN_SETTLEMENT_VALUES.map((value) => ({
    value,
    label: {
      refund: tr('settlement_refund', 'Refund'),
      credit: tr('settlement_credit', 'Store credit'),
      replacement: tr('settlement_replacement', 'Replacement'),
      writeoff: tr('settlement_writeoff', 'No compensation'),
    }[value],
  })), [t])

  const updateQty = (productId: number | string, nextValue: string, max: number) => {
    const parsed = Number(nextValue || 0)
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, max)) : 0
    setQuantities((prev) => ({ ...prev, [String(productId)]: normalized }))
  }

  const submit = async () => {
    if (!branchId) return notify(tr('branch_required', 'Branch is required'), 'error')
    if (!supplierId) return notify(tr('supplier_required', 'Supplier is required'), 'error')
    if (!reason.trim()) return notify(tr('return_reason_required', 'Reason is required'), 'error')
    if (!selectedItems.length) return notify(tr('select_items_to_return', 'Select at least one item to return.'), 'error')

    if (!beginSingleAction(submitInFlightRef)) return
    setSubmitting(true)
    try {
      const result = await withLoaderTimeout(
        () => createSupplierReturnRequest({
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
        }),
        'Create supplier return',
        SUPPLIER_RETURN_CREATE_TIMEOUT_MS,
      )
      notify(tr('supplier_return_success', 'Supplier return processed successfully'), 'success')
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      await Promise.resolve(onSuccess?.(result))
      onClose?.()
    } catch (error) {
      notify(getLoaderErrorMessage(error, tr('error', 'Error')), 'error')
    } finally {
      finishSingleAction(submitInFlightRef)
      setSubmitting(false)
    }
  }

  // Backdrop/X close should not fire while a submit is in flight -- the
  // Cancel button below already guards on `submitting` for this reason,
  // same pattern ReceiveBatchModal.tsx/ManageBatchesModal.tsx/
  // InventoryBatchModal.tsx use, but backdrop/X bypassed it entirely.
  // S4-21: the losable work is the picked supplier/branch plus every
  // quantity typed against a product row. Branch alone is pre-filled noise,
  // so it does not count on its own.
  const supplierReturnDirty = Boolean(supplierId)
    || reason.trim().length > 0
    || notes.trim().length > 0
    || compensationUsd.trim().length > 0
    || compensationKhr.trim().length > 0
    || Object.values(quantities).some((value) => Number(value) > 0)
  const closeGuard = useCloseGuard({ dirty: supplierReturnDirty }, () => { onClose?.() })

  // The backdrop, the ✕ and Cancel all land here.
  const closeIfIdle = () => {
    if (!submitting) closeGuard.requestClose()
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-4xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{tr('return_to_supplier', 'Return to Supplier')}</h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{tr('supplier_return_hint', 'Send stock back to supplier and record compensation/loss.')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={closeIfIdle} disabled={submitting} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{tr('loading', 'Loading')}...</div>
        ) : (
          <div className="modal-scroll space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="supplier-return-branch" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('branch', 'Branch')}</label>
                <AppSelect
                  id="supplier-return-branch"
                  className="w-full"
                  buttonClassName="w-full text-sm"
                  value={branchId}
                  options={branchOptions}
                  onChange={setBranchId}
                  ariaLabel={tr('branch', 'Branch')}
                />
              </div>
              <div>
                <label htmlFor="supplier-return-supplier" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('supplier', 'Supplier')}</label>
                <ContactPicker
                  id="supplier-return-supplier"
                  className="w-full"
                  contacts={suppliers}
                  value={supplierId}
                  onChange={setSupplierId}
                  placeholder={tr('select_supplier', 'Select supplier')}
                  ariaLabel={tr('supplier', 'Supplier')}
                />
              </div>
              <div>
                <label htmlFor="supplier-return-settlement" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('settlement_method', 'Settlement')}</label>
                <AppSelect
                  id="supplier-return-settlement"
                  className="w-full"
                  buttonClassName="w-full text-sm"
                  value={settlement}
                  options={settlementOptions}
                  onChange={(nextValue) => {
                    if (SUPPLIER_RETURN_SETTLEMENT_VALUES.includes(nextValue as SettlementMethod)) {
                      setSettlement(nextValue as SettlementMethod)
                    }
                  }}
                  ariaLabel={tr('settlement_method', 'Settlement')}
                />
              </div>
              <div>
                <label htmlFor="supplier-return-reason" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{tr('reason', 'Reason')}</label>
                <input id="supplier-return-reason" list="supplier-return-reason-presets" className="input text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={tr('return_reason_placeholder', 'Choose a saved reason or type your own')} />
                <datalist id="supplier-return-reason-presets">
                  {returnReasonPresets.supplier.map((savedReason) => <option key={savedReason.toLocaleLowerCase()} value={savedReason} />)}
                </datalist>
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
                <div className="ml-auto flex min-w-0 w-full items-center gap-1.5 sm:w-auto sm:max-w-sm sm:flex-1">
                  <input
                    className="input min-w-0 flex-1 text-sm"
                    placeholder={tr('search_products_placeholder', 'Search products by name, SKU, category')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <ScanSearchButton onDetected={setSearch} t={(key) => tr(key, key)} />
                </div>
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
                      const qty = Number(quantities[String(product.id)] || 0)
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
          <button className="btn-secondary flex-1" onClick={closeIfIdle} disabled={submitting}>{tr('cancel', 'Cancel')}</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading || loadingProducts || submitting}>
            {submitting ? `${tr('saving_label', 'Saving')}...` : tr('save', 'Save')}
          </button>
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>,
    document.body,
  )
}
