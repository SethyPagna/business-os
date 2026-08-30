import { useCallback, useEffect, useRef, useState } from 'react'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getFeesReport } from '../../api/feesTransport.ts'

// Fees report section for the Reports hub. Range + branch are owned by the
// hub and passed in. Backed by GET /api/fees/report, keyed on fee_date (the
// effective date a fee is booked to).

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

interface FeesReport {
  totals: { count: number; amount_usd: number }
  days: Array<{ date: string; count: number; amount_usd: number }>
  by_type: Array<{ fee_type: string; count: number; amount_usd: number }>
}

interface FeesReportSectionProps {
  t: TranslateFn
  fmtUSD: MoneyFormatter
  range: DateTimeRange
  branchId?: string
  active?: boolean
}

function displayDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const weekday = new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${m[2]}/${m[3]}/${m[1]}`
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalize(raw: unknown): FeesReport {
  const r = (raw || {}) as Partial<FeesReport>
  const totals = (r.totals || {}) as FeesReport['totals']
  return {
    totals: { count: num(totals.count), amount_usd: num(totals.amount_usd) },
    days: Array.isArray(r.days) ? r.days.map((d) => ({ date: String(d.date || ''), count: num(d.count), amount_usd: num(d.amount_usd) })) : [],
    by_type: Array.isArray(r.by_type) ? r.by_type.map((d) => ({ fee_type: String(d.fee_type || ''), count: num(d.count), amount_usd: num(d.amount_usd) })) : [],
  }
}

export default function FeesReportSection({ t, fmtUSD, range, branchId, active = true }: FeesReportSectionProps) {
  const [report, setReport] = useState<FeesReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const result = await getFeesReport({
        startDate: range.startDate,
        endDate: range.endDate,
        ...(branchId ? { branchId } : {}),
      })
      if (requestRef.current !== requestId) return
      setReport(normalize(result))
    } catch (err) {
      if (requestRef.current !== requestId) return
      setReport(null)
      setError(err instanceof Error && err.message ? err.message : (t('report_failed') || 'Could not load this report.'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [range.startDate, range.endDate, branchId, t])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  const statChip = (label: string, value: string, tone = '') => (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${tone || 'text-slate-900 dark:text-white'}`}>{value}</div>
    </div>
  )

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{t('try_again') || 'Try again'}</button>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {statChip(t('fees') || 'Fees', String(report?.totals.count ?? 0))}
        {statChip(t('total') || 'Total', fmtUSD(report?.totals.amount_usd ?? 0))}
        {statChip(t('avg_fee') || 'Avg fee', fmtUSD(report && report.totals.count > 0 ? report.totals.amount_usd / report.totals.count : 0))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Per-day list */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{t('by_day') || 'By day'}</div>
          {loading && !report ? (
            <div className="space-y-2">{[0, 1, 2].map((row) => <div key={row} className="h-6 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />)}</div>
          ) : !report?.days.length ? (
            <div className="text-xs text-slate-400">{t('no_data') || 'No data'}</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {report.days.map((day) => (
                  <tr key={day.date} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{displayDay(day.date)}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-400">×{day.count}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(day.amount_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* By fee type */}
        <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{t('by_type') || 'By type'}</div>
          {!report?.by_type.length ? (
            <div className="text-xs text-slate-400">{t('no_data') || 'No data'}</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {report.by_type.map((row) => (
                  <tr key={row.fee_type} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-1.5 pr-2 capitalize text-slate-700 dark:text-slate-200">{row.fee_type}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-400">×{row.count}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{fmtUSD(row.amount_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
