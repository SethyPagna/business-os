import { todayStr } from '../../utils/dateHelpers.ts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import { clearWorkDraft, scheduleWorkDraftWrite, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { getProductBatches, receiveBatchStock, type ProductBatch } from '../../api/batchesTransport.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import SupplierPickerField from '../shared/SupplierPickerField.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'

function todayIsoDate(): string {
  return todayStr()
}

type InventoryId = number | string
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryProduct = Record<string, any> & {
  id?: InventoryId
  name?: string
  unit?: string
}

type ReceiveBatchModalProps = {
  product: InventoryProduct | null
  branchSelectOptions: AppSelectOption[]
  defaultBranchId?: string
  notify: (message: string, type?: string) => void
  onClose: () => void
  onReceived: () => void
  t: Translator
  tr: TranslationWithFallback
}

// Receives new stock into a lot/expiry-tracked batch (see
// api/batchesTransport.ts + cloudflare/src/lib/productBatches.ts). Distinct
// from InventoryBatchModal ("batch session" -- a queue of ordinary stock
// adjustments/transfers/moves across several products); this is always for
// one product, and always creates or tops up one product_batches row.
export default function ReceiveBatchModal({
  product,
  branchSelectOptions,
  defaultBranchId,
  notify,
  onClose,
  onReceived,
  t,
  tr,
}: ReceiveBatchModalProps) {
  const [branchId, setBranchId] = useState(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
  const [quantity, setQuantity] = useState('1')
  const [receivedDate, setReceivedDate] = useState(todayIsoDate())
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')
  // Supplier + cost + paid/on-credit (migrations 0062/0065): who this lot
  // came from, what one unit cost, and — when on credit — the due date the
  // admin reminder is built on. D5a: the supplier is a real picker now --
  // supplierId is set only by picking a contact suggestion; free text keeps
  // id null (deliberate name-only attribution, never auto-creates).
  const [supplierName, setSupplierName] = useState('')
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [unitCost, setUnitCost] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'' | 'paid' | 'credit'>('')
  const [creditDueDate, setCreditDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  // D4b: the same existing-lot picker every adjust surface has -- 'new'
  // creates/matches by date (this modal's original behavior), a number
  // tops up that exact lot (its own received_at stays; the server
  // validates it belongs to this product). Deliberately NOT persisted in
  // the localStorage draft: a drafted lot id can go stale (deactivated,
  // deleted) between sessions, and 'new' is always a safe default.
  const [batchChoice, setBatchChoice] = useState<'new' | number>('new')
  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [batchLoading, setBatchLoading] = useState(false)

  useEffect(() => {
    const productId = Number(product?.id)
    const parsedBranchId = Number(branchId)
    setBatchChoice('new')
    if (!productId || !parsedBranchId) { setBatchOptions([]); return }
    let cancelled = false
    setBatchLoading(true)
    // Every active lot, empty ones included -- topping one back up is a
    // normal receipt, same list the adjust pickers show for 'add'.
    getProductBatches(productId, parsedBranchId, false)
      .then((res) => { if (!cancelled) setBatchOptions(res?.batches || []) })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[ReceiveBatchModal] batch options load failed:', error)
        setBatchOptions([])
      })
      .finally(() => { if (!cancelled) setBatchLoading(false) })
    return () => { cancelled = true }
  }, [product?.id, branchId])

  // Reset the form whenever a different product is opened (or the modal is
  // closed and re-opened for the same one) -- otherwise a leftover
  // received date/expiry from the previous receipt would silently carry
  // over.
  useEffect(() => {
    setBranchId(defaultBranchId || String(branchSelectOptions[0]?.value ?? ''))
    setQuantity('1')
    setReceivedDate(todayIsoDate())
    setExpiryDate('')
    setNotes('')
    setSupplierName('')
    setSupplierId(null)
    setUnitCost('')
    setPaymentStatus('')
    setCreditDueDate('')
  }, [product?.id])

  // N2: an open receive entry with anything typed beyond the defaults is
  // in-progress stock work -- page navigation must ask, not strand it.
  const dirtyStateRef = useRef(false)
  dirtyStateRef.current = Boolean(product) && (
    quantity !== '1' || expiryDate !== '' || notes !== '' ||
    supplierName !== '' || unitCost !== '' || paymentStatus !== '' || creditDueDate !== ''
  )
  // Part 388 "Canva-level" persistence: typed values survive a crash,
  // reload, or accidental close via a per-product localStorage draft --
  // cleared on a successful receive and on explicit Discard & Leave.
  const draftKey = product ? scopedWorkDraftKey(`receive_${product.id}`) : ''
  useEffect(() => {
    if (!product) return
    try {
      const raw = localStorage.getItem(draftKey)
      const parsed = raw ? JSON.parse(raw) as Record<string, any> : null
      // Accept both the shared { at, data } envelope and the old flat shape so
      // existing device drafts survive this migration.
      const draft = parsed?.data || parsed?.form || parsed
      if (draft) {
        if (draft.quantity !== undefined) setQuantity(draft.quantity)
        if (draft.receivedDate) setReceivedDate(draft.receivedDate)
        if (draft.expiryDate !== undefined) setExpiryDate(draft.expiryDate)
        if (draft.notes !== undefined) setNotes(draft.notes)
        if (draft.supplierName !== undefined) setSupplierName(draft.supplierName)
        // D5a: the contact link rides with the drafted name. Only restored
        // when a name is drafted too -- an id with no name would be
        // invisible on screen yet change what the submit writes.
        setSupplierId(draft.supplierName && Number(draft.supplierId) > 0 ? Number(draft.supplierId) : null)
        if (draft.unitCost !== undefined) setUnitCost(draft.unitCost)
        if (draft.paymentStatus === 'paid' || draft.paymentStatus === 'credit' || draft.paymentStatus === '') setPaymentStatus(draft.paymentStatus)
        if (draft.creditDueDate !== undefined) setCreditDueDate(draft.creditDueDate)
      }
    } catch { /* storage unavailable -- modal still works */ }
    return registerDirtyWork({
      key: `receive-batch-${product.id}`,
      // E1 retired the standalone 'inventory' page id -- the Branches hub
      // hosts this flow now, so the nav-guard dot must point THERE.
      // (Rider on F3 slice 1, flagged from a7's E1 notes.)
      pageId: 'branches',
      label: `${tr('receive_batch', 'Receive Batch')}${product.name ? ` — ${product.name}` : ''}`,
      isDirty: () => dirtyStateRef.current,
      discard: () => clearWorkDraft(draftKey),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id])

  useEffect(() => {
    if (!product || !dirtyStateRef.current) return
    return scheduleWorkDraftWrite(draftKey, { quantity, receivedDate, expiryDate, notes, supplierName, supplierId, unitCost, paymentStatus, creditDueDate }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity, receivedDate, expiryDate, notes, supplierName, supplierId, unitCost, paymentStatus, creditDueDate])

  if (!product) return null

  const closeIfIdle = () => {
    if (!saving) onClose()
  }

  // D5a: same visibility-mirror rule as the received date -- an existing
  // lot that already carries a supplier keeps it (first attribution
  // sticks, COALESCE server-side), so the picker locks to that name and
  // nothing is sent. An existing lot with NO supplier still offers the
  // picker: a choice there FILLS the blank, which the server honors.
  const selectedLot = typeof batchChoice === 'number'
    ? batchOptions.find((batch) => Number(batch.id) === batchChoice) || null
    : null
  const lotAttributedName = selectedLot?.supplier_name?.trim() || null

  const submit = async () => {
    const productId = Number(product.id)
    const parsedBranchId = Number(branchId)
    const parsedQuantity = Number(quantity)
    if (!parsedBranchId) { notify(tr('choose_branch', 'Choose a branch'), 'error'); return }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) { notify(tr('quantity_must_be_positive', 'Quantity must be a positive number'), 'error'); return }
    if (paymentStatus === 'credit' && !creditDueDate) {
      notify(tr('credit_needs_due_date', 'A credit purchase needs its due date — the admin reminder is built on it.'), 'error')
      return
    }
    const branchName = branchSelectOptions.find((option) => String(option.value) === String(branchId))?.label || tr('branch', 'selected branch')
    const lotLabel = typeof batchChoice === 'number'
      ? batchDisplayLabel({ id: batchChoice, lot_code: selectedLot?.lot_code ?? null, received_at: selectedLot?.received_at ?? null, batch_number: selectedLot?.batch_number ?? null }, t('batch') || 'Batch')
      : tr('new_batch', 'a new lot')
    if (!window.confirm(tr(
      'confirm_receive_batch_details',
      'Receive {quantity} {unit} of {product} into {branch}, using {lot}? This posts stock movement(s).',
    )
      .replace('{quantity}', String(parsedQuantity))
      .replace('{unit}', product.unit || 'unit(s)')
      .replace('{product}', product.name || 'this product')
      .replace('{branch}', String(branchName))
      .replace('{lot}', lotLabel))) return

    setSaving(true)
    try {
      const res = await receiveBatchStock({
        productId,
        branchId: parsedBranchId,
        quantity: parsedQuantity,
        expiryDate: expiryDate || null,
        // Mirrors the inputs' visibility: an explicit lot ignores the date
        // (it keeps its own), so the date only rides on 'new'.
        receivedDate: batchChoice === 'new' ? (receivedDate || null) : null,
        batchId: typeof batchChoice === 'number' ? batchChoice : null,
        notes: notes.trim() || null,
        // Mirrors the picker's visibility: locked (lot already attributed)
        // sends nothing, so the wire never carries a choice the UI
        // couldn't offer.
        supplierName: lotAttributedName ? null : (supplierName.trim() || null),
        supplierId: lotAttributedName ? null : supplierId,
        unitCostUsd: unitCost.trim() === '' ? null : Number(unitCost),
        paymentStatus: paymentStatus || null,
        creditDueDate: paymentStatus === 'credit' ? creditDueDate : null,
      })
      if (res?.success === false) {
        notify((res as any)?.error || tr('receive_batch_failed', 'Failed to receive batch stock'), 'error')
        return
      }
      notify(tr('batch_received', 'Batch stock received'))
      clearWorkDraft(scopedWorkDraftKey(`receive_${productId}`))
      onReceived()
      onClose()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('receive_batch_failed', 'Failed to receive batch stock'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const modal = (
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('receive_batch', 'Receive Batch')}</h2>
            <div className="mt-0.5 truncate text-xs text-gray-400">{product.name}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="btn-primary min-h-9 px-3 py-1.5 text-xs sm:hidden" onClick={submit} disabled={saving}>
              {saving ? (t('saving') || 'Saving...') : tr('receive_stock', 'Receive stock')}
            </button>
            <button type="button" onClick={closeIfIdle} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" disabled={saving}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="modal-scroll space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                {tr('quantity_received', 'Quantity received')} {product.unit ? `(${product.unit})` : ''}
              </span>
              <input
                className="input w-full text-sm"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                autoComplete="off"
              />
            </label>
            {/* D4b: the same batch picker every adjust surface has --
                consistent everywhere. 'New batch' keeps this modal's
                original create-or-match-by-date behavior; picking a lot
                tops up that exact one. */}
            <div className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('batch', 'Batch')}</span>
              {batchLoading ? (
                <div className="text-[11px] text-gray-400">{t('loading') || 'Loading...'}</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                    onClick={() => setBatchChoice('new')}
                  >
                    {tr('new_batch', '+ New batch')}
                  </button>
                  {batchOptions.map((batch) => (
                    <button
                      key={batch.id}
                      type="button"
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${batchChoice === Number(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                      onClick={() => setBatchChoice(Number(batch.id))}
                    >
                      {batchDisplayLabel(batch, tr('batch', 'Batch'))} ({batch.quantity})
                    </button>
                  ))}
                </div>
              )}
            </div>
            {batchChoice === 'new' ? (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
                {/* Typed, not a native picker (Sep 3) -- staff key this on a
                    numeric pad and it derives the lot code. */}
                <DateEntryInput
                  className="w-full text-sm"
                  t={t}
                  ariaLabel={tr('received_date', 'Received date')}
                  value={receivedDate}
                  onChange={(iso) => setReceivedDate(iso)}
                />
                {/* Preview only -- the backend always recomputes and stores
                    the authoritative code itself from whichever date is
                    actually submitted (see batchCode.ts's dateToBatchCode).
                    A receipt on the same date as an existing batch tops it
                    up automatically; there's no separate lot code to type. */}
                <span className="mt-1 block text-[11px] text-gray-400">
                  {tr('batch_code_preview', 'Batch code')}: {dateToBatchCode(receivedDate) || '--'}
                </span>
              </label>
            ) : (
              /* Same visibility rule as the adjust surfaces: an existing
                 lot keeps its own received date, so the date input hides
                 rather than pretending to apply. */
              <div className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('received_date', 'Received date')}</span>
                <span className="mt-2 block text-[11px] text-gray-400">
                  {tr('existing_lot_keeps_date', 'Tops up the selected lot — its received date stays.')}
                </span>
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('expiry_date', 'Expiry date')}</span>
              <DateEntryInput
                className="w-full text-sm"
                t={t}
                ariaLabel={tr('expiry_date', 'Expiry date')}
                value={expiryDate}
                onChange={(iso) => setExpiryDate(iso)}
              />
            </label>
          </div>
          {/* Supplier + cost on one row (this lot's own facts) */}
          <div className="grid gap-2 sm:grid-cols-2">
            <SupplierPickerField
              idPrefix="receive-batch"
              value={{ supplierId, supplierName }}
              onChange={(next) => { setSupplierId(next.supplierId); setSupplierName(next.supplierName) }}
              tr={tr}
              lockedName={lotAttributedName}
              hint={selectedLot && !lotAttributedName
                ? tr('supplier_will_fill_lot', 'This lot has no supplier yet — your choice will be recorded on it.')
                : null}
            />
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('unit_cost_usd', 'Unit cost (USD)')}</span>
              <input
                className="input w-full text-sm"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>
          {/* Paid vs on-credit; the due date appears only when credit and is
              required — it is what the admin reminder is built on. */}
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('payment_to_supplier', 'Payment to supplier')}</span>
            <div className="flex items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs font-medium dark:border-gray-600">
                {([['', tr('payment_unset', '—')], ['paid', tr('paid', 'Paid')], ['credit', tr('on_credit', 'On credit')]] as const).map(([value, label], index) => (
                  <button
                    key={value || 'unset'}
                    type="button"
                    className={`px-3 py-1.5 ${index > 0 ? 'border-l border-gray-200 dark:border-gray-600' : ''} ${paymentStatus === value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    onClick={() => setPaymentStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {paymentStatus === 'credit' ? (
                <label className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="flex-shrink-0 text-[11px] text-gray-500">{tr('due', 'Due')}</span>
                  <DateEntryInput
                    className="min-w-0 flex-1 text-sm"
                    t={t}
                    ariaLabel={tr('due', 'Due')}
                    value={creditDueDate}
                    onChange={(iso) => setCreditDueDate(iso)}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('notes') || 'Notes'}</span>
            <textarea
              className="input min-h-[70px] w-full text-sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={tr('receive_batch_notes_placeholder', 'Optional -- PO number, condition, etc.')}
            />
          </label>
        </div>
        <div className="hidden items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
            {t('cancel') || 'Cancel'}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submit} disabled={saving}>
            {saving ? (t('saving') || 'Saving...') : tr('receive_stock', 'Receive stock')}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}
