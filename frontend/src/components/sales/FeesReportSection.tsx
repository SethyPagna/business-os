import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getFeesReport } from '../../api/feesTransport.ts'
import Modal from '../shared/Modal'

// Fees report section for the Reports hub. Range + branch are owned by the
// hub and passed in. Backed by GET /api/fees/report, keyed on fee_date (the
// effective date a fee is booked to).

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

interface FeesReport {
  totals: { count: number; amount_usd: number; amount_khr: number }
  days: Array<{ date: string; count: number; amount_usd: number; amount_khr: number }>
  by_type: Array<{ fee_type: string; count: number; amount_usd: number; amount_khr: number }>
}

interface FeesReportSectionProps {
  t: TranslateFn
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  range: DateTimeRange
  branchId?: string
  active?: boolean
  /** The Reports-hub section title (icon + label). Rendered on the same row
   * as this section's breakdown chips; the totals drop to a line below. */
  titleNode?: ReactNode
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
    totals: { count: num(totals.count), amount_usd: num(totals.amount_usd), amount_khr: num(totals.amount_khr) },
    days: Array.isArray(r.days) ? r.days.map((d) => ({ date: String(d.date || ''), count: num(d.count), amount_usd: num(d.amount_usd), amount_khr: num(d.amount_khr) })) : [],
    by_type: Array.isArray(r.by_type) ? r.by_type.map((d) => ({ fee_type: String(d.fee_type || ''), count: num(d.count), amount_usd: num(d.amount_usd), amount_khr: num(d.amount_khr) })) : [],
  }
}

export default function FeesReportSection({ t, fmtUSD, fmtKHR, range, branchId, active = true, titleNode }: FeesReportSectionProps) {
  // Fees are recorded in EITHER USD or KHR; show whichever are present so a
  // month of KHR fees no longer reads as "$0.00" (Part 553). No conversion.
  const moneyPair = (usd: number, khr: number): string => {
    const parts: string[] = []
    if (usd) parts.push(fmtUSD(usd))
    if (khr) parts.push(fmtKHR(khr))
    return parts.length ? parts.join(' · ') : fmtUSD(0)
  }
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

  // Text summary + click-to-open floats — same contract as the Returns
  // report section (no stat tiles, "|" dividers, scrollable Modal).
  const [openTable, setOpenTable] = useState<'days' | 'types' | null>(null)

  const floatTable = (rows: Array<{ key: string; label: string; count: number; usd: number; khr: number }>) => (
    rows.length === 0 ? (
      <div className="text-xs text-slate-400">{t('no_data') || 'No data'}</div>
    ) : (
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <td className="max-w-[12rem] truncate py-1.5 pr-2 text-slate-700 dark:text-slate-200">{row.label}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">×{row.count}</td>
              <td className="py-1.5 text-right font-medium text-slate-900 dark:text-white">{moneyPair(row.usd, row.khr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  )

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{t('try_again') || 'Try again'}</button>
        </div>
      ) : null}

      {/* Title row: the section title (from the hub) sits left, the
          breakdown chips ride ml-auto on the SAME row (Part 552). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {titleNode ? <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{titleNode}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpenTable('days')}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700"
          >
            {t('by_day') || 'By day'} <span className="text-slate-400">{report?.days.length ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={() => setOpenTable('types')}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700"
          >
            {t('by_type') || 'By type'} <span className="text-slate-400">{report?.by_type.length ?? 0}</span>
          </button>
        </span>
      </div>

      {/* Totals on their own line below the title row. Both currencies show
          (Part 553) — fees are recorded in USD OR KHR, so a USD-only total
          hid every KHR fee as "$0.00". */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>{report?.totals.count ?? 0} {t('fees') || 'fees'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('total') || 'Total'} <b className="text-slate-900 dark:text-white">{moneyPair(report?.totals.amount_usd ?? 0, report?.totals.amount_khr ?? 0)}</b></span>
      </div>

      {openTable ? (
        <Modal
          title={openTable === 'days' ? (t('by_day') || 'By day') : (t('by_type') || 'By type')}
          onClose={() => setOpenTable(null)}
          draggable
        >
          {openTable === 'days'
            ? floatTable((report?.days ?? []).map((day) => ({ key: day.date, label: displayDay(day.date), count: day.count, usd: day.amount_usd, khr: day.amount_khr })))
            : floatTable((report?.by_type ?? []).map((row) => ({ key: row.fee_type, label: row.fee_type, count: row.count, usd: row.amount_usd, khr: row.amount_khr })))}
        </Modal>
      ) : null}
    </div>
  )
}
