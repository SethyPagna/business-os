import { todayStr } from '../../../utils/dateHelpers.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import { getInventoryReasons, saveInventoryReasons } from '../../../api/methods.ts'
// Same saved-reason catalog + "Manage reasons" flow BranchStockAdjuster.tsx
// (product edit page's per-branch adjuster) and Inventory's own "Adjust
// stock" modal already use -- this bulk modal was the one place still
// hardcoding `Bulk ${action} stock` as the reason with no way to pick or
// type a real one. Batch selection is deliberately NOT a per-product
// picker here (see the note above the batch-behavior panel below) -- a
// bulk change can span many different products, each with its own
// distinct batch list at the chosen branch, so a single picker doesn't
// generalize the way it does for BranchStockAdjuster's one-product,
// multi-branch rows. Instead this reuses the wire contract's own
// auto-routing (routes/inventory.ts's /adjust already treats `batchId`
// as optional: omitted on 'add' creates a fresh batch per product,
// omitted on 'remove' FIFO-drains oldest batches first) and makes that
// behavior visible/confirmable instead of leaving it silent.
import InventoryReasonManagerModal from '../../inventory/InventoryReasonManagerModal.tsx'
import SupplierPickerField from '../../shared/SupplierPickerField.tsx'
import ConfirmDialog, { type ConfirmReviewItem } from '../../shared/ConfirmDialog.tsx'
import { dateToBatchCode } from '../../../utils/batchCode.ts'

const BULK_ADD_STOCK_MUTATION_TIMEOUT_MS = 12000

// All received-date defaults use the fixed Cambodia business calendar day.
function todayIsoDate(): string {
  return todayStr()
}

