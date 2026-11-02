import { useEffect, useState } from 'react'
import ChipRail, { RailChip } from '../shared/kit/ChipRail.tsx'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import { getStatusBadgeLabel as getStatusLabel } from './StatusBadge.tsx'
import { saleStatusDestinations, type SaleReturnTag } from '../../utils/saleStatusDisplay.ts'

type TranslateFn = (key: string) => string

export default function SaleStatusWorkflow({
  currentStatus,
  returnTag = null,
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
  /** The shown status word (saleStatusDisplay), not the raw column. */
  currentStatus: string
  returnTag?: SaleReturnTag | null
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
  const destinations = saleStatusDestinations({ status: currentStatus, returnTag })
  // Completed from Awaiting Delivery is the delivery itself; the review still shows both statuses.
  const destinationLabel = (status: string) => status === 'completed' && currentStatus === 'awaiting_delivery'
    ? t('sale_mark_delivered') || 'Mark delivered'
    : getStatusLabel(status, t)

  if (step === 'destination') {
    return (
      <ChipRail label={t('status') || 'Status'} data-sale-status-destinations="">
        {destinations.map((status) => (
          <RailChip key={status} onClick={() => { onSelect(status); setStep('review') }}>
            {destinationLabel(status)}
          </RailChip>
        ))}
      </ChipRail>
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
