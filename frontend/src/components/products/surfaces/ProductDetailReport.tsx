import { useEffect, useMemo, useState } from 'react'
import { getProductDetailReport, getStockLedger } from '../../../api/productReadTransport.ts'
import { movementColorClass, translateMovementType } from '../../inventory/movementGroups.ts'
import SectionCard from '../../shared/SectionCard'
import { fmtDate } from '../../../utils/formatters'

// D3 (Part 422): the detail page's report sections, per the user's Aug-28
// spec -- batch summary (each lot: qty + received/expiry + supplier),
// movement history WITH the running balance, sales breakdown (per day /
// per month), and the Suppliers section (every distinct supplier with
// totals). All read-only: /products/:id/detail-report (one round trip for
// batches+suppliers+sales) and the D1 /stock-ledger scoped to this
// product for movements, so the numbers here can never disagree with the
// Products-page ledger. Sections render through N3's SectionCard, folded
// by default, and this whole component is its own lazy chunk that only
// loads when the detail modal opens.
//
// The spec's movement-table Batch column is rendered blank-honest for
// now: inventory_movements never records which lot a row touched (the
// same linkage gap the D2 board note documents); the Reference column
// carries what IS recorded (receipt/import/adjustment reasons).

type Translate = (key: string) => string | undefined

type LotRow = {
  id: number
  lot_code: string | null
  batch_number: number | null
  received_at: string | null
  expiry_date: string | null
  supplier_name: string | null
  total_qty: number
}

type SupplierRow = {
  supplier_key: string
  supplier_name: string | null
  lot_count: number
  current_qty: number
  lots_with_cost: number
  lots_without_cost: number
  first_received_at: string | null
  last_received_at: string | null
}

type BreakdownRow = { period: string; qty: number; revenue_usd: number; sale_count: number }

type DetailReport = {
  batches?: LotRow[]
  suppliers?: SupplierRow[]
  sales?: { by_day?: BreakdownRow[]; by_month?: BreakdownRow[] }
}

type LedgerRow = {
  id: number
  movement_type: string
  signed_quantity: number
  reason: string | null
  created_at: string
  before_qty: number
  after_qty: number
  reference_id?: number | null
}

