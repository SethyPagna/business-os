import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import StatsRangeRow from '../shared/StatsRangeRow.tsx'
import { fmtDateOnly } from '../../utils/formatters'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls.tsx'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import InvoiceDetailFloat from './InvoiceDetailFloat.tsx'
import CopyableId from '../shared/CopyableId.tsx'

type TranslateFn = (key: string) => string | undefined

type PurchaseBatch = {
  id: number
  batch_number?: number | null
  lot_code?: string | null
  received_at?: string | null
  received_quantity?: number | null
  unit_cost_usd?: number | null
  payment_status?: string | null
  credit_due_date?: string | null
  product_name?: string | null
  remaining_quantity?: number | null
}

type PurchasesPayload = {
  supplier?: { id: number; name?: string | null }
  totals?: {
    batches?: number
    products?: number
    units_received?: number
    cost_usd?: number
    credit_open_usd?: number
    credit_batches?: number
    batches_without_cost?: number
  }
  batches?: PurchaseBatch[]
  page?: number
  page_size?: number
  total_batches?: number
  total_pages?: number
}

type SupplierPurchasesModalProps = {
  supplierId: number | string
  supplierName: string
  fetchPurchases: (id: number | string, params?: { page?: number; page_size?: number; from?: string; to?: string }) => Promise<unknown>
  onClose: () => void
  t: TranslateFn
}

