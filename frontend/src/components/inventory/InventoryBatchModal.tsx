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
}

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type InventoryReasonGroups = Record<InventoryReasonType, InventoryReason[]>

type InventoryBatchLine = Record<string, any> & {
  productId: InventoryId
  action: string
  quantity: InventoryFormValue
  reason?: string
  productName?: string
  stockQty?: number
  unit?: string
  error?: string
  adjustType?: string
  branchId?: InventoryId | ''
  fromBranchId?: InventoryId | ''
  toBranchId?: InventoryId | ''
  moveMode?: string
  destinationProductId?: InventoryId | ''
  destinationName?: string
}

type InventoryBatch = {
  items: InventoryBatchLine[]
} | null

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type InventoryBatchModalProps = {
  batchApplying: boolean
  branchSelectOptions: AppSelectOption[]
  branchWithPlaceholderOptions: AppSelectOption[]
  inventoryBatch: InventoryBatch
  moveReasonOptions: AppSelectOption[]
  onApply: () => void
  onClose: () => void
  onRemoveLine: (productId: InventoryId) => void
  onUpdateLine: (productId: InventoryId, patch: Partial<InventoryBatchLine>) => void
  reasonsByType: InventoryReasonGroups
  setReasonManager: Dispatch<SetStateAction<ReasonManagerState>>
  summary: InventoryProduct[]
  t: Translator
  tr: TranslationWithFallback
}

function buildDestinationProductOptions(products: InventoryProduct[] = [], excludedProductId: InventoryId | undefined, placeholder: string): AppSelectOption[] {
  const excludedId = Number(excludedProductId)
  const options: AppSelectOption[] = [{ value: '', label: placeholder }]
  for (const product of products) {
    const id = Number(product?.id)
    if (Number.isFinite(excludedId) && id === excludedId) continue
    options.push({ value: String(product.id), label: product.name || String(product.id) })
  }
  return options
}

