import { memo, useState } from 'react'
import Modal from '../shared/Modal'
import { stockConditionLabel } from '../../utils/stockCondition.ts'
import { disposeTaggedLot, restoreTaggedLot, type TaggedLotGroup } from '../../api/damagedLotsTransport.ts'

// P3-L6. The TAGGED child row: units the owner chose to keep inside the
// product group instead of destroying ("Make it option chooseable to keep in
// group with tag or remove entiriely"), one row per (product, tag, branch).
//
// Three rules this file exists to hold in one place:
//
//  1. The row is INSIDE the group and OUTSIDE the group's sellable totals.
//     These units are not in branch_stock, so productGrouping.ts -- which
//     builds every group total, every picker list and POS's own product rows
//     from product records -- cannot see them at all. The exclusion is
//     structural, not a filter; the row is rendered beside a group's rows from
//     its own fetch, and is labelled "Not sellable" so the number on screen is
//     never mistaken for stock that can be sold.
//  2. The tag text is the raw English constant in every language (the owner:
//     "the tag remains english even in khmer"). stockConditionLabel returns
//     the token itself; nothing here routes it through tr().
//  3. The two row actions are the two directions out of the held state:
//     "Remove entirely" destroys the units and books the loss at cost, and
//     "Restore to sellable" is the exact reversal of having kept them. Both
//     require a reason, like every other stock change.

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type TaggedStockRow = TaggedLotGroup

export type TaggedStockAction = { row: TaggedStockRow; kind: 'dispose' | 'restore' }

function ActionButtons({ row, tr, canWrite, onAction, compact }: {
  row: TaggedStockRow
  tr: Translate
  canWrite: boolean
  onAction: (action: TaggedStockAction) => void
  compact?: boolean
}) {
  if (!canWrite) return null
  const size = compact
    ? 'h-6 px-1.5 text-[10px]'
    : 'h-7 px-2 text-[11px]'
  const base = `inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border font-medium transition-colors ${size}`
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={`${base} border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`}
        onClick={(event) => { event.stopPropagation(); onAction({ row, kind: 'restore' }) }}
      >
        {tr('stock_tagged_restore', 'Restore to sellable', 'ស្តារទៅជាទំនិញលក់បាន')}
      </button>
      <button
        type="button"
        className={`${base} border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50`}
        onClick={(event) => { event.stopPropagation(); onAction({ row, kind: 'dispose' }) }}
      >
        {tr('stock_remove_entirely', 'Remove entirely', 'ដកចេញទាំងស្រុង')}
      </button>
    </div>
  )
}

function TagPill({ row }: { row: TaggedStockRow }) {
  return (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
      {/* Raw English constant -- see the file header. */}
      {stockConditionLabel(row.condition_tag)}
    </span>
  )
}

/** Desktop: an ordinary child <tr> in the products table, so the excel-style
 *  columns line up with the sellable rows above it. Only the name rail, the
 *  branch and the quantity carry content -- a held row has no price, no margin
 *  and no catalog identity of its own. */
function TaggedStockDesktopRowComponent({ row, tr, canWrite, onAction, selectionModeActive }: {
  row: TaggedStockRow
  tr: Translate
  canWrite: boolean
  onAction: (action: TaggedStockAction) => void
  selectionModeActive: boolean
}) {
  return (
    <tr className="table-row bg-orange-50/40 dark:bg-orange-950/10" data-tagged-stock-row={row.condition_tag}>
      <td className={`${selectionModeActive ? 'px-2' : 'px-0'} py-2`} />
      <td className="px-2 py-2" />
      <td className="px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TagPill row={row} />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {tr('stock_tagged_not_sellable', 'Not sellable', 'លក់មិនបាន')}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{row.branch_name || ''}</td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2" />
      <td className="px-3 py-2" />
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="tabular-nums text-sm font-semibold text-orange-700 dark:text-orange-300">{row.quantity}</span>
          <ActionButtons row={row} tr={tr} canWrite={canWrite} onAction={onAction} compact />
        </div>
      </td>
    </tr>
  )
}

/** Memoized: this row's own re-render is gated on its own props, not on
 *  every unrelated Products.tsx state change re-invoking the .map() that
 *  builds it (see hotRowMemoBoundaries.test.ts's ProductCard precedent). */
export const TaggedStockDesktopRow = memo(TaggedStockDesktopRowComponent)

