import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStockLedger } from '../../api/productReadTransport.ts'
import { movementColorClass, translateMovementType } from '../inventory/movementGroups.ts'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import FilterMenu, { type FilterSection } from '../shared/FilterMenu'
import Modal from '../shared/Modal'
import PaginationControls from '../shared/PaginationControls'
import SearchInput from '../shared/SearchInput'
import InfoHint from '../shared/InfoHint'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import { fmtDate, fmtClock24, fmtDateTime24 } from '../../utils/formatters'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'

// D1 (Part 415): the user's Stock Change ledger on the Products page --
// one row per recorded action over the EXISTING movement history, with the
// derived running balance (before -> after) the /stock-ledger kernel
// computes by walking back from current stock. Read-only. Row click opens
// the per-product mini-ledger (D3's absorption of Inventory's
// view-stock-movement drill into the Products surface): the same endpoint
// scoped to that product, so both levels always agree.
//
// Part 553 (this session): reworked to the two-column In / Out model the
// user asked for -- the "Adjustments" view is gone (its rows fold into In),
// the date-range + search row leads and every mini-section (view toggle,
// filters, the now-always-visible In-vs-Out stats) sits BELOW it, and blank
// times on legacy/imported rows are shown honestly instead of as a mystery
// "—" (their date now groups correctly; the time reads "no time recorded").

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
  ledger_bucket: 'in' | 'out'
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

type LedgerSummary = {
  inCount: number
  outCount: number
  inQty: number
  outQty: number
  total: number
}

type LedgerResponse = {
  items?: LedgerRow[]
  total?: number
  totalPages?: number
  summary?: LedgerSummary
}

// Part 553: two columns only. The old 'adjustments' view was removed (its
// rows fold into In); 'all' shows everything.
type LedgerView = 'all' | 'in' | 'out'

type Translate = (key: string) => string

const PAGE_SIZE = 25

const EMPTY_SUMMARY: LedgerSummary = { inCount: 0, outCount: 0, inQty: 0, outQty: 0, total: 0 }

function tr(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

function signedLabel(row: LedgerRow): string {
  const sign = row.signed_quantity > 0 ? '+' : row.signed_quantity < 0 ? '−' : ''
  return `${sign}${Math.abs(row.signed_quantity)}`
}

// A bare "YYYY-MM-DD" stamp (a legacy/imported movement with no time of
// day). The DATE still renders -- normalizeTimestampInput now treats it as
// midnight so day-grouping works -- but its clock would be a fabricated
// 00:00/07:00, so the time slot honestly reads "no time recorded" instead.
function isDateOnlyStamp(raw: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw ?? '').trim())
}

