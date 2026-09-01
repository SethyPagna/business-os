import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { getStockLedger } from '../../api/productReadTransport.ts'
import { revertStockMovement } from '../../api/inventoryWriteTransport.ts'
import { updateBatch } from '../../api/batchesTransport.ts'
import { fmtDate, fmtDateTime24 } from '../../utils/formatters.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Modal from '../shared/Modal.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'

const FastStockInModal = lazyRetry(() => import('../inventory/FastStockInModal.tsx'), 'stock-session-fast-stock-in')

type T = (key: string) => string
type Branch = { id?: string | number; name?: string }
type Row = {
  id: number; product_id: number; product_name: string; barcode?: string | null; quantity: number
  branch_id?: number | null; branch_name?: string | null; user_name?: string | null; created_at: string
  reference_id?: number | string | null; batch_id?: number | null; batch_received_at?: string | null
  batch_supplier_id?: number | null; batch_supplier_name?: string | null; movement_type: string
}
type Session = {
  key: string; rows: Row[]; supplier: SupplierChoice; receivedDate: string; branchId: string
  branchName: string; userName: string; createdAt: string; quantity: number
}

function sessionKey(row: Row): string {
  if (row.reference_id) return `session:${row.reference_id}`
  const stamp = new Date(row.created_at).getTime()
  const tenMinuteBucket = Number.isFinite(stamp) ? Math.floor(stamp / 600000) : row.id
  return `legacy:${tenMinuteBucket}:${row.user_name || ''}:${row.branch_id || ''}:${row.batch_supplier_id || row.batch_supplier_name || ''}:${row.batch_received_at || ''}`
}