type Translate = (key: string) => string | undefined
type InventoryReasonType = 'adjust' | 'transfer' | 'move' | 'delete'

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type Branch = {
  id: number | string
  name: string
  is_default?: boolean | number | null
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

type StockAction = 'add' | 'remove' | 'set'

type AdjustStockPayload = {
  productId: number | string
  productName: string
  type: StockAction
  quantity: number
  branchId: number | null
  unitCostUsd: number
  unitCostKhr: number
  reason: string
  userId?: number | string
  userName?: string
  receivedDate?: string
  supplierId?: number
  supplierName?: string
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
  // Carried over from the inline "Adjust stock" bulk panel on Products.tsx
  // (bulkEditForm.action/qty) so this modal continues that choice instead
  // of silently discarding it and re-asking for a plain add -- previously
  // this modal always sent type:'add' no matter what the panel's
  // Add/Remove/Set buttons had selected, the exact "two UIs disagreeing
  // with each other" case this pass is fixing.
  initialAction?: StockAction
  initialQuantity?: number | string
}

function getProductApi(): ProductApi {
  return (window as unknown as { api: ProductApi }).api
}

function parseQuantity(value: string, action: StockAction): number | null {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  // 'set' legitimately allows 0 (set stock to zero); add/remove need a
  // positive amount to actually change anything.
  if (action !== 'set' && amount <= 0) return null
  return amount
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

export default function BulkAddStockModal({ productIds, products, branches, user, onClose, onDone, t, initialAction, initialQuantity }: BulkAddStockModalProps) {
  const defaultBranchId = branches.find((branch) => branch.is_default)?.id || branches[0]?.id || ''
  const [branchId, setBranchId] = useState(String(defaultBranchId))
  const [action, setAction] = useState<StockAction>(initialAction || 'add')
  const [qty, setQty] = useState(initialQuantity != null && initialQuantity !== '' ? String(initialQuantity) : '')
  // D4b: the received date IS the lot control in a bulk add -- there is no
  // per-product batch picker here (see the import comment above for why a
  // single picker can't span a mixed selection), but the date drives the
  // server's date->code matching per product exactly as a picker's "New
  // batch" does, so late bulk stock-ins land with their real date.
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  // D5a: one supplier for the whole bulk receive event -- every lot this
  // add creates gets it; a lot that already has a supplier keeps its own
  // (COALESCE fill server-side, first attribution sticks). supplierId only
  // ever comes from picking a contact suggestion; free text stays a
  // deliberate name-only attribution.
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // Part 563: the review dialog is open (handleSave validated + opened it;
  // commitBulk runs the per-product writes on confirm).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<ReasonManagerState>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const saveInFlightRef = useRef(false)
  const selectedProductIds = new Set(productIds.map((id) => String(id)))
  const selectedProducts = products.filter((product) => selectedProductIds.has(String(product.id)))

  useEffect(() => {
    let cancelled = false
    getInventoryReasons()
      .then((result) => {
        if (cancelled) return
        const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: InventoryReason[] }).items : []
        setInventoryReasons(items)
      })
      .catch(() => { if (!cancelled) setInventoryReasons([]) })
    return () => { cancelled = true }
  }, [])
  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])
  // Same saveReasonCatalog/addSavedReason/renameSavedReason/deleteSavedReason
  // pattern as BranchStockAdjuster.tsx / Inventory.tsx -- one shared catalog,
  // edited from wherever a reason picker appears.
  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await saveInventoryReasons(nextItems) as { pending?: boolean; items?: InventoryReason[] } | undefined
      if (result?.pending) {
        setMsg(t('reason_submitted_for_review') || 'Submitted for review -- changes will appear once approved.')
        return inventoryReasons
      }
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons, t])
  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])
  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(t('rename_reason_prompt') || 'Rename saved reason', entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => (item.id === entry.id ? { ...item, label: nextLabel.trim() } : item))
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(t('delete_saved_reason_confirm') || 'Delete this saved reason?')) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const runBulkStockMutation = useCallback((loader: () => Promise<ApiResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, BULK_ADD_STOCK_MUTATION_TIMEOUT_MS)
  ), [])
  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: 'Global (no branch)' },
    ...branches.map((branch) => ({
      value: branch.id,
      label: branch.is_default ? `${branch.name} (default)` : branch.name,
    })),
  ], [branches])
  const actionLabels: Record<StockAction, string> = {
    add: t('add') || 'Add',
    remove: t('remove') || 'Remove',
    set: t('set') || 'Set',
  }

  // Part 563: validate, then open the review dialog. commitBulk runs the
  // actual per-product writes once the operator confirms.
  const handleSave = () => {
    if (saving) return
    if (parseQuantity(qty, action) === null) { setMsg('Enter a valid quantity'); return }
    // Same rule BranchStockAdjuster.tsx/Inventory.tsx already enforce for
    // every other stock-adjustment surface -- routes/inventory.ts's /adjust
    // requires `reason` server-side too, this just fails fast client-side with
    // a clear message instead of a per-product server error.
    if (!reason.trim()) { setMsg(t('adjust_reason_required') || 'A reason is required for this stock adjustment.'); return }
    setMsg(null)
    setConfirmOpen(true)
  }

  const buildBulkReviewItems = (): ConfirmReviewItem[] => {
    // Matches the branch dropdown's own label for the branchless option.
    const branchName = branchId ? (branches.find((b) => String(b.id) === String(branchId))?.name || String(branchId)) : 'Global (no branch)'
    const items: ConfirmReviewItem[] = [
      { label: t('type') || 'Type', value: actionLabels[action] },
      { label: t('products') || 'Products', value: String(selectedProducts.length) },
      { label: t('quantity') || 'Quantity', value: String(qty || 0) },
      { label: t('branch') || 'Branch', value: branchName },
    ]
    const trimmedReason = reason.trim()
    if (trimmedReason) items.push({ label: t('reason') || 'Reason', value: trimmedReason })
    if (action === 'add' && supplierName.trim()) items.push({ label: t('supplier') || 'Supplier', value: supplierName.trim() })
    return items
  }

  const commitBulk = async () => {
    setConfirmOpen(false)
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    const amount = parseQuantity(qty, action)
    if (amount === null) {
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
            type: action,
            quantity: amount,
            branchId: normalizeBranchId(branchId),
            unitCostUsd: product.purchase_price_usd || 0,
            unitCostKhr: product.purchase_price_khr || 0,
            reason: reason.trim(),
            userId: user?.id,
            userName: user?.name,
            // Only an 'add' creates/matches lots -- same visibility-mirror
            // rule as every other adjust surface.
            receivedDate: action === 'add' && receivedDate ? receivedDate : undefined,
            // D5a: adds only, mirroring the field's own visibility below.
            supplierId: action === 'add' && supplierId != null ? supplierId : undefined,
            supplierName: action === 'add' && supplierName.trim() ? supplierName.trim() : undefined,
          }), 'Bulk adjust product stock')
          if (result?.success === false) throw new Error(result?.error || 'Failed to adjust stock')
          done += 1
          updatedIds.push(productId)
        } catch {
          failed += 1
          failedIds.push(productId)
        }
      }
      if (done) onDone({ quantity: amount, branchId, done, failed, updatedIds, failedIds })
      else setMsg('Failed to adjust stock')
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="fade-in w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">
          {t('adjust_stock_for_products') || `${actionLabels[action]} Stock -- ${productIds.length} Products`}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('adjust_stock_bulk_desc') || 'This will apply the same change to each selected product.'}</p>
        <div className="space-y-4">
          {/* Same border-2 / blue-50+blue-700 segmented style as
              InventoryStockModals.tsx, BranchStockAdjuster.tsx, and the
              Products.tsx inline bulk panel that opens this modal --
              continues whatever choice was already made there instead of
              only ever offering "add" here. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('adjust_stock') || 'Adjust stock'}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['add', 'remove', 'set'] as StockAction[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAction(value)}
                  className={`rounded-xl border-2 py-2 text-xs font-medium ${action === value ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                >
                  {actionLabels[value]}
                </button>
              ))}
            </div>
          </div>
          {branches.length > 0 ? (
            <div>
              <label htmlFor="bulk-add-stock-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Branch</label>
              <AppSelect
                id="bulk-add-stock-branch"
                className="w-full"
                buttonClassName="w-full"
                value={branchId}
                options={branchOptions}
                onChange={setBranchId}
                ariaLabel="Branch"
              />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('quantity') || 'Quantity'}</label>
            <input className="input" type="number" min="0" step="any" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="e.g. 10" autoFocus />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[1, 5, 10, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${Number(qty) === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                  onClick={() => setQty(String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          {/* Batch behavior is made visible here rather than offered as a
              per-product picker (see the import comment above for why a
              single picker doesn't generalize across a mixed bulk
              selection) -- this mirrors exactly what routes/inventory.ts's
              /adjust already does server-side when no explicit batchId is
              given. */}
          {action !== 'set' ? (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {action === 'add'
                ? (t('bulk_add_batch_note') || 'Each product gets its own new batch with the received date below.')
                : (t('bulk_remove_batch_note') || 'Stock is drawn from each product\u2019s oldest batch first (FIFO).')}
            </p>
          ) : null}
          {action === 'add' ? (
            <div>
              <label htmlFor="bulk-add-stock-received-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('received_date') || 'Received date'}
              </label>
              <input
                id="bulk-add-stock-received-date"
                className="input text-sm"
                type="date"
                value={receivedDate}
                onChange={(event) => setReceivedDate(event.target.value)}
              />
              <div className="mt-1 text-[11px] text-gray-400">
                {t('batch_code_preview') || 'Batch code'}: {dateToBatchCode(receivedDate) || '--'}
              </div>
              {/* D5a: the same supplier picker every other add surface has.
                  One choice for the whole bulk event; lots that already
                  carry a supplier keep theirs (fill-only server-side). */}
              <div className="mt-3">
                <SupplierPickerField
                  idPrefix="bulk-add-stock"
                  value={{ supplierId, supplierName }}
                  onChange={(next) => { setSupplierId(next.supplierId); setSupplierName(next.supplierName) }}
                  tr={(key, fallbackEn, _fallbackKm) => { const value = t(key); return value && value !== key ? value : (fallbackEn ?? key) }}
                  hint={t('supplier_bulk_hint') || 'Applies to every lot this bulk add creates or fills — lots that already have a supplier keep theirs.'}
                />
              </div>
            </div>
          ) : null}
          <div>
            <label htmlFor="bulk-add-stock-reason" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('reason') || 'Reason'}
            </label>
            {reasonsByType.adjust.length ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {reasonsByType.adjust.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                    onClick={() => setReason(entry.label)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              id="bulk-add-stock-reason"
              className="input text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('reason_placeholder') || 'Choose a saved reason or type your own'}
            />
            <button
              type="button"
              className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => setReasonManager({ open: true, type: 'adjust' })}
            >
              {t('manage_reasons') || 'Manage reasons'}
            </button>
          </div>
          {msg ? <p className="text-sm text-red-600 dark:text-red-400">{msg}</p> : null}
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving ? (t('saving') || 'Saving...') : `${actionLabels[action]} ${qty || 0} ${action === 'set' ? '' : 'to each'}`.trim()}
            </button>
            <button className="btn-secondary" onClick={onClose}>{t('cancel') || 'Cancel'}</button>
          </div>
        </div>
      </div>
      <InventoryReasonManagerModal
        addSavedReason={addSavedReason}
        deleteSavedReason={deleteSavedReason}
        reasonDraft={reasonDraft}
        reasonManager={reasonManager}
        reasonsByType={reasonsByType}
        renameSavedReason={renameSavedReason}
        savingReasons={savingReasons}
        setReasonDraft={setReasonDraft}
        setReasonManager={setReasonManager}
        t={t}
        tr={(key: string, fallbackEn?: string) => t(key) || fallbackEn || key}
      />
      {confirmOpen ? (
        <ConfirmDialog
          t={(key: string) => t(key)}
          title={t('adjust_stock') || 'Adjust stock'}
          message={t('adjust_stock_bulk_desc') || 'This will apply the same change to each selected product.'}
          items={buildBulkReviewItems()}
          confirmLabel={`${actionLabels[action]} ${qty || 0} ${action === 'set' ? '' : 'to each'}`.trim()}
          working={saving}
          workingLabel={t('saving') || 'Saving...'}
          onConfirm={commitBulk}
          onClose={() => { if (!saving) setConfirmOpen(false) }}
        />
      ) : null}
    </div>
  )
}
