import { useState } from 'react'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Modal from '../shared/Modal'
import DateTimeRangePicker, { todayDateTimeRange, type DateTimeRange } from '../shared/DateTimeRangePicker.tsx'
import StatusBadge from './StatusBadge'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { fmtDateOnly } from '../../utils/formatters.ts'
import { SALES_IMPORT_COLUMNS } from '../../utils/salesImportContract.ts'

const SALES_EXPORT_PREVIEW_TIMEOUT_MS = 20000
const SALES_EXPORT_CSV_TIMEOUT_MS = 30000

type TranslateFn = (key: string) => string
type MoneyFormatter = (value: number) => string

interface ExportModalProps {
  onClose: () => void
  t?: TranslateFn
  fmtUSD: MoneyFormatter
}

interface ExportDates {
  start: string
  end: string
  startTime: string
  endTime: string
}

type CsvRow = Record<string, unknown>

interface SalesExportSummary {
  total_transactions?: number
  completed_transactions?: number
  revenue_usd?: number
  cogs_usd?: number
  gross_profit_usd?: number
  gross_margin_pct?: number
  total_discounts_usd?: number
  total_tax_usd?: number
  total_delivery_usd?: number
  total_refunds_usd?: number
  net_revenue_usd?: number
  avg_order_usd?: number
  [key: string]: unknown
}

interface SalesExportStatusRow {
  status?: unknown
  count?: number
  revenue?: number
}

interface SalesExportProductRow {
  product_id?: string | number | null
  product_name?: string | null
  qty_sold?: number
  revenue_usd?: number
}

interface SalesExportData {
  period?: Partial<ExportDates>
  summary?: SalesExportSummary
  by_status?: SalesExportStatusRow[]
  by_product?: SalesExportProductRow[]
  sales?: CsvRow[]
  truncated?: boolean
  total_matching?: number
  snapshot_max_id?: number | null
  has_more?: boolean
  next_cursor?: { created_at?: string; id?: number } | null
}

interface SalesExportApi {
  getSalesExport: (params: {
    startDate: string; endDate: string; startTime: string; endTime: string; format?: 'csv'; detailsOnly?: string; pageSize?: string
    snapshotMaxId?: string; afterCreatedAt?: string; afterId?: string
  }) => Promise<SalesExportData | string>
}

