import { useApp } from '../../AppContext.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { shiftCountText, shiftFigureRows, shiftRegisteredCash } from '../../utils/shiftReportModel.ts'
import type { Shift } from '../../api/shiftTransport.ts'

/**
 * The admin half of the shift report, in the order the owner reads it
 * (Sep 6 2026):
 *
 *   1. REGISTERED CASH -- what was counted into the drawer at open and out of
 *      it at end, both currencies, side by side in one block. It is a
 *      breakdown "to keep track how much is spent", not an input to anything:
 *      every figure in block 2 is identical whatever is counted here, which is
 *      what makes the registration report-only rather than part of the books.
 *   2. THE MONEY -- sales, COGS, profit, the two halves of expenses (delivery
 *      cost and everything else), delivery fees charged, refunds as ONE total,
 *      and credit as a positive "awaiting payment" note.
 *
 * Nothing is computed here and nothing is ordered here: both come from
 * utils/shiftReportModel.ts, over the server's own figures
 * (cloudflare/src/lib/shiftReconciliation.ts). The app, the Telegram report
 * and the Reports hub therefore cannot drift into three answers for one shift.
 *
 * The money block appears only when the server priced the shift for this
 * caller (the shift-review capability); everyone else still sees the
 * registration, which is their own drawer.
 *
 * USD and riel are never added together: the drawer holds two separate piles,
 * and the sales kernel's basis is dollars.
 */

type Props = {
  shift: Shift
  className?: string
}

export default function ShiftReportFigures({ shift, className = '' }: Props) {
  const { t, fmtUSD, fmtKHR } = useApp() as {
    t: (key: string) => string
    fmtUSD: (value: unknown) => string
    fmtKHR: (value: unknown) => string
  }
  const registered = shiftRegisteredCash(shift)
  const rows = shiftFigureRows(shift.figures)

  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
        <div className="flex items-center gap-1 text-xs font-semibold text-gray-800 dark:text-gray-100">
          {t('shift_registered_cash')}
          <InfoHint text={t('shift_registered_cash_hint')} label={t('shift_registered_cash')} />
        </div>
        {/* Open and end in ONE block, per currency: the owner reads them
            against each other, so they sit side by side rather than on two
            screens. Each cell is independently "—" -- a drawer counted in
            dollars only is not an uncounted drawer. */}
        <div className="mt-2 grid min-w-0 grid-cols-[minmax(2.25rem,auto)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <div aria-hidden="true" />
          <div className="text-right font-medium text-gray-500 dark:text-gray-400">{t('shift_registered_open')}</div>
          <div className="text-right font-medium text-gray-500 dark:text-gray-400">{t('shift_registered_end')}</div>
          <div className="text-gray-500 dark:text-gray-400">USD</div>
          <div className="break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountText(registered.open.usd, fmtUSD)}</div>
          <div className="break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountText(registered.end.usd, fmtUSD)}</div>
          <div className="text-gray-500 dark:text-gray-400">KHR</div>
          <div className="break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountText(registered.open.khr, fmtKHR)}</div>
          <div className="break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountText(registered.end.khr, fmtKHR)}</div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{t('shift_report_figures')}</div>
          <dl className="mt-1.5 min-w-0 divide-y divide-gray-100 text-xs dark:divide-zinc-800">
            {rows.map((row) => (
              <div key={row.key} className="flex min-w-0 items-baseline justify-between gap-3 py-1">
                <dt className="flex shrink-0 items-center gap-1 text-gray-500 dark:text-gray-400">
                  {t(row.key)}
                  {row.hintKey ? <InfoHint text={t(row.hintKey)} label={t(row.key)} /> : null}
                </dt>
                <dd className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">
                  {row.khr == null ? fmtUSD(row.usd) : `${fmtUSD(row.usd)} · ${fmtKHR(row.khr)}`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  )
}
