import { useEffect, useState } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import { ALL_STATUSES, getStatusBadgeLabel as getStatusLabel } from './StatusBadge.tsx'

type TranslateFn = (key: string) => string

export default function SaleStatusWorkflow({
  currentStatus,
  selectedStatus,
  notes,
  saving,
  t,
  onSelect,
  onNotesChange,
  onConfirm,
  children,
  reviewRequestId = 0,
  confirmDisabled = false,
  showNotes = true,
}: {
  currentStatus: string
  selectedStatus: string
  notes: string
  saving: boolean
  t: TranslateFn
  onSelect: (status: string) => void
  onNotesChange: (notes: string) => void
  onConfirm: () => void
  children?: React.ReactNode
  reviewRequestId?: number
  confirmDisabled?: boolean
  showNotes?: boolean
}) {
  // It opens on the destination chips, real content from first paint: there is
  // no "Status" opener to press first. Picking a chip moves to the review.
  const [step, setStep] = useState<'destination' | 'review'>('destination')
  useEffect(() => {
    if (reviewRequestId > 0) setStep('review')
  }, [reviewRequestId])
  const destinations = ALL_STATUSES
    .filter((status) => !['partial_return', 'returned', currentStatus].includes(status))
    .filter((status) => currentStatus !== 'partial_return' || status === 'cancelled')

  if (step === 'destination') {
    return (
      <div data-sale-status-destinations="" className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none]">
        {destinations.map((status) => (
          <button
            key={status}
            type="button"
            className="min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium leading-relaxed text-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            onClick={() => { onSelect(status); setStep('review') }}
          >
            {getStatusLabel(status, t)}
          </button>
        ))}
      </div>
    )
  }

  const backLabel = t('back') || 'Back'
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 text-center">
          <div><div className="text-[11px] text-gray-400">{t('current_status') || 'Current status'}</div><div className="font-semibold">{getStatusLabel(currentStatus, t)}</div></div>
          <span aria-hidden="true">→</span>
          <div><div className="text-[11px] text-gray-400">{t('new_status') || 'New status'}</div><div className="font-semibold text-blue-700 dark:text-blue-300">{getStatusLabel(selectedStatus, t)}</div></div>
        </div>
      </div>
      {showNotes ? <div>
        <textarea id="sale-status-notes" disabled={saving} aria-label={t('notes') || 'Notes'} className="input min-h-[80px] resize-none text-sm" value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder={t('status_notes_placeholder') || 'Optional notes about this status change'} />
      </div> : null}
      {children}
      <div data-sale-status-review-actions="" className="flex items-stretch gap-2">
        <button type="button" disabled={saving} className="btn-secondary inline-flex min-h-11 w-11 shrink-0 items-center justify-center px-0" aria-label={backLabel} title={backLabel} onClick={() => setStep('destination')}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className="btn-primary inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-sm" disabled={saving || confirmDisabled || selectedStatus === currentStatus} onClick={onConfirm}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {t('apply') || 'Apply'}
        </button>
      </div>
    </div>
  )
}