function getSalesExportApi(): SalesExportApi {
  if (!window.api) throw new Error('Sales export API is not available.')
  return window.api as SalesExportApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function ExportModal({ onClose, t, fmtUSD }: ExportModalProps) {
  const [range, setRange] = useState<DateTimeRange>(todayDateTimeRange)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<SalesExportData | null>(null)

  const tr = (key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const validateDates = (): ExportDates => {
    const dates = { start: range.startDate, end: range.endDate, startTime: range.startTime, endTime: range.endTime }
    if (!dates.start || !dates.end) {
      throw new Error(tr('please_select_start_end_dates', 'Please select start and end dates'))
    }
    return dates
  }

  const downloadCsvBlob = (text: string, dates: ExportDates): void => {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sales-export-${dates.start}-${dates.end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buildCsvFallback = (data: SalesExportData): string => {
    if (!data?.sales?.length) throw new Error(tr('no_data_to_export', 'No data to export'))
    const rows = data.sales
    const headers = [...SALES_IMPORT_COLUMNS]
    const escape = (value: unknown): string => {
      if (value == null) return ''
      const text = String(value)
      return text.includes(',') || text.includes('"') || text.includes('\n')
        ? `"${text.replace(/"/g, '""')}"`
        : text
    }
    // Deliberately no report-title/summary preamble: this CSV is the
    // authoritative import-compatible detail file. The accounting summary
    // stays in Preview, while the downloaded file can round-trip directly
    // through Sales Import without deleting decorative rows by hand.
    return '\uFEFF' + [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n')
  }

  const handlePreview = async () => {
    try {
      const dates = validateDates()
      setLoading(true)
      const data = await withLoaderTimeout(
        () => getSalesExportApi().getSalesExport({ startDate: dates.start, endDate: dates.end, startTime: dates.startTime, endTime: dates.endTime }),
        'Sales export preview',
        SALES_EXPORT_PREVIEW_TIMEOUT_MS,
      )
      if (typeof data === 'string') throw new Error(tr('error_loading_export', 'Error loading export'))
      setPreview(data)
    } catch (error) {
      alert(getErrorMessage(error, tr('error_loading_export', 'Error loading export')))
    } finally {
      setLoading(false)
    }
  }

  const handleExportCSV = async () => {
    try {
      const dates = validateDates()
      setLoading(true)
      const api = getSalesExportApi()
      const first = await withLoaderTimeout(
        () => api.getSalesExport({ startDate: dates.start, endDate: dates.end, startTime: dates.startTime, endTime: dates.endTime, detailsOnly: 'true', pageSize: '500' }),
        'Sales export CSV',
        SALES_EXPORT_CSV_TIMEOUT_MS,
      )
      if (typeof first === 'string') throw new Error(tr('error_loading_export', 'Error loading export'))
      const rows = [...(first.sales || [])]
      let page = first
      while (page.has_more) {
        const cursor = page.next_cursor
        if (!cursor?.created_at || !cursor.id || !page.snapshot_max_id) {
          throw new Error(tr('sales_export_cursor_stalled', 'Sales export could not advance to the next page safely.'))
        }
        const next = await withLoaderTimeout(
          () => api.getSalesExport({
            startDate: dates.start, endDate: dates.end, startTime: dates.startTime, endTime: dates.endTime, detailsOnly: 'true', pageSize: '500',
            snapshotMaxId: String(page.snapshot_max_id), afterCreatedAt: cursor.created_at, afterId: String(cursor.id),
          }),
          'Sales export CSV page',
          SALES_EXPORT_CSV_TIMEOUT_MS,
        )
        if (typeof next === 'string') throw new Error(tr('error_loading_export', 'Error loading export'))
        rows.push(...(next.sales || []))
        page = next
      }
      const csvText = buildCsvFallback({ ...first, sales: rows })
      downloadCsvBlob(csvText, dates)
    } catch (error) {
      alert(getErrorMessage(error, tr('export_error', 'Export error')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={tr('export_sales_report', 'Export Sales Report')} onClose={onClose} wide unsavedChanges="read-only">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="rounded-2xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{tr('export_sales_report', 'Export Sales Report')}</div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tr('export_sales_hint', 'Preview the accounting summary first, then export the detailed CSV for the selected date range.')}
            </div>
          </div>
        </div>

        <fieldset className="min-w-0" disabled={loading}>
          <legend className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{tr('report_period', 'Report Period')}</legend>
          <DateTimeRangePicker value={range} onChange={(next) => { setRange(next); setPreview(null) }} t={(key) => tr(key, key)} showTime continuous={false} className="w-full" triggerClassName="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm" />
        </fieldset>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={handlePreview} disabled={loading} className="btn-secondary flex-1 text-sm disabled:opacity-50">
            <Eye className="mr-2 inline h-4 w-4" />
            {loading ? tr('loading', 'Loading...') : tr('preview_summary', 'Preview Summary')}
          </button>
          <button type="button" onClick={handleExportCSV} disabled={loading} className="btn-primary flex-1 text-sm disabled:opacity-50">
            <Upload className="mr-2 inline h-4 w-4" />
            {loading ? tr('loading', 'Loading...') : tr('export_csv_btn', 'Export CSV')}
          </button>
        </div>

        {preview ? (
          <div className="space-y-4">
            {preview.truncated ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                {tr('sales_export_truncated_warning', 'This date range has {total} matching sales, but only the first 5,000 are included in this preview and the CSV export. Narrow the date range to get everything.').replace('{total}', String(preview.total_matching ?? ''))}
              </div>
            ) : null}
            <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-700/50">
              <div className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                {tr('accounting_summary', 'Accounting Summary')} {tr('accounting_summary_period', '{start} to {end}').replace('{start}', fmtDateOnly(preview.period?.start ?? '')).replace('{end}', fmtDateOnly(preview.period?.end ?? ''))}
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {([
                  [tr('total_transactions', 'Total Transactions'), preview.summary?.total_transactions],
                  [tr('completed_sales', 'Completed Sales'), preview.summary?.completed_transactions],
                  [tr('revenue_usd', 'Revenue (USD)'), fmtUSD(preview.summary?.revenue_usd || 0)],
                  [`${tr('cogs', 'COGS')} (USD)`, fmtUSD(preview.summary?.cogs_usd || 0)],
                  [tr('gross_profit', 'Gross Profit'), fmtUSD(preview.summary?.gross_profit_usd || 0)],
                  [tr('margin_pct', 'Margin %'), `${preview.summary?.gross_margin_pct || 0}%`],
                  [tr('discounts', 'Discounts'), fmtUSD(preview.summary?.total_discounts_usd || 0)],
                  [tr('tax_collected', 'Tax Collected'), fmtUSD(preview.summary?.total_tax_usd || 0)],
                  [tr('delivery_fees', 'Delivery Fees'), fmtUSD(preview.summary?.total_delivery_usd || 0)],
                  [tr('total_refunded', 'Total Refunded'), fmtUSD(preview.summary?.total_refunds_usd || 0)],
                  [tr('net_revenue', 'Net Revenue'), fmtUSD(preview.summary?.net_revenue_usd || 0)],
                  [tr('avg_order', 'Avg Order'), fmtUSD(preview.summary?.avg_order_usd || 0)],
                ] satisfies Array<[string, string | number | undefined]>).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {preview.by_status?.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{tr('by_status', 'By Status')}</div>
                <div className="space-y-1">
                  {preview.by_status.map((row) => (
                    <div key={String(row.status || 'status')} className="flex items-center justify-between border-b border-gray-100 py-1 text-sm dark:border-gray-700">
                      <StatusBadge status={row.status} t={t} />
                      <span className="text-gray-500">{tr('export_status_sales_count', '{count} sales').replace('{count}', String(row.count ?? 0))} · {fmtUSD(row.revenue || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.by_product?.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{tr('top_products', 'Top Products')}</div>
                <div className="space-y-1">
                  {preview.by_product.slice(0, 8).map((row, index) => (
                    <div key={`${row.product_id || row.product_name}-${index}`} className="flex items-center justify-between border-b border-gray-100 py-1 text-sm dark:border-gray-700">
                      <span className="mr-2 min-w-0 flex-1 detail-scroll-text text-gray-700 dark:text-gray-300">{row.product_name}</span>
                      <span className="shrink-0 text-gray-500">{tr('export_product_qty_sold', '{count} sold').replace('{count}', String(row.qty_sold ?? 0))} · {fmtUSD(row.revenue_usd || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
