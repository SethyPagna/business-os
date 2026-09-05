import { useEffect, useState } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import { ALL_STATUSES, getStatusLabel } from './StatusBadge.tsx'

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
  const [step, setStep] = useState<'closed' | 'destination' | 'review'>('closed')
  useEffect(() => {
    if (reviewRequestId > 0) setStep('review')
  }, [reviewRequestId])
  const destinations = ALL_STATUSES
    .filter((status) => !['partial_return', 'returned', currentStatus].includes(status))
    .filter((status) => currentStatus !== 'partial_return' || status === 'cancelled')

  if (step === 'closed') {
    return (
      <button type="button" className="btn-secondary w-full text-sm" onClick={() => setStep('destination')}>
        {t('status') || 'Status'}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <button type="button" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-gray-600 dark:text-gray-300" onClick={() => setStep(step === 'review' ? 'destination' : 'closed')}>
        <ChevronLeft className="h-4 w-4" />
        {step === 'review' ? (t('back') || 'Back') : (t('cancel') || 'Cancel')}
      </button>
      {step === 'destination' ? (
        <>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('choose_status') || 'Choose destination status'}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {destinations.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="min-h-11 rounded-lg border border-gray-300 px-2 py-2 text-sm font-medium text-gray-800 hover:border-blue-500 hover:bg-blue-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                  onClick={() => { onSelect(status); setStep('review') }}
                >
                  {getStatusLabel(status, t)}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 text-center">
              <div><div className="text-[11px] text-gray-400">{t('current_status') || 'Current status'}</div><div className="font-semibold">{getStatusLabel(currentStatus, t)}</div></div>
              <span aria-hidden="true">→</span>
              <div><div className="text-[11px] text-gray-400">{t('new_status') || 'New status'}</div><div className="font-semibold text-blue-700 dark:text-blue-300">{getStatusLabel(selectedStatus, t)}</div></div>
            </div>
          </div>
          {showNotes ? <div>
            <label htmlFor="sale-status-notes" className="mb-1 block text-xs text-gray-400">{t('notes') || 'Notes'}</label>
            <textarea id="sale-status-notes" className="input min-h-[80px] resize-none text-sm" value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder={t('status_notes_placeholder') || 'Optional notes about this status change'} />
          </div> : null}
          {children}
          <button type="button" className="btn-primary w-full text-sm" disabled={saving || confirmDisabled || selectedStatus === currentStatus} onClick={onConfirm}>
            {saving ? (t('loading') || 'Saving') : (t('confirm') || 'Confirm')}
          </button>
        </>
      )}
    </div>
  )
}
