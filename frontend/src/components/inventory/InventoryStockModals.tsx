import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'
import { getProductBatches, type ProductBatch } from '../../api/batchesTransport.ts'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../utils/batchCode.ts'
import SupplierPickerField from '../shared/SupplierPickerField.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import { isStockInSubmission } from '../../utils/stockReceiptFields.ts'

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
  wholesale_price_usd: InventoryFormValue
  wholesale_price_khr: InventoryFormValue
  discount_enabled: boolean
  discount_type: string
  discount_percent: InventoryFormValue
  discount_amount_usd: InventoryFormValue
  cost_usd: InventoryFormValue
  cost_khr: InventoryFormValue
  barcode: string
  // Mandatory batch selection (add/remove, every target incl. group
  // containers -- D4b; see routes/inventory.ts's `/adjust` batchId
  // comment): '' = nothing picked yet (blocks submit), 'new' = create a
  // fresh batch (the default once the picker loads for 'add'), a number =
  // an existing batch's id. Ignored server-side when pricing is unlocked,
  // so it's left as-is (not reset) when the person flips that toggle --
  // the UI just stops asking for it.
  batch_id: InventoryId | ''
  // D4 (11.28): the REAL received date for stock recorded late. Shown
  // only when this add creates a lot ("New batch", or unlocked pricing
  // which always makes a fresh one); Inventory.tsx only puts it on the
  // wire in exactly those cases, so a lingering value can't re-date an
  // existing lot's top-up.
  received_date: string
  // D5a: who this add was bought from. supplier_id only ever comes from
  // picking a contact suggestion (free text stays a deliberate name-only
  // attribution); this modal CLEARS both whenever an already-attributed
  // lot is picked, so Inventory.tsx's onAdjust can trust the form to be
  // honest -- first attribution sticks server-side either way.
  supplier_id: number | ''
  supplier_name: string
  // S4-15/S4-16: the receipt facts the Sessions list has always had columns
  // for. Shown for any stock-IN (an 'add', or a 'set' that raises the figure
  // -- see utils/stockReceiptFields.ts), because the route converts exactly
  // that 'set' into an add and records these on the movement and its lot.
  // Blank cost stays blank: the Sessions list reports "no receipt-level cost"
  // honestly rather than borrowing the product's stored cost price.
  unit_cost_usd: InventoryFormValue
  payment_status: string
  credit_due_date: string
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
  // Optional resilience slots used by the Products-page adjust flow
  // (StockAdjustModal.tsx): an inline notice pinned under the form when the
  // last submit FAILED, and a submit label that reads "Retry (n)" while a
  // failed row is still unsaved. Both default to the previous behaviour, so
  // Inventory.tsx and every other caller stay unchanged.
  adjustNotice?: ReactNode
  adjustSubmitLabel?: ReactNode
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
  adjustNotice = null,
  adjustSubmitLabel,
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
  const requestedSetTotal = Number(adjustForm.quantity)
  const setDifference = Number.isFinite(requestedSetTotal) ? requestedSetTotal - adjustCurrentQuantity : null

  // Mandatory batch selection, for EVERY target -- group containers
  // included (D4b). The old "flat rows only" exclusion predated the
  // unconditional batch-ledger auto-routing in routes/inventory.ts's
  // /adjust: since that change, an add on an is_group container CREATES a
  // container batch server-side either way, so hiding the picker only hid
  // lots that already existed -- one surface silently weaker than its
  // siblings, the exact inconsistency the user rejected. (Name-grouped
  // rows -- most real groups -- are flat rows and always had the picker.)
  // Resolve against whichever row the "Adjust target" picker actually has
  // selected, same as adjustCurrentQuantity/adjustCurrentPricing above.
  const adjustTargetId = adjustForm.product_id || adjustModal?.id
  const unlockPricing = adjustForm.type === 'add' && !adjustForm.pricingLocked
  // A batch is scoped to one branch's stock -- "No specific branch" (the
  // placeholder option in adjustBranchSelectOptions) has no branch to pick
  // a batch within, so the picker only shows once a real branch is
  // selected. In practice `openAdjust` always pre-fills the default
  // branch, so this only matters if the person explicitly clears it.
  const adjustBranchId = adjustForm.branch_id ? Number(adjustForm.branch_id) : null
  const showBatchPicker = (adjustForm.type === 'add' || adjustForm.type === 'remove')
    && !unlockPricing
    && Boolean(adjustBranchId)
  // S4-16: a 'set' above the current figure IS a receipt -- routes/inventory.ts
  // turns it into an add of the difference and runs it through the same batch
  // ledger. It has no batch picker (nothing to pick against a total), so it
  // always creates or date-matches a lot, which is why it gates the same
  // received-date / supplier / cost / payment fields an explicit add does.
  const isStockIn = isStockInSubmission(adjustForm.type, adjustForm.quantity, adjustCurrentQuantity)
  const createsOrFillsLot = isStockIn
    && (unlockPricing || adjustForm.type === 'set' || (showBatchPicker && adjustForm.batch_id !== ''))
  const creditDueMissing = adjustForm.payment_status === 'credit' && String(adjustForm.credit_due_date || '').trim() === ''

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
  // `n+1: mm/dd/yyyy` stays the default for add stock"). That quote is from
  // Sep 3; the label itself became day-first on Sep 4. Remove has no
  // such default (no batch-less removals), so it's left blank until the
  // person actually picks one. Only fires once per target/branch/type
  // combo (guarded by the empty-string check) so it doesn't stomp a
  // selection already made against the previous options.
  useEffect(() => {
    if (showBatchPicker && adjustForm.type === 'add' && adjustForm.batch_id === '') {
      setAdjustForm((current) => (current.batch_id === '' ? { ...current, batch_id: 'new' } : current))
    }
  }, [showBatchPicker, adjustForm.type, adjustForm.batch_id, setAdjustForm])

  // D5a: same visibility-mirror rule as the received date. An existing lot
  // that already carries a supplier keeps it (first attribution sticks,
  // COALESCE server-side), so the picker locks to that name; an
  // unattributed existing lot still offers it (a choice FILLS the blank,
  // which the server honors). unlockPricing always creates a fresh lot, so
  // the picker stays live there with no lot to consult.
  const selectedAdjustLot = adjustForm.type === 'add' && !unlockPricing
    && adjustForm.batch_id !== '' && adjustForm.batch_id !== 'new'
    ? batchOptions.find((batch) => String(batch.id) === String(adjustForm.batch_id)) || null
    : null
  const adjustLotAttributedName = selectedAdjustLot?.supplier_name?.trim() || null
  // Keep the form honest: a locked lot clears any previously typed choice,
  // so what Inventory.tsx's onAdjust puts on the wire is exactly what the
  // person saw on screen.
  useEffect(() => {
    if (adjustLotAttributedName && (adjustForm.supplier_id !== '' || adjustForm.supplier_name !== '')) {
      setAdjustForm((current) => ({ ...current, supplier_id: '', supplier_name: '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustLotAttributedName])

  if (!adjustModal && !transferModal) return null

  const modals = (
    <>
      {adjustModal ? (
        <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={onCloseAdjust}>
          <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900 dark:text-white">{t('adjust_stock')}</h2>
                <div className="truncate text-xs text-gray-400 mt-0.5">{adjustModal.name} - Current: {adjustCurrentQuantity} {adjustModal.unit}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={onAdjust} className="btn-primary min-h-9 max-w-24 truncate px-3 py-1.5 text-xs sm:hidden" disabled={adjustSaving}>{adjustSaving ? (t('saving') || 'Saving...') : (adjustSubmitLabel || t('save'))}</button>
                <button type="button" onClick={onCloseAdjust} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                  <X className="h-4 w-4" />
                </button>
              </div>
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
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                  {adjustForm.type === 'set'
                    ? `${t('adjust_set') || 'Set'} ${t('stock') || 'Stock'} (${t('total') || 'Total'}) *`
                    : `${t('quantity') || 'Quantity'} *`}
                </label>
                <input
                  id="inventory-adjust-quantity"
                  name="inventory_adjust_quantity"
                  className="input text-sm"
                  type="number"
                  step="any"
                  min="0"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f=>({...f, quantity:e.target.value}))} />
                {adjustForm.type === 'set' && setDifference != null ? (
                  <div className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    {t('current_stock') || 'Current stock'}: {adjustCurrentQuantity} → {t('total') || 'Total'}: {requestedSetTotal} (Δ {setDifference >= 0 ? '+' : ''}{setDifference})
                  </div>
                ) : null}
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
              {/* D4 (11.28): recording stock late may carry the REAL
                  received date -- same field + default ReceiveBatchModal
                  has. Shown only when this add creates a lot ("New batch",
                  or unlocked pricing which always makes a fresh one); an
                  existing lot keeps its own date. The code preview matters
                  because the date DERIVES the lot code, and a matching code
                  tops up that lot instead of creating a twin. */}
              {isStockIn && (unlockPricing || adjustForm.type === 'set' || (showBatchPicker && adjustForm.batch_id === 'new')) ? (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('received_date', 'Received date')}</label>
                  {/* Typed, not a native picker (Sep 3): staff key the date
                      on a numeric pad, so 9032026 has to land as 09/03/2026
                      -- and this IS the add/remove/set stock dialog's date. */}
                  <DateEntryInput
                    id="inventory-adjust-received-date"
                    name="inventory_adjust_received_date"
                    className="text-sm"
                    t={t}
                    ariaLabel={tr('received_date', 'Received date')}
                    value={adjustForm.received_date}
                    onChange={iso => setAdjustForm(f => ({ ...f, received_date: iso }))}
                  />
                  <div className="mt-1 text-[11px] text-gray-400">
                    {tr('batch_code_preview', 'Batch code', 'កូដបាច់')}: {dateToBatchCode(adjustForm.received_date) || '--'}
                  </div>
                </div>
              ) : null}
              {/* D5a: supplier attribution for the lot this add creates or
                  fills -- the same picker, same rules, as ReceiveBatchModal
                  and BranchStockAdjuster. Adds only. */}
              {createsOrFillsLot ? (
                <SupplierPickerField
                  idPrefix="inventory-adjust"
                  value={{ supplierId: adjustForm.supplier_id === '' ? null : adjustForm.supplier_id, supplierName: adjustForm.supplier_name }}
                  onChange={(next) => setAdjustForm((current) => ({ ...current, supplier_id: next.supplierId ?? '', supplier_name: next.supplierName }))}
                  tr={tr}
                  lockedName={adjustLotAttributedName}
                  hint={selectedAdjustLot && !adjustLotAttributedName
                    ? tr('supplier_will_fill_lot', 'This lot has no supplier yet — your choice will be recorded on it.')
                    : null}
                />
              ) : null}
              {/* S4-15/S4-16: what this receipt COST and how it was paid. The
                  Sessions list has always had a Total cost and a Payment
                  column; before this block there was nowhere on this form to
                  answer either, so every receipt taken from the Products
                  section, the Stock-changes ledger or the Inventory page
                  landed there blank. Same fields, same defaults and same
                  credit rule as FastStockInModal, so the two receipt surfaces
                  record the same facts. Deliberately NOT prefilled from the
                  product's stored cost: an unentered cost is reported as
                  unentered rather than guessed. */}
              {isStockIn ? (
                <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="inventory-adjust-unit-cost" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('receipt_cost', 'Receipt cost')} ({usdSymbol}/{tr('unit', 'unit')})</label>
                      <input
                        id="inventory-adjust-unit-cost"
                        name="inventory_adjust_unit_cost"
                        className="input text-sm"
                        type="number"
                        step="any"
                        min="0"
                        placeholder={tr('not_recorded', 'Not recorded')}
                        value={adjustForm.unit_cost_usd}
                        onChange={e => setAdjustForm(f => ({ ...f, unit_cost_usd: e.target.value }))}
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('payment', 'Payment')}</span>
                      <div className="flex gap-1.5">
                        {(['paid', 'credit'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={adjustForm.payment_status === mode}
                            onClick={() => setAdjustForm(f => ({ ...f, payment_status: mode, credit_due_date: mode === 'credit' ? f.credit_due_date : '' }))}
                            className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${adjustForm.payment_status === mode
                              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                              : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                          >
                            {mode === 'credit' ? tr('on_credit', 'On credit') : tr('paid', 'Paid')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {adjustForm.payment_status === 'credit' ? (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('due_date', 'Due date')}</label>
                      <DateEntryInput
                        id="inventory-adjust-credit-due-date"
                        name="inventory_adjust_credit_due_date"
                        className="text-sm"
                        t={t}
                        ariaLabel={tr('due_date', 'Due date')}
                        value={adjustForm.credit_due_date}
                        onChange={iso => setAdjustForm(f => ({ ...f, credit_due_date: iso }))}
                      />
                      {creditDueMissing ? (
                        <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{tr('fast_stockin_credit_due', 'On-credit stock needs a due date')}</div>
                      ) : null}
                    </div>
                  ) : null}
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
              {/* The failed-submit reason sits with the values that produced
                  it, above the actions, so it survives the toast. */}
              {adjustNotice}
              <div className="hidden gap-2 pt-1 sm:flex">
                <button onClick={onAdjust} className="btn-primary flex-1 text-sm" disabled={adjustSaving}>{adjustSaving ? (t('saving') || 'Saving...') : (adjustSubmitLabel || t('save'))}</button>
                <button onClick={onCloseAdjust} className="btn-secondary text-sm" disabled={adjustSaving}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {transferModal ? (
        <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={onCloseTransfer}>
          <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('transfer', 'Transfer')}</h2>
                <div className="mt-0.5 truncate text-xs text-gray-400">{transferModal.name} - {getStockQty(transferModal)} {transferModal.unit}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={onTransfer} className="btn-primary min-h-9 max-w-24 truncate px-3 py-1.5 text-xs sm:hidden" disabled={transferSaving}>{transferSaving ? (t('saving') || 'Saving...') : tr('transfer', 'Transfer')}</button>
                <button type="button" onClick={onCloseTransfer} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                  <X className="h-4 w-4" />
                </button>
              </div>
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
              <div className="hidden gap-2 pt-1 sm:flex">
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

  if (typeof document === 'undefined') return modals
  return createPortal(modals, document.body)
}
