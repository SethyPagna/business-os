import { useEffect, useMemo, useState, type ReactNode } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import type { LucideIcon } from 'lucide-react'
import { getProductDetailReport, getStockLedger, getProductSalesDetail, getProductSupplierPurchases } from '../../../api/productReadTransport.ts'
import { movementColorClass, translateMovementType } from '../../inventory/movementGroups.ts'
import { fmtDate, fmtDateTime24 } from '../../../utils/formatters'
import { batchDisplayLabel } from '../../../utils/batchLabel.ts'

// D3 (Part 422; reworked Part 563): the detail page's report sections, per
// the user's Aug-28 spec -- movement history WITH the running balance, sales
// breakdown (per day / per month), and the Suppliers section (every distinct
// supplier with totals). All read-only: /products/:id/detail-report (one round
// trip for batches+suppliers+sales) and the D1 /stock-ledger scoped to this
// product for movements, so the numbers here can never disagree with the
// Products-page ledger.
//
// Part-563 change (user ask): these three are no longer folded expand-in-place
// SectionCards. They are now colored summary PILLS -- one per section, matching
// the detail sheet's Batches button -- that open a click-to-view FLOAT (a modal
// on top of the detail sheet) rather than expanding inline. Same reasoning as
// the Batches move: a dense detail sheet reads better as a row of "open the
// full view" affordances than as several stacked expanders. The Part-563 ask
// also reported these sections "showing nothing" -- the old code swallowed a
// failed report/ledger fetch into a silent empty/Loading state; this version
// surfaces the actual error inline (loadError banner) and gives each float an
// honest loading / empty / populated state so a real failure is diagnosable
// instead of looking like "no data".
//
// The spec's movement-table Batch column: migration 0084 records the lot on
// every movement where ONE lot is truthfully known (writers stamp
// movements.batch_id); rows spread across several lots, over legacy aggregate
// stock, or written before 0084 stay blank-honest.

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
  batch_id?: number | null
  batch_lot_code?: string | null
  batch_received_at?: string | null
}

// Drill-down rows: the individual sales in a period, and the lots one supplier
// delivered for this product (fetched on demand when a summary row is opened).
type SaleDetailRow = { id: number; receipt_number: string | null; created_at: string; customer_name: string | null; qty: number; revenue_usd: number }
type PurchaseRow = { id: number; lot_code: string | null; batch_number: number | null; received_at: string | null; expiry_date: string | null; unit_cost_usd: number | null; supplier_name: string | null; total_qty: number }
// Per-key drill cache: an array once loaded, or a loading/error sentinel.
type DrillCache<T> = Record<string, T[] | 'loading' | 'error'>

// Which float is open. `null` = none; the parent detail sheet stays interactive
// behind it (the float is a separate z-[60] overlay above the z-50 sheet).
type OpenSection = 'movements' | 'sales' | 'suppliers' | null

// Per-section pill styling. Colors mirror shared/SectionCard's
// SECTION_KIND_COLORS (stock=orange, sales=red, suppliers=purple) so the
// section-kind color still carries meaning, and the pill shape matches the
// detail sheet's amber Batches button so all four affordances read as one set.
// Tailwind needs literal class strings, so each kind lists its own.
const SECTION_PILL: Record<Exclude<OpenSection, null>, { icon: LucideIcon; pill: string; accent: string }> = {
  movements: {
    icon: History,
    pill: 'bg-orange-50/70 text-orange-700 hover:bg-orange-50 dark:bg-orange-950/20 dark:text-orange-200 dark:hover:bg-orange-950/30',
    accent: 'text-orange-500/80 dark:text-orange-300/70',
  },
  sales: {
    icon: TrendingUp,
    pill: 'bg-red-50/70 text-red-700 hover:bg-red-50 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/30',
    accent: 'text-red-500/80 dark:text-red-300/70',
  },
  suppliers: {
    icon: Users,
    pill: 'bg-purple-50/70 text-purple-700 hover:bg-purple-50 dark:bg-purple-950/20 dark:text-purple-200 dark:hover:bg-purple-950/30',
    accent: 'text-purple-500/80 dark:text-purple-300/70',
  },
}

