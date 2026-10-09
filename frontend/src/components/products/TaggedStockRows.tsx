import { memo, useEffect, useRef, useState } from 'react'
import Eraser from 'lucide-react/dist/esm/icons/eraser.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import Modal from '../shared/Modal'
import IconButton from '../shared/kit/IconButton.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { useModalClose } from '../shared/modalCloseContext.ts'
import { stockConditionLabel } from '../../utils/stockCondition.ts'
import { disposeTaggedLot, restoreTaggedLot, type TaggedLotChange, type TaggedLotGroup } from '../../api/damagedLotsTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { stockFailureText, stockLineNeedsRemoval } from '../../utils/stockAdjustOutcome.ts'
import { assertActorSessionDispatchAllowed, captureActorReadScope, isActorReadScopeCurrent } from '../../api/actorReadScope.ts'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string
const ACTION_BUTTON_CLASS = `${toolbarIconButtonClassName} !h-10 !w-10`

export type TaggedStockRow = TaggedLotGroup

export type TaggedStockAction = { row: TaggedStockRow; kind: 'dispose' | 'restore' }

function ActionButtons({ row, tr, canWrite, onAction }: {
  row: TaggedStockRow
  tr: Translate
  canWrite: boolean
  onAction: (action: TaggedStockAction) => void
}) {
  if (!canWrite) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        label={tr('stock_tagged_restore', 'Clear tag', 'លុបស្លាក')}
        icon={<Eraser className="h-4 w-4" />}
        className={ACTION_BUTTON_CLASS}
        onClick={(event) => { event.stopPropagation(); onAction({ row, kind: 'restore' }) }}
      />
      <IconButton
        label={tr('stock_remove_entirely', 'Remove entirely', 'ដកចេញទាំងស្រុង')}
        icon={<Trash2 className="h-4 w-4" />}
        className={`${ACTION_BUTTON_CLASS} !text-red-700 dark:!text-red-300`}
        onClick={(event) => { event.stopPropagation(); onAction({ row, kind: 'dispose' }) }}
      />
    </div>
  )
}

function TagPill({ row }: { row: TaggedStockRow }) {
  return (
    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
      {stockConditionLabel(row.condition_tag)}
    </span>
  )
}

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
            {tr('stock_tagged_sellable', 'Sell with this tag', 'លក់ជាមួយស្លាកនេះ')}
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
          <ActionButtons row={row} tr={tr} canWrite={canWrite} onAction={onAction} />
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
        {[row.branch_name, tr('stock_tagged_sellable', 'Sell with this tag', 'លក់ជាមួយស្លាកនេះ')].filter(Boolean).join(' · ')}
      </span>
      <span className="tabular-nums text-sm font-semibold text-orange-700 dark:text-orange-300">{row.quantity}</span>
      <ActionButtons row={row} tr={tr} canWrite={canWrite} onAction={onAction} />
    </div>
  )
}

export const TaggedStockMobileCard = memo(TaggedStockMobileCardComponent)

function CancelAction({ tr, onClose, disabled }: { tr: Translate; onClose: () => void; disabled: boolean }) {
  const requestClose = useModalClose(onClose)
  return <IconButton label={tr('cancel', 'Cancel')} icon={<X className="h-4 w-4" />} className={ACTION_BUTTON_CLASS} disabled={disabled} onClick={requestClose} />
}

