import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import type { DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import { getSalesGroupedTotals, getProductSalesRanking } from '../../api/salesTransport.ts'
import { downloadCSV } from '../../utils/csv.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'

// Breakdown section for the Reports hub (Sep 3 2026, lane fx/reports-redesign).
//
// "Where did the money come from?" -- the same range, sliced by customer,
// cashier, payment method, hour of day, weekday, branch, or product.
//
// Backed by GET /api/sales/grouped-totals and /api/sales/product-ranking,
// which build every row from the salesAnalytics kernel's own expressions.
// The response carries the kernel's `totals` for the SAME filters alongside
// the rows, and this section renders it as a total row and states whether
// the rows add up. A drift can therefore never be silent: it is on screen.
//
// Products are ranked on LINE sales (sale_items.total_usd), which is
// deliberately NOT revenue -- order-level discounts and refunds belong to the
// order, not to any one line -- so that view labels its column accordingly
// and shows no total-row reconciliation claim.

type TranslateFn = (key: string) => string | undefined

type GroupKey = 'customer' | 'cashier' | 'payment_method' | 'hour' | 'weekday' | 'branch'
type ViewKey = GroupKey | 'product'

interface GroupedRow {
  key: string
  label: string
  tx_count: number
  revenue_usd: number
  gross_sales_usd: number
  discount_usd: number
  refund_usd: number
  pending_revenue_usd: number
  avg_order_usd: number
  cost_usd?: number
  profit_usd?: number
}

interface ProductRow {
  product_id: number | null
  product_name: string
  sale_count: number
  qty: number
  line_sales_usd: number
  cost_usd?: number
  profit_usd?: number
  cost_missing_snapshot_lines?: number
}

interface ReportsBreakdownSectionProps {
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function normalizeGrouped(raw: unknown): GroupedRow {
  const r = (raw || {}) as Record<string, unknown>
  const row: GroupedRow = {
    key: String(r.key ?? ''),
    label: String(r.label ?? ''),
    tx_count: num(r.tx_count),
    revenue_usd: num(r.revenue_usd),
    gross_sales_usd: num(r.gross_sales_usd),
    discount_usd: num(r.discount_usd),
    refund_usd: num(r.refund_usd),
    pending_revenue_usd: num(r.pending_revenue_usd),
    avg_order_usd: num(r.avg_order_usd),
  }
  // Admin-only figures stay ABSENT when the server omitted them.
  if ('cost_usd' in r) row.cost_usd = num(r.cost_usd)
  if ('profit_usd' in r) row.profit_usd = num(r.profit_usd)
  return row
}

function normalizeProduct(raw: unknown): ProductRow {
  const r = (raw || {}) as Record<string, unknown>
  const row: ProductRow = {
    product_id: r.product_id == null ? null : Number(r.product_id),
    product_name: String(r.product_name ?? ''),
    sale_count: num(r.sale_count),
    qty: num(r.qty),
    line_sales_usd: num(r.line_sales_usd),
  }
  if ('cost_usd' in r) row.cost_usd = num(r.cost_usd)
  if ('profit_usd' in r) row.profit_usd = num(r.profit_usd)
  if ('cost_missing_snapshot_lines' in r) row.cost_missing_snapshot_lines = num(r.cost_missing_snapshot_lines)
  return row
}

export default function ReportsBreakdownSection({ t, fmtMoney, range, branchId, active = true, titleNode }: ReportsBreakdownSectionProps) {
  const trh = (key: string, fallback: string): string => { const v = t(key); return v && v !== key ? v : fallback }
  const [view, setView] = useState<ViewKey>('customer')
  const [rows, setRows] = useState<GroupedRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [totals, setTotals] = useState<GroupedRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const viewOptions = useMemo<AppSelectOption[]>(() => [
    { value: 'customer', label: trh('by_customer', 'By customer') },
    { value: 'cashier', label: trh('by_cashier', 'By cashier') },
    { value: 'payment_method', label: trh('by_payment_method', 'By payment method') },
    { value: 'hour', label: trh('by_hour', 'By hour of day') },
    { value: 'weekday', label: trh('by_weekday', 'By weekday') },
    { value: 'branch', label: trh('by_branch', 'By branch') },
    { value: 'product', label: trh('by_product', 'By product') },
  ], [t]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!range.startDate || !range.endDate) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    const params = {
      startDate: range.startDate,
      endDate: range.endDate,
      ...(range.startTime && range.endTime ? { startTime: range.startTime, endTime: range.endTime } : {}),
      ...(branchId ? { branchId } : {}),
    }
    try {
      if (view === 'product') {
        const result = await getProductSalesRanking(params) as { rows?: unknown[] } | null
        if (requestRef.current !== requestId) return
        setProducts((result?.rows || []).map(normalizeProduct))
        setRows([])
        setTotals(null)
      } else {
        const result = await getSalesGroupedTotals({ ...params, groupBy: view }) as { rows?: unknown[]; totals?: unknown } | null
        if (requestRef.current !== requestId) return
        setRows((result?.rows || []).map(normalizeGrouped))
        setTotals(result?.totals ? normalizeGrouped(result.totals) : null)
        setProducts([])
      }
    } catch (err) {
      if (requestRef.current !== requestId) return
      setError(err instanceof Error ? err.message : String(err))
      setRows([]); setProducts([]); setTotals(null)
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [range.startDate, range.endDate, range.startTime, range.endTime, branchId, view])

  useEffect(() => { if (active) void load() }, [active, load])

  const showProfit = view === 'product'
    ? products.some((p) => p.profit_usd != null)
    : rows.some((r) => r.profit_usd != null) || totals?.profit_usd != null

  const rowLabel = (row: GroupedRow): string => {
    if (view === 'hour') return `${row.key.padStart(2, '0')}:00`
    if (view === 'weekday') {
      const idx = Number(row.key)
      const name = WEEKDAYS[idx] || row.key
      return trh(name.toLowerCase(), name)
    }
    return row.label || trh('unknown', 'Unknown')
  }

  // The sum of what is on screen, against the kernel's own total for the
  // same filters. Equal is the expected state; anything else is shown.
  const summedRevenue = rows.reduce((s, r) => s + r.revenue_usd, 0)
  const reconciles = totals ? Math.abs(summedRevenue - totals.revenue_usd) < 0.005 : null

  const exportCsv = () => {
    if (view === 'product') {
      downloadCSV(`products-${range.startDate}-${range.endDate}.csv`, products.map((p) => ({
        [trh('product', 'Product')]: p.product_name,
        [trh('quantity', 'Qty')]: p.qty,
        [trh('sales', 'Sales')]: p.sale_count,
        [trh('line_sales', 'Line sales')]: p.line_sales_usd,
        ...(p.profit_usd != null ? { [trh('profit', 'Profit')]: p.profit_usd } : {}),
      })))
      return
    }
    downloadCSV(`breakdown-${view}-${range.startDate}-${range.endDate}.csv`, rows.map((r) => ({
      [trh('name', 'Name')]: rowLabel(r),
      [trh('transactions', 'Transactions')]: r.tx_count,
      [trh('revenue', 'Revenue')]: r.revenue_usd,
      [trh('avg_order', 'Average order')]: r.avg_order_usd,
      [trh('refunds', 'Refunds')]: r.refund_usd,
      ...(r.profit_usd != null ? { [trh('profit', 'Profit')]: r.profit_usd } : {}),
    })))
  }

  const empty = !loading && !error && (view === 'product' ? products.length === 0 : rows.length === 0)

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{titleNode}</div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <AppSelect
            value={view}
            options={viewOptions}
            onChange={(next) => setView(next as ViewKey)}
            ariaLabel={trh('break_down_by', 'Break down by')}
            buttonClassName="min-w-0 py-1 text-xs sm:max-w-[11rem]"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || empty}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" /> {trh('export', 'Export')}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>
      ) : null}
      {loading ? <p className="text-xs text-slate-400">{trh('loading', 'Loading')}…</p> : null}
      {empty ? <p className="py-3 text-center text-xs text-slate-400">{trh('no_data', 'No data for this range')}</p> : null}

      {/* The table scrolls inside its own box; the page itself never scrolls
          sideways at 375px. */}
      {!empty && !loading ? (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {view === 'product' ? (
                  <>
                    <th className="py-1.5 pr-2 font-medium">{trh('product', 'Product')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('quantity', 'Qty')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('sales', 'Sales')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('line_sales', 'Line sales')}</th>
                    {showProfit ? <th className="py-1.5 text-right font-medium">{trh('profit', 'Profit')}</th> : null}
                  </>
                ) : (
                  <>
                    <th className="py-1.5 pr-2 font-medium">{trh('name', 'Name')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('tx_count_short', 'Tx')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('revenue', 'Revenue')}</th>
                    <th className="py-1.5 pr-2 text-right font-medium">{trh('avg_order', 'Avg')}</th>
                    {showProfit ? <th className="py-1.5 text-right font-medium">{trh('profit', 'Profit')}</th> : null}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {view === 'product' ? products.map((p, i) => (
                <tr key={`${p.product_id ?? 'n'}-${i}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="max-w-[14rem] truncate py-1.5 pr-2 text-slate-700 dark:text-slate-200">{p.product_name || trh('unknown', 'Unknown')}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{p.qty}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{p.sale_count}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">{fmtMoney(p.line_sales_usd)}</td>
                  {showProfit ? <td className="py-1.5 text-right tabular-nums text-blue-600 dark:text-blue-400">{p.profit_usd != null ? fmtMoney(p.profit_usd) : '—'}</td> : null}
                </tr>
              )) : rows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="max-w-[14rem] truncate py-1.5 pr-2 text-slate-700 dark:text-slate-200">{rowLabel(r)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.tx_count}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{fmtMoney(r.revenue_usd)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtMoney(r.avg_order_usd)}</td>
                  {showProfit ? <td className="py-1.5 text-right tabular-nums text-blue-600 dark:text-blue-400">{r.profit_usd != null ? fmtMoney(r.profit_usd) : '—'}</td> : null}
                </tr>
              ))}
            </tbody>
            {totals && view !== 'product' ? (
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-600">
                  <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{trh('total', 'Total')}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{totals.tx_count}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmtMoney(totals.revenue_usd)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtMoney(totals.avg_order_usd)}</td>
                  {showProfit ? <td className="py-1.5 text-right tabular-nums text-blue-700 dark:text-blue-400">{totals.profit_usd != null ? fmtMoney(totals.profit_usd) : '—'}</td> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {view === 'product' && !empty ? (
        <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
          {trh('reports_line_sales_note', 'Line sales are item totals before order-level discounts and refunds, so they do not add up to revenue.')}
        </p>
      ) : null}
      {reconciles === true ? (
        <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
          {trh('reports_rows_reconcile', 'These rows add up to the total, and the total is the same figure the Sales list shows.')}
        </p>
      ) : null}
      {reconciles === false ? (
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          {trh('reports_rows_capped', 'Only the top rows are listed, so they add up to less than the total.')}
        </p>
      ) : null}
    </div>
  )
}
