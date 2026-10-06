// The cancellation answers for ONE sale -- reason, note and the optional lost
// fee -- shared by the single-sale dialog and every row of the bulk review, so
// the two can never ask different questions.

export type CancelReason = 'mistake' | 'buyer_refused' | 'other'

export type CancelFieldsValue = {
  cancel_reason: '' | CancelReason
  cancel_note: string
  cancel_fee_usd: string
  cancel_fee_khr: string
  cancel_fee_note: string
}

export const EMPTY_CANCEL_FIELDS: CancelFieldsValue = {
  cancel_reason: '', cancel_note: '', cancel_fee_usd: '', cancel_fee_khr: '', cancel_fee_note: '',
}

type Translate = (key: string, fallback: string) => string

const REASONS: Array<[CancelReason, string, string]> = [
  ['mistake', 'cancel_reason_mistake', 'Mistake'],
  ['buyer_refused', 'cancel_reason_buyer_refused', "Buyer didn't buy"],
  ['other', 'cancel_reason_other', 'Other'],
]

/** A sale cannot be cancelled without a reason, and "Other" must say what happened. */
export function cancelFieldsComplete(value: CancelFieldsValue): boolean {
  return !!value.cancel_reason && (value.cancel_reason !== 'other' || value.cancel_note.trim().length > 0)
}

export function cancelFieldsDirty(value: CancelFieldsValue): boolean {
  return Boolean(value.cancel_reason)
    || value.cancel_note.trim().length > 0
    || value.cancel_fee_usd.trim().length > 0
    || value.cancel_fee_khr.trim().length > 0
    || value.cancel_fee_note.trim().length > 0
}

export default function CancelSaleFields({ value, onChange, disabled = false, withFee, tr }: {
  value: CancelFieldsValue
  onChange: (patch: Partial<CancelFieldsValue>) => void
  disabled?: boolean
  /** A lost fee belongs to ONE sale, so the single dialog and each bulk row ask for it
   * -- and only for a role that may add expenses (N9, utils/cancelFeeRules.ts). */
  withFee: boolean
  tr: Translate
}) {
  const noteRequired = value.cancel_reason === 'other'
  const noteLabel = noteRequired ? tr('cancel_note_required', 'What happened? (required)') : tr('cancel_note_placeholder', 'Optional details')
  const feeLabel = tr('cancel_lost_fee', 'Money lost on this sale (optional)')
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={tr('cancel_reason_label', 'Why is it cancelled?')} className="grid grid-cols-3 gap-1">
        {REASONS.map(([reason, key, fallback]) => (
          <button
            key={reason}
            type="button"
            role="radio"
            aria-checked={value.cancel_reason === reason}
            disabled={disabled}
            className={`min-h-10 rounded-lg border px-2 py-1 text-xs font-medium leading-relaxed disabled:opacity-60 ${value.cancel_reason === reason ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            onClick={() => onChange({ cancel_reason: reason })}
          >
            {tr(key, fallback)}
          </button>
        ))}
      </div>
      <textarea
        className="input min-h-[56px] w-full resize-none text-sm"
        disabled={disabled}
        value={value.cancel_note}
        onChange={(event) => onChange({ cancel_note: event.target.value })}
        placeholder={noteLabel}
        aria-label={noteLabel}
        aria-required={noteRequired}
      />
      {withFee ? (
        <div role="group" aria-label={feeLabel} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-700/50 dark:bg-amber-900/20">
          <div className="text-xs font-medium leading-relaxed text-amber-800 dark:text-amber-200">{feeLabel}</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input w-full text-sm" disabled={disabled} type="number" min="0" step="any" inputMode="decimal" placeholder="USD" aria-label="USD" value={value.cancel_fee_usd} onChange={(event) => onChange({ cancel_fee_usd: event.target.value })} />
            <input className="input w-full text-sm" disabled={disabled} type="number" min="0" step="100" inputMode="numeric" placeholder="KHR" aria-label="KHR" value={value.cancel_fee_khr} onChange={(event) => onChange({ cancel_fee_khr: event.target.value })} />
          </div>
          <input
            className="input w-full text-sm"
            disabled={disabled}
            value={value.cancel_fee_note}
            onChange={(event) => onChange({ cancel_fee_note: event.target.value })}
            placeholder={tr('cancel_fee_note_placeholder', 'What this fee was (e.g. delivery to buyer)')}
            aria-label={tr('cancel_fee_note_placeholder', 'What this fee was (e.g. delivery to buyer)')}
          />
        </div>
      ) : null}
    </div>
  )
}
