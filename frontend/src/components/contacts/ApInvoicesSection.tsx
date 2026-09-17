import { useEffect, useMemo, useRef, useState } from 'react'
import { supplierDisplay } from '../../utils/supplierDisplay.ts'
import AppSelect from '../shared/AppSelect.tsx'
import SuggestionTextInput, { type SuggestionOption } from '../shared/SuggestionTextInput.tsx'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
// fmtDate, not fmtDateOnly: these are full UTC instants converted from the
// old system's Bangkok wall clock, so the calendar day must be read in the
// business timezone (an fmtDateOnly UTC slice would show the previous day
// for anything before 07:00 Bangkok).
import { fmtDate } from '../../utils/formatters'
import { getSupplierApInvoices } from '../../api/contactReadTransport.ts'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import InvoiceLedgerSummary from './InvoiceLedgerSummary.tsx'
import InvoiceDetailFloat from './InvoiceDetailFloat.tsx'
import CopyableId from '../shared/CopyableId.tsx'

type TranslateFn = (key: string) => string | undefined

// M-audit follow-through: the legacy supplier AP ledger (the old system's
// account-payable reports, imported Aug 30 as finance history). Flat,
// read-only rows -- AP invoices never create stock receipts or fees, so
// there is nothing to drill into. Mounted inside the Suppliers tab, so the
// contacts_suppliers gate covers it front and back, same as the Stock-In
// Invoice report above it.

type ApInvoice = {
  id: number
  source_branch: string
  legacy_id: number
  supplier_name: string
  invoice_no?: string | null
  invoice_date: string
  due_date?: string | null
  term_days?: number
  taxable_amount_usd?: number
  vat_amount_usd?: number
  total_amount_usd?: number
  amount_paid_usd?: number
  outstanding_balance_usd?: number
  status?: string
}

type ApTotals = {
  invoices?: number
  total_usd?: number
  paid_usd?: number
  outstanding_usd?: number
  outstanding_count?: number
}

type ApPayload = {
  invoices?: ApInvoice[]
  totals?: ApTotals
  page?: number
  page_size?: number
  total_invoices?: number
  meta?: { suppliers?: Array<{ key: string; name?: string | null; invoice_count?: number }> }
}

type ApInvoicesSectionProps = {
  t: TranslateFn
}

