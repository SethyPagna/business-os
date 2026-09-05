import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { useApp } from '../../AppContext.tsx'
import { fmtClock24, fmtDateOnly, fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import { shiftCashDifference, type Shift } from '../../api/shiftTransport.ts'

type Props = {
  shift: Shift
  detail?: boolean
  className?: string
}

function duration(shift: Shift, t: (key: string) => string): string {
  const start = parseServerTimestampMs(shift.opened_at)
  const end = parseServerTimestampMs(shift.closed_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const minutes = Math.floor((end - start) / 60_000)
  return `${Math.floor(minutes / 60)} ${t('shift_hours_short')} ${minutes % 60} ${t('shift_minutes_short')}`
}

export default function ShiftSummary({ shift, detail = false, className = '' }: Props) {
  const { t, fmtUSD, fmtKHR } = useApp() as {
    t: (key: string) => string
    fmtUSD: (value: unknown) => string
    fmtKHR: (value: unknown) => string
  }
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const status = shift.cancelled_at
    ? tr('shift_status_cancelled', 'Cancelled / closed out')
    : shift.closed_at ? tr('shift_status_closed', 'Closed') : tr('shift_status_open', 'Open')
  const cashier = shift.user_name || tr('shift_staff', 'Staff')
  const branch = shift.branch_name || tr('all_branches', 'All branches')
  const before = `${fmtUSD(shift.opening_float_usd)} · ${fmtKHR(shift.opening_float_khr)}`
  const after = shift.closing_counted_usd == null || shift.closing_counted_khr == null
    ? '—'
    : `${fmtUSD(shift.closing_counted_usd)} · ${fmtKHR(shift.closing_counted_khr)}`
  const difference = shiftCashDifference(shift)
  const differenceText = difference.usd == null || difference.khr == null
    ? '—'
    : `${fmtUSD(difference.usd)} · ${fmtKHR(difference.khr)}`

  return (
    <section className={`min-w-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{fmtDateOnly(shift.business_date)}</span>
            <span className="dense-id text-[10px] text-gray-400 dark:text-gray-500">{shift.shift_code}</span>
          </div>
          <div className="mt-0.5 break-words text-xs leading-relaxed text-gray-500 dark:text-gray-400">{cashier} · {branch}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${shift.cancelled_at ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : shift.closed_at ? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{status}</span>
      </div>

      <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_open_time', 'Open')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{fmtClock24(shift.opened_at)}</dd></div>
        <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_close_time', 'Close')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{shift.closed_at ? fmtClock24(shift.closed_at) : status}</dd></div>
        <div className="min-w-0"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_before', 'Before')}</dt><dd className="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-100">{before}</dd></div>
        <div className="min-w-0"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_after', 'After')}</dt><dd className="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-100">{after}</dd></div>
      </dl>

      {detail ? (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-zinc-800">
          <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-3">
            <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_opened_at', 'Opened at')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{fmtDateTime24(shift.opened_at)}</dd></div>
            <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_closed_at', 'Closed at')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{shift.closed_at ? fmtDateTime24(shift.closed_at) : '—'}</dd></div>
            <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_duration', 'Duration')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{duration(shift, t)}</dd></div>
          </dl>
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-gray-100"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{tr('shift_cash_breakdown', 'Cash breakdown')}</div>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_before', 'Before')}</dt><dd className="font-medium">{before}</dd></div>
              <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_after', 'After')}</dt><dd className="font-medium">{after}</dd></div>
              <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_difference', 'Difference')}</dt><dd className="font-medium">{differenceText}</dd></div>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{tr('shift_difference_hint', 'Closing counted cash minus opening cash. This drawer difference is not profit.')}</p>
          </div>
          {shift.opening_note || shift.closing_note ? (
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_opening_note', 'Opening note')}</dt><dd className="mt-0.5 break-words font-medium">{shift.opening_note || '—'}</dd></div>
              <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_closing_note', 'Closing note')}</dt><dd className="mt-0.5 break-words font-medium">{shift.closing_note || '—'}</dd></div>
            </dl>
          ) : null}
          {shift.cancelled_at ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-semibold">{tr('shift_status_cancelled', 'Cancelled / closed out')} · {fmtDateTime24(shift.cancelled_at)}</div>
              <div className="mt-1">{tr('shift_cancelled_by', 'Cancelled by')}: {shift.cancelled_by_user_name || tr('shift_staff', 'Staff')}</div>
              <div className="mt-1 break-words">{tr('shift_cancel_reason', 'Reason')}: {shift.cancel_reason || '—'}</div>
              <p className="mt-1 text-[11px]">{tr('shift_cancel_preserved_hint', 'The recorded times and cash counts above are retained; cancellation does not delete or replace them.')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
