import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'

type TranslateFn = (key: string) => string | undefined

export type SaleCancelPayload = {
  cancel_reason: 'mistake' | 'buyer_refused' | 'other'
  cancel_note?: string
  cancel_fee_usd?: number
  cancel_fee_khr?: number
  cancel_fee_note?: string
}

type CancelSaleModalProps = {
  // What is being cancelled -- a receipt number for a single sale, or a
  // "N sales" label for a bulk cancel.
  label: string
  // Bulk mode hides the lost-fee inputs: a lost fee is a per-sale fact
  // (each fee row links to ONE sale), so it is only offered when
  // cancelling a single sale.
  bulk?: boolean
  saving?: boolean
  onClose: () => void
  onConfirm: (payload: SaleCancelPayload) => void
  t: TranslateFn
}

// Cancelling a sale is a corrective action, not a status flip (Part 383):
// the backend refuses it without a reason, adds the stock back with a
// movement note naming the cancellation, and records the optional lost
// fee (e.g. a delivery fee already paid out that the buyer refused to
// cover) as a linked expense row on the Expenses page.
export default function CancelSaleModal({ label, bulk = false, saving = false, onClose, onConfirm, t }: CancelSaleModalProps) {
  const [reason, setReason] = useState<'' | 'mistake' | 'buyer_refused' | 'other'>('')
  const [note, setNote] = useState('')
  const [feeUsd, setFeeUsd] = useState('')
  const [feeKhr, setFeeKhr] = useState('')
  const [feeNote, setFeeNote] = useState('')

  useEffect(() => {
    setReason('')
    setNote('')
    setFeeUsd('')
    setFeeKhr('')
    setFeeNote('')
  }, [label])

  const tr = (key: string, fallback: string): string => t(key) || fallback

  const reasonOptions = [
    ['mistake', tr('cancel_reason_mistake', 'Mistake')],
    ['buyer_refused', tr('cancel_reason_buyer_refused', "Buyer didn't buy")],
    ['other', tr('cancel_reason_other', 'Other')],
  ] as const

  const noteRequired = reason === 'other'
  const canConfirm = !!reason && (!noteRequired || note.trim().length > 0) && !saving

  // S4-21: the reason and the lost-fee figures are typed once and are the
  // only record of WHY a sale was cancelled -- worth an ask before the
  // backdrop throws them away.
  const cancelDirty = Boolean(reason)
    || note.trim().length > 0
    || feeUsd.trim().length > 0
    || feeKhr.trim().length > 0
    || feeNote.trim().length > 0
  const closeGuard = useCloseGuard({ dirty: cancelDirty }, onClose)
  // The backdrop, the ✕ and the footer Cancel all land here.
  const closeIfIdle = () => {
    if (!saving) closeGuard.requestClose()
  }

  const confirm = () => {
    if (!canConfirm || !reason) return
    const payload: SaleCancelPayload = { cancel_reason: reason }
    if (note.trim()) payload.cancel_note = note.trim()
    if (!bulk) {
      const usd = Number(feeUsd)
      const khr = Number(feeKhr)
      if (Number.isFinite(usd) && usd > 0) payload.cancel_fee_usd = usd
      if (Number.isFinite(khr) && khr > 0) payload.cancel_fee_khr = khr
      if (feeNote.trim()) payload.cancel_fee_note = feeNote.trim()
    }
    onConfirm(payload)
  }

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" onClick={closeIfIdle}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white">{tr('cancel_sale_title', 'Cancel sale')}</h2>
            <div className="mt-0.5 truncate text-xs text-gray-400">{label}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={closeIfIdle} className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" disabled={saving}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="modal-scroll space-y-3 p-4">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('cancel_reason_label', 'Why is it cancelled?')}</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs font-medium dark:border-gray-600">
              {reasonOptions.map(([value, optionLabel], index) => (
                <button
                  key={value}
                  type="button"
                  className={`px-3 py-1.5 ${index > 0 ? 'border-l border-gray-200 dark:border-gray-600' : ''} ${reason === value ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                  onClick={() => setReason(value)}
                >
                  {optionLabel}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
              {noteRequired ? tr('cancel_note_required', 'What happened? (required)') : tr('notes', 'Notes')}
            </span>
            <textarea
              className="input min-h-[64px] w-full text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr('cancel_note_placeholder', 'Optional details')}
            />
          </label>
          {!bulk ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
              <div className="text-[11px] font-medium text-amber-800 dark:text-amber-200">{tr('cancel_lost_fee', 'Money lost on this sale (optional)')}</div>
              <div className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
                {tr('cancel_lost_fee_hint', 'e.g. a delivery fee already paid that the buyer refused to cover. Recorded as an expense on the Expenses page.')}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-gray-500">USD</span>
                  <input className="input w-full text-sm" type="number" min="0" step="any" inputMode="decimal" value={feeUsd} onChange={(event) => setFeeUsd(event.target.value)} placeholder="0.00" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-gray-500">KHR</span>
                  <input className="input w-full text-sm" type="number" min="0" step="100" inputMode="numeric" value={feeKhr} onChange={(event) => setFeeKhr(event.target.value)} placeholder="0" />
                </label>
              </div>
              <input
                className="input mt-2 w-full text-sm"
                value={feeNote}
                onChange={(event) => setFeeNote(event.target.value)}
                placeholder={tr('cancel_fee_note_placeholder', 'What this fee was (e.g. delivery to buyer)')}
              />
            </div>
          ) : (
            <div className="text-[11px] text-gray-400">
              {tr('cancel_bulk_fee_hint', 'Lost fees are per sale -- cancel a sale on its own to record one.')}
            </div>
          )}
          <div className="text-[11px] text-gray-400">
            {tr('cancel_stock_hint', 'Anything not already returned goes back into stock, with a movement note naming this cancellation.')}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button type="button" className="btn-secondary text-sm" onClick={closeIfIdle} disabled={saving}>
            {tr('keep_sale', 'Keep sale')}
          </button>
          <button
            type="button"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={confirm}
            disabled={!canConfirm}
          >
            {saving ? tr('saving', 'Saving...') : bulk ? tr('confirm_cancel_sales', 'Cancel these sales') : tr('confirm_cancel_sale', 'Cancel this sale')}
          </button>
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>,
    document.body,
  )
}
