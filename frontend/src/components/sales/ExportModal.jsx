import { useMemo, useState } from 'react'
import { CalendarRange, Download, Eye, FileSpreadsheet } from 'lucide-react'
import Modal from '../shared/Modal'
import StatusBadge from './StatusBadge'

export default function ExportModal({ onClose, t, fmtUSD }) {
  const [period, setPeriod] = useState('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)

  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const computeDates = (selectedPeriod) => {
    const now = new Date()
    if (selectedPeriod === 'daily') {
      const day = now.toISOString().split('T')[0]
      return { start: day, end: day }
    }
    if (selectedPeriod === 'monthly') {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
      return { start, end }
    }
    if (selectedPeriod === 'yearly') {
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
    }
    return { start: startDate, end: endDate }
  }

  const previewDates = useMemo(() => computeDates(period), [period, startDate, endDate])

  const validateDates = () => {
    const dates = computeDates(period)
    if (!dates.start || !dates.end) {
      throw new Error(tr('please_select_start_end_dates', 'Please select start and end dates'))
    }
    return dates
  }

  const downloadCsvBlob = (text, dates) => {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sales-export-${dates.start}-${dates.end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buildCsvFallback = (data, dates) => {
    if (!data?.sales?.length) throw new Error(tr('no_data_to_export', 'No data to export'))
    const rows = data.sales
    const headers = Object.keys(rows[0] || {})
    const escape = (value) => {
      if (value == null) return ''
      const text = String(value)
      return text.includes(',') || text.includes('"') || text.includes('\n')
        ? `"${text.replace(/"/g, '""')}"`
        : text
    }
    const summaryLines = Object.entries(data.summary || {}).map(([key, value]) => `${key},${value}`).join('\n')
    return [
      'SALES EXPORT REPORT',
      `Period: ${dates.start} to ${dates.end}`,
      '',
      'SUMMARY',
      summaryLines,
      '',
      'SALES DETAIL',
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n')
  }

  const handlePreview = async () => {
    try {
      const dates = validateDates()
      setLoading(true)
      const data = await window.api.getSalesExport({ startDate: dates.start, endDate: dates.end })
      setPreview(data)
    } catch (error) {
      alert(error?.message || tr('error_loading_export', 'Error loading export'))
    } finally {
      setLoading(false)
    }
  }

  const handleExportCSV = async () => {
    try {
      const dates = validateDates()
      setLoading(true)
      const data = await window.api.getSalesExport({ startDate: dates.start, endDate: dates.end, format: 'csv' })
      const csvText = typeof data === 'string' ? data : buildCsvFallback(data, dates)
      downloadCsvBlob(csvText, dates)
    } catch (error) {
      alert(error?.message || tr('export_error', 'Export error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={tr('export_sales_report', 'Export Sales Report')} onClose={onClose} wide>
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

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">{tr('report_period', 'Report Period')}</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['daily', tr('period_daily', 'Daily')],
              ['monthly', tr('period_monthly', 'Monthly')],
              ['yearly', tr('period_yearly', 'Yearly')],
              ['custom', tr('period_custom', 'Custom')],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`rounded-xl border-2 px-3 py-2 text-sm font-medium ${
                  period === value
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {period === 'custom' ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">{tr('start_date', 'Start Date')}</label>
                <input type="date" className="input text-sm" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{tr('end_date', 'End Date')}</label>
                <input type="date" className="input text-sm" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
          ) : (
            <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
              <CalendarRange className="h-4 w-4" />
              {previewDates.start} to {previewDates.end}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={handlePreview} disabled={loading} className="btn-secondary flex-1 text-sm disabled:opacity-50">
            <Eye className="mr-2 inline h-4 w-4" />
            {loading ? tr('loading', 'Loading...') : tr('preview_summary', 'Preview Summary')}
          </button>
          <button type="button" onClick={handleExportCSV} disabled={loading} className="btn-primary flex-1 text-sm disabled:opacity-50">
            <Download className="mr-2 inline h-4 w-4" />
            {loading ? tr('loading', 'Loading...') : tr('export_csv_btn', 'Export CSV')}
          </button>
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-700/50">
              <div className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                {tr('accounting_summary', 'Accounting Summary')} {preview.period?.start} to {preview.period?.end}
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {[
                  ['Total Transactions', preview.summary?.total_transactions],
                  ['Completed Sales', preview.summary?.completed_transactions],
                  ['Revenue (USD)', fmtUSD(preview.summary?.revenue_usd || 0)],
                  ['COGS (USD)', fmtUSD(preview.summary?.cogs_usd || 0)],
                  ['Gross Profit', fmtUSD(preview.summary?.gross_profit_usd || 0)],
                  ['Margin %', `${preview.summary?.gross_margin_pct || 0}%`],
                  ['Discounts', fmtUSD(preview.summary?.total_discounts_usd || 0)],
                  ['Tax Collected', fmtUSD(preview.summary?.total_tax_usd || 0)],
                  ['Delivery Fees', fmtUSD(preview.summary?.total_delivery_usd || 0)],
                  ['Total Refunds', fmtUSD(preview.summary?.total_refunds_usd || 0)],
                  ['Net Revenue', fmtUSD(preview.summary?.net_revenue_usd || 0)],
                  ['Avg Order', fmtUSD(preview.summary?.avg_order_usd || 0)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {preview.by_status?.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">By Status</div>
                <div className="space-y-1">
                  {preview.by_status.map((row) => (
                    <div key={row.status} className="flex items-center justify-between border-b border-gray-100 py-1 text-sm dark:border-gray-700">
                      <StatusBadge status={row.status} t={t} />
                      <span className="text-gray-500">{row.count} sales · {fmtUSD(row.revenue || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {preview.by_product?.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Top Products</div>
                <div className="space-y-1">
                  {preview.by_product.slice(0, 8).map((row, index) => (
                    <div key={`${row.product_id || row.product_name}-${index}`} className="flex items-center justify-between border-b border-gray-100 py-1 text-sm dark:border-gray-700">
                      <span className="mr-2 min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{row.product_name}</span>
                      <span className="shrink-0 text-gray-500">{row.qty_sold} sold · {fmtUSD(row.revenue_usd || 0)}</span>
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
