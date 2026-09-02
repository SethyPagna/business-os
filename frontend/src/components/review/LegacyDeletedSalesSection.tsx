import { useEffect, useRef, useState } from 'react'
import AppSelect from '../shared/AppSelect.tsx'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import SearchInput from '../shared/SearchInput'
import { fmtDateTime24 } from '../../utils/formatters'
import { getLegacyDeletedSales } from '../../api/auditLogTransport.ts'
import { useApp as useAppHook } from '../../AppContext.tsx'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'

// M-audit follow-through: the legacy deleted-sale audit ledger -- every
// line the old system's cashiers deleted from a cart or bill (618 events /
// 2,234 lines imported Aug 30), preserved verbatim as evidence. These rows
// never touched sales or stock, so this is a read-only trail beside the
// Audit Log, under the same audit_log permission front and back. The one
// famous 9,999,999 row is shown as stored: it is audit evidence of an
// old-system typo, not an operational amount.

type DeletedRow = {
  id: number
  event_key: string
  invoice_no?: string | null
  reference_no?: string | null
  cashier_name?: string | null
  bill_delete_reason?: string | null
  deleted_at?: string | null
  deleted_by?: string | null
  deletion_reason?: string | null
  product_id?: number | null
  source_product_name: string
  product_name?: string | null
  source_code?: string | null
  quantity: number
  unit_price_usd: number
  total_usd: number
}

type DeletedTotals = {
  events?: number
  lines?: number
  units?: number
  value_usd?: number
}

type DeletedPayload = {
  items?: DeletedRow[]
  totals?: DeletedTotals
  page?: number
  page_size?: number
  total_lines?: number
  meta?: { cashiers?: Array<{ key: string; name?: string | null; line_count?: number }> }
}

type LegacyDeletedSalesAppContext = {
  t: (key: string, fallback?: string) => string
}
const useApp = useAppHook as unknown as () => LegacyDeletedSalesAppContext

export default function LegacyDeletedSalesSection() {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [search, setSearch] = useState('')
  const [cashier, setCashier] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [refreshToken, setRefreshToken] = useState(0)
  const [data, setData] = useState<DeletedPayload | null>(null)
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
    getLegacyDeletedSales({
      search,
      cashier: cashier === 'all' ? '' : cashier,
      from: fromDate,
      to: toDate,
      page,
      page_size: pageSize,
    })
      .then((result) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        const nextData = (result || {}) as DeletedPayload
        const nextPage = clampPage(page, Number(nextData.total_lines) || 0, pageSize)
        if (nextPage !== page) {
          setPage(nextPage)
          return
        }
        setData(nextData)
      })
      .catch((err: unknown) => {
        if (!aliveRef.current || requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : tr('legacy_deleted_sales_failed', 'Failed to load the deleted-sale ledger'))
      })
      .finally(() => {
        if (aliveRef.current && requestRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, cashier, fromDate, toDate, page, pageSize, refreshToken])

  const totals = data?.totals || {}
  const rows = Array.isArray(data?.items) ? data!.items! : []
  const cashierOptions = Array.isArray(data?.meta?.cashiers) ? data!.meta!.cashiers! : []
  const totalLines = Number(data?.total_lines) || 0

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const anyFilter = search !== '' || cashier !== 'all' || fromDate !== '' || toDate !== ''

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const reasonOf = (row: DeletedRow): string => {
    const parts = [row.deletion_reason, row.bill_delete_reason].map((value) => String(value || '').trim()).filter(Boolean)
    return parts.length ? [...new Set(parts)].join(' · ') : '--'
  }

  const referenceOf = (row: DeletedRow): string => {
    const parts = [row.invoice_no, row.reference_no].map((value) => String(value || '').trim()).filter(Boolean)
    return parts.length ? parts.join(' · ') : '--'
  }

  return (
    <div className="page-scroll flex flex-col gap-3 p-3 sm:p-6">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {tr('legacy_deleted_sales_hint', 'Lines cashiers deleted from carts and bills in the old system, preserved as audit evidence. These never changed sales or stock.')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          id="legacy-deleted-sales-search"
          value={search}
          onChange={(value: string) => changeFilter(() => setSearch(value))}
          placeholder={tr('search', 'Search')}
          className="min-w-[12rem]"
        />
        <AppSelect
          ariaLabel={tr('cashier', 'Cashier')}
          value={cashier}
          onChange={(value) => changeFilter(() => setCashier(value))}
          className="min-w-[10rem]"
          options={[
            { value: 'all', label: tr('all_cashiers', 'All cashiers') },
            ...cashierOptions.map((option) => ({ value: option.key, label: String(option.name || option.key) })),
          ]}
        />
        <DateTimeRangePicker
          value={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
          onChange={(range) => changeFilter(() => {
            setFromDate(range.startDate || '')
            setToDate(range.endDate || '')
          })}
          t={(key: string) => t(key)}
          showTime={false}
          triggerClassName="flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5"
        />
        {anyFilter ? (
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            onClick={() => changeFilter(() => { setSearch(''); setCashier('all'); setFromDate(''); setToDate('') })}
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [tr('legacy_deleted_events', 'Events'), String(totals.events ?? 0)],
              [tr('invoice_lines', 'Lines'), String(totals.lines ?? 0)],
              [tr('units', 'Units'), String(totals.units ?? 0)],
              [tr('legacy_deleted_value', 'Deleted value'), money(totals.value_usd)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                <div className="text-[11px] text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tr('legacy_deleted_sales_empty', 'No deleted-sale records match these filters.')}</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">{tr('deleted_at', 'Deleted at')}</th>
                    <th className="px-3 py-2">{tr('cashier', 'Cashier')}</th>
                    <th className="px-3 py-2">{tr('product', 'Product')}</th>
                    <th className="px-3 py-2">{tr('barcode', 'Barcode')}</th>
                    <th className="px-3 py-2 text-right">{tr('quantity', 'Quantity')}</th>
                    <th className="px-3 py-2 text-right">{tr('unit_price', 'Unit price')}</th>
                    <th className="px-3 py-2 text-right">{tr('total', 'Total')}</th>
                    <th className="px-3 py-2">{tr('reason', 'Reason')}</th>
                    <th className="px-3 py-2">{tr('invoice_no', 'Invoice #')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-800 dark:text-gray-100">{row.deleted_at ? fmtDateTime24(row.deleted_at) : tr('not_recorded', 'Not recorded')}</td>
                      <td className="px-3 py-2 text-gray-500">{row.cashier_name || row.deleted_by || '--'}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">
                        {row.product_name || row.source_product_name}
                        {row.product_id == null ? (
                          <span className="ml-1 text-[10px] text-gray-400">{tr('legacy_deleted_unlinked', 'not in catalog')}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{row.source_code || '--'}</td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{Number(row.quantity) || 0}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(row.unit_price_usd)}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(row.total_usd)}</td>
                      <td className="max-w-[16rem] px-3 py-2 text-gray-500">{reasonOf(row)}</td>
                      <td className="px-3 py-2 text-gray-500">{referenceOf(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-center">
            <PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalLines} label={tr('invoice_lines', 'Lines').toLowerCase()} t={t} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
          </div>
        </>
      )}
    </div>
  )
}
