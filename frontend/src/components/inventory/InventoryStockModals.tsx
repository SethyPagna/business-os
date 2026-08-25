import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

type MoneyFormatter = (value: number) => string

type InventoryId = number | string
type InventoryFormValue = string | number
type InventoryReasonType = 'adjust' | 'transfer' | 'move'
type Translator = (key: string) => string | undefined
type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type InventoryProduct = Record<string, any> & {
  id?: InventoryId
  name?: string
  unit?: string
  branch_stock?: Array<Record<string, any>>
}

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type InventoryReasonGroups = Record<InventoryReasonType, InventoryReason[]>

// Pricing here mirrors ProductForm.tsx's own field set (one "Cost" input,
// not a separate "cost" + "purchase price" pair -- see that form's own
// purchase_price_usd/cost_price_usd mirroring). `pricingLocked` (default
// true) hides all of it and adds straight to the current row/branch --
// the fast, common case. Unlocking reveals these fields so the person can
// receive stock at genuinely different pricing; the backend
// (resolveAddStockTarget in routes/inventory.ts) then finds-or-creates
// the matching row automatically, which is what the old separate "Move
// Stock" modal used to require a second manual step for.
type AdjustForm = {
  product_id?: InventoryId
  type: string
  quantity: InventoryFormValue
  reason: string
  branch_id: InventoryId | ''
  pricingLocked: boolean
  selling_price_usd: InventoryFormValue
  selling_price_khr: InventoryFormValue
  special_price_usd: InventoryFormValue
  special_price_khr: InventoryFormValue
  discount_enabled: boolean
  discount_type: string
  discount_percent: InventoryFormValue
  discount_amount_usd: InventoryFormValue
  cost_usd: InventoryFormValue
  cost_khr: InventoryFormValue
  barcode: string
  // Mandatory batch selection (add/remove, flat rows only -- see
  // routes/inventory.ts's `/adjust` batchId comment): '' = nothing picked
  // yet (blocks submit on a flat row), 'new' = create a fresh batch (the
  // default once the picker loads for 'add'), a number = an existing
  // batch's id. Ignored server-side when pricing is unlocked, so it's
  // left as-is (not reset) when the person flips that toggle -- the UI
  // just stops asking for it.
  batch_id: InventoryId | ''
}

type TransferForm = {
  from_branch_id: InventoryId | ''
  to_branch_id: InventoryId | ''
  quantity: InventoryFormValue
  reason: string
}

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type AdjustCurrentPricing = {
  selling_price_usd: number
  selling_price_khr: number
}

type InventoryStockModalsProps = {
  adjustBranchSelectOptions: AppSelectOption[]
  adjustCurrentPricing: AdjustCurrentPricing
  adjustCurrentQuantity: number
  adjustForm: AdjustForm
  adjustModal: InventoryProduct | null
  adjustSaving: boolean
  adjustTargetOptions: InventoryProduct[]
  adjustTargetSelectOptions: AppSelectOption[]
  branchCount: number
  branchSelectOptions: AppSelectOption[]
  branchWithPlaceholderOptions: AppSelectOption[]
  defaultAddQuantity: number
  fmtKHR: MoneyFormatter
  fmtUSD: MoneyFormatter
  getStockQty: (product?: InventoryProduct | null) => number
  onAdjust: () => void
  onCloseAdjust: () => void
  onCloseTransfer: () => void
  onTransfer: () => void
  reasonsByType: InventoryReasonGroups
  setAdjustForm: Dispatch<SetStateAction<AdjustForm>>
  setReasonManager: Dispatch<SetStateAction<ReasonManagerState>>
  setTransferForm: Dispatch<SetStateAction<TransferForm>>
  t: Translator
  tr: TranslationWithFallback
  transferForm: TransferForm
  transferModal: InventoryProduct | null
  transferSaving: boolean
  transferSourceBranchOptions: AppSelectOption[]
  usdSymbol: string
}