export default function StockInSessionsSection({ t, notify, branches, onChanged }: { t: T; notify: (message: string, kind?: string) => void; branches: Branch[]; onChanged: () => void }) {
  const tr = useCallback((key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }, [t])
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Session | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editSupplier, setEditSupplier] = useState<SupplierChoice>({ supplierId: null, supplierName: '' })
  const [addMore, setAddMore] = useState<Session | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await getStockLedger({ view: 'all', page: 1, pageSize: 1000 }) as { items?: Row[] }
      const all = payload.items || []
      const reverted = new Set(all.map((row) => String(row.reference_id || '')).filter((value) => value.startsWith('revert:')).map((value) => Number(value.slice(7))))
      setRows(all.filter((row) => row.movement_type === 'add' && !!row.batch_id && !reverted.has(Number(row.id))))
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('load_failed', 'Could not load stock-in sessions'), 'error')
    } finally { setLoading(false) }
  }, [notify, tr])
  useEffect(() => { void load() }, [load])

  const sessions = useMemo(() => {
    const map = new Map<string, Session>()
    for (const row of rows) {
      const key = sessionKey(row)
      const current = map.get(key)
      if (current) { current.rows.push(row); current.quantity += Math.abs(Number(row.quantity) || 0); continue }
      map.set(key, {
        key, rows: [row], quantity: Math.abs(Number(row.quantity) || 0),
        supplier: { supplierId: row.batch_supplier_id || null, supplierName: row.batch_supplier_name || '' },
        receivedDate: row.batch_received_at || '', branchId: row.branch_id ? String(row.branch_id) : '',
        branchName: row.branch_name || '', userName: row.user_name || '', createdAt: row.created_at,
      })
    }
    const query = search.trim().toLowerCase()
    return [...map.values()].filter((session) => !query || [session.supplier.supplierName, session.branchName, session.userName, ...session.rows.flatMap((row) => [row.product_name, row.barcode || ''])].join(' ').toLowerCase().includes(query))
  }, [rows, search])

  const open = (session: Session) => { setSelected(session); setEditing(false); setEditDate(session.receivedDate); setEditSupplier(session.supplier) }
  const saveHeader = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const batchIds = [...new Set(selected.rows.map((row) => Number(row.batch_id)).filter(Boolean))]
      for (const batchId of batchIds) await updateBatch(batchId, { receivedAt: editDate || null, supplierId: editSupplier.supplierId, supplierName: editSupplier.supplierName })
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
      <div className="min-w-0 flex-1"><SearchInput id="stock-in-session-search" value={search} onChange={setSearch} placeholder={tr('search_stock_sessions', 'Search products, suppliers, users…')} /></div>
      <ScanSearchButton onDetected={setSearch} t={t} showLabel />
    </div>
    {loading ? <div className="py-10 text-center text-sm text-gray-400">{tr('loading', 'Loading')}…</div> : !sessions.length ? <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{tr('no_stock_sessions', 'No stock-in sessions found')}</div> : (
      <div className="space-y-2">{sessions.map((session) => <button key={session.key} type="button" onClick={() => open(session)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm hover:border-blue-300 dark:border-gray-700 dark:bg-gray-900">
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{session.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}</span><span className="block truncate text-xs text-gray-400">{fmtDate(session.receivedDate || session.createdAt)} · {session.userName || tr('unknown_user', 'Unknown user')} · {session.branchName || '—'}</span></span>
        <span className="shrink-0 text-right"><span className="block text-sm font-bold text-emerald-600">+{session.quantity}</span><span className="text-[11px] text-gray-400">{session.rows.length} {tr('products', 'products')}</span></span>
      </button>)}</div>
    )}

    {selected ? <Modal title={tr('stock_in_session', 'Stock-in session')} onClose={() => setSelected(null)} size="lg">
      <div className="space-y-3">
        {editing ? <div className="grid gap-3 rounded-xl bg-gray-50 p-3 sm:grid-cols-2 dark:bg-gray-800/60"><label><span className="mb-1 block text-xs text-gray-500">{tr('received_date', 'Received date')}</span><input className="input" value={editDate} onChange={(event) => setEditDate(event.target.value)} placeholder="mm/dd/yyyy" /></label><SupplierPickerField value={editSupplier} onChange={setEditSupplier} tr={(key, fallback = key) => tr(key, fallback)} idPrefix="stock-session-edit" /></div> : <div className="rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800/60"><div className="font-semibold text-gray-900 dark:text-white">{selected.supplier.supplierName || tr('supplier_not_recorded', 'Supplier not recorded')}</div><div className="mt-1 text-xs text-gray-400">{fmtDate(selected.receivedDate || selected.createdAt)} · {selected.userName || tr('unknown_user', 'Unknown user')} · {selected.branchName || '—'}</div><div className="mt-1 text-xs text-gray-400">{tr('recorded', 'Recorded')}: {fmtDateTime24(selected.createdAt)}</div></div>}
        <div className="space-y-1">{selected.rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-700"><span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">{row.product_name}</span>{row.barcode ? <span className="block truncate font-mono text-[11px] text-gray-400">{row.barcode}</span> : null}</span><span className="flex shrink-0 items-center gap-2"><b className="text-sm text-emerald-600">+{Math.abs(Number(row.quantity) || 0)}</b><button type="button" disabled={busy} onClick={() => void removeRow(row)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={tr('remove_stock', 'Remove Stock')}><Trash2 className="h-4 w-4" /></button></span></div>)}</div>
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">{editing ? <><button type="button" disabled={busy} className="btn-primary" onClick={() => void saveHeader()}>{tr('save', 'Save')}</button><button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditing(false)}>{tr('cancel', 'Cancel')}</button></> : <><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />{tr('edit', 'Edit')}</button><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => { setAddMore(selected); setSelected(null) }}><Plus className="h-4 w-4" />{tr('add_more', 'Add more')}</button><button type="button" disabled={busy} className="btn-danger ml-auto inline-flex items-center gap-1.5" onClick={() => void removeSession()}><Trash2 className="h-4 w-4" />{tr('remove_session', 'Remove session')}</button></>}</div>
      </div>
    </Modal> : null}
    {addMore ? <Suspense fallback={null}><FastStockInModal branchOptions={branches.map((branch) => ({ value: String(branch.id || ''), label: String(branch.name || branch.id || '') }))} defaultBranchId={addMore.branchId || null} initialHeader={{ branchId: addMore.branchId, receivedDate: addMore.receivedDate, supplier: addMore.supplier }} tr={(key, fallback = key) => tr(key, fallback)} notify={notify} onClose={() => setAddMore(null)} onDone={() => { void load(); onChanged() }} /></Suspense> : null}
  </div>
}
