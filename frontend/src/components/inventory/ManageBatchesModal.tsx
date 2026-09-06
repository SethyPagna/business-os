import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtDateOnly } from '../../utils/formatters'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import SectionCard from '../shared/SectionCard'
import { deactivateBatch, getProductBatches, updateBatch, updateBatchBranchQuantity, type ProductBatch } from '../../api/batchesTransport.ts'
import { getInventoryMovements } from '../../api/inventoryTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import { buildHistoryRowModel } from '../../utils/historyRowModel.ts'

type DayMovement = {
  id?: number | string
  movement_type?: string
  quantity?: number
  reason?: string | null
  branch_name?: string | null
  user_name?: string | null
  created_at?: string | null
}

// Everyday use shows the batch DATE only; the day view is where the TIMES
// live (user, Aug 28): selecting a batch's received date drills into that
// day's movements with the clock time of each add — a historical import's
// movements carry only the date, shown honestly as date-only.
function movementTime(createdAt: string | null | undefined): string | null {
  const value = String(createdAt || '')
  const match = value.match(/[T ](\d{2}:\d{2})/)
  if (!match) return null
  // A midnight timestamp on an imported historical movement is the date
  // standing in for an unknown time, not a real 00:00 receipt.
  return match[1] === '00:00' ? null : match[1]
}

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
  // Synchronous double-submit guard for the batch edit save. State (savingId)
  // updates asynchronously, so two fast clicks can both pass a state check
  // before it settles; the ref flips synchronously. (Restores the guard that
  // moved out of Inventory.tsx when Part 562 relocated batch management here.)
  const saveBatchInFlightRef = useRef(false)
  // Drill level: null = the batch list; a yyyy-mm-dd date = that day's
  // movement detail (with times). Back always returns to the list.
  const [dayDetail, setDayDetail] = useState<string | null>(null)
  const [dayMovements, setDayMovements] = useState<DayMovement[]>([])
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState('')

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
    setDayDetail(null)
  }, [product?.id])

  useEffect(() => {
    if (!dayDetail || !productId) return
    let alive = true
    setDayLoading(true)
    setDayError('')
    Promise.resolve(getInventoryMovements({ productId, branchId, startDate: dayDetail, endDate: dayDetail, page: 1, pageSize: 200 }))
      .then((res: unknown) => {
        const items = (res as { items?: DayMovement[] } | null)?.items
        if (alive) setDayMovements(Array.isArray(items) ? items : [])
      })
      .catch((e: unknown) => { if (alive) setDayError(e instanceof Error ? e.message : tr('load_failed', 'Failed to load')) })
      .finally(() => { if (alive) setDayLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayDetail, productId, branchId])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, branchId])

  // S4-21: row edits here auto-save per row, so the ONLY unsaved thing is a
  // row currently open in edit mode with a draft in it. Nothing else in
  // this modal is authored -- the branch picker and the day drill-down are
  // navigation.
  const closeGuard = useCloseGuard({ dirty: editingId !== null }, onClose)

  if (!product) return null

  // The backdrop and the ✕ both land here.
  const closeIfIdle = () => {
    if (!savingId) closeGuard.requestClose()
  }

  const startEdit = (batch: ProductBatch) => {
    setEditingId(batch.id)
    setDraft({ expiryDate: batch.expiry_date || '', receivedAt: (batch.received_at || '').slice(0, 10), notes: batch.notes || '', quantity: String(batch.quantity ?? 0) })
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (batch: ProductBatch) => {
    const nextQuantity = Number(draft.quantity)
    const quantityChange = Number.isFinite(nextQuantity) && nextQuantity >= 0 && nextQuantity !== Number(batch.quantity)
    const batchLabel = batchDisplayLabel({ id: batch.id, lot_code: batch.lot_code ?? null, received_at: batch.received_at ?? null, batch_number: batch.batch_number ?? null }, t('batch') || 'Batch')
    const quantityNote = quantityChange
      ? ` ${tr('batch_quantity_change_note', 'Quantity will change from {from} to {to} at this branch.')
          .replace('{from}', String(batch.quantity))
          .replace('{to}', String(nextQuantity))}`
      : ''
    if (!window.confirm(tr(
      'confirm_update_batch_details',
      'Update {batch} for {product}?{note}',
    )
      .replace('{batch}', batchLabel)
      .replace('{product}', product.name || 'this product')
      .replace('{note}', quantityNote))) return
    if (!beginSingleAction(saveBatchInFlightRef, { blocked: savingId != null })) return
    setSavingId(batch.id)
    try {
      const res = await updateBatch(batch.id, {
        expiryDate: draft.expiryDate || null,
        receivedAt: draft.receivedAt || null,
        notes: draft.notes.trim() || null,
        expectedUpdatedAt: batch.updated_at ?? null,
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
      finishSingleAction(saveBatchInFlightRef)
      setSavingId(null)
    }
  }

  const deactivate = async (batch: ProductBatch) => {
    const batchLabel = batchDisplayLabel({ id: batch.id, lot_code: batch.lot_code ?? null, received_at: batch.received_at ?? null, batch_number: batch.batch_number ?? null }, t('batch') || 'Batch')
    if (!window.confirm(tr(
      'confirm_deactivate_batch_details',
      'Deactivate {batch} for {product}? It will no longer be available for new stock operations.',
    )
      .replace('{batch}', batchLabel)
      .replace('{product}', product?.name || 'this product'))) return
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

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
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
          {dayDetail ? (
            <SectionCard
              kind="stock"
              collapsible={false}
              onBack={() => setDayDetail(null)}
              backLabel={tr('back', 'Back', 'ថយក្រោយ')}
              title={`${tr('movements_on_day', 'Movements on', 'ចលនាស្តុកនៅ')} ${fmtDateOnly(dayDetail)}`}
              subtitle={tr('day_detail_time_hint', 'Times shown where recorded — imported history carries the date only.', 'បង្ហាញម៉ោងដែលបានកត់ត្រា — ប្រវត្តិនាំចូលមានតែកាលបរិច្ឆេទប៉ុណ្ណោះ។')}
            >
              <div className="space-y-1.5 p-3">
                {dayLoading ? (
                  <div className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
                ) : dayError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{dayError}</div>
                ) : dayMovements.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400">{tr('no_movements_that_day', 'No recorded movements on this day for this branch.', 'គ្មានចលនាស្តុកដែលបានកត់ត្រានៅថ្ងៃនេះសម្រាប់សាខានេះទេ។')}</div>
                ) : dayMovements.map((movement, index) => {
                  const type = String(movement.movement_type || '').toLowerCase()
                  const label = type === 'add' ? tr('stock_in', 'Stock in', 'ស្តុកចូល')
                    : type === 'sale' ? tr('sale', 'Sale', 'ការលក់')
                    : type === 'remove' || type === 'out' ? tr('stock_out', 'Stock out', 'ស្តុកចេញ')
                    : type.startsWith('adjust') ? tr('adjustment', 'Adjustment', 'ការកែតម្រូវ')
                    : movement.movement_type || '—'
                  const inbound = type === 'add'
                  const time = movementTime(movement.created_at)
                  const model = buildHistoryRowModel(movement)
                  return (
                    <div key={movement.id ?? index} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs dark:border-gray-700">
                      <span className="w-12 flex-shrink-0 font-mono text-gray-500 dark:text-gray-400">
                        {time || tr('date_only', 'date', 'កាលបរិច្ឆេទ')}
                      </span>
                      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 font-medium ${inbound ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'}`}>
                        {label}
                      </span>
                      <span className="flex-shrink-0 font-semibold text-gray-900 dark:text-white">
                        {inbound ? '+' : '-'}{Math.abs(Number(movement.quantity) || 0)}
                      </span>
                      {/* N13: this printed `reason || branch_name`, so one cell
                          silently meant two different things and you could not
                          tell which. Same three facts, same order, same shared
                          placeholder as every other history surface. */}
                      <span className="min-w-0 flex-1 truncate text-gray-400" title={`${model.reason} · ${model.branch} · ${model.actor}`}>
                        {`${model.reason} · ${model.branch} · ${model.actor}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          ) : loading ? (
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
                        {/* Typed, not a native picker (Sep 3) -- this date
                            IS the lot code, and staff key it as digits. */}
                        <DateEntryInput
                          className="w-full text-sm"
                          t={t}
                          ariaLabel={tr('batch_date', 'Batch date')}
                          value={draft.receivedAt}
                          onChange={(iso) => setDraft((prev) => ({ ...prev, receivedAt: iso }))}
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
                        <DateEntryInput
                          className="w-full text-sm"
                          t={t}
                          ariaLabel={tr('expiry_date', 'Expiry date')}
                          value={draft.expiryDate}
                          onChange={(iso) => setDraft((prev) => ({ ...prev, expiryDate: iso }))}
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
                    <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-amber-100 bg-amber-50/95 px-1 pt-2 backdrop-blur-sm dark:border-amber-900/50 dark:bg-amber-950/95">
                      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={cancelEdit} disabled={isSaving}>
                        {t('cancel') || 'Cancel'}
                      </button>
                      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => saveEdit(batch)} disabled={isSaving}>
                        {isSaving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-amber-700 dark:text-amber-200">{batchDisplayLabel(batch, tr('batch', 'Batch'))}</div>
                      {/* Compact product-card-style meta: received date (drills
                          to the day view where the times live), expiry and
                          supplier collapse onto ONE wrapping line instead of a
                          stack of separate rows (user, Aug 29: "like product
                          cards ... compact, less rows"). */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-300">
                        {[
                          batch.received_at ? (
                            <button
                              type="button"
                              className="text-blue-600 hover:underline dark:text-blue-300"
                              onClick={() => setDayDetail(String(batch.received_at || '').slice(0, 10) || null)}
                            >
                              {tr('received_on', 'Received', 'បានទទួល')} {fmtDateOnly(String(batch.received_at || '').slice(0, 10))} ›
                            </button>
                          ) : null,
                          <span>{tr('expiry', 'Expiry')} {batch.expiry_date ? fmtDateOnly(batch.expiry_date) : tr('no_expiry', 'No expiry')}</span>,
                          batch.supplier_name ? <span className="max-w-[9rem] truncate" title={String(batch.supplier_name)}>{batch.supplier_name}</span> : null,
                          !batch.is_active ? <span className="font-medium text-gray-400">{tr('deactivated', 'Deactivated')}</span> : null,
                        ].filter(Boolean).map((node, i) => (
                          <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
                            {i > 0 ? <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">·</span> : null}
                            {node}
                          </span>
                        ))}
                      </div>
                      {batch.notes ? <div className="mt-0.5 truncate text-[11px] text-gray-400" title={batch.notes}>{batch.notes}</div> : null}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <div className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{batch.quantity} {product.unit}</div>
                      <div className="flex items-center gap-0.5">
                        <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30" onClick={() => startEdit(batch)} disabled={isSaving}>
                          {t('edit') || 'Edit'}
                        </button>
                        {batch.is_active ? (
                          <button
                            type="button"
                            className="flex items-center rounded-lg px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
                            onClick={() => deactivate(batch)}
                            disabled={isSaving}
                            title={tr('deactivate', 'Deactivate')}
                            aria-label={tr('deactivate', 'Deactivate')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* The header X is the single close affordance -- the old footer
            "Close" button duplicated it (user ask); edits here auto-save per
            row, so there was no other footer action to keep. */}
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>,
    document.body,
  )
}
