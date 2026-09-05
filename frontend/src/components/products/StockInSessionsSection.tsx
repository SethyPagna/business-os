import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { getStockInSessionLines, getStockInSessions } from '../../api/productReadTransport.ts'
import { revertStockMovement } from '../../api/inventoryWriteTransport.ts'
import { updateBatch } from '../../api/batchesTransport.ts'
import { fmtClock24, fmtDate, fmtDateTime24 } from '../../utils/formatters.ts'
import { groupByBusinessDay } from '../../utils/businessDayGroups.ts'
import { stockSessionId } from '../../utils/timestampId.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Modal from '../shared/Modal.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import PaginationControls, { clampPage, DEFAULT_PAGE_SIZE } from '../shared/PaginationControls.tsx'
import { ProductImg, ProductImagePlaceholder } from './shared/primitives.tsx'

const FastStockInModal = lazyRetry(() => import('../inventory/FastStockInModal.tsx'), 'stock-session-fast-stock-in')

type T = (key: string) => string
type Branch = { id?: string | number; name?: string }
type Row = {
  id: number; product_id: number; product_name: string; barcode?: string | null; quantity: number
  sku?: string | null; image_path?: string | null
  branch_id?: number | null; branch_name?: string | null; user_name?: string | null; created_at: string
  reference_id?: number | string | null; batch_id?: number | null; batch_lot_code?: string | null; batch_received_at?: string | null
  batch_supplier_id?: number | null; batch_supplier_name?: string | null; movement_type: string
  unit?: string | null; brand?: string | null; category?: string | null; tag_label?: string | null; reason?: string | null
  unit_cost_usd?: number | null; total_cost_usd?: number | null
  selling_price_usd?: number | null; selling_price_khr?: number | null
  purchase_price_usd?: number | null; purchase_price_khr?: number | null
  cost_price_usd?: number | null; cost_price_khr?: number | null
  batch_unit_cost_usd?: number | null; batch_received_cost_usd?: number | null
  batch_payment_status?: string | null; batch_credit_due_date?: string | null
  batch_expiry_date?: string | null; batch_updated_at?: string | null
  batch_receipt_session_count?: number | null
}
type Session = {
  key: string; rows: Row[]; supplier: SupplierChoice; receivedDate: string; branchId: string
  branchName: string; userName: string; createdAt: string; quantity: number
  costUsd: number | null; linesWithoutCost: number; paymentStatus: 'paid' | 'credit' | 'mixed' | ''
  creditDueDate: string; hasSharedBatch: boolean; hasMixedHeader: boolean
}

function sessionCost(rows: Row[]): { costUsd: number | null; linesWithoutCost: number } {
  let total = 0
  let known = false
  let missing = 0
  const fallbackBatches = new Set<number>()
  for (const row of rows) {
    const movementTotal = row.total_cost_usd == null ? null : Number(row.total_cost_usd)
    if (movementTotal != null && Number.isFinite(movementTotal) && movementTotal > 0) {
      total += movementTotal; known = true; continue
    }
    const batchId = Number(row.batch_id) || 0
    const batchTotal = row.batch_received_cost_usd == null ? null : Number(row.batch_received_cost_usd)
    // A cumulative lot total is exact for a receipt only when the lot is tied
    // to one session. Count it once if that session has several movement rows.
    if (batchId && Number(row.batch_receipt_session_count) <= 1 && batchTotal != null && Number.isFinite(batchTotal) && batchTotal >= 0 && !fallbackBatches.has(batchId)) {
      fallbackBatches.add(batchId); total += batchTotal; known = true; continue
    }
    missing += 1
  }
  return { costUsd: known ? Math.round(total * 100) / 100 : null, linesWithoutCost: missing }
}

function paymentState(rows: Row[]): Session['paymentStatus'] {
  const values = [...new Set(rows.map((row) => String(row.batch_payment_status || '')).filter((value) => value === 'paid' || value === 'credit'))]
  return values.length > 1 ? 'mixed' : (values[0] as 'paid' | 'credit' | undefined) || ''
}

function formatUsd(value: unknown): string {
  const amount = Number(value)
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '—'
}

