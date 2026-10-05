import type { ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import AppSelect, { type AppSelectOption } from './AppSelect.tsx'
import InfoHint from './InfoHint.tsx'
import Modal from './Modal.tsx'

type SelectSide = {
  /** Shown inside the control and used as its accessible name. */
  label: string
  value: string
  options: AppSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

type BulkFieldChangeDialogProps = {
  title: ReactNode
  /** Above the From/To row: a field switch or a target search. */
  lead?: ReactNode
  from: SelectSide
  to: SelectSide
  /** "N matching" -- the one number the change will touch. */
  matchingText: string
  /** "N skipped", short; the long explanation belongs in `hint`. */
  skippedText?: string
  hint?: string
  /** Warnings that must stay visible (sales left out, a limit exceeded). */
  alerts?: ReactNode
  /** The rows the change will touch. */
  list?: ReactNode
  confirm: { label: string; disabled: boolean; onConfirm: () => void }
  saving: boolean
  /** True once the person has chosen something worth an "unsaved changes" ask. */
  dirty: boolean
  onClose: () => void
}

/**
 * The one From -> To bulk-change review, shared by the Sales and Returns
 * selected-rows toolbars: choose the source value and the new value, see how
 * many rows match, confirm. It sits on the shared Modal, so there is one close
 * (the X), the dirty guard, and the dialog keyboard contract come with it.
 */
export default function BulkFieldChangeDialog({ title, lead, from, to, matchingText, skippedText, hint, alerts, list, confirm, saving, dirty, onClose }: BulkFieldChangeDialogProps) {
  return (
    <Modal title={title} onClose={onClose} size="sm" keyboard closeDisabled={saving} unsavedChanges={{ dirty }}>
      <div className="space-y-3">
        {lead}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <AppSelect className="w-full" buttonClassName="w-full" prefix={from.label} ariaLabel={from.label} value={from.value} disabled={saving || from.disabled} onChange={from.onChange} options={from.options} />
          <span className="text-gray-400" aria-hidden="true">→</span>
          <AppSelect className="w-full" buttonClassName="w-full" prefix={to.label} ariaLabel={to.label} value={to.value} disabled={saving || to.disabled} onChange={to.onChange} options={to.options} />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm leading-relaxed dark:border-blue-800 dark:bg-blue-950/30">
          <span className="font-semibold text-blue-800 dark:text-blue-200">{matchingText}</span>
          {skippedText ? <span className="text-xs text-blue-700/80 dark:text-blue-300/80">· {skippedText}</span> : null}
          {hint ? <InfoHint className="ml-auto" label={matchingText} text={hint} /> : null}
        </div>
        {alerts}
        {list}
        <div className="flex justify-end border-t border-gray-200 pt-3 dark:border-gray-700">
          <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={saving || confirm.disabled} onClick={confirm.onConfirm}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {confirm.label}
          </button>
        </div>
      </div>
    </Modal>
  )
}
