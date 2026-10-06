import { useEffect, useState } from 'react'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import InfoHint from '../shared/InfoHint.tsx'
import Modal from '../shared/Modal.tsx'
import CancelSaleFields, { EMPTY_CANCEL_FIELDS, cancelFieldsComplete, cancelFieldsDirty, type CancelFieldsValue } from './CancelSaleFields.tsx'
import { cancelFieldsFeeWithinSale } from '../../utils/cancelFeeRules.ts'

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
  // N9: recording a lost fee adds an expense (Expenses -> Add), and the fee
  // cannot exceed the cancelled sale's total.
  feeAllowed: boolean
  sale?: { total_usd?: unknown; exchange_rate?: unknown }
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
export default function CancelSaleModal({ label, bulk = false, feeAllowed, sale = {}, saving = false, onClose, onConfirm, t }: CancelSaleModalProps) {
  const [fields, setFields] = useState<CancelFieldsValue>(EMPTY_CANCEL_FIELDS)

  useEffect(() => { setFields(EMPTY_CANCEL_FIELDS) }, [label])

  const tr = (key: string, fallback: string): string => t(key) || fallback
  const withFee = !bulk && feeAllowed
  const feeOverTotal = withFee && !cancelFieldsFeeWithinSale(fields, sale)
  const canConfirm = cancelFieldsComplete(fields) && !feeOverTotal && !saving

  const confirm = () => {
    if (!canConfirm || !fields.cancel_reason) return
    const payload: SaleCancelPayload = { cancel_reason: fields.cancel_reason }
    if (fields.cancel_note.trim()) payload.cancel_note = fields.cancel_note.trim()
    if (withFee) {
      const usd = Number(fields.cancel_fee_usd)
      const khr = Number(fields.cancel_fee_khr)
      if (Number.isFinite(usd) && usd > 0) payload.cancel_fee_usd = usd
      if (Number.isFinite(khr) && khr > 0) payload.cancel_fee_khr = khr
      if (fields.cancel_fee_note.trim()) payload.cancel_fee_note = fields.cancel_fee_note.trim()
    }
    onConfirm(payload)
  }

  // One hint instead of three paragraphs: where the stock goes, and what a lost fee is.
  const hint = [
    tr('cancel_stock_hint', 'Anything not already returned goes back into stock, with a movement note naming this cancellation.'),
    bulk
      ? tr('cancel_bulk_fee_hint', 'Lost fees are per sale -- cancel a sale on its own to record one.')
      : withFee ? tr('cancel_lost_fee_hint', 'e.g. a delivery fee already paid that the buyer refused to cover. Recorded as an expense on the Expenses page.') : '',
  ].filter(Boolean).join('\n\n')

  // S4-21: the reason and the lost-fee figures are typed once and are the
  // only record of WHY a sale was cancelled -- worth an ask before the
  // backdrop throws them away. The shared Modal's X (and Escape) is the one close.
  return (
    <Modal
      title={<><span className="block">{tr('cancel_sale_title', 'Cancel sale')}</span><span className="block text-xs font-normal text-gray-400">{label}</span></>}
      onClose={onClose}
      size="sm"
      keyboard
      closeDisabled={saving}
      unsavedChanges={{ dirty: cancelFieldsDirty(fields) }}
      headerExtra={<InfoHint label={tr('cancel_sale_title', 'Cancel sale')} text={hint} />}
    >
      <div className="space-y-3">
        <CancelSaleFields value={fields} onChange={(patch) => setFields((current) => ({ ...current, ...patch }))} disabled={saving} withFee={withFee} feeOverTotal={feeOverTotal} tr={tr} />
        <div className="flex justify-end border-t border-gray-200 pt-3 dark:border-gray-700">
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={confirm}
            disabled={!canConfirm}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
            {tr('confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
