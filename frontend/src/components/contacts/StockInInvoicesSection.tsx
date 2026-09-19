import { useApp } from '../../AppContext'
import { canViewAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import AppSelect from '../shared/AppSelect.tsx'
import SuggestionTextInput from '../shared/SuggestionTextInput.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import { fmtDateOnly } from '../../utils/formatters'
import { todayStr } from '../../utils/dateHelpers.ts'
import { getStockInInvoiceLines, getStockInInvoiceReport } from '../../api/contactReadTransport.ts'
import InvoiceLedgerSummary from './InvoiceLedgerSummary.tsx'
import InvoiceDetailFloat from './InvoiceDetailFloat.tsx'
import CopyableId from '../shared/CopyableId.tsx'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

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
  received_at?: string | null
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

const LINE_PAGE_SIZE = 100

function groupKeyOf(group: InvoiceGroup): string {
  return `${group.supplier_key}|${group.received_day || 'none'}`
}

export default function StockInInvoicesSection({ t }: StockInInvoicesSectionProps) {
  const { user } = useApp() as { user: any }
  const canViewCosts = canViewAcquisitionCosts(user)
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [branchId, setBranchId] = useState('all')
  const [supplierKey, setSupplierKey] = useState('all')
  const [supplierQuery, setSupplierQuery] = useState('')
  const initialToday = todayStr()
  const [fromDate, setFromDate] = useState(initialToday)
  const [toDate, setToDate] = useState(initialToday)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lineCache, setLineCache] = useState<Record<string, LinesState>>({})
  // P3-2: the invoice group whose detail float is open (user: "i meant float
  // when clicked on the invoice rows click to view details and sections").
  // Its product lines live in `lineCache`, keyed by group -- the float renders
  // that slot, so the loader/pager below is unchanged. There is no inline
  // expand any more: a row opens the float and nothing else (owner: "the
  // invoice is doing click to expand. instead it should be click to open view
  // detail float"), so the cache is named for what it is.
  const [detailGroup, setDetailGroup] = useState<InvoiceGroup | null>(null)
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
      page_size: pageSize,
    })
      .then((result) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        const nextData = (result || {}) as ReportPayload
        const nextPage = clampPage(page, Number(nextData.total_invoices) || 0, pageSize)
        if (nextPage !== page) {
          setPage(nextPage)
          return
        }
        setData(nextData)
        // A filter change makes the open group's line set stale (the branch
        // filter also scopes lines), so the cache is dropped and the float
        // closes with it rather than showing lines from the old filter.
        setLineCache({})
        setDetailGroup(null)
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : tr('stock_in_invoices_failed', 'Failed to load the stock-in invoice report'))
      })
      .finally(() => {
        if (aliveRef.current && requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, supplierKey, fromDate, toDate, page, pageSize, refreshToken])

  const loadLines = useCallback((group: InvoiceGroup, linePage: number) => {
    const key = groupKeyOf(group)
    setLineCache((current) => ({
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
        const total = Number(payload.total_lines) || 0
        const nextPage = clampPage(linePage, total, LINE_PAGE_SIZE)
        if (nextPage !== linePage) {
          window.setTimeout(() => loadLines(group, nextPage), 0)
          return
        }
        setLineCache((current) => (current[key] ? {
          ...current,
          [key]: {
            lines: Array.isArray(payload.lines) ? payload.lines : [],
            page: linePage,
            pageSize: LINE_PAGE_SIZE,
            total,
            loading: false,
            error: '',
          },
        } : current))
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return
        setLineCache((current) => (current[key] ? {
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

  // Clicking an invoice row opens its float. The lines are fetched on open
  // unless this group's page is already cached, so re-opening the same invoice
  // shows its rows immediately instead of flashing a loader.
  const openGroup = (group: InvoiceGroup) => {
    setDetailGroup(group)
    if (!lineCache[groupKeyOf(group)]) loadLines(group, 1)
  }

  const totals = data?.totals || {}
  const invoices = Array.isArray(data?.invoices) ? data!.invoices! : []
  const branches = Array.isArray(data?.meta?.branches) ? data!.meta!.branches! : []
  const supplierOptions = Array.isArray(data?.meta?.suppliers) ? data!.meta!.suppliers! : []
  const totalInvoices = Number(data?.total_invoices) || 0
  const branchNameById = new Map(branches.map((branch) => [String(branch.id), String(branch.name || '')]))

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const qty = (value: unknown): string => (value == null ? '--' : String(Number(value) || 0))
  const anyFilter = branchId !== 'all' || supplierKey !== 'all' || supplierQuery !== '' || fromDate !== '' || toDate !== ''

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const supplierLabel = (group: InvoiceGroup): string => {
    if (group.supplier_key === 'none') return tr('no_supplier_recorded', 'No supplier')
    return String(group.supplier_name || '').trim() || tr('no_supplier_recorded', 'No supplier')
  }

  const groupBranchNames = (group: InvoiceGroup): string => {
    const ids = String(group.branch_ids || '').split(',').map((id) => id.trim()).filter(Boolean)
    return ids.map((id) => branchNameById.get(id) || `#${id}`).join(', ')
  }

  const paymentChip = (line: InvoiceLine) => {
    if (line.payment_status === 'credit') {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {tr('on_credit', 'Not Yet Paid')}{line.credit_due_date ? ` · ${fmtDateOnly(line.credit_due_date)}` : ''}
        </span>
      )
    }
    if (line.payment_status === 'paid') {
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
    }
    return <span className="text-[11px] text-gray-400">--</span>
  }

  return (
    <div className="space-y-3 py-3 pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))]">
      {/* The filter + date row pins while the supplier-day groups scroll --
          the app-wide "search bar row and the date both can be pinned and
          stick ... for all sections and pages" convention, at the same
          `sticky top-2` offset the Customers/Suppliers/Delivery search rows
          use one level up. Outside the overflow-x-auto row on purpose: a
          horizontally scrolling box cannot itself be the sticky element. */}
      <div className="sticky top-2 z-30 -mx-3 -mt-3 space-y-1.5 bg-gray-50 px-3 pb-2 pt-3 dark:bg-gray-900">
      {/* P3-10. The Start→End range leads the pinned block on its OWN
          full-width row, exactly as Sales/Inventory/Branches do, because it
          used to be the THIRD control inside the `overflow-x-auto` filter
          line below -- on a phone that pushed it past the right edge, so the
          owner reported "invoice doesn't have start and end date ... i don't
          see it in small screens". StatsRangeRow also brings the preset chips
          (All time / Today / Yesterday / 7d / 30d / week / month / year), so
          widening a ledger no longer means opening the picker. */}
      <StatsRangeRow
        range={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
        onRangeChange={(range) => changeFilter(() => {
          setFromDate(range.startDate || '')
          setToDate(range.endDate || '')
        })}
        t={t}
      />
      {/* The report's standard filter row: branch · supplier.
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
        <SuggestionTextInput
          id="stock-in-invoice-supplier"
          ariaLabel={tr('supplier', 'Supplier')}
          value={supplierQuery}
          onChange={(value, option) => changeFilter(() => {
            // Names can repeat: only a picked row supplies the filter key.
            // Typing/clearing releases the old filter while searching options.
            setSupplierQuery(option?.payload === 'all' ? '' : value)
            setSupplierKey(option ? String(option.payload) : 'all')
          })}
          className="min-w-[11rem]"
          inputClassName="input h-9 w-full text-xs"
          placeholder={tr('all_suppliers', 'All Suppliers')}
          options={[
            { value: tr('all_suppliers', 'All Suppliers'), key: 'all', payload: 'all' },
            { value: tr('no_supplier_recorded', 'No supplier'), key: 'none', payload: 'none' },
            ...supplierOptions.map((option) => ({ value: String(option.name || option.key), key: option.key, payload: option.key, selected: supplierKey === option.key })),
          ]}
        />
        {anyFilter ? (
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            onClick={() => changeFilter(() => { setBranchId('all'); setSupplierKey('all'); setSupplierQuery(''); setFromDate(''); setToDate('') })}
          >
            {tr('clear', 'Clear')}
          </button>
        ) : null}
      </div>
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
          <InvoiceLedgerSummary
            ariaLabel={tr('stock_in_invoices', 'Stock-In invoices')}
            items={[
              { key: 'invoices', label: `${tr('stock_in_invoices_count', 'Invoices')} / ${tr('invoice_lines', 'Lines')}`, value: `${totals.invoices ?? 0} / ${totals.lines ?? 0}` },
              { key: 'units', label: tr('units_received', 'Units received'), value: qty(totals.units_received) },
              { key: 'credit', label: tr('credit_open', 'Not Yet Paid'), value: String(totals.credit_lines ?? 0) },
            ]}
            total={canViewCosts ? { key: 'total', label: tr('purchase_cost', 'Purchase cost'), value: money(totals.cost_usd) } : undefined}
          />
          {canViewCosts && Number(totals.lines_without_cost) > 0 ? (
            <div className="text-[11px] text-gray-400">
              {tr('purchase_cost_partial_hint', 'Some received dates have no recorded quantity/cost yet (received before tracking, or cost unknown) -- the totals above only count received dates where both are known:')} {totals.lines_without_cost}
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
            <>
            {/* P10-15 (owner: "the supplier display is not consistent like
                excel style in large screens"): this ledger used to be a bare
                stacked list of buttons at every width -- the only supplier
                list in the Suppliers tab without the dense header-row table
                its own sibling (Supplier AP Invoices, immediately below in
                the same chip switcher) already uses. Matching that sibling's
                exact table/card split rather than inventing a third shape. */}
            <div data-invoice-ledger-scroll className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200 dark:border-gray-700 md:block">
              <table className="w-full min-w-[860px] text-left text-xs tabular-nums">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">{tr('received_date', 'Received date')}</th>
                    <th className="px-3 py-2">{tr('supplier', 'Supplier')}</th>
                    <th className="px-3 py-2">{tr('received_branch', 'Received into')}</th>
                    <th className="px-3 py-2 text-right">{tr('invoice_lines', 'Lines')}</th>
                    <th className="px-3 py-2 text-right">{tr('units_received', 'Units received')}</th>
                    {canViewCosts ? <th className="px-3 py-2 text-right">{tr('purchase_cost', 'Purchase cost')}</th> : null}
                    <th className="px-3 py-2">{tr('on_credit', 'Not Yet Paid')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((group) => {
                    const key = groupKeyOf(group)
                    const branchNames = groupBranchNames(group)
                    return (
                      <tr
                        key={key}
                        className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-700/40"
                        onClick={() => openGroup(group)}
                        aria-haspopup="dialog"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-gray-800 dark:text-gray-100">
                          {group.received_day ? <time dateTime={group.received_day}>{fmtDateOnly(group.received_day)}</time> : tr('no_date_recorded', 'No date recorded')}
                        </td>
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{supplierLabel(group)}</td>
                        <td className="px-3 py-2 text-gray-500">{branchNames || tr('not_recorded', 'Not recorded')}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{group.line_count}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{qty(group.units_received)}</td>
                        {canViewCosts ? <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(group.cost_usd)}</td> : null}
                        <td className="px-3 py-2">
                          {group.credit_lines > 0 ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{group.credit_lines}</span>
                          ) : <span className="text-[11px] text-gray-400">--</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {invoices.map((group) => {
                const key = groupKeyOf(group)
                const branchNames = groupBranchNames(group)
                return (
                  <div key={key} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                    {/* P3-2: the row opens the invoice's float instead of
                        pushing an inline table into the list. One compact line
                        on a wide screen, wrapping on a phone. */}
                    <button
                      type="button"
                      className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      onClick={() => openGroup(group)}
                      aria-haspopup="dialog"
                    >
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                        {group.received_day ? <time dateTime={group.received_day}>{fmtDateOnly(group.received_day)}</time> : tr('no_date_recorded', 'No date recorded')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{supplierLabel(group)}</span>
                      {branchNames ? <span className="text-[11px] text-gray-400">{branchNames}</span> : null}
                      {group.credit_lines > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr('on_credit', 'Not Yet Paid')}: {group.credit_lines}</span>
                      ) : null}
                      <span className="text-xs text-gray-500">{group.line_count} {tr('invoice_lines', 'Lines').toLowerCase()}</span>
                      <span className="text-xs text-gray-500">{qty(group.units_received)} {tr('units', 'Units').toLowerCase()}</span>
                      {canViewCosts ? <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{money(group.cost_usd)}</span> : null}
                    </button>
                  </div>
                )
              })}
            </div>
            </>
          )}

          <div className="flex justify-center">
            <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalInvoices} label={tr('stock_in_invoices_count', 'Invoices').toLowerCase()} t={t} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
          </div>
        </>
      )}

      {detailGroup ? (() => {
        const linesState = lineCache[groupKeyOf(detailGroup)]
        const linePages = linesState ? Math.max(1, Math.ceil(linesState.total / linesState.pageSize)) : 1
        return (
          <InvoiceDetailFloat
            t={t}
            wide
            onClose={() => setDetailGroup(null)}
            title={`${tr('invoice_details', 'Invoice details')} -- ${supplierLabel(detailGroup)}`}
            idLabel={tr('received_date', 'Received date')}
            idValue={detailGroup.received_day ? fmtDateOnly(detailGroup.received_day) : tr('no_date_recorded', 'No date recorded')}
            badge={detailGroup.credit_lines > 0 ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium leading-5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {tr('on_credit', 'Not Yet Paid')}: {detailGroup.credit_lines}
              </span>
            ) : null}
            sections={[
              {
                key: 'invoice',
                title: tr('details', 'Details'),
                facts: [
                  { key: 'supplier', label: tr('supplier', 'Supplier'), value: supplierLabel(detailGroup) },
                  { key: 'received_day', label: tr('received_date', 'Received date'), value: detailGroup.received_day ? <time dateTime={detailGroup.received_day}>{fmtDateOnly(detailGroup.received_day)}</time> : tr('no_date_recorded', 'No date recorded') },
                  { key: 'branches', label: tr('received_branch', 'Received into'), value: groupBranchNames(detailGroup) || tr('not_recorded', 'Not recorded') },
                  { key: 'lines', label: tr('invoice_lines', 'Lines'), value: String(detailGroup.line_count) },
                  { key: 'units', label: tr('units_received', 'Units received'), value: qty(detailGroup.units_received) },
                  ...(canViewCosts ? [{ key: 'cost', label: tr('purchase_cost', 'Purchase cost'), value: money(detailGroup.cost_usd) }] : []),
                ],
              },
              {
                key: 'lines',
                title: tr('invoice_lines', 'Lines'),
                // Same table the ledger used to push inline. It lives here now
                // (user: the row click opens a float), still paging through the
                // existing per-invoice loader.
                content: linesState?.error ? (
                  <div className="px-3 py-2 text-sm leading-6 text-amber-800 dark:text-amber-200">{linesState.error}</div>
                ) : !linesState || (linesState.loading && linesState.lines.length === 0) ? (
                  <div className="px-3 py-3 text-center text-sm leading-6 text-gray-400">{tr('loading', 'Loading...')}</div>
                ) : (
                  <>
                    <div data-invoice-ledger-scroll className="max-w-full overflow-x-auto overscroll-x-contain">
                      <table className="w-full min-w-[860px] text-left text-xs tabular-nums">
                        <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          <tr>
                            <th className="px-3 py-2">{tr('product', 'Product')}</th>
                            <th className="px-3 py-2">{tr('barcode', 'Barcode')}</th>
                            <th className="px-3 py-2">{tr('batch', 'Received date')}</th>
                            <th className="px-3 py-2 text-right">{tr('quantity_received', 'Qty received')}</th>
                            <th className="px-3 py-2">{tr('unit', 'Unit')}</th>
                            {canViewCosts ? <th className="px-3 py-2 text-right">{tr('unit_cost_usd', 'Unit cost (USD)')}</th> : null}
                            {canViewCosts ? <th className="px-3 py-2 text-right">{tr('total', 'Total')}</th> : null}
                            <th className="px-3 py-2">{tr('payment_to_supplier', 'Payment')}</th>
                            <th className="px-3 py-2">{tr('received_branch', 'Received into')}</th>
                            <th className="px-3 py-2 text-right">{tr('remaining', 'Remaining')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linesState.lines.map((line) => (
                            <tr key={line.id} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-3 py-2 leading-6 text-gray-800 dark:text-gray-100">{line.product_name || '--'}</td>
                              <td className="px-3 py-2 leading-6 text-gray-500">
                                {line.barcode ? (
                                  <CopyableId value={line.barcode} copyLabel={tr('copy', 'Copy')} copiedLabel={tr('copied', 'Copied')} valueClassName="text-xs leading-5 text-gray-500" />
                                ) : '--'}
                              </td>
                              <td className="px-3 py-2 leading-6 text-gray-500">{batchDisplayLabel({ id: line.id, lot_code: line.lot_code, received_at: line.received_at, batch_number: line.batch_number }, tr('batch', 'Received date'))}</td>
                              <td className="px-3 py-2 text-right leading-6 text-gray-800 dark:text-gray-100">{qty(line.received_quantity)}</td>
                              <td className="px-3 py-2 leading-6 text-gray-500">{line.unit || '--'}</td>
                              {canViewCosts ? <td className="px-3 py-2 text-right leading-6 text-gray-800 dark:text-gray-100">{line.unit_cost_usd == null ? '--' : money(line.unit_cost_usd)}</td> : null}
                              {canViewCosts ? <td className="px-3 py-2 text-right font-medium leading-6 text-gray-800 dark:text-gray-100">{line.line_total_usd == null ? '--' : money(line.line_total_usd)}</td> : null}
                              <td className="px-3 py-2">{paymentChip(line)}</td>
                              <td className="px-3 py-2 leading-6 text-gray-500">{line.received_branch_name || tr('not_recorded', 'Not recorded')}</td>
                              <td className="px-3 py-2 text-right leading-6 text-gray-500">{qty(line.remaining_quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {linePages > 1 ? (
                      <div className="flex justify-center border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                        <PaginationControls compact rangeAsPageSize page={linesState.page} pageSize={linesState.pageSize} pageSizeOptions={[LINE_PAGE_SIZE]} editablePageSizeInput={false} totalItems={linesState.total} label={tr('invoice_lines', 'Lines').toLowerCase()} t={t} onPageChange={(nextPage) => loadLines(detailGroup, nextPage)} />
                      </div>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        )
      })() : null}
    </div>
  )
}