export default function InventoryBatchModal({
  batchApplying,
  branchSelectOptions,
  branchWithPlaceholderOptions,
  inventoryBatch,
  moveReasonOptions,
  onApply,
  onClose,
  onRemoveLine,
  onUpdateLine,
  reasonsByType,
  setReasonManager,
  summary,
  t,
  tr,
}: InventoryBatchModalProps) {
  if (!inventoryBatch?.items?.length) return null

  const closeIfIdle = () => {
    if (!batchApplying) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="flex max-h-modal-92 w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-5xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('inventory_batch_session', 'Batch session')}</h2>
            <div className="mt-0.5 text-xs text-gray-400">
              {tr(
                'inventory_batch_session_desc',
                'Review each selected product, then apply all stock changes together.',
              )}
            </div>
          </div>
          <button type="button" onClick={closeIfIdle} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" disabled={batchApplying}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-scroll space-y-3 p-4">
          {inventoryBatch.items.map((item) => (
            <div key={item.productId} className="rounded-2xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {tr('current_stock', 'Current stock')} {item.stockQty} {item.unit || ''}
                  </div>
                  {item.error ? (
                    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                      {item.error}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <AppSelect
                    value={item.action}
                    onChange={(nextValue) => onUpdateLine(item.productId, { action: nextValue, reason: '' })}
                    ariaLabel={t('action') || 'Action'}
                    className="w-32"
                    buttonClassName="h-8 w-full px-2 py-1 text-xs"
                    menuClassName="min-w-[9rem]"
                    optionClassName="text-xs"
                    options={[
                      { value: 'adjust', label: tr('adjust_stock', 'Adjust stock') },
                      { value: 'transfer', label: tr('transfer', 'Transfer') },
                      { value: 'move', label: tr('move_stock', 'Move stock') },
                    ]}
                  />
                  <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30" onClick={() => onRemoveLine(item.productId)} disabled={batchApplying}>
                    {t('remove') || 'Remove'}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-12">
                <label className="block lg:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'}</span>
                  <input className="input text-sm" type="number" min="0" step="any" value={item.quantity} onChange={(event) => onUpdateLine(item.productId, { quantity: event.target.value })} autoComplete="off" />
                </label>

                {item.action === 'adjust' ? (
                  <>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('action') || 'Action'}</span>
                      <AppSelect
                        value={item.adjustType || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { adjustType: nextValue })}
                        ariaLabel={t('action') || 'Action'}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[8rem]"
                        optionClassName="text-sm"
                        options={[
                          { value: 'add', label: t('add') || 'Add' },
                          { value: 'remove', label: t('remove') || 'Remove' },
                          { value: 'set', label: t('set') || 'Set' },
                        ]}
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                      <AppSelect
                        value={item.branchId || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { branchId: nextValue })}
                        ariaLabel={t('branch') || 'Branch'}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[13rem]"
                        optionClassName="text-sm"
                        options={branchSelectOptions}
                      />
                    </label>
                  </>
                ) : null}

                {item.action === 'transfer' ? (
                  <>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch')}</span>
                      <AppSelect
                        value={item.fromBranchId || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { fromBranchId: nextValue })}
                        ariaLabel={tr('source_branch', 'Source branch')}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[13rem]"
                        optionClassName="text-sm"
                        options={branchWithPlaceholderOptions}
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch')}</span>
                      <AppSelect
                        value={item.toBranchId || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { toBranchId: nextValue })}
                        ariaLabel={tr('destination_branch', 'Destination branch')}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[13rem]"
                        optionClassName="text-sm"
                        options={branchWithPlaceholderOptions}
                      />
                    </label>
                  </>
                ) : null}

                {item.action === 'move' ? (
                  <>
                    <div className="lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_row', 'Destination row')}</span>
                      <div className="flex gap-1">
                        <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'existing' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => onUpdateLine(item.productId, { moveMode: 'existing' })}>{tr('existing_row', 'Existing')}</button>
                        <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => onUpdateLine(item.productId, { moveMode: 'new' })}>{tr('new_row', 'New row')}</button>
                      </div>
                    </div>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                      <AppSelect
                        value={item.branchId || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { branchId: nextValue })}
                        ariaLabel={t('branch') || 'Branch'}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[13rem]"
                        optionClassName="text-sm"
                        options={branchSelectOptions}
                      />
                    </label>
                    {item.moveMode === 'existing' ? (
                      <label className="block lg:col-span-4">
                        <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_product', 'Destination product row')}</span>
                        <AppSelect
                          value={item.destinationProductId || ''}
                          onChange={(nextValue) => onUpdateLine(item.productId, { destinationProductId: nextValue })}
                          ariaLabel={tr('destination_product', 'Destination product row')}
                          className="w-full"
                          buttonClassName="h-10 w-full text-sm"
                          menuClassName="min-w-[16rem]"
                          optionClassName="text-sm"
                          options={buildDestinationProductOptions(summary, item.productId, tr('choose_destination_product', 'Choose a destination product row'))}
                        />
                      </label>
                    ) : (
                      <label className="block lg:col-span-4">
                        <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('name') || 'Name'}</span>
                        <input className="input text-sm" value={item.destinationName} onChange={(event) => onUpdateLine(item.productId, { destinationName: event.target.value })} autoComplete="off" />
                      </label>
                    )}
                  </>
                ) : null}

                <label className="block lg:col-span-4">
                  <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    <span>{t('reason') || 'Reason'}</span>
                    <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: item.action === 'move' ? 'move' : item.action === 'transfer' ? 'transfer' : 'adjust' })}>
                      {tr('manage_reasons', 'Manage reasons')}
                    </button>
                  </span>
                  <div className="space-y-2">
                    {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).length ? (
                      <div className="flex flex-wrap gap-1">
                        {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                            onClick={() => onUpdateLine(item.productId, { reason: entry.label })}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {item.action === 'move' ? (
                      <AppSelect
                        value={item.reason || ''}
                        onChange={(nextValue) => onUpdateLine(item.productId, { reason: nextValue })}
                        ariaLabel={t('reason') || 'Reason'}
                        className="w-full"
                        buttonClassName="h-10 w-full text-sm"
                        menuClassName="min-w-[13rem]"
                        optionClassName="text-sm"
                        options={moveReasonOptions}
                      />
                    ) : (
                      <textarea className="input min-h-[80px] text-sm" value={item.reason} onChange={(event) => onUpdateLine(item.productId, { reason: event.target.value })} placeholder={t('reason') || 'Reason'} />
                    )}
                  </div>
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {inventoryBatch.items.length} {t('products') || 'products'}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={batchApplying}>
              {t('cancel') || 'Cancel'}
            </button>
            <button type="button" className="btn-primary text-sm" onClick={onApply} disabled={batchApplying || !inventoryBatch.items.length}>
              {batchApplying ? (t('saving') || 'Saving...') : tr('apply_changes', 'Apply changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
