import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls.tsx'
import { fmtDateTime24 } from '../../utils/formatters'
import CopyableId from '../shared/CopyableId.tsx'
import StatusBadge from '../sales/StatusBadge.tsx'
import { getCustomerSalesReport } from '../../api/salesTransport.ts'

// X4 (Part 395): the customer leg of the per-contact drills -- purchase
// totals for one customer over a range (suppliers: D5 Purchases; couriers:
// X3 Deliveries). Backed by /api/sales/customer-report from the shared
// salesAnalytics kernel.
//
// P10-21 (owner: "customers purchases are doing default date start and date
// end, remove that to show all"): this used to open on the app-wide today
// preset, so a customer with years of history only ever showed today. It now opens on
// ALL TIME (empty bounds) -- exactly the shape SupplierPurchasesModal uses
// for the sibling supplier drill -- and the range picker still narrows the
// view once the operator actually chooses a range.
//
// P10-22 (owner: "the stats can be one row, make it compact. then actually
// show rows of sales as well. records."): the four stat cells collapse into
// one row (2a) and the modal now lists the customer's individual sale rows,
// paged server-side (2b), the same shape SupplierPurchasesModal uses for its
// received-line rows.

type TranslateFn = (key: string) => string | undefined

interface CustomerSalesTotals {
  tx_count: number
  collected_usd: number
  discount_usd: number
  membership_discount_usd: number
  points_redeemed: number
  first_sale_at: string | null
  last_sale_at: string | null
}

interface CustomerSaleRow {
  id: number
  receipt_number: string | null
  created_at: string
  branch_name: string | null
  status: string
  total_usd: number
}

interface CustomerReportResult {
  totals?: CustomerSalesTotals
  sales?: CustomerSaleRow[]
  page?: number
  page_size?: number
  total_sales?: number
}

interface CustomerPurchasesReportModalProps {
  customerId: number | string
  customerName: string
  t: TranslateFn
  onClose: () => void
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
}

function money(value: unknown): string {
  return `$${(Number(value) || 0).toFixed(2)}`
}

