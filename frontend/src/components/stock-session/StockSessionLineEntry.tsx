import type { RefObject } from 'react'
import Search from 'lucide-react/dist/esm/icons/search.js'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import StockReasonField from '../shared/StockReasonField.tsx'
import StockConditionTagRow from '../inventory/StockConditionTagRow.tsx'
import type { SavedStockReason } from '../../utils/useSavedStockReasons.ts'
import type { LineEntryField, StockMode, StockSessionProduct } from '../../utils/stockSessionDraft.ts'
import { IconField, InsetNumberField, INVALID_RING } from './StockSessionSharedDetails.tsx'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type CandidateGroupRow = { key: string; name: string; options: number; stock: number }

type LineEntryProps = {
  tr: Translate
  packLookup: (key: string) => string | undefined
  mode: StockMode
  busy: boolean
  // E1
  searchInputRef: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (text: string) => void
  groups: CandidateGroupRow[]
  onOpenGroup: (key: string) => void
  /** Add + products.add: the typed text a "+ Create" row would create, else null. */
  createText: string | null
  onCreate: () => void
  onScan: (value: string) => void
  picked: StockSessionProduct | null
  pickedStock: number
  pickedIsNew: boolean
  onClearPick: () => void
  // E2 / E3
  quantity: string
  onQuantity: (next: string) => void
  freeQuantity: string
  onFreeQuantity: (next: string) => void
  unitCost: string
  onUnitCost: (next: string) => void
  canViewCosts: boolean
  canEditCosts: boolean
  canReceive: boolean
  sellingPrice: string
  onSellingPrice: (next: string) => void
  canEditPrice: boolean
  expiryDate: string
  onExpiryDate: (iso: string) => void
  lotOptions: AppSelectOption[]
  lotValue: string
  onLot: (value: string) => void
  conditionTag: string
  onConditionTag: (next: string) => void
  tagDisabled: boolean
  // E4
  reason: string
  onReason: (next: string) => void
  savedReasons: SavedStockReason[]
  onManageReasons?: () => void
  onAdd: () => void
  editing: boolean
  /** Why Add cannot take this line yet (its tooltip). */
  refusal: string | null
  /** The control to ring: the receipt gate's, or any after a refused Add. */
  invalidField: LineEntryField | null
}

