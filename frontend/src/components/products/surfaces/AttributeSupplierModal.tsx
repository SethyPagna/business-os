import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useCloseGuard } from '../../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../../shared/UnsavedChangesPrompt.tsx'
import SupplierPickerField, { type SupplierChoice } from '../../shared/SupplierPickerField.tsx'
import { backfillProductSupplier } from '../../../api/productWriteTransport.ts'
import { batchDisplayLabel } from '../../../utils/batchLabel.ts'
import { fmtDate } from '../../../utils/formatters'

// D5 (Part 578, item 3): attribute a supplier to a product's UNATTRIBUTED lots
// after the fact. Supplier attribution lives on the lot (migration 0062); a lot
// whose name never matched a suppliers row at receive time keeps supplier_id
// NULL and "stays linkable later" -- this modal is that later linking. The user
// picks an EXISTING supplier (a free-text name is name-only and can't be linked
// by id, so the confirm stays disabled until a suggestion is chosen -- the same
// match-only rule the import engine follows), selects which unknown lots it
// covers (all by default), and applies. The whole thing is one undoable/redoable
// action server-side (POST /:id/suppliers/backfill), surfaced by the Products
// page's ActionHistoryBar. Single close affordance (header X), per house rule.

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type UnattributedLot = {
  id: number
  lot_code: string | null
  batch_number: number | null
  received_at: string | null
  supplier_name: string | null
}

export default function AttributeSupplierModal({
  productId,
  lots,
  tr,
  notify,
  onClose,
  onDone,
}: {
  productId: number
  lots: UnattributedLot[]
  tr: TranslationWithFallback
  notify: (message: unknown, type?: string) => void
  onClose: () => void
  onDone: () => void
}) {
  const [choice, setChoice] = useState<SupplierChoice>({ supplierId: null, supplierName: '' })
  const [selected, setSelected] = useState<Set<number>>(() => new Set(lots.map((l) => l.id)))
  const [busy, setBusy] = useState(false)

  const selectedCount = selected.size
  const canApply = choice.supplierId != null && selectedCount > 0 && !busy
  const allSelected = selectedCount === lots.length && lots.length > 0

  const sortedLots = useMemo(
    () => [...lots].sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || ''))),
    [lots],
  )

  const toggleLot = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelected((prev) => (prev.size === lots.length ? new Set<number>() : new Set(lots.map((l) => l.id))))
  }

  const apply = async () => {
    if (!canApply || choice.supplierId == null) return
    setBusy(true)
    try {
      const ids = Array.from(selected)
      const result = await backfillProductSupplier(productId, choice.supplierId, ids.length === lots.length ? undefined : ids)
      if (result && result.success) {
        const n = Number(result.updated || 0)
        notify(
          tr('supplier_attributed_n', `Attributed ${n} lot(s) to ${choice.supplierName}`).replace('{n}', String(n)).replace('{name}', choice.supplierName),
          'success',
        )
        onDone()
        onClose()
      } else {
        notify(result?.error || tr('supplier_attribute_failed', 'Could not attribute the supplier.'), 'error')
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('supplier_attribute_failed', 'Could not attribute the supplier.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  // S4-21: the picked supplier is the authored bit; the lot ticks default to
  // all and are not work someone typed.
  const closeGuard = useCloseGuard(
    { dirty: choice.supplierId != null || choice.supplierName.trim().length > 0 },
    onClose,
  )
  // The backdrop and the ✕ both land here.
  const requestClose = () => { if (!busy) closeGuard.requestClose() }

  const modal = (
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1060] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={requestClose}>
      <div
        className="modal-panel-safe flex w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">
          <p className="min-w-0 truncate text-xs font-semibold text-gray-900 dark:text-white">{tr('attribute_supplier', 'Attribute supplier')}</p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={requestClose}
              aria-label={tr('close', 'Close')}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <SupplierPickerField
            value={choice}
            onChange={setChoice}
            tr={tr}
            idPrefix={`attr-supplier-${productId}`}
            hint={tr('attribute_supplier_hint', 'Pick an existing supplier to record on the lots below.')}
          />

          <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span>{tr('lots_without_supplier', 'Lots without a supplier')}</span>
            <button type="button" onClick={toggleAll} className="font-semibold text-purple-600 hover:underline dark:text-purple-300">
              {allSelected ? tr('clear_all', 'Clear all') : tr('select_all', 'Select all')}
            </button>
          </div>

          <div className="space-y-0.5 rounded-lg bg-gray-50 p-1.5 dark:bg-gray-800/50">
            {sortedLots.map((lot) => {
              const on = selected.has(lot.id)
              return (
                <label key={lot.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-gray-100 dark:hover:bg-gray-700/50">
                  <input type="checkbox" checked={on} onChange={() => toggleLot(lot.id)} className="h-3.5 w-3.5 shrink-0 accent-purple-600" />
                  <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
                    {batchDisplayLabel({ id: lot.id, lot_code: lot.lot_code, received_at: lot.received_at })}
                    {lot.supplier_name ? <span className="ml-1 text-gray-400">· {lot.supplier_name}</span> : null}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-gray-400">{lot.received_at ? fmtDate(lot.received_at) : '--'}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{selectedCount}/{lots.length} {tr('selected', 'selected')}</span>
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? tr('saving', 'Saving...') : tr('attribute', 'Attribute')}
          </button>
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>
  )

  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}
