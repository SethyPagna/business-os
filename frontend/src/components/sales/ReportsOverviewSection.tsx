import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getSalesStatsStrip } from '../../api/salesTransport.ts'
import { downloadCSV } from '../../utils/csv.ts'
import InfoHint from '../shared/InfoHint.tsx'

// Overview section for the Reports hub (Sep 3 2026, lane fx/reports-redesign).
//
// The point of this section is RECONCILIATION. It calls GET
// /api/sales/stats-strip -- byte for byte the endpoint the Sales list's own
// stats strip calls (Sales.tsx) -- with the hub's range and branch. So the
// headline a user reads in Reports is not "computed like" the Sales list's,
// it is literally the same response from the same salesAnalytics kernel
// call. Nothing in this file does arithmetic on money beyond formatting;
// every figure below names the field it came from.
//
// Revenue is the canonical definition and is NOT redefined here: net sales
// (subtotal minus both discounts) over recognized sales, minus customer
// refunds. Tax and customer-paid delivery are not revenue -- they appear
// under "collected" instead, which is why the two differ.

type TranslateFn = (key: string) => string | undefined

interface Totals {
  tx_count: number
  gross_sales_usd: number
  discount_usd: number
  refund_usd: number
  revenue_usd: number
  pending_revenue_usd: number
  collected_total_usd: number
  tax_usd: number
  delivery_usd: number
  avg_order_usd: number
  /** Admin-only: absent (not zero) for staff, see routes/sales.ts gating. */
  cost_usd?: number
  profit_usd?: number
}

interface ReportsOverviewSectionProps {
  t: TranslateFn
  fmtMoney: (usd: number, khr?: number) => string
  range: DateTimeRange
  branchId?: string
  active?: boolean
  titleNode?: ReactNode
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Keep admin-only keys ABSENT when the server omitted them, so the tile is
 *  dropped rather than rendered as a misleading $0.00. */
function normalizeTotals(raw: unknown): Totals {
  const r = (raw || {}) as Record<string, unknown>
  const out: Totals = {
    tx_count: num(r.tx_count),
    gross_sales_usd: num(r.gross_sales_usd),
    discount_usd: num(r.discount_usd),
    refund_usd: num(r.refund_usd),
    revenue_usd: num(r.revenue_usd),
    pending_revenue_usd: num(r.pending_revenue_usd),
    collected_total_usd: num(r.collected_total_usd),
    tax_usd: num(r.tax_usd),
    delivery_usd: num(r.delivery_usd),
    avg_order_usd: num(r.avg_order_usd),
  }
  if ('cost_usd' in r) out.cost_usd = num(r.cost_usd)
  if ('profit_usd' in r) out.profit_usd = num(r.profit_usd)
  return out
}

export default function ReportsOverviewSection({ t, fmtMoney, range, branchId, active = true, titleNode }: ReportsOverviewSectionProps) {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const result = await getSalesStatsStrip({
        startDate: range.startDate,
        endDate: range.endDate,
        ...(range.startTime && range.endTime ? { startTime: range.startTime, endTime: range.endTime } : {}),
        ...(branchId ? { branchId } : {}),
      })
      if (requestRef.current !== requestId) return
      setTotals(normalizeTotals((result as { totals?: unknown } | null)?.totals))
    } catch (err) {
      if (requestRef.current !== requestId) return
      setError(err instanceof Error ? err.message : String(err))
      setTotals(null)
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [range.startDate, range.endDate, range.startTime, range.endTime, branchId])

  useEffect(() => { if (active) void load() }, [active, load])

  const marginPct = totals && totals.profit_usd != null && totals.revenue_usd > 0
    ? (totals.profit_usd / totals.revenue_usd) * 100
    : null

  // Each tile names the kernel field behind it, so a figure is always
  // traceable to a query rather than to this component.
  const tiles: Array<{ id: string; label: string; value: string; hint: string; tone?: string }> = totals ? [
    { id: 'revenue', label: trh('revenue', 'Revenue'), value: fmtMoney(totals.revenue_usd), tone: 'text-emerald-600 dark:text-emerald-400',
      hint: trh('reports_hint_revenue', 'Net sales (subtotal minus discounts) on completed sales, minus customer refunds. Tax and delivery fees are not revenue.') },
    { id: 'tx', label: trh('transactions', 'Transactions'), value: String(totals.tx_count),
      hint: trh('reports_hint_tx', 'Sales in this range, excluding cancelled ones.') },
    { id: 'avg', label: trh('avg_order', 'Average order'), value: fmtMoney(totals.avg_order_usd),
      hint: trh('reports_hint_avg', 'Revenue divided by the number of transactions.') },
    { id: 'gross', label: trh('gross_sales', 'Gross sales'), value: fmtMoney(totals.gross_sales_usd),
      hint: trh('reports_hint_gross', 'Subtotal before any discount or refund.') },
    { id: 'discount', label: trh('discounts', 'Discounts'), value: fmtMoney(totals.discount_usd),
      hint: trh('reports_hint_discount', 'Store plus membership discounts given in this range.') },
    { id: 'refund', label: trh('refunds', 'Refunds'), value: fmtMoney(totals.refund_usd), tone: 'text-rose-600 dark:text-rose-400',
      hint: trh('reports_hint_refund', 'Money refunded to customers, already subtracted from revenue.') },
    { id: 'pending', label: trh('pending_credit', 'Unpaid credit'), value: fmtMoney(totals.pending_revenue_usd), tone: 'text-amber-600 dark:text-amber-400',
      hint: trh('reports_hint_pending', 'Sales awaiting payment. Not revenue until paid.') },
    { id: 'collected', label: trh('collected', 'Collected'), value: fmtMoney(totals.collected_total_usd),
      hint: trh('reports_hint_collected', 'Revenue plus the tax and customer-paid delivery actually taken in.') },
    ...(totals.profit_usd != null ? [{
      id: 'profit', label: trh('profit', 'Profit'), value: fmtMoney(totals.profit_usd), tone: 'text-blue-600 dark:text-blue-400',
      hint: trh('reports_hint_profit', 'Revenue minus cost of goods sold and store-paid delivery.'),
    }] : []),
    ...(marginPct != null ? [{
      id: 'margin', label: trh('margin', 'Margin'), value: `${marginPct.toFixed(1)}%`,
      hint: trh('reports_hint_margin', 'Profit as a share of revenue.'),
    }] : []),
  ] : []

  const exportCsv = () => {
    if (!totals) return
    downloadCSV(`overview-${range.startDate}-${range.endDate}.csv`, tiles.map((tile) => ({
      [trh('figure', 'Figure')]: tile.label,
      [trh('value', 'Value')]: tile.value,
    })))
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{titleNode}</div>
        <div className="ml-auto flex items-center gap-1.5">
          {loading ? <span className="text-xs text-slate-400">{trh('loading', 'Loading')}…</span> : null}
          <button
            type="button"
            onClick={exportCsv}
            disabled={!totals}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" /> {trh('export', 'Export')}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>
      ) : null}

      {/* 2-up on phones, widening with the viewport -- the project's stats
          convention (never a sideways-scrolling row). */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.id} className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{tile.label}</span>
              <InfoHint text={tile.hint} label={tile.label} />
            </div>
            <div className={`truncate text-sm font-semibold tabular-nums ${tile.tone || 'text-slate-800 dark:text-slate-100'}`}>{tile.value}</div>
          </div>
        ))}
      </div>

      {totals ? (
        <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
          {trh('reports_same_as_sales_list', 'These are the same figures the Sales list shows for this date range.')}
        </p>
      ) : null}
    </div>
  )
}
