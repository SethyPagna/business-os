import { useCallback, useEffect, useRef, useState } from 'react'
import { getStockLedger } from '../../api/productReadTransport.ts'
import { movementColorClass, translateMovementType } from '../inventory/movementGroups.ts'
import AppSelect from '../shared/AppSelect'
import Modal from '../shared/Modal'
import PaginationControls from '../shared/PaginationControls'
import SearchInput from '../shared/SearchInput'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import { fmtDateTime24 } from '../../utils/formatters'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

// D1 (Part 415): the user's Stock Change ledger on the Products page --
// one row per recorded action over the EXISTING movement history, with the
// derived running balance (before -> after) the /stock-ledger kernel
// computes by walking back from current stock. Read-only. Row click opens
// the per-product mini-ledger (D3's absorption of Inventory's
// view-stock-movement drill into the Products surface): the same endpoint
// scoped to that product, so both levels always agree.

type LedgerRow = {
  id: number
  product_id: number
  product_name: string
  barcode: string | null
  unit: string | null
  branch_name: string | null
  movement_type: string
  quantity: number
  signed_quantity: number
  reason: string | null
  user_name: string | null
  created_at: string
  ledger_bucket: 'adjustment' | 'in' | 'out'
  before_qty: number
  after_qty: number
  // 0084 (D2a): the ONE lot this movement touched, when attributable --
  // NULL for multi-lot spreads, legacy aggregate stock and pre-0084 rows.
  batch_id: number | null
  batch_lot_code: string | null
  batch_received_at: string | null
  batch_supplier_id: number | null
  batch_supplier_name: string | null
}

type LedgerResponse = {
  items?: LedgerRow[]
  total?: number
  totalPages?: number
}

type LedgerView = 'all' | 'adjustments' | 'in' | 'out'

type Translate = (key: string) => string

const PAGE_SIZE = 25

