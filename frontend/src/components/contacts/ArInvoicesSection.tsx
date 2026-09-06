import { useEffect, useRef, useState } from 'react'
import AppSelect from '../shared/AppSelect.tsx'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import ColumnChooser from '../shared/ColumnChooser.tsx'
import { useColumnPreferences } from '../shared/useColumnPreferences.ts'
import type { TableColumnDef } from '../shared/columnPreferences.ts'
// fmtDate, not fmtDateOnly: AR invoice dates are UTC instants converted from
// the old system's Bangkok wall clock (same as the AP ledger), so the calendar
// day must be read in the business timezone.
import { fmtDate } from '../../utils/formatters'
import { getCustomerReceivables } from '../../api/contactReadTransport.ts'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'

type TranslateFn = (key: string) => string | undefined

// The customer accounts-receivable ledger (migration 0094): who owes the shop,
// how much, and since when -- the customer-side mirror of ApInvoicesSection.
// Read-only; AR rows never rewrite a sale's payment or move stock. Meant to
// mount inside the Customers tab (contacts_customers gate covers it). Optional
// large-screen columns (Taxable / VAT) fold away by default so the common
// "who owes, how much" view stays compact; the column chooser reveals them.

type ArInvoice = {
  id: number
  legacy_id: number
  customer_id: number | null
  customer_code?: string | null
  customer_name: string
  invoice_no?: string | null
  invoice_date: string
  taxable_amount_usd?: number
  vat_amount_usd?: number
  total_amount_usd?: number
  amount_paid_usd?: number
  outstanding_balance_usd?: number
  status?: string
}

type ArTotals = {
  invoices?: number
  total_usd?: number
  paid_usd?: number
  outstanding_usd?: number
  outstanding_count?: number
}

type ArPayload = {
  invoices?: ArInvoice[]
  totals?: ArTotals
  page?: number
  page_size?: number
  total_invoices?: number
  ledger_ready?: boolean
  meta?: { customers?: Array<{ key: string; name?: string | null; invoice_count?: number }> }
}

type ArInvoicesSectionProps = {
  t: TranslateFn
}

const AR_OPTIONAL_COLUMNS: TableColumnDef[] = [
  { key: 'invoice_no', label: 'Invoice #' },
  { key: 'taxable', label: 'Taxable', defaultVisible: false },
  { key: 'vat', label: 'VAT', defaultVisible: false },
]