export default function ProductDetailReport({ productId, t, fmtUSD }: {
  productId: number
  t: Translate
  fmtUSD: (value: unknown) => string
}) {
  const [report, setReport] = useState<DetailReport | null>(null)
  const [movements, setMovements] = useState<LedgerRow[] | null>(null)
  const [salesMode, setSalesMode] = useState<'by_day' | 'by_month'>('by_day')
  const [loadError, setLoadError] = useState('')

  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setMovements(null)
    getProductDetailReport(productId)
      .then((response) => { if (!cancelled) setReport((response || {}) as DetailReport) })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)) })
    getStockLedger({ productId, page: 1, pageSize: 30 })
      .then((response) => {
        if (cancelled) return
        const rows = (response as { items?: LedgerRow[] })?.items
        setMovements(Array.isArray(rows) ? rows : [])
      })
      .catch(() => { if (!cancelled) setMovements([]) })
    return () => { cancelled = true }
  }, [productId])

  const salesRows = useMemo(() => {
    const rows = salesMode === 'by_day' ? report?.sales?.by_day : report?.sales?.by_month
    return Array.isArray(rows) ? rows.slice(0, 31) : []
  }, [report, salesMode])

  const signed = (row: LedgerRow): string => `${row.signed_quantity > 0 ? '+' : row.signed_quantity < 0 ? '−' : ''}${Math.abs(row.signed_quantity)}`

  return (
    <div className="space-y-2">
      {loadError ? <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">{loadError}</p> : null}

      <SectionCard kind="batches" title={`${tr('batches', 'Batches')}${report?.batches?.length ? ` (${report.batches.length})` : ''}`} storageKey="product_detail_batches" defaultOpen={false}>
        <div className="max-h-56 space-y-1 overflow-y-auto p-2">
          {(report?.batches || []).map((lot) => (
            <div key={lot.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs dark:bg-gray-800/60">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{lot.lot_code || `#${lot.batch_number ?? lot.id}`}</span>
              <span className="tabular-nums text-gray-600 dark:text-gray-300">{lot.total_qty}</span>
              <span className="text-gray-400">{lot.received_at ? fmtDate(lot.received_at) : '--'}</span>
              <span className="text-gray-400">{lot.expiry_date ? `${tr('expiry', 'Expiry')} ${fmtDate(lot.expiry_date)}` : ''}</span>
              <span className="text-gray-500 dark:text-gray-400">{lot.supplier_name || ''}</span>
            </div>
          ))}
          {report && !report.batches?.length ? <p className="py-2 text-center text-xs text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
          {!report ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : null}
        </div>
      </SectionCard>

      <SectionCard kind="stock" title={tr('stock_change_ledger', 'Stock Changes')} storageKey="product_detail_movements" defaultOpen={false}>
        <div className="max-h-64 overflow-y-auto p-2">
          {movements === null ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : (
            <div className="space-y-1">
              {movements.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs dark:bg-gray-800/60">
                  <span className="whitespace-nowrap text-gray-400">{fmtDate(row.created_at)}</span>
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}>
                    {signed(row)} {translateMovementType(row.movement_type, t as (key: string) => string)}
                  </span>
                  <span className="tabular-nums text-gray-500">{row.before_qty} → {row.after_qty}</span>
                  <span className="max-w-40 truncate text-gray-400" title={row.reason || ''}>{row.reason || ''}</span>
                </div>
              ))}
              {!movements.length ? <p className="py-2 text-center text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard kind="sales" title={tr('sales', 'Sales')} storageKey="product_detail_sales" defaultOpen={false}>
        <div className="p-2">
          <div className="mb-1.5 inline-flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-gray-800">
            <button type="button" onClick={() => setSalesMode('by_day')} className={`rounded-md px-2 py-1 font-medium ${salesMode === 'by_day' ? 'bg-white text-blue-600 shadow dark:bg-gray-900' : 'text-gray-500'}`}>{tr('daily', 'Daily')}</button>
            <button type="button" onClick={() => setSalesMode('by_month')} className={`rounded-md px-2 py-1 font-medium ${salesMode === 'by_month' ? 'bg-white text-blue-600 shadow dark:bg-gray-900' : 'text-gray-500'}`}>{tr('monthly', 'Monthly')}</button>
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {salesRows.map((row) => (
              <div key={row.period} className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs dark:bg-gray-800/60">
                <span className="text-gray-500">{salesMode === 'by_day' ? fmtDate(row.period) : row.period}</span>
                <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">×{row.qty}</span>
                <span className="tabular-nums text-gray-500">{fmtUSD(row.revenue_usd)}</span>
              </div>
            ))}
            {report && !salesRows.length ? <p className="py-2 text-center text-xs text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
            {!report ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard kind="suppliers" title={`${tr('suppliers', 'Suppliers')}${report?.suppliers?.length ? ` (${report.suppliers.length})` : ''}`} storageKey="product_detail_suppliers" defaultOpen={false}>
        <div className="max-h-52 space-y-1 overflow-y-auto p-2">
          {(report?.suppliers || []).map((supplier) => (
            <div key={supplier.supplier_key} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs dark:bg-gray-800/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{supplier.supplier_name || tr('unknown', 'Unknown')}</span>
                <span className="tabular-nums text-gray-500">{supplier.lot_count} {tr('batches', 'Batches').toLowerCase()} · {supplier.current_qty}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-gray-400">
                <span>{supplier.first_received_at ? fmtDate(supplier.first_received_at) : '--'} → {supplier.last_received_at ? fmtDate(supplier.last_received_at) : '--'}</span>
                {supplier.lots_without_cost > 0 ? <span>{supplier.lots_without_cost} {tr('lots_without_cost', 'without cost')}</span> : null}
              </div>
            </div>
          ))}
          {report && !report.suppliers?.length ? <p className="py-2 text-center text-xs text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
          {!report ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : null}
        </div>
      </SectionCard>
    </div>
  )
}
