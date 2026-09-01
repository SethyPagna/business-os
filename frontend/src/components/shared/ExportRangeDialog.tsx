import { useState } from 'react'
import Modal from './Modal'
import DateTimeRangePicker from './DateTimeRangePicker'

// The shared range step in front of an export (user, Aug 31: "do the date
// range for all the exports... if the page with export also has start/end
// date outside as well, it will default shows that start/end date, but you
// can edit but first shown is that"): opens seeded with the page's own
// Start → End range, editable before the export runs. An empty range means
// "everything" -- same semantics as the page filters themselves.

type Translate = (key: string) => string | undefined

export type ExportRange = { startDate: string; endDate: string }

export default function ExportRangeDialog({
  initial,
  onClose,
  onExport,
  t,
  title,
}: {
  initial: ExportRange
  onClose: () => void
  /** Runs the export for the chosen range; the dialog closes when it resolves. */
  onExport: (range: ExportRange) => Promise<void> | void
  t: Translate
  title?: string
}) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const [range, setRange] = useState<ExportRange>(() => ({ startDate: initial.startDate || '', endDate: initial.endDate || '' }))
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onExport(range)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title || tr('export', 'Export')} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {tr('date', 'Date')}
          </label>
          <DateTimeRangePicker
            value={{ startDate: range.startDate, endDate: range.endDate, startTime: '', endTime: '' }}
            onChange={(next) => setRange({ startDate: next.startDate || '', endDate: next.endDate || '' })}
            t={t}
            showTime={false}
            triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2"
          />
          <p className="mt-1 text-xs text-gray-400">
            {tr('export_range_hint', 'Starts from the range shown on the page — change it to export a different window. Empty = everything.')}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void run()}>
            {busy ? (tr('exporting', 'Exporting…')) : tr('export', 'Export')}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            {tr('cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
