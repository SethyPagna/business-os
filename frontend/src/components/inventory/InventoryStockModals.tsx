import { lazy, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import SuggestionTextInput from '../shared/SuggestionTextInput.tsx'
import { useFormDirty } from '../../utils/formDirty.ts'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import { markRestoreHandled } from '../../utils/minimizedWork.ts'
import { TOOLBAR_BUTTON_BASE, toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { useSavedStockReasonCatalog } from '../../utils/useSavedStockReasons.ts'

const StockReasonsManagerModal = lazy(() => import('../shared/StockReasonsManagerModal'))

// The Branches/Inventory transfer form. Stock changes (add / remove / set)
// all go through the Stock Session float (FastStockInModal); this file keeps
// only the transfer between branches.

type InventoryId = number | string
type InventoryFormValue = string | number
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryProduct = Record<string, any> & {
  id?: InventoryId
  name?: string
  unit?: string
  branch_stock?: Array<Record<string, any>>
}

type TransferForm = {
  from_branch_id: InventoryId | ''
  to_branch_id: InventoryId | ''
  quantity: InventoryFormValue
  reason: string
  // The received date to move from (only lots with stock at the source are
  // offered) and its quantity when read -- the Worker re-checks it.
  batch_id?: InventoryId | ''
  batch_quantity?: number | ''
}

type InventoryStockModalsProps = {
  branchWithPlaceholderOptions?: AppSelectOption[]
  getStockQty: (product?: InventoryProduct | null) => number
  onCloseTransfer: () => void
  onMinimizeTransfer?: () => void
  transferRestoredDirty?: boolean
  transferPending?: boolean
  transferWorkKey?: string
  onTransfer: () => void
  onTransferSourceChange?: (branchId: string) => void
  setTransferForm: Dispatch<SetStateAction<TransferForm>>
  t: Translator
  tr: TranslationWithFallback
  transferForm: TransferForm
  transferDestinationBranchOptions?: AppSelectOption[]
  transferModal: InventoryProduct | null
  transferSaving: boolean
  transferSourceBranchOptions: AppSelectOption[]
}

export default function InventoryStockModals({
  branchWithPlaceholderOptions,
  getStockQty,
  onCloseTransfer,
  onMinimizeTransfer,
  transferRestoredDirty = false,
  transferPending = false,
  transferWorkKey,
  onTransfer,
  onTransferSourceChange,
  setTransferForm,
  t,
  tr,
  transferForm,
  transferDestinationBranchOptions,
  transferModal,
  transferSaving,
  transferSourceBranchOptions,
}: InventoryStockModalsProps) {
  useEffect(() => { if (transferModal) markRestoreHandled('inventory_transfer') }, [transferModal?.id])
  // The saved transfer reasons, re-read after the reasons manager changes them.
  const { reasons: transferReasons, reload: reloadTransferReasons } = useSavedStockReasonCatalog('transfer')
  const [reasonsManagerOpen, setReasonsManagerOpen] = useState(false)
  const changeTransferSource = onTransferSourceChange || ((branchId: string) => {
    setTransferForm((current) => ({ ...current, from_branch_id: branchId, to_branch_id: '', batch_id: '', batch_quantity: '' }))
  })
  // Transfer offers only received dates with stock at the source branch.
  const [transferBatchOptions, setTransferBatchOptions] = useState<ProductBatch[]>([])
  const [transferBatchesLoading, setTransferBatchesLoading] = useState(false)
  const transferProductId = transferModal?.id
  const transferSourceId = transferForm.from_branch_id
  useEffect(() => {
    setTransferBatchOptions([])
    if (!transferProductId || !(Number(transferSourceId) > 0)) return undefined
    let cancelled = false
    setTransferBatchesLoading(true)
    getProductBatches(transferProductId, Number(transferSourceId), true)
      .then((res) => {
        if (cancelled) return
        const batches = (res?.batches || []).filter((batch) => Number(batch.quantity) > 0)
        setTransferBatchOptions(batches)
        // A lot chosen under another source (or no longer holding stock) is dropped.
        setTransferForm((current) => (current.batch_id && !batches.some((batch) => String(batch.id) === String(current.batch_id))
          ? { ...current, batch_id: '', batch_quantity: '' } : current))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[Inventory] transfer lot load failed:', error)
        setTransferBatchOptions([])
        // Only Automatic can be shown without the lot list, so a lot restored
        // from a draft must not ride the wire unseen: fall back to Automatic.
        setTransferForm((current) => (current.batch_id ? { ...current, batch_id: '', batch_quantity: '' } : current))
      })
      .finally(() => { if (!cancelled) setTransferBatchesLoading(false) })
    return () => { cancelled = true }
    // setTransferForm is the parent's stable setter; re-key on product/source only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferProductId, transferSourceId])
  const destinationBranchOptions = transferDestinationBranchOptions || branchWithPlaceholderOptions || []

  // S4-21: the form lives in the PARENT page's state, so useFormDirty takes
  // the snapshot itself on the first render of each opening; the reset key
  // goes null while the modal is shut, so a second open re-baselines.
  const transferDirty = useFormDirty(transferForm, transferModal ? `transfer-${transferModal.id}` : null)
  const transferGuard = useCloseGuard(transferWorkKey ? { workKey: transferWorkKey } : { dirty: !transferPending && (transferDirty.dirty || transferRestoredDirty) }, onCloseTransfer, onMinimizeTransfer)
  // A dismissal during a save is ignored rather than prompting about a form
  // the request is still reading.
  const requestCloseTransfer = () => { if (!transferSaving) transferGuard.requestClose() }

  if (!transferModal) return null

  const modals = (
    <>
      {transferModal ? (
        <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={requestCloseTransfer}>
          <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700 sm:px-4">
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('transfer', 'Transfer')}</h2>
                <div className="mt-0.5 detail-scroll-text text-xs text-gray-400">{transferModal.name} - {getStockQty(transferModal)} {transferModal.unit}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onMinimizeTransfer ? <MinimizeButton onMinimize={onMinimizeTransfer} tr={tr} disabled={transferSaving} /> : null}
                <button type="button" onClick={requestCloseTransfer} disabled={transferSaving} className={toolbarIconButtonClassName} aria-label={t('close') || 'Close'}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* Section 10 (owner, 30 Sep): one row per pair, the name of each
                control inside it, no captions. */}
            <fieldset disabled={transferSaving || transferPending} className={`modal-scroll min-w-0 space-y-2 p-3 sm:p-4 ${transferSaving || transferPending ? 'pointer-events-none opacity-60' : ''}`}>
              <div className="grid grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                <AppSelect
                  value={transferForm.from_branch_id}
                  onChange={changeTransferSource}
                  ariaLabel={tr('source_branch', 'Source branch')}
                  className="w-full min-w-0"
                  buttonClassName="h-9 w-full text-sm"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm"
                  options={transferSourceBranchOptions}
                />
                <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <AppSelect
                  value={transferForm.to_branch_id}
                  onChange={(nextValue) => setTransferForm((current) => ({ ...current, to_branch_id: nextValue }))}
                  ariaLabel={tr('destination_branch', 'Destination branch')}
                  className="w-full min-w-0"
                  buttonClassName="h-9 w-full text-sm"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm"
                  options={destinationBranchOptions}
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)] gap-1.5">
                {/* Automatic (FIFO) is the default and never blocks the
                    transfer: a product whose stock has no dated lot at the
                    source still moves, allocated by the Worker. */}
                <AppSelect
                  value={Number(transferForm.batch_id) > 0 ? String(transferForm.batch_id) : ''}
                  onChange={(nextValue) => {
                    const batch = transferBatchOptions.find((option) => String(option.id) === nextValue)
                    setTransferForm((current) => (batch
                      ? { ...current, batch_id: batch.id, batch_quantity: Number(batch.quantity || 0) }
                      : { ...current, batch_id: '', batch_quantity: '' }))
                  }}
                  ariaLabel={tr('transfer_pick_batch_optional', 'Received date (optional)')}
                  disabled={transferBatchesLoading}
                  className="w-full min-w-0"
                  buttonClassName="h-9 w-full text-sm tabular-nums"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm tabular-nums"
                  options={[
                    { value: '', label: transferBatchesLoading ? (t('loading') || 'Loading...') : tr('transfer_auto_fifo', 'Automatic (FIFO)') },
                    ...transferBatchOptions.map((batch) => ({
                      value: String(batch.id),
                      label: `${batchDisplayLabel(batch, tr('batch', 'Received date'))} · ${batch.quantity}`,
                    })),
                  ]}
                />
                <input
                  className="input h-9 text-sm tabular-nums"
                  type="number"
                  min="0"
                  step="any"
                  aria-label={t('quantity') || 'Quantity'}
                  title={t('quantity') || 'Quantity'}
                  placeholder={t('quantity') || 'Quantity'}
                  value={transferForm.quantity}
                  onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))}
                />
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <SuggestionTextInput
                  id="inventory-transfer-reason"
                  name="inventory_transfer_reason"
                  className="min-w-0 flex-1"
                  inputClassName="h-9 text-sm"
                  value={transferForm.reason}
                  options={transferReasons.map((entry) => entry.label)}
                  onChange={(next) => setTransferForm((current) => ({ ...current, reason: next }))}
                  ariaLabel={t('reason') || 'Reason'}
                  placeholder={tr('transfer_reason_placeholder', 'Reason for this transfer')}
                />
                <button
                  type="button"
                  className={toolbarIconButtonClassName}
                  onClick={() => setReasonsManagerOpen(true)}
                  aria-label={tr('manage_reasons', 'Manage reasons')}
                  title={tr('manage_reasons', 'Manage reasons')}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </fieldset>
            <div className="flex-shrink-0 border-t border-gray-200 p-3 dark:border-gray-700 sm:p-4">
              <button type="button" onClick={onTransfer} className={`btn-primary ${TOOLBAR_BUTTON_BASE} w-full`} disabled={transferSaving || transferPending}>
                {transferSaving ? (t('saving') || 'Saving...') : tr('transfer', 'Transfer')}
              </button>
            </div>
          </div>
          <UnsavedChangesPrompt guard={transferGuard} />
        </div>
      ) : null}
      {reasonsManagerOpen ? (
        <Suspense fallback={null}>
          <StockReasonsManagerModal initialTab="transfer" onClose={() => setReasonsManagerOpen(false)} onChanged={reloadTransferReasons} />
        </Suspense>
      ) : null}
    </>
  )

  if (typeof document === 'undefined') return modals
  return createPortal(modals, document.body)
}