function tr(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

function signedLabel(row: LedgerRow): string {
  const sign = row.signed_quantity > 0 ? '+' : row.signed_quantity < 0 ? '−' : ''
  return `${sign}${Math.abs(row.signed_quantity)}`
}

type BranchOption = { id: number; name: string }

export default function StockChangeSection({ t }: { t: Translate }) {
  const [view, setView] = useState<LedgerView>('all')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 350)
  // D2's ledger filters: branch + inclusive date range + supplier. The
  // supplier filter reads the movement's lot attribution (migration 0084's
  // movements.batch_id, stamped by every writer where ONE lot is truthfully
  // known); rows without an attributed lot are honestly excluded from a
  // supplier-filtered view, never guessed in.
  const [branchId, setBranchId] = useState(0)
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [supplierId, setSupplierId] = useState(0)
  const [suppliers, setSuppliers] = useState<Array<{ id: number; name: string }>>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [detail, setDetail] = useState<LedgerRow | null>(null)
  const [detailRows, setDetailRows] = useState<LedgerRow[] | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const response = await getStockLedger({
        view,
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        branchId: branchId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        supplierId: supplierId || undefined,
      }) as LedgerResponse
      if (requestRef.current !== requestId) return
      setRows(Array.isArray(response?.items) ? response.items : [])
      setTotal(Number(response?.total || 0))
      setLoadError('')
    } catch (error) {
      if (requestRef.current !== requestId) return
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [view, page, debouncedSearch, branchId, startDate, endDate, supplierId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(1) }, [view, debouncedSearch, branchId, startDate, endDate, supplierId])

  useEffect(() => {
    let cancelled = false
    import('../../api/branchTransport.ts')
      .then(({ getBranches }) => getBranches())
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        setBranches(rows
          .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
          .map((row) => ({ id: Number(row.id) || 0, name: String(row.name || '') }))
          .filter((row) => row.id > 0))
      })
      .catch(() => { /* filter row simply stays branch-less */ })
    // The shared cached name-only suppliers read every role may call (the
    // same loader the supplier pickers use).
    import('../shared/SupplierPickerField.tsx')
      .then(({ loadSupplierNames }) => loadSupplierNames())
      .then((rows) => { if (!cancelled) setSuppliers(rows) })
      .catch(() => { /* filter row simply stays supplier-less */ })
    return () => { cancelled = true }
  }, [])

  const openDetail = useCallback(async (row: LedgerRow) => {
    setDetail(row)
    setDetailRows(null)
    try {
      const response = await getStockLedger({ productId: row.product_id, page: 1, pageSize: 20 }) as LedgerResponse
      setDetailRows(Array.isArray(response?.items) ? response.items : [])
    } catch {
      setDetailRows([])
    }
  }, [])

  const views: Array<{ id: LedgerView; label: string }> = [
    { id: 'all', label: tr(t, 'all', 'All') },
    { id: 'adjustments', label: tr(t, 'adjustment', 'Adjustment') },
    { id: 'in', label: tr(t, 'stock_in', 'Stock In') },
    { id: 'out', label: tr(t, 'stock_out', 'Stock Out') },
  ]

  const beforeLabel = tr(t, 'before_qty', 'Before')
  const afterLabel = tr(t, 'after_qty', 'After')

  const bucketCell = (row: LedgerRow, bucket: LedgerRow['ledger_bucket']) => {
    if (row.ledger_bucket !== bucket) return <td key={bucket} className="px-2 py-1.5" />
    return (
      <td key={bucket} className="px-2 py-1.5">
        <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}>
          {signedLabel(row)}
          <span className="font-normal opacity-80">{translateMovementType(row.movement_type, t)}</span>
        </span>
        {row.reason ? <div className="mt-0.5 max-w-44 truncate text-[11px] text-gray-400" title={row.reason}>{row.reason}</div> : null}
      </td>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800">
          {views.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === option.id ? 'bg-white text-blue-600 shadow dark:bg-gray-900' : 'text-gray-500'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="min-w-48 flex-1 sm:max-w-72">
          <SearchInput id="stock-ledger-search" name="stock_ledger_search" value={search} onChange={setSearch} placeholder={tr(t, 'search', 'Search')} />
        </div>
        {branches.length > 1 ? (
          <AppSelect
            name="stock_ledger_branch"
            value={String(branchId || '')}
            onChange={(value) => setBranchId(Number(value) || 0)}
            ariaLabel={tr(t, 'branch', 'Branch')}
            options={[
              { value: '', label: `${tr(t, 'branch', 'Branch')}: ${tr(t, 'all', 'All')}` },
              ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
            ]}
          />
        ) : null}
        {suppliers.length ? (
          <AppSelect
            name="stock_ledger_supplier"
            value={String(supplierId || '')}
            onChange={(value) => setSupplierId(Number(value) || 0)}
            ariaLabel={tr(t, 'supplier', 'Supplier')}
            options={[
              { value: '', label: `${tr(t, 'supplier', 'Supplier')}: ${tr(t, 'all', 'All')}` },
              ...suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name })),
            ]}
          />
        ) : null}
        <input
          type="date"
          className="input h-9 w-auto text-sm"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          aria-label={tr(t, 'start_date', 'Start date')}
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          className="input h-9 w-auto text-sm"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          aria-label={tr(t, 'end_date', 'End date')}
        />
        <span className="text-xs text-gray-400">{total}</span>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {loadError}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>{tr(t, 'retry', 'Retry')}</button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400 dark:border-gray-700">
              <th className="px-2 py-2">{tr(t, 'date', 'Date')}</th>
              <th className="px-2 py-2">{tr(t, 'name', 'Name')}</th>
              <th className="px-2 py-2">{tr(t, 'barcode', 'Barcode')}</th>
              <th className="px-2 py-2">{tr(t, 'batch', 'Batch')}</th>
              <th className="px-2 py-2 text-right">{beforeLabel}</th>
              <th className="px-2 py-2">{tr(t, 'adjustment', 'Adjustment')}</th>
              <th className="px-2 py-2">{tr(t, 'stock_in', 'Stock In')}</th>
              <th className="px-2 py-2">{tr(t, 'stock_out', 'Stock Out')}</th>
              <th className="px-2 py-2 text-right">{afterLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-blue-50/40 dark:border-gray-800 dark:hover:bg-blue-900/10"
                onClick={() => void openDetail(row)}
              >
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-gray-500">{fmtDateTime24(row.created_at)}</td>
                <td className="max-w-52 truncate px-2 py-1.5 font-medium text-gray-800 dark:text-gray-100" title={row.product_name}>{row.product_name}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-gray-400">{row.barcode || '--'}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-gray-500">
                  {row.batch_id ? batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at }) : '--'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{row.before_qty}</td>
                {bucketCell(row, 'adjustment')}
                {bucketCell(row, 'in')}
                {bucketCell(row, 'out')}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-gray-800 dark:text-gray-100">{row.after_qty}</td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-400">{tr(t, 'no_data_found', 'No data found')}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {loading ? <p className="text-center text-xs text-gray-400">{tr(t, 'loading', 'Loading')}...</p> : null}

      <div className="flex justify-center">
        <PaginationControls
          compact
          rangeAsPageSize
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={total}
          onPageChange={setPage}
          editablePageSizeInput={false}
          t={t}
        />
      </div>

      {detail ? (
        <Modal title={`${detail.product_name}`} onClose={() => { setDetail(null); setDetailRows(null) }}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{tr(t, 'date', 'Date')}</div>
                <div className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-gray-100">{fmtDateTime24(detail.created_at)}</div>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{beforeLabel}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{detail.before_qty}</div>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{translateMovementType(detail.movement_type, t)}</div>
                <div className={`mt-0.5 inline-flex rounded-lg px-2 py-0.5 text-sm font-semibold ${movementColorClass(detail.movement_type, detail.signed_quantity)}`}>{signedLabel(detail)}</div>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{afterLabel}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{detail.after_qty}</div>
              </div>
            </div>
            {detail.batch_id ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <span className="text-[11px] uppercase tracking-wide text-gray-400">{tr(t, 'batch', 'Batch')}: </span>
                {batchDisplayLabel({ id: detail.batch_id, lot_code: detail.batch_lot_code, received_at: detail.batch_received_at })}
                {detail.batch_supplier_name ? <span className="text-gray-400"> · {detail.batch_supplier_name}</span> : null}
              </p>
            ) : null}
            {detail.reason ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <span className="text-[11px] uppercase tracking-wide text-gray-400">{tr(t, 'reason', 'Reason')}: </span>
                {detail.reason}
              </p>
            ) : null}
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{detail.branch_name || '--'}</span>
              <span>{detail.user_name || '--'}</span>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{tr(t, 'stock_change_ledger', 'Stock Changes')}</div>
              {detailRows === null ? (
                <p className="py-3 text-center text-xs text-gray-400">{tr(t, 'loading', 'Loading')}...</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {detailRows.map((row) => (
                    <div key={row.id} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${row.id === detail.id ? 'ring-1 ring-blue-300 dark:ring-blue-700' : ''} bg-gray-50 dark:bg-gray-800/60`}>
                      <span className="text-gray-400">{fmtDateTime24(row.created_at)}</span>
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}>{signedLabel(row)}</span>
                      <span className="tabular-nums text-gray-500">{row.before_qty} → {row.after_qty}</span>
                    </div>
                  ))}
                  {!detailRows.length ? <p className="py-2 text-center text-gray-400">{tr(t, 'no_data_found', 'No data found')}</p> : null}
                </div>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
