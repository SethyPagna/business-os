import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../AppContext'
import { getStockLedger } from '../../api/productReadTransport.ts'
import { revertStockMovement, editStockMovementReason } from '../../api/inventoryWriteTransport.ts'

// The full-featured adjust modal (batch, price-lock, reasons) reused from the
// Inventory/Branches page -- lazy so its weight only loads when the person
// actually opens the Adjust menu, not on every Stock Changes view.
const StockAdjustModal = lazy(() => import('./forms/StockAdjustModal'))
// The shipment receiver, same one the Branches page offers -- reachable from
// this section's Adjust menu too (user, Aug 31: "for fast stock in do that
// for products pages and all sections").
const FastStockInModal = lazy(() => import('../inventory/FastStockInModal'))
// The shared range step in front of an export -- defaults to this section's
// own Start → End range (user, Aug 31: "do the date range for all the
// exports").
const ExportRangeDialog = lazy(() => import('../shared/ExportRangeDialog'))
import { movementColorClass, translateMovementType } from '../inventory/movementGroups.ts'
import DateTimeRangePicker from '../shared/DateTimeRangePicker'
import FilterMenu, { type FilterSection } from '../shared/FilterMenu'
import Modal from '../shared/Modal'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import PaginationControls from '../shared/PaginationControls'
import SearchInput from '../shared/SearchInput'
import ScanSearchButton from '../shared/ScanSearchButton'
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
  brand?: string | null
  category?: string | null
  tag_label?: string | null
  branch_name: string | null
  movement_type: string
  quantity: number
  signed_quantity: number
  reason: string | null
  reference_id?: number | string | null
  unit_cost_usd?: number | null
  unit_cost_khr?: number | null
  total_cost_usd?: number | null
  total_cost_khr?: number | null
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
  batch_payment_status?: string | null
  batch_credit_due_date?: string | null
  batch_expiry_date?: string | null
  batch_unit_cost_usd?: number | null
  batch_received_cost_usd?: number | null
  batch_receipt_session_count?: number | null
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

function fmtOptionalUsd(value: unknown): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type BranchOption = { id: number; name: string }

// The Stock Changes section's header-row actions, registered UP to Products.tsx
// so its "Adjust" menu and ledger export render on the page header row beside
// info/History/Manage (user, Aug 31) instead of in this section's body. The
// modals and the ledger's live filter state stay in this component -- only the
// trigger UI is lifted, via these stable callbacks.
export type StockChangeHeaderActions = {
  canAdjust: boolean
  openAdjust: (type: 'add' | 'remove' | 'set') => void
  openFastStockIn: () => void
  runExport: () => void
}

type StockChangeSectionProps = {
  t: Translate
  // Called with the action set on mount (and whenever it changes), and with
  // null on unmount so Products.tsx can drop the header controls when this
  // section is not shown.
  onRegisterActions?: (actions: StockChangeHeaderActions | null) => void
}