export default function InventoryStockModals({
  adjustBranchSelectOptions,
  adjustCurrentPricing,
  adjustCurrentQuantity,
  adjustForm,
  adjustModal,
  adjustSaving,
  adjustTargetOptions,
  adjustTargetSelectOptions,
  branchCount,
  branchWithPlaceholderOptions,
  defaultAddQuantity,
  fmtKHR,
  fmtUSD,
  getStockQty,
  onAdjust,
  onCloseAdjust,
  onCloseTransfer,
  onTransfer,
  reasonsByType,
  setAdjustForm,
  setReasonManager,
  setTransferForm,
  t,
  tr,
  transferForm,
  transferModal,
  transferSaving,
  transferSourceBranchOptions,
  usdSymbol,
}: InventoryStockModalsProps) {
  const addQuantityChoices = [...new Set([1, defaultAddQuantity, 5, 10, 20].filter((n) => n > 0))]

  // Mandatory batch selection -- scoped to flat rows only (!is_group).
  // Group container rows have no stock of their own (each child row has
  // its own product_batches), so there's nothing to pick a batch *for* at
  // the group level -- same exclusion the existing batch/expiry system
  // (ReceiveBatchModal, ManageBatchesModal) already documents for
  // variant/group picking. Resolve against whichever row the "Adjust
  // target" picker actually has selected, same as adjustCurrentQuantity/
  // adjustCurrentPricing above.
  const adjustTargetId = adjustForm.product_id || adjustModal?.id
  const adjustTargetProduct = adjustTargetOptions.find((p) => String(p.id) === String(adjustTargetId)) || adjustModal
  const isGroupTarget = Boolean(adjustTargetProduct?.is_group)
  const unlockPricing = adjustForm.type === 'add' && !adjustForm.pricingLocked
  // A batch is scoped to one branch's stock -- "No specific branch" (the
  // placeholder option in adjustBranchSelectOptions) has no branch to pick
  // a batch within, so the picker only shows once a real branch is
  // selected. In practice `openAdjust` always pre-fills the default
  // branch, so this only matters if the person explicitly clears it.
  const adjustBranchId = adjustForm.branch_id ? Number(adjustForm.branch_id) : null
  const showBatchPicker = !isGroupTarget
    && (adjustForm.type === 'add' || adjustForm.type === 'remove')
    && !unlockPricing
    && Boolean(adjustBranchId)

  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  useEffect(() => {
    if (!showBatchPicker || !adjustTargetId || !adjustBranchId) { setBatchOptions([]); return }
    // Target/branch/type changed since the last fetch -- whatever was
    // previously picked may not even be in the new list (different
    // product, different branch's stock, or add<->remove switched which
    // batches are eligible). Clear it so a stale id can't ride along to
    // submit; the "default to new batch" effect below re-fills it for
    // 'add' once the new list is in.
    setAdjustForm((current) => (current.batch_id === '' ? current : { ...current, batch_id: '' }))
    let cancelled = false
    setBatchLoading(true)
    // 'remove' only offers batches that actually have stock at this
    // branch (onlyAvailable) -- picking an empty lot to remove from would
    // just bounce off removeStockFromBatch's InsufficientBatchStockError
    // server-side; 'add' shows every active batch, including empty ones,
    // since topping one back up is a normal receipt.
    getProductBatches(adjustTargetId, adjustBranchId, adjustForm.type === 'remove')
      .then((res) => { if (!cancelled) setBatchOptions(res?.batches || []) })
      // getProductBatches no longer resolves a failed request as an empty
      // list (see batchesTransport.ts), so this needs a real handler --
      // without one a 403/500 here would surface as an unhandled rejection.
      // An empty option list is the honest fallback for a picker, but the
      // failure is logged rather than swallowed silently.
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[Inventory] batch options load failed:', error)
        setBatchOptions([])
      })
      .finally(() => { if (!cancelled) setBatchLoading(false) })
    return () => { cancelled = true }
  }, [showBatchPicker, adjustTargetId, adjustBranchId, adjustForm.type])
  // Default to "new batch" the first time the picker has something to
  // show for an add -- matches the decided default ("Default batch
  // `n+1: mm/dd/yyyy` stays the default for add stock"). Remove has no
  // such default (no batch-less removals), so it's left blank until the
  // person actually picks one. Only fires once per target/branch/type
  // combo (guarded by the empty-string check) so it doesn't stomp a
  // selection already made against the previous options.
  useEffect(() => {
    if (showBatchPicker && adjustForm.type === 'add' && adjustForm.batch_id === '') {
      setAdjustForm((current) => (current.batch_id === '' ? { ...current, batch_id: 'new' } : current))
    }
  }, [showBatchPicker, adjustForm.type, adjustForm.batch_id, setAdjustForm])

  if (!adjustModal && !transferModal) return null

  return (
    <>
      {adjustModal ? (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onCloseAdjust}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-modal-92" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('adjust_stock')}</h2>
                <div className="text-xs text-gray-400 mt-0.5">{adjustModal.name} - Current: {adjustCurrentQuantity} {adjustModal.unit}</div>
              </div>
              <button onClick={onCloseAdjust} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-3">
              {adjustTargetOptions.length > 1 ? (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('adjust_target', 'Adjust target')}</label>
                  <AppSelect
                    value={adjustForm.product_id || adjustModal.id || ''}
                    onChange={(nextValue) => setAdjustForm((current) => ({ ...current, product_id: nextValue }))}
                    ariaLabel={tr('adjust_target', 'Adjust target')}
                    className="w-full"
                    buttonClassName="h-10 w-full text-sm"
                    menuClassName="min-w-[15rem]"
                    optionClassName="text-sm"
                    options={adjustTargetSelectOptions}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {([['add', t('adjust_add') || 'Add'], ['remove', t('adjust_remove') || 'Remove'], ['set', t('adjust_set') || 'Set']] as [string, string][]).map(([v,lbl]) => (
                  <button key={v} onClick={() => setAdjustForm(f=>({...f, type:v}))}
                    className={`py-2 rounded-xl border-2 text-xs font-medium ${adjustForm.type===v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('quantity')} *</label>
                <input
                  id="inventory-adjust-quantity"
                  name="inventory_adjust_quantity"
                  className="input text-sm"
                  type="number"
                  step="any"
                  min="0"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f=>({...f, quantity:e.target.value}))} />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {addQuantityChoices.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${Number(adjustForm.quantity) === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                      onClick={() => setAdjustForm(f => ({ ...f, quantity: n }))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {adjustForm.type === 'add' ? (
                <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {/* Long on/off explanation moved off the face of the
                          card and into this hover/focus tooltip -- same
                          icon-button pattern InventoryMovementsSurface.tsx
                          uses for its "grouped movement history" info,
                          rather than a second always-visible text line.
                          Part 207: icon moved before the label it explains. */}
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:border-blue-200 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-blue-800 dark:hover:text-blue-300"
                        title={adjustForm.pricingLocked
                          ? tr('lock_pricing_on_hint', "On: this stock is added to this row at its current price. Turn off to receive it at a different price.")
                          : tr('lock_pricing_off_hint', "Off: if this price differs from an existing row's, stock goes there (or a new row is created) instead of here.")}
                        aria-label={adjustForm.pricingLocked
                          ? tr('lock_pricing_on_hint', "On: this stock is added to this row at its current price. Turn off to receive it at a different price.")
                          : tr('lock_pricing_off_hint', "Off: if this price differs from an existing row's, stock goes there (or a new row is created) instead of here.")}
                      >
                        <Info className="h-2.5 w-2.5" aria-hidden="true" />
                      </button>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{tr('lock_current_pricing', 'Lock current pricing')}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Current locked-in price, resolved against whichever
                          row is actually selected (adjustCurrentPricing
                          tracks the "Adjust target" picker, not just the
                          product the modal opened from) -- shown regardless
                          of lock state so it's still visible as the
                          starting point right up until the fields below are
                          edited. */}
                      <span className="text-right text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                        <span className="block font-semibold text-gray-700 dark:text-gray-300">{fmtUSD(adjustCurrentPricing.selling_price_usd)}</span>
                        {adjustCurrentPricing.selling_price_khr > 0 ? (
                          <span className="block">{fmtKHR(adjustCurrentPricing.selling_price_khr)}</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={adjustForm.pricingLocked}
                        onClick={() => setAdjustForm(f => ({ ...f, pricingLocked: !f.pricingLocked }))}
                        className={`relative h-5 w-9 rounded-full transition-colors ${adjustForm.pricingLocked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${adjustForm.pricingLocked ? 'translate-x-0.5' : 'translate-x-4'}`} />
                      </button>
                    </div>
                  </div>
                  {!adjustForm.pricingLocked ? (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('cost_price_usd_full', 'Cost')} ({usdSymbol})</label>
                          <input className="input text-sm" type="number" step="any" min="0" value={adjustForm.cost_usd} onChange={e => setAdjustForm(f=>({...f, cost_usd:e.target.value}))} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('cost_price_khr_full', 'Cost')} (KHR)</label>
                          <input className="input text-sm" type="number" step="any" min="0" value={adjustForm.cost_khr} onChange={e => setAdjustForm(f=>({...f, cost_khr:e.target.value}))} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('selling_price_usd_full', 'Selling Price')} ({usdSymbol})</label>
                          <input className="input text-sm" type="number" step="any" min="0" value={adjustForm.selling_price_usd} onChange={e => setAdjustForm(f=>({...f, selling_price_usd:e.target.value}))} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('selling_price_khr_full', 'Selling Price')} (KHR)</label>
                          <input className="input text-sm" type="number" step="any" min="0" value={adjustForm.selling_price_khr} onChange={e => setAdjustForm(f=>({...f, selling_price_khr:e.target.value}))} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                        <input type="checkbox" checked={!!adjustForm.discount_enabled} onChange={e => setAdjustForm(f=>({...f, discount_enabled:e.target.checked}))} />
                        {tr('product_discount', 'Discount')}
                      </label>
                      {adjustForm.discount_enabled ? (
                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('discount_percent', 'Percent off')}</label>
                          <input className="input text-sm" type="number" step="any" min="0" value={adjustForm.discount_percent} onChange={e => setAdjustForm(f=>({...f, discount_percent:e.target.value}))} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showBatchPicker ? (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                    {adjustForm.type === 'add' ? tr('batch', 'Batch') : tr('batch_to_remove_from', 'Batch to remove from')} *
                  </label>
                  {batchLoading ? (
                    <div className="text-xs text-gray-400">{t('loading') || 'Loading...'}</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {adjustForm.type === 'add' ? (
                        <button
                          type="button"
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium border ${adjustForm.batch_id === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                          onClick={() => setAdjustForm((f) => ({ ...f, batch_id: 'new' }))}
                        >
                          {tr('new_batch', '+ New batch')}
                        </button>
                      ) : null}
                      {batchOptions.map((batch) => (
                        <button
                          key={batch.id}
                          type="button"
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium border ${String(adjustForm.batch_id) === String(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                          onClick={() => setAdjustForm((f) => ({ ...f, batch_id: batch.id }))}
                        >
                          {batchDisplayLabel(batch, tr('batch', 'Batch'))} ({batch.quantity})
                        </button>
                      ))}
                      {!batchOptions.length && adjustForm.type === 'remove' ? (
                        <div className="text-xs text-gray-400">{tr('no_batches_with_stock', 'No batches with stock in this branch')}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
              {adjustForm.type === 'add' && unlockPricing ? (
                <div className="text-[11px] text-gray-400">
                  {tr('batch_auto_new_unlocked', 'A new batch is created automatically for unlocked-pricing receipts.')}
                </div>
              ) : null}
              {branchCount > 1 ? (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('branch')}</label>
                  <AppSelect
                    id="inventory-adjust-branch"
                    name="inventory_adjust_branch"
                    value={adjustForm.branch_id}
                    onChange={(nextValue) => setAdjustForm((current) => ({ ...current, branch_id: nextValue }))}
                    ariaLabel={t('branch') || 'Branch'}
                    className="w-full"
                    buttonClassName="h-10 w-full text-sm"
                    menuClassName="min-w-[13rem]"
                    optionClassName="text-sm"
                    options={adjustBranchSelectOptions}
                  />
                </div>
              ) : null}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block">{t('reason')}</label>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'adjust' })}>
                    {tr('manage_reasons', 'Manage reasons')}
                  </button>
                </div>
                {reasonsByType.adjust.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {reasonsByType.adjust.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${adjustForm.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                        onClick={() => setAdjustForm((current) => ({ ...current, reason: entry.label }))}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  id="inventory-adjust-reason"
                  name="inventory_adjust_reason"
                  className="input text-sm"
                  placeholder={t('reason_placeholder')}
                  value={adjustForm.reason} onChange={e => setAdjustForm(f=>({...f, reason:e.target.value}))} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={onAdjust} className="btn-primary flex-1 text-sm" disabled={adjustSaving}>{adjustSaving ? (t('saving') || 'Saving...') : t('save')}</button>
                <button onClick={onCloseAdjust} className="btn-secondary text-sm" disabled={adjustSaving}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transferModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onCloseTransfer}>
          <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('transfer', 'Transfer')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{transferModal.name} - {getStockQty(transferModal)} {transferModal.unit}</div>
              </div>
              <button type="button" onClick={onCloseTransfer} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch')}</span>
                <AppSelect
                  value={transferForm.from_branch_id}
                  onChange={(nextValue) => setTransferForm((current) => ({ ...current, from_branch_id: nextValue }))}
                  ariaLabel={tr('source_branch', 'Source branch')}
                  className="w-full"
                  buttonClassName="h-10 w-full text-sm"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm"
                  options={transferSourceBranchOptions}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch')}</span>
                <AppSelect
                  value={transferForm.to_branch_id}
                  onChange={(nextValue) => setTransferForm((current) => ({ ...current, to_branch_id: nextValue }))}
                  ariaLabel={tr('destination_branch', 'Destination branch')}
                  className="w-full"
                  buttonClassName="h-10 w-full text-sm"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm"
                  options={branchWithPlaceholderOptions}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'} *</span>
                <input className="input text-sm" type="number" min="0" step="any" value={transferForm.quantity} onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))} />
              </label>
              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('reason') || 'Reason'} *</span>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'transfer' })}>
                    {tr('manage_reasons', 'Manage reasons')}
                  </button>
                </div>
                {reasonsByType.transfer.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {reasonsByType.transfer.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${transferForm.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                        onClick={() => setTransferForm((current) => ({ ...current, reason: entry.label }))}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea className="input min-h-[84px] text-sm" value={transferForm.reason} onChange={(event) => setTransferForm((current) => ({ ...current, reason: event.target.value }))} placeholder={tr('transfer_reason_placeholder')} />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onTransfer} className="btn-primary flex-1 text-sm" disabled={transferSaving}>
                  {transferSaving ? (t('saving') || 'Saving...') : tr('transfer', 'Transfer')}
                </button>
                <button type="button" onClick={onCloseTransfer} className="btn-secondary text-sm" disabled={transferSaving}>
                  {t('cancel') || 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </>
  )
}
