import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import { useApp } from '../../AppContext.tsx'
import { fmtDateTime24, parseServerTimestampMs } from '../../utils/formatters.ts'
import type { Shift } from '../../api/shiftTransport.ts'
import ShiftHeaderRow, { shiftCellTime } from './ShiftHeaderRow.tsx'
import ShiftCashBreakdown from './ShiftCashBreakdown.tsx'
import ShiftReportFigures from './ShiftReportFigures.tsx'
import ShiftCloseDriftNote from './ShiftCloseDriftNote.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { shiftAdditionalCash, shiftDrawerSourceBadge, shiftFiguresForViewer, shiftHasUsd, shiftMoneyText, shiftNotCounted } from './shiftReportModel.ts'
import type { PermissionUser } from '../../utils/permissions.ts'

type Props = {
  shift: Shift
  detail?: boolean
  /** The shift's standing review says it was closed late (read from the same closed_late entry as the Shifts popup). */
  closedLate?: boolean
  className?: string
}

function duration(shift: Shift, t: (key: string) => string): string {
  const start = parseServerTimestampMs(shift.opened_at)
  const end = parseServerTimestampMs(shift.closed_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—'
  const minutes = Math.floor((end - start) / 60_000)
  return `${Math.floor(minutes / 60)} ${t('shift_hours_short')} ${minutes % 60} ${t('shift_minutes_short')}`
}

export default function ShiftSummary({ shift: receivedShift, detail = false, closedLate = false, className = '' }: Props) {
  const { user } = useApp() as { user: PermissionUser }
  const shift = shiftFiguresForViewer(receivedShift, user)
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
  const closeTime = shift.closed_at ? `${shiftCellTime(shift.closed_at, shift.business_date)}${detail ? ` · ${duration(shift, t)}` : ''}` : status
  // Riel first; the dollar half only when this shift has any dollar figure, on every pair row of it (owner A72 + Q3).
  const showUsd = shiftHasUsd(shift)
  const before = shiftMoneyText({ usd: shift.opening_float_usd, khr: shift.opening_float_khr }, showUsd, fmtUSD, fmtKHR)
  // Per currency, through the shared rule. A drawer counted in dollars and
  // left blank in riel used to print a bare "—" for BOTH, hiding a number the
  // cashier actually wrote; now only the uncounted half is a dash, and a
  // wholly uncounted drawer is still one dash.
  const afterText = shiftMoneyText({ usd: shift.closing_counted_usd, khr: shift.closing_counted_khr }, showUsd, fmtUSD, fmtKHR)
  // A shift closed late with no count says so, instead of a bare dash (same-day closes keep the dash).
  const after = shiftNotCounted(shift, closedLate) ? tr('shift_late_not_counted', 'Not counted (closed late)') : afterText
  // Between the two: the extra change put in mid-shift (owner, 13 Oct 2026, item 14:
  // Opening -> Additional -> Closing everywhere, $0 included). The shared rule answers
  // the figure, zero when none; the (+) of an inflow marks only an amount, as in the
  // report block and the POS summary.
  const additional = shiftAdditionalCash(shift)
  const between = `${additional.usd || additional.khr ? '+ ' : ''}${shiftMoneyText(additional, showUsd, fmtUSD, fmtKHR)}`
  const sourceBadge = shiftDrawerSourceBadge(shift)

  return (
    <section className={`min-w-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 ${className}`}>
      <ShiftHeaderRow shift={shift}>
        {/* EDITED, the same fact a sale row carries: this record was
            corrected after it was written, and the corrections (who, when,
            before -> after) are in the records list inside this shift's
            float -- which is what the row opens. Counted by the server
            across the whole lineage and excluding the close/cancel/reopen
            transitions, so it never brands an ordinary closed shift. */}
        {closedLate ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr('shift_closed_late', 'Closed late')}</span>
        ) : null}
        {(shift.amendment_count ?? 0) > 0 ? (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            title={tr('shift_amendments', 'Records')}
          >
            {tr('shift_edited', 'Edited')}{(shift.amendment_count ?? 0) > 1 ? ` · ${shift.amendment_count}` : ''}
          </span>
        ) : null}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${shift.cancelled_at ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : shift.closed_at ? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>{status}</span>
      </ShiftHeaderRow>

      {/* Six units on a phone: Open and Close take three each, then Before, Additional and
          After take two each, so the card stays two short rows at 360px (the cash values
          wrap inside their cell instead of widening it). From sm the five cells are one
          row. The label is the full "Added cash", the same word the report and the form use. */}
      <dl className="mt-2 grid min-w-0 grid-cols-6 gap-x-3 gap-y-2 text-xs sm:grid-cols-5">
        <div className="col-span-3 sm:col-span-1"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_open_time', 'Open')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{shiftCellTime(shift.opened_at, shift.business_date)}</dd></div>
        <div className="col-span-3 sm:col-span-1"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_close_time', 'Close')}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-100">{closeTime}</dd></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_before', 'Before')}</dt><dd className="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-100">{before}</dd></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_recon_additional_cash', 'Added cash')}</dt><dd className="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-100">{between}</dd></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-gray-500 dark:text-gray-400">{tr('shift_after', 'After')}</dt><dd className="mt-0.5 break-words font-medium text-gray-800 dark:text-gray-100">{after}</dd></div>
      </dl>

      {detail ? (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 dark:border-zinc-800">
          {/* The report the owner reads first: registered cash open vs end in
              both currencies, then the money. The drawer chain below it stays
              where it was -- it answers a different question (what should be
              in the till), and only an admin's response carries `figures`. */}
          <ShiftReportFigures shift={shift} closedLate={closedLate} />
          <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-gray-100">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{tr('shift_cash_breakdown', 'Cash breakdown')}
              {/* N4: a closed shift's drawer is the one it closed on (stored),
                  or -- for a shift closed before figures were stored -- a
                  recomputation, and the row says which. */}
              {sourceBadge ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${sourceBadge.source === 'stored'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}>
                  {tr(sourceBadge.key, sourceBadge.fallback)}
                  <InfoHint text={t(sourceBadge.hintKey)} label={tr(sourceBadge.key, sourceBadge.fallback)} />
                </span>
              ) : null}
            </div>
            {/* The eight drawer rows the server reconciled, and the same eight the
                Telegram shift report prints. When the server sent no breakdown
                (an old row, or a list read) the before/after pair still stands. */}
            {shift.reconciliation
              ? <ShiftCashBreakdown className="mt-2" reconciliation={shift.reconciliation} showUsd={showUsd} notCounted={shiftNotCounted(shift, closedLate)} />
              : (
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_before', 'Before')}</dt><dd className="font-medium">{before}</dd></div>
                  <div><dt className="text-gray-500 dark:text-gray-400">{tr('shift_after', 'After')}</dt><dd className="font-medium">{after}</dd></div>
                </dl>
              )}
            <ShiftCloseDriftNote className="mt-2" shift={shift} />
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