export default function StockChangeSection({ t, onRegisterActions }: StockChangeSectionProps) {
  // Row write actions (revert / edit reason) reuse the same app context the
  // rest of the Products page reads -- can() gates them exactly as the server
  // does (Inventory adjust access), notify() surfaces the result.
  const app = useApp() as { can: (section: string, action: string) => boolean; notify: (message: string, type?: string) => void }
  const canAdjust = app.can('inventory', 'adjust')
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
  // Row context actions on the open detail: an inline reason editor and a
  // two-step revert confirm. rowBusy blocks both while a write is in flight.
  const [rowBusy, setRowBusy] = useState(false)
  const [editingReason, setEditingReason] = useState<string | null>(null)
  const [pendingReasonSave, setPendingReasonSave] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState(false)
  // Adjust menu (Add / Remove / Adjust quantity) -> opens the reused modal.
  // The trigger button/menu now lives on the page header row (Products.tsx);
  // this state drives which modal that menu opens.
  const [adjustType, setAdjustType] = useState<'add' | 'remove' | 'set' | null>(null)
  const [fastStockInOpen, setFastStockInOpen] = useState(false)
  const [exportRange, setExportRange] = useState<{ startDate: string; endDate: string } | null>(null)
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
    setEditingReason(null)
    setConfirmRevert(false)
    try {
      const response = await getStockLedger({ productId: row.product_id, page: 1, pageSize: 20 }) as LedgerResponse
      setDetailRows(Array.isArray(response?.items) ? response.items : [])
    } catch {
      setDetailRows([])
    }
  }, [])

  const closeDetail = useCallback(() => {
    setDetail(null); setDetailRows(null); setEditingReason(null); setConfirmRevert(false)
  }, [])

  // Ranged CSV export of the ledger, honoring the section's current search/
  // branch/supplier/view filters. Walks /stock-ledger pages (1000/page,
  // 10-page cap) and says so honestly if the range holds more.
  const runLedgerExport = useCallback(async (range: { startDate: string; endDate: string }) => {
    const pageSize = 1000
    const maxPages = 10
    const rows: LedgerRow[] = []
    let grandTotal = 0
    for (let exportPage = 1; exportPage <= maxPages; exportPage += 1) {
      const response = await getStockLedger({
        view,
        page: exportPage,
        pageSize,
        search: debouncedSearch || undefined,
        branchId: branchId || undefined,
        startDate: range.startDate || undefined,
        endDate: range.endDate || undefined,
        supplierId: supplierId || undefined,
      }) as LedgerResponse
      const items = Array.isArray(response?.items) ? response.items : []
      grandTotal = Number(response?.total || 0)
      rows.push(...items)
      if (rows.length >= grandTotal || items.length < pageSize) break
    }
    if (grandTotal > rows.length) {
      app.notify(tr(t, 'export_truncated', `Export capped at ${rows.length} of ${grandTotal} records — narrow the range for the rest.`), 'warning')
    }
    const { downloadCSV } = await import('../../utils/csv.ts')
    downloadCSV(`stock-changes-${range.startDate || 'all'}-${range.endDate || 'all'}.csv`, rows.map((row) => ({
      date: isDateOnlyStamp(row.created_at) ? fmtDate(row.created_at) : fmtDateTime24(row.created_at),
      product: row.product_name,
      barcode: row.barcode || '',
      branch: row.branch_name || '',
      type: row.movement_type,
      quantity: row.signed_quantity,
      before: row.before_qty,
      after: row.after_qty,
      batch: row.batch_id ? batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at }) : '',
      supplier: row.batch_supplier_name || '',
      reason: row.reason || '',
      reference: row.reference_id ?? '',
      unit: row.unit || '',
      category: row.category || '',
      brand: row.brand || '',
      tag: row.tag_label || '',
      user: row.user_name || '',
      unit_cost_usd: row.unit_cost_usd ?? row.batch_unit_cost_usd ?? '',
      unit_cost_khr: row.unit_cost_khr ?? '',
      total_cost_usd: row.total_cost_usd ?? row.batch_received_cost_usd ?? '',
      total_cost_khr: row.total_cost_khr ?? '',
      batch_expiry: row.batch_expiry_date || '',
      payment_status: row.batch_payment_status || '',
      credit_due_date: row.batch_credit_due_date || '',
    })))
  }, [app, branchId, debouncedSearch, supplierId, t, view])

  // Revert: post the compensating counter-movement, then refresh the list (the
  // reverted row stays -- the ledger is append-only -- and the new counter-
  // movement appears). Close the detail so the person sees the updated list.
  const doRevert = useCallback(async () => {
    if (!detail) return
    setRowBusy(true)
    try {
      const res = await revertStockMovement(detail.id) as { success?: boolean; error?: string } | undefined
      if (res && res.success === false) throw new Error(res.error || tr(t, 'revert_failed', 'Revert failed'))
      app.notify(tr(t, 'movement_reverted', 'Change reverted'))
      closeDetail()
      void load()
    } catch (error) {
      app.notify(error instanceof Error ? error.message : tr(t, 'unknown_error', 'Something went wrong'), 'error')
    } finally {
      setRowBusy(false)
    }
  }, [detail, app, t, closeDetail, load])

  // Select-then-confirm: staging the trimmed value opens the ConfirmDialog
  // rendered near the detail modal (replaces the previous bare
  // window.confirm()); commitSaveReason runs the actual write.
  const saveReason = useCallback(() => {
    if (!detail || editingReason == null) return
    const next = editingReason.trim()
    if (!next) { app.notify(tr(t, 'reason_required', 'A reason is required'), 'error'); return }
    setPendingReasonSave(next)
  }, [detail, editingReason, app, t])

  const commitSaveReason = useCallback(async () => {
    if (!detail || pendingReasonSave == null) return
    const next = pendingReasonSave
    setRowBusy(true)
    try {
      const res = await editStockMovementReason(detail.id, next) as { success?: boolean; error?: string } | undefined
      if (res && res.success === false) throw new Error(res.error || tr(t, 'update_failed', 'Update failed'))
      app.notify(tr(t, 'reason_updated', 'Reason updated'))
      setDetail((current) => (current ? { ...current, reason: next } : current))
      setEditingReason(null)
      void load()
    } catch (error) {
      app.notify(error instanceof Error ? error.message : tr(t, 'unknown_error', 'Something went wrong'), 'error')
    } finally {
      setRowBusy(false)
      setPendingReasonSave(null)
    }
  }, [detail, pendingReasonSave, app, t, load])

  // Header-row action bridge (user, Aug 31): the Adjust menu + ledger export
  // moved onto the page header row, rendered by Products.tsx. Its trigger
  // callbacks are registered here. runExport must open with THIS section's
  // current Start -> End range, so it reads the latest range from a ref rather
  // than closing over a stale value (which would let the export dialog seed
  // itself with whatever the range was when the section first mounted).
  const rangeRef = useRef({ startDate, endDate })
  useEffect(() => { rangeRef.current = { startDate, endDate } }, [startDate, endDate])
  const openExport = useCallback(() => setExportRange({ ...rangeRef.current }), [])
  useEffect(() => {
    if (!onRegisterActions) return
    onRegisterActions({
      canAdjust,
      openAdjust: (type) => setAdjustType(type),
      openFastStockIn: () => setFastStockInOpen(true),
      runExport: openExport,
    })
    return () => onRegisterActions(null)
  }, [onRegisterActions, canAdjust, openExport])

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
            <span className="break-words text-[13px] font-semibold leading-4 text-gray-800 dark:text-gray-100" title={row.product_name}>{row.product_name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
            {row.batch_id ? (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at })}
              </span>
            ) : null}
            {row.barcode ? <span className="break-all font-mono">{row.barcode}</span> : null}
            {row.batch_supplier_name ? <span className="break-words font-medium text-gray-500 dark:text-gray-300">{row.batch_supplier_name}</span> : null}
            {row.branch_name ? <span className="break-words">{row.branch_name}</span> : null}
            {row.user_name ? <span className="break-words">· {row.user_name}</span> : null}
            {row.reason ? <span className="break-words text-gray-400">· {row.reason}</span> : null}
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

  const renderDesktopRows = () => (
    <div className="desktop-dense-only dense-data-shell">
      <div className="scroll-x">
        <table className="dense-data-table min-w-[980px]" aria-label={tr(t, 'stock_change_ledger', 'Stock Changes')}>
          <colgroup>
            <col className="w-[5.5rem]" />
            <col className="w-[18%]" />
            <col className="w-[8rem]" />
            <col className="w-[5.5rem]" />
            <col className="w-[7.5rem]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{tr(t, 'time', 'Time')}</th>
              <th data-tone="blue">{tr(t, 'product', 'Product')}</th>
              <th data-tone="violet">{tr(t, 'type', 'Type')}</th>
              <th data-tone="emerald" className="text-right">{tr(t, 'quantity', 'Quantity')}</th>
              <th className="text-right">{beforeLabel} → {afterLabel}</th>
              <th>{tr(t, 'branch', 'Branch')}</th>
              <th>{tr(t, 'supplier', 'Supplier')}</th>
              <th>{tr(t, 'cashier_user', 'User')}</th>
              <th>{tr(t, 'reason', 'Reason')}</th>
            </tr>
          </thead>
          <tbody>
            {dayGroups.flatMap((group) => [
              <tr key={`day-${group.key}`} className="dense-day-row"><td colSpan={9}>{group.key} · {group.rows.length}</td></tr>,
              ...group.rows.map((row) => {
                const dateOnly = isDateOnlyStamp(row.created_at)
                const clock = dateOnly ? '' : fmtClock24(row.created_at)
                const timeUnknown = dateOnly || clock === '—' || clock === ''
                return (
                  <tr
                    key={row.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => void openDetail(row)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openDetail(row) } }}
                    aria-label={`${row.product_name}, ${signedLabel(row)}`}
                  >
                    <td className="tabular-nums text-gray-400" title={timeUnknown ? noTimeLabel : undefined}>{timeUnknown ? '––:––' : clock}</td>
                    <td><span className="whitespace-normal break-words font-semibold text-gray-800 dark:text-gray-100">{row.product_name}</span><span className="break-all dense-id text-gray-400">{row.barcode || (row.batch_id ? batchDisplayLabel({ id: row.batch_id, lot_code: row.batch_lot_code, received_at: row.batch_received_at }) : '—')}</span></td>
                    <td><span className={`inline-flex max-w-full items-center rounded px-1.5 py-0.5 font-semibold ${movementColorClass(row.movement_type, row.signed_quantity)}`}><span className="dense-cell-truncate">{translateMovementType(row.movement_type, t)}</span></span></td>
                    <td className={`text-right font-bold tabular-nums ${row.signed_quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{signedLabel(row)}</td>
                    <td className="text-right tabular-nums text-gray-500">{row.before_qty} → <b className="text-gray-800 dark:text-gray-100">{row.after_qty}</b></td>
                    <td><span className="dense-cell-truncate" title={row.branch_name || ''}>{row.branch_name || '—'}</span></td>
                    <td><span className="dense-cell-truncate" title={row.batch_supplier_name || ''}>{row.batch_supplier_name || '—'}</span></td>
                    <td><span className="dense-cell-truncate" title={row.user_name || ''}>{row.user_name || '—'}</span></td>
                    <td><span className="dense-cell-truncate text-gray-500" title={row.reason || ''}>{row.reason || '—'}</span></td>
                  </tr>
                )
              }),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  )

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
      {/* Rows 1+2 pin together while the ledger scrolls (user, Aug 31: "the
          search bar row and the date both can be pinned and stick ... for
          all sections and pages") -- same sticky treatment as the Products
          listing's own search row above this section. */}
      <div className="sticky top-0 z-30 -mx-1 space-y-3 bg-gray-50/95 px-1 pb-2 pt-1 backdrop-blur dark:bg-gray-900/95 sm:mx-0 sm:px-0">
      {/* Row 1: the date-range + search bar row. It leads; every mini-section
          drops BELOW it (user, Aug 31 2026: "move all mini sections (filters,
          stats, etc.) below the date range and search bar row"). Unified
          Start → End pill -- the same control as the Dashboard, Fees,
          Inventory movements and Audit Log range filters. The section's Adjust
          menu and ledger export now live on the page header row above (see
          Products.tsx / HeaderActions' primaryActionSlot), so this row leads
          straight with the date range. */}
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
        {/* The barcode scanner rides the ledger search too (user, Aug 31:
            "bring the barcode scanner back") -- scanning a product fills the
            search box, same as the Products / POS / Inventory search rows. */}
        <ScanSearchButton onDetected={setSearch} t={t} />
        {/* The loose "↓ <total> ⓘ" export affordance that used to sit at the
            end of this row was removed (user, Aug 31: "remove the whole thing")
            -- the ledger CSV export is now folded into the page header's
            Manage → Export (context-aware on this section, via the registered
            runExport above). The running total stays on the pagination row. */}
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
      </div>
      </div>

      {/* The In/Out totals get their own row DIRECTLY above the list (user,
          Aug 31: "the total rows ... can be moved to above the rows, below
          the current placement") -- out of the pinned toolbar, leading the
          data they summarize. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {stat('in', summary.inCount, summary.inQty)}
        {stat('out', summary.outCount, summary.outQty)}
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {loadError}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>{tr(t, 'retry', 'Retry')}</button>
        </div>
      ) : null}

      {/* Desktop uses a compact workbook-style ledger. Mobile retains the
          day-grouped cards so values do not squeeze into unreadable columns. */}
      {loading && !rows.length ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-[4.25rem] animate-pulse rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40" />)}
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-3 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{tr(t, 'no_data_found', 'No data found')}</div>
      ) : (
        <>
          {renderDesktopRows()}
          <div className="mobile-cards-only space-y-4">
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
          </div>
          {loading ? <p className="text-center text-xs text-gray-400">{tr(t, 'loading', 'Loading')}...</p> : null}
        </>
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
        <Modal title={`${detail.product_name}`} onClose={closeDetail}>
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
            {detail.barcode ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <span className="text-[11px] uppercase tracking-wide text-gray-400">{tr(t, 'barcode', 'Barcode')}: </span>
                <span className="font-mono">{detail.barcode}</span>
              </p>
            ) : null}
            {detail.reason ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                <span className="text-[11px] uppercase tracking-wide text-gray-400">{tr(t, 'reason', 'Reason')}: </span>
                {detail.reason}
              </p>
            ) : null}
            <dl className="grid gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800/60 sm:grid-cols-2">
              {([
                [tr(t, 'reference', 'Reference'), detail.reference_id],
                [tr(t, 'unit', 'Unit'), detail.unit],
                [tr(t, 'category', 'Category'), detail.category],
                [tr(t, 'brand', 'Brand'), detail.brand],
                [tr(t, 'tag', 'Tag'), detail.tag_label],
                [tr(t, 'unit_cost', 'Unit cost'), detail.unit_cost_usd != null || detail.batch_unit_cost_usd != null ? fmtOptionalUsd(detail.unit_cost_usd ?? detail.batch_unit_cost_usd) : null],
                [tr(t, 'total_cost', 'Total cost'), detail.total_cost_usd != null || detail.batch_received_cost_usd != null ? fmtOptionalUsd(detail.total_cost_usd ?? detail.batch_received_cost_usd) : null],
                [tr(t, 'expiry_date', 'Expiry'), detail.batch_expiry_date],
                [tr(t, 'payment_status', 'Payment status'), detail.batch_payment_status],
                [tr(t, 'credit_due_date', 'Credit due'), detail.batch_credit_due_date],
                [tr(t, 'receipt_sessions', 'Receipt sessions'), detail.batch_receipt_session_count],
              ] as Array<[string, string | number | null | undefined]>).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="uppercase tracking-wide text-gray-400">{label}</dt>
                  <dd className="mt-0.5 whitespace-normal break-words font-medium text-gray-700 dark:text-gray-200">{String(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{detail.branch_name || '--'}</span>
              <span>{detail.user_name || '--'}</span>
            </div>
            {/* Row context actions -- Edit reason + Revert -- only for a user
                with Inventory adjust access (the server enforces the same).
                Revert is a two-step inline confirm; its "what it does" note
                (append-only, which types qualify) lives behind the InfoHint. */}
            {canAdjust ? (
              editingReason == null ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                  <button
                    type="button"
                    disabled={rowBusy}
                    onClick={() => setEditingReason(detail.reason || '')}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {tr(t, 'edit_reason', 'Edit reason')}
                  </button>
                  {confirmRevert ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{tr(t, 'confirm_revert', 'Revert this change?')}</span>
                      <button type="button" disabled={rowBusy} onClick={() => void doRevert()} className="rounded-lg bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-50">{tr(t, 'revert', 'Revert')}</button>
                      <button type="button" disabled={rowBusy} onClick={() => setConfirmRevert(false)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-gray-600 dark:border-gray-700 dark:text-gray-300">{tr(t, 'cancel', 'Cancel')}</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => setConfirmRevert(true)}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-900/20"
                    >
                      {tr(t, 'revert', 'Revert')}
                    </button>
                  )}
                  <InfoHint
                    label={tr(t, 'revert', 'Revert')}
                    text={tr(t, 'revert_info', 'Posts a compensating opposite movement — nothing is deleted, and the revert itself appears in the history. Only manual stock changes and imports can be reverted; sales, returns and transfers must be undone from their own records.')}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                  <input
                    autoFocus
                    value={editingReason}
                    onChange={(event) => setEditingReason(event.target.value)}
                    className="input flex-1 text-sm"
                    placeholder={tr(t, 'reason', 'Reason')}
                    onKeyDown={(event) => { if (event.key === 'Enter') void saveReason() }}
                  />
                  <button type="button" disabled={rowBusy} onClick={() => void saveReason()} className="btn-primary px-3 py-1 text-xs disabled:opacity-50">{tr(t, 'save', 'Save')}</button>
                  <button type="button" disabled={rowBusy} onClick={() => setEditingReason(null)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">{tr(t, 'cancel', 'Cancel')}</button>
                </div>
              )
            ) : null}
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

      {pendingReasonSave !== null ? (
        <ConfirmDialog
          t={(key: string, fallback?: string) => tr(t, key, fallback || key)}
          title={tr(t, 'confirm_update_stock_reason', 'Update the reason recorded for this stock movement?')}
          message={pendingReasonSave}
          working={rowBusy}
          onConfirm={() => { void commitSaveReason() }}
          onClose={() => { if (!rowBusy) setPendingReasonSave(null) }}
        />
      ) : null}

      {adjustType ? (
        <Suspense fallback={null}>
          <StockAdjustModal
            initialType={adjustType}
            t={t}
            onClose={() => setAdjustType(null)}
            onDone={() => { setAdjustType(null); void load() }}
          />
        </Suspense>
      ) : null}

      {exportRange ? (
        <Suspense fallback={null}>
          <ExportRangeDialog
            initial={exportRange}
            title={`${tr(t, 'export', 'Export')} — ${tr(t, 'stock_change_ledger', 'Stock Changes')}`}
            t={t}
            onClose={() => setExportRange(null)}
            onExport={runLedgerExport}
          />
        </Suspense>
      ) : null}

      {fastStockInOpen ? (
        <Suspense fallback={null}>
          <FastStockInModal
            branchOptions={branches.map((branch) => ({ value: String(branch.id), label: branch.name || String(branch.id) }))}
            defaultBranchId={branchId || null}
            tr={(key: string, fallback = key) => tr(t, key, fallback)}
            notify={(message: string, kind?: string) => app.notify(message, kind)}
            onClose={() => setFastStockInOpen(false)}
            onDone={() => { void load() }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
