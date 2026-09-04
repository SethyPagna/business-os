import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { fmtDateOnly } from '../../utils/formatters'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls.tsx'

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
  fetchPurchases: (id: number | string, params?: { page?: number; page_size?: number }) => Promise<unknown>
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
  const aliveRef = useRef(true)

  const tr = (key: string, fallback: string): string => t(key) || fallback

  useEffect(() => {
    setPage(1)
  }, [supplierId])

  useEffect(() => {
    aliveRef.current = true
    setLoading(true)
    setError('')
    fetchPurchases(supplierId, { page, page_size: pageSize })
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
  }, [supplierId, page, pageSize])

  const totals = data?.totals || {}
  const batches = Array.isArray(data?.batches) ? data!.batches! : []
  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const qty = (value: unknown): string => (value == null ? '--' : String(Number(value) || 0))

  return (
    <Modal title={`${tr('supplier_purchases', 'Purchases')} -- ${supplierName}`} onClose={onClose} wide unsavedChanges="read-only">
      <div className="space-y-3">
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
                [`${tr('purchase_batches', 'Batches')} / ${tr('products', 'Products')}`, `${totals.batches ?? 0} / ${totals.products ?? 0}`],
                [tr('units_received', 'Units received'), qty(totals.units_received)],
                [tr('purchase_cost', 'Purchase cost'), money(totals.cost_usd)],
                [tr('credit_open', 'On credit'), `${money(totals.credit_open_usd)} (${totals.credit_batches ?? 0})`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-200 px-3 py-1.5 dark:border-gray-700">
                  <div className="text-[11px] text-gray-400">{label}</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
                </div>
              ))}
            </div>
            {Number(totals.batches_without_cost) > 0 ? (
              <div className="text-[11px] text-gray-400">
                {tr('purchase_cost_partial_hint', 'Some batches have no recorded quantity/cost yet (received before tracking, or cost unknown) -- the totals above only count batches where both are known:')} {totals.batches_without_cost}
              </div>
            ) : null}
            {batches.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">{tr('no_purchases_yet', 'No batches are attributed to this supplier yet.')}</div>
            ) : (
              <div className="max-h-[55vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">{tr('product', 'Product')}</th>
                      <th className="px-3 py-2">{tr('batch', 'Batch')}</th>
                      <th className="px-3 py-2">{tr('received_date', 'Received')}</th>
                      <th className="px-3 py-2 text-right">{tr('quantity_received', 'Qty received')}</th>
                      <th className="px-3 py-2 text-right">{tr('unit_cost_usd', 'Unit cost (USD)')}</th>
                      <th className="px-3 py-2 text-right">{tr('remaining', 'Remaining')}</th>
                      <th className="px-3 py-2">{tr('payment_to_supplier', 'Payment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{batch.product_name || '--'}</td>
                        <td className="px-3 py-2 text-gray-500">{batch.lot_code || (batch.batch_number != null ? `#${batch.batch_number}` : '--')}</td>
                        <td className="px-3 py-2 text-gray-500">{batch.received_at ? fmtDateOnly(batch.received_at) : '--'}</td>
                        <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{qty(batch.received_quantity)}</td>
                        <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-100">{batch.unit_cost_usd == null ? '--' : money(batch.unit_cost_usd)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{qty(batch.remaining_quantity)}</td>
                        <td className="px-3 py-2">
                          {batch.payment_status === 'credit' ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                              {tr('on_credit', 'On credit')}{batch.credit_due_date ? ` · ${fmtDateOnly(batch.credit_due_date)}` : ''}
                            </span>
                          ) : batch.payment_status === 'paid' ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{tr('paid', 'Paid')}</span>
                          ) : (
                            <span className="text-[11px] text-gray-400">--</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls
              page={Number(data?.page || page)}
              pageSize={Number(data?.page_size || pageSize)}
              totalItems={Number(data?.total_batches ?? totals.batches ?? 0)}
              onPageChange={setPage}
              onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
              label={tr('purchase_batches', 'batches')}
              t={t}
              compact
            />
          </>
        )}
        <button type="button" className="btn-primary w-full" onClick={onClose}>{t('close') || 'Close'}</button>
      </div>
    </Modal>
  )
}