export default function StockInSessionsSection({ t, notify, branches, onChanged }: { t: T; notify: (message: string, kind?: string) => void; branches: Branch[]; onChanged: () => void }) {
  const tr = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const [sessions, setSessions] = useState<Session[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [totalSessions, setTotalSessions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<Session | null>(null)
  const [selectedLine, setSelectedLine] = useState<Row | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editSupplier, setEditSupplier] = useState<SupplierChoice>({ supplierId: null, supplierName: '' })
  const [editPayment, setEditPayment] = useState<'paid' | 'credit'>('paid')
  const [editCreditDueDate, setEditCreditDueDate] = useState('')
  const [addMore, setAddMore] = useState<Session | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const payload = await getStockInSessions({ page, pageSize, search }) as { sessions?: Array<Record<string, unknown>>; total?: number }
      if (!payload || !Array.isArray(payload.sessions)) {
        throw new Error(tr('stock_sessions_invalid_response', 'Stock-in sessions returned an unexpected response. Please retry.'))
      }
      const nextTotal = Math.max(0, Number(payload.total) || 0)
      const nextPage = clampPage(page, nextTotal, pageSize)
      if (nextPage !== page) {
        setPage(nextPage)
        return
      }
      const mapped = payload.sessions.map((row, index): Session => ({
        key: String(row.session_key || `session-row-${page}-${index + 1}`), rows: [], quantity: Number(row.quantity) || 0,
        supplier: { supplierId: Number(row.supplier_id) || null, supplierName: Number(row.supplier_state_count) > 1 ? tr('mixed_suppliers', 'Multiple suppliers') : String(row.supplier_name || '') },
        receivedDate: String(row.received_at || ''), branchId: row.branch_id ? String(row.branch_id) : '',
        branchName: Number(row.branch_state_count) > 1 ? tr('multiple_branches', 'Multiple branches') : String(row.branch_name || ''),
        userName: Number(row.user_state_count) > 1 ? tr('multiple_users', 'Multiple users') : String(row.user_name || ''), createdAt: String(row.created_at || ''),
        costUsd: Number(row.movement_cost_usd) > 0 ? Number(row.movement_cost_usd) : null,
        linesWithoutCost: Number(row.lines_without_movement_cost) || 0,
        paymentStatus: Number(row.payment_state_count) > 1 ? 'mixed' : (row.payment_status === 'paid' || row.payment_status === 'credit' ? row.payment_status : ''),
        creditDueDate: String(row.credit_due_date || ''), hasSharedBatch: false,
        hasMixedHeader: Number(row.supplier_state_count) > 1 || Number(row.branch_state_count) > 1 || Number(row.user_state_count) > 1,
      }))
      setSessions(mapped)
      setTotalSessions(nextTotal)
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('load_failed', 'Could not load stock-in sessions')
      setLoadError(message)
      notify(message, 'error')
    } finally { setLoading(false) }
  }, [notify, page, pageSize, search, tr])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 200)
    return () => window.clearTimeout(timer)
  }, [load])

  // N14: one date per business DAY on a divider row, and each session row then
  // carries only its wall clock -- the same treatment the Stock Changes ledger
  // has shipped since Aug 30 2026. The shared helper (utils/businessDayGroups)
  // keys on Asia/Phnom_Penh, not the device calendar, so a 23:30 Phnom Penh
  // receipt does not slide onto the neighbouring day for a device abroad.
  // Rows already arrive created_at DESC from GET /products/stock-in-sessions.
  const dayGroups = useMemo(() => groupByBusinessDay(sessions, (session) => session.createdAt), [sessions])

  const open = async (summary: Session) => {
    if (opening) return
    setOpening(true)
    try {
      const payload = await getStockInSessionLines(summary.key) as { rows?: Row[]; truncated?: boolean }
      if (!payload || !Array.isArray(payload.rows)) {
        throw new Error(tr('stock_session_invalid_response', 'Stock-in session details returned an unexpected response. Please retry.'))
      }
      if (payload.truncated) throw new Error(tr('stock_session_too_large', 'This session has more than 2,000 lines. Narrow or split it before editing.'))
      const rows = payload.rows
      const cost = sessionCost(rows)
      const session = {
        ...summary, rows, costUsd: cost.costUsd, linesWithoutCost: cost.linesWithoutCost,
        paymentStatus: paymentState(rows), creditDueDate: rows.find((row) => row.batch_credit_due_date)?.batch_credit_due_date || '',
        hasSharedBatch: rows.some((row) => Number(row.batch_receipt_session_count) > 1),
        hasMixedHeader: summary.hasMixedHeader,
      } satisfies Session
      setSelected(session); setSelectedLine(null); setEditing(false); setEditDate(session.receivedDate); setEditSupplier(session.supplier)
      setEditPayment(session.paymentStatus === 'credit' ? 'credit' : 'paid'); setEditCreditDueDate(session.creditDueDate)
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('load_failed', 'Could not load stock-in session'), 'error')
    } finally { setOpening(false) }
  }
  const saveHeader = async () => {
    if (!selected || busy) return
    if (selected.hasSharedBatch || selected.hasMixedHeader) {
      notify(tr('shared_batch_session_edit_blocked', 'This session shares a lot with another receipt. Review both receipts before editing the lot; changing it here could rewrite another session.'), 'error')
      return
    }
    if (editPayment === 'credit' && !editCreditDueDate.trim()) {
      notify(tr('fast_stockin_credit_due', 'On-credit stock needs a due date'), 'error')
      return
    }
    if (!window.confirm(tr(
      'confirm_update_stock_session',
      'Update the receipt details for this {count}-line stock-in session? The selected lot records will be updated.',
    ).replace('{count}', String(selected.rows.length)))) return
    setBusy(true)
    try {
      const batches = new Map<number, Row>()
      for (const row of selected.rows) if (Number(row.batch_id)) batches.set(Number(row.batch_id), row)
      for (const [batchId, row] of batches) await updateBatch(batchId, {
        receivedAt: editDate || null,
        supplierId: editSupplier.supplierId,
        supplierName: editSupplier.supplierName,
        paymentStatus: editPayment,
        creditDueDate: editPayment === 'credit' ? editCreditDueDate : null,
        expectedUpdatedAt: row.batch_updated_at || null,
      })
      notify(tr('stock_session_updated', 'Stock-in session updated'))
      setEditing(false); setSelected(null); await load(); onChanged()
    } catch (error) { notify(error instanceof Error ? error.message : tr('update_failed', 'Update failed'), 'error') }
    finally { setBusy(false) }
  }
  const removeRow = async (row: Row) => {
    if (busy || !window.confirm(tr('confirm_remove_stock_line', `Remove ${row.product_name} from this session? This posts a reversing stock movement.`))) return
    setBusy(true)
    try { await revertStockMovement(row.id); notify(tr('movement_reverted', 'Stock line removed')); setSelected(null); await load(); onChanged() }
    catch (error) { notify(error instanceof Error ? error.message : tr('update_failed', 'Update failed'), 'error') }
    finally { setBusy(false) }
  }
  const removeSession = async () => {
    if (!selected || busy || !window.confirm(tr('confirm_remove_stock_session', `Remove this ${selected.rows.length}-line stock-in session? Each line will be reversed; history is preserved.`))) return
    setBusy(true)
    try {
      for (const row of selected.rows) await revertStockMovement(row.id)
      notify(tr('stock_session_removed', 'Stock-in session removed'))
      setSelected(null); await load(); onChanged()
    } catch (error) { notify(error instanceof Error ? error.message : tr('update_failed', 'Update failed'), 'error') }
    finally { setBusy(false) }
  }

  return <div className="space-y-3">
    <div className="sticky top-0 z-20 flex gap-2 bg-gray-50/95 py-1 backdrop-blur dark:bg-gray-900/95">
      <div className="min-w-0 flex-1"><SearchInput id="stock-in-session-search" value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder={tr('search_stock_sessions', 'Search products, suppliers, users…')} /></div>
      <ScanSearchButton onDetected={(value) => { setSearch(value); setPage(1) }} t={t} />
    </div>
    {loading ? <div className="py-10 text-center text-sm text-gray-400">{tr('loading', 'Loading')}…</div> : loadError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"><p>{loadError}</p><button type="button" className="btn-secondary mt-3 h-9 px-3 text-xs" onClick={() => void load()}>{tr('retry', 'Retry')}</button></div> : !sessions.length ? <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{tr('no_stock_sessions', 'No stock-in sessions found')}</div> : (<>
      <div className="desktop-dense-only dense-data-shell">
        <div className="scroll-x">
          <table className="dense-data-table min-w-[900px]" aria-label={tr('stock_in_sessions', 'Stock-in Sessions')}>
            <colgroup><col className="w-[8rem]" /><col className="w-[18%]" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[8rem]" /><col className="w-[7rem]" /><col /></colgroup>
            <thead><tr><th>{tr('session_id', 'Session ID')}</th><th data-tone="blue">{tr('supplier', 'Supplier')}</th><th>{tr('branch', 'Branch')}</th><th>{tr('cashier_user', 'User')}</th><th data-tone="violet">{tr('payment', 'Payment')}</th><th data-tone="emerald" className="text-right">{tr('quantity', 'Quantity')}</th><th data-tone="amber" className="text-right">{tr('total_cost', 'Total cost')}</th><th>{tr('time', 'Time')}</th></tr></thead>
            <tbody>{dayGroups.flatMap((group) => [
              <tr key={`day-${group.key}`} className="dense-day-row"><td colSpan={8}>{group.key} · {group.rows.length}</td></tr>,
              ...group.rows.map((session) => <tr key={session.key} data-clickable="true" tabIndex={0} onClick={() => void open(session)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void open(session) } }} aria-label={`${session.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}, ${session.quantity}`}>
              <td><span className="dense-cell-truncate dense-id font-semibold text-blue-700 dark:text-blue-300" title={session.key}>{stockSessionId(session.createdAt) || session.key}</span></td>
              <td><span className="dense-cell-truncate font-semibold" title={session.supplier.supplierName}>{session.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}</span></td>
              <td><span className="dense-cell-truncate" title={session.branchName}>{session.branchName || '—'}</span></td>
              <td><span className="dense-cell-truncate" title={session.userName}>{session.userName || tr('unknown_user', 'Unknown user')}</span></td>
              <td><span className={`inline-flex rounded px-1.5 py-0.5 font-semibold ${session.paymentStatus === 'credit' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' : session.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{session.paymentStatus === 'credit' ? tr('on_credit', 'On credit') : session.paymentStatus === 'paid' ? tr('paid', 'Paid') : tr('not_recorded', 'Not recorded')}</span></td>
              <td className="text-right font-bold tabular-nums text-emerald-600">+{session.quantity}</td>
              <td className="text-right font-semibold tabular-nums">{session.costUsd == null ? '—' : `$${session.costUsd.toFixed(2)}`}</td>
              {/* Time only -- the day divider above carries the date, and the
                  full stamp stays revealable on hover (truncated-text rule). */}
              <td><span className="dense-cell-truncate tabular-nums" title={fmtDateTime24(session.createdAt)}>{fmtClock24(session.createdAt)}</span></td>
            </tr>),
            ])}</tbody>
          </table>
        </div>
      </div>
      <div className="mobile-cards-only space-y-1.5">{dayGroups.flatMap((group) => [
        <div key={`day-${group.key}`} className="px-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group.key} · {group.rows.length}</div>,
        ...group.rows.map((session) => <button key={session.key} type="button" disabled={opening} onClick={() => void open(session)} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left shadow-sm hover:border-blue-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{session.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}</span><span className="block truncate dense-id text-gray-400" title={fmtDateTime24(session.createdAt)}>{stockSessionId(session.createdAt) || session.key} · {fmtClock24(session.createdAt)}</span><span className="block truncate text-[11px] text-gray-400">{session.branchName || '—'} · {session.userName || tr('unknown_user', 'Unknown user')}</span></span>
          <span className="shrink-0 text-right"><span className="block text-sm font-bold text-emerald-600">+{session.quantity}</span><span className="block text-[11px] font-semibold text-gray-500">{session.costUsd == null ? '—' : `$${session.costUsd.toFixed(2)}`}</span></span>
        </button>),
      ])}</div>
    </>)}
    <div className="flex justify-center"><PaginationControls compact rangeAsPageSize page={page} pageSize={pageSize} totalItems={totalSessions} label={tr('stock_in_sessions', 'stock-in sessions')} t={t} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} /></div>

    {/* S4-14: the id the list row shows is repeated in the title, so the row
        an operator clicked and the receipt they read back are the same thing. */}
    {selected ? <Modal title={`${tr('stock_in_session', 'Stock-in session')}${stockSessionId(selected.createdAt) ? ` · ${stockSessionId(selected.createdAt)}` : ''}`} onClose={() => setSelected(null)} size="lg" unsavedChanges={{ dirty: editing }}>
      <div className="space-y-3">
        {editing ? <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60">
          <label><span className="mb-1 block text-[11px] text-gray-500">{tr('received_date', 'Received date')}</span><DateEntryInput className="h-9 text-sm" t={t} ariaLabel={tr('received_date', 'Received date')} value={String(editDate || '').slice(0, 10)} onChange={(iso) => setEditDate(iso)} /></label>
          <SupplierPickerField value={editSupplier} onChange={setEditSupplier} tr={(key, fallback = key) => tr(key, fallback)} idPrefix="stock-session-edit" />
          <label><span className="mb-1 block text-[11px] text-gray-500">{tr('payment', 'Payment')}</span><AppSelect ariaLabel={tr('payment', 'Payment')} value={editPayment} onChange={(value) => setEditPayment(value as 'paid' | 'credit')} buttonClassName="h-9 w-full text-sm" optionClassName="text-sm" options={[{ value: 'paid', label: tr('paid', 'Paid') }, { value: 'credit', label: tr('on_credit', 'On credit') }]} /></label>
          {editPayment === 'credit' ? <label><span className="mb-1 block text-[11px] text-gray-500">{tr('due_date', 'Due date')}</span><DateEntryInput className="h-9 text-sm" t={t} ariaLabel={tr('due_date', 'Due date')} value={String(editCreditDueDate || '').slice(0, 10)} onChange={(iso) => setEditCreditDueDate(iso)} /></label> : <div />}
          {selected.hasSharedBatch || selected.hasMixedHeader ? <div className="col-span-2 text-[11px] text-amber-700 dark:text-amber-300">{tr('shared_batch_session_edit_blocked', 'This session contains shared lots or mixed linked headers. Review its receipts before editing; changing them together could rewrite another session.')}</div> : null}
        </div> : <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-gray-50 p-2.5 text-xs dark:bg-gray-800/60 sm:grid-cols-4">
          <div className="col-span-2 min-w-0 sm:col-span-1"><div className="truncate font-semibold text-gray-900 dark:text-white">{selected.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}</div><div className="truncate text-gray-400">{selected.branchName || '—'}</div></div>
          <div><div className="text-gray-400">{tr('received_date', 'Received date')}</div><div className="text-gray-700 dark:text-gray-200">{fmtDate(selected.receivedDate || selected.createdAt)}</div></div>
          <div><div className="text-gray-400">{tr('recorded', 'Recorded')}</div><div className="text-gray-700 dark:text-gray-200">{fmtDateTime24(selected.createdAt)}</div></div>
          <div><div className="text-gray-400">{tr('cashier_user', 'User')}</div><div className="truncate text-gray-700 dark:text-gray-200">{selected.userName || tr('unknown_user', 'Unknown user')}</div></div>
          <div><div className="text-gray-400">{tr('total_cost', 'Total cost')}</div><div className="font-semibold text-gray-700 dark:text-gray-200">{selected.costUsd == null ? '—' : `$${selected.costUsd.toFixed(2)}`}</div></div>
          <div><div className="text-gray-400">{tr('payment', 'Payment')}</div><div className="text-gray-700 dark:text-gray-200">{selected.paymentStatus === 'credit' ? `${tr('on_credit', 'On credit')}${selected.creditDueDate ? ` · ${fmtDate(selected.creditDueDate)}` : ''}` : selected.paymentStatus === 'paid' ? tr('paid', 'Paid') : tr('not_recorded', 'Not recorded')}</div></div>
          <div><div className="text-gray-400">{tr('quantity', 'Quantity')}</div><div className="font-semibold text-emerald-600">+{selected.quantity}</div></div>
          {selected.linesWithoutCost ? <div className="col-span-2 text-[11px] text-amber-700 dark:text-amber-300 sm:col-span-4">{selected.linesWithoutCost} {tr('stock_lines_without_cost', 'line(s) have no receipt-level cost. Shared-lot totals are not guessed.')}</div> : null}
        </div>}
        {selectedLine ? <div className="relative grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-blue-100 bg-blue-50/55 p-3 text-xs dark:border-blue-900/60 dark:bg-blue-950/20 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          {selectedLine.image_path ? <ProductImg src={selectedLine.image_path} alt={selectedLine.product_name} className="h-14 w-14 rounded-lg object-cover sm:h-[4.5rem] sm:w-[4.5rem]" /> : <ProductImagePlaceholder compact className="h-14 w-14 rounded-lg sm:h-[4.5rem] sm:w-[4.5rem]" />}
          <div className="min-w-0 pr-7"><div className="break-words font-semibold text-gray-900 dark:text-white">{selectedLine.product_name}</div><div className="mt-0.5 break-all dense-id text-gray-500">{selectedLine.barcode || tr('barcode_not_recorded', 'Barcode not recorded')}{selectedLine.sku ? ` · ${selectedLine.sku}` : ''}</div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4"><div><span className="block text-gray-400">{tr('quantity', 'Quantity')}</span><b className="text-emerald-600">+{Math.abs(Number(selectedLine.quantity) || 0)} {selectedLine.unit || ''}</b></div><div><span className="block text-gray-400">{tr('receipt_cost', 'Receipt cost')}</span><b>{formatUsd(selectedLine.unit_cost_usd ?? selectedLine.batch_unit_cost_usd)}</b></div><div><span className="block text-gray-400">{tr('selling_price', 'Selling price')}</span><b>{formatUsd(selectedLine.selling_price_usd)}</b></div><div><span className="block text-gray-400">{tr('purchase_price', 'Purchase price')}</span><b>{formatUsd(selectedLine.purchase_price_usd ?? selectedLine.cost_price_usd)}</b></div><div><span className="block text-gray-400">{tr('brand', 'Brand')}</span><b className="break-words">{selectedLine.brand || '—'}</b></div><div><span className="block text-gray-400">{tr('category', 'Category')}</span><b className="break-words">{selectedLine.category || '—'}</b></div><div><span className="block text-gray-400">{tr('batch', 'Batch')}</span><b className="dense-id">{selectedLine.batch_lot_code || `#${selectedLine.batch_id || '—'}`}</b></div><div><span className="block text-gray-400">{tr('expiry_date', 'Expiry')}</span><b>{selectedLine.batch_expiry_date ? fmtDate(selectedLine.batch_expiry_date) : '—'}</b></div><div><span className="block text-gray-400">{tr('supplier', 'Supplier')}</span><b className="truncate">{selectedLine.batch_supplier_name || '—'}</b></div><div><span className="block text-gray-400">{tr('payment', 'Payment')}</span><b>{selectedLine.batch_payment_status === 'credit' ? tr('on_credit', 'On credit') : selectedLine.batch_payment_status === 'paid' ? tr('paid', 'Paid') : '—'}</b></div></div>
          </div><button type="button" className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-white dark:hover:bg-gray-800" onClick={() => setSelectedLine(null)}>{tr('close', 'Close')}</button>
        </div> : null}
        <div className="desktop-dense-only dense-data-shell">
          <div className="scroll-x"><table className="dense-data-table min-w-[720px]">
            <thead><tr><th data-tone="blue">{tr('product', 'Product')}</th><th>{tr('barcode', 'Barcode')}</th><th>{tr('batch', 'Batch')}</th><th>{tr('reason', 'Reason')}</th><th data-tone="emerald" className="text-right">{tr('quantity', 'Quantity')}</th><th data-tone="amber" className="text-right">{tr('unit_cost', 'Unit cost')}</th><th className="w-10" aria-label={tr('actions', 'Actions')} /></tr></thead>
            <tbody>{selected.rows.map((row) => {
              const unitCost = row.total_cost_usd != null && Number(row.total_cost_usd) > 0 ? Number(row.total_cost_usd) / Math.max(1, Math.abs(Number(row.quantity) || 0)) : row.unit_cost_usd
              return <tr key={row.id} className={selectedLine?.id === row.id ? 'bg-blue-50/70 dark:bg-blue-950/20' : ''}>
                <td><button type="button" onClick={() => setSelectedLine(row)} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 text-left hover:text-blue-700 dark:hover:text-blue-300"><span>{row.image_path ? <ProductImg src={row.image_path} alt="" className="h-8 w-8 rounded object-cover" /> : <ProductImagePlaceholder compact className="h-8 w-8 rounded" />}</span><span className="min-w-0"><span className="block dense-cell-truncate font-semibold" title={row.product_name}>{row.product_name}</span><span className="block dense-cell-truncate text-[10px] text-gray-400">{[row.unit, row.tag_label].filter(Boolean).join(' · ')}</span></span></button></td>
                <td><span className="dense-cell-truncate dense-id" title={row.barcode || ''}>{row.barcode || '—'}</span></td>
                <td><span className="dense-cell-truncate dense-id">{row.batch_id || '—'}</span></td>
                <td><span className="dense-cell-truncate text-gray-500" title={row.reason || ''}>{row.reason || '—'}</span></td>
                <td className="text-right font-bold tabular-nums text-emerald-600">+{Math.abs(Number(row.quantity) || 0)}</td>
                <td className="text-right tabular-nums">{unitCost == null || Number(unitCost) <= 0 ? '—' : `$${Number(unitCost).toFixed(2)}`}</td>
                <td><button type="button" disabled={busy} onClick={() => void removeRow(row)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={tr('remove_stock', 'Remove Stock')}><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            })}</tbody>
          </table></div>
        </div>
        <div className="mobile-cards-only space-y-1">{selected.rows.map((row) => {
          const unitCost = row.total_cost_usd != null && Number(row.total_cost_usd) > 0 ? Number(row.total_cost_usd) / Math.max(1, Math.abs(Number(row.quantity) || 0)) : row.unit_cost_usd
          return <div key={row.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 ${selectedLine?.id === row.id ? 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/20' : 'border-gray-100 dark:border-gray-700'}`}>
            <button type="button" onClick={() => setSelectedLine(row)} className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2 text-left"><span>{row.image_path ? <ProductImg src={row.image_path} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <ProductImagePlaceholder compact className="h-10 w-10 rounded-lg" />}</span><span className="min-w-0"><span className="block break-words text-[13px] font-medium leading-4 text-gray-800 dark:text-gray-100">{row.product_name}</span><span className="block break-all text-[11px] text-gray-400">{[row.barcode, row.unit, row.tag_label].filter(Boolean).join(' · ') || tr('details_not_recorded', 'Details not recorded')}</span>{row.reason ? <span className="block truncate text-[11px] text-gray-400">{row.reason}</span> : null}</span></button>
            <span className="shrink-0 text-right"><b className="block text-sm text-emerald-600">+{Math.abs(Number(row.quantity) || 0)}</b><span className="block text-[11px] text-gray-400">{unitCost == null || Number(unitCost) <= 0 ? '—' : `$${Number(unitCost).toFixed(2)} / ${row.unit || tr('unit', 'unit')}`}</span></span>
            <button type="button" disabled={busy} onClick={() => void removeRow(row)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={tr('remove_stock', 'Remove Stock')}><Trash2 className="h-4 w-4" /></button>
          </div>
        })}</div>
        <div className="compact-action-row border-t border-gray-100 pt-3 dark:border-gray-700">{editing ? <><button type="button" disabled={busy} className="btn-primary h-8 px-2.5 text-xs" onClick={() => void saveHeader()}>{tr('save', 'Save')}</button><button type="button" disabled={busy} className="btn-secondary h-8 px-2.5 text-xs" onClick={() => setEditing(false)}>{tr('cancel', 'Cancel')}</button></> : <><button type="button" className="btn-secondary inline-flex h-8 items-center gap-1 px-2.5 text-xs" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />{tr('edit', 'Edit')}</button><button type="button" className="btn-primary inline-flex h-8 items-center gap-1 px-2.5 text-xs" onClick={() => { setAddMore(selected); setSelected(null) }}><Plus className="h-3.5 w-3.5" />{tr('add_more', 'Add more')}</button><button type="button" disabled={busy} className="btn-danger ml-auto inline-flex h-8 items-center gap-1 px-2.5 text-xs" onClick={() => void removeSession()}><Trash2 className="h-3.5 w-3.5" />{tr('remove_session', 'Remove')}</button></>}</div>
      </div>
    </Modal> : null}
    {addMore ? <Suspense fallback={null}><FastStockInModal branchOptions={branches.map((branch) => ({ value: String(branch.id || ''), label: String(branch.name || branch.id || '') }))} defaultBranchId={addMore.branchId || null} initialHeader={{ branchId: addMore.branchId, receivedDate: addMore.receivedDate, supplier: addMore.supplier, paymentStatus: addMore.paymentStatus === 'credit' ? 'credit' : 'paid', creditDueDate: addMore.creditDueDate }} tr={(key, fallback = key) => tr(key, fallback)} notify={notify} onClose={() => setAddMore(null)} onDone={() => { void load(); onChanged() }} /></Suspense> : null}
  </div>
}