export default function CustomerPurchasesReportModal({ customerId, customerName, t, onClose }: CustomerPurchasesReportModalProps) {
  // P10-21: empty bounds mean all-time. Only once the operator picks a range
  // does the request carry startDate/endDate at all (getCustomerSalesReport
  // builds its query with skipEmpty, so these never reach the Worker as
  // literal empty strings).
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [result, setResult] = useState<CustomerReportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const trText = (key: string, fallback: string): string => tr(t, key, fallback)

  useEffect(() => { setPage(1) }, [customerId, fromDate, toDate])

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string | number> = {
        customerId: String(customerId),
        page,
        page_size: pageSize,
      }
      if (fromDate) params.startDate = fromDate
      if (toDate) params.endDate = toDate
      const response = await getCustomerSalesReport(params) as CustomerReportResult | null
      if (requestRef.current !== requestId) return
      setResult(response || null)
    } catch (err) {
      if (requestRef.current !== requestId) return
      setResult(null)
      setError(err instanceof Error && err.message ? err.message : tr(t, 'daily_report_failed', 'Could not load this report.'))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [customerId, fromDate, toDate, page, pageSize, t])

  useEffect(() => { load() }, [load])

  const totals = result?.totals || null
  const sales = Array.isArray(result?.sales) ? result!.sales! : []

  return (
    <Modal title={`${tr(t, 'customer_purchases', 'Purchases')} -- ${customerName}`} onClose={onClose} wide unsavedChanges="read-only">
      {/* P10-16/P10-20 parity: the shared Modal's own body already scrolls the
          whole panel, so the sale list below gets the SAME single-scroll-region
          shape SupplierPurchasesModal now uses (a flex column filling h-full,
          only the middle list region carrying its own overflow-y-auto) rather
          than a second nested scrollbar. */}
      <div className="flex h-full min-h-0 flex-col gap-3">
        <StatsRangeRow
          range={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
          onRangeChange={(range) => {
            setFromDate(range.startDate || '')
            setToDate(range.endDate || '')
          }}
          t={t}
        />

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {error}
            <button type="button" className="ml-2 font-medium underline underline-offset-2" onClick={() => load()}>{tr(t, 'try_again', 'Try again')}</button>
          </div>
        ) : loading ? (
          <div className="py-8 text-center text-sm text-gray-400">{tr(t, 'loading', 'Loading...')}</div>
        ) : !totals || totals.tx_count === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            {tr(t, 'no_purchases_in_range', 'No purchases in the selected range.')}
          </div>
        ) : (
          <>
            {/* P10-22a: one compact row, not a 2x2 grid -- the row scrolls
                sideways on a phone only if all four cells genuinely can't
                fit, matching the house density style (SupplierPurchasesModal
                went 4-across at sm+ for the same reason). */}
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [tr(t, 'customer_purchases', 'Purchases'), String(totals.tx_count)],
                [tr(t, 'collected_total', 'Collected total'), money(totals.collected_usd)],
                [tr(t, 'store_discount', 'Store discounts'), money(totals.discount_usd)],
                [
                  tr(t, 'membership_discount', 'Membership'),
                  totals.points_redeemed > 0
                    ? `${money(totals.membership_discount_usd)} (${totals.points_redeemed} ${tr(t, 'points_redeemed', 'points')})`
                    : money(totals.membership_discount_usd),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-200 px-3 py-1.5 dark:border-gray-700">
                  <div className="text-[11px] text-gray-400">{label}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
                </div>
              ))}
            </div>

            {/* P10-22b: the actual sale records, not only totals. Large
                screens keep a table; phones get the wrapped card list, the
                same split SupplierPurchasesModal uses for its lines. */}
            {sales.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">{tr(t, 'no_sales_in_range', 'No sales in this range.')}</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="hidden md:block">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2">{tr(t, 'receipt_number', 'Receipt #')}</th>
                        <th className="px-3 py-2">{tr(t, 'date', 'Date')}</th>
                        <th className="px-3 py-2">{tr(t, 'branch', 'Branch')}</th>
                        <th className="px-3 py-2">{tr(t, 'status', 'Status')}</th>
                        <th className="px-3 py-2 text-right">{tr(t, 'total', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map((sale) => (
                        <tr key={sale.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2 leading-6 text-gray-800 dark:text-gray-100">
                            <CopyableId value={sale.receipt_number || '--'} copyLabel={tr(t, 'copy', 'Copy')} copiedLabel={tr(t, 'copied', 'Copied')} valueClassName="text-xs leading-6" />
                          </td>
                          <td className="px-3 py-2 leading-6 text-gray-500">{fmtDateTime24(sale.created_at)}</td>
                          <td className="px-3 py-2 leading-6 text-gray-500">{sale.branch_name || '--'}</td>
                          <td className="px-3 py-2 leading-6"><StatusBadge status={sale.status} t={(key) => t(key) || key} /></td>
                          <td className="px-3 py-2 text-right leading-6 font-semibold text-gray-900 dark:text-white">{money(sale.total_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 md:hidden">
                  {sales.map((sale) => (
                    <div key={sale.id} className="rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <CopyableId value={sale.receipt_number || '--'} copyLabel={tr(t, 'copy', 'Copy')} copiedLabel={tr(t, 'copied', 'Copied')} valueClassName="min-w-0 flex-1 truncate text-sm leading-6 text-gray-900 dark:text-white" />
                        <span className="text-sm font-semibold leading-6 tabular-nums text-gray-900 dark:text-white">{money(sale.total_usd)}</span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs leading-5 text-gray-400">{fmtDateTime24(sale.created_at)}</span>
                        <span className="text-xs leading-5 text-gray-400">{sale.branch_name || '--'}</span>
                        <span className="ml-auto"><StatusBadge status={sale.status} t={(key) => t(key) || key} /></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="shrink-0">
              <PaginationControls
                page={Number(result?.page || page)}
                pageSize={Number(result?.page_size || pageSize)}
                totalItems={Number(result?.total_sales ?? 0)}
                onPageChange={setPage}
                onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
                label={trText('sales', 'sales')}
                t={t}
                compact
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