// D5 (Part 384): the supplier's purchase history -- one row per batch
// attributed to them (0062), showing what was bought (received_quantity,
// 0067), at what unit cost (0065), what is still on the shelf, and the
// paid / on-credit state the admin reminders are built on. Reached from
// the supplier detail modal, so it inherits the contacts_suppliers gate
// front and back.
export default function SupplierPurchasesModal({ supplierId, supplierName, fetchPurchases, onClose, t }: SupplierPurchasesModalProps) {
  const [data, setData] = useState<PurchasesPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  // P3-10: this report had NO date range at all, so a supplier with years of
  // receipts could only be read page by page. It opens on ALL TIME (empty
  // bounds) so the existing, complete view is what loads first; the bounds are
  // only sent once a range is chosen, and buildQueryString drops empty values.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // P3-2: the received line whose detail float is open. Every column the
  // report has is already on the row, so the float needs no extra fetch.
  const [detailBatch, setDetailBatch] = useState<PurchaseBatch | null>(null)
  const aliveRef = useRef(true)

  const tr = (key: string, fallback: string): string => t(key) || fallback

  useEffect(() => {
    setPage(1)
  }, [supplierId])

  useEffect(() => {
    aliveRef.current = true
    setLoading(true)
    setError('')
    fetchPurchases(supplierId, { page, page_size: pageSize, from: fromDate, to: toDate })
      .then((result) => {
        if (!aliveRef.current) return
        setData((result || {}) as PurchasesPayload)
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return
        setError(err instanceof Error ? err.message : tr('supplier_purchases_failed', 'Failed to load purchases'))
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false)
      })
    return () => {
      aliveRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, page, pageSize, fromDate, toDate])

  const totals = data?.totals || {}
  const batches = Array.isArray(data?.batches) ? data!.batches! : []
  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const qty = (value: unknown): string => (value == null ? '--' : String(Number(value) || 0))

  const paymentChip = (batch: PurchaseBatch) => {
    if (batch.payment_status === 'credit') {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium leading-5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {tr('on_credit', 'Not Yet Paid')}{batch.credit_due_date ? ` · ${fmtDateOnly(batch.credit_due_date)}` : ''}
        </span>
      )
    }
    if (batch.payment_status === 'paid') {
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium leading-5 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
    }
    return <span className="text-[11px] leading-5 text-gray-400">--</span>
  }

  return (
    <Modal title={`${tr('supplier_purchases', 'Purchases')} -- ${supplierName}`} onClose={onClose} wide unsavedChanges="read-only">
      <div className="space-y-3">
        {/* Start → End on its own full-width row above the report, the same
            control and preset chips the three invoice ledgers now lead with.
            Outside the loading branch on purpose: re-ranging must stay
            reachable while the next page is in flight. */}
        <StatsRangeRow
          range={{ startDate: fromDate, endDate: toDate, startTime: '', endTime: '' }}
          onRangeChange={(range) => {
            setFromDate(range.startDate || '')
            setToDate(range.endDate || '')
            setPage(1)
          }}
          t={t}
        />
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>
        ) : error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">{error}</div>
        ) : (
          <>
            {/* Part 567: 4 stat cells, not 5 (user: "the stats can be 4 stats
                not 5... made more compact"). Batches and Products -- both plain
                counts -- share one cell so nothing is dropped. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [`${tr('purchase_batches', 'Received dates')} / ${tr('products', 'Products')}`, `${totals.batches ?? 0} / ${totals.products ?? 0}`],
                [tr('units_received', 'Units received'), qty(totals.units_received)],
                [tr('purchase_cost', 'Purchase cost'), money(totals.cost_usd)],
                [tr('credit_open', 'Not Yet Paid'), `${money(totals.credit_open_usd)} (${totals.credit_batches ?? 0})`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-200 px-3 py-1.5 dark:border-gray-700">
                  <div className="text-[11px] text-gray-400">{label}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
                </div>
              ))}
            </div>
            {Number(totals.batches_without_cost) > 0 ? (
              <div className="text-[11px] text-gray-400">
                {tr('purchase_cost_partial_hint', 'Some received dates have no recorded quantity/cost yet (received before tracking, or cost unknown) -- the totals above only count received dates where both are known:')} {totals.batches_without_cost}
              </div>
            ) : null}
            {batches.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">{tr('no_purchases_yet', 'No received dates are attributed to this supplier yet.')}</div>
            ) : (
              <>
              {/* Large screens keep the full table; the phone gets the wrapped
                  card list below rather than a 640px table dragged sideways
                  inside an already-narrow modal. Either one opens the same
                  per-line float on click. */}
              <div className="hidden max-h-[calc(55*var(--app-vh))] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 md:block">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{tr('product', 'Product')}</th>
                      <th className="px-3 py-2">{tr('batch', 'Received date')}</th>
                      <th className="px-3 py-2">{tr('received_date', 'Received')}</th>
                      <th className="px-3 py-2 text-right">{tr('quantity_received', 'Qty received')}</th>
                      <th className="px-3 py-2 text-right">{tr('unit_cost_usd', 'Unit cost (USD)')}</th>
                      <th className="px-3 py-2 text-right">{tr('remaining', 'Remaining')}</th>
                      <th className="px-3 py-2">{tr('payment_to_supplier', 'Payment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr
                        key={batch.id}
                        className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-700/40"
                        onClick={() => setDetailBatch(batch)}
                      >
                        <td className="px-3 py-2 leading-6 text-gray-800 dark:text-gray-100">{batch.product_name || '--'}</td>
                        <td className="px-3 py-2 leading-6 text-gray-500">{batchDisplayLabel({ id: batch.id, lot_code: batch.lot_code, received_at: batch.received_at, batch_number: batch.batch_number }, tr('batch', 'Received date'))}</td>
                        <td className="px-3 py-2 leading-6 text-gray-500">{batch.received_at ? fmtDateOnly(batch.received_at) : '--'}</td>
                        <td className="px-3 py-2 text-right leading-6 text-gray-800 dark:text-gray-100">{qty(batch.received_quantity)}</td>
                        <td className="px-3 py-2 text-right leading-6 text-gray-800 dark:text-gray-100">{batch.unit_cost_usd == null ? '--' : money(batch.unit_cost_usd)}</td>
                        <td className="px-3 py-2 text-right leading-6 text-gray-500">{qty(batch.remaining_quantity)}</td>
                        <td className="px-3 py-2">{paymentChip(batch)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {batches.map((batch) => (
                  <div
                    key={batch.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer rounded-xl border border-gray-200 px-3 py-2 active:bg-gray-50 dark:border-gray-700 dark:active:bg-gray-700/40"
                    onClick={() => setDetailBatch(batch)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailBatch(batch) } }}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-sm leading-6 text-gray-900 dark:text-white">{batch.product_name || '--'}</span>
                      <span className="text-sm font-semibold leading-6 tabular-nums text-gray-900 dark:text-white">{batch.unit_cost_usd == null ? '--' : money(batch.unit_cost_usd)}</span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <CopyableId
                        value={batchDisplayLabel({ id: batch.id, lot_code: batch.lot_code, received_at: batch.received_at, batch_number: batch.batch_number }, tr('batch', 'Received date'))}
                        copyLabel={tr('copy', 'Copy')}
                        copiedLabel={tr('copied', 'Copied')}
                        valueClassName="text-xs leading-5 text-gray-500"
                      />
                      <span className="text-xs leading-5 tabular-nums text-gray-400">{qty(batch.received_quantity)} {tr('units', 'Units').toLowerCase()}</span>
                      <span className="ml-auto">{paymentChip(batch)}</span>
                    </div>
                  </div>
                ))}
              </div>
              </>
            )}
            <PaginationControls
              page={Number(data?.page || page)}
              pageSize={Number(data?.page_size || pageSize)}
              totalItems={Number(data?.total_batches ?? totals.batches ?? 0)}
              onPageChange={setPage}
              onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
              label={tr('purchase_batches', 'received dates')}
              t={t}
              compact
            />
          </>
        )}
        {/* No footer Close. The shared Modal already renders the header ✕ that
            calls this same onClose, and a read-only report has no action of
            its own for a footer to hold -- so a full-width Close there was a
            second close affordance dressed as the panel's primary action. Its
            sibling, CustomerPurchasesReportModal, never had one. (An import
            wizard's footer Close is a different shape: it is the cancel half
            of a real action row, beside Import.) */}
      </div>
      {detailBatch ? (
        <InvoiceDetailFloat
          t={t}
          // This float opens on top of the purchases report, so it declares the
          // nested layer the shared Modal already supports.
          layer="nested"
          onClose={() => setDetailBatch(null)}
          title={`${tr('purchase_line_details', 'Received line')} -- ${detailBatch.product_name || supplierName}`}
          idLabel={tr('batch', 'Received date')}
          idValue={batchDisplayLabel({ id: detailBatch.id, lot_code: detailBatch.lot_code, received_at: detailBatch.received_at, batch_number: detailBatch.batch_number }, tr('batch', 'Received date'))}
          badge={paymentChip(detailBatch)}
          sections={[
            {
              key: 'line',
              title: tr('details', 'Details'),
              facts: [
                { key: 'product', label: tr('product', 'Product'), value: detailBatch.product_name || '--' },
                { key: 'supplier', label: tr('supplier', 'Supplier'), value: supplierName || '--' },
                { key: 'received_at', label: tr('received_date', 'Received date'), value: detailBatch.received_at ? fmtDateOnly(detailBatch.received_at) : '--' },
                { key: 'received_quantity', label: tr('quantity_received', 'Qty received'), value: qty(detailBatch.received_quantity) },
                { key: 'remaining', label: tr('remaining', 'Remaining'), value: qty(detailBatch.remaining_quantity) },
              ],
            },
            {
              key: 'money',
              title: tr('invoice_amounts', 'Amounts'),
              facts: [
                { key: 'unit_cost', label: tr('unit_cost_usd', 'Unit cost (USD)'), value: detailBatch.unit_cost_usd == null ? '--' : money(detailBatch.unit_cost_usd) },
                // The report stores cost per unit; the line total is that cost
                // times what arrived, and stays '--' when either is unknown
                // rather than being silently reported as $0.00.
                { key: 'line_total', label: tr('total', 'Total'), value: detailBatch.unit_cost_usd == null || detailBatch.received_quantity == null ? '--' : money(Number(detailBatch.unit_cost_usd) * Number(detailBatch.received_quantity)) },
                { key: 'payment', label: tr('payment_to_supplier', 'Payment'), value: paymentChip(detailBatch) },
                { key: 'credit_due', label: tr('due_date', 'Due date'), value: detailBatch.credit_due_date ? fmtDateOnly(detailBatch.credit_due_date) : '--' },
              ],
            },
          ]}
        />
      ) : null}
    </Modal>
  )
}