/** Rows E1-E4 of the Items step (spec 3.4). */
export default function StockSessionLineEntry(props: LineEntryProps) {
  const {
    tr, packLookup, mode, busy, searchInputRef, query, onQuery, groups, onOpenGroup, createText, onCreate, onScan,
    picked, pickedStock, pickedIsNew, onClearPick, quantity, onQuantity, freeQuantity, onFreeQuantity,
    unitCost, onUnitCost, canViewCosts, canEditCosts, canReceive, sellingPrice, onSellingPrice, canEditPrice,
    expiryDate, onExpiryDate, lotOptions, lotValue, onLot, conditionTag, onConditionTag, tagDisabled,
    reason, onReason, savedReasons, onManageReasons, onAdd, editing, refusal, invalidField,
  } = props
  const ring = (field: LineEntryField): boolean => invalidField === field
  const lotLabel = tr('received_date', 'Received date')
  const showList = !picked && (groups.length > 0 || createText != null)
  const lotSelect = (
    <IconField icon={CalendarDays} title={lotLabel}>
      <AppSelect
        value={lotValue}
        options={lotOptions}
        onChange={onLot}
        ariaLabel={lotLabel}
        disabled={busy || !picked || lotOptions.every((option) => option.disabled)}
        className="w-full"
        buttonClassName={`h-10 w-full pl-8 pr-1.5 text-xs sm:text-sm ${ring('lot') ? INVALID_RING : ''}`}
        optionClassName="text-sm"
      />
    </IconField>
  )
  const tagSelect = (
    <StockConditionTagRow
      variant="select"
      mode={mode === 'add' ? 'add' : 'remove'}
      value={conditionTag}
      onChange={onConditionTag}
      tr={tr}
      disabled={busy || !picked || tagDisabled}
      id="stock-session-condition-tag"
    />
  )

  return (
    <div className="space-y-1.5" data-stock-session-entry={mode}>
      {/* E1 */}
      {picked ? (
        <div className="flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/60 py-1 pl-2.5 pr-1 text-sm dark:border-blue-800 dark:bg-blue-900/20">
          <span className="min-w-0 flex-1 break-words font-medium text-gray-900 dark:text-gray-100">
            {String(picked.name || `#${picked.id}`)}
            {pickedIsNew ? <span className="ml-1.5 inline-block rounded bg-emerald-100 px-1 align-middle text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{tr('stock_session_new_product', 'New')}</span> : null}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">{tr('stock', 'Stock')} {pickedStock}</span>
          <button type="button" disabled={busy} onClick={onClearPick} aria-label={tr('clear', 'Clear')} title={tr('clear', 'Clear')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <IconField icon={Search} title={tr('stock_session_search', 'Product or barcode')} className="flex-1">
            <input
              ref={searchInputRef}
              className={`input h-10 w-full min-w-0 pl-8 text-sm ${ring('product') ? INVALID_RING : ''}`}
              placeholder={tr('stock_session_search', 'Product or barcode')}
              aria-label={tr('stock_session_search', 'Product or barcode')}
              value={query}
              disabled={busy}
              onChange={(event) => onQuery(event.target.value)}
              autoComplete="off"
            />
            {showList ? (
              <div role="listbox" aria-label={tr('stock_session_search', 'Product or barcode')} className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(15rem,45vh)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800">
                {groups.map((group) => (
                  <button key={group.key} type="button" role="option" aria-selected={false} onClick={() => onOpenGroup(group.key)} className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20">
                    <span className="min-w-0 break-words text-gray-800 dark:text-gray-200">{group.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{group.options > 1 ? `${group.options} · ` : ''}{group.stock}</span>
                  </button>
                ))}
                {createText != null ? (
                  <button type="button" role="option" aria-selected={false} onClick={onCreate} className="flex min-h-10 w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-gray-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20">
                    <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{tr('create_named_product', 'Create "{name}"').replace('{name}', createText)}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </IconField>
          <ScanSearchButton onDetected={onScan} t={(key) => tr(key, key)} title={tr('scan_product_for_stock_in', 'Scan product for this stock-in')} />
        </div>
      )}

      {/* E2 (+ E3 for Add) */}
      {mode === 'add' ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-1.5">
            <InsetNumberField label={tr('stock_line_qty', 'Qty')} value={quantity} onChange={onQuantity} disabled={busy || !canReceive} invalid={ring('qty')} onEnter={onAdd} />
            <InsetNumberField label={tr('stock_receipt_free_goods', 'Free')} value={freeQuantity} onChange={onFreeQuantity} disabled={busy || !canReceive} invalid={ring('free')} placeholder="0" onEnter={onAdd} />
            {canViewCosts || canEditCosts ? (
              <InsetNumberField label={tr('cost', 'Cost')} value={unitCost} onChange={onUnitCost} step="0.0001" disabled={busy || !canEditCosts || !canReceive} invalid={ring('cost')} onEnter={onAdd} />
            ) : (
              <div className="relative flex h-10 min-w-0 items-end justify-end rounded-lg border border-gray-200 bg-gray-50 px-2 pb-1.5 text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900/40" aria-disabled="true" title={tr('cost', 'Cost')}>
                <span className="absolute left-2 top-1 text-[9px] leading-none">{tr('cost', 'Cost')}</span>—
              </div>
            )}
            <InsetNumberField label={tr('price', 'Price')} value={sellingPrice} onChange={onSellingPrice} step="0.01" disabled={busy || !picked || !canEditPrice} invalid={ring('price')} onEnter={onAdd} />
          </div>
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] gap-1.5">
            {lotSelect}
            <IconField icon={CalendarClock} title={tr('expiry', 'Expiry')}>
              <DateEntryInput
                className="h-10 w-full pl-8 text-xs sm:text-sm"
                t={packLookup}
                ariaLabel={tr('expiry', 'Expiry')}
                placeholder={tr('expiry', 'Expiry')}
                disabled={busy || !picked}
                value={expiryDate}
                onChange={onExpiryDate}
              />
            </IconField>
            {tagSelect}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] gap-1.5">
          {lotSelect}
          <InsetNumberField
            label={mode === 'set' ? tr('set_to', 'Set to') : tr('stock_line_qty', 'Qty')}
            value={quantity}
            onChange={onQuantity}
            disabled={busy}
            invalid={ring('qty')}
            onEnter={onAdd}
          />
          {tagSelect}
        </div>
      )}

      {/* E4 */}
      <StockReasonField
        variant="compact"
        id="stock-session-reason"
        label={tr('reason', 'Reason')}
        ariaLabel={tr('reason', 'Reason')}
        placeholder={tr('reason', 'Reason')}
        value={reason}
        onChange={onReason}
        onEnter={onAdd}
        savedReasons={savedReasons}
        onManage={onManageReasons}
        manageLabel={tr('manage_reasons', 'Manage reasons')}
        trailing={(
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            aria-disabled={refusal ? true : undefined}
            title={refusal || undefined}
            className={`btn-primary h-10 w-16 shrink-0 px-2 text-sm ${refusal ? 'opacity-50' : ''}`}
          >
            {editing ? tr('save', 'Save') : tr('add', 'Add')}
          </button>
        )}
      />
    </div>
  )
}
