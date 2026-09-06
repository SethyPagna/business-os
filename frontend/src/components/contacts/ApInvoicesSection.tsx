import { useEffect, useRef, useState } from 'react'
import AppSelect from '../shared/AppSelect.tsx'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
// fmtDate, not fmtDateOnly: these are full UTC instants converted from the
// old system's Bangkok wall clock, so the calendar day must be read in the
// business timezone (an fmtDateOnly UTC slice would show the previous day
// for anything before 07:00 Bangkok).
import { fmtDate } from '../../utils/formatters'
import { getSupplierApInvoices } from '../../api/contactReadTransport.ts'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'

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
  const [status, setStatus] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<ApPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const anyFilter = branch !== 'all' || supplier !== 'all' || status !== 'all' || fromDate !== '' || toDate !== ''

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const branchLabel = (value: string): string => (
    value === 'warehouse' ? tr('warehouse', 'Warehouse') : tr('shop', 'Shop')
  )

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
    <div className="space-y-3 p-3">
      {/* The filter + date row pins while the invoice rows scroll under it --
          the app-wide convention (user, Aug 31: "the search bar row and the
          date both can be pinned and stick ... for all sections and pages"),
          the same `sticky top-2` treatment the Customers/Suppliers/Delivery
          search rows already use one level up in this same page scroll.
          The wrapper sits OUTSIDE the overflow-x-auto row on purpose: a box
          that scrolls horizontally cannot itself be the sticky element. The
          negative margins let the blurred background span the section's own
          p-3 padding instead of leaving a bright gutter beside it. */}
      <div className="sticky top-2 z-30 -mx-3 -mt-3 bg-gray-50/95 px-3 pb-2 pt-3 backdrop-blur dark:bg-gray-900/95">
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
        <AppSelect
          ariaLabel={tr('supplier', 'Supplier')}
          value={supplier}
          onChange={(value) => changeFilter(() => setSupplier(value))}
          className="min-w-[11rem]"
          options={[
            { value: 'all', label: tr('all_suppliers', 'All Suppliers') },
            ...supplierOptions.map((option) => ({ value: option.key, label: String(option.name || option.key) })),
          ]}
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [tr('stock_in_invoices_count', 'Invoices'), String(totals.invoices ?? 0)],
              [tr('ap_total_billed', 'Total billed'), money(totals.total_usd)],
              [tr('paid', 'Paid'), money(totals.paid_usd)],
              [`${tr('ap_outstanding', 'Outstanding')} (${totals.outstanding_count ?? 0})`, money(totals.outstanding_usd)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="text-[11px] text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          {invoices.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tr('ap_invoices_empty', 'No supplier invoices match these filters.')}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[980px] text-left text-xs">
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
                    <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{fmtDate(row.invoice_date)}</td>
                      <td className="px-3 py-2 text-gray-500">{branchLabel(row.source_branch)}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{row.supplier_name || '--'}</td>
                      <td className="px-3 py-2 text-gray-500">
                        {row.invoice_no || '--'}
                        <span className="ml-1 text-[10px] text-gray-400">#{row.legacy_id}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{row.due_date ? fmtDate(row.due_date) : '--'}</td>
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
          )}

          <div className="flex justify-center">
            <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalInvoices} label={tr('stock_in_invoices_count', 'Invoices').toLowerCase()} t={t} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
          </div>
        </>
      )}
    </div>
  )
}