function fmtQty(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '0'
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
  const [summary, setSummary] = useState<LedgerSummary>(EMPTY_SUMMARY)
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
      setSummary(response?.summary ? { ...EMPTY_SUMMARY, ...response.summary } : EMPTY_SUMMARY)
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

  // Part 553: two view chips plus All -- the Adjustment chip is gone (its
  // rows fold into In).
  const views: Array<{ id: LedgerView; label: string }> = [
    { id: 'all', label: tr(t, 'all', 'All') },
    { id: 'in', label: tr(t, 'stock_in', 'Stock In') },
    { id: 'out', label: tr(t, 'stock_out', 'Stock Out') },
  ]

  const beforeLabel = tr(t, 'before_qty', 'Before')
  const afterLabel = tr(t, 'after_qty', 'After')
  const noTimeLabel = tr(t, 'time_not_recorded', 'Time not recorded (imported record)')

  // Branch + supplier folded into the shared FilterMenu (user, Aug 30 2026:
  // "fold supplier and branch into filter menu") instead of two loose selects
  // on the toolbar row. Branch only appears when the business has more than
  // one; the supplier list gets its own in-panel search once it's long
  // (searchable). Empty when neither applies -> no filter trigger renders.
  const filterSections = useMemo<FilterSection[]>(() => {
    const sections: FilterSection[] = []
    if (branches.length > 1) {
      sections.push({
        id: 'branch',
        label: tr(t, 'branch', 'Branch'),
        options: [
          { id: '', label: tr(t, 'all', 'All'), active: !branchId, onClick: () => setBranchId(0) },
          ...branches.map((branch) => ({ id: branch.id, label: branch.name, active: branchId === branch.id, onClick: () => setBranchId(branch.id) })),
        ],
      })
    }
    if (suppliers.length) {
      sections.push({
        id: 'supplier',
        label: tr(t, 'supplier', 'Supplier'),
        searchable: true,
        options: [
          { id: '', label: tr(t, 'all', 'All'), active: !supplierId, onClick: () => setSupplierId(0) },
          ...suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name, active: supplierId === supplier.id, onClick: () => setSupplierId(supplier.id) })),
        ],
      })
    }
    return sections
  }, [branches, suppliers, branchId, supplierId, t])

  // Group the current page's rows by their business-timezone DAY so the date
  // lives once on a divider header and each card need only show its time
  // (user, Aug 30 2026: "for date just show outside separating the change by
  // day... in the card just put the time as we have date to divide outside").
  // fmtDate is mm/dd/yyyy in business time, so grouping by that string IS a
  // business-day grouping. Rows already arrive sorted created_at desc, so
  // iteration preserves both the day order and the within-day order. A day
  // can straddle a page edge -- that's fine, the header just reappears on the
  // next page, same as every other server-paged day-grouped list here.
  const dayGroups = useMemo(() => {
    const groups: Array<{ key: string; rows: LedgerRow[] }> = []
    const index = new Map<string, number>()
    for (const row of rows) {
      const key = fmtDate(row.created_at)
      let at = index.get(key)
      if (at === undefined) { at = groups.length; index.set(key, at); groups.push({ key, rows: [] }) }
      groups[at].rows.push(row)
    }
    return groups
  }, [rows])

  const renderCard = (row: LedgerRow) => {
    const dateOnly = isDateOnlyStamp(row.created_at)
    const clock = dateOnly ? '' : fmtClock24(row.created_at)
    const timeUnknown = dateOnly || clock === '—' || clock === ''
    return (
      <button
        key={row.id}
        type="button"
        onClick={() => void openDetail(row)}
        className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-700 dark:hover:bg-blue-900/10"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Time only -- the day header above carries the date. A
                legacy/imported row with no time of day shows a muted marker
                (with an explanatory tooltip) rather than a fabricated 00:00. */}
            <span
              className={`shrink-0 tabular-nums text-xs font-medium ${timeUnknown ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400'}`}
              title={timeUnknown ? noTimeLabel : undefined}
            >
              {timeUnknown ? '––:––' : clock}
            </span>
            <span className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={row.product_name}>{row.product_name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
            {row.barcode ? <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-300">{row.barcode}</span> : null}
            {row.batch_id ? (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at })}
              </span>
            ) : null}
            {row.branch_name ? <span className="truncate">{row.branch_name}</span> : null}
            {row.reason ? <span className="truncate text-gray-400" title={row.reason}>· {row.reason}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}>
            {signedLabel(row)}
            <span className="font-normal opacity-80">{translateMovementType(row.movement_type, t)}</span>
          </span>
          <div className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {row.before_qty} <span className="text-gray-300 dark:text-gray-600">→</span> <span className="font-semibold text-gray-800 dark:text-gray-100">{row.after_qty}</span>
          </div>
        </div>
      </button>
    )
  }

  // Always-visible In vs Out stats (user, Aug 31: "stats should be visible
  // directly without expand/collapse"). Colour-coded so the reported
  // "70+ in vs very few out" reads at a glance -- and now honest, since the
  // completed outflow list means damaged/moved/replacement rows finally land
  // in Out instead of inflating In. Numbers come from the server summary,
  // computed over the current date/search/branch/supplier scope but ignoring
  // the In/Out chip, so the split is the same whichever view is selected.
  const stat = (kind: 'in' | 'out', count: number, qty: number) => {
    const active = view === kind
    const isIn = kind === 'in'
    return (
      <button
        type="button"
        onClick={() => setView(active ? 'all' : kind)}
        title={isIn ? tr(t, 'stock_in', 'Stock In') : tr(t, 'stock_out', 'Stock Out')}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold transition ${
          isIn
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
            : 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
        } ${active ? 'ring-2 ring-inset ' + (isIn ? 'ring-emerald-400 dark:ring-emerald-600' : 'ring-rose-400 dark:ring-rose-600') : 'hover:brightness-95'}`}
      >
        <span aria-hidden="true">{isIn ? '↑' : '↓'}</span>
        <span className="tabular-nums">{count}</span>
        <span className="font-normal opacity-80">{isIn ? tr(t, 'stock_in', 'Stock In') : tr(t, 'stock_out', 'Stock Out')}</span>
        <span className="font-normal tabular-nums opacity-60">· {fmtQty(qty)}</span>
      </button>
    )
  }

  return (
    <div className="space-y-3">
      {/* Row 1: the date-range + search bar row. It leads; every mini-section
          drops BELOW it (user, Aug 31 2026: "move all mini sections (filters,
          stats, etc.) below the date range and search bar row"). Unified
          Start → End pill -- the same control as the Dashboard, Fees,
          Inventory movements and Audit Log range filters. */}
      <div className="flex flex-wrap items-center gap-2">
        <DateTimeRangePicker
          value={{ startDate, endDate, startTime: '', endTime: '' }}
          onChange={(next) => {
            setStartDate(next.startDate || '')
            setEndDate(next.endDate || '')
          }}
          t={t}
          showTime={false}
          triggerClassName="flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5"
        />
        <div className="min-w-48 flex-1 sm:max-w-96">
          <SearchInput id="stock-ledger-search" name="stock_ledger_search" value={search} onChange={setSearch} placeholder={tr(t, 'search', 'Search')} />
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-400">
          {total}
          {/* The ledger's "what is this" explanation lives behind this info
              affordance instead of an inline sentence above the section
              (density: instructions move into the info toolkit, not the
              layout). */}
          <InfoHint
            label={tr(t, 'stock_change_ledger', 'Stock Changes')}
            text={tr(t, 'stock_change_ledger_info', 'Read-only. Every recorded stock action — stock in, stock out — with the running balance (before → after) computed from current stock. Tap a card for that product’s full history.')}
          />
        </span>
      </div>

      {/* Row 2: the mini-sections, BELOW the date/search row -- the In/Out/All
          view toggle, the branch/supplier filter menu, and the
          always-visible In-vs-Out stats (no Stats expander; the Adjustments
          column is gone -- everything nets to In or Out). */}
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
        {filterSections.length ? (
          <FilterMenu
            label={tr(t, 'filters', 'Filters')}
            activeCount={(branchId ? 1 : 0) + (supplierId ? 1 : 0)}
            sections={filterSections}
            onClear={() => { setBranchId(0); setSupplierId(0) }}
            mobileIconOnly
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {stat('in', summary.inCount, summary.inQty)}
          {stat('out', summary.outCount, summary.outQty)}
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {loadError}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>{tr(t, 'retry', 'Retry')}</button>
        </div>
      ) : null}

      {/* Day-grouped card list (user, Aug 30 2026): a divider header per day
          carries the date, then one tappable card per change showing just its
          time -- replacing the horizontally-scrolling before/after table
          (card design like the Products / Fees sections). Tap a card for the
          per-product mini-ledger. */}
      {loading && !rows.length ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-[4.25rem] animate-pulse rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40" />)}
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-3 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{tr(t, 'no_data_found', 'No data found')}</div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{group.key}</span>
                <span className="text-[11px] text-gray-400">{group.rows.length}</span>
                <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
              </div>
              <div className="space-y-2">
                {group.rows.map(renderCard)}
              </div>
            </div>
          ))}
          {loading ? <p className="text-center text-xs text-gray-400">{tr(t, 'loading', 'Loading')}...</p> : null}
        </div>
      )}

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
                <div className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-gray-100" title={isDateOnlyStamp(detail.created_at) ? noTimeLabel : undefined}>
                  {isDateOnlyStamp(detail.created_at) ? fmtDate(detail.created_at) : fmtDateTime24(detail.created_at)}
                </div>
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
                      <span className="text-gray-400" title={isDateOnlyStamp(row.created_at) ? noTimeLabel : undefined}>
                        {isDateOnlyStamp(row.created_at) ? fmtDate(row.created_at) : fmtDateTime24(row.created_at)}
                      </span>
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