export default function ApInvoicesSection({ t }: ApInvoicesSectionProps) {
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [branch, setBranch] = useState('all')
  const [supplier, setSupplier] = useState('all')
  // P11-13: same searchable-picker treatment as the AR ledger's customer
  // filter -- a search box that lists its options rather than a click-to-
  // open menu with nothing typeable.
  const [supplierQuery, setSupplierQuery] = useState('')
  const [status, setStatus] = useState('all')
  // P3-10: ALL TIME on first open, not Today. `supplier_invoices` holds only
  // the legacy account-payable documents imported on Aug 30 -- nothing writes
  // a row with today's date, so a Today default made the ledger open empty
  // every single time ("for invoice, i see only one or none ... it seems to
  // only show today"). Empty bounds are dropped by buildQueryString and the
  // Worker only adds its invoice_date conditions when from/to arrive
  // (cloudflare/src/routes/contacts.ts, the ap-invoices where-builder), so
  // this asks for the whole ledger rather than an unbounded-looking today.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<ApPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P3-2: the row the detail float is open on. The float is fed entirely from
  // the row the list already holds -- there is no per-invoice AP endpoint and
  // the list response carries every column the document has.
  const [detail, setDetail] = useState<ApInvoice | null>(null)
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
    getSupplierApInvoices({
      branch: branch === 'all' ? '' : branch,
      supplier: supplier === 'all' ? '' : supplier,
      status: status === 'all' ? '' : status,
      from: fromDate,
      to: toDate,
      page,
      page_size: pageSize,
    })
      .then((result) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        const nextData = (result || {}) as ApPayload
        const nextPage = clampPage(page, Number(nextData.total_invoices) || 0, pageSize)
        if (nextPage !== page) {
          setPage(nextPage)
          return
        }
        setData(nextData)
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : tr('ap_invoices_failed', 'Failed to load the supplier AP ledger'))
      })
      .finally(() => {
        if (aliveRef.current && requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, supplier, status, fromDate, toDate, page, pageSize, refreshToken])

  const totals = data?.totals || {}
  const invoices = Array.isArray(data?.invoices) ? data!.invoices! : []
  const supplierOptions = Array.isArray(data?.meta?.suppliers) ? data!.meta!.suppliers! : []
  const totalInvoices = Number(data?.total_invoices) || 0

  useEffect(() => {
    if (supplier === 'all') { setSupplierQuery(''); return }
    const match = supplierOptions.find((option) => option.key === supplier)
    if (match) setSupplierQuery(String(match.name || match.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, supplierOptions.length])

  const supplierSuggestionOptions = useMemo<SuggestionOption[]>(
    () => supplierOptions.map((option) => ({
      value: String(option.name || option.key),
      key: option.key,
      payload: option.key,
      selected: supplier === option.key,
    })),
    [supplierOptions, supplier],
  )

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const anyFilter = branch !== 'all' || supplier !== 'all' || status !== 'all' || fromDate !== '' || toDate !== ''

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
    // The open invoice may not survive the new filter, so the float closes
    // with the list it was opened from rather than outliving its row.
    setDetail(null)
  }

  const branchLabel = (value: string): string => (
    value === 'warehouse' ? tr('warehouse', 'Warehouse') : tr('shop', 'Shop')
  )

  /** What the old system printed on the document, falling back to its row id. */
  const invoiceLabel = (row: ApInvoice): string => String(row.invoice_no || '').trim() || `#${row.legacy_id}`

  const statusChip = (row: ApInvoice) => {
    if (Number(row.outstanding_balance_usd) > 0) {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {tr('ap_outstanding', 'Outstanding')}
        </span>
      )
    }
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
  }

  return (
    <div className="space-y-3 py-3 pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))]">
      {/* The filter + date row pins while the invoice rows scroll under it --
          the app-wide convention (user, Aug 31: "the search bar row and the
          date both can be pinned and stick ... for all sections and pages"),
          the same `sticky top-2` treatment the Customers/Suppliers/Delivery
          search rows already use one level up in this same page scroll.
          The wrapper sits OUTSIDE the overflow-x-auto row on purpose: a box
          that scrolls horizontally cannot itself be the sticky element. The
          negative margins let the blurred background span the section's own
          p-3 padding instead of leaving a bright gutter beside it. */}
      <div className="sticky top-2 z-30 -mx-3 -mt-3 space-y-1.5 bg-gray-50 px-3 pb-2 pt-3 dark:bg-gray-900">
      {/* P3-10: the Start→End range leads the pinned block on its own
          full-width row (same shape as Sales), instead of being the fourth
          control inside the horizontally scrolling filter line below where a
          phone never reached it. Presets come with StatsRangeRow. */}
      <StatsRangeRow
        range={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
        onRangeChange={(range) => changeFilter(() => {
          setFromDate(range.startDate || '')
          setToDate(range.endDate || '')
        })}
        t={t}
      />
      {/* Part 567: filters kept to a single scrollable line (user: "the
          filters options one row") rather than wrapping. */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
        <AppSelect
          ariaLabel={tr('branch', 'Branch')}
          value={branch}
          onChange={(value) => changeFilter(() => setBranch(value))}
          className="min-w-[9rem]"
          options={[
            { value: 'all', label: tr('all_branches', 'All Branches') },
            { value: 'warehouse', label: tr('warehouse', 'Warehouse') },
            { value: 'shop', label: tr('shop', 'Shop') },
          ]}
        />
        {/* P11-13: a search box that also lists its options -- typing
            filters the supplier list, focus with nothing typed lists every
            supplier, matching the standing picker rule. */}
        <SuggestionTextInput
          id="ap-supplier-filter"
          ariaLabel={tr('supplier', 'Supplier')}
          value={supplierQuery}
          options={supplierSuggestionOptions}
          className="min-w-[11rem]"
          inputClassName="input h-9 w-full text-xs"
          placeholder={tr('all_suppliers', 'All Suppliers')}
          onChange={(next, option) => {
            setSupplierQuery(next)
            if (option) { changeFilter(() => setSupplier(String(option.payload))); return }
            if (!next.trim()) { changeFilter(() => setSupplier('all')); return }
            const exact = supplierOptions.find((row) => String(row.name || row.key).trim().toLowerCase() === next.trim().toLowerCase())
            if (exact) changeFilter(() => setSupplier(exact.key))
          }}
        />
        <AppSelect
          ariaLabel={tr('status', 'Status')}
          value={status}
          onChange={(value) => changeFilter(() => setStatus(value))}
          className="min-w-[9rem]"
          options={[
            { value: 'all', label: tr('all', 'All') },
            { value: 'outstanding', label: tr('ap_outstanding', 'Outstanding') },
            { value: 'paid', label: tr('paid', 'Paid') },
          ]}
        />
        {anyFilter ? (
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            onClick={() => changeFilter(() => { setBranch('all'); setSupplier('all'); setStatus('all'); setFromDate(''); setToDate('') })}
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
            ariaLabel={tr('ap_invoices', 'Supplier AP Invoices')}
            items={[
              { key: 'invoices', label: tr('stock_in_invoices_count', 'Invoices'), value: String(totals.invoices ?? 0) },
              { key: 'paid', label: tr('paid', 'Paid'), value: money(totals.paid_usd) },
              { key: 'outstanding', label: `${tr('ap_outstanding', 'Outstanding')} (${totals.outstanding_count ?? 0})`, value: money(totals.outstanding_usd) },
            ]}
            total={{ key: 'total', label: tr('ap_total_billed', 'Total billed'), value: money(totals.total_usd) }}
          />

          {invoices.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tr('ap_invoices_empty', 'No supplier invoices match these filters.')}</div>
          ) : (
            <>
            {/* Large screens keep the full excel-style ledger; the phone gets
                the wrapped card list below instead of an 980px table it has to
                drag sideways. Same split, and the same "click the row to open
                the detail", as the Sales list. */}
            <div data-invoice-ledger-scroll className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-gray-200 dark:border-gray-700 md:block">
              <table className="w-full min-w-[980px] text-left text-xs tabular-nums">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">{tr('invoice_date', 'Invoice date')}</th>
                    <th className="px-3 py-2">{tr('branch', 'Branch')}</th>
                    <th className="px-3 py-2">{tr('supplier', 'Supplier')}</th>
                    <th className="px-3 py-2">{tr('invoice_no', 'Invoice #')}</th>
                    <th className="px-3 py-2">{tr('due_date', 'Due date')}</th>
                    <th className="px-3 py-2 text-right">{tr('ap_taxable', 'Taxable')}</th>
                    <th className="px-3 py-2 text-right">{tr('ap_vat', 'VAT')}</th>
                    <th className="px-3 py-2 text-right">{tr('total', 'Total')}</th>
                    <th className="px-3 py-2 text-right">{tr('paid', 'Paid')}</th>
                    <th className="px-3 py-2 text-right">{tr('ap_outstanding', 'Outstanding')}</th>
                    <th className="px-3 py-2">{tr('status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-700/40"
                      onClick={() => setDetail(row)}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-gray-800 dark:text-gray-100"><time dateTime={row.invoice_date}>{fmtDate(row.invoice_date)}</time></td>
                      <td className="px-3 py-2 text-gray-500">{branchLabel(row.source_branch)}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{supplierDisplay(row.supplier_name, tr)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                        {row.invoice_no || '--'}
                        <span className="ml-1 text-[10px] text-gray-400">#{row.legacy_id}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500">{row.due_date ? <time dateTime={row.due_date}>{fmtDate(row.due_date)}</time> : '--'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(row.taxable_amount_usd)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(row.vat_amount_usd)}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(row.total_amount_usd)}</td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{money(row.amount_paid_usd)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${Number(row.outstanding_balance_usd) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'}`}>{money(row.outstanding_balance_usd)}</td>
                      <td className="px-3 py-2">{statusChip(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {invoices.map((row) => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer rounded-xl border border-gray-200 px-3 py-2 active:bg-gray-50 dark:border-gray-700 dark:active:bg-gray-700/40"
                  onClick={() => setDetail(row)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetail(row) } }}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <time dateTime={row.invoice_date} className="whitespace-nowrap text-xs leading-5 tabular-nums text-gray-500">{fmtDate(row.invoice_date)}</time>
                    <span className="min-w-0 flex-1 truncate text-sm leading-6 text-gray-900 dark:text-white">{supplierDisplay(row.supplier_name, tr)}</span>
                    <span className="text-sm font-semibold leading-6 tabular-nums text-gray-900 dark:text-white">{money(row.total_amount_usd)}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {/* The invoice id wraps to a second line rather than being
                        truncated, and a hold copies it. */}
                    <CopyableId
                      value={invoiceLabel(row)}
                      copyLabel={tr('copy', 'Copy')}
                      copiedLabel={tr('copied', 'Copied')}
                      valueClassName="text-xs leading-5 text-gray-500"
                    />
                    <span className="text-xs leading-5 text-gray-400">{branchLabel(row.source_branch)}</span>
                    {Number(row.outstanding_balance_usd) > 0 ? (
                      <span className="text-xs leading-5 tabular-nums text-amber-700 dark:text-amber-300">{tr('ap_outstanding', 'Outstanding')}: {money(row.outstanding_balance_usd)}</span>
                    ) : null}
                    <span className="ml-auto">{statusChip(row)}</span>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}

          <div className="flex justify-center">
            <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalInvoices} label={tr('stock_in_invoices_count', 'Invoices').toLowerCase()} t={t} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
          </div>
        </>
      )}

      {detail ? (
        <InvoiceDetailFloat
          t={t}
          onClose={() => setDetail(null)}
          title={`${tr('invoice_details', 'Invoice details')} -- ${supplierDisplay(detail.supplier_name, tr)}`}
          idLabel={tr('invoice_no', 'Invoice #')}
          idValue={invoiceLabel(detail)}
          badge={statusChip(detail)}
          sections={[
            {
              key: 'document',
              title: tr('details', 'Details'),
              facts: [
                { key: 'invoice_date', label: tr('invoice_date', 'Invoice date'), value: <time dateTime={detail.invoice_date}>{fmtDate(detail.invoice_date)}</time> },
                { key: 'due_date', label: tr('due_date', 'Due date'), value: detail.due_date ? <time dateTime={detail.due_date}>{fmtDate(detail.due_date)}</time> : '--' },
                { key: 'term_days', label: tr('term_days', 'Payment terms (days)'), value: detail.term_days == null ? '--' : String(detail.term_days) },
                { key: 'branch', label: tr('branch', 'Branch'), value: branchLabel(detail.source_branch) },
                { key: 'supplier', label: tr('supplier', 'Supplier'), value: supplierDisplay(detail.supplier_name, tr) },
                { key: 'legacy_id', label: tr('legacy_record_id', 'Legacy record id'), value: `#${detail.legacy_id}` },
              ],
            },
            {
              key: 'amounts',
              title: tr('invoice_amounts', 'Amounts'),
              facts: [
                { key: 'taxable', label: tr('ap_taxable', 'Taxable'), value: money(detail.taxable_amount_usd) },
                { key: 'vat', label: tr('ap_vat', 'VAT'), value: money(detail.vat_amount_usd) },
                { key: 'total', label: tr('total', 'Total'), value: money(detail.total_amount_usd) },
                { key: 'paid', label: tr('paid', 'Paid'), value: money(detail.amount_paid_usd) },
                { key: 'outstanding', label: tr('ap_outstanding', 'Outstanding'), value: money(detail.outstanding_balance_usd) },
              ],
            },
            {
              key: 'lines',
              title: tr('invoice_lines', 'Lines'),
              // Stated, never left as an empty box: migration 0088 imported
              // these as money documents with NO batch/line linkage on purpose
              // ("AP rows must not manufacture stock receipts"), so there is
              // nothing to fetch. The received product lines for the same
              // supplier live in the Stock-In Invoices ledger beside this one.
              note: tr('ap_invoice_no_lines_note', 'Supplier AP invoices are billing documents from the old system and carry no product lines. What physically arrived is in the Stock-In Invoices ledger.'),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
