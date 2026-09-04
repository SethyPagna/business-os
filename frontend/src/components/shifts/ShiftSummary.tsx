import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import type { Shift } from '../../api/shiftTransport.ts'

type Props = {
  shift: Shift
  compact?: boolean
  title?: string
  className?: string
}

function duration(shift: Shift): string {
  const start = parseServerTimestampMs(shift.opened_at)
  const end = parseServerTimestampMs(shift.closed_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const minutes = Math.floor((end - start) / 60_000)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Reusable non-sensitive shift summary for Profile and transaction pages.
 * It intentionally excludes opening/closing cash, costs, profit and notes.
 */
export default function ShiftSummary({ shift, compact = false, title = 'Shift', className = '' }: Props) {
  const status = shift.closed_at ? 'Closed' : 'Open'
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 ${className}`} aria-label={`${title} ${shift.shift_code}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{title} · {shift.shift_code}</div>
            {!compact && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{shift.branch_name || 'All branches'} · {shift.user_name || 'Staff'}</div>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${shift.closed_at ? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{status}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div><dt className="text-gray-500 dark:text-gray-400">Cashier</dt><dd className="mt-0.5 truncate font-medium text-gray-800 dark:text-gray-100">{shift.user_name || '—'}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Opened</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{fmtDateTime24(shift.opened_at)}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Closed</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{shift.closed_at ? fmtDateTime24(shift.closed_at) : '—'}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">Duration</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{duration(shift)}</dd></div>
      </dl>
    </section>
  )
}