export default function ProductDetailReport({ productId, barcode, t, fmtUSD }: {
  productId: number
  // Shown in each float's compact title so you can see WHICH product's changes
  // you are looking at (user ask: "the title ... also have barcode").
  barcode?: string
  t: Translate
  fmtUSD: (value: unknown) => string
}) {
  const [report, setReport] = useState<DetailReport | null>(null)
  const [movements, setMovements] = useState<LedgerRow[] | null>(null)
  const [movementsTotal, setMovementsTotal] = useState(0)
  const [salesMode, setSalesMode] = useState<'by_day' | 'by_month'>('by_day')
  const [loadError, setLoadError] = useState('')
  const [openSection, setOpenSection] = useState<OpenSection>(null)
  // Which stock-change row is expanded to its full name/value detail in place
  // (user ask: rows are too spread out; click to open the change's detail --
  // the source movement + its reference -- as compact label/value pairs).
  const [openMovementId, setOpenMovementId] = useState<number | null>(null)
  // Sales / supplier rows expand IN PLACE to their deeper detail (user ask):
  // a sales row -> the individual sales in that period; a supplier row -> the
  // lots that supplier delivered for this product. Each fetches on first open
  // and caches by key so re-opening is instant.
  const [openSalesKey, setOpenSalesKey] = useState<string | null>(null)
  const [salesDrill, setSalesDrill] = useState<DrillCache<SaleDetailRow>>({})
  const [openSupplierKey, setOpenSupplierKey] = useState<string | null>(null)
  const [supplierDrill, setSupplierDrill] = useState<DrillCache<PurchaseRow>>({})

  const toggleSalesRow = (period: string) => {
    const apiMode = salesMode === 'by_month' ? 'month' : 'day'
    const key = `${apiMode}:${period}`
    if (openSalesKey === key) { setOpenSalesKey(null); return }
    setOpenSalesKey(key)
    if (salesDrill[key]) return
    setSalesDrill((prev) => ({ ...prev, [key]: 'loading' }))
    getProductSalesDetail(productId, period, apiMode)
      .then((res) => {
        const rows = (res as { sales?: SaleDetailRow[] })?.sales
        setSalesDrill((prev) => ({ ...prev, [key]: Array.isArray(rows) ? rows : [] }))
      })
      .catch(() => setSalesDrill((prev) => ({ ...prev, [key]: 'error' })))
  }

  const toggleSupplierRow = (supplierKey: string) => {
    if (openSupplierKey === supplierKey) { setOpenSupplierKey(null); return }
    setOpenSupplierKey(supplierKey)
    if (supplierDrill[supplierKey]) return
    setSupplierDrill((prev) => ({ ...prev, [supplierKey]: 'loading' }))
    getProductSupplierPurchases(productId, supplierKey)
      .then((res) => {
        const rows = (res as { purchases?: PurchaseRow[] })?.purchases
        setSupplierDrill((prev) => ({ ...prev, [supplierKey]: Array.isArray(rows) ? rows : [] }))
      })
      .catch(() => setSupplierDrill((prev) => ({ ...prev, [supplierKey]: 'error' })))
  }

  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setMovements(null)
    setMovementsTotal(0)
    setLoadError('')
    getProductDetailReport(productId)
      .then((response) => { if (!cancelled) setReport((response || {}) as DetailReport) })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error)) })
    getStockLedger({ productId, page: 1, pageSize: 30 })
      .then((response) => {
        if (cancelled) return
        const payload = response as { items?: LedgerRow[]; total?: number }
        const rows = payload?.items
        setMovements(Array.isArray(rows) ? rows : [])
        setMovementsTotal(Number(payload?.total || (Array.isArray(rows) ? rows.length : 0)))
      })
      .catch((error) => {
        if (cancelled) return
        setMovements([])
        // Movements have their own transport (not the report round trip), so a
        // ledger-only failure still gets surfaced instead of reading as "no
        // stock changes." Functional updater keeps whichever error landed
        // first (report vs ledger) rather than reading a stale closure value.
        setLoadError((prev) => prev || (error instanceof Error ? error.message : String(error)))
      })
    return () => { cancelled = true }
  }, [productId])

  const salesRows = useMemo(() => {
    const rows = salesMode === 'by_day' ? report?.sales?.by_day : report?.sales?.by_month
    return Array.isArray(rows) ? rows.slice(0, 31) : []
  }, [report, salesMode])

  // Summary counts shown on each pill (like the Batches "(N)"). Sales counts
  // the transactions this product appeared in, summed over the day breakdown
  // (the same rows the daily float shows), so the number matches what opens.
  const suppliersCount = report?.suppliers?.length || 0
  const salesTxCount = useMemo(
    () => (report?.sales?.by_day || []).reduce((sum, row) => sum + Number(row.sale_count || 0), 0),
    [report],
  )

  const signed = (row: LedgerRow): string => `${row.signed_quantity > 0 ? '+' : row.signed_quantity < 0 ? '−' : ''}${Math.abs(row.signed_quantity)}`

  // The FULL movement history is reachable from this detail (user, Aug 31:
  // "make sure you copy the stock movement history into products page view
  // detail") -- Load more appends 30-row pages until the ledger total is
  // exhausted.
  const [movementsLoadingMore, setMovementsLoadingMore] = useState(false)
  const loadMoreMovements = async () => {
    if (movementsLoadingMore || movements === null) return
    setMovementsLoadingMore(true)
    try {
      const nextPage = Math.floor(movements.length / 30) + 1
      const response = await getStockLedger({ productId, page: nextPage, pageSize: 30 }) as { items?: LedgerRow[]; total?: number }
      const rows = Array.isArray(response?.items) ? response.items : []
      setMovements((current) => {
        const seen = new Set((current || []).map((row) => row.id))
        return [...(current || []), ...rows.filter((row) => !seen.has(row.id))]
      })
      if (response?.total != null) setMovementsTotal(Number(response.total) || 0)
    } catch {
      // Keep what already loaded; the button stays for a retry.
    } finally {
      setMovementsLoadingMore(false)
    }
  }

  const movementsLoading = movements === null
  const reportLoading = report === null

  // One pill button. `count` is shown in parens when > 0 (matching Batches);
  // `loading` swaps it for a subtle "..." so an unfetched section doesn't read
  // as an empty one.
  const Pill = ({ section, label, count, loading }: {
    section: Exclude<OpenSection, null>
    label: string
    count: number
    loading: boolean
  }) => {
    const meta = SECTION_PILL[section]
    const Icon = meta.icon
    return (
      <button
        type="button"
        onClick={() => setOpenSection(section)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${meta.pill}`}
      >
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
          {loading ? (
            <span className={meta.accent}>...</span>
          ) : count > 0 ? (
            <span className={meta.accent}>({count})</span>
          ) : null}
        </span>
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
      </button>
    )
  }

  const movementsBody: ReactNode = (
    <div className="space-y-1">
      {movements === null ? (
        <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p>
      ) : (
        <>
          {movements.map((row) => {
            const expanded = openMovementId === row.id
            const typeLabel = translateMovementType(row.movement_type, t as (key: string) => string)
            const batchLabel = row.batch_id
              ? batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at })
              : null
            return (
              <div key={row.id}>
                {/* Compact clickable row: date + change + before->after packed
                    left (not spread), the reason truncates, a chevron marks it
                    as openable. Click reveals the full name/value detail. */}
                <button
                  type="button"
                  onClick={() => setOpenMovementId(expanded ? null : row.id)}
                  className="flex w-full items-center gap-2 rounded-lg bg-gray-50 px-2 py-1 text-left text-[11px] transition-colors hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800"
                >
                  <span className="w-[84px] shrink-0 whitespace-nowrap text-gray-400">{fmtDateTime24(row.created_at)}</span>
                  <span className={`shrink-0 rounded px-1 py-0.5 font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}>
                    {signed(row)} {typeLabel}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-500">{row.before_qty}→{row.after_qty}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-400" title={row.reason || ''}>{row.reason || ''}</span>
                  <ChevronDown className={`h-3 w-3 shrink-0 text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded ? (
                  <div className="mt-0.5 rounded-lg bg-gray-100/70 px-2.5 py-1.5 text-[11px] dark:bg-gray-800/40">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      <dt className="text-gray-400">{tr('date', 'Date')}</dt>
                      <dd className="text-gray-700 dark:text-gray-200">{fmtDateTime24(row.created_at)}</dd>
                      <dt className="text-gray-400">{tr('label_change', 'Change')}</dt>
                      <dd className={`font-semibold ${row.signed_quantity > 0 ? 'text-green-600 dark:text-green-300' : row.signed_quantity < 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-600'}`}>{signed(row)} {typeLabel}</dd>
                      <dt className="text-gray-400">{tr('before_after', 'Before → After')}</dt>
                      <dd className="tabular-nums text-gray-700 dark:text-gray-200">{row.before_qty} → {row.after_qty}</dd>
                      {batchLabel ? (<><dt className="text-gray-400">{tr('batch', 'Batch')}</dt><dd className="text-amber-700 dark:text-amber-300">{batchLabel}</dd></>) : null}
                      {row.reference_id ? (<><dt className="text-gray-400">{tr('source', 'Source')}</dt><dd className="text-gray-700 dark:text-gray-200">{typeLabel} #{row.reference_id}</dd></>) : null}
                      {row.reason ? (<><dt className="text-gray-400">{tr('reason', 'Reason')}</dt><dd className="text-gray-700 dark:text-gray-200">{row.reason}</dd></>) : null}
                    </dl>
                  </div>
                ) : null}
              </div>
            )
          })}
          {!movements.length ? <p className="py-2 text-center text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
          {movements.length < movementsTotal ? (
            <button
              type="button"
              onClick={() => void loadMoreMovements()}
              disabled={movementsLoadingMore}
              className="w-full rounded-lg border border-dashed border-gray-200 py-1.5 text-center text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {movementsLoadingMore
                ? `${tr('loading', 'Loading')}...`
                : `${tr('load_more', 'Load more')} (${movements.length}/${movementsTotal})`}
            </button>
          ) : null}
        </>
      )}
    </div>
  )

  const salesBody: ReactNode = (
    <div>
      <div className="mb-1.5 inline-flex rounded-lg bg-gray-100 p-0.5 text-xs dark:bg-gray-800">
        <button type="button" onClick={() => setSalesMode('by_day')} className={`rounded-md px-2 py-1 font-medium ${salesMode === 'by_day' ? 'bg-white text-blue-600 shadow dark:bg-gray-900' : 'text-gray-500'}`}>{tr('daily', 'Daily')}</button>
        <button type="button" onClick={() => setSalesMode('by_month')} className={`rounded-md px-2 py-1 font-medium ${salesMode === 'by_month' ? 'bg-white text-blue-600 shadow dark:bg-gray-900' : 'text-gray-500'}`}>{tr('monthly', 'Monthly')}</button>
      </div>
      <div className="space-y-1">
        {salesRows.map((row) => {
          const apiMode = salesMode === 'by_month' ? 'month' : 'day'
          const key = `${apiMode}:${row.period}`
          const open = openSalesKey === key
          const drill = salesDrill[key]
          return (
            <div key={row.period}>
              {/* Click a period row to open the individual sales it aggregates. */}
              <button type="button" onClick={() => toggleSalesRow(row.period)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800">
                <span className="text-gray-500">{salesMode === 'by_day' ? fmtDate(row.period) : row.period}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-200">×{row.qty}</span>
                  <span className="tabular-nums text-gray-500">{fmtUSD(row.revenue_usd)}</span>
                  <ChevronDown className={`h-3 w-3 shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {open ? (
                <div className="mt-0.5 space-y-0.5 rounded-lg bg-gray-100/70 px-2 py-1.5 text-[11px] dark:bg-gray-800/40">
                  {drill === 'loading' || drill === undefined ? (
                    <p className="py-1 text-center text-gray-400">{tr('loading', 'Loading')}...</p>
                  ) : drill === 'error' ? (
                    <p className="py-1 text-center text-red-500">{tr('load_failed', 'Failed to load')}</p>
                  ) : !drill.length ? (
                    <p className="py-1 text-center text-gray-400">{tr('no_data_found', 'No data found')}</p>
                  ) : drill.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-gray-500" title={sale.customer_name || ''}>{sale.receipt_number || `#${sale.id}`}</span>
                      <span className="shrink-0 whitespace-nowrap text-gray-400">{fmtDateTime24(sale.created_at)}</span>
                      <span className="shrink-0 tabular-nums font-semibold text-gray-700 dark:text-gray-200">×{sale.qty}</span>
                      <span className="shrink-0 tabular-nums text-gray-500">{fmtUSD(sale.revenue_usd)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
        {report && !salesRows.length ? <p className="py-2 text-center text-xs text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
        {!report ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : null}
      </div>
    </div>
  )

  const suppliersBody: ReactNode = (
    <div className="space-y-1">
      {(report?.suppliers || []).map((supplier) => {
        const open = openSupplierKey === supplier.supplier_key
        const drill = supplierDrill[supplier.supplier_key]
        return (
          <div key={supplier.supplier_key}>
            {/* Click a supplier to open the lots it delivered for THIS product. */}
            <button type="button" onClick={() => toggleSupplierRow(supplier.supplier_key)} className="w-full rounded-lg bg-gray-50 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-semibold text-gray-700 dark:text-gray-200">{supplier.supplier_name || tr('unknown', 'Unknown')}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-gray-500">{supplier.lot_count} {tr('batches', 'Batches').toLowerCase()} · {supplier.current_qty}</span>
                  <ChevronDown className={`h-3 w-3 shrink-0 text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-gray-400">
                <span>{supplier.first_received_at ? fmtDate(supplier.first_received_at) : '--'} → {supplier.last_received_at ? fmtDate(supplier.last_received_at) : '--'}</span>
                {supplier.lots_without_cost > 0 ? <span>{supplier.lots_without_cost} {tr('lots_without_cost', 'without cost')}</span> : null}
              </div>
            </button>
            {open ? (
              <div className="mt-0.5 space-y-0.5 rounded-lg bg-gray-100/70 px-2 py-1.5 text-[11px] dark:bg-gray-800/40">
                {drill === 'loading' || drill === undefined ? (
                  <p className="py-1 text-center text-gray-400">{tr('loading', 'Loading')}...</p>
                ) : drill === 'error' ? (
                  <p className="py-1 text-center text-red-500">{tr('load_failed', 'Failed to load')}</p>
                ) : !drill.length ? (
                  <p className="py-1 text-center text-gray-400">{tr('no_data_found', 'No data found')}</p>
                ) : drill.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-gray-500">{batchDisplayLabel({ id: lot.id, lot_code: lot.lot_code, received_at: lot.received_at })}</span>
                    <span className="shrink-0 whitespace-nowrap text-gray-400">{lot.received_at ? fmtDate(lot.received_at) : '--'}</span>
                    <span className="shrink-0 tabular-nums font-semibold text-gray-700 dark:text-gray-200">×{lot.total_qty}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">{lot.unit_cost_usd != null ? fmtUSD(lot.unit_cost_usd) : '--'}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {report && !report.suppliers?.length ? <p className="py-2 text-center text-xs text-gray-400">{tr('no_data_found', 'No data found')}</p> : null}
      {!report ? <p className="py-2 text-center text-xs text-gray-400">{tr('loading', 'Loading')}...</p> : null}
    </div>
  )

  const floats: Record<Exclude<OpenSection, null>, { title: string; count: number; body: ReactNode }> = {
    movements: { title: tr('stock_change_ledger', 'Stock Changes'), count: movementsTotal, body: movementsBody },
    sales: { title: tr('sales', 'Sales'), count: salesTxCount, body: salesBody },
    suppliers: { title: tr('suppliers', 'Suppliers'), count: suppliersCount, body: suppliersBody },
  }
  const active = openSection ? floats[openSection] : null

  return (
    <div className="space-y-1.5">
      {loadError ? <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">{loadError}</p> : null}

      <Pill section="movements" label={tr('stock_change_ledger', 'Stock Changes')} count={movementsTotal} loading={movementsLoading} />
      <Pill section="sales" label={tr('sales', 'Sales')} count={salesTxCount} loading={reportLoading} />
      <Pill section="suppliers" label={tr('suppliers', 'Suppliers')} count={suppliersCount} loading={reportLoading} />

      {active ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setOpenSection(null)}
        >
          <div
            className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[80vh] sm:max-w-lg sm:rounded-2xl dark:bg-gray-800 pb-[env(safe-area-inset-bottom)] sm:pb-0"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Compact title bar (user ask): smaller title on its own line with
                the product barcode beneath it for context, tighter padding than
                the old p-4 so the header stops eating the pane. */}
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                  {active.title}
                  {active.count > 0 ? <span className="ml-1 font-normal text-gray-400">({active.count})</span> : null}
                </p>
                {barcode ? <p className="truncate font-mono text-[10px] leading-tight text-gray-400">{barcode}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setOpenSection(null)}
                aria-label={tr('close', 'Close')}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* The header X is the single close affordance -- the old
                full-width footer "Close" button was a duplicate (user ask). */}
            <div className="min-h-0 flex-1 overflow-auto p-3">{active.body}</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
