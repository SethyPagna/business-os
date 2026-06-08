import type { Dispatch, SetStateAction } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect'

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

type AdjustForm = {
  product_id?: InventoryId
  type: string
  quantity: InventoryFormValue
  unit_cost_usd: InventoryFormValue
  unit_cost_khr: InventoryFormValue
  reason: string
  branch_id: InventoryId | ''
}

type MoveForm = {
  mode: string
  destination_product_id: InventoryId | ''
  destination_name: string
  quantity: InventoryFormValue
  branch_id: InventoryId | ''
  reason: string
  note: string
  selling_price_usd: string
  special_price_usd: string
  discount_enabled: boolean
  discount_type: string
  discount_percent: string
  discount_amount_usd: string
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

type InventoryStockModalsProps = {
  adjustBranchSelectOptions: AppSelectOption[]
  adjustCurrentQuantity: number
  adjustForm: AdjustForm
  adjustModal: InventoryProduct | null
  adjustSaving: boolean
  adjustTargetOptions: InventoryProduct[]
  adjustTargetSelectOptions: AppSelectOption[]
  branchCount: number
  branchSelectOptions: AppSelectOption[]
  branchWithPlaceholderOptions: AppSelectOption[]
  getStockQty: (product?: InventoryProduct | null) => number
  moveDestinationProductOptions: AppSelectOption[]
  moveForm: MoveForm
  moveModal: InventoryProduct | null
  moveReasonOptions: AppSelectOption[]
  moveSaving: boolean
  onAdjust: () => void
  onCloseAdjust: () => void
  onCloseMove: () => void
  onCloseTransfer: () => void
  onMove: () => void
  onTransfer: () => void
  reasonsByType: InventoryReasonGroups
  setAdjustForm: Dispatch<SetStateAction<AdjustForm>>
  setMoveForm: Dispatch<SetStateAction<MoveForm>>
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
  adjustCurrentQuantity,
  adjustForm,
  adjustModal,
  adjustSaving,
  adjustTargetOptions,
  adjustTargetSelectOptions,
  branchCount,
  branchSelectOptions,
  branchWithPlaceholderOptions,
  getStockQty,
  moveDestinationProductOptions,
  moveForm,
  moveModal,
  moveReasonOptions,
  moveSaving,
  onAdjust,
  onCloseAdjust,
  onCloseMove,
  onCloseTransfer,
  onMove,
  onTransfer,
  reasonsByType,
  setAdjustForm,
  setMoveForm,
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
  if (!adjustModal && !transferModal && !moveModal) return null

  return (
    <>
      {adjustModal ? (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onCloseAdjust}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
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
              </div>
              {adjustForm.type === 'add' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost ({usdSymbol})</label>
                    <input
                      id="inventory-adjust-cost-usd"
                      name="inventory_adjust_cost_usd"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_usd}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_usd:e.target.value}))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost (KHR)</label>
                    <input
                      id="inventory-adjust-cost-khr"
                      name="inventory_adjust_cost_khr"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_khr}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_khr:e.target.value}))} />
                  </div>
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
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
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

      {moveModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onCloseMove}>
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('move_stock', 'Move stock')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{moveModal.name} - {getStockQty(moveModal)} {moveModal.unit}</div>
              </div>
              <button type="button" onClick={onCloseMove} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-xl border-2 py-2 text-xs font-semibold ${moveForm.mode === 'existing' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                  onClick={() => setMoveForm((current) => ({ ...current, mode: 'existing' }))}
                >
                  {tr('existing_row', 'Existing row')}
                </button>
                <button
                  type="button"
                  className={`rounded-xl border-2 py-2 text-xs font-semibold ${moveForm.mode === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                  onClick={() => setMoveForm((current) => ({ ...current, mode: 'new' }))}
                >
                  {tr('quick_create_row', 'Quick-create row')}
                </button>
              </div>

              {moveForm.mode === 'existing' ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('destination_product', 'Destination product row')}</span>
                  <AppSelect
                    value={moveForm.destination_product_id}
                    onChange={(nextValue) => setMoveForm((current) => ({ ...current, destination_product_id: nextValue }))}
                    ariaLabel={tr('destination_product', 'Destination product row')}
                    className="w-full"
                    buttonClassName="h-10 w-full text-sm"
                    menuClassName="min-w-[16rem]"
                    optionClassName="text-sm"
                    options={moveDestinationProductOptions}
                  />
                </label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('name') || 'Name'}</span>
                    <input className="input text-sm" value={moveForm.destination_name} onChange={(event) => setMoveForm((current) => ({ ...current, destination_name: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('selling_price_usd_full', 'Selling Price (USD)')}</span>
                    <input className="input text-sm" type="number" step="any" min="0" value={moveForm.selling_price_usd} onChange={(event) => setMoveForm((current) => ({ ...current, selling_price_usd: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('special_price_usd_full', 'Special Price (USD)')}</span>
                    <input className="input text-sm" type="number" step="any" min="0" value={moveForm.special_price_usd} onChange={(event) => setMoveForm((current) => ({ ...current, special_price_usd: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
                    <input type="checkbox" checked={!!moveForm.discount_enabled} onChange={(event) => setMoveForm((current) => ({ ...current, discount_enabled: event.target.checked }))} />
                    {tr('product_discount', 'Discounts')}
                  </label>
                  {moveForm.discount_enabled ? (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{moveForm.discount_type === 'fixed' ? tr('discount_amount_usd', 'Discount amount (USD)') : tr('discount_percent', 'Percent off')}</span>
                      <input className="input text-sm" type="number" step="any" min="0" value={moveForm.discount_type === 'fixed' ? moveForm.discount_amount_usd : moveForm.discount_percent} onChange={(event) => setMoveForm((current) => current.discount_type === 'fixed' ? { ...current, discount_amount_usd: event.target.value } : { ...current, discount_percent: event.target.value })} autoComplete="off" />
                    </label>
                  ) : null}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'} *</span>
                  <input className="input text-sm" type="number" step="any" min="0" value={moveForm.quantity} onChange={(event) => setMoveForm((current) => ({ ...current, quantity: event.target.value }))} autoComplete="off" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                  <AppSelect
                    value={moveForm.branch_id}
                    onChange={(nextValue) => setMoveForm((current) => ({ ...current, branch_id: nextValue }))}
                    ariaLabel={t('branch') || 'Branch'}
                    className="w-full"
                    buttonClassName="h-10 w-full text-sm"
                    menuClassName="min-w-[13rem]"
                    optionClassName="text-sm"
                    options={branchSelectOptions}
                  />
                </label>
              </div>
              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('reason') || 'Reason'}</span>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'move' })}>
                    {tr('manage_reasons', 'Manage reasons')}
                  </button>
                </div>
                <AppSelect
                  value={moveForm.reason}
                  onChange={(nextValue) => setMoveForm((current) => ({ ...current, reason: nextValue }))}
                  ariaLabel={t('reason') || 'Reason'}
                  className="w-full"
                  buttonClassName="h-10 w-full text-sm"
                  menuClassName="min-w-[13rem]"
                  optionClassName="text-sm"
                  options={moveReasonOptions}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('notes') || 'Notes'}</span>
                <textarea className="input min-h-[76px] text-sm" value={moveForm.note} onChange={(event) => setMoveForm((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onMove} className="btn-primary flex-1 text-sm" disabled={moveSaving}>{moveSaving ? (t('saving') || 'Saving...') : tr('move_stock', 'Move stock')}</button>
                <button type="button" onClick={onCloseMove} className="btn-secondary text-sm" disabled={moveSaving}>{t('cancel') || 'Cancel'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