export function TaggedStockActionModal({ action, tr, notify, onClose, onDone }: {
  action: TaggedStockAction
  tr: Translate
  notify: (message: string, kind?: string) => void
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { row, kind } = action
  const held = Math.max(0, Number(row.quantity) || 0)
  const [quantity, setQuantity] = useState(String(held))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Readonly<TaggedLotChange> | null>(null)
  const [retryBlocked, setRetryBlocked] = useState(false)
  const [scope] = useState(() => captureActorReadScope())
  const busy = useRef(false)
  const mounted = useRef(true)
  const reasonInput = useRef<HTMLInputElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [requestId] = useState(() => createClientRequestId('tagged'))
  const tag = stockConditionLabel(row.condition_tag)
  const title = kind === 'dispose'
    ? tr('stock_remove_entirely', 'Remove entirely', 'ដកចេញទាំងស្រុង')
    : tr('stock_tagged_restore', 'Clear tag', 'លុបស្លាក')

  const refreshRows = () => {
    void Promise.resolve().then(() => { if (isActorReadScopeCurrent(scope, false)) return onDone() }).catch(() => {
      if (isActorReadScopeCurrent(scope, false)) notify(tr('stock_tagged_refresh_failed', 'Refresh Products to see the latest stock.'), 'error')
    })
  }

  const submit = async () => {
    if (busy.current || retryBlocked) return
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      notify(tr('invalid_quantity', 'Invalid quantity'), 'error'); return
    }
    if (qty > held) { notify(tr('stock_tagged_quantity_over', 'More than the tagged quantity', 'លើសពីបរិមាណមានស្លាក'), 'error'); return }
    if (!reason.trim()) { notify(tr('reason_required', 'A reason is required'), 'error'); return }
    busy.current = true
    setSaving(true)
    let committed = false
    try {
      assertActorSessionDispatchAllowed(scope)
      const payload = pending || Object.freeze({
        productId: row.product_id,
        branchId: Number(row.branch_id),
        conditionTag: tag,
        quantity: qty,
        reason: reason.trim(),
        client_request_id: requestId,
      })
      setPending(payload)
      const response = await (kind === 'dispose' ? disposeTaggedLot(payload) : restoreTaggedLot(payload)) as Record<string, unknown> | null
      if (!mounted.current || !isActorReadScopeCurrent(scope, false)) return
      if (!response || response.success !== true || response.productId !== Number(payload.productId)
        || response.conditionTag !== payload.conditionTag || response.quantity !== payload.quantity
        || !Number.isSafeInteger(response.branchId) || Number(response.branchId) <= 0) {
        throw { code: 'stock_request_outcome_unknown' }
      }
      committed = true
    } catch (error) {
      if (!mounted.current || !isActorReadScopeCurrent(scope, false)) return
      const detail = error as { code?: unknown; status?: unknown; outcome?: unknown } | null
      const code = String(detail?.code || '')
      const refused = detail?.outcome === 'not_dispatched' || (detail?.status === 409 && code === 'tagged_lot_conflict')
      if (!pending && refused) setPending(null)
      if (stockLineNeedsRemoval(error)) setRetryBlocked(true)
      notify(stockFailureText(error, tr, tr('error', 'Error')), 'error')
      if (code === 'tagged_lot_conflict' || stockLineNeedsRemoval(error)) refreshRows()
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
    if (committed) {
      onClose()
      notify(kind === 'dispose'
        ? tr('stock_tagged_dispose_done', 'Removed from tagged stock', 'បានដកចេញពីស្តុកមានស្លាក')
        : tr('stock_tagged_restore_done', 'Tag cleared; physical stock unchanged', 'បានលុបស្លាក។ ស្តុកសរុបមិនផ្លាស់ប្ដូរ។'))
      refreshRows()
    }
  }

  return (
    <Modal
      title={`${title} — ${tag}`}
      onClose={onClose}
      size="sm"
      keyboard
      closeDisabled={saving}
      unsavedChanges={{ dirty: !!pending || reason.trim().length > 0 || quantity !== String(held) }}
    >
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="font-medium">{row.product_name || `#${row.product_id}`}</span>
          {row.branch_name ? <span className="text-gray-400">· {row.branch_name}</span> : null}
          <span className="text-gray-400">· {held}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('quantity', 'Qty')}</span>
          <input
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            min={0}
            max={held}
            step="any"
            required
            disabled={saving || !!pending}
            className="input text-base md:text-sm"
            value={quantity}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); reasonInput.current?.focus() } }}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('reason', 'Reason')} *</span>
          <input
            type="text"
            ref={reasonInput}
            enterKeyHint="done"
            maxLength={500}
            required
            disabled={saving || !!pending}
            className="input text-base md:text-sm"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {tr('stock_tagged_included_hint', 'Tagged stock is included in physical stock. Clearing a tag leaves physical quantity unchanged.', 'ស្តុកដែលមានស្លាករាប់ក្នុងស្តុកសរុប។ លុបស្លាកមិនផ្លាស់ប្តូរចំនួនសរុបទេ។')}
        </p>
        {pending && !saving ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{retryBlocked
          ? tr('stock_tagged_check_history', 'This request cannot be retried. Check Stock Changes before closing.')
          : tr('stock_tagged_pending', 'This request may already be saved. Retry the same details, or check Stock Changes before closing.')}</p> : null}
        <div className="flex justify-end gap-2">
          <CancelAction tr={tr} onClose={onClose} disabled={saving} />
          <IconButton type="submit" label={pending ? tr('retry', 'Retry') : title}
            icon={kind === 'dispose' ? <Trash2 className="h-4 w-4" /> : <Eraser className="h-4 w-4" />}
            className={`${ACTION_BUTTON_CLASS} ${kind === 'dispose' ? '!text-red-700 dark:!text-red-300' : '!text-blue-700 dark:!text-blue-300'}`} loading={saving} disabled={retryBlocked} />
        </div>
      </form>
    </Modal>
  )
}