export default function ArInvoicesSection({ t }: ArInvoicesSectionProps) {
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [customer, setCustomer] = useState('all')
  const [status, setStatus] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<ArPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const aliveRef = useRef(true)
  const requestRef = useRef(0)

  const cols = useColumnPreferences('customer_receivables', AR_OPTIONAL_COLUMNS)
  const chooserColumns = AR_OPTIONAL_COLUMNS.map((column) => ({ ...column, label: tr(column.key === 'invoice_no' ? 'invoice_no' : column.key === 'taxable' ? 'ap_taxable' : 'ap_vat', column.label) }))

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    getCustomerReceivables({
      customer: customer === 'all' ? '' : customer,
      status: status === 'all' ? '' : status,
      from: fromDate,
      to: toDate,
      page,
      page_size: pageSize,
    })
      .then((result) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        const nextData = (result || {}) as ArPayload
        const nextPage = clampPage(page, Number(nextData.total_invoices) || 0, pageSize)
        if (nextPage !== page) {
          setPage(nextPage)
          return
        }
        setData(nextData)
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : tr('ar_invoices_failed', 'Failed to load the customer AR ledger'))
      })
      .finally(() => {
        if (aliveRef.current && requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, status, fromDate, toDate, page, pageSize, refreshToken])

  const totals = data?.totals || {}
  const invoices = Array.isArray(data?.invoices) ? data!.invoices! : []
  const customerOptions = Array.isArray(data?.meta?.customers) ? data!.meta!.customers! : []
  const totalInvoices = Number(data?.total_invoices) || 0
  const ledgerReady = data?.ledger_ready !== false

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const anyFilter = customer !== 'all' || status !== 'all' || fromDate !== '' || toDate !== ''
  const changeFilter = (apply: () => void) => { apply(); setPage(1) }

  const statusChip = (row: ArInvoice) => {
    const outstanding = Number(row.outstanding_balance_usd)
    if (outstanding > 0) {
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr('ar_outstanding', 'Owed')}</span>
    }
    if (outstanding < 0) {
      return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">{tr('ar_overpaid', 'Credit')}</span>
    }
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
  }

  return (
    <div className="space-y-3 p-3">
      {/* Same pinned filter + date row as the AP ledger it mirrors: the
          app-wide "search bar row and the date both can be pinned and stick
          ... for all sections and pages" convention, at the `sticky top-2`
          offset the Customers/Suppliers/Delivery search rows use one level
          up. The sticky wrapper is outside the overflow-x-auto row because a
          horizontally scrolling box cannot itself be the sticky element. */}
      <div className="sticky top-2 z-30 -mx-3 -mt-3 bg-gray-50/95 px-3 pb-2 pt-3 backdrop-blur dark:bg-gray-900/95">
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
        <AppSelect
          ariaLabel={tr('customer', 'Customer')}
          value={customer}
          onChange={(value) => changeFilter(() => setCustomer(value))}
          className="min-w-[11rem]"
          options={[
            { value: 'all', label: tr('all_customers', 'All Customers') },
            ...customerOptions.map((option) => ({ value: option.key, label: String(option.name || option.key) })),
          ]}
        />
        <AppSelect
          ariaLabel={tr('status', 'Status')}
          value={status}
          onChange={(value) => changeFilter(() => setStatus(value))}
          className="min-w-[9rem]"
          options={[
            { value: 'all', label: tr('all', 'All') },
            { value: 'outstanding', label: tr('ar_outstanding', 'Owed') },
            { value: 'overpaid', label: tr('ar_overpaid', 'Credit') },
            { value: 'settled', label: tr('paid', 'Paid') },
          ]}
        />
        <DateTimeRangePicker
          value={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
          onChange={(range) => changeFilter(() => { setFromDate(range.startDate || ''); setToDate(range.endDate || '') })}
          t={t}
          showTime={false}
          triggerClassName="flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5"
        />
        {anyFilter ? (
          <button type="button" className="btn-secondary py-1 text-xs" onClick={() => changeFilter(() => { setCustomer('all'); setStatus('all'); setFromDate(''); setToDate('') })}>
            {tr('clear', 'Clear')}
          </button>
        ) : null}
        <ColumnChooser
          columns={chooserColumns}
          isVisible={cols.isVisible}
          toggle={cols.toggle}
          reset={cols.reset}
          label={tr('columns', 'Columns')}
          resetLabel={tr('reset', 'Reset')}
          className="ml-auto hidden lg:inline-block"
        />
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

      {!ledgerReady ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {tr('ar_ledger_not_ready', 'The customer receivables ledger has not been imported yet.')}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [tr('stock_in_invoices_count', 'Invoices'), String(totals.invoices ?? 0)],
              [tr('ar_total_billed', 'Total billed'), money(totals.total_usd)],
              [tr('paid', 'Paid'), money(totals.paid_usd)],
              [`${tr('ar_outstanding', 'Owed')} (${totals.outstanding_count ?? 0})`, money(totals.outstanding_usd)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="text-[11px] text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          {invoices.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tr('ar_invoices_empty', 'No customer receivables match these filters.')}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">{tr('invoice_date', 'Invoice date')}</th>
                    <th className="px-3 py-2">{tr('customer', 'Customer')}</th>
                    {cols.isVisible('invoice_no') ? <th className="px-3 py-2">{tr('invoice_no', 'Invoice #')}</th> : null}
                    {cols.isVisible('taxable') ? <th className="px-3 py-2 text-right">{tr('ap_taxable', 'Taxable')}</th> : null}
                    {cols.isVisible('vat') ? <th className="px-3 py-2 text-right">{tr('ap_vat', 'VAT')}</th> : null}
                    <th className="px-3 py-2 text-right">{tr('total', 'Total')}</th>
                    <th className="px-3 py-2 text-right">{tr('paid', 'Paid')}</th>
                    <th className="px-3 py-2 text-right">{tr('ar_outstanding', 'Owed')}</th>
                    <th className="px-3 py-2">{tr('status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((row) => {
                    const outstanding = Number(row.outstanding_balance_usd)
                    return (
                      <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{fmtDate(row.invoice_date)}</td>
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{row.customer_name || '--'}</td>
                        {cols.isVisible('invoice_no') ? (
                          <td className="px-3 py-2 text-gray-500">
                            {row.invoice_no || '--'}
                            <span className="ml-1 text-[10px] text-gray-400">#{row.legacy_id}</span>
                          </td>
                        ) : null}
                        {cols.isVisible('taxable') ? <td className="px-3 py-2 text-right text-gray-500">{money(row.taxable_amount_usd)}</td> : null}
                        {cols.isVisible('vat') ? <td className="px-3 py-2 text-right text-gray-500">{money(row.vat_amount_usd)}</td> : null}
                        <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(row.total_amount_usd)}</td>
                        <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{money(row.amount_paid_usd)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${outstanding > 0 ? 'text-amber-700 dark:text-amber-300' : outstanding < 0 ? 'text-sky-700 dark:text-sky-300' : 'text-gray-500'}`}>{money(outstanding)}</td>
                        <td className="px-3 py-2">{statusChip(row)}</td>
                      </tr>
                    )
                  })}
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
