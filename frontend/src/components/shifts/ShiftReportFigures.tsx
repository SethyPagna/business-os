import { useApp } from '../../AppContext.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { shiftCountedPairText, shiftFigureRows, shiftFiguresOf, shiftRegisteredCash } from './shiftReportModel.ts'
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
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const registered = shiftRegisteredCash(shift)
  const additional = shift.figures?.additional_cash
  const rows = shiftFigureRows(shiftFiguresOf(shift))

  return (
    <div className={`min-w-0 space-y-2 ${className}`}>
      <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
        <div className="flex items-center gap-1 text-xs font-semibold text-gray-800 dark:text-gray-100">
          {tr('shift_registered_cash', 'Registered cash')}
          <InfoHint text={tr('shift_registered_cash_hint', 'Drawer registration for reference only; it never changes sales, profit, or whether a shift can close.')} label={tr('shift_registered_cash', 'Registered cash')} />
        </div>
        {/* One compact row per drawer state keeps USD and KHR together on
            narrow PWA screens. The separator makes the two native piles clear
            without forcing a second horizontal scroll. */}
        <div className="mt-2 space-y-1 text-xs">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400">{tr('shift_registered_open', 'OPEN')}</span>
            <span className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountedPairText(registered.open.usd, registered.open.khr, fmtUSD, fmtKHR)}</span>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400">{tr('shift_registered_end', 'END')}</span>
            <span className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">{shiftCountedPairText(registered.end.usd, registered.end.khr, fmtUSD, fmtKHR)}</span>
          </div>
          {(additional?.usd || additional?.khr) ? (
            <div className="flex min-w-0 items-baseline justify-between gap-3 border-t border-black/5 pt-1 dark:border-white/10">
              <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400">{tr('shift_recon_additional_cash', 'Additional cash')}</span>
              <span className="min-w-0 break-words text-right font-medium text-gray-800 dark:text-gray-100">+ {shiftCountedPairText(additional.usd, additional.khr, fmtUSD, fmtKHR)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{tr('shift_report_figures', 'Business results')}</div>
          <dl className="mt-1.5 min-w-0 divide-y divide-gray-100 text-xs dark:divide-zinc-800">
            {rows.map((row) => (
              <div key={row.key} className="flex min-w-0 items-baseline justify-between gap-3 py-1">
                <dt className="flex shrink-0 items-center gap-1 text-gray-500 dark:text-gray-400">
                  {t(row.key)}
                  {row.hintKey ? <InfoHint text={t(row.hintKey)} label={t(row.key)} /> : null}
                </dt>
                <dd className={`min-w-0 break-words text-right font-medium ${
                  row.tone === 'positive' ? 'text-green-700 dark:text-green-400'
                    : row.tone === 'negative' ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-800 dark:text-gray-100'
                }`}>
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