/** Small screens: the same row as a card inside the group card. */
function TaggedStockMobileCardComponent({ row, tr, canWrite, onAction }: {
  row: TaggedStockRow
  tr: Translate
  canWrite: boolean
  onAction: (action: TaggedStockAction) => void
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 border-t border-orange-100 bg-orange-50/50 px-3 py-2 dark:border-orange-900/40 dark:bg-orange-950/20"
      data-tagged-stock-row={row.condition_tag}
    >
      <TagPill row={row} />
      <span className="min-w-0 flex-1 detail-scroll-text text-[11px] text-gray-500 dark:text-gray-400">
        {[row.branch_name, tr('stock_tagged_not_sellable', 'Not sellable', 'លក់មិនបាន')].filter(Boolean).join(' · ')}
      </span>
      <span className="tabular-nums text-sm font-semibold text-orange-700 dark:text-orange-300">{row.quantity}</span>
      <ActionButtons row={row} tr={tr} canWrite={canWrite} onAction={onAction} />
    </div>
  )
}

export const TaggedStockMobileCard = memo(TaggedStockMobileCardComponent)

/**
 * The one dialog both actions share. Quantity defaults to the whole held row
 * (the common case) and is capped at it client-side; the Worker re-reads the
 * held lots and refuses anyway, so a stale page cannot over-apply. A reason is
 * mandatory on both, exactly as it is for every other stock change.
 */
export function TaggedStockActionModal({ action, tr, notify, onClose, onDone }: {
  action: TaggedStockAction
  tr: Translate
  notify: (message: string, kind?: string) => void
  onClose: () => void
  onDone: () => void
}) {
  const { row, kind } = action
  const held = Math.max(0, Number(row.quantity) || 0)
  const [quantity, setQuantity] = useState(String(held))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const tag = stockConditionLabel(row.condition_tag)
  const title = kind === 'dispose'
    ? tr('stock_remove_entirely', 'Remove entirely', 'ដកចេញទាំងស្រុង')
    : tr('stock_tagged_restore', 'Restore to sellable', 'ស្តារទៅជាទំនិញលក់បាន')

  const submit = async () => {
    if (saving) return
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      notify(tr('fast_stockin_qty', 'Quantity must be at least 1'), 'error'); return
    }
    if (qty > held) { notify(tr('stock_tagged_quantity_over', 'More than the held quantity', 'លើសពីបរិមាណដែលរក្សាទុក'), 'error'); return }
    if (!reason.trim()) { notify(tr('reason_required', 'A reason is required'), 'error'); return }
    setSaving(true)
    try {
      const payload = {
        productId: row.product_id,
        branchId: Number(row.branch_id),
        conditionTag: tag,
        quantity: qty,
        reason: reason.trim(),
      }
      await (kind === 'dispose' ? disposeTaggedLot(payload) : restoreTaggedLot(payload))
      notify(kind === 'dispose'
        ? tr('stock_tagged_dispose_done', 'Removed from tagged stock', 'បានដកចេញពីស្តុកមានស្លាក')
        : tr('stock_tagged_restore_done', 'Restored to sellable stock', 'បានស្តារទៅស្តុកលក់បាន'))
      onDone()
      onClose()
    } catch (error) {
      // The dialog STAYS open with everything typed intact -- the standing
      // rule for a failed stock action.
      notify(error instanceof Error ? error.message : tr('error', 'Error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${title} — ${tag}`}
      onClose={onClose}
      size="sm"
      // Only the typed reason can be lost, and it cannot outlive this dialog.
      unsavedChanges={{ dirty: reason.trim().length > 0 }}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="font-medium">{row.product_name || `#${row.product_id}`}</span>
          {row.branch_name ? <span className="text-gray-400">· {row.branch_name}</span> : null}
          <span className="text-gray-400">· {held}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</span>
          <input
            type="number"
            min={1}
            max={held}
            step="1"
            className="input text-sm"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('reason', 'Reason')} *</span>
          <input
            type="text"
            className="input text-sm"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {tr('stock_tagged_excluded_hint', 'Held stock: counted here but never in the group stock total, and never offered to a sale.', 'ស្តុករក្សាទុក៖ រាប់នៅទីនេះ ប៉ុន្តែមិនរាប់ក្នុងស្តុកសរុបរបស់ក្រុម និងមិនអាចលក់បានទេ។')}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary px-3 text-xs" disabled={saving} onClick={onClose}>
            {tr('cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className={`${kind === 'dispose' ? 'btn-danger' : 'btn-primary'} px-3 text-xs`}
            disabled={saving}
            onClick={() => { void submit() }}
          >
            {title}
          </button>
        </div>
      </div>
    </Modal>
  )
}
