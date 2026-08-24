import { useEffect, useState } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { deactivateBatch, getProductBatches, updateBatch, updateBatchBranchQuantity, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'

type InventoryId = number | string
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryProduct = Record<string, any> & {
  id?: InventoryId
  name?: string
  unit?: string
}

type ManageBatchesModalProps = {
  product: InventoryProduct | null
  branchSelectOptions: AppSelectOption[]
  defaultBranchId?: string
  notify: (message: string, type?: string) => void
  onClose: () => void
  onChanged: () => void
  t: Translator
  tr: TranslationWithFallback
}

// Edit/deactivate a batch after it's already been received -- the admin
// surface `routes/batches.ts`'s PATCH/DELETE /api/batches/:id endpoints
// existed for but had nothing calling them (flagged in progress.md).
// Deliberately separate from ReceiveBatchModal (which only ever creates/
// tops up a batch): this is a live-fetched list of a product's EXISTING
// batches for one branch, edited in place. Scoped per branch the same way
// ReceiveBatchModal is, since GET /api/batches requires a branchId (a
// batch can have stock rows across several branches, but there's no
// "all branches at once" listing endpoint) and correcting a branch's own
// batch quantity is a distinct action (PATCH .../branches/:branchId,
// not exposed here -- this modal only edits the batch's own fields and
// deactivates, matching what was actually asked for).
export default function ManageBatchesModal({
  product,
  branchSelectOptions,
  defaultBranchId,
  notify,
  onClose,
  onChanged,
  t,
  tr,
}: ManageBatchesModalProps) {
  const [branchId, setBranchId] = useState(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
  const [batches, setBatches] = useState<ProductBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [editingId, setEditingId] = useState<InventoryId | null>(null)
  const [draft, setDraft] = useState<{ expiryDate: string; receivedAt: string; notes: string; quantity: string }>({ expiryDate: '', receivedAt: '', notes: '', quantity: '' })
  const [savingId, setSavingId] = useState<InventoryId | null>(null)

  const productId = product ? Number(product.id) : null

  const load = async () => {
    if (!productId || !branchId) return
    setLoading(true)
    setLoadError('')
    try {
      const res = await getProductBatches(productId, branchId)
      setBatches(Array.isArray(res?.batches) ? res.batches : [])
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : tr('load_failed', 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }

  // Reset scope + reload whenever a different product is opened, or the
  // branch selection changes.
  useEffect(() => {
    setBranchId(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
    setEditingId(null)
  }, [product?.id])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, branchId])

  if (!product) return null

  const closeIfIdle = () => {
    if (!savingId) onClose()
  }

  const startEdit = (batch: ProductBatch) => {
    setEditingId(batch.id)
    setDraft({ expiryDate: batch.expiry_date || '', receivedAt: (batch.received_at || '').slice(0, 10), notes: batch.notes || '', quantity: String(batch.quantity ?? 0) })
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (batch: ProductBatch) => {
    setSavingId(batch.id)
    try {
      const res = await updateBatch(batch.id, {
        expiryDate: draft.expiryDate || null,
        receivedAt: draft.receivedAt || null,
        notes: draft.notes.trim() || null,
      })
      if (res?.success === false) {
        notify((res as any)?.error || tr('update_failed', 'Update failed'), 'error')
        return
      }

      // Quantity is a separate scoped correction (PATCH .../branches/:id,
      // a stock-take SET for this batch at this branch only) rather than
      // part of the lot/expiry/notes PATCH above -- it moves
      // branch_stock/products.stock_quantity too, so it's only sent when
      // the field actually changed. This is what lets a stock change be
      // applied to one specific batch instead of the product overall.
      const nextQuantity = Number(draft.quantity)
      if (Number.isFinite(nextQuantity) && nextQuantity >= 0 && nextQuantity !== Number(batch.quantity)) {
        const qtyRes = await updateBatchBranchQuantity(batch.id, branchId, nextQuantity)
        if ((qtyRes as any)?.success === false) {
          notify((qtyRes as any)?.error || tr('update_failed', 'Update failed'), 'error')
          return
        }
      }

      notify(tr('batch_updated', 'Batch updated'))
      setEditingId(null)
      await load()
      onChanged()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('update_failed', 'Update failed'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  const deactivate = async (batch: ProductBatch) => {
    setSavingId(batch.id)
    try {
      const res = await deactivateBatch(batch.id)
      if (res?.success === false) {
        notify((res as any)?.error || tr('deactivate_failed', 'Failed to deactivate'), 'error')
        return
      }
      notify(tr('batch_deactivated', 'Batch deactivated'))
      if (editingId === batch.id) setEditingId(null)
      await load()
      onChanged()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('deactivate_failed', 'Failed to deactivate'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('manage_batches', 'Manage Batches')}</h2>
            <div className="mt-0.5 truncate text-xs text-gray-400">{product.name}</div>
          </div>
          <button type="button" onClick={closeIfIdle} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" disabled={!!savingId}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-gray-200 p-4 dark:border-gray-700">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
            <AppSelect
              value={branchId}
              onChange={setBranchId}
              ariaLabel={t('branch') || 'Branch'}
              className="w-full"
              buttonClassName="h-10 w-full text-sm"
              menuClassName="min-w-[13rem]"
              optionClassName="text-sm"
              options={branchSelectOptions}
            />
          </label>
        </div>

        <div className="modal-scroll space-y-2 p-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{loadError}</div>
          ) : batches.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">{tr('no_batches_for_branch', 'No batches for this branch')}</div>
          ) : batches.map((batch) => {
            const isEditing = editingId === batch.id
            const isSaving = savingId === batch.id
            return (
              <div key={batch.id} className={`rounded-xl border px-3 py-2.5 ${batch.is_active ? 'border-amber-100 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20' : 'border-gray-200 bg-gray-50 opacity-60 dark:border-gray-700 dark:bg-gray-900/40'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('batch_date', 'Batch date')}</span>
                        <input
                          className="input w-full text-sm"
                          type="date"
                          value={draft.receivedAt}
                          onChange={(event) => setDraft((prev) => ({ ...prev, receivedAt: event.target.value }))}
                        />
                        {/* Preview only -- the backend always recomputes
                            and stores the authoritative code itself from
                            whichever date is actually submitted (see
                            batchCode.ts's dateToBatchCode). There is no
                            more separately-editable lot code; correcting
                            this date IS how the batch's code is
                            corrected. */}
                        <span className="mt-1 block text-[11px] text-gray-400">
                          {tr('batch_code_preview', 'Batch code')}: {dateToBatchCode(draft.receivedAt) || '--'}
                        </span>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_date', 'Expiry date')}</span>
                        <input
                          className="input w-full text-sm"
                          type="date"
                          value={draft.expiryDate}
                          onChange={(event) => setDraft((prev) => ({ ...prev, expiryDate: event.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                        {tr('batch_quantity_at_branch', 'Quantity at this branch')}
                      </span>
                      <input
                        className="input w-full text-sm"
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={draft.quantity}
                        onChange={(event) => setDraft((prev) => ({ ...prev, quantity: event.target.value }))}
                      />
                      <span className="mt-1 block text-[11px] text-gray-400">
                        {tr('batch_quantity_scoped_hint', 'A stock-take correction for this batch/lot only -- other batches of this product are not affected.')}
                      </span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('notes') || 'Notes'}</span>
                      <textarea
                        className="input min-h-[60px] w-full text-sm"
                        value={draft.notes}
                        onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={cancelEdit} disabled={isSaving}>
                        {t('cancel') || 'Cancel'}
                      </button>
                      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => saveEdit(batch)} disabled={isSaving}>
                        {isSaving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-amber-700 dark:text-amber-200">{batchDisplayLabel(batch, tr('batch', 'Batch'))}</div>
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">{batch.expiry_date || tr('no_expiry', 'No expiry')}</div>
                        {batch.notes ? <div className="mt-1 text-xs text-gray-400">{batch.notes}</div> : null}
                        {!batch.is_active ? <div className="mt-1 text-[11px] font-medium text-gray-400">{tr('deactivated', 'Deactivated')}</div> : null}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{batch.quantity} {product.unit}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30" onClick={() => startEdit(batch)} disabled={isSaving}>
                        {t('edit') || 'Edit'}
                      </button>
                      {batch.is_active ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
                          onClick={() => deactivate(batch)}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3 w-3" />
                          {isSaving ? (t('saving') || 'Saving...') : tr('deactivate', 'Deactivate')}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary text-sm" onClick={closeIfIdle} disabled={!!savingId}>
            {t('close') || 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
