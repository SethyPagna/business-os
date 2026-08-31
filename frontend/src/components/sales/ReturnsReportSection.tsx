import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getReturnsReport } from '../../api/returnsReadTransport.ts'
import Modal from '../shared/Modal'

// Returns (refunds) report section for the Reports hub. Range + branch are
// owned by the hub and passed in; this section only fetches and renders.
// Backed by GET /api/returns/report, which scopes to customer returns
// (total_refund_usd = money refunded to customers) and excludes cancelled.

type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

interface ReturnsReport {
  totals: { count: number; refund_usd: number; refund_khr: number }
  days: Array<{ date: string; count: number; refund_usd: number; refund_khr: number }>
  by_reason: Array<{ reason: string; count: number; refund_usd: number; refund_khr: number }>
  by_type: Array<{ return_type: string; count: number; refund_usd: number; refund_khr: number }>
}

interface ReturnsReportSectionProps {
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

function normalize(raw: unknown): ReturnsReport {
  const r = (raw || {}) as Partial<ReturnsReport>
  const totals = (r.totals || {}) as ReturnsReport['totals']
  return {
    totals: { count: num(totals.count), refund_usd: num(totals.refund_usd), refund_khr: num(totals.refund_khr) },
    days: Array.isArray(r.days) ? r.days.map((d) => ({ date: String(d.date || ''), count: num(d.count), refund_usd: num(d.refund_usd), refund_khr: num(d.refund_khr) })) : [],
    by_reason: Array.isArray(r.by_reason) ? r.by_reason.map((d) => ({ reason: String(d.reason || ''), count: num(d.count), refund_usd: num(d.refund_usd), refund_khr: num(d.refund_khr) })) : [],
    by_type: Array.isArray(r.by_type) ? r.by_type.map((d) => ({ return_type: String(d.return_type || ''), count: num(d.count), refund_usd: num(d.refund_usd), refund_khr: num(d.refund_khr) })) : [],
  }
}

export default function ReturnsReportSection({ t, fmtUSD, fmtKHR, range, branchId, active = true, titleNode }: ReturnsReportSectionProps) {
  // Refunds can be USD or KHR; show whichever are present (Part 553) so a
  // KHR refund no longer reads as "$0.00". No conversion.
  const moneyPair = (usd: number, khr: number): string => {
    const parts: string[] = []
    if (usd) parts.push(fmtUSD(usd))
    if (khr) parts.push(fmtKHR(khr))
    return parts.length ? parts.join(' · ') : fmtUSD(0)
  }
  const [report, setReport] = useState<ReturnsReport | null>(null)
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
      const result = await getReturnsReport({
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

  // Which breakdown float is open (user, Aug 30: reports show a TEXT
  // summary with "|" dividers, and details open as a scrollable float on
  // click — no stat tiles, no inline card grid).
  const [openTable, setOpenTable] = useState<'days' | 'reasons' | 'types' | null>(null)

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

  const tableChip = (key: 'days' | 'reasons' | 'types', label: string, count: number) => (
    <button
      type="button"
      onClick={() => setOpenTable(key)}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700"
    >
      {label} <span className="text-slate-400">{count}</span>
    </button>
  )

  return (
    <div className="space-y-2">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{t('try_again') || 'Try again'}</button>
        </div>
      ) : null}

      {/* Title row: title left, breakdown chips ml-auto on the SAME row
          (Part 552). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {titleNode ? <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{titleNode}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {tableChip('days', t('by_day') || 'By day', report?.days.length ?? 0)}
          {tableChip('reasons', t('by_reason') || 'By reason', report?.by_reason.length ?? 0)}
          {tableChip('types', t('by_type') || 'By type', report?.by_type.length ?? 0)}
        </span>
      </div>

      {/* Totals on their own line below the title row. Both currencies show
          (Part 553) — a KHR refund used to read as "$0.00". */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>{report?.totals.count ?? 0} {t('returns') || 'returns'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{t('refunds') || 'Refunds'} <b className="text-red-600 dark:text-red-400">{moneyPair(report?.totals.refund_usd ?? 0, report?.totals.refund_khr ?? 0)}</b></span>
      </div>

      {openTable ? (
        <Modal
          title={openTable === 'days' ? (t('by_day') || 'By day') : openTable === 'reasons' ? (t('by_reason') || 'By reason') : (t('by_type') || 'By type')}
          onClose={() => setOpenTable(null)}
          draggable
        >
          {openTable === 'days'
            ? floatTable((report?.days ?? []).map((day) => ({ key: day.date, label: displayDay(day.date), count: day.count, usd: day.refund_usd, khr: day.refund_khr })))
            : openTable === 'reasons'
              ? floatTable((report?.by_reason ?? []).map((row) => ({ key: row.reason, label: row.reason, count: row.count, usd: row.refund_usd, khr: row.refund_khr })))
              : floatTable((report?.by_type ?? []).map((row) => ({ key: row.return_type, label: row.return_type, count: row.count, usd: row.refund_usd, khr: row.refund_khr })))}
        </Modal>
      ) : null}
    </div>
  )
}
