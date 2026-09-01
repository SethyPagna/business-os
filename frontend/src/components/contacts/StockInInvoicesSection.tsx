import { useCallback, useEffect, useRef, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import AppSelect from '../shared/AppSelect.tsx'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import { fmtDateOnly } from '../../utils/formatters'
import { getStockInInvoiceLines, getStockInInvoiceReport } from '../../api/contactReadTransport.ts'

type TranslateFn = (key: string) => string | undefined

// D1b: the Stock-In Invoice report — purchases grouped supplier → invoice
// (received date) → product lines, modeled on the old system's report,
// with the standard filter row: branch · supplier · date range. Lines load
// per invoice on expand and page separately, so one huge group (the
// catalog import's synthetic same-day batches) can never balloon the
// response. Mounted inside the Suppliers tab, so the contacts_suppliers
// gate covers it front and back — per-lot costs and supplier spend are
// exactly what that grant protects.
//
// An "invoice" is one supplier's receipts on one calendar day: the old
// system's invoice NUMBER was never stored in this schema, so the date is
// the honest grouping. Lots with no recorded branch/date/supplier show
// under explicit "not recorded" labels instead of being hidden.

type InvoiceGroup = {
  supplier_key: string
  supplier_name?: string | null
  received_day: string
  line_count: number
  units_received: number | null
  cost_usd: number | null
  lines_without_cost: number
  credit_lines: number
  branch_ids?: string | null
}

type ReportTotals = {
  invoices?: number
  lines?: number
  units_received?: number
  cost_usd?: number
  lines_without_cost?: number
  credit_lines?: number
  invoices_without_branch?: number
}

type ReportPayload = {
  invoices?: InvoiceGroup[]
  totals?: ReportTotals
  page?: number
  page_size?: number
  total_invoices?: number
  meta?: {
    branches?: Array<{ id: number; name?: string | null }>
    suppliers?: Array<{ key: string; name?: string | null }>
  }
}

type InvoiceLine = {
  id: number
  batch_number?: number | null
  lot_code?: string | null
  received_quantity?: number | null
  unit_cost_usd?: number | null
  line_total_usd?: number | null
  payment_status?: string | null
  credit_due_date?: string | null
  received_branch_name?: string | null
  product_name?: string | null
  barcode?: string | null
  unit?: string | null
  remaining_quantity?: number | null
}

type LinesState = {
  lines: InvoiceLine[]
  page: number
  pageSize: number
  total: number
  loading: boolean
  error: string
}

type StockInInvoicesSectionProps = {
  t: TranslateFn
}

const GROUP_PAGE_SIZE = 15
const LINE_PAGE_SIZE = 100

function groupKeyOf(group: InvoiceGroup): string {
  return `${group.supplier_key}|${group.received_day || 'none'}`
}

export default function StockInInvoicesSection({ t }: StockInInvoicesSectionProps) {
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [branchId, setBranchId] = useState('all')
  const [supplierKey, setSupplierKey] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, LinesState>>({})
  const aliveRef = useRef(true)
  const requestRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    getStockInInvoiceReport({
      branch_id: branchId === 'all' ? '' : branchId,
      supplier: supplierKey === 'all' ? '' : supplierKey,
      from: fromDate,
      to: toDate,
      page,
      page_size: GROUP_PAGE_SIZE,
    })
      .then((result) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setData((result || {}) as ReportPayload)
        // A filter change makes the open groups' line sets stale (the
        // branch filter also scopes lines), so they collapse.
        setExpanded({})
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : tr('stock_in_invoices_failed', 'Failed to load the stock-in invoice report'))
      })
      .finally(() => {
        if (aliveRef.current && requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, supplierKey, fromDate, toDate, page, refreshToken])

  const loadLines = useCallback((group: InvoiceGroup, linePage: number) => {
    const key = groupKeyOf(group)
    setExpanded((current) => ({
      ...current,
      [key]: {
        lines: current[key]?.lines || [],
        page: linePage,
        pageSize: LINE_PAGE_SIZE,
        total: current[key]?.total || 0,
        loading: true,
        error: '',
      },
    }))
    getStockInInvoiceLines({
      supplier_key: group.supplier_key,
      day: group.received_day || 'none',
      branch_id: branchId === 'all' ? '' : branchId,
      page: linePage,
      page_size: LINE_PAGE_SIZE,
    })
      .then((result) => {
        if (!aliveRef.current) return
        const payload = (result || {}) as { lines?: InvoiceLine[]; total_lines?: number }
        setExpanded((current) => (current[key] ? {
          ...current,
          [key]: {
            lines: Array.isArray(payload.lines) ? payload.lines : [],
            page: linePage,
            pageSize: LINE_PAGE_SIZE,
            total: Number(payload.total_lines) || 0,
            loading: false,
            error: '',
          },
        } : current))
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return
        setExpanded((current) => (current[key] ? {
          ...current,
          [key]: {
            ...current[key],
            loading: false,
            error: err instanceof Error ? err.message : tr('stock_in_invoices_failed', 'Failed to load the stock-in invoice report'),
          },
        } : current))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId])

  const toggleGroup = (group: InvoiceGroup) => {
    const key = groupKeyOf(group)
    if (expanded[key]) {
      setExpanded((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      return
    }
    loadLines(group, 1)
  }

  const totals = data?.totals || {}
  const invoices = Array.isArray(data?.invoices) ? data!.invoices! : []
  const branches = Array.isArray(data?.meta?.branches) ? data!.meta!.branches! : []
  const supplierOptions = Array.isArray(data?.meta?.suppliers) ? data!.meta!.suppliers! : []
  const totalInvoices = Number(data?.total_invoices) || 0
  const totalPages = Math.max(1, Math.ceil(totalInvoices / GROUP_PAGE_SIZE))
  const branchNameById = new Map(branches.map((branch) => [String(branch.id), String(branch.name || '')]))

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const qty = (value: unknown): string => (value == null ? '--' : String(Number(value) || 0))
  const anyFilter = branchId !== 'all' || supplierKey !== 'all' || fromDate !== '' || toDate !== ''

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const supplierLabel = (group: InvoiceGroup): string => {
    if (group.supplier_key === 'none') return tr('no_supplier_recorded', 'No supplier recorded')
    return String(group.supplier_name || '').trim() || tr('no_supplier_recorded', 'No supplier recorded')
  }

  const groupBranchNames = (group: InvoiceGroup): string => {
    const ids = String(group.branch_ids || '').split(',').map((id) => id.trim()).filter(Boolean)
    return ids.map((id) => branchNameById.get(id) || `#${id}`).join(', ')
  }

  const paymentChip = (line: InvoiceLine) => {
    if (line.payment_status === 'credit') {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {tr('on_credit', 'On credit')}{line.credit_due_date ? ` · ${fmtDateOnly(line.credit_due_date)}` : ''}
        </span>
      )
    }
    if (line.payment_status === 'paid') {
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
    }
    return <span className="text-[11px] text-gray-400">--</span>
  }

  return (
    <div className="space-y-3 p-3">
      {/* The report's standard filter row: branch · supplier · date range.
          Part 567: kept to a single scrollable line (user: "the filters
          options one row") rather than wrapping to two. */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
        <AppSelect
          ariaLabel={tr('branch', 'Branch')}
          value={branchId}
          onChange={(value) => changeFilter(() => setBranchId(value))}
          className="min-w-[9rem]"
          options={[
            { value: 'all', label: tr('all_branches', 'All Branches') },
            ...branches.map((branch) => ({ value: String(branch.id), label: String(branch.name || `#${branch.id}`) })),
          ]}
        />
        <AppSelect
          ariaLabel={tr('supplier', 'Supplier')}
          value={supplierKey}
          onChange={(value) => changeFilter(() => setSupplierKey(value))}
          className="min-w-[11rem]"
          options={[
            { value: 'all', label: tr('all_suppliers', 'All Suppliers') },
            { value: 'none', label: tr('no_supplier_recorded', 'No supplier recorded') },
            ...supplierOptions.map((option) => ({ value: option.key, label: String(option.name || option.key) })),
          ]}
        />
        {/* Unified Start → End pill (same control the Dashboard, reports,
            Fees and Inventory movements use) instead of two loose inputs. */}
        <DateTimeRangePicker
          value={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
          onChange={(range) => changeFilter(() => {
            setFromDate(range.startDate || '')
            setToDate(range.endDate || '')
          })}
          t={t}
          showTime={false}
          triggerClassName="flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5"
        />
        {anyFilter ? (
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            onClick={() => changeFilter(() => { setBranchId('all'); setSupplierKey('all'); setFromDate(''); setToDate('') })}
          >
            {tr('clear', 'Clear')}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          <span>{error}</span>
          <button type="button" className="btn-secondary whitespace-nowrap py-1 text-xs" disabled={loading} onClick={() => setRefreshToken((current) => current + 1)}>
            {tr('retry', 'Retry')}
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>
      ) : (
        <>
          {/* Part 567: 4 stat cells, not 5 (user: "the stats can be 4 stats
              not 5... made more compact"). Invoices and Lines -- both plain
              counts -- share one cell so nothing is dropped. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [`${tr('stock_in_invoices_count', 'Invoices')} / ${tr('invoice_lines', 'Lines')}`, `${totals.invoices ?? 0} / ${totals.lines ?? 0}`],
              [tr('units_received', 'Units received'), qty(totals.units_received)],
              [tr('purchase_cost', 'Purchase cost'), money(totals.cost_usd)],
              [tr('credit_open', 'On credit'), String(totals.credit_lines ?? 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-3 py-1.5 dark:border-gray-700">
                <div className="text-[11px] text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>
          {Number(totals.lines_without_cost) > 0 ? (
            <div className="text-[11px] text-gray-400">
              {tr('purchase_cost_partial_hint', 'Some batches have no recorded quantity/cost yet (received before tracking, or cost unknown) -- the totals above only count batches where both are known:')} {totals.lines_without_cost}
            </div>
          ) : null}
          {branchId !== 'all' && Number(totals.invoices_without_branch) > 0 ? (
            <div className="text-[11px] text-amber-700 dark:text-amber-300">
              {tr('stock_in_invoices_no_branch_note', 'Invoices with no recorded receiving branch are not shown under this branch filter:')} {totals.invoices_without_branch}
            </div>
          ) : null}

          {invoices.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tr('stock_in_invoices_empty', 'No stock-in invoices match these filters.')}</div>
          ) : (
            <div className="space-y-2">
              {invoices.map((group) => {
                const key = groupKeyOf(group)
                const linesState = expanded[key]
                const branchNames = groupBranchNames(group)
                const linePages = linesState ? Math.max(1, Math.ceil(linesState.total / linesState.pageSize)) : 1
                return (
                  <div key={key} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                    <button
                      type="button"
                      className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      onClick={() => toggleGroup(group)}
                      aria-expanded={Boolean(linesState)}
                    >
                      <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${linesState ? '' : '-rotate-90'}`} />
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {group.received_day ? fmtDateOnly(group.received_day) : tr('no_date_recorded', 'No date recorded')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{supplierLabel(group)}</span>
                      {branchNames ? <span className="text-[11px] text-gray-400">{branchNames}</span> : null}
                      {group.credit_lines > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr('on_credit', 'On credit')}: {group.credit_lines}</span>
                      ) : null}
                      <span className="text-xs text-gray-500">{group.line_count} {tr('invoice_lines', 'Lines').toLowerCase()}</span>
                      <span className="text-xs text-gray-500">{qty(group.units_received)} {tr('units', 'Units').toLowerCase()}</span>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{money(group.cost_usd)}</span>
                    </button>
                    {linesState ? (
                      <div className="border-t border-gray-100 dark:border-gray-800">
                        {linesState.error ? (
                          <div className="px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{linesState.error}</div>
                        ) : linesState.loading && linesState.lines.length === 0 ? (
                          <div className="px-3 py-3 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[860px] text-left text-xs">
                                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                  <tr>
                                    <th className="px-3 py-2">{tr('product', 'Product')}</th>
                                    <th className="px-3 py-2">{tr('barcode', 'Barcode')}</th>
                                    <th className="px-3 py-2">{tr('batch', 'Batch')}</th>
                                    <th className="px-3 py-2 text-right">{tr('quantity_received', 'Qty received')}</th>
                                    <th className="px-3 py-2">{tr('unit', 'Unit')}</th>
                                    <th className="px-3 py-2 text-right">{tr('unit_cost_usd', 'Unit cost (USD)')}</th>
                                    <th className="px-3 py-2 text-right">{tr('total', 'Total')}</th>
                                    <th className="px-3 py-2">{tr('payment_to_supplier', 'Payment')}</th>
                                    <th className="px-3 py-2">{tr('received_branch', 'Received into')}</th>
                                    <th className="px-3 py-2 text-right">{tr('remaining', 'Remaining')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {linesState.lines.map((line) => (
                                    <tr key={line.id} className="border-t border-gray-100 dark:border-gray-800">
                                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{line.product_name || '--'}</td>
                                      <td className="px-3 py-2 text-gray-500">{line.barcode || '--'}</td>
                                      <td className="px-3 py-2 text-gray-500">{line.lot_code || (line.batch_number != null ? `#${line.batch_number}` : '--')}</td>
                                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{qty(line.received_quantity)}</td>
                                      <td className="px-3 py-2 text-gray-500">{line.unit || '--'}</td>
                                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{line.unit_cost_usd == null ? '--' : money(line.unit_cost_usd)}</td>
                                      <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{line.line_total_usd == null ? '--' : money(line.line_total_usd)}</td>
                                      <td className="px-3 py-2">{paymentChip(line)}</td>
                                      <td className="px-3 py-2 text-gray-500">{line.received_branch_name || tr('not_recorded', 'Not recorded')}</td>
                                      <td className="px-3 py-2 text-right text-gray-500">{qty(line.remaining_quantity)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {linePages > 1 ? (
                              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800">
                                <span>{tr('page', 'Page')} {linesState.page} / {linePages}</span>
                                <button type="button" className="btn-secondary py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={linesState.page <= 1 || linesState.loading} onClick={() => loadLines(group, linesState.page - 1)}>
                                  {tr('previous', 'Previous')}
                                </button>
                                <button type="button" className="btn-secondary py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={linesState.page >= linePages || linesState.loading} onClick={() => loadLines(group, linesState.page + 1)}>
                                  {tr('next', 'Next')}
                                </button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>{totalInvoices} {tr('stock_in_invoices_count', 'Invoices').toLowerCase()}</span>
              <div className="flex items-center gap-2">
                <span>{tr('page', 'Page')} {page} / {totalPages}</span>
                <button type="button" className="btn-secondary py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  {tr('previous', 'Previous')}
                </button>
                <button type="button" className="btn-secondary py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
                  {tr('next', 'Next')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
