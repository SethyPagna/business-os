import { useCallback, useRef, useState } from 'react'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'

const BULK_ADD_STOCK_MUTATION_TIMEOUT_MS = 12000

type Translate = (key: string) => string | undefined

type Branch = {
  id: number | string
  name: string
  is_default?: boolean
}

type Product = {
  id: number | string
  name: string
  purchase_price_usd?: number
  purchase_price_khr?: number
}

type User = {
  id?: number | string
  name?: string
} | null | undefined

type AdjustStockPayload = {
  productId: number | string
  productName: string
  type: 'add'
  quantity: number
  branchId: number | null
  unitCostUsd: number
  unitCostKhr: number
  reason: string
  userId?: number | string
  userName?: string
}

type ApiResult = {
  success?: boolean
  error?: string
}

type ProductApi = {
  adjustStock: (payload: AdjustStockPayload) => Promise<ApiResult | undefined>
}

type BulkAddStockResult = {
  quantity: number
  branchId: string
  done: number
  failed: number
  updatedIds: number[]
  failedIds: number[]
}

type BulkAddStockModalProps = {
  productIds: Array<number | string>
  products: Product[]
  branches: Branch[]
  user?: User
  onClose: () => void
  onDone: (result: BulkAddStockResult) => void
  t: Translate
}

function getProductApi(): ProductApi {
  return (window as unknown as { api: ProductApi }).api
}

function parsePositiveQuantity(value: string): number | null {
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function normalizeBranchId(value: string): number | null {
  if (!value) return null
  const branchId = Number.parseInt(value, 10)
  return Number.isFinite(branchId) ? branchId : null
}

function normalizeProductId(value: number | string): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

export default function BulkAddStockModal({ productIds, products, branches, user, onClose, onDone, t }: BulkAddStockModalProps) {
  const defaultBranchId = branches.find((branch) => branch.is_default)?.id || branches[0]?.id || ''
  const [branchId, setBranchId] = useState(String(defaultBranchId))
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const saveInFlightRef = useRef(false)
  const selectedProductIds = new Set(productIds.map((id) => String(id)))
  const selectedProducts = products.filter((product) => selectedProductIds.has(String(product.id)))
  const runBulkStockMutation = useCallback((loader: () => Promise<ApiResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, BULK_ADD_STOCK_MUTATION_TIMEOUT_MS)
  ), [])

  const handleSave = async () => {
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    const amount = parsePositiveQuantity(qty)
    if (!amount) {
      finishSingleAction(saveInFlightRef)
      setMsg('Enter a valid quantity')
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      let done = 0
      let failed = 0
      const updatedIds: number[] = []
      const failedIds: number[] = []
      for (const product of selectedProducts) {
        const productId = normalizeProductId(product.id)
        try {
          const result = await runBulkStockMutation(() => getProductApi().adjustStock({
            productId: product.id,
            productName: product.name,
            type: 'add',
            quantity: amount,
            branchId: normalizeBranchId(branchId),
            unitCostUsd: product.purchase_price_usd || 0,
            unitCostKhr: product.purchase_price_khr || 0,
            reason: 'Bulk add stock',
            userId: user?.id,
            userName: user?.name,
          }), 'Bulk add product stock')
          if (result?.success === false) throw new Error(result?.error || 'Failed to add stock')
          done += 1
          updatedIds.push(productId)
        } catch {
          failed += 1
          failedIds.push(productId)
        }
      }
      if (done) onDone({ quantity: amount, branchId, done, failed, updatedIds, failedIds })
      else setMsg('Failed to add stock')
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="fade-in w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">
          {t('add_stock_to_products') || `Add Stock to ${productIds.length} Products`}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('add_stock_desc') || 'This will add the same quantity to each selected product.'}</p>
        <div className="space-y-4">
          {branches.length > 0 ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Branch</label>
              <select className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">Global (no branch)</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quantity_to_add') || 'Quantity to Add'}</label>
            <input className="input" type="number" min="1" step="any" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="e.g. 10" autoFocus />
          </div>
          {msg ? <p className="text-sm text-red-600 dark:text-red-400">{msg}</p> : null}
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving ? (t('adding') || 'Adding...') : `+ ${t('add_to_each') || `Add ${qty || 0} to each`}`}
            </button>
            <button className="btn-secondary" onClick={onClose}>{t('cancel') || 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
